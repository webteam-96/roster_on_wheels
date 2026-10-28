using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// N8 Meetings (build spec 3.17 pasted links, #23, B.1 #31): tokenised calendar feeds, meeting compliance and the
/// reminder text. Meetings are the club_attendance records (one row per meeting, attendance in
/// club_attendance_members); their mode and pasted join link are ROW Wave 1 (AttendanceService.NormalizeMeeting).
/// Reminders: MeetingReminderBackgroundService (email) and the 'meeting' leg of MobileNotificationFeedService (in-app).
/// </summary>
// shortcut: no "public meeting" flag: meeting records never reach public pages, so join links are never public; add the
// flag with a club-site meetings list when a club wants to publish an open meeting.
public class MeetingsService
{
    public const string FeatureKey = "meetings";
    // shortcut: one fixed lead time for email and in-app reminders, make it a club setting if clubs ask for one.
    public const int ReminderLeadHours = 24;
    // RI's standard club constitution has clubs meet at least twice a month: the rule until a district sets its own.
    public const int DefaultMeetingsPerMonth = 2;

    private readonly string _cs;

    public MeetingsService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    public static string ModeLabel(string? mode) => mode switch { "online" => "Online", "hybrid" => "Hybrid", _ => "In person" };

    // ── Calendar feeds ───────────────────────────────────────────────────────────────────────

    /// <summary>The feed token of a club (clubId) or of a member (memberId), or null when none was issued.</summary>
    public async Task<string?> GetFeedTokenAsync(int? clubId, int? memberId)
    {
        await using var conn = new MySqlConnection(_cs);
        return await conn.ExecuteScalarAsync<string?>(
            $"SELECT token FROM meeting_calendar_feeds WHERE {(clubId != null ? "fk_club_id" : "fk_member_id")} = @Id",
            new { Id = clubId ?? memberId });
    }

