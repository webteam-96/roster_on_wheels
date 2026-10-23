using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Planning mode (ROW build spec 3.1): which Rotary years a write touches, a district's read-only year, and the elect
/// roles that may write the year being planned. Used by ScopeWriteGuardMiddleware (elect access),
/// PlanningWriteGuardMiddleware (read-only years), AuthService (elect sign-in) and the dues services (collection off).
/// Everything here is off while the planning_mode switch is off, except the Wave 1 rule in ReadOnlyYearAsync.
/// </summary>
public static class PlanningAccess
{
    public const string FeatureKey = "planning_mode";
    public static readonly string[] DistrictRoles = { "DGE", "DS", "DT" };
    public static readonly string[] ClubRoles = { "PE", "SE" };

    /// <summary>A write on a planning route: the club or district in the URL, the years it touches, whether a year
    /// could not be read (Unknown), and whether the stored record belongs to another club or district (Foreign).</summary>
    public sealed record Target(bool IsClub, int ScopeId, HashSet<int> Years, bool Unknown, bool Foreign);

    private sealed record Rule(string Methods, Regex Path, string? BodyYear = null, string[]? BodyDates = null,
        string? QueryYear = null, bool RouteYear = false, string? Record = null);

    private const RegexOptions Opt = RegexOptions.IgnoreCase | RegexOptions.Compiled;

    // Each returns the stored record's year (Year) and its club or district (Scope) for @id.
    private const string OfficerSql =
        "SELECT fk_year_id AS Year, fk_club_id AS Scope FROM board_of_directors WHERE pk_board_director_id = @id AND isdeleted = 0";
    // upcoming_events is the club and district calendar: a club event has fk_club_id, a district event fk_club_id 0
    // and fk_district_id; the year is the one its EventDate falls in.
    private const string EventYear = @"
        SELECT (SELECT y.pk_year_id FROM rotary_year_master y
                WHERE DATE(e.EventDate) BETWEEN y.StartDate AND y.EndDate AND y.isdeleted = 0 LIMIT 1) AS Year, ";
    private const string ClubEventSql = EventYear + "e.fk_club_id AS Scope FROM upcoming_events e WHERE e.pk_upcoming_event_id = @id AND e.isdeleted = 0";
    private const string DistrictEventSql = EventYear + @"IF(e.fk_club_id = 0, e.fk_district_id, NULL) AS Scope
        FROM upcoming_events e WHERE e.pk_upcoming_event_id = @id AND e.isdeleted = 0";
    private const string GroupSql =
        "SELECT fk_year_id AS Year, fk_district_id AS Scope FROM district_committee_group WHERE id = @id AND isdeleted = 0";
    private const string CommitteeMemberSql =
        "SELECT fk_year_id AS Year, fk_district_id AS Scope FROM district_committee_member WHERE id = @id AND isdeleted = 0";

