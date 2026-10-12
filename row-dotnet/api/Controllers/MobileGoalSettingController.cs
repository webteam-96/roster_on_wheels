using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

// Mobile twin for Goal Setting — same behaviour as the web GoalSettingController,
// reusing the same IGoalSettingService (no logic duplicated). Kept as a separate
// controller so the mobile auth/route prefix can evolve independently.
//
// SuperAdmin is web-portal-only (never authenticates on mobile), so the
// SuperAdmin-gated endpoints below (role assignment, foundation import/samples,
// member search, unscoped overview, add-designation, send-emails) are still
// present for full parity but will simply Forbid for any mobile token. The
// day-to-day surface used on mobile is: goal entry (club/district), the district
// admin's club list, the ZC zone list, the scoped oversight views + matrix, the
// lock/unlock actions, the leadership designation catalog (read), and messaging.
[ApiController]
[Route("api/mobile/goal-setting")]
[Authorize]
public class MobileGoalSettingController : ControllerBase
{
    private readonly IGoalSettingService _service;
    public MobileGoalSettingController(IGoalSettingService service) => _service = service;

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

    [HttpGet("categories")]
    public async Task<ActionResult<List<GoalCategoryDto>>> GetCategories()
        => Ok(await _service.GetCategoriesAsync());

    // The categories that HAVE a month-wise concept — Membership and TRF (user 2026-09-25).
    // Youth Service and Public Image are annual only: everything else about them is unchanged, but
    // they never appear on a month-wise screen or in a Month-wise report sheet. The app can either
    // call this for its month-wise tabs, or keep using "categories" and honour the new HasMonthWise
    // flag on each row — both give the same answer.
    [HttpGet("monthly/categories")]
    public async Task<ActionResult<List<GoalCategoryDto>>> GetMonthWiseCategories()
        => Ok((await _service.GetCategoriesAsync()).Where(c => c.HasMonthWise).ToList());


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

    // ── Month-wise collected values (mirror of web GoalSettingController monthly/*) ──
    // Current-month save lock for Club/District admins lives in the service, so it applies here too.
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

