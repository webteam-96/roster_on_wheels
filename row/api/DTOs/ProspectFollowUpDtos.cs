namespace RotaryApi.DTOs;

// Prospect follow-up tasks and new-prospect notifications (gap agent, 2026-11-19).

public class ProspectTaskDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public int ProspectId { get; set; }
    public string ProspectName { get; set; } = "";
    public string? ProspectEmail { get; set; }
    public string? ProspectMobile { get; set; }
    public string? ProspectStage { get; set; }
    public string Title { get; set; } = "";
    public string? Notes { get; set; }
    public int AssigneeMemberId { get; set; }
    public string? AssigneeName { get; set; }
    /// <summary>The club's calendar day, yyyy-MM-dd.</summary>
    public string DueDate { get; set; } = "";
    public int? RemindDaysBefore { get; set; }
    public string Status { get; set; } = "open";
    public DateTime? ReminderSentAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CompletionNote { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class SaveProspectTaskDto
{
    public int ProspectId { get; set; }
    public string Title { get; set; } = "";
    public string? Notes { get; set; }
    public int AssigneeMemberId { get; set; }
    public DateTime DueDate { get; set; }
    public int? RemindDaysBefore { get; set; }
    /// <summary>Update only: "open" or "done"; null keeps the stored status.</summary>
    public string? Status { get; set; }
}

public class CompleteProspectTaskDto
{
    public string? Note { get; set; }
}

public class ProspectNotifySettingsDto
{
    public bool ToPresident { get; set; } = true;
    public bool ToMembershipChair { get; set; } = true;
    public List<int> MemberIds { get; set; } = new();
    public bool InApp { get; set; } = true;
    public bool Email { get; set; } = true;
    /// <summary>Read only: who holds the role this year, for the settings screen.</summary>
    public List<string> Presidents { get; set; } = new();
    public List<string> MembershipChairs { get; set; } = new();
}
