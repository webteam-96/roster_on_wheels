using System.Globalization;
using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Reminders for volunteer slots (sign-ups whose slot starts within 24 hours) and meeting duties (meeting within 2 days),
/// only while the "volunteers" switch is on. A row is claimed (reminder_sent_at) before its email is sent, so a crash
/// loses one email instead of sending it twice; the app's bell shows members the same reminder from reminder_sent_at
/// (MobileNotificationFeedService). email_log records every send and failure (the club's email log).
/// </summary>
// Slot times and duty dates are the club's wall clock: each is compared with the local time of the club's district
// zone (N12, ZoneTime).
// shortcut: failed sends are not retried (email_log shows them), add a retry when delivery tracking lands.
public class VolunteerReminderBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<VolunteerReminderBackgroundService> _log;
    private readonly string _cs;

    public VolunteerReminderBackgroundService(IServiceScopeFactory scopes, ILogger<VolunteerReminderBackgroundService> log, IConfiguration config)
    {
        _scopes = scopes;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private sealed class Due
    {
        public int Id { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
        public bool IsMember { get; set; }
        public string What { get; set; } = "";        // the task, or the duty
        public string? Detail { get; set; }           // the sheet's title, or the duty's note
        public DateTime When { get; set; }
        public DateTime? Until { get; set; }
        public int ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string ClubName { get; set; } = "";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if ((await FeatureGate.OnAsync(_cs)).Contains("volunteers")) await RemindAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Volunteer reminder tick failed"); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RemindAsync(CancellationToken ct)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync(ct);
        var slots = new List<Due>();
        var duties = new List<Due>();
        foreach (var (tz, zone) in await ZoneTime.ZonesAsync(c))
        {
            var now = ZoneTime.Local(zone);
            var at = new { Now = now, Today = now.Date, Tz = tz };
            slots.AddRange(await c.QueryAsync<Due>($@"
            SELECT su.pk_signup_id AS Id, COALESCE(m.EmailId, su.email) AS Email, COALESCE(m.MemberName, su.name) AS Name,
                   su.fk_member_id IS NOT NULL AS IsMember, sl.task AS What, sh.title AS Detail, sl.starts_at AS `When`,
                   sl.ends_at AS Until, sh.fk_club_id AS ClubId, cl.fk_district_id AS DistrictId, cl.ClubName
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
            JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
            LEFT JOIN district_master dz ON dz.pk_district_id = cl.fk_district_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE su.reminder_sent_at IS NULL
              AND sl.starts_at > @Now AND sl.starts_at <= @Now + INTERVAL 24 HOUR AND {ZoneTime.Filter("dz")}
            ORDER BY sl.starts_at LIMIT 200", at));
            duties.AddRange(await c.QueryAsync<Due>($@"
            SELECT d.pk_duty_id AS Id, m.EmailId AS Email, m.MemberName AS Name, 1 AS IsMember, d.duty AS What, d.note AS Detail,
                   d.meeting_date AS `When`, d.fk_club_id AS ClubId, cl.fk_district_id AS DistrictId, cl.ClubName
            FROM meeting_duties d
            JOIN club_master cl ON cl.pk_club_id = d.fk_club_id
            LEFT JOIN district_master dz ON dz.pk_district_id = cl.fk_district_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = d.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE d.reminder_sent_at IS NULL AND d.meeting_date BETWEEN @Today AND @Today + INTERVAL 2 DAY AND {ZoneTime.Filter("dz")}
            ORDER BY d.meeting_date LIMIT 200", at));
        }

        using var scope = _scopes.CreateScope();
        var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
        foreach (var r in slots)
            if (await ClaimAsync(c, "volunteer_signups", "pk_signup_id", r.Id) && Address(r) is { } to)
                await email.SendScopedEmailAsync(to, $"Reminder: {r.What}, {r.When.ToString("ddd d MMM, HH:mm", CultureInfo.InvariantCulture)}", SlotHtml(r), r.ClubId, r.DistrictId);
        foreach (var r in duties)
            if (await ClaimAsync(c, "meeting_duties", "pk_duty_id", r.Id) && Address(r) is { } to)
                await email.SendScopedEmailAsync(to, $"Meeting duty: {r.What}, {r.When.ToString("ddd d MMM", CultureInfo.InvariantCulture)}", DutyHtml(r), r.ClubId, r.DistrictId);
    }

    // Table and key names are the two constants above, never input.
    private static async Task<bool> ClaimAsync(MySqlConnection c, string table, string key, int id) =>
        await c.ExecuteAsync($"UPDATE {table} SET reminder_sent_at = NOW() WHERE {key} = @id AND reminder_sent_at IS NULL", new { id }) > 0;

    private static string? Address(Due r) => r.Email?.Trim() is { Length: > 3 } e && e.Contains('@') ? e : null;

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string Wrap(Due r, string body) => $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {E(r.Name)},</p>
{body}
<p style=""color:#64748b;font-size:12px"">This is an automated message from {E(Brand.ProductName)} for {E(r.ClubName)}.</p>
</div>";

    // shortcut: a non-member cancels by telling the club (no cancel link), add a signed cancel link if clubs ask.
    private static string SlotHtml(Due r)
    {
        var when = r.When.ToString("dddd d MMMM yyyy, HH:mm", CultureInfo.InvariantCulture)
                   + (r.Until is { } u ? " to " + u.ToString(u.Date == r.When.Date ? "HH:mm" : "d MMMM, HH:mm", CultureInfo.InvariantCulture) : "");
        var who = r.IsMember ? "" : "<p>You signed up on the club's volunteer page. If you cannot come, please let the club know.</p>";
        return Wrap(r, $@"<p>Thank you for volunteering with {E(r.ClubName)}. A reminder of your slot:</p>
<p><strong>{E(r.What)}</strong> ({E(r.Detail)})<br>{E(when)}</p>
{who}");
    }

    private static string DutyHtml(Due r) => Wrap(r, $@"<p>You are down for <strong>{E(r.What)}</strong> at the {E(r.ClubName)} meeting on
{E(r.When.ToString("dddd d MMMM yyyy", CultureInfo.InvariantCulture))}.</p>
{(string.IsNullOrEmpty(r.Detail) ? "" : $"<p>{E(r.Detail)}</p>")}");
}
