using System.Net;
using Dapper;
using MySqlConnector;
using RotaryApi.Controllers;
using RotaryApi.Privacy;

namespace RotaryApi.Services;

/// <summary>
/// Engagement (build list #26-#28, flag engagement): membership milestones and Paul Harris Fellow highlights.
/// One engagement_events row per milestone or PHF. Its UNIQUE dedupe_key is the sent-log, and the row is written
/// before the email goes, so a restart or a second run never sends twice. The rows feed the app (a leg in
/// MobileNotificationFeedService), the highlights list the bulletin and greetings pull, and the spotlight card
/// queue (EngagementController). Channels: email and the in-app feed only.
/// </summary>
public class EngagementService
{
    public const string FeatureKey = "engagement";
    public static readonly int[] DefaultMilestones = { 1, 3, 5, 10 };
    // shortcut: a missed day is caught up for 7 days only; widen it if the job may be down longer.
    private const int CatchUpDays = 7;
    // A PHF awarded longer ago than this when it is entered is history being back-filled, not news.
    private const int PhfNewsDays = 90;

    // Active membership of a club whose district and zone are active (the kill-switch chain the feed and push use).
    private const string ActiveMembership = @"
        JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1
        JOIN district_master dm ON dm.pk_district_id = c.fk_district_id AND dm.isdeleted = 0 AND dm.IsActive = 1
        JOIN zone_master z ON z.pk_zone_id = dm.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1";

    private readonly string _connectionString;
    private readonly IEmailService _email;
    private readonly ILogger<EngagementService> _log;

