using System.Globalization;
using System.Net;
using Dapper;
using Microsoft.Extensions.Localization;
using MySqlConnector;
using RotaryApi.Services.Localization;

namespace RotaryApi.Services;

/// <summary>
/// Subscription renewal reminders (build spec 3.5). Each district tenant's admins get one notice 60 days before
/// term_end (that it renews, or ends when auto-renew is off), and up to three reminders 7, 14 and 30 days after a
/// term_end that has not been moved on (dunning). Renewing (a new term_end in Settings > Tenants) starts over.
/// shortcut: email only, no charge; collecting the renewal comes with Stripe.
/// </summary>
public class TenantRenewalService
{
    private static readonly int[] DunningDays = { 7, 14, 30 };
    private readonly string _cs;
    private readonly IEmailService _email;
    private readonly ILogger<TenantRenewalService> _log;

    public TenantRenewalService(IConfiguration config, IEmailService email, ILogger<TenantRenewalService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _log = log;
    }

    private sealed class Due
    {
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public DateTime TermEnd { get; set; }
        public bool AutoRenew { get; set; }
        public int Stage { get; set; }
        public DateTime? DunningFor { get; set; }
    }

    public async Task<List<string>> RunAsync()
    {
        var done = new List<string>();
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var notices = (await conn.QueryAsync<Due>(@"
            SELECT t.fk_district_id AS DistrictId, d.DistrictNumber, t.term_end AS TermEnd, t.auto_renew = 1 AS AutoRenew,
                   t.dunning_stage AS Stage, t.dunning_for AS DunningFor
            FROM tenant_subscriptions t JOIN district_master d ON d.pk_district_id = t.fk_district_id AND d.isdeleted = 0
            WHERE t.fk_club_id = 0 AND t.term_end BETWEEN CURDATE() AND CURDATE() + INTERVAL 60 DAY
              AND (t.renewal_notice_for IS NULL OR t.renewal_notice_for <> t.term_end)")).ToList();
        foreach (var t in notices)
        {
            var sent = await SendAsync(conn, t.DistrictId, L =>
            {
                var when = $"<strong>{t.TermEnd.ToString("d MMMM yyyy", CultureInfo.CurrentCulture)}</strong>";
                var body = t.AutoRenew
                    ? $"<p>{L["The ROW subscription of District {0} renews on {1}.", Esc(t.DistrictNumber), when]}</p>" +
                      $"<p>{L["Nothing is needed to keep it running. To change or stop the renewal, contact ROW before that date."]}</p>"
                    : $"<p>{L["The ROW subscription of District {0} ends on {1} and is not set to renew.", Esc(t.DistrictNumber), when]}</p>" +
                      $"<p>{L["To keep using ROW after that date, contact ROW to renew. Your data is kept either way."]}</p>";
                return (L["ROW subscription: District {0} on {1}", t.DistrictNumber ?? "", t.TermEnd.ToString("d MMMM yyyy", CultureInfo.CurrentCulture)], body);
            });
            await conn.ExecuteAsync("UPDATE tenant_subscriptions SET renewal_notice_for = term_end WHERE fk_district_id = @DistrictId AND fk_club_id = 0", new { t.DistrictId });
            done.Add($"notice district {t.DistrictNumber}: {sent} sent");
        }

        var overdue = (await conn.QueryAsync<Due>(@"
            SELECT t.fk_district_id AS DistrictId, d.DistrictNumber, t.term_end AS TermEnd, t.auto_renew = 1 AS AutoRenew,
                   t.dunning_stage AS Stage, t.dunning_for AS DunningFor
            FROM tenant_subscriptions t JOIN district_master d ON d.pk_district_id = t.fk_district_id AND d.isdeleted = 0
            WHERE t.fk_club_id = 0 AND t.term_end < CURDATE() - INTERVAL 6 DAY")).ToList();
        foreach (var t in overdue)
        {
            var stage = t.DunningFor == t.TermEnd ? t.Stage : 0; // a renewed term starts over
            var daysLate = (DateTime.Today - t.TermEnd.Date).Days;
            var due = DunningDays.Count(d => daysLate >= d);
            if (due <= stage) continue;
            var sent = await SendAsync(conn, t.DistrictId, L =>
            {
                var when = $"<strong>{t.TermEnd.ToString("d MMMM yyyy", CultureInfo.CurrentCulture)}</strong>";
                var body = $"<p>{L["The ROW subscription of District {0} ended on {1} and has not been renewed.", Esc(t.DistrictNumber), when]}</p>" +
                           $"<p>{L["Contact ROW to renew. Your data is kept."]}</p>" +
                           $"<p style='color:#64748b;font-size:12px'>{L["Reminder {0} of {1}.", due, DunningDays.Length]}</p>";
                return (L["Renewal overdue: ROW subscription of District {0}", t.DistrictNumber ?? ""], body);
            });
            await conn.ExecuteAsync(@"UPDATE tenant_subscriptions SET dunning_stage = @due, dunning_for = term_end
                WHERE fk_district_id = @DistrictId AND fk_club_id = 0", new { due, t.DistrictId });
            done.Add($"reminder {due} district {t.DistrictNumber}: {sent} sent");
        }
        return done;
    }

    /// <summary>
    /// To the district's admins (district-level Admin role) with an email; returns how many went out. <paramref name="text"/>
    /// builds the subject and body in each admin's language (S5).
    /// </summary>
    private async Task<int> SendAsync(MySqlConnection conn, int districtId, Func<IStringLocalizer, (string Subject, string Html)> text)
    {
        var to = (await conn.QueryAsync<string>(@"
            SELECT DISTINCT m.EmailId FROM member_roles mr
            JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE mr.fk_role_id = 2 AND mr.fk_district_id = @districtId AND IFNULL(mr.fk_club_id, 0) = 0
              AND mr.IsActive = 1 AND mr.isdeleted = 0 AND IFNULL(m.EmailId, '') <> ''", new { districtId })).ToList();
        var sent = 0;
        foreach (var address in to)
        {
            try
            {
                string subject, html;
                using (MessageCulture.Use(await MessageCulture.ForEmailAsync(conn, address)))
                    (subject, html) = text(DbStringLocalizer.Instance);
                await _email.SendScopedEmailAsync(address, subject, html, null, districtId);
                sent++;
            }
            catch (Exception ex) { _log.LogWarning(ex, "renewal email for district {District} failed", districtId); }
        }
        return sent;
    }

    private static string Esc(string? s) => WebUtility.HtmlEncode(s ?? "");
}

/// <summary>Runs the renewal reminders once a day, behind BackgroundJobs:Enabled.</summary>
public class TenantRenewalBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<TenantRenewalBackgroundService> _log;

    public TenantRenewalBackgroundService(IServiceScopeFactory scopes, IConfiguration config, ILogger<TenantRenewalBackgroundService> log)
    {
        _scopes = scopes;
        _config = config;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("BackgroundJobs:Enabled", true)) return;
        try { await Task.Delay(TimeSpan.FromMinutes(15), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope(); // IEmailService is scoped
                var done = await scope.ServiceProvider.GetRequiredService<TenantRenewalService>().RunAsync();
                if (done.Count > 0) _log.LogInformation("renewal reminders: {Done}", string.Join("; ", done));
            }
            catch (Exception ex) { _log.LogError(ex, "renewal reminders failed"); }
            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }
}
