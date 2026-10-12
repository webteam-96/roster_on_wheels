namespace RotaryApi.DTOs;

// ============================================================================
//  Club Dues (District Dues) DTOs — separate from Membership Dues.
//  Campaign is DISTRICT-scoped; each club owes (unpaid non-honorary members) x rate.
//  Only Club President / Secretary / Treasurer may pay. Single Annual fee.
// ============================================================================

// ── Campaign list row ───────────────────────────────────────────
public class ClubDuesListDto
{
    public int Id { get; set; }
    public string? DistrictNumber { get; set; }
    public string? RotaryYear { get; set; }
    public string? Purpose { get; set; }
    public decimal DefaultPerMemberRate { get; set; }
    public int ClubCount { get; set; }
    public int MemberCount { get; set; }        // total non-honorary members across the district
    public int PaidMemberCount { get; set; }
    public int UnpaidMemberCount { get; set; }
    public decimal CollectedAmount { get; set; }
    public bool IsActive { get; set; }
    public string? WeblinkUrl { get; set; }
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetUrl { get; set; }
    public DateTime CreatedDate { get; set; }
}

// ── Campaign detail ─────────────────────────────────────────────
public class ClubDuesDetailDto
{
    public int Id { get; set; }
    public int FkDistrictId { get; set; }
    public string RotaryYear { get; set; } = "";
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    // Amount config — LEGACY (RateModel=0): DefaultPerMemberRate is the BASE (offline) rate; online adds the surcharge %.
    public decimal DefaultPerMemberRate { get; set; }
    public int AmountType { get; set; }
    public decimal DefaultPercentage { get; set; }
    public decimal OnlineSurchargePercent { get; set; }   // % added on top for ONLINE payments only
    // Amount config — INDEPENDENT (RateModel=1): online and offline are fully separate rates/splits.
    public int RateModel { get; set; }                    // 0=legacy combined, 1=independent online/offline tracks
    public decimal OnlinePerMemberRate { get; set; }
    public decimal OfflinePerMemberRate { get; set; }
    // Payment
    public int ModeOfPayment { get; set; }
    public bool IsShowBankInReceipt { get; set; }
    // Offline bank
    public string? OfflineBankName { get; set; }
    public string? OfflineAccountNumber { get; set; }
    public string? OfflineIfscCode { get; set; }
    // Offline approval routing
    public string? ApproverEmail { get; set; }
    // Email
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCC { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    public string? ReminderButtonText { get; set; }
    // Google Sheet
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetEmail { get; set; }
    // Related
    public List<ClubDuesVendorDto>? Vendors { get; set; }
}

// ── Create / Update campaign ────────────────────────────────────
public class CreateClubDuesDto
{
    public int FkDistrictId { get; set; }
    public string RotaryYear { get; set; } = "";
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    public decimal DefaultPerMemberRate { get; set; }
    public int AmountType { get; set; }
    public decimal DefaultPercentage { get; set; }
    public decimal OnlineSurchargePercent { get; set; }   // % added on top for ONLINE payments only
    public int RateModel { get; set; }                    // 0=legacy combined, 1=independent online/offline tracks
    public decimal OnlinePerMemberRate { get; set; }
    public decimal OfflinePerMemberRate { get; set; }
    public int ModeOfPayment { get; set; }
    public bool IsShowBankInReceipt { get; set; }
    public string? OfflineBankName { get; set; }
    public string? OfflineAccountNumber { get; set; }
    public string? OfflineIfscCode { get; set; }
    public string? ApproverEmail { get; set; }
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCC { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    public string? ReminderButtonText { get; set; }
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetEmail { get; set; }
    // Online vendor splits (JSON, parsed on backend) — LEGACY: the one shared split. INDEPENDENT: the online-only split.
    public string? VendorsJson { get; set; }
    // Offline vendor splits (JSON, parsed on backend) — INDEPENDENT mode only; ignored for legacy campaigns.
    public string? OfflineVendorsJson { get; set; }
    // Per-club rate/split overrides (JSON, parsed on backend). LEGACY row shape: {fkClubId, perMemberRate, vendors}.
    // INDEPENDENT row shape: {fkClubId, onlinePerMemberRate, offlinePerMemberRate, onlineVendors, offlineVendors}.
    public string? ClubOverridesJson { get; set; }
}

// ── District-admin content-only edit (logos + email content) ────
// District admins may change branding/email copy for THEIR district's campaign
// but never amounts, dates, approver, splits or clubs. Backed by UpdateContentAsync.
public class UpdateClubDuesContentDto
{
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCC { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    public string? ReminderButtonText { get; set; }
}

// ── Vendor split (campaign-level) — Razorpay Route linked account ───
public class ClubDuesVendorDto
{
    public int? Id { get; set; }
    public int FkRouteAccountId { get; set; }
    public string AccountId { get; set; } = "";   // Razorpay linked account (acc_...)
    public string? AccountName { get; set; }
    public string? BankAccountLast4 { get; set; }
    public string? BankIfsc { get; set; }
    public decimal SplitAmount { get; set; }
    public decimal SplitPercentage { get; set; }
    public bool IsDefault { get; set; }
    public bool IsSelf { get; set; }
    public string? AccountLabel { get; set; }
    public bool IsOnline { get; set; } = true;   // which independent track this row belongs to (legacy rows are always true)
}

// ── Save per-club vendor split ──────────────────────────────────
public class ClubVendorsSaveDto
{
    public string? VendorsJson { get; set; }
    public bool IsOnline { get; set; } = true;   // which track this save replaces (legacy campaigns always save the online/shared set)
}

// ── Offline payment account picker option (effective: per-club override else campaign default) ──
public class ClubDuesOfflineAccountOptionDto
{
    public int FkRouteAccountId { get; set; }
    public string AccountId { get; set; } = "";
    public string? AccountLabel { get; set; }
    public decimal Amount { get; set; }    // this account's share of the club's currently-owed total
}

// ── Per-account row within a club's breakdown (Clubs list) — real accounts only, never the
//    online-only platform-fee account. Amount is this account's TARGET share of the club's total
//    due; IsPaid reflects whether that account's cut has actually been collected. ──
public class ClubDuesAccountBreakdownDto
{
    public int FkRouteAccountId { get; set; }
    public string? AccountLabel { get; set; }
    public decimal Amount { get; set; }
    public bool IsPaid { get; set; }
}

// ── One per-club vendor split row (bulk fetch for the Club List step) ──
public class ClubDuesClubVendorRow
{
    public int FkClubId { get; set; }
    public int FkRouteAccountId { get; set; }
    public string? AccountId { get; set; }
    public decimal SplitAmount { get; set; }
    public decimal SplitPercentage { get; set; }
    public bool IsOnline { get; set; } = true;
}

// ── Per-club row (the clubs grid) ───────────────────────────────
public class ClubDuesClubListDto
{
    public int ClubDuesClubId { get; set; }
    public int FkClubId { get; set; }
    public string? ClubName { get; set; }
    public bool IsSyncedFromRotaryOrg { get; set; }   // show sync + non-sync
    public decimal PerMemberRate { get; set; }        // legacy base rate (kept for legacy campaigns; unused when independent)
    public decimal OnlinePerMemberRate { get; set; }  // effective (per-club override else campaign) rate for this club
    public decimal OfflinePerMemberRate { get; set; }
    public int MemberCount { get; set; }              // live non-honorary count
    public int PaidCount { get; set; }
    public int UnpaidCount { get; set; }
    public decimal AmountPaid { get; set; }           // raw combined sum, any mode (unchanged)
    // Online track — for legacy campaigns this is the same shared split applied against the surcharged total.
    public decimal OnlineAmount { get; set; }         // memberCount x onlineRate — the full due if paid entirely online
    public decimal OnlinePaid { get; set; }           // raw sum of paid online payments
    public List<ClubDuesAccountBreakdownDto> OnlineAccountBreakdown { get; set; } = new();
    // Offline track — for legacy campaigns this is the same shared split (platform account excluded) applied
    // against the base total; for independent campaigns it's the fully separate offline-only split.
    public decimal OfflineAmount { get; set; }        // memberCount x offlineRate — the full due if paid entirely offline
    public decimal OfflinePaid { get; set; }          // raw sum of paid offline payments
    public List<ClubDuesAccountBreakdownDto> OfflineAccountBreakdown { get; set; } = new();
    public decimal TotalPaid { get; set; }             // onlinePaid + offlinePaid — always well-defined regardless of mode
    public string? Status { get; set; }               // No Members / Fully Paid / Partial / Unpaid
    public bool HasPendingApproval { get; set; }
    public int? PendingPaymentId { get; set; }
    public int? LastPaidPaymentId { get; set; }        // most recent PAID payment (for "Send receipt")
    public int? LastOfflinePaymentId { get; set; }     // most recent OFFLINE payment (for "Edit offline")
    public bool HasClubVendorSplit { get; set; }       // has a per-club Razorpay split override (either track)
    [System.Text.Json.Serialization.JsonIgnore]
    public bool HasOnlinePaid { get; set; }            // internal input to PaidOnline/OnlineAccountBreakdown, not for display

