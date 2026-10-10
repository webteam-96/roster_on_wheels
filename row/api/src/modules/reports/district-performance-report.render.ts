import { Brand } from "../../brand/brand";
import { dotnetRound, formatDate, formatNumber, nowIn } from "../../common/dotnet-format";
import { emailFooter, emailHeader } from "../../services/email.service";
import { copyWorksheet, ExcelJS, toBuffer } from "../../services/xlsx";
import { roundAway } from "../goal-setting/goal-core";
import type { DistrictPerformanceGoalData } from "../goal-setting/goal-reports";

// ── DTOs (DistrictPerformanceReportDtos.cs) ──────────────────────────────────────────────────────
export interface PerformanceReportItem { label: string; value: string; url?: string | null }
export interface PerformanceReportSection {
  part: string; partSubtitle: string | null; title: string; intro: string | null; items: PerformanceReportItem[];
  tableHeaders: string[] | null; tableRows: string[][] | null; note: string | null;
}
export interface PerformanceReportHighlight { group: string | null; label: string; value: string; sub: string | null; percent: number | null; newRow: boolean }
export interface DistrictPerformanceKpi {
  zoneName: string; districtNumber: string; governorName: string | null; clubs: number; nonSyncedClubs: number; members: number; women: number; youth: number;
  joined: number; left: number; clubProjects: number; districtProjects: number; beneficiaries: number; volunteerHours: number; cmrSubmitted: number; cmrDue: number;
  awardPoints: number; clubService: number; avenues: Map<string, number>; foundation: Map<string, number>; trfAsOn: string | null;
  membershipTarget: number | null; membershipAchieved: number | null; membershipPct: number | null; trfTarget: number | null; trfAchieved: number | null; trfPct: number | null;
}
export const allClubs = (k: DistrictPerformanceKpi) => k.clubs + k.nonSyncedClubs;
export interface DistrictPerformanceReportResult {
  districtId: number; districtNumber: string; zoneName: string; yearId: number; yearLabel: string; periodLabel: string;
  governorName: string | null; governorEmail: string | null; governorMobile: string | null; subject: string; fileName: string;
  reportKicker: string; reportTitle: string; reportSubtitle: string; salutation: string; introLine: string; closingLine: string; attachmentNote: string;
  kpi: DistrictPerformanceKpi | null; districtReports: DistrictPerformanceReportResult[] | null;
  highlights: PerformanceReportHighlight[]; tilesPerRow: number; scopeNote: string | null; sections: PerformanceReportSection[];
  excel: Buffer | null; html: string | null;
}
export const newResult = (o: Partial<DistrictPerformanceReportResult>): DistrictPerformanceReportResult => ({
  districtId: 0, districtNumber: "", zoneName: "", yearId: 0, yearLabel: "", periodLabel: "", governorName: null, governorEmail: null, governorMobile: null,
  subject: "", fileName: "", reportKicker: "District Performance Report", reportTitle: "", reportSubtitle: "", salutation: "", introLine: "", closingLine: "",
  attachmentNote: "", kpi: null, districtReports: null, highlights: [], tilesPerRow: 3, scopeNote: null, sections: [], excel: null, html: null, ...o,
});
export const section = (o: Partial<PerformanceReportSection> & { title: string }): PerformanceReportSection => ({
  part: "", partSubtitle: null, intro: null, items: [], tableHeaders: null, tableRows: null, note: null, ...o,
});
export const tile = (o: Partial<PerformanceReportHighlight> & { label: string; value: string }): PerformanceReportHighlight => ({ group: null, sub: null, percent: null, newRow: false, ...o });

// ── Per-club rows (private classes of the C# service) ────────────────────────────────────────────
export interface ClubRow { id: number; clubName: string; clubRotaryId: string | null; city: string | null; state: string | null; clubCharterDate: string | null; memberCount: number }
export interface MemberAgg {
  members: number; membersJul1: number; women: number; womenJul1: number; youth: number; added: number; leftCount: number; deletedAllTime: number;
  youthJul1: number; youthAdded: number; youthLeft: number; womenAdded: number; womenLeft: number; leftJul1: number; womenLeftJul1: number; youthLeftJul1: number;
}
export interface WebsiteRow { clubId: number; clubName: string | null; subdomain: string | null; clientDomain: string | null; status: string | null; endDate: string | null; host: string | null; url: string | null }
export interface LeaderRow { clubId: number; designation: string | null; name: string | null; mobile: string | null; email: string | null }
export interface ClubStats {
  club: ClubRow; m: MemberAgg; projects: Map<string, number>; totalProjects: number; clubService: number; beneficiaries: number; manHours: number; cost: number;
  cmrSubmitted: number; website: WebsiteRow | null; districtDuesPaid: boolean; goalCategoriesSet: Set<number>; awardPoints: number;
  president: LeaderRow | null; secretary: LeaderRow | null; cmrByMonth: Map<number, string>; cmrPending: number; cmrNotStarted: number; trfUsd: number; mod: Map<string, number>;
}
export interface CmrGridRow { club: ClubRow; byMonth: Map<number, string>; submitted: number }

