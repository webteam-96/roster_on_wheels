using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Phase 8: club-website expiry reminders.
//
// Trial sites (no AmountPaid / no TransactionId):
//   - 3 days before EndDate
//   - 1 day before EndDate
//   (Day-1 welcome is sent by ClubWebsitesController at activation time, not by this service.)
//
// Paid sites:
//   - 30, 15, 7, and 1 days before EndDate
//
// Once a site has expired (EndDate < today) no more reminders are sent — per spec.
//
// Idempotency: each milestone is logged in club_website_logs with a unique marker
// ("Milestone:T-3", "Milestone:P-15", etc.) so a process restart or a 6-hour-cycle
// re-run on the same day doesn't double-send.

public class ClubWebsiteReminderBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ClubWebsiteReminderBackgroundService> _logger;
    private readonly IConfiguration _config;
    private readonly string _connectionString;

    // Days-before-EndDate that trigger a reminder, split by site kind.
    private static readonly int[] TrialMilestones = new[] { 3, 1 };
    private static readonly int[] PaidMilestones  = new[] { 30, 15, 7, 1 };

    public ClubWebsiteReminderBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<ClubWebsiteReminderBackgroundService> logger,
        IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _config = configuration;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ClubWebsiteReminder background service started.");
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunDailyAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in ClubWebsiteReminder background service.");
            }
            // 6-hour cycle is well within idempotency guarantees — milestone marker
            // in the log table dedupes within a 2-day window.
            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }

    private async Task RunDailyAsync(CancellationToken ct)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        // 1. Auto-expire any Active site past its EndDate (independent of email logic).
        // EXISTS guard against orphaned fk_club_id rows — production has at least
        // one such row (club deleted but website kept), and MySQL was refusing the
        // UPDATE with a FK-violation on club_websites_ibfk_1 even though the
        // UPDATE doesn't touch fk_club_id. Skipping orphans here AND in the
        // reminder SELECT below stops the background service from crashing.
        var expired = await conn.QueryAsync<int>(@"
            SELECT pk_id FROM club_websites w
            WHERE Status = 'Active' AND EndDate < CURDATE() AND isdeleted = 0
              AND EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = w.fk_club_id)");
        foreach (var id in expired)
        {
            try
            {
                await conn.ExecuteAsync(
                    "UPDATE club_websites SET Status = 'Expired' WHERE pk_id = @Id", new { Id = id });
                await conn.ExecuteAsync(@"
                    INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
                    VALUES (@Id, 'AutoExpired', 'End date passed — status auto-updated', 0)",
                    new { Id = id });
            }
            catch (MySqlConnector.MySqlException ex) when (ex.Message.Contains("foreign key", StringComparison.OrdinalIgnoreCase))
            {
                // Defensive: if the EXISTS guard missed an edge case (e.g. parent
                // deleted between SELECT and UPDATE), skip this row instead of
                // killing the whole tick.
                _logger.LogWarning(ex, "Skipped expiry for club_website id={Id} due to orphaned fk_club_id.", id);
            }
        }

        // 2. Reminder candidates — Active sites that hit any milestone today.
        //    Trial vs paid is inferred from AmountPaid + TransactionId; chain-active
        //    is enforced so kill-switched clubs stop getting nags.
        var candidates = (await conn.QueryAsync<dynamic>(@"
            SELECT w.pk_id        AS id,
                   w.fk_club_id   AS clubId,
                   c.ClubName     AS clubName,
                   w.Subdomain    AS subdomain,
                   w.ClientDomain AS clientDomain,
                   w.EndDate      AS endDate,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
                   w.AmountPaid   AS amountPaid,
                   w.TransactionId AS transactionId,
                   w.ReminderDays AS reminderDays
            FROM club_websites w
            JOIN club_master c    ON c.pk_club_id      = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z    ON z.pk_zone_id      = d.fk_zone_id
            WHERE w.Status = 'Active' AND w.isdeleted = 0
              AND DATEDIFF(w.EndDate, CURDATE()) >= 0
              AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1")).ToList();

        if (candidates.Count == 0) return;

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        if (!currentYearId.HasValue)
        {
            _logger.LogWarning("No current rotary year set — skipping website reminders.");
            return;
        }

        using var scope = _serviceProvider.CreateScope();
        var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();
        var interakt = scope.ServiceProvider.GetRequiredService<IInteraktService>();
        var waTemplate = _config["Interakt:ClubWebsiteReminderTemplate"];
        var parentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain' LIMIT 1")
            ?? (_config.GetSection("PleskSettings")["ParentDomain"] ?? RotaryApi.Services.Brand.ClubSiteParentDomain);

        foreach (var w in candidates)
        {
            if (ct.IsCancellationRequested) break;

            int daysLeft = (int)(w.daysLeft ?? 0);
            bool isPaid = ((decimal?)w.amountPaid ?? 0m) > 0m
                          || !string.IsNullOrWhiteSpace((string?)w.transactionId);

            // Pick the milestone (if any) that exactly matches today's daysLeft.
            // Trial sites use a tighter cadence per spec (welcome handled at activation).
            int[] milestones = isPaid ? PaidMilestones : TrialMilestones;
            // Also honor the club's chosen reminder lead time (set at purchase) on top of the fixed
            // safety milestones. A distinct value gets its own idempotency marker (daysLeft) below.
            int? customRem = w.reminderDays == null ? (int?)null : (int)w.reminderDays;
            if (customRem is > 0 && !milestones.Contains(customRem.Value))
                milestones = milestones.Append(customRem.Value).ToArray();
            if (!milestones.Contains(daysLeft)) continue;

            string marker = $"Milestone:{(isPaid ? "P" : "T")}-{daysLeft}";

            // Idempotency: skip if we've already logged this exact milestone
            // for this site within the last 2 days.
            var already = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_website_logs
                WHERE fk_website_id = @Id
                  AND Action = 'ReminderSent'
                  AND Details LIKE @Pattern
                  AND PerformedDate > DATE_SUB(NOW(), INTERVAL 2 DAY)",
                new { Id = (int)w.id, Pattern = $"%{marker}%" });
            if (already > 0) continue;

            var leaders = (await conn.QueryAsync<dynamic>(@"
                SELECT m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                       d.designation_name AS designation
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                JOIN designation_master d   ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                  AND d.designation_name IN ('Club President', 'Club Secretary', 'Club Treasurer')
                  AND ((m.EmailId IS NOT NULL AND m.EmailId <> '') OR (m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''))",
                new { ClubId = (int)w.clubId, YearId = currentYearId.Value })).ToList();

            // One-click renewal link (encrypted; server re-resolves price/gateway at pay time).
            var frontend = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
            var payLink = $"{frontend}/pay/club-website/{WebsitePayLinkToken.Generate(_config, (int)w.clubId, currentYearId.Value)}";
            string subdomain = (string?)w.subdomain ?? "";
            string clientDomain = (string?)w.clientDomain ?? "";
            string websiteUrl = !string.IsNullOrWhiteSpace(clientDomain) ? clientDomain
                : (!string.IsNullOrWhiteSpace(subdomain) ? $"{subdomain}.{parentDomain}" : (string)w.clubName);
            string dueDate = ((DateTime)w.endDate).ToString("dd MMM yyyy");

            int sent = 0, failed = 0;
            foreach (var l in leaders)
            {
                string? lemail = (string?)l.email;
                string? lmobile = (string?)l.mobile;
                string lname = (string?)l.memberName ?? "";
                string ldesig = (string?)l.designation ?? "";
                if (!string.IsNullOrWhiteSpace(lemail))
                {
                    try
                    {
                        await emailService.SendClubWebsiteReminderEmailAsync(
                            lemail!, lname, (string)w.clubName, ldesig, subdomain,
                            (DateTime)w.endDate, daysLeft, payLink);
                        sent++;
                    }
                    catch (Exception ex) { failed++; _logger.LogError(ex, "Website reminder email failed for {Email}", lemail); }
                }
                // WhatsApp renewal template: [name, websiteUrl, dueDate, payLink].
                if (!string.IsNullOrWhiteSpace(lmobile) && !string.IsNullOrWhiteSpace(waTemplate))
                {
                    try
                    {
                        var ok = await interakt.SendWhatsAppWithBodyValuesAsync(lmobile!, waTemplate,
                            new[] { lname, websiteUrl, dueDate, payLink });
                        if (ok) sent++; else failed++;
                    }
                    catch (Exception ex) { failed++; _logger.LogWarning(ex, "Website reminder WhatsApp failed for {Mobile}", lmobile); }
                }
            }

            await conn.ExecuteAsync(
                "UPDATE club_websites SET LastReminderSent = NOW() WHERE pk_id = @Id",
                new { Id = (int)w.id });

            // Log with the milestone marker so future runs deduplicate correctly.
            await conn.ExecuteAsync(@"
                INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy)
                VALUES (@Id, 'ReminderSent', @Details, 0)",
                new
                {
                    Id = (int)w.id,
                    Details = $"{marker} — {(isPaid ? "Paid" : "Trial")} site, {daysLeft} day(s) left. Sent: {sent}, Failed: {failed}",
                });
        }
    }
}
