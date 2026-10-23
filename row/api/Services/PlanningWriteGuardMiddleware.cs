using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// While a district's tenant subscription is in the <c>planning</c> state (ROW Wave 1, build spec item 1), writes to
/// that district's current-year records are refused with 409; other years (the next year being planned) are allowed.
/// Applies to every write route that carries <c>{yearId}</c> together with <c>{clubId}</c> or <c>{districtId}</c>.
/// With planning_mode on (N7, PlanningAccess): the planning routes (officers, calendars, committees, AGs) are covered
/// too, with the year read from the body or the stored record, which must belong to the club or district in the URL;
/// the read-only year is the one before the planning year; after a cut-over the archived year is read-only.
/// </summary>
// shortcut: other routes that take the year in the body or query are not covered, add them to PlanningAccess when one matters.
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
        if (write)
        {
            var on = await FeatureGate.IsOnAsync(PlanningAccess.FeatureKey, _connectionString);
            var target = on ? await PlanningAccess.ResolveTargetAsync(ctx, _connectionString) : null;
            if (target is { Foreign: true })
            {
                ctx.Response.StatusCode = StatusCodes.Status404NotFound;
                await ctx.Response.WriteAsJsonAsync(new { message = "Record not found in this club or district." });
                return;
            }
            int? districtId = int.TryParse(ctx.GetRouteValue("districtId")?.ToString(), out var d) ? d : null;
            int? clubId = int.TryParse(ctx.GetRouteValue("clubId")?.ToString(), out var c) ? c : null;
            if (target != null)
            {
                districtId = target.IsClub ? null : target.ScopeId;
                clubId = target.IsClub ? target.ScopeId : null;
            }
            var years = new HashSet<int>(target?.Years ?? new HashSet<int>());
            if (int.TryParse(ctx.GetRouteValue("yearId")?.ToString(), out var yearId)) years.Add(yearId);
            if (years.Count > 0 && (districtId != null || clubId != null))
            {
                await using var conn = new MySqlConnection(_connectionString);
                if (await PlanningAccess.ReadOnlyYearAsync(conn, districtId, clubId, on) is { } ro && years.Contains(ro.Year))
                {
                    ctx.Response.StatusCode = StatusCodes.Status409Conflict;
                    await ctx.Response.WriteAsJsonAsync(new
                    {
                        message = ro.Archived
                            ? "This Rotary year is archived for this district: it is read-only."
                            : "This district is in planning: the current year is read-only. Plan in next year.",
                    });
                    return;
                }
            }
        }
        await _next(ctx);
    }
}
