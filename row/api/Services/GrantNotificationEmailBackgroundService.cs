using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Emails the grant notifications GrantService writes (grant_notifications rows still 'pending'); the in-app copy
/// is the row itself, read by the app's bell. A row is marked before it is sent, so a crash mid-send loses that one
/// email instead of sending it twice; email_log records every send and failure (Settings > Email log).
/// </summary>
// shortcut: failed sends are not retried (email_log shows them), add a retry when delivery tracking lands.
public class GrantNotificationEmailBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<GrantNotificationEmailBackgroundService> _log;
    private readonly string _cs;
    private readonly string _frontendUrl;

    public GrantNotificationEmailBackgroundService(IServiceScopeFactory scopes, ILogger<GrantNotificationEmailBackgroundService> log, IConfiguration config)
    {
        _scopes = scopes;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
        _frontendUrl = config["FrontendUrl"]?.TrimEnd('/') ?? "";
    }

    private sealed class Pending
    {
        public int Id { get; set; }
        public int ApplicationId { get; set; }
        public string Side { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Body { get; set; }
        public int ClubId { get; set; }
        public int DistrictId { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await SendPendingAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Grant notification email tick failed"); }
            try { await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task SendPendingAsync(CancellationToken ct)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync(ct);
        var rows = (await c.QueryAsync<Pending>(@"
            SELECT n.pk_notification_id AS Id, n.fk_application_id AS ApplicationId, n.side AS Side, n.title AS Title, n.body AS Body,
                   a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, m.EmailId AS Email, m.MemberName AS Name
            FROM grant_notifications n
            JOIN grant_applications a ON a.pk_application_id = n.fk_application_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = n.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE n.email_status = 'pending'
            ORDER BY n.pk_notification_id LIMIT 50")).ToList();
        if (rows.Count == 0) return;

        using var scope = _scopes.CreateScope();
        var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
        foreach (var r in rows)
        {
            if (ct.IsCancellationRequested) break;
            var to = r.Email?.Trim();
            var send = !string.IsNullOrEmpty(to) && to.Contains('@');
            var claimed = await c.ExecuteAsync(@"
                UPDATE grant_notifications SET email_status = @status, email_sent_at = NOW()
                WHERE pk_notification_id = @Id AND email_status = 'pending'", new { r.Id, status = send ? "sent" : "skipped" });
            if (claimed == 0 || !send) continue;
            await email.SendScopedEmailAsync(to!, r.Title, Html(r), r.ClubId, r.DistrictId);
        }
    }

    private string Html(Pending r)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var page = r.Side == GrantService.DistrictSide ? "district-admin-dashboard" : "club-admin-dashboard";
        var link = _frontendUrl.Length == 0 ? "" :
            $"<p><a href=\"{E($"{_frontendUrl}/{page}/grants/{r.ApplicationId}")}\">Open the application in {E(Brand.ProductName)}</a></p>";
        return $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {E(r.Name)},</p>
<p><strong>{E(r.Title)}</strong></p>
<p>{E(r.Body)}</p>
{link}
<p style=""color:#64748b;font-size:12px"">This is an automated message from {E(Brand.ProductName)}.</p>
</div>";
    }
}
