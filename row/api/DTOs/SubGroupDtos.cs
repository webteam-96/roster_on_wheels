namespace RotaryApi.DTOs;

public class SubGroupListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string GroupName { get; set; } = "";
    public int MemberCount { get; set; }
}

public class CreateSubGroupDto
{
    public int YearId { get; set; }
    public string GroupName { get; set; } = "";
    public List<int> MemberIds { get; set; } = new();
}

public class UpdateSubGroupDto
{
    public int YearId { get; set; }
    public string GroupName { get; set; } = "";
    public List<int> MemberIds { get; set; } = new();
}

public class SubGroupDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string GroupName { get; set; } = "";
    public List<SubGroupMemberDto> Members { get; set; } = new();
}

public class SubGroupMemberDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ProfilePhotoPath { get; set; }
    public string? ClubName { get; set; }
}
