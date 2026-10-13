namespace RotaryApi.DTOs;

// AG Dashboard DTOs — shared by web and mobile.
// Field names are camelCase per Program.cs JsonNamingPolicy.CamelCase.

public class AgClubSummaryDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string PresidentName { get; set; } = "";
    public string SecretaryName { get; set; } = "";
    // Rotary.org sync flag + club-website state ('active' | 'expired' | 'none').
    // Same definitions as GlobalSearchController so the screens agree.
    public bool IsSyncedFromRotaryOrg { get; set; }
    public string ClubWebsiteStatus { get; set; } = "none";
    // Raw stored subdomain — the frontend cleans it into a URL (some rows hold
    // junk like "https//rcthanehills/"). Null when the club has no site.
    public string? ClubWebsiteSubdomain { get; set; }
    public int Members { get; set; }
    // Club Service entries the club filed this year (user 2026-09-29). This was `Meetings` = rows in
    // club_attendance - the attendance register, not what a club files under Club Service. Same source
    // as the District view and the Club Monthly Report, so every screen agrees.
    public int ClubService { get; set; }
    public int TotalProjects { get; set; }
    public int ProjectRank { get; set; }
    public decimal TrfTotalInr { get; set; }
    public decimal TrfTotalUsd { get; set; }
    public int Ocv { get; set; }
    // Wave 12A: national rank reserved — data source not finalised yet. Always
    // null with `nationalRankIsPending = true` until a source is decided.
    public int? NationalRank { get; set; }
    public bool NationalRankIsPending { get; set; } = true;
}

public class AgIdentityDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string YearLabel { get; set; } = "";
}

public class AgClubsResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgClubSummaryDto> Clubs { get; set; } = new();
    public int TotalMembers { get; set; }
    public int TotalClubService { get; set; }
    public int TotalProjects { get; set; }
    public decimal TotalTrfInr { get; set; }
    public int TotalClubsInDistrict { get; set; }
}

public class AgClubDetailResponse
{
    public AgClubSummaryDto Summary { get; set; } = new();
    public List<AgMonthlyPointDto> Monthly { get; set; } = new();
    public AgTrfBreakdownDto Trf { get; set; } = new();
    public List<AgProjectRowDto> RecentProjects { get; set; } = new();
}

public class AgMonthlyPointDto
{
    public string Month { get; set; } = ""; // "Jul 2025"
    // Club Service entries filed in that month - was `Meetings` = rows in club_attendance, the
    // attendance register (user 2026-10-01, same rule as AgClubSummaryDto.ClubService). The whole
    // AG module now reads one definition of Club Service.
    public int ClubService { get; set; }
    public int Projects { get; set; }
    public decimal TrfInr { get; set; }
}

public class AgTrfBreakdownDto
{
    public decimal AnnualInr { get; set; }
    public decimal PolioInr { get; set; }
    public decimal Endowment { get; set; }
    public decimal Others { get; set; }
    public decimal TotalInr { get; set; }
    public decimal TotalUsd { get; set; }
}

public class AgClubTrfDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public AgTrfBreakdownDto Trf { get; set; } = new();
    // Wave 12A: percentage of the AG total TRF contributed by this club
    // (computed in service: clubTrfInr / agTotalTrfInr * 100, rounded to 1dp).
    public decimal PercentOfAgTotal { get; set; }
}

public class AgTrfResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgClubTrfDto> Clubs { get; set; } = new();
    public AgTrfBreakdownDto Totals { get; set; } = new();
}

public class AgMembershipClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public int ClubService { get; set; }   // was Meetings (club_attendance) - user 2026-09-29
    public int TotalProjects { get; set; }
    public int ProjectRank { get; set; }
    public decimal Trf { get; set; }
    public int Ocv { get; set; }
    public int Beneficiaries { get; set; }
    // Wave 12A: number of citation goals "achieved" (points_earned > 0)
    // from district_citation_club_entry — represents goals the club has met.
    public int GoalsCitations { get; set; }
}

public class AgMembershipResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgMembershipClubRowDto> Clubs { get; set; } = new();
    public int TotalMembers { get; set; }
    public int TotalClubService { get; set; }
    public int TotalProjects { get; set; }
    public decimal TotalTrfInr { get; set; }
    public int TotalOcv { get; set; }
    public int TotalClubsInDistrict { get; set; }
    public int TotalBeneficiaries { get; set; }
}

public class AgYouthClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int NewGenerationService { get; set; }
    public int VocationalService { get; set; }
    public int InternationalService { get; set; }
    public int TotalProjects { get; set; }
    public int Members { get; set; }
    public int Meetings { get; set; }
}

