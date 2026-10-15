using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public approval flow for offline membership-dues payments.
//
// Token-based: each Club President / Secretary receives an email with a
// personalised URL of the form {FrontendUrl}/dues-approval/{token}. The
// frontend loads the payment summary via GET here, and applies the action
// via POST. No login required — the HMAC token IS the auth.
//
// The actor (President or Secretary) is encoded in the token, so the audit
// columns ApprovedBy / ApprovedSource / RejectedBy / RejectionSource record
// who clicked and how, even though they're not admin users.
[ApiController]
[Route("api/public/dues-approval")]
[AllowAnonymous]
public class PublicDuesApprovalController : ControllerBase
{
    private readonly string _connectionString;
    private readonly string _signingSecret;

    public PublicDuesApprovalController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _signingSecret = config["JwtSettings:Secret"]!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public class ActionRequest
    {
        public string Action { get; set; } = "";  // "approve" | "reject"
        public string? ApprovalRemark { get; set; }
        public string? RejectionReason { get; set; }
    }

    [HttpGet("{token}")]
    public async Task<ActionResult> Get(string token)
    {
        if (!MembershipDuesApprovalToken.TryVerify(token, _signingSecret, out var p, out var error))
            return Unauthorized(new { message = error ?? "Invalid token." });
        return await BuildSnapshotAsync(p!.PaymentId, p.ActorMemberId);
    }

    [HttpPost("{token}")]
    public async Task<ActionResult> Apply(string token, [FromBody] ActionRequest req)
    {
        if (!MembershipDuesApprovalToken.TryVerify(token, _signingSecret, out var p, out var error))
            return Unauthorized(new { message = error ?? "Invalid token." });

        var actionLower = (req?.Action ?? "").Trim().ToLowerInvariant();
        if (actionLower != "approve" && actionLower != "reject")
            return BadRequest(new { message = "Action must be 'approve' or 'reject'." });

        if (actionLower == "reject" && string.IsNullOrWhiteSpace(req?.RejectionReason))
            return BadRequest(new { message = "Rejection reason is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, OfflineStatus FROM membership_dues_payments WHERE pk_id=@Id AND isdeleted=0",
            new { Id = p!.PaymentId });
        if (row == null) return NotFound(new { message = "Payment not found." });

        var currentStatus = ((string?)row.OfflineStatus ?? "").Trim();
        // Idempotent — return the current snapshot with an "already handled" flag.
        if (string.Equals(currentStatus, "Approved", StringComparison.OrdinalIgnoreCase)
            || string.Equals(currentStatus, "Rejected", StringComparison.OrdinalIgnoreCase))
        {
            return await BuildSnapshotAsync(p.PaymentId, p.ActorMemberId, alreadyHandled: true);
        }

        if (actionLower == "approve")
        {
            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET
                    IsPaid=1, PaymentStatus='Approved', OfflineStatus='Approved',
                    ApprovedBy=@ActorId, ApprovedDate=NOW(),
                    ApprovalRemark=@Remark, ApprovalSource='email-link',
                    modified_by=@ActorId, modified_date=NOW()
                WHERE pk_id=@Id",
                new
                {
                    Id = p.PaymentId,
                    ActorId = p.ActorMemberId,
                    Remark = string.IsNullOrWhiteSpace(req!.ApprovalRemark) ? null : req.ApprovalRemark.Trim()
                });
        }
        else
        {
            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET
                    PaymentStatus='Rejected', OfflineStatus='Rejected',
                    RejectedBy=@ActorId, RejectedDate=NOW(),
                    RejectionReason=@Reason, RejectionSource='email-link',
                    modified_by=@ActorId, modified_date=NOW()
                WHERE pk_id=@Id",
                new
                {
                    Id = p.PaymentId,
                    ActorId = p.ActorMemberId,
                    Reason = req!.RejectionReason!.Trim()
                });
        }

