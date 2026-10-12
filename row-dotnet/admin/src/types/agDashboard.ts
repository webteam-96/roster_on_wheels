// AG Dashboard response types — must match RotaryApi/DTOs/AgDashboardDtos.cs
// camelCase per JsonNamingPolicy.

export interface AgIdentity {
  memberId: number;
  name: string;
  districtNumber: string;
  yearLabel: string;
}

export interface AgClubSummary {
  clubId: number;
  clubName: string;
  districtNumber: string;
  presidentName: string;
  secretaryName: string;
  isSyncedFromRotaryOrg: boolean;
  clubWebsiteStatus: "active" | "expired" | "none";
  clubWebsiteSubdomain: string | null;
  members: number;
  // Club Service entries filed this year - was `meetings` (club_attendance) until 2026-09-29.
  clubService: number;
  totalProjects: number;
  projectRank: number;
  trfTotalInr: number;
  trfTotalUsd: number;
  ocv: number;
  // Wave 12A: national rank (separate from district `projectRank`).
  // `nationalRankIsPending = true` while data source is being finalised.
  nationalRank?: number | null;
  nationalRankIsPending?: boolean;
}

export interface AgClubsResponse {
  ag: AgIdentity;
  clubs: AgClubSummary[];
  totalMembers: number;
  totalClubService: number;
  totalProjects: number;
  totalTrfInr: number;
  totalClubsInDistrict: number;
}

export interface AgMonthlyPoint {
  month: string;
  // Club Service entries filed that month - was `meetings` (club_attendance), user 2026-10-01.
  clubService: number;
  projects: number;
  trfInr: number;
}

export interface AgTrfBreakdown {
  annualInr: number;
  polioInr: number;
  endowment: number;
  others: number;
  totalInr: number;
  totalUsd: number;
}

export interface AgProjectPhoto {
  url: string;
  description: string | null;
  isPrimary: boolean;
}

// Full project detail for the AG projects popup — fetched per project on open.
export interface AgProjectDetail {
  projectId: number;
  clubId: number;
  clubName: string;
  yearId: number;
  yearLabel: string;
  title: string;
  description: string | null;
  location: string | null;
  avenue: string | null;
  areaOfFocus: string | null;
  category: string | null;
  subCategory: string | null;
  date: string | null;
  cost: number;
  currency: string;
  funding: string;
  beneficiaries: number;
  manHours: number;
  manHoursIsPending: boolean;
  rotariansInvolved: number;
  rotaractorsInvolved: number;
  rccInvolved: number;
  projectType: string | null;
  isJointProject: boolean;
  coHostName: string | null;
  clubRole: string | null;
  approvalStatus: string | null;
  photos: AgProjectPhoto[];
}

export interface AgProjectRow {
  // Identity for the detail drill-down. projectId is unique only within its year table.
  projectId: number;
  yearId: number;
  clubId: number;
  clubName: string;
  title: string;
  // Service avenue (module_master.ModuleName) — Community / Vocational /
  // International / New Generations / Public Image / Club Service.
  avenue: string | null;
  category: string | null;
  areaOfFocus: string | null;
  date: string | null;
  cost: number;
  currency: string;
  beneficiaries: number;
  manHours: number;
  funding: string;
  rotarians: number;
  // Approval workflow status. Null for Club Service / non-approval avenues;
  // 'pending' / 'approved' / 'rejected' for the 5 approval avenues.
  approvalStatus?: string | null;
}

export interface AgClubDetailResponse {
  summary: AgClubSummary;
  monthly: AgMonthlyPoint[];
  trf: AgTrfBreakdown;
  recentProjects: AgProjectRow[];
}

export interface AgClubTrf {
  clubId: number;
  clubName: string;
  members: number;
  trf: AgTrfBreakdown;
}

export interface AgTrfResponse {
  ag: AgIdentity;
  clubs: AgClubTrf[];
  totals: AgTrfBreakdown;
}

export interface AgMembershipClubRow {
  clubId: number;
  clubName: string;
  members: number;
  clubService: number;
  totalProjects: number;
  projectRank: number;
  trf: number;
  ocv: number;
  beneficiaries: number;
}

export interface AgMembershipResponse {
  ag: AgIdentity;
  clubs: AgMembershipClubRow[];
  totalMembers: number;
  totalClubService: number;
  totalProjects: number;
  totalTrfInr: number;
  totalOcv: number;
  totalClubsInDistrict: number;
  totalBeneficiaries: number;
}

export interface AgYouthClubRow {
  clubId: number;
  clubName: string;
  newGenerationService: number;
  vocationalService: number;
  internationalService: number;
  totalProjects: number;
  members: number;
  meetings: number;
}

export interface AgYouthResponse {
  ag: AgIdentity;
  clubs: AgYouthClubRow[];
  totalNewGeneration: number;
  totalVocational: number;
  totalInternational: number;
  totalProjects: number;
}

export interface AgProjectsResponse {
  ag: AgIdentity;
  projects: AgProjectRow[];
  clubProjectCounts: Record<string, number>;
  monthlyProjectCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  totalProjects: number;
  totalBeneficiaries: number;
  totalManHours: number;
  totalCost: number;
  targetCurrency: string;
}

export interface AgCitationClubRow {
  clubId: number;
  clubName: string;
  members: number;
  total: number;
  membership: number;
  trf: number;
  service: number;
  publicImage: number;
  youth: number;
  foundation: number;
}

export interface AgGoalsClubRow {
  clubId: number;
  clubName: string;
  members: number;
  membershipGrowth: number;
  trfPerCapita: number;
  serviceProjects: number;
  meetingAttendance: number;
  myRotary: number;
  newMembers: number;
}

export interface AgMonthlyTrackingPoint {
  month: string;
  byClub: Record<string, number>;
}

export interface AgExcellenceResponse {
  ag: AgIdentity;
  citation: AgCitationClubRow[];
  goals: AgGoalsClubRow[];
  monthlyProjects: AgMonthlyTrackingPoint[];
  monthlyMeetings: AgMonthlyTrackingPoint[];
  monthlyTrf: AgMonthlyTrackingPoint[];
  averageCitationScore: number;
  topScoringClub: AgCitationClubRow | null;
}

export interface AgDistrictClubRow {
  clubId: number;
  clubName: string;
  members: number;
  meetings: number;
  // Club Service entries the club filed for the year (module club_service), shown by the
  // District view in place of the old attendance-based "meetings".
  clubService: number;
  totalProjects: number;
  trfTotalInr: number;
  ocv: number;
  projectRank: number;
  vocationalService: number;
  internationalService: number;
  newGenerationService: number;
}

export interface AgDistrictResponse {
  ag: AgIdentity;
  clubs: AgDistrictClubRow[];
  totalMembers: number;
  totalMeetings: number;
  totalClubService: number;
  totalProjects: number;
  totalTrfInr: number;
}
