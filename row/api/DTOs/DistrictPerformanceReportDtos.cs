namespace RotaryApi.DTOs;

// ── District Performance Report (DG progress report) ─────────────────────────────────────────────
// One district, current Rotary year till date. Counts go in the email body / on-screen view; the
// listings go in the .xlsx attachment. The same Sections drive the email, the Summary sheet and the
// settings screen, so all three always show identical numbers.

public sealed class DistrictPerformanceReportResult
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string ZoneName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string PeriodLabel { get; set; } = "";          // "01 Jul 2026 – 17 Sep 2026"
    public string? GovernorName { get; set; }
    public string? GovernorEmail { get; set; }
    public string? GovernorMobile { get; set; }
    public string Subject { get; set; } = "";
    public string FileName { get; set; } = "";
    // Heading / wording, so the same email + Summary renderer serves the District report and the
    // RI Director (all zones) report.
    public string ReportKicker { get; set; } = "District Performance Report";
    public string ReportTitle { get; set; } = "";
    public string ReportSubtitle { get; set; } = "";
    public string Salutation { get; set; } = "";
    public string IntroLine { get; set; } = "";
    public string ClosingLine { get; set; } = "";
    public string AttachmentNote { get; set; } = "";
    // Numeric headline figures of one district — used to build the RI Director (all zones) report.
    [System.Text.Json.Serialization.JsonIgnore]
    public DistrictPerformanceKpi? Kpi { get; set; }
    // RI Director report only: every district's own report, used for the "All Districts" sheet.
    [System.Text.Json.Serialization.JsonIgnore]
    public List<DistrictPerformanceReportResult>? DistrictReports { get; set; }
    // "At a glance" tiles shown first (email, screen, top of the Summary sheet).
    public List<PerformanceReportHighlight> Highlights { get; set; } = new();
    // Tiles per row in the email: 4 on the District report (two rows of four), 3 on the RI Director report.
    [System.Text.Json.Serialization.JsonIgnore]
    public int TilesPerRow { get; set; } = 3;
    // Plain one-line note printed right under the tiles — says the counts cover synced clubs only.
    public string? ScopeNote { get; set; }
    public List<PerformanceReportSection> Sections { get; set; } = new();
    // Only filled when the attachment was requested (download / send) — the on-screen view skips the
    // heavy all-clubs goal workbook so it stays quick.
    public byte[]? Excel { get; set; }
    public string? Html { get; set; }
}

public sealed class PerformanceReportSection
{
    // Report part this section belongs to ("District 3142" / "Clubs of District 3142"). A new part starts a
    // large heading band in the email, the Summary sheet and the screen.
    public string Part { get; set; } = "";
    public string? PartSubtitle { get; set; }
    public string Title { get; set; } = "";
    // Optional small line under the title, before the figures (e.g. where the rest of the goals live).
    public string? Intro { get; set; }
    public List<PerformanceReportItem> Items { get; set; } = new();
    // Optional small table (Goal Setting per category, top-5 lists). Values are pre-formatted text.
    public List<string>? TableHeaders { get; set; }
    public List<List<string>>? TableRows { get; set; }
    public string? Note { get; set; }
}

public sealed class DistrictPerformanceKpi
{
    public string ZoneName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string? GovernorName { get; set; }
    public long Clubs { get; set; }                  // active = synced with Rotary.org
    public long NonSyncedClubs { get; set; }         // shown beside the club count
    // Club COUNT = synced + non-synced, to match Rotary.org (user 2026-09-28). Member counts stay synced-only.
    public long AllClubs => Clubs + NonSyncedClubs;
    public long Members { get; set; }                // honorary members are never counted
    public long Women { get; set; }
    public long Youth { get; set; }
    public long Joined { get; set; }
    public long Left { get; set; }
    public long ClubProjects { get; set; }
    public long DistrictProjects { get; set; }      // district's own projects + events
    public long Beneficiaries { get; set; }
    public long VolunteerHours { get; set; }
    public long CmrSubmitted { get; set; }
    public long CmrDue { get; set; }                 // submitted + saved + not started, completed months
    public decimal AwardPoints { get; set; }
    public long ClubService { get; set; }
    // Service project counts per avenue, keyed by the avenue label.
    public Dictionary<string, long> Avenues { get; set; } = new(StringComparer.Ordinal);
    // TRF achieved per fund, keyed by the Goal Setting metric name (Total Giving, Annual Fund …).
    public Dictionary<string, decimal> Foundation { get; set; } = new(StringComparer.Ordinal);
    public string? TrfAsOn { get; set; }             // "31 Aug 2026" — the month the TRF figures are as on
    public decimal? MembershipTarget { get; set; }   // "Total Members" goal
    public decimal? MembershipAchieved { get; set; }
    public decimal? MembershipPct { get; set; }
    public decimal? TrfTarget { get; set; }          // "Total Giving" goal
    public decimal? TrfAchieved { get; set; }
    public decimal? TrfPct { get; set; }
}

