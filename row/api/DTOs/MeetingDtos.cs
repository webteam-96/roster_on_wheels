using System.ComponentModel.DataAnnotations;

namespace RotaryApi.DTOs;

/// <summary>Meeting compliance for one month (N8 Meetings, build spec B.1 #31).</summary>
public class MeetingComplianceDto
{
    /// <summary>YYYY-MM</summary>
    public string Month { get; set; } = "";
    /// <summary>The district's rule, or the platform default (2) when the district has not set one.</summary>
    public int DistrictDefault { get; set; }
    public bool DistrictDefaultIsSet { get; set; }
    public List<MeetingComplianceClubDto> Clubs { get; set; } = new();
}

public class MeetingComplianceClubDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    /// <summary>Meetings required in the month: the club's override, else the district default.</summary>
    public int Required { get; set; }
    public bool IsOverride { get; set; }
    /// <summary>Meeting records dated in the month, not in the future, with attendance marked.</summary>
    public int Held { get; set; }
    /// <summary>met | due (the month is not over yet) | missed</summary>
    public string Status { get; set; } = "";
}

/// <summary>ClubId null sets the district default; a club id sets that club's override, and a null count clears it.</summary>
public class SetMeetingRuleDto
{
    public int? ClubId { get; set; }
    [Range(0, 31)]
    public int? MeetingsPerMonth { get; set; }
}
