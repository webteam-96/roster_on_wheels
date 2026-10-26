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
// SuperAdmin-gated endpoints below (foundation import/samples, unscoped overview)
// are still present for full parity but will simply Forbid for any mobile token.
// The day-to-day surface used on mobile is: goal entry (club/district), the
// district admin's club list, and messaging.
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

    // ── SuperAdmin read-only Overview matrix (one zone × one category × one year) ──
    [HttpGet("overview")]
    public async Task<ActionResult<GoalOverviewMatrixDto>> GetOverview(
        [FromQuery] int zoneId, [FromQuery] int categoryId, [FromQuery] int? yearId = null)
    {
        if (!IsSuperAdminRole()) return Forbid();
        var r = await _service.GetOverviewMatrixAsync(zoneId, categoryId, yearId);
        return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(WithoutYouthPct(WithoutSuggestionRows(r)));
    }

    // The overview grid is numbers only, so the 10 Public Image suggestion (text) slots came through as
    // 10 empty rows with the same label. Mobile only — the web district summary matrix builds its
    // "Suggestions" column from these same rows, so the shared service is left as it is.
    private static GoalOverviewMatrixDto WithoutSuggestionRows(GoalOverviewMatrixDto m)
    {
        m.Rows = m.Rows.Where(r => !string.Equals(r.GroupName, "Suggestions", StringComparison.OrdinalIgnoreCase)).ToList();
        return m;
    }

    // Youth Service: no Achievement(%) rows in the overview (user 2026-10-09) - same as the web Goal
    // Overview grid. The District Admin's own form keeps them.
    private static GoalOverviewMatrixDto WithoutYouthPct(GoalOverviewMatrixDto m)
    {
        if (string.Equals(m.CategoryName, "Youth Service", StringComparison.OrdinalIgnoreCase))
            m.Rows = m.Rows.Where(r => r.DataType != "Percentage").ToList();
        return m;
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

    // ── District Admin / District Governor messages (user 2026-10-09), same as web ──
    // The district side writes about one category; the SuperAdmin reads (no replies). GET marks the
    // conversation read for readers.
    [HttpGet("district-messages/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalDistrictMessagesDto>> GetDistrictMessages(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetDistrictMessagesAsync(GetMemberId(), categoryId, districtId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("district-messages/{categoryId:int}/{districtId:int}")]
    public async Task<ActionResult<GoalCommentDto>> PostDistrictMessage(
        [FromRoute] int categoryId, [FromRoute] int districtId, [FromQuery] int yearId, [FromBody] PostGoalCommentRequest request)
    {
        try { return Ok(await _service.PostDistrictMessageAsync(GetMemberId(), categoryId, districtId, yearId, request.CommentText)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Readers' inbox: every District Admin / DG conversation the caller may read in a zone.
    [HttpGet("district-messages/inbox")]
    public async Task<ActionResult<List<GoalDistrictConversationDto>>> GetDistrictMessageInbox(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0)
        => Ok(await _service.GetDistrictMessageInboxAsync(GetMemberId(), zoneId, yearId, categoryId, districtId));

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
        catch (Exception) { return BadRequest(new { message = "Failed to read the Excel file. Check that it is a valid .xlsx file." }); }
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
        catch (Exception) { return BadRequest(new { message = "Failed to read the Excel file. Check that it is a valid .xlsx file." }); }
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
