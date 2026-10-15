namespace RotaryApi.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  MEMBERSHIP-DUES PAYMENT RECEIPT (mobile)
// ═══════════════════════════════════════════════════════════════════════════
// Structured twin of the HTML receipt e-mail built by
// MembershipDuesService.SendReceiptEmailAsync. Every field here maps 1:1 onto a
// row/column that the e-mail already renders — nothing new is invented, so the
// PDF the Flutter app downloads and the e-mail the member received show the
// same numbers, the same wording and the same transaction references.
//
// NOTE ON RECEIPT NUMBERS: membership_dues_payments has NO receipt-number
// column (only IsReceiptSent), and the e-mail receipt does not print one
// either. The transaction reference (Cashfree TransactionId for online, or
// OfflineTransactionId for offline) is the receipt's only payment reference,
// exactly as in the e-mail. PaymentId is exposed as an internal reference for
// the app but is deliberately NOT presented as an official "receipt no.".
public class DuesReceiptDto
{
    // ── Internal references (not printed as an official receipt number) ──
    public int PaymentId { get; set; }
    public int MemberFeeId { get; set; }
    public int DuesId { get; set; }
    public int MemberId { get; set; }

    // ── Meta rows — same labels/order as the e-mail's top table ──
    public string MemberName { get; set; } = "";      // "Member Name"
    public string? DistrictNumber { get; set; }        // "District Number"
    public string? ClubName { get; set; }              // "Club Name"
    public string? Purpose { get; set; }               // "Purpose"
    public string Status { get; set; } = "Paid";       // "Status" (always Paid — guarded)
    public string PaymentDateTime { get; set; } = "";  // "Date and Time" (dd-MMM-yyyy hh:mm tt)
    public string? ApproverRemark { get; set; }        // "Approver's Remark"

    // ── Fees table — same 7 columns as the e-mail's per-fee table ──
    public List<DuesReceiptLineDto> Fees { get; set; } = new();

    // ── Totals (derived from Fees; convenience for native rendering) ──
    public decimal TotalAmount { get; set; }
    public decimal TotalGatewayCharges { get; set; }
    public decimal GrandTotal { get; set; }

    // ── Branding, matching the e-mail header/footer ──
    public string OrganisationName { get; set; } = "ROW";
    public string DocumentTitle { get; set; } = "Payment Receipt";
    public string GeneratedOn { get; set; } = "";
}

// One row of the receipt's fee table. Mirrors the e-mail columns:
//   Sr No | Fee Type | Amount | Mode | Payment Gateway Charges | Payment Date | Transaction ID
public class DuesReceiptLineDto
{
    public int SrNo { get; set; }
    public int FeeType { get; set; }                 // 1=Annual, 2=Semi 1, 3=Semi 2
    public string FeeTypeLabel { get; set; } = "";   // campaign's Fees1Text/Fees2Text/Fees3Text
    public decimal Amount { get; set; }              // net of gateway charges (whole rupees)
    public string AmountText { get; set; } = "";     // "₹12,500"
    public bool IsOnline { get; set; }
    public string Mode { get; set; } = "";           // "Online" / "Offline"
    public decimal? GatewayCharges { get; set; }     // null for offline (prints "N/A")
    public string GatewayChargesText { get; set; } = "";
    public string PaymentDate { get; set; } = "";    // dd-MMM-yyyy
    public string TransactionId { get; set; } = "";  // TransactionId ?? OfflineTransactionId ?? "N/A"
}