    public EngagementService(IConfiguration config, IEmailService email, ILogger<EngagementService> log)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _log = log;
    }

    public static async Task<bool> IsOnAsync(string connectionString)
        => (await FeatureGate.OnAsync(connectionString)).Contains(FeatureKey);

    /// <summary>"5 years in Rotary" or "Paul Harris Fellow +2".</summary>
    public static string Label(string type, int level) => type == "PHF"
        ? FoundationDesignationsController.Label("PHF", level)
        : $"{level} {(level == 1 ? "year" : "years")} in Rotary";

    /// <summary>The congratulation line used by the feed, the highlights list and the spotlight card.</summary>
    public static string Sentence(string type, int level, string memberName, string? clubName)
    {
        var of = string.IsNullOrWhiteSpace(clubName) ? "" : $" of {clubName}";
        return type == "PHF"
            ? $"Congratulations to {memberName}{of}, recognised as a {Label(type, level)}."
            : $"Congratulations to {memberName}{of} on {level} {(level == 1 ? "year" : "years")} of Rotary membership.";
    }

    /// <summary>"1, 3,5" → [1, 3, 5]; null when an entry is not a whole number from 1 to 100 or there are more than 10.</summary>
    public static int[]? ParseYears(string? text)
    {
        var parts = (text ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var years = new List<int>();
        foreach (var p in parts)
        {
            if (!int.TryParse(p, out var y) || y < 1 || y > 100) return null;
            if (!years.Contains(y)) years.Add(y);
        }
        return years.Count > 10 ? null : years.OrderBy(y => y).ToArray();
    }

    /// <summary>
    /// New PHF designations (awarded in the last 90 days) become highlights, one per designation: the dedupe key
    /// makes a repeat a no-op. designationId limits it to one row (called right after a designation is added).
    /// A member in two clubs gets the highlight once, in the first club the SELECT returns.
    /// </summary>
    public static Task<int> CapturePhfAsync(MySqlConnection conn, int? designationId, int? districtId = null) =>
        conn.ExecuteAsync($@"
            INSERT IGNORE INTO engagement_events
                (event_type, dedupe_key, fk_member_master_profile_id, fk_club_id, fk_district_id, fk_designation_id, level, occurred_on)
            SELECT 'PHF', CONCAT('PHF:', d.pk_member_designation_id), d.fk_member_master_profile_id, cm.fk_club_id,
                   c.fk_district_id, d.pk_member_designation_id, IFNULL(d.level, 0), d.awarded_date
            FROM member_foundation_designations d
            JOIN club_members cm ON cm.fk_member_master_profile_id = d.fk_member_master_profile_id
            {ActiveMembership}
            WHERE d.isdeleted = 0 AND d.designation_type = 'PHF' AND d.awarded_date >= CURDATE() - INTERVAL {PhfNewsDays} DAY
              AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
              AND (@Id IS NULL OR d.pk_member_designation_id = @Id)
              AND (@District IS NULL OR c.fk_district_id = @District)",
            new { Id = designationId, District = districtId });

    private sealed class Candidate
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? Email { get; set; }
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public int Years { get; set; }
        public DateTime OccurredOn { get; set; }
        public bool MayEmail { get; set; }
    }

    /// <summary>
    /// The daily pass: capture new PHF highlights, then record and send the milestones that came round in the last
    /// 7 days. Each milestone row is inserted before its email, so only the run that inserts it sends.
    /// districtId limits the pass to one district (the SuperAdmin "run now"). Each district counts from its own local
    /// date (N12); fromLocalHour leaves out the districts whose local time is earlier (the daily job's morning start).
    /// </summary>
    public async Task<(int Milestones, int Highlights)> RunAsync(int? districtId, CancellationToken ct = default, int fromLocalHour = 0)
    {
        if (!await IsOnAsync(_connectionString)) return (0, 0);
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        var highlights = await CapturePhfAsync(conn, null, districtId);

        var settings = (await conn.QueryAsync<(int DistrictId, string Years, string? Message)>(
                "SELECT fk_district_id, milestone_years, governor_message FROM engagement_district_settings"))
            .ToDictionary(s => s.DistrictId);
        int[] YearsOf(int district) => settings.TryGetValue(district, out var s) ? ParseYears(s.Years) ?? Array.Empty<int>() : DefaultMilestones;
        var wanted = settings.Keys.SelectMany(YearsOf).Concat(DefaultMilestones).Distinct().ToArray();

        var milestones = 0;
        var governors = new Dictionary<int, string?>(); // District Governor per district, read once per pass
        var links = new Dictionary<int, string>();      // Foundation giving link per district, read once per pass
        foreach (var (tz, zone) in await ZoneTime.ZonesAsync(conn))
        {
            var local = ZoneTime.Local(zone);
            if (local.Hour < fromLocalHour) continue;
            // The consent filter for broadcast messages (privacy module) decides the email; the feed item is in-app.
            var candidates = await conn.QueryAsync<Candidate>($@"
                SELECT cm.fk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email,
                       cm.fk_club_id AS ClubId, c.ClubName, c.fk_district_id AS DistrictId, dm.DistrictNumber,
                       TIMESTAMPDIFF(YEAR, cm.JoinedDate, @Today) AS Years,
                       DATE_ADD(cm.JoinedDate, INTERVAL TIMESTAMPDIFF(YEAR, cm.JoinedDate, @Today) YEAR) AS OccurredOn,
                       CASE WHEN 1 = 1{PrivacyConsent.BroadcastFilter()} THEN 1 ELSE 0 END AS MayEmail
                FROM club_members cm
                {ActiveMembership}
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND cm.JoinedDate IS NOT NULL
                  AND TIMESTAMPDIFF(YEAR, cm.JoinedDate, @Today) IN @Wanted
                  AND DATE_ADD(cm.JoinedDate, INTERVAL TIMESTAMPDIFF(YEAR, cm.JoinedDate, @Today) YEAR) >= @Today - INTERVAL {CatchUpDays - 1} DAY
                  AND (@District IS NULL OR c.fk_district_id = @District) AND {ZoneTime.Filter("dm")}",
                new { Wanted = wanted, District = districtId, Today = local.Date, Tz = tz });

            foreach (var c in candidates)
            {
                if (ct.IsCancellationRequested) break;
                if (!YearsOf(c.DistrictId).Contains(c.Years)) continue;
                var inserted = await conn.ExecuteAsync(@"
                    INSERT IGNORE INTO engagement_events
                        (event_type, dedupe_key, fk_member_master_profile_id, fk_club_id, fk_district_id, level, occurred_on)
                    VALUES ('MILESTONE', @Key, @MemberId, @ClubId, @DistrictId, @Years, @OccurredOn)",
                    new { Key = $"MILESTONE:{c.MemberId}:{c.Years}", c.MemberId, c.ClubId, c.DistrictId, c.Years, c.OccurredOn });
                if (inserted == 0) continue; // already recorded and sent
                milestones++;
                if (c.MayEmail && !string.IsNullOrWhiteSpace(c.Email))
                {
                    if (!links.TryGetValue(c.DistrictId, out var link))
                        links[c.DistrictId] = link = await CommsTemplates.FoundationLinkAsync(conn, c.DistrictId);
                    await SendMilestoneEmailAsync(conn, c, settings.TryGetValue(c.DistrictId, out var s) ? s.Message : null, governors, link);
                }
            }
        }
        if (milestones + highlights > 0) _log.LogInformation("Engagement pass: {Milestones} milestones, {Highlights} PHF highlights", milestones, highlights);
        return (milestones, highlights);
    }

    // shortcut: a failed email is not retried (the sent-log row already exists; email_log shows the failure).
    // foundationLink: the district's giving link ({foundation_link}); empty = no link.
    private async Task SendMilestoneEmailAsync(MySqlConnection conn, Candidate c, string? governorMessage, Dictionary<int, string?> governors,
        string foundationLink)
    {
        // S5: the fixed wording in the member's language (their own, else their club's). The district's Governor
        // message is sent as the district wrote it.
        using var culture = RotaryApi.Services.Localization.MessageCulture.Use(
            await RotaryApi.Services.Localization.MessageCulture.ForMemberAsync(conn, c.MemberId));
        var L = RotaryApi.Services.Localization.DbStringLocalizer.Instance;
        string label = c.Years == 1 ? L["1 year in Rotary"] : L["{0} years in Rotary", c.Years];
        static string Html(string s) => WebUtility.HtmlEncode(s).Replace("\r\n", "\n").Replace("\n", "<br/>");
        string text, signature = "", give = "";
        if (!string.IsNullOrWhiteSpace(governorMessage))
        {
            // Governor variant: the district's template, signed by this Rotary year's District Governor.
            text = governorMessage.Replace("{name}", c.MemberName).Replace("{years}", c.Years.ToString())
                .Replace("{club}", c.ClubName ?? "").Replace("{foundation_link}", foundationLink);
            if (!governors.TryGetValue(c.DistrictId, out var governor))
                governors[c.DistrictId] = governor = await CurrentGovernorAsync(conn, c.DistrictId);
            string role = L["District Governor, District {0}", c.DistrictNumber ?? ""];
            signature = $"<p>{(string.IsNullOrWhiteSpace(governor) ? "" : Html(governor) + "<br/>")}{Html(role)}</p>";
        }
        else
        {
            text = (c.Years == 1 ? L["Congratulations on 1 year of Rotary membership with {0}.", c.ClubName ?? ""]
                                 : L["Congratulations on {0} years of Rotary membership with {1}.", c.Years, c.ClubName ?? ""])
                 + " " + L["Thank you for your service to your club and your community."];
            // the district's template places {foundation_link} itself; the standard text adds a line when there is a link
            if (foundationLink.Length > 0)
                give = $"<p>{L["Celebrate with a gift to The Rotary Foundation: {0}", $"<a href=\"{Html(foundationLink)}\">{Html(foundationLink)}</a>"]}</p>";
        }
        var html = $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #17458F; margin-top: 0;'>{L["Congratulations on {0}", Html(label)]}</h2>
                        <p>{L["Dear {0},", Html(c.MemberName)]}</p>
                        <p>{Html(text)}</p>
                        {give}
                        {signature}
            {EmailService.EMAIL_FOOTER}";
        await _email.SendScopedEmailAsync(c.Email!, L["Congratulations on {0}", label], html, c.ClubId, c.DistrictId);
    }

    /// <summary>Name of this Rotary year's District Governor (member or not), or null when none is set.</summary>
    public static Task<string?> CurrentGovernorAsync(MySqlConnection conn, int districtId) =>
        conn.QueryFirstOrDefaultAsync<string?>($@"
            SELECT {DistrictGovernorSql.Name} FROM district_governors g
            {DistrictGovernorSql.JoinMember}
            JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id AND y.IsCurrent = 1 AND y.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.isdeleted = 0 LIMIT 1", new { D = districtId });
}

/// <summary>Runs the engagement pass every hour for the districts whose local time is 08:00 or later (the greetings
/// hour, in each district's zone). The sent-log makes every repeat on the same day send nothing.</summary>
public class EngagementBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<EngagementBackgroundService> _log;

    public EngagementBackgroundService(IServiceScopeFactory scopes, ILogger<EngagementBackgroundService> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<EngagementService>().RunAsync(null, ct, fromLocalHour: 8);
            }
            catch (Exception ex)
            {
                if (ct.IsCancellationRequested) break;
                _log.LogError(ex, "Engagement pass failed; retrying next hour");
            }
            try { await Task.Delay(TimeSpan.FromHours(1), ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
