namespace RotaryApi.DTOs;

public class AnnouncementListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public bool IsDisplayOnBanner { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public string Status { get; set; } = "";
    public int ReminderCount { get; set; }
    // Per-channel send outcome (for the listing status chips: Pending / Sent X · Failed Y).
    public DateTime? EmailSentDate { get; set; }
    public int EmailSentCount { get; set; }
    public int EmailFailedCount { get; set; }
}

public class AnnouncementDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public bool IsDisplayOnBanner { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public string Status { get; set; } = "";
    public List<AnnouncementReminderDto> Reminders { get; set; } = new();
}

public class AnnouncementReminderDto
{
    public int Id { get; set; }
    public DateTime ReminderDateTime { get; set; }
}

public class CreateAnnouncementDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public bool IsDisplayOnBanner { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public List<DateTime>? Reminders { get; set; }
}

public class UpdateAnnouncementDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public bool IsDisplayOnBanner { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public List<DateTime>? Reminders { get; set; }
}
