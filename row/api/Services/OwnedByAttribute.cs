using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Answers 404 unless the record named by one route value belongs to the club, district or parent record named by
/// another. The scope guard only proves the caller may act on /api/clubs/{clubId} (or the district); without this, a
/// record id from another club passed under the caller's own club would be read or changed.
/// <paramref name="existsSql"/> is a constant in code with @Id and @Scope parameters, never built from input.
/// Several attributes on one action check a chain (group in district, then member in group).
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
public sealed class OwnedByAttribute : ActionFilterAttribute
{
    private readonly string _sql, _idRoute, _scopeRoute;

    public OwnedByAttribute(string existsSql, string idRoute, string scopeRoute)
    {
        _sql = existsSql; _idRoute = idRoute; _scopeRoute = scopeRoute;
    }

    public override async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var values = context.RouteData.Values;
        if (!int.TryParse(values[_idRoute]?.ToString(), out var id) || !int.TryParse(values[_scopeRoute]?.ToString(), out var scope))
        {
            context.Result = new NotFoundObjectResult(new { message = "Not found." });
            return;
        }
        var cs = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection");
        await using var conn = new MySqlConnection(cs);
        var found = await conn.ExecuteScalarAsync<int?>(_sql, new { Id = id, Scope = scope });
        if (found is not > 0)
        {
            context.Result = new NotFoundObjectResult(new { message = "Not found." });
            return;
        }
        await next();
    }
}
