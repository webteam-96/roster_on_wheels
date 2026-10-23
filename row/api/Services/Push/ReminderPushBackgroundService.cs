using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Polls announcement_reminders + upcoming_event_reminders every 60 seconds.
/// Fires push for reminder rows whose ReminderDateTime has passed (and not too old) and PushSentAt
/// is still NULL. Each reminder fires exactly once. Recipient/send/log shared via PushDispatcher.
///
/// Stale guard: skip reminders older than 24 hours (e.g., system was down) — irrelevant by then.
/// </summary>
public class ReminderPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ReminderPushBackgroundService> _logger;

    public ReminderPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ReminderPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ReminderPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAnnouncementRemindersAsync(stoppingToken);
                await ProcessEventRemindersAsync(stoppingToken);
            }
            catch (Exception ex) { _logger.LogError(ex, "Error in ReminderPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessAnnouncementRemindersAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS ReminderId, r.fk_announcement_id AS AnnouncementId, r.ReminderDateTime,
                   a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, a.Title, a.Description
            FROM announcement_reminders r
            JOIN announcements a ON a.pk_announcement_id = r.fk_announcement_id
                                  AND a.isdeleted = 0
            WHERE r.IsActive = 1
              AND r.PushSentAt IS NULL
              AND r.ReminderDateTime <= NOW()
              AND r.ReminderDateTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY r.ReminderDateTime
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable) return;

        foreach (var r in due)
        {
            ct.ThrowIfCancellationRequested();
            int reminderId = (int)r.ReminderId;
            int annId = (int)r.AnnouncementId;
            int clubId = (int)r.ClubId;
            int? districtId = r.DistrictId == null ? null : (int?)r.DistrictId;
            string title = (string)(r.Title ?? "");
            string desc = (string)(r.Description ?? "");

            var marked = await conn.ExecuteAsync(@"
                UPDATE announcement_reminders SET PushSentAt = NOW()
                WHERE pk_reminder_id = @Id AND PushSentAt IS NULL",
                new { Id = reminderId });
            if (marked == 0) continue;

            try { await SendAnnouncementReminderAsync(conn, push, reminderId, annId, clubId, districtId, title, desc, ct); }
            catch (Exception ex) { _logger.LogError(ex, "Failed announcement reminder push {Rid}", reminderId); }
        }
    }

    private async Task ProcessEventRemindersAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS ReminderId, r.fk_upcoming_event_id AS EventId, r.ReminderDateTime,
                   e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId, e.Title, e.Description, e.EventDate
            FROM upcoming_event_reminders r
            JOIN upcoming_events e ON e.pk_upcoming_event_id = r.fk_upcoming_event_id
                                  AND e.isdeleted = 0
            WHERE r.IsActive = 1
              AND r.PushSentAt IS NULL
              AND r.ReminderDateTime <= NOW()
              AND r.ReminderDateTime > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY r.ReminderDateTime
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable) return;

        foreach (var r in due)
        {
            ct.ThrowIfCancellationRequested();
            int reminderId = (int)r.ReminderId;
            int eventId = (int)r.EventId;
            int clubId = (int)r.ClubId;
            int? districtId = r.DistrictId == null ? null : (int?)r.DistrictId;
            string title = (string)(r.Title ?? "");
            string desc = (string)(r.Description ?? "");
            DateTime? eventDate = r.EventDate;

            var marked = await conn.ExecuteAsync(@"
                UPDATE upcoming_event_reminders SET PushSentAt = NOW()
                WHERE pk_reminder_id = @Id AND PushSentAt IS NULL",
                new { Id = reminderId });
            if (marked == 0) continue;

            try
            {
                await EventPushBackgroundService.SendForEventAsync(conn, push, eventId, clubId, districtId, title, desc, eventDate,
                    isReminder: true, reminderId: reminderId, ct);
            }
            catch (Exception ex) { _logger.LogError(ex, "Failed event reminder push {Rid}", reminderId); }
        }
    }

    private async Task SendAnnouncementReminderAsync(
        MySqlConnection conn, IFirebasePushService push,
        int reminderId, int announcementId, int clubId, int? districtId,
        string headline, string description, CancellationToken ct)
    {
        var tokenToMember = await PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
        if (tokenToMember.Count == 0) return;

        var sourceName = await PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
        var pushTitle = PushDispatcher.ReminderTitle(sourceName);
        var pushBody = string.IsNullOrWhiteSpace(description) ? headline : $"{headline} — {PushDispatcher.Trim(description, 160)}";

        // Deep-link contract (Firebase_Notification_Routes.md): reminders open the same screen as the item.
        var data = new Dictionary<string, string>
        {
            ["type"] = "club_announcement",
            ["clubId"] = clubId.ToString(),
            ["announcementId"] = announcementId.ToString(),
        };

        await PushDispatcher.SendLogCleanupAsync(conn, push, tokenToMember, pushTitle, pushBody, data,
            "announcement_reminder_push_log",
            new[] { ("fk_reminder_id", reminderId), ("fk_announcement_id", announcementId) }, ct);
    }
}
