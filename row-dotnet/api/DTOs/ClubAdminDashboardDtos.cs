namespace RotaryApi.DTOs;

public class ClubAdminIdentityDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string YearLabel { get; set; } = "";
    public bool RotaryOrgSyncEnabled { get; set; }
    public bool ClubWebsiteActive { get; set; }
    public DateTime? ClubWebsiteExpiry { get; set; }
    /// <summary>Sum of available (unused, unexpired, active) Email credits for the club.
    /// Drives the credits chip on the Overview hero (point #16, 2026-06-12).</summary>
    public int EmailCreditBalance { get; set; }
    public int WhatsAppCreditBalance { get; set; }
}

public class ClubAdminAvenueRow
{
    public string Avenue { get; set; } = "";
    public int Completed { get; set; }
}

public class ClubAdminCitationRow
{
    public string Criterion { get; set; } = "";
    public decimal Earned { get; set; }
    public decimal MaxPoints { get; set; }
}

public class ClubAdminMemberGrowthPoint
{
    public string Month { get; set; } = "";
    public int Male { get; set; }
    public int Female { get; set; }
    public int Honorary { get; set; }
}

public class ClubAdminEventRow
{
    public string Title { get; set; } = "";
    public string Type { get; set; } = "";  // Meeting / Service / TRF / Event
    public string? Date { get; set; }
    public string? Location { get; set; }
}

public class ClubAdminOverviewResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();

    public int TotalMembers { get; set; }
    public int ActiveMembers { get; set; }
    public int MaleMembers { get; set; }
    public int FemaleMembers { get; set; }
    public int HonoraryMembers { get; set; }
    public int NewMembersThisYear { get; set; }
    public int TerminatedThisYear { get; set; }

    public decimal AvgAttendance { get; set; } // %
    public decimal TrfRaisedInr { get; set; }
    public decimal TrfGoalInr { get; set; }
    public int ServiceProjects { get; set; }
    public int ServiceGoal { get; set; }
    public decimal DistrictCitationScore { get; set; }

    public decimal TrfAnnualFund { get; set; }
    public decimal TrfPolioFund { get; set; }
    public decimal TrfEndowment { get; set; }
    public int TrfMajorDonors { get; set; }
    public int PhfContributors { get; set; }

    public List<ClubAdminAvenueRow> Avenues { get; set; } = new();
    public List<ClubAdminCitationRow> CitationChecklist { get; set; } = new();
    public List<ClubAdminMemberGrowthPoint> MemberGrowth { get; set; } = new();
    public List<ClubAdminEventRow> UpcomingEvents { get; set; } = new();
}

public class ClubAdminFundMetric
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal Value { get; set; }
    public string Unit { get; set; } = ""; // a currency code / "%" / ""
}

public class ClubAdminFoundationResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public List<ClubAdminFundMetric> Metrics { get; set; } = new();
    public decimal TotalCollectedInr { get; set; }
    public decimal AnnualFundInr { get; set; }
    public decimal PolioFundInr { get; set; }
    public decimal EndowmentInr { get; set; }
    public decimal OthersInr { get; set; }
    public int MajorDonors { get; set; }
}

public class ClubAdminMemberRow
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? Gender { get; set; }
    public string? RotaryId { get; set; }
    public string? JoinedDate { get; set; }
}

public class ClubAdminMembershipResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int TotalMembers { get; set; }
    public int MaleMembers { get; set; }
    public int FemaleMembers { get; set; }
    public int HonoraryMembers { get; set; }
    public int NewMembersThisYear { get; set; }
    public int TerminatedThisYear { get; set; }
    public List<ClubAdminMemberRow> Members { get; set; } = new();
    public List<ClubAdminMemberRow> RecentJoiners { get; set; } = new();
    public List<ClubAdminMemberGrowthPoint> MonthlyTrend { get; set; } = new();
}

public class ClubAdminProjectRow
{
    public string Title { get; set; } = "";
    public string? Avenue { get; set; }
    public string? Category { get; set; }
    public string? Date { get; set; }
    public decimal Cost { get; set; }
    public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency; // the project's own currency — row shows Cost in this
    public int Beneficiaries { get; set; }
    public string? Funding { get; set; }
    public string ApprovalStatus { get; set; } = "";
}

public class ClubAdminAvenueResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public List<ClubAdminAvenueRow> Avenues { get; set; } = new();
    public List<ClubAdminProjectRow> Projects { get; set; } = new();
    public int TotalProjects { get; set; }
    public decimal TotalCost { get; set; }
    public string TargetCurrency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency; // currency of TotalCost (district default)
    public int TotalBeneficiaries { get; set; }
}

