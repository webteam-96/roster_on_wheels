namespace RotaryApi.DTOs;

public class LoginRequestDto
{
    public string? Email { get; set; }
    public string? CountryCode { get; set; }
    public string? MobileNumber { get; set; }
    public string Password { get; set; } = "";
}

public class LoginResponseDto
{
    public string Token { get; set; } = "";
    public string MemberName { get; set; } = "";
    public string Email { get; set; } = "";
    public int MemberId { get; set; }
    // Flat distinct role names (kept for backward-compat with existing web clients
    // that read `roles` as `string[]`). Also matches the comma-separated JWT claim.
    public List<string> Roles { get; set; } = new();
    public bool IsTemporaryPassword { get; set; }
    public DateTime? LastLoginTime { get; set; }
    public int SessionExpiryMinutes { get; set; }

    // ── New scope fields (additive — existing clients can ignore safely) ──
    // Per-(role × scoping unit) row. A user who is Club Admin of 3 clubs has 3
    // entries in ScopedRoles, each with a different ClubId/ClubName.
    public List<RoleScopeDto> ScopedRoles { get; set; } = new();
    public List<ZoneScopeDto> AccessibleZones { get; set; } = new();
    public List<DistrictScopeDto> AccessibleDistricts { get; set; } = new();
    public List<ClubScopeDto> AccessibleClubs { get; set; } = new();
    // Districts where this member is a District Admin with all-clubs access.
    public List<DistrictScopeDto> DistrictClubAccess { get; set; } = new();
}

public class LoginAuditLogDto
{
    public int Id { get; set; }
    public int? MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string EmailOrMobile { get; set; } = "";
    public DateTime LoginTime { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public string LoginStatus { get; set; } = "";
    public string? FailureReason { get; set; }
}

public class ForgotPasswordRequestDto
{
    public string? Email { get; set; }
    public string? CountryCode { get; set; }
    public string? MobileNumber { get; set; }
}

public class ResetPasswordRequestDto
{
    public string Token { get; set; } = "";
    public string NewPassword { get; set; } = "";
    public string ConfirmPassword { get; set; } = "";
}

public class ChangePasswordRequestDto
{
    public string CurrentPassword { get; set; } = "";
    public string NewPassword { get; set; } = "";
    public string ConfirmPassword { get; set; } = "";
}
