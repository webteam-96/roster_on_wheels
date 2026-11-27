"use client";

// Month-wise / Quarterly in the RCC Goals design (user 2026-11-19: "that type need to show everywhere") for the new goal
// flow - Disha Goals (RI Director / DG) and District Set Goals (DG / Club Admin). Same look and rules as the RCC popup
// (DistrictMonthWiseRotary): one navy block per section with Report / Quarterly / Month-wise on the right; As on July 1st ·
// Target · Target Details · Achieved · % Ach.; each month (or quarter) Target / Achieved; the target is the yearly goal
// spread over the months (the RCC / report rule - GoalSettingService.SpreadTarget), running; Achieved running; below the
// target red, equal yellow, above green. A question with no month figures shows its year figures and blank months.
// The same figures as the reports' Month wise / Quarter sheets.

import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/text-buttons";
import { useEffect, useState } from "react";
import { CalendarDays, CalendarRange, Download, Loader2 } from "@/components/icons";
import type { MonthlyLine } from "@/services/dishaApi";

type Data = { months: number[]; lines: MonthlyLine[] };
const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS = [{ label: "Q1 · Jul-Sep", months: [7, 8, 9] }, { label: "Q2 · Oct-Dec", months: [10, 11, 12] },
  { label: "Q3 · Jan-Mar", months: [1, 2, 3] }, { label: "Q4 · Apr-Jun", months: [4, 5, 6] }];

