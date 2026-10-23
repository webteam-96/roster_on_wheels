namespace RotaryApi.DTOs;

public class CreateMassEmailDto
{
    public int RecipientType { get; set; } = 1; // Club: 1=All, 2=Subgroup, 3=Manual. District: 1=All, 2=Clubs, 3=Subgroups. Both: 4=Contact groups
    public int? FkSubgroupId { get; set; }
    public List<int>? SubgroupIds { get; set; }
    public List<int>? ClubIds { get; set; }
    public List<int>? MemberIds { get; set; }
    public List<int>? ContactGroupIds { get; set; }
    public string FromName { get; set; } = "";
    public string? ReplyName { get; set; }
    public string? ReplyEmail { get; set; }
    public string Subject { get; set; } = "";
    public string? EmailBody { get; set; }
    public bool SaveAsDraft { get; set; }
    // N5: template whose language versions replace Subject/EmailBody per member (Subject/EmailBody stay the fallback).
    public string? TemplateKey { get; set; }
}

public class MassEmailListDto
{
    public int Id { get; set; }
    public string Subject { get; set; } = "";
    public string Status { get; set; } = "";
    public int RecipientType { get; set; }
    public int TotalRecipients { get; set; }
    public int SentCount { get; set; }
    public int FailedCount { get; set; }
    public DateTime? SentDate { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class MassEmailDetailDto
{
    public int Id { get; set; }
    public int FkClubId { get; set; }
    public int RecipientType { get; set; }
    public int? FkSubgroupId { get; set; }
    public string? SubgroupName { get; set; }
    [System.Text.Json.Serialization.JsonIgnore] public string? ContactGroupIdsCsv { get; set; }
    public List<int> ContactGroupIds => (ContactGroupIdsCsv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
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
    public DateTime CreatedDate { get; set; }
    public string? TemplateKey { get; set; }
    public List<MassEmailRecipientDto> Recipients { get; set; } = new();
}

public class MassEmailRecipientDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public DateTime? SentDate { get; set; }
    public string? ErrorMessage { get; set; }
}

public class RecipientCountDto
{
    public int TotalMembers { get; set; }
    public int MembersWithEmail { get; set; }
}
