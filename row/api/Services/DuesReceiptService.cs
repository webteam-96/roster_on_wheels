using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  MEMBERSHIP-DUES RECEIPT (structured, for the mobile app)
// ═══════════════════════════════════════════════════════════════════════════
// Read-only twin of MembershipDuesService.SendReceiptEmailAsync. It resolves
// the SAME rows, applies the SAME fee-type labels and the SAME surcharge
// back-out maths, so the PDF/JSON the Flutter app gets is field-for-field the
// receipt the member already had by e-mail.
//
// Deliberately a SEPARATE service rather than a refactor of
// MembershipDuesService: that class owns the live e-mail/receipt/webhook paths
// and is being edited concurrently. Nothing here mutates state — no
// IsReceiptSent flip, no e-mail, no credit deduction. It is SELECT-only.
//
// SECURITY: every read is scoped by the caller's memberId. The paymentId in
// the URL is never trusted on its own; ownership is proved against
// membership_dues_member_fees.fk_member_profile_id before any data is
// returned.
public class DuesReceiptService : IDuesReceiptService
{
    private readonly string _connStr;
    private readonly ILogger<DuesReceiptService> _logger;

    public DuesReceiptService(IConfiguration config, ILogger<DuesReceiptService> logger)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    public async Task<DuesReceiptDto> GetReceiptAsync(int paymentId, int memberId)
    {
        if (memberId <= 0)
            throw new ReceiptForbiddenException("Not authenticated.");

        using var conn = new MySqlConnection(_connStr);
        await conn.OpenAsync();

        // Fetch the payment WITHOUT filtering on the member, so we can tell
        // "does not exist" (404) apart from "not yours" (403) and log the
        // latter. The row itself is never returned unless ownership passes.
        var p = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.pk_id, p.fk_member_profile_id, p.fk_member_fee_id, p.fk_membership_dues_id,
                   p.IsPaid, p.PaymentStatus, p.PaymentDate, p.ApprovalRemark,
                   f.fk_member_profile_id AS FeeMemberId,
                   m.MemberName,
                   mf.MemberName AS FeeMemberName,
                   md.pk_membership_dues_id AS DuesId, md.Purpose,
                   md.Fees1Text, md.Fees2Text, md.Fees3Text, md.OnlineSurchargePercent,
                   d.DistrictNumber, c.ClubName
            FROM membership_dues_payments p
            LEFT JOIN membership_dues_member_fees f ON p.fk_member_fee_id = f.pk_id
            LEFT JOIN member_master_profile m  ON p.fk_member_profile_id = m.pk_member_master_profile_id
            LEFT JOIN member_master_profile mf ON f.fk_member_profile_id  = mf.pk_member_master_profile_id
            LEFT JOIN membership_dues md ON p.fk_membership_dues_id = md.pk_membership_dues_id
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE p.pk_id = @Id AND p.isdeleted = 0",
            new { Id = paymentId });

        if (p == null)
            throw new KeyNotFoundException("Receipt not found.");

        // ── OWNERSHIP ────────────────────────────────────────────────────
        // membership_dues_member_fees.fk_member_profile_id is the authoritative
        // "whose fee is this" column (MembershipDuesService treats it as the
        // trustworthy one when the payment's own FK is stale). Both FKs must
        // resolve to the caller: if they disagree the row is ambiguous, and the
        // safe direction is to refuse rather than risk exposing someone else's
        // payment. Verified against prod: 0 of 1429 paid rows disagree, so this
        // locks out no legitimate member.
        int feeMemberId = Convert.ToInt32(p.FeeMemberId ?? 0);
        int payMemberId = Convert.ToInt32(p.fk_member_profile_id ?? 0);

        if (feeMemberId != memberId || payMemberId != memberId)
        {
            _logger.LogWarning(
                "Receipt denied: member {Caller} requested payment {Pid} (payment fk={PayFk}, fee fk={FeeFk}).",
                memberId, paymentId, payMemberId, feeMemberId);
            // 403 rather than 404-with-detail: the caller is authenticated but
            // this simply is not their payment.
            throw new ReceiptForbiddenException("This payment does not belong to you.");
        }

        // ── PAID GUARD ───────────────────────────────────────────────────
        // Only IsPaid=1 may be receipted. Pending offline submissions, stuck
        // PaymentStatus='ACTIVE' Cashfree rows (46 in prod) and Rejected rows
        // must never produce a receipt.
        if (!Convert.ToBoolean(p.IsPaid ?? false))
        {
            var status = (string?)p.PaymentStatus ?? "Pending";
            throw new ReceiptNotPayableException(
                $"A receipt is only available once the payment is confirmed. Current status: {status}.");
        }

        if (p.DuesId == null)
            throw new KeyNotFoundException("The club dues record for this payment is missing or deleted.");

