using ClosedXML.Excel;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Daily statistics report — a background service (DailyStatsReportBackgroundService) fires this
// once a day at 06:00 in the brand's time zone. It emails a counts table (HTML body) + a multi-sheet Excel attachment
// (Sync-club list, Non-sync-club list, District-wise summary, Project breakdown) to the recipients.
//
// Scope: the organisation is ROW (ROW). All headline club/member numbers are
// scoped to those five zones; everything else is reported separately under "Other Zones". The 3
// permanently-exempt districts (5656 test district, 1280 = COG's district, "IFRM India") and the
// placeholder "Zone 0" are left out of every number. Only active districts / non-deleted rows count.
//
// PROJECT COUNTS come from ProjectCountRules — the same definition the public website counts with
// (user, 2026-09-28: the report's project total must match portal.example.org/projects). So an
// ongoing project counts ONCE, a project the moderator hasn't approved doesn't count, and one
// whose beneficiary count went over the limit without approval doesn't either. Each rule's
// removals are reported here as their own columns, which the website has no room to show.
public interface IDailyStatsReportService
{
    // Compute everything and build the Excel + email body — WITHOUT sending. Used by the
    // preview/download endpoint (works on dev, no email) and by the scheduled send below.
    Task<DailyStatsResult> BuildReportAsync(CancellationToken ct = default);
    // Build + email to the configured recipients. On a dev/remote-DB machine the SCHEDULED job is
    // suppressed (force=false) so it can't spam recipients while developing; a manual admin trigger
    // passes force=true to actually send (and log) for on-demand testing.
    Task SendDailyReportAsync(CancellationToken ct = default, bool force = false);
}

public sealed class DailyStatsResult
{
    public byte[] Excel { get; set; } = Array.Empty<byte>();
    public string Html { get; set; } = "";
    public string Subject { get; set; } = "";
    public string FileName { get; set; } = "";
    public List<KeyValuePair<string, long>> Metrics { get; set; } = new();
    // Avenue × (one-time / ongoing / total) tables, for the on-screen preview.
    public List<AvenueBreakdown> Breakdowns { get; set; } = new();
}

public sealed class AvenueBreakdown
{
    public string Title { get; set; } = "";
    public List<AvenueBreakdownRow> Rows { get; set; } = new();
}

public sealed class AvenueBreakdownRow
{
    public string Avenue { get; set; } = "";
    public long OneTime { get; set; }
    public long Ongoing { get; set; }
    public long Total { get; set; }
    // What the counting rules left out of Total (user, 2026-09-28 — the email shows these
    // as separate columns; the website just shows Total).
    public long NotRepeat { get; set; }
    public long NotModerator { get; set; }
    public long NotBeneficiary { get; set; }
    // Club Service (meetings) and "Other" (no module) sit under the project total, never in it.
    public bool IsProject { get; set; } = true;
}

public class DailyStatsReportService : IDailyStatsReportService
{
    private readonly string _conn;
    private readonly IEmailService _email;
    private readonly IYearTableResolver _yearTables;
    private readonly IProjectCountRules _countRules;
    private readonly ILogger<DailyStatsReportService> _logger;
    private readonly string[] _recipients;
    private readonly bool _suppressLocalDev;

    // ROW (as the NestJS edition): zones and exempt districts from Brand:Scope (empty zones = all zones,
    // empty exempt list = none). The original platform hard-coded its own zones and its own test / COG / partner districts.
    private static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;
    private static string[] ScopeZones => RotaryApi.Services.Brand.Zones.Length > 0 ? RotaryApi.Services.Brand.Zones : new[] { "" };
    private static int AllZones => RotaryApi.Services.Brand.Zones.Length == 0 ? 1 : 0;
    private const string Zone0 = "Zone 0";
    // The five ROW zones this organisation covers. Everything else = "Other Zones".


    // The avenues of service + Public Image (module keys), in display order. Project counts split by these.
    private static readonly (string Key, string Label)[] Avenues =
    {
        ("club_service",             "Club Service"),
        ("community_service",        "Community Service"),
        ("vocational_service",       "Vocational Service"),
        ("international_service",    "International Service"),
        ("new_generation_service",   "New Generation Service"),
        ("public_image_initiative",  "Public Image Initiative"),
    };

    public DailyStatsReportService(IConfiguration config, IEmailService email,
        IYearTableResolver yearTables, IProjectCountRules countRules, ILogger<DailyStatsReportService> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _yearTables = yearTables;
        _countRules = countRules;
        _logger = logger;
        // A non-localhost DB host ⇒ a developer machine pointing at the remote DB ⇒ do NOT send the
        // real email (never fires on the server, which connects as Server=localhost). Same guard as
        // CmrSubmissionMailer — stops the 06:00 job from mailing real recipients while testing locally.
        _suppressLocalDev = IsRemoteDb(_conn);
        var configured = config.GetSection("DailyStatsReport:Recipients").Get<string[]>();
        _recipients = (configured != null && configured.Length > 0)
            ? configured
            : RotaryApi.Services.Brand.ReportRecipients;
    }