    [HttpPost("monthly/districts/{categoryId:int}")]
    public async Task<ActionResult<GoalMonthlyFormDto>> SaveDistrictMonthly(
        [FromRoute] int categoryId, [FromBody] SaveGoalMonthlyRequest request, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.SaveDistrictMonthlyGoalsAsync(GetMemberId(), categoryId, request, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Goal reports (.xlsx) — same builders + file names as web ──
    private const string XlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // Category-less goal Excel (all four categories, 2 sheets: Till Date + Month wise).
    [HttpGet("goals-excel/districts")]
    public async Task<ActionResult> GetDistrictGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var bytes = await _service.BuildDistrictMonthlyExcelAsync(GetMemberId(), 0, yearId, districtId);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"district-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("goals-excel/clubs")]
    public async Task<ActionResult> GetClubGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var bytes = await _service.BuildClubMonthlyExcelAsync(GetMemberId(), 0, yearId, clubId);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"club-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Every club in the district in one workbook (each club stacked under its own name band).
    [HttpGet("goals-excel/clubs-all")]
    public async Task<ActionResult> GetAllClubsGoalsExcel([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var bytes = await _service.BuildAllClubsMonthlyExcelAsync(GetMemberId(), yearId, districtId);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"all-clubs-goal-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("monthly/districts/{categoryId:int}/excel")]
    public async Task<ActionResult> GetDistrictMonthlyExcel(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var bytes = await _service.BuildDistrictMonthlyExcelAsync(GetMemberId(), categoryId, yearId, districtId);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"goals-monthly-district-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("monthly/clubs/{categoryId:int}/excel")]
    public async Task<ActionResult> GetClubMonthlyExcel(
        [FromRoute] int categoryId, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var bytes = await _service.BuildClubMonthlyExcelAsync(GetMemberId(), categoryId, yearId, clubId);
            if (bytes == null) return NotFound(new { message = "No data." });
            return File(bytes, XlsxMime, $"goals-monthly-club-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
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
        return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(WithoutSuggestionRows(r));
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
            return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(WithoutSuggestionRows(r));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // The overview grid is numbers only, so the 10 Public Image suggestion (text) slots came through as
    // 10 empty rows with the same label. Mobile only — the web district summary matrix builds its
    // "Suggestions" column from these same rows, so the shared service is left as it is.
    private static GoalOverviewMatrixDto WithoutSuggestionRows(GoalOverviewMatrixDto m)
    {
        m.Rows = m.Rows.Where(r => !string.Equals(r.GroupName, "Suggestions", StringComparison.OrdinalIgnoreCase)).ToList();
        return m;
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

    // Send the role-assigned email (with login) to EVERYONE currently in the active listing.
    // zoneId (optional) = same zone filter as the web listing: email ONLY that zone's people.
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
    // GET is open to any authenticated member; adding a new designation is SuperAdmin-only.
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

    // Global member search — the assign form picks the member first (before any zone).
    [HttpGet("search-members")]
    public async Task<ActionResult<List<GoalZoneMemberDto>>> SearchMembers([FromQuery] string? search)
    {
        if (!IsSuperAdminRole()) return Forbid();
        return Ok(await _service.SearchMembersAsync(search));
    }

    // ── Scoped oversight views — any authenticated member with an active assignment,
    //    or SuperAdmin. Not gated by IsAuthorisedRole(): assignees need not hold Admin. ──
    [HttpGet("my-assignments")]
    public async Task<ActionResult<List<GoalMyAssignmentDto>>> GetMyAssignments()
        => Ok(await _service.GetMyAssignmentsAsync(GetMemberId()));

    [HttpGet("scoped/districts/{categoryId:int}")]
    public async Task<ActionResult<List<GoalDistrictSummaryDto>>> GetScopedDistricts(
        [FromRoute] int categoryId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetScopedDistrictsGoalListAsync(GetMemberId(), categoryId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("scoped/districts/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCategoryFormDto>> GetScopedDistrictForm(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetScopedDistrictGoalFormAsync(GetMemberId(), categoryId, yearId, districtId)); }
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

    // ── Messaging (two-way; formerly "comments"). Optional clubId>0 selects the Club↔District thread. ──
    [HttpGet("comments/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetComments(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int clubId = 0)
    {
        try { return Ok(await _service.GetCommentsAsync(GetMemberId(), categoryId, districtId, clubId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("comments/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostComment(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromQuery] int clubId, [FromBody] PostGoalCommentRequest request)
    {
        try { return Ok(await _service.PostCommentAsync(GetMemberId(), categoryId, districtId, clubId, yearId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Pairwise oversight messaging (RI Director ↔ each DA / ZC), per (category, district, year) ──
    [HttpGet("threads/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalThreadListDto>> GetThreadList(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId)
        => Ok(await _service.GetGoalThreadListAsync(GetMemberId(), categoryId, districtId, yearId));

    [HttpGet("threads/{categoryId:int}/{districtId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetThreadMessages(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromRoute] int ownerMemberId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetGoalThreadMessagesAsync(GetMemberId(), categoryId, districtId, yearId, ownerMemberId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("threads/{categoryId:int}/{districtId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostThreadMessage(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromRoute] int ownerMemberId,
        [FromQuery] int yearId, [FromBody] PostGoalCommentRequest request)
    {
        try { return Ok(await _service.PostGoalThreadMessageAsync(GetMemberId(), categoryId, districtId, yearId, ownerMemberId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Zone-based messaging (RI Director dashboard): ZC + DA message boxes for one (category, zone) ──
    [HttpGet("zone-threads/{categoryId:int}/{zoneId:int}")]
    public async Task<ActionResult<GoalThreadListDto>> GetZoneThreadList(
        [FromRoute] int categoryId, [FromRoute] int zoneId, [FromQuery] int yearId, [FromQuery] string? act = null)
        => Ok(await _service.GetGoalZoneThreadListAsync(GetMemberId(), categoryId, zoneId, yearId, act));

    [HttpGet("owner-thread/{categoryId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<List<GoalCommentDto>>> GetOwnerThreadMessages(
        [FromRoute] int categoryId, [FromRoute] int ownerMemberId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetGoalOwnerThreadMessagesAsync(GetMemberId(), categoryId, yearId, ownerMemberId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("owner-thread/{categoryId:int}/{ownerMemberId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostOwnerThreadMessage(
        [FromRoute] int categoryId, [FromRoute] int ownerMemberId, [FromQuery] int yearId, [FromBody] PostGoalCommentRequest request)
    {
        try { return Ok(await _service.PostGoalOwnerThreadMessageAsync(GetMemberId(), categoryId, yearId, ownerMemberId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── Foundation benchmark import (SuperAdmin only, cumulative till-date) ───
    public class FoundationImportForm
    {
        public IFormFile? File { get; set; }
        public int YearId { get; set; }
    }

    public class FoundationClubImportForm
    {
        public IFormFile? File { get; set; }
        public int YearId { get; set; }
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
            return Ok(await _service.ImportFoundationMonthlyAsync(GetMemberId(), form.YearId, stream));
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
            return Ok(await _service.ImportFoundationClubAsync(GetMemberId(), form.YearId, stream));
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
