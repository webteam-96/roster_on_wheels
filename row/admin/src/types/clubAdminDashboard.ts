// Club Admin Dashboard response types — must match RotaryApi/DTOs/ClubAdminDashboardDtos.cs

export interface ClubAdminIdentity {
  memberId: number;
  name: string;
  clubId: number;
  clubName: string;
  districtNumber: string;
  yearLabel: string;
  rotaryOrgSyncEnabled: boolean;
  clubWebsiteActive: boolean;
  clubWebsiteExpiry: string | null;
  /** Available (active, unexpired, unused) Email credits — surfaced on the
   *  Overview hero next to the Rotary.org Sync chip. */
  emailCreditBalance: number;
}

export interface ClubAdminAvenueRow { avenue: string; completed: number; }

export interface ClubAdminCitationRow {
  criterion: string;
  earned: number;
  maxPoints: number;
}

export interface ClubAdminMemberGrowthPoint {
  month: string; male: number; female: number; honorary: number;
}

export interface ClubAdminEventRow {
  title: string; type: string; date: string | null; location: string | null;
}

export interface ClubAdminOverviewResponse {
  club: ClubAdminIdentity;
  totalMembers: number;
  activeMembers: number;
  maleMembers: number;
  femaleMembers: number;
  honoraryMembers: number;
  newMembersThisYear: number;
  terminatedThisYear: number;
  avgAttendance: number;
  trfRaisedInr: number;
  trfGoalInr: number;
  serviceProjects: number;
  serviceGoal: number;
  districtCitationScore: number;
  trfAnnualFund: number;
  trfPolioFund: number;
  trfEndowment: number;
  trfMajorDonors: number;
  phfContributors: number;
  avenues: ClubAdminAvenueRow[];
  citationChecklist: ClubAdminCitationRow[];
  memberGrowth: ClubAdminMemberGrowthPoint[];
  upcomingEvents: ClubAdminEventRow[];
}

export interface ClubAdminFundMetric {
  id: string; name: string; value: number; unit: string;
}

export interface ClubAdminFoundationResponse {
  club: ClubAdminIdentity;
  metrics: ClubAdminFundMetric[];
  totalCollectedInr: number;
  annualFundInr: number;
  polioFundInr: number;
  endowmentInr: number;
  othersInr: number;
  majorDonors: number;
}

export interface ClubAdminMemberRow {
  memberId: number;
  name: string;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  rotaryId: string | null;
  joinedDate: string | null;
}

export interface ClubAdminMembershipResponse {
  club: ClubAdminIdentity;
  totalMembers: number;
  maleMembers: number;
  femaleMembers: number;
  honoraryMembers: number;
  newMembersThisYear: number;
  terminatedThisYear: number;
  members: ClubAdminMemberRow[];
  recentJoiners: ClubAdminMemberRow[];
  monthlyTrend: ClubAdminMemberGrowthPoint[];
}

export interface ClubAdminProjectRow {
  title: string;
  avenue: string | null;
  category: string | null;
  date: string | null;
  cost: number;
  currency: string; // project's own currency — cost cell shows this
  beneficiaries: number;
  funding: string | null;
  approvalStatus: string;
}

export interface ClubAdminAvenueResponse {
  club: ClubAdminIdentity;
  avenues: ClubAdminAvenueRow[];
  projects: ClubAdminProjectRow[];
  totalProjects: number;
  totalCost: number;
  targetCurrency: string; // currency of totalCost (district default)
  totalBeneficiaries: number;
}

export interface ClubAdminCmrRow {
  reportMonth: string;
  isSubmitted: boolean;
  submittedDate: string | null;
}

export interface ClubAdminAttendanceRow {
  date: string;
  topic: string | null;
  present: number;
  total: number;
  pct: number;
}

export interface ClubAdminEGovernanceResponse {
  club: ClubAdminIdentity;
  clubMonthlyReports: ClubAdminCmrRow[];
  recentMeetings: ClubAdminAttendanceRow[];
  cmrSubmitted: number;
  cmrPending: number;
  avgAttendance: number;
  meetingsHeld: number;
}

export interface ClubAdminCommunicationItem {
  kind: string;
  title: string;
  publishDate: string | null;
  imagePath: string | null;
  description: string | null;
}

export interface ClubAdminGreetingRow {
  name: string;
  mobile: string | null;
  date: string | null;
  kind: "birthday" | "anniversary";
  day: number;
}

