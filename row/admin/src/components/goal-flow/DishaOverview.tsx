"use client";

// Disha Goals - Overview tab: one table (Category | Question | Goal | Achieved | %) per the RCC Goals design
// (user 2026-11-20), for the RI Director / SA (Zone / District from the page's filter bar) and the DG (own district).
// Each section, in the Goal Setting card order (Clubs, Members, Women Members, RAG Analysis, Summary, ...):
//   - the Goal Setting / RCC cards (the 26 RCC goals + Clubs, Members, Women Members, RAG Analysis, Summary) with
//     their DISHA goal (set in Set Goals / by the DG - never from Rotary.org / RISAO) and Goal Setting's Achieved;
//   - a Disha question that IS one of those cards takes its place; the other Disha questions come after.
// Read only (goals are set in the Set Goals tab).

import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Loader2, Lock, LockOpen } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getDishaOverview, getDishaDistrictOverview, getDishaDistrictGoalState, getDishaGoalState, setDishaLocks,
  type DishaZone, type DishaOverviewLine, type DishaGoalState,
} from "@/services/dishaApi";
import type { GoalSourceDates } from "@/services/api";
import {
  SECTION_TABS, sectionHeading, categoryShortName, cardSourceNote, isRotaryOnlyCard, dayLabel, overviewLabel, RAG_BANDS, asOnWording,
  type SectionKey, type SectionCard,
} from "@/lib/goalRotaryLayout";
import { goalFieldOf, existingGoalOf, withDishaGoal, orderSection, sectionOfCategory, type DishaSection } from "@/lib/dishaRccGoals";
import { useDishaRccCards } from "@/components/goal-flow/useDishaRccCards";
import RotaryLoader from "@/components/RotaryLoader";
import { downloadDishaReport, loadDishaPeriod, dishaPeriodGroup } from "@/lib/dishaReport";
import RccPeriodView from "@/components/goal-flow/RccPeriodView";
import type { GoalFieldWithValueDto } from "@/types/goalSetting";

type Data = Awaited<ReturnType<typeof getDishaOverview>>;
type Group = { key: DishaSection | string; heading: string; section?: SectionKey; lock: DishaSection; lines: DishaOverviewLine[] };

// Same RAG scale as the Goal Setting overview: 0-10 red, 11-25 yellow, 26-50 orange, 51-100 blue, 101+ purple.
const ragFill = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;
const SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };

const fmtNum = (v: number | string | null | undefined, dp: number) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { maximumFractionDigits: dp });
};
const fmtPct = (p: number | null, dp: number) =>
  p == null ? "—" : `${p.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
// Goal Setting box value (as GoalOversightMatrixRotary).
const fmtField = (f: GoalFieldWithValueDto, v: number | null | undefined) => {
  if (f.dataType === "Boolean") return f.boolValue ? "YES" : "NO";
  if (v == null) return "";
  const s = Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return f.dataType === "Currency" ? `$${s}` : f.dataType === "Percentage" ? `${s}%` : s;
};
function Tag({ kind }: { kind: "auto" | "manual" }) {
  const c = kind === "auto" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-go-meta font-bold ${c}`}>{kind === "auto" ? "Auto Fetch" : "Manual Entry"}</span>;
}

