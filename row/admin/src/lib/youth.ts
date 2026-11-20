import type { ClearanceState, YouthProgram, YouthStatus } from "@/services/api";

/** Youth programs (gap #12). Mirrors YouthRules.MayMove in the API: the next statuses this person may set. */
export function nextStatuses(from: YouthStatus, chair: boolean): YouthStatus[] {
  const club: YouthStatus[] = from === "applied" || from === "approved" ? ["withdrawn"] : [];
  if (!chair) return club;
  const decide: Partial<Record<YouthStatus, YouthStatus[]>> = {
    applied: ["approved", "declined"],
    approved: ["attended", "declined"],
    attended: ["completed"],
  };
  return [...(decide[from] ?? []), ...club];
}

export const PROGRAM_LABEL: Record<YouthProgram, string> = { ryla: "RYLA", rli: "RLI" };
export const STATUS_LABEL: Record<YouthStatus, string> = {
  applied: "Applied", approved: "Approved", declined: "Declined", attended: "Attended", completed: "Completed", withdrawn: "Withdrawn",
};
export const ACTION_LABEL: Record<YouthStatus, string> = {
  applied: "Applied", approved: "Approve", declined: "Decline", attended: "Mark attended", completed: "Mark completed", withdrawn: "Withdraw",
};
export const CLEARANCE_LABEL: Record<ClearanceState, string> = {
  cleared: "Cleared", expiring: "Expires soon", expired: "Expired", incomplete: "Incomplete",
};

/** "2026-11-19T00:00:00" -> "2026-11-19" for a date input; "" for none. */
export const dayInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