public class AgYouthResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgYouthClubRowDto> Clubs { get; set; } = new();
    public int TotalNewGeneration { get; set; }
    public int TotalVocational { get; set; }
    public int TotalInternational { get; set; }
    public int TotalProjects { get; set; }
}

public class AgProjectRowDto
{
    // Identity for the detail drill-down. ProjectId is only unique WITHIN its year
    // table (rotary_projects_YYYY_YY), so YearId must travel with it.
    public int ProjectId { get; set; }
    public int YearId { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    // Service avenue = module_master.ModuleName via rotary_projects.fk_module_id
    // (Community / Vocational / International / New Generations / Public Image / Club Service).
    public string? Avenue { get; set; }
    public string? Category { get; set; }
    public string? AreaOfFocus { get; set; }
    public string? Date { get; set; }
    public decimal Cost { get; set; }
    public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency; // project's own currency — row shows Cost in this
    public int Beneficiaries { get; set; }
    public int ManHours { get; set; }
    public string Funding { get; set; } = "";
    public int Rotarians { get; set; }
    // Wave 12A: true when the year table doesn't expose a `man_hours` column yet
    // (pre-Wave-13A3 schema). Once the column ships, real values flow through
    // and the flag flips to false.
    public bool ManHoursIsPending { get; set; }
    // Approval workflow status. Null for Club Service / non-approval avenues;
    // 'pending' / 'approved' / 'rejected' for the 5 approval avenues
    // (community, vocational, international, new-generations, public-image).
    public string? ApprovalStatus { get; set; }
}

public class AgProjectsResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgProjectRowDto> Projects { get; set; } = new();
    public Dictionary<string, int> ClubProjectCounts { get; set; } = new(); // clubName -> count
    public Dictionary<string, int> MonthlyProjectCounts { get; set; } = new(); // "Jul 2025" -> count
    public Dictionary<string, int> CategoryCounts { get; set; } = new();
    public int TotalProjects { get; set; }
    public int TotalBeneficiaries { get; set; }
    public int TotalManHours { get; set; }
    public decimal TotalCost { get; set; }
    public string TargetCurrency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency; // currency of TotalCost (district default)
}

public class AgCitationClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public decimal Total { get; set; }
    public decimal Membership { get; set; }
    public decimal Trf { get; set; }
    public decimal Service { get; set; }
    public decimal PublicImage { get; set; }
    public decimal Youth { get; set; }
    public decimal Foundation { get; set; }
}

public class AgGoalsClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public decimal MembershipGrowth { get; set; } // %
    public decimal TrfPerCapita { get; set; } // INR
    public int ServiceProjects { get; set; }
    public decimal MeetingAttendance { get; set; } // %
    public decimal MyRotary { get; set; } // %
    public int NewMembers { get; set; }
    // Wave 12A: true when `club_myrotary_tracking` table (or row) doesn't exist
    // yet for this club/year (pre-Wave-13A3 schema). In that case MyRotary is 0
    // and the UI should render an em-dash. After Wave 13A3 ships and rows are
    // populated, the flag flips to false and real percentages flow through.
    public bool MyRotaryIsPending { get; set; }
}

// Wave 12A: Award-status row for the AG Excellence screen. One row per club.
// Each "*Status" string is one of: "achieved", "on-track", "behind", or
// "pending" when the underlying `club_award_status` table doesn't have a row
// for this club/year yet.
public class AgAwardStatusDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public bool OnTrack { get; set; }
    public bool Achieved { get; set; }
    public string PresidentialCitation { get; set; } = "pending";
    public string DistrictCitation { get; set; } = "pending";
    public string MembershipExcellence { get; set; } = "pending";
    // True when no row exists in club_award_status for this club/year.
    public bool IsPending { get; set; } = true;
}

// Wave 12A: One row of the Head-to-Head comparison table (District View).
// All metrics scoped to the AG's assigned clubs only.
public class AgHeadToHeadRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public int Meetings { get; set; }
    public int ClubService { get; set; }
    public int TotalProjects { get; set; }
    public decimal TrfInr { get; set; }
    public decimal Dck { get; set; } // citation total (District Club Karma)
    public int? NationalRank { get; set; }
    public bool NationalRankIsPending { get; set; } = true;
    public int VocationalService { get; set; }
    public int InternationalService { get; set; }
    public int NewGenerationService { get; set; }
}

// Wave 12A: Structured per-metric bar series for the four district bar charts.
// Each dictionary maps clubName -> value.
public class AgMetricBarsDto
{
    public Dictionary<string, int> MembersPerClub { get; set; } = new();
    public Dictionary<string, int> ProjectsPerClub { get; set; } = new();
    public Dictionary<string, decimal> TrfPerClub { get; set; } = new();
    public Dictionary<string, int> MeetingsPerClub { get; set; } = new();
    public Dictionary<string, int> ClubServicePerClub { get; set; } = new();
}