// ── Constants ────────────────────────────────────────────────────────────────────────────────────
export const PROJECT_AVENUES: [string, string][] = [
  ["community_service", "Community Service"], ["vocational_service", "Vocational Service"], ["international_service", "International Service"],
  ["new_generation_service", "New Generation Service"], ["public_image_initiative", "Public Image Initiative"],
];
export const CLUB_SERVICE_KEY = "club_service";
export const PCT_HEADER = "Percentage Achieved";
export const OTHER_AVENUE = "Other";
export const ZONE_TOTAL_LABEL = "Zone total";
export const RAG_RED = "RED", RAG_AMBER = "AMBER", RAG_GREEN = "GREEN", RAG_BELOW = "Below 10 members";
export const membershipBand = (members: number) => (members >= 41 ? RAG_GREEN : members >= 26 ? RAG_AMBER : members >= 10 ? RAG_RED : RAG_BELOW);
export const ROTARY_MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
/** Club Goal Setting is parked behind "Coming soon": the "Goals - Clubs" sheet carries that notice. */
export const CLUB_GOALS_COMING_SOON = true;

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────
export const N = (v: number) => formatNumber(v, "N0");
export const Dec = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? formatNumber(v, "N0") : formatNumber(v, "N2"));
export const Pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${roundAway(v, 1)}%`);
/** Foundation (TRF): 2 decimals, as the Goal Setting screens. */
export const Pct2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${roundAway(v, 2)}%`);
export const Money = (v: number, currency: string) => `${currency} ${formatNumber(dotnetRound(v, 0), "N0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number) => MONTHS[m - 1];
export const safeFile = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "_");
export const D = (d: string | null | undefined) => (d ? formatDate(d, "dd MMM yyyy") : "");
const E = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Progress colour: under 30% red, under 60% amber, otherwise green. */
export const ragColor = (pct: number) => (pct < 30 ? "#dc2626" : pct < 60 ? "#d97706" : "#16a34a");
const bandColor = (text: string) => (text.startsWith(RAG_RED) ? "#dc2626" : text.startsWith(RAG_AMBER) ? "#d97706" : text.startsWith(RAG_GREEN) ? "#16a34a" : null);
/** decimal.TryParse(text.TrimEnd('%'), Number, Invariant). */
export function parsePct(text: string): number | null {
  const t = text.replace(/%+$/, "").trim();
  return /^[+-]?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, "")) : null;
}
const isPctHeader = (h: string) => h === PCT_HEADER || h.endsWith("%");
const today = () => nowIn(Brand.Current.locale.defaultTimeZone);

// ── Email body (also the screen's "Print") ───────────────────────────────────────────────────────
export function buildEmailBody(r: DistrictPerformanceReportResult, banner: string | null): string {
  const navy = "#1a365d", blue = "#2d7fc7", ink = "#1e293b", muted = "#64748b", line = "#e2e8f0";
  let sb = emailHeader().replace("max-width: 620px", "max-width: 820px");
  if (banner && banner.trim())
    sb += `<p style='font-size:13px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:10px 12px;border-radius:6px;margin:0 0 16px 0'>${E(banner)}</p>`;
  sb += `
            <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:0 0 18px 0'>
              <tr><td style='border-left:5px solid ${blue};padding:4px 0 4px 14px'>
                <div style='font-size:11px;letter-spacing:1.5px;color:${muted};text-transform:uppercase'>${E(r.reportKicker)}</div>
                <div style='font-size:26px;font-weight:bold;color:${navy};line-height:1.2'>${E(r.reportTitle)}</div>
                <div style='font-size:12px;color:${muted}'>${E(r.reportSubtitle)}</div>
              </td></tr>
            </table>`;
  sb += `<p style='font-size:14px;color:#333;margin:0 0 18px 0'>${E(r.salutation)}<br/>${E(r.introLine)}</p>`;

  if (r.highlights.length > 0) {
    const perRow = r.tilesPerRow === 4 ? 4 : 3;
    const tdWidth = perRow === 4 ? "25%" : "33%";
    const groups: [string | null, PerformanceReportHighlight[]][] = [];
    for (const h of r.highlights) {
      const g = groups.find((x) => x[0] === h.group);
      if (g) g[1].push(h); else groups.push([h.group, [h]]);
    }
    for (const [key, group] of groups) {
      sb += `<div style='font-size:13px;font-weight:bold;color:${navy};margin:12px 0 6px 0'>${E(key ?? "At a glance")}</div>`;
      sb += "<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:separate;border-spacing:6px;margin:0 -6px 6px -6px'>";
      const rows: PerformanceReportHighlight[][] = [];
      for (const t of group) {
        if (rows.length === 0 || rows[rows.length - 1].length === perRow || t.newRow) rows.push([]);
        rows[rows.length - 1].push(t);
      }
      for (const tiles of rows) {
        sb += "<tr>";
        for (let j = 0; j < perRow; j++) {
          if (j >= tiles.length) { sb += `<td width='${tdWidth}'></td>`; continue; }
          const h = tiles[j];
          const valueColor = h.percent !== null ? ragColor(h.percent) : navy;
          sb += `<td width='${tdWidth}' valign='top' style='background:#f8fafc;border:1px solid ${line};border-radius:8px;padding:12px 12px'>
                            <div style='font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:${muted};white-space:nowrap'>${E(h.label)}</div>
                            <div style='font-size:22px;font-weight:bold;color:${valueColor};line-height:1.3;white-space:nowrap'>${E(h.value)}</div>
                            <div style='font-size:11px;color:${muted}'>${E(h.sub)}</div>
                        </td>`;
        }
        sb += "</tr>";
      }
      sb += "</table>";
    }
  }
  if (r.scopeNote && r.scopeNote.trim()) sb += `<p style='font-size:12px;color:#334155;margin:0 0 4px 2px;line-height:1.6'>${E(r.scopeNote)}</p>`;

  let lastPart: string | null = null;
  let partNo = 0;
  for (const s of r.sections) {
    if (s.part && s.part !== lastPart) {
      lastPart = s.part;
      partNo++;
      sb += `<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:30px 0 4px 0'>
                    <tr><td style='background:${navy};border-radius:8px;padding:13px 16px'>
                      <div style='font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#bfdbfe'>Part ${partNo}</div>
                      <div style='font-size:19px;font-weight:bold;color:#ffffff;line-height:1.3'>${E(s.part)}</div>
                      ${!s.partSubtitle || !s.partSubtitle.trim() ? "" : `<div style='font-size:12px;color:#cbd5e1'>${E(s.partSubtitle)}</div>`}
                    </td></tr></table>`;
    }
    sb += `<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:20px 0 0 0'>
                <tr><td style='border-left:4px solid ${blue};background:#f1f5f9;padding:8px 12px;font-size:14px;font-weight:bold;color:${navy}'>${E(s.title)}</td></tr></table>`;
    if (s.intro && s.intro.trim()) sb += `<p style='font-size:12px;color:#334155;font-style:italic;margin:6px 0 2px 12px'>${E(s.intro)}</p>`;

    if (s.items.length > 0) {
      sb += "<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse'><tbody>";
      for (const it of s.items) {
        const sub = it.label.startsWith(" ");
        const value = !it.url || !it.url.trim() ? E(it.value) : `<a href='${E(it.url)}' target='_blank' style='color:#1d4ed8;text-decoration:underline'>${E(it.value)}</a>`;
        sb += `<tr>
                        <td style='padding:7px 12px${sub ? " 7px 28px" : ""};border-bottom:1px solid ${line};font-size:13px;color:${sub ? muted : "#334155"}'>${E(it.label.trim())}</td>
                        <td style='padding:7px 12px;border-bottom:1px solid ${line};font-size:14px;color:${ink};font-weight:bold;text-align:right;white-space:nowrap'>${value}</td></tr>`;
      }
      sb += "</tbody></table>";
    }

    if (s.tableHeaders && s.tableRows && s.tableRows.length > 0) {
      const h = s.tableHeaders;
      const rankTable = h.length > 1 && h[0] === "#";
      sb += "<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin-top:4px'><thead><tr>";
      for (let c = 0; c < h.length; c++)
        sb += `<th style='padding:7px 10px;border-bottom:2px solid ${line};font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:${muted};text-align:${c === 0 || (rankTable && c === 1) ? "left" : "right"}${c === 0 && !rankTable && h.length >= 4 ? ";width:26%" : ""}'>${E(h[c])}</th>`;
      sb += "</tr></thead><tbody>";
      for (const row of s.tableRows) {
        sb += row.length > 0 && row[0] === ZONE_TOTAL_LABEL ? "<tr style='background:#e8f0fb;font-weight:bold'>" : "<tr>";
        for (let c = 0; c < row.length; c++) {
          const cp = c < h.length && isPctHeader(h[c]) ? parsePct(row[c]) : null;
          if (cp !== null) {
            sb += `<td style='padding:7px 10px;border-bottom:1px solid ${line};font-size:13px;font-weight:bold;color:${ragColor(cp)};text-align:right;white-space:nowrap'>${E(row[c])}</td>`;
            continue;
          }
          const left = c === 0 || (rankTable && c === 1);
          const band = c === 0 ? bandColor(row[c]) : null;
          sb += `<td style='padding:7px 10px;border-bottom:1px solid ${line};font-size:13px;color:${band ?? (left ? "#334155" : ink)};${band !== null ? "font-weight:bold;" : ""}text-align:${left ? "left" : "right"};white-space:${left ? "normal" : "nowrap"}'>${E(row[c])}</td>`;
        }
        sb += "</tr>";
      }
      sb += "</tbody></table>";
    }
    if (s.note && s.note.trim()) sb += `<p style='font-size:12px;color:#334155;font-style:italic;margin:5px 0 0 12px'>${E(s.note)}</p>`;
  }

  sb += `
            <p style='font-size:14px;color:#333;line-height:1.7;margin:26px 0 8px 0'>
                ${E(r.closingLine)}
            </p>
            <table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;margin:14px 0 6px 0'>
              <tr><td style='background:#f8fafc;border:1px solid ${line};border-radius:8px;padding:12px 14px;font-size:12px;color:#334155;line-height:1.7'>
                📎 ${E(r.attachmentNote)}
              </td></tr>
            </table>
            <p style='font-size:12px;color:#334155;font-style:italic;margin:10px 0 0 0'>All figures are as on ${formatDate(today(), "dd MMM yyyy")} and are sourced from the ${E(Brand.Current.productName)} portal.</p>`;
  sb += emailFooter();
  return sb;
}

// ── Excel helpers ────────────────────────────────────────────────────────────────────────────────
type WS = ExcelJS.Worksheet;
type Cell = ExcelJS.Cell;
const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const fill = (cell: Cell, hex: string) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const font = (cell: Cell, f: Partial<ExcelJS.Font>) => (cell.font = { ...cell.font, ...f });
const align = (cell: Cell, a: Partial<ExcelJS.Alignment>) => (cell.alignment = { ...cell.alignment, ...a });
const each = (ws: WS, r1: number, c1: number, r2: number, c2: number, fn: (cell: Cell, r: number, c: number) => void) => {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ws.getCell(r, c), r, c);
};
/** Range.Style.Border.Outside/InsideBorder = Thin with their colours. */
function boxBorders(ws: WS, r1: number, c1: number, r2: number, c2: number, outer: string, inner: string) {
  const o = { style: "thin" as const, color: { argb: argb(outer) } };
  const i = { style: "thin" as const, color: { argb: argb(inner) } };
  each(ws, r1, c1, r2, c2, (cell, r, c) => (cell.border = { top: r === r1 ? o : i, bottom: r === r2 ? o : i, left: c === c1 ? o : i, right: c === c2 ? o : i }));
}
const topMedium = (ws: WS, r: number, c1: number, c2: number) => each(ws, r, c1, r, c2, (cell) => (cell.border = { ...cell.border, top: { style: "medium" } }));
const merge = (ws: WS, r1: number, c1: number, r2: number, c2: number) => { if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2); };
/** Columns().AdjustToContents(firstRow, lastRow, minWidth, maxWidth), approximately. */
function adjustToContents(ws: WS, firstRow: number, lastRow: number, min: number, max: number) {
  const widths: number[] = [];
  for (let r = firstRow; r <= lastRow; r++)
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value as unknown;
      const text = v && typeof v === "object" && "text" in (v as object) ? String((v as { text: unknown }).text) : String(v ?? "");
      widths[c] = Math.max(widths[c] ?? 0, text.length + 2);
    });
  for (let c = 1; c < widths.length; c++) ws.getColumn(c).width = Math.min(max, Math.max(min, widths[c] ?? min));
}
/** Blue underlined external link (a malformed address stays plain text). */
function linkCell(cell: Cell, url: string | null | undefined) {
  if (!url || !url.trim()) return;
  try {
    cell.value = { text: String(cell.value ?? ""), hyperlink: url };
    font(cell, { color: { argb: argb("#1d4ed8") }, underline: "single" });
  } catch {
    /* plain text */
  }
}
function styleFigureCell(cell: Cell, header: string, text: string, col: number) {
  let color: string | null = null;
  const pct = isPctHeader(header) ? parsePct(text) : null;
  if (pct !== null) color = ragColor(pct);
  else if (col === 0) color = bandColor(text);
  if (color === null) return;
  font(cell, { bold: true, color: { argb: argb(color) } });
}
const numFmt = (n: number, frac = "#,##0.##") => (Number.isInteger(n) ? "#,##0" : frac);
/** Numbers written as numbers (so they sum / sort); % and text stay text. */
export function tryNumber(raw: string): number | null {
  if (!raw || !raw.trim() || raw.includes("%")) return null;
  const v = raw.replace(/^[A-Z]{3}\s+/, "").replace(/[\p{Sc},+]/gu, "").trim();
  return /^-?(\d+\.?\d*|\.\d+)$/.test(v) ? Number(v) : null;
}

// ── Summary sheet (= email body) ─────────────────────────────────────────────────────────────────
export function buildSummarySheet(wb: ExcelJS.Workbook, r: DistrictPerformanceReportResult) {
  const navy = "#1a365d", blue = "#2d7fc7", labelBg = "#f1f5f9", border = "#cbd5e1";
  const cols = Math.max(5, ...r.sections.map((x) => x.tableHeaders?.length ?? 0));
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 44;
  ws.getColumn(2).width = 34;
  for (let i = 3; i <= cols; i++) ws.getColumn(i).width = 18;
  let row = 1;

  const band = (text: string, size: number, fg: string, bg: string, bold: boolean, height: number, italic = false) => {
    merge(ws, row, 1, row, cols);
    const c = ws.getCell(row, 1);
    c.value = text;
    font(c, { size, bold, italic, color: { argb: argb(fg) } });
    fill(c, bg);
    align(c, { horizontal: "center", vertical: "middle" });
    ws.getRow(row).height = height;
    row++;
  };
  band(`${r.reportKicker} — ${r.reportTitle}`, 18, "#FFFFFF", navy, true, 34);
  band(r.reportSubtitle, 10, "#475569", "#eef2f7", false, 20);
  if (r.governorName && r.governorName.trim())
    band(`District Governor: ${r.governorName}${r.governorEmail !== null ? "  ·  " + r.governorEmail : ""}${r.governorMobile && r.governorMobile.trim() ? "  ·  " + r.governorMobile : ""}`, 10, "#475569", "#eef2f7", false, 18);
  band(`Generated ${formatDate(today(), "dd MMM yyyy, hh:mm tt")}`, 8, "#94a3b8", "#FFFFFF", false, 14, true);
  row++;

  if (r.highlights.length > 0) {
    merge(ws, row, 1, row, cols);
    const ag = ws.getCell(row, 1);
    ag.value = "At a Glance";
    font(ag, { bold: true, color: { argb: argb("#FFFFFF") } });
    fill(ag, navy);
    ws.getRow(row).height = 22;
    row++;
    let lastGroup: string | null = null;
    for (const h of r.highlights) {
      if (h.group !== null && h.group !== lastGroup) {
        lastGroup = h.group;
        merge(ws, row, 1, row, cols);
        const gh = ws.getCell(row, 1);
        gh.value = h.group;
        font(gh, { bold: true, color: { argb: argb("#FFFFFF") } });
        fill(gh, blue);
        row++;
      }
      const k = ws.getCell(row, 1);
      k.value = h.label;
      font(k, { bold: true, color: { argb: argb("#334155") } });
      fill(k, labelBg);
      const v = ws.getCell(row, 2);
      v.value = h.value;
      font(v, { bold: true, size: 13, color: { argb: argb(h.percent !== null ? ragColor(h.percent) : navy) } });
      align(v, { horizontal: "right" });
      merge(ws, row, 3, row, cols);
      const d = ws.getCell(row, 3);
      d.value = h.sub ?? "";
      font(d, { color: { argb: argb("#64748b") } });
      const o = { style: "thin" as const, color: { argb: argb(border) } };
      each(ws, row, 1, row, cols, (cell, _r, c) => (cell.border = { top: o, bottom: o, ...(c === 1 ? { left: o } : {}), ...(c === cols ? { right: o } : {}) }));
      row++;
    }
    if (r.scopeNote && r.scopeNote.trim()) {
      merge(ws, row, 1, row, cols);
      const sn = ws.getCell(row, 1);
      sn.value = r.scopeNote;
      font(sn, { size: 10, color: { argb: argb("#334155") } });
      align(sn, { wrapText: true });
      ws.getRow(row).height = 26;
      row++;
    }
    row++;
  }

  let lastPart: string | null = null;
  let partNo = 0;
  for (const s of r.sections) {
    if (s.part && s.part !== lastPart) {
      lastPart = s.part;
      partNo++;
      row++;
      merge(ws, row, 1, row, cols);
      const pb = ws.getCell(row, 1);
      pb.value = `PART ${partNo} — ${s.part}${!s.partSubtitle || !s.partSubtitle.trim() ? "" : "   ·   " + s.partSubtitle}`;
      font(pb, { bold: true, size: 14, color: { argb: argb("#FFFFFF") } });
      fill(pb, navy);
      align(pb, { vertical: "middle" });
      ws.getRow(row).height = 28;
      row += 2;
    }
    merge(ws, row, 1, row, cols);
    const t = ws.getCell(row, 1);
    t.value = s.title;
    font(t, { bold: true, color: { argb: argb("#FFFFFF") } });
    fill(t, blue);
    ws.getRow(row).height = 22;
    row++;
    if (s.intro && s.intro.trim()) {
      merge(ws, row, 1, row, cols);
      const si = ws.getCell(row, 1);
      si.value = s.intro;
      font(si, { italic: true, size: 10, color: { argb: argb("#334155") } });
      row++;
    }
    for (const it of s.items) {
      const k = ws.getCell(row, 1);
      k.value = it.label;
      font(k, { bold: true, color: { argb: argb("#334155") } });
      fill(k, labelBg);
      const v = ws.getCell(row, 2);
      v.value = it.value;
      align(v, { horizontal: "right" });
      linkCell(v, it.url);
      boxBorders(ws, row, 1, row, 2, border, border);
      row++;
    }
    if (s.tableHeaders && s.tableRows && s.tableRows.length > 0) {
      const tcols = s.tableHeaders.length;
      const headRow = row;
      for (let c = 0; c < tcols; c++) {
        const hc = ws.getCell(row, c + 1);
        hc.value = s.tableHeaders[c];
        font(hc, { bold: true });
        fill(hc, "#e2e8f0");
        align(hc, { wrapText: true });
      }
      row++;
      const rankTable = s.tableHeaders[0] === "#";
      for (const tr of s.tableRows) {
        for (let c = 0; c < tcols && c < tr.length; c++) {
          const dc = ws.getCell(row, c + 1);
          dc.value = tr[c];
          align(dc, { wrapText: true, vertical: "top", ...(c >= 1 && !(rankTable && c === 1) ? { horizontal: "right" as const } : {}) });
          styleFigureCell(dc, s.tableHeaders[c], tr[c], c);
        }
        row++;
      }
      boxBorders(ws, headRow, 1, row - 1, tcols, border, "#e2e8f0");
    }
    if (s.note && s.note.trim()) {
      merge(ws, row, 1, row, cols);
      const n = ws.getCell(row, 1);
      n.value = s.note;
      font(n, { italic: true, size: 10, color: { argb: argb("#334155") } });
      row++;
    }
    row++;
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ── District workbook ────────────────────────────────────────────────────────────────────────────
export interface DistrictWorkbookInput {
  r: DistrictPerformanceReportResult; clubs: ClubStats[]; categories: { id: number; name: string }[]; hasOtherAvenue: boolean; websites: WebsiteRow[];
  months: number[]; goals: DistrictPerformanceGoalData; currency: string; nonSynced: ClubRow[]; cmrRows: CmrGridRow[]; awardsEnabled: boolean;
  zonalByGoal: { goal: string; points: number; maxPoints: number | null }[];
}

/** Listing-sheet style (same look as the daily statistics report). */
function listStyle(ws: WS, cols: number, lastDataRow: number, numberCols: number[]) {
  each(ws, 1, 1, 1, cols, (c) => {
    fill(c, "#1F4E79");
    font(c, { bold: true, color: { argb: argb("#FFFFFF") } });
    align(c, { horizontal: "center", wrapText: true });
  });
  ws.getRow(1).height = 30;
  boxBorders(ws, 1, 1, Math.max(1, lastDataRow), cols, "#8EAADB", "#D9E1F2");
  for (let rr = 2; rr <= lastDataRow; rr++) if (rr % 2 === 0) each(ws, rr, 1, rr, cols, (c) => fill(c, "#EAF1FB"));
  if (lastDataRow >= 2) for (const nc of numberCols) for (let rr = 2; rr <= lastDataRow; rr++) align(ws.getCell(rr, nc), { horizontal: "right" });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, lastDataRow), column: cols } };
  adjustToContents(ws, 1, Math.max(1, lastDataRow), 8, 60);
}
const headers = (ws: WS, h: string[]) => h.forEach((x, i) => (ws.getCell(1, i + 1).value = x));
function emptyNote(ws: WS, cols: number, text: string) {
  ws.getCell(2, 1).value = text;
  merge(ws, 2, 1, 2, cols);
  font(ws.getCell(2, 1), { italic: true, color: { argb: argb("#64748b") } });
}
function setCell(cell: Cell, v: unknown, decFmt = "#,##0.0") {
  if (v === null || v === undefined) return;
  if (typeof v === "number") {
    cell.value = v;
    cell.numFmt = Number.isInteger(v) ? "#,##0" : decFmt;
  } else cell.value = String(v);
}

export async function buildDistrictWorkbook(x: DistrictWorkbookInput): Promise<Buffer> {
  const { r, clubs, categories, hasOtherAvenue, websites, months, goals, currency, nonSynced, cmrRows, awardsEnabled, zonalByGoal } = x;
  const wb = new ExcelJS.Workbook();
  buildSummarySheet(wb, r);
  const avenueLabels = PROJECT_AVENUES.map((a) => a[1]);
  if (hasOtherAvenue) avenueLabels.push(OTHER_AVENUE);

  // District — every district-level figure on one sheet.
  {
    const ws = wb.addWorksheet("District");
    const navy = "#1a365d", blue = "#2d7fc7", border = "#cbd5e1";
    ws.getColumn(1).width = 44;
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 18;
    let row = 1;
    merge(ws, row, 1, row, 5);
    const t = ws.getCell(row, 1);
    t.value = `District ${r.districtNumber} — District Details`;
    font(t, { bold: true, size: 16, color: { argb: argb("#FFFFFF") } });
    fill(t, navy);
    align(t, { horizontal: "center" });
    ws.getRow(row).height = 30;
    row++;
    merge(ws, row, 1, row, 5);
    ws.getCell(row, 1).value = `${r.zoneName}   ·   Rotary Year ${r.yearLabel}   ·   ${r.periodLabel}`;
    align(ws.getCell(row, 1), { horizontal: "center" });
    font(ws.getCell(row, 1), { color: { argb: argb("#475569") } });
    row += 2;

    const band = (text: string) => {
      merge(ws, row, 1, row, 5);
      const c = ws.getCell(row, 1);
      c.value = text;
      font(c, { bold: true, color: { argb: argb("#FFFFFF") } });
      fill(c, blue);
      ws.getRow(row).height = 20;
      row++;
    };
    const kv = (label: string, value: string, url: string | null = null) => {
      ws.getCell(row, 1).value = label.trim();
      if (label.startsWith(" ")) align(ws.getCell(row, 1), { indent: 2 });
      const v = ws.getCell(row, 2);
      v.value = value;
      align(v, { horizontal: "right" });
      font(v, { bold: true });
      linkCell(v, url);
      boxBorders(ws, row, 1, row, 2, border, border);
      row++;
    };
    if (r.governorName && r.governorName.trim()) {
      band("District Governor");
      kv("Name", r.governorName);
      kv("Email", r.governorEmail ?? "Not on record");
      kv("Mobile", r.governorMobile ?? "");
      row++;
    }
    const districtPart = r.sections[0]?.part ?? "";
    for (const s of r.sections.filter((y) => y.part === districtPart)) {
      band(s.title);
      if (s.intro && s.intro.trim()) {
        merge(ws, row, 1, row, 5);
        const si = ws.getCell(row, 1);
        si.value = s.intro;
        font(si, { italic: true, size: 10, color: { argb: argb("#334155") } });
        row++;
      }
      for (const it of s.items) kv(it.label, it.value, it.url ?? null);
      if (s.tableHeaders && s.tableRows && s.tableRows.length > 0) {
        const cols = s.tableHeaders.length;
        for (let c = 0; c < cols; c++) {
          const hc = ws.getCell(row, c + 1);
          hc.value = s.tableHeaders[c];
          font(hc, { bold: true });
          fill(hc, "#e2e8f0");
          align(hc, { wrapText: true });
        }
        const headRow = row;
        row++;
        for (const tr of s.tableRows) {
          for (let c = 0; c < cols && c < tr.length; c++) {
            const dc = ws.getCell(row, c + 1);
            dc.value = tr[c];
            if (c >= 1) align(dc, { horizontal: "right" });
            styleFigureCell(dc, s.tableHeaders[c], tr[c], c);
          }
          row++;
        }
        boxBorders(ws, headRow, 1, row - 1, cols, border, border);
      }
      if (s.note && s.note.trim()) {
        merge(ws, row, 1, row, 5);
        const n = ws.getCell(row, 1);
        n.value = s.note;
        font(n, { italic: true, size: 10, color: { argb: argb("#334155") } });
        row++;
      }
      row++;
    }
    if (zonalByGoal.length > 0) {
      band("Zonal Awards — Points by Goal");
      ["Goal", "Points received", "Max points"].forEach((h, c) => {
        const hc = ws.getCell(row, c + 1);
        hc.value = h;
        font(hc, { bold: true });
        fill(hc, "#e2e8f0");
      });
      const headRow = row;
      row++;
      for (const z of zonalByGoal) {
        ws.getCell(row, 1).value = z.goal;
        align(ws.getCell(row, 1), { wrapText: true });
        ws.getCell(row, 2).value = z.points;
        ws.getCell(row, 2).numFmt = "#,##0.##";
        if (z.maxPoints !== null) {
          ws.getCell(row, 3).value = z.maxPoints;
          ws.getCell(row, 3).numFmt = "#,##0.##";
        }
        row++;
      }
      ws.getCell(row, 1).value = "TOTAL";
      ws.getCell(row, 2).value = zonalByGoal.reduce((a, z) => a + z.points, 0);
      ws.getCell(row, 2).numFmt = "#,##0.##";
      each(ws, row, 1, row, 3, (c) => {
        font(c, { bold: true });
        fill(c, "#cfe0f4");
      });
      boxBorders(ws, headRow, 1, row, 3, border, border);
    }
    ws.views = [{ state: "frozen", ySplit: 2 }];
  }

  // All Clubs — one row per club, every module count across the columns.
  {
    const ws = wb.addWorksheet("All Clubs");
    type Col = { h: string; v: (s: ClubStats) => unknown; num: boolean; sum: boolean };
    const cols: Col[] = [
      { h: "Club Name", v: (s) => s.club.clubName, num: false, sum: false },
      { h: "Club ID (Rotary)", v: (s) => s.club.clubRotaryId ?? "", num: false, sum: false },
      { h: "City", v: (s) => s.club.city ?? "", num: false, sum: false },
      { h: "Charter Date", v: (s) => D(s.club.clubCharterDate), num: false, sum: false },
      { h: "RAG Band", v: (s) => membershipBand(s.m.members), num: false, sum: false },
      { h: "Potential Members (till date)", v: (s) => s.mod.get("Potential Members") ?? 0, num: true, sum: true },
    ];
    for (const cat of categories) cols.push({ h: `Goals: ${cat.name}`, v: (s) => (s.goalCategoriesSet.has(cat.id) ? "Yes" : "No"), num: false, sum: false });
    for (const av of avenueLabels) cols.push({ h: av, v: (s) => s.projects.get(av) ?? 0, num: true, sum: true });
    cols.push(
      { h: "Total Projects", v: (s) => s.totalProjects, num: true, sum: true },
      { h: "Club Service", v: (s) => s.clubService, num: true, sum: true },
      { h: "Beneficiaries", v: (s) => s.beneficiaries, num: true, sum: true },
      { h: "Volunteer Hours", v: (s) => s.manHours, num: true, sum: true },
      { h: `Project Cost (${currency})`, v: (s) => dotnetRound(s.cost, 0), num: true, sum: true },
      { h: "Club Monthly Report Submitted", v: (s) => s.cmrSubmitted, num: true, sum: true },
      { h: "Club Monthly Report Not Submitted", v: (s) => s.cmrPending + s.cmrNotStarted, num: true, sum: true },
      { h: "OCV/GOV Documents", v: (s) => s.mod.get("OCV/GOV Documents") ?? 0, num: true, sum: true },
      { h: "TRF Contributions", v: (s) => s.mod.get("TRF Contributions") ?? 0, num: true, sum: true },
      { h: "TRF Amount (USD)", v: (s) => dotnetRound(s.trfUsd, 0), num: true, sum: true },
      { h: "PPH Camps", v: (s) => s.mod.get("PPH Camps") ?? 0, num: true, sum: true },
      { h: "Active Club Website", v: (s) => (s.website === null ? "No" : (s.website.host ?? "Yes")), num: false, sum: false },
    );
    if (awardsEnabled) cols.push({ h: "District Award Points", v: (s) => s.awardPoints, num: true, sum: true });
    cols.push(
      { h: "President", v: (s) => s.president?.name ?? "", num: false, sum: false },
      { h: "President Mobile", v: (s) => s.president?.mobile ?? "", num: false, sum: false },
      { h: "President Email", v: (s) => s.president?.email ?? "", num: false, sum: false },
      { h: "Secretary", v: (s) => s.secretary?.name ?? "", num: false, sum: false },
      { h: "Secretary Mobile", v: (s) => s.secretary?.mobile ?? "", num: false, sum: false },
      { h: "Secretary Email", v: (s) => s.secretary?.email ?? "", num: false, sum: false },
    );
    headers(ws, ["Sr.No.", ...cols.map((c) => c.h)]);
    const websiteCol = cols.findIndex((c) => c.h === "Active Club Website") + 2;
    const bandCol = cols.findIndex((c) => c.h === "RAG Band") + 2;
    let row = 2;
    for (const s of clubs) {
      ws.getCell(row, 1).value = row - 1;
      cols.forEach((c, i) => setCell(ws.getCell(row, i + 2), c.v(s)));
      if (s.website?.url) linkCell(ws.getCell(row, websiteCol), s.website.url);
      styleFigureCell(ws.getCell(row, bandCol), "", membershipBand(s.m.members), 0);
      row++;
    }
    const lastData = row - 1;
    if (clubs.length === 0) emptyNote(ws, cols.length + 1, "No active clubs.");
    else {
      ws.getCell(row, 2).value = "TOTAL";
      cols.forEach((c, i) => {
        if (!c.sum) return;
        setCell(ws.getCell(row, i + 2), clubs.reduce((a, s) => a + (Number(c.v(s)) || 0), 0));
      });
    }
    const numberCols = [1, ...cols.flatMap((c, i) => (c.num ? [i + 2] : []))];
    listStyle(ws, cols.length + 1, Math.max(1, lastData), numberCols);
    if (clubs.length > 0) {
      each(ws, row, 1, row, cols.length + 1, (c) => {
        font(c, { bold: true });
        fill(c, "#CFE0F4");
      });
      topMedium(ws, row, 1, cols.length + 1);
      for (const nc of numberCols) align(ws.getCell(row, nc), { horizontal: "right" });
    }
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  }

  // Synced / Non-Synced Clubs.
  const clubList = (name: string, rows: ClubRow[], emptyText: string) => {
    const ws = wb.addWorksheet(name);
    const h = ["Sr.No.", "Club Name", "Club ID (Rotary)", "City", "State", "Charter Date"];
    headers(ws, h);
    let row = 2;
    for (const c of rows) {
      ws.getRow(row).values = [row - 1, c.clubName, c.clubRotaryId ?? "", c.city ?? "", c.state ?? "", D(c.clubCharterDate)];
      row++;
    }
    if (row === 2) emptyNote(ws, h.length, emptyText);
    listStyle(ws, h.length, Math.max(1, row - 1), [1]);
  };
  clubList("Synced Clubs", clubs.map((s) => s.club), "No active clubs.");
  clubList("Non-Synced Clubs", nonSynced, "Every club in the district is synced with Rotary.org.");

  // Goal Setting (the Goal Setting reports' YTD sheets, copied unchanged).
  const copyGoalSheet = async (bytes: Buffer | null, sheetName: string, emptyText: string) => {
    if (bytes) {
      try {
        const src = new ExcelJS.Workbook();
        await src.xlsx.load(bytes as unknown as ArrayBuffer);
        const ytd = src.worksheets.find((w) => w.name.toLowerCase().startsWith("ytd")) ?? src.worksheets[0];
        if (ytd) {
          copyWorksheet(ytd, wb, sheetName);
          return;
        }
      } catch {
        const partial = wb.getWorksheet(sheetName);
        if (partial) wb.removeWorksheet(partial.id);
      }
    }
    const ws = wb.addWorksheet(sheetName);
    ws.getCell(1, 1).value = emptyText;
    font(ws.getCell(1, 1), { italic: true });
    ws.getColumn(1).width = 60;
  };
  await copyGoalSheet(goals.districtWorkbook, "Goals - District", "The district has not entered any goals yet.");
  // shortcut: only the CLUB_GOALS_COMING_SOON notice is ported (RIZones' live setting); port the per-category club sheet split when club goals launch.
  if (CLUB_GOALS_COMING_SOON) {
    const soon = wb.addWorksheet("Goals - Clubs");
    soon.getCell(1, 1).value = "Club Goal Setting is being finalised and will be available shortly.";
    font(soon.getCell(1, 1), { italic: true });
    soon.getColumn(1).width = 70;
  }

  // Projects Ranking.
  {
    const ws = wb.addWorksheet("Projects Ranking");
    const h = ["Rank", "Club Name", ...avenueLabels, "Total Projects", "Beneficiaries", "Volunteer Hours", `Project Cost (${currency})`];
    headers(ws, h);
    let row = 2;
    for (const s of [...clubs].sort((a, b) => b.totalProjects - a.totalProjects || ordinal(a.club.clubName, b.club.clubName))) {
      ws.getRow(row).values = [row - 1, s.club.clubName, ...avenueLabels.map((av) => s.projects.get(av) ?? 0), s.totalProjects, s.beneficiaries, s.manHours, dotnetRound(s.cost, 0)];
      ws.getCell(row, h.length).numFmt = "#,##0";
      row++;
    }
    if (row === 2) emptyNote(ws, h.length, "No active clubs.");
    listStyle(ws, h.length, Math.max(1, row - 1), [1, ...Array.from({ length: h.length - 2 }, (_, i) => i + 3)]);
  }

  // Club Monthly Report Grid.
  {
    const ws = wb.addWorksheet("Club Monthly Report Grid");
    const h = ["Sr.No.", "Club Name", ...months.map(monthName), "Submitted"];
    headers(ws, h);
    let row = 2;
    for (const s of cmrRows) {
      ws.getCell(row, 1).value = row - 1;
      ws.getCell(row, 2).value = s.club.clubName;
      let c = 3;
      for (const mo of months) {
        const val = s.byMonth.get(mo) ?? "";
        const cell = ws.getCell(row, c++);
        cell.value = val;
        if (val === "Submitted") font(cell, { color: { argb: argb("#15803d") } });
        else if (val === "Not submitted") font(cell, { color: { argb: argb("#b91c1c") } });
      }
      ws.getCell(row, c).value = s.submitted;
      row++;
    }
    if (row === 2) emptyNote(ws, h.length, "No active clubs.");
    listStyle(ws, h.length, Math.max(1, row - 1), [1, h.length]);
  }

  // Club Websites.
  {
    const ws = wb.addWorksheet("Club Websites");
    const h = ["Sr.No.", "Club Name", "Website"];
    headers(ws, h);
    let row = 2;
    for (const w of [...websites].sort((a, b) => ordinal(a.clubName ?? "", b.clubName ?? ""))) {
      ws.getRow(row).values = [row - 1, w.clubName ?? "", w.host ?? w.clientDomain ?? w.subdomain ?? ""];
      linkCell(ws.getCell(row, 3), w.url);
      row++;
    }
    if (row === 2) emptyNote(ws, h.length, "No club in this district has an active club website.");
    listStyle(ws, h.length, Math.max(1, row - 1), [1]);
  }
  return toBuffer(wb);
}

/** OrderBy on strings in .NET (culture compare), close enough to the invariant collation. */
export const ordinal = (a: string, b: string) => a.localeCompare(b, "en");

// ── RI Director (all zones) workbook ─────────────────────────────────────────────────────────────
const FUND_NAMES = ["Total Giving", "Annual Fund", "Polio Plus Fund", "Endowment Fund", "CSR"];
export const ZONE_FUNDS = FUND_NAMES;

export async function buildZoneWorkbook(r: DistrictPerformanceReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  buildSummarySheet(wb, r);
  const reports = r.districtReports ?? [];

  // Column model = every item label / goal metric in first-seen order across all districts.
  const keys: string[] = [];
  const seen = new Set<string>();
  const values: Map<string, string>[] = [];
  for (const dr of reports) {
    const map = new Map<string, string>();
    const put = (key: string, value: string) => {
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
      map.set(key, value);
    };
    for (const s of dr.sections) {
      const area = s.part.startsWith("Clubs") ? "Clubs" : "District";
      for (const it of s.items) put(`${area}: ${s.title} — ${it.label.trim()}`, it.value);
      if (!s.tableHeaders || !s.tableRows || s.tableHeaders.length < 2 || s.tableHeaders[0] === "#") continue;
      for (const g of s.tableRows) {
        if (s.title === "Clubs & Members" && g.length > 0 && g[0] !== "Active clubs") continue;
        for (let c = 1; c < s.tableHeaders.length && c < g.length; c++) {
          const h = s.tableHeaders[c].replace(/\s*\(as on [^)]*\)/g, "");
          put(`${area}: ${s.title} — ${g[0]} — ${h}`, g[c]);
        }
      }
    }
    values.push(map);
  }

  const ws = wb.addWorksheet("All Districts");
  const lead = ["Zone", "District", "District Governor", "DG Email", "DG Mobile"];
  lead.forEach((h, i) => (ws.getCell(1, i + 1).value = h));
  keys.forEach((k, i) => (ws.getCell(1, lead.length + i + 1).value = k));
  const cols = lead.length + keys.length;

  let row = 2;
  const totalRows: number[] = [];
  for (const zone of [...new Set(reports.map((x) => x.zoneName))]) {
    const idx = reports.flatMap((x, i) => (x.zoneName === zone ? [i] : []));
    const sums = new Map<number, number>();
    for (const i of idx) {
      const dr = reports[i];
      ws.getRow(row).values = [dr.zoneName, dr.districtNumber, dr.governorName ?? "", dr.governorEmail ?? "", dr.governorMobile ?? ""];
      for (let c = 0; c < keys.length; c++) {
        const raw = values[i].get(keys[c]);
        if (raw === undefined) continue;
        const cell = ws.getCell(row, lead.length + c + 1);
        const n = tryNumber(raw);
        if (n !== null) {
          cell.value = n;
          cell.numFmt = numFmt(n);
          sums.set(c, (sums.get(c) ?? 0) + n);
        } else cell.value = raw;
      }
      row++;
    }
    ws.getCell(row, 1).value = zone;
    ws.getCell(row, 2).value = ZONE_TOTAL_LABEL;
    for (const [c, v] of sums) {
      const cell = ws.getCell(row, lead.length + c + 1);
      cell.value = v;
      cell.numFmt = numFmt(v);
    }
    totalRows.push(row);
    row++;
  }
  const lastRow = Math.max(1, row - 1);
  each(ws, 1, 1, 1, cols, (c) => {
    fill(c, "#1F4E79");
    font(c, { bold: true, color: { argb: argb("#FFFFFF") } });
    align(c, { wrapText: true, vertical: "top" });
  });
  ws.getRow(1).height = 60;
  boxBorders(ws, 1, 1, lastRow, cols, "#8EAADB", "#D9E1F2");
  for (const tr of totalRows) {
    each(ws, tr, 1, tr, cols, (c) => {
      font(c, { bold: true });
      fill(c, "#CFE0F4");
    });
    topMedium(ws, tr, 1, cols);
  }
  [12, 12, 26, 28, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let c = lead.length + 1; c <= cols; c++) ws.getColumn(c).width = 16;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  if (lastRow > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: cols } };

  // The three breakdowns, zone by zone then district by district.
  const kpis = reports.flatMap((d) => (d.kpi ? [d.kpi] : []));
  const zoneNames = [...new Set(kpis.map((k) => k.zoneName))];
  const avenueNames = [...PROJECT_AVENUES.map((a) => a[1]), ...[...new Set(kpis.flatMap((k) => [...k.avenues.keys()]))].filter((a) => a === OTHER_AVENUE)];
  const breakdownSheet = (sheetName: string, hs: string[], rowOf: (d: DistrictPerformanceKpi) => number[], totalOf: (zr: DistrictPerformanceKpi[]) => number[]) => {
    const ws2 = wb.addWorksheet(sheetName);
    hs.forEach((h, i) => (ws2.getCell(1, i + 1).value = h));
    let row2 = 2;
    const zoneRows: number[] = [];
    const write = (zone: string, label: string, vals: number[], bold: boolean) => {
      ws2.getCell(row2, 1).value = zone;
      ws2.getCell(row2, 2).value = label;
      vals.forEach((v, c) => {
        const cell = ws2.getCell(row2, c + 3);
        cell.value = v;
        cell.numFmt = numFmt(v);
      });
      if (bold) {
        each(ws2, row2, 1, row2, hs.length, (c) => {
          font(c, { bold: true });
          fill(c, "#CFE0F4");
        });
        zoneRows.push(row2);
      }
      row2++;
    };
    for (const zone of zoneNames) {
      const zr = kpis.filter((k) => k.zoneName === zone);
      write(zone, "Zone total", totalOf(zr), true);
      for (const d of zr) write(zone, d.districtNumber, rowOf(d), false);
    }
    write("All zones", "Grand total", totalOf(kpis), true);
    const last2 = row2 - 1;
    each(ws2, 1, 1, 1, hs.length, (c) => {
      fill(c, "#1F4E79");
      font(c, { bold: true, color: { argb: argb("#FFFFFF") } });
      align(c, { wrapText: true });
    });
    ws2.getRow(1).height = 34;
    boxBorders(ws2, 1, 1, Math.max(1, last2), hs.length, "#8EAADB", "#D9E1F2");
    for (const zr of zoneRows) topMedium(ws2, zr, 1, hs.length);
    ws2.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    adjustToContents(ws2, 1, Math.max(1, last2), 10, 40);
  };
  const sum = (zr: DistrictPerformanceKpi[], f: (k: DistrictPerformanceKpi) => number) => zr.reduce((a, k) => a + f(k), 0);
  breakdownSheet("Clubs", ["Zone", "District", "Clubs"], (d) => [allClubs(d)], (zr) => [sum(zr, allClubs)]);
  breakdownSheet("Foundation", ["Zone", "District", ...FUND_NAMES], (d) => FUND_NAMES.map((f) => d.foundation.get(f) ?? 0), (zr) => FUND_NAMES.map((f) => sum(zr, (k) => k.foundation.get(f) ?? 0)));
  breakdownSheet(
    "Service Projects",
    ["Zone", "District", ...avenueNames, "Total Projects", "Club Service"],
    (d) => [...avenueNames.map((a) => d.avenues.get(a) ?? 0), d.clubProjects + d.districtProjects, d.clubService],
    (zr) => [...avenueNames.map((a) => sum(zr, (k) => k.avenues.get(a) ?? 0)), sum(zr, (k) => k.clubProjects + k.districtProjects), sum(zr, (k) => k.clubService)],
  );
  return toBuffer(wb);
}
