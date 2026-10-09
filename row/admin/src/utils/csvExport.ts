import XLSX from "xlsx-js-style";
import { getActiveBrand } from "@/lib/brand";
import { fileTimestamp } from "@/lib/dateUtils";

interface CsvColumn {
  key: string;
  label: string;
  width?: number;
  hyperlink?: boolean;
  linkText?: string;
  /** When true, the column's cells get Excel "Wrap Text" formatting. */
  wrap?: boolean;
  /** When true, render a green-fill bold cell whenever the value equals "100%". Used by Data Collection Done(%) columns. */
  greenWhen100Percent?: boolean;
  /** When true, render the 1-based row serial number (Sr.No.) instead of a data value. */
  index?: boolean;
  /** Fixed identity/summary column — tinted so it reads as a separate block from the
   *  dynamic data-collection fields. Set by the Data Collection reports. */
  master?: boolean;
  /** Custom cell-value formatter (overrides default formatting). e.g. day+month only for DOB/DOA. */
  format?: (val: any, row: any) => string;
}

interface ExportOptions {
  title?: string;
  subtitle?: string;
  /** Extra summary line rendered right below "Generated … | Total Records …"
   *  (e.g. "Not Downloaded: 5 | Android: 12 | iOS: 7" for the App-users report). */
  summary?: string;
  /** Optional SECOND section rendered two blank rows below the main table's footer:
   *  section heading → optional note → one sub-table per section. Purely additive — the
   *  main table above it is untouched. Used by the OCV report to render Live Documents
   *  exactly the way the Word report does; those modules can never appear in the
   *  document checklist. */
  extraTable?: ExtraTable;
}

/** One sub-table inside `ExtraTable` — the Excel counterpart of the Word report's
 *  "{Label} (n)" sub-heading followed by its own bordered grid. Cells arrive as
 *  pre-formatted strings so both documents show byte-identical values. */
interface ExtraTableSection {
  label: string;
  headers: string[];
  rows: string[][];
  /** Row rendered in place of header+body when this sub-table has no rows. */
  emptyText?: string;
}

interface ExtraTable {
  /** Section heading, rendered with the same style as the sheet title. */
  title: string;
  /** Optional italic note under the heading (e.g. what the rows are). */
  note?: string;
  /** Sub-tables, in the order they should appear. */
  sections: ExtraTableSection[];
  /** Single row rendered when there are no sub-tables at all. */
  emptyText?: string;
}

// Header style: dark blue background, white bold text
const headerStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: {
    top: { style: "thin" as const, color: { rgb: "000000" } },
    bottom: { style: "thin" as const, color: { rgb: "000000" } },
    left: { style: "thin" as const, color: { rgb: "000000" } },
    right: { style: "thin" as const, color: { rgb: "000000" } },
  },
};

// Title style: large bold primary color
const titleStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 16 },
  alignment: { horizontal: "left" as const },
};

// Subtitle style
const subtitleStyle = {
  font: { bold: false, color: { rgb: "555555" }, sz: 10, italic: true },
  alignment: { horizontal: "left" as const },
};

// Info row style (generated date, total)
const infoStyle = {
  font: { color: { rgb: "666666" }, sz: 10 },
  alignment: { horizontal: "left" as const },
};

// Data cell border
const cellBorder = {
  border: {
    top: { style: "thin" as const, color: { rgb: "D0D0D0" } },
    bottom: { style: "thin" as const, color: { rgb: "D0D0D0" } },
    left: { style: "thin" as const, color: { rgb: "D0D0D0" } },
    right: { style: "thin" as const, color: { rgb: "D0D0D0" } },
  },
};

// Alternating row colors
const evenRowStyle = {
  ...cellBorder,
  fill: { fgColor: { rgb: "F2F7FB" } },
  font: { sz: 10 },
};
const oddRowStyle = {
  ...cellBorder,
  fill: { fgColor: { rgb: "FFFFFF" } },
  font: { sz: 10 },
};

// Master (fixed identity/summary) columns on Data Collection reports — a flat tint that
// overrides the zebra so the block visually separates from the dynamic field columns.
const masterCellStyle = {
  ...cellBorder,
  fill: { fgColor: { rgb: "E8EEF4" } },
  font: { sz: 10, color: { rgb: "1F4E79" } },
};

