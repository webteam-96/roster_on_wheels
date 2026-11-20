import type { FollowupKind, SaveVolunteerSheetExtras, VolunteerFollowup } from "@/types/volunteers";

// Helpers for the volunteer sheet extras panel (api/Services/VolunteerExtrasService.cs holds the rules).

/** One editable follow-up; days stay text while typed. */
export interface FollowupRow {
  id: number | null;
  kind: FollowupKind;
  days: string;
  subject: string;
  body: string;
  sentCount: number;
}

export const toFollowupRows = (list: VolunteerFollowup[]): FollowupRow[] =>
  list.map((f) => ({ ...f, days: String(f.days) }));

export const emptyFollowup = (kind: FollowupKind): FollowupRow =>
  ({ id: null, kind, days: kind === "before" ? "2" : "1", subject: "", body: "", sentCount: 0 });

/** The body the API saves; days that are not a whole number go as -1, which the server refuses with its message. */
export const toExtrasBody = (confirmationText: string, rows: FollowupRow[], coordinatorIds: number[]): SaveVolunteerSheetExtras => ({
  confirmationText: confirmationText.trim() || null,
  followups: rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    days: /^\d+$/.test(r.days.trim()) ? Number(r.days.trim()) : -1,
    subject: r.subject.trim(),
    body: r.body.trim(),
  })),
  coordinatorIds,
});

/** "2 days before the slot", "on the day the slot ends", "1 day after the slot ends". */
export const followupWhen = (kind: FollowupKind, days: number): string => {
  const n = `${days} day${days === 1 ? "" : "s"}`;
  if (kind === "before") return `${n} before the slot`;
  return days === 0 ? "when the slot ends" : `${n} after the slot ends`;
};
