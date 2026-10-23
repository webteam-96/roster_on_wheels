// District Admin Dashboard response types
import type { ClubAdminMemberGrowthPoint } from "./clubAdminDashboard";

export interface DistrictAdminIdentity {
  memberId: number;
  name: string;
  districtId: number;
  districtNumber: string;
  yearLabel: string;
  totalClubs: number;
}

export interface DistrictAdminClubStat {
  clubId: number;
  clubName: string;
  members: number;
  meetings: number;
  projects: number;
  trfInr: number;
}

export interface DistrictAdminMemberStat { label: string; count: number; }

export interface DistrictAdminRotaryNetworkRow {
  id: number;
  clubId: number;
  clubName: string;
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

export interface DistrictAdminRotaryNetworkClubOption {
  clubId: number;
  clubName: string;
}

export interface DistrictAdminRotaryNetworkResponse {
  district: DistrictAdminIdentity;
  totalTerminated: number;
  totalPotential: number;
  terminatedMembers: DistrictAdminRotaryNetworkRow[];
  potentialMembers: DistrictAdminRotaryNetworkRow[];
  clubs: DistrictAdminRotaryNetworkClubOption[];
}

export interface DistrictAdminOverviewResponse {
  district: DistrictAdminIdentity;
  totalClubs: number;
  activeClubs: number;
  totalMembers: number;
  newMembersThisYear: number;
  terminatedThisYear: number;
  totalProjects: number;
  totalMeetings: number;
  avgAttendance: number;
  trfTotalInr: number;
  districtCitationScore: number;
  announcements: number;
  newsletters: number;
  upcomingEvents: number;
  topClubsByMembers: DistrictAdminClubStat[];
  topClubsByTrf: DistrictAdminClubStat[];
  topClubsByProjects: DistrictAdminClubStat[];
}

export interface DistrictAdminMembershipResponse {
  district: DistrictAdminIdentity;
  totalMembers: number;
  maleMembers: number;
  femaleMembers: number;
  honoraryMembers: number;
  newMembersThisYear: number;
  terminatedThisYear: number;
  clubBreakdown: DistrictAdminClubStat[];
  ageGroups: DistrictAdminMemberStat[];
  monthlyTrend: ClubAdminMemberGrowthPoint[];
}

export interface DistrictAdminFundClubRow {
  clubId: number;
  clubName: string;
  annualFund: number;
  polioFund: number;
  endowment: number;
  others: number;
  total: number;
}

/* ── Wave 13A2 additive types ─────────────────────────────────────── */

export interface DistrictAdminFoundationGoalPanel {
  totalTargetInr?: number | null;
  annualTargetInr?: number | null;
  polioTargetInr?: number | null;
  endowmentTargetInr?: number | null;
  othersTargetInr?: number | null;
  isPending: boolean;
}

export interface DistrictAdminProjectTargetRow {
  typeKey: string;
  typeLabel: string;
  target?: number | null;
  completed: number;
  percentAchieved: number;
  isPending: boolean;
}

export interface DistrictAdminDistrictEventRow {
  id: number;
  title: string;
  description?: string | null;
  eventDate?: string | null;
  venue?: string | null;
  status: string;            // Upcoming | Past | Cancelled
  clubName?: string | null;
}

export interface DistrictAdminProjectFrequencyRow {
  clubId: number;
  clubName: string;
  category: string;
  completed: number;
}

export interface DistrictAdminProjectListingRow {
  projectId: number;
  clubId: number;
  clubName: string;
  title: string;
  projectDate?: string | null;
  beneficiaries: number;
  funds: number;
  manHours: number;
  avenueName?: string | null;
  areaOfFocus?: string | null;
  manHoursIsPending?: boolean;
}

export interface DistrictAdminFoundationResponse {
  district: DistrictAdminIdentity;
  totalInr: number;
  annualFundInr: number;
  polioFundInr: number;
  endowmentInr: number;
  othersInr: number;
  majorDonors: number;
  phfContributors: number;
  clubBreakdown: DistrictAdminFundClubRow[];

