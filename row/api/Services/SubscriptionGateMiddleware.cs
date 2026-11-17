using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Locks club and district features by subscription (KIS/ROW/SUB/01 sections 2, 3, 4.4, 4.5; exception 6: a locked
/// feature opened by direct link). Runs only when <c>Subscriptions:Enforce=true</c>. Super Admins always pass.
/// Answers 403 with a <c>code</c> the web and the app turn into the locked screen:
/// <c>subscription_required</c> (level None, or a district with no working District subscription),
/// <c>club_subscription_required</c> (a Full-only feature under Reporting),
/// <c>executives_only</c> (under Reporting only the club's executives sign in),
/// <c>app_subscription_required</c> (the member app, for a member of no club with a Club subscription).
/// Nothing is deleted or switched off in the data, so renewing restores everything as it was.
/// </summary>
public class SubscriptionGateMiddleware
{
    private static readonly Regex ClubPath = new(@"^/api/clubs/(\d+)(?:/([a-z0-9-]+))?", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ClubDashboardPath = new(@"^/api/(?:mobile/)?club-admin-dashboard/([a-z0-9-]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DistrictPath = new(@"^/api/(?:districts|district-modules)/(\d+)(?:/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DistrictDashboardPath = new(@"^/api/(?:mobile/)?(?:district-admin-dashboard|ag-dashboard)(?:/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    // Open at every level: buying a subscription, signing in, the app's version / sign-in checks and push token.
    private static readonly Regex AlwaysOpen = new(@"^/api/(subscriptions|auth|payments|mobile/(version|login-check|login-announcement|fcm))(/|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Section 3 rows 3 to 7, as the path segment after <c>api/clubs/{id}/</c> ("" is the club's own details).</summary>
    public static readonly IReadOnlySet<string> ReportingClubSegments = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "", "projects", "attendance", "monthly-reports", "club-report", "targets", "board-of-directors", "past-presidents",
        "members", "rotary-org-credentials", "has-website",
    };

    /// <summary>The same rows on the club dashboard (<c>api/club-admin-dashboard/{segment}</c>).</summary>
    public static readonly IReadOnlySet<string> ReportingDashboardSegments = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "available-years", "overview", "dashboard-bod", "dashboard-directory", "membership", "avenue",
        "service-projects-avenue", "service-projects-overview", "egovernance", "rotary-org-terminated-members",
    };

    /// <summary>
    /// Section 3 rows 1 and 3 to 7 on routes that name the club in the route or the query instead of under
    /// <c>api/clubs/{id}</c>: club goals, paying district dues, the AG module, district awards entries, club
    /// analytics, and planning the next year. Every other such route needs the Club subscription.
    /// </summary>
    private static readonly string[] ReportingPrefixes =
    {
        "/api/goal-setting", "/api/goal-setting-rotary", "/api/club-foundation-goals", "/api/club-dues", "/api/ag",
        "/api/citation-matrix", "/api/club-analytics", "/api/planning", "/api/time-zone",
    };

    private static bool HasPrefix(string path, string[] prefixes) => prefixes.Any(p =>
        path.Equals(p, StringComparison.OrdinalIgnoreCase) || path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase));

    private static bool IsReportingPrefix(string path) => HasPrefix(path, ReportingPrefixes);

    // Routes that take the club from the request body or from a record, and belong to section 3 rows 3 to 7:
    // the member list (view only), the RI project sync, grants, and the district's own lists.
    private static readonly string[] ReportingBodyPrefixes =
    {
        "/api/rotary-org-sync", "/api/grants", "/api/district-governors", "/api/district-directory",
        "/api/mobile/club-admin/club-report", "/api/mobile/club-admin/past-presidents", "/api/mobile/club-award-status",
        "/api/mobile/club-myrotary",
    };

    // Features outside section 3 rows 3 to 7 whose controllers take the club from the request body or a record and
    // run their own access checks, not the scope checks: chat, wallet and credits, the club website, payment
    // accounts, training bookings, the assistant, mass email and the email and push logs. The caller needs a seat
    // that works (MemberHasFullSeatAsync).
    // shortcut: a person with a seat in one Full club can still name a second, district-only club in the body of
    // these routes; move the check into each controller if that case ever matters.
    private static readonly string[] FullMemberPrefixes =
    {
        "/api/chat", "/api/wallet", "/api/admin/wallet", "/api/website-billing", "/api/admin/club-websites",
        "/api/cashfree-kyc", "/api/training-appointments", "/api/assistant", "/api/mass-email", "/api/mass-emails",
        "/api/email-log", "/api/admin/push-logs",
    };

    /// <summary>
    /// Section 3 for a path alone: true when a club at Reporting may use this route. Decides what the scope checks
    /// answer for a club the gate could not see in the route or the query (<see cref="ClubClosedAsync"/>).
    /// </summary>
    public static bool OpenUnderReporting(string path, bool write)
    {
        var club = ClubPath.Match(path);
        if (club.Success)
        {
            var segment = club.Groups[2].Value;
            return ReportingClubSegments.Contains(segment) && !(write && segment.Equals("members", StringComparison.OrdinalIgnoreCase));
        }
        var dash = ClubDashboardPath.Match(path);
        if (dash.Success) return ReportingDashboardSegments.Contains(dash.Groups[1].Value);
        if (DistrictPath.IsMatch(path) || DistrictDashboardPath.IsMatch(path)) return true;
        if (HasPrefix(path, new[] { "/api/members" })) return !write; // row 6: the member list is view only
        return IsReportingPrefix(path) || HasPrefix(path, ReportingBodyPrefixes);
    }

    // Set by the gate for the rest of the request: this route needs the Club subscription. AsyncLocal because the
    // scope checks are static and have no HttpContext.
    private static readonly AsyncLocal<bool> FullOnlyRequest = new();

    /// <summary>
    /// The refusal code for a club request, or null when it may go on. <paramref name="reportingFeature"/>: the path is
    /// one of section 3 rows 3 to 7. <paramref name="memberListWrite"/>: a change to the member list, view only under
    /// Reporting (row 6). <paramref name="clubSideOnly"/>: the caller reaches this club only as its member or admin
    /// (district officers and AGs see a Reporting club's reports without being its executive).
    /// </summary>
    public static string? ClubDenial(ClubAccessLevel level, bool reportingFeature, bool memberListWrite, bool isExecutive, bool clubSideOnly)
    {
        if (level == ClubAccessLevel.Full) return null;
        if (level == ClubAccessLevel.None) return "subscription_required";
        if (!reportingFeature || memberListWrite) return "club_subscription_required";
        return clubSideOnly && !isExecutive ? "executives_only" : null;
    }

    private static readonly Dictionary<string, string> Messages = new()
    {
        ["subscription_required"] = "This needs an active subscription.",
        ["club_subscription_required"] = "Available with Club subscription.",
        ["app_subscription_required"] = "The app is available when your club has a Club subscription.",
        ["executives_only"] = "Under the District subscription only the club's executives on record with Rotary International can sign in.",
    };

    private readonly RequestDelegate _next;
    private readonly string _cs;

    public SubscriptionGateMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "";
        var user = ctx.User;
        if (!SubscriptionAccess.Enforce || HttpMethods.IsOptions(ctx.Request.Method) || user.Identity?.IsAuthenticated != true
            || UserPermissionHelper.IsSuperAdmin(user) || AlwaysOpen.IsMatch(path)
            || !int.TryParse(user.FindFirst("memberId")?.Value, out var memberId))
        {
            await _next(ctx);
            return;
        }

        var write = !(HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method));
        FullOnlyRequest.Value = !OpenUnderReporting(path, write);
        var code = await DenialAsync(ctx, path, ctx.Request.Query, memberId, write);
        if (code == null) { await _next(ctx); return; }
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        await ctx.Response.WriteAsJsonAsync(new { message = Messages[code], code });
    }

    private async Task<string?> DenialAsync(HttpContext ctx, string path, IQueryCollection query, int memberId, bool write)
    {
        static int QueryId(IQueryCollection q, string key) => int.TryParse(q[key], out var v) ? v : 0;
        int RouteId(string key) => int.TryParse(ctx.GetRouteValue(key)?.ToString(), out var v) ? v : 0;

        var club = ClubPath.Match(path);
        if (club.Success)
        {
            var segment = club.Groups[2].Value;
            return await ClubDenialAsync(int.Parse(club.Groups[1].Value), memberId,
                ReportingClubSegments.Contains(segment), write && segment.Equals("members", StringComparison.OrdinalIgnoreCase));
        }
        var dash = ClubDashboardPath.Match(path);
        if (dash.Success)
        {
            // shortcut: without ?clubId= the dashboard picks the caller's club itself and is not gated here; the
            // web and the app always send clubId. Gate inside ClubAdminDashboardService if a caller ever omits it.
            var clubId = QueryId(query, "clubId");
            return clubId > 0 ? await ClubDenialAsync(clubId, memberId, ReportingDashboardSegments.Contains(dash.Groups[1].Value), false) : null;
        }
        var district = DistrictPath.Match(path);
        var districtId = district.Success ? int.Parse(district.Groups[1].Value)
            : DistrictDashboardPath.IsMatch(path) ? QueryId(query, "districtId") : 0;
        if (districtId > 0)
        {
            // Section 4.5 step 4: district modules lock. Club members still read district records their Full club shows.
            if (await DistrictWorksAsync(districtId)) return null;
            return await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, false, districtId) ? "subscription_required" : null;
        }
        // Section 4.4: the member app works only for members of a club with a Club subscription.
        if (path.StartsWith("/api/mobile/", StringComparison.OrdinalIgnoreCase))
            return await MemberHasFullClubAsync(memberId) ? null : "app_subscription_required";

        if (HasPrefix(path, FullMemberPrefixes) && !await MemberHasFullSeatAsync(memberId))
            return "club_subscription_required";

        // Every other route that names a club or a district in the route ({clubId}, {districtId}) or the query.
        // A club id carried only in the request body is closed by ClubClosedAsync, through the scope checks.
        var namedClub = RouteId("clubId") is > 0 and var rc ? rc : QueryId(query, "clubId");
        if (namedClub > 0) return await ClubDenialAsync(namedClub, memberId, IsReportingPrefix(path), false);
        var namedDistrict = RouteId("districtId") is > 0 and var rd ? rd : QueryId(query, "districtId");
        if (namedDistrict > 0 && !await DistrictWorksAsync(namedDistrict))
            return await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, false, namedDistrict) ? "subscription_required" : null;
        return null;
    }

    private async Task<string?> ClubDenialAsync(int clubId, int memberId, bool reportingFeature, bool memberListWrite)
    {
        var access = await CachedAsync($"club:{clubId}", async conn => await SubscriptionAccess.GetClubAccessAsync(conn, clubId));
        if (access == null || access.Level == ClubAccessLevel.Full) return null; // unknown club: the endpoint answers 404
        var isExecutive = false;
        var clubSideOnly = false;
        if (access.Level == ClubAccessLevel.Reporting && reportingFeature && !memberListWrite)
        {
            (isExecutive, clubSideOnly) = await CachedAsync($"seat:{memberId}:{clubId}", async conn =>
            {
                var exec = await SubscriptionOfficers.StandingAtClubAsync(conn, memberId, clubId) != ExecutiveStanding.None;
                var ofClub = await conn.ExecuteScalarAsync<int>(@"
                    SELECT (SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @memberId AND fk_club_id = @clubId
                              AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0)
                         + (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @memberId AND fk_club_id = @clubId
                              AND fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0)", new { memberId, clubId }) > 0;
                return (exec, ofClub && !await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, false, access.DistrictId));
            });
        }
        return ClubDenial(access.Level, reportingFeature, memberListWrite, isExecutive, clubSideOnly);
    }

    private Task<bool> DistrictWorksAsync(int districtId) => CachedAsync($"district:{districtId}", async conn =>
        (await SubscriptionAccess.GetDistrictStateAsync(conn, districtId)).State is SubscriptionState.Active or SubscriptionState.Grace);

    private Task<bool> MemberHasFullClubAsync(int memberId) => CachedAsync($"member:{memberId}", async conn =>
    {
        var clubIds = await conn.QueryAsync<int>(@"
            SELECT fk_club_id FROM club_members
            WHERE fk_member_master_profile_id = @memberId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0", new { memberId });
        foreach (var id in clubIds)
            if ((await SubscriptionAccess.GetClubAccessAsync(conn, id))?.Level == ClubAccessLevel.Full) return true;
        return false;
    });

    // A seat that works: member or Admin of a club with a Club subscription, or a district Admin or AG of a district
    // whose District subscription works.
    private Task<bool> MemberHasFullSeatAsync(int memberId) => CachedAsync($"fullseat:{memberId}", async conn =>
    {
        var clubIds = await conn.QueryAsync<int>(@"
            SELECT fk_club_id FROM club_members
            WHERE fk_member_master_profile_id = @memberId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0
            UNION
            SELECT fk_club_id FROM member_roles
            WHERE fk_member_master_profile_id = @memberId AND fk_role_id = 2 AND fk_club_id > 0 AND IsActive = 1 AND isdeleted = 0",
            new { memberId });
        foreach (var id in clubIds)
            if ((await SubscriptionAccess.GetClubAccessAsync(conn, id))?.Level == ClubAccessLevel.Full) return true;
        var districtIds = await conn.QueryAsync<int>(@"
            SELECT fk_district_id FROM member_roles
            WHERE fk_member_master_profile_id = @memberId AND fk_role_id = 2 AND IFNULL(fk_club_id, 0) = 0
              AND fk_district_id > 0 AND IsActive = 1 AND isdeleted = 0
            UNION
            SELECT c.fk_district_id FROM district_ag ag JOIN club_master c ON c.pk_club_id = ag.fk_club_id
            WHERE ag.fk_member_id = @memberId AND ag.is_active = 1 AND ag.isdeleted = 0", new { memberId });
        foreach (var id in districtIds)
            if ((await SubscriptionAccess.GetDistrictStateAsync(conn, id)).State is SubscriptionState.Active or SubscriptionState.Grace) return true;
        return false;
    });

    // Short cache: every signed-in request asks. A paid order clears it, so a club is Full straight away (4.3 step 2).
    private static readonly ConcurrentDictionary<string, (DateTime At, object? Value)> Cache = new();

    public static void Invalidate() => Cache.Clear();

    /// <summary>
    /// True when the club has no access at all (level None), or is at Reporting and this request is for a feature
    /// that needs the Club subscription, and enforcement is on. The scope checks
    /// (ScopeWriteGuardMiddleware.AllowedAsync / ReadAllowedAsync) ask this, so controllers that take the club id from
    /// the request body refuse a closed club too. Super Admins are let through by the caller's own role check.
    /// </summary>
    internal static async Task<bool> ClubClosedAsync(string connectionString, int clubId)
    {
        if (!SubscriptionAccess.Enforce || clubId <= 0) return false;
        var access = await CachedAsync(connectionString, $"club:{clubId}", async conn => await SubscriptionAccess.GetClubAccessAsync(conn, clubId));
        return access is { Level: ClubAccessLevel.None } || (access is { Level: ClubAccessLevel.Reporting } && FullOnlyRequest.Value);
    }

    private Task<T> CachedAsync<T>(string key, Func<MySqlConnection, Task<T>> read) => CachedAsync(_cs, key, read);

    private static async Task<T> CachedAsync<T>(string connectionString, string key, Func<MySqlConnection, Task<T>> read)
    {
        if (Cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < TimeSpan.FromSeconds(30)) return (T)hit.Value!;
        await using var conn = RowDb.Connect(connectionString);
        await conn.OpenAsync();
        var value = await read(conn);
        if (Cache.Count > 20_000) Cache.Clear();
        Cache[key] = (DateTime.UtcNow, value);
        return value;
    }
}
