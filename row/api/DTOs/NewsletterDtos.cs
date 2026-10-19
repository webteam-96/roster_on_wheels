namespace RotaryApi.DTOs;

public class NewsletterListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string AttachmentType { get; set; } = "link";
    public string? LinkUrl { get; set; }
    public string? FilePath { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public string Status { get; set; } = "";
    public DateTime? WhatsAppSentDate { get; set; }
    public int WhatsAppSentCount { get; set; }
    public int WhatsAppFailedCount { get; set; }
    public DateTime? EmailSentDate { get; set; }
    public int EmailSentCount { get; set; }
    public int EmailFailedCount { get; set; }
}

public class NewsletterDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string AttachmentType { get; set; } = "link";
    public string? LinkUrl { get; set; }
    public string? FilePath { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public string Status { get; set; } = "";
    public string? RecipientTarget { get; set; }
    public string? RecipientZoneIds { get; set; }
    public string? RecipientDistrictIds { get; set; }
    public string? RecipientSubgroupIds { get; set; }
}

public class CreateNewsletterDto
{
    public string Title { get; set; } = "";
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string AttachmentType { get; set; } = "link";
    public string? LinkUrl { get; set; }
    public string? FilePath { get; set; }
    public bool IsSendEmail { get; set; }
}

public class UpdateNewsletterDto
{
    public string Title { get; set; } = "";
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string AttachmentType { get; set; } = "link";
    public string? LinkUrl { get; set; }
    public string? FilePath { get; set; }
    public bool IsSendEmail { get; set; }
}
