// Convert a UTC ISO string from backend to a local datetime-local input value (YYYY-MM-DDTHH:mm)
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Split a UTC ISO into local date (YYYY-MM-DD) and time (HH:mm) for separate date + time inputs
export function toLocalDateParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Filename-safe local timestamp (no colons) for downloaded reports so repeat downloads
// don't overwrite each other, e.g. "2026-05-29_14-30-55".
export function fileTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Club meeting times (MeetingFromTime/MeetingToTime) come back from the backend as a raw
// 24-hour TIME string ("20:00:00" or "20:00") — the DB storage is format-agnostic, but every
// other time shown to users in this system uses 12-hour AM/PM (emails, reports, reminders all
// use "hh:mm tt"). Use this wherever a club's meeting time is DISPLAYED (not in <input type="time">
// fields, which require a 24-hour "HH:MM" value per the HTML spec — leave those as-is).
// Returns e.g. "8:00 PM", or "" for null/empty/invalid input.
export function formatMeetingTime12Hour(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  const hour24 = parseInt(match[1], 10);
  const minute = match[2];
  if (hour24 < 0 || hour24 > 23) return value;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

// Short month names — used so dates read unambiguously ("01 Aug" not "01/08", which
// could be read as Jan 8). Index 0 = Jan.
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Full date with a MONTH NAME: "01 Jan 2015". Use for joining dates and any general date
// display so the month is never ambiguous. Accepts an ISO string/datetime or a Date.
// Returns "" for null/empty/invalid input.
export function formatDMY(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// Project-wide rule: birthdays and anniversaries DISPLAY day-month only — the year is
// stored in the DB and stays available in edit forms (so the user can correct it), but
// nowhere else in the UI shows it. Use this helper for every birthDate/anniversaryDate
// render across V1, V2 and any export. Month is shown as a NAME so it's unambiguous —
// returns e.g. "15 Jun" for a June 15 date.
//
// Accepts: ISO string ("2026-06-15"), ISO datetime ("2026-06-15T00:00:00Z"), or already
//          a "DD-MM" string (mobile API responses may pre-format).
// Returns: "DD Mon" string, or "" for null/empty/invalid input.
export function formatBirthAnniversary(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";
  // Already day-month formatted (mobile API may strip the year before sending)
  if (typeof value === "string" && /^\d{1,2}-\d{1,2}$/.test(value.trim())) {
    const [dd, mm] = value.trim().split("-").map((n) => parseInt(n, 10));
    if (mm >= 1 && mm <= 12) return `${String(dd).padStart(2, "0")} ${MONTHS_SHORT[mm - 1]}`;
    return value.trim();
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()]}`;
}
