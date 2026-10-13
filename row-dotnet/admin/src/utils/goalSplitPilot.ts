/**
 * Quarterly / month-wise TARGET SPLIT pilot: the Quarterly and Month-wise buttons on Goal Setting.
 *
 * The API decides who may save a split (GoalSetting:SplitPilot:Enabled / ClubIds / DistrictIds; default:
 * everyone). This mirrors it for showing the buttons. With no pilot ids configured the split is shown to
 * everyone; NEXT_PUBLIC_GOAL_SPLIT_PILOT_CLUB_IDS / _DISTRICT_IDS (comma-separated pk ids) narrow it to a
 * pilot, and must match the API's lists.
 */
function ids(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

const PILOT_CLUB_IDS = ids(process.env.NEXT_PUBLIC_GOAL_SPLIT_PILOT_CLUB_IDS);
const PILOT_DISTRICT_IDS = ids(process.env.NEXT_PUBLIC_GOAL_SPLIT_PILOT_DISTRICT_IDS);
const PILOT_ONLY = PILOT_CLUB_IDS.length > 0 || PILOT_DISTRICT_IDS.length > 0;

/** A club or district screen may show the split when no pilot is configured or its own id is in the pilot. */
export function isGoalSplitPilot(clubId?: number | null, districtId?: number | null): boolean {
  if (!PILOT_ONLY) return true;
  if (clubId != null && clubId > 0) return PILOT_CLUB_IDS.includes(clubId);
  if (districtId != null && districtId > 0) return PILOT_DISTRICT_IDS.includes(districtId);
  return false;
}
