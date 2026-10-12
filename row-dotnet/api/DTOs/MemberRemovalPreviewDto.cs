namespace RotaryApi.DTOs;

public class MemberRemovalPreviewDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? EmailId { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public bool IsLastClub { get; set; }
    public List<OtherClubInfo> OtherClubs { get; set; } = new();
    public List<string> RolesInThisClub { get; set; } = new();
    public List<string> AllRoleNames { get; set; } = new();
    public List<BodEntry> BodEntries { get; set; } = new();
    public List<DcCommitteeEntry> DcCommitteeMemberships { get; set; } = new();
    public List<DcGroupEntry> DcGroupMemberships { get; set; } = new();
    public List<DcSubGroupEntry> SubGroupMemberships { get; set; } = new();
}

public class OtherClubInfo
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
}

public class BodEntry
{
    public string DesignationName { get; set; } = "";
    public string YearLabel { get; set; } = "";
}

public class DcCommitteeEntry
{
    public string Designation { get; set; } = "";
    public string YearLabel { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
}

public class DcGroupEntry
{
    public string GroupName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
}

public class DcSubGroupEntry
{
    public string SubGroupName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
}
