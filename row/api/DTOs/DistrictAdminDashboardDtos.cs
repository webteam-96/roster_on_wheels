namespace RotaryApi.DTOs;

public class DistrictAdminIdentityDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string YearLabel { get; set; } = "";
    public int TotalClubs { get; set; }
}

public class DistrictAdminClubStat
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public int Meetings { get; set; }
    public int Projects { get; set; }
    public decimal TrfInr { get; set; }
}

// Membership goal panel (read from district_membership_goal — Wave 13A3).
// IsPending=true means the goal table is not yet populated for this district/year;
// frontend renders a "Pending" chip until data arrives.
public class DistrictAdminMembershipGoalPanel
{
    public int Current { get; set; }
    public int? Target { get; set; }
    public int Delta { get; set; }
    public bool IsPending { get; set; }
    public List<DistrictAdminClubStat> TopClubs { get; set; } = new();
}

// TRF goal panel — overall percent + per-fund breakdown.
public class DistrictAdminTrfGoalPanel
{
    public decimal? TotalTargetInr { get; set; }
    public decimal RaisedInr { get; set; }
    public decimal RemainingInr { get; set; }
    public decimal PercentAchieved { get; set; }
    public bool IsPending { get; set; }
    public decimal AnnualFundInr { get; set; }
    public decimal PolioFundInr { get; set; }
    public decimal EndowmentInr { get; set; }
    public decimal OthersInr { get; set; }
    public decimal? AnnualTargetInr { get; set; }
    public decimal? PolioTargetInr { get; set; }
    public decimal? EndowmentTargetInr { get; set; }
    public decimal? OthersTargetInr { get; set; }
}

// Service Projects panel — per-avenue counts + targets.
public class DistrictAdminServiceAvenuePanelRow
{
    public string AvenueKey { get; set; } = "";  // community / vocational / international / public_image / new_generation
    public string AvenueName { get; set; } = "";
    public int Completed { get; set; }
    public int? Target { get; set; }
    public decimal PercentAchieved { get; set; }
    public bool IsPending { get; set; }
}

public class DistrictAdminServiceProjectsPanel
{
    // TotalProjects counts the 5 service avenues ONLY (Club Services / meetings excluded).
    public int TotalProjects { get; set; }
    // Club Services (club meetings) count — shown separately, not part of TotalProjects.
    public int ClubServicesCount { get; set; }
    public int? TotalTarget { get; set; }
    public bool IsPending { get; set; }
    public List<DistrictAdminServiceAvenuePanelRow> Avenues { get; set; } = new();
}

// District Awards donut breakdown by category.
public class DistrictAdminCitationCategoryRow
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int PointsEarned { get; set; }
    public int QualifiedClubs { get; set; }
    // Wave 13A4 additions — per-category club-level completion buckets
    // so the Overview donut card can show a Complete / Partial / Incomplete
    // status chip alongside the total points.
    public int MaxPoints { get; set; }
    public int CompleteClubs { get; set; }
    public int PartialClubs { get; set; }
    public int IncompleteClubs { get; set; }
    public string Status { get; set; } = "";  // complete | partial | incomplete
}

public class DistrictAdminCitationPanel
{
    public int TotalPoints { get; set; }
    public int QualifiedClubs { get; set; }
    public List<DistrictAdminCitationCategoryRow> Categories { get; set; } = new();
}

// Club leaderboard row — ranked purely by District Awards points.
public class DistrictAdminClubLeaderboardRow
{
    public int Rank { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Members { get; set; }
    public decimal TrfInr { get; set; }
    public int Projects { get; set; }
    public int CitationScore { get; set; }
    public int Score { get; set; }
    // Wave 13A4 — percentile of Score within the district (0..100), used
    // by the new leaderboard UI ("Mulund East · 93%").
    public decimal Percentile { get; set; }
}

public class DistrictAdminOverviewResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int TotalClubs { get; set; }
    public int ActiveClubs { get; set; }
    public int TotalMembers { get; set; }
    public int NewMembersThisYear { get; set; }
    public int TerminatedThisYear { get; set; }
    public int TotalProjects { get; set; }
    public int TotalMeetings { get; set; }
    public decimal AvgAttendance { get; set; }
    public decimal TrfTotalInr { get; set; }
    public decimal DistrictCitationScore { get; set; }
    public int Announcements { get; set; }
    public int Newsletters { get; set; }
    public int UpcomingEvents { get; set; }
    public List<DistrictAdminClubStat> TopClubsByMembers { get; set; } = new();
    public List<DistrictAdminClubStat> TopClubsByTrf { get; set; } = new();
    public List<DistrictAdminClubStat> TopClubsByProjects { get; set; } = new();

