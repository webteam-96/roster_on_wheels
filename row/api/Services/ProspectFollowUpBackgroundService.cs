using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Every minute, while contacts_growth is on: writes the reminder notice of each open prospect task whose reminder day
/// has come (in the club's own zone), then emails the prospect notices still 'pending'. A task is claimed
/// (reminder_sent_at) and a notice marked before it is sent, so a crash loses one email instead of sending it twice;
/// email_log records every send and failure.
/// </summary>
// shortcut: failed sends are not retried (email_log shows them), add a retry when delivery tracking lands.
public class ProspectFollowUpBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<ProspectFollowUpBackgroundService> _log;
    private readonly string _cs;
    private readonly string _frontendUrl;

    public ProspectFollowUpBackgroundService(IServiceScopeFactory scopes, ILogger<ProspectFollowUpBackgroundService> log, IConfiguration config)
    {
        _scopes = scopes;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
        _frontendUrl = config["FrontendUrl"]?.TrimEnd('/') ?? "";
    }

    private sealed class DueTask
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public int ProspectId { get; set; }
        public string ProspectName { get; set; } = "";
        public string Title { get; set; } = "";
        public int Assignee { get; set; }
        public DateTime DueDate { get; set; }
        public int? RemindDaysBefore { get; set; }
    }

    private sealed class Pending
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string ClubName { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Body { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await FeatureGate.IsOnAsync(ProspectFollowUpService.FeatureKey, _cs))
                {
                    await RemindAsync(stoppingToken);
                    await SendPendingAsync(stoppingToken);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Prospect follow-up tick failed"); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RemindAsync(CancellationToken ct)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync(ct);
        foreach (var (tz, zone) in await ZoneTime.ZonesAsync(c))
        {
            var today = ZoneTime.Local(zone).Date;
            var rows = await c.QueryAsync<DueTask>($@"
                SELECT t.pk_task_id AS Id, t.fk_club_id AS ClubId, t.fk_potential_member_id AS ProspectId, pm.name AS ProspectName,
                       t.title AS Title, t.fk_assignee_member_id AS Assignee, t.due_date AS DueDate, t.remind_days_before AS RemindDaysBefore
                FROM prospect_tasks t
                JOIN potential_members pm ON pm.pk_potential_member_id = t.fk_potential_member_id AND pm.isdeleted = 0
                JOIN club_master cl ON cl.pk_club_id = t.fk_club_id
                JOIN club_members cm ON cm.fk_club_id = t.fk_club_id AND cm.fk_member_master_profile_id = t.fk_assignee_member_id
                                    AND cm.IsActive = 1 AND cm.isdeleted = 0
                LEFT JOIN district_master dz ON dz.pk_district_id = cl.fk_district_id
                WHERE t.status = 'open' AND t.reminder_sent_at IS NULL AND t.remind_days_before IS NOT NULL
                  AND t.due_date <= @Horizon AND {ZoneTime.Filter("dz")}
                ORDER BY t.due_date LIMIT 200", new { Horizon = today.AddDays(30), Tz = tz });
            foreach (var t in rows.Where(r => ProspectFollowUpService.ReminderDue(r.DueDate, r.RemindDaysBefore, today)))
            {
                if (await c.ExecuteAsync("UPDATE prospect_tasks SET reminder_sent_at = UTC_TIMESTAMP() WHERE pk_task_id = @Id AND reminder_sent_at IS NULL",
                        new { t.Id }) == 0) continue;
                var settings = await ProspectFollowUpService.SettingsAsync(c, t.ClubId);
                var when = t.DueDate.Date < today ? "was due" : t.DueDate.Date == today ? "is due today," : "is due";
                await ProspectFollowUpService.NotifyAsync(c, t.ClubId, t.ProspectId, t.Id, "task_reminder", $"Reminder: {t.Title}",
                    $"Your follow-up with {t.ProspectName} {when} {t.DueDate:d MMM yyyy}.", new[] { t.Assignee }, settings.InApp, settings.Email);
            }
        }
    }

    private async Task SendPendingAsync(CancellationToken ct)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync(ct);
        var rows = (await c.QueryAsync<Pending>(@"
            SELECT n.pk_notification_id AS Id, n.fk_club_id AS ClubId, cl.fk_district_id AS DistrictId, cl.ClubName,
                   n.title AS Title, n.body AS Body, m.EmailId AS Email, m.MemberName AS Name
            FROM prospect_notifications n
            JOIN club_master cl ON cl.pk_club_id = n.fk_club_id
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
                UPDATE prospect_notifications SET email_status = @status, email_sent_at = UTC_TIMESTAMP()
                WHERE pk_notification_id = @Id AND email_status = 'pending'", new { r.Id, status = send ? "sent" : "skipped" });
            if (claimed == 0 || !send) continue;
            try { await email.SendScopedEmailAsync(to!, r.Title, Html(r), r.ClubId, r.DistrictId); }
            catch (Exception ex) { _log.LogWarning(ex, "Prospect notice email {Id} failed", r.Id); }
        }
    }

    private string Html(Pending r)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var link = _frontendUrl.Length == 0 ? "" :
            $"<p><a href=\"{E($"{_frontendUrl}/clubs/{r.ClubId}/rotary-network/potential-members/v2")}\">Open Potential Members in {E(Brand.ProductName)}</a></p>";
        return $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {E(r.Name)},</p>
<p><strong>{E(r.Title)}</strong></p>
<p>{E(r.Body)}</p>
{link}
<p style=""color:#64748b;font-size:12px"">This is an automated message from {E(Brand.ProductName)} for {E(r.ClubName)}.</p>
</div>";
    }
}
