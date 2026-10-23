namespace RotaryApi.DTOs;

// Planning mode (ROW build spec 3.1, Services/PlanningService.cs).

public class StartPlanningDto
{
    /// <summary>The governor-elect; when null, the DGE that RI holds for the year being planned (district_governors).</summary>
    public int? DgeMemberId { get; set; }
}

public class PlanningAppointDto
{
    /// <summary>DS (district secretary) or DT (district treasurer).</summary>
    public string Role { get; set; } = "";
    public int MemberId { get; set; }
}

public class PlanningInviteDto
{
    public int ClubId { get; set; }
    /// <summary>PE (president-elect) or SE (secretary-elect).</summary>
    public string Role { get; set; } = "";
    public int MemberId { get; set; }
}

public class PlanningAcceptDto
{
    public string Token { get; set; } = "";
}

/// <summary>A district's planning state, for the banner and the app.</summary>
public class PlanningStateDto
{
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public string State { get; set; } = "live";
    public int? PlanningYearId { get; set; }
    public string? PlanningYearLabel { get; set; }
    public DateTime? PlanningYearStart { get; set; }
    public DateTime? PlanningYearEnd { get; set; }
    public int? ReadOnlyYearId { get; set; }
    public string? ReadOnlyYearLabel { get; set; }
    public bool ReadOnlyYearArchived { get; set; }
    public DateTime? CutoverAt { get; set; }
    public DateTime? CutoverDoneAt { get; set; }
}

/// <summary>One elect role (planning_roles row).</summary>
public class PlanningRoleDto
{
    public int RoleId { get; set; }
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public string Role { get; set; } = "";
    public string Status { get; set; } = "";
    public string Source { get; set; } = "";
    public int MemberId { get; set; }
    public string? MemberName { get; set; }
    public int YearId { get; set; }
    public string? YearLabel { get; set; }
    public DateTime? YearStart { get; set; }
    public DateTime? YearEnd { get; set; }
    public DateTime? InvitedAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
}

public class PlanningLaunchpadItemDto
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public bool Done { get; set; }
    public string Detail { get; set; } = "";
    /// <summary>Not built yet (clubs authorised with RI waits for the RI vendor path).</summary>
    public bool Stub { get; set; }
}

public class PlanningClubDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public PlanningRoleDto? Pe { get; set; }
    public PlanningRoleDto? Se { get; set; }
}

public class PlanningOverviewDto
{
    public PlanningStateDto State { get; set; } = new();
    public List<PlanningRoleDto> Team { get; set; } = new();
    public List<PlanningClubDto> Clubs { get; set; } = new();
    public List<PlanningLaunchpadItemDto> Launchpad { get; set; } = new();
    /// <summary>The viewer may appoint, invite, revoke and run the cut-over (the DGE or a SuperAdmin).</summary>
    public bool CanManage { get; set; }
}
