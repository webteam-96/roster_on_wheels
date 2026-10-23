using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Citation matrix endpoint shared by:
//  · /districts/{id}/district-report  (Download under District Citation row)
//  · /district-admin-dashboard/egovernance  (Download under Citation tab)
//  · /clubs/{id}/club-report/v2  (Download as the sole report)
//
// Returns the per-column basePoints + answerType and per-cell
// { achievedDisplay, achievedNumeric, total } needed for the
// 3-sub-section matrix Excel export (Base | Achieved | Total).
[ApiController]
[Route("api/citation-matrix")]
[Authorize]
public class CitationMatrixController : ControllerBase
{
    private readonly string _connectionString;

    public CitationMatrixController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    [HttpGet]
    public async Task<ActionResult> GetMatrix([FromQuery] int districtId, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        // Same readers as /api/districts/{id}/district-report, or /api/clubs/{id}/club-report when one club is asked for.
        var me = int.TryParse(User.FindFirst("memberId")?.Value, out var mid) ? mid : 0;
        if (me <= 0 || !(await RotaryApi.Services.ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, me, false, districtId)
                         || (clubId > 0 && await RotaryApi.Services.ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, me, true, clubId.Value))))
            return StatusCode(403, new { message = "You do not have access to this district." });
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Resolve year — fall back to current rotary year.
        var resolvedYearId = yearId.GetValueOrDefault();
        if (resolvedYearId <= 0)
        {
            resolvedYearId = await conn.ExecuteScalarAsync<int>(
                "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        }
        if (resolvedYearId <= 0) return BadRequest(new { message = "No current rotary year configured." });

        var district = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_district_id AS districtId, DistrictNumber AS districtNumber FROM district_master WHERE pk_district_id = @D AND isdeleted = 0",
            new { D = districtId });
        if (district == null) return NotFound(new { message = "District not found." });

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id",
            new { Id = resolvedYearId });

        var clubFilter = clubId.HasValue && clubId.Value > 0 ? " AND pk_club_id = @ClubId" : "";
        // user 2026-10-08: Rotaract clubs only for SuperAdmin.
        if (RotaryApi.Services.ClubScopeSql.HideRotaract(RotaryApi.Services.UserPermissionHelper.IsSuperAdmin(User)))
            clubFilter += " AND " + RotaryApi.Services.ClubScopeSql.NotRotaract("");
        var clubs = (await conn.QueryAsync<dynamic>($@"
            SELECT pk_club_id AS clubId, ClubName AS clubName
            FROM club_master
            WHERE fk_district_id = @D AND isdeleted = 0{clubFilter}
            ORDER BY ClubName",
            new { D = districtId, ClubId = clubId })).ToList();

        var categories = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, category_name AS name, sort_order AS sortOrder
            FROM district_citation_category
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
            ORDER BY sort_order, category_name",
            new { D = districtId, Y = resolvedYearId })).ToList();

        // Title appends the sub-item lineage so the matrix column header is
        // unique per auto question — e.g. three "Club Service" rows become
        // "Club Service · Environment" / "Club Service · Basic Education" etc.
        var autoQs = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS questionId, q.fk_category_id AS categoryId,
                   CONCAT(
                       a.activity_name,
                       IFNULL((
                           SELECT CONCAT(' · ', GROUP_CONCAT(
                               CASE
                                   WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN COALESCE(aof_only.name, s.sub_item_name)
                                   ELSE s.sub_item_name
                               END
                               ORDER BY s.sort_order SEPARATOR ' / '
                           ))
                           FROM district_citation_auto_question_sub s
                           LEFT JOIN area_of_focus_master aof_only      ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
                           WHERE s.fk_auto_question_id = q.pk_id AND s.isdeleted = 0
                       ), '')
                   ) AS title,
                   q.sort_order AS sortOrder,
                   /* Base points for auto questions can live either on the parent
                      (q.points) OR on each sub-item (district_citation_auto_question_sub.points).
                      Summing both sources fixes the Base-equals-0 bug for number-type questions
                      whose points are stored only on sub-items. */
                   (COALESCE(q.points, 0)
                    + COALESCE((SELECT SUM(s.points)
                                FROM district_citation_auto_question_sub s
                                WHERE s.fk_auto_question_id = q.pk_id AND s.isdeleted = 0), 0)
                   ) AS basePoints
            FROM district_citation_auto_question q
            INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
            ORDER BY q.fk_category_id, q.sort_order, a.activity_name",
            new { D = districtId, Y = resolvedYearId })).ToList();

        var manualQs = (await conn.QueryAsync<dynamic>(@"
            SELECT sc.pk_id AS questionId, mc.fk_category_id AS categoryId,
                   CONCAT(mc.criteria_name, ' — ', sc.sub_criteria_title) AS title,
                   (mc.sort_order * 1000 + sc.sort_order) AS sortOrder,
                   sc.points AS basePoints,
                   sc.answer_type AS answerType
            FROM district_citation_manual_sub_criteria sc
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
            WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y
              AND mc.isdeleted = 0 AND sc.isdeleted = 0
            ORDER BY mc.fk_category_id, sortOrder",
            new { D = districtId, Y = resolvedYearId })).ToList();

        // Manual choose_one options — for Achieved display text lookup
        var manualOptions = (await conn.QueryAsync<dynamic>(@"
            SELECT o.pk_id AS id, o.fk_sub_criteria_id AS subCriteriaId,
                   o.option_text AS optionText, o.option_points AS optionPoints
            FROM district_citation_manual_sub_criteria_option o
            INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = o.fk_sub_criteria_id
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
            WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y
              AND o.isdeleted = 0 AND sc.isdeleted = 0 AND mc.isdeleted = 0",
            new { D = districtId, Y = resolvedYearId })).ToList();
        var optionLookup = manualOptions.ToDictionary(o => (int)o.id, o => (string)o.optionText);

        var clubIdCsv = clubs.Count > 0 ? string.Join(",", clubs.Select(c => (int)c.clubId)) : "0";
        var entries = (await conn.QueryAsync<dynamic>($@"
            SELECT e.fk_club_id AS clubId, e.entry_type AS entryType,
                   e.fk_question_id AS questionId,
                   e.answer_value AS answerValue,
                   (e.points_earned + e.bonus_earned) AS score
            FROM district_citation_club_entry e
            WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.isdeleted = 0
              AND e.fk_club_id IN ({clubIdCsv})",
            new { D = districtId, Y = resolvedYearId })).ToList();

        // Assemble: columns ordered category → auto-then-manual within category
        var matrixColumns = new List<object>();
        var matrixCategories = new List<object>();
        foreach (var cat in categories)
        {
            int catId = (int)cat.id;
            var catCols = new List<object>();
            foreach (var q in autoQs.Where(q => (int)q.categoryId == catId))
            {
                catCols.Add(new
                {
                    type = "auto",
                    questionId = (int)q.questionId,
                    title = (string)q.title,
                    basePoints = (decimal?)q.basePoints ?? 0m,
                    answerType = "number"
                });
            }
            foreach (var q in manualQs.Where(q => (int)q.categoryId == catId))
            {
                catCols.Add(new
                {
                    type = "manual",
                    questionId = (int)q.questionId,
                    title = (string)q.title,
                    basePoints = (decimal?)q.basePoints ?? 0m,
                    answerType = NormalizeAnswerType((string?)q.answerType)
                });
            }
            if (catCols.Count == 0) continue;
            matrixCategories.Add(new { id = catId, name = (string)cat.name, span = catCols.Count });
            matrixColumns.AddRange(catCols);
        }

        // Build per-cell payload — for auto we may have multiple sub-item rows per
        // (club, question), so achievedNumeric SUMs and total SUMs across them.
        var rows = new List<object>();
        foreach (var club in clubs)
        {
            int cid = (int)club.clubId;
            var cells = new Dictionary<string, object>();
            var clubEntries = entries.Where(e => (int)e.clubId == cid).ToList();
            var grouped = clubEntries
                .GroupBy(e => new { type = (string)e.entryType, qid = (int)e.questionId });
            foreach (var g in grouped)
            {
                var key = $"{g.Key.type}-{g.Key.qid}";
                decimal total = g.Sum(e => (decimal?)e.score ?? 0m);

                // Decide achieved representation based on answer type
                string achievedDisplay;
                decimal? achievedNumeric;
                if (g.Key.type == "auto")
                {
                    decimal sum = 0; bool any = false;
                    foreach (var e in g)
                    {
                        if (decimal.TryParse((string?)e.answerValue, out var n)) { sum += n; any = true; }
                    }
                    achievedNumeric = any ? sum : (decimal?)null;
                    achievedDisplay = any ? FormatNumber(sum) : "";
                }
                else
                {
                    // manual — only one entry per (club, sub-criteria) expected
                    var first = g.FirstOrDefault();
                    var raw = (string?)first?.answerValue ?? "";
                    var qMeta = manualQs.FirstOrDefault(q => (int)q.questionId == g.Key.qid);
                    var atype = qMeta != null ? NormalizeAnswerType((string?)qMeta.answerType) : "number";
                    if (atype == "yesno")
                    {
                        var lower = raw.Trim().ToLowerInvariant();
                        achievedDisplay = lower == "yes" ? "Yes" : (lower == "no" ? "No" : "");
                        achievedNumeric = null;
                    }
                    else if (atype == "choose_one")
                    {
                        if (int.TryParse(raw, out var optId) && optionLookup.TryGetValue(optId, out var optText))
                            achievedDisplay = optText;
                        else
                            achievedDisplay = raw;
                        achievedNumeric = null;
                    }
                    else
                    {
                        if (decimal.TryParse(raw, out var n))
                        {
                            achievedNumeric = n;
                            achievedDisplay = FormatNumber(n);
                        }
                        else
                        {
                            achievedNumeric = null;
                            achievedDisplay = raw;
                        }
                    }
                }

                cells[key] = new
                {
                    achievedDisplay,
                    achievedNumeric,
                    total
                };
            }
            rows.Add(new { clubId = cid, clubName = (string)club.clubName, cells });
        }

        return Ok(new
        {
            districtId,
            districtNumber = (string?)district.districtNumber ?? "",
            yearId = resolvedYearId,
            yearLabel = year != null ? (string?)year.yearLabel ?? "" : "",
            categories = matrixCategories,
            columns = matrixColumns,
            rows
        });
    }

    private static string NormalizeAnswerType(string? raw)
    {
        var r = (raw ?? "").Trim().ToLowerInvariant().Replace(" ", "").Replace("_", "").Replace("-", "");
        if (r == "yesno" || r == "yn" || r == "boolean" || r == "bool" || r == "yes" || r == "no") return "yesno";
        if (r == "chooseone" || r == "choose" || r == "select" || r == "option" || r == "options" || r == "radio") return "choose_one";
        return "number";
    }

    private static string FormatNumber(decimal n)
    {
        if (n == decimal.Truncate(n)) return ((long)n).ToString();
        return n.ToString("0.##");
    }
}