public class ClubAdminCmrRow
{
    public string ReportMonth { get; set; } = "";
    public bool IsSubmitted { get; set; }
    public string? SubmittedDate { get; set; }
}

public class ClubAdminAttendanceRow
{
    public string Date { get; set; } = "";
    public string? Topic { get; set; }
    public int Present { get; set; }
    public int Total { get; set; }
    public decimal Pct { get; set; }
}

public class ClubAdminEGovernanceResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public List<ClubAdminCmrRow> ClubMonthlyReports { get; set; } = new();
    public List<ClubAdminAttendanceRow> RecentMeetings { get; set; } = new();
    public int CmrSubmitted { get; set; }
    public int CmrPending { get; set; }
    public decimal AvgAttendance { get; set; }
    public int MeetingsHeld { get; set; }
}

public class ClubAdminCommunicationItem
{
    public string Kind { get; set; } = ""; // announcement | newsletter | event
    public string Title { get; set; } = "";
    public string? PublishDate { get; set; }
    public string? ImagePath { get; set; }
    public string? Description { get; set; }
}

public class ClubAdminCommunicationResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int AnnouncementCount { get; set; }
    public int NewsletterCount { get; set; }
    public int UpcomingEventCount { get; set; }
    public int DocumentCount { get; set; }
    public int GreetingsTodayCount { get; set; }
    public List<ClubAdminCommunicationItem> Announcements { get; set; } = new();
    public List<ClubAdminCommunicationItem> Newsletters { get; set; } = new();
    public List<ClubAdminCommunicationItem> UpcomingEvents { get; set; } = new();
    public List<ClubAdminCommunicationItem> Documents { get; set; } = new();
    /// <summary>All birthdays in the CURRENT calendar month for this club. Frontend
    /// filters this list into Today / This Week / This Month tabs.</summary>
    public List<ClubAdminGreetingRow> BirthdaysThisMonth { get; set; } = new();
    public List<ClubAdminGreetingRow> AnniversariesThisMonth { get; set; } = new();
}

public class ClubAdminGreetingRow
{
    public string Name { get; set; } = "";
    public string? Mobile { get; set; }
    public DateTime? Date { get; set; }
    /// <summary>"birthday" | "anniversary"</summary>
    public string Kind { get; set; } = "";
    public int Day { get; set; }
}

public class ClubAdminWebsiteResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public bool Configured { get; set; }
    public string Subdomain { get; set; } = "";
    public string? ThirdPartyDomain { get; set; }
    // Resolved "Visit Website" URL: custom domain when reachable, else platform subdomain.
    // Single source of truth used by V1/V2/Mobile. Sanitised — frontends use as-is.
    public string? VisitUrl { get; set; }
    public string Status { get; set; } = ""; // active / trial / trial_expired / expired
    public string? ActivatedDate { get; set; }
    public string? ExpiryDate { get; set; }
    public int MenuCount { get; set; }
    public int BannerCount { get; set; }
    public int EventCount { get; set; }
    public int AnnouncementCount { get; set; }
    public bool KillSwitchOn { get; set; }
}

public class ClubAdminDuesMemberRow
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public decimal AmountDue { get; set; }
    public decimal AmountPaid { get; set; }
    public string Status { get; set; } = ""; // paid | partial | unpaid
}

public class ClubAdminPaymentsResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public decimal TotalDue { get; set; }
    public decimal TotalCollected { get; set; }
    public int PaidCount { get; set; }
    public int UnpaidCount { get; set; }
    public int PartialCount { get; set; }
    // Members list + KPI counts EXCLUDE honorary members (added 2026-07-09) —
    // honoraries don't pay dues so counting them in the paid/unpaid breakdown
    // caused confusion. The dashboard shows this count separately next to the
    // "from N members" line.
    public int HonoraryCount { get; set; }
    public List<ClubAdminDuesMemberRow> Members { get; set; } = new();
}

// ─── Dashboard sub-tabs (Directory / BOD / Marketplace / Rotary Network) ──

public class ClubAdminDashboardDirectoryMemberRow
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? Gender { get; set; }
    public string? RotaryId { get; set; }
    public string? PhotoPath { get; set; }
    public string? Designation { get; set; }
    public bool IsHonorary { get; set; }
    public bool IsClubAdmin { get; set; }
    public bool IsDistrictAdmin { get; set; }
    public string? JoinedDate { get; set; }
}

public class ClubAdminDashboardDirectoryResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int TotalMembers { get; set; }
    /// <summary>Members - honorary. Labelled "Paid Members" on the dashboard.</summary>
    public int FullMembers { get; set; }
    public int HonoraryMembers { get; set; }
    public int ClubAdminsCount { get; set; }
    /// <summary>Members whose Gender = 'Male'. New 2026-06-12 to power the
    /// Male card on the Directory tab.</summary>
    public int MaleMembers { get; set; }
    public int FemaleMembers { get; set; }
    public List<ClubAdminDashboardDirectoryMemberRow> Members { get; set; } = new();
}

public class ClubAdminDashboardBodRow
{
    public int Id { get; set; }
    public int Sr { get; set; }
    public string Name { get; set; } = "";
    public string Designation { get; set; } = "";
    public int? DesignationSortOrder { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? PhotoPath { get; set; }
    public int? DesignationId { get; set; }
    public int MemberId { get; set; }
    public bool IsMember { get; set; }
}

public class ClubAdminYearOption
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsCurrent { get; set; }
}

// Powers the global year dropdown in the dashboard topbar.
// Years are filtered to only those where the resolved club has actual data
// (per the data-only year-dropdown rule).
public class ClubAdminAvailableYearsResponse
{
    public int ClubId { get; set; }
    public int? CurrentYearId { get; set; }
    public string CurrentYearLabel { get; set; } = "";
    public List<ClubAdminYearOption> Years { get; set; } = new();
}

public class ClubAdminDashboardBodResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int BoardMembers { get; set; }
    public int ExecutiveRoles { get; set; }
    public int ServiceChairs { get; set; }
    public int GrowthOutreach { get; set; }
    public string SelectedYearLabel { get; set; } = "";
    public int? SelectedYearId { get; set; }
    public List<ClubAdminYearOption> AvailableYears { get; set; } = new();
    public List<ClubAdminDashboardBodRow> Directors { get; set; } = new();
}

public class ClubAdminDashboardMarketplaceListing
{
    public string Title { get; set; } = "";
    public string Kind { get; set; } = ""; // event | announcement | newsletter
    public string? Date { get; set; }
    public string Status { get; set; } = ""; // Active | Open | Closed
}

public class ClubAdminDashboardMarketplaceAccount
{
    public string ClubName { get; set; } = "";
    public string MarketplaceId { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string Subscription { get; set; } = "";
    public string? ContactSupport { get; set; }
}

public class ClubAdminDashboardMarketplaceResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public string Subscription { get; set; } = "";
    public int ClubListingsCount { get; set; }
    public string MemberId { get; set; } = "";
    public string Platform { get; set; } = "";
    public string PlatformUrl { get; set; } = "";
    public string LaunchUrl { get; set; } = "";
    public List<ClubAdminDashboardMarketplaceListing> Listings { get; set; } = new();
    public ClubAdminDashboardMarketplaceAccount Account { get; set; } = new();
}

public class ClubAdminDashboardRotaryNetworkRow
{
    public int Id { get; set; }
    public string MemberId { get; set; } = "";
    public string MemberType { get; set; } = ""; // Active | Honorary | etc. (terminated members)
    public string FirstName { get; set; } = "";
    public string MiddleName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string? AdmissionDate { get; set; }
    public string? TerminationDate { get; set; }
    public string? TerminationReason { get; set; }
    public string? Status { get; set; } // "Terminated" | "Potential"
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; } // Potential members only — potential_members.reference_details
}

public class ClubAdminDashboardRotaryNetworkResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int TotalTerminated { get; set; }
    public int ThisRotaryYear { get; set; }
    public int NowMember { get; set; }
    public int LackOfParticipation { get; set; }
    public List<ClubAdminDashboardRotaryNetworkRow> TerminatedMembers { get; set; } = new();
    public List<ClubAdminDashboardRotaryNetworkRow> PotentialMembers { get; set; } = new();
}

// ─── Service Projects & Public Image (Phase C) ─────────────────────────

public class ServiceProjectsOverviewKpis
{
    public int TotalProjects { get; set; }
    public int TotalBeneficiaries { get; set; }
    public decimal TotalCost { get; set; }
    public int TotalManHours { get; set; }
    public int MeetingsHeld { get; set; }
}

public class ServiceProjectsAvenueSummaryRow
{
    public string AvenueKey { get; set; } = "";
    public string AvenueName { get; set; } = "";
    public int Projects { get; set; }
    public int Beneficiaries { get; set; }
    public decimal Cost { get; set; }
    public int ManHours { get; set; }
}

