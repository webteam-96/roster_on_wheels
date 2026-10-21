using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Platform-wide module switches (user's module sheet, 2026-10-21; list in PENDING-WORK §11a).
/// Skipped modules are off for good: the code stays, the API answers 404 and the admin hides them.
/// Flagged modules are built but off until a SuperAdmin turns them on (Settings > Features, table platform_features).
/// Per-club / per-district module switches (club_modules, district_modules) still apply on top of this.
/// </summary>
public static class FeatureGate
{
    public enum Kind { Skipped, Flagged }

    /// <param name="Api">request path patterns; a pattern starting with "write:" only blocks POST/PUT/PATCH/DELETE</param>
    /// <param name="Admin">admin page path patterns (JavaScript regex syntax too: the admin hides links and pages with them)</param>
    public record Feature(string Key, string Label, Kind Kind, string[] Api, string[] Admin);

    public static readonly Feature[] All =
    {
        new("club_moderation", "Club moderator dashboard and project approval", Kind.Skipped,
            new[] { @"^/api/project-approval(/|$)", @"^/api/(mobile/)?club-moderator(/|$)" },
            new[] { @"^/club-moderator(/|$)" }),
        new("ri_director", "RI Director dashboard and reports", Kind.Skipped,
            new[] { @"^/api/(mobile/)?ri-director(/|$)" },
            new[] { @"^/ri-director(/|$)" }),
        new("zonal_dashboard", "Zonal dashboard and zone reports", Kind.Skipped,
            new[] { @"^/api/(mobile/)?zonal-dashboard(/|$)" },
            new[] { @"^/zonal-dashboard(/|$)" }),
        new("zonal_awards", "Zonal awards", Kind.Skipped,
            new[] { @"^/api/(mobile/)?zonal-awards(/|$)", @"^/api/districts/\d+/zonal-awards(/|$)", @"^/api/zones/\d+/zone-awards(/|$)", @"/toggle-zonal-awards$" },
            new[] { @"/zonal-awards(/|$)" }),
        new("goal_lock", "District goal lock / unlock", Kind.Skipped,
            new[] { @"^/api/(mobile/)?goal-setting/districts/\d+/(lock|unlock)$" },
            Array.Empty<string>()),
        new("goal_setting_roles", "Goal setting roles", Kind.Skipped,
            new[] { @"write:^/api/(mobile/)?goal-setting/role-assignments(/|$)" },
            new[] { @"^/settings/goal-setting-roles(/|$)" }),
        new("directory_data_collection", "Directory data collection", Kind.Skipped,
            new[] { @"^/api/admin/directory-config(/|$)" },
            new[] { @"^/settings/directory-data-collection(/|$)" }),
        new("direct_beneficiaries", "Direct beneficiary limit and approvals", Kind.Skipped,
            // the project forms read the limit and ask for approval above it: a 404 reads as "no limit"
            new[] { @"^/api/beneficiary-approval(/|$)", @"^/api/system-settings/direct_beneficiaries_limit$", @"^/api/zones/\d+/direct-beneficiar" },
            new[] { @"^/settings/direct-beneficiaries-limit(/|$)", @"^/zones/[^/]+/direct-beneficiaries(/|$)" }),
        new("pph_camps", "PPH camps", Kind.Skipped,
            new[] { @"/pph-(camps|attendees)(/|$)" },
            new[] { @"/pph-camps(/|$)" }),
        new("category_masters", "Categories and sub-categories masters", Kind.Skipped,
            // project forms still read categories, only editing the masters is skipped
            new[] { @"write:^/api/(sub-)?categories(/|$)" },
            new[] { @"^/settings/categories(/|$)" }),
        new("marketplace", "Market place", Kind.Skipped,
            new[] { @"^/api/(mobile/)?club-admin-dashboard/dashboard-marketplace(/|$)" },
            new[] { @"/marketplace(/|$)" }),

        new("ocv", "OCV / Governor visit", Kind.Flagged,
            new[] { @"^/api/clubs/\d+/ocv-gov(/|$)", @"/ocv-documents(/|$)", @"^/api/public/ocv-live-documents(/|$)", @"/district-report/ocv-gov(/|$)" },
            new[] { @"/ocv-gov(/|$)" }),
        new("foundation_goals", "Foundation goals", Kind.Flagged,
            new[] { @"^/api/(mobile/)?club-foundation-goals(/|$)", @"/foundation-goal(/|$)" },
            new[] { @"/foundation-goal(/|$)" }),
        new("sub_groups", "Sub groups", Kind.Flagged,
            // district committee sub groups (…/committee/groups/{id}/sub-groups) are a different module
            new[] { @"^/api/(clubs|districts)/\d+/sub-groups(/|$)" },
            new[] { @"^/(clubs|districts)/[^/]+/sub-groups(/|$)", @"/quick-links/sub-groups(/|$)" }),
        new("cmr_email_settings", "CMR submission email settings", Kind.Flagged,
            new[] { @"/cmr-email-settings(/|$)" },
            Array.Empty<string>()),
        new("club_excellence", "Club excellence / youth tracking", Kind.Flagged,
            new[] { @"^/api/(mobile/)?ag-dashboard/(excellence|youth)(/|$)" },
            new[] { @"^/ag-dashboard/(excellence|youth)(/|$)" }),
        new("club_monthly_report", "Club monthly report", Kind.Flagged,
            new[] { @"/(club-)?monthly-reports?(/|$)" },
            new[] { @"/club-monthly-report(/|$)" }),
    };

    private static readonly (Feature F, Regex Re, bool WritesOnly)[] Rules = All
        .SelectMany(f => f.Api.Select(p => (f, new Regex(p.StartsWith("write:") ? p[6..] : p, RegexOptions.IgnoreCase | RegexOptions.Compiled), p.StartsWith("write:"))))
        .ToArray();

    public static bool IsSkipped(string key) => All.Any(f => f.Key == key && f.Kind == Kind.Skipped);

    /// <summary>The feature that blocks this request, or null.</summary>
    public static Feature? Match(string path, string method)
    {
        var write = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        foreach (var (f, re, writesOnly) in Rules)
            if ((write || !writesOnly) && re.IsMatch(path)) return f;
        return null;
    }

    // Flagged features that are on. Short cache: every API request reads it.
    private static HashSet<string>? _on;
    private static DateTime _onRead;

    public static async Task<HashSet<string>> OnAsync(string connectionString)
    {
        if (_on != null && DateTime.UtcNow - _onRead < TimeSpan.FromSeconds(30)) return _on;
        await using var conn = new MySqlConnection(connectionString);
        _on = (await conn.QueryAsync<string>("SELECT feature_key FROM platform_features WHERE enabled = 1")).ToHashSet();
        _onRead = DateTime.UtcNow;
        return _on;
    }

    public static void Invalidate() => _on = null;

    public static async Task<bool> IsOffAsync(Feature f, string connectionString)
        => f.Kind == Kind.Skipped || !(await OnAsync(connectionString)).Contains(f.Key);
}

/// <summary>Answers 404 for requests to a skipped module or to a flagged module that is switched off.</summary>
public class FeatureGateMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _connectionString;

    public FeatureGateMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var f = FeatureGate.Match(ctx.Request.Path.Value ?? "", ctx.Request.Method);
        if (f != null && await FeatureGate.IsOffAsync(f, _connectionString))
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            await ctx.Response.WriteAsJsonAsync(new { message = "This feature is not available.", feature = f.Key });
            return;
        }
        await _next(ctx);
    }
}
