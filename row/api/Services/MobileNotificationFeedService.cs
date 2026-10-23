using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Backing service for the mobile bell-icon feed (GET /api/mobile/notifications).
///
/// ── Why this is a LIVE AGGREGATION and not a push-history read ─────────────────────────────
/// The obvious alternative was "replay what we actually pushed to this member" from the
/// *_push_log tables. Two facts in this repo rule that out:
///   1. PushLogCleanupBackgroundService DELETEs every push-log row older than 5 days, so the
///      bell would only ever have 5 days of history.
///   2. PushDispatcher.ResolveClubDistrictTokensAsync only ever creates log rows for members
///      with a usable member_master_profile.LastDeviceToken — a small minority of the roster.
///      Members without a live token would see a permanently EMPTY bell.
/// So the feed is recomputed from the source tables on read, scoped to the member. Everything a
/// member could have been notified about is present, whether or not the push reached their device.
///
/// ── Sources ──────────────────────────────────────────────────────────────────────────────
///   greetings      club roster birthdays/anniversaries whose date has just come round
///   projects       rotary_projects_YYYY_YY (current + previous Rotary year ONLY — see YearTables)
///   announcements  announcements
///   events         upcoming_events
///   newsletters    newsletters
///   documents      club_documents
///   meetings       club_attendance reminders, while the 'meetings' feature is on (N8 Meetings)
///
/// ── Shape of the query ───────────────────────────────────────────────────────────────────
/// One UNION ALL of narrow, index-friendly legs; ORDER BY / LIMIT / OFFSET are applied to the
/// UNION so pagination is correct ACROSS sources (never per source). Nothing correlated runs per
/// row: the only follow-up query is a single batched primary-photo lookup for the ≤ pageSize
/// project rows that actually made it onto the requested page.
/// </summary>
public class MobileNotificationFeedService : IMobileNotificationFeedService
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _years;

    public MobileNotificationFeedService(IConfiguration config, IYearTableResolver years)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _years = years;
    }

    // Greetings are capped to a much shorter window than the rest of the feed: they are a daily
    // recurrence, so a 6-month lookback on a 1100-member club would bury every other notification
    // under ~1000 birthday cards. 30 days keeps "who celebrated recently" useful and bounded.
    private const int GreetingLookbackDays = 30;

    private const int BodyMaxChars = 300;

    private static readonly string[] AllTypes =
        { "greeting", "project", "announcement", "event", "newsletter", "document", "highlight", "grant", "volunteer", "meeting_duty", "invite", "meeting" };

    public async Task<PagedResult<MobileNotificationDto>> GetFeedAsync(
        int memberId, int page, int pageSize, int days, string? types)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;
        if (days < 1) days = 90;
        if (days > 365) days = 365;

        var empty = new PagedResult<MobileNotificationDto> { Page = page, PageSize = pageSize, TotalCount = 0 };
        if (memberId <= 0) return empty;

        var wanted = ParseTypes(types);
        if (wanted.Count == 0) return empty;

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // ── 1. Scope ───────────────────────────────────────────────────────────────────────
        // Reuse the SAME scope builder the mobile session itself is built from
        // (MobileAuthService.VerifyOtpAsync / GetMyContextAsync) so the feed can never show
        // anything the member is not already entitled to see. excludeSuperAdmin: true matches
        // every other mobile caller.
        var scopes = await MemberScopesHelper.BuildScopesAsync(conn, memberId, excludeSuperAdmin: true);

        var clubNames = scopes.Clubs.ToDictionary(c => c.Id, c => c.Name);
        var districtNumbers = scopes.Districts.ToDictionary(d => d.Id, d => d.Number);

        // Kill-switch: drop any club/district whose club→district→zone chain has an inactive link,
        // exactly as PushDispatcher does when choosing recipients. Batched — one query, no N+1.
        var (clubIds, districtIds) = await FilterActiveScopeAsync(
            conn, scopes.Clubs.Select(c => c.Id).ToList(), scopes.Districts.Select(d => d.Id).ToList());

        if (clubIds.Count == 0 && districtIds.Count == 0) return empty;

        // Per-member notification toggles from the mobile Settings screen
        // (MobileMemberSettingsController). A member who switched a module OFF must not get
        // those rows in the bell either. Defaults are 1 for everyone.
        var prefs = await conn.QueryFirstOrDefaultAsync<NotifyPrefs>(@"
            SELECT CAST(NotifyUpcomingEvents AS UNSIGNED) AS NotifyEvents,
                   CAST(NotifyAnnouncements  AS UNSIGNED) AS NotifyAnnouncements,
                   CAST(NotifyNewsletters    AS UNSIGNED) AS NotifyNewsletters,
                   CAST(NotifyDocuments      AS UNSIGNED) AS NotifyDocuments
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId }) ?? new NotifyPrefs();

        // ── 2. Which year-partitioned project tables to scan ───────────────────────────────
        var yearTables = await YearTablesAsync(conn);

        // ── 3. Build the UNION ─────────────────────────────────────────────────────────────
        var p = new DynamicParameters();
        p.Add("MemberId", memberId);
        p.Add("From", DateTime.Now.AddDays(-days));
        p.Add("GreetFrom", DateTime.Now.AddDays(-Math.Min(days, GreetingLookbackDays)).Date);
        p.Add("Take", pageSize);
        p.Add("Skip", (page - 1) * pageSize);
        if (clubIds.Count > 0) p.Add("ClubIds", clubIds);
        if (districtIds.Count > 0) p.Add("DistrictIds", districtIds);

        var legs = new List<Leg>();

        if (wanted.Contains("announcement") && prefs.NotifyAnnouncements)
            legs.Add(AnnouncementLeg(clubIds.Count > 0, districtIds.Count > 0));
        if (wanted.Contains("event") && prefs.NotifyEvents)
            legs.Add(EventLeg(clubIds.Count > 0, districtIds.Count > 0));
        if (wanted.Contains("newsletter") && prefs.NotifyNewsletters)
            legs.Add(NewsletterLeg(clubIds.Count > 0, districtIds.Count > 0));
        if (wanted.Contains("document") && prefs.NotifyDocuments)
            legs.Add(DocumentLeg(clubIds.Count > 0, districtIds.Count > 0));
        if (wanted.Contains("meeting") && clubIds.Count > 0
            && (await FeatureGate.OnAsync(_connectionString)).Contains(MeetingsService.FeatureKey))
            legs.Add(MeetingLeg());

        if (wanted.Contains("project"))
            foreach (var t in yearTables)
            {
                if (clubIds.Count > 0) legs.Add(ProjectLeg(t, districtScoped: false));
                if (districtIds.Count > 0) legs.Add(ProjectLeg(t, districtScoped: true));
            }

        if (wanted.Contains("greeting") && clubIds.Count > 0)
        {
            legs.Add(GreetingDigestLeg());
            legs.Add(SelfGreetingLeg("BirthDate", "Birthday", "IsEnableBirthdayNotification"));
            legs.Add(SelfGreetingLeg("AnniversaryDate", "Anniversary", "IsEnableAnniversaryNotification"));
        }

        // Engagement highlights (milestones, new Paul Harris Fellows) of the member's clubs, while that module is on.
        if (wanted.Contains("highlight") && clubIds.Count > 0 && await EngagementService.IsOnAsync(_connectionString))
            legs.Add(HighlightLeg());

        // Grant notifications are addressed to the member (GrantService); read only while the module is switched on.
        if (wanted.Contains("grant") && (await FeatureGate.OnAsync(_connectionString)).Contains("grants"))
            legs.Add(GrantLeg());

        // Volunteer slot and meeting duty reminders (VolunteerReminderBackgroundService), while the module is switched on.
        if ((wanted.Contains("volunteer") || wanted.Contains("meeting_duty")) && (await FeatureGate.OnAsync(_connectionString)).Contains("volunteers"))
        {
            if (wanted.Contains("volunteer")) legs.Add(VolunteerLeg());
            if (wanted.Contains("meeting_duty")) legs.Add(MeetingDutyLeg());
        }

        // "Bring a guest" prompts sent to this member (InvitePromptService), while the feature is on.
        if (wanted.Contains("invite") && clubIds.Count > 0 && await FeatureGate.IsOnAsync("contacts_growth", _connectionString))
            legs.Add(InviteLeg());

        if (legs.Count == 0) return empty;

        // COUNT is a sum of per-leg scalar counts rather than COUNT(*) over the materialised
        // UNION — same WHERE clauses (single source of truth: Leg.FromWhere), but MySQL never has
        // to build the derived table just to size it.
        var countSql = "SELECT " + string.Join(" + ", legs.Select(l => l.IsAggregate
            // an aggregate leg emits one row per GROUP — count the groups, not the input rows
            ? $"(SELECT COUNT(*) FROM (SELECT 1 AS x {l.FromWhere}) agg)"
            : $"(SELECT COUNT(*) {l.FromWhere})")) + " AS Total";

        var pageSql = "SELECT * FROM (\n"
                    + string.Join("\nUNION ALL\n", legs.Select(l => $"SELECT {Select(l)} {l.FromWhere}"))
                    + "\n) u ORDER BY u.SortAt DESC, u.Type, u.Id DESC LIMIT @Take OFFSET @Skip";

        int totalCount;
        List<FeedRow> rows;
        using (var multi = await conn.QueryMultipleAsync(countSql + ";\n" + pageSql, p))
        {
            totalCount = await multi.ReadFirstAsync<int>();
            rows = (await multi.ReadAsync<FeedRow>()).ToList();
        }

        // ── 4. Project photos for THIS PAGE only (batched — never per row) ─────────────────
        var photos = await LoadProjectPhotosAsync(conn, rows, yearTables);

        // ── 5. Materialise DTOs ────────────────────────────────────────────────────────────
        var items = rows.Select(r => ToDto(r, clubNames, districtNumbers, photos)).ToList();

        return new PagedResult<MobileNotificationDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // Scope helpers
    // ══════════════════════════════════════════════════════════════════════════════════════

    private static HashSet<string> ParseTypes(string? types)
    {
        if (string.IsNullOrWhiteSpace(types)) return new HashSet<string>(AllTypes, StringComparer.OrdinalIgnoreCase);
        var wanted = types.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                          .Select(t => t.ToLowerInvariant())
                          .Where(t => AllTypes.Contains(t))
                          .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return wanted;
    }

    /// <summary>
    /// Keep only clubs/districts whose whole club→district→zone chain is active. Two queries, no N+1 —
    /// KillSwitchHelper's per-id helpers open a fresh connection each call and would be O(scope).
    /// </summary>
    private static async Task<(List<int> ClubIds, List<int> DistrictIds)> FilterActiveScopeAsync(
        MySqlConnection conn, List<int> clubIds, List<int> districtIds)
    {
        var clubs = new List<int>();
        var districts = new HashSet<int>();

        if (clubIds.Count > 0)
        {
            var rows = await conn.QueryAsync<(int ClubId, int DistrictId)>(@"
                SELECT c.pk_club_id, d.pk_district_id
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                WHERE c.pk_club_id IN @Ids AND c.isdeleted = 0 AND c.IsActive = 1",
                new { Ids = clubIds });
            foreach (var r in rows) { clubs.Add(r.ClubId); districts.Add(r.DistrictId); }
        }

        if (districtIds.Count > 0)
        {
            var rows = await conn.QueryAsync<int>(@"
                SELECT d.pk_district_id
                FROM district_master d
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
                WHERE d.pk_district_id IN @Ids AND d.isdeleted = 0 AND d.IsActive = 1",
                new { Ids = districtIds });
            districts.UnionWith(rows);
        }

        return (clubs.Distinct().ToList(), districts.ToList());
    }

    /// <summary>
    /// Current + previous Rotary year tables ONLY. Deliberate cap: there are 50+
    /// rotary_projects_* tables and scanning all of them per bell refresh would be absurd.
    /// A project older than ~2 Rotary years is not "a notification".
    /// </summary>
    private async Task<List<YearTableInfo>> YearTablesAsync(MySqlConnection conn)
    {
        var all = await _years.GetAllExistingYearTablesAsync(conn);   // ordered by StartDate
        if (all.Count == 0) return all;

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 LIMIT 1");

        var current = currentYearId.HasValue ? all.FirstOrDefault(t => t.YearId == currentYearId.Value) : null;
        current ??= all.LastOrDefault(t => StartYear(t.YearLabel) is int y && y <= DateTime.Now.Year);
        if (current == null) return new List<YearTableInfo>();

        var result = new List<YearTableInfo> { current };

        // Previous = the table whose label starts exactly one year earlier. Matching on the label
        // rather than "the row before this one" avoids picking up the junk year rows that exist in
        // rotary_year_master (e.g. '205-06', '5-06', '2066-67').
        int? curStart = StartYear(current.YearLabel);
        if (curStart.HasValue)
        {
            var prev = all.FirstOrDefault(t => StartYear(t.YearLabel) == curStart.Value - 1);
            if (prev != null) result.Add(prev);
        }
        return result;
    }

    private static int? StartYear(string yearLabel)
    {
        var head = yearLabel.Split('-')[0];
        return head.Length == 4 && int.TryParse(head, out var y) ? y : null;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // SQL fragments
    // ══════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// A UNION leg. <see cref="Cols"/> is positional and MUST line up with <see cref="ColNames"/> —
    /// the aliases are attached centrally by <see cref="Select"/> so that EVERY leg exposes the same
    /// column names. (A derived table takes its column names from the FIRST leg only, so if any leg
    /// were allowed to name its own columns, filtering that leg out with ?types= would silently
    /// rename `u.SortAt` and break the ORDER BY.)
    /// </summary>
    private sealed record Leg(string[] Cols, string FromWhere, bool IsAggregate = false);

    private static readonly string[] ColNames =
    {
        "Type", "Id", "YearId", "ClubId", "DistrictId", "ScopeKind",
        "Title", "Body", "ImageUrl", "LinkUrl", "SortAt", "DeepLinkType", "Extra"
    };

    private static string Select(Leg leg)
    {
        if (leg.Cols.Length != ColNames.Length)
            throw new InvalidOperationException($"Feed leg has {leg.Cols.Length} columns, expected {ColNames.Length}.");
        return string.Join(",\n", leg.Cols.Select((c, i) => $"{c} AS {ColNames[i]}"));
    }

    private sealed class NotifyPrefs
    {
        public bool NotifyEvents { get; set; } = true;
        public bool NotifyAnnouncements { get; set; } = true;
        public bool NotifyNewsletters { get; set; } = true;
        public bool NotifyDocuments { get; set; } = true;
    }

    /// <summary>
    /// Visibility predicate for one communications table.
    ///
    /// The two arms are mutually exclusive by construction, so a row can never be counted twice:
    ///   district → fk_club_id is 0/NULL   (verified in prod: 0 rows carry BOTH
    ///   club     → fk_club_id &gt; 0        a club id and a district id)
    /// The caller returns early when the member has neither, so at least one arm is always present.
    /// </summary>
    private static string ScopeWhere(string a, bool hasClubs, bool hasDistricts)
    {
        var arms = new List<string>();

        if (hasClubs)
            arms.Add($"({a}.fk_club_id > 0 AND {a}.fk_club_id IN @ClubIds)");

        if (hasDistricts)
            arms.Add($"(({a}.fk_club_id = 0 OR {a}.fk_club_id IS NULL) AND {a}.fk_district_id IN @DistrictIds)");

        return "(" + string.Join(" OR ", arms) + ")";
    }

    private static string ScopeKind(string a) =>
        $"CASE WHEN {a}.fk_club_id > 0 THEN 'club' ELSE 'district' END";

    /// <summary>
    /// Site-relative media path, matching the CASE already used by MobileCalendarController /
    /// ClubWebsitePublicDataController for the same table.
    /// </summary>
    private static string MediaPath(string a, string col, string folder) => $@"
        CASE WHEN {a}.{col} IS NULL OR {a}.{col} = '' THEN NULL
             WHEN {a}.{col} LIKE '/%' THEN {a}.{col}
             WHEN {a}.fk_district_id IS NOT NULL AND {a}.fk_district_id > 0 THEN CONCAT('/Documents/{folder}/Group', {a}.fk_district_id, '/', {a}.{col})
             ELSE CONCAT('/Documents/{folder}/Group', {a}.fk_club_id, '/', {a}.{col}) END";

    // Every string column is normalised to one charset/collation: the year-partitioned project
    // tables were created over many years and carry mixed collations, which makes a bare UNION ALL
    // fail with "Illegal mix of collations" (same fix as ProjectPushBackgroundService).
    private static string Str(string expr) => $"CONVERT({expr} USING utf8mb4) COLLATE utf8mb4_general_ci";

    private static Leg AnnouncementLeg(bool hasClubs, bool hasDistricts) => new(
        Cols: new[]
        {
            Str("'announcement'"), "a.pk_announcement_id", "0",
            "a.fk_club_id", "a.fk_district_id", Str(ScopeKind("a")),
            Str("a.Title"), Str("a.Description"),
            Str(MediaPath("a", "ImagePath", "announcement")),
            Str("NULL"),
            "a.PublishDateTime",
            Str("'club_announcement'"), Str("NULL")
        },
        // announcements has no OcvLiveVisibility helper (that class covers the three OCV modules).
        // Predicate is the one AnnouncementPushBackgroundService already uses.
        FromWhere: $@"
            FROM announcements a
            WHERE a.isdeleted = 0
              AND a.PublishDateTime >= @From AND a.PublishDateTime <= NOW()
              AND (a.ExpiryDateTime IS NULL OR a.ExpiryDateTime >= NOW())
              AND {ScopeWhere("a", hasClubs, hasDistricts)}");

    private static Leg EventLeg(bool hasClubs, bool hasDistricts) => new(
        Cols: new[]
        {
            Str("'event'"), "e.pk_upcoming_event_id", "0",
            "e.fk_club_id", "e.fk_district_id", Str(ScopeKind("e")),
            Str("e.Title"), Str("e.Description"),
            Str(MediaPath("e", "ImagePath", "Event")),
            Str("e.RegistrationLink"),
            "e.PublishDate",
            Str("'club_upcoming_event'"), Str("DATE_FORMAT(e.EventDate, '%Y-%m-%dT%H:%i:%s')")
        },
        FromWhere: $@"
            FROM upcoming_events e
            WHERE e.isdeleted = 0
              AND e.PublishDate >= @From
              AND {OcvLiveVisibility.UpcomingEvents("e")}
              AND {ScopeWhere("e", hasClubs, hasDistricts)}");

    private static Leg NewsletterLeg(bool hasClubs, bool hasDistricts) => new(
        Cols: new[]
        {
            Str("'newsletter'"), "n.pk_newsletter_id", "IFNULL(n.fk_year_id, 0)",
            "n.fk_club_id", "n.fk_district_id", Str(ScopeKind("n")),
            Str("n.Title"), Str("NULL"), Str("NULL"),
            Str($@"CASE WHEN n.AttachmentType = 'link' AND IFNULL(n.LinkUrl, '') <> '' THEN n.LinkUrl
                        WHEN IFNULL(n.FilePath, '') = '' THEN n.LinkUrl
                        ELSE {MediaPath("n", "FilePath", "ebulletin")} END"),
            "n.PublishDateTime",
            Str("'club_newsletter'"), Str("n.AttachmentType")
        },
        FromWhere: $@"
            FROM newsletters n
            WHERE n.isdeleted = 0
              AND n.PublishDateTime >= @From
              AND {OcvLiveVisibility.Newsletters("n")}
              AND {ScopeWhere("n", hasClubs, hasDistricts)}");

    private static Leg DocumentLeg(bool hasClubs, bool hasDistricts) => new(
        Cols: new[]
        {
            Str("'document'"), "d.pk_document_id", "0",
            "d.fk_club_id", "d.fk_district_id", Str(ScopeKind("d")),
            Str("d.Title"), Str("d.OriginalFileName"), Str("NULL"),
            Str(MediaPath("d", "FilePath", "documentsafe")),
            "d.PublishDateTime",
            Str("'document'"), Str("d.AccessType")
        },
        FromWhere: $@"
            FROM club_documents d
            WHERE d.isdeleted = 0
              AND d.PublishDateTime >= @From
              AND {OcvLiveVisibility.ClubDocuments("d")}
              AND {ScopeWhere("d", hasClubs, hasDistricts)}");

    // In-app meeting reminder (N8 Meetings): it arrives ReminderLeadHours before the meeting, or when the meeting is
    // entered if that is later. A meeting entered after it took place (attendance logged afterwards) is no reminder.
    private static readonly string MeetingRemindAt =
        $"GREATEST(DATE_SUB(a.EventDateTime, INTERVAL {MeetingsService.ReminderLeadHours} HOUR), a.created_date)";

    private static Leg MeetingLeg() => new(
        Cols: new[]
        {
            Str("'meeting'"), "a.pk_attendance_id", "0",
            "a.fk_club_id", "0", Str("'club'"),
            Str("a.EventName"), Str("a.Description"), Str("NULL"),
            Str("CASE WHEN a.MeetingMode IN ('online', 'hybrid') THEN a.MeetingLink END"),
            MeetingRemindAt,
            Str("'club_meeting'"), Str("CONCAT(a.MeetingMode, '|', DATE_FORMAT(a.EventDateTime, '%Y-%m-%dT%H:%i:%s'))")
        },
        FromWhere: $@"
            FROM club_attendance a
            WHERE a.fk_club_id IN @ClubIds AND a.isdeleted = 0
              AND a.created_date < a.EventDateTime
              AND {MeetingRemindAt} <= NOW() AND {MeetingRemindAt} >= @From");

    /// <summary>
    /// One project leg per (year table × scope). Club and district scopes are SEPARATE legs on
    /// purpose: a single leg with `(fk_club_id IN (..) OR (fk_club_id = 0 AND fk_district_id IN (..)))`
    /// stops MySQL using idx_club_module and turns the 168k-row year table into a full scan.
    ///
    /// Filter is the canonical public one, written WITHOUT a `NOT (x AND y)` — that pattern
    /// silently drops every row where y is NULL (this repo lost 89,578 project rows to it).
    /// </summary>
    /// <summary>Grant application notifications (one row per recipient, written by GrantService). Extra carries
    /// the application id for the deep link.</summary>
    private static Leg GrantLeg() => new(
        Cols: new[]
        {
            Str("'grant'"), "gn.pk_notification_id", "0",
            "ga.fk_club_id", "ga.fk_district_id", Str("'club'"),
            Str("gn.title"), Str("gn.body"), Str("NULL"), Str("NULL"),
            "gn.created_date",
            Str("'grant_application'"), Str("CAST(gn.fk_application_id AS CHAR)")
        },
        FromWhere: @"
            FROM grant_notifications gn
            JOIN grant_applications ga ON ga.pk_application_id = gn.fk_application_id
            WHERE gn.fk_member_id = @MemberId AND gn.created_date >= @From");

    /// <summary>The member's volunteer slot reminders (one per sign-up, when the reminder went out). The id is the
    /// sheet's, for the deep link.</summary>
    private static Leg VolunteerLeg() => new(
        Cols: new[]
        {
            Str("'volunteer'"), "sh.pk_sheet_id", "0",
            "sh.fk_club_id", "NULL", Str("'club'"),
            Str("CONCAT('Reminder: ', sl.task)"), Str("CONCAT(sh.title, ', ', DATE_FORMAT(sl.starts_at, '%d %b %Y %H:%i'))"),
            Str("NULL"), Str("NULL"),
            "su.reminder_sent_at",
            Str("'volunteer_sheet'"), Str("NULL")
        },
        FromWhere: @"
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
            JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            WHERE su.fk_member_id = @MemberId AND su.reminder_sent_at >= @From");

    /// <summary>The member's meeting duty reminders.</summary>
    private static Leg MeetingDutyLeg() => new(
        Cols: new[]
        {
            Str("'meeting_duty'"), "d.pk_duty_id", "0",
            "d.fk_club_id", "NULL", Str("'club'"),
            Str("CONCAT('Meeting duty: ', d.duty)"), Str("CONCAT('Meeting on ', DATE_FORMAT(d.meeting_date, '%d %b %Y'))"),
            Str("NULL"), Str("NULL"),
            "d.reminder_sent_at",
            Str("'meeting_duty'"), Str("NULL")
        },
        FromWhere: @"
            FROM meeting_duties d
            WHERE d.fk_member_id = @MemberId AND d.reminder_sent_at >= @From");

    private static Leg ProjectLeg(YearTableInfo t, bool districtScoped) => new(
        Cols: new[]
        {
            Str("'project'"), "p.pk_project_id", t.YearId.ToString(),
            "p.fk_club_id", "p.fk_district_id", Str(districtScoped ? "'district'" : "'club'"),
            Str("p.title"), Str("p.description"), Str("NULL"), Str("NULL"),
            "COALESCE(p.created_date, p.project_date)",
            Str("CONCAT('club_project_', COALESCE(NULLIF(mm.ModuleKey, ''), 'community_service'))"),
            Str("mm.ModuleName")
        },
        FromWhere: $@"
            FROM `{t.ProjectsTable}` p
            LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE {(districtScoped
                    ? "p.fk_club_id = 0 AND p.fk_district_id IN @DistrictIds"
                    : "p.fk_club_id IN @ClubIds")}
              AND p.isdeleted = 0 AND p.is_active = 1
              AND COALESCE(p.created_date, p.project_date) >= @From");

    /// <summary>
    /// This year's (or last year's, when the day has not come round yet) instance of a member's
    /// month/day, anchored at 08:00 — the hour GreetingsWorker's scheduled task fires. A 29-Feb
    /// date in a non-leap year yields NULL and drops out, which is the correct outcome.
    /// No `&lt;= NOW()` guard is needed: by construction the value is never later than TODAY, and
    /// clamping on NOW() would hide today's celebrations from anyone opening the app before 08:00.
    /// </summary>
    private static string OccExpr(string dateCol) => $@"
        CASE WHEN DATE_FORMAT(m.{dateCol}, '%m-%d') <= DATE_FORMAT(CURDATE(), '%m-%d')
             THEN STR_TO_DATE(CONCAT(YEAR(CURDATE()),     '-', DATE_FORMAT(m.{dateCol}, '%m-%d'), ' 08:00:00'), '%Y-%m-%d %H:%i:%s')
             ELSE STR_TO_DATE(CONCAT(YEAR(CURDATE()) - 1, '-', DATE_FORMAT(m.{dateCol}, '%m-%d'), ' 08:00:00'), '%Y-%m-%d %H:%i:%s') END";

    internal const string ProfilePhotoCase = @"
        CASE WHEN IFNULL(m.ProfilePhotoPath, '') = '' THEN NULL
             WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
             ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END";

    /// <summary>
    /// Engagement highlights (EngagementService): membership milestones and new Paul Harris Fellows in the member's
    /// clubs. A PHF whose designation was removed drops out. Title carries the member's name and Extra
    /// "MILESTONE:&lt;years&gt;" or "PHF:&lt;level&gt;"; <see cref="ToDto"/> turns them into display text.
    /// </summary>
    private static Leg HighlightLeg() => new(
        Cols: new[]
        {
            Str("'highlight'"), "e.pk_engagement_event_id", "0",
            "e.fk_club_id", "e.fk_district_id", Str("'club'"),
            Str("m.MemberName"), Str("NULL"),
            Str(ProfilePhotoCase),
            Str("NULL"),
            "e.created_date",
            Str("'engagement_highlight'"), Str("CONCAT(e.event_type, ':', e.level)")
        },
        FromWhere: @"
            FROM engagement_events e
            JOIN member_master_profile m ON m.pk_member_master_profile_id = e.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN member_foundation_designations d ON d.pk_member_designation_id = e.fk_designation_id
            WHERE e.fk_club_id IN @ClubIds AND e.created_date >= @From
              AND (e.fk_designation_id IS NULL OR d.isdeleted = 0)");

    /// <summary>
    /// Every celebrant (birthday + anniversary) in the member's own clubs whose date has come
    /// round inside the greeting window. Gated by the club's IsEnableBirthdayNotification /
    /// IsEnableAnniversaryNotification flags — a club that switched greeting notifications OFF
    /// must not produce greeting notifications.
    /// </summary>
    private static string CelebrantsSubquery()
    {
        string leg(string dateCol, string flagCol, int isB, int isA) => $@"
            SELECT cm.fk_club_id AS ClubId, c.fk_district_id AS DistrictId,
                   {OccExpr(dateCol)} AS Occ, {isB} AS IsB, {isA} AS IsA,
                   {Str("m.MemberName")} AS MemberName,
                   {Str(ProfilePhotoCase)} AS Photo
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.{flagCol} = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id IN @ClubIds AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.{dateCol} IS NOT NULL
              AND {OccExpr(dateCol)} >= @GreetFrom";

        return leg("BirthDate", "IsEnableBirthdayNotification", 1, 0)
             + "\nUNION ALL\n"
             + leg("AnniversaryDate", "IsEnableAnniversaryNotification", 0, 1);
    }

    /// <summary>
    /// ONE row per (club × day), not one per celebrant — this mirrors the notification that is
    /// actually sent: GreetingsJob.SendCelebrationsDigestAsync broadcasts a single
    /// "N birthdays and M anniversaries to celebrate today" push per source per day.
    /// Emitting a row per person instead made page 1 of a 1,108-member club 20 birthday cards
    /// and pushed every project/announcement off the screen.
    ///
    /// There is no stored greeting row worth replaying instead: greeting_send_log only reaches
    /// back to 2026-06-30 and the majority of its rows are Status='skipped' (no credit /
    /// no device token), so it under-reports what members should see.
    ///
    /// Title carries the celebrant names, Extra carries "birthdays/anniversaries" counts; both are
    /// turned into display text in <see cref="ToDto"/>.
    /// </summary>
    private static Leg GreetingDigestLeg() => new(
        Cols: new[]
        {
            Str("'greeting'"), "g.ClubId", "0",
            "g.ClubId", "g.DistrictId", Str("'club'"),
            "GROUP_CONCAT(DISTINCT g.MemberName ORDER BY g.MemberName SEPARATOR ', ')",
            Str("NULL"),
            "NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(g.Photo SEPARATOR '||'), '||', 1), '')",
            Str("NULL"),
            "g.Occ",
            Str("'celebrations_digest'"),
            "CONCAT(SUM(g.IsB), '/', SUM(g.IsA))"
        },
        FromWhere: $"FROM (\n{CelebrantsSubquery()}\n) g GROUP BY g.ClubId, g.DistrictId, g.Occ",
        IsAggregate: true);

    /// <summary>
    /// The member's OWN birthday / anniversary, kept as its own row alongside the club digest —
    /// GreetingsWorker likewise sends the celebrant a personal greeting AND the club a digest.
    /// Cheap: filtered by pk_member_master_profile_id.
    /// </summary>
    private static Leg SelfGreetingLeg(string dateCol, string occasion, string clubFlagCol) => new(
        Cols: new[]
        {
            Str("'greeting'"), "m.pk_member_master_profile_id", "0",
            "cm.fk_club_id", "c.fk_district_id", Str("'club'"),
            Str("m.MemberName"), Str("NULL"),
            Str(ProfilePhotoCase),
            Str("NULL"),
            OccExpr(dateCol),
            Str("'celebrations_digest'"), Str($"'self_{occasion}'")
        },
        FromWhere: $@"
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.{clubFlagCol} = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.fk_club_id IN @ClubIds AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.{dateCol} IS NOT NULL
              AND {OccExpr(dateCol)} >= @GreetFrom");

    // One row per prompt this member received (invite_prompt_log). The app opens its "invite a guest" screen for
    // the club, which reads the member's link from GET api/clubs/{clubId}/invite-link.
    private static Leg InviteLeg() => new(
        Cols: new[]
        {
            Str("'invite'"), "l.pk_id", "0", "l.fk_club_id", "c.fk_district_id", Str("'club'"),
            Str("'Bring a guest to the next meeting'"),
            Str("CONCAT('Meeting on ', DATE_FORMAT(ip.meeting_date, '%d %b %Y'), '. Share your personal invite link with a guest.')"),
            Str("NULL"), Str("NULL"), "l.created_date", Str("'invite_guest'"), Str("DATE_FORMAT(ip.meeting_date, '%Y-%m-%d')")
        },
        FromWhere: @"
            FROM invite_prompt_log l
            JOIN invite_prompts ip ON ip.pk_invite_prompt_id = l.fk_invite_prompt_id
            JOIN club_master c ON c.pk_club_id = l.fk_club_id
            WHERE l.fk_member_id = @MemberId AND l.fk_club_id IN @ClubIds AND l.created_date >= @From");

    // ══════════════════════════════════════════════════════════════════════════════════════
    // Materialisation
    // ══════════════════════════════════════════════════════════════════════════════════════

    private sealed class FeedRow
    {
        public string Type { get; set; } = "";
        public int Id { get; set; }
        public int YearId { get; set; }
        public int? ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string ScopeKind { get; set; } = "";
        public string? Title { get; set; }
        public string? Body { get; set; }
        public string? ImageUrl { get; set; }
        public string? LinkUrl { get; set; }
        public DateTime SortAt { get; set; }
        public string DeepLinkType { get; set; } = "";
        public string? Extra { get; set; }
    }

    /// <summary>
    /// Primary photo for the project rows ON THIS PAGE — one query per year table represented
    /// (≤ 2), never a correlated subquery per row. Path convention copied verbatim from
    /// PublicProjectStatsController.
    /// </summary>
    private static async Task<Dictionary<(int YearId, int ProjectId), string>> LoadProjectPhotosAsync(
        MySqlConnection conn, List<FeedRow> rows, List<YearTableInfo> yearTables)
    {
        var map = new Dictionary<(int, int), string>();
        var projectRows = rows.Where(r => r.Type == "project").ToList();
        if (projectRows.Count == 0) return map;

        foreach (var t in yearTables)
        {
            var ids = projectRows.Where(r => r.YearId == t.YearId).Select(r => r.Id).Distinct().ToList();
            if (ids.Count == 0) continue;

            var suffix = t.YearLabel.Replace("-", "_");
            var photoRows = await conn.QueryAsync<(int ProjectId, string Url)>($@"
                SELECT ph.fk_project_id,
                       CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                              CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                   ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                              '/', ph.image_path)
                FROM `{t.PhotosTable}` ph
                JOIN `{t.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
                WHERE ph.fk_project_id IN @Ids
                ORDER BY ph.fk_project_id, ph.is_primary DESC, ph.sort_order, ph.pk_photo_id",
                new { Ids = ids });

            foreach (var r in photoRows)
                map.TryAdd((t.YearId, r.ProjectId), r.Url);   // ORDER BY puts the primary first
        }
        return map;
    }

    private static MobileNotificationDto ToDto(
        FeedRow r,
        Dictionary<int, string> clubNames, Dictionary<int, string> districtNumbers,
        Dictionary<(int, int), string> photos)
    {
        var dto = new MobileNotificationDto
        {
            Type = r.Type,
            Id = r.Id,
            Title = r.Title ?? "",
            Body = Trim(r.Body),
            ImageUrl = r.ImageUrl,
            DateTime = r.SortAt,
            Scope = r.ScopeKind,
            ClubId = r.ClubId is > 0 ? r.ClubId : null,
            DistrictId = r.DistrictId is > 0 ? r.DistrictId : null,
            LinkUrl = r.LinkUrl,
            SourceName = SourceName(r, clubNames, districtNumbers),
            DeepLink = new MobileNotificationDeepLinkDto
            {
                Type = r.DeepLinkType,
                ClubId = r.ClubId is > 0 ? r.ClubId : null,
                DistrictId = r.DistrictId is > 0 ? r.DistrictId : null,
                EntityId = r.Id,
                YearId = r.Type == "project" ? r.YearId : null,
                Scope = r.Type == "document" ? r.ScopeKind : null,
                ScopeId = r.Type == "document" ? (r.ScopeKind == "district" ? r.DistrictId : r.ClubId) : null
            }
        };

        switch (r.Type)
        {
            case "greeting":
            {
                // Greeting rows carry raw material, not display text: Title holds the celebrant
                // name(s) and Extra holds either "self_<Occasion>" or "<birthdays>/<anniversaries>".
                var names = r.Title ?? "";

                if (r.Extra != null && r.Extra.StartsWith("self_", StringComparison.OrdinalIgnoreCase))
                {
                    bool bd = r.Extra.EndsWith("Birthday", StringComparison.OrdinalIgnoreCase);
                    dto.Title = bd ? "Happy Birthday!" : "Happy Anniversary!";
                    dto.Body = $"Warm wishes from {dto.SourceName}.";
                    dto.DeepLink.EntityId = r.Id;   // the member's own profile
                    break;
                }

                var (bCount, aCount) = ParseCelebrationCounts(r.Extra);
                if (bCount + aCount == 1)
                {
                    dto.Title = $"{names}'s {(bCount == 1 ? "Birthday" : "Anniversary")}";
                    dto.Body = $"{names} · {dto.SourceName}";
                }
                else
                {
                    // Same phrasing GreetingsJob.BuildDigestBody uses for the push itself.
                    var parts = new List<string>();
                    if (bCount > 0) parts.Add($"{bCount} birthday{(bCount == 1 ? "" : "s")}");
                    if (aCount > 0) parts.Add($"{aCount} anniversar{(aCount == 1 ? "y" : "ies")}");
                    dto.Title = string.Join(" and ", parts) + " to celebrate";
                    dto.Body = Trim(names);
                }
                // celebrations_digest carries no entity id (Firebase_Notification_Routes.md) —
                // the app opens the club calendar for the row's date.
                dto.DeepLink.EntityId = null;
                break;
            }
            case "project":
                // Extra holds the avenue's display name ("Community Service", ...).
                if (!string.IsNullOrWhiteSpace(r.Extra))
                    dto.Body = string.IsNullOrWhiteSpace(dto.Body) ? r.Extra : $"{r.Extra} · {dto.Body}";
                if (r.ClubId is int cid && photos.TryGetValue((r.YearId, r.Id), out var url))
                    dto.ImageUrl = url;
                break;
            case "event":
                // Extra holds the event's own date so the card can show "on <date>".
                if (!string.IsNullOrWhiteSpace(r.Extra) && DateTime.TryParse(r.Extra, out var ed))
                    dto.Body = string.IsNullOrWhiteSpace(dto.Body)
                        ? ed.ToString("dd MMM yyyy, h:mm tt")
                        : $"{ed:dd MMM yyyy, h:mm tt} · {dto.Body}";
                break;
            case "meeting":
            {
                // Extra holds "<mode>|<meeting time>": the reminder names the time, the mode and, online or hybrid, the join link.
                var parts = (r.Extra ?? "").Split('|', 2);
                var at = parts.Length == 2 && DateTime.TryParse(parts[1], out var md) ? md.ToString("dd MMM yyyy, h:mm tt") : null;
                dto.Title = $"Meeting reminder: {dto.Title}";
                dto.Body = string.Join(" · ", new[] { at, MeetingsService.ModeLabel(parts[0]), r.LinkUrl }
                    .Where(s => !string.IsNullOrEmpty(s)));
                break;
            }
            case "newsletter":
                dto.Body ??= "A new newsletter has been published.";
                break;
            case "document":
                dto.Body ??= "A new document has been published.";
                break;
            case "highlight":
            {
                // Title holds the member's name, Extra "MILESTONE:5" or "PHF:2" (see HighlightLeg).
                var parts = (r.Extra ?? "").Split(':');
                var level = parts.Length > 1 && int.TryParse(parts[1], out var lv) ? lv : 0;
                var name = r.Title ?? "";
                dto.Title = $"{name}: {EngagementService.Label(parts[0], level)}";
                dto.Body = EngagementService.Sentence(parts[0], level, name, dto.SourceName);
                break;
            }
            case "grant":
                // the deep link opens the application, not the notification row
                dto.DeepLink.EntityId = int.TryParse(r.Extra, out var appId) ? appId : null;
                break;
        }

        return dto;
    }

    private static string SourceName(FeedRow r, Dictionary<int, string> clubNames, Dictionary<int, string> districtNumbers)
    {
        if (r.ScopeKind == "district" && r.DistrictId is int did && districtNumbers.TryGetValue(did, out var num))
            return $"District {num}";
        if (r.ClubId is int cid && clubNames.TryGetValue(cid, out var name)) return name;
        if (r.DistrictId is int d2 && districtNumbers.TryGetValue(d2, out var n2)) return $"District {n2}";
        return "Rotary";
    }

    /// <summary>Parses the digest leg's "&lt;birthdays&gt;/&lt;anniversaries&gt;" counter string.</summary>
    private static (int Birthdays, int Anniversaries) ParseCelebrationCounts(string? extra)
    {
        if (string.IsNullOrWhiteSpace(extra)) return (0, 0);
        var parts = extra.Split('/');
        if (parts.Length != 2) return (0, 0);
        // SUM() comes back as a DECIMAL string ("11" or "11.0" depending on server settings).
        int P(string s) => decimal.TryParse(s, System.Globalization.NumberStyles.Any,
                                            System.Globalization.CultureInfo.InvariantCulture, out var d) ? (int)d : 0;
        return (P(parts[0]), P(parts[1]));
    }

    private static string? Trim(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        return s.Length <= BodyMaxChars ? s : s[..BodyMaxChars] + "…";
    }
}
