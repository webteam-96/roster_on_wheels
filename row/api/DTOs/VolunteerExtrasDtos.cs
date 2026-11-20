namespace RotaryApi.DTOs;

// Volunteer sheet extras (Services/VolunteerExtrasService.cs).

public class VolunteerFollowupDto
{
    public int? Id { get; set; }                      // null: a new follow-up
    public string Kind { get; set; } = "before";      // before (days before the slot starts) | after (days after it ends)
    public int Days { get; set; }
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public int SentCount { get; set; }                // read only: sign-ups it has gone to
}

public class VolunteerCoordinatorDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public bool HasEmail { get; set; }
}

public class VolunteerSheetExtrasDto
{
    public string? ConfirmationText { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public List<VolunteerFollowupDto> Followups { get; set; } = new();
    public List<int> CoordinatorIds { get; set; } = new();
    public List<VolunteerCoordinatorDto> Members { get; set; } = new();   // the club's active members to pick from
}

public class SaveVolunteerSheetExtrasDto
{
    public string? ConfirmationText { get; set; }
    public List<VolunteerFollowupDto> Followups { get; set; } = new();
    public List<int> CoordinatorIds { get; set; } = new();
}

public class VolunteerArchiveDto
{
    public bool Archived { get; set; }
}

public class VolunteerCopyDto
{
    public int ShiftDays { get; set; }                // slot times move by this many days
}

public class MemberVolunteerReminderDto
{
    public string Kind { get; set; } = "before";
    public int Days { get; set; }
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime DueAt { get; set; }
    public DateTime? SentAt { get; set; }
}

public class MemberVolunteerSignupDto
{
    public int SignupId { get; set; }
    public int SlotId { get; set; }
    public string SheetTitle { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string Task { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public string? ConfirmationText { get; set; }
    public List<MemberVolunteerReminderDto> Reminders { get; set; } = new();
}
