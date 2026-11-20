using System.Data;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Member sign-in for a club website's members-only pages and files (website builder). Not an API session: the token
/// only says "member M of club C until T", is signed with a key derived from the JWT secret, and is checked against
/// the club's active member list on every use, so a member who leaves loses access at once. Files are reached through
/// short-lived signed URLs handed out only to a valid session, so the session token never sits in a URL.
/// shortcut: sign-out is client-side (the token is stateless and lasts 8 hours); add a revocation list if a club
/// needs to cut a session short.
/// </summary>
public sealed class WebsiteMemberSession
{
    public static readonly TimeSpan SessionLife = TimeSpan.FromHours(8);
    public static readonly TimeSpan FileLinkLife = TimeSpan.FromHours(1);

    private static readonly Lazy<string> DummyHash = new(() => BCrypt.Net.BCrypt.HashPassword("row-website-dummy-password"));
    private readonly byte[] _key;
    private readonly string _cs;
    private readonly IWebHostEnvironment _env;

    public WebsiteMemberSession(IConfiguration config, IWebHostEnvironment env)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _env = env;
        _key = DeriveKey(config["JwtSettings:Secret"] ?? throw new InvalidOperationException("JwtSettings:Secret is not configured."));
    }

    public static byte[] DeriveKey(string secret) =>
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes("row-website-member-session-v1"));

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Sign(byte[] key, string data) => B64(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(data)));

    private static bool SameSig(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(a), Encoding.ASCII.GetBytes(b));

    // ── Pure token logic (unit-tested) ─────────────────────────────────────────────────────────────────────

    public static string IssueToken(byte[] key, int clubId, int memberId, DateTimeOffset expires)
    {
        var body = $"{clubId}.{memberId}.{expires.ToUnixTimeSeconds()}";
        return body + "." + Sign(key, "site|" + body);
    }

    /// <summary>The member id when the token is well-formed, correctly signed, unexpired and for this club; else null.</summary>
    public static int? ReadToken(byte[] key, string? token, int clubId, DateTimeOffset now)
    {
        var p = (token ?? "").Split('.');
        if (p.Length != 4 || !int.TryParse(p[0], out var c) || !int.TryParse(p[1], out var m) || !long.TryParse(p[2], out var exp)) return null;
        if (!SameSig(p[3], Sign(key, $"site|{p[0]}.{p[1]}.{p[2]}"))) return null;
        if (c != clubId || m <= 0 || exp < now.ToUnixTimeSeconds()) return null;
        return m;
    }

    public static string FileSig(byte[] key, int mediaId, long exp) => Sign(key, $"file|{mediaId}|{exp}");

    public static bool FileSigValid(byte[] key, int mediaId, long exp, string? sig, DateTimeOffset now) =>
        exp >= now.ToUnixTimeSeconds() && !string.IsNullOrEmpty(sig) && SameSig(sig, FileSig(key, mediaId, exp));

    // ── With the database ──────────────────────────────────────────────────────────────────────────────────

    public string SignedFileUrl(string pathBase, int mediaId)
    {
        var exp = DateTimeOffset.UtcNow.Add(FileLinkLife).ToUnixTimeSeconds();
        return $"{pathBase}/api/public/website-files/{mediaId}?e={exp}&s={FileSig(_key, mediaId, exp)}";
    }

    public bool FileLinkValid(int mediaId, long exp, string? sig) => FileSigValid(_key, mediaId, exp, sig, DateTimeOffset.UtcNow);

    private static Task<int> IsActiveMemberAsync(MySqlConnection conn, int clubId, int memberId) => conn.ExecuteScalarAsync<int>(@"
        SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND fk_member_master_profile_id = @M AND IsActive = 1 AND isdeleted = 0",
        new { C = clubId, M = memberId });

    /// <summary>The signed-in member of this club, or null (bad, expired, other club, or no longer an active member).</summary>
    public async Task<int?> MemberAsync(string? token, int clubId)
    {
        var m = ReadToken(_key, token, clubId, DateTimeOffset.UtcNow);
        if (m == null) return null;
        await using var conn = new MySqlConnection(_cs);
        return await IsActiveMemberAsync(conn, clubId, m.Value) > 0 ? m : null;
    }

    /// <summary>
    /// Email + password sign-in, the same credential checks as the app's password sign-in (lockout after 5 wrong
    /// passwords, banned passwords, trial lock), limited to active members of this club.
    /// Throws UnauthorizedAccessException with a message for the visitor.
    /// </summary>
    public async Task<(string Token, string Name, DateTimeOffset Expires)> SignInAsync(int clubId, string? email, string? password)
    {
        const string invalid = "Invalid email or password.";
        email = (email ?? "").Trim();
        if (email.Length == 0 || email.Length > 200 || string.IsNullOrEmpty(password) || password.Length > 200)
            throw new UnauthorizedAccessException(invalid);

        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_member_by_email", new { p_Email = email }, commandType: CommandType.StoredProcedure);
        var cred = member == null ? null : await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_credentials", new { p_MemberId = (int)member.Id }, commandType: CommandType.StoredProcedure);
        if (cred == null)
        {
            BCrypt.Net.BCrypt.Verify(password, DummyHash.Value); // same time as a real check, so emails cannot be probed
            throw new UnauthorizedAccessException(invalid);
        }
        int memberId = (int)member!.Id;
        int credId = (int)cred.Id;
        int failed = cred.FailedLoginAttempts != null ? Convert.ToInt32(cred.FailedLoginAttempts) : 0;
        DateTime? lockoutEnd = cred.LockoutEndTime as DateTime?;
        if (failed >= 5 && lockoutEnd != null && lockoutEnd > DateTime.UtcNow)
            throw new UnauthorizedAccessException("Account is locked due to multiple failed login attempts. Please try again later.");
        if (BannedPasswords.Refused(_env, password) || !BCrypt.Net.BCrypt.Verify(password, (string)cred.PasswordHash))
        {
            failed++;
            await conn.ExecuteAsync("sp_auth_update_failed_login",
                new { p_CredId = credId, p_Attempts = failed, p_Lockout = failed >= 5 ? DateTime.UtcNow.AddMinutes(15) : (DateTime?)null },
                commandType: CommandType.StoredProcedure);
            throw new UnauthorizedAccessException(invalid);
        }
        if (await IsActiveMemberAsync(conn, clubId, memberId) == 0)
            throw new UnauthorizedAccessException("This sign-in is for members of this club.");
        await TrialLock.RefuseIfLockedAsync(conn, memberId);
        await conn.ExecuteAsync("sp_auth_update_success_login", new { p_CredId = credId }, commandType: CommandType.StoredProcedure);

        var expires = DateTimeOffset.UtcNow.Add(SessionLife);
        return (IssueToken(_key, clubId, memberId, expires), (string?)member.MemberName ?? "", expires);
    }
}