    // ── Latest PAID payment ──
    public bool? PaidOnline { get; set; }              // true = Online, false = Offline, null = nothing paid yet
    public string? OfflineTransactionType { get; set; } // 1 Cash, 2 Cheque, 3 NEFT, 4 UPI, 5 Other
    public string? OfflineTransactionId { get; set; }   // transaction / reference no.
    public string? OfflineRemark { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? OfflineAccountLabel { get; set; }    // which bank account this offline payment was recorded against
}

// ── Offline payment detail (for the Edit-offline dialog) ────────
public class ClubDuesOfflineDetailDto
{
    public int PaymentId { get; set; }
    public int FkClubId { get; set; }
    public decimal Amount { get; set; }
    public int MemberCountCovered { get; set; }
    public string? TransactionType { get; set; }
    public string? TransactionId { get; set; }
    public string? GivenTo { get; set; }
    public string? BankName { get; set; }
    public string? ChequeNumber { get; set; }
    public string? Remark { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? Attachment { get; set; }
    public string? OfflineStatus { get; set; }
    public int? FkRouteAccountId { get; set; }
    public string? AccountName { get; set; }
    public string? BankAccountLast4 { get; set; }
    public string? BankIfsc { get; set; }
    public string? AccountLabel { get; set; }
}

// ── Per-member row (within a club) ──────────────────────────────
public class ClubDuesMemberListDto
{
    public int ClubDuesMemberId { get; set; }
    public int FkMemberProfileId { get; set; }
    public string? MemberName { get; set; }
    public bool IsHonorary { get; set; }
    public decimal Rate { get; set; }
    public bool IsPaid { get; set; }
    public DateTime? PaidDate { get; set; }
    public int? FkPaymentId { get; set; }
}

// ── Update a club's rate ────────────────────────────────────────
public class UpdateClubDuesRateDto
{
    public decimal PerMemberRate { get; set; }         // legacy campaigns
    public decimal? OnlinePerMemberRate { get; set; }   // independent campaigns — null leaves the campaign default in effect
    public decimal? OfflinePerMemberRate { get; set; }
}

// ── Record offline club payment (officer or admin) ──────────────
public class RecordOfflineClubDuesPaymentDto
{
    public int FkClubId { get; set; }
    public int? PaidByMemberId { get; set; }          // which officer
    public int? FkRouteAccountId { get; set; }         // which bank account this payment went into (razorpay_route_accounts.pk_id)
    public string? TransactionType { get; set; }
    public string? TransactionId { get; set; }
    public string? GivenTo { get; set; }
    public string? BankName { get; set; }
    public string? ChequeNumber { get; set; }
    public string? Remark { get; set; }
    public DateTime? PaymentDate { get; set; }
    public bool SendReceiptEmail { get; set; }
    public string? ApprovalRemark { get; set; }
}

// ── Approve / reject ────────────────────────────────────────────
public class ApproveClubDuesPaymentDto
{
    public bool IsApproved { get; set; }
    public string? RejectionReason { get; set; }
    public string? ApprovalRemark { get; set; }
}

// ── Public pay page (officer) ───────────────────────────────────
public class PublicClubDuesDto
{
    public int Id { get; set; }
    public string? Purpose { get; set; }
    public string? PurposeDescription { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    public string? DistrictNumber { get; set; }
    public int ModeOfPayment { get; set; }
    // The paying club's live snapshot
    public int FkClubId { get; set; }
    public string? ClubName { get; set; }
    public decimal PerMemberRate { get; set; }
    public int MemberCount { get; set; }
    public int PaidCount { get; set; }
    public int UnpaidCount { get; set; }
    public decimal AmountOwed { get; set; }           // unpaid x rate — the OFFLINE (base) amount
    public decimal OnlineSurchargePercent { get; set; } // % added for online payments
    public decimal OnlineAmountOwed { get; set; }     // AmountOwed + surcharge — the ONLINE amount to pay
    public bool IsFullyPaid { get; set; }
    public bool IsPending { get; set; }
    // Set when the club's MOST RECENT offline submission was rejected (and not superseded by a
    // newer pending/approved one) — surfaced to the payer so they know to resubmit.
    public string? LastRejectedReason { get; set; }
    public DateTime? LastRejectedDate { get; set; }
    // Bank (for offline)
    public string? OfflineBankName { get; set; }
    public string? OfflineAccountNumber { get; set; }
    public string? OfflineIfscCode { get; set; }
}

// ── Public payment submit (online) ──────────────────────────────
public class PublicClubDuesPaymentSubmitDto
{
    public int FkClubId { get; set; }
    public int? PaidByMemberId { get; set; }
}

// ── Payment session response (Razorpay Checkout) ────────────────
public class ClubDuesPaymentSessionResponseDto
{
    public string KeyId { get; set; } = "";           // rzp_live_... (sent to browser)
    public string RazorpayOrderId { get; set; } = ""; // order_...
    public long AmountPaise { get; set; }
    public string Receipt { get; set; } = "";
    public int PaymentId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerEmail { get; set; }
    public string? CustomerPhone { get; set; }
}

// ── Verify payment (Razorpay checkout callback) ─────────────────
public class ClubDuesVerifyDto
{
    public int PaymentId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string RazorpayPaymentId { get; set; } = "";
    public string RazorpaySignature { get; set; } = "";
}

// ── Copy-pay-link response (non-expiring shareable link) ────────
public class ClubDuesPayLinkDto
{
    public string Url { get; set; } = "";
    // Retained for wire compatibility only — the link does not expire, so this is a
    // far-future sentinel. Do not surface it as a real deadline.
    public DateTime ExpiresAtUtc { get; set; }
}

// ── Reminder ────────────────────────────────────────────────────
public class ClubDuesReminderDto
{
    public int? FkClubId { get; set; }
    public string? Remark { get; set; }
}

// ── Send a test email (reminder / receipt) with sample values ────
// Sends to an arbitrary address using the CURRENT (possibly unsaved) template text, so the admin
// can preview before saving. Consumes 1 Email credit from the campaign's district wallet.
public class ClubDuesTestEmailDto
{
    public string Email { get; set; } = "";       // recipient of the test
    public string Type { get; set; } = "reminder"; // "reminder" | "receipt"
    public int DistrictId { get; set; }            // whose wallet the credit is drawn from
    public int DuesId { get; set; }                // 0 in create mode (before the campaign is saved)
    public string? Subject { get; set; }           // current subject text (with {{tokens}})
    public string? Body { get; set; }              // current body html (with {{tokens}})
    public string? ButtonText { get; set; }        // current "Pay Now" button text (reminder only)
    // Offline bank details (reminder only) — passed so the preview matches "show bank" config.
    public bool ShowBank { get; set; }
    public string? BankName { get; set; }
    public string? AccountNumber { get; set; }
    public string? Ifsc { get; set; }
}
