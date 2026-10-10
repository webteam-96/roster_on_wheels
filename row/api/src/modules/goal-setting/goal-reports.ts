import type { DbCommands } from "../../database/db.service";
import { Brand } from "../../brand/brand";
import { formatDate, nowIn } from "../../common/dotnet-format";
import { UnauthorizedAccessException } from "../../common/exceptions";
import { hideRotaract, notRotaract } from "../../services/club-scope.helper";
import { isDistrictAdminWithClubAccess } from "../../services/club-admin-access.helper";
import { ExcelJS, toBuffer } from "../../services/xlsx";
import { MONTHLY_COLLECTED_TO_TARGET, isAnnualOnlyCategory, roundAway } from "./goal-core";
import { GoalForms, MEMBERSHIP_BASELINE_KEY, TRF_HIGHEST_KEY, isTrfCategory, monthlyMetricLabel, youthPctText } from "./goal-forms";
import type { GoalCommentDto, GoalMonthPeriodDto, GoalThreadListDto, GoalCategoryDto } from "./goal-setting.dtos";

/** One report row of a category for one entity (GoalSettingService.GoalMetricComputed). */
export interface GoalMetricComputed {
  twoDecimalPct: boolean; label: string; groupName: string; baselineLabel: string; baseline: number | null; hasBaseline: boolean;
  displayText: string | null; baselineIsReferenceOnly: boolean; singleValue: boolean; fieldKey: string; monthlyTracked: boolean;
  target: number | null; achieved: number | null; pct: number | null; monthTotal: number; monthly: Record<number, number | null>;
  closedMonths: Set<number>; splitBase: number | null; monthlyTargets: Record<number, number | null>; targetsSuggested: boolean;
  quarterlyTargets: Record<number, number | null>; quarterlyAchieved: Record<number, number | null>;
}
const metric = (o: Partial<GoalMetricComputed>): GoalMetricComputed => ({
  twoDecimalPct: false, label: "", groupName: "", baselineLabel: "", baseline: null, hasBaseline: false, displayText: null, baselineIsReferenceOnly: false,
  singleValue: false, fieldKey: "", monthlyTracked: true, target: null, achieved: null, pct: null, monthTotal: 0, monthly: {}, closedMonths: new Set(),
  splitBase: null, monthlyTargets: {}, targetsSuggested: false, quarterlyTargets: {}, quarterlyAchieved: {}, ...o,
});
export type PerCat = { name: string; rows: GoalMetricComputed[]; months: GoalMonthPeriodDto[] }[];

export interface DistrictPerformanceGoalMetric { category: string; metric: string; baseline: number | null; target: number | null; achieved: number | null; pct: number | null; displayText: string | null; singleValue: boolean }
export interface DistrictPerformanceGoalData { districtMetrics: DistrictPerformanceGoalMetric[]; achievedAsOn: Map<string, string>; districtWorkbook: Buffer | null; clubsWorkbook: Buffer | null }
export interface DistrictSideRow { id: number; categoryId: number; categoryName: string; categorySort: number; districtId: number; districtNumber: string | null; zoneId: number; yearId: number; postedBy: number; fromName: string; text: string; created: string; fromRole: string | null }

// ── Labels shared by every report ────────────────────────────────────────────────────────────
export const reportLabel = (label: string | null | undefined) =>
  ({ "Total No of Clubs as on July 1st": "Clubs as on July 1st", "Total Members as on July 1st": "Members as on July 1st", "Existing Women Members as on July 1st": "Women Members as on July 1st", "Percentage Achieved": "Achievement(%)" } as Record<string, string>)[label ?? ""] ?? label ?? "";
export const targetHeader = (_categoryName?: string | null) => "Target for the Current year";
export const achievedHeader = (categoryName: string | null | undefined, trfAsOn: string | null | undefined) => (isTrfCategory(categoryName) && trfAsOn && trfAsOn.trim() ? `Achieved (as on ${trfAsOn})` : "Achieved");
/** Prefix the group when a label repeats inside its category ("Total Clubs" under Rotaract, Interact and RCC). */
export function qualifiedLabel(m: GoalMetricComputed, all: GoalMetricComputed[]) {
  const label = reportLabel(m.label);
  const dup = all.filter((x) => reportLabel(x.label).toLowerCase() === label.toLowerCase()).length > 1;
  return dup && m.groupName.trim() ? `${m.groupName} — ${label}` : label;
}
const isYouthCategory = (n: string | null | undefined) => (n ?? "").toLowerCase() === "youth service";
/** Oversight reports: Youth Service without its Achievement(%) columns. */
export function dropYouthPct(perCat: PerCat) {
  for (const p of perCat) if (isYouthCategory(p.name)) p.rows = p.rows.filter((x) => !x.fieldKey.endsWith("_pct"));
}
function computePct(baseline: number | null, target: number | null, achieved: number | null, membership: boolean, decimals = 1): number | null {
  if (target === null || target <= 0) return 0;
  const ach = achieved ?? 0;
  if (membership) {
    const b = baseline ?? 0;
    const planned = target - b;
    if (planned <= 0) return 0;
    return Math.max(0, Math.min(100, roundHalfEven(((ach - b) / planned) * 100, 1)));
  }
  return Math.max(0, Math.min(100, roundHalfEven((ach / target) * 100, decimals)));
}
/** Math.Round(decimal, n) — banker's rounding. */
function roundHalfEven(v: number, n: number) {
  const f = 10 ** n, x = v * f, fl = Math.floor(x), diff = x - fl;
  const r = Math.abs(diff - 0.5) < 1e-9 ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(x);
  return r / f;
}
/** Achievement % at a cumulative achieved value (capped at 100). */
function pctAtMonth(m: GoalMetricComputed, cum: number): number | null {
  const target = m.target ?? 0;
  if (m.baseline !== null && !m.baselineIsReferenceOnly) {
    const planned = target - m.baseline, gained = cum - m.baseline;
    const pct = planned > 0 ? (gained / planned) * 100 : target > 0 && cum >= target ? 100 : 0;
    return roundAway(Math.max(0, Math.min(100, pct)), 0);
  }
  return target > 0 ? Math.min(100, roundAway((cum / target) * 100, m.twoDecimalPct ? 2 : 0)) : null;
}
/** Running monthly target: the growth over 12 months in whole numbers, leftover in the last month. */
function runningMonthTargets(m: GoalMetricComputed, months: GoalMonthPeriodDto[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const start = m.baselineIsReferenceOnly ? 0 : m.baseline ?? 0;
  const saved = !m.targetsSuggested && Object.values(m.monthlyTargets).some((v) => v !== null);
  let shares: number[];
  if (saved) shares = months.map((mo) => m.monthlyTargets[mo.month] ?? 0);
  else if (m.target !== null && months.length) {
    const growth = roundAway(m.target - start, 0);
    if (growth <= 0) { for (const mo of months) out.set(mo.month, m.target); return out; }
    const each = Math.floor(growth / months.length);
    const extra = growth - each * months.length;
    shares = months.map((_, i) => each + (i === months.length - 1 ? extra : 0));
  } else { for (const mo of months) out.set(mo.month, null); return out; }
  let run = start;
  months.forEach((mo, i) => { run += shares[i]; out.set(mo.month, run); });
  return out;
}
/** One month header shared by several categories: open when ANY category has it open. */
export function unionMonths(lists: GoalMonthPeriodDto[][]): GoalMonthPeriodDto[] {
  const all = lists.filter((l) => l.length);
  if (!all.length) return [];
  return all[0].map((mo) => ({ ...mo, isAvailable: all.some((l) => l.some((x) => x.month === mo.month && x.isAvailable)) }));
}

// ── exceljs rendering of the ClosedXML report styles ─────────────────────────────────────────
const C = { navy: "FF1A365D", blue: "FF2D7FC7", labelBg: "FFF1F5F9", headBg: "FFE2E8F0", border: "FFCBD5E1", ink: "FF1E293B", white: "FFFFFFFF", sub: "FF475569", subBg: "FFEEF2F7", muted: "FF94A3B8" };
const thin = { style: "thin" as const, color: { argb: C.border } };
const BOX = { top: thin, bottom: thin, left: thin, right: thin };
type WS = ExcelJS.Worksheet;
const colLetter = (n: number) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const merge = (s: WS, r1: number, c1: number, r2: number, c2: number) => { if (r1 !== r2 || c1 !== c2) s.mergeCells(r1, c1, r2, c2); };
function setNum(s: WS, r: number, c: number, v: number | null | undefined) {
  const cell = s.getCell(r, c);
  cell.value = v === null || v === undefined ? "—" : v;
  cell.alignment = { ...cell.alignment, horizontal: "center" };
}
function setPct(s: WS, r: number, c: number, v: number | null | undefined, twoDecimals = false) {
  const cell = s.getCell(r, c);
  if (v === null || v === undefined) cell.value = "—";
  else { cell.value = v; cell.numFmt = twoDecimals && v !== Math.trunc(v) ? '0.00"%"' : '0"%"'; }
  cell.alignment = { ...cell.alignment, horizontal: "center" };
}
function setText(s: WS, r: number, c: number, text: string, wrap = false) {
  const cell = s.getCell(r, c);
  cell.value = text;
  if (wrap) cell.alignment = { ...cell.alignment, wrapText: true };
}
function header(s: WS, r: number, c: number, text?: string, wrap = false) {
  const cell = s.getCell(r, c);
  if (text !== undefined) cell.value = text;
  cell.font = { bold: true, color: { argb: C.ink } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headBg } };
  cell.alignment = { horizontal: "center", vertical: "middle", ...(wrap ? { wrapText: true } : {}) };
  cell.border = BOX;
}
function borderRow(s: WS, r: number, cols: number) {
  for (let c = 1; c <= cols; c++) s.getCell(r, c).border = BOX;
  const first = s.getCell(r, 1);
  first.font = { ...first.font, bold: true };
  first.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.labelBg } };
}
function titleBand(s: WS, cols: number, title: string, subtitle: string, r: { v: number }) {
  merge(s, r.v, 1, r.v, cols);
  const t = s.getCell(r.v, 1);
  t.value = title;
  t.font = { bold: true, size: 18, color: { argb: C.white } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  s.getRow(r.v).height = 32;
  r.v++;
  merge(s, r.v, 1, r.v, cols);
  const st = s.getCell(r.v, 1);
  st.value = subtitle;
  st.font = { size: 10, color: { argb: C.sub } };
  st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.subBg } };
  st.alignment = { horizontal: "center" };
  s.getRow(r.v).height = 18;
  r.v += 2;
}
function sectionBand(s: WS, cols: number, label: string, r: { v: number }) {
  merge(s, r.v, 1, r.v, cols);
  const c = s.getCell(r.v, 1);
  c.value = label;
  c.font = { bold: true, color: { argb: C.white } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.blue } };
  c.alignment = { vertical: "middle" };
  s.getRow(r.v).height = 20;
  r.v++;
}
function landscape(s: WS, printArea?: string, margins = true) {
  s.pageSetup = {
    ...s.pageSetup, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    ...(margins ? { margins: { top: 0.5, bottom: 0.5, left: 0.4, right: 0.4, header: 0.3, footer: 0.3 } } : {}),
    ...(printArea ? { printArea } : {}),
  };
}
const generatedStamp = () => formatDate(nowIn(Brand.Current.locale.defaultTimeZone), "dd MMM yyyy, hh:mm tt");