    // ── new Wave 13A2 fields (additive) ─────────────────────────────────
    public int QualifiedCitationClubs { get; set; }
    public DistrictAdminMembershipGoalPanel MembershipGoal { get; set; } = new();
    public DistrictAdminTrfGoalPanel TrfGoal { get; set; } = new();
    public DistrictAdminServiceProjectsPanel ServiceProjects { get; set; } = new();
    public DistrictAdminCitationPanel Citation { get; set; } = new();
    public List<DistrictAdminClubStat> Top20ClubsByMembers { get; set; } = new();
    public List<DistrictAdminClubLeaderboardRow> ClubLeaderboard { get; set; } = new();

    // ── Wave 13A4: overview UI extensions (new design) ──────────────────
    // Gender / status breakdown used by the redesigned Membership card.
    // Active = club_members.IsActive=1 (already reflected in TotalMembers).
    // Inactive = club_members rows with IsActive=0 (still exists, not deleted).
    public int MaleMembers { get; set; }
    public int FemaleMembers { get; set; }
    public int HonoraryMembers { get; set; }
    public int InactiveMembers { get; set; }
    // PHF / Major-Donor counts feed the redesigned TRF Goal card. Same
    // definitions as the Foundation page — count of distinct DonorName in
    // trf_contributions for the year (PHF = any amount, Major = >= $1000).
    public int PhfMembers { get; set; }
    public int MajorDonors { get; set; }

    // Dynamic per-fund-type breakdown for the "TRF Contribution" panel.
    // Fund names come from trf_fund_master (admin-managed via the club TRF
    // Settings dialog), plus "Others" for rows where fk_fund_id maps to
    // the Others master fund — those carry their free-text label in
    // trf_contributions.OtherFundName. Amounts are aggregated across every
    // club in the district for the selected year and returned in USD (TRF is stored in USD).
    public List<DistrictAdminFundBreakdownRow> FundTypeBreakdown { get; set; } = new();
}

public class DistrictAdminFundBreakdownRow
{
    public string FundName { get; set; } = "";
    public decimal AmountInr { get; set; }
}

public class DistrictAdminMemberStat
{
    public string Label { get; set; } = "";
    public int Count { get; set; }
}

// One row per "tab" on Membership page: Directors / DistrictCommittee /
// AssistantGovernors / Clubs. Each shows count + active + participation %.
public class DistrictAdminMembershipTabCount
{
    public string TabKey { get; set; } = "";   // directors | district_committee | ag | clubs
    public string TabLabel { get; set; } = "";
    public int Total { get; set; }
    public int Active { get; set; }
    public decimal ParticipationPercent { get; set; }
}

public class DistrictAdminMembershipResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int TotalMembers { get; set; }
    public int MaleMembers { get; set; }
    public int FemaleMembers { get; set; }
    public int HonoraryMembers { get; set; }
    public int NewMembersThisYear { get; set; }
    public int TerminatedThisYear { get; set; }
    public List<DistrictAdminClubStat> ClubBreakdown { get; set; } = new();
    public List<DistrictAdminMemberStat> AgeGroups { get; set; } = new();
    public List<ClubAdminMemberGrowthPoint> MonthlyTrend { get; set; } = new();

    // ── new Wave 13A2 fields (additive) ─────────────────────────────────
    public int ActiveMembers { get; set; }
    public DistrictAdminMembershipGoalPanel MembershipGoal { get; set; } = new();
    public List<DistrictAdminMembershipTabCount> TabCounts { get; set; } = new();
}

// Paginated directory item — used by GetMembershipDirectoryAsync.
public class DistrictAdminDirectoryMemberRow
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string? PhotoPath { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? RotaryId { get; set; }
    public string? Gender { get; set; }
    public string? ClubName { get; set; }
    public int? ClubId { get; set; }
    public string Role { get; set; } = "";    // Member / Admin / AG …
    public string Status { get; set; } = "";  // Active | Inactive | Honorary
    public bool IsHonorary { get; set; }
    public bool IsDistrictAdmin { get; set; }
    public bool IsClubAdmin { get; set; }
    public string? JoinedDate { get; set; }
}

public class DistrictAdminDirectoryPagedResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages { get; set; }
    public List<DistrictAdminDirectoryMemberRow> Items { get; set; } = new();
}