export interface ClubAdminCommunicationResponse {
  club: ClubAdminIdentity;
  announcementCount: number;
  newsletterCount: number;
  upcomingEventCount: number;
  documentCount: number;
  greetingsTodayCount: number;
  announcements: ClubAdminCommunicationItem[];
  newsletters: ClubAdminCommunicationItem[];
  upcomingEvents: ClubAdminCommunicationItem[];
  documents: ClubAdminCommunicationItem[];
  birthdaysThisMonth: ClubAdminGreetingRow[];
  anniversariesThisMonth: ClubAdminGreetingRow[];
}

export interface ClubAdminWebsiteResponse {
  club: ClubAdminIdentity;
  configured: boolean;
  subdomain: string;
  thirdPartyDomain: string | null;
  // Backend-resolved "Visit Website" URL — already sanitised. Use this in preference to
  // building one client-side. Null when no usable URL can be produced.
  visitUrl: string | null;
  status: string;
  activatedDate: string | null;
  expiryDate: string | null;
  menuCount: number;
  bannerCount: number;
  eventCount: number;
  announcementCount: number;
  killSwitchOn: boolean;
}

export interface ClubAdminDuesMemberRow {
  memberId: number;
  memberName: string;
  amountDue: number;
  amountPaid: number;
  status: string;
}

export interface ClubAdminPaymentsResponse {
  club: ClubAdminIdentity;
  totalDue: number;
  totalCollected: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  // Honorary count is EXCLUDED from all the other counts (paid/unpaid/partial)
  // and from the members array. Rendered separately on the dashboard KPI as a
  // small chip next to "from N members" so admins see the total roster size.
  honoraryCount: number;
  members: ClubAdminDuesMemberRow[];
}

// ─── Dashboard sub-tabs (Phase B) ────────────────────────────────────

export interface ClubAdminDashboardDirectoryMemberRow {
  memberId: number;
  name: string;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  rotaryId: string | null;
  photoPath: string | null;
  designation: string | null;
  isHonorary: boolean;
  isClubAdmin: boolean;
  isDistrictAdmin: boolean;
  joinedDate: string | null;
}

export interface ClubAdminDashboardDirectoryResponse {
  club: ClubAdminIdentity;
  totalMembers: number;
  /** members - honorary. Labelled "Active Members" on the dashboard. */
  fullMembers: number;
  honoraryMembers: number;
  clubAdminsCount: number;
  maleMembers: number;
  femaleMembers: number;
  members: ClubAdminDashboardDirectoryMemberRow[];
}

export interface ClubAdminDashboardBodRow {
  id: number;
  sr: number;
  name: string;
  designation: string;
  designationSortOrder: number | null;
  mobile: string | null;
  email: string | null;
  photoPath: string | null;
  designationId: number | null;
  memberId: number;
  isMember: boolean;
}

export interface ClubAdminYearOption {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}

export interface ClubAdminDashboardBodResponse {
  club: ClubAdminIdentity;
  boardMembers: number;
  executiveRoles: number;
  serviceChairs: number;
  growthOutreach: number;
  selectedYearLabel: string;
  selectedYearId: number | null;
  availableYears: ClubAdminYearOption[];
  directors: ClubAdminDashboardBodRow[];
}

export interface ClubAdminDashboardMarketplaceListing {
  title: string;
  kind: string;
  date: string | null;
  status: string;
}

export interface ClubAdminDashboardMarketplaceAccount {
  clubName: string;
  marketplaceId: string;
  districtNumber: string;
  subscription: string;
  contactSupport: string | null;
}

export interface ClubAdminDashboardMarketplaceResponse {
  club: ClubAdminIdentity;
  subscription: string;
  clubListingsCount: number;
  memberId: string;
  platform: string;
  platformUrl: string;
  launchUrl: string;
  listings: ClubAdminDashboardMarketplaceListing[];
  account: ClubAdminDashboardMarketplaceAccount;
}

export interface ClubAdminDashboardRotaryNetworkRow {
  id: number;
  memberId: string;
  memberType: string;
  firstName: string;
  middleName: string;
  lastName: string;
  admissionDate: string | null;
  terminationDate: string | null;
  terminationReason: string | null;
  status: string | null;
  mobile?: string | null;
  email?: string | null;
  notes?: string | null; // Potential members only
}

export interface ClubAdminDashboardRotaryNetworkResponse {
  club: ClubAdminIdentity;
  totalTerminated: number;
  thisRotaryYear: number;
  nowMember: number;
  lackOfParticipation: number;
  terminatedMembers: ClubAdminDashboardRotaryNetworkRow[];
  potentialMembers: ClubAdminDashboardRotaryNetworkRow[];
}

// ─── Service Projects & Public Image (Phase C) ────────────────────────

