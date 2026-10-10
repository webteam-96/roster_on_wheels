import type { DbCommands } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate } from "../../common/dotnet-format";
import { InvalidOperationException } from "../../common/exceptions";
import { ExcelJS, toBuffer } from "../../services/xlsx";
import { MEMBERSHIP_IMPORT_FROM_YEAR_START, MEMBERSHIP_IMPORT_SCOPE, MONTHLY_COLLECTED_TO_TARGET, YOUTH_IMPORT_SCOPE, liveDistrictWomenCount, roundAway, ymd } from "./goal-core";
import { GoalForms, MEMBERSHIP_BASELINE_KEY } from "./goal-forms";
import { GoalMessaging } from "./goal-messaging";
import type { GoalFoundationImportResultDto } from "./goal-setting.dtos";

/** District Foundation matrix rows (SrNo, Number1_Dont_change, Category, field / input type). */
const FOUNDATION_ROWS: [number, number, string, string][] = [
  [1, 47, "Annual Fund", "annual_fund_achieved"],
  [2, 47, "Annual Fund_Target", "annual_fund_target"],
  [3, 46, "Polio Plus Society", "polio_plus_achieved"],
  [4, 46, "Polio Plus Society_Target", "polio_plus_target"],
  [5, 41, "Endowment", "endowment_achieved"],
  [6, 41, "Endowment_Target", "endowment_target"],
  [7, 52, "CSR project with RFI", "csr_achieved"],
  [8, 52, "CSR project with RFI_Target", "csr_target"],
];
const FOUNDATION_CATEGORY_TO_KEY = new Map(FOUNDATION_ROWS.map(([, , cat, key]) => [cat.trim().toLowerCase(), key]));
/** Rotary's Monthly Contribution Report (club) columns → club field keys. */
const MCR_CLUB_COLUMNS: [number, string][] = [
  [4, "club_af_goal_amount"], [5, "club_goal_pct_achieved"], [6, "club_af_per_capita"], [7, "club_annual_fund_ytd"],
  [8, "club_polioplus_ytd"], [9, "club_other_funds_ytd"], [10, "club_endowment_ytd"], [11, "club_total_ytd"],
];
const MCR_HEADERS = ["Club No", "Name", "Rotarians", "Annual Fund Goal Amount", "Goal % Achieved", "AF Per Capita", "Annual Fund", "PolioPlus Fund", "Other Funds", "Endowment Fund", "Total"];
/** Club Foundation field → the district "Achieved" field that totals it (targets are never rolled up). */
const CLUB_TO_DISTRICT_FOUNDATION: [string, string][] = [["club_annual_fund_ytd", "annual_fund_achieved"], ["club_polioplus_ytd", "polio_plus_achieved"], ["club_endowment_ytd", "endowment_achieved"]];
const BATCH_ROWS = 500;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isDash = (s: string) => s === "-" || s === "–" || s === "—";
/** Rotary-year order of a calendar month: Jul = 1 … Jun = 12. */
const orderOf = (m: number) => (m >= 7 ? m - 6 : m + 6);

/** cell.GetString(): the cell's value as text (rich text joined, formula result, numbers as written). */
export function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
  if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
  if ("text" in o) return String(o.text ?? "");
  if ("error" in o) return String(o.error ?? "");
  return "";
}
const at = (ws: ExcelJS.Worksheet, r: number, c: number) => cellText(ws.getRow(r).getCell(c).value).trim();
const lastRowUsed = (ws: ExcelJS.Worksheet) => ws.actualRowCount ? ws.rowCount : 1;

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new InvalidOperationException("Not an Excel (.xlsx) file.");
  }
  return wb;
}

/** Every sheet as (name, cells "r,c" -> trimmed text). shortcut: exceljs instead of raw OpenXML; if a Rotary.org export will not open, read the sheet XML directly. */
async function readGrids(buf: Buffer) {
  const wb = await loadWorkbook(buf);
  return wb.worksheets.map((ws) => {
    const cells = new Map<string, string>();
    ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => cells.set(`${r},${c}`, cellText(cell.value).trim())));
    return { name: ws.name, cells };
  });
}
const rowsOf = (cells: Map<string, string>) => [...new Set([...cells.keys()].map((k) => Number(k.split(",")[0])))].sort((a, b) => a - b);
const rowCells = (cells: Map<string, string>, r: number) => [...cells.entries()].filter(([k]) => Number(k.split(",")[0]) === r).map(([k, v]) => ({ c: Number(k.split(",")[1]), v })).sort((a, b) => a.c - b.c);
const get = (cells: Map<string, string>, r: number, c: number) => cells.get(`${r},${c}`) ?? "";
const toInt = (t: string | undefined) => {
  if (!t || !t.trim()) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? roundAway(n, 0) : null;
};
const isDistrictNo = (t: string) => !!t && /^\d+$/.test(t);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** DateTime.TryParse for "30 September 2026", "2026-09-30", "September 30, 2026" or an Excel serial; null if none. */
function parseLooseDate(t: string): string | null {
  let m = /^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})$/.exec(t);
  if (m) { const mo = MONTHS.findIndex((x) => x.startsWith(m![2].toLowerCase().slice(0, 3))); if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) { const mo = MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3))); if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = Number(t);
  if (Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
  return null;
}
const dmy = (iso: string) => formatDate(iso, "d MMM yyyy");

