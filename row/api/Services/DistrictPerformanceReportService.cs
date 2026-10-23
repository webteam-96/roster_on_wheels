using System.Globalization;
using System.Net;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// ── District Performance Report (DG progress report) — 2026-09-17 ─────────────────────────────────
// ONE district, current Rotary year, 1 July → today. Counts go in the email body (and the settings
// screen); listings go in a real .xlsx attachment. The same Sections list drives the email, the
// Excel Summary sheet and the screen, so all three always agree.
//
// Counting rules (agreed with the user 2026-09-17 / 2026-09-18):
//   • Clubs    — the CLUB COUNT includes synced and non-synced clubs, to match Rotary.org (user 2026-09-28).
//                Every other figure (members, per-club lists, projects, Club Monthly Report …) covers synced
//                clubs only; non-synced clubs are listed in the "Non-Synced Clubs" sheet.
//   • Members  — each person counted ONCE, honorary members never counted and never mentioned,
//                active clubs only (identical to Goal Setting's live membership counts).
//   • As on 1 July — the Goal Setting baseline rule: joined / chartered before 1 July.
//   • Left     — real departures only: TerminationDate in the year AND a TerminationReason. Club
//                terminations / duplicate merges also mark rows deleted and are NOT departures.
//   • Youth    — age 18–40 from BirthDate (the stored IsYouth flag goes stale; it is 0 for everyone).
//   • Projects — rejected projects excluded, district-level projects included, Club Service entries
//                reported separately (not projects). Costs converted to the district's currency.
//   • RAG      — Goal Setting's "Healthy Clubs" bands: RED 10–25, AMBER 26–40, GREEN 41+ members.
//   • Clubs "have set goals" — at least one saved TARGET value (Membership auto-fills live figures).
//   • District Dues and District Awards sections appear only when the district uses them that year.
//
// Schedule — HARD-CODED below (ScheduleOn / ScheduleMode / SendHour / recipient arrays), no appsettings:
//   Mode "Test" (now) → District 3142, daily at the send hour (brand time zone), to the two
//                       test addresses (first = To, rest = CC).
//   Mode "Live" (later) → on the 1st & 16th: every district to its District Governor (CC LiveCc; a district
//                       with no DG email is skipped and LiveCc is told).
// Scheduled sends are suppressed on a dev machine (remote DB) — same guard as the daily stats report.
// The SuperAdmin screen's "Send test email" always sends (to TestRecipients).
public interface IDistrictPerformanceReportService
{
    Task<List<PerformanceReportDistrictOption>> GetDistrictsAsync();
    Task<PerformanceReportSettingsDto> GetSettingsAsync();
    Task<DistrictPerformanceReportResult> BuildReportAsync(int districtId, bool includeAttachment, CancellationToken ct = default);
    Task<string> SendTestAsync(int districtId, int requestedByMemberId, CancellationToken ct = default);
    // The email body of an already-built report — the SuperAdmin screen's "Print" opens exactly this.
    string BuildPrintHtml(DistrictPerformanceReportResult result);
    // catchUp = the API started after today's send hour: only districts with a VERIFIED "not sent
    // today" log are sent, so a restart can never mail the same district twice.
    Task RunScheduledAsync(bool catchUp, CancellationToken ct = default);
}

public class DistrictPerformanceReportService : IDistrictPerformanceReportService
{
    public const string EmailType = "District Performance";

    private readonly string _conn;
    private readonly IEmailService _email;
    private readonly IGoalSettingService _goals;
    private readonly IYearTableResolver _yearTables;
    private readonly ICurrencyRateService _fx;
    private readonly ILogger<DistrictPerformanceReportService> _logger;
    private readonly bool _suppressLocalDev;
    private readonly string _parentDomain;   // bare club-website subdomains live under this (PleskSettings:ParentDomain)

    private readonly bool _enabled;
    private readonly string _mode;
    private readonly int _hour;
    private readonly string[] _testDistricts;
    private readonly string[] _testRecipients;
    private readonly string[] _liveCc;
    private readonly int[] _liveDays;

    // 5656 test district, 1280 = COG, IFRM India, 999 test; TEST-* districts are excluded in the query too.
    // ROW (as the NestJS edition): zones and exempt districts from Brand:Scope (empty zones = all zones,
    // empty exempt list = none). The original platform hard-coded its own zones and its own test / COG / partner districts.
    private static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;
    private static string[] ScopeZones => RotaryApi.Services.Brand.Zones.Length > 0 ? RotaryApi.Services.Brand.Zones : new[] { "" };
    private static int AllZones => RotaryApi.Services.Brand.Zones.Length == 0 ? 1 : 0;
    // Both reports cover the portal's own zones only — Zone 0 and "Other Zones" are out (user 2026-09-18).