/**
 * Port of GoalSettingService.cs, layer 3: the goal reports — the metric rows behind every report,
 * the per-entity workbook (YTD · Quarter · Month wise), the horizontal all-clubs / district
 * workbooks, the zone workbook, the messages sheets and the report scope checks.
 */
export abstract class GoalReports extends GoalForms {
  // Defined by the messaging layer.
  abstract getGoalThreadList(memberId: number, categoryId: number, districtId: number, yearId: number): Promise<GoalThreadListDto>;
  abstract getGoalThreadMessages(memberId: number, categoryId: number, districtId: number, yearId: number, ownerMemberId: number): Promise<GoalCommentDto[]>;
  abstract getGoalZoneThreadList(memberId: number, categoryId: number, zoneId: number, yearId: number, actingAs?: string | null, filterDistrictId?: number | null): Promise<GoalThreadListDto>;
  abstract getGoalOwnerThreadMessages(memberId: number, categoryId: number, yearId: number, ownerMemberId: number, zoneId?: number | null): Promise<GoalCommentDto[]>;
  protected abstract districtSideReportRows(conn: DbCommands, memberId: number, yearId: number, zoneId: number, categoryId: number, districtId: number): Promise<DistrictSideRow[]>;

  /** One category's metric rows for one entity, with baseline / target / achieved / % resolved. */
  protected async computeCategoryMetrics(conn: DbCommands, categoryId: number, yearId: number, entityType: string, clubId: number, districtId: number, autoFillLive: boolean): Promise<{ name: string; rows: GoalMetricComputed[]; months: GoalMonthPeriodDto[] }> {
    const form = await this.buildMonthlyForm(conn, categoryId, yearId, entityType, clubId, districtId, "", false);
    if (!form || !form.fields.length) return { name: "", rows: [], months: [] };
    const fieldList = await this.loadFieldsWithValues(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive);
    const live = new Map<string, number | null>(), labelByKey = new Map<string, string>();
    for (const fv of fieldList) { live.set(fv.fieldKey, fv.numericValue); labelByKey.set(fv.fieldKey, fv.fieldLabel); }
    const closedMonths = new Set(form.months.filter((m) => !m.isAvailable).map((m) => m.month));
    const trf = isTrfCategory(form.categoryName);
    let rows: GoalMetricComputed[] = [];
    for (const f of form.fields) {
      const baseKey = MEMBERSHIP_BASELINE_KEY[f.fieldKey];
      const hasBaseline = baseKey !== undefined;
      const baseline = hasBaseline ? live.get(baseKey) ?? null : null;
      const highKey = TRF_HIGHEST_KEY[f.fieldKey];
      const trfHighest = !hasBaseline && highKey !== undefined;
      const highestVal = trfHighest ? live.get(highKey) ?? null : null;
      let target: number | null = null;
      let ownTarget = false;
      if (f.fieldKey in MONTHLY_COLLECTED_TO_TARGET) {
        const tKey = MONTHLY_COLLECTED_TO_TARGET[f.fieldKey];
        if (tKey) target = live.get(tKey) ?? null;
        else ownTarget = true;
      }
      target ??= f.annualTarget;
      const liveAch = live.get(f.fieldKey);
      let achieved: number | null = liveAch !== undefined && liveAch !== null ? liveAch : deriveAchieved(f.monthly, form.months, hasBaseline, f.total);
      if (ownTarget) { target = achieved ?? target; achieved = null; }
      const bl = hasBaseline ? labelByKey.get(baseKey) : undefined;
      rows.push(metric({
        fieldKey: f.fieldKey, monthlyTracked: f.monthlyTracked, displayText: f.displayText, label: monthlyMetricLabel(f),
        groupName: f.groupName.trim() ? f.groupName : monthlyMetricLabel(f),
        baselineLabel: bl && bl.trim() ? bl : trfHighest ? "Highest" : "As on July 1st",
        baseline: f.baseline ?? baseline ?? highestVal, hasBaseline: hasBaseline || trfHighest, baselineIsReferenceOnly: trfHighest,
        target, achieved, pct: computePct(baseline, target, achieved, hasBaseline, trf ? 2 : 1), twoDecimalPct: trf,
        monthTotal: f.total, monthly: f.monthly, monthlyTargets: f.monthlyTargets, targetsSuggested: f.targetsAreSuggested,
        quarterlyTargets: f.quarterlyTargets, quarterlyAchieved: f.quarterlyAchieved, splitBase: f.splitBase, closedMonths,
      }));
    }
    // TRF: Total Giving as a full metric (it has no monthly-collected field).
    if (trf && !rows.some((x) => x.fieldKey === "total_giving_achieved")) {
      const tg = (k: string) => live.get(k) ?? null;
      rows.push(metric({
        fieldKey: "total_giving_achieved", label: "Total Giving", groupName: "Total Giving", baselineLabel: "Highest",
        baseline: tg("total_contributions_highest"), hasBaseline: true, baselineIsReferenceOnly: true, target: tg("total_contributions_target"),
        achieved: tg("total_giving_achieved"), pct: tg("total_giving_pct"), twoDecimalPct: true,
        monthly: Object.fromEntries(form.months.map((m) => [m.month, null])), closedMonths,
      }));
    }
    // Public Image + Youth Service: one column per field, in the form's own order and labels.
    if (["public image", "youth service"].includes(form.categoryName.toLowerCase())) {
      const byKey = new Map<string, GoalMetricComputed>();
      for (const have of rows) if (!byKey.has(have.fieldKey)) byKey.set(have.fieldKey, have);
      const ordered: GoalMetricComputed[] = [];
      const suggestions: string[] = [];
      let suggestionRow: GoalMetricComputed | null = null;
      for (const fv of fieldList) {
        if (fv.groupName.toLowerCase() === "suggestions") {
          if (fv.textValue && fv.textValue.trim()) suggestions.push(fv.textValue.trim());
          if (!suggestionRow) { suggestionRow = metric({ fieldKey: "suggestions", label: "Suggestions", groupName: fv.groupName, baselineLabel: "As on July 1st", singleValue: true }); ordered.push(suggestionRow); }
          continue;
        }
        const row = byKey.get(fv.fieldKey);
        if (row) { row.singleValue = true; row.hasBaseline = false; ordered.push(row); }
        else
          ordered.push(metric({
            fieldKey: fv.fieldKey, label: fv.fieldLabel, groupName: fv.groupName, baselineLabel: "As on July 1st", singleValue: true,
            target: fv.dataType === "Boolean" || fv.dataType === "Text" ? null : fv.numericValue,
            displayText: fv.dataType === "Boolean" ? (fv.boolValue === null ? null : fv.boolValue ? "Yes" : "No") : fv.dataType === "Text" ? fv.textValue : youthPctText(fv),
          }));
      }
      if (suggestionRow && suggestions.length) suggestionRow.displayText = suggestions.map((s, i) => `${i + 1}) ${s}`).join("\n");
      rows = ordered;
    }
    return { name: form.categoryName, rows, months: form.months };
  }

