// Disha Goals report (user 2026-11-19, option A): the SAME report as before (server Excel, same layouts / sheets /
// design) with the Goal Setting boxes of the Overview added as rows - the 26 RCC goals + Clubs, Members, Women Members,
// RAG Analysis, Summary - in the Goal Setting order. The boxes' figures are worked out here exactly as on the Overview
// (Goal Setting forms + the Disha goals) and sent with the request; the Disha questions come from the API as before.

import { saveAs } from "file-saver";
import { getGoalCategories, getDistrictGoalForm, getClubGoalForm, getDistrictMonthlyGoals, getDistrictMonthlyGoalsScoped } from "@/services/api";
import type { MonthlyLine } from "@/services/dishaApi";
import {
  getDishaOverview, getDishaDistrictOverview, getDishaAwardsDistrictMonthly, getDishaGoalState, getDishaDistrictGoalState,
  downloadDishaFullReport, downloadDishaDistrictFullReport, downloadDishaClubsReport, type DishaFullReportItem,
} from "@/services/dishaApi";
import { withRag, withRotaryFields, isFutureYearLabel, overviewLabel, SECTION_TABS, RAG_BANDS, type SectionKey, type SectionCard } from "@/lib/goalRotaryLayout";
import { dishaCards, goalFieldOf, withDishaGoal, orderSection, sectionOfCategory, SECTION_NAMES } from "@/lib/dishaRccGoals";
import { fileTimestamp } from "@/lib/dateUtils";
import { DISHA_DG_SHOW_POINTS } from "@/components/goal-flow/common";

export interface DishaReportScope {
  yearId: number; yearLabel?: string | null;
  zoneId?: number | null; zoneName?: string;
  districtId?: number | null;      // one district (RI Director's district filter, a district card's Report, or the DG)
  dg?: boolean;                    // the DG's own page (district endpoints only)
}

const num = (v: number | null | undefined) => (v == null ? null : String(v));

export async function downloadDishaReport(scope: DishaReportScope): Promise<void> {
  const { yearId } = scope;
  const one = scope.districtId ?? null;
  const data = scope.dg && one ? await getDishaDistrictOverview(one, yearId) : await getDishaOverview(yearId, scope.zoneId);
  const districts = data.districts.filter((d) => !one || d.districtId === one);
  if (districts.length === 0) throw new Error("No districts to report.");
  const ids = districts.map((d) => d.districtId);

  const goals: Record<number, Record<string, number | null>> = {};
  if (scope.dg && one) goals[one] = (await getDishaDistrictGoalState(one, yearId)).rccGoals;
  else Object.entries((await getDishaGoalState(yearId, scope.zoneId)).districts).forEach(([id, s]) => { goals[Number(id)] = s.rccGoals; });

  const cats = await getGoalCategories();
  const future = isFutureYearLabel(scope.yearLabel ?? null);
  const cards: Record<number, Record<SectionKey, SectionCard[]>> = {};
  const queue = [...ids];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      const did = id;
      const res = await Promise.allSettled(cats.map(async (c) => withRag(withRotaryFields(await getDistrictGoalForm(c.id, yearId, did)))));
      cards[did] = dishaCards(res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])), future);
    }
  }));

  // Month figures of the boxes (Month wise / Quarterly sheets, user 2026-11-19), per district.
  const monthsOf: Record<number, Record<string, Record<number, number>>> = {};
  const mq = [...ids];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let id = mq.shift(); id != null; id = mq.shift()) monthsOf[id] = await boxMonthsOf(id, yearId);
  }));

  // One box's figures for one district: Goal / Achieved / % - as the Overview card shows them.
  const boxCell = (sk: SectionKey, name: string, id: number) => {
    const raw = cards[id]?.[sk]?.find((x) => x.name === name);
    if (!raw) return { goal: null, achieved: null, pct: null };
    const gf = goalFieldOf(raw);
    const ach = raw.fields.find((f) => /achieved$/.test(f.fieldKey));
    return { ...cardFigures(gf ? withDishaGoal(raw, goals[id]?.[gf.fieldKey]) : raw), monthly: ach ? monthsOf[id]?.[ach.fieldKey] ?? null : null };
  };
  // Rows in the Overview's order: per section the Goal Setting boxes (a matching Disha question in its place), then
  // the section's other Disha questions; extra Disha categories after.
  const first = ids.find((id) => cards[id]);
  const items: DishaFullReportItem[] = [];
  SECTION_TABS.forEach((s) => {
    const lines = data.lines.filter((l) => sectionOfCategory(l.categoryName) === s.key);
    const category = lines[0]?.categoryName ?? SECTION_NAMES[s.key];
    const tmpl = first != null ? cards[first]?.[s.key] ?? [] : [];
    orderSection(lines, tmpl).forEach((it) => {
      if (it.kind === "line") { items.push({ kind: "line", key: it.line.key, category: it.line.categoryName, title: it.line.title }); return; }
      const c = it.card;
      const gf = goalFieldOf(c);
      const isNumber = !!gf || c.fields.some((f) => /achieved$/.test(f.fieldKey));
      items.push({ kind: "box", category, title: c.name, number: isNumber, twoDecimals: gf?.dataType === "Currency",
        cells: Object.fromEntries(ids.map((id) => [id, boxCell(s.key, c.name, id)])) });
    });
  });
  data.lines.filter((l) => sectionOfCategory(l.categoryName) === "other")
    .forEach((l) => items.push({ kind: "line", key: l.key, category: l.categoryName, title: l.title }));

  // Points only on the DG's own report; the RI Director's has none (user 2026-11-19).
  const blob = one ? await downloadDishaDistrictFullReport(one, { yearId, items, showPoints: !!scope.dg && DISHA_DG_SHOW_POINTS }) : await downloadDishaFullReport({ yearId, zoneId: scope.zoneId, items });
  const name = one ? `Disha_Goals_D${districts[0].districtNumber}` : scope.zoneId ? `Disha_Goals_${(scope.zoneName ?? "Zone").replace(/\s+/g, "_")}` : "Disha_Goals_All_Districts";
  saveAs(blob, `${name}_${fileTimestamp()}.xlsx`);
}

