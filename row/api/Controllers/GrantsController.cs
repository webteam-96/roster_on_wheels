using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Grants (ROW build spec 3.8, Services/GrantService.cs). District routes need someone who manages that district,
/// club routes someone who manages that club, for reads too: ScopeWriteGuardMiddleware lets any member of a club
/// read its club and district routes, and grant applications are for their admins only. Off until a SuperAdmin
/// switches on "grants" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class GrantsController : ControllerBase
{
    private const string District = "api/districts/{districtId:int}/grants";
    private const string Club = "api/clubs/{clubId:int}/grants";
    private readonly GrantService _grants;
    private readonly string _connectionString;

    public GrantsController(GrantService grants, IConfiguration configuration)
    {
        _grants = grants;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(bool club, int scopeId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, club, scopeId);

    private ObjectResult NotDistrictAdmin() => StatusCode(403, new { message = "Only the district's admins can manage its grants." });
    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's admins can manage its grant applications." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Grant application not found." });

    // ===== District =====

    [HttpGet(District + "/cycles")]
    public async Task<IActionResult> Cycles(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.ListCyclesAsync(districtId));
    }

    [HttpPost(District + "/cycles")]
    public async Task<IActionResult> CreateCycle(int districtId, [FromBody] SaveGrantCycleDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.SaveCycleAsync(districtId, null, dto, MemberId, HttpContext));
    }

    [HttpPut(District + "/cycles/{cycleId:int}")]
    public async Task<IActionResult> UpdateCycle(int districtId, int cycleId, [FromBody] SaveGrantCycleDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var cycle = await _grants.SaveCycleAsync(districtId, cycleId, dto, MemberId, HttpContext);
        return cycle == null ? NotFound(new { message = "Grant cycle not found." }) : Ok(cycle);
    }

    [HttpGet(District + "/cycles/{cycleId:int}/cashflow")]
    public async Task<IActionResult> CashFlow(int districtId, int cycleId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var flow = await _grants.GetCashFlowAsync(districtId, cycleId);
        return flow == null ? NotFound(new { message = "Grant cycle not found." }) : Ok(flow);
    }

    [HttpGet(District + "/summary")]
    public async Task<IActionResult> YearSummary(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.GetYearSummaryAsync(districtId));
    }

    /// <summary>Queues the due and overdue report reminders of this district now (the hourly job does the same for all).</summary>
    [HttpPost(District + "/reminders")]
    public async Task<IActionResult> SendReminders(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(new { sent = await _grants.QueueReportRemindersAsync(districtId) });
    }

    // ----- Qualified clubs, monthly cash flow and receipts, email templates (grants extras) -----

    [HttpGet(District + "/settings")]
    public async Task<IActionResult> Settings(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.GetSettingsAsync(districtId));
    }

    [HttpPut(District + "/settings")]
    public async Task<IActionResult> SaveSettings(int districtId, [FromBody] GrantSettingsDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.SaveSettingsAsync(districtId, dto, MemberId, HttpContext));
    }

    [HttpGet(District + "/qualifications")]
    public async Task<IActionResult> Qualifications(int districtId, [FromQuery] int yearId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.ListQualificationsAsync(districtId, yearId));
    }

    [HttpPut(District + "/qualifications/{clubId:int}/{yearId:int}")]
    public async Task<IActionResult> SaveQualification(int districtId, int clubId, int yearId, [FromBody] SaveGrantQualificationDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var q = await _grants.SaveQualificationAsync(districtId, clubId, yearId, dto, MemberId, HttpContext);
        return q == null ? NotFound(new { message = "That club is not in this district." }) : Ok(q);
    }

    [HttpGet(District + "/cycles/{cycleId:int}/monthly")]
    public async Task<IActionResult> Monthly(int districtId, int cycleId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var f = await _grants.GetMonthlyCashFlowAsync(districtId, cycleId);
        return f == null ? NotFound(new { message = "Grant cycle not found." }) : Ok(f);
    }

    [HttpGet(District + "/cycles/{cycleId:int}/monthly/export")]
    public async Task<IActionResult> MonthlyExport(int districtId, int cycleId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var bytes = await _grants.ExportMonthlyCashFlowAsync(districtId, cycleId);
        return bytes == null ? NotFound(new { message = "Grant cycle not found." })
            : File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"grants-cash-flow-{cycleId}.xlsx");
    }

    [HttpPost(District + "/cycles/{cycleId:int}/receipts")]
    public async Task<IActionResult> AddReceipt(int districtId, int cycleId, [FromBody] SaveGrantReceiptDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var f = await _grants.AddReceiptAsync(districtId, cycleId, dto, MemberId, HttpContext);
        return f == null ? NotFound(new { message = "Grant cycle not found." }) : Ok(f);
    }

    [HttpDelete(District + "/cycles/{cycleId:int}/receipts/{receiptId:int}")]
    public async Task<IActionResult> DeleteReceipt(int districtId, int cycleId, int receiptId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _grants.DeleteReceiptAsync(districtId, cycleId, receiptId, MemberId, HttpContext)
            ? NoContent() : NotFound(new { message = "Receipt not found." });
    }

    [HttpGet(District + "/email-templates")]
    public async Task<IActionResult> EmailTemplates(int districtId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(new { templates = await _grants.ListTemplatesAsync(districtId), placeholders = GrantService.TemplatePlaceholders });
    }

    [HttpPut(District + "/email-templates/{kind}")]
    public async Task<IActionResult> SaveEmailTemplate(int districtId, string kind, [FromBody] SaveGrantEmailTemplateDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.SaveTemplateAsync(districtId, kind, dto, MemberId, HttpContext));
    }

    [HttpDelete(District + "/email-templates/{kind}")]
    public async Task<IActionResult> ResetEmailTemplate(int districtId, string kind)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.ResetTemplateAsync(districtId, kind, MemberId, HttpContext));
    }

    [HttpPost(District + "/email-templates/{kind}/preview")]
    public async Task<IActionResult> PreviewEmailTemplate(int districtId, string kind, [FromBody] SaveGrantEmailTemplateDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(GrantService.PreviewTemplate(kind, dto));
    }

    [HttpGet(District + "/cycles/{cycleId:int}/export")]
    public async Task<IActionResult> Export(int districtId, int cycleId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var csv = await _grants.ExportCsvAsync(districtId, cycleId);
        if (csv == null) return NotFound(new { message = "Grant cycle not found." });
        return File(Encoding.UTF8.GetBytes("﻿" + csv), "text/csv", $"grants-{cycleId}.csv");
    }

    [HttpGet(District + "/applications")]
    public async Task<IActionResult> DistrictApplications(int districtId, [FromQuery] int? cycleId, [FromQuery] string? status, [FromQuery] bool? archived)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return Ok(await _grants.ListDistrictApplicationsAsync(districtId, cycleId, status, archived));
    }

    [HttpGet(District + "/applications/{id:int}")]
    public async Task<IActionResult> DistrictApplication(int districtId, int id)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var app = await _grants.GetApplicationAsync(GrantService.DistrictSide, districtId, id);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(District + "/applications/{id:int}/actions/{transition}")]
    public async Task<IActionResult> DistrictAction(int districtId, int id, string transition, [FromBody] GrantActionDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var app = await _grants.TransitionAsync(GrantService.DistrictSide, districtId, id, transition, dto, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(District + "/applications/{id:int}/comments")]
    public async Task<IActionResult> DistrictComment(int districtId, int id, [FromBody] GrantCommentDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var app = await _grants.CommentAsync(GrantService.DistrictSide, districtId, id, dto.Comment, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(District + "/applications/{id:int}/payments")]
    public async Task<IActionResult> RecordPayment(int districtId, int id, [FromBody] RecordGrantPaymentDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        var app = await _grants.RecordPaymentAsync(districtId, id, dto, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpGet(District + "/applications/{id:int}/attachments/{attachmentId:int}")]
    public async Task<IActionResult> DistrictAttachment(int districtId, int id, int attachmentId)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await FileResultAsync(GrantService.DistrictSide, districtId, id, attachmentId);
    }

    // ===== Club =====

    [HttpGet(Club)]
    public async Task<IActionResult> Overview(int clubId)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var overview = await _grants.GetClubOverviewAsync(clubId);
        return overview == null ? NotFound(new { message = "Club not found." }) : Ok(overview);
    }

    [HttpPost(Club + "/applications")]
    public async Task<IActionResult> CreateApplication(int clubId, [FromBody] SaveGrantApplicationDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        return Ok(new { id = await _grants.CreateApplicationAsync(clubId, dto, MemberId, HttpContext) });
    }

    [HttpGet(Club + "/applications/{id:int}")]
    public async Task<IActionResult> ClubApplication(int clubId, int id)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var app = await _grants.GetApplicationAsync(GrantService.ClubSide, clubId, id);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPut(Club + "/applications/{id:int}")]
    public async Task<IActionResult> UpdateApplication(int clubId, int id, [FromBody] SaveGrantApplicationDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        if (!await _grants.UpdateApplicationAsync(clubId, id, dto, MemberId, HttpContext)) return Missing();
        return Ok(await _grants.GetApplicationAsync(GrantService.ClubSide, clubId, id));
    }

    [HttpPost(Club + "/applications/{id:int}/actions/{transition}")]
    public async Task<IActionResult> ClubAction(int clubId, int id, string transition, [FromBody] GrantActionDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var app = await _grants.TransitionAsync(GrantService.ClubSide, clubId, id, transition, dto, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(Club + "/applications/{id:int}/comments")]
    public async Task<IActionResult> ClubComment(int clubId, int id, [FromBody] GrantCommentDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var app = await _grants.CommentAsync(GrantService.ClubSide, clubId, id, dto.Comment, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(Club + "/applications/{id:int}/interim-reports")]
    public async Task<IActionResult> InterimReport(int clubId, int id, [FromBody] SubmitGrantInterimReportDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var app = await _grants.SubmitInterimReportAsync(clubId, id, dto, MemberId, HttpContext);
        return app == null ? Missing() : Ok(app);
    }

    [HttpPost(Club + "/applications/{id:int}/attachments")]
    [RequestSizeLimit(21 * 1024 * 1024)]
    public async Task<IActionResult> Upload(int clubId, int id, IFormFile file, [FromQuery] string? kind)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        var att = await _grants.AddAttachmentAsync(clubId, id, file, MemberId, HttpContext, kind);
        return att == null ? Missing() : Ok(att);
    }

    [HttpDelete(Club + "/applications/{id:int}/attachments/{attachmentId:int}")]
    public async Task<IActionResult> DeleteAttachment(int clubId, int id, int attachmentId)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        return await _grants.DeleteAttachmentAsync(clubId, id, attachmentId, MemberId, HttpContext) ? NoContent() : Missing();
    }

    [HttpGet(Club + "/applications/{id:int}/attachments/{attachmentId:int}")]
    public async Task<IActionResult> ClubAttachment(int clubId, int id, int attachmentId)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        return await FileResultAsync(GrantService.ClubSide, clubId, id, attachmentId);
    }

    // Light mode: the club's district is not on ROW, so the club records only grant amount and report date per project.
    [HttpGet(Club + "/light")]
    public async Task<IActionResult> LightProjects(int clubId, [FromQuery] int yearId)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        return Ok(await _grants.GetLightProjectsAsync(clubId, yearId));
    }

    [HttpPut(Club + "/light/{yearId:int}/{projectId:int}")]
    public async Task<IActionResult> SaveLight(int clubId, int yearId, int projectId, [FromBody] SaveGrantLightDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotClubAdmin();
        return await _grants.SaveLightAsync(clubId, yearId, projectId, dto, MemberId, HttpContext)
            ? NoContent() : NotFound(new { message = "Project not found." });
    }

    private async Task<IActionResult> FileResultAsync(string side, int scopeId, int id, int attachmentId)
    {
        var file = await _grants.GetAttachmentFileAsync(side, scopeId, id, attachmentId);
        if (file == null) return NotFound(new { message = "File not found." });
        Response.Headers["X-Content-Type-Options"] = "nosniff"; // club uploads: never let a browser guess the type
        return PhysicalFile(file.Value.Path, file.Value.ContentType, file.Value.Name);
    }
}
