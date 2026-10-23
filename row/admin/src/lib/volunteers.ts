import type { SaveVolunteerSlot, VolunteerSlot } from "@/types/volunteers";

// Small helpers for the volunteer pages (api/Services/VolunteerService.cs holds the rules).

/** API date-time to the "YYYY-MM-DDTHH:mm" a datetime-local input wants ("" when empty). The wall-clock value as
 *  stored, never shifted by a zone, so a save round-trips unchanged. */
export const timeInput = (v: string | null | undefined) => (v ? v.slice(0, 16) : "");

/** One editable slot in the sheet form; places stay text while typed. */
export interface SlotRow {
  id: number | null;
  task: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  filled: number;
}

export const toRows = (slots: VolunteerSlot[]): SlotRow[] =>
  slots.map((s) => ({
    id: s.id, task: s.task, startsAt: timeInput(s.startsAt), endsAt: timeInput(s.endsAt), capacity: String(s.capacity), filled: s.filled,
  }));

export const toSlots = (rows: SlotRow[]): SaveVolunteerSlot[] =>
  rows.map((r) => ({ id: r.id, task: r.task.trim(), startsAt: r.startsAt, endsAt: r.endsAt || null, capacity: Number(r.capacity) || 0 }));

/** Hours typed per sign-up ("" clears them) to the API's entries. */
export const hoursEntries = (typed: Record<number, string>) =>
  Object.entries(typed).map(([id, v]) => ({ signupId: Number(id), hours: v.trim() === "" ? null : Number(v) }));

/** The total of the typed hours, added in hundredths so 0.1 + 0.2 stays 0.3. */
export const typedTotal = (typed: Record<number, string>) =>
  Object.values(typed).reduce((sum, v) => sum + Math.round((Number(v) || 0) * 100), 0) / 100;
