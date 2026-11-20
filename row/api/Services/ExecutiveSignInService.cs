using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Club executives sign in with a code sent by email (KIS/ROW/SUB/01 sections 4.1 step 4, 4.2 step 1, exception 1).
/// The person must be a current or incoming executive of a club, on record with RI, whose access level is
/// Reporting or Full. A verified code gives them the club's Admin role (marked via_subscription) and admin years:
/// this year when current, next year only when incoming. The web session then comes from AuthService as usual.
/// </summary>
public sealed class ExecutiveSignInService
{
    private const int CodeMinutes = 10;
    private const int MaxAttempts = 5;

    private readonly string _conn;
    private readonly IEmailService _email;
    private readonly IAdminYearService _adminYears;
    private readonly IConfiguration _config;
    private readonly SubscriptionOfficers _officers;
    private readonly ILogger<ExecutiveSignInService> _logger;

    public ExecutiveSignInService(IConfiguration config, IEmailService email, IAdminYearService adminYears,
        SubscriptionOfficers officers, ILogger<ExecutiveSignInService> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _adminYears = adminYears;
        _config = config;
        _officers = officers;
        _logger = logger;
    }

    public sealed record ClubSeat(int ClubId, string ClubName, ExecutiveStanding Standing, ClubAccessLevel Level);