  /** Every category's metrics for one entity; null when the entity has no goal data at all. */
  protected async computeEntityPerCat(conn: DbCommands, entityType: string, clubId: number, districtId: number, yearId: number, autoFillLive: boolean, only: Set<number> | null = null): Promise<{ perCat: PerCat; months0: GoalMonthPeriodDto[] } | null> {
    let cats = await this.getCategories();
    if (only) cats = cats.filter((c) => only.has(c.id));
    const perCat: PerCat = [];
    for (const cat of cats) {
      const r = await this.computeCategoryMetrics(conn, cat.id, yearId, entityType, clubId, districtId, autoFillLive);
      if (r.rows.length) perCat.push({ name: r.name || cat.name, rows: r.rows, months: r.months });
    }
    if (!perCat.length) return null;
    return { perCat, months0: unionMonths(perCat.map((p) => p.months)) };
  }

  /** The per-entity workbook: YTD (Till Date) · Quarter · Month wise. Null when there is no goal data. */
  protected async renderEntityWorkbook(conn: DbCommands, entityType: string, clubId: number, districtId: number, yearId: number, entityTitle: string, subtitle: string, autoFillLive: boolean, only: Set<number> | null = null, dropYouth = false): Promise<ExcelJS.Workbook | null> {
    const trfAsOn = await this.foundationAsOn(conn, yearId, entityType);
    let cats = await this.getCategories();
    if (only) cats = cats.filter((c) => only.has(c.id));
    const perCat: PerCat = [];
    for (const cat of cats) {
      const r = await this.computeCategoryMetrics(conn, cat.id, yearId, entityType, clubId, districtId, autoFillLive);
      if (r.rows.length) perCat.push({ name: r.name || cat.name, rows: r.rows, months: r.months });
    }
    if (!perCat.length) return null;
    if (dropYouth) dropYouthPct(perCat);
    const months0 = perCat.find((p) => p.months.length)!.months;

    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet("YTD (Till Date)");
    s1.getColumn(1).width = 34;
    for (let i = 2; i <= 5; i++) s1.getColumn(i).width = 15;
    const r = { v: 1 };
    titleBand(s1, 5, entityTitle, subtitle, r);
    this.writeYtdBlock(s1, perCat, r, trfAsOn);
    landscape(s1, `A1:E${r.v - 1}`);

    const sq = wb.addWorksheet("Quarter");
    const qCols = 7;
    sq.getColumn(1).width = 30;
    r.v = 1;
    titleBand(sq, qCols, entityTitle, subtitle + "   ·   Quarter", r);
    this.writeQuarterBlock(sq, perCat, r);
    landscape(sq, r.v > 1 ? `A1:${colLetter(qCols)}${r.v - 1}` : undefined);

    const s2 = wb.addWorksheet("Month wise");
    const grid = entityType === "District";
    const totalCols = grid ? 3 + 2 * months0.length + 2 : 3 + months0.length;
    s2.getColumn(1).width = 30;
    r.v = 1;
    titleBand(s2, totalCols, entityTitle, subtitle + "   ·   Month wise", r);
    if (grid) this.writeMonthGridBlock(s2, perCat, r);
    else this.writeMonthBlock(s2, perCat, totalCols, r);
    landscape(s2, `A1:${colLetter(totalCols)}${r.v - 1}`);
    return wb;
  }

  private writeYtdBlock(s: WS, perCat: PerCat, r: { v: number }, trfAsOn: string | null) {
    for (const { name, rows: allRows } of perCat) {
      const rows = allRows.filter((x) => x.monthlyTracked || x.singleValue);
      if (!rows.length) continue;
      const allSingle = rows.every((x) => x.singleValue);
      const hasBase = !allSingle && rows.some((x) => x.hasBaseline);
      const cols = allSingle ? 2 : hasBase ? 5 : 4;
      sectionBand(s, cols, name, r);
      const baseLabels = [...new Set(rows.filter((x) => x.hasBaseline).map((x) => reportLabel(x.baselineLabel)))];
      const baseHeader = baseLabels.length === 1 && baseLabels[0].trim() ? baseLabels[0] : "As on Jul 1";
      const hs = allSingle ? ["Particulars", "Value"] : hasBase ? ["Particulars", baseHeader, targetHeader(name), achievedHeader(name, trfAsOn), "Achievement(%)"] : ["Particulars", targetHeader(name), achievedHeader(name, trfAsOn), "Achievement(%)"];
      hs.forEach((h, i) => header(s, r.v, i + 1, h));
      r.v++;
      for (const m of rows) {
        let c = 1;
        setText(s, r.v, c++, qualifiedLabel(m, rows));
        if (allSingle) {
          if (m.displayText !== null) setText(s, r.v, c, m.displayText, true);
          else setNum(s, r.v, c, m.target);
          borderRow(s, r.v++, cols);
          continue;
        }
        if (hasBase) setNum(s, r.v, c++, m.baseline);
        setNum(s, r.v, c++, m.target);
        setNum(s, r.v, c++, m.achieved);
        setPct(s, r.v, c, m.pct, m.twoDecimalPct);
        borderRow(s, r.v++, cols);
      }
      r.v++;
    }
  }