        // ── Fee-type labels — identical fallbacks to the e-mail receipt ──
        var fees1Text = (string?)p.Fees1Text;
        var fees2Text = (string?)p.Fees2Text;
        var fees3Text = (string?)p.Fees3Text;
        string FeeTypeLabel(int t) => t switch
        {
            1 => fees1Text ?? "Annual",
            2 => fees2Text ?? "Semi-Annual 1",
            3 => fees3Text ?? "Semi-Annual 2",
            _ => "Dues"
        };

        // Member name: same "Rotarian" fallback the e-mail uses when the
        // profile row has a blank name. The fee row's profile is the backstop.
        var memberName = (string?)p.MemberName;
        if (string.IsNullOrWhiteSpace(memberName)) memberName = (string?)p.FeeMemberName;
        if (string.IsNullOrWhiteSpace(memberName)) memberName = "Rotarian";

        int memberFeeId = Convert.ToInt32(p.fk_member_fee_id ?? 0);

        // ── Fee lines ────────────────────────────────────────────────────
        // Exactly the e-mail's query: EVERY paid payment under this member's
        // fee row, so a member who paid Semi 1 + Semi 2 sees both lines on one
        // receipt (matching the e-mail they received).
        var paidPayments = (await conn.QueryAsync<dynamic>(@"
            SELECT p.pk_id, p.FeeType, p.Amount, p.IsOnline, p.PaymentDate,
                   p.TransactionId, p.OfflineTransactionId, p.OfflineTransactionType
            FROM membership_dues_payments p
            WHERE p.fk_member_fee_id = @FeeId
              AND p.IsPaid = 1
              AND p.isdeleted = 0
            ORDER BY p.FeeType, p.PaymentDate, p.pk_id",
            new { FeeId = memberFeeId })).ToList();

        decimal surchargePercent = Convert.ToDecimal(p.OnlineSurchargePercent ?? 0m);

        var lines = new List<DuesReceiptLineDto>();
        int sr = 0;
        foreach (var pp in paidPayments)
        {
            sr++;
            int ft = Convert.ToInt32(pp.FeeType);
            decimal total = Convert.ToDecimal(pp.Amount);
            bool ppIsOnline = Convert.ToBoolean(pp.IsOnline);

            // Surcharge back-out — byte-for-byte the same arithmetic and
            // rounding as SendReceiptEmailAsync, so the printed figures match.
            decimal netAmount;
            decimal? gateway = null;
            string gatewayText;
            if (ppIsOnline)
            {
                decimal baseEquivalent = surchargePercent > 0 ? total / (1 + surchargePercent / 100m) : total;
                decimal g = Math.Round(total - baseEquivalent, 2, MidpointRounding.AwayFromZero);
                netAmount = (int)Math.Round(total - g, 0, MidpointRounding.AwayFromZero);
                gateway = g;
                gatewayText = $"₹{g:N2}";
            }
            else
            {
                netAmount = (int)Math.Round(total, 0, MidpointRounding.AwayFromZero);
                gatewayText = "N/A";
            }

            // Transaction reference: online txn id, else the offline reference,
            // else "N/A" — 558 paid rows have no TransactionId (offline) and
            // 1304 have no OfflineTransactionId, so "N/A" is common and expected.
            string txnId = (string?)pp.TransactionId ?? "";
            if (string.IsNullOrWhiteSpace(txnId)) txnId = (string?)pp.OfflineTransactionId ?? "";
            if (string.IsNullOrWhiteSpace(txnId)) txnId = "N/A";

            lines.Add(new DuesReceiptLineDto
            {
                SrNo = sr,
                FeeType = ft,
                FeeTypeLabel = FeeTypeLabel(ft),
                Amount = netAmount,
                AmountText = $"₹{netAmount:N0}",
                IsOnline = ppIsOnline,
                Mode = ppIsOnline ? "Online" : "Offline",
                GatewayCharges = gateway,
                GatewayChargesText = gatewayText,
                PaymentDate = ((DateTime?)pp.PaymentDate)?.ToString("dd-MMM-yyyy") ?? "-",
                TransactionId = txnId,
            });
        }

        var totalAmount = lines.Sum(l => l.Amount);
        var totalGateway = lines.Sum(l => l.GatewayCharges ?? 0m);

        return new DuesReceiptDto
        {
            PaymentId = paymentId,
            MemberFeeId = memberFeeId,
            DuesId = Convert.ToInt32(p.DuesId),
            MemberId = memberId,

            MemberName = memberName!,
            DistrictNumber = (string?)p.DistrictNumber,
            ClubName = (string?)p.ClubName,
            Purpose = (string?)p.Purpose,
            Status = "Paid",
            PaymentDateTime = ((DateTime?)p.PaymentDate)?.ToString("dd-MMM-yyyy hh:mm tt")
                              ?? DateTime.Now.ToString("dd-MMM-yyyy hh:mm tt"),
            ApproverRemark = (string?)p.ApprovalRemark,

            Fees = lines,
            TotalAmount = totalAmount,
            TotalGatewayCharges = totalGateway,
            GrandTotal = totalAmount + totalGateway,

            GeneratedOn = DateTime.Now.ToString("dd-MMM-yyyy hh:mm tt"),
        };
    }
}
