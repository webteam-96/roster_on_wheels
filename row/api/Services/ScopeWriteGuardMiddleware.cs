using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Writes (POST/PUT/PATCH/DELETE) under <c>api/clubs/{clubId}/…</c> and <c>api/districts/{districtId}/…</c> are
/// allowed only for people who manage that club or district (ROW security fix, 2026-10-19). Before this, those
/// endpoints only required a signed-in user, so any member could change any club's records.
///
/// Club: SuperAdmin, RIDirector, the club's Admin / ClubModerator / AG, or a district Admin with access to all
/// clubs of the club's district. District: SuperAdmin, RIDirector, the district's Admin, or the ZonalCoordinator
/// of its zone. Roles are read from member_roles on every write (not from the token), so a revoked role stops
/// working at once. Anonymous requests pass through; the endpoint's own [Authorize] answers them.
/// </summary>
public class ScopeWriteGuardMiddleware
{
    private static readonly Regex Scoped = new(@"^/api/(clubs|districts)/(\d+)(?:/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly RequestDelegate _next;
    private readonly string _connectionString;

    public ScopeWriteGuardMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    // Writes outside a club/district scope that only certain roles may make (role ids from the roles table:
    // 2 Admin, 3 SuperAdmin, 4 ZonalCoordinator, 5 ClubModerator, 6 AG, 7 RIDirector).
    private static readonly (string Prefix, int[] Roles)[] RoleOnly =
    {
        ("/api/ri-director", new[] { 3, 7 }),
        ("/api/categories", new[] { 3 }),
        ("/api/sub-categories", new[] { 3 }),
        ("/api/area-of-focus", new[] { 3 }),
        ("/api/funding", new[] { 3 }),
        ("/api/website-data-modules", new[] { 3 }),
        ("/api/mass-email/image", new[] { 2, 3, 4, 5, 6, 7 }),
        ("/api/tenants", new[] { 3 }),
        ("/api/editions", new[] { 3 }),
        ("/api/i18n", new[] { 3 }),
        ("/api/features", new[] { 3 }),
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
        var m = write ? Scoped.Match(path) : null;
        if (m is { Success: true } && ctx.User.Identity?.IsAuthenticated == true)
        {
            var memberId = int.TryParse(ctx.User.FindFirst("memberId")?.Value, out var id) ? id : 0;
            var isClub = m.Groups[1].Value.Equals("clubs", StringComparison.OrdinalIgnoreCase);
            var scopeId = int.Parse(m.Groups[2].Value);
            if (memberId <= 0 || !await AllowedAsync(memberId, isClub, scopeId))
            {
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                await ctx.Response.WriteAsJsonAsync(new { message = isClub
                    ? "You do not manage this club."
                    : "You do not manage this district." });
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

    internal async Task<bool> AllowedAsync(int memberId, bool isClub, int scopeId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        const string active = "mr.fk_member_master_profile_id = @M AND mr.IsActive = 1 AND mr.isdeleted = 0";
        // District-level rows store fk_club_id as NULL or 0 (same rule as ClubAdminAccessHelper).
        // AG clubs come from district_ag, the AG module's own assignment table.
        var sql = isClub
            ? $@"SELECT
                   (SELECT COUNT(*) FROM member_roles mr
                    LEFT JOIN club_master c ON c.pk_club_id = @S
                    WHERE {active} AND (
                          mr.fk_role_id IN (3, 7)
                       OR (mr.fk_role_id IN (2, 5) AND mr.fk_club_id = @S)
                       OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                           AND mr.AllClubsAccess = 1 AND mr.fk_district_id = c.fk_district_id)))
                 + (SELECT COUNT(*) FROM district_ag ag
                    WHERE ag.fk_member_id = @M AND ag.fk_club_id = @S AND ag.is_active = 1 AND ag.isdeleted = 0)"
            : $@"SELECT COUNT(*) FROM member_roles mr
                 LEFT JOIN district_master d ON d.pk_district_id = @S
                 WHERE {active} AND (
                       mr.fk_role_id IN (3, 7)
                    OR (mr.fk_role_id = 2 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.fk_district_id = @S)
                    OR (mr.fk_role_id = 4 AND mr.fk_zone_id = d.fk_zone_id))";
        return await conn.ExecuteScalarAsync<int>(sql, new { M = memberId, S = scopeId }) > 0;
    }
}
