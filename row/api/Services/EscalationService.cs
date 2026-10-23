using System.Globalization;
using System.Net;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Escalation ladder (build list B.1 #32, B.3, flag escalation). A club that fails one of its district's rules alerts
/// its club president; while it still fails, its Assistant Governor after the district's delay, then the District
/// Governor. Rules per district (escalation_rules): the target rule (club status on the N10 target dashboard is red,
/// or amber or red) and the meeting rule (a finished month with at least N meetings fewer than the N8 rule).
/// One escalation_alerts row per level sent (who, when, why, level). Its UNIQUE (club, rule, period, level) key is
/// claimed before anything goes out, so the daily pass never alerts twice. Channels: email and the in-app feed.
/// </summary>
public class EscalationService
{
    public const string FeatureKey = "escalation";
    public const int MaxDelayDays = 60;
    public const int MaxShortfall = 31;
    public static readonly string[] TargetStatuses = { "red", "amber" };
    public static readonly string[] RuleKeys = { "target", "meetings" };
    // A case that has not climbed for this long stops (longer than any delay).
    private const int OpenCaseDays = MaxDelayDays + 30;

    // Metrics that can carry a club target, with their names in alert texts.
    private static readonly (string Key, string Name)[] TargetMetrics =
    {
        ("growth", "membership growth"), ("newMembers", "new members"), ("dues", "District Dues paid"), ("foundation", "Foundation giving (USD)"),
    };

    private readonly string _cs;
    private readonly TargetDashboardService _targets;
    private readonly MeetingsService _meetings;
    private readonly IEmailService _email;
    private readonly ILogger<EscalationService> _log;

    public EscalationService(IConfiguration config, TargetDashboardService targets, MeetingsService meetings, IEmailService email,
        ILogger<EscalationService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _targets = targets;
        _meetings = meetings;
        _email = email;
        _log = log;
    }

    public sealed class Rules
    {
        public string? TargetStatus { get; set; }
        public int? MeetingShortfall { get; set; }
        public int AgDelayDays { get; set; } = 7;
        public int DgDelayDays { get; set; } = 7;
    }

    private sealed class DistrictRules
    {
        public int DistrictId { get; set; }
        public string? TargetStatus { get; set; }
        public int? MeetingShortfall { get; set; }
        public int AgDelayDays { get; set; }
        public int DgDelayDays { get; set; }
    }

    /// <summary>The form's error, or null. Both rules empty is valid: the district gets no alerts.</summary>
    public static string? Validate(Rules r)
    {
        if (r.TargetStatus != null && !TargetStatuses.Contains(r.TargetStatus)) return "The target rule must be red or amber.";
        if (r.MeetingShortfall is < 1 or > MaxShortfall) return $"Meetings missed must be a whole number from 1 to {MaxShortfall}.";
        if (r.AgDelayDays is < 1 or > MaxDelayDays || r.DgDelayDays is < 1 or > MaxDelayDays)
            return $"Delays must be whole days from 1 to {MaxDelayDays}.";
        return null;
    }

    /// <summary>The district's rules; defaults (both rules off) when it has none.</summary>
    public async Task<Rules> GetRulesAsync(int districtId)
    {
        await using var conn = new MySqlConnection(_cs);
        return await conn.QueryFirstOrDefaultAsync<Rules>(@"
            SELECT target_status AS TargetStatus, meeting_shortfall AS MeetingShortfall, ag_delay_days AS AgDelayDays,
                   dg_delay_days AS DgDelayDays
            FROM escalation_rules WHERE fk_district_id = @D", new { D = districtId }) ?? new Rules();
    }

    public async Task SaveRulesAsync(int districtId, Rules r, int by)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.ExecuteAsync(@"
            INSERT INTO escalation_rules (fk_district_id, target_status, meeting_shortfall, ag_delay_days, dg_delay_days, modified_by)
            VALUES (@D, @TargetStatus, @MeetingShortfall, @AgDelayDays, @DgDelayDays, @By)
            ON DUPLICATE KEY UPDATE target_status = VALUES(target_status), meeting_shortfall = VALUES(meeting_shortfall),
                ag_delay_days = VALUES(ag_delay_days), dg_delay_days = VALUES(dg_delay_days), modified_by = VALUES(modified_by)",
            new { D = districtId, r.TargetStatus, r.MeetingShortfall, r.AgDelayDays, r.DgDelayDays, By = by });
    }

    /// <summary>"Rotary Club of X is behind its targets": the email subject and the app feed title.</summary>
    public static string Headline(string? clubName, string? rule)
        => $"{clubName ?? "A club"} {(rule == "meetings" ? "held fewer meetings than the district's rule" : "is behind its targets")}";

    public static string RoleName(int level) => level switch { 1 => "Club president", 2 => "Assistant Governor", _ => "District Governor" };

    private sealed class OpenCase
    {
        public int ClubId { get; set; }
        public string Rule { get; set; } = "";
        public string Period { get; set; } = "";
        public int Level { get; set; }
        public DateTime LastSent { get; set; }
        public int DaysSince { get; set; }
    }

    private sealed class Person
    {
        public int? MemberId { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
    }

    /// <summary>
    /// The daily pass for every district with a rule, or for one district (the SuperAdmin "run now"). First the open
    /// cases climb a level where the delay has passed and the club still fails; then new failures open at level 1.
    /// Returns the number of alerts written.
    /// </summary>
    public async Task<int> RunAsync(int? districtId, CancellationToken ct = default)
    {
        var on = await FeatureGate.OnAsync(_cs);
        if (!on.Contains(FeatureKey)) return 0;
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync(ct);
        var districts = await conn.QueryAsync<DistrictRules>(@"
            SELECT r.fk_district_id AS DistrictId, r.target_status AS TargetStatus, r.meeting_shortfall AS MeetingShortfall,
                   r.ag_delay_days AS AgDelayDays, r.dg_delay_days AS DgDelayDays
            FROM escalation_rules r
            JOIN district_master d ON d.pk_district_id = r.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
            WHERE (r.target_status IS NOT NULL OR r.meeting_shortfall IS NOT NULL) AND (@D IS NULL OR r.fk_district_id = @D)",
            new { D = districtId });
        var written = 0;
        foreach (var r in districts)
        {
            if (ct.IsCancellationRequested) break;
            // The target rule reads the N10 dashboard and the meeting rule the N8 compliance: each needs its module on.
            written += await RunDistrictAsync(conn, r,
                r.TargetStatus != null && on.Contains("target_dashboard"),
                r.MeetingShortfall != null && on.Contains(MeetingsService.FeatureKey),
                on.Contains(CommsService.FeatureKey));
        }
        if (written > 0) _log.LogInformation("Escalation pass: {Count} alerts written", written);
        return written;
    }

    private async Task<int> RunDistrictAsync(MySqlConnection conn, DistrictRules r, bool targetRule, bool meetingRule, bool comms)
    {
        if (!targetRule && !meetingRule) return 0;
        var now = DateTime.Now;
        var thisMonth = Period(now);
        var lastMonth = Period(now.AddMonths(-1));
        var open = (await conn.QueryAsync<OpenCase>($@"
            SELECT fk_club_id AS ClubId, rule_key AS Rule, period AS Period, MAX(level) AS Level, MAX(created_date) AS LastSent,
                   DATEDIFF(NOW(), MAX(created_date)) AS DaysSince
            FROM escalation_alerts WHERE fk_district_id = @D
            GROUP BY fk_club_id, rule_key, period
            HAVING MAX(level) < 3 AND MAX(created_date) >= NOW() - INTERVAL {OpenCaseDays} DAY",
            new { D = r.DistrictId })).ToList();

        // What fails today: the target rule per club (its status now), the meeting rule per club and finished month.
        var names = new Dictionary<int, string>();
        var behind = new Dictionary<int, string>();
        var missed = new Dictionary<(int Club, string Period), string>();
        if (targetRule && await _targets.GetDistrictForJobAsync(r.DistrictId) is { } dash)
            foreach (var c in dash.Clubs.Where(c => c.Status == "red" || (r.TargetStatus == "amber" && c.Status == "amber")))
            {
                names[c.ClubId] = c.ClubName;
                behind[c.ClubId] = TargetReason(c, r.TargetStatus!, dash.YearElapsedPercent);
            }
        if (meetingRule)
            foreach (var period in open.Where(o => o.Rule == "meetings").Select(o => o.Period).Append(lastMonth).Distinct())
            {
                var month = DateTime.ParseExact(period, "yyyy-MM", CultureInfo.InvariantCulture);
                foreach (var c in (await _meetings.GetComplianceAsync(r.DistrictId, null, month))?.Clubs ?? new())
                    if (c.Status == "missed" && c.Required - c.Held >= r.MeetingShortfall)
                    {
                        names[c.ClubId] = c.ClubName;
                        missed[(c.ClubId, period)] = $"{c.Held} of {c.Required} required meetings held in {MonthName(month)}.";
                    }
            }

        // Cases already open for these periods: skipped before their recipients are looked up (the claim still guards).
        var opened = open.Select(o => (o.ClubId, o.Rule, o.Period)).ToHashSet();
        opened.UnionWith(await conn.QueryAsync<(int, string, string)>(@"
            SELECT fk_club_id, rule_key, period FROM escalation_alerts
            WHERE fk_district_id = @D AND level = 3 AND ((rule_key = 'target' AND period = @T) OR (rule_key = 'meetings' AND period = @L))",
            new { D = r.DistrictId, T = thisMonth, L = lastMonth }));

        var written = 0;
        // Climb: the delay counts in calendar days from the last level, so a daily run at any hour keeps the timing.
        foreach (var o in open)
        {
            var delay = o.Level == 1 ? r.AgDelayDays : r.DgDelayDays;
            var reason = o.Rule == "target" ? (targetRule ? behind.GetValueOrDefault(o.ClubId) : null)
                       : meetingRule ? missed.GetValueOrDefault((o.ClubId, o.Period)) : null;
            if (o.DaysSince < delay || reason == null) continue; // not due yet, or the club caught up
            if (await AlertAsync(conn, r.DistrictId, o.ClubId, names[o.ClubId], o.Rule, o.Period, o.Level + 1, reason, o.LastSent, comms)) written++;
        }
        // Open: this month's target failures and last month's meeting failures start at the club president.
        foreach (var (club, reason) in behind.Where(b => !opened.Contains((b.Key, "target", thisMonth))))
            if (await AlertAsync(conn, r.DistrictId, club, names[club], "target", thisMonth, 1, reason, null, comms)) written++;
        foreach (var ((club, period), reason) in missed.Where(m => m.Key.Period == lastMonth && !opened.Contains((m.Key.Club, "meetings", lastMonth))))
            if (await AlertAsync(conn, r.DistrictId, club, names[club], "meetings", period, 1, reason, null, comms)) written++;
        return written;
    }

    /// <summary>Writes the alert row (the claim) and, when it is new, emails the recipient. False when this level was
    /// already sent for the rule, club and period.</summary>
    private async Task<bool> AlertAsync(MySqlConnection conn, int districtId, int clubId, string clubName, string rule,
        string period, int level, string reason, DateTime? previous, bool comms)
    {
        var to = await RecipientAsync(conn, districtId, clubId, level);
        var status = to == null ? "no_recipient"
            : string.IsNullOrWhiteSpace(to.Email) ? "no_email"
            : comms && await OptedOutAsync(conn, to, districtId) ? "opted_out"
            : "sent";
        var claimed = await conn.ExecuteAsync(@"
            INSERT IGNORE INTO escalation_alerts
                (fk_district_id, fk_club_id, rule_key, period, level, fk_member_id, recipient_name, reason, email_status)
            VALUES (@districtId, @clubId, @rule, @period, @level, @MemberId, @Name, @reason, @status)",
            new { districtId, clubId, rule, period, level, MemberId = to?.MemberId, Name = to?.Name, reason, status });
        if (claimed == 0) return false;
        // shortcut: a failed email is not retried (the alert row is the claim; email_log shows the failure).
        if (status == "sent")
        {
            var (subject, html) = Email(clubName, rule, level, reason, to!.Name, previous);
            await _email.SendScopedEmailAsync(to.Email!, subject, html, clubId, districtId);
        }
        return true;
    }

    // Holders for the current Rotary year: club president (board of directors), the club's Assistant Governor
    // (district_ag), the District Governor (district_governors, a member or not).
    private static Task<Person?> RecipientAsync(MySqlConnection conn, int districtId, int clubId, int level) => level switch
    {
        1 => conn.QueryFirstOrDefaultAsync<Person?>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name, m.EmailId AS Email
            FROM board_of_directors b
            JOIN designation_master dd ON dd.pk_designation_id = b.fk_designation_id AND dd.designation_name = 'Club President'
            JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1 AND y.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE b.fk_club_id = @C AND b.isdeleted = 0
            ORDER BY b.pk_board_director_id DESC LIMIT 1", new { C = clubId }),
        2 => conn.QueryFirstOrDefaultAsync<Person?>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name, m.EmailId AS Email
            FROM district_ag a
            JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id AND y.IsCurrent = 1 AND y.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
            WHERE a.fk_club_id = @C AND a.is_active = 1 AND a.isdeleted = 0
            ORDER BY a.id DESC LIMIT 1", new { C = clubId }),
        _ => conn.QueryFirstOrDefaultAsync<Person?>($@"
            SELECT m.pk_member_master_profile_id AS MemberId, {DistrictGovernorSql.Name} AS Name, {DistrictGovernorSql.Email} AS Email
            FROM district_governors g
            {DistrictGovernorSql.JoinMember}
            JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id AND y.IsCurrent = 1 AND y.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.isdeleted = 0
            ORDER BY g.pk_id DESC LIMIT 1", new { D = districtId }),
    };

    // With N5 on, an address that unsubscribed or bounced for the district (or the platform) gets the app item only.
    private static async Task<bool> OptedOutAsync(MySqlConnection conn, Person to, int districtId)
        => await conn.ExecuteScalarAsync<int>(
            $"SELECT CASE WHEN {CommsTemplates.EmailBlockedSql("@M", "@E", "0", "@D")} THEN 1 ELSE 0 END",
            new { M = to.MemberId ?? 0, E = to.Email, D = districtId }) == 1;

    private static string TargetReason(TargetClubRowDto c, string threshold, int elapsedPercent)
    {
        var parts = TargetMetrics
            .Where(t => c.Metrics.TryGetValue(t.Key, out var m) && (m.Status == "red" || (threshold == "amber" && m.Status == "amber")))
            .Select(t => $"{t.Name} {Num(c.Metrics[t.Key].Actual)} of {Num(c.Metrics[t.Key].Target ?? 0)} ({c.Metrics[t.Key].Percent ?? 0}%)");
        var text = $"Behind target: {string.Join(", ", parts)}. {elapsedPercent}% of the Rotary year has passed.";
        return text.Length <= 500 ? text : text[..497] + "...";
    }

    private static string Num(decimal d) => d.ToString("#,0.##", CultureInfo.InvariantCulture);
    private static string Period(DateTime d) => d.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    private static string MonthName(DateTime d) => d.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

    // English, ROW's default language. shortcut: no per-language template yet; move it to an N5 template key
    // ("escalation") when districts ask for alerts in their language.
    internal static (string Subject, string Html) Email(string clubName, string rule, int level, string reason, string? name, DateTime? previous)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var since = previous?.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var why = level switch
        {
            1 => "You receive this as the club president.",
            2 => $"You receive this as the club's Assistant Governor: the club president was alerted on {since} and the club has not caught up.",
            _ => $"You receive this as District Governor: the club president and then the Assistant Governor (on {since}) were alerted and the club has not caught up.",
        };
        var subject = Headline(clubName, rule).Replace("\r", " ").Replace("\n", " ");
        var html = EmailService.EMAIL_HEADER + $@"
                        <p>Dear {E(string.IsNullOrWhiteSpace(name) ? RoleName(level) : name)},</p>
                        <p><strong>{E(subject)}</strong>.</p>
                        <p>{E(reason)}</p>
                        <p style='color:#555;'>{E(why)}</p>" + EmailService.EMAIL_FOOTER;
        return (subject, html);
    }
}

/// <summary>Runs the escalation and the target celebration passes once a day from 08:00 in the brand's time zone. Hourly
/// ticks only check the clock; the claim rows make a repeat run after a restart send nothing.</summary>
public class TargetAlertsBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<TargetAlertsBackgroundService> _log;

    public TargetAlertsBackgroundService(IServiceScopeFactory scopes, ILogger<TargetAlertsBackgroundService> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        DateOnly? escalated = null, celebrated = null;
        while (!ct.IsCancellationRequested)
        {
            var local = TimeZoneInfo.ConvertTime(DateTime.UtcNow, Brand.TimeZone);
            var today = DateOnly.FromDateTime(local);
            if (local.Hour >= 8 && (escalated != today || celebrated != today))
            {
                using var scope = _scopes.CreateScope();
                // Each pass on its own: a failing one retries next hour and never stops the other.
                try
                {
                    if (escalated != today) await scope.ServiceProvider.GetRequiredService<EscalationService>().RunAsync(null, ct);
                    escalated = today;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested) { _log.LogError(ex, "Escalation pass failed; retrying next hour"); }
                try
                {
                    if (celebrated != today) await scope.ServiceProvider.GetRequiredService<CelebrationService>().RunAsync(null, ct);
                    celebrated = today;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested) { _log.LogError(ex, "Celebration pass failed; retrying next hour"); }
            }
            try { await Task.Delay(TimeSpan.FromHours(1), ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