public class DistrictAdminFundClubRow
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public decimal AnnualFund { get; set; }
    public decimal PolioFund { get; set; }
    public decimal Endowment { get; set; }
    public decimal Others { get; set; }
    public decimal Total { get; set; }
}

// District-wide Rotary Network — same shape as the club-level row, plus which
// club each member belongs to (needed since this aggregates across every club
// in the district).
public class DistrictAdminRotaryNetworkRow
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string MemberId { get; set; } = "";
    public string MemberType { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string MiddleName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string? AdmissionDate { get; set; }
    public string? TerminationDate { get; set; }
    public string? TerminationReason { get; set; }
    public string? Status { get; set; } // "Terminated" | "Potential"
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; } // Potential members only
}

public class DistrictAdminRotaryNetworkClubOption
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
}

public class DistrictAdminRotaryNetworkResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int TotalTerminated { get; set; }
    public int TotalPotential { get; set; }
    public List<DistrictAdminRotaryNetworkRow> TerminatedMembers { get; set; } = new();
    public List<DistrictAdminRotaryNetworkRow> PotentialMembers { get; set; } = new();
    // Every active club in the district — powers the club search/filter on both tabs.
    public List<DistrictAdminRotaryNetworkClubOption> Clubs { get; set; } = new();
}

// Live Rotary.org terminated members, fanned out across every linked club in the district
// (or just one club when clubId is passed). Never persisted — display-only, same rule as
// the club-level live fetch.
public class DistrictAdminLiveTerminatedResponse
{
    public List<DistrictAdminRotaryNetworkRow> Members { get; set; } = new();
    public int ClubsQueried { get; set; }
    public int ClubsSkippedNoRotaryId { get; set; }
    public string? Warning { get; set; }
}

// Status of the server-side background job that warms rotary_org_terminated_cache for a
// whole district (DistrictRotaryRefreshJobRunner). Polled by the frontend; survives the
// browser tab that started it being closed or navigated away from.
public class DistrictRotaryRefreshJobStatusDto
{
    public int JobId { get; set; }
    public int DistrictId { get; set; }
    public string Status { get; set; } = ""; // Running | Done | Failed
    public int TotalLinkedClubs { get; set; }
    public int ClubsDone { get; set; }
    public DateTime StartedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
    public DateTime? FinishedUtc { get; set; }
    public string? Warning { get; set; }
}

public class DistrictAdminFoundationGoalPanel
{
    public decimal? TotalTargetInr { get; set; }
    public decimal? AnnualTargetInr { get; set; }
    public decimal? PolioTargetInr { get; set; }
    public decimal? EndowmentTargetInr { get; set; }
    public decimal? OthersTargetInr { get; set; }
    public bool IsPending { get; set; }
}

// One row per project-target type (read from district_project_target — Wave 13A3).
// Type matches module_master.ModuleKey (community_service, vocational_service, etc).
public class DistrictAdminProjectTargetRow
{
    public string TypeKey { get; set; } = "";
    public string TypeLabel { get; set; } = "";
    public int? Target { get; set; }
    public int Completed { get; set; }
    public decimal PercentAchieved { get; set; }
    public bool IsPending { get; set; }
}

// District event (district-level event, not club-scoped).
public class DistrictAdminDistrictEventRow
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? EventDate { get; set; }
    public string? Venue { get; set; }
    public string Status { get; set; } = ""; // Upcoming | Past | Cancelled
    public string? ClubName { get; set; }    // organizing club, if any
}

// Per-club + per-category project completion frequency.
public class DistrictAdminProjectFrequencyRow
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string Category { get; set; } = "";  // module name / category name
    public int Completed { get; set; }
}

// One row in the "All District Projects" detailed listing.
public class DistrictAdminProjectListingRow
{
    public int ProjectId { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    public string? ProjectDate { get; set; }
    public int Beneficiaries { get; set; }
    public decimal Funds { get; set; }
    public int ManHours { get; set; }
    public string? AvenueName { get; set; }
    public string? AreaOfFocus { get; set; }
}

public class DistrictAdminFoundationResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public decimal TotalInr { get; set; }
    public decimal AnnualFundInr { get; set; }
    public decimal PolioFundInr { get; set; }
    public decimal EndowmentInr { get; set; }
    public decimal OthersInr { get; set; }
    public int MajorDonors { get; set; }
    public int PhfContributors { get; set; }
    public List<DistrictAdminFundClubRow> ClubBreakdown { get; set; } = new();

