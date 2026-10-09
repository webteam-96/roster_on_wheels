/**
 * Quarterly / month-wise TARGET SPLIT pilot (user 2026-09-25): the Quarterly and Month-wise buttons
 * on Goal Setting show ONLY for these while the split is tested live. Everyone else sees Goal Setting
 * exactly as before — the yearly target is untouched either way.
 *
 * The API enforces the same list (RotaryApi/Services/GoalTargetSplitPilot.cs) — change BOTH.
 * To open it to everyone, set ENABLED to false here and in the API.
 */
const ENABLED = true;

/** Thane City View (pk_club_id 2765). */
const PILOT_CLUB_IDS: number[] = [2765];

/** District 5656 (pk_district_id 2). */
const PILOT_DISTRICT_IDS: number[] = [2];

/** A club or district screen may show the split when its own id is in the pilot. */
export function isGoalSplitPilot(clubId?: number | null, districtId?: number | null): boolean {
  if (!ENABLED) return true;
  if (clubId != null && clubId > 0) return PILOT_CLUB_IDS.includes(clubId);
  if (districtId != null && districtId > 0) return PILOT_DISTRICT_IDS.includes(districtId);
  return false;
}
