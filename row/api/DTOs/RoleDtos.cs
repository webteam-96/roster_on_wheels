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

public class AssignZonalCoordinatorDto
{
    public int MemberId { get; set; }
    public int ZoneId { get; set; }
}

public class ZonalCoordinatorDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string Email { get; set; } = "";
    public DateTime? AssignedDate { get; set; }
}

public class RIDirectorDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Mobile { get; set; }
    public DateTime? AssignedDate { get; set; }
    // Login-details email (Send vs Resend on settings/ri-director). 0 = never sent.
    public int EmailSentCount { get; set; }
    public DateTime? EmailLastSentDate { get; set; }
}

// One club an RI Director belongs to, for the profile popup on settings/ri-director.
public class RIDirectorClubDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string? DistrictNumber { get; set; }
    public string? ZoneName { get; set; }
    public string? Designation { get; set; }     // this year's board designation, if any
    public bool IsHonorary { get; set; }
    public bool IsClubAdmin { get; set; }        // holds the Club Admin role for this club
}

// The profile shown when a Current RI Director row is clicked (user 2026-09-29).
public class RIDirectorProfileDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? PhotoPath { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? RotaryId { get; set; }
    public DateTime? AssignedDate { get; set; }
    // Districts he administers (District Admin role), separate from the districts of his clubs.
    public List<string> AdminDistricts { get; set; } = new();
    public List<string> OtherRoles { get; set; } = new();
    public List<RIDirectorClubDto> Clubs { get; set; } = new();
}

public class ZonalMemberSearchDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string Email { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
}
