using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Disha Goals = District Awards moved one level up (user 2026-11-17; old District Awards goes after go-live).
// The RI Director (or Super Admin) sets categories / auto / manual questions WITH points for all their districts -
// same screens, same rules as District Awards (DistrictModulesController citation endpoints) - plus:
//   * the 4 RCC categories are created by default and cannot be edited / deleted; extra categories can be added
//   * a Goal per DISTRICT on every question line (disha_goal)
//   * RISAO figures in the Auto list (activity master "RISAO - ..."): the district's RISAO figure
// Each district answers like a club does in District Awards (disha_district_entry): auto = counted over the
// district's clubs (District Awards counting), manual = typed by the District Admin; points the same formula.
// Owner = the member who set the questions (fk_owner_id); a district sees the questions of every owner whose
// scope covers it. Owner 0 = "Rotary India default" (user 2026-11-18): the 4 RCC categories and the pre-created
// extra goal questions for ALL districts - every RI Director sees them and sets each district's goal; only Super
// Admin edits / deletes them (one change hits every district). Only Rotary.org districts (synced clubs), never Zone 0 / Other Zones.
[ApiController]
[Authorize]
public class DishaAwardsController : ControllerBase, IAsyncActionFilter
{
    private readonly string _cs;
    private readonly AdminYearGuard _guard;
    private readonly IGoalSettingService _goals;
    public DishaAwardsController(IConfiguration config, AdminYearGuard guard, IGoalSettingService goals)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _guard = guard;
        _goals = goals;
    }

    // Who may use Disha Goals (user 2026-11-18, like Goal Setting):
    //   Super Admin - everything, every district.
    //   Goal roles (RI Director, Zonal Coordinator, District Assistant: RMC, RRFC, ... and their assistants) - only
    //     the districts of their Goal Setting assignments; view only, except the RI Director (questions, goals, refresh).
    //   District Admin (DG) - their own district: view and answer (the DG pages).
    private HashSet<int>? _scope;           // null = every district (Super Admin)
    private bool _canManage;                 // add / edit / delete questions, set goals, refresh all
    [NonAction]
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // Disha Goals are OFF in ROW (FeatureGate "disha_goals"): the gate answers 404 before this runs while it is off.
        if (IsSuperAdmin) { _canManage = true; await next(); return; }
        // ROW has no Goal Setting Roles (no RI Director / Zone Co-ordinator / District Assistant): besides Super Admin
        // only the District Admin (DG) of the district in the route, for that district only, read and answer.
        int? districtId = context.ActionArguments.TryGetValue("districtId", out var dv) && dv is int di ? di : null;
        bool districtAdmin = districtId.HasValue && await _guard.DistrictYearlessAsync(User, districtId.Value) == null;
        if (!districtAdmin)
        { context.Result = StatusCode(403, new { message = "You have no access to Disha Goals for this district." }); return; }
        _scope = new HashSet<int> { districtId!.Value };
        var method = context.HttpContext.Request.Method;
        // The full report is a POST only to carry the page's figures - it reads, never writes (user 2026-11-19).
        bool write = !HttpMethods.IsGet(method) && !(context.HttpContext.Request.Path.Value ?? "").EndsWith("/report-full", StringComparison.OrdinalIgnoreCase)
            && !(context.HttpContext.Request.Path.Value ?? "").EndsWith("/clubs-report", StringComparison.OrdinalIgnoreCase);
        bool districtWrite = districtId.HasValue;           // answers / one district's refresh - checked inside
        if (write && !districtWrite && !_canManage)
        { context.Result = StatusCode(403, new { message = "Only Super Admin can change Disha questions and goals." }); return; }
        await next();
    }

    private static readonly string[] RccCategories =
        { "Enhance Participant Engagement", "Increase our Impact", "Expand Our Reach", "Increase Our Ability to Adapt" };

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    // Questions on the RI Director's / Super Admin's screens: their own + the Rotary India defaults (owner 0).
    private int[] MyOwners => new[] { MemberId, 0 };
    // May the caller change a question of this owner? Own ones; the defaults (owner 0) only Super Admin.
    private string CanEditSql => "(fk_owner_id = @O OR (fk_owner_id = 0 AND @SA = 1))";
    private bool IsSuperAdmin => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private async Task<MySqlConnection> OpenAsync() { var c = new MySqlConnection(_cs); await c.OpenAsync(); return c; }
    private static async Task<int> YearAsync(MySqlConnection conn, int? yearId) =>
        yearId > 0 ? yearId.Value : await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1") ?? 0;

    // ── Scope ──────────────────────────────────────────────────────────────────
    public sealed record ScopeDistrict(int id, string districtNumber, int zoneId, string zoneName);

    // Districts a member sets Disha questions for: Super Admin / RI Director (role 7) = all, RI Director goal seat = its zones.
    private async Task<List<ScopeDistrict>> MyScopeAsync(MySqlConnection conn) =>
        _scope == null ? await ScopeOfAsync(conn, 0) : (await ScopeOfAsync(conn, 0)).Where(d => _scope.Contains(d.id)).ToList();

    private static async Task<List<ScopeDistrict>> ScopeOfAsync(MySqlConnection conn, int memberId)
    {
        var all = memberId == 0 || await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id IN (3, 7) AND IsActive = 1 AND isdeleted = 0",
            new { M = memberId }) > 0;
        var sql = $@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, z.pk_zone_id AS zoneId, z.ZoneName AS zoneName
            FROM district_master d JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("d")}
              AND z.ZoneName NOT IN ('Zone 0', 'Other Zones')
              AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.IsSyncedFromRotaryOrg = 1 AND {HierarchyScopeSql.ClubLive("c")})"
            + (all ? "" : @" AND d.fk_zone_id IN (
                SELECT z2.fk_zone_id FROM goal_role_assignments a JOIN goal_role_assignment_zones z2 ON z2.fk_assignment_id = a.pk_id
                WHERE a.fk_member_id = @M AND a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0)")
            + " ORDER BY z.ZoneName, d.DistrictNumber";
        return (await conn.QueryAsync<ScopeDistrict>(sql, new { M = memberId })).ToList();
    }

    // Owners whose questions a district sees (their scope covers it).
    private static async Task<List<int>> OwnersOfDistrictAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var owners = (await conn.QueryAsync<int>(@"
            SELECT fk_owner_id FROM disha_category WHERE fk_year_id = @Y AND isdeleted = 0
            UNION SELECT fk_owner_id FROM disha_auto_question WHERE fk_year_id = @Y AND isdeleted = 0
            UNION SELECT fk_owner_id FROM disha_manual_criteria WHERE fk_year_id = @Y AND isdeleted = 0", new { Y = yearId })).ToList();
        var res = new List<int>();
        foreach (var o in owners)
            if ((await ScopeOfAsync(conn, o)).Any(d => d.id == districtId)) res.Add(o);
        return res;
    }

    // ── Categories (4 RCC defaults, not editable / deletable) ─────────────────
    private async Task EnsureDefaultsAsync(MySqlConnection conn, int yearId)
    {
        // The 4 RCC categories are shared defaults (owner 0) for every district and RI Director.
        for (int i = 0; i < RccCategories.Length; i++)
            await conn.ExecuteAsync(@"
                INSERT INTO disha_category (fk_owner_id, fk_year_id, category_name, sort_order, is_default, created_by)
                SELECT 0, @Y, @N, @S, 1, @M FROM DUAL
                WHERE NOT EXISTS (SELECT 1 FROM disha_category WHERE fk_owner_id = 0 AND fk_year_id = @Y AND category_name = @N AND isdeleted = 0)",
                new { M = MemberId, Y = yearId, N = RccCategories[i], S = i + 1 });
    }

    [HttpGet("api/disha-awards/categories")]
    public async Task<ActionResult> GetCategories([FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        await EnsureDefaultsAsync(conn, y);
        return Ok(await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, fk_year_id AS yearId, category_name AS categoryName, sort_order AS sortOrder, is_default AS isDefault
            FROM disha_category WHERE fk_owner_id IN @O AND fk_year_id = @Y AND isdeleted = 0 ORDER BY is_default DESC, sort_order, category_name",
            new { O = MyOwners, Y = y }));
    }

    public class CategoryDto { public int YearId { get; set; } public string CategoryName { get; set; } = ""; public int SortOrder { get; set; } }

    [HttpPost("api/disha-awards/categories")]
    public async Task<ActionResult> CreateCategory([FromBody] CategoryDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.CategoryName)) return BadRequest(new { message = "Category name is required." });
        await using var conn = await OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO disha_category (fk_owner_id, fk_year_id, category_name, sort_order, created_by) VALUES (@O, @Y, @N, @S, @O); SELECT LAST_INSERT_ID();",
            new { O = MemberId, Y = dto.YearId, N = dto.CategoryName.Trim(), S = dto.SortOrder });
        return Ok(new { id, message = "Category created." });
    }

    [HttpPut("api/disha-awards/categories/{id:int}")]
    public async Task<ActionResult> UpdateCategory(int id, [FromBody] CategoryDto dto)
    {
        await using var conn = await OpenAsync();
        var n = await conn.ExecuteAsync(@"UPDATE disha_category SET category_name = @N, sort_order = @S, modified_by = @O, modified_date = NOW()
            WHERE pk_id = @Id AND fk_owner_id = @O AND is_default = 0 AND isdeleted = 0", new { Id = id, O = MemberId, N = dto.CategoryName.Trim(), S = dto.SortOrder });
        return n == 0 ? BadRequest(new { message = "The 4 RCC categories cannot be changed." }) : Ok(new { message = "Category updated." });
    }

    [HttpDelete("api/disha-awards/categories/{id:int}")]
    public async Task<ActionResult> DeleteCategory(int id)
    {
        await using var conn = await OpenAsync();
        var used = await conn.ExecuteScalarAsync<int>(@"SELECT (SELECT COUNT(*) FROM disha_auto_question WHERE fk_category_id = @Id AND isdeleted = 0)
            + (SELECT COUNT(*) FROM disha_manual_criteria WHERE fk_category_id = @Id AND isdeleted = 0)", new { Id = id });
        if (used > 0) return BadRequest(new { message = "Cannot delete category with existing questions." });
        var n = await conn.ExecuteAsync("UPDATE disha_category SET isdeleted = 1, modified_by = @O, modified_date = NOW() WHERE pk_id = @Id AND fk_owner_id = @O AND is_default = 0",
            new { Id = id, O = MemberId });
        return n == 0 ? BadRequest(new { message = "The 4 RCC categories cannot be deleted." }) : Ok(new { message = "Category deleted." });
    }

    // ── Auto questions (same shape as District Awards) ─────────────────────────
    private static async Task<List<dynamic>> LoadAutoAsync(MySqlConnection conn, IEnumerable<int> owners, int yearId)
    {
        var qs = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS id, q.fk_owner_id AS ownerId, q.fk_category_id AS categoryId, cc.category_name AS categoryName, cc.sort_order AS catSort,
                   q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                   CAST(ROUND(q.points) AS SIGNED) AS points, q.is_bonus AS isBonus, CAST(ROUND(q.bonus_points) AS SIGNED) AS bonusPoints,
                   q.min_bonus AS minBonus, q.max_bonus AS maxBonus, COALESCE(q.per_unit, 1) AS perUnit, q.sort_order AS sortOrder, q.fk_year_id AS yearId
            FROM disha_auto_question q
            JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            JOIN disha_category cc ON cc.pk_id = q.fk_category_id
            WHERE q.fk_owner_id IN @O AND q.fk_year_id = @Y AND q.isdeleted = 0
            ORDER BY cc.is_default DESC, cc.sort_order, q.sort_order", new { O = owners, Y = yearId })).ToList();
        var ids = qs.Select(q => (int)q.id).ToList();
        var subs = ids.Count == 0 ? new List<dynamic>() : (await conn.QueryAsync<dynamic>(@"
            SELECT s.pk_id AS id, s.fk_auto_question_id AS autoQuestionId, s.sub_item_type AS subItemType, s.sub_item_id AS subItemId,
                   s.sub_item_name AS subItemName, s.filter_aof_id AS filterAofId, s.filter_cat_id AS filterCatId,
                   CAST(ROUND(s.points) AS SIGNED) AS points, s.is_bonus AS isBonus, CAST(ROUND(s.bonus_points) AS SIGNED) AS bonusPoints,
                   s.min_bonus AS minBonus, s.max_bonus AS maxBonus,
                   aof.name AS areaOfFocusName, cat.name AS categoryName, sub.name AS subCategoryName
            FROM disha_auto_question_sub s
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = COALESCE(s.filter_aof_id, CASE WHEN LOWER(s.sub_item_type) = 'area_of_focus' THEN s.sub_item_id END)
            LEFT JOIN category_master cat ON cat.pk_category_id = COALESCE(s.filter_cat_id, CASE WHEN LOWER(s.sub_item_type) = 'category' THEN s.sub_item_id END)
            LEFT JOIN sub_category_master sub ON LOWER(s.sub_item_type) IN ('sub_category','subcategory') AND sub.pk_sub_category_id = s.sub_item_id
            WHERE s.fk_auto_question_id IN @Ids AND s.isdeleted = 0 ORDER BY s.sort_order", new { Ids = ids })).ToList();
        foreach (var q in qs) q.subItems = subs.Where(s => (int)s.autoQuestionId == (int)q.id).ToList();
        return qs;
    }

    [HttpGet("api/disha-awards/auto-questions")]
    public async Task<ActionResult> GetAuto([FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        return Ok(await LoadAutoAsync(conn, MyOwners, await YearAsync(conn, yearId)));
    }

    [HttpPost("api/disha-awards/auto-questions")]
    public async Task<ActionResult> CreateAuto([FromBody] DishaAutoQuestionDto dto)
    {
        if (RisaoFigures.InRccActivityIds.Contains(dto.ActivityId)) return BadRequest(new { message = "This goal is already one of the RCC goals - it cannot be an Auto question." });
        await using var conn = await OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO disha_auto_question (fk_owner_id, fk_year_id, fk_category_id, fk_activity_id, points, is_bonus, bonus_points, min_bonus, max_bonus, sort_order, per_unit, created_by)
            VALUES (@O, @YearId, @CategoryId, @ActivityId, @Points, @IsBonus, @BonusPoints, @MinBonus, @MaxBonus, @SortOrder, @PerUnit, @O); SELECT LAST_INSERT_ID();",
            new { O = MemberId, dto.YearId, dto.CategoryId, dto.ActivityId, dto.Points, IsBonus = dto.IsBonus ? 1 : 0, dto.BonusPoints, dto.MinBonus, dto.MaxBonus, dto.SortOrder, PerUnit = Math.Max(1, dto.PerUnit) });
        await SaveAutoSubsAsync(conn, id, dto.SubItems);
        return Ok(new { id, message = "Auto question created." });
    }

    [HttpPut("api/disha-awards/auto-questions/{id:int}")]
    public async Task<ActionResult> UpdateAuto(int id, [FromBody] DishaAutoQuestionDto dto)
    {
        if (RisaoFigures.InRccActivityIds.Contains(dto.ActivityId)) return BadRequest(new { message = "This goal is already one of the RCC goals - it cannot be an Auto question." });
        await using var conn = await OpenAsync();
        var n = await conn.ExecuteAsync(@"UPDATE disha_auto_question SET fk_category_id = @CategoryId, fk_activity_id = @ActivityId, points = @Points,
            is_bonus = @IsBonus, bonus_points = @BonusPoints, min_bonus = @MinBonus, max_bonus = @MaxBonus, sort_order = @SortOrder, per_unit = @PerUnit, modified_by = @O, modified_date = NOW()
            WHERE pk_id = @Id AND " + CanEditSql + " AND isdeleted = 0",
            new { Id = id, O = MemberId, SA = IsSuperAdmin ? 1 : 0, dto.CategoryId, dto.ActivityId, dto.Points, IsBonus = dto.IsBonus ? 1 : 0, dto.BonusPoints, dto.MinBonus, dto.MaxBonus, dto.SortOrder, PerUnit = Math.Max(1, dto.PerUnit) });
        if (n == 0) return NotFound(new { message = "Question not found." });
        await SaveAutoSubsAsync(conn, id, dto.SubItems);
        return Ok(new { message = "Auto question updated." });
    }

    // Sub-items keep their ids on edit (answers and goals stay linked); new ones inserted, removed ones soft-deleted.
    private async Task SaveAutoSubsAsync(MySqlConnection conn, int qId, List<DishaAutoSubItemDto> subsIn)
    {
        var old = (await conn.QueryAsync<int>("SELECT pk_id FROM disha_auto_question_sub WHERE fk_auto_question_id = @Q AND isdeleted = 0", new { Q = qId })).ToHashSet();
        var kept = new HashSet<int>();
        int sort = 0;
        foreach (var s in subsIn)
        {
            var prm = new { Q = qId, SId = s.Id, T = s.SubItemType, I = s.SubItemId, N = s.SubItemName, s.FilterAofId, s.FilterCatId, s.Points,
                            B = s.IsBonus ? 1 : 0, s.BonusPoints, s.MinBonus, s.MaxBonus, S = sort++, O = MemberId };
            if (s.Id > 0 && old.Contains(s.Id) && kept.Add(s.Id))
                await conn.ExecuteAsync(@"UPDATE disha_auto_question_sub SET sub_item_type = @T, sub_item_id = @I, sub_item_name = @N, filter_aof_id = @FilterAofId,
                    filter_cat_id = @FilterCatId, points = @Points, is_bonus = @B, bonus_points = @BonusPoints, min_bonus = @MinBonus, max_bonus = @MaxBonus,
                    sort_order = @S, modified_by = @O, modified_date = NOW() WHERE pk_id = @SId", prm);
            else
                await conn.ExecuteAsync(@"INSERT INTO disha_auto_question_sub (fk_auto_question_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, filter_cat_id,
                    points, is_bonus, bonus_points, min_bonus, max_bonus, sort_order, created_by)
                    VALUES (@Q, @T, @I, @N, @FilterAofId, @FilterCatId, @Points, @B, @BonusPoints, @MinBonus, @MaxBonus, @S, @O)", prm);
        }
        var gone = old.Where(x => !kept.Contains(x)).ToList();
        if (gone.Count > 0) await conn.ExecuteAsync("UPDATE disha_auto_question_sub SET isdeleted = 1, modified_date = NOW() WHERE pk_id IN @Ids", new { Ids = gone });
    }

    [HttpDelete("api/disha-awards/auto-questions/{id:int}")]
    public async Task<ActionResult> DeleteAuto(int id)
    {
        await using var conn = await OpenAsync();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM disha_district_entry WHERE entry_type = 'auto' AND fk_question_id = @Id AND isdeleted = 0 AND points_earned + bonus_earned > 0", new { Id = id }) > 0)
            return BadRequest(new { message = "Cannot delete: districts have earned points." });
        if (await conn.ExecuteAsync("UPDATE disha_auto_question SET isdeleted = 1, modified_by = @O, modified_date = NOW() WHERE pk_id = @Id AND " + CanEditSql,
                new { Id = id, O = MemberId, SA = IsSuperAdmin ? 1 : 0 }) == 0)
            return BadRequest(new { message = "Only Super Admin can delete a shared default question." });
        await conn.ExecuteAsync("UPDATE disha_auto_question_sub SET isdeleted = 1 WHERE fk_auto_question_id = @Id", new { Id = id });
        return Ok(new { message = "Auto question deleted." });
    }

    // ── Manual criteria (same shape as District Awards) ────────────────────────
    private static async Task<List<dynamic>> LoadManualAsync(MySqlConnection conn, IEnumerable<int> owners, int yearId)
    {
        var cs = (await conn.QueryAsync<dynamic>(@"
            SELECT mc.pk_id AS id, mc.fk_owner_id AS ownerId, mc.fk_category_id AS categoryId, cc.category_name AS categoryName, cc.sort_order AS catSort,
                   mc.criteria_name AS criteriaName, mc.sort_order AS sortOrder, mc.fk_year_id AS yearId
            FROM disha_manual_criteria mc JOIN disha_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_owner_id IN @O AND mc.fk_year_id = @Y AND mc.isdeleted = 0
            ORDER BY cc.is_default DESC, cc.sort_order, mc.sort_order", new { O = owners, Y = yearId })).ToList();
        var ids = cs.Select(c => (int)c.id).ToList();
        var subs = ids.Count == 0 ? new List<dynamic>() : (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, fk_criteria_id AS criteriaId, sub_criteria_title AS subCriteriaTitle, answer_type AS answerType,
                   CAST(ROUND(points) AS SIGNED) AS points, is_bonus AS isBonus, CAST(ROUND(bonus_points) AS SIGNED) AS bonusPoints,
                   min_bonus AS minBonus, max_bonus AS maxBonus, remark, sort_order AS sortOrder
            FROM disha_manual_sub_criteria WHERE fk_criteria_id IN @Ids AND isdeleted = 0 ORDER BY sort_order", new { Ids = ids })).ToList();
        var subIds = subs.Select(s => (int)s.id).ToList();
        var opts = subIds.Count == 0 ? new List<dynamic>() : (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, fk_sub_criteria_id AS subCriteriaId, option_text AS optionText, CAST(ROUND(option_points) AS SIGNED) AS optionPoints, sort_order AS sortOrder
            FROM disha_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted = 0 ORDER BY sort_order", new { Ids = subIds })).ToList();
        foreach (var s in subs) s.options = opts.Where(o => (int)o.subCriteriaId == (int)s.id).ToList();
        foreach (var c in cs) c.subCriteria = subs.Where(s => (int)s.criteriaId == (int)c.id).ToList();
        return cs;
    }

    [HttpGet("api/disha-awards/manual-criteria")]
    public async Task<ActionResult> GetManual([FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        return Ok(await LoadManualAsync(conn, MyOwners, await YearAsync(conn, yearId)));
    }

    [HttpPost("api/disha-awards/manual-criteria")]
    public async Task<ActionResult> CreateManual([FromBody] DistrictModulesController.CitationManualCriteriaDto dto)
    {
        await using var conn = await OpenAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO disha_manual_criteria (fk_owner_id, fk_year_id, fk_category_id, criteria_name, sort_order, created_by)
            VALUES (@O, @YearId, @CategoryId, @CriteriaName, @SortOrder, @O); SELECT LAST_INSERT_ID();",
            new { O = MemberId, dto.YearId, dto.CategoryId, dto.CriteriaName, dto.SortOrder });
        await SaveManualSubsAsync(conn, id, dto.SubCriteria);
        return Ok(new { id, message = "Manual criteria created." });
    }

    [HttpPut("api/disha-awards/manual-criteria/{id:int}")]
    public async Task<ActionResult> UpdateManual(int id, [FromBody] DistrictModulesController.CitationManualCriteriaDto dto)
    {
        await using var conn = await OpenAsync();
        var n = await conn.ExecuteAsync(@"UPDATE disha_manual_criteria SET fk_category_id = @CategoryId, criteria_name = @CriteriaName, sort_order = @SortOrder,
            modified_by = @O, modified_date = NOW() WHERE pk_id = @Id AND " + CanEditSql + " AND isdeleted = 0",
            new { Id = id, O = MemberId, SA = IsSuperAdmin ? 1 : 0, dto.CategoryId, dto.CriteriaName, dto.SortOrder });
        if (n == 0) return NotFound(new { message = "Question not found." });
        await SaveManualSubsAsync(conn, id, dto.SubCriteria);
        return Ok(new { message = "Manual criteria updated." });
    }

    // Sub-criteria and options keep their ids on edit (the districts' answers stay linked).
    private async Task SaveManualSubsAsync(MySqlConnection conn, int criteriaId, List<DistrictModulesController.CitationManualSubCriteriaDto> subsIn)
    {
        var old = (await conn.QueryAsync<int>("SELECT pk_id FROM disha_manual_sub_criteria WHERE fk_criteria_id = @C AND isdeleted = 0", new { C = criteriaId })).ToHashSet();
        var kept = new HashSet<int>();
        foreach (var s in subsIn)
        {
            var prm = new { C = criteriaId, SId = s.Id, T = s.SubCriteriaTitle, s.AnswerType, s.Points, B = s.IsBonus ? 1 : 0, s.BonusPoints, s.MinBonus, s.MaxBonus,
                            s.Remark, s.SortOrder, O = MemberId };
            int subId;
            if (s.Id > 0 && old.Contains(s.Id) && kept.Add(s.Id))
            {
                subId = s.Id;
                await conn.ExecuteAsync(@"UPDATE disha_manual_sub_criteria SET sub_criteria_title = @T, answer_type = @AnswerType, points = @Points, is_bonus = @B,
                    bonus_points = @BonusPoints, min_bonus = @MinBonus, max_bonus = @MaxBonus, remark = @Remark, sort_order = @SortOrder, modified_by = @O, modified_date = NOW()
                    WHERE pk_id = @SId", prm);
            }
            else
                subId = await conn.ExecuteScalarAsync<int>(@"INSERT INTO disha_manual_sub_criteria (fk_criteria_id, sub_criteria_title, answer_type, points, is_bonus,
                    bonus_points, min_bonus, max_bonus, remark, sort_order, created_by)
                    VALUES (@C, @T, @AnswerType, @Points, @B, @BonusPoints, @MinBonus, @MaxBonus, @Remark, @SortOrder, @O); SELECT LAST_INSERT_ID();", prm);

            var oldOpts = (await conn.QueryAsync<int>("SELECT pk_id FROM disha_manual_sub_criteria_option WHERE fk_sub_criteria_id = @S AND isdeleted = 0", new { S = subId })).ToHashSet();
            var keptOpts = new HashSet<int>();
            if (s.AnswerType == "choose_one")
                foreach (var o in s.Options)
                {
                    var op = new { S = subId, OId = o.Id, T = o.OptionText, P = o.OptionPoints, o.SortOrder, O = MemberId };
                    if (o.Id > 0 && oldOpts.Contains(o.Id) && keptOpts.Add(o.Id))
                        await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria_option SET option_text = @T, option_points = @P, sort_order = @SortOrder, modified_by = @O, modified_date = NOW() WHERE pk_id = @OId", op);
                    else
                        await conn.ExecuteAsync("INSERT INTO disha_manual_sub_criteria_option (fk_sub_criteria_id, option_text, option_points, sort_order, created_by) VALUES (@S, @T, @P, @SortOrder, @O)", op);
                }
            var goneOpts = oldOpts.Where(x => !keptOpts.Contains(x)).ToList();
            if (goneOpts.Count > 0) await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria_option SET isdeleted = 1 WHERE pk_id IN @Ids", new { Ids = goneOpts });
        }
        var gone = old.Where(x => !kept.Contains(x)).ToList();
        if (gone.Count > 0)
        {
            await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria SET isdeleted = 1 WHERE pk_id IN @Ids", new { Ids = gone });
            await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria_option SET isdeleted = 1 WHERE fk_sub_criteria_id IN @Ids", new { Ids = gone });
        }
    }

    [HttpDelete("api/disha-awards/manual-criteria/{id:int}")]
    public async Task<ActionResult> DeleteManual(int id)
    {
        await using var conn = await OpenAsync();
        var subIds = (await conn.QueryAsync<int>("SELECT pk_id FROM disha_manual_sub_criteria WHERE fk_criteria_id = @Id AND isdeleted = 0", new { Id = id })).ToList();
        if (subIds.Count > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM disha_district_entry WHERE entry_type = 'manual' AND fk_question_id IN @Ids AND isdeleted = 0", new { Ids = subIds }) > 0)
            return BadRequest(new { message = "Cannot delete: districts have answered." });
        if (await conn.ExecuteAsync("UPDATE disha_manual_criteria SET isdeleted = 1, modified_by = @O, modified_date = NOW() WHERE pk_id = @Id AND " + CanEditSql,
                new { Id = id, O = MemberId, SA = IsSuperAdmin ? 1 : 0 }) == 0)
            return BadRequest(new { message = "Only Super Admin can delete a shared default question." });
        if (subIds.Count > 0)
        {
            await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria SET isdeleted = 1 WHERE pk_id IN @Ids", new { Ids = subIds });
            await conn.ExecuteAsync("UPDATE disha_manual_sub_criteria_option SET isdeleted = 1 WHERE fk_sub_criteria_id IN @Ids", new { Ids = subIds });
        }
        return Ok(new { message = "Manual criteria deleted." });
    }

    // ── Lines (question rows a district answers), goals, answers ───────────────
    public class Line
    {
        public string LineType { get; set; } = "";   // auto | auto_sub | manual
        public int LineId { get; set; }
        public int QuestionId { get; set; }
        public int? SubQuestionId { get; set; }
        public string CategoryName { get; set; } = "";
        public string Title { get; set; } = "";
        public string Source { get; set; } = "";     // auto | manual
        public bool IsRisao { get; set; }
        public bool Linked { get; set; }           // a Goal Setting box (DishaGoalLinks) - figures from Goal Setting
        public int PerUnit { get; set; } = 1;      // Auto: points for every PerUnit (user 2026-11-18, option B)
        public string AnswerType { get; set; } = "number";
        public List<object> Options { get; set; } = new();
        public decimal Points { get; set; }
        public bool IsBonus { get; set; }
        public decimal BonusPoints { get; set; }
        public int MinBonus { get; set; }
        public int MaxBonus { get; set; }
        public string? ActivityName { get; set; }
        public string? SubItemType { get; set; }
        public int? SubItemId { get; set; }
        public string? SubItemName { get; set; }
        // per district
        public decimal? GoalValue { get; set; }
        public string? AnswerValue { get; set; }
        public decimal PointsEarned { get; set; }
        public decimal? AchievementPct { get; set; }
    }

    private static async Task<List<Line>> LoadLinesAsync(MySqlConnection conn, IEnumerable<int> owners, int yearId)
    {
        var lines = new List<Line>();
        foreach (var q in await LoadAutoAsync(conn, owners, yearId))
        {
            var subs = (List<dynamic>)q.subItems;
            string act = q.activityName;
            bool risao = RisaoFigures.IsRisaoActivity(act);
            if (subs.Count == 0 || (long)q.points > 0)   // same rule as District Awards
                lines.Add(new Line { LineType = "auto", LineId = (int)q.id, QuestionId = (int)q.id, CategoryName = q.categoryName, Title = RisaoFigures.Plain(act), Source = "auto",
                    IsRisao = risao, ActivityName = act, Points = (long)q.points, IsBonus = Convert.ToBoolean(q.isBonus), BonusPoints = (long)q.bonusPoints,
                    MinBonus = (int)q.minBonus, MaxBonus = (int)q.maxBonus, PerUnit = Math.Max(1, Convert.ToInt32(q.perUnit)) });
            foreach (var s in subs)
                lines.Add(new Line { LineType = "auto_sub", LineId = (int)s.id, QuestionId = (int)q.id, SubQuestionId = (int)s.id, CategoryName = q.categoryName,
                    Title = string.IsNullOrWhiteSpace((string?)s.subItemName) ? RisaoFigures.Plain(act) : $"{RisaoFigures.Plain(act)} - {s.subItemName}", Source = "auto", IsRisao = risao, ActivityName = act,
                    SubItemType = s.subItemType, SubItemId = (int?)s.subItemId, SubItemName = s.subItemName,
                    Points = (long)s.points, IsBonus = Convert.ToBoolean(s.isBonus), BonusPoints = (long)s.bonusPoints, MinBonus = (int)s.minBonus, MaxBonus = (int)s.maxBonus });
        }
        foreach (var c in await LoadManualAsync(conn, owners, yearId))
            foreach (var s in (List<dynamic>)c.subCriteria)
            {
                var opts = ((List<dynamic>)s.options).Select(o => (object)new { id = (int)o.id, optionText = (string)o.optionText, optionPoints = (long)o.optionPoints }).ToList();
                lines.Add(new Line { LineType = "manual", LineId = (int)s.id, QuestionId = (int)s.id, CategoryName = c.categoryName,
                    Title = string.IsNullOrWhiteSpace((string?)s.subCriteriaTitle) ? (string)(c.criteriaName ?? "") : (string)s.subCriteriaTitle,
                    Source = "manual", AnswerType = GoalFlowController.NormType((string?)s.answerType, opts.Count > 0), Options = opts,
                    Points = (long)s.points, IsBonus = Convert.ToBoolean(s.isBonus), BonusPoints = (long)s.bonusPoints, MinBonus = (int)s.minBonus, MaxBonus = (int)s.maxBonus });
            }
        foreach (var l in lines.Where(l => DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) != null))
        {
            l.Linked = true;
            l.Source = "auto";
        }
        return lines;
    }

    // Goal Setting figures per district for the linked lines (user 2026-11-18).
    private static async Task<Dictionary<int, Dictionary<string, decimal>>> GsValuesAsync(MySqlConnection conn, IEnumerable<int> districts, int yearId)
    {
        var map = new Dictionary<int, Dictionary<string, decimal>>();
        foreach (var d in districts.Distinct()) map[d] = await DishaGoalLinks.DistrictValuesAsync(conn, d, yearId);
        return map;
    }

    // Disha points (user 2026-11-18, option B): Auto = District Awards formula on the figure, for every PerUnit
    // (New Clubs / Women / Rotaractors = what was ADDED this year). Manual = the saved District Awards points.
    private static decimal AutoPointsNow(Line l, string? answer, Dictionary<string, decimal>? gs)
    {
        decimal? v;
        var link = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
        if (link != null && gs != null && DishaGoalLinks.Achieved(link, gs) is decimal ach)
            v = DishaGoalLinks.Gained(link, ach, DishaGoalLinks.Baseline(link, gs));
        else v = GoalFlowController.Num(answer);
        if (v is not > 0) return 0;
        var (p, b) = AutoPoints((int)Math.Floor(v.Value), l.Points, l.IsBonus, l.BonusPoints, l.MinBonus, l.MaxBonus, l.PerUnit);
        return p + b;
    }

    // A line's answer + % inputs for one district: linked lines use Goal Setting's Achieved and formula.
    private static (string? Answer, decimal? PctGoal, string? PctAnswer) Figures(Line l, decimal? goal, string? answer, Dictionary<string, decimal>? gs)
    {
        var link = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
        if (link == null || gs == null) return (answer, goal, answer);
        var ach = DishaGoalLinks.Achieved(link, gs);
        var ans = ach == null ? answer : Math.Round(ach.Value, 0, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture);
        var (g, a) = DishaGoalLinks.ForPct(link, goal, ans, DishaGoalLinks.Baseline(link, gs));
        return (ans, g, a);
    }

    private static async Task<Dictionary<(int D, string T, int L), (string? Val, decimal Pts)>> LoadEntriesAsync(MySqlConnection conn, IEnumerable<int> districts, int yearId)
    {
        var rows = await conn.QueryAsync<(int D, string Type, int Q, int? Sub, string? Val, decimal P, decimal B)>(@"
            SELECT fk_district_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned
            FROM disha_district_entry WHERE fk_district_id IN @Ds AND fk_year_id = @Y AND isdeleted = 0", new { Ds = districts, Y = yearId });
        var map = new Dictionary<(int, string, int), (string?, decimal)>();
        foreach (var r in rows)
            map[r.Type == "manual" ? (r.D, "manual", r.Q) : r.Sub is > 0 ? (r.D, "auto_sub", r.Sub.Value) : (r.D, "auto", r.Q)] = (r.Val, r.P + r.B);
        return map;
    }

    private static async Task<Dictionary<(int D, string T, int L), decimal?>> LoadGoalsAsync(MySqlConnection conn, IEnumerable<int> districts, int yearId) =>
        (await conn.QueryAsync<(int D, string T, int L, decimal? G)>(
            "SELECT fk_district_id, line_type, fk_line_id, goal_value FROM disha_goal WHERE fk_district_id IN @Ds AND fk_year_id = @Y AND goal_value IS NOT NULL",
            new { Ds = districts, Y = yearId })).ToDictionary(g => (g.D, g.T, g.L), g => g.G);

    // RI Director: districts ranked by Disha points (like District Awards' Club Points), with goal progress. Zone filter.
    [HttpGet("api/disha-awards/districts")]
    public async Task<ActionResult> GetDistricts([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var scope = await MyScopeAsync(conn);
        var zones = scope.GroupBy(d => d.zoneId).Select(g => new { id = g.Key, name = g.First().zoneName }).OrderBy(z => z.name).ToList();
        var ds = scope.Where(d => !(zoneId > 0) || d.zoneId == zoneId).ToList();
        var lines = await LoadLinesAsync(conn, MyOwners, y);
        var entries = await LoadEntriesAsync(conn, ds.Select(d => d.id), y);
        var goals = await LoadGoalsAsync(conn, ds.Select(d => d.id), y);
        var gs = await GsValuesAsync(conn, ds.Select(d => d.id), y);
        var rows = ds.Select(d =>
        {
            decimal pts = lines.Sum(l =>
            {
                var goal = goals.TryGetValue((d.id, l.LineType, l.LineId), out var gv0) ? gv0 : null;
                entries.TryGetValue((d.id, l.LineType, l.LineId), out var e0);
                return l.Source == "auto" ? AutoPointsNow(l, e0.Val, gs.GetValueOrDefault(d.id)) : e0.Pts;
            });
            var (g, r, score) = GoalFlowController.ScoreOf(lines.Select(l =>
            {
                var f = Figures(l, goals.TryGetValue((d.id, l.LineType, l.LineId), out var gv) ? gv : null,
                    entries.TryGetValue((d.id, l.LineType, l.LineId), out var e) ? e.Val : null, gs.GetValueOrDefault(d.id));
                return (l.AnswerType, f.PctGoal, f.PctAnswer);
            }));
            return new { districtId = d.id, districtNumber = d.districtNumber, zoneId = d.zoneId, zoneName = d.zoneName, points = Math.Round(pts), goals = g, reached = r, score };
        })
        .OrderByDescending(r => r.points).ThenByDescending(r => r.score ?? -1).ThenBy(r => r.districtNumber)
        .Select((r, i) => new { rank = i + 1, r.districtId, r.districtNumber, r.zoneId, r.zoneName, r.points, r.goals, r.reached, r.score }).ToList();
        return Ok(new { yearId = y, zones, districts = rows, canManage = _canManage });
    }

    // RI Director: lines x districts with each district's goal and answer (for the goal editor). Zone filter.
    [HttpGet("api/disha-awards/goals")]
    public async Task<ActionResult> GetGoals([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ds = (await MyScopeAsync(conn)).Where(d => !(zoneId > 0) || d.zoneId == zoneId).ToList();
        var lines = await LoadLinesAsync(conn, MyOwners, y);
        var entries = await LoadEntriesAsync(conn, ds.Select(d => d.id), y);
        var goals = await LoadGoalsAsync(conn, ds.Select(d => d.id), y);
        var gs = await GsValuesAsync(conn, ds.Select(d => d.id), y);
        string K(Line l) => $"{l.LineType}:{l.LineId}";
        DishaGoalLinks.Link? Lk(Line l) => l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
        return Ok(new
        {
            yearId = y,
            districts = ds,
            lines = lines.Select(l => new { key = K(l), l.LineType, l.LineId, l.CategoryName, l.Title, l.Source, l.IsRisao, l.AnswerType, l.Options,
                linked = l.Linked, youth = Lk(l)?.Youth ?? false }),
            // Goal Setting's "as on 1 July" figure per district for the linked lines - the % uses Goal Setting's formula.
            baselines = lines.Where(l => l.Linked).ToDictionary(K, l => ds.ToDictionary(d => d.id,
                d => gs.TryGetValue(d.id, out var v) ? DishaGoalLinks.Baseline(Lk(l)!, v) : null)),
            goals = lines.ToDictionary(K, l => ds.Where(d => goals.ContainsKey((d.id, l.LineType, l.LineId)))
                .ToDictionary(d => d.id, d => goals[(d.id, l.LineType, l.LineId)])),
            answers = lines.ToDictionary(K, l => ds.ToDictionary(d => d.id,
                d => Figures(l, null, entries.TryGetValue((d.id, l.LineType, l.LineId), out var e) ? OptionText(l, e.Val) : null, gs.GetValueOrDefault(d.id)).Answer)),
        });
    }

    private static string? OptionText(Line l, string? val)
    {
        if (l.AnswerType != "choose_one" || val == null) return val;
        foreach (dynamic o in l.Options) if (((int)o.id).ToString() == val) return (string)o.optionText;
        return val;
    }

    public class GoalsDto { public int YearId { get; set; } public List<GoalDto> Goals { get; set; } = new(); }
    public class GoalDto { public string LineType { get; set; } = ""; public int LineId { get; set; } public int DistrictId { get; set; } public decimal? GoalValue { get; set; } }

    // Year-wise rights (user 2026-11-20): an RI Director (goal role) may change Disha goals / locks only in the Rotary
    // years ticked on the role; any other year is view only. Super Admin and DGs (own year rule) pass.
    private async Task<ActionResult?> RoleYearDeniedAsync(MySqlConnection conn, int yearId, int districtId = 0)
    {
        // ROW: no goal roles, so no role years to check (Super Admin and DGs pass their own rules).
        await Task.CompletedTask; return null;
    }

    [HttpPut("api/disha-awards/goals")]
    public async Task<ActionResult> SaveGoals([FromBody] GoalsDto body)
    {
        if (body.Goals.Any(g => g.GoalValue < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        await using var conn = await OpenAsync();
        if (await RoleYearDeniedAsync(conn, body.YearId) is { } ry) return ry;
        var scope = (await MyScopeAsync(conn)).Select(d => d.id).ToHashSet();
        var mineLines = (await LoadLinesAsync(conn, MyOwners, body.YearId)).Where(l => l.AnswerType == "number").ToDictionary(l => (l.LineType, l.LineId));
        // A locked district section is read only for everyone until it is unlocked (user 2026-11-18, as Goal Overview).
        var locks = await LocksAsync(conn, body.Goals.Select(g => g.DistrictId).Distinct(), body.YearId);
        foreach (var g in body.Goals.Where(g => scope.Contains(g.DistrictId) && mineLines.ContainsKey((g.LineType, g.LineId))
                     && !(locks.GetValueOrDefault(g.DistrictId)?.Contains(DishaRccGoals.SectionOfCategory(mineLines[(g.LineType, g.LineId)].CategoryName)) ?? false)))
            await conn.ExecuteAsync(@"
                INSERT INTO disha_goal (fk_year_id, fk_district_id, line_type, fk_line_id, goal_value, created_by) VALUES (@Y, @D, @T, @L, @G, @M)
                ON DUPLICATE KEY UPDATE goal_value = @G, modified_by = @M, modified_date = NOW()",
                new { Y = body.YearId, D = g.DistrictId, T = g.LineType, L = g.LineId, G = g.GoalValue, M = MemberId });
        return Ok(new { message = "Goals saved." });
    }

    // ── Disha goals set by the RI Director / SA / DG + Lock / Unlock (user 2026-11-18, like Goal Overview) ──
    // Questions: disha_goal. Goal Setting / RCC boxes in the Disha Overview: disha_rcc_goal (by field key) - their own
    // Disha figure, never written by a Rotary.org sync or RISAO import. Locks: disha_goal_lock per district + section.
    private static async Task<Dictionary<int, HashSet<string>>> LocksAsync(MySqlConnection conn, IEnumerable<int> districts, int y) =>
        (await conn.QueryAsync<(int D, string S)>(
            "SELECT fk_district_id, section_key FROM disha_goal_lock WHERE fk_district_id IN @Ds AND fk_year_id = @Y AND is_locked = 1",
            new { Ds = districts, Y = y }))
        .GroupBy(r => r.D).ToDictionary(g => g.Key, g => g.Select(r => r.S).ToHashSet());
    private static async Task<Dictionary<int, Dictionary<string, decimal?>>> RccGoalsAsync(MySqlConnection conn, IEnumerable<int> districts, int y) =>
        (await conn.QueryAsync<(int D, string K, decimal? V)>(
            "SELECT fk_district_id, field_key, goal_value FROM disha_rcc_goal WHERE fk_district_id IN @Ds AND fk_year_id = @Y AND goal_value IS NOT NULL",
            new { Ds = districts, Y = y }))
        .GroupBy(r => r.D).ToDictionary(g => g.Key, g => g.ToDictionary(r => r.K, r => r.V));

    // RI Director / SA: every district in scope (zone filter) - locks and the Disha goals of the RCC boxes.
    [HttpGet("api/disha-awards/goal-state")]
    public async Task<ActionResult> GoalState([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ids = (await MyScopeAsync(conn)).Where(d => !(zoneId > 0) || d.zoneId == zoneId).Select(d => d.id).ToList();
        var locks = await LocksAsync(conn, ids, y);
        var rcc = await RccGoalsAsync(conn, ids, y);
        return Ok(new
        {
            yearId = y, canManage = _canManage,
            districts = ids.ToDictionary(id => id, id => new
            {
                locks = locks.TryGetValue(id, out var l) ? l.ToList() : new List<string>(),
                rccGoals = rcc.TryGetValue(id, out var r) ? r : new Dictionary<string, decimal?>(),
            }),
        });
    }

    // One district (its DG, or the RI Director / SA): locks, the RCC-box goals, and who may set goals.
    [HttpGet("api/disha-awards/district/{districtId:int}/goal-state")]
    public async Task<ActionResult> DistrictGoalState(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        bool dg = await _guard.DistrictYearAsync(User, districtId, y) == null;
        var locks = await LocksAsync(conn, new[] { districtId }, y);
        var rcc = await RccGoalsAsync(conn, new[] { districtId }, y);
        return Ok(new
        {
            yearId = y, canManage = _canManage, canSetGoals = _canManage || dg,
            locks = locks.TryGetValue(districtId, out var l) ? l.ToList() : new List<string>(),
            rccGoals = rcc.TryGetValue(districtId, out var r) ? r : new Dictionary<string, decimal?>(),
        });
    }

    public class DistrictGoalsDto
    {
        public int YearId { get; set; }
        public List<GoalDto> QuestionGoals { get; set; } = new();
        public List<RccGoalDto> RccGoals { get; set; } = new();
    }
    public class RccGoalDto { public string FieldKey { get; set; } = ""; public decimal? GoalValue { get; set; } }

    // Save one district's goals (RI Director / SA / its DG) - only sections that are not locked.
    [HttpPut("api/disha-awards/district/{districtId:int}/goals")]
    public async Task<ActionResult> SaveDistrictGoals(int districtId, [FromBody] DistrictGoalsDto body)
    {
        if (body.QuestionGoals.Any(g => g.GoalValue < 0) || body.RccGoals.Any(g => g.GoalValue < 0))
            return BadRequest(new { message = "A goal cannot be negative." });
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        if (!_canManage && await _guard.DistrictYearAsync(User, districtId, y) is { } denied) return denied;
        if (_canManage && await RoleYearDeniedAsync(conn, y, districtId) is { } ry) return ry;
        // A locked section is read only for everyone - RI Director / SA unlock it first (user 2026-11-18, as Goal Overview).
        var locked = (await LocksAsync(conn, new[] { districtId }, y)).GetValueOrDefault(districtId) ?? new();
        var lines = (await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y))
            .Where(l => l.AnswerType == "number").ToDictionary(l => (l.LineType, l.LineId));
        int saved = 0, skipped = 0;
        foreach (var g in body.QuestionGoals)
        {
            if (!lines.TryGetValue((g.LineType, g.LineId), out var l)) continue;
            if (locked.Contains(DishaRccGoals.SectionOfCategory(l.CategoryName))) { skipped++; continue; }
            await conn.ExecuteAsync(@"
                INSERT INTO disha_goal (fk_year_id, fk_district_id, line_type, fk_line_id, goal_value, created_by) VALUES (@Y, @D, @T, @L, @G, @M)
                ON DUPLICATE KEY UPDATE goal_value = @G, modified_by = @M, modified_date = NOW()",
                new { Y = y, D = districtId, T = g.LineType, L = g.LineId, G = g.GoalValue, M = MemberId });
            saved++;
        }
        foreach (var g in body.RccGoals)
        {
            if (!DishaRccGoals.GoalKeys.TryGetValue(g.FieldKey, out var section)) continue;
            if (locked.Contains(section)) { skipped++; continue; }
            await conn.ExecuteAsync(@"
                INSERT INTO disha_rcc_goal (fk_year_id, fk_district_id, field_key, goal_value, modified_by) VALUES (@Y, @D, @K, @G, @M)
                ON DUPLICATE KEY UPDATE goal_value = @G, modified_by = @M",
                new { Y = y, D = districtId, K = g.FieldKey, G = g.GoalValue, M = MemberId });
            saved++;
        }
        return Ok(new { message = skipped > 0 ? $"Goals saved. {skipped} goal(s) not changed - that section is locked." : "Goals saved.", saved, skipped });
    }

    public class RccGoalRowDto { public int DistrictId { get; set; } public string FieldKey { get; set; } = ""; public decimal? GoalValue { get; set; } }
    public class RccGoalsDto { public int YearId { get; set; } public List<RccGoalRowDto> Goals { get; set; } = new(); }

    // Set Goals tab (RI Director / SA): the Disha goal of the Goal Setting / RCC boxes, every district in scope.
    [HttpPut("api/disha-awards/rcc-goals")]
    public async Task<ActionResult> SaveRccGoals([FromBody] RccGoalsDto body)
    {
        if (!_canManage) return StatusCode(403, new { message = "Only Super Admin can change Disha goals here." });
        if (body.Goals.Any(g => g.GoalValue < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        if (await RoleYearDeniedAsync(conn, y) is { } ry) return ry;
        var scope = (await MyScopeAsync(conn)).Select(d => d.id).ToHashSet();
        var rlocks = await LocksAsync(conn, body.Goals.Select(g => g.DistrictId).Distinct(), y);
        foreach (var g in body.Goals.Where(g => scope.Contains(g.DistrictId) && DishaRccGoals.GoalKeys.TryGetValue(g.FieldKey, out var sec)
                     && !(rlocks.GetValueOrDefault(g.DistrictId)?.Contains(sec) ?? false)))
            await conn.ExecuteAsync(@"
                INSERT INTO disha_rcc_goal (fk_year_id, fk_district_id, field_key, goal_value, modified_by) VALUES (@Y, @D, @K, @G, @M)
                ON DUPLICATE KEY UPDATE goal_value = @G, modified_by = @M",
                new { Y = y, D = g.DistrictId, K = g.FieldKey, G = g.GoalValue, M = MemberId });
        return Ok(new { message = "Goals saved." });
    }

    public class LockDto
    {
        public int YearId { get; set; }
        public List<int>? DistrictIds { get; set; }   // null = every district in scope (zone filter)
        public int? ZoneId { get; set; }
        public List<string>? Sections { get; set; }   // null = every section
        public bool Locked { get; set; }
    }

    // Lock / Unlock Disha goals: one district + one section, one district (all sections), or all districts.
    // RI Director / SA only (the gate refuses non-GET without a districtId for the others).
    [HttpPost("api/disha-awards/locks")]
    public async Task<ActionResult> SetLocks([FromBody] LockDto body)
    {
        if (!_canManage) return StatusCode(403, new { message = "Only Super Admin can lock Disha goals." });
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        if (await RoleYearDeniedAsync(conn, y) is { } ry) return ry;
        var scope = (await MyScopeAsync(conn)).Where(d => !(body.ZoneId > 0) || d.zoneId == body.ZoneId).Select(d => d.id).ToHashSet();
        var ids = body.DistrictIds == null ? scope.ToList() : body.DistrictIds.Where(scope.Contains).ToList();
        var sections = (body.Sections ?? DishaRccGoals.Sections.ToList()).Where(DishaRccGoals.Sections.Contains).ToList();
        foreach (var d in ids)
            foreach (var s in sections)
                await conn.ExecuteAsync(@"
                    INSERT INTO disha_goal_lock (fk_year_id, fk_district_id, section_key, is_locked, modified_by) VALUES (@Y, @D, @S, @L, @M)
                    ON DUPLICATE KEY UPDATE is_locked = @L, modified_by = @M",
                    new { Y = y, D = d, S = s, L = body.Locked, M = MemberId });
        var what = ids.Count == 1 ? "District goals" : $"Goals of {ids.Count} districts";
        return Ok(new { message = $"{what} {(body.Locked ? "locked" : "unlocked")}." });
    }

    // ── One district (District Admin): answer like a club does in District Awards ──
    [HttpGet("api/disha-awards/district/{districtId:int}")]
    public async Task<ActionResult> GetDistrict(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var current = await YearAsync(conn, null);
        var owners = await OwnersOfDistrictAsync(conn, districtId, y);
        var lines = await LoadLinesAsync(conn, owners, y);
        var entries = await LoadEntriesAsync(conn, new[] { districtId }, y);
        var goals = await LoadGoalsAsync(conn, new[] { districtId }, y);
        var gs = await DishaGoalLinks.DistrictValuesAsync(conn, districtId, y);
        foreach (var l in lines)
        {
            if (entries.TryGetValue((districtId, l.LineType, l.LineId), out var e)) { l.AnswerValue = e.Val; l.PointsEarned = e.Pts; }
            if (goals.TryGetValue((districtId, l.LineType, l.LineId), out var g)) l.GoalValue = g;
            var f = Figures(l, l.GoalValue, l.AnswerValue, gs);
            l.AnswerValue = f.Answer;
            l.AchievementPct = GoalFlowController.Pct(l.AnswerType, f.PctGoal, l.AnswerType == "choose_one" ? null : f.PctAnswer);
            if (l.Source == "auto") l.PointsEarned = AutoPointsNow(l, e.Val, gs);
        }
        var canAnswer = y == current && await _guard.DistrictYearAsync(User, districtId, y) == null;
        return Ok(new { yearId = y, canAnswer, risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "District"),
                        totalPoints = Math.Round(lines.Sum(l => l.PointsEarned)), lines });
    }

    public class AnswerDto { public int SubCriteriaId { get; set; } public string? AnswerValue { get; set; } }

    [HttpPost("api/disha-awards/district/{districtId:int}/answers")]
    public async Task<ActionResult> SaveAnswers(int districtId, [FromBody] List<AnswerDto> answers)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, null);
        var denied = await _guard.DistrictYearAsync(User, districtId, y);
        if (denied != null) return denied;
        if (answers.Any(a => GoalFlowController.Num(a.AnswerValue) < 0)) return BadRequest(new { message = "Answers cannot be negative. Please enter 0 or more." });
        var lines = (await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y)).Where(l => l.LineType == "manual" && l.Source == "manual").ToDictionary(l => l.LineId);
        foreach (var a in answers)
        {
            if (!lines.TryGetValue(a.SubCriteriaId, out var l)) continue;
            var optPts = l.Options.Select(o => (dynamic)o).ToDictionary(o => (int)o.id, o => (decimal)(long)o.optionPoints);
            var (p, b) = GoalFlowController.ManualPoints(l.AnswerType, a.AnswerValue, l.Points, l.IsBonus, l.BonusPoints, l.MinBonus, l.MaxBonus, optPts);
            await UpsertEntryAsync(conn, y, districtId, "manual", l.LineId, null, a.AnswerValue, p, b, MemberId);
        }
        return Ok(new { message = "Answers saved." });
    }

    private static async Task UpsertEntryAsync(MySqlConnection conn, int yearId, int districtId, string type, int questionId, int? subId, string? val, decimal p, decimal b, int memberId)
    {
        var prm = new { Y = yearId, D = districtId, T = type, Q = questionId, S = subId, V = val, P = p, B = b, M = memberId };
        var id = await conn.ExecuteScalarAsync<int?>(@"SELECT pk_id FROM disha_district_entry WHERE fk_year_id = @Y AND fk_district_id = @D AND entry_type = @T
            AND fk_question_id = @Q AND (fk_sub_question_id <=> @S) AND isdeleted = 0 LIMIT 1", prm);
        if (id.HasValue)
            await conn.ExecuteAsync("UPDATE disha_district_entry SET answer_value = @V, points_earned = @P, bonus_earned = @B, modified_by = @M, modified_date = NOW() WHERE pk_id = @Id",
                new { Id = id.Value, V = val, P = p, B = b, M = memberId });
        else
            await conn.ExecuteAsync(@"INSERT INTO disha_district_entry (fk_year_id, fk_district_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned, created_by)
                VALUES (@Y, @D, @T, @Q, @S, @V, @P, @B, @M)", prm);
    }

    // District Awards auto points formula (CitationAutoPointsBackgroundService.CalculatePoints).
    // "For every" (option B): points per block of perUnit (1 = the usual count x points); bonus min / max use the real figure.
    private static (decimal, decimal) AutoPoints(int count, decimal pts, bool isBonus, decimal bonusPts, int minB, int maxB, int perUnit = 1)
    {
        if (count == 0) return (0, 0);
        if (perUnit < 1) perUnit = 1;
        if (!isBonus) return ((count / perUnit) * pts, 0);
        if (minB == 0 && maxB == 0) return ((count / perUnit) * pts, bonusPts);
        var capped = maxB > 0 && count > maxB ? maxB : count;
        return ((capped / perUnit) * pts, count >= minB && minB > 0 ? bonusPts : 0);
    }

    // Count every auto line for the given districts (District Awards counting over the district's clubs; RISAO = the
    // district's RISAO figure, or the clubs' figures added up when RISAO has no district figure).
    public static async Task<int> RefreshAutoAsync(MySqlConnection conn, CitationAutoPointsBackgroundService svc, IEnumerable<int> districtIds, int yearId, int memberId)
    {
        int n = 0;
        foreach (var d in districtIds)
        {
            var lines = (await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, d, yearId), yearId)).Where(l => l.Source == "auto").ToList();
            var gs = await DishaGoalLinks.DistrictValuesAsync(conn, d, yearId);
            foreach (var l in lines)
            {
                // A Goal Setting box: answer = Goal Setting's Achieved (total); points on what was added this year.
                var link = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
                if (link != null)
                {
                    var ach = DishaGoalLinks.Achieved(link, gs);
                    if (ach == null) continue;
                    var (lp, lb) = AutoPoints(DishaGoalLinks.Gained(link, ach.Value, DishaGoalLinks.Baseline(link, gs)), l.Points, l.IsBonus, l.BonusPoints, l.MinBonus, l.MaxBonus, l.PerUnit);
                    await UpsertEntryAsync(conn, yearId, d, l.LineType == "manual" ? "manual" : "auto", l.QuestionId, l.LineType == "manual" ? null : l.SubQuestionId,
                        Math.Round(ach.Value, 0, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture), lp, lb, memberId);
                    n++;
                    continue;
                }
                int? count = null;
                var field = l.IsRisao ? RisaoFigures.DistrictFieldOf(l.ActivityName!) : null;
                if (count == null && field != null)
                {
                    var v = await RisaoFigures.DistrictValueAsync(conn, field, d, yearId);
                    count = v == null ? null : (int)Math.Round(v.Value, MidpointRounding.AwayFromZero);
                }
                count ??= await svc.CountForDistrictAsync(d, yearId, l.ActivityName!, l.SubItemType, l.SubItemId, l.SubItemName);
                if (count == null) continue;
                var (p, b) = AutoPoints(count.Value, l.Points, l.IsBonus, l.BonusPoints, l.MinBonus, l.MaxBonus, l.PerUnit);
                await UpsertEntryAsync(conn, yearId, d, "auto", l.QuestionId, l.SubQuestionId, count.Value.ToString(CultureInfo.InvariantCulture), p, b, memberId);
                n++;
            }
        }
        return n;
    }

    // Month-wise (user 2026-11-18, option A): each Auto line's achieved per month (District Awards counting over the
    // district's clubs; RISAO = the monthly RISAO import) + the yearly answer; Manual lines are yearly.
    // One district's achieved per month (7..6) for each line: Goal Setting's months for its boxes, the monthly RISAO
    // import for RISAO fields, the monthly counts for the other Auto Fetch; Manual Entry = null (yearly only).
    private async Task<Dictionary<string, Dictionary<int, decimal>?>> MonthlyByLineAsync(MySqlConnection conn, int districtId, int y, List<Line> lines)
    {
        var year = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var proj = await HttpContext.RequestServices.GetRequiredService<IYearTableResolver>().ResolveByYearIdAsync(conn, y);
        var mods = await MonthlyGoalCounts.ModuleIdsAsync(conn);
        var clubs = (await conn.QueryAsync<int>($"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToList();
        var res = new Dictionary<string, Dictionary<int, decimal>?>();
        foreach (var l in lines)
        {
            var k = $"{l.LineType}:{l.LineId}";
            var link = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
            if (link != null) { var gm = await DishaGoalLinks.MonthlyAsync(conn, link, districtId, y); res[k] = gm.Count > 0 ? gm : null; continue; }
            if (l.Source != "auto" || !MonthlyGoalCounts.IsMonthly(l.ActivityName)) { res[k] = null; continue; }
            res[k] = l.IsRisao
                ? await MonthlyGoalCounts.RisaoDistrictAsync(conn, l.ActivityName!, districtId, clubs, y)
                : proj == null ? new() : await MonthlyGoalCounts.AutoAsync(conn, l.ActivityName!, clubs, y, year.Start, year.End, proj.ProjectsTable, mods, l.SubItemType, l.SubItemId, l.SubItemName);
        }
        return res;
    }

    [HttpGet("api/disha-awards/district/{districtId:int}/monthly")]
    public async Task<ActionResult> GetDistrictMonthly(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var year = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var proj = await HttpContext.RequestServices.GetRequiredService<IYearTableResolver>().ResolveByYearIdAsync(conn, y);
        var mods = await MonthlyGoalCounts.ModuleIdsAsync(conn);
        var clubs = (await conn.QueryAsync<int>($"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToList();
        var lines = await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y);
        var entries = await LoadEntriesAsync(conn, new[] { districtId }, y);
        var goals = await LoadGoalsAsync(conn, new[] { districtId }, y);
        var gs = await DishaGoalLinks.DistrictValuesAsync(conn, districtId, y);
        var rows = new List<object>();
        foreach (var l in lines)
        {
            Dictionary<int, decimal>? monthly = null;
            var link = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
            if (link != null)
            {
                // Goal Setting's own months; Achieved = 1 July + the months (= Goal Setting's Achieved).
                var gm = await DishaGoalLinks.MonthlyAsync(conn, link, districtId, y);
                entries.TryGetValue((districtId, l.LineType, l.LineId), out var le);
                rows.Add(new { l.LineType, l.LineId, l.CategoryName, l.Title, l.Source, l.IsRisao, l.AnswerType,
                    goalValue = goals.TryGetValue((districtId, l.LineType, l.LineId), out var lg) ? lg : null,
                    answerValue = Figures(l, null, le.Val, gs).Answer, monthly = gm.Count > 0 ? gm : null,
                    baseline = DishaGoalLinks.Baseline(link, gs), youth = link.Youth });
                continue;
            }
            if (l.Source == "auto" && MonthlyGoalCounts.IsMonthly(l.ActivityName))
                monthly = l.IsRisao
                    ? await MonthlyGoalCounts.RisaoDistrictAsync(conn, l.ActivityName!, districtId, clubs, y)
                    : proj == null ? new() : await MonthlyGoalCounts.AutoAsync(conn, l.ActivityName!, clubs, y, year.Start, year.End, proj.ProjectsTable, mods, l.SubItemType, l.SubItemId, l.SubItemName);
            entries.TryGetValue((districtId, l.LineType, l.LineId), out var e);
            rows.Add(new { l.LineType, l.LineId, l.CategoryName, l.Title, l.Source, l.IsRisao, l.AnswerType,
                goalValue = goals.TryGetValue((districtId, l.LineType, l.LineId), out var g) ? g : null,
                answerValue = e.Val, monthly });
        }
        return Ok(new { yearId = y, months = MonthlyGoalCounts.YearMonths, risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "District"), lines = rows });
    }

    // ── Reports (user 2026-11-18) ──
    // One cell of the report: same Goal / Achieved / % / Points the screens show.
    private static GfCell ReportCell(Line l, decimal? goal, (string? Val, decimal Pts) e, Dictionary<string, decimal>? gs)
    {
        var f = Figures(l, goal, e.Val, gs);
        var pct = GoalFlowController.Pct(l.AnswerType, f.PctGoal, l.AnswerType == "choose_one" ? null : f.PctAnswer);
        var pts = l.Source == "auto" ? AutoPointsNow(l, e.Val, gs) : e.Pts;
        string? shown = l.AnswerType switch
        {
            "yesno" => f.Answer == "yes" ? "Yes" : f.Answer == "no" ? "No" : null,
            "choose_one" => OptionText(l, f.Answer),
            _ => f.Answer,
        };
        return new GfCell(goal, shown, pct, pts);
    }
    private static GfQuestion ReportQuestion(Line l) => new(l.CategoryName, l.Title, l.Source == "auto", l.AnswerType, l.IsRisao);
    private static async Task<string> YearLabelAsync(MySqlConnection conn, int y) =>
        await conn.ExecuteScalarAsync<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y }) ?? "";

    // RI Director: every district in scope (zone filter) - questions down, districts across (Goal / Achieved / % /
    // Points), total points and rank; one district = the single-district report.
    [HttpGet("api/disha-awards/report")]
    public async Task<ActionResult> Report([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ds = (await MyScopeAsync(conn)).Where(d => !(zoneId > 0) || d.zoneId == zoneId).ToList();
        if (ds.Count == 0) return NotFound(new { message = "No districts to report." });
        if (ds.Count == 1) return await DistrictReport(ds[0].id, y);
        var lines = await LoadLinesAsync(conn, MyOwners, y);
        if (lines.Count == 0) return NotFound(new { message = "No Disha questions for this year yet." });
        var entries = await LoadEntriesAsync(conn, ds.Select(d => d.id), y);
        var goals = await LoadGoalsAsync(conn, ds.Select(d => d.id), y);
        var gs = await GsValuesAsync(conn, ds.Select(d => d.id), y);
        var cells = new GfCell[lines.Count, ds.Count];
        for (int i = 0; i < lines.Count; i++)
            for (int e = 0; e < ds.Count; e++)
            {
                var l = lines[i]; var d = ds[e].id;
                entries.TryGetValue((d, l.LineType, l.LineId), out var en);
                cells[i, e] = ReportCell(l, goals.TryGetValue((d, l.LineType, l.LineId), out var g) ? g : null, en, gs.GetValueOrDefault(d));
            }
        var zone = zoneId > 0 ? ds[0].zoneName + " · " : "";
        var bytes = GoalFlowExcel.EntitiesDown("Disha Goals - All Districts",   // districts down, questions across (user 2026-11-19)
            $"{zone}Rotary Year {await YearLabelAsync(conn, y)}   ·   {ds.Count} districts   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            "District", lines.Select(ReportQuestion).ToList(), ds.Select(d => $"D{d.districtNumber}").ToList(), cells);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Disha_Goals_All_Districts_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // Overview tab (user 2026-11-18, boss demo): every district in scope (zone filter) as cards, like the Goal Setting
    // overview - each question's Goal / Achieved / % / Points per district (same figures as the report), the zone
    // total per question, points and rank per district.
    [HttpGet("api/disha-awards/overview")]
    public async Task<ActionResult> Overview([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ds = (await MyScopeAsync(conn)).Where(d => !(zoneId > 0) || d.zoneId == zoneId).ToList();
        return Ok(await OverviewPayloadAsync(conn, y, ds, await LoadLinesAsync(conn, MyOwners, y)));
    }

    // DG (user 2026-11-18): the same Overview for their own district - the questions that apply to it.
    [HttpGet("api/disha-awards/district/{districtId:int}/overview")]
    public async Task<ActionResult> DistrictOverview(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ds = (await ScopeOfAsync(conn, 0)).Where(d => d.id == districtId).ToList();
        return Ok(await OverviewPayloadAsync(conn, y, ds, await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y)));
    }

    private async Task<object> OverviewPayloadAsync(MySqlConnection conn, int y, List<ScopeDistrict> ds, List<Line> lines)
    {
        var entries = await LoadEntriesAsync(conn, ds.Select(d => d.id), y);
        var goals = await LoadGoalsAsync(conn, ds.Select(d => d.id), y);
        var gs = await GsValuesAsync(conn, ds.Select(d => d.id), y);
        string K(Line l) => $"{l.LineType}:{l.LineId}";
        // Goal Setting boxes: their "as on 1 July" figure too (user 2026-11-18: "Total No of Clubs as on July 1st" ...).
        var links = lines.ToDictionary(K, l => l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null);
        decimal? BaseOf(string k, int d) => links[k] is { } lk && gs.TryGetValue(d, out var v) ? DishaGoalLinks.Baseline(lk, v) : null;
        object Cell(string k, int d, GfCell c) => new { goal = c.Goal, achieved = c.Achieved, pct = c.Pct, points = Math.Round(c.Points), baseline = BaseOf(k, d) };

        var perDistrict = ds.Select(d => (d, cells: lines.ToDictionary(K, l =>
        {
            entries.TryGetValue((d.id, l.LineType, l.LineId), out var en);
            return ReportCell(l, goals.TryGetValue((d.id, l.LineType, l.LineId), out var g) ? g : null, en, gs.GetValueOrDefault(d.id));
        }))).ToList();

        // Total of the districts in view: Goal and Achieved added up; % with the same formula on the totals
        // (Goal Setting boxes: Goal Setting's formula on the summed Goal Setting figures); Yes / No = districts with Yes.
        var sumGs = new Dictionary<string, decimal>();
        foreach (var v in gs.Values) foreach (var (k, n) in v) sumGs[k] = sumGs.GetValueOrDefault(k) + n;
        var totals = lines.ToDictionary(K, l =>
        {
            var cs = perDistrict.Select(p => p.cells[K(l)]).ToList();
            decimal pts = Math.Round(cs.Sum(c => c.Points));
            decimal? baseline = links[K(l)] is { } lk ? DishaGoalLinks.Baseline(lk, sumGs) : null;
            if (l.AnswerType == "yesno")
                return new { goal = (decimal?)null, achieved = (string?)$"{cs.Count(c => c.Achieved == "Yes")} of {cs.Count}", pct = (decimal?)null, points = pts, baseline };
            if (l.AnswerType != "number")
                return new { goal = (decimal?)null, achieved = (string?)null, pct = (decimal?)null, points = pts, baseline };
            var withGoal = cs.Where(c => c.Goal != null).ToList();
            decimal? goal = withGoal.Count == 0 ? null : withGoal.Sum(c => c.Goal!.Value);
            var nums = cs.Select(c => GoalFlowController.Num(c.Achieved)).Where(n => n != null).ToList();
            string? ach = nums.Count == 0 ? null : nums.Sum(n => n!.Value).ToString(CultureInfo.InvariantCulture);
            var f = Figures(l, goal, ach, l.Linked ? sumGs : null);
            return new { goal, achieved = f.Answer, pct = GoalFlowController.Pct(l.AnswerType, f.PctGoal, f.PctAnswer), points = pts, baseline };
        });

        var rows = perDistrict.Select(p => new
        {
            districtId = p.d.id, districtNumber = p.d.districtNumber, zoneId = p.d.zoneId, zoneName = p.d.zoneName,
            points = Math.Round(p.cells.Values.Sum(c => c.Points)),
            cells = p.cells.ToDictionary(kv => kv.Key, kv => Cell(kv.Key, p.d.id, kv.Value)),
        })
        .OrderByDescending(r => r.points).ThenBy(r => r.districtNumber)
        .Select((r, i) => new { rank = i + 1, r.districtId, r.districtNumber, r.zoneId, r.zoneName, r.points, r.cells }).ToList();

        return new
        {
            yearId = y,
            risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "District"),
            lines = lines.Select(l => new { key = K(l), l.CategoryName, l.Title, l.Source, l.IsRisao, l.AnswerType, baseKey = links[K(l)]?.BaseKey }),
            totals,
            districts = rows,
        };
    }

    // ── Report WITH the Goal Setting boxes (user 2026-11-19, option A): the SAME report (same layouts, sheets and
    // design as Report / DistrictReport) with the Overview's Goal Setting boxes (the 26 RCC goals + Clubs, Members,
    // Women Members, RAG Analysis, Summary) added as rows in the Goal Setting order. The page sends the order and the
    // boxes' figures (worked out on screen from Goal Setting + the Disha goals); the Disha questions come from here.
    public class FullReportItem
    {
        public string Kind { get; set; } = "line";      // line = a Disha question (Key) | box = a Goal Setting box
        public string? Key { get; set; }
        public string Category { get; set; } = "";
        public string Title { get; set; } = "";
        public bool TwoDecimals { get; set; }
        public bool Number { get; set; } = true;
        public Dictionary<int, FullReportCell> Cells { get; set; } = new();
    }
    public class FullReportCell { public decimal? Goal { get; set; } public string? Achieved { get; set; } public decimal? Pct { get; set; } public decimal? Baseline { get; set; }
        public Dictionary<int, decimal>? Monthly { get; set; } }   // the box's achieved per month (Goal Setting) - month-wise sheets
    public class FullReportDto { public int? YearId { get; set; } public int? ZoneId { get; set; } public List<FullReportItem> Items { get; set; } = new();
        public bool ShowPoints { get; set; } }   // one district: Points only on the DG's own report (user 2026-11-19)

    private static (List<GfQuestion> Qs, List<Func<int, GfCell>> Get) FullRows(List<Line> lines, List<FullReportItem> items,
        Func<Line, int, GfCell> lineCell)
    {
        var byKey = lines.ToDictionary(l => $"{l.LineType}:{l.LineId}");
        var qs = new List<GfQuestion>(); var get = new List<Func<int, GfCell>>(); var used = new HashSet<string>();
        foreach (var it in items)
        {
            if (it.Kind == "line")
            {
                if (it.Key == null || !byKey.TryGetValue(it.Key, out var l) || !used.Add(it.Key)) continue;
                qs.Add(ReportQuestion(l) with { HasBase = l.Linked }); get.Add(d => lineCell(l, d));
            }
            else
            {
                qs.Add(new GfQuestion(it.Category, it.Title, true, it.Number ? "number" : "text", it.TwoDecimals, it.Cells.Values.Any(c => c.Baseline != null)));
                get.Add(d => it.Cells.TryGetValue(d, out var c) ? new GfCell(c.Goal, c.Achieved, c.Pct, 0, c.Baseline, c.Monthly) : new GfCell(null, null, null, 0));
            }
        }
        // Any Disha question the page did not list still goes in, at the end of its kind (nothing is ever dropped).
        foreach (var l in lines.Where(l => !used.Contains($"{l.LineType}:{l.LineId}"))) { qs.Add(ReportQuestion(l) with { HasBase = l.Linked }); get.Add(d => lineCell(l, d)); }
        return (qs, get);
    }

    [HttpPost("api/disha-awards/report-full")]
    public async Task<ActionResult> ReportFull([FromBody] FullReportDto body)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        var ds = (await MyScopeAsync(conn)).Where(d => !(body.ZoneId > 0) || d.zoneId == body.ZoneId).ToList();
        if (ds.Count == 0) return NotFound(new { message = "No districts to report." });
        if (ds.Count == 1) return await DistrictReportFull(ds[0].id, body);
        var lines = await LoadLinesAsync(conn, MyOwners, y);
        var entries = await LoadEntriesAsync(conn, ds.Select(d => d.id), y);
        var goals = await LoadGoalsAsync(conn, ds.Select(d => d.id), y);
        var gs = await GsValuesAsync(conn, ds.Select(d => d.id), y);
        // Month wise / Quarterly sheets (user 2026-11-19): each district's month figures per line.
        var monthly = new Dictionary<int, Dictionary<string, Dictionary<int, decimal>?>>();
        foreach (var d in ds) monthly[d.id] = await MonthlyByLineAsync(conn, d.id, y, lines);
        var (qs, get) = FullRows(lines, body.Items, (l, d) =>
        {
            entries.TryGetValue((d, l.LineType, l.LineId), out var en);
            var cell = ReportCell(l, goals.TryGetValue((d, l.LineType, l.LineId), out var g) ? g : null, en, gs.GetValueOrDefault(d));
            cell = cell with { Monthly = monthly[d].GetValueOrDefault($"{l.LineType}:{l.LineId}") };
            var lk = l.Linked ? DishaGoalLinks.Of(l.LineType, l.ActivityName, l.Title) : null;
            return lk != null && gs.TryGetValue(d, out var v) ? cell with { Baseline = DishaGoalLinks.Baseline(lk, v) } : cell;
        });
        if (qs.Count == 0) return NotFound(new { message = "No Disha goals for this year yet." });
        var cells = new GfCell[qs.Count, ds.Count];
        for (int i = 0; i < qs.Count; i++) for (int e = 0; e < ds.Count; e++) cells[i, e] = get[i](ds[e].id);
        var zone = body.ZoneId > 0 ? ds[0].zoneName + " · " : "";
        // Districts down; Category / Question / As on July 1st · Goal · Achieved · % across (user 2026-11-19).
        var bytes = GoalFlowExcel.DistrictsDownOverview("Disha Goals - All Districts",
            $"{zone}Rotary Year {await YearLabelAsync(conn, y)}   ·   {ds.Count} districts   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            qs, ds.OrderBy(d => d.districtNumber).Select(d => d.districtNumber.Trim()).ToList(),   // just the number (user 2026-11-19)
            Reorder(cells, ds.Select((d, i) => (d.districtNumber, i)).OrderBy(x => x.districtNumber).Select(x => x.i).ToList()),
            months: MonthlyGoalCounts.YearMonths.ToList());
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Disha_Goals_All_Districts_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }
    private static GfCell[,] Reorder(GfCell[,] cells, List<int> order)
    {
        var o = new GfCell[cells.GetLength(0), order.Count];
        for (int i = 0; i < cells.GetLength(0); i++) for (int e = 0; e < order.Count; e++) o[i, e] = cells[i, order[e]];
        return o;
    }

    // One district (DG, or the RI Director's district filter): same as DistrictReport + the Goal Setting boxes.
    [HttpPost("api/disha-awards/district/{districtId:int}/report-full")]
    public async Task<ActionResult> DistrictReportFull(int districtId, [FromBody] FullReportDto body)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        var lines = await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y);
        var entries = await LoadEntriesAsync(conn, new[] { districtId }, y);
        var goals = await LoadGoalsAsync(conn, new[] { districtId }, y);
        var gs = await DishaGoalLinks.DistrictValuesAsync(conn, districtId, y);
        var monthly = await MonthlyByLineAsync(conn, districtId, y, lines);
        var (qs, get) = FullRows(lines, body.Items, (l, d) =>
        {
            entries.TryGetValue((d, l.LineType, l.LineId), out var en);
            return ReportCell(l, goals.TryGetValue((d, l.LineType, l.LineId), out var g) ? g : null, en, gs)
                with { Monthly = monthly.GetValueOrDefault($"{l.LineType}:{l.LineId}") };
        });
        if (qs.Count == 0) return NotFound(new { message = "No Disha goals for this year yet." });
        var num = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? "";
        var asOn = await RisaoFigures.AsOnAsync(conn, y, "District");
        var bytes = GoalFlowExcel.Single($"Disha Goals - District {num}",
            $"Rotary Year {await YearLabelAsync(conn, y)}{(asOn != null ? $"   ·   RISAO figures as on {asOn}" : "")}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            qs, qs.Select((_, i) => get[i](districtId)).ToList(), body.ShowPoints, MonthlyGoalCounts.YearMonths.ToList());
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Disha_Goals_D{num}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // Disha Overview "View clubs" report (user 2026-11-19): the district's clubs DOWN, the Goal Setting boxes ACROSS
    // (Category / Question / As on July 1st · Goal · Achieved · %) - the figures the page shows, sent by the page.
    public class ClubsReportDto
    {
        public int? YearId { get; set; }
        public List<ClubRef> Clubs { get; set; } = new();
        public List<FullReportItem> Items { get; set; } = new();
    }
    public class ClubRef { public int Id { get; set; } public string Name { get; set; } = ""; }

    [HttpPost("api/disha-awards/district/{districtId:int}/clubs-report")]
    public async Task<ActionResult> ClubsReport(int districtId, [FromBody] ClubsReportDto body)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, body.YearId);
        var num = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? "";
        // Only the district's own clubs.
        var own = (await conn.QueryAsync<int>("SELECT pk_club_id FROM club_master WHERE fk_district_id = @D", new { D = districtId })).ToHashSet();
        var clubs = body.Clubs.Where(c => own.Contains(c.Id)).OrderBy(c => c.Name).ToList();
        if (clubs.Count == 0 || body.Items.Count == 0) return NotFound(new { message = "No clubs to report." });
        var qs = body.Items.Select(it => new GfQuestion(it.Category, it.Title, true, it.Number ? "number" : "text", it.TwoDecimals,
            it.Cells.Values.Any(c => c.Baseline != null))).ToList();
        var cells = new GfCell[qs.Count, clubs.Count];
        for (int i = 0; i < qs.Count; i++)
            for (int e = 0; e < clubs.Count; e++)
                cells[i, e] = body.Items[i].Cells.TryGetValue(clubs[e].Id, out var c) ? new GfCell(c.Goal, c.Achieved, c.Pct, 0, c.Baseline) : new GfCell(null, null, null, 0);
        var bytes = GoalFlowExcel.DistrictsDownOverview($"Disha Goals - Clubs of District {num}",
            $"Rotary Year {await YearLabelAsync(conn, y)}   ·   {clubs.Count} clubs   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            qs, clubs.Select(c => c.Name).ToList(), cells, "Club");
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Disha_Goals_Clubs_D{num}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // One district (DG, or the RI Director's district view): Auto section, then Manual section.
    [HttpGet("api/disha-awards/district/{districtId:int}/report")]
    public async Task<ActionResult> DistrictReport(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var lines = await LoadLinesAsync(conn, await OwnersOfDistrictAsync(conn, districtId, y), y);
        if (lines.Count == 0) return NotFound(new { message = "No Disha questions for this year yet." });
        var entries = await LoadEntriesAsync(conn, new[] { districtId }, y);
        var goals = await LoadGoalsAsync(conn, new[] { districtId }, y);
        var gs = await DishaGoalLinks.DistrictValuesAsync(conn, districtId, y);
        var cells = lines.Select(l =>
        {
            entries.TryGetValue((districtId, l.LineType, l.LineId), out var en);
            return ReportCell(l, goals.TryGetValue((districtId, l.LineType, l.LineId), out var g) ? g : null, en, gs);
        }).ToList();
        var num = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? "";
        var asOn = await RisaoFigures.AsOnAsync(conn, y, "District");
        var bytes = GoalFlowExcel.Single($"Disha Goals - District {num}",
            $"Rotary Year {await YearLabelAsync(conn, y)}{(asOn != null ? $"   ·   RISAO figures as on {asOn}" : "")}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            lines.Select(ReportQuestion).ToList(), cells, showPoints: false);   // Disha: no points (user 2026-11-20)
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Disha_Goals_D{num}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpPost("api/disha-awards/district/{districtId:int}/refresh-auto")]
    public async Task<ActionResult> RefreshDistrict(int districtId, [FromQuery] int? yearId)
    {
        // Super Admin / RI Director, or the district's own DG (user 2026-11-18); other goal roles view only.
        if (!_canManage && await _guard.DistrictYearlessAsync(User, districtId) is { } denied) return denied;
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var svc = HttpContext.RequestServices.GetRequiredService<CitationAutoPointsBackgroundService>();
        var n = await RefreshAutoAsync(conn, svc, new[] { districtId }, y, MemberId);
        return Ok(new { message = n == 0 ? "No auto questions." : "Auto answers refreshed." });
    }

    // RI Director: count the auto lines for all districts in scope (or one zone).
    [HttpPost("api/disha-awards/refresh-auto")]
    public async Task<ActionResult> RefreshAll([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await YearAsync(conn, yearId);
        var ds = (await MyScopeAsync(conn)).Where(d => !(zoneId > 0) || d.zoneId == zoneId).Select(d => d.id).ToList();
        var svc = HttpContext.RequestServices.GetRequiredService<CitationAutoPointsBackgroundService>();
        var n = await RefreshAutoAsync(conn, svc, ds, y, MemberId);
        return Ok(new { message = $"Auto answers refreshed for {ds.Count} districts ({n} answers)." });
    }

    // Same shape as DistrictModulesController.CitationAutoQuestionDto + "For every" (per_unit) and the category filter.
    public class DishaAutoQuestionDto
    {
        public int YearId { get; set; } public int CategoryId { get; set; } public int ActivityId { get; set; }
        public int Points { get; set; } public bool IsBonus { get; set; } public int BonusPoints { get; set; }
        public int MinBonus { get; set; } public int MaxBonus { get; set; } public int SortOrder { get; set; } public int PerUnit { get; set; } = 1;
        public List<DishaAutoSubItemDto> SubItems { get; set; } = new();
    }
    public class DishaAutoSubItemDto
    {
        public int Id { get; set; } public string SubItemType { get; set; } = ""; public int? SubItemId { get; set; } public string? SubItemName { get; set; }
        public int? FilterAofId { get; set; } public int? FilterCatId { get; set; } public int Points { get; set; } public bool IsBonus { get; set; }
        public int BonusPoints { get; set; } public int MinBonus { get; set; } public int MaxBonus { get; set; }
    }
}