    /// <summary>
    /// The clubs where this member is an executive and may sign in. A club with no access (None) keeps only its
    /// current executives: section 4.3 lets them buy the Club subscription, and the gate shows them nothing else.
    /// </summary>
    public static async Task<List<ClubSeat>> SeatsAsync(MySqlConnection conn, int memberId)
    {
        var clubs = await conn.QueryAsync<(int ClubId, string ClubName)>(@"
            SELECT DISTINCT o.fk_club_id, c.ClubName FROM ri_club_officers o
            JOIN member_master_profile m ON m.RotaryId = CAST(o.ri_member_id AS CHAR) COLLATE utf8mb4_unicode_ci AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = o.fk_club_id AND c.isdeleted = 0
            WHERE m.pk_member_master_profile_id = @memberId", new { memberId });
        var seats = new List<ClubSeat>();
        foreach (var (clubId, name) in clubs)
        {
            var standing = await SubscriptionOfficers.StandingAtClubAsync(conn, memberId, clubId);
            if (standing == ExecutiveStanding.None) continue;
            var access = await SubscriptionAccess.GetClubAccessAsync(conn, clubId);
            if (access == null || (access.Level == ClubAccessLevel.None && standing != ExecutiveStanding.Current)) continue;
            seats.Add(new ClubSeat(clubId, name, standing, access.Level));
        }
        return seats;
    }

    /// <summary>Step 1: email a 6-digit code. Exception 1: an email that is not a current executive is refused with the reason.</summary>
    public async Task RequestCodeAsync(string email)
    {
        email = (email ?? "").Trim();
        if (email.Length == 0) throw new ArgumentException("Enter your email.");
        await using var conn = RowDb.Connect(_conn);
        await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<(int Id, string Name)>(
            "SELECT pk_member_master_profile_id, MemberName FROM member_master_profile WHERE EmailId = @email AND isdeleted = 0 LIMIT 1",
            new { email });
        var seats = member.Id > 0 ? await SeatsAsync(conn, member.Id) : new List<ClubSeat>();
        if (seats.Count == 0 && member.Id > 0)
        {
            // A club nobody has subscribed for yet was never read from RI. Read this member's clubs once a day at
            // most, so an executive can sign in and buy (section 4.3). Known member emails only, behind the auth limit.
            var unread = await conn.QueryAsync<int>(@"
                SELECT cm.fk_club_id FROM club_members cm
                LEFT JOIN ri_club_officer_sync s ON s.fk_club_id = cm.fk_club_id
                WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                  AND (s.synced_at IS NULL OR s.synced_at < UTC_TIMESTAMP() - INTERVAL 1 DAY)
                LIMIT 5", new { member.Id });
            foreach (var clubId in unread.ToList()) await _officers.SyncClubAsync(conn, clubId);
            seats = await SeatsAsync(conn, member.Id);
        }
        if (seats.Count == 0)
            throw new UnauthorizedAccessException(
                "This email is not a current club executive on record with Rotary International. " +
                "If you hold a club office, ask your club to update My Rotary.");

        var recent = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM exec_signin_codes WHERE fk_member_id = @Id AND created_at > UTC_TIMESTAMP() - INTERVAL 15 MINUTE",
            new { member.Id });
        if (recent >= 3) throw new InvalidOperationException("Too many codes requested. Wait 15 minutes and try again.");

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        await conn.ExecuteAsync(@"
            INSERT INTO exec_signin_codes (fk_member_id, code_hash, expires_at)
            VALUES (@Id, @hash, UTC_TIMESTAMP() + INTERVAL @CodeMinutes MINUTE)",
            new { member.Id, hash = Hash(member.Id, code), CodeMinutes });

        var body = $@"<p>Hello {WebUtility.HtmlEncode(member.Name)},</p>
<p>Your {WebUtility.HtmlEncode(Brand.ProductName)} sign-in code is:</p>
<p style=""font-size:28px;font-weight:700;letter-spacing:6px"">{code}</p>
<p>It works for {CodeMinutes} minutes. If you did not ask for it, ignore this email.</p>";
        await _email.SendGenericEmailAsync(email, $"{Brand.ProductName} sign-in code", body);
    }

    /// <summary>Step 1, second half: check the code, give the club Admin role and admin years, return the member id.</summary>
    public async Task<int> VerifyCodeAsync(string email, string code)
    {
        email = (email ?? "").Trim();
        code = (code ?? "").Trim();
        await using var conn = RowDb.Connect(_conn);
        await conn.OpenAsync();
        var memberId = await conn.ExecuteScalarAsync<int>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId = @email AND isdeleted = 0 LIMIT 1", new { email });
        var row = await conn.QueryFirstOrDefaultAsync<(long Id, string Hash, int Attempts)>(@"
            SELECT pk_id, code_hash, attempts FROM exec_signin_codes
            WHERE fk_member_id = @memberId AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
            ORDER BY pk_id DESC LIMIT 1", new { memberId });
        if (memberId <= 0 || row.Id == 0) throw new UnauthorizedAccessException("The code has expired. Ask for a new one.");
        if (row.Attempts >= MaxAttempts) throw new UnauthorizedAccessException("Too many wrong codes. Ask for a new one.");
        var ok = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row.Hash), Encoding.ASCII.GetBytes(Hash(memberId, code)));
        if (!ok)
        {
            await conn.ExecuteAsync("UPDATE exec_signin_codes SET attempts = attempts + 1 WHERE pk_id = @Id", new { row.Id });
            throw new UnauthorizedAccessException("That code is not right.");
        }
        await conn.ExecuteAsync("UPDATE exec_signin_codes SET used_at = UTC_TIMESTAMP() WHERE pk_id = @Id", new { row.Id });

        var seats = await SeatsAsync(conn, memberId);
        if (seats.Count == 0) throw new UnauthorizedAccessException("Your club no longer has access. Ask your club or district to renew.");
        await GrantSeatsAsync(conn, memberId, seats);
        return memberId;
    }

