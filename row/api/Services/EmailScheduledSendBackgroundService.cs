using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Scans Announcement /
/// UpcomingEvent / Newsletter records (+ reminders) where IsSendEmail = 1 AND EmailSentDate IS NULL
/// AND the publish datetime has passed, then emails recipients via Brevo (IEmailService) using a
/// branded HTML body per content type. Deducts 'Email' credits after sending and marks EmailSentDate.
///
/// Recipient resolution: club / district, with the club→district→zone kill-switch; selects EmailId.
/// Projects live in year-wise tables and are handled by ProcessProjectsAsync (UNION across year tables).
/// </summary>
public class EmailScheduledSendBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<EmailScheduledSendBackgroundService> _logger;
    private readonly IConfiguration _config;
    private readonly string _connectionString;

    private const int PollIntervalSeconds = 10;
    private const int MaxConcurrencyPerRecord = 8;

    public EmailScheduledSendBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<EmailScheduledSendBackgroundService> logger,
        IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _config = config;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("EmailScheduledSendBackgroundService started");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAnnouncementsAsync(stoppingToken);
                await ProcessUpcomingEventsAsync(stoppingToken);
                await ProcessNewslettersAsync(stoppingToken);
                await ProcessProjectsAsync(stoppingToken);
                await ProcessUpcomingEventRemindersAsync(stoppingToken);
                await ProcessAnnouncementRemindersAsync(stoppingToken);
            }
            catch (Exception ex) when (IsTransientDbBlip(ex))
            {
                _logger.LogWarning("Email tick — transient DB connection blip, retrying next tick: {Msg}", ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "EmailScheduledSend tick failed");
            }
            try { await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private static bool IsTransientDbBlip(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is MySqlException my)
            {
                if (my.IsTransient) return true;
                if (my.Number is 1042 or 1043 or 2002 or 2003 or 2006 or 2013) return true;
            }
            if (e is System.Net.Sockets.SocketException) return true;
            if (e is System.IO.IOException && (e.Message.Contains("forcibly closed") || e.Message.Contains("transport connection"))) return true;
            if (e is TimeoutException) return true;
        }
        return false;
    }

    private MySqlConnection NewConn() => new(_connectionString);

    // ══════════════════════════════════════════════════════════════
    // Announcements
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessAnnouncementsAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_announcement_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
                   Title, Description, ImagePath
            FROM announcements
            WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
              AND PublishDateTime <= NOW()
            LIMIT 20")).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            var sourceName = await ResolveSourceNameAsync(conn, scope, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId);
            _logger.LogInformation("Email Announcement {Id} scope={Scope} recipients={Count}", id, scope, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("announcement", Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            var subject = $"Announcement from {sourceName}: {(string)rec.Title}";
            string html =BuildAnnouncementHtml(sourceName, (string)rec.Title, (string?)rec.Description, imgUrl);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync("announcements", "pk_announcement_id", id, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "Announcement", id, (string)rec.Title);
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Upcoming Events
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessUpcomingEventsAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
                   Title, Description, ImagePath, EventDate, EventVenue, RegistrationLink
            FROM upcoming_events
            WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
              AND PublishDate <= NOW()
            LIMIT 20")).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            var sourceName = await ResolveSourceNameAsync(conn, scope, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId);
            _logger.LogInformation("Email UpcomingEvent {Id} scope={Scope} recipients={Count}", id, scope, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("Event", Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            var link = !string.IsNullOrWhiteSpace((string?)rec.RegistrationLink) ? (string)rec.RegistrationLink : "";
            var eventDate = rec.EventDate != null ? ((DateTime)rec.EventDate).ToString("dd MMM yyyy, hh:mm tt") : "-";
            var subject = $"Upcoming Event from {sourceName}: {(string)rec.Title}";
            string html =BuildEventHtml(sourceName, (string)rec.Title, eventDate, (string?)rec.Description,
                (string?)rec.EventVenue, link, imgUrl);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync("upcoming_events", "pk_upcoming_event_id", id, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "UpcomingEvent", id, (string)rec.Title);
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Newsletters
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessNewslettersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
                   Title, AttachmentType, LinkUrl, FilePath
            FROM newsletters
            WHERE IsSendEmail = 1 AND EmailSentDate IS NULL AND isdeleted = 0
              AND PublishDateTime <= NOW()
            LIMIT 20")).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            var sourceName = await ResolveSourceNameAsync(conn, scope, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId);
            _logger.LogInformation("Email Newsletter {Id} scope={Scope} recipients={Count}", id, scope, recipients.Count);
            var link = (string?)rec.AttachmentType == "link"
                ? ((string?)rec.LinkUrl ?? "")
                : BuildAbsoluteUrl(BuildMediaPath("ebulletin", Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.FilePath));
            var subject = $"Newsletter from {sourceName}: {(string)rec.Title}";
            string html =BuildNewsletterHtml(sourceName, (string)rec.Title, link);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync("newsletters", "pk_newsletter_id", id, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "Newsletter", id, (string)rec.Title);
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Projects (year-wise: scan every year-wise table for pending rows).
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessProjectsAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        using var scope = _scopeFactory.CreateScope();
        var yearTables = scope.ServiceProvider.GetRequiredService<IYearTableResolver>();
        var tables = await yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return;

        // CONVERT/COLLATE every string column — year-wise project tables can carry different
        // default collations, so UNION ALL fails with "Illegal mix of collations" without this.
        var legs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_district_id AS DistrictId, p.fk_year_id AS YearId,
                      CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci AS Title,
                      p.project_date AS ProjectDate,
                      p.project_cost AS ProjectCost, p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours,
                      CONVERT(af.name USING utf8mb4) COLLATE utf8mb4_general_ci AS AreaOfFocus,
                      CONVERT(COALESCE(mm.ModuleKey, '') USING utf8mb4) COLLATE utf8mb4_general_ci AS ModuleKey,
                      CONVERT('{t.ProjectsTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearTable,
                      CONVERT('{t.PhotosTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS PhotosTable,
                      CONVERT('{t.YearLabel}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearLabel
               FROM `{t.ProjectsTable}` p
               LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
               LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
               WHERE p.send_email = 1 AND p.EmailSentDate IS NULL AND p.isdeleted = 0"));
        var pending = (await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({legs}) u LIMIT 20")).ToList();

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string yearTable = (string)rec.YearTable;
            string scopeStr = rec.DistrictId != null ? "district" : "club";
            var sourceName = await ResolveSourceNameAsync(conn, scopeStr, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scopeStr, (int)rec.ClubId, (int?)rec.DistrictId);
            _logger.LogInformation("Email Project {Id} scope={Scope} recipients={Count}", id, scopeStr, recipients.Count);
            // Year-wise: pk_project_id is only unique WITHIN a year table, so the link MUST carry the
            // year — without it the public page can resolve a DIFFERENT club's project that reuses the
            // same pk. The public page reads ?year= and forwards it as ?yearId=.
            var publicLink = $"{frontendUrl}/public/project/{id}?year={(int)rec.YearId}";
            var projectDate = rec.ProjectDate != null ? ((DateTime)rec.ProjectDate).ToString("dd MMM yyyy") : "-";

            // Club Service meetings: email shows only the Club Service add/edit fields + primary photo.
            if (scopeStr == "club" && ClubServiceNotification.IsClubService((string?)rec.ModuleKey))
            {
                var meeting = await ClubServiceNotification.LoadAsync(conn, yearTable, (string)rec.PhotosTable, (string)rec.YearLabel, id);
                var csSubject = $"Club Service from {sourceName}: {(string)rec.Title}";
                string csHtml = BuildClubServiceHtml(sourceName, (string)rec.Title, projectDate,
                    meeting?.MeetingType, meeting?.Description, meeting?.Attendance,
                    BuildAbsoluteUrl(meeting?.AgendaDocument), BuildAbsoluteUrl(meeting?.MinutesDocument),
                    BuildAbsoluteUrl(meeting?.PrimaryPhotoPath), publicLink);
                await SendBatchAsync(recipients, csSubject, csHtml, async (sent, failed) =>
                {
                    await MarkSentAsync(yearTable, "pk_project_id", id, sent, failed);
                    await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "Project", id, (string)rec.Title);
                }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
                continue;
            }

            var cost = rec.ProjectCost != null ? Convert.ToDecimal(rec.ProjectCost).ToString("N0") : "-";
            var ben = rec.DirectBeneficiaries != null ? rec.DirectBeneficiaries.ToString() : "-";
            var mh = rec.ManHours != null ? rec.ManHours.ToString() : "-";
            var subject = $"Project from {sourceName}: {(string)rec.Title}";
            string html = BuildProjectHtml(sourceName, (string)rec.Title, projectDate, (string?)rec.AreaOfFocus, cost, ben, mh, publicLink);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync(yearTable, "pk_project_id", id, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "Project", id, (string)rec.Title);
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // UpcomingEvent Reminders
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessUpcomingEventRemindersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS Id, r.fk_upcoming_event_id AS EventId,
                   e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId, e.Scope,
                   e.Title, e.Description, e.ImagePath, e.EventDate, e.EventVenue, e.RegistrationLink
            FROM upcoming_event_reminders r
            JOIN upcoming_events e ON e.pk_upcoming_event_id = r.fk_upcoming_event_id
            WHERE r.IsActive = 1 AND r.EmailSentDate IS NULL
              AND r.ReminderDateTime <= NOW()
              AND e.IsSendEmail = 1 AND e.isdeleted = 0
              AND e.EmailSentDate IS NOT NULL
            LIMIT 20")).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int reminderId = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            var sourceName = await ResolveSourceNameAsync(conn, scope, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("Event", Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            var link = !string.IsNullOrWhiteSpace((string?)rec.RegistrationLink) ? (string)rec.RegistrationLink : "";
            var eventDate = rec.EventDate != null ? ((DateTime)rec.EventDate).ToString("dd MMM yyyy, hh:mm tt") : "-";
            var subject = $"Reminder — Upcoming Event from {sourceName}: {(string)rec.Title}";
            string html =BuildEventHtml(sourceName, (string)rec.Title, eventDate, (string?)rec.Description,
                (string?)rec.EventVenue, link, imgUrl, isReminder: true);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync("upcoming_event_reminders", "pk_reminder_id", reminderId, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "UpcomingEventReminder", reminderId, $"Reminder for {(string)rec.Title}");
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Announcement Reminders
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessAnnouncementRemindersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS Id, r.fk_announcement_id AS AnnId,
                   a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, a.Scope,
                   a.Title, a.Description, a.ImagePath
            FROM announcement_reminders r
            JOIN announcements a ON a.pk_announcement_id = r.fk_announcement_id
            WHERE r.IsActive = 1 AND r.EmailSentDate IS NULL
              AND r.ReminderDateTime <= NOW()
              AND a.IsSendEmail = 1 AND a.isdeleted = 0
              AND a.EmailSentDate IS NOT NULL
            LIMIT 20")).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int reminderId = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            var sourceName = await ResolveSourceNameAsync(conn, scope, rec.ClubId, rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("announcement", Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            var subject = $"Reminder — Announcement from {sourceName}: {(string)rec.Title}";
            string html =BuildAnnouncementHtml(sourceName, (string)rec.Title, (string?)rec.Description, imgUrl, isReminder: true);
            await SendBatchAsync(recipients, subject, html, async (sent, failed) =>
            {
                await MarkSentAsync("announcement_reminders", "pk_reminder_id", reminderId, sent, failed);
                await DeductAfterSendAsync(rec.ClubId, rec.DistrictId, sent, "AnnouncementReminder", reminderId, $"Reminder for {(string)rec.Title}");
            }, ct, (int?)Nz(rec.ClubId), (int?)Nz(rec.DistrictId));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Recipient resolution (selects Email)
    // ══════════════════════════════════════════════════════════════
    private record Recipient(int MemberId, string MemberName, string Email);

    private static string ResolveScope(dynamic? clubId, dynamic? districtId, dynamic? scopeCol)
    {
        if (districtId != null) return "district";
        int cid = clubId != null ? (int)clubId : 0;
        if (cid > 0) return "club";
        var s = scopeCol as string;
        return string.IsNullOrWhiteSpace(s) ? "club" : s.ToLowerInvariant();
    }

    private async Task<List<Recipient>> ResolveRecipientsAsync(
        MySqlConnection conn, string scope, int clubId, int? districtId)
    {
        if (scope == "club")
        {
            // DISTINCT: a member with >1 active club_members row in the same club must be counted
            // (and charged) ONCE, not twice. District scope below already does this.
            return (await conn.QueryAsync<Recipient>(@"
                SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = @Id
                  AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND c.IsActive = 1 AND c.isdeleted = 0
                  AND d.IsActive = 1 AND d.isdeleted = 0
                  AND z.IsActive = 1 AND z.isdeleted = 0
                  AND m.isdeleted = 0
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''" + RotaryApi.Privacy.PrivacyConsent.BroadcastFilter(),
                new { Id = clubId })).ToList();
        }
        if (scope == "district")
        {
            return (await conn.QueryAsync<Recipient>(@"
                SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE c.fk_district_id = @Id
                  AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND c.IsActive = 1 AND c.isdeleted = 0
                  AND d.IsActive = 1 AND d.isdeleted = 0
                  AND z.IsActive = 1 AND z.isdeleted = 0
                  AND m.isdeleted = 0
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''" + RotaryApi.Privacy.PrivacyConsent.BroadcastFilter(),
                new { Id = districtId ?? 0 })).ToList();
        }
        return new List<Recipient>();
    }

    private async Task<string> ResolveSourceNameAsync(MySqlConnection conn, string scope, dynamic? clubId, dynamic? districtId)
    {
        try
        {
            if (scope == "club" && clubId != null)
            {
                var name = await conn.ExecuteScalarAsync<string>(
                    "SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = (int)clubId });
                return name ?? "Rotary Club";
            }
            if (scope == "district" && districtId != null)
            {
                var num = await conn.ExecuteScalarAsync<string>(
                    "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = (int)districtId });
                return $"RI District {num ?? "-"}";
            }
        }
        catch { }
        return "ROW";
    }

    private string BuildAbsoluteUrl(string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return "";
        if (relative.StartsWith("http")) return relative;
        var backend = _config["BackendUrl"] ?? "http://localhost:5000";
        return $"{backend.TrimEnd('/')}{(relative.StartsWith("/") ? relative : "/" + relative)}";
    }

    // Announcement/Event images are stored FILENAME-ONLY; the read SQL rebuilds the served path via
    // CONCAT('/Documents/{folder}/Group{id}/', file). The scheduled send MUST do the same, else the
    // image URL in the email is missing its /Documents/{folder}/Group{id}/ prefix and 404's.
    private static string? BuildMediaPath(string folder, int? clubId, int? districtId, string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return null;
        if (fileName.StartsWith("/") || fileName.StartsWith("http")) return fileName;
        if (districtId is > 0) return $"/Documents/{folder}/Group{districtId}/{fileName}";
        if (clubId is > 0) return $"/Documents/{folder}/Group{clubId}/{fileName}";
        return $"/Documents/{folder}/{fileName}";
    }

    // ══════════════════════════════════════════════════════════════
    // Send + bookkeeping
    // ══════════════════════════════════════════════════════════════
    private static int? Nz(dynamic? v)
    {
        if (v == null) return null;
        try { int i = (int)v; return i == 0 ? (int?)null : i; }
        catch { return null; }
    }

    private async Task SendBatchAsync(
        List<Recipient> recipients, string subject, string html,
        Func<int, int, Task> onComplete, CancellationToken ct,
        int? clubId = null, int? districtId = null)
    {
        if (recipients.Count == 0)
        {
            _logger.LogWarning("Email send skipped: zero recipients for '{Subject}'", subject);
            await onComplete(0, 0);
            return;
        }
        int sent = 0, failed = 0;
        using var scope = _scopeFactory.CreateScope();
        var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
        await Parallel.ForEachAsync(recipients,
            new ParallelOptions { MaxDegreeOfParallelism = MaxConcurrencyPerRecord, CancellationToken = ct },
            async (r, _) =>
            {
                try
                {
                    await email.SendScopedEmailAsync(r.Email, subject, PersonalizeGreeting(html, r.MemberName), clubId, districtId);
                    Interlocked.Increment(ref sent);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Email send failed to {Email}", r.Email);
                    Interlocked.Increment(ref failed);
                }
            });
        await onComplete(sent, failed);
    }

    // The html carries a {{NAME}} token so the per-recipient name is substituted without rebuilding the body.
    private static string PersonalizeGreeting(string html, string memberName)
        => html.Replace("{{NAME}}", WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(memberName) ? "Rotarian" : memberName));

    private async Task DeductAfterSendAsync(dynamic? clubId, dynamic? districtId, int sent, string source, int sourceId, string title)
    {
        if (sent <= 0) return;
        try
        {
            using var scopeS = _scopeFactory.CreateScope();
            int entityId = districtId != null ? (int)districtId : (clubId != null ? (int)clubId : 0);
            if (entityId <= 0) return;
            var creditSvc = scopeS.ServiceProvider.GetRequiredService<ICreditManagementService>();
            await creditSvc.DeductWithHistoryAsync(entityId, "Email", sent, source, sourceId, $"Email sent for {title}", 0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to deduct {Sent} Email credits for {Source} {Id}", sent, source, sourceId);
        }
    }

    private async Task MarkSentAsync(string table, string pk, int id, int sent, int failed)
    {
        try
        {
            using var conn = NewConn();
            await conn.OpenAsync();
            await conn.ExecuteAsync(
                $"UPDATE {table} SET EmailSentDate = NOW(), EmailSentCount = @S, EmailFailedCount = @F WHERE {pk} = @Id",
                new { S = sent, F = failed, Id = id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to mark Email sent for {Table} {Id}", table, id);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // HTML builders (branded; {{NAME}} substituted per recipient)
    // ══════════════════════════════════════════════════════════════
    private static string Esc(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string Shell(string sourceName, string heading, string innerHtml) => $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;max-width:640px;margin:0 auto'>
  <div style='background:#07294d;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0'>
    <div style='text-align:center;margin-bottom:12px'><img src='{Brand.EmailLogoUrl}' alt='ROW' style='height:77px' /></div>
    <div style='font-size:13px;opacity:.85'>{Esc(sourceName)}</div>
    <h2 style='margin:4px 0 0 0;font-size:19px'>{Esc(heading)}</h2>
  </div>
  <div style='background:#ffffff;border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 8px 8px'>
    <p style='margin:0 0 14px 0'>Dear Rtn. {{{{NAME}}}},</p>
    {innerHtml}
    <p style='margin:24px 0 0 0;color:#94a3b8;font-size:12px'>This is an automated message from ROW. For further details, please contact your Club / District leadership.</p>
  </div>
</div>";

    private static string Row(string label, string? value)
        => string.IsNullOrWhiteSpace(value) ? "" :
           $"<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>{Esc(label)}</td>" +
           $"<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top'>{Esc(value)}</td></tr>";

    private static string LinkButton(string url, string text)
        => string.IsNullOrWhiteSpace(url) ? "" :
           $"<p style='margin:16px 0 0 0'><a href='{WebUtility.HtmlEncode(url)}' style='background:#1e3a8a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block'>{Esc(text)}</a></p>";

    private static string Image(string url)
        => string.IsNullOrWhiteSpace(url) ? "" :
           $"<p style='margin:0 0 16px 0'><img src='{WebUtility.HtmlEncode(url)}' alt='' style='max-width:100%;border-radius:6px'/></p>";

    private static string BuildEventHtml(string sourceName, string title, string eventDate, string? details,
        string? venue, string? regLink, string? imageUrl, bool isReminder = false)
    {
        var heading = isReminder ? $"Reminder: {title}" : title;
        var inner =
            $"<p style='margin:0 0 14px 0'>You are invited to an upcoming event organized by <strong>{Esc(sourceName)}</strong>:</p>" +
            Image(imageUrl ?? "") +
            "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
            Row("Event", title) + Row("Date", eventDate) + Row("Venue", venue) + Row("Details", details) +
            "</table>" +
            LinkButton(regLink ?? "", "Register / More details");
        return Shell(sourceName, heading, inner);
    }

    private static string BuildAnnouncementHtml(string sourceName, string title, string? description, string? imageUrl, bool isReminder = false)
    {
        var heading = isReminder ? $"Reminder: {title}" : title;
        var inner =
            $"<p style='margin:0 0 14px 0'>An announcement from <strong>{Esc(sourceName)}</strong>:</p>" +
            Image(imageUrl ?? "") +
            (string.IsNullOrWhiteSpace(description) ? "" : $"<div style='margin:0 0 8px 0'>{Esc(description)}</div>");
        return Shell(sourceName, heading, inner);
    }

    private static string BuildNewsletterHtml(string sourceName, string title, string? link)
    {
        var inner =
            $"<p style='margin:0 0 14px 0'><strong>{Esc(sourceName)}</strong> has published a new newsletter:</p>" +
            $"<p style='margin:0 0 8px 0;font-size:16px'><strong>{Esc(title)}</strong></p>" +
            LinkButton(link ?? "", "View / Download newsletter");
        return Shell(sourceName, $"Newsletter: {title}", inner);
    }

    private static string BuildProjectHtml(string sourceName, string title, string projectDate, string? areaOfFocus,
        string? cost, string? beneficiaries, string? manHours, string publicLink)
    {
        var inner =
            $"<p style='margin:0 0 14px 0'>A project update from <strong>{Esc(sourceName)}</strong>:</p>" +
            "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
            Row("Project", title) + Row("Date", projectDate) + Row("Area of Focus", areaOfFocus) +
            Row("Project Cost", cost) + Row("Direct Beneficiaries", beneficiaries) + Row("Man Hours", manHours) +
            "</table>" +
            LinkButton(publicLink, "View project");
        return Shell(sourceName, $"Project: {title}", inner);
    }

    // Club Service meeting — only the fields on the Club Service add/edit form (Title, Date, Meeting
    // Type, Description, Attendance, Agenda, Minutes) plus the primary photo.
    private static string BuildClubServiceHtml(string sourceName, string title, string meetingDate,
        string? meetingType, string? description, string? attendance,
        string? agendaUrl, string? minutesUrl, string? photoUrl, string publicLink)
    {
        static string DocLink(string label, string? url)
            => string.IsNullOrWhiteSpace(url) ? "" :
               $"<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>{Esc(label)}</td>" +
               $"<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top'><a href='{WebUtility.HtmlEncode(url)}' style='color:#1e3a8a'>Download</a></td></tr>";

        var descRow = string.IsNullOrWhiteSpace(description) ? "" :
            $"<tr><td style='padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;width:140px;vertical-align:top'>Description</td>" +
            $"<td style='padding:6px 12px;border:1px solid #e2e8f0;vertical-align:top;white-space:pre-line'>{Esc(description)}</td></tr>";

        var inner =
            $"<p style='margin:0 0 14px 0'>A club meeting from <strong>{Esc(sourceName)}</strong>:</p>" +
            Image(photoUrl ?? "") +
            "<table style='border-collapse:collapse;width:100%;border:1px solid #e2e8f0'>" +
            Row("Meeting", title) + Row("Date", meetingDate) + Row("Meeting Type", meetingType) +
            descRow + Row("Attendance", attendance) +
            DocLink("Agenda", agendaUrl) + DocLink("Minutes of Meeting", minutesUrl) +
            "</table>" +
            LinkButton(publicLink, "View Club Service");
        return Shell(sourceName, $"Club Service: {title}", inner);
    }
}
