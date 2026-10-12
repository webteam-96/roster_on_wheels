namespace RotaryApi.DTOs;

public class ClubListDto
{
    public int Id { get; set; }
    public int FkDistrictId { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string ClubRotaryId { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public string? ClubLogoPath { get; set; }
    public string? MeetingDay { get; set; }
    public TimeSpan? MeetingFromTime { get; set; }
    public TimeSpan? MeetingToTime { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int TotalMembers { get; set; }
    // Of TotalMembers, how many are honorary (club_members.IsHonoraryMember=1). The regular
    // "member count" the UI shows is TotalMembers - HonoraryMembers.
    public int HonoraryMembers { get; set; }
    // 2026-07-03: surface Rotary.org sync flag in the club listing so
    // district admins can tell at a glance which rows are auto-managed
    // from api.rotary.org vs manually-added.
    public bool IsSyncedFromRotaryOrg { get; set; }
    // 2026-07-03: club website info for the listing column. Rules:
    //   • WebsiteSubdomain non-null + not expired  → show link
    //   • WebsiteSubdomain non-null + past EndDate → "Expired"
    //   • WebsiteSubdomain null                    → "No"
    public string? WebsiteSubdomain { get; set; }
    public string? WebsiteClientDomain { get; set; }
    public DateTime? WebsiteEndDate { get; set; }
    public string? WebsiteStatus { get; set; }
}

public class ClubDetailDto
{
    public int Id { get; set; }
    public int FkDistrictId { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string ClubRotaryId { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public string Timezone { get; set; } = "Asia/Kolkata";
    public DateTime? ClubCharterDate { get; set; }
    public string? ClubLogoPath { get; set; }
    public string? ClubWebsite { get; set; }
    public string? MeetingDay { get; set; }
    public TimeSpan? MeetingFromTime { get; set; }
    public TimeSpan? MeetingToTime { get; set; }
    public string? MeetingAddress { get; set; }
    public string Country { get; set; } = "India";
    // The club's OWN Country field (above) defaults to "India" regardless of reality — unreliable
    // for currency defaulting. This is the club's DISTRICT's Country instead, used as a fallback
    // guess for a project's default currency when DistrictDefaultCurrency (below) isn't set yet.
    public string? DistrictCountry { get; set; }
    // SuperAdmin-set default currency for this club's district (see district_master.DefaultCurrency).
    // Null until a SuperAdmin explicitly sets it — frontend falls back to guessing from DistrictCountry.
    public string? DistrictDefaultCurrency { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Pincode { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public DateTime? ActiveFromDate { get; set; }
    public DateTime? ActiveToDate { get; set; }
    public bool IsAutomaticMeetingReminder { get; set; }
    public bool IsFamilyLogin { get; set; }
    public bool IsActive { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int TotalMembers { get; set; }
}

public class CreateClubDto
{
    public int FkDistrictId { get; set; }
    public string ClubRotaryId { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public string Timezone { get; set; } = "Asia/Kolkata";
    public DateTime? ClubCharterDate { get; set; }
    public string? ClubLogoPath { get; set; }
    public string? ClubWebsite { get; set; }
    public string? MeetingDay { get; set; }
    public TimeSpan? MeetingFromTime { get; set; }
    public TimeSpan? MeetingToTime { get; set; }
    public string? MeetingAddress { get; set; }
    public string Country { get; set; } = "India";
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Pincode { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public DateTime? ActiveFromDate { get; set; }
    public DateTime? ActiveToDate { get; set; }
    public bool IsAutomaticMeetingReminder { get; set; } = true;
    public bool IsFamilyLogin { get; set; } = false;
    public bool IsActive { get; set; } = true;
}

public class UpdateClubDto
{
    public int FkDistrictId { get; set; }
    public string ClubRotaryId { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public string Timezone { get; set; } = "Asia/Kolkata";
    public DateTime? ClubCharterDate { get; set; }
    public string? ClubLogoPath { get; set; }
    public string? ClubWebsite { get; set; }
    public string? MeetingDay { get; set; }
    public TimeSpan? MeetingFromTime { get; set; }
    public TimeSpan? MeetingToTime { get; set; }
    public string? MeetingAddress { get; set; }
    public string Country { get; set; } = "India";
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Pincode { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public DateTime? ActiveFromDate { get; set; }
    public DateTime? ActiveToDate { get; set; }
    public bool IsAutomaticMeetingReminder { get; set; } = true;
    public bool IsFamilyLogin { get; set; } = false;
    public bool IsActive { get; set; } = true;
}

public class ClubMemberDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public string? ProfilePhotoPath { get; set; }
    public string? EmailId { get; set; }
    public string? PrimaryMobileNumber { get; set; }
    public string? RotaryId { get; set; }
    public DateTime? JoinedDate { get; set; }
    public int ClubMemberId { get; set; }
    public bool MembershipActive { get; set; }
    public bool IsHonorary { get; set; }
    public List<string> Roles { get; set; } = new();
    public bool HasAdminRole { get; set; }
    public string? Designation { get; set; }
    public string? ClassificationProfession { get; set; }
    // COG (club 31598) only — structured split of the free-text Designation label
    // ("3292 Dg 2025 - 26"). CogDistrictNumber = "3292", CogYear = "2025-26".
    // NULL for every other club (and for COG rows whose label isn't year-structured).
    // The mobile app renders these two instead of the (now suppressed) joined date.
    public string? CogDistrictNumber { get; set; }
    public string? CogYear { get; set; }
}

// Body for PUT /api/clubs/{id}/members/{memberId}/cog-designation (SuperAdmin, COG only).
// The two values are recombined into club_members.Designation in the canonical
// "NNNN Dg YYYY - YY" shape (793 of the 1,097 populated COG rows already use it),
// so no new column and no DDL is needed.
public class UpdateCogDesignationDto
{
    public string DistrictNumber { get; set; } = string.Empty;
    // Rotary-year label from rotary_year_master, e.g. "2025-26".
    public string YearLabel { get; set; } = string.Empty;
}

public class DistrictMemberDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public string? ProfilePhotoPath { get; set; }
    public string? EmailId { get; set; }
    public string? PrimaryMobileNumber { get; set; }
    public string? RotaryId { get; set; }
    public string? ClubNames { get; set; }
    public string? ClubName { get; set; }
    public DateTime? JoinedDate { get; set; }
    public string? RoleNames { get; set; }
    public bool HasDistrictAdminRole { get; set; }
    public bool AllClubsAccess { get; set; }   // District Admin has all-clubs access (SuperAdmin-set)
    public bool HasClubAdminRole { get; set; }
    public bool IsSuperAdmin { get; set; }
    public List<string> Roles => string.IsNullOrEmpty(RoleNames)
        ? new List<string>()
        : RoleNames.Split(',').ToList();
}

public class AddClubMemberDto
{
    public int MemberId { get; set; }
    public DateTime? JoinedDate { get; set; }
}

// Body for the SuperAdmin "District Admin all-clubs access" toggle.
public class DistrictAdminClubAccessDto
{
    public bool Enabled { get; set; }
}

public class TerminatedMemberDto
{
    public int Id { get; set; }
    public string? RotaryId { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public DateTime? JoinedDate { get; set; }
    public DateTime? TerminationDate { get; set; }
    public string? TerminationReason { get; set; }
}
