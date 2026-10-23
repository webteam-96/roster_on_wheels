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
    public string Kind { get; set; } = "";          // income | expense | partner
    public string Description { get; set; } = "";
    public string? Detail { get; set; }
    public decimal? Amount { get; set; }
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
    public string Kind { get; set; } = "";          // application | report
    public string OriginalName { get; set; } = "";
    public int SizeBytes { get; set; }
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
    public string? CreatedByName { get; set; }
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
