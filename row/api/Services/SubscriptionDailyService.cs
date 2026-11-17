using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// The daily pass for District and Club subscriptions (KIS/ROW/SUB/01).
/// Section 4.5 step 1: renewal reminders to the buyer 30, 7 and 1 days before the term ends.
/// Section 4.6 steps 1 and 3: re-reads the officers of every club that has access, invites executives who are new
/// on record with RI, and ends the edit rights of people who no longer hold an office.
/// </summary>
public sealed class SubscriptionDailyService
{
    public static readonly int[] ReminderDays = { 30, 7, 1 };

    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly IEmailService _email;
    private readonly SubscriptionOfficers _officers;
    private readonly ExecutiveSignInService _signIn;
    private readonly ILogger<SubscriptionDailyService> _log;

    public SubscriptionDailyService(IConfiguration config, IEmailService email, SubscriptionOfficers officers,
        ExecutiveSignInService signIn, ILogger<SubscriptionDailyService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _email = email;
        _officers = officers;
        _signIn = signIn;
        _log = log;
    }

    public async Task<List<string>> RunAsync(CancellationToken ct = default)
    {
        var done = new List<string>();
        await using var conn = RowDb.Connect(_cs);
        await conn.OpenAsync(ct);
        done.Add($"reminders sent: {await SendRemindersAsync(conn)}");
        var (clubs, invited, ended) = await SyncOfficersAsync(conn, ct);
        done.Add($"officer sync: {clubs} clubs, {invited} invited, {ended} roles ended");
        return done;
    }

    private sealed class Due
    {
        public int Id { get; set; }
        public int DistrictId { get; set; }
        public int ClubId { get; set; }
        public DateTime TermEnd { get; set; }
        public int Days { get; set; }
        public string? Email { get; set; }
        public string? BuyerName { get; set; }
        public string Scope { get; set; } = "";
    }