// Wave 12A: One point on the radar chart (4-axis: members, projects, trf, goals).
public class AgRadarPointDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public int Projects { get; set; }
    public decimal TrfInr { get; set; }
    public decimal GoalsScore { get; set; }
}

public class AgMonthlyTrackingPointDto
{
    public string Month { get; set; } = "";
    public Dictionary<string, decimal> ByClub { get; set; } = new(); // clubName -> value
}

public class AgExcellenceResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgCitationClubRowDto> Citation { get; set; } = new();
    public List<AgGoalsClubRowDto> Goals { get; set; } = new();
    public List<AgMonthlyTrackingPointDto> MonthlyProjects { get; set; } = new();
    public List<AgMonthlyTrackingPointDto> MonthlyMeetings { get; set; } = new();
    public List<AgMonthlyTrackingPointDto> MonthlyTrf { get; set; } = new();
    public decimal AverageCitationScore { get; set; }
    public AgCitationClubRowDto? TopScoringClub { get; set; }
    // Wave 12A: per-club award status. Empty list with each row's IsPending=true
    // when the club_award_status table is missing or unpopulated. After
    // Wave 13A3 lands the table, real status values flow through.
    public List<AgAwardStatusDto> AwardStatus { get; set; } = new();
    // True when the club_award_status table itself doesn't exist yet, so the
    // entire AwardStatus list is empty and the UI should render placeholders.
    public bool AwardStatusIsPending { get; set; }
}

public class AgDistrictClubRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public int Meetings { get; set; }
    public int ClubService { get; set; }
    public int TotalProjects { get; set; }
    public decimal TrfTotalInr { get; set; }
    public int Ocv { get; set; }
    public int ProjectRank { get; set; }
    public int VocationalService { get; set; }
    public int InternationalService { get; set; }
    public int NewGenerationService { get; set; }
}

public class AgDistrictResponse
{
    public AgIdentityDto Ag { get; set; } = new();
    public List<AgDistrictClubRowDto> Clubs { get; set; } = new();
    public int TotalMembers { get; set; }
    public int TotalMeetings { get; set; }
    // Club Service entries filed by the club (module club_service), NOT the attendance
    // register - the District view compares this (user 2026-09-24).
    public int TotalClubService { get; set; }
    public int TotalProjects { get; set; }
    public decimal TotalTrfInr { get; set; }
    // Wave 12A: Head-to-head comparison rows scoped to the AG's assigned clubs.
    public List<AgHeadToHeadRowDto> HeadToHeadTable { get; set; } = new();
    // Wave 12A: Structured per-metric bars (4 charts).
    public AgMetricBarsDto MetricBars { get; set; } = new();
    // Wave 12A: Radar chart points — one per club with 4 axes
    // (members, projects, trf, goals).
    public List<AgRadarPointDto> Radar { get; set; } = new();
}

// ── Available years (global topbar year picker) ──────────────────────────────
// Years where the AG's OWN clubs have data — never the whole district's years.
// An AG assigned 10 of a district's 100 clubs must only see years those 10 have.
public class AgYearOptionDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsCurrent { get; set; }
}

public class AgAvailableYearsResponse
{
    public int? CurrentYearId { get; set; }
    public string CurrentYearLabel { get; set; } = "";
    public List<AgYearOptionDto> Years { get; set; } = new();
}

// ── AG project detail (popup) ────────────────────────────────────────────────
// Fetched on demand for ONE project rather than shipped with the list — photos and
// long text would bloat a several-hundred-row payload for data that's only read when
// a row is opened.
public class AgProjectPhotoDto
{
    public string Url { get; set; } = "";
    public string? Description { get; set; }
    public bool IsPrimary { get; set; }
}

public class AgProjectDetailDto
{
    public int ProjectId { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";

    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }

    public string? Avenue { get; set; }
    public string? AreaOfFocus { get; set; }
    public string? Category { get; set; }
    public string? SubCategory { get; set; }

    public string? Date { get; set; }
    public decimal Cost { get; set; }
    public string Funding { get; set; } = "";
    public int Beneficiaries { get; set; }
    public int ManHours { get; set; }
    public bool ManHoursIsPending { get; set; }
    public int RotariansInvolved { get; set; }
    public int RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int RccInvolved { get; set; }

    public string? ProjectType { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? ClubRole { get; set; }
    public string? ApprovalStatus { get; set; }

    public List<AgProjectPhotoDto> Photos { get; set; } = new();
}
