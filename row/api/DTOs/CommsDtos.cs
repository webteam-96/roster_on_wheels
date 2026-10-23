namespace RotaryApi.DTOs;

// N5 Communication upgrades (CommsService / CommsController).

public class CommSettingsDto
{
    public string? DefaultLanguage { get; set; }
    /// <summary>The language used when a member has none: this setting, else the district's, else the platform's.</summary>
    public string EffectiveLanguage { get; set; } = "";
    public bool GovernorNoteEnabled { get; set; }
    public string? GovernorName { get; set; }
    public string? GovernorPhotoUrl { get; set; }
    public string? GovernorMessage { get; set; }
    public string? SenderFromName { get; set; }
    public string? SenderFromEmail { get; set; }
    public string? SenderReplyTo { get; set; }
    /// <summary>District only: the Foundation giving link for {{foundation_link}} in greetings and milestone texts.</summary>
    public string? FoundationGivingUrl { get; set; }
}

public class CommTemplateDto
{
    public int Id { get; set; }
    public string TemplateKey { get; set; } = "";
    public string Language { get; set; } = "";
    public string Subject { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    /// <summary>False for a machine translation nobody has reviewed yet (shown as beta).</summary>
    public bool Reviewed { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

public class SaveCommTemplateDto
{
    public string? TemplateKey { get; set; }
    public string? Language { get; set; }
    public string? Subject { get; set; }
    public string? BodyHtml { get; set; }
    public bool Reviewed { get; set; } = true;
}

public class DnsRecordDto
{
    public string Type { get; set; } = "TXT";
    public string Host { get; set; } = "";
    public string Value { get; set; } = "";
    public string Purpose { get; set; } = "";
}

public class SenderDomainDto
{
    public int Id { get; set; }
    public string Domain { get; set; } = "";
    public string DkimSelector { get; set; } = "";
    public string VerifyToken { get; set; } = "";
    public bool OwnershipOk { get; set; }
    public bool SpfOk { get; set; }
    public bool DkimOk { get; set; }
    public bool DmarcOk { get; set; }
    public bool Verified => OwnershipOk && SpfOk && DkimOk && DmarcOk;
    public DateTime? CheckedAt { get; set; }
    public List<DnsRecordDto> Records { get; set; } = new();
}

public class AddSenderDomainDto
{
    public string? Domain { get; set; }
    public string? DkimSelector { get; set; }
}

public class CommUsageCampaignDto
{
    public int Id { get; set; }
    public string Subject { get; set; } = "";
    public DateTime? SentDate { get; set; }
    public int Sent { get; set; }
    public int Delivered { get; set; }
    public int Opened { get; set; }
    public int Clicked { get; set; }
    public int Bounced { get; set; }
    public int Complaints { get; set; }
    public int Skipped { get; set; }
}

public class CommUsageDto
{
    public string Month { get; set; } = "";
    public string Edition { get; set; } = "";
    /// <summary>Null when the edition has no allowance (sends are not limited).</summary>
    public int? PerMember { get; set; }
    public int Members { get; set; }
    public int? Allowance { get; set; }
    public int Used { get; set; }
    public int? Remaining { get; set; }
    public List<CommUsageCampaignDto> Campaigns { get; set; } = new();
}

public class CommSuppressionDto
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Reason { get; set; } = "";
    public DateTime CreatedDate { get; set; }
}

public class CommOptOutDto
{
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public string Channel { get; set; } = "";
    public DateTime ChangedAtUtc { get; set; }
    public string Source { get; set; } = "";
}

public class CampaignRecipientTrackingDto
{
    public string? MemberName { get; set; }
    public string? Email { get; set; }
    public string? Language { get; set; }
    public string Status { get; set; } = "";
    public string? DeliveryStatus { get; set; }
    public DateTime? SentDate { get; set; }
    public DateTime? OpenedAt { get; set; }
    public int OpenCount { get; set; }
    public DateTime? ClickedAt { get; set; }
    public int ClickCount { get; set; }
    public string? ErrorMessage { get; set; }
}

public class CampaignTrackingDto : CommUsageCampaignDto
{
    public string Status { get; set; } = "";
    public string? TemplateKey { get; set; }
    public int Recipients { get; set; }
    public int Failed { get; set; }
    public List<CampaignRecipientTrackingDto> RecipientRows { get; set; } = new();
}

public class ChannelConsentDto
{
    public string Channel { get; set; } = "";
    public bool Consented { get; set; } = true;
    /// <summary>Null when the member never changed it (members receive club and district mail until they opt out).</summary>
    public DateTime? ChangedAtUtc { get; set; }
    public string? Source { get; set; }
}

public class MemberCommsPreferencesDto
{
    /// <summary>As stored on the member record (a code such as "es", or a language name from the profile).</summary>
    public string? Language { get; set; }
    public string EffectiveLanguage { get; set; } = "";
    public List<ChannelConsentDto> Consents { get; set; } = new();
}

public class SetMemberConsentsDto
{
    public bool? Email { get; set; }
    public bool? Push { get; set; }
}

public class UnsubscribeInfoDto
{
    public string MaskedEmail { get; set; } = "";
    public bool Subscribed { get; set; }
}
