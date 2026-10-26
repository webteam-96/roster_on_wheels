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

    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    // Every caller gets every goal category.
    [HttpGet("categories")]
    public async Task<ActionResult<List<GoalCategoryDto>>> GetCategories()
        => Ok(await _service.GetCategoriesAsync());

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

    // Goal Overview read-only month-wise: any district (SuperAdmin only, checked in the service).
    [HttpGet("monthly/districts/{categoryId:int}/oversight")]
    public async Task<ActionResult<GoalMonthlyFormDto>> GetDistrictMonthlyOversight(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            var r = await _service.GetDistrictMonthlyGoalFormScopedAsync(GetMemberId(), categoryId, yearId, districtId);
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

    // ── Goal Overview "View clubs" popup: the all-clubs "Club Goal Setting" Excel report for a district. ──
    // No role gate on these three: each service call throws "This district is outside your goal-setting
    // scope" unless the caller is the SuperAdmin or that district's admin.
    [HttpGet("goals-excel/clubs-all/oversight")]
    public async Task<ActionResult> GetScopedAllClubsGoalsExcel([FromQuery] int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildAllClubsMonthlyExcelScopedAsync(GetMemberId(), yearId, districtId);
            return bytes == null ? NotFound(new { message = "No club goal data for this district." })
                : File(bytes, XlsxMime, $"Club_Goal_Setting_D{districtId}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal Overview "Club Goal Setting" popup: clubs matrix for a district (SuperAdmin or its admin). ──
    [HttpGet("districts/{categoryId:int}/clubs-matrix/oversight")]
    public async Task<ActionResult<GoalClubMatrixDto>> GetScopedDistrictClubsGoalMatrix(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            return Ok(await _service.GetScopedDistrictClubsGoalMatrixAsync(GetMemberId(), categoryId, yearId, districtId));
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("districts/{categoryId:int}/clubs-monthly-matrix/oversight")]
    public async Task<ActionResult<GoalClubMonthlyMatrixDto>> GetScopedDistrictClubsMonthlyMatrix(
        [FromRoute] int categoryId, [FromQuery] int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            return Ok(await _service.GetScopedDistrictClubsMonthlyMatrixAsync(GetMemberId(), categoryId, yearId, districtId));
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
        return r == null ? NotFound(new { message = "Invalid zone or year." }) : Ok(r);
    }

    // ── Goal Overview dashboard: districts = rows, compact Target/Achieved/% per category ──
    [HttpGet("district-summary-matrix")]
    public async Task<ActionResult<GoalDistrictSummaryMatrixDto>> GetDistrictSummaryMatrix(
        [FromQuery] int zoneId, [FromQuery] int? yearId = null)
    {
        try { return Ok(await _service.GetScopedDistrictSummaryMatrixAsync(GetMemberId(), zoneId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal Overview district list (SuperAdmin) ──
    [HttpGet("scoped/districts/{categoryId:int}")]
    public async Task<ActionResult<List<GoalDistrictSummaryDto>>> GetScopedDistricts(
        [FromRoute] int categoryId, [FromQuery] int yearId)
    {
        try { return Ok(await _service.GetScopedDistrictsGoalListAsync(GetMemberId(), categoryId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── District goal report (districts × categories horizontal, YTD + Month-wise), scoped to
    //    selection: districtId → that district; else zoneId → that zone's districts; else all districts. ──
    [HttpGet("district-report")]
    public async Task<ActionResult> GetGoalDistrictReport([FromQuery] int? zoneId = null, [FromQuery] int? districtId = null, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildGoalDistrictReportExcelAsync(GetMemberId(), zoneId, districtId, yearId);
            return bytes == null ? NotFound(new { message = "No goal data to report for this selection." })
                : File(bytes, XlsxMime, $"goal-district-report-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Goal Overview per-district download: the EXACT district-admin "District Goal Setting" workbook
    //    (YTD + Month-wise, vertical), SuperAdmin only. ──
    [HttpGet("district-report/{districtId:int}")]
    public async Task<ActionResult> GetGoalDistrictSettingReport(int districtId, [FromQuery] int? yearId = null)
    {
        try
        {
            var bytes = await _service.BuildDistrictGoalSettingReportScopedAsync(GetMemberId(), districtId, yearId);
            return bytes == null ? NotFound(new { message = "No goal data to report for this district." })
                : File(bytes, XlsxMime, $"District_Goal_Setting_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Messaging (two-way; formerly "comments") — same "any authenticated member with
    //    visibility" gate. Optional clubId>0 selects the Club↔District thread. ────
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

    // Red "new message" dot for the Goal Overview Messages popup (per zone+year).
    [HttpGet("messages/has-unread")]
    public async Task<ActionResult<object>> GetHasUnreadMessages([FromQuery] int zoneId, [FromQuery] int yearId)
        => Ok(new { hasUnread = await _service.HasUnreadZoneMessagesAsync(GetMemberId(), zoneId, yearId) });

    // ── District Admin / District Governor messages (user 2026-10-09) ──
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

    [HttpGet("district-messages/inbox")]
    public async Task<ActionResult<List<GoalDistrictConversationDto>>> GetDistrictMessageInbox(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0)
        => Ok(await _service.GetDistrictMessageInboxAsync(GetMemberId(), zoneId, yearId, categoryId, districtId));

    // ── Goal messages report (Excel): every District Admin / DG message in a zone, filterable by
    //    category (0=all) + district (0=all). SuperAdmin only. ──
    [HttpGet("messages/report")]
    public async Task<ActionResult> GetGoalMessagesReport(
        [FromQuery] int zoneId, [FromQuery] int yearId, [FromQuery] int categoryId = 0, [FromQuery] int districtId = 0)
    {
        try
        {
            var bytes = await _service.BuildGoalMessagesReportExcelAsync(GetMemberId(), zoneId, yearId, categoryId, districtId);
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
            return Ok(await _service.ImportFoundationClubAsync(GetMemberId(), form.YearId, stream, form.Month));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception) { return BadRequest(new { message = "Failed to read the Excel file. Check that it is a valid .xlsx file." }); }
    }

    // District Membership import (SuperAdmin, user 2026-10-08): Rotary.org "Comparison to 1 July"
    // (clubs + members) + "Members Admitted by Gender" (women). The month comes from the file's date.
    public class MembershipImportForm
    {
        public IFormFile? MembersFile { get; set; }
        public IFormFile? GenderFile { get; set; }
        public IFormFile? RotaractFile { get; set; }   // optional: Youth Service -> Rotaract Clubs Achieved
        public IFormFile? InteractFile { get; set; }   // optional: Interact_Statistics -> Interact Clubs Achieved
        public int YearId { get; set; }
    }

    [HttpPost("membership-import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<ActionResult<GoalFoundationImportResultDto>> ImportDistrictMembership([FromForm] MembershipImportForm form)
    {
        if (!IsSuperAdminRole()) return Forbid();
        if (form.MembersFile == null || form.MembersFile.Length == 0 || form.GenderFile == null || form.GenderFile.Length == 0)
            return BadRequest(new { message = "Upload both files: the Rotary \"Comparison to 1 July\" file and the \"Members Admitted by Gender\" file." });
        try
        {
            using var members = form.MembersFile.OpenReadStream();
            using var gender = form.GenderFile.OpenReadStream();
            using var rotaract = form.RotaractFile != null && form.RotaractFile.Length > 0 ? form.RotaractFile.OpenReadStream() : null;
            using var interact = form.InteractFile != null && form.InteractFile.Length > 0 ? form.InteractFile.OpenReadStream() : null;
            return Ok(await _service.ImportDistrictMembershipAsync(GetMemberId(), form.YearId, members, form.MembersFile.FileName, gender,
                rotaract, form.RotaractFile?.FileName, interact));
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
        catch (Exception) { return BadRequest(new { message = "Failed to read the Excel file. Check that it is a valid .xlsx file." }); }
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