    // ── new Wave 13A2 fields (additive) ─────────────────────────────────
    public DistrictAdminFoundationGoalPanel FoundationGoal { get; set; } = new();
    public List<DistrictAdminProjectTargetRow> DistrictProjectTargets { get; set; } = new();
    public List<DistrictAdminDistrictEventRow> DistrictEvents { get; set; } = new();
    public List<DistrictAdminProjectFrequencyRow> ProjectFrequency { get; set; } = new();
    public List<DistrictAdminProjectListingRow> AllProjects { get; set; } = new();
}

public class DistrictAdminCommunicationItem
{
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string? PublishDate { get; set; }
    public string? ImagePath { get; set; }
}

public class DistrictAdminGreetingItem
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string? PhotoPath { get; set; }
    public string? ClubName { get; set; }
    public string Kind { get; set; } = "";   // birthday | anniversary
    public string Date { get; set; } = "";   // MM-DD or yyyy-MM-dd
    public string Bucket { get; set; } = ""; // today | this_week | next_week
}

public class DistrictAdminDocumentItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string? PublishDate { get; set; }
    public string? FilePath { get; set; }
    public string? OriginalFileName { get; set; }
    public string AccessType { get; set; } = "";
}

public class DistrictAdminCommunicationResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int AnnouncementCount { get; set; }
    public int NewsletterCount { get; set; }
    public int UpcomingEventCount { get; set; }
    public List<DistrictAdminCommunicationItem> Announcements { get; set; } = new();
    public List<DistrictAdminCommunicationItem> Newsletters { get; set; } = new();
    public List<DistrictAdminCommunicationItem> UpcomingEvents { get; set; } = new();

    // ── new Wave 13A2 fields (additive) ─────────────────────────────────
    public int DocumentCount { get; set; }
    public int GreetingsTodayCount { get; set; }
    public List<DistrictAdminDistrictEventRow> DistrictEvents { get; set; } = new();
    public List<DistrictAdminGreetingItem> Greetings { get; set; } = new();
    public List<DistrictAdminDocumentItem> Documents { get; set; } = new();
}

public class DistrictAdminCmrClubRow
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int CmrsSubmitted { get; set; }
    public int CmrsPending { get; set; }
    public decimal AvgAttendance { get; set; }
    public int MeetingsHeld { get; set; }
}

// CMR per-month aggregate for the per-month breakdown row on the CMR sub-tab.
public class DistrictAdminCmrMonthRow
{
    public int Month { get; set; }             // 1=Jul .. 12=Jun (rotary year month)
    public int CalendarMonth { get; set; }     // 7=Jul .. 6=Jun (Gregorian)
    public string Label { get; set; } = "";    // "Jul"
    public int Submitted { get; set; }
    public int OnTime { get; set; }
    public int Late { get; set; }
    public int Pending { get; set; }
    public int NotStarted { get; set; }
}

// Per-club 12-month grid row (CMR sub-tab grid).
public class DistrictAdminCmrPerClubMonth
{
    public int Month { get; set; }
    public string Status { get; set; } = ""; // submitted | pending | not_started | late
    public string? SubmittedDate { get; set; }
}

public class DistrictAdminCmrPerClubRow
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int Submitted { get; set; }
    public int Pending { get; set; }
    public List<DistrictAdminCmrPerClubMonth> Months { get; set; } = new();
}

// District Awards per-club score.
public class DistrictAdminCitationClubRow
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int PointsEarned { get; set; }
    public int BonusEarned { get; set; }
    public int TotalScore { get; set; }
    // Alias for the egovernance frontend which reads `totalPoints`.
    // Same value as TotalScore; kept as a computed property so callers
    // and Dapper mapping stay unchanged.
    public int TotalPoints => TotalScore;
    public bool Qualified { get; set; }
}

// E-Gov reports list item.
public class DistrictAdminReportItem
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string ExportUrl { get; set; } = "";
    public string Format { get; set; } = ""; // pdf | xlsx | csv
}

public class DistrictAdminEGovernanceKpis
{
    public int MonthlyReports { get; set; }
    public int AvgCitationScore { get; set; }
}

public class DistrictAdminEGovernanceResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public int TotalCmrSubmitted { get; set; }
    public int TotalCmrPending { get; set; }
    public decimal AvgAttendance { get; set; }
    public int TotalMeetings { get; set; }
    public int ClubsWithFullCmrCompliance { get; set; }
    public int ClubsWithMissingCmr { get; set; }
    public List<DistrictAdminCmrClubRow> ClubCompliance { get; set; } = new();

    // ── new Wave 13A2 fields (additive) ─────────────────────────────────
    // top-level KPI tiles
    public int MonthlyReportsCount { get; set; }
    public decimal AvgCitationScore { get; set; }

    // Frontend reads `data.kpis?.monthlyReports/avgCitationScore`.
    // Surface a nested Kpis object so the top KPI tiles light up. Same values
    // as the flat fields above (kept for backwards compatibility).
    public DistrictAdminEGovernanceKpis Kpis { get; set; } = new();

    // CMR sub-tab payload
    public int CmrTotalClubs { get; set; }
    public decimal CmrOnTimePercent { get; set; }
    public List<DistrictAdminCmrMonthRow> CmrMonthBreakdown { get; set; } = new();
    public List<DistrictAdminCmrPerClubRow> CmrPerClubGrid { get; set; } = new();

    // District Awards sub-tab (frontend reads `districtCitation`).
    public List<DistrictAdminCitationClubRow> DistrictCitation { get; set; } = new();

    // Reports sub-tab
    public List<DistrictAdminReportItem> Reports { get; set; } = new();
}

// Dedicated paged responses for sub-endpoints
public class DistrictAdminCmrPerClubGridResponse
{
    public DistrictAdminIdentityDto District { get; set; } = new();
    public List<DistrictAdminCmrPerClubRow> Rows { get; set; } = new();
}

// ─── Wave 13A3 — DG goal-setting + AG-feeding DTOs ───────────────────
// Five new tables, all (district|club, year)-scoped. POST = upsert.
// Authorization: GET allowed for caller's resolved district; POST requires
// active District Admin assignment at the requested district.

// Table: district_membership_goal — DG per-RY membership target
public class DistrictMembershipGoalDto
{
    public int PkId { get; set; }
    public int FkDistrictId { get; set; }
    public int FkYearId { get; set; }
    public int TargetTotal { get; set; }
    public int TargetNewMembers { get; set; }
    public decimal TargetRetentionPercent { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

// Table: district_foundation_goal — DG per-RY foundation collection target
public class DistrictFoundationGoalDto
{
    public int PkId { get; set; }
    public int FkDistrictId { get; set; }
    public int FkYearId { get; set; }
    public decimal TargetAnnualFundUsd { get; set; }
    public decimal TargetPolioFundUsd { get; set; }
    public decimal TargetEndowmentFundUsd { get; set; }
    public decimal TargetOtherFundUsd { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

// Table: district_project_target — per-RY per-avenue project count targets
// One row per (district, year, module). Used for District Admin "Service Projects" tab.
public class DistrictProjectTargetDto
{
    public int PkId { get; set; }
    public int FkDistrictId { get; set; }
    public int FkYearId { get; set; }
    public int FkModuleId { get; set; }
    public string? ModuleName { get; set; }
    public int TargetCount { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

// Wrapper for POST /project-targets (bulk upsert per avenue).
public class DistrictProjectTargetsBulkRequest
{
    public int DistrictId { get; set; }
    public int YearId { get; set; }
    public List<DistrictProjectTargetItem> Targets { get; set; } = new();
}
public class DistrictProjectTargetItem
{
    public int FkModuleId { get; set; }
    public int TargetCount { get; set; }
}

// Table: club_award_status — DG marks per-club award achievement status
// Status values: "pending" | "on_track" | "achieved" | "behind"
public class ClubAwardStatusDto
{
    public int PkId { get; set; }
    public int FkClubId { get; set; }
    public int FkYearId { get; set; }
    public bool OnTrack { get; set; }
    public bool Achieved { get; set; }
    public string PresidentialCitationStatus { get; set; } = "pending";
    public string DistrictCitationStatus { get; set; } = "pending";
    public string MembershipExcellenceStatus { get; set; } = "pending";
    public string? Notes { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

// Table: club_myrotary_tracking — admin enters MyRotary registration counts
public class ClubMyRotaryTrackingDto
{
    public int PkId { get; set; }
    public int FkClubId { get; set; }
    public int FkYearId { get; set; }
    public int RegisteredMembers { get; set; }
    public int TotalMembers { get; set; }
    public decimal RegistrationPercentage { get; set; }
    public DateTime? LastSynced { get; set; }
    public DateTime? ModifiedDate { get; set; }
}