  /** Quarter tables: the quarter's share of the growth, what was achieved in it and the % (capped at 100). */
  private writeQuarterBlock(s: WS, perCat: PerCat, r: { v: number }) {
    const qLabels = ["Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun"];
    for (const { name, rows } of perCat) {
      if (isAnnualOnlyCategory(name)) continue;
      const tracked = rows.filter((x) => x.monthlyTracked);
      if (!tracked.length) continue;
      const hasBase = tracked.some((x) => x.hasBaseline);
      const blockCols = 1 + (hasBase ? 1 : 0) + 2 + qLabels.length;
      sectionBand(s, blockCols, name, r);
      let c = 1;
      header(s, r.v, c++, "Particulars");
      if (hasBase) header(s, r.v, c++, "As on Jul 1 / Value");
      header(s, r.v, c++, targetHeader(name));
      header(s, r.v, c++, "To add");
      for (const q of qLabels) header(s, r.v, c++, q);
      r.v++;
      const first = hasBase ? 5 : 4;
      for (const m of tracked) {
        c = 1;
        setText(s, r.v, c++, qualifiedLabel(m, tracked));
        if (hasBase) setNum(s, r.v, c++, m.baseline);
        setNum(s, r.v, c++, m.target);
        setNum(s, r.v, c, m.splitBase);
        borderRow(s, r.v++, blockCols);
        setText(s, r.v, 1, "  Target");
        for (let q = 1; q <= 4; q++) setNum(s, r.v, first + q - 1, m.quarterlyTargets[q] ?? null);
        borderRow(s, r.v++, blockCols);
        setText(s, r.v, 1, "  Achieved");
        for (let q = 1; q <= 4; q++) setNum(s, r.v, first + q - 1, m.quarterlyAchieved[q] ?? null);
        borderRow(s, r.v++, blockCols);
        setText(s, r.v, 1, "  Achievement(%)");
        for (let q = 1; q <= 4; q++) {
          const qt = m.quarterlyTargets[q] ?? null, qa = m.quarterlyAchieved[q] ?? null;
          const pct = qt !== null && qt !== 0 && qa !== null ? Math.min(100, roundAway((qa / qt) * 100, m.twoDecimalPct ? 2 : 0)) : null;
          setPct(s, r.v, first + q - 1, pct, m.twoDecimalPct);
        }
        borderRow(s, r.v++, blockCols);
      }
      r.v++;
    }
  }

  /** Club Month wise: per metric the yearly row, the month split (when saved), cumulative Achieved and %. */
  private writeMonthBlock(s: WS, perCat: PerCat, totalCols: number, r: { v: number }) {
    for (const { name, rows, months } of perCat) {
      if (isAnnualOnlyCategory(name)) continue;
      const hasBase = rows.some((x) => x.hasBaseline);
      const blockCols = totalCols - (hasBase ? 0 : 1);
      sectionBand(s, blockCols, name, r);
      let c = 1;
      header(s, r.v, c++, "Particulars");
      if (hasBase) header(s, r.v, c++, "As on Jul 1 / Value");
      header(s, r.v, c++, targetHeader(name));
      for (const mo of months) header(s, r.v, c++, mo.label);
      r.v++;
      const firstMonth = hasBase ? 4 : 3;
      for (const m of rows) {
        c = 1;
        setText(s, r.v, c++, qualifiedLabel(m, rows));
        if (!m.monthlyTracked) {
          if (m.displayText !== null) setText(s, r.v, c, m.displayText, true);
          else setNum(s, r.v, c, m.target ?? m.baseline);
          c++;
          if (hasBase) setNum(s, r.v, c, null);
          borderRow(s, r.v++, blockCols);
          continue;
        }
        if (hasBase) setNum(s, r.v, c++, m.baseline);
        setNum(s, r.v, c, m.target);
        borderRow(s, r.v++, blockCols);
        const cum: (number | null)[] = [];
        let run = m.baselineIsReferenceOnly ? 0 : m.baseline ?? 0;
        for (const mo of months) {
          if (mo.isAvailable) { run += m.monthly[mo.month] ?? 0; cum.push(run); } else cum.push(null);
        }
        if (Object.values(m.monthlyTargets).some((v) => v !== null)) {
          setText(s, r.v, 1, "  Target");
          months.forEach((mo, i) => setNum(s, r.v, firstMonth + i, m.monthlyTargets[mo.month] ?? null));
          borderRow(s, r.v++, blockCols);
        }
        setText(s, r.v, 1, "  Achieved");
        cum.forEach((v, i) => setNum(s, r.v, firstMonth + i, v));
        borderRow(s, r.v++, blockCols);
        setText(s, r.v, 1, "  Achievement(%)");
        cum.forEach((v, i) => setPct(s, r.v, firstMonth + i, v !== null ? pctAtMonth(m, v) : null, m.twoDecimalPct));
        borderRow(s, r.v++, blockCols);
      }
      r.v++;
    }
  }

  /** District Month wise grid: every month a Target | Achieved pair, one row per metric. */
  private writeMonthGridBlock(s: WS, perCat: PerCat, r: { v: number }) {
    for (const { name, rows, months } of perCat) {
      if (isAnnualOnlyCategory(name)) continue;
      const blockCols = 3 + 2 * months.length + 2;
      sectionBand(s, blockCols, name, r);
      const hr = r.v;
      const tall = (col: number, txt: string) => { header(s, hr, col, txt); header(s, hr + 1, col); merge(s, hr, col, hr + 1, col); };
      tall(1, "Particulars");
      tall(2, "As on Jul 1 / Value");
      tall(3, targetHeader(name));
      let c = 4;
      for (const mo of months) {
        header(s, hr, c, mo.label);
        header(s, hr, c + 1);
        merge(s, hr, c, hr, c + 1);
        header(s, hr + 1, c, "Target");
        header(s, hr + 1, c + 1, "Achieved");
        c += 2;
      }
      tall(c, "Achieved");
      tall(c + 1, "% Achievement");
      borderRow(s, hr, blockCols);
      borderRow(s, hr + 1, blockCols);
      r.v += 2;
      for (const m of rows) {
        if (!m.monthlyTracked && name.toLowerCase() === "membership") continue;
        setText(s, r.v, 1, qualifiedLabel(m, rows));
        if (!m.monthlyTracked) {
          if (m.displayText !== null) setText(s, r.v, 3, m.displayText, true);
          else setNum(s, r.v, 3, m.target ?? m.baseline);
          borderRow(s, r.v++, blockCols);
          continue;
        }
        setNum(s, r.v, 2, m.baselineIsReferenceOnly || !m.hasBaseline ? null : m.baseline);
        setNum(s, r.v, 3, m.target);
        const tgt = runningMonthTargets(m, months);
        let run = m.baselineIsReferenceOnly ? 0 : m.baseline ?? 0;
        let last: number | null = null;
        c = 4;
        for (const mo of months) {
          setNum(s, r.v, c, tgt.has(mo.month) ? tgt.get(mo.month)! : null);
          let ach: number | null = null;
          if (mo.isAvailable) { run += m.monthly[mo.month] ?? 0; ach = run; last = run; }
          setNum(s, r.v, c + 1, ach);
          c += 2;
        }
        setNum(s, r.v, c, last);
        s.getCell(r.v, c).font = { bold: true };
        setPct(s, r.v, c + 1, last !== null ? pctAtMonth(m, last) : null, m.twoDecimalPct);
        borderRow(s, r.v++, blockCols);
      }
      r.v++;
    }
  }