    /// <summary>Club Admin role per seat (via_subscription), with admin years: current = this year, incoming = next year only.</summary>
    private async Task GrantSeatsAsync(MySqlConnection conn, int memberId, List<ClubSeat> seats)
    {
        var currentYear = await AdminYearService.GetCurrentYearIdAsync(conn)
            ?? throw new InvalidOperationException("No current Rotary year is configured.");
        var nextYear = await conn.ExecuteScalarAsync<int?>(@"
            SELECT n.pk_year_id FROM rotary_year_master c JOIN rotary_year_master n ON n.StartDate = DATE_ADD(c.StartDate, INTERVAL 1 YEAR)
            WHERE c.pk_year_id = @currentYear AND IFNULL(n.isdeleted,0) = 0 LIMIT 1", new { currentYear });

        ClubAdminLimitException? refused = null;
        var seated = 0;
        foreach (var seat in seats)
        {
            var hasAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @memberId AND fk_role_id = 2
                  AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0", new { memberId, seat.ClubId });
            // Club Admin limit: a club already at its limit gives this executive no seat.
            if (hasAdmin == 0 && await ClubAdminLimit.CanGrantAsync(conn, memberId, seat.ClubId) is int max)
            {
                refused = new ClubAdminLimitException(seat.ClubId, max);
                _logger.LogWarning("Executive sign-in: member {MemberId} not seated at club {ClubId}, Club Admin limit {Max} reached", memberId, seat.ClubId, max);
                continue;
            }
            seated++;
            if (hasAdmin == 0)
                await conn.ExecuteAsync(@"
                    INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedDate,
                                              AssignedBy, via_subscription)
                    VALUES (@memberId, 2, @ClubId, 1, 0, NOW(), @memberId, 1)", new { memberId, seat.ClubId });

            var years = seat.Standing == ExecutiveStanding.Current ? new[] { currentYear }
                : nextYear is int n ? new[] { n } : Array.Empty<int>();
            if (years.Length > 0 && hasAdmin == 0)
                await _adminYears.SetManualGrantsAsync(conn, memberId, seat.ClubId, null, years, false, memberId);
        }
        if (seated == 0 && refused != null) throw refused;
        _logger.LogInformation("Executive sign-in: member {MemberId} seated at {Clubs}", memberId, string.Join(",", seats.Select(s => s.ClubId)));
    }

    /// <summary>
    /// Section 4.1 step 4 / 4.3 step 3: invite the executives of these clubs, and list clubs with no executive
    /// email on record for the district (exception 2). Returns (invited, clubs without executives).
    /// <paramref name="onlyRiMemberIds"/>: invite these people only (the daily pass invites officers new on record).
    /// </summary>
    public async Task<(int Invited, List<string> WithoutExecutives)> InviteAsync(MySqlConnection conn, IEnumerable<int> clubIds,
        IReadOnlySet<long>? onlyRiMemberIds = null)
    {
        var signIn = $"{(_config["FrontendUrl"] ?? "").TrimEnd('/')}/exec-signin";
        var invited = 0;
        var without = new List<string>();
        foreach (var clubId in clubIds.Distinct())
        {
            var name = await conn.ExecuteScalarAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId });
            var execs = (await SubscriptionOfficers.GetExecutivesAsync(conn, clubId))
                .Where(e => !string.IsNullOrWhiteSpace(e.Email) && (onlyRiMemberIds == null || onlyRiMemberIds.Contains(e.RiMemberId))).ToList();
            if (execs.Count == 0) { without.Add(name); continue; }
            foreach (var e in execs.GroupBy(x => x.Email!.ToLowerInvariant()).Select(g => g.First()))
            {
                var body = $@"<p>Hello {WebUtility.HtmlEncode(e.Name ?? "")},</p>
<p>{WebUtility.HtmlEncode(name)} now has {WebUtility.HtmlEncode(Brand.ProductName)}. As {WebUtility.HtmlEncode(e.Role)}, you can sign in with your email; we send you a code, no password needed.</p>
<p><a href=""{signIn}"">Sign in to {WebUtility.HtmlEncode(Brand.ProductName)}</a></p>";
                try
                {
                    await _email.SendScopedEmailAsync(e.Email!, $"{name}: sign in to {Brand.ProductName}", body, clubId, null);
                    invited++;
                }
                catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException)
                {
                    _logger.LogWarning(ex, "Invitation to an executive of club {ClubId} failed", clubId);
                }
            }
        }
        return (invited, without);
    }

    private static string Hash(int memberId, string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{memberId}:{code}"))).ToLowerInvariant();
}
