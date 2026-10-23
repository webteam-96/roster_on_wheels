// N8 Meetings: meeting compliance on the district club list and its own page (api/Controllers/MeetingsController.cs).

import { appLocale } from "@/lib/appFormat";

export type MeetingStatus = "met" | "due" | "missed";

export const MEETING_STATUS: Record<MeetingStatus, { label: string; cls: string }> = {
  met: { label: "Met", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  due: { label: "Due", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  missed: { label: "Missed", cls: "border-red-200 bg-red-50 text-red-700" },
};

/** "YYYY-MM" of the month before `now`: the last complete month, which the API also defaults to. */
export function lastCompleteMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A meetings-per-month input: "" is null (no club override), a whole number 0 to 31 is itself, anything else undefined. */
export function parseMeetingCount(value: string): number | null | undefined {
  const v = value.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 31 ? n : undefined;
}

/** "Sep 2026" for "2026-09". */
export function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString(appLocale(), { month: "short", year: "numeric" });
}
