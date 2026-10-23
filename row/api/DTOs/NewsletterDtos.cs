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
    public bool IsSendEmail { get; set; }
    public string Status { get; set; } = "";
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
    public bool IsSendEmail { get; set; }
    public string Status { get; set; } = "";
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
