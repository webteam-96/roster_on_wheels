namespace RotaryApi.DTOs;

public class MobileRequestOtpDto
{
    public string LoginType { get; set; } = "member"; // "member" | "family"
    public string Identifier { get; set; } = ""; // mobile number OR email
    public int? CountryId { get; set; }           // required when identifier is mobile
}

public class MobileVerifyOtpDto
{
    public string LoginType { get; set; } = "member";
    public string Identifier { get; set; } = "";
    public int? CountryId { get; set; }
    public string Otp { get; set; } = "";
    public string? Imei { get; set; }
    public string? DeviceToken { get; set; }
    public string? DeviceName { get; set; } // "iOS" | "Android"
    public string? AppVersion { get; set; }
}

public class MobileLogoutDto
{
    public string? Imei { get; set; }
}

public class MobileRequestOtpResponse
{
    public string Message { get; set; } = "";
    public bool SentEmail { get; set; }
    public bool SentSms { get; set; }
    public bool SentWhatsApp { get; set; }
    public int OtpExpiresInSeconds { get; set; }

    // TEMPORARY — when MobileOtp:ReturnDebugOtp=true (appsettings.json),
    // the actual OTP is echoed here so testers can verify without checking
    // email/SMS. Set the flag to false (or delete) after live verification.
    public string? DebugOtp { get; set; }
}

public class MobileVerifyOtpResponse
{
    public string Token { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string MemberType { get; set; } = "member"; // "member" | "family"
    public int? FamilyMemberId { get; set; }
    public List<string> RoleNames { get; set; } = new();           // flat role names (for JWT claim parity)
    public List<RoleScopeDto> Roles { get; set; } = new();         // scoped: district-wise + club-wise
    public List<DistrictScopeDto> AccessibleDistricts { get; set; } = new();
    public List<ClubScopeDto> AccessibleClubs { get; set; } = new();
    public List<ZoneScopeDto> AccessibleZones { get; set; } = new();
    public List<DistrictScopeDto> DistrictClubAccess { get; set; } = new();
    // Per-scope module groups for the mobile dashboard. Each club and each
    // district the member belongs to gets its own group, with the modules
    // already filtered by the member's role for that scope:
    //   - Club / District Admin → ALL enabled modules for that scope
    //   - Pure Member           → only modules with IsDefaultForMember = 1
    // The Flutter app renders one section per group.
    public MemberMobileDashboardDto MemberMobileDashboard { get; set; } = new();
}

// Shared context endpoint (both web + mobile)
public class MyContextResponse
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public int? CountryId { get; set; }
    public string MemberType { get; set; } = "member";
    public int? FamilyMemberId { get; set; }
    public List<RoleScopeDto> Roles { get; set; } = new();
    public List<ZoneScopeDto> AccessibleZones { get; set; } = new();
    public List<DistrictScopeDto> AccessibleDistricts { get; set; } = new();
    public List<ClubScopeDto> AccessibleClubs { get; set; } = new();
    // Districts where this member is a District Admin with all-clubs access.
    public List<DistrictScopeDto> DistrictClubAccess { get; set; } = new();
    public MemberMobileDashboardDto MemberMobileDashboard { get; set; } = new();
}

// One tile per module surfaced on the Flutter member dashboard.
public class MemberMobileModuleDto
{
    public int Id { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string? IconClass { get; set; }
    public string? IconPath { get; set; }
    public string? Description { get; set; }
    public string? RouteUrl { get; set; }
    public int SortOrder { get; set; }
}

// Root container for the per-scope module groups.
public class MemberMobileDashboardDto
{
    public List<MemberMobileClubGroupDto> Clubs { get; set; } = new();
    public List<MemberMobileDistrictGroupDto> Districts { get; set; } = new();
}

// One group per club the member belongs to. IsAdmin = true when the member
// has the Club Admin role for THIS club (then Modules contains every enabled
// module). IsAdmin = false → Modules is the IsDefaultForMember-filtered subset.
public class MemberMobileClubGroupDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public bool IsAdmin { get; set; }
    public List<MemberMobileModuleDto> Modules { get; set; } = new();
}

// One group per district the member belongs to. Same admin / filter rules.
public class MemberMobileDistrictGroupDto
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public bool IsAdmin { get; set; }
    public List<MemberMobileModuleDto> Modules { get; set; } = new();
}

public class RoleScopeDto
{
    public string RoleName { get; set; } = "";
    public string Scope { get; set; } = ""; // "global" | "zone" | "district" | "club"
    public int? ZoneId { get; set; }
    public string? ZoneName { get; set; }
    public int? DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public int? ClubId { get; set; }
    public string? ClubName { get; set; }
}

public class ZoneScopeDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}

public class DistrictScopeDto
{
    public int Id { get; set; }
    public string Number { get; set; } = "";
    public int? ZoneId { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
    // True when the district has >=1 Rotary.org-synced club. Used to gate Goal Setting
    // (sync clubs/districts only) in the sidebar.
    public bool IsSynced { get; set; }
}

public class ClubScopeDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int? DistrictId { get; set; }
    public int TotalMembers { get; set; }
    // Live website URL — null if club has no active website. ClientDomain wins over Subdomain.
    public string? WebsiteUrl { get; set; }
    // club_master.IsSyncedFromRotaryOrg — gates Goal Setting (sync clubs only) in the sidebar.
    public bool IsSynced { get; set; }
}
