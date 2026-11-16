using System.Globalization;
using Dapper;
using MySqlConnector;
using RotaryApi.Services.RotaryOrg;

namespace RotaryApi.Services;

/// <summary>Whether a person is a club executive now, or an incoming one for the next Rotary year (KIS/ROW/SUB/01 s.2).</summary>
public enum ExecutiveStanding { None, Current, Incoming }

/// <summary>
/// RI officer data behind District and Club subscriptions. Club officers come from RI
/// (GET clubs/{type}/{id}/officers) and are kept in <c>ri_club_officers</c>, last, this and next Rotary year.
/// Executives (section 2): President, President-Elect (next year's President), Past President (last year's President),
/// Secretary, Treasurer, Executive Secretary. People are matched to ROW members by RI member id (member_master_profile.RotaryId).
/// </summary>
public sealed class SubscriptionOfficers
{
    private readonly IRotaryOrgApiClient _ri;
    private readonly ILogger<SubscriptionOfficers> _logger;

    public SubscriptionOfficers(IRotaryOrgApiClient ri, ILogger<SubscriptionOfficers> logger)
    {
        _ri = ri;
        _logger = logger;
    }

    /// <summary>RI titles that make someone a club executive in their term (President-Elect and Past President are derived).</summary>
    public static readonly IReadOnlySet<string> ExecutiveRoles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Club President", "Club President-Elect", "Club Secretary", "Club Treasurer", "Club Executive Secretary/Director",
        "Club Executive Secretary",
    };

    /// <summary>First day of the Rotary year that contains <paramref name="day"/> (1 July).</summary>
    public static DateTime RotaryYearStart(DateTime day) => new(day.Month >= 7 ? day.Year : day.Year - 1, 7, 1);

    /// <summary>
    /// Standing of one officer row on <paramref name="today"/>. Current: an executive office whose term covers today,
    /// or last year's President (Past President). Incoming: an executive office that starts next 1 July
    /// (next year's President is the President-Elect and counts as current). Section 4.6: on 1 July the incoming become current by date alone.
    /// </summary>
    public static ExecutiveStanding StandingOf(string role, DateTime start, DateTime end, DateTime today)
    {
        if (!ExecutiveRoles.Contains(role)) return ExecutiveStanding.None;
        var thisYear = RotaryYearStart(today);
        if (start.Date <= today.Date && today.Date <= end.Date) return ExecutiveStanding.Current;
        if (role.Equals("Club President", StringComparison.OrdinalIgnoreCase) && end.Date == thisYear.AddDays(-1))
            return ExecutiveStanding.Current; // Past President
        if (start.Date == thisYear.AddYears(1))
            // Next year's President is this year's President-Elect, a current executive (section 2); the rest are incoming.
            return role.StartsWith("Club President", StringComparison.OrdinalIgnoreCase) ? ExecutiveStanding.Current : ExecutiveStanding.Incoming;
        return ExecutiveStanding.None;
    }

    public sealed record SyncResult(int ClubId, string Status, int Officers, string? Message);

    /// <summary>Reads the club's officers for last, this and next Rotary year from RI and replaces the stored copy.</summary>
    public async Task<SyncResult> SyncClubAsync(MySqlConnection conn, int clubId, CancellationToken ct = default)
    {
        var club = await conn.QueryFirstOrDefaultAsync<(string? RotaryId, string? ClubType)>(
            "SELECT ClubRotaryId, ClubType FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
        if (!int.TryParse(club.RotaryId, out var riClubId) || riClubId <= 0)
            return await RecordAsync(conn, new SyncResult(clubId, "not_synced", 0, "The club has no RI club id."));

        var from = RotaryYearStart(DateTime.UtcNow).AddYears(-1);
        var to = from.AddYears(3).AddDays(-1);
        List<RotaryOrgClubOfficerDto> officers;
        try
        {
            officers = await _ri.GetClubOfficersAsync(club.ClubType ?? "Rotary Club", riClubId,
                from.ToString("yyyy-MM-dd"), to.ToString("yyyy-MM-dd"), ct, throwOnFailure: true);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "RI officers failed for club {ClubId}", clubId);
            return await RecordAsync(conn, new SyncResult(clubId, "error", 0, "RI could not be reached."));
        }

        var rows = officers
            .Select(o => (Ok: long.TryParse(o.RotaryId, out var id) & TryDate(o.StartDate, out var s) & TryDate(o.EndDate, out var e),
                          Id: id, Role: o.Role ?? "", Start: s, End: e, o.Name))
            .Where(r => r.Ok && r.Role.Length > 0)
            .ToList();

        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync("DELETE FROM ri_club_officers WHERE fk_club_id = @clubId", new { clubId }, tx);
        foreach (var r in rows)
        {
            var (first, last) = SplitName(r.Name);
            await conn.ExecuteAsync(@"
                INSERT IGNORE INTO ri_club_officers (fk_club_id, ri_member_id, officer_role, start_date, end_date, first_name, last_name)
                VALUES (@clubId, @Id, @Role, @Start, @End, @first, @last)",
                new { clubId, r.Id, r.Role, r.Start, r.End, first, last }, tx);
        }
        await tx.CommitAsync(ct);

        var anyExecutive = rows.Any(r => StandingOf(r.Role, r.Start, r.End, DateTime.UtcNow) != ExecutiveStanding.None);
        return await RecordAsync(conn, anyExecutive
            ? new SyncResult(clubId, "ok", rows.Count, null)
            : new SyncResult(clubId, "no_officers", rows.Count, "RI has no current or incoming executives for this club."));
    }

    /// <summary>Syncs every club of the district; section 4.1 step 3.</summary>
    public async Task<List<SyncResult>> SyncDistrictAsync(MySqlConnection conn, int districtId, CancellationToken ct = default)
    {
        var clubIds = await conn.QueryAsync<int>(
            "SELECT pk_club_id FROM club_master WHERE fk_district_id = @districtId AND isdeleted = 0 AND IsActive = 1", new { districtId });
        var results = new List<SyncResult>();
        foreach (var id in clubIds) results.Add(await SyncClubAsync(conn, id, ct));
        return results;
    }

    public sealed record Executive(long RiMemberId, string Role, DateTime Start, DateTime End, ExecutiveStanding Standing,
        int? MemberId, string? Name, string? Email);

    /// <summary>The club's current and incoming executives from the stored RI data, joined to ROW members.</summary>
    public static async Task<List<Executive>> GetExecutivesAsync(MySqlConnection conn, int clubId)
    {
        var rows = await conn.QueryAsync<(long RiMemberId, string Role, DateTime Start, DateTime End, int? MemberId, string? Name, string? Email)>(@"
            SELECT o.ri_member_id, o.officer_role, o.start_date, o.end_date, m.pk_member_master_profile_id,
                   COALESCE(m.MemberName, TRIM(CONCAT(IFNULL(o.first_name,''), ' ', IFNULL(o.last_name,'')))), m.EmailId
            FROM ri_club_officers o
            LEFT JOIN member_master_profile m ON m.RotaryId = CAST(o.ri_member_id AS CHAR) COLLATE utf8mb4_unicode_ci AND m.isdeleted = 0
            WHERE o.fk_club_id = @clubId", new { clubId });
        var today = DateTime.UtcNow.Date;
        return rows.Select(r => new Executive(r.RiMemberId, r.Role, r.Start, r.End, StandingOf(r.Role, r.Start, r.End, today),
                r.MemberId, r.Name, r.Email))
            .Where(e => e.Standing != ExecutiveStanding.None)
            .ToList();
    }

    /// <summary>The member's best standing at the club (Current beats Incoming).</summary>
    public static async Task<ExecutiveStanding> StandingAtClubAsync(MySqlConnection conn, int memberId, int clubId)
    {
        var mine = (await GetExecutivesAsync(conn, clubId)).Where(e => e.MemberId == memberId).ToList();
        if (mine.Any(e => e.Standing == ExecutiveStanding.Current)) return ExecutiveStanding.Current;
        return mine.Count > 0 ? ExecutiveStanding.Incoming : ExecutiveStanding.None;
    }

    /// <summary>
    /// Section 4.1 step 1: District Governor, Governor-Elect or District Secretary. RI's district officers route
    /// refuses this API login (401), so ROW's records decide: district_governors (this year = DG, next year = DGE)
    /// and the district committee's "District Secretary" for this year.
    /// </summary>
    public static async Task<bool> IsDistrictBuyerAsync(MySqlConnection conn, int memberId, int districtId)
    {
        var thisStart = RotaryYearStart(DateTime.UtcNow);
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT (SELECT COUNT(*) FROM district_governors g JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
                    WHERE g.fk_district_id = @districtId AND g.fk_member_id = @memberId AND IFNULL(g.isdeleted,0) = 0
                      AND y.StartDate IN (@thisStart, @nextStart))
                 + (SELECT COUNT(*) FROM district_committee_member c JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                    WHERE c.fk_district_id = @districtId AND c.fk_member_id = @memberId AND IFNULL(c.isdeleted,0) = 0
                      AND c.is_active = 1 AND c.district_designation LIKE '%District Secretary%' AND y.StartDate = @thisStart)",
            new { districtId, memberId, thisStart, nextStart = thisStart.AddYears(1) }) > 0;
    }

    private static async Task<SyncResult> RecordAsync(MySqlConnection conn, SyncResult r)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO ri_club_officer_sync (fk_club_id, synced_at, officer_count, status, message)
            VALUES (@ClubId, UTC_TIMESTAMP(), @Officers, @Status, @Message)
            ON DUPLICATE KEY UPDATE synced_at = UTC_TIMESTAMP(), officer_count = @Officers, status = @Status, message = @Message", r);
        return r;
    }

    private static bool TryDate(string? s, out DateTime d) =>
        DateTime.TryParseExact(s?.Length > 10 ? s[..10] : s, new[] { "MM/dd/yyyy", "yyyy-MM-dd", "M/d/yyyy" },
            CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    private static (string? First, string? Last) SplitName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return (null, null);
        var i = name.Trim().LastIndexOf(' ');
        return i < 0 ? (name.Trim(), null) : (name[..i].Trim(), name[(i + 1)..].Trim());
    }
}
