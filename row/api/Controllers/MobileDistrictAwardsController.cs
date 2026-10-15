using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Dapper;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// ════════════════════════════════════════════════════════════════════════
// Mobile READ-ONLY view of the District Awards module (formerly District
// Citation). Mirrors the web admin GETs in DistrictModulesController so the
// Flutter app can render the same 5 tabs (Categories / Description /
// Auto Questions / Manual Questions / Club Points) without admin write
// access. All writes (POST/PUT/DELETE) stay web-only — admins manage the
// rubric from a desktop.
//
// Same SQL projections as the web side so JSON shapes match: points / bonus /
// option points come back as integers (CAST(ROUND(...) AS SIGNED)) per the
// no-decimal rule applied earlier in this cycle.
// ════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileDistrictAwardsController : ControllerBase
{
    private readonly string _connectionString;
    public MobileDistrictAwardsController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection Conn() => new(_connectionString);

    // ── Categories ──────────────────────────────────────────────────────
    [HttpGet("districts/{districtId}/awards/categories")]
    public async Task<ActionResult> GetCategories(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        using var conn = Conn();
        await conn.OpenAsync();
        var sql = @"SELECT c.pk_id AS id, c.fk_district_id AS districtId, c.fk_year_id AS yearId,
                           c.category_name AS categoryName, c.sort_order AS sortOrder, c.is_active AS isActive,
                           y.YearLabel AS yearLabel
                    FROM district_citation_category c
                    LEFT JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                    WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0";
        if (yearId.HasValue) sql += " AND c.fk_year_id = @YearId";
        sql += " ORDER BY c.sort_order, c.category_name";
        return Ok(await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId }));
    }

    // ── Description ─────────────────────────────────────────────────────
    [HttpGet("districts/{districtId}/awards/description")]
    public async Task<ActionResult> GetDescription(int districtId, [FromQuery] int yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        using var conn = Conn();
        await conn.OpenAsync();
        var result = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id, description_html AS descriptionHtml FROM district_citation_description
            WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId });
        return Ok(result ?? new { id = 0, descriptionHtml = "" });
    }

    // ── Auto Questions (with sub-items) ─────────────────────────────────
    [HttpGet("districts/{districtId}/awards/auto-questions")]
    public async Task<ActionResult> GetAutoQuestions(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        using var conn = Conn();
        await conn.OpenAsync();

        var sql = @"SELECT q.pk_id AS id, q.fk_category_id AS categoryId, cc.category_name AS categoryName,
                           q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                           CAST(ROUND(q.points) AS SIGNED) AS points, q.is_bonus AS isBonus,
                           CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
                           q.min_bonus AS minBonus, q.max_bonus AS maxBonus,
                           q.sort_order AS sortOrder, q.fk_year_id AS yearId
                    FROM district_citation_auto_question q
                    INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
                    INNER JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
                    WHERE q.fk_district_id=@DistrictId AND q.isdeleted=0";
        if (yearId.HasValue) sql += " AND q.fk_year_id=@YearId";
        sql += " ORDER BY cc.sort_order, q.sort_order";
        var questions = (await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId })).ToList();

        var qIds = questions.Select(q => (int)q.id).ToList();
        if (qIds.Count > 0)
        {
            var subs = (await conn.QueryAsync<dynamic>(@"
                SELECT s.pk_id AS id, s.fk_auto_question_id AS autoQuestionId, s.sub_item_type AS subItemType,
                       s.sub_item_id AS subItemId, s.sub_item_name AS subItemName,
                       s.filter_aof_id AS filterAofId, s.filter_cat_id AS filterCatId,
                       CAST(ROUND(s.points) AS SIGNED) AS points, s.is_bonus AS isBonus,
                       CAST(ROUND(s.bonus_points) AS SIGNED) AS bonusPoints,
                       s.min_bonus AS minBonus, s.max_bonus AS maxBonus,
                       COALESCE(aof_only.name, aof_for_cat.name, aof_for_sub.name, aof_by_filter.name) AS areaOfFocusName,
                       COALESCE(cat_only.name, cat_for_sub.name, cat_by_filter.name) AS categoryName,
                       sub_only.name AS subCategoryName
                FROM district_citation_auto_question_sub s
                LEFT JOIN area_of_focus_master aof_only      ON LOWER(s.sub_item_type) = 'area_of_focus' AND aof_only.pk_area_of_focus_id = s.sub_item_id
                LEFT JOIN category_master cat_only           ON LOWER(s.sub_item_type) = 'category'      AND cat_only.pk_category_id      = s.sub_item_id
                LEFT JOIN area_of_focus_master aof_for_cat   ON LOWER(s.sub_item_type) = 'category'      AND aof_for_cat.pk_area_of_focus_id = cat_only.fk_area_of_focus_id
                LEFT JOIN sub_category_master sub_only       ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND sub_only.pk_sub_category_id = s.sub_item_id
                LEFT JOIN category_master cat_for_sub        ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND cat_for_sub.pk_category_id = sub_only.fk_category_id
                LEFT JOIN area_of_focus_master aof_for_sub   ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND aof_for_sub.pk_area_of_focus_id = cat_for_sub.fk_area_of_focus_id
                LEFT JOIN area_of_focus_master aof_by_filter ON s.filter_aof_id IS NOT NULL AND aof_by_filter.pk_area_of_focus_id = s.filter_aof_id
                LEFT JOIN category_master cat_by_filter      ON s.filter_cat_id IS NOT NULL AND cat_by_filter.pk_category_id      = s.filter_cat_id
                WHERE s.fk_auto_question_id IN @Ids AND s.isdeleted = 0
                ORDER BY s.sort_order",
                new { Ids = qIds })).ToList();

            foreach (var q in questions)
                q.subItems = subs.Where(s => (int)s.autoQuestionId == (int)q.id).ToList();
        }
        else
        {
            foreach (var q in questions) q.subItems = new List<dynamic>();
        }
        return Ok(questions);
    }

    // ── Manual Questions (with sub-criteria + options) ──────────────────
    [HttpGet("districts/{districtId}/awards/manual-questions")]
    public async Task<ActionResult> GetManualQuestions(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        using var conn = Conn();
        await conn.OpenAsync();

        var sql = @"SELECT mc.pk_id AS id, mc.fk_category_id AS categoryId, cc.category_name AS categoryName,
                           mc.criteria_name AS criteriaName, mc.sort_order AS sortOrder, mc.fk_year_id AS yearId
                    FROM district_citation_manual_criteria mc
                    INNER JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
                    WHERE mc.fk_district_id=@DistrictId AND mc.isdeleted=0";
        if (yearId.HasValue) sql += " AND mc.fk_year_id=@YearId";
        sql += " ORDER BY cc.sort_order, mc.sort_order";
        var criteria = (await conn.QueryAsync<dynamic>(sql, new { DistrictId = districtId, YearId = yearId })).ToList();

        var mcIds = criteria.Select(c => (int)c.id).ToList();
        if (mcIds.Count > 0)
        {
            var subs = (await conn.QueryAsync<dynamic>(@"
                SELECT sc.pk_id AS id, sc.fk_criteria_id AS criteriaId, sc.sub_criteria_title AS subCriteriaTitle,
                       sc.answer_type AS answerType,
                       CAST(ROUND(sc.points) AS SIGNED) AS points,
                       sc.is_bonus AS isBonus,
                       CAST(ROUND(sc.bonus_points) AS SIGNED) AS bonusPoints,
                       sc.min_bonus AS minBonus, sc.max_bonus AS maxBonus, sc.remark, sc.sort_order AS sortOrder
                FROM district_citation_manual_sub_criteria sc WHERE sc.fk_criteria_id IN @Ids AND sc.isdeleted=0 ORDER BY sc.sort_order",
                new { Ids = mcIds })).ToList();

            var subIds = subs.Select(s => (int)s.id).ToList();
            var options = subIds.Count > 0
                ? (await conn.QueryAsync<dynamic>(@"
                    SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText,
                           CAST(ROUND(option_points) AS SIGNED) AS optionPoints,
                           sort_order AS sortOrder
                    FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted=0 ORDER BY sort_order",
                    new { Ids = subIds })).ToList()
                : new List<dynamic>();

            foreach (var s in subs)
                s.options = options.Where(o => (int)o.subCriteriaId == (int)s.id).ToList();
            foreach (var c in criteria)
                c.subCriteria = subs.Where(s => (int)s.criteriaId == (int)c.id).ToList();
        }
        else
        {
            foreach (var c in criteria) c.subCriteria = new List<dynamic>();
        }
        return Ok(criteria);
    }

    // ── Club Points (leaderboard) ───────────────────────────────────────
    [HttpGet("districts/{districtId}/awards/club-points")]
    public async Task<ActionResult> GetClubPoints(int districtId, [FromQuery] int yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        using var conn = Conn();
        await conn.OpenAsync();

        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_id AS clubId, ClubName AS clubName, ClubCode AS clubRotaryId
            FROM club_master
            WHERE fk_district_id=@DistrictId AND isdeleted=0
            ORDER BY ClubName",
            new { DistrictId = districtId })).ToList();

        // Same UNION-of-auto-and-manual aggregation as the web endpoint.
        var entries = (await conn.QueryAsync<dynamic>(@"
            SELECT clubId, SUM(score) AS totalPoints FROM (
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_auto_question q
                    ON q.pk_id = e.fk_question_id
                   AND q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0
                WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId
                  AND e.entry_type='auto' AND e.isdeleted=0
                UNION ALL
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_manual_sub_criteria sc
                    ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                INNER JOIN district_citation_manual_criteria mc
                    ON mc.pk_id = sc.fk_criteria_id
                   AND mc.fk_district_id = @DistrictId AND mc.fk_year_id = @YearId AND mc.isdeleted = 0
                WHERE e.fk_district_id=@DistrictId AND e.fk_year_id=@YearId
                  AND e.entry_type='manual' AND e.isdeleted=0
            ) t
            GROUP BY clubId",
            new { DistrictId = districtId, YearId = yearId }))
            .ToDictionary(e => (int)e.clubId, e => (decimal)e.totalPoints);

        var result = clubs.Select(c => new {
            clubId = (int)c.clubId,
            clubName = (string)c.clubName,
            clubRotaryId = (string?)c.clubRotaryId,
            totalPoints = (int)Math.Round(entries.ContainsKey((int)c.clubId) ? entries[(int)c.clubId] : 0m)
        }).OrderByDescending(c => c.totalPoints).ToList();

        return Ok(result);
    }
}
