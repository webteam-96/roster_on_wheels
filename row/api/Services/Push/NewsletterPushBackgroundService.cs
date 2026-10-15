using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Polls newsletters every 60 seconds — fires push once when PublishDateTime is reached and
/// PushNotificationSent is still 0. Recipient/send/log shared via PushDispatcher. RI-scope skipped.
/// </summary>
public class NewsletterPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<NewsletterPushBackgroundService> _logger;

    public NewsletterPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<NewsletterPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("NewsletterPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueNewslettersAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in NewsletterPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessDueNewslettersAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId, Title
            FROM newsletters
            WHERE isdeleted = 0
              AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDateTime <= NOW()
              AND IFNULL(Scope, '') <> 'ri'
            ORDER BY PublishDateTime
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable)
        {
            _logger.LogWarning("Firebase not available — skipping {Count} due newsletter(s)", due.Count);
            return;
        }

        foreach (var nl in due)
        {
            ct.ThrowIfCancellationRequested();
            int nlId = (int)nl.Id;
            int clubId = (int)nl.ClubId;
            int? districtId = nl.DistrictId == null ? null : (int?)nl.DistrictId;
            string title = (string)(nl.Title ?? "");

            var marked = await conn.ExecuteAsync(@"
                UPDATE newsletters SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                WHERE pk_newsletter_id = @Id AND IFNULL(PushNotificationSent, 0) = 0",
                new { Id = nlId });
            if (marked == 0) continue;

            try { await SendForNewsletterAsync(conn, push, nlId, clubId, districtId, title, ct); }
            catch (Exception ex) { _logger.LogError(ex, "Failed newsletter push {Id}", nlId); }
        }
    }

    private async Task SendForNewsletterAsync(
        MySqlConnection conn, IFirebasePushService push,
        int newsletterId, int clubId, int? districtId, string title, CancellationToken ct)
    {
        var tokenToMember = await PushDispatcher.ResolveClubDistrictTokensAsync(conn, clubId, districtId);
        if (tokenToMember.Count == 0) { _logger.LogInformation("Newsletter {Id}: no FCM tokens", newsletterId); return; }

        var sourceName = await PushDispatcher.ResolveSourceNameAsync(conn, clubId, districtId);
        var pushTitle = PushDispatcher.SourceTitle("Newsletter", sourceName);
        var pushBody = string.IsNullOrWhiteSpace(title) ? "A new newsletter has been published." : title;

        // Deep-link contract (Firebase_Notification_Routes.md): app opens /clubs/{clubId}/newsletters → detail.
        var data = new Dictionary<string, string>
        {
            ["type"] = "club_newsletter",
            ["clubId"] = clubId.ToString(),
            ["newsletterId"] = newsletterId.ToString(),
        };

        var (sent, failed) = await PushDispatcher.SendLogCleanupAsync(
            conn, push, tokenToMember, pushTitle, pushBody, data,
            "newsletter_push_log", new[] { ("fk_newsletter_id", newsletterId) }, ct);
        _logger.LogInformation("Newsletter {Id} push: sent={Sent} failed={Failed} totalTokens={Total}",
            newsletterId, sent, failed, tokenToMember.Count);
    }
}
