using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using MySqlConnector;
using QRCoder;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Account security (gap agent 2026-11-19): TOTP multi-factor login with hashed recovery codes, and email magic-link
/// sign-in. MFA is required for members of a club whose policy requires it, and for SuperAdmins only when
/// AccountSecurity:RequireMfaForSuperAdmins is true (default false); anyone else may turn
/// it on. A right password (or magic link) with MFA due yields a short-lived single-use challenge instead of a JWT;
/// the existing JWT is issued only after the second factor, by the same session builders as before.
/// </summary>
public class AccountSecurityService
{
    public const string Web = "web";
    public const string Mobile = "mobile";
    private const string Issuer = "ROW";
    private static readonly TimeSpan ChallengeLife = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MagicLife = TimeSpan.FromMinutes(15);
    private const int MaxAttempts = 5;
    private const int MagicPerWindow = 3; // per member per MagicLife window, on top of the per-IP "auth" rate limit
    private const string Expired = "This sign-in step has expired. Please sign in again.";

    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly IDataProtector _protector;
    private readonly IEmailService _email;
    private readonly ILogger<AccountSecurityService> _logger;

    public AccountSecurityService(IConfiguration config, IDataProtectionProvider dp, IEmailService email, ILogger<AccountSecurityService> logger)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _protector = dp.CreateProtector("RotaryApi.AccountSecurity.Totp.v1");
        _email = email;
        _logger = logger;
    }

    private MySqlConnection Conn() => new(_cs);

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(32));
    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Recovery code / mobile sign-in code form: 10 base32 characters shown as xxxxx-xxxxx (50 bits).</summary>
    public static string NewShortCode()
    {
        var s = Totp.Base32Encode(RandomNumberGenerator.GetBytes(7))[..10].ToLowerInvariant();
        return $"{s[..5]}-{s[5..]}";
    }
    public static string NormaliseCode(string? code) => new string((code ?? "").Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

    // ───────────────────────── policy ─────────────────────────

    /// <summary>Owner decision 2026-11-20: MFA is optional for SuperAdmins unless this setting is turned on.</summary>
    public static bool SuperAdminsMustUseMfa(IConfiguration config) => config.GetValue("AccountSecurity:RequireMfaForSuperAdmins", false);

    public static async Task<bool> IsRequiredAsync(MySqlConnection conn, int memberId, IConfiguration config)
    {
        if (SuperAdminsMustUseMfa(config) && await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return true;
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN club_security_policy p ON p.fk_club_id = cm.fk_club_id AND p.require_mfa = 1
            WHERE cm.fk_member_master_profile_id = @M AND cm.IsActive = 1 AND cm.isdeleted = 0", new { M = memberId }) > 0;
    }

    private static Task<dynamic?> MfaRowAsync(MySqlConnection conn, int memberId) =>
        conn.QueryFirstOrDefaultAsync<dynamic>("SELECT * FROM member_mfa WHERE fk_member_id = @M", new { M = memberId });

    private static bool Enabled(dynamic? row) => row != null && Convert.ToBoolean(row!.enabled);

    /// <summary>Called after the first factor succeeded. Null: no second factor due, issue the session as before.</summary>
    public static async Task<MfaChallengeDto?> LoginGateAsync(MySqlConnection conn, int memberId, string channel, bool isTemporary, IConfiguration config)
    {
        var enabled = Enabled(await MfaRowAsync(conn, memberId));
        if (!enabled && !await IsRequiredAsync(conn, memberId, config)) return null;
        var token = NewToken();
        var now = DateTime.UtcNow;
        await conn.ExecuteAsync(@"
            INSERT INTO auth_login_challenges (token_hash, fk_member_id, channel, is_temporary, setup_required, expires_at, created_at)
            VALUES (@H, @M, @C, @T, @S, @E, @N)",
            new { H = Hash(token), M = memberId, C = channel, T = isTemporary, S = !enabled, E = now + ChallengeLife, N = now });
        return new MfaChallengeDto { MfaToken = token, MfaSetupRequired = !enabled };
    }

    /// <summary>The gate for a web first factor that has no connection of its own (exec email code).</summary>
    public async Task<MfaChallengeDto?> WebLoginGateAsync(int memberId)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        return await LoginGateAsync(conn, memberId, Web, false, _config);
    }

    private async Task<dynamic> LiveChallengeAsync(MySqlConnection conn, string? token, string channel)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100) throw new UnauthorizedAccessException(Expired);
        var ch = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT * FROM auth_login_challenges
            WHERE token_hash = @H AND channel = @C AND used_at IS NULL AND expires_at > @Now AND attempts < @Max",
            new { H = Hash(token), C = channel, Now = DateTime.UtcNow, Max = MaxAttempts });
        return ch ?? throw new UnauthorizedAccessException(Expired);
    }

    /// <summary>Login-time enrolment for a member who must use MFA but has not set it up yet.</summary>
    public async Task<MfaSetupDto> StartSetupFromChallengeAsync(string? token, string channel)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        var ch = await LiveChallengeAsync(conn, token, channel);
        if (!Convert.ToBoolean(ch.setup_required)) throw new ArgumentException("Multi-factor sign-in is already set up.");
        return await NewPendingSecretAsync(conn, (int)ch.fk_member_id);
    }

    /// <summary>Checks the second factor against a challenge. On success the challenge is spent and the caller issues
    /// the normal session. A setup challenge enables MFA and returns the new recovery codes.</summary>
    public async Task<MfaVerifiedDto> VerifyChallengeAsync(string? token, string? code, string channel, string? ip, string? ua)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        var ch = await LiveChallengeAsync(conn, token, channel);
        int id = (int)ch.pk_id, memberId = (int)ch.fk_member_id;
        // Count the attempt before checking, so parallel guesses cannot exceed the cap.
        var counted = await conn.ExecuteAsync("UPDATE auth_login_challenges SET attempts = attempts + 1 WHERE pk_id = @Id AND attempts < @Max AND used_at IS NULL",
            new { Id = id, Max = MaxAttempts });
        if (counted == 0) throw new UnauthorizedAccessException(Expired);

        List<string>? recovery = null;
        bool ok;
        if (Convert.ToBoolean(ch.setup_required))
        {
            recovery = await TryEnableAsync(conn, memberId, code);
            ok = recovery != null;
        }
        else ok = await CheckSecondFactorAsync(conn, memberId, code);

        if (!ok)
        {
            await Audit(conn, memberId, ip, ua, "failed", "Wrong MFA code");
            throw new UnauthorizedAccessException("That code is not right. Check your authenticator app and try again.");
        }
        if (await conn.ExecuteAsync("UPDATE auth_login_challenges SET used_at = @Now WHERE pk_id = @Id AND used_at IS NULL", new { Id = id, Now = DateTime.UtcNow }) == 0)
            throw new UnauthorizedAccessException(Expired);
        await Audit(conn, memberId, ip, ua, "success", "MFA");
        return new MfaVerifiedDto { MemberId = memberId, IsTemporary = Convert.ToBoolean(ch.is_temporary), RecoveryCodes = recovery };
    }

    /// <summary>A current TOTP code (not replayed) or an unused recovery code.</summary>
    private async Task<bool> CheckSecondFactorAsync(MySqlConnection conn, int memberId, string? code)
    {
        var row = await MfaRowAsync(conn, memberId);
        if (!Enabled(row)) return false;
        var secret = _protector.Unprotect((string)row!.secret_protected);
        var step = Totp.Match(secret, code, DateTime.UtcNow, row.last_used_step == null ? null : Convert.ToInt64(row.last_used_step));
        if (step != null)
            // Conditional update: two requests with the same code cannot both pass.
            return await conn.ExecuteAsync(@"UPDATE member_mfa SET last_used_step = @S, updated_at = @Now
                WHERE fk_member_id = @M AND (last_used_step IS NULL OR last_used_step < @S)", new { S = step, M = memberId, Now = DateTime.UtcNow }) == 1;
        var norm = NormaliseCode(code);
        if (norm.Length != 10) return false;
        return await conn.ExecuteAsync(@"UPDATE member_mfa_recovery_codes SET used_at = @Now
            WHERE fk_member_id = @M AND code_hash = @H AND used_at IS NULL LIMIT 1", new { M = memberId, H = Hash(norm), Now = DateTime.UtcNow }) == 1;
    }

    private async Task<MfaSetupDto> NewPendingSecretAsync(MySqlConnection conn, int memberId)
    {
        var secret = Totp.NewSecret();
        await conn.ExecuteAsync(@"
            INSERT INTO member_mfa (fk_member_id, pending_secret_protected, enabled, updated_at) VALUES (@M, @P, 0, @Now)
            ON DUPLICATE KEY UPDATE pending_secret_protected = @P, updated_at = @Now",
            new { M = memberId, P = _protector.Protect(secret), Now = DateTime.UtcNow });
        var account = await conn.ExecuteScalarAsync<string?>(
            "SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @M", new { M = memberId });
        var uri = Totp.OtpAuthUri(Issuer, string.IsNullOrWhiteSpace(account) ? $"member-{memberId}" : account, secret);
        using var qr = new QRCodeGenerator().CreateQrCode(uri, QRCodeGenerator.ECCLevel.M);
        var svg = new SvgQRCode(qr).GetGraphic(6);
        return new MfaSetupDto { Secret = secret, OtpAuthUri = uri, QrSvg = svg };
    }

    /// <summary>Confirms the pending secret with a code; enables MFA and returns fresh recovery codes, or null.</summary>
    private async Task<List<string>?> TryEnableAsync(MySqlConnection conn, int memberId, string? code)
    {
        var row = await MfaRowAsync(conn, memberId);
        if (row?.pending_secret_protected == null) return null;
        string pendingProtected = row.pending_secret_protected;
        var step = Totp.Match(_protector.Unprotect(pendingProtected), code, DateTime.UtcNow, null);
        if (step == null) return null;
        var n = await conn.ExecuteAsync(@"
            UPDATE member_mfa SET secret_protected = pending_secret_protected, pending_secret_protected = NULL,
                   enabled = 1, enabled_at = @Now, last_used_step = @S, updated_at = @Now
            WHERE fk_member_id = @M AND pending_secret_protected = @P",
            new { M = memberId, P = pendingProtected, S = step, Now = DateTime.UtcNow });
        return n == 1 ? await NewRecoveryCodesAsync(conn, memberId) : null;
    }

    private static async Task<List<string>> NewRecoveryCodesAsync(MySqlConnection conn, int memberId)
    {
        var codes = Enumerable.Range(0, 10).Select(_ => NewShortCode()).ToList();
        var now = DateTime.UtcNow;
        await using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync("DELETE FROM member_mfa_recovery_codes WHERE fk_member_id = @M", new { M = memberId }, tx);
        await conn.ExecuteAsync("INSERT INTO member_mfa_recovery_codes (fk_member_id, code_hash, created_at) VALUES (@M, @H, @Now)",
            codes.Select(c => new { M = memberId, H = Hash(NormaliseCode(c)), Now = now }), tx);
        await tx.CommitAsync();
        return codes;
    }

    // ───────────────────────── self-service (signed in) ─────────────────────────

    public async Task<MfaStatusDto> GetStatusAsync(int memberId)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        var row = await MfaRowAsync(conn, memberId);
        return new MfaStatusDto
        {
            Enabled = Enabled(row),
            Required = await IsRequiredAsync(conn, memberId, _config),
            EnabledAt = Enabled(row) ? (DateTime?)row!.enabled_at : null,
            RecoveryCodesLeft = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_mfa_recovery_codes WHERE fk_member_id = @M AND used_at IS NULL", new { M = memberId }),
        };
    }

    public async Task<MfaSetupDto> StartEnrolAsync(int memberId)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        if (Enabled(await MfaRowAsync(conn, memberId))) throw new ArgumentException("Multi-factor sign-in is already on.");
        return await NewPendingSecretAsync(conn, memberId);
    }

    public async Task<List<string>> ConfirmEnrolAsync(int memberId, string? code)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        if (Enabled(await MfaRowAsync(conn, memberId))) throw new ArgumentException("Multi-factor sign-in is already on.");
        return await TryEnableAsync(conn, memberId, code) ?? throw new ArgumentException("That code is not right. Check your authenticator app and try again.");
    }

    public async Task DisableAsync(int memberId, string? code)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        if (await IsRequiredAsync(conn, memberId, _config)) throw new InvalidOperationException("Multi-factor sign-in is required for your account and cannot be turned off.");
        if (!await CheckSecondFactorAsync(conn, memberId, code)) throw new ArgumentException("That code is not right.");
        await conn.ExecuteAsync(@"UPDATE member_mfa SET enabled = 0, secret_protected = NULL, pending_secret_protected = NULL, last_used_step = NULL, updated_at = @Now
            WHERE fk_member_id = @M", new { M = memberId, Now = DateTime.UtcNow });
        await conn.ExecuteAsync("DELETE FROM member_mfa_recovery_codes WHERE fk_member_id = @M", new { M = memberId });
    }

    public async Task<List<string>> RegenerateRecoveryCodesAsync(int memberId, string? code)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        if (!await CheckSecondFactorAsync(conn, memberId, code)) throw new ArgumentException("That code is not right.");
        return await NewRecoveryCodesAsync(conn, memberId);
    }

    // ───────────────────────── club policy ─────────────────────────

    public async Task<ClubSecurityPolicyDto> GetClubPolicyAsync(int actorId, int clubId)
    {
        await using var conn = Conn(); await conn.OpenAsync();
        await EnsureClubAccessAsync(conn, actorId, clubId);
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName, COALESCE(p.require_mfa, 0) AS require_mfa, p.updated_at
            FROM club_master c LEFT JOIN club_security_policy p ON p.fk_club_id = c.pk_club_id
            WHERE c.pk_club_id = @C AND c.isdeleted = 0", new { C = clubId }) ?? throw new KeyNotFoundException("Club not found.");
        var stats = await conn.QueryFirstAsync<dynamic>(@"
            SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN m.enabled = 1 THEN 1 ELSE 0 END), 0) AS enrolled
            FROM club_members cm LEFT JOIN member_mfa m ON m.fk_member_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0", new { C = clubId });
        return new ClubSecurityPolicyDto
        {
            ClubId = clubId, ClubName = (string?)row.ClubName ?? "", RequireMfa = Convert.ToBoolean(row.require_mfa),
            UpdatedAt = (DateTime?)row.updated_at, ActiveMembers = Convert.ToInt32(stats.total), MembersWithMfa = Convert.ToInt32(stats.enrolled),
        };
    }

    public async Task<ClubSecurityPolicyDto> SetClubPolicyAsync(int actorId, int clubId, bool requireMfa)
    {
        await using (var conn = Conn())
        {
            await conn.OpenAsync();
            await EnsureClubAccessAsync(conn, actorId, clubId);
            await conn.ExecuteAsync(@"
                INSERT INTO club_security_policy (fk_club_id, require_mfa, updated_by, updated_at) VALUES (@C, @R, @A, @Now)
                ON DUPLICATE KEY UPDATE require_mfa = @R, updated_by = @A, updated_at = @Now",
                new { C = clubId, R = requireMfa, A = actorId, Now = DateTime.UtcNow });
        }
        return await GetClubPolicyAsync(actorId, clubId);
    }

    private static async Task EnsureClubAccessAsync(MySqlConnection conn, int actorId, int clubId)
    {
        if (clubId <= 0) throw new ArgumentException("Club is required.");
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, actorId)) return;
        await ClubAdminAccessHelper.EnsureClubAdminAsync(conn, actorId, clubId);
    }

    // ───────────────────────── magic link ─────────────────────────

    public const string MagicRequestedMessage = "If the account exists, a sign-in link has been sent to the registered email.";

    /// <summary>Emails a single-use sign-in link (web) or code (app). Same reply whether or not the email exists.</summary>
    public async Task RequestMagicLinkAsync(string? email, string channel, string? ip)
    {
        email = (email ?? "").Trim();
        if (email.Length == 0 || email.Length > 254 || !email.Contains('@')) return;
        await using var conn = Conn(); await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>("sp_auth_get_member_by_email", new { p_Email = email }, commandType: CommandType.StoredProcedure);
        if (member == null) return;
        int memberId = (int)member.Id;
        string to = (string?)member.EmailId ?? "", name = (string?)member.MemberName ?? "";
        if (string.IsNullOrWhiteSpace(to)) return;
        if (channel == Web && !await HasWebAccessAsync(conn, memberId)) return;

        var now = DateTime.UtcNow;
        var recent = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM auth_magic_links WHERE fk_member_id = @M AND created_at > @Since", new { M = memberId, Since = now - MagicLife });
        if (recent >= MagicPerWindow) return; // quietly: the reply must not reveal anything

        // Only the newest link works: older unused ones for this channel are retired.
        await conn.ExecuteAsync("UPDATE auth_magic_links SET used_at = @Now WHERE fk_member_id = @M AND channel = @C AND used_at IS NULL",
            new { M = memberId, C = channel, Now = now });
        var secret = channel == Web ? NewToken() : NewShortCode();
        await conn.ExecuteAsync(@"
            INSERT INTO auth_magic_links (token_hash, fk_member_id, channel, expires_at, created_at, request_ip)
            VALUES (@H, @M, @C, @E, @Now, @Ip)",
            new { H = Hash(channel == Web ? secret : NormaliseCode(secret)), M = memberId, C = channel, E = now + MagicLife, Now = now, Ip = ip?.Length > 64 ? ip[..64] : ip });

        var safeName = WebUtility.HtmlEncode(name);
        string body;
        if (channel == Web)
        {
            var link = $"{(_config["FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/')}/login?magic={Uri.EscapeDataString(secret)}";
            var safeLink = WebUtility.HtmlEncode(link);
            body = $"<p>Hello {safeName},</p><p>Use this link to sign in to ROW. It works once and expires in {(int)MagicLife.TotalMinutes} minutes.</p>" +
                   $"<p><a href=\"{safeLink}\">Sign in to ROW</a></p><p>If you did not ask for this, ignore this email. Your password has not changed.</p>";
        }
        else
            body = $"<p>Hello {safeName},</p><p>Your ROW app sign-in code is:</p><p style=\"font-size:22px;font-weight:bold;letter-spacing:2px\">{secret}</p>" +
                   $"<p>It works once and expires in {(int)MagicLife.TotalMinutes} minutes. If you did not ask for this, ignore this email.</p>";
        try { await _email.SendGenericEmailAsync(to, "Your ROW sign-in link", body); }
        catch (Exception ex) { _logger.LogWarning(ex, "Magic-link email failed for member {MemberId}", memberId); }
    }

    /// <summary>Spends a web magic-link token; returns the member, or throws.</summary>
    public async Task<int> ConsumeWebMagicLinkAsync(string? token, string? ip, string? ua)
    {
        const string bad = "This sign-in link is invalid or has expired. Please ask for a new one.";
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100) throw new UnauthorizedAccessException(bad);
        await using var conn = Conn(); await conn.OpenAsync();
        var now = DateTime.UtcNow;
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, fk_member_id FROM auth_magic_links
            WHERE token_hash = @H AND channel = @C AND used_at IS NULL AND expires_at > @Now",
            new { H = Hash(token), C = Web, Now = now });
        if (row == null) throw new UnauthorizedAccessException(bad);
        // Single use: only the request that flips used_at wins.
        if (await conn.ExecuteAsync("UPDATE auth_magic_links SET used_at = @Now WHERE pk_id = @Id AND used_at IS NULL", new { Id = (int)row.pk_id, Now = now }) == 0)
            throw new UnauthorizedAccessException(bad);
        int memberId = (int)row.fk_member_id;
        await EnsureWebLoginAllowedAsync(conn, memberId);
        await Audit(conn, memberId, ip, ua, "success", "Magic link");
        return memberId;
    }

    /// <summary>Spends an app sign-in code for this email; five wrong tries kill the code.</summary>
    public async Task<int> ConsumeMobileCodeAsync(string? email, string? code, string? ip, string? ua)
    {
        const string bad = "That code is not right or has expired. Please ask for a new one.";
        email = (email ?? "").Trim();
        var norm = NormaliseCode(code);
        if (email.Length == 0 || norm.Length != 10) throw new UnauthorizedAccessException(bad);
        await using var conn = Conn(); await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>("sp_auth_get_member_by_email", new { p_Email = email }, commandType: CommandType.StoredProcedure);
        if (member == null) throw new UnauthorizedAccessException(bad);
        int memberId = (int)member.Id;
        var now = DateTime.UtcNow;
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, token_hash FROM auth_magic_links
            WHERE fk_member_id = @M AND channel = @C AND used_at IS NULL AND expires_at > @Now AND attempts < @Max
            ORDER BY pk_id DESC LIMIT 1", new { M = memberId, C = Mobile, Now = now, Max = MaxAttempts });
        if (row == null) throw new UnauthorizedAccessException(bad);
        int id = (int)row.pk_id;
        if (await conn.ExecuteAsync("UPDATE auth_magic_links SET attempts = attempts + 1 WHERE pk_id = @Id AND attempts < @Max AND used_at IS NULL",
                new { Id = id, Max = MaxAttempts }) == 0)
            throw new UnauthorizedAccessException(bad);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes((string)row.token_hash), Encoding.ASCII.GetBytes(Hash(norm))))
        {
            await Audit(conn, memberId, ip, ua, "failed", "Wrong sign-in code");
            throw new UnauthorizedAccessException(bad);
        }
        if (await conn.ExecuteAsync("UPDATE auth_magic_links SET used_at = @Now WHERE pk_id = @Id AND used_at IS NULL", new { Id = id, Now = now }) == 0)
            throw new UnauthorizedAccessException(bad);
        await Audit(conn, memberId, ip, ua, "success", "Sign-in code");
        return memberId;
    }

    private async Task<bool> HasWebAccessAsync(MySqlConnection conn, int memberId)
    {
        var roles = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND r.RoleName IN ('Admin', 'SuperAdmin', 'AG')", new { Id = memberId });
        return roles > 0 || await PlanningAccess.IsElectAsync(conn, _cs, memberId);
    }

    /// <summary>The same club/district/zone kill-switch the password login applies (SuperAdmin exempt).</summary>
    private static async Task EnsureWebLoginAllowedAsync(MySqlConnection conn, int memberId)
    {
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return;
        var live = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @M
              AND cm.IsActive = 1 AND cm.isdeleted = 0 AND c.IsActive = 1 AND c.isdeleted = 0
              AND d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0", new { M = memberId });
        if (live == 0) throw new UnauthorizedAccessException("Your zone, district, or club is currently inactive. Please contact your administrator.");
    }

    private static async Task Audit(MySqlConnection conn, int memberId, string? ip, string? ua, string status, string reason)
    {
        try
        {
            await conn.ExecuteAsync("sp_login_audit_create", new
            {
                p_MemberId = memberId, p_MemberName = "", p_EmailOrMobile = "", p_IpAddress = ip ?? "",
                p_UserAgent = ua?.Length > 500 ? ua[..500] : ua ?? "", p_Status = status, p_FailureReason = reason,
            }, commandType: CommandType.StoredProcedure);
        }
        catch { /* audit never blocks sign-in, same as AuthService */ }
    }
}
