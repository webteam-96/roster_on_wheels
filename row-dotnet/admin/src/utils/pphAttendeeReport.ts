import { exportToCSV } from "@/utils/csvExport";
import { PphAttendeeReportRow } from "@/types/pphCamp";

// Date-only formatter for camp/reading dates in the report (day-mon-year).
function dateOnly(val: unknown): string {
  if (!val) return "";
  const d = new Date(String(val));
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Downloads the scoped PPH attendee report to Excel. Rows arrive already ordered
 * club-wise from the API (never deduped); exportToCSV renders the "Total: N record(s)"
 * footer for the grand total. `fileTimestamp` is appended by exportToCSV.
 */
export function exportPphAttendeeReport(rows: PphAttendeeReportRow[], opts: { filename: string; title: string; subtitle?: string }) {
  exportToCSV(
    rows,
    opts.filename,
    [
      { key: "sr", label: "Sr.No.", index: true, width: 8 },
      { key: "districtNumber", label: "District", width: 12 },
      { key: "clubName", label: "Club", width: 30 },
      { key: "campTitle", label: "Camp", width: 28 },
      { key: "campDate", label: "Camp Date", width: 14, format: dateOnly },
      { key: "yearLabel", label: "Rotary Year", width: 12 },
      { key: "attendeeName", label: "Attendee Name", width: 24 },
      { key: "mobileNo", label: "Mobile", width: 16 },
      { key: "sex", label: "Sex", width: 8 },
      { key: "address", label: "Address", width: 34, wrap: true },
      { key: "readingCount", label: "Readings", width: 10 },
      { key: "latestReadingDate", label: "Latest Reading", width: 16, format: dateOnly },
    ],
    { title: opts.title, subtitle: opts.subtitle },
  );
}
