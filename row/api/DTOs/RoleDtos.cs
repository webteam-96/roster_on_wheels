namespace RotaryApi.DTOs;

public class RoleDto
{
    public int Id { get; set; }
    public string RoleName { get; set; } = "";
    public string Description { get; set; } = "";
}

public class AssignRoleRequestDto
{
    public int MemberId { get; set; }
    public int RoleId { get; set; } = 2; // Default to Admin role
    public int? ClubId { get; set; } // Club-specific admin role
}

public class RemoveRoleRequestDto
{
    public int MemberId { get; set; }
    public int RoleId { get; set; } = 2; // Default to Admin role
    public int? ClubId { get; set; } // Club-specific admin role
}

public class MemberWithRolesDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = "";
    public string EmailId { get; set; } = "";
    public string PrimaryMobileNumber { get; set; } = "";
    public List<string> Roles { get; set; } = new();
    public bool HasAdminRole { get; set; }
    public bool HasCredentials { get; set; }
    // Active club(s) + district(s) the member belongs to — disambiguates same-named members
    // across different clubs in pickers. Comma-joined when a member is in more than one.
    public string? ClubName { get; set; }
    public string? DistrictNumber { get; set; }
}
