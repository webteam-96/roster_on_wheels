namespace RotaryApi.DTOs;

public class RiDirectorContextDto
{
    public int ZoneCount { get; set; }
    public int DistrictCount { get; set; }
    public int ClubCount { get; set; }
    public int MemberCount { get; set; }
    public RiCreditBalanceDto Credits { get; set; } = new();
}

public class RiCreditBalanceDto
{
    public int EmailTotal { get; set; }
    public int EmailUsed { get; set; }
    public int EmailBalance { get; set; }
    public int WhatsappTotal { get; set; }
    public int WhatsappUsed { get; set; }
    public int WhatsappBalance { get; set; }
}

public class RiCreditListDto
{
    public int Id { get; set; }
    public string CreditType { get; set; } = "";
    public int CreditCount { get; set; }
    public int UsedCount { get; set; }
    public int PreviousCount { get; set; }
    public DateTime FromDate { get; set; }
    public DateTime ToDate { get; set; }
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? ProofDocumentPath { get; set; }
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
    // Most recent time a credit of this type was consumed (email/WhatsApp sent). Null if never used.
    public DateTime? LastUsedDate { get; set; }
}

public class RiAddCreditDto
{
    public string CreditType { get; set; } = "";
    public int CreditCount { get; set; }
    public DateTime FromDate { get; set; }
    public DateTime ToDate { get; set; }
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? ProofDocumentPath { get; set; }
}

public class RiCreditUsageHistoryDto
{
    public int Id { get; set; }
    public string CreditType { get; set; } = "";
    public int DeductedCount { get; set; }
    public string Source { get; set; } = "";
    public int? SourceId { get; set; }
    public string? SourceDetail { get; set; }
    public int BalanceBefore { get; set; }
    public int BalanceAfter { get; set; }
    public DateTime? CreatedDate { get; set; }
}

// ── RI Sub Group Years (years that have at least one RI sub group) ──
public class RiSubGroupYearDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsCurrent { get; set; }
    public int GroupCount { get; set; }
}

// ── RI Sub Groups (year-scoped) ──
public class RiSubGroupListDto
{
    public int Id { get; set; }
    public int YearId { get; set; }
    public string? YearLabel { get; set; }
    public string GroupName { get; set; } = "";
    public int MemberCount { get; set; }
    public DateTime? CreatedDate { get; set; }
}

public class RiSubGroupDetailDto
{
    public int Id { get; set; }
    public int YearId { get; set; }
    public string? YearLabel { get; set; }
    public string GroupName { get; set; } = "";
    public List<RiSubGroupMemberDto> Members { get; set; } = new();
}

public class RiSubGroupMemberDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ProfilePhotoPath { get; set; }
    public string? ClubName { get; set; }
    public string? DistrictNumber { get; set; }
}

public class RiCreateSubGroupDto
{
    public int YearId { get; set; }
    public string GroupName { get; set; } = "";
    public List<int> MemberIds { get; set; } = new();
}

public class RiAvailableMemberDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ProfilePhotoPath { get; set; }
    public string? ClubName { get; set; }
    public string? DistrictNumber { get; set; }
    public int? ZoneId { get; set; }
    public string? ZoneName { get; set; }
}

// ── RI Mass Email ──
public class RiCreateMassEmailDto
{
    // RecipientType: 1 = All, 2 = Zones, 3 = Districts, 4 = Subgroups, 5 = Manual Members
    public int RecipientType { get; set; } = 1;
    public int[]? ZoneIds { get; set; }
    public int[]? DistrictIds { get; set; }
    public int[]? SubgroupIds { get; set; }
    public int[]? MemberIds { get; set; }
    public string FromName { get; set; } = "";
    public string? ReplyName { get; set; }
    public string? ReplyEmail { get; set; }
    public string Subject { get; set; } = "";
    public string? EmailBody { get; set; }
    public bool SaveAsDraft { get; set; } = true;
}

// ── RI Web Links ──
public class RiWeblinkListDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string LinkType { get; set; } = "url";
    public string? LinkUrl { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
}

public class RiCreateWeblinkDto
{
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string LinkType { get; set; } = "url"; // url | youtube
    public string? LinkUrl { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; } = 0;
    public bool IsActive { get; set; } = true;
}

// ── RI Newsletters ──
public class RiCreateNewsletterDto
{
    public string Title { get; set; } = "";
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string AttachmentType { get; set; } = "link"; // link | pdf
    public string? LinkUrl { get; set; }
    public string? FilePath { get; set; }
    public bool IsSendEmail { get; set; }
    public string? RecipientTarget { get; set; }
    public int[]? RecipientZoneIds { get; set; }
    public int[]? RecipientDistrictIds { get; set; }
    public int[]? RecipientSubgroupIds { get; set; }
}

public class RiMassEmailDetailDto
{
    public int Id { get; set; }
    public int RecipientType { get; set; }
    public string? RecipientTarget { get; set; }
    public string? RecipientZoneIds { get; set; }
    public string? RecipientDistrictIds { get; set; }
    public string? RecipientSubgroupIds { get; set; }
    public int? FkSubgroupId { get; set; }
    public string? SubgroupName { get; set; }
    public string FromName { get; set; } = "";
    public string? ReplyName { get; set; }
    public string? ReplyEmail { get; set; }
    public string Subject { get; set; } = "";
    public string? EmailBody { get; set; }
    public string Status { get; set; } = "";
    public int TotalRecipients { get; set; }
    public int SentCount { get; set; }
    public int FailedCount { get; set; }
    public DateTime? SentDate { get; set; }
    public DateTime? CreatedDate { get; set; }
    public List<MassEmailRecipientDto> Recipients { get; set; } = new();
}
