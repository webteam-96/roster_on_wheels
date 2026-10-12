using System.Data;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Periodically scans Announcement / UpcomingEvent / Newsletter / Project records where
/// IsSendWhatsapp=1 AND WhatsAppSentDate IS NULL AND (PublishDate|PublishDateTime) has passed,
/// then sends WhatsApp messages to recipients via Interakt using the right template per scope.
/// Credits were already deducted at save; the scheduler only sends and marks sent.
/// </summary>
public class WhatsAppScheduledSendBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WhatsAppScheduledSendBackgroundService> _logger;
    private readonly IConfiguration _config;
    private readonly string _connectionString;

    private const int PollIntervalSeconds = 5;
    private const int MaxConcurrencyPerRecord = 10;

    // Interakt rate limit: 300 messages/minute. We send in chunks of BulkBatchSize, then pause
    // BulkBatchIntervalSeconds before the next chunk, so we never trip "Rate limit exceeded".
    // Configurable in appsettings (Interakt:BulkBatchSize / BulkBatchIntervalSeconds) so the
    // ceiling can be raised without a code change if Interakt lifts the limit.
    private readonly int _batchSize;
    private readonly int _batchIntervalSeconds;
    // Transient-failure auto-retry (429 / 5xx / network) — a bad number (400) is NOT retried.
    private const int MaxSendRetries = 3;
    private const int RetryBackoffSeconds = 3;

    // Template map: scope -> template name
    private static readonly Dictionary<string, string> AnnouncementTemplates = new()
    {
        { "club", "rotary_club_announcement_26" },
        { "district", "rotary_district_announcement_26_up" },
        { "ri", "rotary_admin_announcement_26_1" },
    };

    // ── Announcement description budget ───────────────────────────────────────────────
    // A rendered WhatsApp template body may hold 600 characters IN TOTAL: the template's own
    // static text plus every substituted {{n}}. An announcement Description is free text up to
    // 1000 chars (Announcements.txt), so long ones overflow and Meta rejects the send. The only
    // field we may shorten is the Description, so its budget is computed per send as
    //     600 − AnnouncementStaticChars − (memberName + sourceName + title + imageUrl + imageUrl)
    //
    // ASSUMPTION — the approved body text is NOT in this repo or the database (grep finds only the
    // template NAMES; there is no template table). It lives solely in the Interakt/Meta template
    // manager. The skeleton below is a best-effort reconstruction used ONLY to size the static
    // text; all three announcement templates share the same 6-parameter shape, so one figure
    // covers club/district/RI. When the exact approved body is available, paste it in verbatim
    // (placeholders included) and the budget re-derives itself — no other change needed.
    // Real approved template body (club variant; district/RI share the same 5-param shape).
    // Used only to size the {{4}} Details budget — 5 params: {{1}} name, {{2}} club/district,
    // {{3}} title, {{4}} details, {{5}} image. (Was 6 params with a duplicate image/link slot.)
    private const string AnnouncementTemplateSkeleton =
        """
        Club Announcement
        Dear Rtn. {{1}},
        This is to inform you that your club, RC {{2}}, has posted a new announcement. Please find the details below:
        Title: {{3}}
        Details: {{4}}
        Announcement Image (if applicable): {{5}}
        This is an automated notification from the system. For any queries, please contact your Club Leaders.
        """;

    private static readonly int AnnouncementStaticChars =
        WhatsAppTemplateText.StaticChars(AnnouncementTemplateSkeleton);
    private static readonly Dictionary<string, string> EventTemplates = new()
    {
        { "club", "rotary_club_upcoming_event_26" },
        { "district", "rotary_district_upcoming_event_26" },
        { "ri", "rotary_admin_upcoming_event_25" },
    };
    private static readonly Dictionary<string, string> NewsletterTemplates = new()
    {
        { "club", "rotary_club_newsletter_25" },
        { "district", "rotary_district_newsletter_25" },
        // { "ri", "pending" } — not yet
    };
    private static readonly Dictionary<string, string> ProjectTemplates = new()
    {
        { "club", "ri_project_template" },
        { "district", "ri_district_projects_25_8l" },
        // no RI project template
    };

    public WhatsAppScheduledSendBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<WhatsAppScheduledSendBackgroundService> logger,
        IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _config = config;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _batchSize = Math.Max(1, config.GetValue("Interakt:BulkBatchSize", 300));
        _batchIntervalSeconds = Math.Max(0, config.GetValue("Interakt:BulkBatchIntervalSeconds", 60));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("WhatsAppScheduledSendBackgroundService started");
        await CleanupStuckRecordsAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Each module is isolated: one failing record must not stop the modules behind it.
                await RunStepAsync("Announcements", () => ProcessAnnouncementsAsync(stoppingToken));
                await RunStepAsync("UpcomingEvents", () => ProcessUpcomingEventsAsync(stoppingToken));
                await RunStepAsync("Newsletters", () => ProcessNewslettersAsync(stoppingToken));
                await RunStepAsync("Projects", () => ProcessProjectsAsync(stoppingToken));
                await RunStepAsync("AnnouncementReminders", () => ProcessAnnouncementRemindersAsync(stoppingToken));
                await RunStepAsync("EventReminders", () => ProcessUpcomingEventRemindersAsync(stoppingToken));
            }
            catch (Exception ex) when (IsTransientDbBlip(ex))
            {
                // Transient remote-DB connection drop (idle pool socket killed by server/firewall).
                // Pool will hand out a fresh connection on the next tick — no action needed.
                // Demoted to Warning to avoid false-alarm error logs.
                _logger.LogWarning("WhatsApp tick — transient DB connection blip, retrying next tick: {Msg}", ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "WhatsAppScheduledSend tick failed");
            }
            await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds), stoppingToken);
        }
    }

    // One module's failure is logged and left for the next poll; the others still run. Without this a
    // single bad row stalls every WhatsApp send in the system (see the 2026-09-18 district announcement,
    // which blocked the queue for six days).
    private async Task RunStepAsync(string step, Func<Task> work)
    {
        try { await work(); }
        catch (Exception ex) when (IsTransientDbBlip(ex))
        {
            _logger.LogWarning("WhatsApp {Step} — transient DB blip, retrying next tick: {Msg}", step, ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WhatsApp {Step} failed; other modules continue", step);
        }
    }

    /// <summary>True for transient MySQL connection drops we shouldn't alert on.</summary>
    private static bool IsTransientDbBlip(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is MySqlException my)
            {
                if (my.IsTransient) return true;
                // 1042 = unable to connect, 0 = generic socket-level errors get bubbled up here too
                if (my.Number == 1042 || my.Number == 1043 || my.Number == 2002 || my.Number == 2003 || my.Number == 2006 || my.Number == 2013) return true;
            }
            if (e is System.Net.Sockets.SocketException) return true;
            if (e is System.IO.IOException && (e.Message.Contains("forcibly closed") || e.Message.Contains("transport connection"))) return true;
            if (e is TimeoutException) return true;
            if (e.Message != null && (e.Message.Contains("Connect Timeout") || e.Message.Contains("Couldn't connect to server") || e.Message.Contains("forcibly closed"))) return true;
        }
        return false;
    }

    private MySqlConnection NewConn() => new(_connectionString);

    // One-time cleanup: clear WhatsAppSentDate on records where it was set BEFORE PublishDate (bogus state from old pre-UTC-fix bug)
    private async Task CleanupStuckRecordsAsync(CancellationToken ct)
    {
        try
        {
            using var conn = NewConn();
            await conn.OpenAsync(ct);
            int fixedA = await conn.ExecuteAsync(@"
                UPDATE announcements SET WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0
                WHERE WhatsAppSentDate IS NOT NULL AND WhatsAppSentDate < PublishDateTime");
            int fixedE = await conn.ExecuteAsync(@"
                UPDATE upcoming_events SET WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0
                WHERE WhatsAppSentDate IS NOT NULL AND WhatsAppSentDate < PublishDate");
            int fixedN = await conn.ExecuteAsync(@"
                UPDATE newsletters SET WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0
                WHERE WhatsAppSentDate IS NOT NULL AND WhatsAppSentDate < PublishDateTime");
            if (fixedA + fixedE + fixedN > 0)
                _logger.LogInformation("Cleanup: reset {A} announcements, {E} events, {N} newsletters stuck with bogus SentDate", fixedA, fixedE, fixedN);
        }
        catch (Exception ex) { _logger.LogError(ex, "CleanupStuckRecords failed"); }
    }

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
                   Title, Description, ImagePath,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
            FROM announcements
            WHERE IsSendWhatsapp = 1 AND WhatsAppSentDate IS NULL AND isdeleted = 0
              AND PublishDateTime <= NOW()" + WhatsAppPilot.SqlFilter(WhatsAppPilot.Module.Announcement) + @"
            LIMIT 20", WhatsAppPilot.Params)).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            if (!AnnouncementTemplates.TryGetValue(scope, out var template))
            {
                _logger.LogWarning("Announcement {Id}: unknown scope '{Scope}', skipping", id, scope);
                await MarkSentAsync("announcements", "pk_announcement_id", id, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scope, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId,
                (string?)rec.RecipientTarget, (string?)rec.RecipientZoneIds, (string?)rec.RecipientDistrictIds, (string?)rec.RecipientSubgroupIds);
            _logger.LogInformation("Announcement {Id} scope={Scope} recipients={Count}", id, scope, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("announcement", scope, Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            // Normalise once (newlines/HTML/entities); only the recipient's name changes the
            // remaining budget, so the per-recipient step is just the word-boundary cut.
            var title = (string)rec.Title;
            var descClean = WhatsAppTemplateText.Normalise((string?)rec.Description);
            // {{2}} = bare entity name: club name, or district NUMBER (the template text already
            // says "RC"/"District"), so strip the "District " prefix sourceName carries for districts.
            var waSource = sourceName.StartsWith("District ") ? sourceName["District ".Length..] : sourceName;
            if (scope == "club" || scope == "district")
            {
                await SendCommsMessageBatchAsync(WhatsAppCommsTemplates.Announcement(scope == "district", (string)sourceName, title,
                    (string?)rec.Description, (string)imgUrl), recipients, async (sent, failed) => {
                    await MarkSentAsync("announcements", "pk_announcement_id", id, sent, failed);
                    await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "Announcement", id, (string)rec.Title);
                }, ct, new WhatsAppLogContext("Announcement", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
                continue;
            }
            // RI: 5-param templates: {{1}} name, {{2}} club/district, {{3}} title, {{4}} details, {{5}} image.
            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, waSource, title,
                WhatsAppTemplateText.FitNormalisedText(descClean, AnnouncementStaticChars,
                    m.MemberName, waSource, title, imgUrl),
                imgUrl
            }, async (sent, failed) => {
                await MarkSentAsync("announcements", "pk_announcement_id", id, sent, failed);
                await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "Announcement", id, (string)rec.Title);
            }, ct, new WhatsAppLogContext("Announcement", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
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
                   Title, Description, ImagePath, EventDate, EventVenue, RegistrationLink,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
            FROM upcoming_events
            WHERE IsSendWhatsapp = 1 AND WhatsAppSentDate IS NULL AND isdeleted = 0
              AND PublishDate <= NOW()" + WhatsAppPilot.SqlFilter(WhatsAppPilot.Module.Event) + @"
            LIMIT 20", WhatsAppPilot.Params)).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            if (!EventTemplates.TryGetValue(scope, out var template))
            {
                _logger.LogWarning("UpcomingEvent {Id}: unknown scope '{Scope}', skipping", id, scope);
                await MarkSentAsync("upcoming_events", "pk_upcoming_event_id", id, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scope, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId,
                (string?)rec.RecipientTarget, (string?)rec.RecipientZoneIds, (string?)rec.RecipientDistrictIds, (string?)rec.RecipientSubgroupIds);
            _logger.LogInformation("UpcomingEvent {Id} scope={Scope} clubId={ClubId} recipients={Count}", id, scope, (int)rec.ClubId, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("Event", scope, Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            // No registration link → send an EMPTY link, not the image URL (don't show a bogus reg link).
            var link = !string.IsNullOrWhiteSpace((string?)rec.RegistrationLink) ? (string)rec.RegistrationLink : "";
            var eventDate = ((DateTime)rec.EventDate).ToString("dd MMM yyyy hh:mm tt");
            if (scope == "club" || scope == "district")
            {
                await SendCommsMessageBatchAsync(WhatsAppCommsTemplates.Event(scope == "district", (string)sourceName, (string)rec.Title,
                    (DateTime)rec.EventDate, (string?)rec.Description, (string?)rec.EventVenue, link, (string)imgUrl), recipients, async (sent, failed) => {
                    await MarkSentAsync("upcoming_events", "pk_upcoming_event_id", id, sent, failed);
                    await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEvent", id, (string)rec.Title);
                }, ct, new WhatsAppLogContext("UpcomingEvent", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
                continue;
            }
            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, sourceName, (string)rec.Title, eventDate,
                ((string?)rec.Description) ?? "", ((string?)rec.EventVenue) ?? "-",
                link, imgUrl
            }, async (sent, failed) => {
                await MarkSentAsync("upcoming_events", "pk_upcoming_event_id", id, sent, failed);
                await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEvent", id, (string)rec.Title);
            }, ct, new WhatsAppLogContext("UpcomingEvent", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Newsletters
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessNewslettersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        // Same pilot gate as announcements and events: while the newsletter templates are new, only the
        // pilot club (and RI-scope rows, which carry neither id) are picked up.
        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_newsletter_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId,
                   COALESCE(Scope, IF(fk_district_id IS NOT NULL, 'district', 'club')) AS Scope,
                   Title, AttachmentType, LinkUrl, FilePath,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
            FROM newsletters
            WHERE IsSendWhatsapp = 1 AND WhatsAppSentDate IS NULL AND isdeleted = 0
              AND PublishDateTime <= NOW()" + WhatsAppPilot.SqlFilter(WhatsAppPilot.Module.Newsletter) + @"
            LIMIT 20", WhatsAppPilot.Params)).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            if (!NewsletterTemplates.TryGetValue(scope, out var template))
            {
                _logger.LogWarning("Newsletter {Id}: unknown scope '{Scope}', skipping", id, scope);
                await MarkSentAsync("newsletters", "pk_newsletter_id", id, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scope, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId,
                (string?)rec.RecipientTarget, (string?)rec.RecipientZoneIds, (string?)rec.RecipientDistrictIds, (string?)rec.RecipientSubgroupIds);
            _logger.LogInformation("Newsletter {Id} scope={Scope} recipients={Count}", id, scope, recipients.Count);
            bool isLink = (string?)rec.AttachmentType == "link";
            // `string`, NOT `var`: keeps the dynamic-ness of the BuildMediaPath chain from
            // travelling into the SendCommsMessageBatchAsync call below, the way every other
            // module here does it (see `(string)imgUrl` in the announcement and event branches).
            string link = isLink
                ? ((string?)rec.LinkUrl ?? "")
                : (string)BuildAbsoluteUrl(BuildMediaPath("ebulletin", scope, Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.FilePath));

            // Plain locals, not dynamic: a method group cannot be passed to a dynamically dispatched call.
            string title = (string)rec.Title;
            // `?? 0` is load-bearing. Nz returns int? (null for null AND for 0), and a CLUB
            // newsletter has fk_district_id = NULL, so Nz(rec.DistrictId) is null. Assigning that
            // to a plain int threw RuntimeBinderException "Cannot convert null to 'int'" on the
            // FIRST newsletter of every poll, which RunStepAsync caught and logged - so club
            // newsletters sent nothing at all from 24 Sep (the day this branch went in) until this
            // fix, while announcements and events kept flowing. The compiler could not catch it:
            // the dynamic argument makes the call dynamically dispatched, so the int? -> int
            // conversion is only checked at runtime. Announcements and events pass the same Nz
            // results straight into int?-typed parameters, which is why they never hit it.
            // 0 = "none" is the contract the two uses below already expect.
            int clubIdForSend = Nz(rec.ClubId) ?? 0, districtIdForSend = Nz(rec.DistrictId) ?? 0;
            Func<int, int, Task> finish = async (sent, failed) =>
            {
                await MarkSentAsync("newsletters", "pk_newsletter_id", id, sent, failed);
                await DeductAfterSendAsync(scope, clubIdForSend, districtIdForSend == 0 ? null : districtIdForSend,
                    sent, "Newsletter", id, title);
            };
            var logCtx = new WhatsAppLogContext("Newsletter", id, title, clubIdForSend, districtIdForSend);

            // Club newsletters use the new approved templates (user 2026-09-24): a saved LINK goes in the
            // body, an attached PDF rides in the template's document header. District newsletters stay on
            // the old text template until theirs is approved, so they are untouched here.
            if (scope == "club")
            {
                await SendCommsMessageBatchAsync(
                    WhatsAppCommsTemplates.ClubNewsletter(sourceName, title,
                        isLink ? link : null, isLink ? null : link),
                    recipients, finish, ct, logCtx);
                continue;
            }

            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, sourceName, (string)rec.Title, link
            }, async (sent, failed) => {
                await MarkSentAsync("newsletters", "pk_newsletter_id", id, sent, failed);
                await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "Newsletter", id, (string)rec.Title);
            }, ct, new WhatsAppLogContext("Newsletter", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Projects (year-wise: scan every year-wise table for pending rows)
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessProjectsAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        // Resolve every existing year-wise table; build a UNION ALL across them.
        // Each leg also carries its own ProjectsTable name so MarkSentAsync hits the right year.
        using var scope = _scopeFactory.CreateScope();
        var yearTables = scope.ServiceProvider.GetRequiredService<IYearTableResolver>();
        var tables = await yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return;

        // CONVERT(... USING utf8mb4) COLLATE utf8mb4_general_ci on every string
        // column — year-wise project tables can have different default collations
        // (e.g. utf8mb4_unicode_ci vs utf8mb4_general_ci), and UNION ALL fails
        // with "Illegal mix of collations" without explicit normalisation.
        var legs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT p.pk_project_id AS Id, p.fk_club_id AS ClubId, p.fk_district_id AS DistrictId, p.fk_year_id AS YearId,
                      CONVERT(COALESCE(p.DistrictProjectType, IF(p.fk_district_id IS NOT NULL, 'district', 'club')) USING utf8mb4) COLLATE utf8mb4_general_ci AS ScopeRaw,
                      CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci AS Title,
                      p.project_date AS ProjectDate,
                      p.project_cost AS ProjectCost, p.direct_beneficiaries AS DirectBeneficiaries, p.man_hours AS ManHours,
                      CONVERT(af.name USING utf8mb4) COLLATE utf8mb4_general_ci AS AreaOfFocus,
                      CONVERT('{t.ProjectsTable}' USING utf8mb4) COLLATE utf8mb4_general_ci AS YearTable
               FROM `{t.ProjectsTable}` p
               LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
               WHERE p.send_whatsapp = 1 AND p.WhatsAppSentDate IS NULL AND p.isdeleted = 0
                 AND (p.approval_status IS NULL OR p.approval_status = 'approved')"));
        var pending = (await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({legs}) u LIMIT 20")).ToList();

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int id = (int)rec.Id;
            string yearTable = (string)rec.YearTable;
            string scopeStr = rec.DistrictId != null ? "district" : "club";
            if (!ProjectTemplates.TryGetValue(scopeStr, out var template))
            {
                await MarkSentAsync(yearTable, "pk_project_id", id, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scopeStr, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scopeStr, (int)rec.ClubId, (int?)rec.DistrictId, null, null, null, null);
            _logger.LogInformation("Project {Id} scope={Scope} recipients={Count}", id, scopeStr, recipients.Count);
            // Year-wise: pk_project_id is only unique WITHIN a year table, so the link MUST carry the
            // year — without it the public page scans year tables and can resolve a DIFFERENT club's
            // project that reuses the same pk. The public page reads ?year= and forwards it as ?yearId=.
            var publicLink = $"{frontendUrl}/public/project/{id}?year={(int)rec.YearId}";
            var projectDate = rec.ProjectDate != null ? ((DateTime)rec.ProjectDate).ToString("dd MMM yyyy") : "-";
            var cost = rec.ProjectCost != null ? Convert.ToDecimal(rec.ProjectCost).ToString("N0") : "-";
            var ben = rec.DirectBeneficiaries != null ? rec.DirectBeneficiaries.ToString() : "-";
            var mh = rec.ManHours != null ? rec.ManHours.ToString() : "-";
            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, sourceName, (string)rec.Title, projectDate,
                ((string?)rec.AreaOfFocus) ?? "-", cost, ben, mh, publicLink
            }, async (sent, failed) => {
                await MarkSentAsync(yearTable, "pk_project_id", id, sent, failed);
                await DeductAfterSendAsync(scopeStr, rec.ClubId, rec.DistrictId, sent, "Project", id, (string)rec.Title);
            }, ct, new WhatsAppLogContext("Project", id, (string)rec.Title, Nz(rec.ClubId), Nz(rec.DistrictId)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // UpcomingEvent Reminders (repeat notifications)
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessUpcomingEventRemindersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS Id, r.fk_upcoming_event_id AS EventId, r.ReminderDateTime,
                   e.fk_club_id AS ClubId, e.fk_district_id AS DistrictId, e.Scope,
                   e.Title, e.Description, e.ImagePath, e.EventDate, e.EventVenue, e.RegistrationLink,
                   e.RecipientTarget, e.RecipientZoneIds, e.RecipientDistrictIds, e.RecipientSubgroupIds
            FROM upcoming_event_reminders r
            JOIN upcoming_events e ON e.pk_upcoming_event_id = r.fk_upcoming_event_id
            WHERE r.IsActive = 1 AND r.WhatsAppSentDate IS NULL
              AND r.ReminderDateTime <= NOW()
              AND e.IsSendWhatsapp = 1 AND e.isdeleted = 0
              AND e.WhatsAppSentDate IS NOT NULL" + WhatsAppPilot.SqlFilter(WhatsAppPilot.Module.Event, "e") + @"
            LIMIT 20", WhatsAppPilot.Params)).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int reminderId = (int)rec.Id;
            int eventId = (int)rec.EventId;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            if (!EventTemplates.TryGetValue(scope, out var template))
            {
                await MarkSentAsync("upcoming_event_reminders", "pk_reminder_id", reminderId, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scope, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId,
                (string?)rec.RecipientTarget, (string?)rec.RecipientZoneIds, (string?)rec.RecipientDistrictIds, (string?)rec.RecipientSubgroupIds);
            _logger.LogInformation("EventReminder {Rid} event={Eid} scope={Scope} recipients={Count}", reminderId, eventId, scope, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("Event", scope, Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            // No registration link → send an EMPTY link, not the image URL (don't show a bogus reg link).
            var link = !string.IsNullOrWhiteSpace((string?)rec.RegistrationLink) ? (string)rec.RegistrationLink : "";
            var eventDate = ((DateTime)rec.EventDate).ToString("dd MMM yyyy hh:mm tt");
            if (scope == "club" || scope == "district")
            {
                await SendCommsMessageBatchAsync(WhatsAppCommsTemplates.Event(scope == "district", (string)sourceName, (string)rec.Title,
                    (DateTime)rec.EventDate, (string?)rec.Description, (string?)rec.EventVenue, link, (string)imgUrl), recipients, async (sent, failed) => {
                    await MarkSentAsync("upcoming_event_reminders", "pk_reminder_id", reminderId, sent, failed);
                    await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEventReminder", reminderId, $"Reminder for {(string)rec.Title}");
                }, ct, new WhatsAppLogContext("UpcomingEventReminder", reminderId, $"Reminder for {(string)rec.Title}", Nz(rec.ClubId), Nz(rec.DistrictId)));
                continue;
            }
            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, sourceName, (string)rec.Title, eventDate,
                ((string?)rec.Description) ?? "", ((string?)rec.EventVenue) ?? "-",
                link, imgUrl
            }, async (sent, failed) => {
                await MarkSentAsync("upcoming_event_reminders", "pk_reminder_id", reminderId, sent, failed);
                await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "UpcomingEventReminder", reminderId, $"Reminder for {(string)rec.Title}");
            }, ct, new WhatsAppLogContext("UpcomingEventReminder", reminderId, $"Reminder for {(string)rec.Title}", Nz(rec.ClubId), Nz(rec.DistrictId)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Announcement Reminders (repeat notifications)
    // ══════════════════════════════════════════════════════════════
    private async Task ProcessAnnouncementRemindersAsync(CancellationToken ct)
    {
        using var conn = NewConn();
        await conn.OpenAsync(ct);

        var pending = (await conn.QueryAsync<dynamic>(@"
            SELECT r.pk_reminder_id AS Id, r.fk_announcement_id AS AnnId, r.ReminderDateTime,
                   a.fk_club_id AS ClubId, a.fk_district_id AS DistrictId, a.Scope,
                   a.Title, a.Description, a.ImagePath,
                   a.RecipientTarget, a.RecipientZoneIds, a.RecipientDistrictIds, a.RecipientSubgroupIds
            FROM announcement_reminders r
            JOIN announcements a ON a.pk_announcement_id = r.fk_announcement_id
            WHERE r.IsActive = 1 AND r.WhatsAppSentDate IS NULL
              AND r.ReminderDateTime <= NOW()
              AND a.IsSendWhatsapp = 1 AND a.isdeleted = 0
              AND a.WhatsAppSentDate IS NOT NULL" + WhatsAppPilot.SqlFilter(WhatsAppPilot.Module.Announcement, "a") + @"
            LIMIT 20", WhatsAppPilot.Params)).ToList();

        foreach (var rec in pending)
        {
            if (ct.IsCancellationRequested) break;
            int reminderId = (int)rec.Id;
            int annId = (int)rec.AnnId;
            string scope = ResolveScope(rec.ClubId, rec.DistrictId, rec.Scope);
            if (!AnnouncementTemplates.TryGetValue(scope, out var template))
            {
                await MarkSentAsync("announcement_reminders", "pk_reminder_id", reminderId, 0, 0);
                continue;
            }
            string sourceName = await ResolveSourceNameAsync(conn, scope, (int?)rec.ClubId, (int?)rec.DistrictId);
            var recipients = await ResolveRecipientsAsync(conn, scope, (int)rec.ClubId, (int?)rec.DistrictId,
                (string?)rec.RecipientTarget, (string?)rec.RecipientZoneIds, (string?)rec.RecipientDistrictIds, (string?)rec.RecipientSubgroupIds);
            _logger.LogInformation("AnnouncementReminder {Rid} ann={Aid} scope={Scope} recipients={Count}", reminderId, annId, scope, recipients.Count);
            var imgUrl = BuildAbsoluteUrl(BuildMediaPath("announcement", scope, Nz(rec.ClubId), Nz(rec.DistrictId), (string?)rec.ImagePath));
            // Same 600-char body budget as the first send — see AnnouncementTemplateSkeleton.
            var title = (string)rec.Title;
            var descClean = WhatsAppTemplateText.Normalise((string?)rec.Description);
            var waSource = sourceName.StartsWith("District ") ? sourceName["District ".Length..] : sourceName;
            if (scope == "club" || scope == "district")
            {
                await SendCommsMessageBatchAsync(WhatsAppCommsTemplates.Announcement(scope == "district", (string)sourceName, title,
                    (string?)rec.Description, (string)imgUrl), recipients, async (sent, failed) => {
                    await MarkSentAsync("announcement_reminders", "pk_reminder_id", reminderId, sent, failed);
                    await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "AnnouncementReminder", reminderId, $"Reminder for {(string)rec.Title}");
                }, ct, new WhatsAppLogContext("AnnouncementReminder", reminderId, $"Reminder for {(string)rec.Title}", Nz(rec.ClubId), Nz(rec.DistrictId)));
                continue;
            }
            await SendBatchAsync(recipients, template, (m) => new string[] {
                m.MemberName, waSource, title,
                WhatsAppTemplateText.FitNormalisedText(descClean, AnnouncementStaticChars,
                    m.MemberName, waSource, title, imgUrl),
                imgUrl
            }, async (sent, failed) => {
                await MarkSentAsync("announcement_reminders", "pk_reminder_id", reminderId, sent, failed);
                await DeductAfterSendAsync(scope, rec.ClubId, rec.DistrictId, sent, "AnnouncementReminder", reminderId, $"Reminder for {(string)rec.Title}");
            }, ct, new WhatsAppLogContext("AnnouncementReminder", reminderId, $"Reminder for {(string)rec.Title}", Nz(rec.ClubId), Nz(rec.DistrictId)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════
    private record Recipient(int MemberId, string MemberName, string Mobile);

    // Authoritative scope from foreign keys; fall back to Scope column only if both FKs missing.
    private static string ResolveScope(dynamic? clubId, dynamic? districtId, dynamic? scopeCol)
    {
        if (districtId != null) return "district";
        int cid = clubId != null ? (int)clubId : 0;
        if (cid > 0) return "club";
        var s = scopeCol as string;
        return string.IsNullOrWhiteSpace(s) ? "club" : s.ToLowerInvariant();
    }

    private async Task<List<Recipient>> ResolveRecipientsAsync(
        MySqlConnection conn, string scope, int clubId, int? districtId,
        string? target, string? zoneIdsStr, string? districtIdsStr, string? subgroupIdsStr)
    {
        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        if (scope == "club")
        {
            // DISTINCT: a member with >1 active club_members row in the same club must be counted
            // (and charged) ONCE, not twice. District scope below already does this.
            return (await conn.QueryAsync<Recipient>(@"
                SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.PrimaryMobileNumber AS Mobile
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
                  AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''",
                new { Id = clubId })).ToList();
        }
        if (scope == "district")
        {
            return (await conn.QueryAsync<Recipient>(@"
                SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.PrimaryMobileNumber AS Mobile
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
                  AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''",
                new { Id = districtId ?? 0 })).ToList();
        }
        // RI scope: expand by RecipientTarget
        return await ResolveRiRecipientsAsync(conn, target ?? "all", zoneIdsStr, districtIdsStr, subgroupIdsStr);
    }

    private async Task<List<Recipient>> ResolveRiRecipientsAsync(
        MySqlConnection conn, string target, string? zoneIdsStr, string? districtIdsStr, string? subgroupIdsStr)
    {
        int[] Parse(string? s) => string.IsNullOrWhiteSpace(s) ? Array.Empty<int>()
            : s.Split(',').Select(x => int.TryParse(x.Trim(), out var v) ? v : 0).Where(v => v > 0).ToArray();

        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        string baseSql = @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.PrimaryMobileNumber AS Mobile
                           FROM member_master_profile m
                           JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                           JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                           JOIN district_master d ON d.pk_district_id = c.fk_district_id
                           JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                           WHERE cm.IsActive = 1 AND cm.isdeleted = 0
                             AND c.IsActive = 1 AND c.isdeleted = 0
                             AND d.IsActive = 1 AND d.isdeleted = 0
                             AND z.IsActive = 1 AND z.isdeleted = 0
                             AND m.isdeleted = 0
                             AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''";
        object? prm = null;
        string filter;
        switch (target.ToLowerInvariant())
        {
            case "zones":
                var zids = Parse(zoneIdsStr);
                if (zids.Length == 0) return new List<Recipient>();
                filter = " AND d.fk_zone_id IN @ZoneIds";
                prm = new { ZoneIds = zids };
                break;
            case "districts":
                var dids = Parse(districtIdsStr);
                if (dids.Length == 0) return new List<Recipient>();
                filter = " AND c.fk_district_id IN @DistrictIds";
                prm = new { DistrictIds = dids };
                break;
            case "subgroups":
                var sgids = Parse(subgroupIdsStr);
                if (sgids.Length == 0) return new List<Recipient>();
                // members are picked from sub_group_members
                return (await conn.QueryAsync<Recipient>(@"
                    SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.PrimaryMobileNumber AS Mobile
                    FROM sub_group_members sm
                    JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
                    WHERE sm.fk_sub_group_id IN @Ids AND sm.isdeleted = 0 AND m.isdeleted = 0
                      AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''",
                    new { Ids = sgids })).ToList();
            default:
                filter = "";
                prm = new { };
                break;
        }
        return (await conn.QueryAsync<Recipient>(baseSql + filter, prm)).ToList();
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
                return $"District {num ?? "-"}";
            }
        }
        catch { }
        return scope == "ri" ? "RI Director" : "ROW";
    }

    private string BuildAbsoluteUrl(string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return "";
        if (relative.StartsWith("http")) return relative;
        var backend = _config["BackendUrl"] ?? "http://localhost:5000";
        return $"{backend.TrimEnd('/')}{(relative.StartsWith("/") ? relative : "/" + relative)}";
    }

    // Announcement/Event images are stored FILENAME-ONLY in the DB; the read SQL rebuilds the served
    // path via CONCAT('/Documents/{folder}/Group{id}/', file). The scheduled send MUST do the same,
    // else the WhatsApp/Email image URL is missing its /Documents/{folder}/Group{id}/ prefix (it came
    // out as backend/<file> and 404'd). folder = "Event" | "announcement".
    private static string? BuildMediaPath(string folder, string scope, int? clubId, int? districtId, string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return null;
        if (fileName.StartsWith("/") || fileName.StartsWith("http")) return fileName;
        if (scope == "ri") return $"/Documents/{folder}/ri/{fileName}";
        if (districtId is > 0) return $"/Documents/{folder}/Group{districtId}/{fileName}";
        if (clubId is > 0) return $"/Documents/{folder}/Group{clubId}/{fileName}";
        return $"/Documents/{folder}/{fileName}";
    }

    // Attribution for the per-recipient whatsapp_log rows this batch writes.
    private record WhatsAppLogContext(string Type, long SourceId, string? Title, int? ClubId, int? DistrictId);

    private static int? Nz(dynamic? v)
    {
        if (v == null) return null;
        try { int i = (int)v; return i == 0 ? (int?)null : i; }
        catch { return null; }
    }

    // Club / District Upcoming Event and Announcement on the new approved templates (see WhatsAppCommsTemplates):
    // image-header template + image URL header when there is an image, else the no-image template.
    private Task SendCommsMessageBatchAsync(WhatsAppCommsMessage msg, List<Recipient> recipients,
        Func<int, int, Task> onComplete, CancellationToken ct, WhatsAppLogContext logCtx)
        => SendBatchAsync(recipients, msg.Template, (m) => msg.BodyFor(m.MemberName), onComplete, ct, logCtx, msg.HeaderValues);

    private async Task SendBatchAsync(
        List<Recipient> recipients,
        string templateName,
        Func<Recipient, string[]> mapBodyValues,
        Func<int, int, Task> onComplete,
        CancellationToken ct,
        WhatsAppLogContext? logCtx = null,
        string[]? headerValues = null)
    {
        if (recipients.Count == 0)
        {
            _logger.LogWarning("WhatsApp send skipped: zero recipients for template {Template}", templateName);
            await onComplete(0, 0);
            return;
        }
        int sent = 0, failed = 0;
        var logRows = new System.Collections.Concurrent.ConcurrentBag<object>();
        using var scope = _scopeFactory.CreateScope();
        var interakt = scope.ServiceProvider.GetRequiredService<IInteraktService>();

        // Throttle: send in chunks of _batchSize (Interakt's per-minute cap), pausing
        // _batchIntervalSeconds between chunks so we never trip the rate limit. Each message
        // auto-retries transient failures (429/5xx/network) up to MaxSendRetries.
        int totalChunks = (recipients.Count + _batchSize - 1) / _batchSize;
        for (int chunk = 0; chunk < totalChunks; chunk++)
        {
            if (ct.IsCancellationRequested) break;
            var slice = recipients.Skip(chunk * _batchSize).Take(_batchSize).ToList();
            await Parallel.ForEachAsync(slice,
                new ParallelOptions { MaxDegreeOfParallelism = MaxConcurrencyPerRecord, CancellationToken = ct },
                async (r, _) =>
                {
                    string[] bodyValues = Array.Empty<string>();
                    try
                    {
                        bodyValues = mapBodyValues(r);
                        var outcome = await SendWithRetryAsync(interakt, r.Mobile, templateName, bodyValues, ct, headerValues);
                        if (outcome.Ok) Interlocked.Increment(ref sent);
                        else Interlocked.Increment(ref failed);
                        if (logCtx != null) logRows.Add(BuildLogRow(logCtx, r, templateName, bodyValues, outcome));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "WhatsApp send failed to {Mobile}", r.Mobile);
                        Interlocked.Increment(ref failed);
                        if (logCtx != null)
                            logRows.Add(BuildLogRow(logCtx, r, templateName, bodyValues, new WhatsAppSendOutcome(false, 0, null, ex.Message)));
                    }
                });
            // Pause before the next chunk (not after the last one).
            if (chunk < totalChunks - 1 && _batchIntervalSeconds > 0 && !ct.IsCancellationRequested)
            {
                _logger.LogInformation("WhatsApp throttle: sent chunk {Chunk}/{Total} ({Size} msgs), pausing {Sec}s for template {Template}",
                    chunk + 1, totalChunks, slice.Count, _batchIntervalSeconds, templateName);
                try { await Task.Delay(TimeSpan.FromSeconds(_batchIntervalSeconds), ct); }
                catch (TaskCanceledException) { break; }
            }
        }

        if (logCtx != null && !logRows.IsEmpty) await WriteLogRowsAsync(logRows);
        await onComplete(sent, failed);
    }

    // Sends one message, auto-retrying transient failures (429 rate-limit, 5xx, network/timeout=0)
    // with a short back-off. A 400 (bad number/template) is permanent and returned immediately.
    private async Task<WhatsAppSendOutcome> SendWithRetryAsync(
        IInteraktService interakt, string mobile, string template, string[] bodyValues, CancellationToken ct,
        string[]? headerValues = null)
    {
        WhatsAppSendOutcome outcome = new(false, 0, null, null);
        for (int attempt = 0; attempt <= MaxSendRetries; attempt++)
        {
            outcome = await interakt.SendWhatsAppDetailedAsync(mobile, template, bodyValues, headerValues: headerValues);
            if (outcome.Ok) return outcome;
            bool retryable = outcome.HttpStatus == 429 || outcome.HttpStatus == 0 || outcome.HttpStatus >= 500;
            if (!retryable || attempt == MaxSendRetries) return outcome;
            try { await Task.Delay(TimeSpan.FromSeconds(RetryBackoffSeconds * (attempt + 1)), ct); }
            catch (TaskCanceledException) { return outcome; }
        }
        return outcome;
    }

    private static object BuildLogRow(WhatsAppLogContext ctx, Recipient r, string template, string[] bodyValues, WhatsAppSendOutcome o)
    {
        var preview = string.Join(" | ", bodyValues ?? Array.Empty<string>());
        if (preview.Length > 2000) preview = preview.Substring(0, 2000);
        var err = o.Error;
        if (err != null && err.Length > 1000) err = err.Substring(0, 1000);
        return new
        {
            RecipientMobile = r.Mobile,
            RecipientName = r.MemberName,
            TemplateName = template,
            WhatsAppType = ctx.Type,
            SourceId = ctx.SourceId,
            Title = ctx.Title,
            ClubId = ctx.ClubId,
            DistrictId = ctx.DistrictId,
            MemberId = r.MemberId > 0 ? (int?)r.MemberId : null,
            Status = o.Ok ? "Sent" : "Failed",
            MessageId = o.MessageId,
            HttpStatus = o.HttpStatus,
            Error = err,
            Preview = preview,
        };
    }

    private async Task WriteLogRowsAsync(IEnumerable<object> rows)
    {
        try
        {
            using var conn = NewConn();
            await conn.OpenAsync();
            await conn.ExecuteAsync(@"
                INSERT INTO whatsapp_log
                    (recipient_mobile, recipient_name, template_name, whatsapp_type, source_id, title,
                     fk_club_id, fk_district_id, fk_member_profile_id, status, interakt_message_id,
                     http_status, error_message, body_preview, sent_at)
                VALUES
                    (@RecipientMobile, @RecipientName, @TemplateName, @WhatsAppType, @SourceId, @Title,
                     @ClubId, @DistrictId, @MemberId, @Status, @MessageId,
                     @HttpStatus, @Error, @Preview, NOW())",
                rows);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write whatsapp_log rows");
        }
    }

    private async Task DeductAfterSendAsync(string scope, dynamic? clubId, dynamic? districtId, int sent, string source, int sourceId, string title)
    {
        if (sent <= 0) return;
        try
        {
            using var scopeS = _scopeFactory.CreateScope();
            if (scope == "ri")
            {
                var riSvc = scopeS.ServiceProvider.GetRequiredService<IRiDirectorService>();
                await riSvc.DeductCreditWithHistoryAsync("WhatsApp", sent, source, sourceId, $"WhatsApp sent for {title}", 0);
                return;
            }
            int entityId = districtId != null ? (int)districtId : (clubId != null ? (int)clubId : 0);
            if (entityId <= 0) return;
            var creditSvc = scopeS.ServiceProvider.GetRequiredService<ICreditManagementService>();
            await creditSvc.DeductWithHistoryAsync(entityId, "WhatsApp", sent, source, sourceId, $"WhatsApp sent for {title}", 0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to deduct {Sent} WhatsApp credits for {Source} {Id}", sent, source, sourceId);
        }
    }

    private async Task MarkSentAsync(string table, string pk, int id, int sent, int failed)
    {
        try
        {
            using var conn = NewConn();
            await conn.OpenAsync();
            await conn.ExecuteAsync(
                $"UPDATE {table} SET WhatsAppSentDate = NOW(), WhatsAppSentCount = @S, WhatsAppFailedCount = @F WHERE {pk} = @Id",
                new { S = sent, F = failed, Id = id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to mark WhatsApp sent for {Table} {Id}", table, id);
        }
    }
}
