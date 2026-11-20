namespace RotaryApi.DTOs;

// Grants module (ROW build spec 3.8).
// shortcut: amounts carry no currency of their own (the admin shows the instance currency), add a cycle currency
// when a district runs its grants in another one.

public class GrantCycleDto
{
    public int Id { get; set; }
    public int DistrictId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string Status { get; set; } = "draft";
    public decimal DdfBudget { get; set; }
    public decimal? MaxRequest { get; set; }
    public int MinQualifiedMembers { get; set; }
    public DateTime? OpensOn { get; set; }
    public DateTime? ClosesOn { get; set; }
    public DateTime? ReportDueOn { get; set; }
    /// <summary>When the interim (progress) report of an approved grant is due; reminders go out before and after.</summary>
    public DateTime? InterimDueOn { get; set; }
    public string? Rules { get; set; }
    // District view only (clubs get 0 / empty).
    public decimal Committed { get; set; }
    public decimal Paid { get; set; }
    public Dictionary<string, int> StatusCounts { get; set; } = new();
}

public class SaveGrantCycleDto
{
    public int YearId { get; set; }
    public string Status { get; set; } = "draft";
    public decimal DdfBudget { get; set; }
    public decimal? MaxRequest { get; set; }
    public int MinQualifiedMembers { get; set; }
    public DateTime? OpensOn { get; set; }
    public DateTime? ClosesOn { get; set; }
    public DateTime? ReportDueOn { get; set; }
    /// <summary>When the interim (progress) report of an approved grant is due; reminders go out before and after.</summary>
    public DateTime? InterimDueOn { get; set; }
    public string? Rules { get; set; }
}

