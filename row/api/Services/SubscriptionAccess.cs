using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>What a club may use (document KIS/ROW/SUB/01, section 2).</summary>
public enum ClubAccessLevel
{
    /// <summary>Neither subscription is active: no one from the club signs in to the club area.</summary>
    None = 0,
    /// <summary>No Club subscription, but the district has an active District subscription: club executives, reporting features.</summary>
    Reporting = 1,
    /// <summary>The club has an active Club subscription.</summary>
    Full = 2,
}

/// <summary>One subscription's state on a given day.</summary>
public enum SubscriptionState { None, Active, Grace, Expired }

/// <summary>
/// District and Club subscriptions (KIS/ROW/SUB/01). Both live in <c>tenant_subscriptions</c>: the district row has
/// <c>fk_club_id = 0</c>, a club row carries the club. A subscription is Active until <c>term_end</c>, then in Grace for
/// <c>Subscriptions:GraceDays</c> (everything keeps working), then Expired. Nothing is deleted when access drops.
/// Enforcement is off until <c>Subscriptions:Enforce=true</c>, so existing clubs are not locked out while it is built.
/// </summary>
public static class SubscriptionAccess
{
    public static bool Enforce { get; private set; }
    public static int GraceDays { get; private set; } = 30;

    public static void Configure(IConfiguration config)
    {
        Enforce = config.GetValue("Subscriptions:Enforce", false);
        GraceDays = Math.Max(0, config.GetValue("Subscriptions:GraceDays", 30));
    }

    /// <summary>State of a subscription whose term ends on <paramref name="termEnd"/>, on <paramref name="today"/>.</summary>
    public static SubscriptionState StateOn(DateTime? termEnd, DateTime today, int graceDays)
    {
        if (termEnd is not DateTime end) return SubscriptionState.None;
        if (today.Date <= end.Date) return SubscriptionState.Active;
        return today.Date <= end.Date.AddDays(graceDays) ? SubscriptionState.Grace : SubscriptionState.Expired;
    }

    /// <summary>Section 2: Full if the club's own subscription works, else Reporting if the district's does, else None.</summary>
    public static ClubAccessLevel LevelFor(SubscriptionState club, SubscriptionState district)
    {
        static bool Works(SubscriptionState s) => s is SubscriptionState.Active or SubscriptionState.Grace;
        if (Works(club)) return ClubAccessLevel.Full;
        return Works(district) ? ClubAccessLevel.Reporting : ClubAccessLevel.None;
    }

    public sealed record ClubAccess(int ClubId, int DistrictId, ClubAccessLevel Level,
        SubscriptionState ClubState, DateTime? ClubTermEnd, SubscriptionState DistrictState, DateTime? DistrictTermEnd);

