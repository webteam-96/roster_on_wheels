using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// While a district's tenant subscription is in the <c>planning</c> state (ROW Wave 1, build spec item 1), writes to
/// that district's current-year records are refused with 409; other years (the next year being planned) are allowed.
/// Applies to every write route that carries <c>{yearId}</c> together with <c>{clubId}</c> or <c>{districtId}</c>.
/// </summary>
// shortcut: routes that take the year in the body or query are not covered, extend when a year-scoped body endpoint matters.
public class PlanningWriteGuardMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _connectionString;

    public PlanningWriteGuardMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var write = !(HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method) || HttpMethods.IsOptions(ctx.Request.Method));
        if (write && int.TryParse(ctx.GetRouteValue("yearId")?.ToString(), out var yearId))
        {
            int? districtId = int.TryParse(ctx.GetRouteValue("districtId")?.ToString(), out var d) ? d : null;
            int? clubId = int.TryParse(ctx.GetRouteValue("clubId")?.ToString(), out var c) ? c : null;
            if ((districtId != null || clubId != null) && await IsPlanningCurrentYearAsync(yearId, districtId, clubId))
            {
                ctx.Response.StatusCode = StatusCodes.Status409Conflict;
                await ctx.Response.WriteAsJsonAsync(new { message = "This district is in planning: the current year is read-only. Plan in next year." });
                return;
            }
        }
        await _next(ctx);
    }

    private async Task<bool> IsPlanningCurrentYearAsync(int yearId, int? districtId, int? clubId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM tenant_subscriptions ts
            JOIN rotary_year_master y ON y.pk_year_id = @yearId AND y.IsCurrent = 1 AND y.isdeleted = 0
            WHERE ts.fk_club_id = 0 AND ts.state = 'planning'
              AND ts.fk_district_id = COALESCE(@districtId, (SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId))",
            new { yearId, districtId, clubId }) > 0;
    }
}
