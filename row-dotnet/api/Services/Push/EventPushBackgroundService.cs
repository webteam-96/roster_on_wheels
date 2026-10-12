using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Polls upcoming_events every 60 seconds — fires push when PublishDate is reached
/// (and EventDate is in the future), once per event. Recipient resolution + send/log/cleanup
/// are shared via PushDispatcher. SendForEventAsync is reused by the event-reminder push.
/// </summary>
public class EventPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<EventPushBackgroundService> _logger;

    public EventPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<EventPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("EventPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueEventsAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in EventPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessDueEventsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   Title, Description, EventDate
            FROM upcoming_events
            WHERE isdeleted = 0
              AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDate <= NOW()
              -- Notify on the event day or earlier (was `EventDate > NOW()`, which silently
              -- dropped every event created for 'today' the moment its listed time passed —
              -- the common case for same-day events). Past-date events are still excluded.
              AND EventDate >= CURDATE()
              AND IFNULL(Scope, '') <> 'ri'
            ORDER BY PublishDate
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable)
        {
            _logger.LogWarning("Firebase not available — skipping {Count} due event(s)", due.Count);
            return;
        }

        foreach (var ev in due)
        {
            ct.ThrowIfCancellationRequested();
            int evId = (int)ev.Id;
            int clubId = (int)ev.ClubId;
            int? districtId = ev.DistrictId == null ? null : (int?)ev.DistrictId;
            string title = (string)(ev.Title ?? "");
            string desc = (string)(ev.Description ?? "");
            DateTime? eventDate = ev.EventDate;

            var marked = await conn.ExecuteAsync(@"
                UPDATE upcoming_events SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                WHERE pk_upcoming_event_id = @Id AND IFNULL(PushNotificationSent, 0) = 0",
                new { Id = evId });
            if (marked == 0) continue;

            try { await SendForEventAsync(conn, push, evId, clubId, districtId, title, desc, eventDate, isReminder: false, reminderId: null, ct); }
            catch (Exception ex) { _logger.LogError(ex, "Failed event push {Id}", evId); }
        }
    }

    internal static async Task SendForEventAsync(
        MySqlConnection conn, IFirebasePushService push,
        int eventId, int clubId, int? districtId,
        string title, string description, DateTime? eventDate,
        bool isReminder, int? reminderId, CancellationToken ct)
    {
        var tokenToMember = await PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
        if (tokenToMember.Count == 0) return;

        var sourceName = await PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
        var pushTitle = isReminder ? PushDispatcher.ReminderTitle(sourceName) : PushDispatcher.SourceTitle("Event", sourceName);
        var datePart = eventDate.HasValue ? $" · {eventDate.Value:dd MMM yyyy}" : "";
        var pushBody = (string.IsNullOrWhiteSpace(title) ? PushDispatcher.Trim(description, 180) : title) + datePart;

        // Deep-link contract (Firebase_Notification_Routes.md): app opens /clubs/{clubId}/upcoming-events → detail.
        var data = new Dictionary<string, string>
        {
            ["type"] = "club_upcoming_event",
            ["clubId"] = clubId.ToString(),
            ["eventId"] = eventId.ToString(),
        };

        if (isReminder && reminderId.HasValue)
            await PushDispatcher.SendLogCleanupAsync(conn, push, tokenToMember, pushTitle, pushBody, data,
                "event_reminder_push_log", new[] { ("fk_reminder_id", reminderId.Value), ("fk_upcoming_event_id", eventId) }, ct);
        else
            await PushDispatcher.SendLogCleanupAsync(conn, push, tokenToMember, pushTitle, pushBody, data,
                "event_push_log", new[] { ("fk_upcoming_event_id", eventId) }, ct);
    }
}
