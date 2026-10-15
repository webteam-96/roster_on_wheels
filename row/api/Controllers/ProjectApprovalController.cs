using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/project-approval")]
public class ProjectApprovalController : ControllerBase
{
    private readonly IProjectApprovalService _approvalService;
    private readonly string _connectionString;

    public ProjectApprovalController(IProjectApprovalService approvalService, IConfiguration configuration)
    {
        _approvalService = approvalService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    // ── Check if club has moderator ──
    [HttpGet("/api/clubs/{clubId}/has-moderator")]
    [Authorize]
    public async Task<ActionResult> HasModerator(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var (hasModerator, moderatorName) = await _approvalService.GetModeratorInfoAsync(clubId);
        return Ok(new { hasModerator, moderatorName });
    }

    // ── Email-based: Show approve page ──
    [HttpGet("{token}/approve")]
    [AllowAnonymous]
    public async Task<ContentResult> ShowApprovePage(string token)
    {
        var detail = await _approvalService.GetByTokenAsync(token) as dynamic;
        if (detail == null)
            return HtmlPage("Request Not Found", "<p>This project approval request was not found.</p>", "#e53e3e");

        if ((string?)detail.approvalStatus != "pending")
            return HtmlPage("Already Processed",
                $"<p>This project has already been <strong>{(string?)detail.approvalStatus}</strong>.</p>" +
                (string.IsNullOrEmpty((string?)detail.approvalRemark) ? "" : $"<p><strong>Remark:</strong> {(string)detail.approvalRemark}</p>"),
                (string?)detail.approvalStatus == "approved" ? "#38a169" : "#e53e3e");

        return new ContentResult { Content = ApprovalFormHtml(token, detail, "approve"), ContentType = "text/html", StatusCode = 200 };
    }

    // ── Email-based: Show reject page ──
    [HttpGet("{token}/reject")]
    [AllowAnonymous]
    public async Task<ContentResult> ShowRejectPage(string token)
    {
        var detail = await _approvalService.GetByTokenAsync(token) as dynamic;
        if (detail == null)
            return HtmlPage("Request Not Found", "<p>This project approval request was not found.</p>", "#e53e3e");

        if ((string?)detail.approvalStatus != "pending")
            return HtmlPage("Already Processed",
                $"<p>This project has already been <strong>{(string?)detail.approvalStatus}</strong>.</p>" +
                (string.IsNullOrEmpty((string?)detail.approvalRemark) ? "" : $"<p><strong>Remark:</strong> {(string)detail.approvalRemark}</p>"),
                (string?)detail.approvalStatus == "approved" ? "#38a169" : "#e53e3e");

        return new ContentResult { Content = ApprovalFormHtml(token, detail, "reject"), ContentType = "text/html", StatusCode = 200 };
    }

    // ── Email-based: Process approve ──
    [HttpPost("{token}/approve")]
    [AllowAnonymous]
    public async Task<ContentResult> ProcessApprove(string token, [FromForm] string? remark)
    {
        try
        {
            var (success, message) = await _approvalService.ApproveByTokenAsync(token, remark);
            return success
                ? HtmlPage("Project Approved", "<p>The project has been approved successfully.</p>", "#38a169")
                : HtmlPage("Cannot Process", $"<p>{message}</p>", "#e53e3e");
        }
        catch (Exception ex)
        {
            return HtmlPage("Error", $"<p>Failed to process approval: {ex.Message}</p>", "#e53e3e");
        }
    }

    // ── Email-based: Process reject ──
    [HttpPost("{token}/reject")]
    [AllowAnonymous]
    public async Task<ContentResult> ProcessReject(string token, [FromForm] string? remark)
    {
        if (string.IsNullOrWhiteSpace(remark))
        {
            var detail = await _approvalService.GetByTokenAsync(token) as dynamic;
            if (detail == null)
                return HtmlPage("Request Not Found", "<p>This project approval request was not found.</p>", "#e53e3e");
            if ((string?)detail.approvalStatus != "pending")
                return HtmlPage("Already Processed",
                    $"<p>This project has already been <strong>{(string?)detail.approvalStatus}</strong>.</p>",
                    (string?)detail.approvalStatus == "approved" ? "#38a169" : "#e53e3e");
            return new ContentResult { Content = ApprovalFormHtml(token, detail, "reject", "Remark is required when rejecting."), ContentType = "text/html", StatusCode = 200 };
        }

        try
        {
            var (success, message) = await _approvalService.RejectByTokenAsync(token, remark);
            return success
                ? HtmlPage("Project Rejected", "<p>The project has been rejected.</p>", "#e53e3e")
                : HtmlPage("Cannot Process", $"<p>{message}</p>", "#e53e3e");
        }
        catch (Exception ex)
        {
            return HtmlPage("Error", $"<p>Failed to process rejection: {ex.Message}</p>", "#e53e3e");
        }
    }

    // ── Dashboard: Project detail ──
    // yearId is a query param because pk_project_id is auto-increment PER
    // year-wise table, so the same int (e.g. 143778) can exist in BOTH
    // rotary_projects_2024_25 AND rotary_projects_2025_26 as completely
    // different projects at different clubs. Without yearId scoping, the
    // cross-year FindByProjectIdAsync scan returns the FIRST hit (earliest
    // year), whose club may not be moderated by the caller → spurious 404.
    [HttpGet("moderator/{projectId}/detail")]
    [Authorize]
    public async Task<ActionResult> GetProjectDetail(int projectId, [FromQuery] int? yearId = null)
    {
        var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
        var result = await _approvalService.GetProjectDetailForModeratorAsync(projectId, memberId, yearId);
        if (result == null) return NotFound(new { message = "Project not found or you are not the moderator for this club." });
        return Ok(result);
    }

    // ── Dashboard: Year summary ──
    [HttpGet("moderator/years")]
    [Authorize]
    public async Task<ActionResult> GetYearSummary()
    {
        var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
        var result = await _approvalService.GetYearSummaryAsync(memberId);
        return Ok(result);
    }

    // ── Dashboard: Project list ──
    [HttpGet("moderator/projects")]
    [Authorize]
    public async Task<ActionResult> GetModeratorProjects([FromQuery] int yearId, [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? moduleKey = null)
    {
        var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
        var (items, totalCount) = await _approvalService.GetProjectsForModeratorAsync(memberId, yearId, status, page, pageSize, moduleKey);
        return Ok(new
        {
            items,
            totalCount,
            page,
            pageSize,
            totalPages = (int)Math.Ceiling((double)totalCount / pageSize)
        });
    }

    // ── Dashboard: Approve project ──
    [HttpPost("moderator/{projectId}/approve")]
    [Authorize]
    public async Task<ActionResult> ModeratorApprove(int projectId, [FromBody] RemarkDto? dto, [FromQuery] int? yearId = null)
    {
        var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
        var (success, message) = await _approvalService.ModeratorApproveAsync(projectId, memberId, dto?.Remark, yearId);
        return success ? Ok(new { message }) : BadRequest(new { message });
    }

    // ── Dashboard: Reject project ──
    [HttpPost("moderator/{projectId}/reject")]
    [Authorize]
    public async Task<ActionResult> ModeratorReject(int projectId, [FromBody] RemarkDto dto, [FromQuery] int? yearId = null)
    {
        var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
        var (success, message) = await _approvalService.ModeratorRejectAsync(projectId, memberId, dto.Remark, yearId);
        return success ? Ok(new { message }) : BadRequest(new { message });
    }

    public class RemarkDto { public string Remark { get; set; } = ""; }

    // ── HTML helpers ──
    private static ContentResult HtmlPage(string title, string bodyContent, string color)
    {
        var html = $@"<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{title} - Rotary Zones</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }}
  .container {{ max-width: 600px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  h1 {{ color: {color}; margin-bottom: 16px; }}
  p {{ color: #4a5568; line-height: 1.6; }}
  .footer {{ margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }}
</style></head><body>
<div class='container'>
  <h1>{title}</h1>
  {bodyContent}
  <div class='footer'>Thank you,<br/><strong>Team ROW</strong></div>
</div></body></html>";
        return new ContentResult { Content = html, ContentType = "text/html", StatusCode = 200 };
    }

    private static string ApprovalFormHtml(string token, dynamic d, string action, string? errorMessage = null)
    {
        var isApprove = action == "approve";
        var actionColor = isApprove ? "#38a169" : "#e53e3e";
        var actionLabel = isApprove ? "Approve" : "Reject";
        var remarkRequired = isApprove ? "" : "required";
        var remarkNote = isApprove ? "(Optional)" : "(Required)";

        return $@"<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{actionLabel} Project - Rotary Zones</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }}
  .container {{ max-width: 600px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  h1 {{ color: {actionColor}; margin-bottom: 16px; }}
  .detail {{ background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }}
  .detail table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
  .detail td {{ padding: 6px 0; }}
  .detail td:first-child {{ color: #718096; width: 40%; }}
  .error {{ color: #e53e3e; background: #fed7d7; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }}
  textarea {{ width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: inherit; resize: vertical; box-sizing: border-box; }}
  button {{ background: {actionColor}; color: white; border: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; }}
  button:hover {{ opacity: 0.9; }}
  .footer {{ margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }}
</style></head><body>
<div class='container'>
  <h1>{actionLabel} Project</h1>
  <div class='detail'>
    <table>
      <tr><td>Project</td><td><strong>{(string?)d.title}</strong></td></tr>
      <tr><td>Module</td><td>{(string?)d.moduleName}</td></tr>
      <tr><td>Club</td><td>{(string?)d.clubName}</td></tr>
      <tr><td>District</td><td>{(string?)d.districtNumber}</td></tr>
      <tr><td>Date</td><td>{(d.projectDate != null ? ((DateTime)d.projectDate).ToString("dd MMM yyyy") : "—")}</td></tr>
      <tr><td>Cost</td><td>{(d.projectCost != null ? RotaryApi.Services.Brand.Money(Convert.ToDecimal(d.projectCost)) : "—")}</td></tr>
      <tr><td>Submitted By</td><td>{(string?)d.submittedByName}</td></tr>
    </table>
  </div>
  {(string.IsNullOrEmpty(errorMessage) ? "" : $"<div class='error'>{errorMessage}</div>")}
  <!-- Post back to the CURRENT page URL (empty action) rather than an absolute
       '/api/...' path. The API is hosted under a sub-application ('/API'), so a
       leading-slash action resolves against the origin and drops the '/API'
       prefix -> 404. The GET (form) and POST (handler) share the same route
       ({token}/approve | {token}/reject), so an empty action always posts to the
       right place regardless of the deployment sub-path. -->
  <form method='POST' action=''>
    <div style='margin-bottom: 16px;'>
      <label style='font-weight: 600; display: block; margin-bottom: 4px;'>Remark {remarkNote}</label>
      <textarea name='remark' rows='3' {remarkRequired} placeholder='Enter your remark...'></textarea>
    </div>
    <button type='submit'>{actionLabel} Project</button>
  </form>
  <div class='footer'>Thank you,<br/><strong>Team ROW</strong></div>
</div></body></html>";
    }
}
