namespace RotaryApi.DTOs;

// ── Membership Dues List ────────────────────────────────────────
public class MembershipDuesListDto
{
    public int Id { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public string? RotaryYear { get; set; }
    public string? Purpose { get; set; }
    public int MemberCount { get; set; }
    public int PaidCount { get; set; }
    public int UnpaidCount { get; set; }
    public bool IsActive { get; set; }
    public string? WeblinkUrl { get; set; }
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetUrl { get; set; }
    public DateTime CreatedDate { get; set; }
}

// ── Membership Dues Detail ──────────────────────────────────────
public class MembershipDuesDetailDto
{
    public int Id { get; set; }
    public int FkDistrictId { get; set; }
    public int FkClubId { get; set; }
    public string RotaryYear { get; set; } = "";
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    // Payment
    public int ModeOfPayment { get; set; }
    public bool IsShowBankInReceipt { get; set; }
    // Fees toggles
    public bool IsFees1 { get; set; }
    public bool IsFees2 { get; set; }
    public bool IsFees3 { get; set; }
    public string? Fees1Text { get; set; }
    public string? Fees2Text { get; set; }
    public string? Fees3Text { get; set; }
    // Default amounts — the ONE true amount (also charged offline). Online
    // amount is always derived as DefaultXAmount * (1 + OnlineSurchargePercent/100).
    public string? DefaultCategoryType { get; set; }
    public decimal DefaultAnnualAmount { get; set; }
    public decimal DefaultSemi1Amount { get; set; }
    public decimal DefaultSemi2Amount { get; set; }
    public decimal OnlineSurchargePercent { get; set; }
    // Amount type / percentage
    public int AmountType { get; set; }
    public decimal DefaultPercentage { get; set; }
    // Offline bank details
    public string? OfflineBankName { get; set; }
    public string? OfflineAccountNumber { get; set; }
    public string? OfflineIfscCode { get; set; }
    // Email
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCC { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    // Google Sheet
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetEmail { get; set; }
    // Related data
    public List<MembershipDuesVendorDto>? Vendors { get; set; }
}

// ── Create / Update Membership Dues ─────────────────────────────
public class CreateMembershipDuesDto
{
    public int FkDistrictId { get; set; }
    public int FkClubId { get; set; }
    public string RotaryYear { get; set; } = "";
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    // Payment
    public int ModeOfPayment { get; set; }
    public bool IsShowBankInReceipt { get; set; }
    // Fees toggles
    public bool IsFees1 { get; set; }
    public bool IsFees2 { get; set; }
    public bool IsFees3 { get; set; }
    public string? Fees1Text { get; set; }
    public string? Fees2Text { get; set; }
    public string? Fees3Text { get; set; }
    // Default amounts — the ONE true amount (also charged offline). Online
    // amount is always derived as DefaultXAmount * (1 + OnlineSurchargePercent/100).
    public string? DefaultCategoryType { get; set; }
    public decimal DefaultAnnualAmount { get; set; }
    public decimal DefaultSemi1Amount { get; set; }
    public decimal DefaultSemi2Amount { get; set; }
    public decimal OnlineSurchargePercent { get; set; }
    // Amount type / percentage
    public int AmountType { get; set; }
    public decimal DefaultPercentage { get; set; }
    // Offline bank details
    public string? OfflineBankName { get; set; }
    public string? OfflineAccountNumber { get; set; }
    public string? OfflineIfscCode { get; set; }
    // Email
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCC { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    // Google Sheet
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetEmail { get; set; }
    // Vendor splits (JSON string, parsed on backend)
    public string? VendorsJson { get; set; }
    // Per-member overrides (JSON string, parsed on backend)
    public string? MemberOverridesJson { get; set; }
}

// ── Vendor Split ────────────────────────────────────────────────
public class MembershipDuesVendorDto
{
    public int? Id { get; set; }
    public int FkKycId { get; set; }
    public string VendorId { get; set; } = "";
    public string? VendorName { get; set; }
    public decimal AnnualAmount { get; set; }
    public decimal Semi1Amount { get; set; }
    public decimal Semi2Amount { get; set; }
    public bool IsDefault { get; set; }
    public bool IsSelf { get; set; }
    public string? AccountLabel { get; set; } // "A/C1", "A/C2" etc
}

// ── Member Fees List ────────────────────────────────────────────
public class MemberFeesListDto
{
    public int MemberFeeId { get; set; }
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public string? CategoryType { get; set; }
    // Annual — AnnualAmount is this member's own stored fee row (for the
    // SuperAdmin Step 4 edit screen, which needs to show/edit real per-member
    // overrides). AnnualBaseAmount is the campaign's configured default,
    // applied uniformly — display-only consumers (mobile app, etc.) should
    // read THIS instead, since per-member rows can carry stale/customized
    // amounts that aren't meant to be shown outside that edit screen.
    public decimal AnnualAmount { get; set; }
    public decimal AnnualBaseAmount { get; set; }
    public decimal AnnualPaid { get; set; }
    public decimal AnnualBalance { get; set; }
    public string? AnnualStatus { get; set; }
    // Semi 1
    public decimal Semi1Amount { get; set; }
    public decimal Semi1BaseAmount { get; set; }
    public decimal Semi1Paid { get; set; }
    public decimal Semi1Balance { get; set; }
    public string? Semi1Status { get; set; }
    // Semi 2
    public decimal Semi2Amount { get; set; }
    public decimal Semi2BaseAmount { get; set; }
    public decimal Semi2Paid { get; set; }
    public decimal Semi2Balance { get; set; }
    public string? Semi2Status { get; set; }
    // Flags
    public bool IsNewMember { get; set; }
    public bool HasPendingApproval { get; set; }
    // Payment info per fee type
    public string? AnnualPaymentMode { get; set; } // "Payment Gateway", "Cash", "NEFT/IMPS/RTGS", "Cheque"
    public DateTime? AnnualPaymentDate { get; set; }
    public string? Semi1PaymentMode { get; set; }
    public DateTime? Semi1PaymentDate { get; set; }
    public string? Semi2PaymentMode { get; set; }
    public DateTime? Semi2PaymentDate { get; set; }
    // Online (gateway) transaction IDs — populated only when the fee type was
    // paid via Payment Gateway. Used by the Offline Entry dialog's read-only
    // panel so admins can SEE the online payment that already settled.
    public string? AnnualOnlineTransactionId { get; set; }
    public string? Semi1OnlineTransactionId { get; set; }
    public string? Semi2OnlineTransactionId { get; set; }
    // Latest paid-offline payment ID per fee type — drives the "Update Offline"
    // pre-fill flow (admin can edit the saved offline details for a paid row).
    public int? AnnualPaidOfflineId { get; set; }
    public int? Semi1PaidOfflineId { get; set; }
    public int? Semi2PaidOfflineId { get; set; }
    // Pending offline payment details
    public int? PendingPaymentId { get; set; }
    public int? PendingFeeType { get; set; }
    public string? PendingTransactionType { get; set; }
    public string? PendingTransactionId { get; set; }
    public string? PendingGivenTo { get; set; }
    public DateTime? PendingPaymentDate { get; set; }
    public string? PendingRemark { get; set; }
    public string? PendingAttachment { get; set; }
    public decimal? PendingAmount { get; set; }
    // Vendor splits per fee type
    public List<MemberVendorSplitDto>? AnnualVendors { get; set; }
    public List<MemberVendorSplitDto>? Semi1Vendors { get; set; }
    public List<MemberVendorSplitDto>? Semi2Vendors { get; set; }
}

// ── Member Vendor Split ─────────────────────────────────────────
public class MemberVendorSplitDto
{
    public string VendorId { get; set; } = "";
    public string? VendorName { get; set; }
    public decimal Amount { get; set; }
    public bool IsDefault { get; set; }
    public bool IsSelf { get; set; }
    public string? AccountLabel { get; set; }
}

// ── Update Member Fee ───────────────────────────────────────────
public class UpdateMemberFeeDto
{
    public string? CategoryType { get; set; }
    // The ONE true amount per fee type — online amount is always derived at
    // payment time via baseAmount * (1 + OnlineSurchargePercent/100).
    public decimal? AnnualAmount { get; set; }
    public decimal? Semi1Amount { get; set; }
    public decimal? Semi2Amount { get; set; }
    public string? VendorsJson { get; set; }
}

// ── Record Offline Dues Payment ─────────────────────────────────
public class RecordOfflineDuesPaymentDto
{
    public int FeeType { get; set; }
    public int FkMemberProfileId { get; set; }
    public string? TransactionType { get; set; }
    public string? TransactionId { get; set; }
    public string? GivenTo { get; set; }
    public string? BankName { get; set; }
    public string? ChequeNumber { get; set; }
    public string? Remark { get; set; }
    public DateTime? PaymentDate { get; set; }
    public bool SendReceiptEmail { get; set; }
    // Optional remark used when an admin saves an Offline Entry update
    // on a Pending row — the save acts as auto-approval, this is the
    // approver's remark recorded on the row.
    public string? ApprovalRemark { get; set; }
}

// ── Approve / Reject Dues Payment ───────────────────────────────
public class ApproveDuesPaymentDto
{
    public bool IsApproved { get; set; }
    public string? RejectionReason { get; set; }
    public string? ApprovalRemark { get; set; }
}

// ── Public Membership Dues ──────────────────────────────────────
public class PublicMembershipDuesDto
{
    public int Id { get; set; }
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    // Fees toggles
    public bool IsFees1 { get; set; }
    public bool IsFees2 { get; set; }
    public bool IsFees3 { get; set; }
    public string? Fees1Text { get; set; }
    public string? Fees2Text { get; set; }
    public string? Fees3Text { get; set; }
    public int ModeOfPayment { get; set; }
    public List<PublicDuesFeeOption>? AvailableFees { get; set; }
}

// ── Public Fee Option ───────────────────────────────────────────
public class PublicDuesFeeOption
{
    public int FeeType { get; set; }
    public string Label { get; set; } = "";
    // Derived online (with-surcharge) amount — what "Pay Online" charges.
    public decimal Amount { get; set; }
    // The ONE true (base) amount — what an offline payment charges. Sent so
    // the frontend no longer needs to approximate this client-side.
    public decimal OfflineAmount { get; set; }
    public bool IsPaid { get; set; }
    public bool IsAvailable { get; set; }
    public bool IsPending { get; set; }
    public bool IsRejected { get; set; }
    public string? RejectionReason { get; set; }
    public string? PaymentDate { get; set; }
    public string? PaymentMode { get; set; }
    // Previous submission details (for resubmit after rejection)
    public string? PrevTransactionType { get; set; }
    public string? PrevTransactionId { get; set; }
    public string? PrevGivenTo { get; set; }
    public string? PrevPaymentDate { get; set; }
    public string? PrevRemark { get; set; }
    public string? PrevAttachment { get; set; }
}

// ── Public Dues Payment Submit ──────────────────────────────────
public class PublicDuesPaymentSubmitDto
{
    public int FkMemberProfileId { get; set; }
    public int FeeType { get; set; }
}

// ── Dues Payment Session Response ───────────────────────────────
public class DuesPaymentSessionResponseDto
{
    public string PaymentSessionId { get; set; } = "";
    public string CfOrderId { get; set; } = "";
    public string OrderId { get; set; } = "";
    public int PaymentId { get; set; }
    public string Environment { get; set; } = "";
    // When non-empty, frontend should redirect to this URL instead of opening Cashfree's JS SDK
    // directly. The proxy hosts the SDK on a whitelisted domain (example.org).
    public string? GatewayProxyUrl { get; set; }
}

// ── Reminder DTOs ─────────────────────────────────────────────
public class SendDuesReminderDto
{
    public int FeeType { get; set; }
    public string? Remark { get; set; }
}

public class BulkDuesReminderDto
{
    public string? Remark { get; set; }
}

// ── Revert Paid → Unpaid (SuperAdmin status correction) ─────────
// NOT a refund: no money moves and no gateway call is made. This only
// un-records a payment that was booked against the wrong member, so the
// member shows as Unpaid again. The payment row itself is preserved
// (soft-deleted + PaymentStatus='Reverted') for the audit trail.
public class RevertDuesPaymentDto
{
    // 1 = Annual, 2 = Semi 1, 3 = Semi 2. When null, every fee type that is
    // currently marked Paid on this member's fee row is reverted.
    public int? FeeType { get; set; }
    // Mandatory free-text justification — stored on the payment row and in
    // the audit log. Max 500 chars (membership_dues_payments.RejectionReason).
    public string? Reason { get; set; }
}

// ── Revert result ───────────────────────────────────────────────
public class RevertDuesPaymentResultDto
{
    public int MemberFeeId { get; set; }
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    // Sum of the reverted payment rows' Amount — what the member was
    // previously recorded as having paid.
    public decimal RevertedAmount { get; set; }
    public List<int> RevertedPaymentIds { get; set; } = new();
    public List<int> RevertedFeeTypes { get; set; } = new();
    public string Message { get; set; } = "";
}
