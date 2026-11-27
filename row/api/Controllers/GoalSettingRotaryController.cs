using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// New Goal Setting (Rotary.org preview) - extra data the new screens need. Additive: the existing
// Goal Setting endpoints are not touched. Super Admin only until go-live, like the preview pages.
[ApiController]
[Route("api/goal-setting-rotary")]
[Authorize]
public class GoalSettingRotaryController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IGoalSettingService _goals;
    public GoalSettingRotaryController(IConfiguration configuration, IGoalSettingService goals)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _goals = goals;
    }

    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // SuperAdmin, or a District Admin / this year's DG of the district (the same people who can run the sync).
    private async Task<bool> CanReadDistrictAsync(MySqlConnection conn, int districtId) =>
        await ClubAdminAccessHelper.IsSuperAdminAsync(conn, GetMemberId())
        || (districtId > 0 && await conn.ExecuteScalarAsync<int>(@"
                SELECT (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
                          AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0)
                     + (SELECT COUNT(*) FROM district_governors g JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id AND y.IsCurrent = 1
                          WHERE g.fk_member_id = @M AND g.fk_district_id = @D AND COALESCE(g.isdeleted,0) = 0)",
                new { M = GetMemberId(), D = districtId }) > 0);

    // RAG = Rotary.org's 5 club-size bands (my.rotary.org Clubs in District report colours, user
    // 2026-10-26/29): Red 0-10, Yellow 11-25, Orange 26-50, Blue 51-100, Purple 101+, Rotary clubs only.
    // Members are counted like the old RAG (active, not honorary) until the Rotary.org counts are
    // synced; unlike it, a club with 0-9 members is counted too (Red), so the bands add up to the clubs.
    [HttpGet("rag-bands")]
    public async Task<ActionResult> RagBands([FromQuery] int districtId)
    {
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        // Was SuperAdmin only; the district's own admins / DG read it on RCC Goals too (live test 2026-11-27).
        if (!await CanReadDistrictAsync(conn, districtId)) return Forbid();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            $@"SELECT
                  COALESCE(SUM(mc <= 10), 0)              AS Red,
                  COALESCE(SUM(mc BETWEEN 11 AND 25), 0)  AS Yellow,
                  COALESCE(SUM(mc BETWEEN 26 AND 50), 0)  AS Orange,
                  COALESCE(SUM(mc BETWEEN 51 AND 100), 0) AS Blue,
                  COALESCE(SUM(mc >= 101), 0)             AS Purple
              FROM (
                  SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS mc
                  FROM club_master c
                  LEFT JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
                       AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                  LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                       AND m.isdeleted = 0
                  WHERE c.fk_district_id = @Id AND c.IsActive = 1 AND c.isdeleted = 0
                        AND c.IsSyncedFromRotaryOrg = 1 AND {ClubScopeSql.NotRotaract("c")} AND {HierarchyScopeSql.ClubLive("c")}
                  GROUP BY c.pk_club_id
              ) t",
            new { Id = districtId });

        int N(object? v) => v == null ? 0 : Convert.ToInt32(v);
        return Ok(new
        {
            red = N(row?.Red), yellow = N(row?.Yellow), orange = N(row?.Orange),
            blue = N(row?.Blue), purple = N(row?.Purple),
        });
    }

    // Rotary.org figures from the RCC fetch (table goal_rotary_org_values, user 2026-10-29): the
    // Rotary.org-only goals (Target / Achieved) and the yearly history (members, women, RAG bands).
    // One district (clubId empty) or one club, one year. The old Goal Setting never reads this table.
    [HttpGet("rotary-org-values")]
    public async Task<ActionResult> RotaryOrgValues([FromQuery] int yearId, [FromQuery] int? districtId, [FromQuery] int? clubId)
    {
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        if (yearId <= 0 || ((districtId ?? 0) <= 0 && (clubId ?? 0) <= 0))
            return BadRequest(new { message = "yearId and districtId or clubId are required." });
        // ROW: SuperAdmin, or a District Admin / this year's DG of the district (the same people who can run the sync).
        var scopeDistrict = (districtId ?? 0) > 0 ? districtId!.Value
            : await conn.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? 0;
        // RIZones 2026-11-13 (new CMR goal panels): a club's own managers may read that club's figures too.
        var clubReader = (clubId ?? 0) > 0 && await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, GetMemberId(), true, clubId!.Value, members: false);
        if (!clubReader && !await CanReadDistrictAsync(conn, scopeDistrict))
            return Forbid();

        var isCurrent = await conn.ExecuteScalarAsync<int?>(
            "SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId }) == 1;
        var rows = (clubId ?? 0) > 0
            ? await conn.QueryAsync<RotaryOrgValueDto>(@"
                SELECT ItemName, Kind, NumericValue AS Value, Source, COALESCE(modified_date, created_date) AS UpdatedAt
                FROM goal_rotary_org_values
                WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_club_id = @C AND isdeleted = 0", new { Y = yearId, C = clubId })
            : await conn.QueryAsync<RotaryOrgValueDto>(@"
                SELECT ItemName, Kind, NumericValue AS Value, Source, COALESCE(modified_date, created_date) AS UpdatedAt
                FROM goal_rotary_org_values
                WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_district_id = @D AND fk_club_id = 0 AND isdeleted = 0", new { Y = yearId, D = districtId });
        var list = rows.ToList();
        // A DG "Sync from Rotary.org" refreshes the district AND all its clubs in one run (user 2026-11-06), so every
        // card shows that sync's date - even targets kept unchanged (Target is fill-only).
        try
        {
            var lastSync = await conn.ExecuteScalarAsync<DateTime?>(@"
                SELECT MAX(r.FinishedAt) FROM rotary_org_sync_requests r
                WHERE r.fk_year_id = @Y AND r.Status = 'DONE'
                  AND r.fk_district_id = COALESCE(NULLIF(@D, 0), (SELECT c.fk_district_id FROM club_master c WHERE c.pk_club_id = @C))",
                new { Y = yearId, D = districtId ?? 0, C = clubId ?? 0 });
            if (lastSync != null) foreach (var r in list) if (r.UpdatedAt < lastSync.Value) r.UpdatedAt = lastSync.Value;
        }
        catch (MySqlException) { /* sync table not created yet = no syncs */ }
        return Ok(new { isCurrentYear = isCurrent, updatedAt = list.Count > 0 ? list.Max(r => r.UpdatedAt) : (DateTime?)null, values = list });
    }

    // Lock / Unlock every club of a district at once (user 2026-10-30, new View Club Goals page):
    // one category or all (categoryId 0); clubId > 0 = just that club (its card). Same rule as the
    // per-club lock - Super Admin or the District Admin of that district - and the same lock table,
    // written in one batch. Pairs already in that state are skipped; clubs with no goals set are locked too.
    [HttpPost("clubs-lock")]
    public async Task<ActionResult> LockAllClubs([FromBody] LockAllClubsRequest req)
    {
        if (req.DistrictId <= 0) return BadRequest(new { message = "districtId is required." });
        var memberId = GetMemberId();
        var yearId = req.YearId ?? 0;
        if (yearId <= 0)
        {
            await using var conn = RowDb.Connect(_connectionString);
            yearId = await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1") ?? 0;
        }
        if (yearId <= 0) return BadRequest(new { message = "No current rotary year." });

        List<int> categoryIds;
        if (req.CategoryId > 0) categoryIds = new List<int> { req.CategoryId };
        else
        {
            await using var conn = RowDb.Connect(_connectionString);
            categoryIds = (await conn.QueryAsync<int>("SELECT pk_category_id FROM goal_categories WHERE isdeleted = 0 ORDER BY SortOrder")).ToList();
        }

        try
        {
            var (changed, skipped) = await _goals.SetDistrictClubsLockAsync(memberId, req.DistrictId, yearId, categoryIds, req.ClubId, req.Locked);
            return Ok(new { changed, skipped, failed = Array.Empty<object>() });
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Goal Setting report in the new design (user 2026-10-30): the old report's workbook (YTD · Quarter ·
    // Month wise, same tables) with the new section names and order. districtIds = one district, or a
    // zone's districts (comma separated); oversight = the RI Director / Zone / District Assistant check.
    [HttpGet("report/districts")]
    public async Task<ActionResult> DistrictReport([FromQuery] string districtIds, [FromQuery] int? yearId, [FromQuery] bool oversight = false, [FromQuery] bool rccOnly = false)
    {
        var ids = (districtIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => int.TryParse(x, out var n) ? n : 0).Where(n => n > 0).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "districtIds is required." });
        try
        {
            var bytes = await _goals.BuildRotaryDistrictReportAsync(GetMemberId(), ids, yearId, oversight, rccOnly);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"District_Goal_Setting_{DateTime.UtcNow:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
    }

    // Every club of a district, clubs across (user 2026-11-02).
    [HttpGet("report/clubs-all")]
    public async Task<ActionResult> AllClubsReport([FromQuery] int districtId, [FromQuery] int? yearId, [FromQuery] bool oversight = false, [FromQuery] bool rccOnly = false)
    {
        try
        {
            var bytes = await _goals.BuildRotaryAllClubsReportAsync(GetMemberId(), districtId, yearId, oversight, rccOnly);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"{(rccOnly ? "RCC_Goals_All_Clubs" : "Club_Goal_Setting_All")}_{DateTime.UtcNow:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
    }

    [HttpGet("report/clubs/{clubId:int}")]
    public async Task<ActionResult> ClubReport([FromRoute] int clubId, [FromQuery] int? yearId, [FromQuery] bool rccOnly = false)
    {
        try
        {
            var bytes = await _goals.BuildRotaryClubReportAsync(GetMemberId(), clubId, yearId, rccOnly);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"Club_Goal_Setting_{DateTime.UtcNow:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
    }

    private const string XlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public sealed class LockAllClubsRequest
    {
        public int DistrictId { get; set; }
        public int? YearId { get; set; }
        public int CategoryId { get; set; }   // 0 = all categories
        public int ClubId { get; set; }       // 0 = every club of the district
        public bool Locked { get; set; }
    }

    // Dates for the "where this figure comes from" message on each goal (user 2026-10-29/30):
    //   rotaryOrgSync = the last completed daily Rotary.org member sync (IST);
    //   imports       = per scope (Membership, Youth, District / Club = Foundation), the last day of the
    //                   latest month imported this rotary year (the month the data covers);
    //   lastSaved     = per category, when this district's / club's typed targets were last saved.
    // RAG Analysis popup (RIZones goal module, restored 2026-11-20): the district's clubs with their Rotary.org member
    // count ("Members now / 30 June"), the figures the RAG bands on the card are counted from.
    [HttpGet("rag-clubs")]
    public async Task<ActionResult> RagClubs([FromQuery] int yearId, [FromQuery] int districtId)
    {
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var m = GetMemberId();
        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)
            && !(districtId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, m, false, districtId)))
            return Forbid();
        if (yearId <= 0 || districtId <= 0) return BadRequest(new { message = "yearId and districtId are required." });
        var rows = await conn.QueryAsync(@"
            SELECT v.fk_club_id AS clubId, c.ClubName AS clubName, CAST(v.NumericValue AS SIGNED) AS members
            FROM goal_rotary_org_values v
            JOIN club_master c ON c.pk_club_id = v.fk_club_id
            WHERE v.fk_year_id = @Y AND v.EntityType = 'Club' AND v.fk_district_id = @D
              AND v.ItemName = 'Members now / 30 June' AND v.Kind = 'Value' AND v.isdeleted = 0
            ORDER BY c.ClubName", new { Y = yearId, D = districtId });
        return Ok(rows);
    }

    [HttpGet("source-dates")]
    public async Task<ActionResult> SourceDates([FromQuery] int yearId, [FromQuery] int? districtId, [FromQuery] int? clubId)
    {
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        // Read by the new CMR goal panels (RIZones 2026-11-13): SuperAdmin, the club's managers (club scope) or whoever
        // manages the district (district scope). Was SuperAdmin only.
        var m = GetMemberId();
        var allowed = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)
            || ((clubId ?? 0) > 0 && await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, m, true, clubId!.Value, members: false))
            || ((districtId ?? 0) > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, m, false, districtId!.Value));
        if (!allowed) return Forbid();
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        var sync = await conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT MAX(DATE_ADD(FinishedAtUtc, INTERVAL 330 MINUTE)) FROM rotary_org_sync_log
            WHERE SyncType = 'ClubMemberSweep' AND Status = 'Completed' AND isdeleted = 0");
        // Per field (user 2026-11-03): members / women = this club's last GOOD member sync; a district =
        // its OLDEST club (a club that failed keeps its old date). Clubs / Rotaract / Interact counts =
        // the last completed club-list sync. Until the worker writes per-club dates, the run date is used.
        var memberSync = sync;
        try
        {
            if ((clubId ?? 0) > 0)
                memberSync = await conn.ExecuteScalarAsync<DateTime?>(@"
                    SELECT DATE_ADD(LastOkUtc, INTERVAL 330 MINUTE) FROM rotary_org_club_member_sync_status
                    WHERE fk_club_id = @C", new { C = clubId });
            else if ((districtId ?? 0) > 0)
                memberSync = await conn.ExecuteScalarAsync<DateTime?>(@"
                    SELECT MIN(DATE_ADD(s.LastOkUtc, INTERVAL 330 MINUTE))
                    FROM club_master c JOIN rotary_org_club_member_sync_status s ON s.fk_club_id = c.pk_club_id
                    WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1",
                    new { D = districtId });
        }
        catch (MySqlException) { /* table not created yet by the sync worker - keep the run date */ }
        var clubSync = await conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT MAX(DATE_ADD(FinishedAtUtc, INTERVAL 330 MINUTE)) FROM rotary_org_sync_log
            WHERE SyncType = 'CountrySync' AND Status = 'Completed' AND isdeleted = 0");
        // A monthly import is dated by the MONTH it covers (user 2026-10-30): Jul + Aug + Sep imported
        // = "30 Sep 2026" - the last day of the latest imported month of the rotary year.
        var startYear = await conn.ExecuteScalarAsync<int?>(
            "SELECT YEAR(StartDate) FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId }) ?? 0;
        var imports = new Dictionary<string, DateTime>();
        if (startYear > 0)
            foreach (var (scope, months) in await conn.QueryAsync<(string Scope, string Months)>(@"
                SELECT Scope, GROUP_CONCAT(PeriodMonth) FROM goal_foundation_import_months
                WHERE fk_year_id = @Y AND isdeleted = 0 GROUP BY Scope", new { Y = yearId }))
            {
                // Rotary year order: Jul (7) .. Dec (12), then Jan (1) .. Jun (6).
                var last = months.Split(',').Select(m => int.TryParse(m, out var n) ? n : 0).Where(n => n is >= 1 and <= 12)
                    .OrderBy(n => n >= 7 ? n - 7 : n + 5).LastOrDefault();
                if (last == 0) continue;
                var y = last >= 7 ? startYear : startYear + 1;
                imports[scope] = new DateTime(y, last, DateTime.DaysInMonth(y, last));
            }
        var isClub = (clubId ?? 0) > 0;
        var saved = (await conn.QueryAsync<(int CategoryId, DateTime At)>(@"
            SELECT f.fk_category_id, MAX(COALESCE(e.modified_date, e.created_date))
            FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.isdeleted = 0 AND f.FieldRole = 'Target'
              AND e.EntityType = @T AND (CASE WHEN @T = 'Club' THEN e.fk_club_id = @C ELSE e.fk_district_id = @D END)
            GROUP BY f.fk_category_id",
            new { Y = yearId, T = isClub ? "Club" : "District", C = clubId ?? 0, D = districtId ?? 0 }))
            .ToDictionary(x => x.CategoryId, x => x.At);
        // The same, per typed box (field id), so each card shows its own target's saved date.
        var savedByField = (await conn.QueryAsync<(int FieldId, DateTime At)>(@"
            SELECT e.fk_field_id, MAX(COALESCE(e.modified_date, e.created_date))
            FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.isdeleted = 0 AND f.FieldRole = 'Target'
              AND e.EntityType = @T AND (CASE WHEN @T = 'Club' THEN e.fk_club_id = @C ELSE e.fk_district_id = @D END)
            GROUP BY e.fk_field_id",
            new { Y = yearId, T = isClub ? "Club" : "District", C = clubId ?? 0, D = districtId ?? 0 }))
            .ToDictionary(x => x.FieldId, x => x.At);
        // DG "Sync from Rotary.org" (user 2026-11-06): once this district (a club = its district) has a
        // finished DG sync this year, every "Updated from Rotary.org" card shows that sync's date.
        DateTime? dgSync = null;
        try
        {
            dgSync = await conn.ExecuteScalarAsync<DateTime?>(@"
                SELECT MAX(r.FinishedAt) FROM rotary_org_sync_requests r
                WHERE r.fk_year_id = @Y AND r.Status = 'DONE'
                  AND r.fk_district_id = COALESCE(NULLIF(@D, 0), (SELECT c.fk_district_id FROM club_master c WHERE c.pk_club_id = @C))",
                new { Y = yearId, D = districtId ?? 0, C = clubId ?? 0 });
        }
        catch (MySqlException) { /* sync table not created yet = no syncs */ }
        return Ok(new { rotaryOrgSync = sync, memberSync, clubSync, dgSync, imports, lastSaved = saved, savedByField });
    }

    // Year dropdown of the new Goal Overview (user 2026-10-30): only years that have goal data - typed
    // goals or Rotary.org figures - plus the current year. Newest first.
    [HttpGet("years")]
    public async Task<ActionResult> Years()
    {
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT y.pk_year_id AS id, y.YearLabel AS yearLabel, (y.IsCurrent = 1) AS isCurrent
            FROM rotary_year_master y
            WHERE y.isdeleted = 0 AND (y.IsCurrent = 1
               OR y.pk_year_id IN (SELECT fk_year_id FROM goal_entries WHERE isdeleted = 0)
               OR y.pk_year_id IN (SELECT fk_year_id FROM goal_rotary_org_values WHERE isdeleted = 0))
            ORDER BY y.StartDate DESC, y.pk_year_id DESC");
        return Ok(rows);
    }

    public sealed class RotaryOrgValueDto
    {
        public string ItemName { get; set; } = "";
        public string Kind { get; set; } = "";
        public decimal? Value { get; set; }
        public string Source { get; set; } = "";
        public DateTime UpdatedAt { get; set; }
    }
}
