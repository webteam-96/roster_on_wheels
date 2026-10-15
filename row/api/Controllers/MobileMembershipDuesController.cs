using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/my-membership-dues")]
[Authorize]
public class MobileMembershipDuesController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IDuesReceiptService _receiptService;

    public MobileMembershipDuesController(IConfiguration config, IDuesReceiptService receiptService)
    {
        _config = config;
        _receiptService = receiptService;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    // TryParse (not Parse) so a malformed/absent memberId claim yields 0 — which
    // every caller treats as "not authenticated" — instead of throwing a 500.
    // Matches the convention in MobileClubDuesController.GetMemberId().
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var x) ? x : 0;

    // Build the signed deep-link the Flutter app surfaces as the "Pay" CTA.
    // The public /pay/dues/{duesId} page accepts ?memberId=&token= and skips
    // the OTP step when the signature verifies.
    private string BuildSignedPayUrl(int duesId, int memberId)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        var token = MobileDuesAccessToken.Generate(duesId, memberId, secret);
        var frontendUrl = (_config["FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/');
        return $"{frontendUrl}/pay/dues/{duesId}?memberId={memberId}&token={Uri.EscapeDataString(token)}&from=mobile";
    }

    // ── Get all club dues for logged-in user across all clubs ──
    [HttpGet]
    public async Task<ActionResult> GetMyDues()
    {
        var memberId = GetUserId();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var items = await conn.QueryAsync<dynamic>(@"
            SELECT md.pk_membership_dues_id AS duesId,
                   md.RotaryYear AS rotaryYear,
                   md.Purpose AS purpose,
                   md.PurposeLogo AS purposeLogo,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   d.DistrictNumber AS districtNumber,
                   mf.pk_id AS memberFeeId,
                   mf.CategoryType AS categoryType,
                   md.IsFees1 AS isFees1, md.IsFees2 AS isFees2, md.IsFees3 AS isFees3,
                   md.Fees1Text AS fees1Text, md.Fees2Text AS fees2Text, md.Fees3Text AS fees3Text,
                   mf.AnnualAmount AS annualAmount,
                   mf.Semi1Amount AS semi1Amount,
                   mf.Semi2Amount AS semi2Amount,
                   md.WeblinkUrl AS weblinkUrl,
                   md.fk_weblink_id AS weblinkId
            FROM membership_dues md
            JOIN club_master c ON c.pk_club_id = md.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = md.fk_district_id
            JOIN club_members cm ON cm.fk_club_id = md.fk_club_id
                 AND cm.fk_member_master_profile_id = @MemberId
                 AND cm.IsActive = 1 AND cm.isdeleted = 0
            -- INNER join, matching the admin-facing member-fees list
            -- (MembershipDuesService.GetMemberFeesAsync) exactly: a member only
            -- appears once they have an actual allocated fee row, and the
            -- amount shown is that row's real amount — never a fallback to the
            -- campaign's default. The old LEFT JOIN + COALESCE(mf.Amount,
            -- md.DefaultAmount) meant an unallocated/edge-case member saw the
            -- CAMPAIGN default here while the admin portal (which requires a
            -- real row) showed their actual — possibly different — amount.
            JOIN membership_dues_member_fees mf ON mf.fk_membership_dues_id = md.pk_membership_dues_id
                 AND mf.fk_member_profile_id = @MemberId AND mf.isdeleted = 0
            WHERE md.IsActive = 1 AND md.isdeleted = 0
            ORDER BY md.RotaryYear DESC, c.ClubName",
            new { MemberId = memberId });

        // For each dues, get payment status per fee type
        var result = new List<object>();
        foreach (var item in items)
        {
            int duesId = (int)item.duesId;
            int? memberFeeId = item.memberFeeId as int?;

            var payments = await conn.QueryAsync<dynamic>(@"
                SELECT pk_id AS paymentId, FeeType AS feeType, Amount AS amount,
                       IsPaid AS isPaid, IsOnline AS isOnline,
                       PaymentStatus AS paymentStatus, PaymentDate AS paymentDate,
                       TransactionId AS transactionId, PaidSource AS paidSource,
                       OfflineStatus AS offlineStatus
                FROM membership_dues_payments
                WHERE fk_membership_dues_id = @DuesId
                  AND fk_member_profile_id = @MemberId
                  AND isdeleted = 0
                ORDER BY FeeType",
                new { DuesId = duesId, MemberId = memberId });

            // Build fee breakdown
            var fees = new List<object>();

            if (Convert.ToBoolean(item.isFees1))
            {
                var p = payments.FirstOrDefault(x => (int)x.feeType == 1);
                fees.Add(new
                {
                    feeType = 1,
                    label = (string)item.fees1Text,
                    amount = (decimal)item.annualAmount,
                    isPaid = p != null && Convert.ToBoolean(p.isPaid),
                    paymentStatus = p != null ? (string?)p.paymentStatus : "Unpaid",
                    paymentDate = p?.paymentDate,
                    transactionId = p?.transactionId,
                    paymentId = p?.paymentId,   // receipt key; null for unpaid fees
                });
            }
            if (Convert.ToBoolean(item.isFees2))
            {
                var p = payments.FirstOrDefault(x => (int)x.feeType == 2);
                fees.Add(new
                {
                    feeType = 2,
                    label = (string)item.fees2Text,
                    amount = (decimal)item.semi1Amount,
                    isPaid = p != null && Convert.ToBoolean(p.isPaid),
                    paymentStatus = p != null ? (string?)p.paymentStatus : "Unpaid",
                    paymentDate = p?.paymentDate,
                    transactionId = p?.transactionId,
                    paymentId = p?.paymentId,   // receipt key; null for unpaid fees
                });
            }
            if (Convert.ToBoolean(item.isFees3))
            {
                var p = payments.FirstOrDefault(x => (int)x.feeType == 3);
                fees.Add(new
                {
                    feeType = 3,
                    label = (string)item.fees3Text,
                    amount = (decimal)item.semi2Amount,
                    isPaid = p != null && Convert.ToBoolean(p.isPaid),
                    paymentStatus = p != null ? (string?)p.paymentStatus : "Unpaid",
                    paymentDate = p?.paymentDate,
                    transactionId = p?.transactionId,
                    paymentId = p?.paymentId,   // receipt key; null for unpaid fees
                });
            }

            // Build pay URL — prefer the per-member signed deep-link so the
            // member skips the OTP step. Falls back to the legacy weblink only
            // if no JWT secret is configured (shouldn't happen in prod).
            string? payUrl = BuildSignedPayUrl(duesId, memberId);
            if (string.IsNullOrWhiteSpace(payUrl))
            {
                if (!string.IsNullOrWhiteSpace((string?)item.weblinkUrl))
                    payUrl = (string)item.weblinkUrl;
                else if (item.weblinkId != null)
                {
                    var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
                    payUrl = $"{frontendUrl}/pay/{(int)item.weblinkId}";
                }
            }

            result.Add(new
            {
                duesId = duesId,
                clubId = (int)item.clubId,
                clubName = (string)item.clubName,
                districtNumber = (string)item.districtNumber,
                rotaryYear = (string)item.rotaryYear,
                purpose = (string?)item.purpose,
                purposeLogo = (string?)item.purposeLogo,
                categoryType = (string?)(item.categoryType) ?? "Standard",
                payUrl,
                fees,
            });
        }

        return Ok(result);
    }

    // ── Per-dues detail for the logged-in member ──────────────────────────
    // Mobile-only — returns paid/unpaid breakdown for ONE dues. Used by the
    // Flutter app to render the dues detail screen with a smart fee selector:
    //   Annual paid           → nothing payable.
    //   Semi1 OR Semi2 paid   → other half still payable; Annual hidden.
    //   Nothing paid          → all enabled fee types selectable.
    // Each paid fee includes its mode (Online / Offline + offline subtype),
    // transaction id, amount, and date so the app can show full receipt info.
    [HttpGet("{duesId}")]
    public async Task<ActionResult> GetMyDuesDetail(int duesId)
    {
        var memberId = GetUserId();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT md.pk_membership_dues_id AS duesId,
                   md.RotaryYear AS rotaryYear,
                   md.Purpose AS purpose,
                   md.PurposeDescription AS purposeDescription,
                   md.PurposeLogo AS purposeLogo,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   d.DistrictNumber AS districtNumber,
                   md.IsFees1 AS isFees1, md.IsFees2 AS isFees2, md.IsFees3 AS isFees3,
                   md.Fees1Text AS fees1Text, md.Fees2Text AS fees2Text, md.Fees3Text AS fees3Text
            FROM membership_dues md
            JOIN club_master c ON c.pk_club_id = md.fk_club_id
            JOIN district_master d ON d.pk_district_id = md.fk_district_id
            WHERE md.pk_membership_dues_id = @DuesId
              AND md.isdeleted = 0 AND md.IsActive = 1",
            new { DuesId = duesId });
        if (dues == null) return NotFound(new { message = "Club dues not found." });

        // Member's fee allocation row — drives the amount per fee type.
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS memberFeeId,
                   COALESCE(AnnualAmount, 0) AS annualAmount,
                   COALESCE(Semi1Amount, 0)  AS semi1Amount,
                   COALESCE(Semi2Amount, 0)  AS semi2Amount
            FROM membership_dues_member_fees
            WHERE fk_membership_dues_id = @DuesId
              AND fk_member_profile_id = @MemberId
              AND isdeleted = 0",
            new { DuesId = duesId, MemberId = memberId });
        if (fee == null)
            return NotFound(new { message = "You don't have a fee allocation for this club dues." });

        // Latest paid row per fee type (any status that means paid).
        var paid = (await conn.QueryAsync<dynamic>(@"
            SELECT p.FeeType        AS feeType,
                   p.pk_id          AS paymentId,
                   p.Amount         AS amount,
                   p.IsOnline       AS isOnline,
                   CASE WHEN p.IsOnline = 1 THEN 'Payment Gateway'
                        ELSE COALESCE(p.OfflineTransactionType, 'Cash') END AS mode,
                   CASE WHEN p.IsOnline = 1 THEN p.TransactionId
                        ELSE p.OfflineTransactionId END AS transactionId,
                   p.PaymentDate    AS paymentDate,
                   p.PaymentStatus  AS paymentStatus,
                   p.OfflineStatus  AS offlineStatus
            FROM membership_dues_payments p
            WHERE p.fk_membership_dues_id = @DuesId
              AND p.fk_member_profile_id = @MemberId
              AND p.IsPaid = 1
              AND p.isdeleted = 0
            ORDER BY p.PaymentDate DESC",
            new { DuesId = duesId, MemberId = memberId })).ToList();

        bool annualPaid = paid.Any(p => (int)p.feeType == 1);
        bool semi1Paid  = paid.Any(p => (int)p.feeType == 2);
        bool semi2Paid  = paid.Any(p => (int)p.feeType == 3);

        var enabledFees = new List<(int Type, string Label, decimal Amount)>();
        if (Convert.ToBoolean(dues.isFees1)) enabledFees.Add((1, (string)dues.fees1Text ?? "Annual", (decimal)fee.annualAmount));
        if (Convert.ToBoolean(dues.isFees2)) enabledFees.Add((2, (string)dues.fees2Text ?? "Semi 1", (decimal)fee.semi1Amount));
        if (Convert.ToBoolean(dues.isFees3)) enabledFees.Add((3, (string)dues.fees3Text ?? "Semi 2", (decimal)fee.semi2Amount));

        var payableFees = new List<object>();
        var paidFees = new List<object>();

        foreach (var ft in enabledFees)
        {
            var paidRow = paid.FirstOrDefault(p => (int)p.feeType == ft.Type);
            if (paidRow != null)
            {
                paidFees.Add(new
                {
                    feeType = ft.Type,
                    label = ft.Label,
                    amount = (decimal)paidRow.amount,
                    mode = (string?)paidRow.mode,
                    isOnline = Convert.ToInt32(paidRow.isOnline) == 1,
                    transactionId = (string?)paidRow.transactionId,
                    paymentDate = paidRow.paymentDate,
                    paymentStatus = (string?)paidRow.paymentStatus,
                    paymentId = paidRow.paymentId,   // receipt key (detail parity with the list)
                });
                continue;
            }
            // Smart filter — if Annual is paid nothing else is payable; if Semi
            // paid then Annual hidden (can't mix whole + half).
            if (annualPaid) continue;
            if (ft.Type == 1 && (semi1Paid || semi2Paid)) continue;
            payableFees.Add(new { feeType = ft.Type, label = ft.Label, amount = ft.Amount });
        }

        var payUrl = BuildSignedPayUrl(duesId, memberId);

        return Ok(new
        {
            duesId,
            clubId = (int)dues.clubId,
            clubName = (string)dues.clubName,
            districtNumber = (string?)dues.districtNumber,
            rotaryYear = (string?)dues.rotaryYear,
            purpose = (string?)dues.purpose,
            purposeDescription = (string?)dues.purposeDescription,
            purposeLogo = (string?)dues.purposeLogo,
            payUrl,
            payableFees,
            paidFees,
            totalOutstanding = payableFees.Sum(f => (decimal)((dynamic)f).amount),
            fullyPaid = payableFees.Count == 0
        });
    }

    // ── Payment receipt ──────────────────────────────────────────────────
    // The member's own receipt for a membership-dues payment, as a downloadable
    // PDF. Content is the same receipt MembershipDuesService.SendReceiptEmailAsync
    // e-mails on payment (same meta rows, same fee table, same amounts, same
    // transaction references) — see DuesReceiptService.
    //
    // AUTH: the member is resolved from the JWT `memberId` claim ONLY. The
    // paymentId in the route is never trusted by itself — DuesReceiptService
    // proves the payment belongs to the caller before returning anything, and
    // refuses any payment that is not IsPaid=1.
    //
    // Returns application/pdf bytes (not base64) so the Flutter app can write
    // the response straight to a file and hand it to the OS share/print/open
    // sheet, with no 33% base64 inflation and no extra decode step.
    // NOTE: deliberately no [Produces("application/pdf")] — that attribute
    // restricts the output formatters for ALL results on the action, so the
    // 403/404/400 JSON error bodies below would fail content negotiation with a
    // 406 and the app would get an empty response instead of the reason. File()
    // sets the PDF content type on the success path by itself.
    [HttpGet("payments/{paymentId:int}/receipt")]
    [ProducesResponseType(typeof(FileResult), StatusCodes.Status200OK)]
    public async Task<ActionResult> GetPaymentReceiptPdf(int paymentId)
    {
        var memberId = GetUserId();
        if (memberId <= 0) return StatusCode(403, new { message = "Not authenticated." });

        try
        {
            var receipt = await _receiptService.GetReceiptAsync(paymentId, memberId);
            var pdf = DuesReceiptPdfBuilder.Build(receipt);

            // Filename is safe by construction (digits only) — no user-controlled
            // text goes into the Content-Disposition header.
            var fileName = $"receipt-{receipt.DuesId}-{receipt.PaymentId}.pdf";
            return File(pdf, "application/pdf", fileName);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (ReceiptForbiddenException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (ReceiptNotPayableException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // JSON twin of the endpoint above — the same receipt model the PDF is
    // rendered from. Offered so the app can show the receipt as a native screen
    // (and only download the PDF when the member taps Share/Save) without a
    // second source of truth for the numbers. Identical auth + paid guards.
    [HttpGet("payments/{paymentId:int}/receipt/data")]
    public async Task<ActionResult> GetPaymentReceiptData(int paymentId)
    {
        var memberId = GetUserId();
        if (memberId <= 0) return StatusCode(403, new { message = "Not authenticated." });

        try
        {
            return Ok(await _receiptService.GetReceiptAsync(paymentId, memberId));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (ReceiptForbiddenException ex) { return StatusCode(403, new { message = ex.Message }); }
        catch (ReceiptNotPayableException ex) { return BadRequest(new { message = ex.Message }); }
    }
}