    /// <summary>One email per subscription per day, to the person who paid last. Subscriptions nobody bought are skipped.</summary>
    private async Task<int> SendRemindersAsync(MySqlConnection conn)
    {
        var due = (await conn.QueryAsync<Due>(@"
            SELECT t.pk_subscription_id AS Id, t.fk_district_id AS DistrictId, t.fk_club_id AS ClubId, t.term_end AS TermEnd,
                   DATEDIFF(t.term_end, UTC_DATE()) AS Days, m.EmailId AS Email, m.MemberName AS BuyerName,
                   IF(t.fk_club_id > 0, c.ClubName, CONCAT('District ', d.DistrictNumber)) AS Scope
            FROM tenant_subscriptions t
            JOIN district_master d ON d.pk_district_id = t.fk_district_id
            LEFT JOIN club_master c ON c.pk_club_id = t.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = (
                 SELECT o.fk_buyer_member_id FROM subscription_orders o
                 WHERE o.fk_district_id = t.fk_district_id AND o.fk_club_id = t.fk_club_id AND o.status = 'paid'
                 ORDER BY o.paid_date DESC LIMIT 1)
            WHERE t.state = 'live' AND DATEDIFF(t.term_end, UTC_DATE()) IN @ReminderDays
              AND (t.renewal_notice_for IS NULL OR t.renewal_notice_for <> UTC_DATE())", new { ReminderDays })).ToList();
        var sent = 0;
        foreach (var t in due)
        {
            if (!string.IsNullOrWhiteSpace(t.Email))
            {
                var kind = t.ClubId > 0 ? "Club" : "District";
                var days = $"{t.Days} day{(t.Days == 1 ? "" : "s")}";
                var page = $"{(_config["FrontendUrl"] ?? "").TrimEnd('/')}/{(t.ClubId > 0 ? "club" : "district")}-admin-dashboard/subscription";
                var body = $@"<p>Hello {WebUtility.HtmlEncode(t.BuyerName ?? "")},</p>
<p>The {kind} subscription of {WebUtility.HtmlEncode(t.Scope)} ends on <strong>{t.TermEnd:d MMMM yyyy}</strong>, in {days}.</p>
<p>Renewing adds one year to the end of the current term. <a href=""{page}"">Renew now</a></p>";
                try
                {
                    await _email.SendScopedEmailAsync(t.Email!, $"{kind} subscription of {t.Scope} ends in {days}", body,
                        t.ClubId > 0 ? t.ClubId : null, t.ClubId > 0 ? null : t.DistrictId);
                    sent++;
                }
                catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException)
                {
                    _log.LogWarning(ex, "Renewal reminder for subscription {Id} failed", t.Id);
                    continue; // not marked, so a second pass on the same day tries again
                }
            }
            await conn.ExecuteAsync("UPDATE tenant_subscriptions SET renewal_notice_for = UTC_DATE() WHERE pk_subscription_id = @Id", new { t.Id });
        }
        return sent;
    }

    /// <summary>Clubs that have access today: their own subscription works, or their district's does.</summary>
    private static Task<IEnumerable<int>> ClubsWithAccessAsync(MySqlConnection conn) => conn.QueryAsync<int>($@"
        SELECT c.pk_club_id FROM club_master c
        WHERE c.isdeleted = 0 AND c.IsActive = 1 AND EXISTS (
            SELECT 1 FROM tenant_subscriptions t
            WHERE t.state = 'live' AND t.term_end >= UTC_DATE() - INTERVAL {SubscriptionAccess.GraceDays} DAY
              AND (t.fk_club_id = c.pk_club_id OR (t.fk_district_id = c.fk_district_id AND t.fk_club_id = 0)))");

    private async Task<(int Clubs, int Invited, int Ended)> SyncOfficersAsync(MySqlConnection conn, CancellationToken ct)
    {
        int clubs = 0, invited = 0, ended = 0;
        foreach (var clubId in (await ClubsWithAccessAsync(conn)).ToList())
        {
            if (ct.IsCancellationRequested) break;
            var before = (await SubscriptionOfficers.GetExecutivesAsync(conn, clubId)).Select(e => e.RiMemberId).ToHashSet();
            var result = await _officers.SyncClubAsync(conn, clubId, ct);
            clubs++;
            // RI unreachable or the club not synced: nothing is known, so nobody is invited and nobody loses rights.
            if (result.Status is not ("ok" or "no_officers")) continue;

            var after = await SubscriptionOfficers.GetExecutivesAsync(conn, clubId);
            var added = after.Where(e => !before.Contains(e.RiMemberId)).Select(e => e.RiMemberId).ToHashSet();
            if (added.Count > 0) invited += (await _signIn.InviteAsync(conn, new[] { clubId }, added)).Invited;

            // 4.6 step 3: the old officer loses edit rights. Only the role the office gave (via_subscription) ends;
            // a role an executive of a Full club gave by hand stays. Outgoing officers keep read access as members.
            var still = after.Where(e => e.MemberId != null).Select(e => e.MemberId!.Value).Append(0).ToArray();
            ended += await conn.ExecuteAsync(@"
                UPDATE member_roles SET IsActive = 0
                WHERE fk_club_id = @clubId AND fk_role_id = 2 AND via_subscription = 1 AND IsActive = 1 AND isdeleted = 0
                  AND fk_member_master_profile_id NOT IN @still", new { clubId, still });
        }
        return (clubs, invited, ended);
    }
}

/// <summary>Runs the subscription pass once a day, behind BackgroundJobs:Enabled.</summary>
public class SubscriptionDailyBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<SubscriptionDailyBackgroundService> _log;

    public SubscriptionDailyBackgroundService(IServiceScopeFactory scopes, ILogger<SubscriptionDailyBackgroundService> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(20), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope(); // IEmailService is scoped
                var done = await scope.ServiceProvider.GetRequiredService<SubscriptionDailyService>().RunAsync(stoppingToken);
                _log.LogInformation("subscription daily pass: {Done}", string.Join("; ", done));
            }
            catch (Exception ex) { _log.LogError(ex, "subscription daily pass failed"); }
            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }
}
