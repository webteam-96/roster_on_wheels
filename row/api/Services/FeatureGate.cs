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
        new("ocv", "OCV / Governor visit", Kind.Flagged,
            new[] { @"^/api/clubs/\d+/ocv-gov(/|$)", @"/ocv-documents(/|$)", @"^/api/public/ocv-live-documents(/|$)", @"/district-report/ocv-gov(/|$)" },
            new[] { @"/ocv-gov(/|$)" }),
        new("foundation_goals", "Foundation goals", Kind.Flagged,
            new[] { @"^/api/(mobile/)?club-foundation-goals(/|$)", @"/foundation-goal(/|$)" },
            new[] { @"/foundation-goal(/|$)" }),
        new("sub_groups", "Sub groups", Kind.Flagged,
            // district committee sub groups (…/committee/groups/{id}/sub-groups) are a different module;
            // …/sub-groups/club-members is the club's member list mass email picks recipients from, so it stays open
            new[] { @"^/api/(clubs|districts)/\d+/sub-groups(/(?!club-members$)|$)" },
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
        // Build spec 3.12. The duplicate check on member add / edit / import is not gated: it refines an existing refusal.
        new("membership_fields", "Foundation designations and committee documents", Kind.Flagged,
            new[] { @"/foundation-designations(/|$)", @"^/api/districts/\d+/committee/documents(/|$)" },
            new[] { @"/foundation-designations(/|$)" }),
        // Build list #26-#28. The milestone job and the app feed (MobileNotificationFeedService) check the flag too.
        new("engagement", "Engagement: milestones, PHF highlights, spotlight cards", Kind.Flagged,
            new[] { @"^/api/(clubs|districts)/\d+/engagement(/|$)", @"^/api/engagement(/|$)" },
            new[] { @"/engagement(/|$)" }),
        new("grants", "Grants (district grant cycles and club applications)", Kind.Flagged,
            new[] { @"^/api/(clubs|districts)/\d+/grants(/|$)" },
            new[] { @"/grants(/|$)" }),
        new("volunteers", "Volunteers and speakers (sign-up sheets, speakers, meeting duties)", Kind.Flagged,
            new[] { @"^/api/clubs/\d+/(volunteer-sheets|speakers|meeting-duties)(/|$)", @"^/api/mobile/(volunteers|meeting-duties)(/|$)",
                    @"^/api/public/volunteers(/|$)", @"^/api/public/club/\d+/speakers(/|$)" },
            new[] { @"/volunteers(/|$)", @"/speakers(/|$)", @"^/public/volunteer(/|$)" }),
        // N3 (2026-10-23). The existing potential-members list/add/edit stay on; the new parts switch with this.
        new("contacts_growth", "Contacts, prospect pipeline, join form, invite prompts and growth", Kind.Flagged,
            new[]
            {
                @"^/api/(clubs|districts)/\d+/(contacts|contact-groups)(/|$)",
                @"^/api/clubs/\d+/potential-members/\d+/convert$",
                @"^/api/(clubs|districts)/\d+/growth(/|$)",
                @"^/api/clubs/\d+/invite-(prompts|link)(/|$)",
                @"^/api/public/(join|invite)(/|$)",
            },
            new[] { @"^/(club|district)-admin-dashboard/contacts(/|$)" }),
        // N10 (2026-10-23): read-only target against actual per club and district; targets come from goal setting and N3.
        new("target_dashboard", "Live target dashboard", Kind.Flagged,
            new[] { @"^/api/(clubs|districts)/\d+/targets(/|$)" },
            new[] { @"^/(club|district)-admin-dashboard/targets(/|$)", @"^/ag-dashboard/targets(/|$)" }),
        // B.1 #32 (2026-10-24): alerts from club president to Assistant Governor to DG. The daily pass and the app feed
        // check the switch too; the target rule also needs target_dashboard on, the meeting rule meetings.
        new(EscalationService.FeatureKey, "Escalation alerts (club president, Assistant Governor, District Governor)", Kind.Flagged,
            new[] { @"^/api/districts/\d+/escalation(/|$)", @"^/api/escalation(/|$)" },
            new[] { @"^/district-admin-dashboard/escalation(/|$)" }),
        // B.1 #35 (2026-10-24): once per target reached, an app message to the club, a note to the DG and a spotlight
        // card. The daily pass and the app feed check the switch; cards are approved on the Engagement page.
        new(CelebrationService.FeatureKey, "Target celebration (club message, note to the DG, spotlight card)", Kind.Flagged,
            new[] { @"^/api/celebration(/|$)" },
            Array.Empty<string>()),
        // the pasted join link on meetings is ROW Wave 1 and stays open; reminders also check this switch
        new(MeetingsService.FeatureKey, "Meetings: calendar feeds, reminders, compliance", Kind.Flagged,
            new[] { @"/calendar-feed(/|$)", @"^/api/public/calendar/", @"/meeting-compliance(/|$)" },
            new[] { @"/meeting-compliance(/|$)" }),
        // the unsubscribe link and the Brevo webhook stay open: links in inboxes must keep working, the webhook has its secret.
        // Sends also check this switch (ClubMassEmailService, GreetingsWorker, meeting reminders).
        new(CommsService.FeatureKey, "Communication: templates per language, sender domains, tracking, consent, allowances", Kind.Flagged,
            new[] { @"^/api/(clubs|districts)/\d+/comms(/|$)", @"^/api/mobile/comms(/|$)" },
            new[] { @"/comms-settings(/|$)" }),
        // off: the public sites get a 404 from the public route and show their default language only
        new("website_languages", "Multilingual websites", Kind.Flagged,
            new[] { @"^/api/(clubs|districts)/\d+/website-languages(/|$)", @"^/api/public/website-languages(/|$)" },
            new[] { @"/website-data/languages(/|$)", @"/my-district-website/languages(/|$)" }),
        // off: every chat route and the hub (/api/chat/hub) answer 404, so the app hides chat
        new("chat", "Chat", Kind.Flagged,
            new[] { @"^/api/chat(/|$)", @"^/api/(clubs|districts)/\d+/chat-moderation(/|$)" },
            new[] { @"/chat-moderation(/|$)" }),
        // N7 (build spec 3.1). Off: the Wave 1 planning guard alone, no elect access or elect sign-in, no scheduled
        // cut-over (the guards, sign-in and the cut-over job check this switch too).
        new(PlanningAccess.FeatureKey, "Planning mode: elect access, launchpad, cut-over, trials", Kind.Flagged,
            new[] { @"^/api/planning(/|$)", @"^/api/tenants/\d+/(trial|convert-trial)$" },
            new[] { @"^/planning(/|$)" }),
    };

    private static readonly (Feature F, Regex Re, bool WritesOnly)[] Rules = All
        .SelectMany(f => f.Api.Select(p => (f, new Regex(p.StartsWith("write:") ? p[6..] : p, RegexOptions.IgnoreCase | RegexOptions.Compiled), p.StartsWith("write:"))))
        .ToArray();

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

    /// <summary>For code outside a gated route (background jobs, shared services): is this flagged module on?</summary>
    public static async Task<bool> IsOnAsync(string key, string connectionString)
        => All.Any(f => f.Key == key && f.Kind == Kind.Flagged) && (await OnAsync(connectionString)).Contains(key);
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
