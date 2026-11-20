using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>One row of district_access_grants, as the access checks need it.</summary>
public sealed record DistrictAccessGrant(int Id, int MemberId, int DistrictId, bool CanWrite,
    DateTime StartsAtUtc, DateTime ExpiresAtUtc, DateTime? RevokedAtUtc);

/// <summary>
/// Time-limited cross-district access (competitor gap: DACdb "level 8"). A SuperAdmin, or a Zonal Coordinator /
/// RI Director for a district in their zone, lets a member read (optionally write) another district's data for a
/// purpose (PETS, RLI, zone work) between a start and an expiry. The grant is checked on every request against the
/// clock, so it stops at expiry or revoke with no job.
///
/// Where it plugs in, and nothing else:
///   read  : ScopeWriteGuardMiddleware for api/districts|district-modules/{id} and the clubs of that district, and
///           ReadAllowedAsync (members: true) for controllers that check a district named outside the URL.
///           Manager-only reads (AllowedAsync, members: false) are NOT widened: mass-email lists, dues, recipient info.
///   write : only api/districts/{id}/{WritableAreas}; the middleware marks the request and AdminYearGuard then lets
///           the year check pass for years that overlap the grant window. Club writes, roles and admins, mass email,
///           money, subscriptions and the website are never reachable through a grant.
/// Every grant, revoke and use is written to audit_log (append-only by trigger).
/// </summary>
public static class CrossDistrictAccess
{
    public const string EntityType = "cross_district_access";
    public const int MaxDays = 366;
    public static readonly string[] Purposes = { "PETS", "RLI", "ZONE", "OTHER" };

    /// <summary>District areas a write grant may change: content, events, committees. Deliberately not
    /// members/admins/roles/ag, mass-emails, website-data, grants, dues, subscriptions, reminders.</summary>
    public static readonly string[] WritableAreas =
        { "announcements", "committee", "district-events", "documents", "newsletters", "projects", "upcoming-events", "weblinks", "sub-groups" };

