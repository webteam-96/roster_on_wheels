namespace RotaryApi.DTOs;

// Account security (gap agent 2026-11-19): MFA + magic link.

public class MfaChallengeDto
{
    public string MfaToken { get; set; } = "";
    public bool MfaSetupRequired { get; set; }
}

public class MfaSetupDto
{
    public string Secret { get; set; } = "";
    public string OtpAuthUri { get; set; } = "";
    public string QrSvg { get; set; } = "";
}

public class MfaVerifiedDto
{
    public int MemberId { get; set; }
    public bool IsTemporary { get; set; }
    public List<string>? RecoveryCodes { get; set; }
}

public class MfaStatusDto
{
    public bool Enabled { get; set; }
    public bool Required { get; set; }
    public DateTime? EnabledAt { get; set; }
    public int RecoveryCodesLeft { get; set; }
}

public class ClubSecurityPolicyDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public bool RequireMfa { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int ActiveMembers { get; set; }
    public int MembersWithMfa { get; set; }
}

public class MfaTokenRequest { public string? MfaToken { get; set; } }
public class MfaVerifyRequest { public string? MfaToken { get; set; } public string? Code { get; set; } }
public class MfaCodeRequest { public string? Code { get; set; } }
public class ClubSecurityPolicyRequest { public bool RequireMfa { get; set; } }
public class MagicLinkRequest { public string? Email { get; set; } }
public class MagicLinkConsumeRequest { public string? Token { get; set; } }

/// <summary>App: second step of sign-in, with the same device fields as the password login.</summary>
public class MobileMfaVerifyRequest
{
    public string? MfaToken { get; set; }
    public string? Code { get; set; }
    public string? Imei { get; set; }
    public string? DeviceToken { get; set; }
    public string? DeviceName { get; set; }
    public string? AppVersion { get; set; }
}

public class MobileMagicCodeRequest
{
    public string? Email { get; set; }
    public string? Code { get; set; }
    public string? Imei { get; set; }
    public string? DeviceToken { get; set; }
    public string? DeviceName { get; set; }
    public string? AppVersion { get; set; }
}
