// Labels shared by the NEW CMR preview and its PDF (same wording as the CMR wizard).
export const CMR_MEETING_LABELS: Record<string, string> = {
  regular: "Regular", fellowship: "Fellowship", bod: "BOD", assembly: "Assembly", trust: "Trust",
};

export const CMR_PROJECT_LABELS: Record<string, string> = {
  community_service: "Community Service",
  vocational_service: "Vocational Service",
  international_service: "International Service",
  new_generation_service: "New Generation Service",
  public_image_initiative: "Public Image Initiative",
};

/** Calendar year of a CMR month: Rotary year "2026-27" -> July..December 2026, January..June 2027. */
export function cmrCalendarYear(yearLabel: string | null | undefined, month: number): number | null {
  const start = Number((yearLabel ?? "").slice(0, 4));
  if (!start) return null;
  return month >= 7 ? start : start + 1;
}

/** Meetings grouped by type, in a fixed order (Regular, Fellowship, BOD, Assembly, Trust, then any other). */
export interface CmrMeetingGroup<T> { type: string; label: string; items: T[]; avgAttendance: number | null }
export function groupCmrMeetings<T extends { meetingType: string | null; attendancePercentage: number | null }>(meetings: T[]): CmrMeetingGroup<T>[] {
  const order = Object.keys(CMR_MEETING_LABELS);
  const by = new Map<string, T[]>();
  meetings.forEach((m) => { const k = m.meetingType || "other"; by.set(k, [...(by.get(k) ?? []), m]); });
  const keys = [...order.filter((k) => by.has(k)), ...Array.from(by.keys()).filter((k) => !order.includes(k))];
  return keys.map((k) => {
    const items = by.get(k)!;
    const p = items.map((m) => m.attendancePercentage).filter((v): v is number => v != null);
    return {
      type: k,
      label: CMR_MEETING_LABELS[k] ?? (k === "other" ? "Other" : k),
      items,
      avgAttendance: p.length ? Math.round(p.reduce((s, v) => s + Number(v), 0) / p.length) : null,
    };
  });
}

/** "Tue, 10 Nov 2026 08:30:47 AM" - same format as the old CMR preview's "Uploaded to District" line. */
export function cmrUploadDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours() % 12 || 12, p2 = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getDay()]}, ${p2(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

/** Same note as the current CMR preview (user 2026-11-10: show it on every new design and in the PDF). */
export const CMR_DISTRICT_NOTE =
  "Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.";
