using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/membership-dues")]
[Authorize]
public class MembershipDuesController : ControllerBase
{
    private readonly IMembershipDuesService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;

    public MembershipDuesController(IMembershipDuesService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    private int? GetAdminClubId()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (roles.Contains("SuperAdmin")) return null;
        var clubId = User.FindFirst("clubId")?.Value;
        return clubId != null ? int.Parse(clubId) : null;
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

    // ── CRUD ───────────────────────────────────────────────────────

    [HttpGet("")]
    public async Task<ActionResult> GetList([FromQuery] int? clubId, [FromQuery] int? districtId, [FromQuery] string? search, [FromQuery] string? year)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var adminClubId = GetAdminClubId();
        if (adminClubId.HasValue) clubId = adminClubId.Value;
        var result = await _service.GetListAsync(clubId, districtId, search, year);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> GetDetail(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetDetailAsync(id);
        if (result == null) return NotFound(new { message = "Club dues not found." });
        return Ok(result);
    }

    [HttpPost("")]
    public async Task<ActionResult> Create([FromForm] CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            var id = await _service.CreateAsync(dto, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { id, message = "Club dues created." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to create club dues: {ex.Message}" });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromForm] CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            await _service.UpdateAsync(id, dto, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { message = "Club dues updated." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to update club dues: {ex.Message}" });
        }
    }

