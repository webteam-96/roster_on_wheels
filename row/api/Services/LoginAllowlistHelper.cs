using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// TEMPORARY login restriction — only mobile numbers listed in
/// <c>LoginAllowlist:Mobiles</c> (appsettings.json) may log in while
/// <c>LoginAllowlist:Enabled</c> is true. Set Enabled=false (or remove the
/// section) to disable the gate entirely.
///
/// Applied to:
///   - <see cref="AuthService.LoginAsync"/>  (web)
///   - <see cref="MobileAuthService.RequestOtpAsync"/>  (mobile)
///
/// Email-based logins are resolved to the member's PrimaryMobileNumber and
/// checked against the same list so the gate cannot be bypassed by using
/// email instead of mobile.
/// </summary>
public static class LoginAllowlistHelper
{
    /// <summary>
    /// Throws <see cref="UnauthorizedAccessException"/> if the caller is not
    /// in the allowlist. Returns silently (allowed) when the allowlist is
    /// disabled or empty.
    /// </summary>
    /// <param name="config">App configuration root.</param>
    /// <param name="conn">Open MySQL connection (used only if email lookup is needed).</param>
    /// <param name="mobile">Mobile number provided in the login request, may be null.</param>
    /// <param name="email">Email provided in the login request, may be null.</param>
    public static async Task EnsureMobileAllowedAsync(
        IConfiguration config,
        MySqlConnection conn,
        string? mobile,
        string? email)
    {
        var section = config.GetSection("LoginAllowlist");
        if (!section.GetValue<bool>("Enabled")) return; // allowlist disabled → everyone allowed

        var allowed = section.GetSection("Mobiles").Get<string[]>() ?? Array.Empty<string>();
        if (allowed.Length == 0) return; // empty allowlist → no restriction

        // Prefer the mobile from the request directly; fall back to looking it up
        // by email so an email-based login can't bypass the gate.
        var mobileToCheck = mobile?.Trim();
        if (string.IsNullOrEmpty(mobileToCheck) && !string.IsNullOrWhiteSpace(email))
        {
            mobileToCheck = await conn.ExecuteScalarAsync<string?>(
                "SELECT PrimaryMobileNumber FROM member_master_profile WHERE EmailId = @Email AND isdeleted = 0 LIMIT 1",
                new { Email = email.Trim() });
        }

        if (string.IsNullOrEmpty(mobileToCheck) || !allowed.Contains(mobileToCheck.Trim()))
        {
            throw new UnauthorizedAccessException(
                "Login is temporarily restricted to authorised testers during live verification. Please contact support if you believe this is in error.");
        }
    }
}