  /** One row per entity (club or district), each category's metrics across columns: YTD · Quarter · Month wise. */
  protected async buildHorizontalGoalWorkbook(firstColHeader: string, title: string, subtitle: string, rowData: { name: string; perCat: PerCat }[], months0: GoalMonthPeriodDto[], trfAsOn: string | null): Promise<Buffer> {
    const ytdRows = (rows: GoalMetricComputed[]) => rows.filter((x) => x.monthlyTracked || x.singleValue);
    type L = { groupName: string; metricLabel: string; baselineLabel: string; hasBaseline: boolean; single: boolean };
    const catOrder: string[] = [];
    const catMetric = new Map<string, L[]>();
    const catMonth = new Map<string, string[]>();
    for (const cd of rowData)
      for (const { name: cat, rows: all } of cd.perCat) {
        const rows = ytdRows(all);
        if (!catMetric.has(cat)) { catMetric.set(cat, []); catOrder.push(cat); }
        const l = catMetric.get(cat)!;
        for (let i = l.length; i < rows.length; i++) l.push({ groupName: rows[i].groupName, metricLabel: reportLabel(rows[i].label), baselineLabel: rows[i].baselineLabel, hasBaseline: rows[i].hasBaseline, single: rows[i].singleValue });
        if (!catMonth.has(cat)) catMonth.set(cat, []);
        if (!isAnnualOnlyCategory(cat)) { const ml = catMonth.get(cat)!; for (let i = ml.length; i < rows.length; i++) ml.push(qualifiedLabel(rows[i], rows)); }
      }
    const metricCols = (l: L) => (l.single ? 1 : l.hasBaseline ? 4 : 3);
    const catCols = (cat: string) => catMetric.get(cat)!.reduce((s, l) => s + metricCols(l), 0);
    const rowsFor = (perCat: PerCat, cat: string) => perCat.find((p) => p.name === cat)?.rows ?? [];

    const wb = new ExcelJS.Workbook();
    // Sheet 1 — YTD
    const s1 = wb.addWorksheet("YTD (Till Date)");
    s1.getColumn(1).width = 30;
    const width1 = 1 + catOrder.reduce((s, c) => s + catCols(c), 0);
    const r = { v: 1 };
    titleBand(s1, width1, title, subtitle, r);
    const aRow = r.v, bRow = r.v + 1, cRow = r.v + 2;
    merge(s1, aRow, 1, cRow, 1);
    header(s1, aRow, 1, firstColHeader);
    let col = 2;
    for (const cat of catOrder) {
      const lbls = catMetric.get(cat)!;
      const span = catCols(cat);
      if (!span) continue;
      merge(s1, aRow, col, aRow, col + span - 1);
      header(s1, aRow, col, cat);
      for (let k = 1; k < span; k++) header(s1, aRow, col + k);
      let mc = col;
      for (let li = 0; li < lbls.length; li++) {
        const l = lbls[li];
        const cols = metricCols(l);
        if (l.single) {
          let run = 1;
          while (li + run < lbls.length && lbls[li + run].single && lbls[li + run].groupName === l.groupName) run++;
          merge(s1, bRow, mc, bRow, mc + run - 1);
          header(s1, bRow, mc, l.groupName);
          for (let k = 1; k < run; k++) header(s1, bRow, mc + k);
          for (let k = 0; k < run; k++) header(s1, cRow, mc + k, lbls[li + k].metricLabel, true);
          mc += run;
          li += run - 1;
          continue;
        }
        merge(s1, bRow, mc, bRow, mc + cols - 1);
        header(s1, bRow, mc, l.groupName);
        for (let k = 1; k < cols; k++) header(s1, bRow, mc + k);
        const sub = l.hasBaseline ? [reportLabel(l.baselineLabel), targetHeader(cat), achievedHeader(cat, trfAsOn), "Achievement(%)"] : [targetHeader(cat), achievedHeader(cat, trfAsOn), "Achievement(%)"];
        sub.forEach((t, k) => header(s1, cRow, mc + k, t, true));
        mc += cols;
      }
      col += span;
    }
    r.v = cRow + 1;
    for (const cd of rowData) {
      setText(s1, r.v, 1, cd.name);
      col = 2;
      for (const cat of catOrder) {
        const lbls = catMetric.get(cat)!;
        const rows = ytdRows(rowsFor(cd.perCat, cat));
        for (let i = 0; i < lbls.length; i++) {
          const m = i < rows.length ? rows[i] : null;
          let cc = col;
          if (lbls[i].single) {
            if (m?.displayText != null) setText(s1, r.v, cc, m.displayText, true);
            else setNum(s1, r.v, cc, m?.target);
            col += 1;
            continue;
          }
          if (lbls[i].hasBaseline) setNum(s1, r.v, cc++, m?.baseline);
          setNum(s1, r.v, cc++, m?.target);
          setNum(s1, r.v, cc++, m?.achieved);
          setPct(s1, r.v, cc, m?.pct, m?.twoDecimalPct === true);
          col += metricCols(lbls[i]);
        }
      }
      borderRow(s1, r.v++, width1);
    }
    for (let c = 2; c <= width1; c++) s1.getColumn(c).width = 12;
    s1.getRow(cRow).height = 46;
    landscape(s1, undefined, false);
    s1.views = [{ state: "frozen", xSplit: 1 }];

    // Sheet 2 — Quarter
    {
      const qh = ["Q1", "Q2", "Q3", "Q4"];
      const sq = wb.addWorksheet("Quarter");
      sq.getColumn(1).width = 30;
      const perQ = 8;
      const widthQ = 1 + catOrder.reduce((s, c) => s + catMonth.get(c)!.length, 0) * perQ;
      const rq = { v: 1 };
      titleBand(sq, widthQ, title, subtitle + "   ·   Quarter", rq);
      const aq = rq.v, bq = rq.v + 1, cq = rq.v + 2;
      merge(sq, aq, 1, cq, 1);
      header(sq, aq, 1, firstColHeader);
      let colq = 2;
      for (const cat of catOrder) {
        const span = catMonth.get(cat)!.length * perQ;
        if (!span) continue;
        merge(sq, aq, colq, aq, colq + span - 1);
        header(sq, aq, colq, cat);
        for (let k = 1; k < span; k++) header(sq, aq, colq + k);
        for (const ml of catMonth.get(cat)!) {
          merge(sq, bq, colq, bq, colq + perQ - 1);
          header(sq, bq, colq, ml);
          for (let k = 1; k < perQ; k++) header(sq, bq, colq + k);
          let sub = colq;
          for (const q of qh) { header(sq, cq, sub++, q + " tgt"); header(sq, cq, sub++, q + " ach"); }
          colq += perQ;
        }
      }
      rq.v = cq + 1;
      for (const cd of rowData) {
        setText(sq, rq.v, 1, cd.name);
        colq = 2;
        for (const cat of catOrder) {
          const lbls = catMonth.get(cat)!;
          const rws = ytdRows(rowsFor(cd.perCat, cat));
          for (let i = 0; i < lbls.length; i++) {
            const m = i < rws.length ? rws[i] : null;
            let sub = colq;
            for (let q = 1; q <= 4; q++) {
              setNum(sq, rq.v, sub++, m ? m.quarterlyTargets[q] ?? null : null);
              setNum(sq, rq.v, sub++, m ? m.quarterlyAchieved[q] ?? null : null);
            }
            colq += perQ;
          }
        }
        borderRow(sq, rq.v++, widthQ);
      }
      for (let c = 2; c <= widthQ; c++) sq.getColumn(c).width = 9;
      landscape(sq, undefined, false);
      sq.views = [{ state: "frozen", xSplit: 1 }];
    }

    // Sheet 3 — Month wise (cumulative Achieved per month + Total)
    const s2 = wb.addWorksheet("Month wise");
    s2.getColumn(1).width = 30;
    const perMetric = months0.length + 1;
    const width2 = 1 + catOrder.reduce((s, c) => s + catMonth.get(c)!.length, 0) * perMetric;
    r.v = 1;
    titleBand(s2, width2, title, subtitle + "   ·   Month wise", r);
    const a2 = r.v, b2 = r.v + 1, c2 = r.v + 2;
    merge(s2, a2, 1, c2, 1);
    header(s2, a2, 1, firstColHeader);
    col = 2;
    for (const cat of catOrder) {
      const span = catMonth.get(cat)!.length * perMetric;
      if (!span) continue;
      merge(s2, a2, col, a2, col + span - 1);
      header(s2, a2, col, cat);
      for (let k = 1; k < span; k++) header(s2, a2, col + k);
      for (const ml of catMonth.get(cat)!) {
        merge(s2, b2, col, b2, col + perMetric - 1);
        header(s2, b2, col, ml);
        for (let k = 1; k < perMetric; k++) header(s2, b2, col + k);
        let cc = col;
        for (const mo of months0) header(s2, c2, cc++, mo.label);
        header(s2, c2, cc, "Total");
        col += perMetric;
      }
    }
    r.v = c2 + 1;
    for (const cd of rowData) {
      setText(s2, r.v, 1, cd.name);
      col = 2;
      for (const cat of catOrder) {
        const lbls = catMonth.get(cat)!;
        const rows = ytdRows(rowsFor(cd.perCat, cat));
        for (let i = 0; i < lbls.length; i++) {
          const m = i < rows.length ? rows[i] : null;
          if (m) {
            let run = m.baselineIsReferenceOnly ? 0 : m.baseline ?? 0;
            let finalCum: number | null = null;
            let cc = col;
            for (const mo of months0) {
              if (mo.isAvailable && !m.closedMonths.has(mo.month)) { run += m.monthly[mo.month] ?? 0; setNum(s2, r.v, cc, run); finalCum = run; }
              else setNum(s2, r.v, cc, null);
              cc++;
            }
            setNum(s2, r.v, cc, finalCum);
          }
          col += perMetric;
        }
      }
      borderRow(s2, r.v++, width2);
    }
    for (let c = 2; c <= width2; c++) s2.getColumn(c).width = 7;
    landscape(s2, undefined, false);
    s2.views = [{ state: "frozen", xSplit: 1 }];
    return toBuffer(wb);
  }

