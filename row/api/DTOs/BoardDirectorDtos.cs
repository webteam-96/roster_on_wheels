namespace RotaryApi.DTOs;

// Designation Master
public class DesignationDto
{
    public int Id { get; set; }
    public string DesignationName { get; set; } = "";
    public int SortOrder { get; set; }
    public int BodCount { get; set; }
}

public class CreateDesignationDto
{
    public string DesignationName { get; set; } = "";
    public int SortOrder { get; set; }
}

public class UpdateDesignationDto
{
    public string DesignationName { get; set; } = "";
    public int SortOrder { get; set; }
}

public class ReorderDesignationsDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}

public class ReorderDesignationsAllDto
{
    public int[] OrderedIds { get; set; } = Array.Empty<int>();
}

// Board of Directors. A row is either a real member (MemberId set) or — for PAST years only —
// a non-member captured by free-text Name/Mobile/Email (kept separate from member_master_profile).
public class BoardDirectorDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int? MemberId { get; set; }
    public bool IsMember { get; set; }
    public string MemberName { get; set; } = "";   // resolved: member name OR non-member name
    public string? ProfilePhotoPath { get; set; }
    public string? NonMemberName { get; set; }
    public string? NonMemberMobile { get; set; }
    public string? NonMemberEmail { get; set; }
    public int DesignationId { get; set; }
    public string DesignationName { get; set; } = "";   // resolved: custom text when designation is "Other", else master name
    public string? CustomDesignation { get; set; }       // raw free-text designation ("Other" only)
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
}

public class CreateBoardDirectorDto
{
    public int? MemberId { get; set; }
    public string? NonMemberName { get; set; }
    public string? NonMemberMobile { get; set; }
    public string? NonMemberEmail { get; set; }
    public int DesignationId { get; set; }
    public string? CustomDesignation { get; set; }   // required when the designation is "Other"
    public int YearId { get; set; }
}

public class UpdateBoardDirectorDto
{
    public int? MemberId { get; set; }
    public string? NonMemberName { get; set; }
    public string? NonMemberMobile { get; set; }
    public string? NonMemberEmail { get; set; }
    public int DesignationId { get; set; }
    public string? CustomDesignation { get; set; }   // required when the designation is "Other"
    public int YearId { get; set; }
}

public class BoardYearDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public string StartDate { get; set; } = "";
    public string EndDate { get; set; } = "";
    public bool IsCurrent { get; set; }
}