    private sealed class SyncSummaryRow
    {
        public string? ZoneName { get; set; }
        public string? DistrictNumber { get; set; }
        public int SyncClubs { get; set; }
        public int NonSyncClubs { get; set; }
        public int MemberCount { get; set; }
    }
    private sealed class SyncClubRow
    {
        public string? ZoneName { get; set; }
        public string? DistrictNumber { get; set; }
        public string? ClubName { get; set; }
        public string? ClubRotaryId { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public int MemberCount { get; set; }
    }
    // One avenue's project split. OneTime + Ongoing are what COUNTS (and what the website
    // shows); the three Not* columns are the rows the rules removed, reported so the email
    // can explain the difference between "entered" and "counted".
    private sealed class AvenueRow
    {
        public string Label { get; set; } = "";
        public long OneTime { get; set; }
        public long Ongoing { get; set; }
        public long NotRepeat { get; set; }        // repeat entry of an ongoing project
        public long NotModerator { get; set; }     // club moderator has not approved it
        public long NotBeneficiary { get; set; }   // beneficiaries over the limit, not approved
        public long Total => OneTime + Ongoing;
        public long NotCounted => NotRepeat + NotModerator + NotBeneficiary;
    }

    // Club Service is the club's meetings, not a project: it is reported on its own line,
    // below the project total. A row belonging to no module at all never reaches here — see
    // ProjectCountFilter.AvenueModuleKeys — so there is no "Other" row any more.
    private const string ClubServiceLabel = "Club Service";
    private static bool IsProjectAvenue(AvenueRow r) => r.Label != ClubServiceLabel;
    private static List<AvenueRow> ProjectAvenues(List<AvenueRow> rows) => rows.Where(IsProjectAvenue).ToList();