/** Rotary.org "Comparison to 1 July": per district # Club / # Member on 1 July and on the report date. */
function parseComparisonFile(grids: Awaited<ReturnType<typeof readGrids>>, what: string, start: string, end: string) {
  const cells = grids[0]?.cells;
  if (!cells) throw new InvalidOperationException(`${what} file has no sheet.`);
  let hdr = 0, dCol = 0, clubCols: number[] = [], memCols: number[] = [];
  for (const r of rowsOf(cells).filter((r) => r <= 30)) {
    const row = rowCells(cells, r);
    dCol = row.find((x) => x.v.toLowerCase() === "district")?.c ?? 0;
    clubCols = row.filter((x) => x.v.toLowerCase() === "# club").map((x) => x.c);
    memCols = row.filter((x) => x.v.toLowerCase() === "# member").map((x) => x.c);
    if (dCol > 0 && clubCols.length >= 2 && memCols.length >= 2) { hdr = r; break; }
  }
  if (hdr === 0) throw new InvalidOperationException(`${what} file: could not find the District / # Club / # Member header. Upload Rotary.org's "Comparison to 1 July" file.`);
  let asOf: string | null = null;
  for (let r = hdr - 1; r >= 1 && asOf === null; r--) {
    const t = get(cells, r, clubCols[1]).replace(/\*/g, "").trim();
    if (t) asOf = parseLooseDate(t);
  }
  if (asOf === null) throw new InvalidOperationException(`${what} file: could not read the report date (e.g. "30 September 2026").`);
  if (asOf < start.slice(0, 10) || asOf > end.slice(0, 10)) throw new InvalidOperationException(`${what} file is dated ${dmy(asOf)}, which is not in the selected Rotary year.`);
  const rows = new Map<string, { jul1Clubs: number; jul1Members: number; clubs: number; members: number }>();
  for (const r of rowsOf(cells).filter((r) => r > hdr)) {
    const dn = get(cells, r, dCol);
    if (!isDistrictNo(dn)) continue;
    rows.set(dn, { jul1Clubs: toInt(get(cells, r, clubCols[0])) ?? 0, jul1Members: toInt(get(cells, r, memCols[0])) ?? 0, clubs: toInt(get(cells, r, clubCols[1])) ?? 0, members: toInt(get(cells, r, memCols[1])) ?? 0 });
  }
  return { rows, asOf };
}

