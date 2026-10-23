using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile-facing twin of the web /api/membership-dues admin surface, scoped
// for the Flutter Club Admin app. Reuses IMembershipDuesService so behaviour
// — including the auto-approve-on-Pending logic inside UpdateOfflinePaymentAsync
// and the AlreadyHandledException short-circuit inside ApproveRejectPaymentAsync —
// stays single-sourced with the web. Authorisation mirrors the web controller:
// SuperAdmin or Admin only.
[ApiController]
[Route("api/mobile/club-admin/membership-dues")]
[Authorize]
public class MobileClubAdminMembershipDuesController : ControllerBase
{
    private readonly IMembershipDuesService _service;
    private readonly IWebHostEnvironment _env;

    public MobileClubAdminMembershipDuesController(IMembershipDuesService service, IWebHostEnvironment env)
    {
        _service = service;
        _env = env;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    // SuperAdmin → null (no club filter). Club Admin → their clubId.
    private int? GetScopedClubId()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (roles.Contains("SuperAdmin")) return null;
        var clubId = User.FindFirst("clubId")?.Value;
        return int.TryParse(clubId, out var cid) ? cid : (int?)null;
    }

    // ── List / Detail ──────────────────────────────────────────────

    // GET /api/mobile/club-admin/membership-dues?clubId=&districtId=&search=&year=
    // SuperAdmin sees everything; Club Admin is auto-scoped to their club
    // regardless of any clubId query value to prevent cross-club access.
    [HttpGet("")]
    public async Task<ActionResult> GetList([FromQuery] int? clubId, [FromQuery] int? districtId, [FromQuery] string? search, [FromQuery] string? year)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var scopedClub = GetScopedClubId() ?? clubId;
        var result = await _service.GetListAsync(scopedClub, districtId, search, year);
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

    // ── Members ────────────────────────────────────────────────────

    [HttpGet("{id}/members")]
    public async Task<ActionResult> GetMembers(int id, [FromQuery] string? search, [FromQuery] string? filter)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var result = await _service.GetMemberFeesAsync(id, search, filter);
        return Ok(result);
    }

    // ── Offline Payments ───────────────────────────────────────────

    // Record a new offline payment (admin-entered, defaults to Approved
    // server-side — matches web flow).
    [HttpPost("{id}/members/{memberFeeId}/offline-payment")]
    public async Task<ActionResult> RecordOfflinePayment(int id, int memberFeeId, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var err = ValidateAttachment(attachment);
        if (err != null) return BadRequest(new { message = err });

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

    // Pre-fill payload for the mobile Offline Entry editor — mirrors the
    // web /payments/{paymentId}/offline-details endpoint.
    [HttpGet("payments/{paymentId}/offline-details")]
    public async Task<ActionResult> GetOfflineDetails(int paymentId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        using var conn = new MySqlConnector.MySqlConnection(HttpContext.RequestServices
            .GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")!);
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

    // Update an existing offline payment. The underlying service handles the
    // Pending → Approved transition automatically: on save, if the row is
    // currently Pending, OfflineStatus/PaymentStatus flip to Approved,
    // ApprovedBy / ApprovedDate are set, ApprovalSource is 'admin-portal',
    // ApprovalRemark falls back to a default when blank, and a receipt email
    // fires. If CP/Secretary later clicks the email link, ApproveRejectPaymentAsync
    // returns AlreadyHandled. For already-Approved rows, this is a data edit;
    // sendReceiptOnUpdate re-sends the receipt with the corrected info.
    [HttpPut("payments/{paymentId}/update-offline")]
    public async Task<ActionResult> UpdateOfflinePayment(int paymentId, [FromForm] RecordOfflineDuesPaymentDto dto, IFormFile? attachment, [FromForm] bool sendReceiptOnUpdate = false)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var err = ValidateAttachment(attachment);
        if (err != null) return BadRequest(new { message = err });

        try
        {
            await _service.UpdateOfflinePaymentAsync(paymentId, dto, attachment, GetUserId(), _env, sendReceiptOnUpdate);
            return Ok(new { message = "Offline payment updated." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (ArgumentException ex)   { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex)            { return StatusCode(500, new { message = $"Failed: {ex.Message}" }); }
    }

    // ── Approve / Reject ───────────────────────────────────────────

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
            return Ok(new { alreadyHandled = true, message = ex.Message });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) { return StatusCode(500, new { message = $"Failed: {ex.Message}" }); }
    }

    // Dashboard alert — one row per dues that has at least one pending offline
    // approval. The web endpoint is scoped by {clubId}; here we derive the
    // club from the JWT (Club Admin) or accept the query arg (SuperAdmin).
    [HttpGet("pending-offline-approvals")]
    public async Task<ActionResult> GetPendingOfflineApprovals([FromQuery] int? clubId = null)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var scopedClub = GetScopedClubId() ?? clubId;
        if (scopedClub == null || scopedClub <= 0) return BadRequest(new { message = "clubId is required." });

        using var conn = new MySqlConnector.MySqlConnection(HttpContext.RequestServices
            .GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")!);
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
            new { ClubId = scopedClub });
        return Ok(rows);
    }

    // ── Receipts & Reminders ───────────────────────────────────────

    [HttpPost("payments/{paymentId}/receipt")]
    public ActionResult SendReceipt(int paymentId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        _ = Task.Run(async () => { try { await _service.SendReceiptEmailAsync(paymentId); } catch { } });
        return Ok(new { message = "Receipt email is being sent." });
    }

    [HttpPost("{id}/members/{memberFeeId}/reminder-email")]
    public ActionResult SendReminderEmail(int id, int memberFeeId, [FromBody] SendDuesReminderDto dto)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        _ = Task.Run(async () => { try { await _service.SendReminderEmailAsync(memberFeeId, dto.FeeType, dto.Remark); } catch { } });
        return Ok(new { message = "Reminder email is being sent." });
    }

    // Bulk reminders skip fully-paid members inside BulkSendReminderEmailAsync — only unpaid members get notified.
    [HttpPost("{id}/bulk-reminder-email")]
    public ActionResult BulkSendReminderEmail(int id, [FromBody] BulkDuesReminderDto? dto = null)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        _ = Task.Run(async () => { try { await _service.BulkSendReminderEmailAsync(id, dto?.Remark); } catch { } });
        return Ok(new { message = "Bulk email reminders are being sent in background." });
    }

    // ── Helpers ───────────────────────────────────────────────────

    private static string? ValidateAttachment(IFormFile? attachment)
    {
        if (attachment == null || attachment.Length == 0) return null;
        var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg" };
        var extension = System.IO.Path.GetExtension(attachment.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(extension))
            return "Invalid file type. Only images (JPG, JPEG, PNG, GIF, WEBP, BMP, SVG) or PDF are allowed.";
        return null;
    }
}