// Footer style
const footerStyle = {
  font: { bold: true, color: { rgb: "1F4E79" }, sz: 10 },
  fill: { fgColor: { rgb: "E8EEF4" } },
  border: {
    top: { style: "medium" as const, color: { rgb: "1F4E79" } },
    bottom: { style: "thin" as const, color: { rgb: "D0D0D0" } },
    left: { style: "thin" as const, color: { rgb: "D0D0D0" } },
    right: { style: "thin" as const, color: { rgb: "D0D0D0" } },
  },
};

function formatValue(val: any): string {
  if (val == null) return "";
  if (val === true) return "Yes";
  if (val === false) return "No";
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  }
  return String(val);
}

/**
 * buildCell — one worksheet cell for a column/row pair: serial numbers, hyperlinks
 * (relative document paths get the API host prepended, absolute URLs are used as-is),
 * custom formatters, wrap-text and the Done(%) green fill.
 *
 * Extracted so the main table and `options.extraTable` build cells — and above all
 * resolve hyperlink targets — through exactly the same code path.
 */
function buildCell(col: CsvColumn, item: any, idx: number, style: any) {
  const rawVal = item[col.key];
  const cell: any = { s: style };
  if (col.index) {
    cell.v = idx + 1;
  } else if (col.hyperlink && rawVal && typeof rawVal === "string" && rawVal.trim() !== "") {
    // Document/file paths come back relative (e.g. "/Documents/..."); prepend the API host
    // so Excel can open them in the browser. Absolute (http) values are used as-is.
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
    const target = /^https?:\/\//i.test(rawVal) ? rawVal : `${apiBase}/${rawVal.replace(/^\//, "")}`;
    cell.v = col.linkText || "View";
    cell.l = { Target: target, Tooltip: "Click to open" };
    cell.s = { ...style, font: { ...style.font, color: { rgb: "0563C1" }, underline: true } };
  } else if (col.format) {
    cell.v = col.format(rawVal, item);
  } else {
    cell.v = formatValue(rawVal);
  }
  // Apply per-column wrap when requested (PPH Camp description etc.)
  if (col.wrap) {
    const baseAlign = (cell.s as any).alignment || {};
    cell.s = { ...cell.s, alignment: { ...baseAlign, wrapText: true, vertical: "top" } };
  }
  // Green-fill bold cell when Done(%) hits 100% — Data Collection reports.
  if (col.greenWhen100Percent && String(rawVal ?? "").trim() === "100%") {
    cell.s = {
      ...cell.s,
      fill: { fgColor: { rgb: "C6EFCE" } },
      font: { ...((cell.s as any).font || {}), bold: true, color: { rgb: "006100" } },
    };
  }
  return cell;
}

/**
 * exportMonthlyPivot — wide "months horizontal" report. Two-row header: each month
 * is a group header merged across its metric sub-columns; lead columns (Club Name /
 * AG Name) are merged down both header rows. One data row per entity (club).
 * Row values are read by each sub-column's flattened `key` (e.g. "m7_meeting").
 */