    /// <summary>Issues a new token for the club or member feed; the previous URL stops working.</summary>
    // shortcut: the token is stored as issued so admins can copy the URL again; store a hash if feeds ever carry more
    // than meeting times and join links.
    public async Task<string> ResetFeedTokenAsync(int? clubId, int? memberId, int createdBy)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await using var conn = new MySqlConnection(_cs);
        await conn.ExecuteAsync(
            $@"INSERT INTO meeting_calendar_feeds (token, {(clubId != null ? "fk_club_id" : "fk_member_id")}, created_by)
               VALUES (@Token, @Id, @By)
               ON DUPLICATE KEY UPDATE token = @Token, created_by = @By, created_date = NOW()",
            new { Token = token, Id = clubId ?? memberId, By = createdBy });
        return token;
    }

    private sealed class FeedMeeting
    {
        public int Id { get; set; }
        public string EventName { get; set; } = "";
        public string? Description { get; set; }
        public DateTime EventDateTime { get; set; }
        public string? MeetingMode { get; set; }
        public string? MeetingLink { get; set; }
        public string ClubName { get; set; } = "";
        public string? Tz { get; set; }
    }

    /// <summary>The iCal text for a feed token, or null for an unknown token or an inactive club.</summary>
    public async Task<string?> BuildIcsAsync(string token)
    {
        await using var conn = new MySqlConnection(_cs);
        var feed = await conn.QueryFirstOrDefaultAsync<(int? ClubId, int? MemberId)>(
            "SELECT fk_club_id, fk_member_id FROM meeting_calendar_feeds WHERE token = @Token", new { Token = token });
        if (feed.ClubId == null && feed.MemberId == null) return null;

        string calName = "My club meetings";
        if (feed.ClubId != null)
        {
            var club = await conn.ExecuteScalarAsync<string?>(
                "SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND IFNULL(isdeleted, 0) = 0 AND IsActive = 1",
                new { Id = feed.ClubId });
            if (club == null) return null;
            calName = $"{club} meetings";
        }

        // A member feed follows the clubs the member belongs to today, so leaving a club drops its meetings.
        var meetings = await conn.QueryAsync<FeedMeeting>($@"
            SELECT a.pk_attendance_id AS Id, a.EventName, a.Description, a.EventDateTime, a.MeetingMode, a.MeetingLink, c.ClubName,
                   d.Timezone AS Tz
            FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE a.isdeleted = 0
              AND a.EventDateTime >= DATE_SUB(NOW(), INTERVAL 90 DAY)
              AND {(feed.ClubId != null
                    ? "a.fk_club_id = @ClubId"
                    : @"a.fk_club_id IN (SELECT cm.fk_club_id FROM club_members cm
                          JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                          WHERE cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND cm.isdeleted = 0)")}
            ORDER BY a.EventDateTime
            LIMIT 500",
            new { feed.ClubId, feed.MemberId });

        return Ics(calName, meetings, showClub: feed.MemberId != null);
    }

    private static string Ics(string calName, IEnumerable<FeedMeeting> meetings, bool showClub)
    {
        var sb = new StringBuilder();
        void Line(string s) => sb.Append(Fold(s)).Append("\r\n");
        static string Local(DateTime d) => d.ToString("yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);
        // N12: a stored UTC time goes out as UTC ("Z"); a stored wall-clock time is the club's, in its district's zone.
        // Meeting forms send the club's wall-clock; AttendanceService converts it to UTC when stored times are UTC.
        static string At(string name, DateTime d, string? tz) =>
            ZoneTime.StoredUtc ? $"{name}:{Local(d)}Z" : $"{name};TZID={ZoneTime.IanaId(ZoneTime.Find(tz))}:{Local(d)}";

        Line("BEGIN:VCALENDAR");
        Line("VERSION:2.0");
        Line("PRODID:-//ROW//Meetings//EN");
        Line("CALSCALE:GREGORIAN");
        Line("METHOD:PUBLISH");
        Line("X-WR-CALNAME:" + Esc(calName));
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        foreach (var m in meetings)
        {
            var link = m.MeetingMode is "online" or "hybrid" ? m.MeetingLink : null;
            var desc = new List<string>();
            if (showClub) desc.Add(m.ClubName);
            if (!string.IsNullOrWhiteSpace(m.Description)) desc.Add(m.Description.Trim());
            desc.Add(link == null ? ModeLabel(m.MeetingMode) : $"{ModeLabel(m.MeetingMode)} meeting. Join: {link}");

            Line("BEGIN:VEVENT");
            Line($"UID:row-meeting-{m.Id}");
            Line("DTSTAMP:" + stamp);
            // shortcut: 1 hour long, meeting records hold no end time. TZID names the zone without a VTIMEZONE block
            // (Google, Apple and Outlook resolve IANA names); add VTIMEZONE if a client shows wrong times.
            Line(At("DTSTART", m.EventDateTime, m.Tz));
            Line(At("DTEND", m.EventDateTime.AddHours(1), m.Tz));
            Line("SUMMARY:" + Esc(m.EventName));
            Line("DESCRIPTION:" + Esc(string.Join("\n\n", desc)));
            if (link != null)
            {
                Line("LOCATION:" + Esc(link));
                Line("URL:" + link);
            }
            Line("END:VEVENT");
        }
        Line("END:VCALENDAR");
        return sb.ToString();
    }

    /// <summary>RFC 5545 TEXT escaping.</summary>
    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,")
        .Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "");

    /// <summary>RFC 5545 line folding: at most 75 octets per line, never splitting a UTF-8 character.</summary>
    private static string Fold(string line)
    {
        if (Encoding.UTF8.GetByteCount(line) <= 75) return line;
        var sb = new StringBuilder();
        var bytes = 0;
        for (var i = 0; i < line.Length; i++)
        {
            var len = char.IsHighSurrogate(line[i]) && i + 1 < line.Length ? 2 : 1;
            var n = Encoding.UTF8.GetByteCount(line.AsSpan(i, len));
            if (bytes + n > 75)
            {
                sb.Append("\r\n ");
                bytes = 1;
            }
            sb.Append(line, i, len);
            bytes += n;
            i += len - 1;
        }
        return sb.ToString();
    }

    // ── Compliance ───────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Compliance of every active club in the district (clubId null) or of one club, for the month starting at
    /// <paramref name="month"/>. A meeting counts as held when its record is dated in the month, is not in the
    /// future and has attendance marked. Null when the club is not found.
    /// </summary>
    public async Task<MeetingComplianceDto?> GetComplianceAsync(int? districtId, int? clubId, DateTime month)
    {
        var from = new DateTime(month.Year, month.Month, 1);
        var to = from.AddMonths(1);
        var now = DateTime.Now;
        await using var conn = new MySqlConnection(_cs);
        districtId ??= await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId AND IFNULL(isdeleted, 0) = 0", new { ClubId = clubId });
        if (districtId == null) return null;

        var def = await conn.ExecuteScalarAsync<int?>(
            "SELECT MeetingsPerMonth FROM meeting_rules WHERE fk_district_id = @D", new { D = districtId });
        var rows = await conn.QueryAsync<(int ClubId, string ClubName, int? Override, long Held)>(@"
            SELECT c.pk_club_id, c.ClubName, r.MeetingsPerMonth,
                   (SELECT COUNT(*) FROM club_attendance a
                     WHERE a.fk_club_id = c.pk_club_id AND a.isdeleted = 0
                       AND a.EventDateTime >= @From AND a.EventDateTime < @To AND a.EventDateTime <= @Now
                       AND EXISTS (SELECT 1 FROM club_attendance_members am WHERE am.fk_attendance_id = a.pk_attendance_id))
            FROM club_master c
            LEFT JOIN meeting_rules r ON r.fk_club_id = c.pk_club_id
            WHERE c.fk_district_id = @D AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1
              AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
            ORDER BY c.ClubName",
            new { D = districtId, ClubId = clubId, From = from, To = to, Now = now });

        var dto = new MeetingComplianceDto
        {
            Month = from.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            DistrictDefault = def ?? DefaultMeetingsPerMonth,
            DistrictDefaultIsSet = def != null,
        };
        foreach (var r in rows)
        {
            var required = r.Override ?? dto.DistrictDefault;
            dto.Clubs.Add(new MeetingComplianceClubDto
            {
                ClubId = r.ClubId,
                ClubName = r.ClubName,
                Required = required,
                IsOverride = r.Override != null,
                Held = (int)r.Held,
                Status = r.Held >= required ? "met" : to > now ? "due" : "missed",
            });
        }
        if (clubId != null && dto.Clubs.Count == 0) return null;
        return dto;
    }

    /// <summary>Sets the district default (clubId null) or a club's override (null count clears it).
    /// False when the club is not in this district.</summary>
    public async Task<bool> SetRuleAsync(int districtId, int? clubId, int? perMonth, int by)
    {
        await using var conn = new MySqlConnection(_cs);
        if (clubId == null)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO meeting_rules (fk_district_id, MeetingsPerMonth, modified_by) VALUES (@D, @N, @By)
                ON DUPLICATE KEY UPDATE MeetingsPerMonth = @N, modified_by = @By",
                new { D = districtId, N = perMonth, By = by });
            return true;
        }
        // The write guard checked the caller manages the district in the URL; the club must be one of its clubs.
        var inDistrict = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @C AND fk_district_id = @D AND IFNULL(isdeleted, 0) = 0",
            new { C = clubId, D = districtId });
        if (inDistrict == 0) return false;
        await conn.ExecuteAsync(perMonth == null
            ? "DELETE FROM meeting_rules WHERE fk_club_id = @C"
            : @"INSERT INTO meeting_rules (fk_club_id, MeetingsPerMonth, modified_by) VALUES (@C, @N, @By)
                ON DUPLICATE KEY UPDATE MeetingsPerMonth = @N, modified_by = @By",
            new { C = clubId, N = perMonth, By = by });
        return true;
    }

    // ── Reminder text ────────────────────────────────────────────────────────────────────────

    /// <summary>The club's template for this nudge (N5 communication, member's language first).</summary>
    public const string ReminderTemplateKey = "meeting_reminder";

    // English unless the club has a 'meeting_reminder' template (N5): then the version in the member's language.
    internal static (string Subject, string Html) ReminderEmail(string clubName, string eventName, string? description,
        DateTime when, string? mode, string? link, CommsTemplates.Template? template = null, string? memberName = null)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var time = when.ToString("dddd d MMMM yyyy, h:mm tt", CultureInfo.InvariantCulture);
        if (template != null)
        {
            var values = new Dictionary<string, string?>
            {
                ["member_name"] = memberName, ["club_name"] = clubName, ["meeting_title"] = eventName,
                ["meeting_time"] = time, ["join_link"] = link ?? "",
            };
            return (CommsTemplates.Fill(template.Subject, values, false),
                    EmailService.EMAIL_HEADER + CommsTemplates.Fill(template.BodyHtml, values, true) + EmailService.EMAIL_FOOTER);
        }
        var about = string.IsNullOrWhiteSpace(description) ? ""
            : $"<p style='color:#4A5A70;'>{E(description.Length > 1000 ? description[..1000] + "..." : description)}</p>";
        var join = link == null ? ""
            : $"<p><strong>Join online:</strong> <a href=\"{E(link)}\">{E(link)}</a></p>";
        var html = EmailService.EMAIL_HEADER + $@"
                        <p>This is a reminder that <strong>{E(clubName)}</strong> meets on <strong>{E(time)}</strong>.</p>
                        <p><strong>{E(eventName)}</strong> ({ModeLabel(mode)})</p>
                        {about}
                        {join}" + EmailService.EMAIL_FOOTER;
        var subject = $"Meeting reminder: {eventName}, {time}".Replace("\r", " ").Replace("\n", " ");
        return (subject, html);
    }
}

