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

/// Email + password sign-in for every member (ROW, 2026-10-19). Device fields as in verify-otp.
public class MobilePasswordLoginDto
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public string? Imei { get; set; }
    public string? DeviceToken { get; set; }
    public string? DeviceName { get; set; }
    public string? AppVersion { get; set; }
}

public class MobileForgotPasswordDto
{
    public string Email { get; set; } = "";
}

public class MobileLogoutDto
{
    public string? Imei { get; set; }
}

public class MobileRequestOtpResponse
{
    public string Message { get; set; } = "";
    public bool SentEmail { get; set; }
    public int OtpExpiresInSeconds { get; set; }

    // TEMPORARY — when MobileOtp:ReturnDebugOtp=true (appsettings.json),
    // the actual OTP is echoed here so testers can verify without checking
    // email. Set the flag to false (or delete) after live verification.
    public string? DebugOtp { get; set; }
}

public class MobileVerifyOtpResponse
{
    // Account security (gap agent): a right password with MFA due returns no Token, only this challenge.
    public bool MfaRequired { get; set; }
    public string? MfaToken { get; set; }
    public bool MfaSetupRequired { get; set; }
    public List<string>? RecoveryCodes { get; set; }
    public bool MustChangePassword { get; set; } // signed in with a temporary password: only the password change works
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
    /// <summary>Current Rotary year id (Year-wise Admin Rights: the year the app's admin buttons are checked against).</summary>
    public int? CurrentYearId { get; set; }
    public string MemberType { get; set; } = "member";
    public int? FamilyMemberId { get; set; }
    public List<RoleScopeDto> Roles { get; set; } = new();
    public List<ZoneScopeDto> AccessibleZones { get; set; } = new();
    public List<DistrictScopeDto> AccessibleDistricts { get; set; } = new();
    public List<ClubScopeDto> AccessibleClubs { get; set; } = new();
    // Districts where this member is a District Admin with all-clubs access.
    public List<DistrictScopeDto> DistrictClubAccess { get; set; } = new();
    public MemberMobileDashboardDto MemberMobileDashboard { get; set; } = new();

    /// <summary>
    /// The "View only" wording for Year-wise Admin Rights, edited by SuperAdmin on
    /// the Settings page. It rides along here because BOTH clients already call
    /// my-context on sign-in and app open, and both already read their year rights
    /// from this same payload — so the copy arrives with the rule it explains, at
    /// no extra round trip on any of the 100-odd screens that show it.
    ///
    /// Templates, not finished sentences: the server does not know which screen is
    /// asking. Each client substitutes {year} / {currentYear} / {years} / {actions}
    /// — see YearRuleMessagesHelper.
    ///
    /// Nullable so an older client ignores it, and a client talking to an older
    /// server falls back to its own compiled-in copy of the same wording.
    /// </summary>
    public RotaryApi.Services.YearRuleMessagesHelper.MessagesDto? YearRuleMessages { get; set; }
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

    // ── Year-wise Admin Rights ──────────────────────────────────────────────
    // Which Rotary years this assignment may ADD/EDIT/DELETE in. Viewing is
    // never year-limited. Only meaningful on an Admin (Club/District) row.
    //
    // ⚠️ ADDITIVE for old clients: a build that predates these fields simply
    // ignores them and behaves as it does today. The server enforces the rule
    // regardless, so an old app cannot edit outside its years — it will just
    // get a clear refusal instead of a hidden button.
    public bool AllYears { get; set; }
    public List<int> YearIds { get; set; } = new();

    // Plain-English reasons ("Club President", "Granted"), for the UI only.
    // NEVER use this to decide a permission.
    public List<string> YearSources { get; set; } = new();

    // Is the year rule itself switched ON for this assignment's scope?
    // (Settings -> Year-wise Admin Rights; club beats district beats platform.)
    //
    // AllYears answers "WHICH years may I edit". This answers the different
    // question "does the year concept apply here at all", and the web needs both:
    // screens whose data carries no Rotary year hide Add/Edit while the picker
    // sits on a past year, which is a CONTEXT rule that AllYears must not lift --
    // a SuperAdmin and a Club Executive Secretary already hold AllYears and are
    // exactly who that rule was written for. With the rule off there is no year
    // context left to honour, so the picker stops mattering. See the web's
    // isCurrentYearSelected().
    //
    // Defaults TRUE: an old client ignores the field, and a client that reads it
    // treats silence as "rule on" -- which is how the platform behaved before the
    // switch existed.
    public bool YearRuleEnabled { get; set; } = true;
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