const fmt = (v: number | null | undefined, two = false) =>
  v == null ? "—" : two ? (Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(Math.round(v));

// GoalSettingService.SpreadTarget: less than one per slot = one each from the first slot; else equal, leftover last.
function spread(total: number, slots: number): number[] {
  if (slots <= 0) return [];
  const each = Math.trunc(total / slots);
  let rem = total - each * slots;
  const extra = each === 0 ? Math.trunc(rem) : 0;
  const out = Array.from({ length: slots }, (_, i) => each + (i < Math.abs(extra) ? Math.sign(extra) : 0));
  rem -= extra;
  out[slots - 1] += rem;
  return out;
}

function statusClass(target: number | null, achieved: number | null): string {
  if (achieved == null || target == null) return "text-go-text-primary";
  const t = Math.round(target), a = Math.round(achieved);
  if (a < t) return "bg-go-danger-50 text-go-danger-600 font-bold";
  if (a === t) return "bg-go-warning-50 text-go-warning-600 font-bold";
  return "bg-go-success-50 text-go-success-600 font-bold";
}

// Months that have started: the current Rotary year up to this month; an earlier year - all of them.
function startedMonths(months: number[], yearLabel?: string | null): Set<number> {
  const now = new Date();
  const curStart = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const ryStart = Number((yearLabel ?? "").match(/^(\d{4})/)?.[1] ?? curStart);
  const out = new Set<number>();
  months.forEach((m) => {
    const d = new Date(m >= 7 ? ryStart : ryStart + 1, m - 1, 1);
    if (d <= now) out.add(m);
  });
  return out;
}

const num = (v: string | null) => (v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);
const twoDp = (l: MonthlyLine) => l.isRisao || /fund|contribution|giving|csr|endowment|amount/i.test(l.title);

export default function RccPeriodView({ load, reloadKey, yearLabel, groupOf, onReport, initial = "month", dsg = false }: {
  load: () => Promise<Data>;
  reloadKey: string;
  yearLabel?: string | null;
  groupOf?: (l: MonthlyLine) => string;          // section heading of a line (default its category)
  onReport?: () => Promise<void>;                // the Report button on each section (the whole report)
  initial?: "month" | "quarter";
  // District Set Goals (user 2026-11-23): "Goal" wording (never Target), RCC Goal + District Set Goal columns, no %,
  // and the 26 RCC lines listed (year figures; Rotary.org gives no month split). Disha / RCC pass nothing - unchanged.
  dsg?: boolean;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "quarter">(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    load().then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || "Failed to load month-wise figures."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (err) return <p className="rounded-go-md bg-go-danger-50 px-4 py-3 text-go-body text-go-danger-600">{err}</p>;
  if (!data) return <div className="flex items-center gap-2 text-go-body text-go-text-muted p-4"><Loader2 size={14} className="animate-spin" /> Loading month-wise…</div>;

  const months = data.months.length ? data.months : [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
  const started = startedMonths(months, yearLabel);
  const groups: { name: string; lines: MonthlyLine[] }[] = [];
  // Only the fields that come by month (Rotary.org / RISAO / monthly counts) - yearly-only ones stay in the Year view (user 2026-11-19).
  data.lines.filter((l) => l.answerType === "number" && (l.monthly != null || (dsg && l.isRcc))).forEach((l) => {
    const g = groupOf ? groupOf(l) : l.categoryName;
    const hit = groups.find((x) => x.name === g);
    if (hit) hit.lines.push(l); else groups.push({ name: g, lines: [l] });
  });
  const slots = period === "quarter" ? QUARTERS.map((q) => ({ key: q.label, label: q.label, months: q.months }))
    : months.map((m) => ({ key: String(m), label: MONTH[m], months: [m] }));

  const btn = (active: boolean) => `inline-flex items-center gap-1.5 h-9 rounded-go-sm border px-3.5 text-go-label font-bold disabled:opacity-40 ${
    active ? "border-go-gold-500 bg-go-gold-500 text-go-navy-900" : "border-go-navy-50 bg-go-surface text-go-navy-700 hover:bg-go-sunken"}`;

  if (groups.length === 0) return <div className="rounded-go-lg border border-dashed border-go-border p-10 text-center text-go-body text-go-text-muted">No month-wise figures for these goals.</div>;

  return (
    <div className="space-y-5 p-1">
      <div className="flex flex-wrap items-center gap-3 text-go-meta text-go-text-secondary">
        <span className="font-bold text-go-text-primary">Achieved vs {dsg ? "District Set Goal" : "Target"}:</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-go-sm bg-go-danger-50" /> Below</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-go-sm bg-go-warning-50" /> Equal</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-go-sm bg-go-success-50" /> Above</span>
      </div>
      {groups.map((g) => {
        const hasBase = !dsg && g.lines.some((l) => l.baseline != null);
        const T = dsg ? "Goal" : "Target";
        return (
          <div key={g.name} className="rounded-go-lg border border-go-border bg-go-surface overflow-hidden">
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-go-value font-bold text-white bg-go-navy-900 border-b-[3px] border-go-gold-500">
              {g.name}
              <span className="text-go-meta font-semibold text-go-navy-50">Auto-calculated by ROW</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {onReport && (
                  <Button variant="outline" size="sm" type="button" disabled={busy}
                    onClick={async () => { setBusy(true); try { await onReport(); } finally { setBusy(false); } }}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Report
                  </Button>
                )}
                <ToggleButton pressed={period === "quarter"} type="button" onClick={() => setPeriod("quarter")}><CalendarRange size={14} /> Quarterly</ToggleButton>
                <ToggleButton pressed={period === "month"} type="button" onClick={() => setPeriod("month")}><CalendarDays size={14} /> Month-wise</ToggleButton>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table bare className="text-go-meta border-collapse w-full whitespace-nowrap">
                <thead>
                  <tr className="bg-go-navy-700 text-white">
                    <th rowSpan={2} className="px-3 py-2 text-left sticky left-0 z-10 bg-go-navy-700">Particulars</th>
                    {hasBase && <th rowSpan={2} className="px-2 py-2 text-right leading-tight">As on<br />July 1st</th>}
                    {dsg && <th rowSpan={2} className="px-2 py-2 text-right leading-tight">RCC<br />Goal</th>}
                    <th rowSpan={2} className="px-2 py-2 text-right leading-tight">{dsg ? <>District<br />Set Goal</> : "Target"}</th>
                    {hasBase && <th rowSpan={2} className="px-2 py-2 text-right leading-tight">Target<br />Details</th>}
                    <th rowSpan={2} className="px-2 py-2 text-right">Achieved</th>
                    {!dsg && <th rowSpan={2} className="px-2 py-2 text-right" title="% Achievement">% Ach.</th>}
                    {slots.map((s) => (
                      <th key={s.key} colSpan={2} className={`px-2 py-1.5 text-center border-l border-white/20 ${started.has(s.months[0]) ? "" : "text-white/50"}`}>{s.label}</th>
                    ))}
                  </tr>
                  <tr className="bg-go-navy-700 text-white/90 text-go-meta">
                    {slots.map((s) => [
                      <th key={`${s.key}t`} className="px-2 py-1 text-right font-semibold border-l border-white/20">{T}</th>,
                      <th key={`${s.key}a`} className="px-2 py-1 text-right font-semibold">Achieved</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => {
                    const two = twoDp(l);
                    const name = <td className="px-3 py-2 font-bold text-go-navy-900 sticky left-0 z-10 bg-go-surface whitespace-normal min-w-[220px]">{l.title}</td>;
                    if (l.answerType !== "number") {
                      const a = l.answerType === "yesno" ? (l.answerValue === "yes" ? "Yes" : l.answerValue === "no" ? "No" : null) : l.answerValue;
                      return (
                        <tr key={`${l.lineType}-${l.lineId}`} className="border-b border-go-border">
                          {name}
                          {hasBase && <td className="px-2 py-2 text-right text-go-text-muted">—</td>}
                          {dsg && <td className="px-2 py-2 text-right text-go-text-muted">—</td>}
                          <td className="px-2 py-2 text-right text-go-text-muted">{l.answerType === "yesno" ? "Yes" : "—"}</td>
                          {hasBase && <td className="px-2 py-2 text-right text-go-text-muted">—</td>}
                          <td className="px-2 py-2 text-right text-go-text-primary">{a || "—"}</td>
                          {!dsg && <td className="px-2 py-2 text-right text-go-text-muted">—</td>}
                          {slots.map((s) => <td key={s.key} colSpan={2} className="px-2 py-2 border-l border-go-border" />)}
                        </tr>
                      );
                    }
                    const start = l.baseline ?? 0;
                    const goal = l.goalValue != null ? Number(l.goalValue) : null;
                    const growth = goal == null ? null : goal - start;
                    const m = l.monthly;
                    const mv = (x: number) => Number(m?.[x] ?? 0);
                    const yearAch = m ? months.reduce((t, x) => t + mv(x), 0) : (num(l.answerValue) != null ? num(l.answerValue)! - start : null);
                    const pct = growth && growth > 0 && yearAch != null ? Math.round((yearAch / growth) * (two ? 10000 : 100)) / (two ? 100 : 1) : null;
                    const shares = growth == null ? null : growth <= 0 ? months.map(() => 0) : spread(Math.round(growth), months.length);
                    const share = (x: number) => shares?.[months.indexOf(x)] ?? 0;
                    // Month-wise: running from July; Quarterly: that quarter only (the report's rule).
                    let runT = 0, runA = 0;
                    const cells = slots.map((s, i) => {
                      if (period === "month") {
                        runT += share(s.months[0]); runA += mv(s.months[0]);
                        return { t: shares ? runT : null, a: m && started.has(s.months[0]) ? runA : null, i };
                      }
                      const t = shares ? s.months.reduce((x, y) => x + share(y), 0) : null;
                      return { t, a: m && started.has(s.months[0]) ? s.months.reduce((x, y) => x + mv(y), 0) : null, i };
                    });
                    return (
                      <tr key={`${l.lineType}-${l.lineId}`} className="border-b border-go-border">
                        {name}
                        {hasBase && <td className="px-2 py-2 text-right text-go-text-secondary">{l.baseline != null ? fmt(l.baseline) : "—"}</td>}
                        {dsg && <td className="px-2 py-2 text-right text-go-text-secondary">{l.isRcc ? fmt(l.rccGoal ?? null, two) : "—"}</td>}
                        <td className="px-2 py-2 text-right text-go-text-primary">{fmt(goal, two)}</td>
                        {hasBase && <td className="px-2 py-2 text-right font-bold text-go-text-primary">{l.baseline != null ? fmt(growth) : "—"}</td>}
                        <td className={`px-2 py-2 text-right ${statusClass(growth, yearAch)}`}>{fmt(yearAch, two)}</td>
                        {!dsg && <td className="px-2 py-2 text-right font-bold text-go-text-primary">{pct == null ? "—" : `${pct}%`}</td>}
                        {m ? cells.map((c) => [
                          <td key={`${c.i}t`} className="px-2 py-2 text-right text-go-text-secondary border-l border-go-border">{fmt(c.t, two)}</td>,
                          <td key={`${c.i}a`} className={`px-2 py-2 text-right ${statusClass(c.t, c.a)}`}>{fmt(c.a, two)}</td>,
                        ]) : slots.map((s) => <td key={s.key} colSpan={2} className="px-2 py-2 text-center text-go-text-muted border-l border-go-border">—</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