export interface ServiceProjectsOverviewKpis {
  totalProjects: number;
  totalBeneficiaries: number;
  totalCost: number;
  totalManHours: number;
  meetingsHeld: number;
}

export interface ServiceProjectsAvenueSummaryRow {
  avenueKey: string;
  avenueName: string;
  projects: number;
  beneficiaries: number;
  cost: number;
  manHours: number;
}

export interface ServiceProjectsPendingFixRow {
  projectId: number;
  title: string;
  avenueKey: string;
  avenueLabel: string;
  fixUrl: string;
  approvalStatus: string;
}

export interface ServiceProjectsOverviewResponse {
  club: ClubAdminIdentity;
  selectedYearId: number | null;
  selectedYearLabel: string;
  availableYears: ClubAdminYearOption[];
  kpis: ServiceProjectsOverviewKpis;
  targetCurrency: string; // currency of kpis.totalCost + per-avenue cost subtotals
  avenues: ServiceProjectsAvenueSummaryRow[];
  pendingItems: ServiceProjectsPendingFixRow[];
}

export interface ServiceProjectsAvenueKpis {
  projects: number | null;
  beneficiaries: number | null;
  amountSpent: number | null;
  manHours: number | null;
  meetingsHeld: number | null;
  avgAttendancePercent: number | null;
  avgAttendanceStayedPercent: number | null;
  membersOnRoll: number | null;
}

export interface ServiceProjectsMeetingRow {
  id: number;
  sr: number;
  date: string;
  meetingType: string;
  title: string;
  attendance: number;
  // BOD meeting -> that year's board size; every other type -> the club roll. attendanceBase names it.
  membersOnRoll: number;
  attendanceBase?: string;
  yearId?: number;
  // Saved on the add/edit form - shown as stored, never recalculated here.
  attendancePercent: number;
}

export interface ServiceProjectsProjectRow {
  id: number;
  sr: number;
  date: string;
  title: string;
  type: string;
  cost: number;
  currency: string; // project's own currency — cost cell shows this
  directBeneficiaries: number;
  manHours: number;
  beneficiary: string | null;
  beneficiaries2: number | null;
  approvalStatus: string;
  campImageUrl?: string | null;   // PPH Camp only — camp logo/image (relative /Documents path)
  isActive?: boolean;             // PPH Camp only — active/inactive
  syncedToOrg: boolean;
  isJointProject: boolean;
  coHostName: string | null;
  parentProjectId: number | null;
  ongoingGroupTitle: string | null;
}

export interface ServiceProjectsPendingApprovalBannerRow {
  projectId: number;
  creatorName: string;
  projectTitle: string;
  avenueLabel: string;
  mobile: string | null;
  email: string | null;
  approvalStatus: string;
}

export interface ServiceProjectsAvenueDetailResponse {
  club: ClubAdminIdentity;
  avenueKey: string;
  avenueName: string;
  selectedYearId: number | null;
  selectedYearLabel: string;
  availableYears: ClubAdminYearOption[];
  kpis: ServiceProjectsAvenueKpis;
  targetCurrency: string; // currency of kpis.amountSpent (district default)
  meetings: ServiceProjectsMeetingRow[];
  oneTimeProjects: ServiceProjectsProjectRow[];
  ongoingProjects: ServiceProjectsProjectRow[];
  pendingApprovals: ServiceProjectsPendingApprovalBannerRow[];
}

// ─── Foundation Collection Goals (Phase C) ─────────────────────────────

export interface FoundationGoalDto {
  goalId: number | null;
  clubId: number;
  yearId: number;
  yearLabel: string;
  apfGoal: number;
  polioPlusGoal: number;
  endowmentFundGoal: number;
  otherGoal: number;
  currency: string;
  remarks: string | null;
  isEditable: boolean;
  isCurrent: boolean;
  updatedDate: string | null;
  updatedBy: string | null;
}

export interface FoundationGoalSaveRequest {
  yearId: number;
  apfGoal: number;
  polioPlusGoal: number;
  endowmentFundGoal: number;
  otherGoal: number;
  currency: string;
  remarks?: string | null;
}

export interface FoundationGoalYearRow {
  yearId: number;
  yearLabel: string;
  isCurrent: boolean;
  isEditable: boolean;
  hasGoal: boolean;
  totalGoal: number;
}

export interface FoundationGoalListResponse {
  clubId: number;
  clubName: string;
  currentSelection: FoundationGoalDto | null;
  years: FoundationGoalYearRow[];
  pastGoals: FoundationGoalDto[];
}