  // ── Admin and oversight downloads ─────────────────────────────────────────

  /** The District Admin's report-section export (all categories; categoryId is ignored as in RIZones). */
  async buildDistrictMonthlyExcel(memberId: number, _categoryId: number, yearId: number | null, requestedDistrictId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      if (districtId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const num = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
      const wb = await this.renderEntityWorkbook(conn, "District", 0, districtId, y.yearId, `District ${num}`, `Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable, await this.daCategoryFilter(conn, memberId));
      return wb ? toBuffer(wb) : null;
    });
  }

  /** The same district workbook for a goal-oversight role, scoped by assignment (no Youth %). */
  async buildDistrictGoalSettingReportScoped(memberId: number, districtId: number, yearId: number | null): Promise<Buffer | null> {
    if (districtId <= 0) return null;
    return this.db.session(async (conn) => {
      await this.assertDistrictInGoalScope(conn, memberId, districtId);
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const num = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
      const wb = await this.renderEntityWorkbook(conn, "District", 0, districtId, y.yearId, `District ${num}`, `Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable, await this.oversightCategoryFilter(conn, memberId), true);
      return wb ? toBuffer(wb) : null;
    });
  }

  async buildClubMonthlyExcel(memberId: number, _categoryId: number, yearId: number | null, requestedClubId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      const clubId = await this.resolveClubId(conn, memberId, requestedClubId);
      if (clubId === 0) return null;
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const row = await conn.queryFirstOrDefault("SELECT c.ClubName AS name, d.DistrictNumber AS num FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @Id AND c.isdeleted = 0", { Id: clubId });
      if (!row) return null;
      const wb = await this.renderEntityWorkbook(conn, "Club", clubId, 0, y.yearId, row.name ?? `Club ${clubId}`, `District ${row.num ?? ""}   ·   Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable, await this.daCategoryFilter(conn, memberId));
      return wb ? toBuffer(wb) : null;
    });
  }

  /** Club Goal Setting → "All": every club of the district, one row each. Rotaract clubs hidden. */
  async buildAllClubsMonthlyExcel(memberId: number, yearId: number | null, requestedDistrictId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      const districtId = await this.resolveDistrictId(conn, memberId, requestedDistrictId);
      return this.buildAllClubsMonthlyExcelCore(conn, districtId, yearId, await this.daCategoryFilter(conn, memberId), hideRotaract(await this.isSuperAdmin(conn, memberId)));
    });
  }

  async buildAllClubsMonthlyExcelScoped(memberId: number, yearId: number | null, districtId: number): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessDistrictReport(conn, memberId, districtId))) throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
      return this.buildAllClubsMonthlyExcelCore(conn, districtId, yearId, await this.oversightCategoryFilter(conn, memberId));
    });
  }

  protected async buildAllClubsMonthlyExcelCore(conn: DbCommands, districtId: number, yearId: number | null, only: Set<number> | null = null, excludeRotaract = false): Promise<Buffer | null> {
    if (districtId === 0) return null;
    const y = await this.resolveYear(conn, yearId);
    if (y.yearId === 0) return null;
    const num = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
    const clubs = await conn.query(
      "SELECT pk_club_id AS Id, ClubName AS Name FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1" + (excludeRotaract ? " AND " + notRotaract("") : "") + " ORDER BY ClubName",
      { D: districtId },
    );
    if (!clubs.length) return null;
    const subtitle = `District ${num}   ·   Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`;
    // bounded parallelism, one pooled connection per task, order preserved
    const computed = await mapLimit(clubs, 12, (club) => this.db.session((c2) => this.computeEntityPerCat(c2, "Club", Number(club.Id), 0, y.yearId, y.isEditable, only)));
    const rowData: { name: string; perCat: PerCat }[] = [];
    let months0: GoalMonthPeriodDto[] = [];
    computed.forEach((data, i) => {
      if (!data) return;
      rowData.push({ name: String(clubs[i].Name), perCat: data.perCat });
      if (!months0.length) months0 = data.months0;
    });
    if (!rowData.length) return null;
    return this.buildHorizontalGoalWorkbook("Club", `All Clubs — District ${num}`, subtitle, rowData, months0, await this.foundationAsOn(conn, y.yearId, "Club"));
  }

  /** District Performance Report: the district's YTD goal rows and (optionally) its Goal Setting workbooks. System call, no caller scope. */
  async getDistrictPerformanceGoalData(districtId: number, yearId: number, includeWorkbooks: boolean): Promise<DistrictPerformanceGoalData> {
    const result: DistrictPerformanceGoalData = { districtMetrics: [], achievedAsOn: new Map(), districtWorkbook: null, clubsWorkbook: null };
    if (districtId <= 0) return result;
    return this.db.session(async (conn) => {
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return result;
      const data = await this.computeEntityPerCat(conn, "District", 0, districtId, y.yearId, y.isEditable);
      if (data) {
        for (const { name, rows: allRows } of data.perCat) {
          const rows = allRows.filter((x) => x.monthlyTracked || x.singleValue);
          for (const m of rows)
            result.districtMetrics.push({ category: name, metric: qualifiedLabel(m, rows), baseline: m.hasBaseline ? m.baseline : null, target: m.target, achieved: m.achieved, pct: m.pct, displayText: m.displayText, singleValue: m.singleValue });
        }
        for (const cat of await conn.query("SELECT pk_category_id AS Id, IF(Name = 'TRF', 'Foundation', Name) AS Name FROM goal_categories WHERE isdeleted = 0")) {
          const asOn = await this.achievedAsOn(conn, Number(cat.Id), y.yearId, "District", 0, districtId);
          if (asOn !== null) result.achievedAsOn.set(String(cat.Name).toLowerCase(), asOn);
        }
      }
      if (includeWorkbooks) {
        const num = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
        const wb = await this.renderEntityWorkbook(conn, "District", 0, districtId, y.yearId, `District ${num}`, `Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable);
        result.districtWorkbook = wb ? await toBuffer(wb) : null;
        result.clubsWorkbook = await this.buildAllClubsMonthlyExcelCore(conn, districtId, y.yearId, null, true);
      }
      return result;
    });
  }

  /** Oversight district report: districts = rows. district > zone > all of the caller's districts. */
  async buildGoalDistrictReportExcel(memberId: number, zoneId: number | null, districtId: number | null, yearId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const isSuper = await this.isSuperAdmin(conn, memberId);
      const onlyCats = await this.oversightCategoryFilter(conn, memberId);
      let allowed: Set<number> | null = null;
      if (!isSuper) {
        allowed = new Set((await this.getMyAssignments(memberId)).flatMap((a) => a.districtIds));
        if (!allowed.size) return null;
      }
      let where = "d.isdeleted=0 AND d.IsActive=1";
      if (districtId !== null && districtId > 0) where += " AND d.pk_district_id=@Did";
      else if (zoneId !== null && zoneId > 0) where += " AND d.fk_zone_id=@Zid";
      let districts = (await conn.query(`SELECT pk_district_id AS Id, DistrictNumber AS Number FROM district_master d WHERE ${where} ORDER BY DistrictNumber`, { Did: districtId ?? 0, Zid: zoneId ?? 0 })).map((d) => ({ id: Number(d.Id), number: String(d.Number) }));
      if (allowed) districts = districts.filter((d) => allowed!.has(d.id));
      if (!districts.length) return null;
      const computed = await mapLimit(districts, 12, (d) => this.db.session((c2) => this.computeEntityPerCat(c2, "District", 0, d.id, y.yearId, y.isEditable, onlyCats)));
      const rowData: { name: string; perCat: PerCat }[] = [];
      let months0: GoalMonthPeriodDto[] = [];
      computed.forEach((data, i) => {
        if (!data) return;
        dropYouthPct(data.perCat);
        rowData.push({ name: `D ${districts[i].number}`, perCat: data.perCat });
        if (!months0.length) months0 = data.months0;
      });
      if (!rowData.length) return null;
      const scopeLabel = districtId !== null && districtId > 0 ? `District ${districts[0].number}` : zoneId !== null && zoneId > 0 ? `Zone (districts) — ${districts.length} district(s)` : `All my districts — ${districts.length} district(s)`;
      return this.buildHorizontalGoalWorkbook("District", "Goal Setting — District Report", `${scopeLabel}   ·   Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, rowData, months0, await this.foundationAsOn(conn, y.yearId, "District"));
    });
  }

  // ── Report scope checks ───────────────────────────────────────────────────

  protected async canAccessZoneReport(conn: DbCommands, memberId: number, zoneId: number) {
    if (zoneId <= 0 || memberId <= 0) return false;
    if (await this.isSuperAdmin(conn, memberId)) return true;
    for (const a of await this.getMyAssignments(memberId))
      if ((a.roleType === "AllCategoryAllDistrictsFewZones" || a.roleType === "AllDistrictsOneCategoryOneZone") && a.zoneIds.includes(zoneId)) return true;
    return Number(await conn.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 4 AND fk_zone_id = @Z AND IsActive = 1 AND isdeleted = 0", { M: memberId, Z: zoneId })) > 0;
  }

  protected async canAccessDistrictReport(conn: DbCommands, memberId: number, districtId: number) {
    if (districtId <= 0 || memberId <= 0) return false;
    if (await this.isSuperAdmin(conn, memberId)) return true;
    if ((await this.getMyAssignments(memberId)).some((a) => a.districtIds.includes(districtId))) return true;
    try {
      return (await this.resolveDistrictId(conn, memberId, districtId)) === districtId;
    } catch (e) {
      if (e instanceof UnauthorizedAccessException) return false;
      throw e;
    }
  }

  protected async canAccessClubReport(conn: DbCommands, memberId: number, clubId: number) {
    if (clubId <= 0 || memberId <= 0) return false;
    if (await this.isSuperAdmin(conn, memberId)) return true;
    try {
      if ((await this.resolveClubId(conn, memberId, clubId)) === clubId) return true;
    } catch (e) {
      if (!(e instanceof UnauthorizedAccessException)) throw e;
    }
    const dId = Number((await conn.executeScalar("SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", { Id: clubId })) ?? 0);
    if (dId <= 0) return false;
    return (await this.getMyAssignments(memberId)).some((a) => a.districtIds.includes(dId));
  }

  /** An Admin of THIS district / club keeps every category; anyone else gets the oversight filter. */
  private async reportCategoryFilter(conn: DbCommands, memberId: number, ownsEntity: boolean) {
    return ownsEntity ? this.daCategoryFilter(conn, memberId) : this.oversightCategoryFilter(conn, memberId);
  }

  async buildDistrictGoalReport(memberId: number, districtId: number, yearId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessDistrictReport(conn, memberId, districtId))) throw new UnauthorizedAccessException("You are not authorised for this district's goal report.");
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const num = String((await conn.executeScalar("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", { Id: districtId })) ?? "");
      const isAdmin = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
           AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0`,
        { M: memberId, D: districtId },
      )) > 0;
      const wb = await this.renderEntityWorkbook(conn, "District", 0, districtId, y.yearId, `District ${num}`, `Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable, await this.reportCategoryFilter(conn, memberId, isAdmin));
      if (!wb) return null;
      await this.appendMessagesSheet(wb, memberId, y.yearId, "district", districtId);
      return toBuffer(wb);
    });
  }

  async buildClubGoalReport(memberId: number, clubId: number, yearId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessClubReport(conn, memberId, clubId))) throw new UnauthorizedAccessException("You are not authorised for this club's goal report.");
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const row = await conn.queryFirstOrDefault("SELECT c.ClubName AS name, d.DistrictNumber AS num FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @Id AND c.isdeleted = 0", { Id: clubId });
      if (!row) return null;
      const isAdmin = Number(await conn.executeScalar(
        `SELECT COUNT(*) FROM member_roles
         WHERE fk_member_master_profile_id = @M AND fk_role_id IN (2, 5) AND fk_club_id = @C
           AND IsActive = 1 AND isdeleted = 0`,
        { M: memberId, C: clubId },
      )) > 0 || (await isDistrictAdminWithClubAccess(conn, memberId, clubId));
      const wb = await this.renderEntityWorkbook(conn, "Club", clubId, 0, y.yearId, row.name ?? `Club ${clubId}`, `District ${row.num ?? ""}   ·   Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`, y.isEditable, await this.reportCategoryFilter(conn, memberId, isAdmin));
      return wb ? toBuffer(wb) : null;
    });
  }

  /** Zone report: per category a districts table (YTD), then Quarter and Month wise flat sheets, then Messages. */
  async buildZoneGoalReport(memberId: number, zoneId: number, yearId: number | null): Promise<Buffer | null> {
    return this.db.session(async (conn) => {
      if (!(await this.canAccessZoneReport(conn, memberId, zoneId))) throw new UnauthorizedAccessException("You are not authorised for this zone's goal report.");
      const y = await this.resolveYear(conn, yearId);
      if (y.yearId === 0) return null;
      const zoneName = String((await conn.executeScalar("SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Z AND isdeleted = 0", { Z: zoneId })) ?? `Zone ${zoneId}`);
      const districts = await conn.query("SELECT pk_district_id AS id, DistrictNumber AS num FROM district_master WHERE fk_zone_id = @Z AND isdeleted = 0 AND IsActive = 1 ORDER BY DistrictNumber", { Z: zoneId });
      if (!districts.length) return null;
      const cats: GoalCategoryDto[] = await this.getOversightCategories(memberId);
      const subtitle = `Zone report   ·   Rotary Year ${y.yearLabel}   ·   Generated ${generatedStamp()}`;
      const computed = new Map<string, { name: string; rows: GoalMetricComputed[]; months: GoalMonthPeriodDto[] }>();
      for (const d of districts) for (const cat of cats) computed.set(`${d.id}:${cat.id}`, await this.computeCategoryMetrics(conn, cat.id, y.yearId, "District", 0, Number(d.id), y.isEditable));
      const ytd = (rows: GoalMetricComputed[]) => rows.filter((x) => x.monthlyTracked || x.singleValue);

      const wb = new ExcelJS.Workbook();
      const s1 = wb.addWorksheet("YTD (Till Date)");
      s1.getColumn(1).width = 14;
      const r = { v: 1 };
      for (const cat of cats) {
        let labels: { label: string; hasBaseline: boolean; single: boolean; baseLabel: string }[] = [];
        for (const d of districts) {
          const rows = ytd(computed.get(`${d.id}:${cat.id}`)!.rows);
          if (rows.length) { labels = rows.map((x) => ({ label: qualifiedLabel(x, rows), hasBaseline: x.hasBaseline, single: x.singleValue, baseLabel: reportLabel(x.baselineLabel) })); break; }
        }
        if (!labels.length) continue;
        const width = 1 + labels.reduce((s, l) => s + (l.single ? 1 : l.hasBaseline ? 4 : 3), 0);
        if (r.v === 1) titleBand(s1, width, `Zone ${zoneName}`, subtitle, r);
        sectionBand(s1, width, cat.name, r);
        const superRow = r.v;
        merge(s1, superRow, 1, superRow + 1, 1);
        header(s1, superRow, 1, "District");
        let c = 2;
        for (const l of labels) {
          const cols = l.single ? 1 : l.hasBaseline ? 4 : 3;
          merge(s1, superRow, c, superRow, c + cols - 1);
          header(s1, superRow, c, l.label);
          for (let k = 1; k < cols; k++) header(s1, superRow, c + k);
          c += cols;
        }
        r.v++;
        c = 2;
        for (const l of labels) {
          const sub = l.single ? ["Value"] : l.hasBaseline ? [l.baseLabel.trim() ? l.baseLabel : "Jul 1", "Target", "Ach.", "Achievement(%)"] : ["Target", "Ach.", "Achievement(%)"];
          sub.forEach((t, k) => header(s1, r.v, c + k, t));
          c += sub.length;
        }
        r.v++;
        for (const d of districts) {
          const drows = ytd(computed.get(`${d.id}:${cat.id}`)!.rows);
          setText(s1, r.v, 1, String(d.num));
          c = 2;
          labels.forEach((l, i) => {
            const m = i < drows.length ? drows[i] : null;
            if (l.single) {
              if (m?.displayText != null) setText(s1, r.v, c, m.displayText, true);
              else setNum(s1, r.v, c, m?.target);
              c++;
              return;
            }
            if (l.hasBaseline) setNum(s1, r.v, c++, m?.baseline);
            setNum(s1, r.v, c++, m?.target);
            setNum(s1, r.v, c++, m?.achieved);
            setPct(s1, r.v, c++, m?.pct, m?.twoDecimalPct === true);
          });
          borderRow(s1, r.v++, width);
        }
        for (let col = 2; col <= width; col++) s1.getColumn(col).width = 9;
        r.v++;
      }
      landscape(s1, undefined, false);
      s1.views = [{ state: "frozen", xSplit: 1 }];

      {
        const qh = ["Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun"];
        const sq = wb.addWorksheet("Quarter");
        const qCols = 12;
        sq.getColumn(1).width = 12; sq.getColumn(2).width = 16; sq.getColumn(3).width = 26;
        const rq = { v: 1 };
        titleBand(sq, qCols, `Zone ${zoneName}`, subtitle + "   ·   Quarter", rq);
        let qc = 1;
        for (const h of ["District", "Category", "Particulars", "Yearly target"]) header(sq, rq.v, qc++, h);
        for (const h of qh) { header(sq, rq.v, qc++, h + " target"); header(sq, rq.v, qc++, h + " achieved"); }
        rq.v++;
        for (const d of districts)
          for (const cat of cats) {
            const { name: nm, rows: rws } = computed.get(`${d.id}:${cat.id}`)!;
            const catName = nm || cat.name;
            if (isAnnualOnlyCategory(catName)) continue;
            for (const m of rws.filter((x) => x.monthlyTracked)) {
              setText(sq, rq.v, 1, String(d.num));
              setText(sq, rq.v, 2, catName);
              setText(sq, rq.v, 3, qualifiedLabel(m, rws));
              setNum(sq, rq.v, 4, m.target);
              let c2 = 5;
              for (let q = 1; q <= 4; q++) { setNum(sq, rq.v, c2++, m.quarterlyTargets[q] ?? null); setNum(sq, rq.v, c2++, m.quarterlyAchieved[q] ?? null); }
              borderRow(sq, rq.v++, qCols);
            }
          }
        landscape(sq, undefined, false);
        sq.views = [{ state: "frozen", xSplit: 3 }];
      }

      const months0 = unionMonths([...computed.values()].map((v) => v.months));
      const s2 = wb.addWorksheet("Month wise");
      const totalCols = 3 + 1 + months0.length + 1;
      s2.getColumn(1).width = 12; s2.getColumn(2).width = 16; s2.getColumn(3).width = 26;
      r.v = 1;
      titleBand(s2, totalCols, `Zone ${zoneName}`, subtitle + "   ·   Month wise", r);
      let hc = 1;
      for (const h of ["District", "Category", "Particulars", "As on Jul 1 / Value"]) header(s2, r.v, hc++, h);
      for (const mo of months0) header(s2, r.v, hc++, mo.label);
      header(s2, r.v, hc, "Gained");
      r.v++;
      for (const d of districts)
        for (const cat of cats) {
          const { name, rows } = computed.get(`${d.id}:${cat.id}`)!;
          for (const m of rows) {
            setText(s2, r.v, 1, String(d.num));
            setText(s2, r.v, 2, name || cat.name);
            setText(s2, r.v, 3, qualifiedLabel(m, rows));
            if (!m.monthlyTracked) {
              if (m.displayText !== null) setText(s2, r.v, 4, m.displayText, true);
              else setNum(s2, r.v, 4, m.target ?? m.baseline);
              let bc = 5;
              for (const _ of months0) setNum(s2, r.v, bc++, null);
              setNum(s2, r.v, bc, null);
              borderRow(s2, r.v++, totalCols);
              continue;
            }
            setNum(s2, r.v, 4, m.baseline);
            let run = m.baselineIsReferenceOnly ? 0 : m.baseline ?? 0;
            let c = 5;
            for (const mo of months0) {
              if (mo.isAvailable && !m.closedMonths.has(mo.month)) { run += m.monthly[mo.month] ?? 0; setNum(s2, r.v, c, run); }
              else setNum(s2, r.v, c, null);
              c++;
            }
            setNum(s2, r.v, c, m.monthTotal);
            for (let k = 1; k <= totalCols; k++) s2.getCell(r.v, k).border = BOX;
            r.v++;
          }
        }
      landscape(s2, undefined, false);
      s2.views = [{ state: "frozen", ySplit: 1 }];

      await this.appendMessagesSheet(wb, memberId, y.yearId, "zone", zoneId);
      return toBuffer(wb);
    });
  }

  /** "Messages" sheet: every conversation of the district / zone the caller can see, plus District Admin / DG messages. */
  private async appendMessagesSheet(wb: ExcelJS.Workbook, memberId: number, yearId: number, scope: "district" | "zone", id: number) {
    const cats = await this.getOversightCategories(memberId);
    const ws = wb.addWorksheet("Messages");
    [16, 32, 28, 64, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const r = { v: 1 };
    titleBand(ws, 5, "Messages", scope === "zone" ? "Goal-setting oversight conversations (zone)" : "Goal-setting oversight conversations", r);
    ["Category", "Thread", "From", "Message", "Date"].forEach((h, i) => header(ws, r.v, i + 1, h));
    r.v++;
    let any = false;
    const write = (cells: string[]) => {
      cells.forEach((v, i) => setText(ws, r.v, i + 1, v, i === 3));
      for (let c = 1; c <= 5; c++) { const cell = ws.getCell(r.v, c); cell.border = BOX; cell.alignment = { ...cell.alignment, vertical: "top" }; }
      r.v++;
      any = true;
    };
    for (const cat of cats) {
      let list: GoalThreadListDto;
      try {
        list = scope === "district" ? await this.getGoalThreadList(memberId, cat.id, id, yearId) : await this.getGoalZoneThreadList(memberId, cat.id, id, yearId, null);
      } catch {
        continue;
      }
      for (const th of list.threads) {
        let msgs: GoalCommentDto[];
        try {
          msgs = scope === "district" ? await this.getGoalThreadMessages(memberId, cat.id, id, yearId, th.ownerMemberId) : await this.getGoalOwnerThreadMessages(memberId, cat.id, yearId, th.ownerMemberId);
        } catch {
          continue;
        }
        for (const m of msgs) write([cat.name, `${th.ownerName} (${th.ownerRoleLabel})`, `${m.postedByRoleLabel} · ${m.postedByName}`, m.commentText, m.createdDate ?? ""]);
      }
    }
    await this.db.session(async (dconn) => {
      const rows = scope === "district" ? await this.districtSideReportRows(dconn, memberId, yearId, 0, 0, id) : await this.districtSideReportRows(dconn, memberId, yearId, id, 0, 0);
      for (const m of rows) {
        if (!cats.some((x) => x.id === m.categoryId)) continue;
        write([m.categoryName, `District ${m.districtNumber} (${m.fromRole})`, `${m.fromRole} · ${m.fromName}`, m.text, formatDate(m.created, "yyyy-MM-dd HH:mm")]);
      }
    });
    if (!any) {
      merge(ws, r.v, 1, r.v, 5);
      const c = ws.getCell(r.v, 1);
      c.value = "No messages.";
      c.font = { italic: true, color: { argb: C.muted } };
      r.v++;
    }
    landscape(ws, `A1:E${r.v - 1}`, false);
  }
}

/** Achieved derived from the month-wise cells: the latest month for cumulative metrics, else the sum. */
function deriveAchieved(monthly: Record<number, number | null>, months: GoalMonthPeriodDto[], cumulative: boolean, total: number): number | null {
  if (cumulative) {
    let last: number | null = null;
    for (const mo of months) { const v = monthly[mo.month]; if (v !== null && v !== undefined) last = v; }
    return last;
  }
  return total;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