public sealed class PerformanceReportHighlight
{
    // Tiles are shown under their group heading ("Membership", "Foundation (as on 31 Aug 2026)" …).
    // Null = one unnamed group, i.e. the plain "At a glance" row the district report uses.
    public string? Group { get; set; }
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
    public string? Sub { get; set; }
    // Set for percentage tiles → coloured red / amber / green by progress. Null = neutral tile.
    public decimal? Percent { get; set; }
    // True = this tile starts a new row (email + screen), even if the row above is not full.
    public bool NewRow { get; set; }
}

public sealed class PerformanceReportItem
{
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
    // Set when the value is a website — rendered as a clickable link (email, screen, Excel).
    public string? Url { get; set; }
    public PerformanceReportItem() { }
    public PerformanceReportItem(string label, string value) { Label = label; Value = value; }
}

// ── Settings screen ──────────────────────────────────────────────────────────────────────────────
public sealed class PerformanceReportDistrictOption
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string? ZoneName { get; set; }
}

public sealed class PerformanceReportLogRow
{
    public long Id { get; set; }
    public string? DistrictNumber { get; set; }
    public string RunType { get; set; } = "";
    public string? ToEmail { get; set; }
    public string? CcEmails { get; set; }
    public string Status { get; set; } = "";
    public string? Message { get; set; }
    public DateTime CreatedDate { get; set; }
}

public sealed class PerformanceReportSettingsDto
{
    public bool ScheduleEnabled { get; set; }
    public string Mode { get; set; } = "Test";        // Test | Live
    public int Hour { get; set; }
    public List<string> TestDistricts { get; set; } = new();
    public List<string> TestRecipients { get; set; } = new();
    public List<string> LiveCc { get; set; } = new();
    public List<int> LiveDays { get; set; } = new();
    public List<PerformanceReportLogRow> RecentRuns { get; set; } = new();
}

// ── Goal Setting data handed to the report by GoalSettingService (system call, no caller scope) ──
public sealed class DistrictPerformanceGoalMetric
{
    public string Category { get; set; } = "";
    public string Metric { get; set; } = "";
    // Membership: the "as on July 1st" figure. TRF: the fund's "Highest" (reference only). Null otherwise.
    public decimal? Baseline { get; set; }
    public decimal? Target { get; set; }
    public decimal? Achieved { get; set; }
    public decimal? Pct { get; set; }
    public string? DisplayText { get; set; }   // Public Image Yes/No / Suggestions text
    public bool SingleValue { get; set; }      // one value, no Target/Achieved/% (Youth Service / Public Image)
}

public sealed class DistrictPerformanceGoalData
{
    public List<DistrictPerformanceGoalMetric> DistrictMetrics { get; set; } = new();
    // Category name → "31 Aug 2026" (latest month with month-wise data), same as the Goal Setting form's
    // "Achieved (as on …)". Missing = no month-wise data yet.
    public Dictionary<string, string> AchievedAsOn { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public byte[]? DistrictWorkbook { get; set; }   // the district's own Goal Setting report (YTD + Month wise)
    public byte[]? ClubsWorkbook { get; set; }      // the all-clubs Goal Setting report (YTD + Month wise)
}