    // The planning routes: officers, club and district calendars, district committees and AGs, plus the district's
    // past-event records (the guard only: their dates cannot be in the future). (?<s>) is the club or district,
    // (?<id>) the stored record. The year sources mirror what each controller files the record under.
    // shortcut: elect roles reach these planning modules only, not every Club Basic module; add a route here when
    // planning needs another year-scoped module.
    private static readonly Rule[] Rules =
    {
        new("POST", new(@"^/api/clubs/(?<s>\d+)/board-of-directors$", Opt), BodyYear: "yearId"),
        new("PUT", new(@"^/api/clubs/(?<s>\d+)/board-of-directors/reorder$", Opt), BodyYear: "yearId"),
        new("PUT DELETE", new(@"^/api/clubs/(?<s>\d+)/board-of-directors/(?<id>\d+)$", Opt), BodyYear: "yearId", Record: OfficerSql),
        new("POST", new(@"^/api/clubs/(?<s>\d+)/upcoming-events$", Opt), BodyDates: new[] { "eventDate" }),
        new("PUT DELETE", new(@"^/api/clubs/(?<s>\d+)/upcoming-events/(?<id>\d+)$", Opt), BodyDates: new[] { "eventDate" }, Record: ClubEventSql),
        new("POST", new(@"^/api/districts/(?<s>\d+)/committee/groups$", Opt), BodyYear: "yearId"),
        new("PUT DELETE", new(@"^/api/districts/(?<s>\d+)/committee/groups/(?<id>\d+)$", Opt), BodyYear: "yearId", Record: GroupSql),
        new("POST PUT DELETE", new(@"^/api/districts/(?<s>\d+)/committee/groups/(?<id>\d+)/members(/\d+)?$", Opt), Record: GroupSql),
        new("POST", new(@"^/api/districts/(?<s>\d+)/committee/members$", Opt), BodyYear: "yearId"),
        new("PUT DELETE", new(@"^/api/districts/(?<s>\d+)/committee/members/(?<id>\d+)$", Opt), BodyYear: "yearId", Record: CommitteeMemberSql),
        new("POST", new(@"^/api/districts/(?<s>\d+)/upcoming-events$", Opt), BodyDates: new[] { "eventDate" }),
        new("PUT DELETE", new(@"^/api/districts/(?<s>\d+)/upcoming-events/(?<id>\d+)$", Opt), BodyDates: new[] { "eventDate" }, Record: DistrictEventSql),
        // the controller files an event under ProjectDate when it is sent (even empty), else EventDate
        new("POST", new(@"^/api/districts/(?<s>\d+)/district-events$", Opt), BodyDates: new[] { "projectDate", "eventDate" }),
        new("PUT DELETE", new(@"^/api/districts/(?<s>\d+)/district-events/\d+/\d+$", Opt), RouteYear: true),
        new("POST", new(@"^/api/districts/(?<s>\d+)/ag$", Opt), BodyYear: "yearId"),
        new("DELETE", new(@"^/api/districts/(?<s>\d+)/ag/member/\d+$", Opt), QueryYear: "yearId"),
    };

    // Photo uploads the planning screens need: they hold no year and only write a file.
    private static readonly Regex Uploads = new(
        @"^/api/(clubs/\d+/upcoming-events/upload|districts/\d+/(upcoming-events/upload|committee/upload-photo))$", Opt);

    /// <summary>The planning route this write hits and the years it touches, or null for any other request.
    /// Resolved once per request (the scope guard and the planning guard share it).</summary>
    public static async Task<Target?> ResolveTargetAsync(HttpContext ctx, string cs)
    {
        if (ctx.Items.TryGetValue(nameof(Target), out var cached)) return (Target?)cached;
        var path = ctx.Request.Path.Value ?? "";
        var method = ctx.Request.Method.ToUpperInvariant();
        Target? target = null;
        foreach (var r in Rules)
        {
            var m = r.Path.Match(path);
            if (!m.Success || !r.Methods.Split(' ').Contains(method) || !int.TryParse(m.Groups["s"].Value, out var scope)) continue;
            var years = new HashSet<int>();
            bool unknown = false, foreign = false;
            await using var conn = new MySqlConnection(cs);
            if (r.RouteYear)
            {
                if (int.TryParse(ctx.GetRouteValue("yearId")?.ToString(), out var y)) years.Add(y); else unknown = true;
            }
            if (r.QueryYear != null)
            {
                if (int.TryParse(ctx.Request.Query[r.QueryYear], out var y) && y > 0) years.Add(y); else unknown = true;
            }
            if (r.BodyYear != null || r.BodyDates != null)
            {
                var body = await ReadJsonObjectAsync(ctx);
                if (r.BodyYear != null && body is { } b && Prop(b, r.BodyYear) is { } v && ReadInt(v) is int y && y > 0) years.Add(y);
                var date = body is { } b2 ? r.BodyDates?.Select(k => Prop(b2, k)).FirstOrDefault(p => p is { ValueKind: not JsonValueKind.Null }) : null;
                if (date is { } d)
                {
                    var dy = await YearOfDateAsync(conn, d.ValueKind == JsonValueKind.String ? d.GetString() : d.ToString());
                    if (dy is int yy) years.Add(yy); else unknown = true;
                }
            }
            if (r.Record != null)
            {
                var row = int.TryParse(m.Groups["id"].Value, out var id)
                    ? await conn.QueryFirstOrDefaultAsync<(int? Year, int? Scope)?>(r.Record, new { id })
                    : null;
                if (row is not { } rec) unknown = true;
                else if (rec.Scope != scope) foreign = true;
                else if (rec.Year is int ry) years.Add(ry);
                else unknown = true;
            }
            target = new Target(path.StartsWith("/api/clubs/", StringComparison.OrdinalIgnoreCase), scope, years,
                unknown || years.Count == 0, foreign);
            break;
        }
        ctx.Items[nameof(Target)] = target;
        return target;
    }