        return await BuildSnapshotAsync(p.PaymentId, p.ActorMemberId);
    }

    private async Task<ActionResult> BuildSnapshotAsync(int paymentId, int actorMemberId, bool alreadyHandled = false)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var details = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.pk_id                AS PaymentId,
                   p.OfflineStatus        AS OfflineStatus,
                   p.PaymentStatus        AS PaymentStatus,
                   p.FeeType,
                   p.Amount,
                   p.PaymentDate,
                   p.OfflineTransactionType,
                   p.OfflineTransactionId,
                   p.OfflineGivenTo,
                   p.OfflineBankName,
                   p.OfflineChequeNumber,
                   p.OfflineRemark,
                   p.Attachment,
                   p.ApprovalRemark,
                   p.RejectionReason,
                   p.ApprovedBy           AS ApprovedById,
                   p.ApprovedDate,
                   p.ApprovalSource,
                   p.RejectedBy           AS RejectedById,
                   p.RejectedDate,
                   p.RejectionSource,
                   m.MemberName           AS MemberName,
                   m.EmailId              AS MemberEmail,
                   md.Purpose,
                   md.RotaryYear,
                   md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   d.DistrictNumber,
                   c.ClubName,
                   approver.MemberName    AS ApprovedByName,
                   rejecter.MemberName    AS RejectedByName,
                   actor.MemberName       AS ActorName,
                   actor.EmailId          AS ActorEmail,
                   dm_actor.designation_name AS ActorDesignation
            FROM membership_dues_payments p
            JOIN membership_dues_member_fees f ON p.fk_member_fee_id = f.pk_id
            JOIN member_master_profile m       ON p.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md            ON p.fk_membership_dues_id = md.pk_membership_dues_id
            LEFT JOIN district_master d        ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c            ON md.fk_club_id = c.pk_club_id
            LEFT JOIN member_master_profile approver ON p.ApprovedBy = approver.pk_member_master_profile_id
            LEFT JOIN member_master_profile rejecter ON p.RejectedBy = rejecter.pk_member_master_profile_id
            LEFT JOIN member_master_profile actor    ON actor.pk_member_master_profile_id = @ActorId
            LEFT JOIN board_of_directors bod
                   ON bod.fk_member_master_profile_id = @ActorId
                  AND bod.fk_club_id = md.fk_club_id
                  AND COALESCE(bod.isdeleted, 0) = 0
                  AND bod.fk_year_id = (
                      SELECT pk_year_id FROM rotary_year_master
                      WHERE YearLabel = md.RotaryYear LIMIT 1
                  )
            LEFT JOIN designation_master dm_actor ON dm_actor.pk_designation_id = bod.fk_designation_id
            WHERE p.pk_id = @Id AND p.isdeleted = 0
            LIMIT 1",
            new { Id = paymentId, ActorId = actorMemberId });

        if (details == null) return NotFound(new { message = "Payment not found." });

        int feeType = Convert.ToInt32(details.FeeType);
        string feeLabel = feeType switch
        {
            1 => (string?)details.Fees1Text ?? "Annual",
            2 => (string?)details.Fees2Text ?? "Semi-Annual 1",
            3 => (string?)details.Fees3Text ?? "Semi-Annual 2",
            _ => "Dues"
        };

        return Ok(new
        {
            paymentId,
            status = (string?)details.OfflineStatus,
            alreadyHandled,
            member = new
            {
                name = (string?)details.MemberName,
                email = (string?)details.MemberEmail
            },
            club = new
            {
                name = (string?)details.ClubName,
                districtNumber = (string?)details.DistrictNumber
            },
            dues = new
            {
                purpose = (string?)details.Purpose,
                rotaryYear = (string?)details.RotaryYear,
                feeType,
                feeLabel,
                amount = details.Amount,
                paymentDate = details.PaymentDate,
                transactionType = (string?)details.OfflineTransactionType,
                transactionId = (string?)details.OfflineTransactionId,
                givenTo = (string?)details.OfflineGivenTo,
                bankName = (string?)details.OfflineBankName,
                chequeNumber = (string?)details.OfflineChequeNumber,
                memberRemark = (string?)details.OfflineRemark,
                attachment = (string?)details.Attachment
            },
            actor = new
            {
                memberId = actorMemberId,
                name = (string?)details.ActorName,
                email = (string?)details.ActorEmail,
                designation = (string?)details.ActorDesignation
            },
            handled = new
            {
                approvedOn = details.ApprovedDate,
                approvedByName = (string?)details.ApprovedByName,
                approvalRemark = (string?)details.ApprovalRemark,
                approvalSource = (string?)details.ApprovalSource,
                rejectedOn = details.RejectedDate,
                rejectedByName = (string?)details.RejectedByName,
                rejectionReason = (string?)details.RejectionReason,
                rejectionSource = (string?)details.RejectionSource
            }
        });
    }
}
