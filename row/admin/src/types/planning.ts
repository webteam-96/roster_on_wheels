// Planning mode (api/Controllers/PlanningController.cs, build spec 3.1; flagged module "planning_mode").

export type ElectRole = "DGE" | "DS" | "DT" | "PE" | "SE";

export interface PlanningState {
  districtId: number;
  districtNumber: string | null;
  state: "planning" | "live";
  planningYearId: number | null;
  planningYearLabel: string | null;
  planningYearStart: string | null;
  planningYearEnd: string | null;
  readOnlyYearId: number | null;
  readOnlyYearLabel: string | null;
  readOnlyYearArchived: boolean;
  cutoverAt: string | null;
  cutoverDoneAt: string | null;
}

export interface PlanningRole {
  roleId: number;
  districtId: number;
  districtNumber: string | null;
  clubId: number;
  clubName: string | null;
  role: ElectRole;
  status: "invited" | "active" | "activated" | "revoked";
  source: string;
  memberId: number;
  memberName: string | null;
  yearId: number;
  yearLabel: string | null;
  yearStart: string | null;
  yearEnd: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
}

export interface LaunchpadItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  stub: boolean;
}

export interface PlanningClub {
  clubId: number;
  clubName: string;
  pe: PlanningRole | null;
  se: PlanningRole | null;
}

export interface PlanningOverview {
  state: PlanningState;
  team: PlanningRole[];
  clubs: PlanningClub[];
  launchpad: LaunchpadItem[];
  canManage: boolean;
}

/** What accepting an invitation answers (the page is public). */
export interface AcceptedInvite {
  role: ElectRole;
  status: string;
  clubName: string | null;
  districtNumber: string | null;
  yearLabel: string | null;
}

export const ROLE_NAMES: Record<ElectRole, string> = {
  DGE: "Governor-elect",
  DS: "District secretary",
  DT: "District treasurer",
  PE: "President-elect",
  SE: "Secretary-elect",
};
