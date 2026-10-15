using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Token-based offline-approval surface for the District Treasurer / approver
// email. The signed ClubDuesApprovalToken IS the authorisation — no login. The
// same token works for both Approve and Reject; the recipient chooses on the page.
[ApiController]
[Route("api/public/club-dues-approval")]
[AllowAnonymous]
public class PublicClubDuesApprovalController : ControllerBase
{
    private readonly IClubDuesService _service;
    private readonly IConfiguration _config;
    private readonly string _connStr;

    public PublicClubDuesApprovalController(IClubDuesService service, IConfiguration config)
    {
        _service = service;
        _config = config;
        _connStr = config.GetConnectionString("DefaultConnection")!;
    }

    // Snapshot of the payment awaiting approval.
    [HttpGet("{token}")]
    public async Task<ActionResult> Get(string token)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        if (!ClubDuesApprovalToken.TryVerify(token, secret, out var payload, out var error))
            return Unauthorized(new { message = error });

        await using var conn = new MySqlConnection(_connStr);
        // camelCase aliases: this row is returned as a Dapper `dynamic` (DapperRow), whose keys are
        // serialized VERBATIM (the JSON camelCase policy only applies to typed objects), so the SQL
        // aliases must already be camelCase to match the approval page (info.amount, info.clubName…).
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.pk_club_dues_payment_id AS paymentId, p.Amount AS amount, p.MemberCountCovered AS memberCountCovered, p.OfflineStatus AS offlineStatus,
                   p.OfflineTransactionType AS offlineTransactionType, p.OfflineTransactionId AS offlineTransactionId, p.OfflineGivenTo AS offlineGivenTo, p.OfflineBankName AS offlineBankName,
                   p.OfflineChequeNumber AS offlineChequeNumber, p.OfflineRemark AS offlineRemark, p.Attachment AS attachment, p.PaymentDate AS paymentDate,
                   cd.Purpose AS purpose, cd.RotaryYear AS rotaryYear, d.DistrictNumber AS districtNumber, c.ClubName AS clubName
            FROM club_dues_payments p
            JOIN club_dues cd ON cd.pk_club_dues_id = p.fk_club_dues_id
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON p.fk_club_id = c.pk_club_id
            WHERE p.pk_club_dues_payment_id = @Id AND p.isdeleted = 0", new { Id = payload!.PaymentId });
        if (info == null) return NotFound(new { message = "Payment not found." });
        return Ok(info);
    }

    // Apply approve/reject. Idempotent — returns alreadyHandled if already decided.
    [HttpPost("{token}")]
    public async Task<ActionResult> Decide(string token, [FromBody] ApproveClubDuesPaymentDto dto)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        if (!ClubDuesApprovalToken.TryVerify(token, secret, out var payload, out var error))
            return Unauthorized(new { message = error });
        try
        {
            await _service.ApproveRejectPaymentAsync(payload!.PaymentId, dto, payload.ActorMemberId);
            return Ok(new { message = dto.IsApproved ? "Approved." : "Rejected." });
        }
        catch (AlreadyHandledException ex)
        {
            return Ok(new { alreadyHandled = true, message = ex.Message });
        }
    }
}
