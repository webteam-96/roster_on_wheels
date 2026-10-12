using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/goal-setting")]
[Authorize]
public class GoalSettingController : ControllerBase
{
    private readonly IGoalSettingService _service;
    public GoalSettingController(IGoalSettingService service) => _service = service;

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    private bool IsAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin");
    }

    private bool IsSuperAdminRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin");
    }

    // Zonal Coordinators (or SuperAdmin borrowing a zone) may view/edit/lock the goals
    // of districts in their zone. The service enforces the actual zone scoping.
    private bool IsZoneAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("ZonalCoordinator") || roles.Contains("SuperAdmin");
    }

    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    // "View as" for the single gated observer SuperAdmin: when asMemberId is
    // supplied AND the caller is a SuperAdmin who IS the observer account, act as that member so the
    // observer can read/observe an RI Director / ZC / DA's oversight + messaging. Everyone else — and
    // any crafted asMemberId — falls back to the real caller. The service re-verifies the observer.
    private async Task<int> EffectiveMemberIdAsync(int? asMemberId)
    {
        var me = GetMemberId();
        if (asMemberId is > 0 && IsSuperAdminRole() && await _service.IsGoalObserverAsync(me))
            return asMemberId.Value;
        return me;
    }

    // The "Observe as" picker list (RI Directors + Zone Co-ordinators). Empty unless caller is the observer.
    [HttpGet("observer/role-list")]
    public async Task<ActionResult<List<GoalObserverRoleDto>>> GetObserverRoleList()
    {
        if (!IsSuperAdminRole()) return Forbid();
        return Ok(await _service.GetObserverRoleListAsync(GetMemberId()));
    }

    // A District Assistant login is shown only the goal category they are appointed for; every other
    // caller — Zone Co-ordinator, SuperAdmin, RI Director, Club / District Admin — gets the full list.
    [HttpGet("categories")]
    public async Task<ActionResult<List<GoalCategoryDto>>> GetCategories([FromQuery] int? asMemberId = null)
        => Ok(await _service.GetCategoriesAsync(await EffectiveMemberIdAsync(asMemberId)));

    // The same list for the GOAL-OVERSIGHT screens (user 2026-09-25). A District Assistant gets only
    // their appointed category here even when they are ALSO a Club / District Admin — on those screens
    // they are the District Assistant. The plain "categories" endpoint above is unchanged, so their own
    // club / district goal panel still offers every category.
    [HttpGet("oversight-categories")]
    public async Task<ActionResult<List<GoalCategoryDto>>> GetOversightCategories([FromQuery] int? asMemberId = null)
        => Ok(await _service.GetOversightCategoriesAsync(await EffectiveMemberIdAsync(asMemberId)));


    // ── Quarterly / month-wise TARGET split (user 2026-09-25) ───────────────────────────────────
    // The YEARLY target is never sent here and never changes. These save the split of it; the API
    // refuses a split that does not add up to the yearly target exactly, naming the metric and the
    // difference. Period = "month" (12 values, 7..6) or "quarter" (4 values, 1..4).
    [HttpPost("targets/split/districts/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> SaveDistrictTargetSplit(
        [FromRoute] int categoryId, [FromBody] SaveGoalTargetSplitRequest request, [FromQuery] int? districtId = null)
    {
        try { return Ok(await _service.SaveDistrictTargetSplitAsync(GetMemberId(), categoryId, request, districtId)); }
        catch (UnauthorizedAccessException ex) { return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("targets/split/clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> SaveClubTargetSplit(
        [FromRoute] int categoryId, [FromBody] SaveGoalTargetSplitRequest request, [FromQuery] int? clubId = null)
    {
        try { return Ok(await _service.SaveClubTargetSplitAsync(GetMemberId(), categoryId, request, clubId)); }
        catch (UnauthorizedAccessException ex) { return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Club goal entry ──────────────────────────────────────────────────
    [HttpGet("clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetClubGoalForm(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetClubGoalFormAsync(GetMemberId(), categoryId, yearId, clubId);
            return r == null ? NotFound(new { message = "No club admin assignment found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> SaveClubGoalForm(
        [FromRoute] int categoryId, [FromBody] SaveGoalEntriesRequest request, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.SaveClubGoalFormAsync(GetMemberId(), categoryId, request, clubId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Month-wise collected values (additive; separate from the annual entry above) ──
    [HttpGet("monthly/clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> GetClubMonthly(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetClubMonthlyGoalFormAsync(GetMemberId(), categoryId, yearId, clubId);
            return r == null ? NotFound(new { message = "No club admin assignment found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("monthly/clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> SaveClubMonthly(
        [FromRoute] int categoryId, [FromBody] SaveGoalMonthlyRequest request, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SaveClubMonthlyGoalsAsync(GetMemberId(), categoryId, request, clubId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    private const string XlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // Category-less goal Excel (all four categories, 2 sheets: Till Date + Month wise) — for the report modules.
    [HttpGet("goals-excel/districts")]
    public async Task<ActionResult> GetDistrictGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var bytes = await _service.BuildDistrictMonthlyExcelAsync(GetMemberId(), 0, yearId, districtId);
        if (bytes == null) return NotFound(new { message = "No data." });
        return File(bytes, XlsxMime, $"district-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpGet("goals-excel/clubs")]
    public async Task<ActionResult> GetClubGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var bytes = await _service.BuildClubMonthlyExcelAsync(GetMemberId(), 0, yearId, clubId);
        if (bytes == null) return NotFound(new { message = "No data." });
        return File(bytes, XlsxMime, $"club-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // "Club Goal Setting → All" — every club in the district in one workbook (2 sheets, each club
    // stacked under its own name band). Distinct from the district's OWN goals (goals-excel/districts).
    [HttpGet("goals-excel/clubs-all")]
    public async Task<ActionResult> GetAllClubsGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var bytes = await _service.BuildAllClubsMonthlyExcelAsync(GetMemberId(), yearId, districtId);
        if (bytes == null) return NotFound(new { message = "No data." });
        return File(bytes, XlsxMime, $"all-clubs-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpGet("monthly/districts/{categoryId:int}/excel")]
    public async Task<ActionResult> GetDistrictMonthlyExcel(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var bytes = await _service.BuildDistrictMonthlyExcelAsync(GetMemberId(), categoryId, yearId, districtId);
        if (bytes == null) return NotFound(new { message = "No data." });
        return File(bytes, XlsxMime, $"goals-monthly-district-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpGet("monthly/clubs/{categoryId:int}/excel")]
    public async Task<ActionResult> GetClubMonthlyExcel(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var bytes = await _service.BuildClubMonthlyExcelAsync(GetMemberId(), categoryId, yearId, clubId);
        if (bytes == null) return NotFound(new { message = "No data." });
        return File(bytes, XlsxMime, $"goals-monthly-club-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpGet("monthly/districts/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> GetDistrictMonthly(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDistrictMonthlyGoalFormAsync(GetMemberId(), categoryId, yearId, districtId);
            return r == null ? NotFound(new { message = "No district admin assignment found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Goal-oversight read-only month-wise: any district in the caller's goal scope (honours observer view-as).
    [HttpGet("monthly/districts/{categoryId:int}/oversight")]
    public async Task<ActionResult<GoalMonthlyFormDto>> GetDistrictMonthlyOversight(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        // No role gate (user 2026-09-21): judged by SCOPE like the other oversight endpoints — the old
        // Admin/SuperAdmin check hid month-wise from RI Director / ZC / DA, whose claim is not "Admin".
        try
        {
            var r = await _service.GetDistrictMonthlyGoalFormScopedAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, districtId);
            return r == null ? NotFound(new { message = "No month-wise data for this district." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("monthly/districts/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> SaveDistrictMonthly(
        [FromRoute] int categoryId, [FromBody] SaveGoalMonthlyRequest request, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SaveDistrictMonthlyGoalsAsync(GetMemberId(), categoryId, request, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── District's own goal entry ────────────────────────────────────────
    [HttpGet("districts/{categoryId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetDistrictGoalForm(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDistrictGoalFormAsync(GetMemberId(), categoryId, yearId, districtId);
            return r == null ? NotFound(new { message = "No district admin assignment found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("districts/{categoryId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> SaveDistrictGoalForm(
        [FromRoute] int categoryId, [FromBody] SaveGoalEntriesRequest request, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.SaveDistrictGoalFormAsync(GetMemberId(), categoryId, request, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── District Admin's "all my clubs" overview ─────────────────────────
    [HttpGet("districts/{categoryId:int}/clubs")]
    public async Task<ActionResult<List<GoalClubSummaryDto>>> GetDistrictClubsGoalList(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.GetDistrictClubsGoalListAsync(GetMemberId(), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── District Admin's read-only "View club goals" matrix (all clubs × one category's fields + RAG) ──
    [HttpGet("districts/{categoryId:int}/clubs-matrix")]
    public async Task<ActionResult<GoalClubMatrixDto>> GetDistrictClubsGoalMatrix(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.GetDistrictClubsGoalMatrixAsync(GetMemberId(), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── District Admin's read-only month-wise matrix (all clubs × months for one category's metrics) ──
    [HttpGet("districts/{categoryId:int}/clubs-monthly-matrix")]
    public async Task<ActionResult<GoalClubMonthlyMatrixDto>> GetDistrictClubsMonthlyMatrix(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.GetDistrictClubsMonthlyMatrixAsync(GetMemberId(), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal-oversight "View clubs" popup: the all-clubs "Club Goal Setting" Excel report for any
    //    district in the caller's goal scope (honours observer view-as). ──
    // NO role gate on these three: the caller is judged by SCOPE, not by role name. The old
    // Admin/SuperAdmin gate refused an RI Director (roles claim "RIDirector"), so "View clubs" failed
    // for the very logins these endpoints were written for (user 2026-09-21). Each service call still
    // throws "This district is outside your goal-setting scope" for anyone who does not hold it.
    [HttpGet("goals-excel/clubs-all/oversight")]
    public async Task<ActionResult> GetScopedAllClubsGoalsExcel([FromQuery] int districtId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try
        {
            var bytes = await _service.BuildAllClubsMonthlyExcelScopedAsync(await EffectiveMemberIdAsync(asMemberId), yearId, districtId);
            return bytes == null ? NotFound(new { message = "No club goal data for this district." })
                : File(bytes, XlsxMime, $"Club_Goal_Setting_D{districtId}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal-oversight "Club Goal Setting" popup: clubs matrix for ANY district in the caller's goal
    //    scope (RI Director / ZC / DA / observer / SuperAdmin), honouring observer view-as. ──
    [HttpGet("districts/{categoryId:int}/clubs-matrix/oversight")]
    public async Task<ActionResult<GoalClubMatrixDto>> GetScopedDistrictClubsGoalMatrix(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try
        {
            return Ok(await _service.GetScopedDistrictClubsGoalMatrixAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("districts/{categoryId:int}/clubs-monthly-matrix/oversight")]
    public async Task<ActionResult<GoalClubMonthlyMatrixDto>> GetScopedDistrictClubsMonthlyMatrix(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try
        {
            return Ok(await _service.GetScopedDistrictClubsMonthlyMatrixAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Zonal Coordinator: districts of my zone (mirror of District Admin's clubs) ──
    [HttpGet("zone/districts/{categoryId:int}")]
    public async Task<ActionResult<List<GoalDistrictSummaryDto>>> GetZoneDistricts(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int? zoneId = null)
    {
        if (!IsZoneAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.GetZoneDistrictsGoalListAsync(GetMemberId(), categoryId, yearId, zoneId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("zone/districts/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetZoneDistrictForm(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int? yearId = null)
    {
        if (!IsZoneAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDistrictGoalFormAsync(GetMemberId(), categoryId, yearId, districtId);
            return r == null ? NotFound(new { message = "District goals not found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("zone/districts/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> SaveZoneDistrictForm(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromBody] SaveGoalEntriesRequest request)
    {
        if (!IsZoneAuthorisedRole()) return Forbid();
        try
        {
            return Ok(await _service.SaveDistrictGoalFormAsync(GetMemberId(), categoryId, request, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("zone/districts/{categoryId:int}/{districtId:int}/lock")]
    public async Task<ActionResult<GoalLockStatusDto>> LockZoneDistrictGoals(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId)
    {
        if (!IsZoneAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetDistrictLockAsync(GetMemberId(), categoryId, yearId, districtId, true)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("zone/districts/{categoryId:int}/{districtId:int}/unlock")]
    public async Task<ActionResult<GoalLockStatusDto>> UnlockZoneDistrictGoals(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId)
    {
        if (!IsZoneAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetDistrictLockAsync(GetMemberId(), categoryId, yearId, districtId, false)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── SuperAdmin read-only Overview matrix (one zone × one category × one year) ──
    [HttpGet("overview")]
    public async Task<ActionResult<GoalOverviewMatrixDto>> GetOverview(
        [FromQuery] int zoneId, [FromQuery] int categoryId, [FromQuery] int? yearId = null)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var r = await _service.GetOverviewMatrixAsync(zoneId, categoryId, yearId);
        return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(r);
    }

    // ── Role-scoped Overview matrix — for a goal oversight role (RI Director / ZC / DA) on a zone
    //    they cover. Same grid as /overview, scope enforced in the service. ──
    [HttpGet("overview-scoped")]
    public async Task<ActionResult<GoalOverviewMatrixDto>> GetScopedOverview(
        [FromQuery] int zoneId, [FromQuery] int categoryId, [FromQuery] int? yearId = null)
    {
        try
        {
            var r = await _service.GetScopedOverviewMatrixAsync(GetMemberId(), zoneId, categoryId, yearId);
            return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal-oversight dashboard: districts = rows, compact Target/Achieved/% per overseen category ──
    [HttpGet("district-summary-matrix")]
    public async Task<ActionResult<GoalDistrictSummaryMatrixDto>> GetDistrictSummaryMatrix(
        [FromQuery] int zoneId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetScopedDistrictSummaryMatrixAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Locking ───────────────────────────────────────────────────────────
    [HttpPost("clubs/{categoryId:int}/lock")]
    public async Task<ActionResult<GoalLockStatusDto>> LockClubGoals(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int clubId)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetClubLockAsync(GetMemberId(), categoryId, yearId, clubId, true)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("clubs/{categoryId:int}/unlock")]
    public async Task<ActionResult<GoalLockStatusDto>> UnlockClubGoals(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int clubId)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetClubLockAsync(GetMemberId(), categoryId, yearId, clubId, false)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("districts/{categoryId:int}/lock")]
    public async Task<ActionResult<GoalLockStatusDto>> LockDistrictGoals(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int districtId)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetDistrictLockAsync(GetMemberId(), categoryId, yearId, districtId, true)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("districts/{categoryId:int}/unlock")]
    public async Task<ActionResult<GoalLockStatusDto>> UnlockDistrictGoals(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int districtId)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SetDistrictLockAsync(GetMemberId(), categoryId, yearId, districtId, false)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Specialized oversight roles (SuperAdmin manages assignments) ────────
    [HttpGet("role-assignments")]
    public async Task<ActionResult<List<GoalRoleAssignmentDto>>> GetRoleAssignments()
    {
        if (!IsSuperAdminRole()) return Forbid();
        return Ok(await _service.GetRoleAssignmentsAsync());
    }

    [HttpPost("role-assignments")]
    public async Task<ActionResult<GoalRoleAssignmentDto>> CreateRoleAssignment([FromBody] CreateGoalRoleAssignmentRequest request)
    {
        if (!IsSuperAdminRole()) return Forbid();
        try { return Ok(await _service.CreateRoleAssignmentAsync(GetMemberId(), request)); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("role-assignments/{assignmentId:int}")]
    public async Task<ActionResult> RevokeRoleAssignment([FromRoute] int assignmentId)
    {
        if (!IsSuperAdminRole()) return Forbid();
        await _service.RevokeRoleAssignmentAsync(assignmentId, GetMemberId());
        return Ok(new { message = "Assignment revoked." });
    }

    // ADD another holder to this assignment ("+" beside a name): the new person inherits the same
    // role type, avenue/category, zone(s) and districts. Silent — no email is sent.
    [HttpPost("role-assignments/{assignmentId:int}/add-holder")]
    public async Task<ActionResult> AddRoleAssignmentHolder([FromRoute] int assignmentId, [FromBody] AddGoalRoleHolderRequest request)
    {
        if (!IsSuperAdminRole()) return Forbid();
        try
        {
            var newId = await _service.AddRoleAssignmentHolderAsync(assignmentId, request, GetMemberId());
            return Ok(new { id = newId, message = "Holder added." });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // REPLACE the holder (and RI-Director zones / District-Assistant districts) without revoking —
    // preserves the hierarchy below; no email.
    [HttpPut("role-assignments/{assignmentId:int}")]
    public async Task<ActionResult> ChangeRoleAssignment([FromRoute] int assignmentId, [FromBody] ChangeGoalRoleAssignmentRequest request)
    {
        if (!IsSuperAdminRole()) return Forbid();
        try { await _service.ChangeRoleAssignmentAsync(assignmentId, request, GetMemberId()); return Ok(new { message = "Assignment updated." }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Send the login/credentials email to the single member on this assignment (on-demand, from the row).
    [HttpPost("role-assignments/{assignmentId:int}/send-credentials")]
    public async Task<ActionResult> SendRoleCredentials([FromRoute] int assignmentId)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var sent = await _service.SendCredentialsEmailAsync(assignmentId, GetMemberId());
        return Ok(new { sent, message = sent > 0 ? "Credentials email sent." : "No email address on file for this member." });
    }

    // Zone ids already held by an active RI Director — the assign/change form hides these. When editing,
    // pass excludeAssignmentId so that assignment's own zones stay selectable.
    [HttpGet("role-assignments/assigned-zones")]
    public async Task<ActionResult<List<int>>> GetAssignedDirectorZones([FromQuery] int? excludeAssignmentId = null)
    {
        if (!IsSuperAdminRole()) return Forbid();
        return Ok(await _service.GetAssignedDirectorZoneIdsAsync(excludeAssignmentId));
    }

    // Excel of the Role Assign listing - zone, assigned districts, the holder's own club and
    // district, name, mobile number and email id. zoneId mirrors the screen's "Filter by zone":
    // omitted = every zone, zone 4 = only that zone's RI Director / ZCs / DAs (user 2026-10-05).
    [HttpGet("role-assignments/export")]
    public async Task<ActionResult> ExportRoleAssignments([FromQuery] int? zoneId = null)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var bytes = await _service.BuildRoleAssignmentsExcelAsync(zoneId);
        var scope = zoneId is > 0 ? $"Zone{zoneId}" : "AllZones";
        return File(bytes, XlsxMime, $"Goal_Role_Assignments_{scope}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    // Send the role-assigned email (with login) to EVERYONE currently in the active listing.
    // Assignment itself no longer emails — the SuperAdmin clicks this once the list looks right.
    // zoneId (optional) = the zone picked in the listing filter → email ONLY that zone's RI Director,
    // Zone Co-ordinators and District Assistants, never the whole list (2026-09-16 request).
    [HttpPost("role-assignments/send-emails")]
    public async Task<ActionResult> SendRoleAssignmentEmails([FromQuery] int? zoneId = null)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var count = await _service.SendAllRoleAssignmentEmailsAsync(GetMemberId(), zoneId);
        return Ok(new { sent = count, message = count > 0
            ? $"Role-assigned email sent to {count} member(s)."
            : "No members with an email address to notify." });
    }

    // ── Leadership designation catalog (RMC / ARC / RPIC …) ────────────────────
    // GET is open to any authenticated member (the assign form and, later, read-only
    // hierarchy views use it); adding a new designation is SuperAdmin-only.
    [HttpGet("designations")]
    public async Task<ActionResult<List<GoalDesignationDto>>> GetDesignations()
        => Ok(await _service.GetDesignationsAsync());

    [HttpPost("designations")]
    public async Task<ActionResult<GoalDesignationDto>> AddDesignation([FromBody] CreateGoalDesignationRequest request)
    {
        if (!IsSuperAdminRole()) return Forbid();
        try { return Ok(await _service.AddDesignationAsync(request)); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Zone-scoped member search — the assign form only searches members inside the selected zone(s).
    [HttpGet("zone-members")]
    public async Task<ActionResult<List<GoalZoneMemberDto>>> SearchZoneMembers([FromQuery] string zoneIds, [FromQuery] string? search)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var ids = (zoneIds ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => int.TryParse(s.Trim(), out var n) ? n : 0)
            .Where(n => n > 0).ToArray();
        return Ok(await _service.SearchZoneMembersAsync(ids, search));
    }

    // Global member search — the assign form now picks the member first (before any zone).
    [HttpGet("search-members")]
    public async Task<ActionResult<List<GoalZoneMemberDto>>> SearchMembers([FromQuery] string? search)
    {
        if (!IsSuperAdminRole()) return Forbid();
        return Ok(await _service.SearchMembersAsync(search));
    }

    // ── Scoped oversight views — any authenticated member with an active assignment,
    //    or SuperAdmin. Not gated by IsAuthorisedRole(): assignees need not hold Admin. ──
    [HttpGet("my-assignments")]
    public async Task<ActionResult<List<GoalMyAssignmentDto>>> GetMyAssignments([FromQuery] int? asMemberId = null)
        => Ok(await _service.GetMyAssignmentsAsync(await EffectiveMemberIdAsync(asMemberId)));

    [HttpGet("scoped/districts/{categoryId:int}")]
    public async Task<ActionResult<List<GoalDistrictSummaryDto>>> GetScopedDistricts(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetScopedDistrictsGoalListAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("scoped/districts/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetScopedDistrictForm(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetScopedDistrictGoalFormAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("scoped/bulk-lock")]
    public async Task<ActionResult<GoalBulkLockResultDto>> BulkLockDistricts([FromBody] GoalBulkLockRequest request)
    {
        try { return Ok(await _service.BulkLockDistrictsAsync(GetMemberId(), request)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Scoped CLUB drill-down (role logins): a district's clubs + one club's read-only goal form.
    [HttpGet("scoped/districts/{categoryId:int}/clubs")]
    public async Task<ActionResult<List<GoalClubSummaryDto>>> GetScopedDistrictClubs(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int districtId, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetScopedDistrictClubsGoalListAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("scoped/clubs/{categoryId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetScopedClubForm(
        [FromRoute] int categoryId, [FromQuery] int yearId, [FromQuery] int clubId, [FromQuery] int? asMemberId = null)
    {
        try
        {
            var r = await _service.GetScopedClubGoalFormAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, clubId);
            return r == null ? NotFound(new { message = "No club goals found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── District oversight report (districts × categories horizontal, YTD + Month-wise), scoped to
    //    selection: districtId → that district; else zoneId → that zone's districts; else all my districts. ──
    [HttpGet("district-report")]
    public async Task<ActionResult> GetGoalDistrictReport([FromQuery] int? zoneId = null, [FromQuery] int? districtId = null, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try
        {
            var bytes = await _service.BuildGoalDistrictReportExcelAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, districtId, yearId);
            return bytes == null ? NotFound(new { message = "No goal data to report for this selection." })
                : File(bytes, XlsxMime, $"goal-district-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal-oversight per-district download: the EXACT district-admin "District Goal Setting" workbook
    //    (YTD + Month-wise, vertical), scope-validated against the caller's goal assignments / SuperAdmin. ──
    [HttpGet("district-report/{districtId:int}")]
    public async Task<ActionResult> GetGoalDistrictSettingReport(int districtId, [FromQuery] int? yearId = null, [FromQuery] int? asMemberId = null)
    {
        try
        {
            var bytes = await _service.BuildDistrictGoalSettingReportScopedAsync(await EffectiveMemberIdAsync(asMemberId), districtId, yearId);
            return bytes == null ? NotFound(new { message = "No goal data to report for this district." })
                : File(bytes, XlsxMime, $"District_Goal_Setting_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Attractive goal reports (scope-enforced in the service; role logins + SuperAdmin) ──
    [HttpGet("report/zone/{zoneId:int}")]
    public async Task<ActionResult> GetZoneGoalReport([FromRoute] int zoneId, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildZoneGoalReportAsync(GetMemberId(), zoneId, yearId);
            return bytes == null ? NotFound(new { message = "No data." })
                : File(bytes, XlsxMime, $"goal-zone-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("report/district/{districtId:int}")]
    public async Task<ActionResult> GetDistrictGoalReport([FromRoute] int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildDistrictGoalReportAsync(GetMemberId(), districtId, yearId);
            return bytes == null ? NotFound(new { message = "No data." })
                : File(bytes, XlsxMime, $"goal-district-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("report/club/{clubId:int}")]
    public async Task<ActionResult> GetClubGoalReport([FromRoute] int clubId, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildClubGoalReportAsync(GetMemberId(), clubId, yearId);
            return bytes == null ? NotFound(new { message = "No data." })
                : File(bytes, XlsxMime, $"goal-club-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Messaging (two-way; formerly "comments") — same "any authenticated member with
    //    visibility" gate. Optional clubId>0 selects the Club↔District thread. ────
    [HttpGet("comments/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetComments(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int clubId = 0, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetCommentsAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, districtId, clubId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("comments/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostComment(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int clubId, [FromBody] PostGoalCommentRequest request, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.PostCommentAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, districtId, clubId, yearId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Pairwise oversight messaging (RI Director ↔ each DA / ZC), per (category, district, year) ──
    [HttpGet("threads/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalThreadListDto>> GetThreadList(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
        => Ok(await _service.GetGoalThreadListAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, districtId, yearId));

    [HttpGet("threads/{categoryId:int}/{districtId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetThreadMessages(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromRoute] int ownerMemberId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetGoalThreadMessagesAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, districtId, yearId, ownerMemberId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("threads/{categoryId:int}/{districtId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostThreadMessage(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromRoute] int ownerMemberId,
        [FromQuery] int yearId, [FromBody] PostGoalCommentRequest request, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.PostGoalThreadMessageAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, districtId, yearId, ownerMemberId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Zone-based messaging (RI Director dashboard): ZC + DA message boxes for one (category, zone) ──
    // Red "new message" dot for the RI Messages popup (per zone+year), and marking them seen on open.
    [HttpGet("messages/has-unread")]
    public async Task<ActionResult<object>> GetHasUnreadMessages([FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
        => Ok(new { hasUnread = await _service.HasUnreadZoneMessagesAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId) });

    [HttpPost("messages/mark-seen")]
    public async Task<ActionResult> MarkMessagesSeen([FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
    {
        await _service.MarkZoneMessagesSeenAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId);
        return Ok(new { ok = true });
    }

    [HttpGet("zone-threads/{categoryId:int}/{zoneId:int}")]
    public async Task<ActionResult<GoalThreadListDto>> GetZoneThreadList(
        [FromRoute] int categoryId, [FromRoute] int zoneId, [FromQuery] int yearId, [FromQuery] string? act = null, [FromQuery] int? asMemberId = null, [FromQuery] int? districtId = null)
        => Ok(await _service.GetGoalZoneThreadListAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, zoneId, yearId, act, districtId));

    [HttpGet("owner-thread/{categoryId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetOwnerThreadMessages(
        [FromRoute] int categoryId, [FromRoute] int ownerMemberId, [FromQuery] int yearId, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetGoalOwnerThreadMessagesAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, ownerMemberId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("owner-thread/{categoryId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostOwnerThreadMessage(
        [FromRoute] int categoryId, [FromRoute] int ownerMemberId, [FromQuery] int yearId, [FromBody] PostGoalCommentRequest request, [FromQuery] int? asMemberId = null, [FromQuery] int districtId = 0)
    {
        try { return Ok(await _service.PostGoalOwnerThreadMessageAsync(await EffectiveMemberIdAsync(asMemberId), categoryId, yearId, ownerMemberId, request.CommentText, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── On-screen unified messages list (RI popup): all messages in a zone, filterable by category
    //    (0=all) + district (0=all). RI Director / ZC / SuperAdmin; honours observer view-as. ──
    [HttpGet("messages/list")]
    public async Task<ActionResult<List<GoalMessageRowDto>>> GetGoalMessagesList(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetGoalMessagesListAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId, categoryId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Roster of ZC/DA in the zone (with message counts) — for the "no messages yet" state in the popup.
    [HttpGet("messages/roster")]
    public async Task<ActionResult<List<GoalMessageOwnerDto>>> GetGoalMessageRoster(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0, [FromQuery] int? asMemberId = null)
    {
        try { return Ok(await _service.GetGoalMessageRosterAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId, categoryId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal messages report (Excel): every message in a zone, filterable by category (0=all) +
    //    district (0=all). RI Director / ZC / SuperAdmin; honours observer view-as. ──
    [HttpGet("messages/report")]
    public async Task<ActionResult> GetGoalMessagesReport(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0, [FromQuery] int? asMemberId = null)
    {
        try
        {
            var bytes = await _service.BuildGoalMessagesReportExcelAsync(await EffectiveMemberIdAsync(asMemberId), zoneId, yearId, categoryId, districtId);
            return bytes == null ? NotFound(new { message = "No messages to report for this selection." })
                : File(bytes, XlsxMime, $"Goal_Messages_Z{zoneId}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Foundation benchmark import (SuperAdmin only, cumulative till-date) ───
    // The 9 Foundation "Reference" fields are populated by a SuperAdmin Excel import, NOT
    // typed by district admins. One master Excel, one row per district (by DistrictNumber),
    // carrying the cumulative till-date figure. SA picks the year; values overwrite the
    // stored goal_entries value per (district, field, year).
    public class FoundationImportForm
    {
        public IFormFile? File { get; set; }
        public int YearId { get; set; }
        public int Month { get; set; }   // 0 = annual only; 1..12 = also snapshot into that month
    }

    public class FoundationClubImportForm
    {
        public IFormFile? File { get; set; }
        public int YearId { get; set; }
        public int Month { get; set; }
    }

    [HttpPost("foundation-import")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult<GoalFoundationImportResultDto>> ImportFoundationMonthly([FromForm] FoundationImportForm form)
    {
        if (!IsSuperAdminRole()) return Forbid();
        if (form.File == null || form.File.Length == 0)
            return BadRequest(new { message = "No file uploaded." });
        try
        {
            using var stream = form.File.OpenReadStream();
            return Ok(await _service.ImportFoundationMonthlyAsync(GetMemberId(), form.YearId, stream, form.Month));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to read the Excel file: {ex.Message}" }); }
    }

    // Club Foundation import — reads EVERY district's clubs from one Rotary MCR Excel (SuperAdmin only).
    [HttpPost("foundation-import/club")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult<GoalFoundationImportResultDto>> ImportFoundationClub([FromForm] FoundationClubImportForm form)
    {
        if (!IsSuperAdminRole()) return Forbid();
        if (form.File == null || form.File.Length == 0)
            return BadRequest(new { message = "No file uploaded." });
        try
        {
            using var stream = form.File.OpenReadStream();
            return Ok(await _service.ImportFoundationClubAsync(GetMemberId(), form.YearId, stream, form.Month));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to read the Excel file: {ex.Message}" }); }
    }

    [HttpGet("foundation-import/sample")]
    public async Task<ActionResult> DownloadFoundationSample()
    {
        if (!IsSuperAdminRole()) return Forbid();
        var bytes = await _service.BuildFoundationSampleExcelAsync();
        var ts = DateTime.Now.ToString("ddMMyyyy_HHmmss");
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"foundation_district_sample_{ts}.xlsx");
    }

    // Rotary.org MCR -> our club import file (synced clubs only, 2 decimals). Returns the file to
    // download; nothing is imported. SuperAdmin only.
    [HttpPost("foundation-import/club/convert")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult> ConvertFoundationClubFile([FromForm] IFormFile file)
    {
        if (!IsSuperAdminRole()) return Forbid();
        if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });
        try
        {
            using var stream = file.OpenReadStream();
            var (bytes, filled, missing) = await _service.ConvertFoundationMcrToClubFileAsync(stream);
            Response.Headers["X-Clubs-Filled"] = filled.ToString();
            Response.Headers["X-Clubs-Missing"] = missing.ToString();
            Response.Headers["Access-Control-Expose-Headers"] = "X-Clubs-Filled, X-Clubs-Missing, Content-Disposition";
            var ts = DateTime.Now.ToString("ddMMyyyy_HHmmss");
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"foundation_club_import_{ts}.xlsx");
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to read the Excel file: {ex.Message}" }); }
    }

    // Club Foundation sample — MCR layout, one row per current synced club, 0 baseline (SuperAdmin only).
    [HttpGet("foundation-import/club/sample")]
    public async Task<ActionResult> DownloadFoundationClubSample()
    {
        if (!IsSuperAdminRole()) return Forbid();
        var bytes = await _service.BuildFoundationClubSampleExcelAsync();
        var ts = DateTime.Now.ToString("ddMMyyyy_HHmmss");
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"foundation_club_sample_{ts}.xlsx");
    }
}