/** Rotary.org "Interact_Statistics", sheet "By District": active clubs now and on 1 July, and the "AS OF" date. */
function parseInteractStatistics(grids: Awaited<ReturnType<typeof readGrids>>) {
  const sheet = grids.find((g) => g.name.trim().toLowerCase() === "by district");
  if (!sheet) throw new InvalidOperationException(`Interact file: sheet "By District" not found. Upload Rotary.org's "Interact_Statistics" file.`);
  const cells = sheet.cells;
  let asOf: string | null = null, hdr = 0, dCol = 0, tCol = 0, yCol = 0;
  for (const r of rowsOf(cells).filter((r) => r <= 30)) {
    const row = rowCells(cells, r);
    for (const x of row)
      if (asOf === null && /^as of/i.test(x.v)) {
        const m = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(x.v.slice(5).trim());
        if (m) { const mo = MONTHS.findIndex((n) => n.startsWith(m[2].toLowerCase().slice(0, 3))); if (mo >= 0) asOf = `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
      }
    dCol = row.find((x) => x.v.toLowerCase() === "district")?.c ?? 0;
    tCol = row.find((x) => x.v.toLowerCase() === "total active clubs")?.c ?? 0;
    yCol = row.find((x) => x.v.toLowerCase().includes("previous rotary year"))?.c ?? 0;
    if (dCol > 0 && tCol > 0 && yCol > 0) { hdr = r; break; }
  }
  if (hdr === 0) throw new InvalidOperationException(`Interact file: District / Total Active Clubs / Change from End of Previous Rotary Year header not found on "By District".`);
  if (asOf === null) throw new InvalidOperationException(`Interact file: could not read the "AS OF" date.`);
  const rows = new Map<string, { now: number; jul1: number }>();
  for (const r of rowsOf(cells).filter((r) => r > hdr)) {
    const dn = get(cells, r, dCol);
    if (!isDistrictNo(dn)) continue;
    const now = toInt(get(cells, r, tCol));
    if (now === null) continue;
    rows.set(dn, { now, jul1: now - (toInt(get(cells, r, yCol)) ?? 0) });
  }
  return { rows, asOf };
}

function validateMcrHeader(ws: ExcelJS.Worksheet) {
  MCR_HEADERS.forEach((h, i) => {
    if (!norm(at(ws, 1, i + 1)).includes(norm(h)))
      throw new InvalidOperationException(`This file doesn't match the Monthly Contribution Report format — column ${i + 1} should be "${h}". Please upload the exact MCR Excel from Rotary.`);
  });
}

/** A whole number cell, stripped of $, commas and stray characters; a dash = 0; null = leave untouched. */
function moneyValue(raw: string, keepMinus = false): number | null {
  if (!raw) return null;
  if (isDash(raw)) return 0;
  const cleaned = raw.replace(keepMinus ? /[^0-9.\-]/g : /[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function upsertBatch(conn: DbCommands, table: "goal_entries" | "goal_entries_monthly", entity: "District" | "Club", rows: [number, number, number][], yearId: number, month: number, memberId: number) {
  if (!rows.length) return;
  const p: Record<string, unknown> = { Y: yearId, M: month, By: memberId };
  const values = rows.map(([f, id, v], i) => {
    p[`f${i}`] = f; p[`e${i}`] = id; p[`v${i}`] = v;
    const club = entity === "Club" ? `@e${i}` : "0", district = entity === "District" ? `@e${i}` : "0";
    return table === "goal_entries" ? `(@f${i}, @Y, '${entity}', ${club}, ${district}, @v${i}, @By, NOW(), 0)` : `(@f${i}, @Y, '${entity}', ${club}, ${district}, @M, @v${i}, @By, NOW(), 0)`;
  });
  const cols = table === "goal_entries" ? "fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted" : "fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted";
  await conn.execute(`INSERT INTO ${table} (${cols}) VALUES ${values.join(",")} ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0`, p);
}

function headerFill(ws: ExcelJS.Worksheet, lastCol: number) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(1, c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003366" } };
    cell.alignment = { horizontal: "center" };
  }
}
function autoWidth(ws: ExcelJS.Worksheet, cols: number) {
  for (let c = 1; c <= cols; c++) {
    let w = 8;
    ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => (w = Math.max(w, cellText(cell.value).length + 2)));
    ws.getColumn(c).width = Math.min(w, 60);
  }
}

/**
 * Port of GoalSettingService.cs, layer 7: the SuperAdmin imports — the district Foundation matrix,
 * the club Monthly Contribution Report (with its roll-up into the districts), the Rotary.org
 * membership / Rotaract / Interact files — and their sample files and the MCR converter.
 */
export abstract class GoalImports extends GoalMessaging {
  /** District Foundation (transposed matrix): cumulative till-date per district, overwritten on re-import. */
  async importFoundationMonthly(memberId: number, yearId: number, file: Buffer, month = 0): Promise<GoalFoundationImportResultDto> {
    return this.db.session(async (conn) => {
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId })) === 0) throw new InvalidOperationException("Invalid Rotary year.");
      const writeMonthly = month >= 1 && month <= 12;
      const prior = new Map<string, number>();
      if (writeMonthly)
        for (const pr of await conn.query(
          `SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
           FROM goal_entries_monthly
           WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND COALESCE(isdeleted, 0) = 0
             AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
           GROUP BY fk_field_id, fk_district_id`,
          { Y: yearId, OrderM: orderOf(month) },
        )) prior.set(`${pr.f}:${pr.d}`, Number(pr.s));
      const fieldIds = new Map((await conn.query("SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0", { Keys: FOUNDATION_ROWS.map((r) => r[3]) })).map((r) => [String(r.k), Number(r.id)]));
      const districtMap = new Map<string, number>();
      for (const d of await conn.query(
        `SELECT d.pk_district_id AS id, d.DistrictNumber AS num
         FROM district_master d
         INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.isdeleted = 0 AND z.isdeleted = 0
           AND EXISTS (SELECT 1 FROM club_master c
                       WHERE c.fk_district_id = d.pk_district_id
                         AND COALESCE(c.isdeleted, 0) = 0)`,
      )) { const k = String(d.num ?? "").trim(); if (k && !districtMap.has(k)) districtMap.set(k, Number(d.id)); }

      const ws = (await loadWorkbook(file)).worksheets[0];
      ["SrNo", "Number1_Dont_change", "Category", "Input Type"].forEach((h, i) => {
        if (!norm(at(ws, 1, i + 1)).includes(norm(h)))
          throw new InvalidOperationException(`This file doesn't match the district Foundation format — column ${i + 1} should be "${h}". Please upload the exact district Foundation Excel from ${Brand.Current.productName}.`);
      });
      const result: GoalFoundationImportResultDto = { yearId, importedDistricts: 0, valuesWritten: 0, skippedRows: [], message: "" };
      const districtColumns: [number, number][] = [];
      const unknown = new Set<string>();
      for (let col = 5; col <= ws.columnCount; col++) {
        const num = at(ws, 1, col);
        if (!num) continue;
        if (districtMap.has(num)) districtColumns.push([col, districtMap.get(num)!]);
        else if (!unknown.has(num.toLowerCase())) {
          unknown.add(num.toLowerCase());
          result.skippedRows.push({ row: 1, districtNumber: num, clubNo: "", clubName: "", reason: "District number not found in the system (or it has no active club) — column skipped." });
        }
      }
      const annual: [number, number, number][] = [], monthly: [number, number, number][] = [];
      const touched = new Set<number>();
      for (let row = 2; row <= lastRowUsed(ws); row++) {
        const key = FOUNDATION_CATEGORY_TO_KEY.get(at(ws, row, 3).toLowerCase());
        if (!key || !fieldIds.has(key)) continue;
        const fieldId = fieldIds.get(key)!;
        for (const [col, districtId] of districtColumns) {
          const raw = moneyValue(at(ws, row, col));
          if (raw === null) continue;
          const value = roundAway(raw, 0);
          annual.push([fieldId, districtId, value]);
          if (writeMonthly && key in MONTHLY_COLLECTED_TO_TARGET) monthly.push([fieldId, districtId, value - (prior.get(`${fieldId}:${districtId}`) ?? 0)]);
          result.valuesWritten++;
          touched.add(districtId);
          if (annual.length >= BATCH_ROWS) await upsertBatch(conn, "goal_entries", "District", annual.splice(0), yearId, month, memberId);
          if (monthly.length >= BATCH_ROWS) await upsertBatch(conn, "goal_entries_monthly", "District", monthly.splice(0), yearId, month, memberId);
        }
      }
      await upsertBatch(conn, "goal_entries", "District", annual, yearId, month, memberId);
      await upsertBatch(conn, "goal_entries_monthly", "District", monthly, yearId, month, memberId);
      if (writeMonthly) await GoalForms.recordFoundationImportMonth(conn, yearId, "District", month, memberId);
      result.importedDistricts = touched.size;
      result.message = `Imported ${result.importedDistricts} district(s), ${result.valuesWritten} value(s). ${result.skippedRows.length} district column(s) skipped.`;
      return result;
    });
  }

  /** Club Foundation from Rotary's MCR (all districts, matched by Club No = synced ClubRotaryId), then the district roll-up. */
  async importFoundationClub(memberId: number, yearId: number, file: Buffer, month = 0): Promise<GoalFoundationImportResultDto> {
    return this.db.session(async (conn) => {
      if (Number(await conn.executeScalar("SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId })) === 0) throw new InvalidOperationException("Invalid Rotary year.");
      const writeMonthly = month >= 1 && month <= 12;
      const prior = new Map<string, number>();
      if (writeMonthly)
        for (const pr of await conn.query(
          `SELECT fk_field_id AS f, fk_club_id AS c, COALESCE(SUM(NumericValue), 0) AS s
           FROM goal_entries_monthly
           WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_district_id = 0 AND COALESCE(isdeleted, 0) = 0
             AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
           GROUP BY fk_field_id, fk_club_id`,
          { Y: yearId, OrderM: orderOf(month) },
        )) prior.set(`${pr.f}:${pr.c}`, Number(pr.s));
      const clubMap = new Map<string, number>();
      for (const c of await conn.query(
        `SELECT pk_club_id AS id, ClubRotaryId AS rid FROM club_master
         WHERE COALESCE(isdeleted, 0) = 0 AND COALESCE(IsSyncedFromRotaryOrg, 0) = 1
           AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''`,
      )) { const k = String(c.rid).trim(); if (k && !clubMap.has(k)) clubMap.set(k, Number(c.id)); }
      const fieldIds = new Map((await conn.query("SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0", { Keys: MCR_CLUB_COLUMNS.map((c) => c[1]) })).map((r) => [String(r.k), Number(r.id)]));

      const ws = (await loadWorkbook(file)).worksheets[0];
      validateMcrHeader(ws);
      const result: GoalFoundationImportResultDto = { yearId, importedDistricts: 0, valuesWritten: 0, skippedRows: [], message: "" };
      const touched = new Set<number>();
      const annual: [number, number, number][] = [], monthly: [number, number, number][] = [];
      const isNonClubRow = (name: string) => { const n = name.toLowerCase(); return (n.includes("district") && n.includes("contribution")) || n.includes("total"); };
      for (let row = 2; row <= lastRowUsed(ws); row++) {
        const no = at(ws, row, 1), name = at(ws, row, 2);
        if (!no && !name) continue;
        if (isNonClubRow(name)) continue;
        if (!no) { result.skippedRows.push({ row, districtNumber: "", clubNo: "", clubName: name, reason: "Row has no Club No — skipped." }); continue; }
        const clubId = clubMap.get(no);
        if (clubId === undefined) { result.skippedRows.push({ row, districtNumber: "", clubNo: no, clubName: name, reason: "Club No not found or club is not synced from Rotary.org — skipped." }); continue; }
        for (const [col, key] of MCR_CLUB_COLUMNS) {
          const fieldId = fieldIds.get(key);
          if (fieldId === undefined) continue;
          const raw = moneyValue(at(ws, row, col));
          if (raw === null) continue;
          const value = roundAway(raw, 2);
          annual.push([fieldId, clubId, value]);
          if (writeMonthly && key in MONTHLY_COLLECTED_TO_TARGET) monthly.push([fieldId, clubId, value - (prior.get(`${fieldId}:${clubId}`) ?? 0)]);
          result.valuesWritten++;
          touched.add(clubId);
          if (annual.length >= BATCH_ROWS) await upsertBatch(conn, "goal_entries", "Club", annual.splice(0), yearId, month, memberId);
          if (monthly.length >= BATCH_ROWS) await upsertBatch(conn, "goal_entries_monthly", "Club", monthly.splice(0), yearId, month, memberId);
        }
      }
      await upsertBatch(conn, "goal_entries", "Club", annual, yearId, month, memberId);
      await upsertBatch(conn, "goal_entries_monthly", "Club", monthly, yearId, month, memberId);
      if (writeMonthly) await GoalForms.recordFoundationImportMonth(conn, yearId, "Club", month, memberId);
      const rolled = await GoalImports.rollUpClubFoundationToDistricts(conn, yearId, month, memberId, touched);
      result.importedDistricts = touched.size;
      result.message = `Imported ${touched.size} synced club(s), ${result.valuesWritten} value(s). ${result.skippedRows.length} club row(s) skipped (not found or not synced from Rotary.org). ${rolled} district(s) updated with the sum of their synced clubs.`;
      return result;
    });
  }

  /** Each touched district's Foundation Achieved = the sum of its synced, active clubs' stored YTD. */
  private static async rollUpClubFoundationToDistricts(conn: DbCommands, yearId: number, month: number, memberId: number, clubs: Set<number>): Promise<number> {
    if (!clubs.size) return 0;
    const writeMonthly = month >= 1 && month <= 12;
    const districtIds = (await conn.query("SELECT DISTINCT fk_district_id AS id FROM club_master WHERE pk_club_id IN @Ids AND COALESCE(fk_district_id, 0) > 0", { Ids: [...clubs] })).map((r) => Number(r.id));
    if (!districtIds.length) return 0;
    const fieldIds = new Map((await conn.query("SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0", { Keys: CLUB_TO_DISTRICT_FOUNDATION.flat() })).map((r) => [String(r.k), Number(r.id)]));
    const sums = new Map<string, number>();
    for (const x of await conn.query(
      `SELECT c.fk_district_id AS d, f.FieldKey AS k, COALESCE(SUM(e.NumericValue), 0) AS s
       FROM goal_entries e
       JOIN goal_fields f ON f.pk_field_id = e.fk_field_id
       JOIN club_master c ON c.pk_club_id = e.fk_club_id
                         AND COALESCE(c.isdeleted, 0) = 0 AND c.IsSyncedFromRotaryOrg = 1
       WHERE e.EntityType = 'Club' AND e.fk_year_id = @Y AND COALESCE(e.isdeleted, 0) = 0
         AND f.FieldKey IN @ClubKeys AND c.fk_district_id IN @Ds
       GROUP BY c.fk_district_id, f.FieldKey`,
      { Y: yearId, ClubKeys: CLUB_TO_DISTRICT_FOUNDATION.map((m) => m[0]), Ds: districtIds },
    )) sums.set(`${x.d}:${x.k}`, Number(x.s));
    const prior = new Map<string, number>();
    if (writeMonthly)
      for (const pr of await conn.query(
        `SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
         FROM goal_entries_monthly
         WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND COALESCE(isdeleted, 0) = 0
           AND fk_district_id IN @Ds
           AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
         GROUP BY fk_field_id, fk_district_id`,
        { Y: yearId, Ds: districtIds, OrderM: orderOf(month) },
      )) prior.set(`${pr.f}:${pr.d}`, Number(pr.s));
    for (const [clubKey, districtKey] of CLUB_TO_DISTRICT_FOUNDATION) {
      const dField = fieldIds.get(districtKey);
      if (dField === undefined) continue;
      for (const d of districtIds) {
        const total = roundAway(sums.get(`${d}:${clubKey}`) ?? 0, 2);
        await conn.execute(
          `INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
           VALUES (@F, @Y, 'District', 0, @D, @V, @By, NOW(), 0)
           ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0`,
          { F: dField, Y: yearId, D: d, V: total, By: memberId },
        );
        if (writeMonthly && districtKey in MONTHLY_COLLECTED_TO_TARGET)
          await conn.execute(
            `INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
             VALUES (@F, @Y, 'District', 0, @D, @M, @V, @By, NOW(), 0)
             ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0`,
            { F: dField, Y: yearId, D: d, M: month, V: total - (prior.get(`${dField}:${d}`) ?? 0), By: memberId },
          );
      }
    }
    if (writeMonthly) await GoalForms.recordFoundationImportMonth(conn, yearId, "District", month, memberId);
    return districtIds.length;
  }

  /**
   * District Membership from Rotary.org (2026-27 on): "Comparison to 1 July" (Rotary) + "Members Admitted by
   * Gender", optionally the Rotaract comparison and Interact_Statistics. Clubs / Members (July 1st + Achieved)
   * from the files, Women July 1st frozen at the first import, Achieved = that + admitted − terminated.
   * The month stores what was added since the previous imported month. Only districts of numbered zones (not Zone 0).
   */
  async importDistrictMembership(memberId: number, yearId: number, membersFile: Buffer, membersFileName: string, genderFile: Buffer, rotaractFile: Buffer | null = null, rotaractFileName: string | null = null, interactFile: Buffer | null = null): Promise<GoalFoundationImportResultDto> {
    if (rotaractFile && !(rotaractFileName ?? "").toLowerCase().includes("rotaract")) throw new InvalidOperationException(`The third file must be Rotary.org's Rotaract "Comparison to 1 July" file (its name contains "Rotaract").`);
    if (membersFileName && membersFileName.toLowerCase().includes("rotaract")) throw new InvalidOperationException(`This is the Rotaract file. Upload the Rotary "Comparison to 1 July" file.`);
    return this.db.session(async (conn) => {
      const yr = await conn.queryFirstOrDefault("SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", { Y: yearId });
      if (!yr || !yr.s) throw new InvalidOperationException("Invalid Rotary year.");
      const start = String(yr.s).slice(0, 10);
      const s = ymd(start)!;
      const end = yr.e ? String(yr.e).slice(0, 10) : new Date(Date.UTC(s.y + 1, s.m - 1, s.d - 1)).toISOString().slice(0, 10);
      if (start < MEMBERSHIP_IMPORT_FROM_YEAR_START) throw new InvalidOperationException("Membership import is used from Rotary year 2026-27 onwards.");

      const { rows: members, asOf } = parseComparisonFile(await readGrids(membersFile), "Members", start, end);
      const month = ymd(asOf)!.m;
      let rotaract: Map<string, { jul1Clubs: number; jul1Members: number; clubs: number; members: number }> | null = null;
      if (rotaractFile) {
        const r = parseComparisonFile(await readGrids(rotaractFile), "Rotaract", start, end);
        if (r.asOf !== asOf) throw new InvalidOperationException(`The Rotaract file is dated ${dmy(r.asOf)} but the Rotary file ${dmy(asOf)} - download both for the same date.`);
        rotaract = r.rows;
      }
      const youthKeys = ["rotaract_clubs_achieved", "rotaract_existing_clubs", "rotaract_existing_members", "rotaract_members_achieved", "interact_clubs_achieved", "interact_existing_clubs"];
      const youthIds = new Map<string, number>();
      for (const x of await conn.query("SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE isdeleted = 0 AND FieldKey IN @Keys", { Keys: youthKeys })) if (!youthIds.has(String(x.k))) youthIds.set(String(x.k), Number(x.id));
      for (const k of rotaract ? youthKeys.slice(0, 4) : []) if (!youthIds.has(k)) throw new InvalidOperationException(`Youth Service field '${k}' is missing.`);
      let interact: Map<string, { now: number; jul1: number }> | null = null;
      if (interactFile) {
        const r = parseInteractStatistics(await readGrids(interactFile));
        if (r.asOf !== asOf) throw new InvalidOperationException(`The Interact file is as of ${dmy(r.asOf)} but the Rotary file ${dmy(asOf)} - download both for the same date.`);
        interact = r.rows;
      }
      for (const k of interact ? youthKeys.slice(4) : []) if (!youthIds.has(k)) throw new InvalidOperationException(`Youth Service field '${k}' is missing.`);
      const upsertDistrict = (fieldId: number, districtId: number, value: number) => conn.execute(
        `INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
         VALUES (@F, @Y, 'District', 0, @D, @V, @By, NOW(), 0)
         ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0`,
        { F: fieldId, Y: yearId, D: districtId, V: value, By: memberId },
      );

      // women admitted / terminated by district (Rotary sheets only, never Rotaract)
      const womenIn = new Map<string, number>(), womenOut = new Map<string, number>();
      const gender = await readGrids(genderFile);
      for (const [word, into] of [["Admitted", womenIn], ["Terminated", womenOut]] as const) {
        const sh = gender.find((x) => x.name.toLowerCase().includes(word.toLowerCase()) && x.name.toLowerCase().includes("rotary") && !x.name.toLowerCase().includes("rotaract"));
        if (!sh) throw new InvalidOperationException(`Gender file: sheet "${word}_Rotary" not found. Upload Rotary.org's "Members Admitted by Gender" file.`);
        let hdr = 0, dCol = 0, fCol = 0;
        for (const r of rowsOf(sh.cells).filter((r) => r <= 30)) {
          const row = rowCells(sh.cells, r);
          dCol = row.find((x) => x.v.toLowerCase() === "district")?.c ?? 0;
          fCol = row.find((x) => x.v.toLowerCase() === "female")?.c ?? 0;
          if (dCol > 0 && fCol > 0) { hdr = r; break; }
        }
        if (hdr === 0) throw new InvalidOperationException(`Gender file: District / Female header not found on sheet "${sh.name}".`);
        for (const r of rowsOf(sh.cells).filter((r) => r > hdr)) {
          const dn = get(sh.cells, r, dCol);
          if (!isDistrictNo(dn)) continue;
          into.set(dn, (into.get(dn) ?? 0) + (toInt(get(sh.cells, r, fCol)) ?? 0));
        }
      }

      const districts = (await conn.query(
        `SELECT d.pk_district_id AS id, d.DistrictNumber AS num
         FROM district_master d
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
         WHERE d.isdeleted = 0 AND z.isdeleted = 0
           AND z.ZoneName LIKE 'Zone %' AND z.ZoneName <> 'Zone 0'
         ORDER BY CAST(d.DistrictNumber AS UNSIGNED)`,
      )).map((d) => ({ id: Number(d.id), num: String(d.num) }));
      const keys = ["total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved", "existing_women_members", "new_women_members_achieved"];
      const fieldIds = new Map<string, number>();
      for (const x of await conn.query(
        `SELECT f.FieldKey AS k, f.pk_field_id AS id FROM goal_fields f
         JOIN goal_categories c ON c.pk_category_id = f.fk_category_id AND c.Name = 'Membership'
         WHERE f.isdeleted = 0 AND f.FieldKey IN @Keys`,
        { Keys: keys },
      )) if (!fieldIds.has(String(x.k))) fieldIds.set(String(x.k), Number(x.id));
      for (const k of keys) if (!fieldIds.has(k)) throw new InvalidOperationException(`Membership field '${k}' is missing.`);

      const importedBefore = await GoalForms.membershipImportedMonths(conn, yearId);
      const firstImport = importedBefore.size === 0;
      const idx = (m: number) => (m - s.m + 12) % 12;
      const priorMonths = [...importedBefore].filter((m) => idx(m) < idx(month));
      const prior = new Map<string, number>();
      if (priorMonths.length)
        for (const pr of await conn.query(
          `SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
           FROM goal_entries_monthly
           WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND isdeleted = 0
             AND PeriodMonth IN @Ms AND fk_field_id IN @Fs
           GROUP BY fk_field_id, fk_district_id`,
          { Y: yearId, Ms: priorMonths, Fs: [...fieldIds.values()] },
        )) prior.set(`${pr.f}:${pr.d}`, Number(pr.s));
      const storedWomen = new Map<number, number>();
      if (!firstImport)
        for (const x of await conn.query(
          `SELECT fk_district_id AS d, NumericValue AS v FROM goal_entries
           WHERE fk_field_id = @F AND fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0
             AND isdeleted = 0 AND NumericValue IS NOT NULL`,
          { F: fieldIds.get("existing_women_members"), Y: yearId },
        )) storedWomen.set(Number(x.d), Number(x.v));

      const result: GoalFoundationImportResultDto = { yearId, importedDistricts: 0, valuesWritten: 0, skippedRows: [], message: "" };
      for (const { id: did, num } of districts) {
        const m = members.get(num.trim());
        if (!m) { result.skippedRows.push({ row: 0, districtNumber: num, clubNo: "", clubName: "", reason: "Not in the Rotary.org members file - left unchanged." }); continue; }
        const womenJul1 = storedWomen.has(did) ? storedWomen.get(did)! : await liveDistrictWomenCount(conn, did, start);
        const annual: Record<string, number> = {
          total_clubs: m.jul1Clubs, new_clubs_achieved: m.clubs, total_members: m.jul1Members, new_members_achieved: m.members,
          existing_women_members: womenJul1, new_women_members_achieved: womenJul1 + (womenIn.get(num.trim()) ?? 0) - (womenOut.get(num.trim()) ?? 0),
        };
        for (const key of keys) {
          await upsertDistrict(fieldIds.get(key)!, did, annual[key]);
          result.valuesWritten++;
        }
        for (const [achKey, baseKey] of Object.entries(MEMBERSHIP_BASELINE_KEY)) {
          const fid = fieldIds.get(achKey)!;
          await conn.execute(
            `INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
             VALUES (@F, @Y, 'District', 0, @D, @M, @V, @By, NOW(), 0)
             ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0`,
            { F: fid, Y: yearId, D: did, M: month, V: annual[achKey] - annual[baseKey] - (prior.get(`${fid}:${did}`) ?? 0), By: memberId },
          );
        }
        result.importedDistricts++;
      }
      let racWritten = 0, intWritten = 0;
      if (rotaract)
        for (const { id: did, num } of districts) {
          const rc = rotaract.get(num.trim());
          if (!rc) continue;
          await upsertDistrict(youthIds.get("rotaract_existing_clubs")!, did, rc.jul1Clubs);
          await upsertDistrict(youthIds.get("rotaract_clubs_achieved")!, did, rc.clubs);
          await upsertDistrict(youthIds.get("rotaract_existing_members")!, did, rc.jul1Members);
          await upsertDistrict(youthIds.get("rotaract_members_achieved")!, did, rc.members);
          racWritten++;
        }
      if (interact)
        for (const { id: did, num } of districts) {
          const ic = interact.get(num.trim());
          if (!ic) continue;
          await upsertDistrict(youthIds.get("interact_existing_clubs")!, did, ic.jul1);
          await upsertDistrict(youthIds.get("interact_clubs_achieved")!, did, ic.now);
          intWritten++;
        }
      if (rotaract || interact) await GoalForms.recordFoundationImportMonth(conn, yearId, YOUTH_IMPORT_SCOPE, month, memberId);
      await GoalForms.recordFoundationImportMonth(conn, yearId, MEMBERSHIP_IMPORT_SCOPE, month, memberId);
      result.message = `Membership as on ${dmy(asOf)}: ${result.importedDistricts} district(s) updated`
        + (result.skippedRows.length ? `, ${result.skippedRows.length} not in the file` : "")
        + (rotaract ? `; Rotaract clubs + Rotaractors (July 1st + Achieved) set for ${racWritten} district(s)` : "")
        + (interact ? `; Interact clubs (July 1st + Achieved) set for ${intWritten} district(s)` : "") + ".";
      return result;
    });
  }

  /** District Foundation sample: the matrix layout, one column per district with an active club, 0 baselines. */
  async buildFoundationSampleExcel(): Promise<Buffer> {
    const districts = await this.db.query(
      `SELECT d.DistrictNumber AS num
       FROM district_master d
       INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
       WHERE d.isdeleted = 0 AND z.isdeleted = 0
         AND EXISTS (SELECT 1 FROM club_master c
                     WHERE c.fk_district_id = d.pk_district_id
                       AND COALESCE(c.isdeleted, 0) = 0)
       ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber`,
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Foundation");
    ws.getRow(1).values = ["SrNo", "Number1_Dont_change", "Category", "Input Type", ...districts.map((d) => String(d.num))];
    const lastCol = 4 + Math.max(1, districts.length);
    headerFill(ws, lastCol);
    FOUNDATION_ROWS.forEach(([sr, id, cat], i) => (ws.getRow(i + 2).values = [sr, id, cat, "Number", ...districts.map(() => 0)]));
    autoWidth(ws, lastCol);
    ws.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
    return toBuffer(wb);
  }

  /** Club Foundation sample: the MCR layout, one row per synced club, 0 baselines. */
  async buildFoundationClubSampleExcel(): Promise<Buffer> {
    const clubs = await this.db.query(
      `SELECT ClubRotaryId AS rid, ClubName AS name, fk_district_id AS did
       FROM club_master
       WHERE IsSyncedFromRotaryOrg = 1 AND COALESCE(isdeleted, 0) = 0
         AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''
       ORDER BY CAST(ClubRotaryId AS UNSIGNED), ClubRotaryId`,
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MCR Report");
    ws.getRow(1).values = MCR_HEADERS;
    headerFill(ws, MCR_HEADERS.length);
    clubs.forEach((c, i) => (ws.getRow(i + 2).values = [String(c.rid), String(c.name ?? ""), ...Array(MCR_HEADERS.length - 2).fill(0)]));
    autoWidth(ws, MCR_HEADERS.length);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return toBuffer(wb);
  }

  /** Rotary.org's raw MCR → our club import file (synced clubs only, 2 decimals) plus a "Notes" sheet. Nothing is imported. */
  async convertFoundationMcrToClubFile(file: Buffer): Promise<{ file: Buffer; filled: number; missing: number }> {
    const sws = (await loadWorkbook(file)).worksheets[0];
    validateMcrHeader(sws);
    const lastCol = MCR_HEADERS.length;
    const found = new Map<string, { district: string; values: (number | null)[] }[]>();
    let district = "", inSummary = false;
    for (let r = 2; r <= lastRowUsed(sws); r++) {
      const a = at(sws, r, 1), name = at(sws, r, 2);
      if (/^district:/i.test(a)) { district = a.slice("District:".length).trim(); inSummary = false; continue; }
      if (a.toLowerCase() === "district summary") { inSummary = true; continue; }
      if (inSummary || !a || !/^\d+$/.test(a)) continue;
      if (/^district/i.test(name) && name.toLowerCase().includes("contribution")) continue;
      const values: (number | null)[] = Array(lastCol + 1).fill(null);
      for (let col = 3; col <= lastCol; col++) {
        const v = moneyValue(at(sws, r, col), true);
        if (v !== null) values[col] = roundAway(v, 2);
      }
      found.set(a, [...(found.get(a) ?? []), { district, values }]);
    }
    const clubs = await this.db.query(
      `SELECT TRIM(c.ClubRotaryId) AS rid, c.ClubName AS name, d.DistrictNumber AS dn
       FROM club_master c
       LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
       WHERE c.IsSyncedFromRotaryOrg = 1 AND COALESCE(c.isdeleted, 0) = 0
         AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
       ORDER BY CAST(c.ClubRotaryId AS UNSIGNED), c.ClubRotaryId`,
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MCR Report");
    ws.getRow(1).values = MCR_HEADERS;
    headerFill(ws, lastCol);
    let row = 2, filled = 0;
    const missing: [string, string][] = [];
    for (const c of clubs) {
      const rid = String(c.rid);
      ws.getCell(row, 1).value = rid;
      ws.getCell(row, 2).value = String(c.name ?? "");
      const hits = found.get(rid);
      if (hits && hits.length) {
        const pick = hits.find((h) => h.district === (c.dn ?? null)) ?? hits[0];
        for (let col = 3; col <= lastCol; col++) {
          ws.getCell(row, col).value = pick.values[col] ?? 0;
          ws.getCell(row, col).numFmt = col === 3 ? "0" : "0.00";
        }
        filled++;
      } else missing.push([rid, String(c.name ?? "")]);
      row++;
    }
    autoWidth(ws, lastCol);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const notes = wb.addWorksheet("Notes");
    notes.getCell(1, 1).value = "Converted from the Rotary.org Monthly Contribution Report";
    notes.getCell(1, 1).font = { bold: true };
    notes.getCell(2, 1).value = `Synced clubs filled: ${filled}`;
    notes.getCell(3, 1).value = `Synced clubs not in Rotary's file (left blank - the import keeps their current values): ${missing.length}`;
    notes.getCell(4, 1).value = "Only the first sheet (MCR Report) is imported. All amounts are rounded to 2 decimals.";
    if (missing.length) {
      let nr = 6;
      notes.getRow(nr).values = ["Club No", "Club"];
      notes.getRow(nr).font = { bold: true };
      for (const [rid, n] of missing) notes.getRow(++nr).values = [rid, n];
    }
    autoWidth(notes, 2);
    return { file: await toBuffer(wb), filled, missing: missing.length };
  }
}