    /// <summary>True when the member's active elect role for this club (PE, SE) or district (DGE, DS, DT) allows this
    /// write: a planning route whose every year is the year being planned, or a planning photo upload.</summary>
    public static async Task<bool> ElectMayWriteAsync(HttpContext ctx, string cs, int memberId, bool isClub, int scopeId)
    {
        if (!await FeatureGate.IsOnAsync(FeatureKey, cs)) return false;
        int? year;
        await using (var conn = new MySqlConnection(cs))
            year = await ElectYearAsync(conn, memberId, isClub, scopeId);
        if (year == null) return false;
        if (Uploads.IsMatch(ctx.Request.Path.Value ?? "")) return true;
        var t = await ResolveTargetAsync(ctx, cs);
        return t is { Unknown: false, Foreign: false } && t.IsClub == isClub && t.ScopeId == scopeId && t.Years.All(y => y == year);
    }

    /// <summary>The year being planned when the member holds an active elect role for this club or district and
    /// the district is planning; otherwise null.</summary>
    public static Task<int?> ElectYearAsync(MySqlConnection conn, int memberId, bool isClub, int scopeId) =>
        conn.ExecuteScalarAsync<int?>($@"
            SELECT pr.fk_year_id FROM planning_roles pr
            JOIN tenant_subscriptions ts ON ts.fk_district_id = pr.fk_district_id AND ts.fk_club_id = 0
                 AND ts.state = 'planning' AND ts.planning_year_id = pr.fk_year_id
            WHERE pr.fk_member_id = @memberId AND pr.status = 'active' AND {(isClub
                ? "pr.fk_club_id = @scopeId AND pr.role_code IN ('PE','SE')"
                : "pr.fk_club_id = 0 AND pr.fk_district_id = @scopeId AND pr.role_code IN ('DGE','DS','DT')")}
            LIMIT 1", new { memberId, scopeId });

    /// <summary>For endpoints outside the URL guards (district goals): the member's elect role covers this club or
    /// district and the year is the one being planned.</summary>
    public static async Task<bool> ElectPlansYearAsync(MySqlConnection conn, string cs, int memberId, bool isClub, int scopeId, int yearId) =>
        yearId > 0 && await FeatureGate.IsOnAsync(FeatureKey, cs) && await ElectYearAsync(conn, memberId, isClub, scopeId) == yearId;

    /// <summary>For endpoints outside the URL guards (district goals): refuses a write to the district's read-only year.</summary>
    public static async Task EnsureYearWritableAsync(MySqlConnection conn, string cs, int districtId, int yearId)
    {
        if (!await FeatureGate.IsOnAsync(FeatureKey, cs)) return;
        if (await ReadOnlyYearAsync(conn, districtId, null, true) is { } ro && ro.Year == yearId)
            throw new InvalidOperationException(ro.Archived
                ? "This Rotary year is archived for this district: it is read-only."
                : "This district is in planning: the current year is read-only. Plan in next year.");
    }

    /// <summary>True when the member holds an active elect role in a district that is planning (admin sign-in,
    /// password reset and the dashboard landing admit them).</summary>
    public static async Task<bool> IsElectAsync(MySqlConnection conn, string cs, int memberId) =>
        await FeatureGate.IsOnAsync(FeatureKey, cs) && await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM planning_roles pr
            JOIN tenant_subscriptions ts ON ts.fk_district_id = pr.fk_district_id AND ts.fk_club_id = 0
                 AND ts.state = 'planning' AND ts.planning_year_id = pr.fk_year_id
            WHERE pr.fk_member_id = @memberId AND pr.status = 'active'", new { memberId }) > 0;

    /// <summary>The year a district's records may not be written in, or null. Planning: the year before the planning
    /// year (Wave 1, or with the switch off: the current year). Live after a cut-over: the archived year (switch on).</summary>
    public static async Task<(int Year, bool Archived)?> ReadOnlyYearAsync(MySqlConnection conn, int? districtId, int? clubId, bool on)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(string State, int? PlanningYear, int? ArchivedYear)?>(@"
            SELECT ts.state, ts.planning_year_id, ts.archived_year_id FROM tenant_subscriptions ts
            WHERE ts.fk_club_id = 0
              AND ts.fk_district_id = COALESCE(@districtId, (SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId))",
            new { districtId, clubId });
        if (row is not { } t) return null;
        if (t.State == "planning")
        {
            var year = on && t.PlanningYear is int p ? await YearBeforeAsync(conn, p) : await CurrentYearAsync(conn);
            return year is int y ? (y, false) : null;
        }
        return on && t.ArchivedYear is int a ? (a, true) : null;
    }