public class GrantApplicationListItemDto
{
    public int Id { get; set; }
    public int CycleId { get; set; }
    public string YearLabel { get; set; } = "";
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "";
    public decimal AmountRequested { get; set; }
    public decimal? AmountApproved { get; set; }
    public decimal Paid { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class GrantLineDto
{
    public int Id { get; set; }                      // read only: the final report's actuals refer to it
    public string Kind { get; set; } = "";          // income | expense | partner
    public string Description { get; set; } = "";
    public string? Detail { get; set; }
    public decimal? Amount { get; set; }
    public string? Category { get; set; }
    public string? Supplier { get; set; }
    /// <summary>Actual spend from the final report (expense lines); read only here.</summary>
    public decimal? ActualAmount { get; set; }
    /// <summary>Actual minus budget, once the final report gives the actual.</summary>
    public decimal? Variance { get; set; }
}

public class GrantSignOffDto
{
    public string Action { get; set; } = "";        // submit | approve
    public string SignerRole { get; set; } = "";
    public string SignatureName { get; set; } = "";
    public string? MemberName { get; set; }
    public DateTime SignedAtUtc { get; set; }
}

public class GrantInterimReportDto
{
    public int Id { get; set; }
    public string Progress { get; set; } = "";
    public decimal AmountSpent { get; set; }
    public string? SubmittedByName { get; set; }
    public DateTime SubmittedAtUtc { get; set; }
}

public class SubmitGrantInterimReportDto
{
    public string? Progress { get; set; }
    public decimal? AmountSpent { get; set; }
}

public class GrantLineActualDto
{
    public int LineId { get; set; }
    public decimal Amount { get; set; }
}

/// <summary>One Rotary year (grant cycle) of a district: approved, paid out, reported spent, outstanding.</summary>
public class GrantYearSummaryDto
{
    public int CycleId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public decimal Budget { get; set; }
    public decimal Approved { get; set; }
    public decimal Paid { get; set; }
    public decimal ReportedSpent { get; set; }
    public decimal Outstanding { get; set; }
}

public class GrantMemberDto
{
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public string? Note { get; set; }
}

public class GrantAttachmentDto
{
    public int Id { get; set; }
    public string Kind { get; set; } = "";          // application | interim | receipt | report
    public string OriginalName { get; set; } = "";
    public int SizeBytes { get; set; }
    public string? UploadedByName { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class GrantEventDto
{
    public int Id { get; set; }
    public string Side { get; set; } = "";
    public string Action { get; set; } = "";
    public string? FromStatus { get; set; }
    public string? ToStatus { get; set; }
    public string? Comment { get; set; }
    public string? MemberName { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class GrantPaymentDto
{
    public int Id { get; set; }
    public decimal Amount { get; set; }
    public DateTime PaidOn { get; set; }
    public string Method { get; set; } = "";
    public string? Reference { get; set; }
    public string? Note { get; set; }
    public string? RecordedByName { get; set; }
}

public class GrantActionInfoDto
{
    public string Action { get; set; } = "";
    public string To { get; set; } = "";
    public bool CommentRequired { get; set; }
}

public class GrantApplicationDto : GrantApplicationListItemDto
{
    public int DistrictId { get; set; }
    public string? Description { get; set; }
    public string? Location { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public int? Beneficiaries { get; set; }
    public bool RulesAccepted { get; set; }
    public string? RejectionReason { get; set; }
    public string? ReportSummary { get; set; }
    public decimal? ReportAmountSpent { get; set; }
    public int? ReportBeneficiaries { get; set; }
    public DateTime? ReportSubmittedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime? ReportAcceptedAt { get; set; }
    public string? CreatedByName { get; set; }
    /// <summary>Expenses minus other income: what the grant must fund, and what the request must equal on submit.</summary>
    public decimal BudgetTotal { get; set; }
    public List<GrantSignOffDto> SignOffs { get; set; } = new();
    public List<GrantInterimReportDto> InterimReports { get; set; } = new();
    /// <summary>Club side: an interim report may be submitted now.</summary>
    public bool CanSubmitInterimReport { get; set; }
    /// <summary>Club side: the kinds of file the club may add or remove now.</summary>
    public List<string> AttachmentKinds { get; set; } = new();
    /// <summary>Club side, while the club may still submit: why the club is not qualified for the cycle's year (null = qualified).</summary>
    public string? QualificationWarning { get; set; }
    /// <summary>Club side: with a warning, whether the district blocks the submit (true) or only warns (false).</summary>
    public bool QualificationRequired { get; set; }
    public GrantCycleDto Cycle { get; set; } = new();
    public List<GrantLineDto> Lines { get; set; } = new();
    public List<GrantMemberDto> Members { get; set; } = new();
    public List<GrantAttachmentDto> Attachments { get; set; } = new();
    public List<GrantEventDto> Events { get; set; } = new();
    public List<GrantPaymentDto> Payments { get; set; } = new();
    /// <summary>Transitions the caller's side may make now.</summary>
    public List<GrantActionInfoDto> Actions { get; set; } = new();
    /// <summary>Club side: the application form may be changed.</summary>
    public bool Editable { get; set; }
    /// <summary>Attachment kind the club may add or remove now (application, report), or null.</summary>
    public string? AttachmentKind { get; set; }
    /// <summary>District side: a disbursement may be recorded.</summary>
    public bool CanRecordPayment { get; set; }
}

public class SaveGrantApplicationDto
{
    public int CycleId { get; set; }                 // create only
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public int? Beneficiaries { get; set; }
    public decimal AmountRequested { get; set; }
    public bool RulesAccepted { get; set; }
    public List<GrantLineDto> Lines { get; set; } = new();
    public List<GrantMemberDto> Members { get; set; } = new();
}

/// <summary>Body of a transition: comment (required for some), amount (approve), report fields (submit_report).</summary>
public class GrantActionDto
{
    public string? Comment { get; set; }
    public decimal? Amount { get; set; }
    public string? ReportSummary { get; set; }
    public decimal? ReportAmountSpent { get; set; }
    public int? ReportBeneficiaries { get; set; }
    /// <summary>Typed full name: the club's sign-off on submit, the approving officer's on approve.</summary>
    public string? Signature { get; set; }
    /// <summary>Final report: actual spend per expense line.</summary>
    public List<GrantLineActualDto>? LineActuals { get; set; }
}

public class GrantCommentDto
{
    public string Comment { get; set; } = "";
}

public class RecordGrantPaymentDto
{
    public decimal Amount { get; set; }
    public DateTime? PaidOn { get; set; }
    public string Method { get; set; } = "";
    public string? Reference { get; set; }
    public string? Note { get; set; }
}

public class GrantCashFlowRowDto
{
    public DateTime PaidOn { get; set; }
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    public decimal Amount { get; set; }
    public string Method { get; set; } = "";
    public string? Reference { get; set; }
    public decimal CumulativePaid { get; set; }
    public decimal Balance { get; set; }
}

public class GrantCashFlowDto
{
    public decimal Budget { get; set; }
    public decimal Committed { get; set; }
    public decimal Paid { get; set; }
    public List<GrantCashFlowRowDto> Rows { get; set; } = new();
}

public class GrantClubOverviewDto
{
    /// <summary>The club's district is not on ROW: the club records only grant amount and report date on its projects.</summary>
    public bool LightMode { get; set; }
    public List<GrantCycleDto> Cycles { get; set; } = new();
    public List<GrantApplicationListItemDto> Applications { get; set; } = new();
    /// <summary>The club's grant qualification per Rotary year (newest first); submitting needs a current one.</summary>
    public List<GrantClubQualificationDto> Qualifications { get; set; } = new();
    /// <summary>The district refuses submits from unqualified clubs (else they are only warned).</summary>
    public bool RequireQualification { get; set; }
}

/// <summary>District grant settings.</summary>
public class GrantSettingsDto
{
    /// <summary>Require club qualification to submit. Off (default): unqualified clubs are warned but may submit.</summary>
    public bool RequireQualification { get; set; }
}

public class GrantLightProjectDto
{
    public int ProjectId { get; set; }
    public string Title { get; set; } = "";
    public DateTime? ProjectDate { get; set; }
    public decimal? GrantAmount { get; set; }
    public DateTime? ReportDate { get; set; }
}

public class SaveGrantLightDto
{
    public decimal? GrantAmount { get; set; }
    public DateTime? ReportDate { get; set; }
}

// ===== Grants extras (2026-11-20): club qualification, monthly cash flow with receipts, email templates =====

public class GrantQualifiedMemberDto
{
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public DateTime? TrainedOn { get; set; }
}

/// <summary>A club's grant qualification for one Rotary year: MOU signed and officer training attended.</summary>
public class GrantClubQualificationDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public DateTime? MouSignedOn { get; set; }
    public DateTime? TrainingOn { get; set; }
    public DateTime? ExpiresOn { get; set; }
    public string? Note { get; set; }
    public DateTime? ModifiedAtUtc { get; set; }
    /// <summary>Qualified now (both dates set, not expired).</summary>
    public bool Qualified { get; set; }
    /// <summary>Why not, when not qualified.</summary>
    public string? Problem { get; set; }
    public List<GrantQualifiedMemberDto> Members { get; set; } = new();
}

public class SaveGrantQualificationDto
{
    public DateTime? MouSignedOn { get; set; }
    public DateTime? TrainingOn { get; set; }
    public DateTime? ExpiresOn { get; set; }
    public string? Note { get; set; }
    public List<GrantQualifiedMemberDto> Members { get; set; } = new();
}

public class GrantReceiptDto
{
    public int Id { get; set; }
    public decimal Amount { get; set; }
    public DateTime ReceivedOn { get; set; }
    public string Source { get; set; } = "";
    public string? Reference { get; set; }
    public string? RecordedByName { get; set; }
}

public class SaveGrantReceiptDto
{
    public decimal? Amount { get; set; }
    public DateTime? ReceivedOn { get; set; }
    public string? Source { get; set; }
    public string? Reference { get; set; }
}

public class GrantMonthRowDto
{
    public string Month { get; set; } = "";          // yyyy-MM
    public decimal Approved { get; set; }
    public decimal PaidOut { get; set; }
    public decimal Receipts { get; set; }
    /// <summary>Receipts minus payments, cumulative to the end of the month.</summary>
    public decimal Balance { get; set; }
}

public class GrantMonthlyCashFlowDto
{
    public int CycleId { get; set; }
    public string YearLabel { get; set; } = "";
    public decimal DdfBudget { get; set; }
    public decimal Approved { get; set; }
    public decimal PaidOut { get; set; }
    public decimal Receipts { get; set; }
    public decimal Balance { get; set; }
    public List<GrantMonthRowDto> Months { get; set; } = new();
    public List<GrantReceiptDto> ReceiptList { get; set; } = new();
}

public class GrantEmailTemplateDto
{
    public string Kind { get; set; } = "";           // status | reminder
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public bool IsDefault { get; set; }
}

public class SaveGrantEmailTemplateDto
{
    public string? Subject { get; set; }
    public string? Body { get; set; }
}

public class GrantEmailPreviewDto
{
    public string Subject { get; set; } = "";
    public string Html { get; set; } = "";
}