export function exportMonthlyPivot(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  leadCols: { key: string; label: string; width?: number }[];
  groups: { label: string; cols: { key: string; label: string; width?: number }[] }[];
  rows: any[];
}) {
  const { filename, title, subtitle, leadCols, groups, rows } = opts;
  const now = new Date();
  const dateStr = now.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Flatten all columns left→right (lead cols first, then each group's cols).
  const flat: { key: string; width?: number }[] = [
    ...leadCols.map((c) => ({ key: c.key, width: c.width })),
    ...groups.flatMap((g) => g.cols.map((c) => ({ key: c.key, width: c.width }))),
  ];
  const colCount = flat.length;

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  let row = 0;
  const put = (r: number, c: number, v: any, s: any) => { ws[XLSX.utils.encode_cell({ r, c })] = { v, s }; };

  put(row, 0, title, titleStyle); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } }); row++;
  put(row, 0, `${getActiveBrand().productName} Admin Portal`, subtitleStyle); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } }); row++;
  if (subtitle) { put(row, 0, subtitle, subtitleStyle); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } }); row++; }
  put(row, 0, `Generated: ${dateStr}  |  Clubs: ${rows.length}`, infoStyle); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } }); row++;
  row++; // blank

  // Two header rows.
  const h1 = row, h2 = row + 1;
  // Lead cols: merged down both header rows.
  leadCols.forEach((c, i) => {
    put(h1, i, c.label, headerStyle);
    put(h2, i, "", headerStyle);
    merges.push({ s: { r: h1, c: i }, e: { r: h2, c: i } });
  });
  // Group headers + their sub-columns.
  let c = leadCols.length;
  for (const g of groups) {
    const start = c;
    put(h1, start, g.label, headerStyle);
    for (const sub of g.cols) {
      put(h1, c, c === start ? g.label : "", headerStyle); // fill spanned cells so borders render
      put(h2, c, sub.label, headerStyle);
      c++;
    }
    merges.push({ s: { r: h1, c: start }, e: { r: h1, c: c - 1 } });
  }
  row = h2 + 1;

  // Data rows.
  rows.forEach((item, idx) => {
    const style = idx % 2 === 0 ? oddRowStyle : evenRowStyle;
    flat.forEach((col, ci) => {
      const raw = item[col.key];
      const v = typeof raw === "number" ? raw : formatValue(raw);
      put(row, ci, v, style);
    });
    row++;
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(row - 1, h2), c: colCount - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = flat.map((col) => ({ wch: col.width || 12 }));
  const rowHeights: any[] = [];
  rowHeights[0] = { hpt: 28 };
  rowHeights[h1] = { hpt: 20 };
  rowHeights[h2] = { hpt: 20 };
  ws["!rows"] = rowHeights;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CMR");
  XLSX.writeFile(wb, `${filename}_${fileTimestamp(now)}.xlsx`);
}

/**
 * exportOcvReport — Governor's Official Visit (OCV/GOV) report. One sheet PER club
 * with a header block (Club Name / ID / District / President / AG) then the table
 * Sr.No. | Module Name | Document Type | Uploaded (Yes/No) | Download Document
 * (hyperlink "Download Here" when uploaded), ending "End Of Report".
 */
export function exportOcvReport(opts: {
  filename: string;
  districtNumber: string;
  yearId: number;
  clubs: Array<{
    clubId: number; clubName: string; clubRotaryId?: string | null; presidentName?: string | null; agName?: string | null;
    rows: Array<{ moduleName: string; documentType: string; uploaded: boolean; downloadUrl?: string | null }>;
  }>;
}) {
  const { filename, districtNumber, yearId, clubs } = opts;
  // Live Documents section rows (fixed) → new app's live-documents export module keys.
  const LIVE_DOCS: Array<{ label: string; module: string }> = [
    { label: "Member Data", module: "members" },
    { label: "Club Meetings", module: "attendance" },
    { label: "Board Of Directors List", module: "board_of_directors" },
    { label: "Service Project List", module: "projects" },
    { label: "Club Monthly Report", module: "club_monthly_report" },
    { label: "District Citation Report", module: "district_citation" },
    { label: "Attendance Report", module: "attendance" },
    { label: "PPH Camp Report", module: "pph_camp" },
    { label: "PPH Camp Attendees Report", module: "pph_attendees" },
    { label: "TRF contribution Report", module: "trf_contributions" },
  ];
  const now = new Date();
  const ts = now.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(",", "");
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
  const COLS = 5;
  const labelStyle = { font: { bold: true, sz: 11, color: { rgb: "1F4E79" } } };
  const valStyle = { font: { sz: 11 } };
  const endStyle = { font: { italic: true, sz: 10, color: { rgb: "666666" } } };

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const list = clubs.length ? clubs : [{ clubName: "No Data", rows: [] } as any];

  for (const club of list) {
    const ws: XLSX.WorkSheet = {};
    const merges: XLSX.Range[] = [];
    let r = 0;
    const put = (row: number, c: number, v: any, s: any) => { ws[XLSX.utils.encode_cell({ r: row, c })] = { v, s }; };

    put(r, 0, "Governor's Official Visit Report", titleStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } }); r++;
    put(r, 0, `Report Generated at:  ${ts}`, infoStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } }); r++;
    r++;
    const meta: [string, string][] = [
      ["Club Name", club.clubName || ""],
      ["Club ID", club.clubRotaryId || ""],
      ["District Number", districtNumber || ""],
      ["President", club.presidentName || ""],
      ["Assistant Governor", club.agName || ""],
    ];
    for (const [label, val] of meta) {
      put(r, 0, label, labelStyle);
      put(r, 1, val, valStyle);
      merges.push({ s: { r, c: 1 }, e: { r, c: COLS - 1 } });
      r++;
    }
    r++;
    ["Sr.No.", "Module Name", "Document Type", "Uploaded", "Download Document"].forEach((h, c) => put(r, c, h, headerStyle));
    r++;
    club.rows.forEach((row: { moduleName: string; documentType: string; uploaded: boolean; downloadUrl?: string | null }, i: number) => {
      const style = i % 2 === 0 ? oddRowStyle : evenRowStyle;
      put(r, 0, i + 1, style);
      put(r, 1, row.moduleName, style);
      put(r, 2, row.documentType, style);
      put(r, 3, row.uploaded ? "Yes" : "No", style);
      if (row.uploaded && row.downloadUrl) {
        const target = /^https?:\/\//i.test(row.downloadUrl) ? row.downloadUrl : `${apiBase}/${row.downloadUrl.replace(/^\//, "")}`;
        ws[XLSX.utils.encode_cell({ r, c: 4 })] = { v: "Download Here", l: { Target: target, Tooltip: "Click to open" }, s: { ...style, font: { ...(style as any).font, color: { rgb: "0563C1" }, underline: true } } };
      } else {
        put(r, 4, "", style);
      }
      r++;
    });

    // ── Live Documents section (report shortcuts, always "Download Here") ──
    r++;
    put(r, 0, "Live Documents", titleStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } }); r++;
    ["Sr.No.", "Module Name", "", "", "Download Document"].forEach((h, c) => put(r, c, h, headerStyle));
    r++;
    LIVE_DOCS.forEach((ld, i) => {
      const style = i % 2 === 0 ? oddRowStyle : evenRowStyle;
      put(r, 0, i + 1, style);
      put(r, 1, ld.label, style);
      put(r, 2, "", style);
      put(r, 3, "", style);
      const target = `${apiBase}/api/clubs/${club.clubId}/live-documents/export?yearId=${yearId}&module=${ld.module}`;
      ws[XLSX.utils.encode_cell({ r, c: 4 })] = { v: "Download Here", l: { Target: target, Tooltip: "Click to open" }, s: { ...style, font: { ...(style as any).font, color: { rgb: "0563C1" }, underline: true } } };
      r++;
    });

    // ── Newsletters section (header only, matching the reference) ──
    r++;
    put(r, 0, "Newsletters", titleStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } }); r++;
    ["Sr.No.", "Module Name", "", "", "Download Document"].forEach((h, c) => put(r, c, h, headerStyle));
    r++;

    r++;
    put(r, 0, "End Of Report", endStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });

    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
    ws["!merges"] = merges;
    ws["!cols"] = [{ wch: 8 }, { wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 20 }];

    let base = (club.clubName || "Club").replace(/[[\]*?/\\:]/g, " ").slice(0, 28) || "Club";
    let name = base, n = 1;
    while (usedNames.has(name)) { name = `${base.slice(0, 25)} ${++n}`; }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  XLSX.writeFile(wb, `${filename}_${fileTimestamp(now)}.xlsx`);
}

