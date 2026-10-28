using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Polls club_documents every 60 seconds — fires push when PublishDateTime is reached
/// (and ExpiryDateTime is in the future), once per document. Documents have NO reminders.
/// </summary>
public class DocumentPushBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<DocumentPushBackgroundService> _logger;

    public DocumentPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<DocumentPushBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DocumentPushBackgroundService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueDocsAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in DocumentPushBackgroundService loop"); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task ProcessDueDocsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("DefaultConnection")!;
        using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync(ct);

        var due = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_document_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId, Title
            FROM club_documents
            WHERE isdeleted = 0
              AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDateTime <= NOW()
              AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
              AND IFNULL(Status, 'Unpublished') = 'Published'
            ORDER BY PublishDateTime
            LIMIT 5")).ToList();
        if (due.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var push = scope.ServiceProvider.GetRequiredService<IFirebasePushService>();
        if (!push.IsAvailable)
        {
            _logger.LogWarning("Firebase not available — skipping {Count} due document(s)", due.Count);
            return;
        }

        foreach (var d in due)
        {
            ct.ThrowIfCancellationRequested();
            int docId = (int)d.Id;
            int clubId = (int)d.ClubId;
            int? districtId = d.DistrictId == null ? null : (int?)d.DistrictId;
            string title = (string)(d.Title ?? "");

            var marked = await conn.ExecuteAsync(@"
                UPDATE club_documents
                SET PushNotificationSent = 1, PushNotificationSentAt = NOW()
                WHERE pk_document_id = @Id AND IFNULL(PushNotificationSent, 0) = 0",
                new { Id = docId });
            if (marked == 0) continue;

            try { await SendForDocumentAsync(conn, push, docId, clubId, districtId, title, ct); }
            catch (Exception ex) { _logger.LogError(ex, "Failed document push {Id}", docId); }
        }
    }

    private static async Task SendForDocumentAsync(
        MySqlConnection conn, IFirebasePushService push,
        int documentId, int clubId, int? districtId, string title, CancellationToken ct)
    {
        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        var memberRows = (await conn.QueryAsync<(int memberId, string fcmToken)>(
            districtId.HasValue
                ? @"SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.LastDeviceToken AS fcmToken
                    FROM member_master_profile m
                    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
                    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                    WHERE m.isdeleted = 0 AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'
                      AND (m.LastMobileLogout IS NULL OR m.LastMobileVisit IS NULL OR m.LastMobileVisit > m.LastMobileLogout)"
                : @"SELECT DISTINCT m.pk_member_master_profile_id AS memberId, m.LastDeviceToken AS fcmToken
                    FROM member_master_profile m
                    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
                    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                    WHERE m.isdeleted = 0 AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'
                      AND (m.LastMobileLogout IS NULL OR m.LastMobileVisit IS NULL OR m.LastMobileVisit > m.LastMobileLogout)",
            new { ClubId = clubId, DistrictId = districtId })).ToList();

        if (memberRows.Count == 0) return;

        var tokenToMember = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in memberRows)
            if (!string.IsNullOrWhiteSpace(row.fcmToken) && !tokenToMember.ContainsKey(row.fcmToken))
                tokenToMember[row.fcmToken] = row.memberId;

        var data = new Dictionary<string, string>
        {
            ["type"] = "document",
            ["documentId"] = documentId.ToString(),
            ["scope"] = districtId.HasValue ? "district" : "club",
            ["scopeId"] = (districtId ?? clubId).ToString(),
            ["isReminder"] = "false",
        };

        string body;
        using (RotaryApi.Services.Localization.MessageCulture.Use(await PushDispatcher.TenantLanguageAsync(conn, clubId, districtId)))
            body = RotaryApi.Services.Localization.DbStringLocalizer.Instance["New document published"];
        var results = await push.SendMulticastAsync(tokenToMember.Keys, title, body, data, ct);

        foreach (var r in results)
        {
            int memberId = tokenToMember.TryGetValue(r.Token, out var mid) ? mid : 0;
            await conn.ExecuteAsync(@"
                INSERT INTO document_push_log
                    (fk_document_id, fk_member_master_profile_id, FcmToken, Status,
                     FirebaseMessageId, ErrorMessage, SentAt, created_date)
                VALUES (@Did, @Mid, @Tok, @Status, @MsgId, @Err, @Sent, NOW())",
                new
                {
                    Did = documentId, Mid = memberId,
                    Tok = r.Token.Length > 500 ? r.Token[..500] : r.Token,
                    Status = r.Success ? "Sent" : "Failed",
                    MsgId = r.FirebaseMessageId,
                    Err = string.IsNullOrEmpty(r.ErrorMessage) ? null : (r.ErrorMessage.Length > 1000 ? r.ErrorMessage[..1000] : r.ErrorMessage),
                    Sent = r.Success ? DateTime.Now : (DateTime?)null,
                });
            if (r.IsTokenInvalid)
                await conn.ExecuteAsync("UPDATE member_master_profile SET LastDeviceToken = NULL WHERE LastDeviceToken = @T", new { T = r.Token });
        }
    }
}
