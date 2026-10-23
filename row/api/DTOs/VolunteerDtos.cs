namespace RotaryApi.DTOs;

// Volunteers and speakers (ROW build spec 3.13): Services/VolunteerService.cs and Services/SpeakerService.cs.

public class VolunteerSheetListItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Status { get; set; } = "open";      // open | closed
    public bool IsPublic { get; set; }
    public string? EventTitle { get; set; }
    public int? ProjectId { get; set; }
    public int SlotCount { get; set; }
    public int Capacity { get; set; }
    public int Filled { get; set; }
    public DateTime? FirstStart { get; set; }
    public decimal Hours { get; set; }
}

public class VolunteerSignupDto
{
    public int Id { get; set; }
    public int SlotId { get; set; }
    public int? MemberId { get; set; }                // null: a non-member who signed up through the public link
    public string Name { get; set; } = "";
    public string? Email { get; set; }                // non-members only
    public decimal? Hours { get; set; }
    public DateTime? ReminderSentAt { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class VolunteerSlotDto
{
    public int Id { get; set; }
    public string Task { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int Capacity { get; set; }
    public int Filled { get; set; }
    public List<VolunteerSignupDto> Signups { get; set; } = new();
}

public class VolunteerSheetDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public int? EventId { get; set; }
    public string? EventTitle { get; set; }
    public int? YearId { get; set; }
    public int? ProjectId { get; set; }
    public string? ProjectTitle { get; set; }
    public int? ProjectManHours { get; set; }         // the project's man_hours now, these hours included
    public int HoursApplied { get; set; }             // what this sheet has added to the project's man_hours
    public decimal TotalHours { get; set; }
    public string PublicToken { get; set; } = "";
    public bool IsPublic { get; set; }
    public string Status { get; set; } = "open";
    public List<VolunteerSlotDto> Slots { get; set; } = new();
}

public class SaveVolunteerSlotDto
{
    public int? Id { get; set; }                      // null: a new slot
    public string Task { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int Capacity { get; set; }
}

public class SaveVolunteerSheetDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public int? EventId { get; set; }
    public int? YearId { get; set; }                  // with ProjectId: the project whose man-hours the hours roll into
    public int? ProjectId { get; set; }
    public bool IsPublic { get; set; } = true;
    public string Status { get; set; } = "open";
    public List<SaveVolunteerSlotDto> Slots { get; set; } = new();
}

public class VolunteerHoursEntryDto
{
    public int SignupId { get; set; }
    public decimal? Hours { get; set; }
}

public class VolunteerHoursDto
{
    public List<VolunteerHoursEntryDto> Entries { get; set; } = new();
}

public class VolunteerTargetDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime? Date { get; set; }
}

public class VolunteerTargetsDto
{
    public List<VolunteerTargetDto> Events { get; set; } = new();
    public List<VolunteerTargetDto> Projects { get; set; } = new();
}

// ── The app (a member of the sheet's club) ──

public class MemberVolunteerSlotDto
{
    public int Id { get; set; }
    public string Task { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int Capacity { get; set; }
    public int Filled { get; set; }
    public bool SignedUp { get; set; }
}

public class MemberVolunteerSheetDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public List<MemberVolunteerSlotDto> Slots { get; set; } = new();
}

// ── The public sign-up link ──

public class PublicVolunteerSlotDto
{
    public int Id { get; set; }
    public string Task { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int SpotsLeft { get; set; }
}

public class PublicVolunteerSheetDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string ClubName { get; set; } = "";
    public string? EventTitle { get; set; }
    public string FormToken { get; set; } = "";      // time-limited, sent back with the sign-up
    public List<PublicVolunteerSlotDto> Slots { get; set; } = new();
}

public class PublicVolunteerSignupDto
{
    public int SlotId { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
    public bool Consent { get; set; }
    public string? FormToken { get; set; }
    public string? Website { get; set; }              // honeypot: hidden from people, filled by bots
}

// ── Speakers and meeting duties ──

public class SpeakerDto
{
    public int Id { get; set; }
    public DateTime MeetingDate { get; set; }
    public string Name { get; set; } = "";
    public string? Topic { get; set; }
    public string? Bio { get; set; }
    public string? PhotoPath { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public bool ShowOnWebsite { get; set; }
}

public class SaveSpeakerDto
{
    public DateTime MeetingDate { get; set; }
    public string Name { get; set; } = "";
    public string? Topic { get; set; }
    public string? Bio { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public bool ShowOnWebsite { get; set; } = true;
}

/// <summary>What the website and the app show: no contact details.</summary>
public class PublicSpeakerDto
{
    public DateTime MeetingDate { get; set; }
    public string Name { get; set; } = "";
    public string? Topic { get; set; }
    public string? Bio { get; set; }
    public string? PhotoPath { get; set; }
}

public class MeetingDutyDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public DateTime MeetingDate { get; set; }
    public string Duty { get; set; } = "";
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public string? Note { get; set; }
    public DateTime? ReminderSentAt { get; set; }
}

public class SaveMeetingDutyDto
{
    public DateTime MeetingDate { get; set; }
    public string Duty { get; set; } = "";
    public int MemberId { get; set; }
    public string? Note { get; set; }
}