  // ── Wave 13A2 additive fields (may be empty until backend wave 13A3) ─
  foundationGoal?: DistrictAdminFoundationGoalPanel;
  districtProjectTargets?: DistrictAdminProjectTargetRow[];
  districtEvents?: DistrictAdminDistrictEventRow[];
  projectFrequency?: DistrictAdminProjectFrequencyRow[];
  allProjects?: DistrictAdminProjectListingRow[];
}

export interface DistrictAdminCommunicationItem {
  kind: string;
  title: string;
  clubName: string;
  publishDate: string | null;
  imagePath: string | null;
}

// Wave 13A2 additive types -----------------------------------------------
export interface DistrictAdminGreetingItem {
  memberId: number;
  name: string;
  photoPath?: string | null;
  clubName?: string | null;
  kind: string;          // birthday | anniversary
  date: string;          // MM-DD or yyyy-MM-dd
  bucket: string;        // today | this_week | next_week
}

export interface DistrictAdminDocumentItem {
  id: number;
  title: string;
  clubName: string;
  publishDate?: string | null;
  filePath?: string | null;
  originalFileName?: string | null;
  accessType: string;
}

export interface DistrictAdminCommunicationResponse {
  district: DistrictAdminIdentity;
  announcementCount: number;
  newsletterCount: number;
  upcomingEventCount: number;
  announcements: DistrictAdminCommunicationItem[];
  newsletters: DistrictAdminCommunicationItem[];
  upcomingEvents: DistrictAdminCommunicationItem[];

  // ── Wave 13A2 additive fields ──────────────────────────────────────────
  documentCount?: number;
  greetingsTodayCount?: number;
  districtEvents?: DistrictAdminDistrictEventRow[];
  greetings?: DistrictAdminGreetingItem[];
  documents?: DistrictAdminDocumentItem[];
}

export interface DistrictAdminCmrClubRow {
  clubId: number;
  clubName: string;
  cmrsSubmitted: number;
  cmrsPending: number;
  avgAttendance: number;
  meetingsHeld: number;
}

export interface DistrictAdminEGovernanceResponse {
  district: DistrictAdminIdentity;
  totalCmrSubmitted: number;
  totalCmrPending: number;
  avgAttendance: number;
  totalMeetings: number;
  clubsWithFullCmrCompliance: number;
  clubsWithMissingCmr: number;
  clubCompliance: DistrictAdminCmrClubRow[];
}

/* ── Wave 13A3 — DG goal-setting DTOs ─────────────────────────────────── */

/**
 * Mirrors RotaryApi.DTOs.DistrictMembershipGoalDto. POST upserts on
 * (fkDistrictId, fkYearId). GET returns null when no goal row exists.
 */
export interface DistrictMembershipGoalDto {
  pkId: number;
  fkDistrictId: number;
  fkYearId: number;
  targetTotal: number;
  targetNewMembers: number;
  targetRetentionPercent: number;
  modifiedDate?: string | null;
}

/**
 * Mirrors RotaryApi.DTOs.DistrictFoundationGoalDto (Wave 13A1 / 13A3).
 * Sent both ways — GET returns null when no row exists; POST is upsert.
 * Raised/realised values come from DistrictAdminFoundationResponse
 * (annualFundInr / polioFundInr / endowmentInr / othersInr) — not on this DTO.
 */
export interface DistrictFoundationGoalDto {
  pkId: number;
  fkDistrictId: number;
  fkYearId: number;
  targetAnnualFundUsd: number;
  targetPolioFundUsd: number;
  targetEndowmentFundUsd: number;
  targetOtherFundUsd: number;
  modifiedDate?: string | null;
}

/** Mirrors RotaryApi.DTOs.DistrictProjectTargetDto. */
export interface DistrictProjectTargetDto {
  pkId: number;
  fkDistrictId: number;
  fkYearId: number;
  fkModuleId: number;
  moduleName?: string | null;
  targetCount: number;
  modifiedDate?: string | null;
}

/** Mirrors RotaryApi.DTOs.DistrictProjectTargetItem. */
export interface DistrictProjectTargetItem {
  fkModuleId: number;
  targetCount: number;
}

/** Mirrors RotaryApi.DTOs.DistrictProjectTargetsBulkRequest. */
export interface DistrictProjectTargetsBulkRequest {
  districtId: number;
  yearId: number;
  targets: DistrictProjectTargetItem[];
}