export function exportToCSV(
  data: any[],
  filename: string,
  columns: CsvColumn[],
  options?: ExportOptions
) {
  if (data.length === 0) return;

  const now = new Date();
  const dateStr = now.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const reportTitle = options?.title || filename.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const colCount = columns.length;

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  let row = 0;

  // Row 0: Title (merged across all columns)
  ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: reportTitle, s: titleStyle };
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });
  row++;

  // Row 1: `${getActiveBrand().productName} Admin Portal`
  ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: `${getActiveBrand().productName} Admin Portal`, s: subtitleStyle };
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });
  row++;

  // Row 2: Subtitle (if provided)
  if (options?.subtitle) {
    ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: options.subtitle, s: subtitleStyle };
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });
    row++;
  }

  // Row 3: Generated date + total
  ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: `Generated: ${dateStr}  |  Total Records: ${data.length}`, s: infoStyle };
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });
  row++;

  // Row 3b: optional summary line (e.g. Not Downloaded / Android / iOS totals)
  if (options?.summary) {
    ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = {
      v: options.summary,
      s: { ...infoStyle, font: { ...infoStyle.font, bold: true, color: { rgb: "1F4E79" } } },
    };
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });
    row++;
  }

  // Row 4: blank separator
  row++;

  // Row 5: Column Headers
  const headerRow = row;
  columns.forEach((col, c) => {
    ws[XLSX.utils.encode_cell({ r: row, c })] = { v: col.label, s: headerStyle };
  });
  row++;

  // Data rows with alternating colors + hyperlink support
  data.forEach((item, idx) => {
    const zebra = idx % 2 === 0 ? oddRowStyle : evenRowStyle;
    columns.forEach((col, c) => {
      // Master columns keep a flat tint instead of the zebra, so the fixed block reads
      // as separate from the dynamic data-collection fields.
      const style = col.master ? masterCellStyle : zebra;
      ws[XLSX.utils.encode_cell({ r: row, c })] = buildCell(col, item, idx, style);
    });
    row++;
  });

  // Footer row
  row++; // blank
  ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: `Total: ${data.length} record(s)`, s: footerStyle };
  for (let c = 1; c < colCount; c++) {
    ws[XLSX.utils.encode_cell({ r: row, c })] = { v: "", s: footerStyle };
  }
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: colCount - 1 } });

  // ── Optional second section, two blank rows below the footer ─────────────
  // Everything above stays exactly as it was; this block only appends. The layout mirrors
  // the Word report: one heading, one italic note, then a sub-heading + grid per module.
  const extra = options?.extraTable;
  let lastRow = row;
  let lastCol = colCount - 1;
  const extraHeaderRows: number[] = [];
  if (extra) {
    const sections = extra.sections || [];
    const maxSectionCols = Math.max(1, ...sections.map((s) => Math.max(s.headers.length, 1)));
    const spanCol = Math.max(colCount, maxSectionCols) - 1;
    row += 3; // footer row + 2 blank rows

    // Section heading — same treatment as the sheet title.
    ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: extra.title, s: titleStyle };
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: spanCol } });
    row++;

    if (extra.note) {
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: extra.note, s: subtitleStyle };
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: spanCol } });
      row++;
    }

    if (sections.length === 0) {
      row++; // blank
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: extra.emptyText || "No records.", s: oddRowStyle };
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: spanCol } });
      row++;
    }

    for (const section of sections) {
      const width = Math.max(section.headers.length, 1);
      row++; // blank line before each sub-table (Word puts space above each sub-heading)

      // Sub-heading "Label (n)" — footerStyle is the existing bold-blue-on-tint band, the
      // closest available match to the Word report's blue sub-heading.
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = {
        v: `${section.label} (${section.rows.length})`,
        s: footerStyle,
      };
      for (let c = 1; c <= spanCol; c++) {
        ws[XLSX.utils.encode_cell({ r: row, c })] = { v: "", s: footerStyle };
      }
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: spanCol } });
      row++;

      if (section.rows.length === 0) {
        // Word prints a muted "No records." line and no grid at all — same here.
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: section.emptyText || "No records.", s: subtitleStyle };
        merges.push({ s: { r: row, c: 0 }, e: { r: row, c: spanCol } });
        row++;
        lastCol = Math.max(lastCol, spanCol);
        continue;
      }

      extraHeaderRows.push(row);
      section.headers.forEach((label, c) => {
        ws[XLSX.utils.encode_cell({ r: row, c })] = { v: label, s: headerStyle };
      });
      row++;

      section.rows.forEach((cells, idx) => {
        const zebra = idx % 2 === 0 ? oddRowStyle : evenRowStyle;
        for (let c = 0; c < width; c++) {
          ws[XLSX.utils.encode_cell({ r: row, c })] = { v: cells[c] ?? "", s: zebra };
        }
        row++;
      });

      lastCol = Math.max(lastCol, width - 1);
    }

    lastRow = Math.max(row - 1, lastRow);
    lastCol = Math.max(lastCol, maxSectionCols - 1);
  }

  // Set sheet range
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
  ws["!merges"] = merges;

  // Column widths (auto or provided) — extended only if a sub-table has more columns.
  const colWidths = columns.map((col) => ({
    wch: col.width || Math.max(col.label.length + 4, 15),
  }));
  for (let i = colWidths.length; i <= lastCol; i++) colWidths.push({ wch: 20 });
  ws["!cols"] = colWidths;

  // Row heights
  const rowHeights: any[] = [];
  rowHeights[0] = { hpt: 28 }; // title
  rowHeights[headerRow] = { hpt: 22 }; // header
  for (const r of extraHeaderRows) rowHeights[r] = { hpt: 22 };
  ws["!rows"] = rowHeights;

  // Create workbook and save
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}_${fileTimestamp(now)}.xlsx`);
}
