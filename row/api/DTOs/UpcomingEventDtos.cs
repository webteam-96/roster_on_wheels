namespace RotaryApi.DTOs;

public class UpcomingEventListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime EventDate { get; set; }
    public DateTime PublishDate { get; set; }
    public DateTime ExpiryDate { get; set; }
    public string? EventVenue { get; set; }
    public string? RegistrationLink { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public string Status { get; set; } = "";
    public int ReminderCount { get; set; }
    public DateTime? WhatsAppSentDate { get; set; }
    public int WhatsAppSentCount { get; set; }
    public int WhatsAppFailedCount { get; set; }
    public DateTime? EmailSentDate { get; set; }
    public int EmailSentCount { get; set; }
    public int EmailFailedCount { get; set; }
}

public class UpcomingEventDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime EventDate { get; set; }
    public DateTime PublishDate { get; set; }
    public DateTime ExpiryDate { get; set; }
    public string? EventVenue { get; set; }
    public string? RegistrationLink { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public string Status { get; set; } = "";
    public string? RecipientTarget { get; set; }
    public string? RecipientZoneIds { get; set; }
    public string? RecipientDistrictIds { get; set; }
    public string? RecipientSubgroupIds { get; set; }
    public List<EventReminderDto> Reminders { get; set; } = new();
}

public class EventReminderDto
{
    public int Id { get; set; }
    public DateTime ReminderDateTime { get; set; }
}

public class CreateUpcomingEventDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime EventDate { get; set; }
    public DateTime PublishDate { get; set; }
    public DateTime ExpiryDate { get; set; }
    public string? EventVenue { get; set; }
    public string? RegistrationLink { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public List<DateTime>? Reminders { get; set; }
    public string? RecipientTarget { get; set; }
    public int[]? RecipientZoneIds { get; set; }
    public int[]? RecipientDistrictIds { get; set; }
    public int[]? RecipientSubgroupIds { get; set; }
}

public class UpdateUpcomingEventDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? ImagePath { get; set; }
    public DateTime EventDate { get; set; }
    public DateTime PublishDate { get; set; }
    public DateTime ExpiryDate { get; set; }
    public string? EventVenue { get; set; }
    public string? RegistrationLink { get; set; }
    public bool IsSendWhatsapp { get; set; }
    public bool IsSendEmail { get; set; }
    public bool IsRepeatNotification { get; set; }
    public List<DateTime>? Reminders { get; set; }
    public string? RecipientTarget { get; set; }
    public int[]? RecipientZoneIds { get; set; }
    public int[]? RecipientDistrictIds { get; set; }
    public int[]? RecipientSubgroupIds { get; set; }
}