    /// <summary>The club's access level today, with both subscriptions' states. Null when the club does not exist.</summary>
    public static async Task<ClubAccess?> GetClubAccessAsync(MySqlConnection conn, int clubId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(int DistrictId, DateTime? ClubEnd, DateTime? DistrictEnd)>(@"
            SELECT c.fk_district_id,
                   (SELECT t.term_end FROM tenant_subscriptions t
                     WHERE t.fk_club_id = c.pk_club_id AND t.state = 'live' ORDER BY t.term_end DESC LIMIT 1),
                   (SELECT t.term_end FROM tenant_subscriptions t
                     WHERE t.fk_district_id = c.fk_district_id AND t.fk_club_id = 0 AND t.state = 'live' LIMIT 1)
            FROM club_master c WHERE c.pk_club_id = @clubId AND c.isdeleted = 0", new { clubId });
        if (row.DistrictId == 0) return null;
        var today = DateTime.UtcNow.Date;
        var clubState = StateOn(row.ClubEnd, today, GraceDays);
        var districtState = StateOn(row.DistrictEnd, today, GraceDays);
        return new ClubAccess(clubId, row.DistrictId, LevelFor(clubState, districtState),
            clubState, row.ClubEnd, districtState, row.DistrictEnd);
    }

    /// <summary>The District subscription's state today (district modules lock when it is Expired or None).</summary>
    public static async Task<(SubscriptionState State, DateTime? TermEnd)> GetDistrictStateAsync(MySqlConnection conn, int districtId)
    {
        var end = await conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT term_end FROM tenant_subscriptions
            WHERE fk_district_id = @districtId AND fk_club_id = 0 AND state = 'live' LIMIT 1", new { districtId });
        return (StateOn(end, DateTime.UtcNow.Date, GraceDays), end);
    }

    /// <summary>
    /// Section 4.5 steps 4-5: scheduled messages stop and payment links close when the owner's subscription no longer
    /// works. A club record (club id above 0) needs the club's own subscription, a district record the district's.
    /// Always true while enforcement is off.
    /// </summary>
    public static async Task<bool> OwnerWorksAsync(MySqlConnection conn, int? clubId, int? districtId)
    {
        if (!Enforce) return true;
        if (clubId is > 0) return (await GetClubAccessAsync(conn, clubId.Value))?.Level == ClubAccessLevel.Full;
        if (districtId is > 0) return (await GetDistrictStateAsync(conn, districtId.Value)).State is SubscriptionState.Active or SubscriptionState.Grace;
        return true;
    }

    /// <summary>
    /// Section 4.5 step 5: a public payment link closes when its club's subscription stops working.
    /// <paramref name="table"/> and <paramref name="keyColumn"/> are code constants.
    /// </summary>
    public static async Task<bool> LinkOpenAsync(IConfiguration config, string table, string keyColumn, int id)
    {
        if (!Enforce) return true;
        await using var conn = RowDb.Connect(config.GetConnectionString("DefaultConnection"));
        var clubId = await conn.ExecuteScalarAsync<int?>($"SELECT fk_club_id FROM `{table}` WHERE `{keyColumn}` = @id", new { id });
        return await OwnerWorksAsync(conn, clubId, null);
    }

    /// <summary>
    /// The same rule as an SQL condition for job queries that page through pending records (a skipped row must not
    /// hold a place in the page). Empty while enforcement is off. The columns are code constants, never user input.
    /// </summary>
    public static string OwnerWorksSql(string clubColumn, string districtColumn)
    {
        if (!Enforce) return "";
        var live = $"t.state = 'live' AND t.term_end >= UTC_DATE() - INTERVAL {GraceDays} DAY";
        return $@" AND (CASE WHEN IFNULL({clubColumn}, 0) > 0
                     THEN EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_club_id = {clubColumn} AND {live})
                     ELSE IFNULL({districtColumn}, 0) = 0
                          OR EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_district_id = {districtColumn} AND t.fk_club_id = 0 AND {live})
                   END)";
    }

    /// <summary>
    /// Section 3: the lowest level each club feature needs. Reporting covers rows 3 to 7 (projects, monthly report,
    /// attendance, goals, club details and officers, member list view, paying district dues); everything else needs Full.
    /// Keys are the module keys used by <see cref="FeatureGate"/>.
    /// </summary>
    public static readonly IReadOnlySet<string> ReportingModules = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        // Row 3, club projects with photos: the service-avenue modules.
        "club_service", "community_service", "international_service", "vocational_service", "new_generation_service",
        "public_image_initiative",
        // Row 4, monthly report, attendance report, club goals.
        "club_monthly_report", "attendance", "reports", "goal_setting",
        // Row 5, club details, meeting place, officers. Row 6, member list (view only).
        "board_of_directors", "directory",
        // Row 7, paying district dues.
        "club_dues",
    };

    public static ClubAccessLevel RequiredLevel(string moduleKey) =>
        ReportingModules.Contains(moduleKey) ? ClubAccessLevel.Reporting : ClubAccessLevel.Full;

    /// <summary>
    /// Section 2: under Reporting only these executives sign in (RI officer titles, current Rotary year; incoming
    /// officers of the next year too, before 1 July).
    /// </summary>
    public static readonly IReadOnlySet<string> ReportingExecutiveTitles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Club President", "Club President-Elect", "Club Immediate Past President", "Club Secretary",
        "Club Treasurer", "Club Executive Secretary/Director",
    };
}