    [HttpPatch("{id}/basic")]
    public async Task<ActionResult> UpdateBasic(int id, [FromForm] string? purpose, [FromForm] string? purposeDescription,
        [FromForm] string? emailCC, [FromForm] string? emailSubject, [FromForm] string? emailBody,
        [FromForm] string? emailReminderSubject, [FromForm] string? emailReminderBody,
        IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var imgErr = ValidateImageFile(logo) ?? ValidateImageFile(bgImage) ?? ValidateImageFile(emailLogo);
        if (imgErr != null) return BadRequest(new { message = imgErr });
        try
        {
            await _service.UpdateBasicAsync(id, purpose, purposeDescription, emailCC, emailSubject, emailBody,
                emailReminderSubject, emailReminderBody, logo, bgImage, emailLogo, GetUserId(), _env);
            return Ok(new { message = "Club dues updated." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to update: {ex.Message}" });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.DeleteAsync(id, GetUserId());
            return Ok(new { message = "Club dues deleted." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to delete club dues: {ex.Message}" });
        }
    }

    [HttpPatch("{id}/toggle-active")]
    public async Task<ActionResult> ToggleActive(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.ToggleActiveAsync(id, GetUserId());
            return Ok(new { message = "Club dues toggled." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to toggle: {ex.Message}" });
        }
    }

    // ── Member Fees ────────────────────────────────────────────────

    [HttpGet("{id}/members")]
    public async Task<ActionResult> GetMemberFees(int id, [FromQuery] string? search, [FromQuery] string? filter)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetMemberFeesAsync(id, search, filter);
        return Ok(result);
    }

    [HttpPost("{id}/allocate")]
    public async Task<ActionResult> AllocateDefaultFees(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.AllocateDefaultFeesAsync(id, GetUserId());
            return Ok(new { message = "Default fees allocated." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to allocate fees: {ex.Message}" });
        }
    }

    [HttpPut("{id}/members/{memberFeeId}")]
    public async Task<ActionResult> UpdateMemberFee(int id, int memberFeeId, [FromBody] UpdateMemberFeeDto dto)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            Console.WriteLine($"[UpdateMemberFee] id={id}, memberFeeId={memberFeeId}, Cat={dto.CategoryType}, Annual={dto.AnnualAmount}, Semi1={dto.Semi1Amount}, Semi2={dto.Semi2Amount}");
            await _service.UpdateMemberFeeAsync(id, memberFeeId, dto, GetUserId());
            return Ok(new { message = "Member fee updated.", debug = new { dto.CategoryType, dto.AnnualAmount, dto.Semi1Amount, dto.Semi2Amount } });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to update member fee: {ex.Message}" });
        }
    }

    // ── Offline Payments ───────────────────────────────────────────

    [HttpPost("{id}/members/{memberFeeId}/offline-payment")]
    public async Task<ActionResult> RecordOfflinePayment(int id, int memberFeeId, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });

        if (attachment != null && attachment.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg" };
            var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Only images (JPG, JPEG, PNG, GIF, WEBP, BMP, SVG) or PDF are allowed." });
        }

        try
        {
            var paymentId = await _service.RecordOfflinePaymentAsync(id, memberFeeId, dto, attachment, GetUserId(), _env);
            return Ok(new { id = paymentId, message = "Offline payment recorded." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    // Pre-fill for the Update Offline dialog. Returns every field needed to
    // populate the form: txn type/id, given to, bank, cheque, date, amount,
    // remark, attachment + the row's current status so the UI knows whether
    // to show "Send updated receipt" (only meaningful when the payment is
    // Approved / Paid).
    [HttpGet("payments/{paymentId}/offline-details")]
    public async Task<ActionResult> GetOfflineDetails(int paymentId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var row = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<dynamic>(conn, @"
            SELECT pk_id                      AS paymentId,
                   fk_member_fee_id           AS memberFeeId,
                   fk_member_profile_id       AS memberId,
                   FeeType                    AS feeType,
                   Amount                     AS amount,
                   IsPaid                     AS isPaid,
                   IsOnline                   AS isOnline,
                   PaymentStatus              AS paymentStatus,
                   OfflineStatus              AS offlineStatus,
                   OfflineTransactionType     AS transactionType,
                   OfflineTransactionId       AS transactionId,
                   OfflineGivenTo             AS givenTo,
                   OfflineBankName            AS bankName,
                   OfflineChequeNumber        AS chequeNumber,
                   OfflineRemark              AS remark,
                   PaymentDate                AS paymentDate,
                   Attachment                 AS attachment
            FROM membership_dues_payments
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = paymentId });
        if (row == null) return NotFound(new { message = "Payment not found." });
        return Ok(row);
    }

    // Update an existing offline payment row WITHOUT changing IsPaid /
    // OfflineStatus / PaymentStatus / IsOnline. Used by the "Update Offline"
    // button on the admin members page — covers both Pending (member-submitted)
    // and Approved (paid) offline payments. If sendReceiptOnUpdate is true AND
    // the row is currently Approved, the receipt email is re-sent so the
    // member gets the corrected version.
    [HttpPut("payments/{paymentId}/update-offline")]
    public async Task<ActionResult> UpdateOfflinePayment(int paymentId, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment, [FromForm] bool sendReceiptOnUpdate = false)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });

        if (attachment != null && attachment.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg" };
            var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Only images (JPG, JPEG, PNG, GIF, WEBP, BMP, SVG) or PDF are allowed." });
        }

        try
        {
            await _service.UpdateOfflinePaymentAsync(paymentId, dto, attachment, GetUserId(), _env, sendReceiptOnUpdate);
            return Ok(new { message = "Offline payment updated." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    // SuperAdmin-only — removes a mistakenly-recorded offline payment (e.g. entered
    // against the wrong member). Club/district admins do NOT get this: they can still
    // correct a payment's details via update-offline, but only a SuperAdmin can make one
    // disappear entirely, since that flips a member back to Unpaid.
    [HttpDelete("payments/{paymentId}")]
    public async Task<ActionResult> DeletePayment(int paymentId)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only a SuperAdmin can remove a payment entry." });
        try
        {
            await _service.DeleteOfflinePaymentAsync(paymentId, GetUserId());
            return Ok(new { message = "Payment removed." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // SuperAdmin-only payment-status correction — flips a member fee that is currently
    // Paid back to Unpaid. This is NOT a refund: no money moves and no gateway call is
    // made. It exists for the "offline payment approved against the wrong member" case.
    // Same SuperAdmin gate as DeletePayment above, but the payment row is preserved
    // (soft-deleted + PaymentStatus='Reverted' + reason/who/when) instead of just being
    // removed, and a reason is mandatory. IAuditLogService is resolved per-action via
    // [FromServices] so the shared controller constructor stays untouched.
    [HttpPost("{id}/members/{memberFeeId}/revert-payment")]
    public async Task<ActionResult> RevertMemberFeePayment(int id, int memberFeeId, [FromBody] RevertDuesPaymentDto dto,
        [FromServices] IAuditLogService auditLog)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only a SuperAdmin can change a member's payment status." });
        try
        {
            var result = await _service.RevertMemberFeePaymentAsync(id, memberFeeId, dto, GetUserId());
            await auditLog.LogAsync(GetUserId(), "Revert Payment", "Club Dues", memberFeeId, result.MemberName,
                new
                {
                    duesId = id,
                    memberFeeId,
                    result.MemberId,
                    result.RevertedFeeTypes,
                    result.RevertedPaymentIds,
                    previousAmount = result.RevertedAmount,
                    reason = (dto.Reason ?? "").Trim(),
                    note = "Status correction only — no refund issued."
                },
                HttpContext);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to revert payment: {ex.Message}" });
        }
    }

    // Lightweight dashboard alert — returns one row per membership_dues that has at
    // least one offline payment in OfflineStatus='Pending'. Powers the club dashboard
    // popup that prompts the admin to review approvals before navigating elsewhere.
    [HttpGet("/api/clubs/{clubId}/membership-dues/pending-offline-approvals")]
    public async Task<ActionResult> GetPendingOfflineApprovals(int clubId)
    {
        if (clubId <= 0) return BadRequest(new { message = "clubId is required." });
        using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var rows = await Dapper.SqlMapper.QueryAsync<dynamic>(conn, @"
            SELECT md.pk_membership_dues_id AS duesId,
                   md.Purpose                AS purpose,
                   COUNT(p.pk_id)            AS pendingCount
            FROM membership_dues md
            INNER JOIN membership_dues_payments p
                ON p.fk_membership_dues_id = md.pk_membership_dues_id
               AND p.OfflineStatus = 'Pending'
               AND p.isdeleted = 0
            WHERE md.fk_club_id = @ClubId
              AND md.isdeleted = 0
            GROUP BY md.pk_membership_dues_id, md.Purpose
            HAVING COUNT(p.pk_id) > 0
            ORDER BY md.pk_membership_dues_id DESC",
            new { ClubId = clubId });
        return Ok(rows);
    }

    [HttpPost("payments/{paymentId}/approve-reject")]
    public async Task<ActionResult> ApproveRejectPayment(int paymentId, [FromBody] ApproveDuesPaymentDto dto)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.ApproveRejectPaymentAsync(paymentId, dto, GetUserId());
            return Ok(new { message = dto.IsApproved ? "Payment approved." : "Payment rejected." });
        }
        catch (AlreadyHandledException ex)
        {
            // Idempotent — return 200 with the explanatory message so the UI shows
            // "already approved/rejected" instead of "Failed".
            return Ok(new { alreadyHandled = true, message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed: {ex.Message}" });
        }
    }

    // ── Receipts & Reminders ───────────────────────────────────────

    // Synchronous: we want failures to surface to the UI (member has no
    // paid payment, missing email address, SMTP error, etc.) instead of
    // silently dropping them. The previous fire-and-forget hid all errors
    // behind a 200 OK toast.
    [HttpPost("payments/{paymentId}/receipt")]
    public async Task<ActionResult> SendReceipt(int paymentId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.SendReceiptEmailAsync(paymentId);
            return Ok(new { message = "Receipt email sent." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) { return StatusCode(500, new { message = $"Failed to send receipt: {ex.Message}" }); }
    }

    // Fee-id-based receipt endpoint. Introduced 2026-07-08 as the safe
    // replacement for the "Send Receipt" button on the members list — the
    // UI has a memberFeeId, not a paymentId. The old code was passing the
    // fee id into /payments/{paymentId}/receipt which occasionally hit an
    // unrelated payment row that happened to share the same pk_id, sending
    // the receipt to the wrong member.
    [HttpPost("member-fees/{memberFeeId}/send-receipt")]
    public async Task<ActionResult> SendReceiptByFeeId(int memberFeeId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.SendReceiptEmailByFeeIdAsync(memberFeeId);
            return Ok(new { message = "Receipt email sent." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) { return StatusCode(500, new { message = $"Failed to send receipt: {ex.Message}" }); }
    }

    [HttpPost("{id}/members/{memberFeeId}/reminder-email")]
    public ActionResult SendReminderEmail(int id, int memberFeeId, [FromBody] SendDuesReminderDto dto)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        _ = Task.Run(async () => { try { await _service.SendReminderEmailAsync(memberFeeId, dto.FeeType, dto.Remark); } catch { } });
        return Ok(new { message = "Reminder email is being sent." });
    }

    [HttpPost("{id}/bulk-reminder-email")]
    public ActionResult BulkSendReminderEmail(int id, [FromBody] BulkDuesReminderDto? dto = null)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        _ = Task.Run(async () => { try { await _service.BulkSendReminderEmailAsync(id, dto?.Remark); } catch { } });
        return Ok(new { message = "Bulk email reminders are being sent in background." });
    }

    // ── Settlements ───────────────────────────────────────────────

    [HttpPost("{id}/settlement-refresh")]
    public async Task<ActionResult> RefreshSettlements(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.RefreshSettlementsAsync(id);
            return Ok(new { message = "Settlements refreshed." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to refresh settlements: {ex.Message}" });
        }
    }

    [HttpGet("{id}/settlement-report")]
    public async Task<ActionResult> GetSettlementReport(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var result = await _service.GetSettlementReportAsync(id);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to get settlement report: {ex.Message}" });
        }
    }

    // ── Export ───────────────────────────────────────────────────

    [HttpGet("{id}/export")]
    public async Task<ActionResult> ExportMembers(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var bytes = await _service.ExportMembersCsvAsync(id);
            // Switched from CSV to XLSX on 2026-06-24 to support green/red Status
            // backgrounds + Settled (after 2.95%) / Payment Mode / Payment Date columns
            // that the user requested. Method name kept for backward-compat — the body
            // builds an XLSX workbook via ClosedXML.
            var ts = DateTime.Now.ToString("ddMMyyyy_HHmmss");
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"membership_dues_report_{id}_{ts}.xlsx");
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to export: {ex.Message}" });
        }
    }

    // ── Google Sheets ──────────────────────────────────────────────

    [HttpPost("{id}/create-google-sheet")]
    public async Task<ActionResult> CreateGoogleSheet(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            var sheetId = await _service.CreateGoogleSheetAsync(id);
            return Ok(new { googleSheetId = sheetId, message = "Google Sheet created successfully." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to create Google Sheet: {ex.Message}" });
        }
    }

    [HttpDelete("{id}/delete-google-sheet")]
    public async Task<ActionResult> DeleteGoogleSheet(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        try
        {
            await _service.DeleteGoogleSheetAsync(id);
            return Ok(new { message = "Google Sheet deleted from Drive." });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to delete Google Sheet: {ex.Message}" });
        }
    }
}