/** One Goal Setting box's figures as the Overview card shows them: Goal / Achieved / % / As on July 1st
 *  (RAG Analysis and Summary as one line of text in Achieved). */
function cardFigures(c: SectionCard): { goal: number | null; achieved: string | null; pct: number | null; baseline?: number | null } {
  const gf = goalFieldOf(c);
  const rag = c.fields.filter((f) => f.fieldKey.startsWith("rag5_"));
  if (rag.length > 0) {
    const total = rag.reduce((t, f) => t + Number(f.numericValue ?? 0), 0);
    return { goal: null, pct: null, achieved: `Total clubs ${total.toLocaleString("en-IN")} (${RAG_BANDS.map((b) => `${b.label}: ${Number(c.fields.find((f) => f.fieldKey === b.key)?.numericValue ?? 0)}`).join(", ")})` };
  }
  const ach = c.fields.find((f) => /achieved$/.test(f.fieldKey));
  const pct = c.fields.find((f) => f.dataType === "Percentage")?.numericValue;
  if (!gf && !ach) {   // Summary: its figures as one line
    return { goal: null, pct: null, achieved: c.fields.filter((f) => f.numericValue != null)
      .map((f) => `${overviewLabel(f.fieldLabel)}: ${Number(f.numericValue).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`).join("; ") || null };
  }
  const goal = gf ? c.fields.find((f) => f.fieldKey === gf.fieldKey)?.numericValue ?? null : null;
  // "As on July 1st" (user 2026-11-19): the box's July-1st figure (Clubs, Members, Women, Rotaract / Interact clubs ...).
  const base = c.fields.find((f) => ["total_clubs", "total_members", "existing_women_members"].includes(f.fieldKey) || /as on july/i.test(f.fieldLabel))?.numericValue;
  return { goal: goal == null ? null : Number(goal), achieved: num(ach?.numericValue ?? null), pct: pct == null ? null : Number(pct),
    baseline: base == null ? null : Number(base) };
}

/** Disha Overview "View clubs" report (user 2026-11-19): every club of the district DOWN, the club's Goal Setting boxes
 *  (the RCC goals + the extra boxes) ACROSS - same figures as the club's read-only Overview cards. */
export async function downloadDishaClubsReportFile(scope: { districtId: number; districtNumber: string; yearId: number; yearLabel?: string | null; clubs: { id: number; name: string }[] }) {
  const cats = await getGoalCategories();
  const future = isFutureYearLabel(scope.yearLabel ?? null);
  const cards: Record<number, Record<SectionKey, SectionCard[]>> = {};
  const queue = scope.clubs.map((c) => c.id);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      const cid = id;
      const res = await Promise.allSettled(cats.map(async (c) => withRag(withRotaryFields(await getClubGoalForm(c.id, scope.yearId, cid)))));
      cards[cid] = dishaCards(res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])), future);
    }
  }));
  const first = scope.clubs.map((c) => c.id).find((id) => cards[id]);
  if (first == null) throw new Error("No club goals to report.");
  const items: DishaFullReportItem[] = [];
  SECTION_TABS.forEach((s) => (cards[first][s.key] ?? []).forEach((tmpl) => {
    const gf = goalFieldOf(tmpl);
    items.push({ kind: "box", category: SECTION_NAMES[s.key], title: tmpl.name,
      number: !!gf || tmpl.fields.some((f) => /achieved$/.test(f.fieldKey)), twoDecimals: gf?.dataType === "Currency",
      cells: Object.fromEntries(scope.clubs.map((c) => {
        const card = cards[c.id]?.[s.key]?.find((x) => x.name === tmpl.name);
        if (!card) return [c.id, { goal: null, achieved: null, pct: null }];
        const g = goalFieldOf(card);
        return [c.id, cardFigures(g ? withDishaGoal(card, null) : card)];
      })) });
  }));
  const blob = await downloadDishaClubsReport(scope.districtId, { yearId: scope.yearId, clubs: scope.clubs, items });
  saveAs(blob, `Disha_Goals_Clubs_D${scope.districtNumber}_${fileTimestamp()}.xlsx`);
}