    /// <summary>Refuses (400) collecting dues of a read-only year while the district plans next year
    /// (spec 3.1: current-year dues collection off). clubDues: club_dues (a club pays its district), else
    /// membership_dues (a member pays the club).</summary>
    public static async Task EnsureDuesCollectableAsync(string cs, bool clubDues, int duesId)
    {
        if (!await FeatureGate.IsOnAsync(FeatureKey, cs)) return;
        await using var conn = new MySqlConnection(cs);
        var dues = await conn.QueryFirstOrDefaultAsync<(int? DistrictId, string? Year)?>(clubDues
            ? "SELECT fk_district_id, RotaryYear FROM club_dues WHERE pk_club_dues_id = @duesId"
            : @"SELECT (SELECT c.fk_district_id FROM club_master c WHERE c.pk_club_id = d.fk_club_id), d.RotaryYear
                FROM membership_dues d WHERE d.pk_membership_dues_id = @duesId", new { duesId });
        if (dues is not { DistrictId: int district } || string.IsNullOrEmpty(dues.Value.Year)) return;
        if (await ReadOnlyYearAsync(conn, district, null, true) is { Archived: false } ro
            && await conn.ExecuteScalarAsync<string?>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Year", new { ro.Year }) == dues.Value.Year)
            throw new InvalidOperationException("Dues collection is off while this district plans next year. It opens at cut-over.");
    }

    public static Task<int?> CurrentYearAsync(MySqlConnection conn) =>
        conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");

    public static Task<int?> YearBeforeAsync(MySqlConnection conn, int yearId) =>
        conn.ExecuteScalarAsync<int?>(@"
            SELECT y.pk_year_id FROM rotary_year_master y
            WHERE y.isdeleted = 0 AND y.StartDate < (SELECT StartDate FROM rotary_year_master WHERE pk_year_id = @yearId)
            ORDER BY y.StartDate DESC LIMIT 1", new { yearId });

    // An unreadable date counts as the current year, as the controllers do (RotaryYearHelper with no date).
    private static async Task<int?> YearOfDateAsync(MySqlConnection conn, string? text) =>
        DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var d)
            ? await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_year_id FROM rotary_year_master WHERE @d BETWEEN StartDate AND EndDate AND isdeleted = 0 LIMIT 1", new { d = d.Date })
            : await CurrentYearAsync(conn);

    private static async Task<JsonElement?> ReadJsonObjectAsync(HttpContext ctx)
    {
        if (ctx.Request.ContentType?.Contains("json", StringComparison.OrdinalIgnoreCase) != true) return null;
        ctx.Request.EnableBuffering();
        try
        {
            using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.Clone() : null;
        }
        catch (JsonException) { return null; }
        finally { ctx.Request.Body.Position = 0; }
    }

    private static JsonElement? Prop(JsonElement obj, string name)
    {
        foreach (var p in obj.EnumerateObject())
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) return p.Value;
        return null;
    }

    private static int? ReadInt(JsonElement v) =>
        v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n
        : v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s) ? s : null;
}
