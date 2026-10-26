using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/event-payment-links")]
[Authorize]
public class EventPaymentLinksController : ControllerBase
{
    private readonly IEventPaymentLinkService _service;
    private readonly IWebHostEnvironment _env;
    private readonly ISubGroupService _subGroupService;
    private readonly string _connectionString;

    public EventPaymentLinksController(IEventPaymentLinkService service, IWebHostEnvironment env, ISubGroupService subGroupService, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _subGroupService = subGroupService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    // Reads (2026-10-24): only the people who manage the link's club or district (the ScopeWriteGuardMiddleware rule:
    // SuperAdmin, club Admin / AG, district Admin). The role check alone let any club's Admin read every link's
    // registrations, payments and bank splits.
    private async Task<bool> ManagesAsync(int? clubId, int? districtId)
    {
        if (UserPermissionHelper.IsSuperAdmin(User)) return true;
        var me = GetUserId();
        return me > 0 && ((clubId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, me, true, clubId.Value))
            || (districtId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, me, false, districtId.Value)));
    }

    private async Task<bool> CanReadLinkAsync(int linkId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var owner = await conn.QueryFirstOrDefaultAsync<(int? ClubId, int? DistrictId)>(
            "SELECT fk_club_id, fk_district_master_id FROM event_payment_links WHERE pk_id = @Id", new { Id = linkId });
        return await ManagesAsync(owner.ClubId, owner.DistrictId);
    }

    // Writes on one member payment: the caller must manage the payment's link (club or district).
    private async Task<bool> CanManageMemberPaymentAsync(int memberPaymentId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var linkId = await conn.ExecuteScalarAsync<int?>("SELECT fk_payment_link_id FROM event_payment_members WHERE pk_id = @Id", new { Id = memberPaymentId });
        return linkId is > 0 && await CanReadLinkAsync(linkId.Value);
    }

    private int? GetAdminClubId()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (roles.Contains("SuperAdmin")) return null;
        var clubId = User.FindFirst("clubId")?.Value;
        return clubId != null ? int.Parse(clubId) : null;
    }

    private int? GetAdminDistrictId()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (roles.Contains("SuperAdmin")) return null;
        var districtId = User.FindFirst("districtId")?.Value;
        return districtId != null ? int.Parse(districtId) : null;
    }

    private static string? ValidateImageFile(IFormFile? file)
    {
        if (file == null || file.Length == 0) return null;
        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = System.IO.Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(extension))
            return "Invalid image file type. Allowed: JPG, JPEG, PNG, GIF, WEBP";
        return null;
    }

    // ── Payment Links CRUD ────────────────────────────────────────

    [HttpGet("")]
    public async Task<ActionResult> GetPaymentLinks([FromQuery] int? clubId, [FromQuery] int? districtId, [FromQuery] string? search)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        // Admin can only see their own club's links
        var adminClubId = GetAdminClubId();
        if (adminClubId.HasValue) clubId = adminClubId.Value;
        // no club or district named = every link on the platform: SuperAdmin only
        if (!await ManagesAsync(clubId, districtId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetPaymentLinksAsync(clubId, districtId, search);
        return Ok(result);
    }

    [HttpGet("{linkId}")]
    public async Task<ActionResult> GetPaymentLinkDetail(int linkId)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetPaymentLinkDetailAsync(linkId);
        if (result == null) return NotFound(new { message = "Payment link not found." });
        return Ok(result);
    }

    [HttpPost("")]
    public async Task<ActionResult> CreatePaymentLink([FromForm] CreateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!await ManagesAsync(dto.FkClubId, dto.FkDistrictMasterId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(eventImage) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            var id = await _service.CreatePaymentLinkAsync(dto, logo, eventImage, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { id, message = "Payment link created." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to create payment link: {ex.Message}" });
        }
    }

    [HttpPost("create-full")]
    public async Task<ActionResult> CreateFullPaymentLink([FromForm] CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!await ManagesAsync(dto.FkClubId, dto.FkDistrictMasterId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            var id = await _service.CreateFullPaymentLinkAsync(dto, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { id, message = "Payment link created successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to create payment link: {ex.Message}" });
        }
    }

    [HttpPut("{linkId}/update-full")]
    public async Task<ActionResult> UpdateFullPaymentLink(int linkId, [FromForm] CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!await CanReadLinkAsync(linkId) || !await ManagesAsync(dto.FkClubId, dto.FkDistrictMasterId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            await _service.UpdateFullPaymentLinkAsync(linkId, dto, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { message = "Payment link updated successfully." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to update payment link: {ex.Message}" });
        }
    }

    [HttpPut("{linkId}")]
    public async Task<ActionResult> UpdatePaymentLink(int linkId, [FromForm] UpdateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!await CanReadLinkAsync(linkId) || !await ManagesAsync(dto.FkClubId, dto.FkDistrictMasterId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(eventImage) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            await _service.UpdatePaymentLinkAsync(linkId, dto, logo, eventImage, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { message = "Payment link updated." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to update payment link: {ex.Message}" });
        }
    }

    [HttpDelete("{linkId}")]
    public async Task<ActionResult> DeletePaymentLink(int linkId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.DeletePaymentLinkAsync(linkId, GetUserId());
            return Ok(new { message = "Payment link deleted." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to delete payment link: {ex.Message}" });
        }
    }

    [HttpPatch("{linkId}/toggle-active")]
    public async Task<ActionResult> ToggleActive(int linkId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.ToggleActiveAsync(linkId, GetUserId());
            return Ok(new { message = "Payment link toggled." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to toggle: {ex.Message}" });
        }
    }

    // ── Subgroup available years ───────────────────────────────────
    [HttpGet("subgroup-years")]
    public async Task<ActionResult> GetSubGroupYears([FromQuery] int? clubId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var years = await _subGroupService.GetAvailableYearsAsync(clubId, districtId);
        return Ok(years);
    }

    // ── Registrations ─────────────────────────────────────────────

    [HttpGet("{linkId}/registrations")]
    public async Task<ActionResult> GetRegistrations(int linkId)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetRegistrationsAsync(linkId);
        return Ok(result);
    }

    [HttpPost("{linkId}/registrations")]
    public async Task<ActionResult> SaveRegistration(int linkId, [FromBody] CreateEventRegistrationDto dto)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var id = await _service.SaveRegistrationAsync(linkId, dto, GetUserId());
        return Ok(new { id, message = "Registration type saved." });
    }

    [HttpPut("{linkId}/registrations/{regId}")]
    [OwnedBy(Owns.EventRegistration, "regId", "linkId")]
    public async Task<ActionResult> UpdateRegistration(int linkId, int regId, [FromBody] CreateEventRegistrationDto dto)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        await _service.UpdateRegistrationAsync(linkId, regId, dto, GetUserId());
        return Ok(new { message = "Registration type updated." });
    }

    [HttpDelete("{linkId}/registrations/{regId}")]
    [OwnedBy(Owns.EventRegistration, "regId", "linkId")]
    public async Task<ActionResult> DeleteRegistration(int linkId, int regId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        await _service.DeleteRegistrationAsync(regId, GetUserId());
        return Ok(new { message = "Registration type deleted." });
    }

    // ── Vendor Splits ─────────────────────────────────────────────

    [HttpGet("{linkId}/vendor-splits")]
    public async Task<ActionResult> GetVendorSplits(int linkId)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetVendorSplitsAsync(linkId);
        return Ok(result);
    }

    [HttpPost("{linkId}/vendor-splits")]
    public async Task<ActionResult> SaveVendorSplits(int linkId, [FromBody] SaveVendorSplitsDto dto)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        await _service.SaveVendorSplitsAsync(linkId, dto, GetUserId());
        return Ok(new { message = "Vendor splits saved." });
    }

    // ── Designations ──────────────────────────────────────────────

    [HttpGet("{linkId}/designations")]
    public async Task<ActionResult> GetDesignations(int linkId)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetDesignationsAsync(linkId);
        return Ok(result);
    }

    [HttpPost("{linkId}/designations")]
    public async Task<ActionResult> SaveDesignation(int linkId, [FromBody] CreateEventDesignationDto dto)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var id = await _service.SaveDesignationAsync(linkId, dto, GetUserId());
        return Ok(new { id, message = "Designation saved." });
    }

    [HttpDelete("{linkId}/designations/{desigId}")]
    [OwnedBy(Owns.EventDesignation, "desigId", "linkId")]
    public async Task<ActionResult> DeleteDesignation(int linkId, int desigId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        await _service.DeleteDesignationAsync(desigId, GetUserId());
        return Ok(new { message = "Designation deleted." });
    }

    // ── Members (Paid/Unpaid) ─────────────────────────────────────

    [HttpGet("{linkId}/members")]
    public async Task<ActionResult> GetMembers(int linkId, [FromQuery] bool isPaid = false, [FromQuery] string? search = null)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetMembersAsync(linkId, isPaid, search);
        return Ok(result);
    }

    [HttpPost("{linkId}/members/offline-payment")]
    public async Task<ActionResult> RecordOfflinePayment(int linkId, [FromForm] RecordOfflinePaymentDto dto, IFormFile? attachment)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!ModelState.IsValid)
        {
            var errors = ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage);
            return BadRequest(new { message = $"Validation failed: {string.Join(", ", errors)}", errors });
        }
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });

        if (attachment != null && attachment.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp" };
            var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Allowed: PDF, JPG, JPEG, PNG, GIF, WEBP" });
        }

        try
        {
            var id = await _service.RecordOfflinePaymentAsync(linkId, dto, attachment, GetUserId(), _env);
            return Ok(new { id, message = "Offline payment recorded." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    [HttpGet("member-payment/{memberPaymentId}")]
    public async Task<ActionResult> GetMemberPaymentDetail(int memberPaymentId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetMemberPaymentAsync(memberPaymentId);
        if (result == null) return NotFound(new { message = "Payment not found." });
        if (!await CanReadLinkAsync((int)result.LinkId)) return StatusCode(403, new { message = "Access denied." });
        return Ok(result);
    }

    [HttpPut("members/{memberPaymentId}/update-offline")]
    public async Task<ActionResult> UpdateOfflinePayment(int memberPaymentId, [FromForm] RecordOfflinePaymentDto dto, IFormFile? attachment)
    {
        if (!await CanManageMemberPaymentAsync(memberPaymentId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });

        if (attachment != null && attachment.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp" };
            var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Allowed: PDF, JPG, JPEG, PNG, GIF, WEBP" });
        }

        try
        {
            await _service.UpdateOfflinePaymentAsync(memberPaymentId, dto, attachment, GetUserId(), _env);
            return Ok(new { message = "Offline payment updated." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    [HttpPost("members/{memberPaymentId}/send-receipt")]
    public async Task<ActionResult> SendReceipt(int memberPaymentId, [FromBody] SendEmailRemarkDto? dto = null)
    {
        if (!await CanManageMemberPaymentAsync(memberPaymentId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.SendReceiptEmailAsync(memberPaymentId, dto?.Remark);
            return Ok(new { message = "Receipt email sent." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    [HttpPost("members/{memberPaymentId}/send-reminder-email")]
    public async Task<ActionResult> SendReminderEmail(int memberPaymentId, [FromBody] SendEmailRemarkDto? dto = null)
    {
        if (!await CanManageMemberPaymentAsync(memberPaymentId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.SendReminderEmailAsync(memberPaymentId, dto?.Remark);
            return Ok(new { message = "Reminder email sent." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    [HttpPost("{linkId}/members/bulk-reminder-email")]
    public async Task<ActionResult> BulkReminderEmail(int linkId, [FromBody] SendEmailRemarkDto? dto = null)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.BulkSendReminderEmailAsync(linkId, dto?.Remark);
            return Ok(new { message = "Bulk email reminders sent." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    [HttpDelete("{linkId}/delete-google-sheet")]
    public async Task<ActionResult> DeleteGoogleSheet(int linkId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.DeleteGoogleSheetForLinkAsync(linkId);
            return Ok(new { message = "Google Sheet deleted from Drive." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to delete Google Sheet: {ex.Message}" });
        }
    }

    [HttpPost("{linkId}/create-google-sheet")]
    public async Task<ActionResult> CreateGoogleSheet(int linkId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var sheetId = await _service.CreateGoogleSheetForLinkAsync(linkId);
            return Ok(new { googleSheetId = sheetId, message = "Google Sheet created successfully." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to create Google Sheet: {ex.Message}" });
        }
    }

    [HttpPost("{linkId}/settlement-refresh")]
    public async Task<ActionResult> RefreshSettlements(int linkId)
    {
        if (!await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.RefreshEventSettlementsAsync(linkId);
            return Ok(new { message = "Settlements refreshed." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to refresh settlements: {ex.Message}" });
        }
    }

    [HttpGet("{linkId}/settlement-report")]
    public async Task<ActionResult> GetSettlementReport(int linkId)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var result = await _service.GetEventSettlementReportAsync(linkId);
            return Ok(result);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to get settlement report: {ex.Message}" });
        }
    }

    [HttpGet("{linkId}/members/export")]
    public async Task<ActionResult> ExportMembers(int linkId, [FromQuery] bool isPaid = false)
    {
        if (!IsSuperAdminOrAdmin() || !await CanReadLinkAsync(linkId)) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var bytes = await _service.ExportMembersExcelAsync(linkId, isPaid);
            return File(bytes, "text/csv", $"event_members_{(isPaid ? "paid" : "unpaid")}_{linkId}.csv");
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }
}