// Zone / District come from the common filter bar of the Disha Goals page (user 2026-11-18) - one filter for every tab.
// dgDistrictId (user 2026-11-18): the DG's own Overview - that one district, read only (lock state shown, no Lock buttons).
export default function DishaOverview({ yearId, yearLabel, zoneId, districtFilter, dgDistrictId, lockTick = 0 }: {
  lockTick?: number;   // bumped by the page's Lock All / Unlock All (user 2026-11-19) - reload the locks
  dgDistrictId?: number;
  zoneId: number | null;
  districtFilter: number | null;
  yearId: number | null;
  yearLabel?: string | null;
  zones: DishaZone[];   // passed by the callers; not used by the table
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<{ canManage: boolean; districts: Record<number, DishaGoalState> } | null>(null);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  // "Month wise" (user 2026-11-19): the district's month-wise / quarterly figures in a popup.
  const [monthOf, setMonthOf] = useState<{ id: number; number: string } | null>(null);

  useEffect(() => {
    if (!yearId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    (dgDistrictId ? getDishaDistrictOverview(dgDistrictId, yearId) : getDishaOverview(yearId, zoneId))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load the overview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [yearId, zoneId, dgDistrictId]);
  const [stateFor, setStateFor] = useState<string | null>(null);   // the year + zone the goals / locks were loaded for
  const loadState = useCallback(() => {
    if (!yearId) return;
    const k = `${yearId}-${zoneId ?? 0}`;
    (dgDistrictId
      ? getDishaDistrictGoalState(dgDistrictId, yearId).then((st) => ({ canManage: false, districts: { [dgDistrictId]: { locks: st.locks, rccGoals: st.rccGoals } } }))
      : getDishaGoalState(yearId, zoneId))
      .then(setState).catch(() => setState(null)).finally(() => setStateFor(k));
  }, [yearId, zoneId, dgDistrictId]);
  useEffect(() => { loadState(); }, [loadState, lockTick]);

  const allIds = useMemo(() => (data?.districts ?? []).map((d) => d.districtId), [data]);
  const { byDistrict: rcc, ready: rccReady } = useDishaRccCards(data ? allIds : null, yearId, yearLabel);

  // Sections: the 4 Rotary.org sections in the Goal Setting order, then any extra Disha category.
  const groups: Group[] = useMemo(() => {
    const lines = data?.lines ?? [];
    const out: Group[] = SECTION_TABS.map((s, i) => ({
      key: s.key, section: s.key, lock: s.key,
      heading: sectionHeading({ key: s.key, no: i + 1, title: s.title, labels: [], owners: [], cards: [] }),
      lines: lines.filter((l) => sectionOfCategory(l.categoryName) === s.key),
    }));
    const extra = Array.from(new Set(lines.filter((l) => sectionOfCategory(l.categoryName) === "other").map((l) => l.categoryName)));
    extra.forEach((c, i) => out.push({ key: `x:${c}`, lock: "other", heading: `${SECTION_TABS.length + i + 1}. ${c}`, lines: lines.filter((l) => l.categoryName === c) }));
    return out;
  }, [data]);

  const goalsOf = (id: number) => state?.districts?.[id]?.rccGoals ?? {};
  const locksOf = (id: number) => state?.districts?.[id]?.locks ?? [];
  // One district's cards of a section, with its Disha goals.
  const cardsOf = (id: number, section?: SectionKey): SectionCard[] =>
    !section ? [] : (rcc[id]?.cards[section] ?? []).map((c) => { const gf = goalFieldOf(c); return gf ? withDishaGoal(c, goalsOf(id)[gf.fieldKey]) : c; });
  const noteOf = (g: SectionCard, dt: GoalSourceDates | null, total = false) => {
    const n = cardSourceNote(g, dt, total);
    if (n || !isRotaryOnlyCard(g)) return asOnWording(n);
    const d = dayLabel(g.form.rotaryOrgUpdatedAt);
    return d ? `Updated from Rotary.org as on ${d}` : "Updated from Rotary.org";
  };
  // Total card of the districts in view: every figure added up (not "Highest"), the Disha goals added up, % again.
  const totalCard = (template: SectionCard, section: SectionKey): SectionCard => {
    const sum = (key: string) => {
      let s = 0, any = false;
      allIds.forEach((id) => {
        const v = (rcc[id]?.cards[section] ?? []).find((c) => c.name === template.name)?.fields.find((f) => f.fieldKey === key)?.numericValue;
        if (v != null) { s += Number(v); any = true; }
      });
      return any ? s : null;
    };
    const gf = goalFieldOf(template);
    const fields = template.fields.filter((f) => !/highest/i.test(f.fieldLabel) && f.dataType !== "Boolean")
      .map((f) => f.dataType === "Percentage" ? { ...f, numericValue: null } : { ...f, numericValue: sum(f.fieldKey) });
    const card = { ...template, fields };
    if (!gf) return { ...card, fields: fields.filter((f) => f.dataType !== "Percentage") };
    let g = 0, any = false;
    // Each district's goal: its Disha goal, else the goal already in Goal Setting (user 2026-11-18).
    allIds.forEach((id) => {
      const v = goalsOf(id)[gf.fieldKey] ?? existingGoalOf((rcc[id]?.cards[section] ?? []).find((c) => c.name === template.name));
      if (v != null) { g += Number(v); any = true; }
    });
    return withDishaGoal(card, any ? g : null);
  };

  const districts = (data?.districts ?? []).filter((d) => !districtFilter || d.districtId === districtFilter);
  const firstId = allIds.find((id) => rcc[id]);
  const canManage = !!state?.canManage;
  const lockSections = groups.some((g) => g.lock === "other") ? [...SECTION_TABS.map((s) => s.key as DishaSection), "other" as DishaSection] : SECTION_TABS.map((s) => s.key as DishaSection);

  async function lock(key: string, body: { districtIds?: number[] | null; sections?: string[] | null; locked: boolean }) {
    if (!yearId) return;
    setLockBusy(key);
    try { await setDishaLocks({ yearId, zoneId, ...body }); loadState(); }
    catch (e: any) { setError(e?.response?.data?.message || "Failed to update the lock."); }
    finally { setLockBusy(null); }
  }

  const items = (g: Group, id: number | null) =>
    orderSection(g.lines, id == null ? [] : g.section ? (rcc[id]?.cards[g.section] ?? []) : []);

  // One loader until everything is in (user 2026-11-18): districts, goals / locks and every district's Goal Setting
  // figures - no half page that fills in after a few seconds.
  const fullyLoaded = !loading && !!data && stateFor === `${yearId}-${zoneId ?? 0}` && (allIds.length === 0 || rccReady);
  if (!error && !fullyLoaded)
    return <div className="py-20 flex flex-col items-center gap-3 text-go-body text-go-text-muted"><RotaryLoader /> Loading Disha goals…</div>;

  // One table like RCC Goals - Category | Question | Total Goal | Achieved | % (user 2026-11-20).
  // All zones / a zone = the total of its districts; one district (or the DG's own) = its own figures, locks and actions.
  const one = districts.length === 1 ? districts[0] : null;
  const table = (() => {
    if (!data || error || data.districts.length === 0) return null;
    const srcId = one ? one.districtId : firstId ?? null;
    const dates = srcId != null ? rcc[srcId]?.dates ?? null : null;
    const th = "border-b border-r border-go-border-strong last:border-r-0 bg-go-sunken px-3 py-3 text-go-label font-bold uppercase tracking-wide text-go-text-secondary";
    const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5 align-top";
    const numTd = `${td} text-right tabular-nums whitespace-nowrap font-semibold text-go-navy-900`;
    const btn = "inline-flex items-center gap-1.5 h-9 px-3 rounded-go-sm border border-go-border-strong bg-go-surface text-go-label font-semibold text-go-navy-700 hover:bg-go-navy-50 disabled:opacity-40";
    const pctCell = (p: number | null | undefined, dp = 0) => p == null ? "—" : (
      <span className="inline-flex items-center gap-1.5 font-bold">
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ragFill(Number(p)) }} />{fmtPct(Number(p), dp)}
      </span>
    );
    const question = (title: string, note: string | null | undefined, tag?: "auto" | "manual", extra?: ReactNode) => (
      <>
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold leading-snug">{title}</span>{tag && <Tag kind={tag} />}</div>
        {note && <div className="text-go-meta text-go-text-secondary">{note}</div>}
        {extra}
      </>
    );
    const row = (key: string, category: string, q: ReactNode, goal: ReactNode, achieved: ReactNode, pct: ReactNode) => (
      <tr key={key}>
        <td className={`${td} font-semibold text-go-navy-700`}>{category}</td>
        <td className={`${td} text-go-text-primary`}>{q}</td>
        <td className={`${numTd} bg-go-navy-50`}>{goal}</td>
        <td className={`${numTd} bg-go-sunken`}>{achieved}</td>
        <td className={`${numTd} bg-go-navy-50`}>{pct}</td>
      </tr>
    );
    const locks = one ? locksOf(one.districtId) : [];
    return (
      <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-hidden">
        {one && (
          <div className="flex flex-wrap items-center gap-2 border-b border-go-border px-4 py-3">
            {state && lockSections.map((s) => {
              const on = locks.includes(s), k = `${one.districtId}-${s}`;
              return canManage ? (
                <Button variant="outline" size="sm" key={s} type="button" disabled={!!lockBusy} onClick={() => lock(k, { districtIds: [one.districtId], sections: [s], locked: !on })}>
                  {lockBusy === k ? <Loader2 size={13} className="animate-spin" /> : on ? <LockOpen size={13} /> : <Lock size={13} />}
                  {on ? "Unlock" : "Lock"} {SHORT[s]}
                </Button>
              ) : (
                <span key={s} className="inline-flex items-center gap-1 text-go-label text-go-text-secondary">
                  {on ? <Lock size={12} /> : <LockOpen size={12} />}{SHORT[s]} {on ? "locked" : "unlocked"}
                </span>
              );
            })}
            <span className="flex-1" />
            <Button variant="outline" size="sm" type="button" onClick={() => setMonthOf({ id: one.districtId, number: one.districtNumber })}><CalendarDays size={14} /> Month wise</Button>
          </div>
        )}
        <Table bare className="w-full table-fixed border-separate border-spacing-0 text-go-body">
          <colgroup><col className="w-[16%]" /><col /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[10%]" /></colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${th} text-left`}>Category</th>
              <th className={`${th} text-left`}>Question</th>
              <th className={`${th} text-right`}>{dgDistrictId ? "Goal" : "Total Goal"}</th>
              <th className={`${th} text-right`}>Achieved</th>
              <th className={`${th} text-right`}>%</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const list = items(g, srcId);
              if (list.length === 0) return null;
              return (
                <Fragment key={g.key}>
                  <tr><td colSpan={5} className="border-b border-go-border-strong bg-go-navy-900 px-3 py-2.5 text-go-title font-bold text-white">{g.heading}</td></tr>
                  {list.map((it) => {
                    if (it.kind === "line") {
                      const l = it.line, cell = one ? one.cells[l.key] : data.totals[l.key];
                      const dp = l.isRisao ? 2 : 0, num = l.answerType === "number";
                      const note = it.card ? noteOf(it.card, dates, !one) : l.isRisao && data.risaoAsOn ? `Updated from RISAO as on ${data.risaoAsOn}` : null;
                      const ach = num ? fmtNum(cell?.achieved, dp)
                        : l.answerType === "choose_one" && !one ? "—"
                        : l.answerType === "yesno" && !one ? `${cell?.achieved || "0"} with Yes` : cell?.achieved || "—";
                      return row(l.key, it.card ? categoryShortName(it.card.form.categoryId, it.card.form.categoryName) : SHORT[sectionOfCategory(l.categoryName)] === "Other" ? l.categoryName : SHORT[sectionOfCategory(l.categoryName)],
                        question(l.title, note, l.source === "auto" ? "auto" : "manual"), num ? fmtNum(cell?.goal, dp) : "—", ach, num ? pctCell(cell?.pct, dp) : "—");
                    }
                    const c = one ? cardsOf(one.districtId, g.section).find((x) => x.name === it.card.name) ?? it.card : totalCard(it.card, g.section!);
                    const category = categoryShortName(c.form.categoryId, c.form.categoryName);
                    const note = noteOf(it.card, dates, !one);
                    if (c.fields.some((f) => f.fieldKey.startsWith("rag5_"))) {
                      const vals = RAG_BANDS.map((b) => Number(c.fields.find((f) => f.fieldKey === b.key)?.numericValue ?? 0));
                      return row(c.name, category, question(c.name, note, undefined, (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-go-meta text-go-text-primary">
                          {RAG_BANDS.map((b, i) => <span key={b.key} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-go-sm" style={{ background: b.color }} />{b.label}: <b>{vals[i]}</b></span>)}
                        </div>
                      )), "—", `${vals.reduce((a, b) => a + b, 0).toLocaleString("en-IN")} clubs`, "—");
                    }
                    const gf = goalFieldOf(c);
                    const pf = c.fields.find((f) => f.dataType === "Percentage");
                    const af = c.fields.find((f) => /achieved$/.test(f.fieldKey)) ?? c.fields.find((f) => f !== gf && f !== pf && /achiev/i.test(f.fieldLabel));
                    // No goal / achieved pair (e.g. Summary): each figure on its own row, under Achieved.
                    if (!gf && !af) return (
                      <Fragment key={c.name}>
                        {c.fields.filter((f) => f !== pf).map((f) => row(`${c.name}-${f.fieldKey}`, category, question(`${c.name}: ${overviewLabel(f.fieldLabel)}`, note), "—", fmtField(f, f.numericValue) || "—", "—"))}
                      </Fragment>
                    );
                    return row(c.name, category, question(c.name, note),
                      gf ? (gf.numericValue == null ? "No goal" : fmtField(gf, gf.numericValue)) : "—",
                      af ? fmtField(af, af.numericValue) || "—" : "—",
                      pctCell(pf?.numericValue, gf?.dataType === "Currency" ? 2 : 0));
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </section>
    );
  })();

  return (
    <div className="space-y-4">
      {!loading && error && <div className="rounded-go-md border border-go-danger-600 bg-go-danger-50 p-4 text-go-body text-go-danger-600">{error}</div>}
      {data && data.districts.length === 0 && <p className="p-6 text-go-body text-go-text-muted">No districts in your scope.</p>}
      {table}
      {/* Month wise - the district's Disha questions + Goal Setting boxes, by month or quarter (same figures as the report). */}
      <Dialog open={!!monthOf} onOpenChange={(o) => { if (!o) setMonthOf(null); }}>
        <DialogContent className="max-w-[98vw] sm:max-w-[98vw] w-[98vw] h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><CalendarDays size={18} className="text-go-navy-700" /> Month wise — District {monthOf?.number}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {monthOf && (
              <RccPeriodView reloadKey={`${monthOf.id}-${yearId ?? "cur"}`} yearLabel={yearLabel} groupOf={dishaPeriodGroup}
                load={() => loadDishaPeriod(monthOf.id, yearId, yearLabel ?? null)}
                onReport={async () => {
                  if (!yearId) return;
                  try { await downloadDishaReport({ yearId, yearLabel, districtId: monthOf.id, dg: !!dgDistrictId }); }
                  catch (e: any) { setError(e?.message && !e?.response ? e.message : "Could not download the report."); }
                }} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
