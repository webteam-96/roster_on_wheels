using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Polls the announcements table every 60 seconds for those whose PublishDateTime
/// has passed but PushNotificationSent is still 0, and fires push notifications via
/// Firebase to all members of the club (or all members of all clubs in the district).
/// Recipient resolution + send/log/cleanup are shared via PushDispatcher.
///
/// Re-send semantics: when an admin changes PublishDateTime, AnnouncementService.UpdateAsync
/// clears PushNotificationSent → this service picks it up on the next poll and re-fires.
/// </summary>
public class AnnouncementPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<AnnouncementPushBackgroundService> _logger;

    public AnnouncementPushBackgroundService(
        IServiceScopeFactory scopeFactory,
        IConfiguration config,
        ILogger<AnnouncementPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("AnnouncementPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueAnnouncementsAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in AnnouncementPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessDueAnnouncementsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        // Club-level (fk_district_id NULL) and District-level both handled; RI-scope skipped.
        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_announcement_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   Title, Description
            FROM announcements
            WHERE isdeleted = 0
              AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDateTime <= NOW()
              AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
              AND IFNULL(Scope, '') <> 'ri'
            ORDER BY PublishDateTime
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable)
        {
            _logger.LogWarning("Firebase not available — skipping {Count} due announcement(s) this cycle", due.Count);
            return;
        }

        foreach (var ann in due)
        {
            ct.ThrowIfCancellationRequested();
            int annId = (int)ann.Id;
            int clubId = (int)ann.ClubId;
            int? districtId = ann.DistrictId == null ? null : (int?)ann.DistrictId;
            string title = (string)(ann.Title ?? "");
            string desc = (string)(ann.Description ?? "");

            // Mark sent IMMEDIATELY to prevent another cycle picking up the same row mid-flight.
            var marked = await conn.ExecuteAsync(@"
                UPDATE announcements SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                WHERE pk_announcement_id = @Id AND IFNULL(PushNotificationSent, 0) = 0",
                new { Id = annId });
            if (marked == 0) continue;

            try { await SendForAnnouncementAsync(conn, push, annId, clubId, districtId, title, desc, ct); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process push for announcement {Id}", annId);
            }
        }
    }

    private async Task SendForAnnouncementAsync(
        MySqlConnection conn, IFirebasePushService push,
        int announcementId, int clubId, int? districtId, string headline, string description, CancellationToken ct)
    {
        var tokenToMember = await PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
        if (tokenToMember.Count == 0)
        {
            _logger.LogInformation("Announcement {Id}: no FCM tokens to send to", announcementId);
            return;
        }

        var sourceName = await PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
        var pushTitle = PushDispatcher.SourceTitle("Announcement", sourceName);
        var pushBody = string.IsNullOrWhiteSpace(description) ? headline : $"{headline} — {PushDispatcher.Trim(description, 160)}";

        // Deep-link contract (Firebase_Notification_Routes.md): app opens /clubs/{clubId}/announcements → detail.
        var data = new Dictionary<string, string>
        {
            ["type"] = "club_announcement",
            ["clubId"] = clubId.ToString(),
            ["announcementId"] = announcementId.ToString(),
        };

        var (sent, failed) = await PushDispatcher.SendLogCleanupAsync(
            conn, push, tokenToMember, pushTitle, pushBody, data,
            "announcement_push_log", new[] { ("fk_announcement_id", announcementId) }, ct);
        _logger.LogInformation("Announcement {Id} push: sent={Sent} failed={Failed} totalTokens={Total}",
            announcementId, sent, failed, tokenToMember.Count);
    }
}