    public async Task<DailyStatsResult> BuildReportAsync(CancellationToken ct = default)
    {
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync(ct);

        // Zone-scope params. Everything is scoped to the 5 ROW zones (the zones); exempt
        // districts + inactive districts are out everywhere.
        var pIndia = new { Exempt = ExemptDistrictNumbers, Zones = ScopeZones, AllZones };

        const string indiaZoneClause = "(@AllZones = 1 OR z.ZoneName IN @Zones)";

        // ── Current year + module ids ─────────────────────────────────────────
        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS Id, YearLabel AS Label FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        int curYearId = year == null ? 0 : Convert.ToInt32(year.Id);
        string curYearLabel = year == null ? "" : (string)year.Label;
        string curProjects = string.IsNullOrEmpty(curYearLabel) ? "" : _yearTables.GetProjectsTableName(curYearLabel);
        string curPhotos = string.IsNullOrEmpty(curYearLabel) ? "" : _yearTables.GetPhotosTableName(curYearLabel);

        // Avenue module ids (resolve by stable ModuleKey → id, and id → display label).
        var keyToId = new Dictionary<string, int>();
        foreach (var m in await conn.QueryAsync<dynamic>(
            "SELECT pk_module_id AS Id, ModuleKey AS K FROM module_master WHERE ModuleKey IN @Keys AND isdeleted = 0",
            new { Keys = Avenues.Select(a => a.Key).ToArray() }))
            keyToId[(string)m.K] = Convert.ToInt32(m.Id);
        var idToLabel = new Dictionary<int, string>();
        foreach (var a in Avenues) if (keyToId.TryGetValue(a.Key, out var id)) idToLabel[id] = a.Label;

        // ── Club / member counts — the zones (primary) ────────────────────────
        long syncClubs = await CountClubsAsync(conn, indiaZoneClause, synced: true, pIndia);
        long nonSyncClubs = await CountClubsAsync(conn, indiaZoneClause, synced: false, pIndia);
        long totalMembers = await CountMembersAsync(conn, indiaZoneClause, pIndia);

        // ── Newsletters (current year) ────────────────────────────────────────
        long newslettersCurYear = curYearId <= 0 ? 0 : await conn.ExecuteScalarAsync<long>(
            "SELECT COUNT(*) FROM newsletters WHERE fk_year_id = @Y AND COALESCE(isdeleted,0) = 0",
            new { Y = curYearId });

        // ── Project photos (incl. Club Service) — current year + all years ────
        // Photo tables have NO isdeleted column (photos cascade-delete with their project via the FK),
        // so only the project row is isdeleted-filtered.
        long photosCurYear = 0;
        if (!string.IsNullOrEmpty(curPhotos) && !string.IsNullOrEmpty(curProjects))
            photosCurYear = await CountPhotosAsync(conn, curPhotos, curProjects);

        long photosAllYears = 0;
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
            photosAllYears += await CountPhotosAsync(conn, t.PhotosTable, t.ProjectsTable);

        // ── Project splits by avenue (counted + what each rule removed) ───────
        // Same rules and same universe as the public website — see ProjectCountRules.
        var filter = await _countRules.GetFilterAsync(conn, ct);

        // Yesterday — across every year-wise table (a project can be logged under any year).
        var yesterdayAcc = new Dictionary<int, AvenueRow>();
        foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
            await AccumulateAvenueSplitAsync(conn, filter, t.ProjectsTable,
                "AND DATE(p.created_date) = (CURDATE() - INTERVAL 1 DAY)", yesterdayAcc);
        var yesterdayRows = ToAvenueRows(yesterdayAcc, idToLabel);

        // Total projects — current year only.
        var curAcc = new Dictionary<int, AvenueRow>();
        if (!string.IsNullOrEmpty(curProjects))
            await AccumulateAvenueSplitAsync(conn, filter, curProjects, null, curAcc);
        var curRows = ToAvenueRows(curAcc, idToLabel);

        // Totals are the PROJECT avenues only: Club Service is meetings, and "Other" is rows
        // with no module. Both are shown on their own line under the total instead.
        long yesterdayOneTime = ProjectAvenues(yesterdayRows).Sum(r => r.OneTime);
        long yesterdayOngoing = ProjectAvenues(yesterdayRows).Sum(r => r.Ongoing);
        long yesterdayTotal = yesterdayOneTime + yesterdayOngoing;
        var curProjectRows = ProjectAvenues(curRows);
        long curOneTime = curProjectRows.Sum(r => r.OneTime);
        long curOngoing = curProjectRows.Sum(r => r.Ongoing);
        long totalProjectsCurYear = curOneTime + curOngoing;
        long curNotRepeat = curProjectRows.Sum(r => r.NotRepeat);
        long curNotModerator = curProjectRows.Sum(r => r.NotModerator);
        long curNotBeneficiary = curProjectRows.Sum(r => r.NotBeneficiary);
        long clubServiceCurYear = curRows.FirstOrDefault(r => r.Label == ClubServiceLabel)?.Total ?? 0;

        // Clubs involved in projects — the clubs behind the counted projects, so this answers
        // the same question the website's "clubs involved" tile does (it used to count a club
        // whose only entry was a meeting, a repeat, or something still awaiting approval).
        long clubsInProjects = string.IsNullOrEmpty(curProjects) ? 0 : await conn.ExecuteScalarAsync<long>(
            $@"SELECT COUNT(DISTINCT p.fk_club_id)
               FROM `{curProjects}` p
               JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                    AND mm.ModuleKey IN ({ProjectCountFilter.ProjectModuleKeys})
               {ProjectCountFilter.Geo("p.fk_club_id")}
               WHERE {filter.CountsAsProject(curProjects)}");

        // ── District-wise summary + club lists (Excel) ────────────────────────
        // Scoped to the SAME 5 ROW zones (the zones) as every headline count, so the detail
        // sheets tie out exactly to the preview: Sync/Non-Sync club sheet row counts == headline club
        // counts, and the District Summary sync/non-sync TOTALs == headline. (Exempt + inactive
        // districts, Other Zones and null-zone districts are all excluded here too.)
        var pExcel = new { Exempt = ExemptDistrictNumbers, Zones = ScopeZones, AllZones };
        var summary = (await conn.QueryAsync<SyncSummaryRow>(@"
            SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber,
                   CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS SyncClubs,
                   CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS NonSyncClubs,
                   (SELECT COUNT(DISTINCT cm.fk_club_id, cm.fk_member_master_profile_id)
                    FROM club_members cm
                    JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0 AND c2.IsSyncedFromRotaryOrg = 1
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
            FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
            WHERE d.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
              AND (@AllZones = 1 OR z.ZoneName IN @Zones)
            GROUP BY d.pk_district_id, z.ZoneName, d.DistrictNumber
            HAVING (SyncClubs + NonSyncClubs) > 0
            ORDER BY z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { Exempt = ExemptDistrictNumbers, Zones = ScopeZones, AllZones })).ToList();

        const string clubListSql = @"
            SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber, c.ClubName AS ClubName,
                   c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                    FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
              AND (@AllZones = 1 OR z.ZoneName IN @Zones) AND {0}
            ORDER BY z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName";
        var syncList = (await conn.QueryAsync<SyncClubRow>(
            string.Format(clubListSql, "c.IsSyncedFromRotaryOrg = 1"), pExcel)).ToList();
        var nonSyncList = (await conn.QueryAsync<SyncClubRow>(
            string.Format(clubListSql, "(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)"), pExcel)).ToList();

        // ── Metrics (headline counts) — used by both the Summary sheet and the email body ──
        var metrics = new (string Label, long Value)[]
        {
            ("Total Sync Clubs (the zones)", syncClubs),
            ("Total Members (the zones)", totalMembers),
            ("Total Non-Sync Clubs (excluding exempt districts)", nonSyncClubs),
            ($"Total Newsletters ({curYearLabel})", newslettersCurYear),
            ($"Total Project Photos — {curYearLabel}", photosCurYear),
            ("Total Project Photos — All Years", photosAllYears),
            ("Projects Added Yesterday — One-Time", yesterdayOneTime),
            ("Projects Added Yesterday — Ongoing", yesterdayOngoing),
            ("Projects Added Yesterday — Total", yesterdayTotal),
            ($"Total Club Service ({curYearLabel})", clubServiceCurYear),
            ($"Total Projects ({curYearLabel}) — One-Time", curOneTime),
            ($"Total Projects ({curYearLabel}) — Ongoing", curOngoing),
            ($"Total Projects ({curYearLabel}) — Total (= website)", totalProjectsCurYear),
            ($"Not counted — repeat entries of ongoing projects", curNotRepeat),
            ($"Not counted — moderator approval pending", curNotModerator),
            ($"Not counted — beneficiary approval pending", curNotBeneficiary),
            ($"Clubs Involved in Projects ({curYearLabel})", clubsInProjects),
        };

        // ── Build the Excel (Summary sheet first, then the existing detail sheets) ──────
        // totalMembers is the DISTINCT-overall member count (a multi-club/district member counted
        // once) — used for the District Summary TOTAL so it ties out to the preview exactly.
        byte[] excel = BuildWorkbook(metrics, summary, syncList, nonSyncList, yesterdayRows, curRows, curYearLabel, totalMembers);

        // ── Email body (counts) + return ─────────────────────────────────────
        string html = BuildEmailBody(metrics, summary.Count, yesterdayRows, curRows, curYearLabel);
        string subject = $"ROW Daily Statistics — {DateTime.Now:dd MMM yyyy}";
        string fileName = $"ROW_Daily_Stats_{DateTime.Now:ddMMyyyy}.xlsx";

        AvenueBreakdown ToBreakdown(string title, List<AvenueRow> src) => new()
        {
            Title = title,
            Rows = src.Select(a => new AvenueBreakdownRow
            {
                Avenue = a.Label, OneTime = a.OneTime, Ongoing = a.Ongoing, Total = a.Total,
                NotRepeat = a.NotRepeat, NotModerator = a.NotModerator, NotBeneficiary = a.NotBeneficiary,
                IsProject = IsProjectAvenue(a),
            }).ToList(),
        };

        return new DailyStatsResult
        {
            Excel = excel,
            Html = html,
            Subject = subject,
            FileName = fileName,
            Metrics = metrics.Select(m => new KeyValuePair<string, long>(m.Label, m.Value)).ToList(),
            Breakdowns = new List<AvenueBreakdown>
            {
                ToBreakdown("Projects Added Yesterday", yesterdayRows),
                ToBreakdown($"Total Projects ({curYearLabel})", curRows),
            },
        };
    }

    // ── Count helpers (zone clause swapped for the India / Other buckets) ─────
    private static async Task<long> CountClubsAsync(MySqlConnection conn, string zoneClause, bool synced, object p)
    {
        string syncCond = synced
            ? "c.IsSyncedFromRotaryOrg = 1"
            : "(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)";
        return await conn.ExecuteScalarAsync<long>($@"
            SELECT COUNT(*) FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE {syncCond} AND c.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1 AND {zoneClause}", p);
    }

    private static async Task<long> CountMembersAsync(MySqlConnection conn, string zoneClause, object p)
    {
        // Members are counted for SYNCED clubs only (c.IsSyncedFromRotaryOrg = 1), and counted PER
        // CLUB (distinct club+member pair) — a member active in two synced clubs counts for each, so
        // this headline equals the sum of the per-club / per-district member columns in the Excel.
        return await conn.ExecuteScalarAsync<long>($@"
            SELECT COUNT(DISTINCT cm.fk_club_id, cm.fk_member_master_profile_id)
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND {zoneClause}", p);
    }

    // Project photos are counted for SYNCED clubs in the zones only. p is the project table.
    // All avenues INCLUDING Club Service.
    private async Task<long> CountPhotosAsync(MySqlConnection conn, string photoTable, string projTable)
    {
        try
        {
            return await conn.ExecuteScalarAsync<long>($@"
                SELECT COUNT(*)
                FROM `{photoTable}` pp
                JOIN `{projTable}` p ON p.pk_project_id = pp.fk_project_id
                JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
                JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt AND d.IsActive = 1
                JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND (@AllZones = 1 OR z.ZoneName IN @Zones)
                WHERE COALESCE(p.isdeleted, 0) = 0",
                new { Exempt = ExemptDistrictNumbers, Zones = ScopeZones, AllZones });
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Daily report: photo count failed for {Table}", photoTable); return 0; }
    }

    // Group a project table by (module, bucket) and fold the counts into acc.
    //
    // The universe and every rule come from ProjectCountFilter, so this measures EXACTLY the
    // set the website publishes — active club in an active district of an India zone, exempt
    // districts and Zone 0 out. Note what is deliberately NOT here any more: the old
    // IsSyncedFromRotaryOrg = 1 condition. It belongs to the club/member headline (whose whole
    // point is the sync split) but it would have made the project total unmatchable, since the
    // public site rightly shows a non-synced club's projects too (3,652 of them, all years).
    //
    // dateClause (if any) must qualify its column as p.created_date.
    private async Task AccumulateAvenueSplitAsync(MySqlConnection conn, ProjectCountFilter f, string table,
        string? dateClause, Dictionary<int, AvenueRow> acc)
    {
        try
        {
            var rows = await conn.QueryAsync<dynamic>($@"
                SELECT p.fk_module_id AS ModuleId, {f.BucketExpr(table)} AS Bucket, COUNT(*) AS Cnt
                FROM `{table}` p
                JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                     AND mm.ModuleKey IN ({ProjectCountFilter.AvenueModuleKeys})
                {ProjectCountFilter.Geo("p.fk_club_id")}
                WHERE {ProjectCountFilter.Live()} {dateClause}
                GROUP BY p.fk_module_id, Bucket");
            foreach (var r in rows)
            {
                int mid = Convert.ToInt32(r.ModuleId);
                long c = Convert.ToInt64(r.Cnt);
                if (!acc.TryGetValue(mid, out var row)) acc[mid] = row = new AvenueRow();
                switch ((string)r.Bucket)
                {
                    case "one_time": row.OneTime += c; break;
                    case "ongoing": row.Ongoing += c; break;
                    case "repeat": row.NotRepeat += c; break;
                    case "moderator": row.NotModerator += c; break;
                    case "beneficiary": row.NotBeneficiary += c; break;
                }
            }
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Daily report: avenue split failed for {Table}", table); }
    }

    // Fold a module-keyed accumulator into the 6 fixed avenue rows. Anything else was already
    // filtered out by the query's module join, so an unknown id here is impossible rather than
    // silently dropped.
    private static List<AvenueRow> ToAvenueRows(Dictionary<int, AvenueRow> acc, Dictionary<int, string> idToLabel)
    {
        var rows = Avenues.Select(a => new AvenueRow { Label = a.Label }).ToList();
        foreach (var kv in acc)
        {
            if (!idToLabel.TryGetValue(kv.Key, out var lbl)) continue;
            var target = rows.First(r => r.Label == lbl);
            target.OneTime += kv.Value.OneTime;
            target.Ongoing += kv.Value.Ongoing;
            target.NotRepeat += kv.Value.NotRepeat;
            target.NotModerator += kv.Value.NotModerator;
            target.NotBeneficiary += kv.Value.NotBeneficiary;
        }
        return rows;
    }

    public async Task SendDailyReportAsync(CancellationToken ct = default, bool force = false)
    {
        var r = await BuildReportAsync(ct);

        if (_recipients.Length == 0) { _logger.LogWarning("Daily report: no recipients configured."); return; }
        var to = _recipients[0];
        var cc = _recipients.Skip(1).ToList();
        // Suppress on a dev/remote-DB machine ONLY for the scheduled job (force=false). A manual
        // admin trigger (force=true) always sends + logs, so email delivery can be tested on dev.
        if (_suppressLocalDev && !force)
        {
            _logger.LogWarning("Daily statistics report SUPPRESSED — local dev (API on a remote DB). Would send to {To} (cc {Cc}). Metrics: {Metrics}",
                to, string.Join(", ", cc), string.Join(" | ", r.Metrics.Select(m => $"{m.Key}={m.Value}")));
            return;
        }
        if (_suppressLocalDev && force)
            _logger.LogWarning("Daily statistics report FORCE-SEND on a dev/remote-DB machine (manual trigger) — emailing real recipients {To} (cc {Cc}).",
                to, string.Join(", ", cc));
        await _email.SendEmailWithAttachmentAsync(to, r.Subject, r.Html, r.Excel, r.FileName, cc);
        _logger.LogInformation("Daily statistics report sent to {To} (cc {Cc}).", to, string.Join(", ", cc));
    }

    // True when the DB host is NOT localhost — i.e. a developer machine pointing at the remote DB.
    private static bool IsRemoteDb(string connectionString)
    {
        try
        {
            var server = (new MySqlConnectionStringBuilder(connectionString).Server ?? "").Trim().ToLowerInvariant();
            return server.Length > 0 && server != "localhost" && server != "127.0.0.1" && server != "::1";
        }
        catch { return false; }   // can't parse → assume production (send) rather than silently drop.
    }

    // First sheet — headline counts, styled exactly like the Club Analytics "Club Report" sheet
    // (navy title band + grey subtitle + italic "Generated" line + blue section bars + bordered KV rows).
    private static void BuildSummarySheet(XLWorkbook wb, (string Label, long Value)[] metrics,
        List<AvenueRow> yesterdayRows, List<AvenueRow> curRows, string curYearLabel)
    {
        var navy = XLColor.FromHtml("#1a365d");
        var blue = XLColor.FromHtml("#2d7fc7");
        var labelBg = XLColor.FromHtml("#f1f5f9");
        var border = XLColor.FromHtml("#cbd5e1");

        var ws = wb.Worksheets.Add("Summary");
        ws.Column(1).Width = 54;
        ws.Column(2).Width = 18;
        ws.Column(3).Width = 14;
        ws.Column(4).Width = 14;
        ws.Column(5).Width = 15;   // the three "not counted" columns of the avenue block
        ws.Column(6).Width = 17;
        ws.Column(7).Width = 18;
        int r = 1;

        // Title band
        ws.Range(r, 1, r, 7).Merge();
        var title = ws.Cell(r, 1);
        title.Value = "ROW — Daily Statistics";
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 18;
        title.Style.Font.FontColor = XLColor.White;
        title.Style.Fill.BackgroundColor = navy;
        title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        title.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(r).Height = 34; r++;

        // Subtitle
        ws.Range(r, 1, r, 7).Merge();
        var sub = ws.Cell(r, 1);
        sub.Value = $"ROW   ·   Rotary Year {curYearLabel}";
        sub.Style.Font.FontSize = 10;
        sub.Style.Font.FontColor = XLColor.FromHtml("#475569");
        sub.Style.Fill.BackgroundColor = XLColor.FromHtml("#eef2f7");
        sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(r).Height = 20; r++;

        // Generated line
        ws.Range(r, 1, r, 7).Merge();
        var gen = ws.Cell(r, 1);
        gen.Value = $"Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}";
        gen.Style.Font.FontSize = 8;
        gen.Style.Font.Italic = true;
        gen.Style.Font.FontColor = XLColor.FromHtml("#94a3b8");
        gen.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r++;
        r++; // spacer

        void Section(string label)
        {
            ws.Range(r, 1, r, 7).Merge();
            var c = ws.Cell(r, 1);
            c.Value = label;
            c.Style.Font.Bold = true;
            c.Style.Font.FontColor = XLColor.White;
            c.Style.Fill.BackgroundColor = blue;
            c.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 22; r++;
        }
        // Project-breakdown block: the 5 project avenues, a bold TOTAL (the figure the website
        // publishes), then Club Service BELOW it — outside the total — and three columns saying
        // what the counting rules removed.
        const int AvCols = 7;
        void AvenueBlock(string title, List<AvenueRow> rows)
        {
            Section(title);
            string[] h = { "Avenue", "One-Time", "Ongoing", "Counted", "Repeat entries", "Moderator pending", "Beneficiary pending" };
            for (int i = 0; i < h.Length; i++) ws.Cell(r, i + 1).Value = h[i];
            var hr = ws.Range(r, 1, r, AvCols);
            hr.Style.Fill.BackgroundColor = navy;
            hr.Style.Font.FontColor = XLColor.White;
            hr.Style.Font.Bold = true;
            hr.Style.Alignment.WrapText = true;
            for (int i = 2; i <= AvCols; i++) ws.Cell(r, i).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            r++;
            int firstDataRow = r;
            void DataRow(AvenueRow a)
            {
                ws.Cell(r, 1).Value = a.Label;
                ws.Cell(r, 2).Value = a.OneTime;
                ws.Cell(r, 3).Value = a.Ongoing;
                ws.Cell(r, 4).Value = a.Total;
                ws.Cell(r, 5).Value = a.NotRepeat;
                ws.Cell(r, 6).Value = a.NotModerator;
                ws.Cell(r, 7).Value = a.NotBeneficiary;
                for (int i = 2; i <= AvCols; i++) ws.Cell(r, i).Style.NumberFormat.Format = "#,##0";
                r++;
            }
            var projects = ProjectAvenues(rows);
            foreach (var a in projects) DataRow(a);

            ws.Cell(r, 1).Value = "TOTAL PROJECTS";
            ws.Cell(r, 2).Value = projects.Sum(x => x.OneTime);
            ws.Cell(r, 3).Value = projects.Sum(x => x.Ongoing);
            ws.Cell(r, 4).Value = projects.Sum(x => x.Total);
            ws.Cell(r, 5).Value = projects.Sum(x => x.NotRepeat);
            ws.Cell(r, 6).Value = projects.Sum(x => x.NotModerator);
            ws.Cell(r, 7).Value = projects.Sum(x => x.NotBeneficiary);
            for (int i = 2; i <= AvCols; i++) ws.Cell(r, i).Style.NumberFormat.Format = "#,##0";
            var tr = ws.Range(r, 1, r, AvCols);
            tr.Style.Font.Bold = true;
            tr.Style.Fill.BackgroundColor = XLColor.FromHtml("#cfe0f4");
            r++;

            // Below the line: the club's meetings, never in the project total.
            foreach (var a in rows.Where(x => !IsProjectAvenue(x)))
            {
                int at = r;
                DataRow(a);
                ws.Range(at, 1, at, AvCols).Style.Font.Italic = true;
                ws.Cell(at, 1).Value = "Club Service (meetings — not a project)";
            }

            var block = ws.Range(firstDataRow - 1, 1, r - 1, AvCols);
            block.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            block.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            block.Style.Border.OutsideBorderColor = border;
            block.Style.Border.InsideBorderColor = XLColor.FromHtml("#e2e8f0");
            ws.Range(firstDataRow, 2, r - 1, AvCols).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            r++;
        }
        void KV(string key, long val)
        {
            var k = ws.Cell(r, 1); k.Value = key;
            k.Style.Font.Bold = true;
            k.Style.Font.FontColor = XLColor.FromHtml("#334155");
            k.Style.Fill.BackgroundColor = labelBg;
            var v = ws.Cell(r, 2); v.Value = val;
            v.Style.NumberFormat.Format = "#,##0";
            v.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            var rng = ws.Range(r, 1, r, 2);
            rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            rng.Style.Border.OutsideBorderColor = border;
            rng.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            r++;
        }

        // metrics order (14): 3 clubs/members · 3 communications · 3 projects-yesterday · 5 projects-year.
        Section("Clubs & Members");
        foreach (var m in metrics.Take(3)) KV(m.Label, m.Value);
        r++;
        Section("Communications & Photos");
        foreach (var m in metrics.Skip(3).Take(3)) KV(m.Label, m.Value);
        r++;
        Section("Projects Added Yesterday");
        foreach (var m in metrics.Skip(6).Take(3)) KV(m.Label, m.Value);
        r++;
        Section($"Projects — {curYearLabel}");
        foreach (var m in metrics.Skip(9)) KV(m.Label, m.Value);
        r++;

        // ── Project breakdown (moved here from the old separate sheet) — below the counts ──
        AvenueBlock("Projects Added Yesterday — by Avenue", yesterdayRows);
        r++;
        AvenueBlock($"Total Projects ({curYearLabel}) — by Avenue", curRows);

        ws.SheetView.FreezeRows(4);
    }

    private static byte[] BuildWorkbook((string Label, long Value)[] metrics, List<SyncSummaryRow> summary, List<SyncClubRow> syncList,
        List<SyncClubRow> nonSyncList, List<AvenueRow> yesterdayRows, List<AvenueRow> curRows, string curYearLabel, long totalMembers)
    {
        using var wb = new XLWorkbook();

        // ── Sheet 1 — SUMMARY (headline counts + project breakdown), styled like the Club Analytics report ──
        BuildSummarySheet(wb, metrics, yesterdayRows, curRows, curYearLabel);

        static void Style(IXLWorksheet ws, int cols, int lastDataRow, int[] numberCols, int? totalRow)
        {
            int lastRow = totalRow ?? lastDataRow;
            var header = ws.Range(1, 1, 1, cols);
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1F4E79");
            header.Style.Font.FontColor = XLColor.White;
            header.Style.Font.Bold = true;
            header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(1).Height = 22;
            if (lastRow >= 1)
            {
                var all = ws.Range(1, 1, lastRow, cols);
                all.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                all.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                all.Style.Border.OutsideBorderColor = XLColor.FromHtml("#8EAADB");
                all.Style.Border.InsideBorderColor = XLColor.FromHtml("#D9E1F2");
            }
            for (int rr = 2; rr <= lastDataRow; rr++)
                if (rr % 2 == 0)
                    ws.Range(rr, 1, rr, cols).Style.Fill.BackgroundColor = XLColor.FromHtml("#EAF1FB");
            if (lastDataRow >= 2)
                foreach (var nc in numberCols)
                    ws.Range(2, nc, lastDataRow, nc).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            if (totalRow.HasValue)
            {
                var tr = ws.Range(totalRow.Value, 1, totalRow.Value, cols);
                tr.Style.Font.Bold = true;
                tr.Style.Fill.BackgroundColor = XLColor.FromHtml("#CFE0F4");
                tr.Style.Border.TopBorder = XLBorderStyleValues.Medium;
            }
            ws.SheetView.FreezeRows(1);
            ws.Range(1, 1, lastDataRow < 1 ? 1 : lastDataRow, cols).SetAutoFilter();
            ws.Columns().AdjustToContents();
        }

        // Sheet 2 — District-wise summary.
        var ws1 = wb.Worksheets.Add("District Summary");
        string[] sh = { "Zone Name", "District Number", "Sync Club Count", "Non-Sync Club Count", "Total Members" };
        for (int i = 0; i < sh.Length; i++) ws1.Cell(1, i + 1).Value = sh[i];
        int r = 2;
        foreach (var s in summary)
        {
            ws1.Cell(r, 1).Value = s.ZoneName ?? "";
            ws1.Cell(r, 2).Value = s.DistrictNumber ?? "";
            ws1.Cell(r, 3).Value = s.SyncClubs;
            ws1.Cell(r, 4).Value = s.NonSyncClubs;
            ws1.Cell(r, 5).Value = s.MemberCount;
            r++;
        }
        int totalRow1 = r;
        ws1.Cell(totalRow1, 1).Value = "TOTAL";
        ws1.Cell(totalRow1, 3).Value = summary.Sum(x => x.SyncClubs);
        ws1.Cell(totalRow1, 4).Value = summary.Sum(x => x.NonSyncClubs);
        // Member TOTAL = DISTINCT across all the zones (matches the preview "Total Members").
        // NOT the sum of the per-district column — a member in clubs of two districts would be
        // counted twice in a plain sum, so the per-district cells need not add up to this total.
        // Member TOTAL = total memberships across the zones synced clubs (a member in N clubs counts
        // N times) — equals the sum of the per-district column above AND the preview "Total Members".
        ws1.Cell(totalRow1, 5).Value = totalMembers;
        Style(ws1, 5, totalRow1 - 1, new[] { 3, 4, 5 }, totalRow1);

        // Sheets 2 & 3 — club lists. Sync Clubs shows a Members column (real per-club roster);
        // Non-Sync Clubs omits it (members are reported for synced clubs only).
        void ClubSheet(string name, List<SyncClubRow> rows, bool showMembers)
        {
            var ws = wb.Worksheets.Add(name);
            string[] h = showMembers
                ? new[] { "Sr.No.", "Zone Name", "District Number", "Club Name", "Club Id (Rotary)", "City", "State", "Members" }
                : new[] { "Sr.No.", "Zone Name", "District Number", "Club Name", "Club Id (Rotary)", "City", "State" };
            for (int i = 0; i < h.Length; i++) ws.Cell(1, i + 1).Value = h[i];
            int rr = 2;
            foreach (var c in rows)
            {
                ws.Cell(rr, 1).Value = rr - 1;
                ws.Cell(rr, 2).Value = c.ZoneName ?? "";
                ws.Cell(rr, 3).Value = c.DistrictNumber ?? "";
                ws.Cell(rr, 4).Value = c.ClubName ?? "";
                ws.Cell(rr, 5).Value = c.ClubRotaryId ?? "";
                ws.Cell(rr, 6).Value = c.City ?? "";
                ws.Cell(rr, 7).Value = c.State ?? "";
                if (showMembers) ws.Cell(rr, 8).Value = c.MemberCount;
                rr++;
            }
            int cols = showMembers ? 8 : 7;
            Style(ws, cols, rr - 1, showMembers ? new[] { 1, 8 } : new[] { 1 }, null);
        }
        ClubSheet("Sync Clubs", syncList, showMembers: true);
        ClubSheet("Non-Sync Clubs", nonSyncList, showMembers: false);

        // (Project breakdown by avenue now lives on the Summary sheet, below the counts — no
        //  separate "Project Breakdown" sheet anymore.)

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static string BuildEmailBody((string Label, long Value)[] metrics, int districtCount,
        List<AvenueRow> yesterdayRows, List<AvenueRow> curRows, string curYearLabel)
    {
        var rows = string.Join("", metrics.Select((m, i) => $@"
            <tr style='background:{(i % 2 == 0 ? "#ffffff" : "#f4f7fb")}'>
                <td style='padding:8px 12px;border:1px solid #d9e1f2;font-size:14px;color:#333'>{System.Net.WebUtility.HtmlEncode(m.Label)}</td>
                <td style='padding:8px 12px;border:1px solid #d9e1f2;font-size:14px;color:#1F4E79;font-weight:bold;text-align:right'>{m.Value:N0}</td>
            </tr>"));
        return $@"
            {EmailService.EMAIL_HEADER}
                <p style='font-size:15px;margin:0 0 14px 0'><strong>ROW — Daily Statistics</strong><br/>
                <span style='font-size:12px;color:#666'>{DateTime.Now:dddd, dd MMMM yyyy}</span></p>
                <table style='border-collapse:collapse;width:100%;max-width:620px'>
                    <thead>
                        <tr style='background:#1F4E79;color:#fff'>
                            <th style='padding:9px 12px;border:1px solid #1F4E79;text-align:left;font-size:13px'>Particulars</th>
                            <th style='padding:9px 12px;border:1px solid #1F4E79;text-align:right;font-size:13px'>Count</th>
                        </tr>
                    </thead>
                    <tbody>{rows}</tbody>
                </table>
                {BuildBreakdownTable("Projects Added Yesterday — by Avenue", yesterdayRows)}
                {BuildBreakdownTable($"Total Projects ({curYearLabel}) — by Avenue", curRows)}
                <p style='font-size:12px;color:#555;line-height:1.7;margin-top:14px;max-width:760px'>
                    <strong>How a project is counted.</strong> One-time projects count once. An ongoing project
                    counts once — its parent entry, or, when the parent belongs to an earlier year, its first
                    entry of this year; its repeat entries are in <em>Repeat entries</em>. A project the club
                    moderator has not approved is in <em>Moderator pending</em>, and one whose beneficiary count
                    went over the limit without approval is in <em>Beneficiary pending</em>. Zone 0 and the
                    exempt districts count nowhere. Club Service is the club's
                    meetings, so it sits outside the project total. <strong>TOTAL PROJECTS is the same figure
                    the website publishes</strong> on its public projects page.
                </p>
                <p style='font-size:13px;color:#444;line-height:1.7;margin-top:16px'>
                    The attached Excel opens with a <strong>Summary</strong> sheet (all counts + the project breakdown by avenue),
                    followed by the detailed listings: <strong>District-wise summary</strong> ({districtCount} districts),
                    <strong>Sync Clubs</strong>, and <strong>Non-Sync Clubs</strong>.
                </p>
                <p style='font-size:12px;color:#888;font-style:italic'>Automated daily report from ROW.</p>
            {EmailService.EMAIL_FOOTER}";
    }

    // Avenue table: the 5 project avenues, a bold TOTAL PROJECTS row (the number the website
    // publishes), then Club Service below it — outside the total — plus the three columns
    // saying what the counting rules removed.
    private static string BuildBreakdownTable(string title, List<AvenueRow> rows)
    {
        static string Cell(long v, bool strong = false) =>
            $"<td style='padding:7px 10px;border:1px solid #d9e1f2;font-size:13px;text-align:right;color:{(strong ? "#1F4E79" : "#333")}{(strong ? ";font-weight:bold" : "")}'>{v:N0}</td>";
        static string Row(AvenueRow a, string bg, string label, bool italic = false) => $@"
            <tr style='background:{bg}{(italic ? ";font-style:italic" : "")}'>
                <td style='padding:7px 10px;border:1px solid #d9e1f2;font-size:13px;color:#333'>{System.Net.WebUtility.HtmlEncode(label)}</td>
                {Cell(a.OneTime)}{Cell(a.Ongoing)}{Cell(a.Total, true)}
                {Cell(a.NotRepeat)}{Cell(a.NotModerator)}{Cell(a.NotBeneficiary)}
            </tr>";

        var projects = ProjectAvenues(rows);
        var body = string.Join("", projects.Select((a, i) => Row(a, i % 2 == 0 ? "#ffffff" : "#f4f7fb", a.Label)));
        var below = string.Join("", rows.Where(x => !IsProjectAvenue(x)).Select(a =>
            Row(a, "#fbfbfb", "Club Service (meetings — not a project)", italic: true)));
        var total = new AvenueRow
        {
            OneTime = projects.Sum(x => x.OneTime),
            Ongoing = projects.Sum(x => x.Ongoing),
            NotRepeat = projects.Sum(x => x.NotRepeat),
            NotModerator = projects.Sum(x => x.NotModerator),
            NotBeneficiary = projects.Sum(x => x.NotBeneficiary),
        };
        static string Th(string t, bool right = true) =>
            $"<th style='padding:8px 10px;border:1px solid #1F4E79;text-align:{(right ? "right" : "left")};font-size:12px'>{t}</th>";
        return $@"
            <p style='font-size:13px;font-weight:bold;color:#1F4E79;margin:18px 0 6px 0'>{System.Net.WebUtility.HtmlEncode(title)}</p>
            <table style='border-collapse:collapse;width:100%;max-width:760px'>
                <thead>
                    <tr style='background:#1F4E79;color:#fff'>
                        {Th("Avenue", right: false)}{Th("One-Time")}{Th("Ongoing")}{Th("Counted")}
                        {Th("Repeat entries")}{Th("Moderator pending")}{Th("Beneficiary pending")}
                    </tr>
                </thead>
                <tbody>{body}{Row(total, "#cfe0f4", "TOTAL PROJECTS")}{below}</tbody>
            </table>";
    }
}