public class ServiceProjectsPendingFixRow
{
    public int ProjectId { get; set; }
    public string Title { get; set; } = "";
    public string AvenueKey { get; set; } = "";
    public string AvenueLabel { get; set; } = "";
    public string FixUrl { get; set; } = "";
    public string ApprovalStatus { get; set; } = "";
}

public class ServiceProjectsOverviewResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public int? SelectedYearId { get; set; }
    public string SelectedYearLabel { get; set; } = "";
    public List<ClubAdminYearOption> AvailableYears { get; set; } = new();
    public ServiceProjectsOverviewKpis Kpis { get; set; } = new();
    // Currency the TotalCost KPI and per-avenue Cost subtotals are expressed in (district default).
    public string TargetCurrency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;
    public List<ServiceProjectsAvenueSummaryRow> Avenues { get; set; } = new();
    public List<ServiceProjectsPendingFixRow> PendingItems { get; set; } = new();
}

public class ServiceProjectsAvenueKpis
{
    // Non-club-service avenues (Community / Vocational / International / NG / PI / PPH)
    public int? Projects { get; set; }
    public int? Beneficiaries { get; set; }
    public decimal? AmountSpent { get; set; }
    public int? ManHours { get; set; }
    // Club Service avenue
    public int? MeetingsHeld { get; set; }
    public decimal? AvgAttendancePercent { get; set; }
    public decimal? AvgAttendanceStayedPercent { get; set; }
    public int? MembersOnRoll { get; set; }
}

public class ServiceProjectsMeetingRow
{
    public int Id { get; set; }
    public int Sr { get; set; }
    public string Date { get; set; } = "";
    public string MeetingType { get; set; } = ""; // "Regular" | "Fellowship" | "Board"
    public string Title { get; set; } = "";        // e.g. "Weekly Meeting"
    public int Attendance { get; set; }
    // What this meeting is measured against: the year's board for a BOD meeting, the club roll for
    // every other type (user 2026-10-01). AttendanceBase names it for the screen.
    public int MembersOnRoll { get; set; }
    public string AttendanceBase { get; set; } = "Total Members";
    public int YearId { get; set; }
    // Saved on the add/edit form - this is read back, never recalculated.
    public decimal AttendancePercent { get; set; }
}

public class ServiceProjectsProjectRow
{
    public int Id { get; set; }
    public int Sr { get; set; }
    public string Date { get; set; } = "";
    public string Title { get; set; } = "";
    public string Type { get; set; } = "";         // "One-time" | "Recurring" | "Annual"
    public decimal Cost { get; set; }
    public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;  // the project's own currency — the list shows Cost in this
    public int DirectBeneficiaries { get; set; }
    public int ManHours { get; set; }
    public string? Beneficiary { get; set; }
    public int? Beneficiaries2 { get; set; }
    public string ApprovalStatus { get; set; } = "";
    // PPH Camp only — the camp's logo/image (relative /Documents path) and its active flag.
    public string? CampImageUrl { get; set; }
    public bool? IsActive { get; set; }
    // True once the RI Flow-Bot extension has confirmed this project was published into Rotary
    // International's Service Project Center — the listing hides its "Sync" button when so.
    public bool SyncedToOrg { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public int? ParentProjectId { get; set; }
    public string? OngoingGroupTitle { get; set; }
}

public class ServiceProjectsPendingApprovalBannerRow
{
    public int ProjectId { get; set; }
    public string CreatorName { get; set; } = "";
    public string ProjectTitle { get; set; } = "";
    public string AvenueLabel { get; set; } = "";
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string ApprovalStatus { get; set; } = "";
}

public class ServiceProjectsAvenueDetailResponse
{
    public ClubAdminIdentityDto Club { get; set; } = new();
    public string AvenueKey { get; set; } = "";
    public string AvenueName { get; set; } = "";
    public int? SelectedYearId { get; set; }
    public string SelectedYearLabel { get; set; } = "";
    public List<ClubAdminYearOption> AvailableYears { get; set; } = new();
    public ServiceProjectsAvenueKpis Kpis { get; set; } = new();
    // Currency the AmountSpent KPI is expressed in (the club's district default). Per-project rows
    // keep their own Currency; foreign-currency costs are converted into this for the total.
    public string TargetCurrency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;
    public List<ServiceProjectsMeetingRow> Meetings { get; set; } = new();
    public List<ServiceProjectsProjectRow> OneTimeProjects { get; set; } = new();
    public List<ServiceProjectsProjectRow> OngoingProjects { get; set; } = new();
    public List<ServiceProjectsPendingApprovalBannerRow> PendingApprovals { get; set; } = new();
}
