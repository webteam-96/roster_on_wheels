namespace RotaryApi.DTOs;

/// <summary>One figure on the target dashboard. Status: green, amber, red, or none when there is no target.</summary>
public class TargetMetricDto
{
    public decimal Actual { get; set; }
    public decimal? Target { get; set; }
    public int? Percent { get; set; }
    public string Status { get; set; } = "none";
}

public class TargetClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int? AgMemberId { get; set; }
    public string? AgName { get; set; }
    public string Status { get; set; } = "none";
    /// <summary>Keys: members, growth, newMembers, dues, attendance, meetings, projects, foundation.</summary>
    public Dictionary<string, TargetMetricDto> Metrics { get; set; } = new();
}

public class TargetAgGroupDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public int Clubs { get; set; }
}

public class TargetDashboardDto
{
    public int DistrictId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    /// <summary>Share of the Rotary year already passed; the status colours compare progress with it.</summary>
    public int YearElapsedPercent { get; set; }
    /// <summary>True when the viewer sees every club of the district (district managers); totals then use the district's own goals.</summary>
    public bool WholeDistrict { get; set; }
    public Dictionary<string, TargetMetricDto> Totals { get; set; } = new();
    public List<TargetAgGroupDto> AgGroups { get; set; } = new();
    public List<TargetClubRowDto> Clubs { get; set; } = new();
}