/// <summary>
/// Emails each active member of the club a reminder <see cref="MeetingsService.ReminderLeadHours"/> hours before a
/// meeting, with the join link for online and hybrid meetings. A (meeting, member) claim in meeting_reminder_log is
/// written before sending, so a restart or a second API instance never sends twice. Acts only while the 'meetings'
/// feature is on.
/// </summary>
public class MeetingReminderBackgroundService : BackgroundService
{
    // shortcut: at most 500 emails per 5-minute tick, the rest go on the next tick; move to a queue if clubs outgrow it.
    private const int MaxPerTick = 500;

    private readonly IServiceProvider _services;
    private readonly ILogger<MeetingReminderBackgroundService> _log;
    private readonly string _cs;

    public MeetingReminderBackgroundService(IServiceProvider services, ILogger<MeetingReminderBackgroundService> log, IConfiguration config)
    {
        _services = services;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private sealed class Due
    {
        public int AttendanceId { get; set; }
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string EventName { get; set; } = "";
        public string? Description { get; set; }
        public DateTime EventDateTime { get; set; }
        public string? MeetingMode { get; set; }
        public string? MeetingLink { get; set; }
        public int MemberId { get; set; }
        public string Email { get; set; } = "";
        public string? MemberName { get; set; }
        public string? Language { get; set; }
        public string? Tz { get; set; }
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), stop);
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var sent = await TickAsync(stop);
                if (sent > 0) _log.LogInformation("Meeting reminders: {Count} emails handed to the mailer (delivery in email_log).", sent);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Meeting reminders failed.");
            }
            await Task.Delay(TimeSpan.FromMinutes(5), stop);
        }
    }

    private async Task<int> TickAsync(CancellationToken stop)
    {
        var features = await FeatureGate.OnAsync(_cs);
        if (!features.Contains(MeetingsService.FeatureKey)) return 0;
        // N5 on: members who unsubscribed from email or whose address bounced are left out; text in the member's language.
        var comms = features.Contains(CommsService.FeatureKey);
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync(stop);
        // N12: stored UTC times are compared with UTC now (one group); wall-clock times with the local time of each
        // district zone.
        var groups = ZoneTime.StoredUtc ? new List<(string Id, TimeZoneInfo Zone)> { ("*", TimeZoneInfo.Utc) } : await ZoneTime.ZonesAsync(conn);
        var due = new List<Due>();
        foreach (var (tz, zone) in groups)
        {
            if (due.Count >= MaxPerTick) break;
            due.AddRange(await conn.QueryAsync<Due>($@"
            SELECT a.pk_attendance_id AS AttendanceId, a.fk_club_id AS ClubId, c.ClubName, a.EventName, a.Description,
                   a.EventDateTime, a.MeetingMode, a.MeetingLink,
                   m.pk_member_master_profile_id AS MemberId, m.EmailId AS Email, m.MemberName, m.PrimaryLanguage AS Language,
                   d.Timezone AS Tz
            FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
            JOIN club_members cm ON cm.fk_club_id = a.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE a.isdeleted = 0
              AND a.EventDateTime > @Now
              AND a.EventDateTime <= DATE_ADD(@Now, INTERVAL {MeetingsService.ReminderLeadHours} HOUR)
              {(tz == "*" ? "" : "AND " + ZoneTime.Filter("d"))}
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''
              AND NOT EXISTS (SELECT 1 FROM meeting_reminder_log l
                              WHERE l.fk_attendance_id = a.pk_attendance_id AND l.fk_member_id = m.pk_member_master_profile_id)
              {RotaryApi.Privacy.PrivacyConsent.BroadcastFilter()}
              {(comms ? "AND NOT " + CommsTemplates.EmailBlockedSql("m.pk_member_master_profile_id", "m.EmailId", "a.fk_club_id", "0") : "")}
            LIMIT {MaxPerTick - due.Count}", new { Now = ZoneTime.Local(zone), Tz = tz }));
        }
        if (due.Count == 0) return 0;

        using var scope = _services.CreateScope();
        var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
        var sent = 0;
        // per club for this tick: its reminder template versions and its language
        var clubTemplates = new Dictionary<int, (Dictionary<string, CommsTemplates.Template> Versions, string Language)>();
        foreach (var r in due)
        {
            if (stop.IsCancellationRequested) break;
            // Claim first: a member listed twice, a second instance or a crash after sending never sends twice.
            // shortcut: one claim per meeting and member, so a rescheduled meeting is not reminded again; key the claim
            // on the meeting time too if secretaries move meetings often.
            var claimed = await conn.ExecuteAsync(
                "INSERT IGNORE INTO meeting_reminder_log (fk_attendance_id, fk_member_id) VALUES (@A, @M)",
                new { A = r.AttendanceId, M = r.MemberId });
            if (claimed == 0) continue;
            var link = r.MeetingMode is "online" or "hybrid" ? r.MeetingLink : null;
            CommsTemplates.Template? template = null;
            if (comms)
            {
                if (!clubTemplates.TryGetValue(r.ClubId, out var ct))
                    clubTemplates[r.ClubId] = ct = (await CommsTemplates.LoadAsync(conn, r.ClubId, 0, MeetingsService.ReminderTemplateKey),
                                                    await CommsTemplates.DefaultLanguageAsync(conn, r.ClubId, 0));
                template = CommsTemplates.Pick(ct.Versions, r.Language, ct.Language);
            }
            // The time as the club reads it: a stored UTC time in the club's district zone.
            var when = ZoneTime.StoredUtc ? ZoneTime.Local(ZoneTime.Find(r.Tz), r.EventDateTime) : r.EventDateTime;
            var (subject, html) = MeetingsService.ReminderEmail(r.ClubName, r.EventName, r.Description, when, r.MeetingMode, link, template, r.MemberName);
            await email.SendScopedEmailAsync(r.Email, subject, html, r.ClubId, null);
            sent++;
        }
        return sent;
    }
}