    // Clubs never counted in either report, whatever district they sit in: the COG past-DG roster club and
    // every IFRM club (alias c = club_master). Rotaract clubs are never counted either (user 2026-10-08).
    // ROW: COG from Brand:Scope:CogClubId, name patterns from DistrictPerformanceReport:ExcludedClubNames
    // (the original platform: its partner programme's "IFRM" clubs). Patterns are plain text, matched with LIKE '%…%'.
    private static string ExcludedClubsSql =>
        $"c.pk_club_id <> {CogDesignationHelper.CogClubId}" + string.Concat(RotaryApi.Services.Brand.ExcludedClubNamePatterns
            .Select(n => $" AND c.ClubName NOT LIKE '%{n.Replace("'", "''").Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%'"))
        + $" AND {ClubScopeSql.NotRotaract("c")}";
    // ROW: numbers in the brand's number locale (the original platform: en-IN lakh / crore grouping).
    private static CultureInfo InCulture
    {
        get
        {
            try { return CultureInfo.GetCultureInfo(Brand.NumberLocale); }
            catch (CultureNotFoundException) { return CultureInfo.InvariantCulture; }
        }
    }

    // Service avenues counted as PROJECTS (Club Service = meetings, reported separately).
    private static readonly (string Key, string Label)[] ProjectAvenues =
    {
        ("community_service",       "Community Service"),
        ("vocational_service",      "Vocational Service"),
        ("international_service",   "International Service"),
        ("new_generation_service",  "New Generation Service"),
        ("public_image_initiative", "Public Image Initiative"),
    };
    private const string ClubServiceKey = "club_service";
    // Goal categories shown in the email body / screen / Summary (the full set is in the Excel sheet).
    private static readonly HashSet<string> HeadlineGoalCategories = new(StringComparer.OrdinalIgnoreCase) { "Membership", "Foundation" };
    // Goal table % column — shown as a red / amber / green coloured figure (no bar, user 2026-09-18).
    public const string PctHeader = "Percentage Achieved";
    private const string OtherAvenue = "Other";

    // RAG "Healthy Clubs" bands — the Goal Setting rule (LiveDistrictRagCountsAsync): a club's active
    // members, honorary not counted. RED 10–25, AMBER 26–40, GREEN 41+; under 10 falls in no band.
    private const string RagRed = "RED", RagAmber = "AMBER", RagGreen = "GREEN", RagBelow = "Below 10 members";
    private static string MembershipBand(long members) =>
        members >= 41 ? RagGreen : members >= 26 ? RagAmber : members >= 10 ? RagRed : RagBelow;

    // Rotary-year month order.
    private static readonly int[] RotaryMonths = { 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 };

    // Age 18–40 from date of birth (BirthDate year 1900 = day/month-only placeholder → unknown).
    private const string YouthExpr =
        "(m.BirthDate IS NOT NULL AND YEAR(m.BirthDate) > 1900 AND TIMESTAMPDIFF(YEAR, m.BirthDate, CURDATE()) BETWEEN 18 AND 40)";

    public DistrictPerformanceReportService(IConfiguration config, IEmailService email, IGoalSettingService goals,
        IYearTableResolver yearTables, ICurrencyRateService fx, ILogger<DistrictPerformanceReportService> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _goals = goals;
        _yearTables = yearTables;
        _fx = fx;
        _logger = logger;
        _suppressLocalDev = IsRemoteDb(_conn);
        _parentDomain = (config.GetSection("PleskSettings")["ParentDomain"] ?? RotaryApi.Services.Brand.ClubSiteParentDomain).Trim().Trim('.').ToLowerInvariant();

        // HARD-CODED (user 2026-09-17: no config, hard-code both email ids).
        // LIVE since 2026-09-29 - the user verified the report and asked for it to go to every
        // District Governor. On the 1st and 16th at the send hour (brand time zone): each district's report
        // to its own DG (CC LiveCc; a district with no DG email is skipped and LiveCc is told).
        _enabled = ScheduleOn;
        _mode = ScheduleMode;
        _hour = SendHour;
        _testDistricts = TestDistrictNumbers;
        _testRecipients = TestRecipientEmails;
        _liveCc = LiveCcEmails;
        _liveDays = LiveDayNumbers;
    }

    public static readonly bool ScheduleOn = true;
    public const string ScheduleMode = "Live";          // "Test" | "Live"
    public static int SendHour => Brand.DistrictReportSendHour;
    // The sample districts the rehearsal run mails (see PreviewDate). 3141 is the one the user has
    // been checking against, 3142 is the original test district.
    private static readonly string[] TestDistrictNumbers = { "3141", "3142" };
    // The SuperAdmin screen's "Send test email" goes ONLY here - never to a DG,
    // so the reports can be checked by hand at any time (user 2026-09-29).
    private static readonly string[] TestRecipientEmails = RotaryApi.Services.Brand.ReportRecipients;
    // Live CC on every DG mail: Naren only (user 2026-09-29 - "don't keep me").
    private static readonly string[] LiveCcEmails = RotaryApi.Services.Brand.InternalCc.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    private static readonly int[] LiveDayNumbers = { 1, 16 };

    // ── One-off rehearsal (user 2026-10-01) ─────────────────────────────────────────────────────
    // A dry run BEFORE the 16th so any problem can be fixed in time: on this exact date the morning
    // job sends the sample district report to the configured
    // addresses ONLY. No District Governor is mailed, nothing is marked as a live
    // run, and the real 16 Oct send is untouched. It is a DATE, not a day number, so it happens once
    // and never repeats; clear it (null) once it has served its purpose.
    private static readonly DateTime? PreviewDate = new DateTime(2026, 10, 6);

    // Club Goal Setting is parked behind a "Coming soon" placeholder on every screen
    // (user 2026-10-01, rotary-frontend/src/lib/clubGoalSetting.ts). The report follows: the
    // "Goals - Clubs" sheets carry the same notice instead of club figures. Set false to bring
    // them back - nothing else changes, the data is still collected.
    private const bool ClubGoalsComingSoon = true;

    public int Hour => _hour;
    public bool ScheduleEnabled => _enabled;

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Screen helpers
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    public async Task<List<PerformanceReportDistrictOption>> GetDistrictsAsync()
    {
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();
        return await LoadReportDistrictsAsync(conn);
    }

    private static async Task<List<PerformanceReportDistrictOption>> LoadReportDistrictsAsync(MySqlConnection conn)
        => (await conn.QueryAsync<PerformanceReportDistrictOption>(@"
            SELECT d.pk_district_id AS DistrictId, d.DistrictNumber AS DistrictNumber, z.ZoneName AS ZoneName
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND d.IsActive = 1
              AND d.DistrictNumber NOT IN @Exempt
              AND d.DistrictNumber NOT LIKE 'TEST%'
              AND (@AllZones = 1 OR z.ZoneName IN @Zones)
            ORDER BY COALESCE(z.sort_order, 999), z.ZoneName,
                     CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { Exempt = ExemptDistrictNumbers, Zones = ScopeZones, AllZones })).ToList();

    public async Task<PerformanceReportSettingsDto> GetSettingsAsync()
    {
        var dto = new PerformanceReportSettingsDto
        {
            ScheduleEnabled = _enabled,
            Mode = _mode,
            Hour = _hour,
            TestDistricts = _testDistricts.ToList(),
            TestRecipients = _testRecipients.ToList(),
            LiveCc = _liveCc.ToList(),
            LiveDays = _liveDays.ToList(),
        };
        try
        {
            await using var conn = new MySqlConnection(_conn);
            await conn.OpenAsync();
            dto.RecentRuns = (await conn.QueryAsync<PerformanceReportLogRow>(@"
                SELECT l.pk_id AS Id, d.DistrictNumber AS DistrictNumber, l.RunType AS RunType, l.ToEmail AS ToEmail,
                       l.CcEmails AS CcEmails, l.Status AS Status, l.Message AS Message, l.created_date AS CreatedDate
                FROM district_performance_report_log l
                LEFT JOIN district_master d ON d.pk_district_id = l.fk_district_id
                ORDER BY l.pk_id DESC LIMIT 500")).ToList();   // one live run alone is ~48 rows
                                                                  // (a mail per district)
        }
        catch (Exception ex)
        {
            // Table not created yet (run SQL/district_performance_report_log.sql) — the screen still works.
            _logger.LogWarning(ex, "District performance report: could not read the run log.");
        }
        return dto;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Build
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    private sealed class DistrictRow
    {
        public int Id { get; set; }
        public string DistrictNumber { get; set; } = "";
        public string? ZoneName { get; set; }
        public string? DefaultCurrency { get; set; }
    }
    private sealed class ClubRow
    {
        public int Id { get; set; }
        public string ClubName { get; set; } = "";
        public string? ClubRotaryId { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public DateTime? ClubCharterDate { get; set; }
        public long MemberCount { get; set; }   // Non-Synced Clubs sheet only
    }
    private sealed class MemberAgg
    {
        public int ClubId { get; set; }
        public long Members { get; set; }
        public long MembersJul1 { get; set; }
        public long Women { get; set; }
        public long WomenJul1 { get; set; }
        public long Youth { get; set; }
        public long Added { get; set; }
        public long LeftCount { get; set; }
        public long DeletedAllTime { get; set; }   // removed with a reason, any year (till date)
        public long YouthJul1 { get; set; }
        public long YouthAdded { get; set; }       // youth (18–40) who joined 1 Jul → today
        public long YouthLeft { get; set; }
        public long WomenAdded { get; set; }
        public long WomenLeft { get; set; }
        // Leavers who were already members on 1 July — they belong back in the 1 July column.
        public long LeftJul1 { get; set; }
        public long WomenLeftJul1 { get; set; }
        public long YouthLeftJul1 { get; set; }
    }
    // District Dues sheet: one row per dues purpose per club.
    private sealed class DuesPaymentRow
    {
        public int DuesId { get; set; }
        public int ClubId { get; set; }
        public decimal? Amount { get; set; }
        public long MembersCovered { get; set; }
        public long IsPaid { get; set; }
        public long IsOnline { get; set; }
        public string? PaymentStatus { get; set; }
        public string? TransactionType { get; set; }
        public string? TransactionId { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? PaidBy { get; set; }
    }
    private sealed class DuesSheetRow
    {
        public ClubRow Club = null!;
        public string Purpose = "";
        public string Status = "";        // Paid | Pending approval | Not paid
        public decimal Amount;
        public long MembersCovered;
        public string Mode = "";
        public string TransactionIds = "";
        public DateTime? LastPaymentDate;
        public string PaidBy = "";
    }
    private sealed class MemberListRow
    {
        public string? MemberName { get; set; }
        public string? ClubName { get; set; }
        public string? RotaryId { get; set; }
        public string? Gender { get; set; }
        public DateTime? Dt { get; set; }
        public string? Reason { get; set; }
    }
    private sealed class ProjectRow
    {
        public int? ClubId { get; set; }
        public string? ModuleKey { get; set; }
        public decimal? Cost { get; set; }
        public string? Currency { get; set; }
        public long? Beneficiaries { get; set; }
        public long? ManHours { get; set; }
        public string? DistrictProjectType { get; set; }   // "Project" | "Event" on district-level rows
    }
    // One club's Club Monthly Report line — month → "Submitted" / "Not submitted" / "" — synced or not.
    private sealed record CmrGridRow(ClubRow Club, Dictionary<int, string> ByMonth, long Submitted);

    private sealed class CmrRow
    {
        public int ClubId { get; set; }
        public long ReportMonth { get; set; }
        public long Uploaded { get; set; }
    }
    private sealed class CountByClub
    {
        public int? ClubId { get; set; }
        public long N { get; set; }
    }
    private sealed class WebsiteRow
    {
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public string? Subdomain { get; set; }
        public string? ClientDomain { get; set; }
        public string? Status { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public decimal? AmountPaid { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? Host { get; set; }   // e.g. club.example.org
        public string? Url { get; set; }    // https://… (clickable)
    }
    private sealed class LeaderRow
    {
        public int ClubId { get; set; }
        public string? Designation { get; set; }
        public string? Name { get; set; }
        public string? Mobile { get; set; }
        public string? Email { get; set; }
    }
    private sealed class PointsRow
    {
        public int ClubId { get; set; }
        public decimal Points { get; set; }
        public decimal AutoPoints { get; set; }
        public decimal ManualPoints { get; set; }
    }

    // Per-club figures for the "All Clubs" / ranking sheets.
    private sealed class ClubStats
    {
        public ClubRow Club = null!;
        public MemberAgg M = new();
        public Dictionary<string, long> Projects = new(StringComparer.Ordinal);
        public long TotalProjects;
        public long ClubService;
        public long Beneficiaries;
        public long ManHours;
        public decimal Cost;
        public long CmrSubmitted;
        public WebsiteRow? Website;       // ACTIVE club website only
        public bool DistrictDuesPaid;
        public HashSet<int> GoalCategoriesSet = new();
        public decimal AwardPoints;
        public LeaderRow? President;
        public LeaderRow? Secretary;
        public Dictionary<int, string> CmrByMonth = new();
        public long CmrPending;
        public long CmrNotStarted;
        public decimal TrfUsd;
        // Every other module count for the All Clubs sheet, keyed by column header (see ClubModuleColumns).
        public Dictionary<string, long> Mod = new(StringComparer.Ordinal);
    }

    public async Task<DistrictPerformanceReportResult> BuildReportAsync(int districtId, bool includeAttachment, CancellationToken ct = default)
    {
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync(ct);

        var district = await conn.QueryFirstOrDefaultAsync<DistrictRow>(@"
            SELECT d.pk_district_id AS Id, d.DistrictNumber AS DistrictNumber, z.ZoneName AS ZoneName, d.DefaultCurrency AS DefaultCurrency
            FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.pk_district_id = @D AND d.isdeleted = 0", new { D = districtId })
            ?? throw new KeyNotFoundException("District not found.");

        var year = await conn.QueryFirstOrDefaultAsync<(int Id, string Label, DateTime StartDate, DateTime EndDate)>(
            "SELECT pk_year_id AS Id, YearLabel AS Label, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        if (year.Id == 0) throw new InvalidOperationException("No current Rotary year is set.");

        DateTime start = year.StartDate.Date;
        DateTime today = DateTime.Today;
        DateTime end = today < year.EndDate.Date ? today : year.EndDate.Date;   // "till date"
        DateTime endExclusive = end.AddDays(1);
        string currency = CurrencyHelper.Normalize(string.IsNullOrWhiteSpace(district.DefaultCurrency) ? RotaryApi.Services.Brand.DefaultCurrency : district.DefaultCurrency);

        var p = new { D = districtId, Y = year.Id, YL = year.Label, S = start, E = end, E1 = endExclusive };
        // Club scope: the district's ACTIVE clubs — active AND synced with Rotary.org (a club that is not synced
        // is not active, user 2026-09-18: it drops out of every count and is listed only in the "Non-Synced
        // Clubs" sheet) — EXCLUDING the COG roster club and IFRM clubs wherever they sit (user 2026-09-17 —
        // e.g. "IFRM 2982 RAAGAM" lives inside real district 2982).
        string activeClub = $"c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND c.IsSyncedFromRotaryOrg = 1 AND {ExcludedClubsSql}";
        // Synced AND non-synced — used only where a figure must cover every club (Club Monthly Report, user 2026-09-28).
        string anyActiveClub = $"c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND {ExcludedClubsSql}";

        // ── District Governor (current year) ──────────────────────────────────────────────────────
        // LEFT JOIN: a DG who is not a member of any club has no profile, and an INNER JOIN would
        // leave the whole governor block empty for that district.
        var dg = await conn.QueryFirstOrDefaultAsync<(string? Name, string? Email, string? Mobile)>($@"
            SELECT {DistrictGovernorSql.Name} AS Name, {DistrictGovernorSql.Email} AS Email,
                   {DistrictGovernorSql.Mobile} AS Mobile
            FROM district_governors g
            {DistrictGovernorSql.JoinMember}
            WHERE g.fk_district_id = @D AND g.fk_year_id = @Y AND COALESCE(g.isdeleted, 0) = 0
            LIMIT 1", p);

        // ── Clubs ────────────────────────────────────────────────────────────────────────────────
        var clubs = (await conn.QueryAsync<ClubRow>($@"
            SELECT c.pk_club_id AS Id, c.ClubName AS ClubName, c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State,
                   c.ClubCharterDate AS ClubCharterDate
            FROM club_master c WHERE {activeClub} ORDER BY c.ClubName", p)).ToList();
        var stats = clubs.ToDictionary(c => c.Id, c => new ClubStats { Club = c });

        // Clubs NOT synced with Rotary.org — kept out of every member / per-club figure and listed in the
        // Excel, but COUNTED in the club counts (user 2026-09-28: club counts must match Rotary.org).
        var nonSynced = (await conn.QueryAsync<ClubRow>($@"
            SELECT c.pk_club_id AS Id, c.ClubName AS ClubName, c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State,
                   c.ClubCharterDate AS ClubCharterDate,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                     WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                       AND cm.IsHonoraryMember = 0 AND m.isdeleted = 0) AS MemberCount
            FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0
              AND {ExcludedClubsSql}
            ORDER BY c.ClubName", p)).ToList();
        long clubsToday = clubs.Count + nonSynced.Count;

        // "As on 1 July" = the Goal Setting rule: chartered before 1 July (no charter date = existing).
        long clubsJul1 = clubs.Concat(nonSynced).Count(c => !c.ClubCharterDate.HasValue || c.ClubCharterDate.Value.Date < start);
        var removed = await conn.QueryFirstOrDefaultAsync<(long Total, long BeforeJul1)>(@"
            SELECT COUNT(*) AS Total,
                   COALESCE(SUM(CASE WHEN ClubCharterDate IS NULL OR ClubCharterDate < @S THEN 1 ELSE 0 END), 0) AS BeforeJul1
            FROM club_master
            WHERE fk_district_id = @D AND isdeleted = 1 AND pk_club_id <> " + CogDesignationHelper.CogClubId + @" AND ClubName NOT LIKE '%IFRM%'
              AND " + ClubScopeSql.NotRotaract("") + @"
              AND IsSyncedFromRotaryOrg = 1
              AND COALESCE(deleted_date, modified_date) >= @S AND COALESCE(deleted_date, modified_date) < @E1", p);
        // Only clubs that WERE counted can be reported as deleted: a club that was never synced with
        // Rotary.org is outside every figure in this report, so closing it changes nothing here
        // (3142's 13 "deleted" clubs were all non-synced rows removed in one cleanup, user 2026-09-18).
        // Note: deleted_date is often empty, so the date falls back to the row's last modified date.
        long clubsRemoved = removed.Total;
        // The line has to read left to right: 1 July + added - deleted = today (user 2026-09-18). So the
        // 1 July column counts what was actually there that morning (including clubs closed since), and
        // "added" counts everything chartered since 1 July, closed again or not.
        clubsJul1 += removed.BeforeJul1;
        long clubsAdded = (clubsToday - (clubsJul1 - removed.BeforeJul1)) + (removed.Total - removed.BeforeJul1);

        // ── Members: per club + district total (each person once); honorary members are excluded ──
        const string act = "cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
        const string beforeJul1 = "(cm.JoinedDate IS NULL OR cm.JoinedDate < @S)";   // Goal Setting "as on July 1st" rule
        string memberAggSelect = $@"
              COUNT(DISTINCT CASE WHEN {act} THEN m.pk_member_master_profile_id END) AS Members,
              COUNT(DISTINCT CASE WHEN {act} AND {beforeJul1} THEN m.pk_member_master_profile_id END) AS MembersJul1,
              COUNT(DISTINCT CASE WHEN {act} AND m.Gender = 'Female' THEN m.pk_member_master_profile_id END) AS Women,
              COUNT(DISTINCT CASE WHEN {act} AND m.Gender = 'Female' AND {beforeJul1} THEN m.pk_member_master_profile_id END) AS WomenJul1,
              COUNT(DISTINCT CASE WHEN {act} AND {YouthExpr} THEN m.pk_member_master_profile_id END) AS Youth,
              COUNT(DISTINCT CASE WHEN {act} AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E THEN m.pk_member_master_profile_id END) AS Added,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' THEN m.pk_member_master_profile_id END) AS LeftCount,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND COALESCE(cm.TerminationReason, '') <> '' THEN m.pk_member_master_profile_id END) AS DeletedAllTime,
              COUNT(DISTINCT CASE WHEN {act} AND {beforeJul1} AND {YouthExpr} THEN m.pk_member_master_profile_id END) AS YouthJul1,
              COUNT(DISTINCT CASE WHEN {act} AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E AND {YouthExpr} THEN m.pk_member_master_profile_id END) AS YouthAdded,
              COUNT(DISTINCT CASE WHEN {act} AND m.Gender = 'Female' AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E THEN m.pk_member_master_profile_id END) AS WomenAdded,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' AND m.Gender = 'Female' THEN m.pk_member_master_profile_id END) AS WomenLeft,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' AND {YouthExpr} THEN m.pk_member_master_profile_id END) AS YouthLeft,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' AND {beforeJul1} THEN m.pk_member_master_profile_id END) AS LeftJul1,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' AND m.Gender = 'Female' AND {beforeJul1} THEN m.pk_member_master_profile_id END) AS WomenLeftJul1,
              COUNT(DISTINCT CASE WHEN cm.isdeleted = 1 AND cm.TerminationDate >= @S AND cm.TerminationDate <= @E AND COALESCE(cm.TerminationReason, '') <> '' AND {YouthExpr} AND {beforeJul1} THEN m.pk_member_master_profile_id END) AS YouthLeftJul1";
        string memberFrom = $@"
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE {activeClub}";
        foreach (var a in await conn.QueryAsync<MemberAgg>($@"
            SELECT cm.fk_club_id AS ClubId, {memberAggSelect} {memberFrom} AND cm.IsHonoraryMember = 0
            GROUP BY cm.fk_club_id", p))
            if (stats.TryGetValue(a.ClubId, out var st)) st.M = a;
        var dm = await conn.QueryFirstOrDefaultAsync<MemberAgg>($@"
            SELECT {memberAggSelect} {memberFrom} AND cm.IsHonoraryMember = 0", p) ?? new MemberAgg();

        // ── Projects (current year table) ────────────────────────────────────────────────────────
        var projects = new List<ProjectRow>();
        string projTable = _yearTables.GetProjectsTableName(year.Label);
        try
        {
            projects = (await conn.QueryAsync<ProjectRow>($@"
                SELECT CASE WHEN COALESCE(pr.fk_club_id, 0) > 0 THEN pr.fk_club_id END AS ClubId,
                       mm.ModuleKey AS ModuleKey, pr.project_cost AS Cost, pr.Currency AS Currency,
                       CAST(pr.direct_beneficiaries AS SIGNED) AS Beneficiaries, CAST(pr.man_hours AS SIGNED) AS ManHours,
                       pr.DistrictProjectType AS DistrictProjectType
                FROM `{projTable}` pr
                JOIN module_master mm ON mm.pk_module_id = pr.fk_module_id
                LEFT JOIN club_master c ON c.pk_club_id = pr.fk_club_id
                WHERE COALESCE(pr.isdeleted, 0) = 0
                  AND (pr.project_date IS NULL OR pr.project_date < @E1)
                  AND ( (COALESCE(pr.fk_club_id, 0) > 0 AND {activeClub})
                     OR (COALESCE(pr.fk_club_id, 0) = 0 AND pr.fk_district_id = @D) )", p)).ToList();
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Performance report: project query failed for {Table}", projTable); }

        var rates = await _fx.GetInrRatesAsync();
        // avenueTotals / totalBeneficiaries / totalHours / totalCost = CLUB projects only; the district's own
        // projects and events (no club, DistrictProjectType set) only feed the At a glance totals.
        var avenueTotals = new Dictionary<string, long>(StringComparer.Ordinal);
        long clubServiceEntries = 0, totalBeneficiaries = 0, totalHours = 0;
        long districtProjects = 0, districtEvents = 0, districtBeneficiaries = 0, districtHours = 0;
        decimal totalCost = 0m, districtCost = 0m;
        foreach (var pr in projects)
        {
            decimal cost = CurrencyHelper.Convert(pr.Cost ?? 0m, pr.Currency, currency, rates);
            if (pr.ClubId == null)
            {
                if (string.Equals(pr.DistrictProjectType, "Event", StringComparison.OrdinalIgnoreCase)) districtEvents++;
                else districtProjects++;
                districtBeneficiaries += pr.Beneficiaries ?? 0;
                districtHours += pr.ManHours ?? 0;
                districtCost += cost;
                continue;
            }
            stats.TryGetValue(pr.ClubId.Value, out var st);
            if (string.Equals(pr.ModuleKey, ClubServiceKey, StringComparison.OrdinalIgnoreCase))
            {
                clubServiceEntries++;
                if (st != null) st.ClubService++;
                continue;
            }
            string label = ProjectAvenues.FirstOrDefault(a => string.Equals(a.Key, pr.ModuleKey, StringComparison.OrdinalIgnoreCase)).Label ?? OtherAvenue;
            avenueTotals[label] = avenueTotals.GetValueOrDefault(label) + 1;
            totalBeneficiaries += pr.Beneficiaries ?? 0;
            totalHours += pr.ManHours ?? 0;
            totalCost += cost;
            if (st == null) continue;
            st.Projects[label] = st.Projects.GetValueOrDefault(label) + 1;
            st.TotalProjects++;
            st.Beneficiaries += pr.Beneficiaries ?? 0;
            st.ManHours += pr.ManHours ?? 0;
            st.Cost += cost;
        }
        bool hasOtherAvenue = avenueTotals.ContainsKey(OtherAvenue);

        // ── CMR ──────────────────────────────────────────────────────────────────────────────────
        var cmr = (await conn.QueryAsync<CmrRow>($@"
            SELECT r.fk_club_id AS ClubId, CAST(r.ReportMonth AS SIGNED) AS ReportMonth, CAST(COALESCE(r.IsUploadedToDistrict, 0) AS SIGNED) AS Uploaded
            FROM club_monthly_reports r JOIN club_master c ON c.pk_club_id = r.fk_club_id
            WHERE {anyActiveClub} AND r.fk_year_id = @Y AND COALESCE(r.isdeleted, 0) = 0", p)).ToList();
        var firstOfThisMonth = new DateTime(today.Year, today.Month, 1);
        var monthStates = RotaryMonths.Select((mo, i) =>
        {
            var first = new DateTime(start.Year, 7, 1).AddMonths(i);
            return (Month: mo, First: first, Due: first < firstOfThisMonth, Future: first > firstOfThisMonth);
        }).ToList();
        var dueMonths = monthStates.Where(x => x.Due).Select(x => x.Month).ToHashSet();
        long cmrSubmitted = 0, cmrPending = 0, cmrNotStarted = 0, clubsUpToDate = 0;
        var cmrLookup = cmr.GroupBy(x => x.ClubId).ToDictionary(g => g.Key, g => g.GroupBy(x => (int)x.ReportMonth).ToDictionary(x => x.Key, x => x.Any(r => r.Uploaded == 1)));
        foreach (var st in stats.Values)
        {
            cmrLookup.TryGetValue(st.Club.Id, out var byMonth);
            byMonth ??= new Dictionary<int, bool>();
            bool upToDate = dueMonths.Count > 0;
            foreach (var ms in monthStates)
            {
                bool has = byMonth.TryGetValue(ms.Month, out var uploaded);
                if (has && uploaded) st.CmrSubmitted++;
                string cell = ms.Future ? "" : has ? (uploaded ? "Submitted" : "Pending") : (ms.Due ? "Not started" : "");
                st.CmrByMonth[ms.Month] = cell;
                if (!ms.Due) continue;
                if (has && uploaded) cmrSubmitted++;
                else if (has) { cmrPending++; st.CmrPending++; upToDate = false; }
                else { cmrNotStarted++; st.CmrNotStarted++; upToDate = false; }
            }
            if (upToDate) clubsUpToDate++;
        }

        // Club Monthly Report for EVERY active club, synced or not (user 2026-09-28) — drives the Month wise
        // table and the Club Monthly Report Grid sheet. Same Submitted / Not submitted rule as above.
        var cmrAllClubs = clubs.Concat(nonSynced).OrderBy(c => c.ClubName).Select(c =>
        {
            cmrLookup.TryGetValue(c.Id, out var byMonth);
            byMonth ??= new Dictionary<int, bool>();
            var cells = new Dictionary<int, string>();
            long submitted = 0;
            foreach (var ms in monthStates)
            {
                bool has = byMonth.TryGetValue(ms.Month, out var uploaded);
                if (has && uploaded) submitted++;
                cells[ms.Month] = ms.Future ? "" : has && uploaded ? "Submitted" : ms.Due || has ? "Not submitted" : "";
            }
            return new CmrGridRow(c, cells, submitted);
        }).ToList();

        // ── Communication (the district's own, published in the period) ─────────────────
        async Task<(long Total, long District, Dictionary<int, long> ByClub)> CountCommsAsync(string table, string dateCol)
        {
            var rows = (await conn.QueryAsync<CountByClub>($@"
                SELECT CASE WHEN COALESCE(n.fk_club_id, 0) > 0 THEN n.fk_club_id END AS ClubId, COUNT(*) AS N
                FROM `{table}` n LEFT JOIN club_master c ON c.pk_club_id = n.fk_club_id
                WHERE COALESCE(n.isdeleted, 0) = 0
                  AND n.{dateCol} >= @S AND n.{dateCol} < @E1
                  AND ( (COALESCE(n.fk_club_id, 0) > 0 AND {activeClub})
                     OR (COALESCE(n.fk_club_id, 0) = 0 AND n.fk_district_id = @D) )
                GROUP BY CASE WHEN COALESCE(n.fk_club_id, 0) > 0 THEN n.fk_club_id END", p)).ToList();
            return (rows.Sum(r => r.N), rows.Where(r => !r.ClubId.HasValue).Sum(r => r.N),
                    rows.Where(r => r.ClubId.HasValue).ToDictionary(r => r.ClubId!.Value, r => r.N));
        }
        // newsletters with no club = the district's GML.
        var newsletters = await CountCommsAsync("newsletters", "PublishDateTime");
        var announcements = await CountCommsAsync("announcements", "PublishDateTime");
        var events = await CountCommsAsync("upcoming_events", "PublishDate");
        var documents = await CountCommsAsync("club_documents", "PublishDateTime");

        // ── Club websites — ACTIVE only (as on today) ───────────────────────────────────────────
        var activeSites = (await conn.QueryAsync<WebsiteRow>($@"
            SELECT w.fk_club_id AS ClubId, c.ClubName AS ClubName, w.Subdomain, w.ClientDomain, w.Status, w.EndDate
            FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
            WHERE {activeClub} AND COALESCE(w.isdeleted, 0) = 0
              AND (w.IsPurchased = 1 OR COALESCE(w.AmountPaid, 0) > 0 OR COALESCE(w.TransactionId, '') <> '')
            ORDER BY c.ClubName, w.pk_id DESC", p))
            .GroupBy(w => w.ClubId).Select(g => g.First())
            .Where(w => !(w.EndDate.HasValue && w.EndDate.Value.Date < today)
                        && (string.IsNullOrWhiteSpace(w.Status) || string.Equals(w.Status, "Active", StringComparison.OrdinalIgnoreCase)))
            .ToList();
        foreach (var w in activeSites)
        {
            w.Host = SiteHost(w.ClientDomain, w.Subdomain, _parentDomain);
            w.Url = w.Host == null ? null : "https://" + w.Host;
            if (stats.TryGetValue(w.ClubId, out var st)) st.Website = w;
        }

        // ── District Dues (shown only when the district has set it up this year) ───────────────────
        long districtDuesSetUp = await conn.ExecuteScalarAsync<long>(@"
            SELECT COUNT(*) FROM club_dues WHERE fk_district_id = @D AND RotaryYear = @YL AND COALESCE(isdeleted, 0) = 0", p);
        var duesPaidClubs = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT dp.fk_club_id FROM club_dues_payments dp
            JOIN club_dues d ON d.pk_club_dues_id = dp.fk_club_dues_id
            WHERE d.fk_district_id = @D AND d.RotaryYear = @YL AND COALESCE(d.isdeleted, 0) = 0
              AND COALESCE(dp.isdeleted, 0) = 0 AND dp.IsPaid = 1", p)).ToHashSet();
        decimal districtDuesCollected = await conn.ExecuteScalarAsync<decimal?>($@"
            SELECT SUM(dp.Amount) FROM club_dues_payments dp
            JOIN club_dues d ON d.pk_club_dues_id = dp.fk_club_dues_id
            JOIN club_master c ON c.pk_club_id = dp.fk_club_id
            WHERE d.fk_district_id = @D AND d.RotaryYear = @YL AND COALESCE(d.isdeleted, 0) = 0
              AND COALESCE(dp.isdeleted, 0) = 0 AND dp.IsPaid = 1 AND {activeClub}", p) ?? 0m;
        foreach (var st in stats.Values) st.DistrictDuesPaid = duesPaidClubs.Contains(st.Club.Id);
        long duesPaidCount = stats.Values.Count(s => s.DistrictDuesPaid);
        // What the campaign should raise, and what is still open: per club, members on the dues roster
        // x that club's effective OFFLINE per-member rate (the online rate only adds the surcharge).
        decimal duesExpected = 0m, duesPending = 0m;
        try
        {
            var due = await conn.QueryFirstOrDefaultAsync<(decimal Expected, decimal Pending)>($@"
                SELECT COALESCE(SUM(t.members * t.rate), 0) AS Expected, COALESCE(SUM(t.unpaid * t.rate), 0) AS Pending
                FROM (
                    SELECT CASE WHEN cd.RateModel = 1 THEN cc.OfflinePerMemberRate ELSE cc.PerMemberRate END AS rate,
                           (SELECT COUNT(*) FROM club_dues_members m
                             WHERE m.fk_club_dues_id = cc.fk_club_dues_id AND m.fk_club_id = cc.fk_club_id
                               AND m.isdeleted = 0 AND m.IsHonorary = 0) AS members,
                           (SELECT COUNT(*) FROM club_dues_members m
                             WHERE m.fk_club_dues_id = cc.fk_club_dues_id AND m.fk_club_id = cc.fk_club_id
                               AND m.isdeleted = 0 AND m.IsHonorary = 0 AND m.IsPaid = 0) AS unpaid
                    FROM club_dues_clubs cc
                    JOIN club_dues cd ON cd.pk_club_dues_id = cc.fk_club_dues_id
                    JOIN club_master c ON c.pk_club_id = cc.fk_club_id
                    WHERE cd.fk_district_id = @D AND cd.RotaryYear = @YL AND COALESCE(cd.isdeleted, 0) = 0
                      AND COALESCE(cc.isdeleted, 0) = 0 AND {activeClub}
                ) t", p);
            duesExpected = due.Expected;
            duesPending = due.Pending;
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Performance report: District Dues expected / pending failed"); }

        // ── District Awards (shown only when enabled for the year) ──────────────────────────────
        long dAwardsEnabled = 0;
        try
        {
            dAwardsEnabled = await conn.ExecuteScalarAsync<long>(@"
                SELECT COUNT(*) FROM district_awards_config WHERE fk_district_id = @D AND fk_year_id = @Y AND is_enabled = 1", p);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Performance report: District Awards config read failed"); }
        // Enabled is not enough: a district that has not added a single question (auto or manual) for the
        // year has no awards to report — hide the section (user 2026-09-18). Old club entries can survive a
        // questionnaire that was removed, and they would otherwise show points nobody can explain.
        long dAwardQuestions = 0;
        try
        {
            dAwardQuestions = await conn.ExecuteScalarAsync<long>(@"
                SELECT (SELECT COUNT(*) FROM district_citation_auto_question
                         WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0)
                     + (SELECT COUNT(*) FROM district_citation_manual_criteria
                         WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0)", p);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Performance report: District Awards question count failed"); }
        bool awardsEnabled = dAwardsEnabled > 0 && dAwardQuestions > 0;
        var points = (await conn.QueryAsync<PointsRow>(@"
            SELECT fk_club_id AS ClubId,
                   CAST(COALESCE(SUM(COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0)), 0) AS DECIMAL(14,2)) AS Points,
                   CAST(COALESCE(SUM(CASE WHEN entry_type = 'auto' THEN COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0) END), 0) AS DECIMAL(14,2)) AS AutoPoints,
                   CAST(COALESCE(SUM(CASE WHEN entry_type = 'manual' THEN COALESCE(points_earned, 0) + COALESCE(bonus_earned, 0) END), 0) AS DECIMAL(14,2)) AS ManualPoints
            FROM district_citation_club_entry
            WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0
            GROUP BY fk_club_id", p)).Where(x => stats.ContainsKey(x.ClubId)).ToList();
        foreach (var pt in points) stats[pt.ClubId].AwardPoints = pt.Points;
        decimal districtAwardPoints = points.Sum(x => x.Points);
        long awardClubs = points.Count(x => x.Points > 0);

        // ── President / Secretary (current year BOD) ─────────────────────────────────────────────
        foreach (var l in await conn.QueryAsync<LeaderRow>($@"
            SELECT b.fk_club_id AS ClubId, dm.designation_name AS Designation,
                   COALESCE(m.MemberName, b.non_member_name) AS Name,
                   COALESCE(m.PrimaryMobileNumber, b.non_member_mobile) AS Mobile,
                   COALESCE(m.EmailId, b.non_member_email) AS Email
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            WHERE {activeClub} AND b.fk_year_id = @Y AND COALESCE(b.isdeleted, 0) = 0
              AND dm.designation_name IN ('Club President', 'Club Secretary')
            ORDER BY b.sort_order, b.pk_board_director_id", p))
        {
            if (!stats.TryGetValue(l.ClubId, out var st)) continue;
            if (l.Designation == "Club President") st.President ??= l;
            else st.Secretary ??= l;
        }

        // ── Goal Setting ─────────────────────────────────────────────────────────────────────────
        var categories = (await conn.QueryAsync<(int Id, string Name)>(
            "SELECT pk_category_id AS Id, IF(Name = 'TRF', 'Foundation', Name) AS Name FROM goal_categories WHERE isdeleted = 0 ORDER BY SortOrder, pk_category_id")).ToList();
        foreach (var gs in await conn.QueryAsync<(int ClubId, int CatId)>($@"
            SELECT DISTINCT ge.fk_club_id AS ClubId, gf.fk_category_id AS CatId
            FROM goal_entries ge
            JOIN goal_fields gf ON gf.pk_field_id = ge.fk_field_id
            JOIN club_master c ON c.pk_club_id = ge.fk_club_id
            WHERE ge.EntityType = 'Club' AND ge.fk_year_id = @Y AND COALESCE(ge.isdeleted, 0) = 0
              AND gf.FieldRole = 'Target' AND {activeClub}
              AND (ge.NumericValue IS NOT NULL OR COALESCE(ge.TextValue, '') <> '' OR ge.BoolValue IS NOT NULL)", p))
            if (stats.TryGetValue(gs.ClubId, out var st)) st.GoalCategoriesSet.Add(gs.CatId);

        var goalData = await _goals.GetDistrictPerformanceGoalDataAsync(districtId, year.Id, includeAttachment);

        // ══════════════════════════════════════════════════════════════════════════════════════
        //  Other district / club module counts
        // ══════════════════════════════════════════════════════════════════════════════════════
        // Each query is isolated: a module whose table is missing or fails just reads 0 instead of
        // breaking the whole report.
        async Task<long> DistrictScalarAsync(string label, string sql)
        {
            try { return await conn.ExecuteScalarAsync<long?>(sql, p) ?? 0; }
            catch (Exception ex) { _logger.LogWarning(ex, "Performance report: {Module} count failed", label); return 0; }
        }
        async Task ClubCountAsync(string key, string sql)
        {
            try
            {
                var byClub = (await conn.QueryAsync<CountByClub>(sql, p)).Where(r => r.ClubId.HasValue)
                    .ToDictionary(r => r.ClubId!.Value, r => r.N);
                foreach (var st in stats.Values) st.Mod[key] = byClub.GetValueOrDefault(st.Club.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Performance report: {Module} per-club count failed", key);
                foreach (var st in stats.Values) st.Mod[key] = 0;
            }
        }
        // Shared filter for "rows of this district's active clubs" (alias x = the module table).
        string xClub = $"JOIN club_master c ON c.pk_club_id = x.fk_club_id WHERE {activeClub}";
        // Shared filter for "the district's OWN rows" (no club).
        const string xDistrict = "COALESCE(x.fk_club_id, 0) = 0 AND x.fk_district_id = @D";

        // ── District leadership & administration ──
        long dCommitteeMembers = await DistrictScalarAsync("District committee", @"
            SELECT COUNT(*) FROM district_committee_member WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0 AND COALESCE(is_active, 1) = 1");
        long dCommitteeGroups = await DistrictScalarAsync("District committee groups", @"
            SELECT COUNT(*) FROM district_committee_group WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0 AND COALESCE(is_active, 1) = 1");
        long dAgs = await DistrictScalarAsync("Assistant Governors", @"
            SELECT COUNT(DISTINCT fk_member_id) FROM district_ag WHERE fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted, 0) = 0 AND COALESCE(is_active, 1) = 1");
        long dAdmins = await DistrictScalarAsync("District admins", @"
            SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM member_roles
            WHERE fk_role_id = 2 AND fk_district_id = @D AND COALESCE(fk_club_id, 0) = 0 AND IsActive = 1 AND COALESCE(isdeleted, 0) = 0");

        // ── District communication ──
        long dMassEmails = await DistrictScalarAsync("District mass emails", $@"
            SELECT COUNT(*) FROM club_mass_emails x WHERE {xDistrict} AND COALESCE(x.isdeleted, 0) = 0 AND x.created_date >= @S AND x.created_date < @E1");
        long dSubGroups = await DistrictScalarAsync("District sub groups", $@"
            SELECT COUNT(*) FROM sub_groups x WHERE {xDistrict} AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0");
        long dWebLinks = await DistrictScalarAsync("District web links", $@"
            SELECT COUNT(*) FROM weblinks x WHERE {xDistrict} AND COALESCE(x.isdeleted, 0) = 0 AND COALESCE(x.IsActive, 1) = 1");
        long dPayLinks = await DistrictScalarAsync("District event payment links", @"
            SELECT COUNT(*) FROM event_payment_links WHERE fk_district_master_id = @D AND COALESCE(fk_club_id, 0) = 0
              AND COALESCE(isdeleted, 0) = 0 AND created_date >= @S AND created_date < @E1");

        // ── Per-club module counts (All Clubs sheet + the Clubs part totals) ──
        // Potential members = everything on record for the club (till date, user 2026-09-18).
        await ClubCountAsync("Potential Members", $@"
            SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM potential_members x {xClub}
              AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id");
        await ClubCountAsync("OCV/GOV Documents", $@"
            SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM ocv_documents x {xClub}
              AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id");
        await ClubCountAsync("TRF Contributions", $@"
            SELECT x.fk_club_id AS ClubId, COUNT(*) AS N FROM trf_contributions x {xClub}
              AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id");
        try
        {
            foreach (var t in await conn.QueryAsync<(int ClubId, decimal Usd)>($@"
                SELECT x.fk_club_id AS ClubId, COALESCE(SUM(x.AmountUSD), 0) AS Usd FROM trf_contributions x {xClub}
                  AND x.fk_year_id = @Y AND COALESCE(x.isdeleted, 0) = 0 GROUP BY x.fk_club_id", p))
                if (stats.TryGetValue(t.ClubId, out var st)) st.TrfUsd = t.Usd;
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Performance report: TRF amount failed"); }
        long ClubsTotal(string key) => stats.Values.Sum(s => s.Mod.GetValueOrDefault(key));
        long ClubsWith(string key) => stats.Values.Count(s => s.Mod.GetValueOrDefault(key) > 0);

        // ══════════════════════════════════════════════════════════════════════════════════════
        //  Sections (email body = screen = Summary sheet)
        // ══════════════════════════════════════════════════════════════════════════════════════
        var sections = new List<PerformanceReportSection>();
        var allStats = stats.Values.OrderBy(s => s.Club.ClubName).ToList();
        long net = dm.Added - dm.LeftCount;
        static string Signed(long v) => (v > 0 ? "+" : "") + N(v);

        // Email / screen / Summary show the two headline goal areas only — Membership and TRF (user
        // decision 2026-09-17). Youth Service and Public Image stay complete in the "Goals - District" sheet.
        var headlineGoals = goalData.DistrictMetrics
            .Where(g => !g.SingleValue && HeadlineGoalCategories.Contains(g.Category))
            .ToList();
        List<DistrictPerformanceGoalMetric> GoalRows(string category) =>
            headlineGoals.Where(g => g.Category.Equals(category, StringComparison.OrdinalIgnoreCase)).ToList();
        List<string> GoalRow(DistrictPerformanceGoalMetric g) => new() { g.Metric, Dec(g.Baseline), Dec(g.Target), Dec(g.Achieved), Pct(g.Pct) };
        // TRF: a fund with no (or zero) "Highest" shows a dash, not 0 (user 2026-09-28).
        List<string> TrfRow(DistrictPerformanceGoalMetric g) => new() { g.Metric, (g.Baseline ?? 0m) == 0m ? "—" : Dec(g.Baseline), Dec(g.Target), Dec(g.Achieved), Pct2(g.Pct) };

        // ── PART 1 — the district's own work ─────────────────────────────────────────────────────
        string districtPart = $"District {district.DistrictNumber}";
        const string districtPartSub = "The district's own work";
        void AddDistrict(PerformanceReportSection s) { s.Part = districtPart; s.PartSubtitle = districtPartSub; sections.Add(s); }

        // Goal Setting — District: the Membership goals are part of the Clubs & Members table (Part 2);
        // TRF stands on its own, with the remaining categories pointed at in the Excel.
        var trfGoals = GoalRows("Foundation");
        string trfAchievedHeader = goalData.AchievedAsOn.TryGetValue("Foundation", out var trfAsOn) ? $"Achieved (as on {trfAsOn})" : "Achieved";
        AddDistrict(new PerformanceReportSection
        {
            Title = "Goal Setting — District Foundation",
            // First column heading "Particulars" instead of "Metric" (user 2026-09-28).
            TableHeaders = new() { "Particulars", "Highest", "Target", trfAchievedHeader, PctHeader },
            Intro = "Targets for the year can be set and updated in the Goal Setting module on the ROW portal. "
                  + "Youth Service and Public Image goals are provided in the attached Excel (Goals - District sheet).",
            TableRows = trfGoals.Select(TrfRow).ToList(),
            Note = trfGoals.Count == 0 ? "The district has not entered Foundation goals yet." : null,
        });

        // RAG Analysis — the Goal Setting "Healthy Clubs" rule: clubs by active members (honorary not counted).
        AddDistrict(new PerformanceReportSection
        {
            Title = "RAG Analysis — Healthy Clubs",
            TableHeaders = new() { "Band (active members per club)", "Clubs" },
            TableRows = new()
            {
                new() { $"{RagRed} (10 – 25)", N(allStats.Count(s => MembershipBand(s.M.Members) == RagRed)) },
                new() { $"{RagAmber} (26 – 40)", N(allStats.Count(s => MembershipBand(s.M.Members) == RagAmber)) },
                new() { $"{RagGreen} (41 and above)", N(allStats.Count(s => MembershipBand(s.M.Members) == RagGreen)) },
                new() { RagBelow, N(allStats.Count(s => MembershipBand(s.M.Members) == RagBelow)) },
            },
            Note = "Bands are based on active members only. Honorary members are not counted.",
        });

        // District Dues is no longer part of this report — email or Excel (user 2026-09-28).

        if (awardsEnabled)
            AddDistrict(new PerformanceReportSection
            {
                Title = "District Awards",
                Items =
                {
                    // ("Enabled" is not printed — the section only exists when it is, user 2026-09-18.)
                    new("District Awards points (all clubs)", Dec(districtAwardPoints)),
                    new("Clubs involved", N(awardClubs)),
                    new("Clubs not involved", N(clubs.Count - awardClubs)),
                    new("Auto points total", Dec(points.Sum(x => x.AutoPoints))),
                    new("Manual points total", Dec(points.Sum(x => x.ManualPoints))),
                },
            });

        // ── PART 2 — the district's clubs ────────────────────────────────────────────────────────
        string clubsPart = $"Clubs of District {district.DistrictNumber}";
        string clubsPartSub = $"{N(clubs.Count + nonSynced.Count)} active clubs · {N(clubs.Count)} synced with Rotary.org · {N(nonSynced.Count)} not synced";
        void AddClubs(PerformanceReportSection s) { s.Part = clubsPart; s.PartSubtitle = clubsPartSub; sections.Add(s); }

        // Clubs & Members carries the Membership goals: where the district stood on 1 July, what it set as
        // its target, what came in and went out, where it stands today and how much of the target that is.
        var membershipGoals = GoalRows("Membership");
        DistrictPerformanceGoalMetric? Goal(string metric) => membershipGoals.FirstOrDefault(g =>
            g.Metric.Equals(metric, StringComparison.OrdinalIgnoreCase));
        // Every row balances: as on 1 July + added - deleted = as on today. The 1 July column is the real
        // position that morning (people / clubs that have gone since are counted back in), and "added"
        // counts everyone who joined in the year even if they have since left.
        List<string> CountRow(string label, long jul1, long added, long deleted, long today, DistrictPerformanceGoalMetric? goal) => new()
        {
            label, N(jul1), N(added), N(deleted), N(today),
            goal?.Target > 0 ? Dec(goal.Target) : "—",
            goal?.Target > 0 ? Pct(goal.Pct) : "—",
        };
        AddClubs(new PerformanceReportSection
        {
            Title = "Clubs & Members",
            Intro = "This data is fetched from synchronised clubs. The data may not be accurate if there are non-sync clubs in your district.",
            TableHeaders = new() { "Count", "As on 1 July", "Added", "Deleted", "As on today", "Target", "Achieved" },
            TableRows = new()
            {
                CountRow("Active clubs", clubsJul1, clubsAdded, clubsRemoved, clubsToday, Goal("New Clubs")),
                CountRow("Members", dm.MembersJul1 + dm.LeftJul1, dm.Added + (dm.LeftCount - dm.LeftJul1), dm.LeftCount, dm.Members, Goal("Total Members")),
                CountRow("Women members", dm.WomenJul1 + dm.WomenLeftJul1, dm.WomenAdded + (dm.WomenLeft - dm.WomenLeftJul1), dm.WomenLeft, dm.Women, Goal("Women Membership")),
                CountRow("Youth members (18–40)", dm.YouthJul1 + dm.YouthLeftJul1, dm.YouthAdded + (dm.YouthLeft - dm.YouthLeftJul1), dm.YouthLeft, dm.Youth, null),
            },
        });

        var projectItems = ProjectAvenues.Select(a => new PerformanceReportItem(a.Label, N(avenueTotals.GetValueOrDefault(a.Label)))).ToList();
        if (hasOtherAvenue) projectItems.Add(new(OtherAvenue, N(avenueTotals[OtherAvenue])));
        projectItems.Add(new("Total projects", N(avenueTotals.Values.Sum())));
        projectItems.Add(new("Club Service", N(clubServiceEntries)));
        projectItems.Add(new("Clubs with at least one project", N(allStats.Count(s => s.TotalProjects > 0))));
        projectItems.Add(new("Beneficiaries", N(totalBeneficiaries)));
        projectItems.Add(new("Volunteer hours", N(totalHours)));
        projectItems.Add(new("Project cost", Money(totalCost, currency)));
        AddClubs(new PerformanceReportSection
        {
            Title = "Service Projects & Club Service",
            Items = projectItems,
        });

        // Club Monthly Report month by month — one row per completed month (user 2026-09-18). Only two
        // columns (user 2026-09-28): Submitted, and Not submitted (saved-but-not-submitted + not started).
        var dueList = monthStates.Where(x => x.Due).ToList();
        var cmrRows = dueList.Select(ms => new List<string>
        {
            MonthName(ms.Month),
            // Every active club, synced or not (user 2026-09-28).
            N(cmrAllClubs.Count(x => x.ByMonth.GetValueOrDefault(ms.Month) == "Submitted")),
            N(cmrAllClubs.Count(x => x.ByMonth.GetValueOrDefault(ms.Month) == "Not submitted")),
        }).ToList();
        AddClubs(new PerformanceReportSection
        {
            Title = "Club Monthly Report - Month wise",
            TableHeaders = new() { "Month", "Submitted", "Not submitted" },
            TableRows = cmrRows,
        });

        AddClubs(new PerformanceReportSection
        {
            Title = "E-Governance",
            Items =
            {
                new("OCV / GOV documents uploaded", N(ClubsTotal("OCV/GOV Documents"))),
            },
        });

        if (awardsEnabled)
            AddClubs(new PerformanceReportSection
            {
                Title = "District Awards — Top Clubs",
                TableHeaders = new() { "#", "Club", "Points" },
                TableRows = allStats.Where(s => s.AwardPoints > 0).OrderByDescending(s => s.AwardPoints).Take(5)
                    .Select((s, i) => new List<string> { (i + 1).ToString(), s.Club.ClubName, Dec(s.AwardPoints) }).ToList(),
                Note = awardClubs == 0 ? "No club has District Awards points yet." : null,
            });

        AddClubs(new PerformanceReportSection
        {
            Title = "Top 5 Clubs by Projects",
            TableHeaders = new() { "#", "Club", "Projects" },
            TableRows = allStats.Where(s => s.TotalProjects > 0).OrderByDescending(s => s.TotalProjects).ThenBy(s => s.Club.ClubName).Take(5)
                .Select((s, i) => new List<string> { (i + 1).ToString(), s.Club.ClubName, N(s.TotalProjects) }).ToList(),
        });
        // "Top 5 Clubs by Members" removed — no member figures outside Clubs & Members (user 2026-09-28).

        // ── At a glance (the first thing the DG sees) ────────────────────────────────────────────
        var totalGivingGoal = headlineGoals.FirstOrDefault(g =>
            g.Category.Equals("Foundation", StringComparison.OrdinalIgnoreCase) && g.Metric.Equals("Total Giving", StringComparison.OrdinalIgnoreCase));
        long cmrDue = cmrSubmitted + cmrPending + cmrNotStarted;
        decimal? cmrPct = cmrDue > 0 ? Math.Round((decimal)cmrSubmitted / cmrDue * 100m, 1) : null;
        long projectTotal = avenueTotals.Values.Sum() + districtProjects + districtEvents;   // clubs + the district's own
        // Row 1: Clubs · TRF Total Giving. Row 2: Service Projects · Total Cost · Beneficiaries · Man Hours
        // (user 2026-09-28). Active Members and Club Monthly Report tiles removed (user 2026-09-28).
        var highlights = new List<PerformanceReportHighlight>
        {
            new() { Label = "Clubs", Value = N(clubs.Count + nonSynced.Count), Sub = $"{N(clubs.Count)} synced · {N(nonSynced.Count)} not synced" },
            // Figure first, percentage underneath (user 2026-09-18).
            totalGivingGoal == null || (totalGivingGoal.Target ?? 0) <= 0
                ? new PerformanceReportHighlight { Label = "Foundation Total Giving", Value = "—", Sub = "Goal not set yet" }
                : new PerformanceReportHighlight
                {
                    Label = "Foundation Total Giving",
                    Value = Dec(totalGivingGoal.Achieved),
                    Sub = $"{Pct2(totalGivingGoal.Pct)} target of {Dec(totalGivingGoal.Target)}",
                    Percent = totalGivingGoal.Pct ?? 0m,
                },
            // Service Projects · Total Cost · Beneficiaries · Man Hours together on their own row (user 2026-09-28).
            new() { NewRow = true, Label = "Service Projects", Value = N(projectTotal), Sub = $"by {N(allStats.Count(s => s.TotalProjects > 0))} clubs{(districtProjects + districtEvents > 0 ? " + district" : "")}" },
            new() { Label = "Total Cost", Value = Money(totalCost + districtCost, currency), Sub = "clubs and district projects" },
            new() { Label = "Beneficiaries", Value = N(totalBeneficiaries + districtBeneficiaries), Sub = "people reached this year" },
            new() { Label = "Man Hours", Value = N(totalHours + districtHours), Sub = "volunteer hours this year" },
        };

        var result = new DistrictPerformanceReportResult
        {
            Highlights = highlights,
            TilesPerRow = 4,
            // Club counts and Club Monthly Report cover every club; member figures (Clubs & Members) carry their
            // own note above that table (user 2026-09-28).
            ScopeNote = "Club counts and Club Monthly Report figures include every active club, whether or not it has enabled sync with "
                      + "Rotary.org. All other figures cover only clubs that have enabled sync, so they may differ from the district's own "
                      + "records until all clubs enable sync. Clubs that have not yet enabled sync are listed in the attached Excel "
                      + "(Non-Synced Clubs sheet).",
            DistrictId = districtId,
            DistrictNumber = district.DistrictNumber,
            ZoneName = district.ZoneName ?? "",
            YearId = year.Id,
            YearLabel = year.Label,
            PeriodLabel = $"{start:dd MMM yyyy} – {end:dd MMM yyyy}",
            GovernorName = dg.Name,
            GovernorEmail = string.IsNullOrWhiteSpace(dg.Email) ? null : dg.Email.Trim(),
            GovernorMobile = dg.Mobile,
            Subject = $"District Performance Report — District {district.DistrictNumber} — {today:dd MMM yyyy}",
            FileName = $"District_{SafeFile(district.DistrictNumber)}_Performance_Report_{DateTime.Now:ddMMyyyy_HHmm}.xlsx",
            Sections = sections,
            ReportKicker = "District Performance Report",
            ReportTitle = $"District {district.DistrictNumber}",
            ReportSubtitle = $"{district.ZoneName} · Rotary Year {year.Label} · {start:dd MMM yyyy} – {end:dd MMM yyyy}",
            Salutation = string.IsNullOrWhiteSpace(dg.Name) ? "Dear District Governor," : $"Dear DG {dg.Name},",
            IntroLine = $"Here is how District {district.DistrictNumber} is progressing this Rotary year — the work of every club, brought together in one place.",
            ClosingLine = $"Thank you for leading District {district.DistrictNumber} this year. These figures are the combined effort of your clubs "
                        + "and Rotarians, and we hope this report helps you see that effort clearly and act on it.",
            AttachmentNote = "The attached Excel holds the complete data behind this report. Sheets included: Summary (this email), "
                           + "District (all district figures), All Clubs (one row per club with every module count), Synced and Non-Synced Clubs, "
                           + (ClubGoalsComingSoon
                               ? "Goals - District (Club Goal Setting is coming soon), "
                               : "Goals - District, Goals - Clubs (one sheet each for Membership, Youth Service, Foundation and Public Image), ")
                           + "Projects Ranking, Club Monthly Report Grid and Club Websites (active).",
        };

        if (includeAttachment)
        {
            // Members Joined / Members Left sheets and the District Dues sheet are no longer part of this
            // report (user 2026-09-28): no member details outside Clubs & Members, and no District Dues.

            result.Excel = BuildWorkbook(result, allStats, categories, hasOtherAvenue, activeSites,
                monthStates.Select(x => x.Month).ToList(), goalData, currency, nonSynced, cmrAllClubs, awardsEnabled);
            result.Html = BuildEmailBody(result, null);
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Send
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    public async Task<string> SendTestAsync(int districtId, int requestedByMemberId, CancellationToken ct = default)
    {
        var r = await BuildReportAsync(districtId, includeAttachment: true, ct);
        string to = _testRecipients[0];
        var cc = _testRecipients.Skip(1).ToList();
        string dgLine = r.GovernorEmail != null
            ? $"When this goes live it will be sent to District Governor {r.GovernorName} ({r.GovernorEmail})."
            : "When this goes live it will be SKIPPED for this district — no District Governor email is on record.";
        string html = BuildEmailBody(r, "TEST COPY — " + dgLine);
        try
        {
            await _email.SendScopedEmailWithAttachmentAsync(to, r.Subject, html, r.Excel!, r.FileName, cc, null, districtId, EmailType);
            await LogAsync(districtId, r.YearId, "Manual", to, cc, "Sent", null, requestedByMemberId);
        }
        catch (Exception ex)
        {
            await LogAsync(districtId, r.YearId, "Manual", to, cc, "Failed", ex.Message, requestedByMemberId);
            throw;
        }
        return $"Test email for District {r.DistrictNumber} sent to {string.Join(", ", _testRecipients)}.";
    }

    public async Task RunScheduledAsync(bool catchUp, CancellationToken ct = default)
    {
        if (!_enabled) return;
        var today = DateTime.Today;
        // Rehearsal day: behave exactly like the old Test mode - sample district report,
        // to the test addresses only. See PreviewDate above.
        bool preview = PreviewDate.HasValue && today.Date == PreviewDate.Value.Date;
        bool live = _mode == "Live" && !preview;
        if (live && !_liveDays.Contains(today.Day)) return;
        if (!live && !preview && _mode == "Live") return;   // a live-mode day that is neither 1st/16th nor the rehearsal
        string runType = live ? "ScheduledLive" : "ScheduledTest";

        List<PerformanceReportDistrictOption> targets;
        await using (var conn = new MySqlConnection(_conn))
        {
            await conn.OpenAsync(ct);
            var all = await LoadReportDistrictsAsync(conn);
            targets = live
                ? all
                : all.Where(d => _testDistricts.Contains(d.DistrictNumber, StringComparer.OrdinalIgnoreCase)).ToList();
        }

        var skippedNoDg = new List<string>();
        foreach (var d in targets)
        {
            if (ct.IsCancellationRequested) break;
            var already = await AlreadyRanTodayAsync(d.DistrictId, runType);
            if (already == true) continue;
            if (catchUp && already == null) continue;   // can't verify the log → never risk a duplicate

            string? to = null;
            List<string> cc = new();
            int yearId = 0;
            try
            {
                var r = await BuildReportAsync(d.DistrictId, includeAttachment: true, ct);
                yearId = r.YearId;
                if (live)
                {
                    if (r.GovernorEmail == null)
                    {
                        skippedNoDg.Add(d.DistrictNumber);
                        await LogAsync(d.DistrictId, yearId, runType, null, null, "Skipped", "No District Governor email on record.", null);
                        continue;
                    }
                    to = r.GovernorEmail;
                    cc = _liveCc.ToList();
                }
                else
                {
                    to = _testRecipients[0];
                    cc = _testRecipients.Skip(1).ToList();
                }

                if (_suppressLocalDev)
                {
                    _logger.LogWarning("District performance report SUPPRESSED on a dev/remote-DB machine — District {District} would go to {To} (cc {Cc}).",
                        d.DistrictNumber, to, string.Join(", ", cc));
                    await LogAsync(d.DistrictId, yearId, runType, to, cc, "Suppressed", "Dev machine — scheduled send suppressed.", null);
                    continue;
                }
                await _email.SendScopedEmailWithAttachmentAsync(to, r.Subject, r.Html!, r.Excel!, r.FileName, cc, null, d.DistrictId, EmailType);
                await LogAsync(d.DistrictId, yearId, runType, to, cc, "Sent", null, null);
                _logger.LogInformation("District performance report sent — District {District} to {To}.", d.DistrictNumber, to);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "District performance report failed for District {District}.", d.DistrictNumber);
                await LogAsync(d.DistrictId, yearId, runType, to, cc, "Failed", ex.Message, null);
            }
        }

        // Live: tell the CC people which districts were skipped for want of a DG email.
        if (live && skippedNoDg.Count > 0 && !_suppressLocalDev && _liveCc.Length > 0)
        {
            try
            {
                var body = $@"{EmailService.EMAIL_HEADER}
                    <p style='font-size:14px;color:#333'>The District Performance Report was <strong>not sent</strong> to these districts
                    because no District Governor email is on record for the current Rotary year:</p>
                    <p style='font-size:15px;font-weight:bold;color:#1F4E79'>{WebUtility.HtmlEncode(string.Join(", ", skippedNoDg))}</p>
                    <p style='font-size:13px;color:#555'>Add the District Governor (with an email address) and the next run will include them.</p>
                    {EmailService.EMAIL_FOOTER}";
                await _email.SendGenericEmailWithCcAsync(_liveCc[0], _liveCc.Length > 1 ? string.Join(",", _liveCc.Skip(1)) : null,
                    $"District Performance Report — {skippedNoDg.Count} district(s) skipped (no DG email) — {today:dd MMM yyyy}", body);
            }
            catch (Exception ex) { _logger.LogError(ex, "District performance report: could not send the skipped-districts notice."); }
        }
    }

    // true = a Sent/Skipped row exists today; false = verified none; null = the log could not be read.
    private async Task<bool?> AlreadyRanTodayAsync(int districtId, string runType)
    {
        try
        {
            await using var conn = new MySqlConnection(_conn);
            await conn.OpenAsync();
            var n = await conn.ExecuteScalarAsync<long>(@"
                SELECT COUNT(*) FROM district_performance_report_log
                WHERE fk_district_id = @D AND RunType = @T AND RunDate = CURDATE() AND Status IN ('Sent', 'Skipped')",
                new { D = districtId, T = runType });
            return n > 0;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "District performance report: run log unavailable.");
            return null;
        }
    }

    private async Task LogAsync(int districtId, int yearId, string runType, string? to, List<string>? cc, string status, string? message, int? memberId)
    {
        try
        {
            await using var conn = new MySqlConnection(_conn);
            await conn.OpenAsync();
            await conn.ExecuteAsync(@"
                INSERT INTO district_performance_report_log
                    (fk_district_id, fk_year_id, RunType, ToEmail, CcEmails, Status, Message, RunDate, created_by, created_date)
                VALUES (@D, @Y, @T, @To, @Cc, @S, @M, CURDATE(), @By, NOW())",
                new
                {
                    D = districtId, Y = yearId, T = runType, To = to,
                    Cc = cc == null || cc.Count == 0 ? null : string.Join(",", cc),
                    S = status,
                    M = message == null ? null : (message.Length > 1000 ? message[..1000] : message),
                    By = memberId,
                });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "District performance report: could not write the run log (run SQL/district_performance_report_log.sql).");
        }
    }

    private static bool IsRemoteDb(string connectionString)
    {
        try
        {
            var server = (new MySqlConnectionStringBuilder(connectionString).Server ?? "").Trim().ToLowerInvariant();
            return server.Length > 0 && server != "localhost" && server != "127.0.0.1" && server != "::1";
        }
        catch { return false; }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Formatting
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    private static string N(long v) => v.ToString("N0", InCulture);
    private static string N(int v) => v.ToString("N0", InCulture);
    private static string Dec(decimal? v)
    {
        if (!v.HasValue) return "—";
        return v.Value == Math.Truncate(v.Value) ? v.Value.ToString("N0", InCulture) : v.Value.ToString("N2", InCulture);
    }
    private static string Pct(decimal? v) => v.HasValue ? $"{v.Value.ToString("0.#", CultureInfo.InvariantCulture)}%" : "—";
    // Foundation (TRF): 2 decimals everywhere, same as the Goal Setting screens (user 2026-10-07).
    private static string Pct2(decimal? v) => v.HasValue ? $"{v.Value.ToString("0.##", CultureInfo.InvariantCulture)}%" : "—";
    private static string Money(decimal v, string currency)
        => $"{currency} {Math.Round(v, 0).ToString("N0", InCulture)}";
    private static string MonthName(int month) => CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(month);
    private static string SafeFile(string s) => new string(s.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_').ToArray());
    private static string D(DateTime? d) => d.HasValue ? d.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : "";

    // Website host for a club/district website record — the same rule the app uses: a client domain
    // wins; otherwise the subdomain as a host ("https://club.example.org/" → "club.example.org",
    // "www.rotarythaneeast.org" kept), and a bare label ("rcthanehills") gets the parent domain appended.
    // Null when nothing usable is stored.
    private static string? SiteHost(string? clientDomain, string? subdomain, string parentDomain)
    {
        var host = WebsiteDomainHelper.NormalizeClientDomain(clientDomain);
        if (host != null) return host;
        var sub = WebsiteDomainHelper.NormalizeClientDomain(subdomain);
        if (sub == null) return null;
        return sub.Contains('.') ? sub : $"{sub}.{parentDomain}";
    }

    // Blue underlined external link in a worksheet cell.
    private static void LinkCell(IXLCell cell, string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        try
        {
            cell.SetHyperlink(new XLHyperlink(url));
            cell.Style.Font.FontColor = XLColor.FromHtml("#1d4ed8");
            cell.Style.Font.Underline = XLFontUnderlineValues.Single;
        }
        catch { /* a malformed stored address stays plain text */ }
    }

    // Progress colour: under 30% red, under 60% amber, otherwise green.
    private static string RagColor(decimal pct) => pct < 30m ? "#dc2626" : pct < 60m ? "#d97706" : "#16a34a";

    // RAG Analysis band names in their own colour (null = not a band row).
    private static string? BandColor(string text) =>
        text.StartsWith(RagRed, StringComparison.Ordinal) ? "#dc2626"
        : text.StartsWith(RagAmber, StringComparison.Ordinal) ? "#d97706"
        : text.StartsWith(RagGreen, StringComparison.Ordinal) ? "#16a34a"
        : null;

    // Excel: % figures and RAG band names in red / amber / green (same colours as the email).
    private static void StyleFigureCell(IXLCell cell, string header, string text, int col)
    {
        string? color = null;
        if ((header == PctHeader || header.EndsWith("%"))
            && decimal.TryParse(text.TrimEnd('%'), NumberStyles.Number, CultureInfo.InvariantCulture, out var pct))
            color = RagColor(pct);
        else if (col == 0) color = BandColor(text);
        if (color == null) return;
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontColor = XLColor.FromHtml(color);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Email body
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Print = the email body itself, so a printed copy is identical to what the DG gets.
    public string BuildPrintHtml(DistrictPerformanceReportResult result) => BuildEmailBody(result, null);

    private static string BuildEmailBody(DistrictPerformanceReportResult r, string? banner)
    {
        // Email-safe layout: tables + inline styles only (no flex/grid), so Gmail / Outlook / phones render it.
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        const string navy = "#1a365d", blue = "#2d7fc7", ink = "#1e293b", muted = "#64748b", line = "#e2e8f0";
        var sb = new System.Text.StringBuilder();
        // Wider body for this report only (620 → 820px) so four tiles fit a row without "₹ 4,81,48,933"
        // wrapping (user 2026-09-28). Every other email keeps the shared 620px header; phones still shrink it.
        sb.Append(EmailService.EMAIL_HEADER.Replace("max-width: 620px", "max-width: 820px"));

        if (!string.IsNullOrWhiteSpace(banner))
            sb.Append($"<p style='font-size:13px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:10px 12px;border-radius:6px;margin:0 0 16px 0'>{E(banner)}</p>");

        // ── Hero ──
        sb.Append($@"
            <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:0 0 18px 0'>
              <tr><td style='border-left:5px solid {blue};padding:4px 0 4px 14px'>
                <div style='font-size:11px;letter-spacing:1.5px;color:{muted};text-transform:uppercase'>{E(r.ReportKicker)}</div>
                <div style='font-size:26px;font-weight:bold;color:{navy};line-height:1.2'>{E(r.ReportTitle)}</div>
                <div style='font-size:12px;color:{muted}'>{E(r.ReportSubtitle)}</div>
              </td></tr>
            </table>");
        sb.Append($@"<p style='font-size:14px;color:#333;margin:0 0 18px 0'>{E(r.Salutation)}<br/>{E(r.IntroLine)}</p>");

        // ── At a glance — 4 tiles per row on the District report ──
        if (r.Highlights.Count > 0)
        {
            int perRow = r.TilesPerRow is 4 ? 4 : 3;
            string tdWidth = perRow == 4 ? "25%" : "33%";
            // Tiles are grouped: the district report has one unnamed group ("At a glance").
            foreach (var group in r.Highlights.GroupBy(h => h.Group))
            {
                sb.Append($"<div style='font-size:13px;font-weight:bold;color:{navy};margin:12px 0 6px 0'>{E(group.Key ?? "At a glance")}</div>");
                sb.Append("<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:separate;border-spacing:6px;margin:0 -6px 6px -6px'>");
                // Rows: a new row when the current one is full or a tile asks for one (NewRow).
                var rows = new List<List<PerformanceReportHighlight>>();
                foreach (var t in group)
                {
                    if (rows.Count == 0 || rows[^1].Count == perRow || t.NewRow) rows.Add(new());
                    rows[^1].Add(t);
                }
                foreach (var tiles in rows)
                {
                    sb.Append("<tr>");
                    for (int j = 0; j < perRow; j++)
                    {
                        if (j >= tiles.Count) { sb.Append($"<td width='{tdWidth}'></td>"); continue; }
                        var h = tiles[j];
                        string valueColor = h.Percent.HasValue ? RagColor(h.Percent.Value) : navy;
                        sb.Append($@"<td width='{tdWidth}' valign='top' style='background:#f8fafc;border:1px solid {line};border-radius:8px;padding:12px 12px'>
                            <div style='font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:{muted};white-space:nowrap'>{E(h.Label)}</div>
                            <div style='font-size:22px;font-weight:bold;color:{valueColor};line-height:1.3;white-space:nowrap'>{E(h.Value)}</div>
                            <div style='font-size:11px;color:{muted}'>{E(h.Sub)}</div>
                        </td>");
                    }
                    sb.Append("</tr>");
                }
                sb.Append("</table>");
            }
        }

        // Plain scope line under the tiles — no box, no colour (user 2026-09-18); darker so it reads (user 2026-09-28).
        if (!string.IsNullOrWhiteSpace(r.ScopeNote))
            sb.Append($"<p style='font-size:12px;color:#334155;margin:0 0 4px 2px;line-height:1.6'>{E(r.ScopeNote)}</p>");

        // ── Sections — grouped into parts (District, then Clubs), each opened by a large band ──
        string? lastPart = null;
        int partNo = 0;
        foreach (var s in r.Sections)
        {
            if (!string.IsNullOrEmpty(s.Part) && s.Part != lastPart)
            {
                lastPart = s.Part;
                partNo++;
                sb.Append($@"<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:30px 0 4px 0'>
                    <tr><td style='background:{navy};border-radius:8px;padding:13px 16px'>
                      <div style='font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#bfdbfe'>Part {partNo}</div>
                      <div style='font-size:19px;font-weight:bold;color:#ffffff;line-height:1.3'>{E(s.Part)}</div>
                      {(string.IsNullOrWhiteSpace(s.PartSubtitle) ? "" : $"<div style='font-size:12px;color:#cbd5e1'>{E(s.PartSubtitle)}</div>")}
                    </td></tr></table>");
            }
            sb.Append($@"<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:20px 0 0 0'>
                <tr><td style='border-left:4px solid {blue};background:#f1f5f9;padding:8px 12px;font-size:14px;font-weight:bold;color:{navy}'>{E(s.Title)}</td></tr></table>");
            if (!string.IsNullOrWhiteSpace(s.Intro))
                sb.Append($"<p style='font-size:12px;color:#334155;font-style:italic;margin:6px 0 2px 12px'>{E(s.Intro)}</p>");

            if (s.Items.Count > 0)
            {
                sb.Append("<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse'><tbody>");
                foreach (var it in s.Items)
                {
                    bool sub = it.Label.StartsWith(" ");
                    sb.Append($@"<tr>
                        <td style='padding:7px 12px{(sub ? " 7px 28px" : "")};border-bottom:1px solid {line};font-size:13px;color:{(sub ? muted : "#334155")}'>{E(it.Label.Trim())}</td>
                        <td style='padding:7px 12px;border-bottom:1px solid {line};font-size:14px;color:{ink};font-weight:bold;text-align:right;white-space:nowrap'>{(string.IsNullOrWhiteSpace(it.Url) ? E(it.Value) : $"<a href='{E(it.Url)}' target='_blank' style='color:#1d4ed8;text-decoration:underline'>{E(it.Value)}</a>")}</td></tr>");
                }
                sb.Append("</tbody></table>");
            }

            if (s.TableHeaders != null && s.TableRows != null && s.TableRows.Count > 0)
            {
                // Text columns align left: the first column, plus the club name in "#"-ranked tables. Numbers right.
                bool rankTable = s.TableHeaders.Count > 1 && s.TableHeaders[0] == "#";
                sb.Append("<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin-top:4px'><thead><tr>");
                for (int c = 0; c < s.TableHeaders.Count; c++)
                    sb.Append($"<th style='padding:7px 10px;border-bottom:2px solid {line};font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:{muted};text-align:{(c == 0 || (rankTable && c == 1) ? "left" : "right")}{(c == 0 && !rankTable && s.TableHeaders.Count >= 4 ? ";width:26%" : "")}'>{E(s.TableHeaders[c])}</th>");
                sb.Append("</tr></thead><tbody>");
                foreach (var row in s.TableRows)
                {
                    sb.Append("<tr>");
                    for (int c = 0; c < row.Count; c++)
                    {
                        // % columns ("Percentage Achieved", "TRF %" …): the figure only, coloured red / amber / green.
                        if (c < s.TableHeaders.Count && (s.TableHeaders[c] == PctHeader || s.TableHeaders[c].EndsWith("%"))
                            && decimal.TryParse(row[c].TrimEnd('%'), NumberStyles.Number, CultureInfo.InvariantCulture, out var cp))
                        {
                            sb.Append($"<td style='padding:7px 10px;border-bottom:1px solid {line};font-size:13px;font-weight:bold;color:{RagColor(cp)};text-align:right;white-space:nowrap'>{E(row[c])}</td>");
                            continue;
                        }
                        bool left = c == 0 || (rankTable && c == 1);
                        string? band = c == 0 ? BandColor(row[c]) : null;
                        sb.Append($"<td style='padding:7px 10px;border-bottom:1px solid {line};font-size:13px;color:{band ?? (left ? "#334155" : ink)};{(band != null ? "font-weight:bold;" : "")}text-align:{(left ? "left" : "right")};white-space:{(left ? "normal" : "nowrap")}'>{E(row[c])}</td>");
                    }
                    sb.Append("</tr>");
                }
                sb.Append("</tbody></table>");
            }

            if (!string.IsNullOrWhiteSpace(s.Note))
                sb.Append($"<p style='font-size:12px;color:#334155;font-style:italic;margin:5px 0 0 12px'>{E(s.Note)}</p>");
        }

        // ── Closing ──
        sb.Append($@"
            <p style='font-size:14px;color:#333;line-height:1.7;margin:26px 0 8px 0'>
                {E(r.ClosingLine)}
            </p>
            <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:14px 0 6px 0'>
              <tr><td style='background:#f8fafc;border:1px solid {line};border-radius:8px;padding:12px 14px;font-size:12px;color:#334155;line-height:1.7'>
                📎 {E(r.AttachmentNote)}
              </td></tr>
            </table>
            <p style='font-size:12px;color:#334155;font-style:italic;margin:10px 0 0 0'>All figures are as on {DateTime.Today:dd MMM yyyy} and are sourced from the ROW portal.</p>");
        sb.Append(EmailService.EMAIL_FOOTER);
        return sb.ToString();
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    //  Excel
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    private static byte[] BuildWorkbook(DistrictPerformanceReportResult r, List<ClubStats> clubs, List<(int Id, string Name)> categories,
        bool hasOtherAvenue, List<WebsiteRow> websites,
        List<int> months, DistrictPerformanceGoalData goals, string currency,
        List<ClubRow> nonSynced, List<CmrGridRow> cmrRows, bool awardsEnabled)
    {
        using var wb = new XLWorkbook();
        BuildSummarySheet(wb, r);

        // Listing-sheet style (same look as the daily statistics report).
        static void Style(IXLWorksheet ws, int cols, int lastDataRow, int[] numberCols)
        {
            var header = ws.Range(1, 1, 1, cols);
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1F4E79");
            header.Style.Font.FontColor = XLColor.White;
            header.Style.Font.Bold = true;
            header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            header.Style.Alignment.WrapText = true;
            ws.Row(1).Height = 30;
            var all = ws.Range(1, 1, Math.Max(1, lastDataRow), cols);
            all.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            all.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            all.Style.Border.OutsideBorderColor = XLColor.FromHtml("#8EAADB");
            all.Style.Border.InsideBorderColor = XLColor.FromHtml("#D9E1F2");
            for (int rr = 2; rr <= lastDataRow; rr++)
                if (rr % 2 == 0) ws.Range(rr, 1, rr, cols).Style.Fill.BackgroundColor = XLColor.FromHtml("#EAF1FB");
            if (lastDataRow >= 2)
                foreach (var nc in numberCols)
                    ws.Range(2, nc, lastDataRow, nc).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            ws.SheetView.FreezeRows(1);
            ws.Range(1, 1, Math.Max(1, lastDataRow), cols).SetAutoFilter();
            ws.Columns().AdjustToContents(1, Math.Max(1, lastDataRow), 8, 60);
        }
        static void Headers(IXLWorksheet ws, IList<string> h) { for (int i = 0; i < h.Count; i++) ws.Cell(1, i + 1).Value = h[i]; }
        static void EmptyNote(IXLWorksheet ws, int cols, string text)
        {
            ws.Cell(2, 1).Value = text;
            ws.Range(2, 1, 2, cols).Merge();
            ws.Cell(2, 1).Style.Font.Italic = true;
            ws.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#64748b");
        }

        var avenueLabels = ProjectAvenues.Select(a => a.Label).ToList();
        if (hasOtherAvenue) avenueLabels.Add(OtherAvenue);

        // ── District — every district-level figure on one sheet ──────────────────────────────
        {
            var ws = wb.Worksheets.Add("District");
            var navy = XLColor.FromHtml("#1a365d");
            var blue = XLColor.FromHtml("#2d7fc7");
            var border = XLColor.FromHtml("#cbd5e1");
            ws.Column(1).Width = 44;
            for (int i = 2; i <= 5; i++) ws.Column(i).Width = 18;
            int row = 1;
            ws.Range(row, 1, row, 5).Merge();
            var t = ws.Cell(row, 1);
            t.Value = $"District {r.DistrictNumber} — District Details";
            t.Style.Font.Bold = true; t.Style.Font.FontSize = 16; t.Style.Font.FontColor = XLColor.White;
            t.Style.Fill.BackgroundColor = navy; t.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(row).Height = 30; row++;
            ws.Range(row, 1, row, 5).Merge();
            ws.Cell(row, 1).Value = $"{r.ZoneName}   ·   Rotary Year {r.YearLabel}   ·   {r.PeriodLabel}";
            ws.Cell(row, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Cell(row, 1).Style.Font.FontColor = XLColor.FromHtml("#475569");
            row += 2;

            void Band(string text)
            {
                ws.Range(row, 1, row, 5).Merge();
                var c = ws.Cell(row, 1);
                c.Value = text; c.Style.Font.Bold = true; c.Style.Font.FontColor = XLColor.White; c.Style.Fill.BackgroundColor = blue;
                ws.Row(row).Height = 20; row++;
            }
            void Kv(string label, string value, string? url = null)
            {
                ws.Cell(row, 1).Value = label.Trim();
                if (label.StartsWith(" ")) ws.Cell(row, 1).Style.Alignment.Indent = 2;
                ws.Cell(row, 2).Value = value;
                ws.Cell(row, 2).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                ws.Cell(row, 2).Style.Font.Bold = true;
                LinkCell(ws.Cell(row, 2), url);
                var rng = ws.Range(row, 1, row, 2);
                rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; rng.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                rng.Style.Border.OutsideBorderColor = border; rng.Style.Border.InsideBorderColor = border;
                row++;
            }

            if (!string.IsNullOrWhiteSpace(r.GovernorName))
            {
                Band("District Governor");
                Kv("Name", r.GovernorName!);
                Kv("Email", r.GovernorEmail ?? "Not on record");
                Kv("Mobile", r.GovernorMobile ?? "");
                row++;
            }

            string districtPart = r.Sections.FirstOrDefault()?.Part ?? "";
            foreach (var s in r.Sections.Where(x => x.Part == districtPart))
            {
                Band(s.Title);
                if (!string.IsNullOrWhiteSpace(s.Intro))
                {
                    ws.Range(row, 1, row, 5).Merge();
                    var si = ws.Cell(row, 1);
                    si.Value = s.Intro; si.Style.Font.Italic = true; si.Style.Font.FontSize = 10;
                    si.Style.Font.FontColor = XLColor.FromHtml("#334155");
                    row++;
                }
                foreach (var it in s.Items) Kv(it.Label, it.Value, it.Url);
                if (s.TableHeaders != null && s.TableRows != null && s.TableRows.Count > 0)
                {
                    int cols = s.TableHeaders.Count;
                    for (int c = 0; c < cols; c++)
                    {
                        var hc = ws.Cell(row, c + 1); hc.Value = s.TableHeaders[c];
                        hc.Style.Font.Bold = true; hc.Style.Fill.BackgroundColor = XLColor.FromHtml("#e2e8f0");
                        hc.Style.Alignment.WrapText = true;
                    }
                    int headRow = row; row++;
                    foreach (var tr in s.TableRows)
                    {
                        for (int c = 0; c < cols && c < tr.Count; c++)
                        {
                            var dc = ws.Cell(row, c + 1);
                            dc.Value = tr[c];
                            if (c >= 1) dc.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                            StyleFigureCell(dc, s.TableHeaders[c], tr[c], c);
                        }
                        row++;
                    }
                    var blk = ws.Range(headRow, 1, row - 1, cols);
                    blk.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; blk.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                    blk.Style.Border.OutsideBorderColor = border; blk.Style.Border.InsideBorderColor = border;
                }
                if (!string.IsNullOrWhiteSpace(s.Note))
                {
                    ws.Range(row, 1, row, 5).Merge();
                    var n = ws.Cell(row, 1);
                    n.Value = s.Note; n.Style.Font.Italic = true; n.Style.Font.FontSize = 10; n.Style.Font.FontColor = XLColor.FromHtml("#334155");
                    row++;
                }
                row++;
            }
            ws.SheetView.FreezeRows(2);
        }

        // ── All Clubs — one row per club, every module count across the columns ──────────────
        {
            var ws = wb.Worksheets.Add("All Clubs");
            // (Header, value, IsNumber, SumInTotal)
            var cols = new List<(string H, Func<ClubStats, object?> V, bool Num, bool Sum)>
            {
                ("Club Name", s => s.Club.ClubName, false, false),
                ("Club ID (Rotary)", s => s.Club.ClubRotaryId ?? "", false, false),
                ("City", s => s.Club.City ?? "", false, false),
                ("Charter Date", s => D(s.Club.ClubCharterDate), false, false),
                // Member columns removed (user 2026-09-28); the RAG band stays with the RAG Analysis.
                ("RAG Band", s => MembershipBand(s.M.Members), false, false),
                ("Potential Members (till date)", s => s.Mod.GetValueOrDefault("Potential Members"), true, true),
            };
            foreach (var cat in categories)
                cols.Add(($"Goals: {cat.Name}", s => s.GoalCategoriesSet.Contains(cat.Id) ? "Yes" : "No", false, false));
            foreach (var av in avenueLabels)
                cols.Add((av, s => s.Projects.GetValueOrDefault(av), true, true));
            cols.AddRange(new (string, Func<ClubStats, object?>, bool, bool)[]
            {
                ("Total Projects", s => s.TotalProjects, true, true),
                ("Club Service", s => s.ClubService, true, true),
                ("Beneficiaries", s => s.Beneficiaries, true, true),
                ("Volunteer Hours", s => s.ManHours, true, true),
                ($"Project Cost ({currency})", s => Math.Round(s.Cost, 0), true, true),
                ("Club Monthly Report Submitted", s => s.CmrSubmitted, true, true),
                ("Club Monthly Report Not Submitted", s => s.CmrPending + s.CmrNotStarted, true, true),
                ("OCV/GOV Documents", s => s.Mod.GetValueOrDefault("OCV/GOV Documents"), true, true),
                ("TRF Contributions", s => s.Mod.GetValueOrDefault("TRF Contributions"), true, true),
                ("TRF Amount (USD)", s => Math.Round(s.TrfUsd, 0), true, true),
                ("Active Club Website", s => s.Website == null ? "No" : (s.Website.Host ?? "Yes"), false, false),
            });
            // District Awards column only when the district uses it (same as the email).
            if (awardsEnabled) cols.Add(("District Award Points", s => s.AwardPoints, true, true));
            cols.AddRange(new (string, Func<ClubStats, object?>, bool, bool)[]
            {
                ("President", s => s.President?.Name ?? "", false, false),
                ("President Mobile", s => s.President?.Mobile ?? "", false, false),
                ("President Email", s => s.President?.Email ?? "", false, false),
                ("Secretary", s => s.Secretary?.Name ?? "", false, false),
                ("Secretary Mobile", s => s.Secretary?.Mobile ?? "", false, false),
                ("Secretary Email", s => s.Secretary?.Email ?? "", false, false),
            });

            static void SetCell(IXLCell cell, object? v)
            {
                switch (v)
                {
                    case null: break;
                    case long l: cell.Value = l; cell.Style.NumberFormat.Format = "#,##0"; break;
                    case int i: cell.Value = i; cell.Style.NumberFormat.Format = "#,##0"; break;
                    case decimal d: cell.Value = d; cell.Style.NumberFormat.Format = d == Math.Truncate(d) ? "#,##0" : "#,##0.0"; break;
                    default: cell.Value = v.ToString(); break;
                }
            }

            Headers(ws, new[] { "Sr.No." }.Concat(cols.Select(c => c.H)).ToList());
            int websiteCol = cols.FindIndex(c => c.H == "Active Club Website") + 2;
            int bandCol = cols.FindIndex(c => c.H == "RAG Band") + 2;
            int row = 2;
            foreach (var s in clubs)
            {
                ws.Cell(row, 1).Value = row - 1;
                for (int i = 0; i < cols.Count; i++) SetCell(ws.Cell(row, i + 2), cols[i].V(s));
                if (s.Website?.Url != null) LinkCell(ws.Cell(row, websiteCol), s.Website.Url);
                StyleFigureCell(ws.Cell(row, bandCol), "", MembershipBand(s.M.Members), 0);
                row++;
            }
            int lastData = row - 1;
            if (clubs.Count == 0) EmptyNote(ws, cols.Count + 1, "No active clubs.");
            else
            {
                // TOTAL row for every countable column.
                ws.Cell(row, 2).Value = "TOTAL";
                for (int i = 0; i < cols.Count; i++)
                {
                    if (!cols[i].Sum) continue;
                    decimal total = clubs.Sum(s => cols[i].V(s) switch { long l => l, int n => n, decimal d => d, _ => 0m });
                    SetCell(ws.Cell(row, i + 2), total);
                }
            }
            var numberCols = new List<int> { 1 };
            for (int i = 0; i < cols.Count; i++) if (cols[i].Num) numberCols.Add(i + 2);
            Style(ws, cols.Count + 1, Math.Max(1, lastData), numberCols.ToArray());
            if (clubs.Count > 0)
            {
                var tr = ws.Range(row, 1, row, cols.Count + 1);
                tr.Style.Font.Bold = true;
                tr.Style.Fill.BackgroundColor = XLColor.FromHtml("#CFE0F4");
                tr.Style.Border.TopBorder = XLBorderStyleValues.Medium;
                foreach (var nc in numberCols) ws.Cell(row, nc).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            }
            ws.SheetView.FreezeColumns(2);
        }

        // ── Synced / Non-Synced Clubs ─────────────────────────────────────────────────────────
        // Synced = the active clubs every count above is based on; Non-Synced = not counted anywhere.
        void ClubList(string name, IEnumerable<ClubRow> rows, string emptyText)
        {
            var ws = wb.Worksheets.Add(name);
            var h = new[] { "Sr.No.", "Club Name", "Club ID (Rotary)", "City", "State", "Charter Date" };
            Headers(ws, h);
            int row = 2;
            foreach (var c in rows)
            {
                ws.Cell(row, 1).Value = row - 1;
                ws.Cell(row, 2).Value = c.ClubName;
                ws.Cell(row, 3).Value = c.ClubRotaryId ?? "";
                ws.Cell(row, 4).Value = c.City ?? "";
                ws.Cell(row, 5).Value = c.State ?? "";
                ws.Cell(row, 6).Value = D(c.ClubCharterDate);
                row++;
            }
            if (row == 2) EmptyNote(ws, h.Length, emptyText);
            Style(ws, h.Length, Math.Max(1, row - 1), new[] { 1 });
        }
        ClubList("Synced Clubs", clubs.Select(s => s.Club), "No active clubs.");
        ClubList("Non-Synced Clubs", nonSynced, "Every club in the district is synced with Rotary.org.");

        // Members Joined / Members Left sheets removed (user 2026-09-28).

        // ── Goal Setting (the existing Goal Setting reports' YTD sheets, copied unchanged) ────
        void CopyGoalSheet(byte[]? bytes, string sheetName, string emptyText)
        {
            if (bytes != null)
            {
                try
                {
                    using var ms = new MemoryStream(bytes);
                    using var src = new XLWorkbook(ms);
                    var ytd = src.Worksheets.FirstOrDefault(w => w.Name.StartsWith("YTD", StringComparison.OrdinalIgnoreCase))
                              ?? src.Worksheets.FirstOrDefault();
                    if (ytd != null) { ytd.CopyTo(wb, sheetName); return; }
                }
                catch
                {
                    // fall through to the empty sheet — drop any half-copied sheet first so the name is free
                    if (wb.Worksheets.TryGetWorksheet(sheetName, out var partial)) partial.Delete();
                }
            }
            var ws = wb.Worksheets.Add(sheetName);
            ws.Cell(1, 1).Value = emptyText;
            ws.Cell(1, 1).Style.Font.Italic = true;
            ws.Column(1).Width = 60;
        }
        CopyGoalSheet(goals.DistrictWorkbook, "Goals - District", "The district has not entered any goals yet.");
        // The post-copy "Metric" → "Particulars" rewrite that used to sit here is gone: the user asked
        // for that heading everywhere (2026-09-29), so GoalSettingService now writes "Particulars" in
        // the first place and there is no "Metric" cell left for this sheet to rename.
        CopyClubGoalSheetsByCategory(wb, goals.ClubsWorkbook);

        // ── Projects Ranking ──────────────────────────────────────────────────────────────────
        {
            var ws = wb.Worksheets.Add("Projects Ranking");
            var h = new List<string> { "Rank", "Club Name" };
            h.AddRange(avenueLabels);
            h.AddRange(new[] { "Total Projects", "Beneficiaries", "Volunteer Hours", $"Project Cost ({currency})" });
            Headers(ws, h);
            int row = 2;
            foreach (var s in clubs.OrderByDescending(x => x.TotalProjects).ThenBy(x => x.Club.ClubName))
            {
                int c = 1;
                ws.Cell(row, c++).Value = row - 1;
                ws.Cell(row, c++).Value = s.Club.ClubName;
                foreach (var av in avenueLabels) ws.Cell(row, c++).Value = s.Projects.GetValueOrDefault(av);
                ws.Cell(row, c++).Value = s.TotalProjects;
                ws.Cell(row, c++).Value = s.Beneficiaries;
                ws.Cell(row, c++).Value = s.ManHours;
                ws.Cell(row, c).Value = Math.Round(s.Cost, 0);
                ws.Cell(row, c).Style.NumberFormat.Format = "#,##0";
                row++;
            }
            if (row == 2) EmptyNote(ws, h.Count, "No active clubs.");
            Style(ws, h.Count, Math.Max(1, row - 1), Enumerable.Range(3, h.Count - 2).Prepend(1).ToArray());
        }

        // ── Club Monthly Report Grid — each month Submitted / Not submitted (user 2026-09-28) ──
        {
            var ws = wb.Worksheets.Add("Club Monthly Report Grid");
            var h = new List<string> { "Sr.No.", "Club Name" };
            h.AddRange(months.Select(MonthName));
            h.Add("Submitted");
            Headers(ws, h);
            int row = 2;
            // Every active club, synced or not (user 2026-09-28).
            foreach (var s in cmrRows)
            {
                ws.Cell(row, 1).Value = row - 1;
                ws.Cell(row, 2).Value = s.Club.ClubName;
                int c = 3;
                foreach (var mo in months)
                {
                    var val = s.ByMonth.GetValueOrDefault(mo) ?? "";
                    var cell = ws.Cell(row, c++);
                    cell.Value = val;
                    if (val == "Submitted") cell.Style.Font.FontColor = XLColor.FromHtml("#15803d");
                    else if (val == "Not submitted") cell.Style.Font.FontColor = XLColor.FromHtml("#b91c1c");
                }
                ws.Cell(row, c).Value = s.Submitted;
                row++;
            }
            if (row == 2) EmptyNote(ws, h.Count, "No active clubs.");
            Style(ws, h.Count, Math.Max(1, row - 1), new[] { 1, h.Count });
        }

        // ── Club Websites ─────────────────────────────────────────────────────────────────────
        {
            var ws = wb.Worksheets.Add("Club Websites");
            var h = new[] { "Sr.No.", "Club Name", "Website" };
            Headers(ws, h);
            int row = 2;
            foreach (var w in websites.OrderBy(x => x.ClubName))
            {
                ws.Cell(row, 1).Value = row - 1;
                ws.Cell(row, 2).Value = w.ClubName ?? "";
                ws.Cell(row, 3).Value = w.Host ?? w.ClientDomain ?? w.Subdomain ?? "";
                LinkCell(ws.Cell(row, 3), w.Url);
                row++;
            }
            if (row == 2) EmptyNote(ws, h.Length, "No club in this district has an active club website.");
            Style(ws, h.Length, Math.Max(1, row - 1), new[] { 1 });
        }

        wb.Worksheet("Summary").SetTabActive();
        using var outMs = new MemoryStream();
        wb.SaveAs(outMs);
        return outMs.ToArray();
    }

    // Goals - Clubs, split into one sheet per goal category (user 2026-09-28): Membership, Youth Service, TRF,
    // Public Image. Each sheet is the all-clubs Goal Setting YTD sheet with only the club column and that
    // category's columns kept. The Goal Setting report itself is not changed.
    private static void CopyClubGoalSheetsByCategory(XLWorkbook wb, byte[]? bytes)
    {
        const string baseName = "Goals - Clubs";
        if (ClubGoalsComingSoon)
        {
            var soon = wb.Worksheets.Add(baseName);
            soon.Cell(1, 1).Value = "Club Goal Setting is being finalised and will be available shortly.";
            soon.Cell(1, 1).Style.Font.Italic = true;
            soon.Column(1).Width = 70;
            return;
        }
        void Empty()
        {
            var ws = wb.Worksheets.Add(baseName);
            ws.Cell(1, 1).Value = "No club has entered any goals yet.";
            ws.Cell(1, 1).Style.Font.Italic = true;
            ws.Column(1).Width = 60;
        }
        if (bytes == null) { Empty(); return; }

        var made = new List<string>();
        try
        {
            using var ms = new MemoryStream(bytes);
            using var src = new XLWorkbook(ms);
            var ytd = src.Worksheets.FirstOrDefault(w => w.Name.StartsWith("YTD", StringComparison.OrdinalIgnoreCase))
                      ?? src.Worksheets.FirstOrDefault();
            if (ytd == null) { Empty(); return; }

            // The category heading row is the one whose first cell is the "Club" column heading.
            int lastCol = ytd.LastColumnUsed()?.ColumnNumber() ?? 1;
            int headRow = Enumerable.Range(1, 10).FirstOrDefault(r => ytd.Cell(r, 1).GetString() == "Club");
            var cats = new List<(string Name, int First, int Last)>();
            if (headRow > 0)
                for (int c = 2; c <= lastCol;)
                {
                    var cell = ytd.Cell(headRow, c);
                    int end = ytd.MergedRanges.FirstOrDefault(m => m.Contains(cell))?.RangeAddress.LastAddress.ColumnNumber ?? c;
                    string name = cell.GetString().Trim();
                    if (name.Length > 0) cats.Add((name, c, end));
                    c = end + 1;
                }
            if (cats.Count == 0) { ytd.CopyTo(wb, baseName); made.Add(baseName); return; }

            string[] preferred = { "Membership", "Youth Service", "Foundation", "Public Image" };
            int Rank(string n) { int i = Array.FindIndex(preferred, p => p.Equals(n, StringComparison.OrdinalIgnoreCase)); return i < 0 ? preferred.Length : i; }
            var mergedAll = ytd.MergedRanges.Select(m => (
                R1: m.RangeAddress.FirstAddress.RowNumber, C1: m.RangeAddress.FirstAddress.ColumnNumber,
                R2: m.RangeAddress.LastAddress.RowNumber, C2: m.RangeAddress.LastAddress.ColumnNumber)).ToList();

            foreach (var (catName, first, last) in cats.OrderBy(x => Rank(x.Name)))
            {
                string sheet = new string($"{baseName} - {catName}".Select(ch => "[]:*?/\\".Contains(ch) ? '-' : ch).ToArray());
                if (sheet.Length > 31) sheet = sheet[..31];
                if (wb.Worksheets.Contains(sheet)) continue;
                var ws = ytd.CopyTo(wb, sheet);
                made.Add(sheet);

                // Unmerge everything first so the column delete never has to split a merged block,
                // then merge back what is left: the title rows across the new width, the club
                // heading, and this category's own heading blocks shifted left.
                foreach (var m in ws.MergedRanges.ToList()) m.Unmerge();
                if (last < lastCol) ws.Columns(last + 1, lastCol).Delete();
                if (first > 2) ws.Columns(2, first - 1).Delete();
                int shift = first - 2, width = 1 + (last - first + 1);
                foreach (var (r1, c1, r2, c2) in mergedAll)
                {
                    if (headRow > 0 && r1 < headRow) ws.Range(r1, 1, r2, width).Merge();
                    else if (c1 == 1 && c2 == 1) ws.Range(r1, 1, r2, 1).Merge();
                    else if (c1 >= first && c2 <= last) ws.Range(r1, c1 - shift, r2, c2 - shift).Merge();
                }
            }
        }
        catch
        {
            // Fall back to one empty sheet — drop any half-built sheets first so the names are free.
            foreach (var n in made) if (wb.Worksheets.TryGetWorksheet(n, out var partial)) partial.Delete();
            Empty();
        }
    }

    // Summary sheet — navy title band, section bars, label/value rows and small tables.
    private static void BuildSummarySheet(XLWorkbook wb, DistrictPerformanceReportResult r)
    {
        var navy = XLColor.FromHtml("#1a365d");
        var blue = XLColor.FromHtml("#2d7fc7");
        var labelBg = XLColor.FromHtml("#f1f5f9");
        var border = XLColor.FromHtml("#cbd5e1");
        // Wide enough for the widest table in the report — anything narrower silently dropped columns.
        int cols = Math.Max(5, r.Sections.Max(x => x.TableHeaders?.Count ?? 0));

        var ws = wb.Worksheets.Add("Summary");
        ws.Column(1).Width = 44;
        ws.Column(2).Width = 34;
        for (int i = 3; i <= cols; i++) ws.Column(i).Width = 18;
        int row = 1;

        void Band(string text, double size, XLColor fg, XLColor bg, bool bold, double height, bool italic = false)
        {
            ws.Range(row, 1, row, cols).Merge();
            var c = ws.Cell(row, 1);
            c.Value = text;
            c.Style.Font.FontSize = size;
            c.Style.Font.Bold = bold;
            c.Style.Font.Italic = italic;
            c.Style.Font.FontColor = fg;
            c.Style.Fill.BackgroundColor = bg;
            c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            c.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(row).Height = height;
            row++;
        }
        Band($"{r.ReportKicker} — {r.ReportTitle}", 18, XLColor.White, navy, true, 34);
        Band(r.ReportSubtitle, 10, XLColor.FromHtml("#475569"), XLColor.FromHtml("#eef2f7"), false, 20);
        if (!string.IsNullOrWhiteSpace(r.GovernorName))
            Band($"District Governor: {r.GovernorName}{(r.GovernorEmail != null ? "  ·  " + r.GovernorEmail : "")}{(!string.IsNullOrWhiteSpace(r.GovernorMobile) ? "  ·  " + r.GovernorMobile : "")}",
                10, XLColor.FromHtml("#475569"), XLColor.FromHtml("#eef2f7"), false, 18);
        Band($"Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", 8, XLColor.FromHtml("#94a3b8"), XLColor.White, false, 14, italic: true);
        row++;

        // At a glance — the same six headline tiles as the email, as label · value · detail rows.
        if (r.Highlights.Count > 0)
        {
            ws.Range(row, 1, row, cols).Merge();
            var ag = ws.Cell(row, 1);
            ag.Value = "At a Glance";
            ag.Style.Font.Bold = true;
            ag.Style.Font.FontColor = XLColor.White;
            ag.Style.Fill.BackgroundColor = navy;
            ws.Row(row).Height = 22;
            row++;
            string? lastGroup = null;
            foreach (var h in r.Highlights)
            {
                if (h.Group != null && h.Group != lastGroup)
                {
                    lastGroup = h.Group;
                    ws.Range(row, 1, row, cols).Merge();
                    var gh = ws.Cell(row, 1);
                    gh.Value = h.Group;
                    gh.Style.Font.Bold = true;
                    gh.Style.Font.FontColor = XLColor.White;
                    gh.Style.Fill.BackgroundColor = blue;
                    row++;
                }
                var k = ws.Cell(row, 1); k.Value = h.Label;
                k.Style.Font.Bold = true; k.Style.Fill.BackgroundColor = labelBg; k.Style.Font.FontColor = XLColor.FromHtml("#334155");
                var v = ws.Cell(row, 2); v.Value = h.Value;
                v.Style.Font.Bold = true; v.Style.Font.FontSize = 13;
                v.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                v.Style.Font.FontColor = h.Percent.HasValue ? XLColor.FromHtml(RagColor(h.Percent.Value)) : navy;
                ws.Range(row, 3, row, cols).Merge();
                var d = ws.Cell(row, 3); d.Value = h.Sub ?? "";
                d.Style.Font.FontColor = XLColor.FromHtml("#64748b");
                var rng = ws.Range(row, 1, row, cols);
                rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                rng.Style.Border.OutsideBorderColor = border;
                row++;
            }
            if (!string.IsNullOrWhiteSpace(r.ScopeNote))
            {
                ws.Range(row, 1, row, cols).Merge();
                var sn = ws.Cell(row, 1);
                sn.Value = r.ScopeNote;
                sn.Style.Font.FontSize = 10;
                sn.Style.Font.FontColor = XLColor.FromHtml("#334155");
                sn.Style.Alignment.WrapText = true;
                ws.Row(row).Height = 26;
                row++;
            }
            row++;
        }

        string? lastPart = null;
        int partNo = 0;
        foreach (var s in r.Sections)
        {
            if (!string.IsNullOrEmpty(s.Part) && s.Part != lastPart)
            {
                lastPart = s.Part;
                partNo++;
                row++;
                ws.Range(row, 1, row, cols).Merge();
                var pb = ws.Cell(row, 1);
                pb.Value = $"PART {partNo} — {s.Part}{(string.IsNullOrWhiteSpace(s.PartSubtitle) ? "" : "   ·   " + s.PartSubtitle)}";
                pb.Style.Font.Bold = true;
                pb.Style.Font.FontSize = 14;
                pb.Style.Font.FontColor = XLColor.White;
                pb.Style.Fill.BackgroundColor = navy;
                pb.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
                ws.Row(row).Height = 28;
                row += 2;
            }
            ws.Range(row, 1, row, cols).Merge();
            var t = ws.Cell(row, 1);
            t.Value = s.Title;
            t.Style.Font.Bold = true;
            t.Style.Font.FontColor = XLColor.White;
            t.Style.Fill.BackgroundColor = blue;
            ws.Row(row).Height = 22;
            row++;
            if (!string.IsNullOrWhiteSpace(s.Intro))
            {
                ws.Range(row, 1, row, cols).Merge();
                var si = ws.Cell(row, 1);
                si.Value = s.Intro; si.Style.Font.Italic = true; si.Style.Font.FontSize = 10;
                si.Style.Font.FontColor = XLColor.FromHtml("#334155");
                row++;
            }

            foreach (var it in s.Items)
            {
                var k = ws.Cell(row, 1); k.Value = it.Label;
                k.Style.Font.Bold = true; k.Style.Font.FontColor = XLColor.FromHtml("#334155"); k.Style.Fill.BackgroundColor = labelBg;
                var v = ws.Cell(row, 2); v.Value = it.Value;
                v.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                LinkCell(v, it.Url);
                var rng = ws.Range(row, 1, row, 2);
                rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                rng.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                rng.Style.Border.OutsideBorderColor = border;
                rng.Style.Border.InsideBorderColor = border;
                row++;
            }

            if (s.TableHeaders != null && s.TableRows != null && s.TableRows.Count > 0)
            {
                int tcols = s.TableHeaders.Count;
                int headRow = row;
                for (int c = 0; c < tcols; c++)
                {
                    var hc = ws.Cell(row, c + 1);
                    hc.Value = s.TableHeaders[c];
                    hc.Style.Font.Bold = true;
                    hc.Style.Fill.BackgroundColor = XLColor.FromHtml("#e2e8f0");
                    hc.Style.Alignment.WrapText = true;
                }
                row++;
                foreach (var tr in s.TableRows)
                {
                    for (int c = 0; c < tcols && c < tr.Count; c++)
                    {
                        var dc = ws.Cell(row, c + 1);
                        dc.Value = tr[c];
                        dc.Style.Alignment.WrapText = true;
                        dc.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                        bool rankTable = s.TableHeaders[0] == "#";
                        if (c >= 1 && !(rankTable && c == 1)) dc.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                        StyleFigureCell(dc, s.TableHeaders[c], tr[c], c);
                    }
                    row++;
                }
                var block = ws.Range(headRow, 1, row - 1, tcols);
                block.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                block.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                block.Style.Border.OutsideBorderColor = border;
                block.Style.Border.InsideBorderColor = XLColor.FromHtml("#e2e8f0");
            }

            if (!string.IsNullOrWhiteSpace(s.Note))
            {
                ws.Range(row, 1, row, cols).Merge();
                var n = ws.Cell(row, 1);
                n.Value = s.Note;
                n.Style.Font.Italic = true;
                n.Style.Font.FontSize = 10;
                n.Style.Font.FontColor = XLColor.FromHtml("#334155");
                row++;
            }
            row++;
        }
        ws.SheetView.FreezeRows(3);
    }
}
