/**
 * OCV / GOV "Live Documents" — the second section of the OCV Report Excel export.
 *
 * The rows are NOT assembled in the frontend. They come from
 * `GET /api/clubs/{clubId}/ocv-gov/report/live-tables`, which returns the exact
 * `OcvWordModuleTable` list that `OcvReportWordBuilder` renders under its own
 * "Live Documents" heading in the Word report. One source of truth
 * (`OcvGovService.LiveModules` + `QueryLiveModuleAsync`) means the Word document and the
 * Excel workbook can never drift apart: same modules, same order, same column headers,
 * same cell formatting, same per-module counts, same "No records." empty case.
 *
 * Live Documents can never appear in the OCV Report's document checklist — that table comes
 * from `GetOcvReportAsync`, driven off `ocv_document_type INNER JOIN ocv_document_category`.
 * "Live Documents" has no rows in either table (the six seeded categories are
 * static/financial/trust/grants/additional/dues), so the join drops it. Hence the separate
 * second section in the Excel.
 *
 * There is deliberately no link column: the Word report does not hyperlink live modules
 * either (their rows ARE the content — there is no stored file to open), and the
 * `/live-documents/export` API route is `[Authorize]`, so a raw hyperlink clicked from
 * Excel would 401.
 */

import { getOcvReportLiveTables } from "@/services/api";

/** One module's snapshot: sub-heading label, column headers, pre-formatted string rows. */
export interface OcvLiveDocumentTable {
  label: string;
  headers: string[];
  rows: string[][];
}

/** Section heading — same text as the Word report's `SectionHeading(body, "Live Documents")`. */
export const OCV_LIVE_DOCUMENTS_TITLE = "Live Documents";

/**
 * Italic note under the heading — same sentence (and same `dd MMM yyyy` date format) as the
 * Word report's `MutedText(...)` line directly beneath its Live Documents heading.
 */
export function ocvLiveDocumentsNote(now: Date = new Date()): string {
  const asOn = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `Current data as on ${asOn}. These modules are not uploaded files — the rows below are read live from the club's records.`;
}

/**
 * Fetch the live module snapshots. Mirrors the Word builder's tolerance: a failure here
 * must not sink the whole export (the Word builder wraps each module render in try/catch),
 * so the caller gets an empty list and the Excel still downloads.
 */
export async function fetchOcvLiveDocumentTables(
  clubId: number,
  yearId: number | null,
): Promise<OcvLiveDocumentTable[]> {
  if (!yearId) return [];
  try {
    const data = await getOcvReportLiveTables(clubId, yearId);
    if (!Array.isArray(data)) return [];
    return data.map((t: OcvLiveDocumentTable) => ({
      label: t?.label ?? "",
      headers: Array.isArray(t?.headers) ? t.headers : [],
      rows: Array.isArray(t?.rows) ? t.rows : [],
    }));
  } catch {
    return [];
  }
}
