using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Writes (POST/PUT/PATCH/DELETE) under <c>api/clubs/{clubId}/…</c> and <c>api/districts/{districtId}/…</c> are
/// allowed only for people who manage that club or district (ROW security fix, 2026-10-19). Before this, those
/// endpoints only required a signed-in user, so any member could change any club's records.
///
/// Club: SuperAdmin, the club's Admin / AG, or a district Admin with access to all
/// clubs of the club's district. District: SuperAdmin, or the district's Admin. Roles are read from
/// member_roles on every write (not from the token), so a revoked role stops working at once. Anonymous requests
/// pass through; the endpoint's own [Authorize] answers them.
///
/// Reads (GET) under the same paths (2026-10-22): allowed for the people above, plus active members of that club
/// (club) or of any club in that district (district), so the app's member screens keep working. Before this, any
/// signed-in user could read any club's or district's records by changing the id in the URL.
/// </summary>
public class ScopeWriteGuardMiddleware
{
    // district-modules/{id} is a district scope too (citation settings had no check of their own).
    private static readonly Regex Scoped = new(@"^/api/(clubs|districts|district-modules)/(\d+)(?:/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly RequestDelegate _next;
    private readonly string _connectionString;

    public ScopeWriteGuardMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    // Writes outside a club/district scope that only certain roles may make (role ids from the roles table:
    // 2 Admin, 3 SuperAdmin, 6 AG).
    private static readonly (string Prefix, int[] Roles)[] RoleOnly =
    {
        ("/api/area-of-focus", new[] { 3 }),
        ("/api/funding", new[] { 3 }),
        ("/api/website-data-modules", new[] { 3 }),
        ("/api/mass-email/image", new[] { 2, 3, 6 }),
        ("/api/tenants", new[] { 3 }),
        ("/api/editions", new[] { 3 }),
        ("/api/i18n", new[] { 3 }),
        ("/api/features", new[] { 3 }),
        ("/api/engagement/run", new[] { 3 }),
    };

    public async Task InvokeAsync(HttpContext ctx)
    {
        var write = !(HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method) || HttpMethods.IsOptions(ctx.Request.Method));
        var path = ctx.Request.Path.Value ?? "";
        if (write && ctx.User.Identity?.IsAuthenticated == true)
        {
            var rule = RoleOnly.FirstOrDefault(r => path.Equals(r.Prefix, StringComparison.OrdinalIgnoreCase)
                || path.StartsWith(r.Prefix + "/", StringComparison.OrdinalIgnoreCase));
            if (rule.Roles != null)
            {
                var member = int.TryParse(ctx.User.FindFirst("memberId")?.Value, out var mid) ? mid : 0;
                if (member <= 0 || !await HasAnyRoleAsync(member, rule.Roles))
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await ctx.Response.WriteAsJsonAsync(new { message = "You do not have permission to change this." });
                    return;
                }
            }
        }
        var m = HttpMethods.IsOptions(ctx.Request.Method) ? null : Scoped.Match(path);
        if (m is { Success: true } && ctx.User.Identity?.IsAuthenticated == true)
        {
            var memberId = int.TryParse(ctx.User.FindFirst("memberId")?.Value, out var id) ? id : 0;
            var isClub = m.Groups[1].Value.Equals("clubs", StringComparison.OrdinalIgnoreCase);
            var scopeId = int.Parse(m.Groups[2].Value);
            var allowed = memberId > 0 && (write
                ? await AllowedAsync(_connectionString, memberId, isClub, scopeId)
                : await ReadAllowedAsync(memberId, isClub, scopeId));
            if (!allowed)
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                await ctx.Response.WriteAsJsonAsync(new { message = (write, isClub) switch
                {
                    (true, true) => "You do not manage this club.",
                    (true, false) => "You do not manage this district.",
                    (false, true) => "You do not have access to this club.",
                    _ => "You do not have access to this district.",
                } });
                return;
            }
        }
        await _next(ctx);
    }

    private async Task<bool> HasAnyRoleAsync(int memberId, int[] roles)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id IN @R AND IsActive = 1 AND isdeleted = 0",
            new { M = memberId, R = roles }) > 0;
    }

    /// <summary>True when the member may read this club or district: a manager, or an active member of the club /
    /// of a club in the district. Managers are checked second so the common member case costs one query.</summary>
    private async Task<bool> ReadAllowedAsync(int memberId, bool isClub, int scopeId)
    {
        await using (var conn = new MySqlConnection(_connectionString))
        {
            await conn.OpenAsync();
            var sql = isClub
                ? @"SELECT COUNT(*) FROM club_members cm
                    WHERE cm.fk_member_master_profile_id = @M AND cm.fk_club_id = @S AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0"
                : @"SELECT COUNT(*) FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    WHERE cm.fk_member_master_profile_id = @M AND c.fk_district_id = @S AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0";
            if (await conn.ExecuteScalarAsync<int>(sql, new { M = memberId, S = scopeId }) > 0) return true;
            if (isClub)
            {
                // whoever manages the club's district may read all of its clubs (district Admin)
                var district = await conn.ExecuteScalarAsync<int?>(
                    "SELECT fk_district_id FROM club_master WHERE pk_club_id = @S", new { S = scopeId });
                if (district is > 0 && await AllowedAsync(_connectionString, memberId, false, district.Value)) return true;
            }
        }
        return await AllowedAsync(_connectionString, memberId, isClub, scopeId);
    }

    /// <summary>True when the member manages this club (isClub) or district; also used by controllers that write
    /// to a club or district named outside the URL.</summary>
    internal static async Task<bool> AllowedAsync(string connectionString, int memberId, bool isClub, int scopeId)
    {
        await using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync();
        const string active = "mr.fk_member_master_profile_id = @M AND mr.IsActive = 1 AND mr.isdeleted = 0";
        // District-level rows store fk_club_id as NULL or 0 (same rule as ClubAdminAccessHelper).
        // AG clubs come from district_ag, the AG module's own assignment table.
        var sql = isClub
            ? $@"SELECT
                   (SELECT COUNT(*) FROM member_roles mr
                    LEFT JOIN club_master c ON c.pk_club_id = @S
                    WHERE {active} AND (
                          mr.fk_role_id = 3
                       OR (mr.fk_role_id = 2 AND mr.fk_club_id = @S)
                       OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                           AND mr.AllClubsAccess = 1 AND mr.fk_district_id = c.fk_district_id)))
                 + (SELECT COUNT(*) FROM district_ag ag
                    WHERE ag.fk_member_id = @M AND ag.fk_club_id = @S AND ag.is_active = 1 AND ag.isdeleted = 0)"
            : $@"SELECT COUNT(*) FROM member_roles mr
                 WHERE {active} AND (
                       mr.fk_role_id = 3
                    OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.fk_district_id = @S))";
        return await conn.ExecuteScalarAsync<int>(sql, new { M = memberId, S = scopeId }) > 0;
    }
}
