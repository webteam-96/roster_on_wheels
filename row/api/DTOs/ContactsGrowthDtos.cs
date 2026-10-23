using System.Text.Json.Serialization;

namespace RotaryApi.DTOs;

// N3 contacts, prospects, growth, invite prompts (2026-10-23).

public class ContactDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string ContactType { get; set; } = "guest";
    public string? Organisation { get; set; }
    public string? Notes { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedDate { get; set; }
    [JsonIgnore] public string? GroupIdsCsv { get; set; }
    public List<int> GroupIds => (GroupIdsCsv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
}

public class SaveContactDto
{
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? ContactType { get; set; }
    public string? Organisation { get; set; }
    public string? Notes { get; set; }
    public List<int>? GroupIds { get; set; }
}

public class ContactGroupDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int ContactCount { get; set; }
}

public class SaveContactGroupDto
{
    public string Name { get; set; } = "";
}

/// <summary>One spreadsheet row, already mapped to fields by the browser.</summary>
public class ContactImportRowDto
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? ContactType { get; set; }
    public string? Organisation { get; set; }
    public string? Notes { get; set; }
}

public class ContactImportRequest
{
    public List<ContactImportRowDto> Rows { get; set; } = new();
    public int? GroupId { get; set; }
    /// <summary>Duplicates fill in their blank fields when true; otherwise they are skipped.</summary>
    public bool UpdateExisting { get; set; }
}

public class ContactImportPreviewRowDto
{
    public int Row { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string ContactType { get; set; } = "guest";
    /// <summary>new, duplicate or invalid.</summary>
    public string Status { get; set; } = "new";
    public string? Reason { get; set; }
    public int? MatchId { get; set; }
}

public class ContactImportResultDto
{
    public int Created { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
    public int Invalid { get; set; }
}

public class InviteEventRequest
{
    public int EventId { get; set; }
    public List<int> ContactGroupIds { get; set; } = new();
    public string? FromName { get; set; }
}

public class StageCountDto
{
    public string Stage { get; set; } = "";
    public int Count { get; set; }
}

public class ClubGrowthDto
{
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public int? Target { get; set; }
    public int Joined { get; set; }
    public int Terminated { get; set; }
    public int NetGrowth => Joined - Terminated;
    public int CurrentMembers { get; set; }
    public int? ProgressPercent => Target is > 0 ? (int)Math.Round(NetGrowth * 100.0 / Target.Value) : null;
    public List<StageCountDto> ProspectsByStage { get; set; } = new();
}

public class SetGrowthTargetDto
{
    public int YearId { get; set; }
    public int Target { get; set; }
}

public class DistrictGrowthClubDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int? Target { get; set; }
    public int Joined { get; set; }
    public int Terminated { get; set; }
    public int NetGrowth => Joined - Terminated;
    public int? ProgressPercent => Target is > 0 ? (int)Math.Round(NetGrowth * 100.0 / Target.Value) : null;
    public int OpenProspects { get; set; }
}

public class DistrictGrowthDto
{
    public int DistrictId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public int TargetTotal { get; set; }
    public int ClubsWithTarget { get; set; }
    public int ClubsReached { get; set; }
    public int Joined { get; set; }
    public int Terminated { get; set; }
    public int NetGrowth => Joined - Terminated;
    public List<StageCountDto> ProspectsByStage { get; set; } = new();
    public List<DistrictGrowthClubDto> Clubs { get; set; } = new();
}

public class InvitePromptDto
{
    public int Id { get; set; }
    public DateTime MeetingDate { get; set; }
    public DateTime SendOn { get; set; }
    public string? Note { get; set; }
    public string Status { get; set; } = "";
    public int SentCount { get; set; }
    public DateTime? SentDate { get; set; }
}

public class CreateInvitePromptDto
{
    public DateTime MeetingDate { get; set; }
    public int DaysBefore { get; set; } = 3;
    public string? Note { get; set; }
}

public class PublicJoinRequest
{
    public int ClubId { get; set; }
    /// <summary>Set by the district website: the club must belong to this district.</summary>
    public int? DistrictId { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Message { get; set; }
    public bool Consent { get; set; }
    /// <summary>Honeypot: a hidden field people never fill in.</summary>
    public string? Website { get; set; }
    /// <summary>Milliseconds between the form showing and being sent; bots post at once.</summary>
    public int ElapsedMs { get; set; }
}

public class PublicRsvpRequest
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public bool Attending { get; set; }
    public bool InterestedInJoining { get; set; }
    public bool Consent { get; set; }
    public string? Website { get; set; }
    public int ElapsedMs { get; set; }
}

public class PublicInviteDto
{
    public string ClubName { get; set; } = "";
    public string InviterName { get; set; } = "";
    public DateTime? MeetingDate { get; set; }
    public string? MeetingDay { get; set; }
    public string? MeetingFromTime { get; set; }
    public string? MeetingToTime { get; set; }
    public string? MeetingAddress { get; set; }
}
