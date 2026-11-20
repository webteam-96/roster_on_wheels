namespace RotaryApi.DTOs;

public class BulletinDto
{
    public string Title { get; set; } = "";
    public string? Intro { get; set; }
    public string? PresidentMessage { get; set; }
    public string Layout { get; set; } = "classic";
    public List<int>? AnnouncementIds { get; set; } // club news, in the order picked
    public List<int>? EventIds { get; set; }        // upcoming events, in the order picked
    public List<int>? StoryIds { get; set; }        // approved member stories, in the order picked
    public bool IncludeBirthdays { get; set; } = true;
    public bool IncludeSpeakers { get; set; } = true;
}

public class BulletinSendDto
{
    public int RecipientType { get; set; } = 1; // 1 = all members, 2 = sub groups
    public List<int>? SubgroupIds { get; set; }
}

public class BulletinListItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Layout { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime? SentDate { get; set; }
    public DateTime CreatedDate { get; set; }
    public int? MassEmailId { get; set; }
    public int? TotalRecipients { get; set; }
    public int SubscriberCount { get; set; }
}

public record BulletinSendResult(int MassEmailId, int Subscribers, string? SubscriberNote);

public class BulletinDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Intro { get; set; }
    public string? PresidentMessage { get; set; }
    public string Layout { get; set; } = "classic";
    [System.Text.Json.Serialization.JsonIgnore] public string? AnnouncementIdsCsv { get; set; }
    public List<int> AnnouncementIds => RotaryApi.Services.BulletinService.ParseIds(AnnouncementIdsCsv);
    [System.Text.Json.Serialization.JsonIgnore] public string? EventIdsCsv { get; set; }
    public List<int> EventIds => RotaryApi.Services.BulletinService.ParseIds(EventIdsCsv);
    [System.Text.Json.Serialization.JsonIgnore] public string? StoryIdsCsv { get; set; }
    public List<int> StoryIds => RotaryApi.Services.BulletinService.ParseIds(StoryIdsCsv);
    public bool IncludeBirthdays { get; set; }
    public bool IncludeSpeakers { get; set; }
    public string Status { get; set; } = "Draft";
    public int? MassEmailId { get; set; }
    public DateTime? SentDate { get; set; }
    public DateTime CreatedDate { get; set; }
    public string? Html { get; set; }
}

public class BulletinOption
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime? Date { get; set; }
}

public class BulletinOptionsDto
{
    public List<BulletinOption> Announcements { get; set; } = new();
    public List<BulletinOption> Events { get; set; } = new();
    public List<BulletinOption> Stories { get; set; } = new();
    public int ConfirmedSubscribers { get; set; }
}

public class StoryDto
{
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
}

public class StoryReviewDto
{
    public string Decision { get; set; } = ""; // approve | reject | changes
    public string? Note { get; set; }
}

public class StoryItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Status { get; set; } = "";
    public int AuthorId { get; set; }
    public string? AuthorName { get; set; }
    public DateTime SubmittedDate { get; set; }
    public string? ReviewerName { get; set; }
    public string? ReviewNote { get; set; }
    public DateTime? ReviewedDate { get; set; }
}

public class PublicStoryDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime? PublishedDate { get; set; }
}

public class BulletinSignupDto
{
    public string Email { get; set; } = "";
    public string? Name { get; set; }
    public string? Website { get; set; } // honeypot: people leave it empty
}

public class BulletinSubscriberDto
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string? Name { get; set; }
    public string Status { get; set; } = "";
    public DateTime SignupDate { get; set; }
    public DateTime? ConfirmedDate { get; set; }
    public DateTime? UnsubscribedDate { get; set; }
}
