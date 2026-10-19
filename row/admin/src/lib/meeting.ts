// Meeting mode on meeting (attendance) records, ROW Wave 1. Same rule as the API's
// AttendanceService.NormalizeMeeting: online and hybrid may carry an https link; in person carries none.

export type MeetingMode = "in_person" | "online" | "hybrid";

export const MEETING_MODES: { value: MeetingMode; label: string }[] = [
  { value: "in_person", label: "In person" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];

export function validateMeeting(mode: MeetingMode, link: string): string | null {
  const l = link.trim();
  if (mode === "in_person" || !l) return null;
  try {
    if (new URL(l).protocol === "https:") return null;
  } catch {
    // fall through
  }
  return "The meeting link must be an https:// address.";
}

export function meetingPayload(mode: MeetingMode, link: string): { meetingMode: MeetingMode; meetingLink: string | null } {
  return { meetingMode: mode, meetingLink: mode === "in_person" ? null : link.trim() || null };
}