/** Goal Setting's month figures of a district (Membership, Foundation, Youth) by field key - the achieved per month,
 *  as the RCC report's Month wise sheet. Fields Goal Setting does not track by month are left out (yearly only). */
export async function boxMonthsOf(districtId: number, yearId: number | null): Promise<Record<string, Record<number, number>>> {
  const out: Record<string, Record<number, number>> = {};
  await Promise.all([1, 210, 211].map(async (c) => {
    let form;
    try { form = await getDistrictMonthlyGoalsScoped(c, districtId, yearId); }
    catch { try { form = await getDistrictMonthlyGoals(c, yearId, districtId); } catch { return; } }
    form?.fields.forEach((f) => {
      const m = Object.fromEntries(Object.entries(f.monthly ?? {}).filter(([, v]) => v != null).map(([k, v]) => [Number(k), Number(v)]));
      if (Object.keys(m).length > 0) out[f.fieldKey] = m;
    });
  }));
  return out;
}

/** Disha district view - Month-wise / Quarterly rows for the Goal Setting boxes (the 26 RCC goals + extras) that are not
 *  already a Disha question; Achieved / Goal as the Overview (Disha goal, else Goal Setting's); months from Goal Setting. */
export async function loadDishaBoxMonthly(districtId: number, yearId: number | null, yearLabel: string | null, dishaTitles: string[]): Promise<MonthlyLine[]> {
  if (!yearId) return [];
  const [cats, st, months] = await Promise.all([getGoalCategories(), getDishaDistrictGoalState(districtId, yearId).catch(() => null), boxMonthsOf(districtId, yearId)]);
  const res = await Promise.allSettled(cats.map(async (c) => withRag(withRotaryFields(await getDistrictGoalForm(c.id, yearId, districtId)))));
  const cards = dishaCards(res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])), isFutureYearLabel(yearLabel));
  const fake = dishaTitles.map((t) => ({ title: t }));
  const out: MonthlyLine[] = [];
  let n = 0;
  SECTION_TABS.forEach((s) => {
    orderSection(fake, cards[s.key] ?? []).forEach((it) => {
      if (it.kind !== "card") return;
      const raw = it.card;
      const gf = goalFieldOf(raw);
      const ach = raw.fields.find((f) => /achieved$/.test(f.fieldKey));
      if (!gf && !ach) return;   // RAG Analysis / Summary have no month figures
      const c = gf ? withDishaGoal(raw, st?.rccGoals?.[gf.fieldKey]) : raw;
      const fig = cardFigures(c);
      const base = ["total_clubs", "total_members", "existing_women_members"].some((k) => raw.fields.some((f) => f.fieldKey === k)) ? fig.baseline ?? null : null;
      out.push({ lineType: "box", lineId: ++n, categoryName: SECTION_NAMES[s.key], title: raw.name, source: "auto", isRisao: false,
        answerType: "number", goalValue: fig.goal, answerValue: fig.achieved, monthly: ach ? months[ach.fieldKey] ?? null : null, baseline: base });
    });
  });
  return out;
}

/** Disha Month-wise / Quarterly (RCC design, user 2026-11-19): the district's Disha questions + the Goal Setting boxes. */
export async function loadDishaPeriod(districtId: number, yearId: number | null, yearLabel: string | null) {
  const m = await getDishaAwardsDistrictMonthly(districtId, yearId);
  const boxes = await loadDishaBoxMonthly(districtId, m.yearId, yearLabel, m.lines.map((l) => l.title)).catch(() => []);
  return { months: m.months, lines: [...m.lines, ...boxes] };
}
/** A Disha line's section heading: the Goal Setting section its category belongs to, else the category itself. */
export function dishaPeriodGroup(l: MonthlyLine): string {
  const sk = sectionOfCategory(l.categoryName);
  return sk !== "other" ? SECTION_NAMES[sk] : l.categoryName;
}