    private static readonly Regex DistrictWritePath =
        new(@"^/api/districts/\d+/([a-z-]+)(?:/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>HttpContext.Items key the middleware sets when a write was let through on a grant.</summary>
    public const string WriteItemKey = "cross-district-write-grant";

    // ── Pure rules (unit tested) ──────────────────────────────────────────

    /// <summary>Live: not revoked, started, not yet expired. Expiry is exclusive.</summary>
    public static bool IsLive(DistrictAccessGrant g, DateTime nowUtc) =>
        g.RevokedAtUtc == null && g.StartsAtUtc <= nowUtc && nowUtc < g.ExpiresAtUtc;

    public static bool Permits(DistrictAccessGrant? g, int memberId, int districtId, bool write, DateTime nowUtc) =>
        g != null && memberId > 0 && g.MemberId == memberId && g.DistrictId == districtId
        && IsLive(g, nowUtc) && (!write || g.CanWrite);

    /// <summary>May a write grant reach this request path? Only api/districts/{id}/{one of WritableAreas}.</summary>
    public static bool IsWritablePath(string? path)
    {
        var m = DistrictWritePath.Match(path ?? "");
        return m.Success && WritableAreas.Contains(m.Groups[1].Value.ToLowerInvariant());
    }

    /// <summary>A Rotary year [start, end] (dates) overlaps the grant window [starts, expires).</summary>
    public static bool CoversYear(DistrictAccessGrant g, DateTime yearStart, DateTime yearEnd) =>
        yearStart.Date < g.ExpiresAtUtc && yearEnd.Date.AddDays(1) > g.StartsAtUtc;

    /// <summary>Server-side validation of a new grant. Null when valid, else the message.</summary>
    public static string? Validate(int memberId, int districtId, string? purpose, string? note,
        DateTime startsUtc, DateTime expiresUtc, DateTime nowUtc)
    {
        if (memberId <= 0) return "Choose a member.";
        if (districtId <= 0) return "Choose a district.";
        if (string.IsNullOrWhiteSpace(purpose) || !Purposes.Contains(purpose.Trim().ToUpperInvariant()))
            return "Choose a purpose: PETS, RLI, zone work or other.";
        if (purpose.Trim().ToUpperInvariant() == "OTHER" && string.IsNullOrWhiteSpace(note))
            return "Say what the access is for.";
        if (note != null && note.Length > 500) return "The note can be at most 500 characters.";
        if (expiresUtc <= startsUtc) return "The expiry must be after the start.";
        if (expiresUtc <= nowUtc) return "The expiry must be in the future.";
        if (startsUtc < nowUtc.AddDays(-1)) return "The start cannot be in the past.";
        if ((expiresUtc - startsUtc).TotalDays > MaxDays) return $"A grant can last at most {MaxDays} days.";
        return null;
    }

    // ── Database ──────────────────────────────────────────────────────────

    private const string Columns = @"pk_grant_id AS Id, fk_member_id AS MemberId, fk_district_id AS DistrictId,
        can_write AS CanWrite, starts_at_utc AS StartsAtUtc, expires_at_utc AS ExpiresAtUtc, revoked_at_utc AS RevokedAtUtc";

    /// <summary>The live grant giving this member read (or write) on the district, if any. The clock is the
    /// server's UTC now, compared in SQL and again by <see cref="Permits"/>.</summary>
    public static async Task<DistrictAccessGrant?> FindLiveAsync(MySqlConnection conn, int memberId, int districtId, bool write)
    {
        if (memberId <= 0 || districtId <= 0) return null;
        var now = DateTime.UtcNow;
        var g = await conn.QueryFirstOrDefaultAsync<DistrictAccessGrant>($@"
            SELECT {Columns} FROM district_access_grants
            WHERE fk_member_id = @M AND fk_district_id = @D AND revoked_at_utc IS NULL
              AND starts_at_utc <= @Now AND expires_at_utc > @Now AND (@W = 0 OR can_write = 1)
            ORDER BY can_write DESC, expires_at_utc DESC LIMIT 1",
            new { M = memberId, D = districtId, Now = now, W = write ? 1 : 0 });
        return Permits(g, memberId, districtId, write, now) ? g : null;
    }

    /// <summary>Writes one audit_log row (the table is append-only). A database error here is swallowed, the same
    /// rule as AuditLogService: auditing must never break the request it records.</summary>
    public static async Task AuditAsync(MySqlConnection conn, int actorId, string action, int grantId, string entityName,
        object details, HttpContext? http = null)
    {
        try
        {
            var ua = http?.Request.Headers.UserAgent.ToString();
            await conn.ExecuteAsync(@"
                INSERT INTO audit_log (fk_member_master_profile_id, member_name, action, entity_type, entity_id, entity_name,
                                       details, ip_address, user_agent)
                VALUES (@A, (SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @A),
                        @Action, @Type, @Id, @Name, @Details, @Ip, @Ua)",
                new
                {
                    A = actorId, Action = action, Type = EntityType, Id = grantId,
                    Name = entityName.Length > 500 ? entityName[..500] : entityName,
                    Details = JsonSerializer.Serialize(details),
                    Ip = http?.Connection.RemoteIpAddress?.ToString(),
                    Ua = ua is { Length: > 500 } ? ua[..500] : ua,
                });
        }
        catch (MySqlException) { /* audit must never break the request */ }
    }

    /// <summary>
    /// Middleware and controller entry point: when the normal checks refused, does a live grant allow this? For a
    /// club scope only reads count, through a grant on the club's district. Logs the use. A write is only ever
    /// allowed on <see cref="IsWritablePath"/>, and marks the request for AdminYearGuard.
    /// </summary>
    internal static async Task<bool> TryUseAsync(string connectionString, int memberId, bool isClub, int scopeId,
        bool write, HttpContext? http, string? path)
    {
        if (memberId <= 0 || scopeId <= 0) return false;
        if (write && (isClub || !IsWritablePath(path))) return false;
        await using var conn = RowDb.Connect(connectionString);
        await conn.OpenAsync();
        var districtId = isClub
            ? await conn.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND IFNULL(isdeleted,0) = 0", new { C = scopeId }) ?? 0
            : scopeId;
        var g = await FindLiveAsync(conn, memberId, districtId, write);
        if (g == null) return false;
        if (write && http != null) http.Items[WriteItemKey] = g;
        await AuditAsync(conn, memberId, write ? "USE_WRITE" : "USE_READ", g.Id, $"district {districtId}",
            new { grantId = g.Id, districtId, clubId = isClub ? scopeId : (int?)null, method = http?.Request.Method, path }, http);
        return true;
    }
}
