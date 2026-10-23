"use client";

// District month-wise, rendered like the "District Goal Setting" report's Month-wise sheet: per category,
// metric rows × month columns (cumulative Achieved to each month) + Total. Read-only, used inside the
// goal-oversight row-click popup. Reuses the same monthly data the report + parent panel use.

import { useEffect, useState } from "react";
import { isAnnualOnlyCategory } from "@/lib/goalCategories";
import { Loader2 } from "@/components/icons";
import { getGoalCategories, getDistrictMonthlyGoalsScoped, type GoalMonthlyForm } from "@/services/api";
import { monthlyFieldLabel } from "@/lib/goalCategories";

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : String(Math.round(v));   // whole numbers only (user 2026-09-29)

// % Achievement, same formula as the District Goal Setting report / oversight matrix:
// membership metrics (have a baseline) → (achieved − baseline)/(target − baseline); others → achieved/target.
function pctAchieved(baseline: number | null | undefined, target: number | null | undefined, achieved: number | null): string {
  if (achieved === null || target === null || target === undefined) return "–";
  const b = baseline ?? null;
  const denom = b === null ? target : target - b;
  const numer = b === null ? achieved : achieved - b;
  if (!denom) return "–";
  const p = (numer / denom) * 100;
  return `${(Math.round(p * 100) / 100).toString()}%`;
}

// Running monthly TARGET (user 2026-10-09) - same rule as the "Month wise" Excel sheet: the year's
// growth (Target − As on July 1st; the Target itself for Foundation) split over the months in whole
// numbers, the whole leftover in the LAST month (June), as a running total. 122 → 135: Jul 123 …
// May 133, Jun 135; 10 → 13: Jul–May 10, Jun 13. A split the admin saved (pilot) is used as it is.
function runningTargets(f: GoalMonthlyForm["fields"][number], months: { month: number }[]): (number | null)[] {
  const start = f.baseline ?? 0;
  const saved = !f.targetsAreSuggested && Object.values(f.monthlyTargets ?? {}).some((v) => v != null);
  let shares: number[];
  if (saved) shares = months.map((mo) => f.monthlyTargets?.[mo.month] ?? 0);
  else if (f.annualTarget != null && months.length > 0) {
    const growth = Math.round(f.annualTarget - start);
    if (growth <= 0) return months.map(() => f.annualTarget);
    const each = Math.floor(growth / months.length);
    const extra = growth - each * months.length;
    shares = months.map((_, i) => each + (i === months.length - 1 ? extra : 0));
  } else return months.map(() => null);
  let run = start;
  return shares.map((x) => (run += x));
}

// `categoryId` = the category the district list behind the popup is showing. Given it, the popup
// reports that one category only, instead of stacking all four (user 2026-09-21).
export default function DistrictMonthWiseReport(
  { districtId, yearId, categoryId = null }: { districtId: number; yearId: number; categoryId?: number | null },
) {
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [forms, setForms] = useState<Record<number, GoalMonthlyForm | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const all = await getGoalCategories();
        if (cancelled) return;
        // Youth Service / Public Image are annual only (user 2026-09-25): a month-wise view never
        // lists them, so Membership and TRF are all that can appear here.
        const monthWise = all.filter((c) => !isAnnualOnlyCategory(c.name));
        const cs = categoryId != null ? monthWise.filter((c) => c.id === categoryId) : monthWise;
        setCats(cs.map((c) => ({ id: c.id, name: c.name })));
        const out: Record<number, GoalMonthlyForm | null> = {};
        await Promise.all(cs.map(async (c) => {
          try { out[c.id] = await getDistrictMonthlyGoalsScoped(c.id, districtId, yearId); } catch { out[c.id] = null; }
        }));
        if (!cancelled) setForms(out);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [districtId, yearId, categoryId]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-slate-400 p-4"><Loader2 size={14} className="animate-spin" /> Loading month-wise…</div>;

  return (
    <div className="space-y-6 p-1">
      {cats.map((c) => {
        const form = forms[c.id];
        const months = form?.months ?? [];
        return (
          <div key={c.id}>
            <div className="text-sm font-semibold text-white px-3 py-1.5 rounded-t-lg" style={{ backgroundColor: "#17458f" }}>{c.name}</div>
            {!form || form.fields.length === 0 ? (
              <div className="border border-t-0 border-slate-200 rounded-b-lg px-3 py-4 text-xs text-slate-400">No month-wise data for this category.</div>
            ) : (
              <div className="overflow-x-auto border border-t-0 border-slate-200 rounded-b-lg">
                <table className="text-xs border-collapse w-full whitespace-nowrap">
                  {/* Every month has a Target | Achieved pair (user 2026-10-09); metrics stay one row each. */}
                  <thead>
                    <tr style={{ backgroundColor: "#17458f" }} className="text-white">
                      <th rowSpan={2} className="px-2 py-1.5 text-left sticky left-0 z-10" style={{ backgroundColor: "#17458f" }}>Particulars</th>
                      <th rowSpan={2} className="px-2 py-1.5 text-right">As on July 1st</th>
                      <th rowSpan={2} className="px-2 py-1.5 text-right">Target</th>
                      {months.map((mo) => <th key={mo.month} colSpan={2} className={`px-2 py-1 text-center border-l border-white/20 ${mo.isAvailable ? "" : "text-white/50"}`}>{mo.label}</th>)}
                      <th rowSpan={2} className="px-2 py-1.5 text-right border-l border-white/20">Achieved</th>
                      <th rowSpan={2} className="px-2 py-1.5 text-right">% Achievement</th>
                    </tr>
                    <tr style={{ backgroundColor: "#17458f" }} className="text-white/90 text-[10px]">
                      {months.map((mo) => [
                        <th key={`${mo.month}t`} className="px-2 py-1 text-right font-medium border-l border-white/20">Target</th>,
                        <th key={`${mo.month}a`} className="px-2 py-1 text-right font-medium">Achieved</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Membership's yearly-only rows (RED / AMBER / GREEN + the 3 Summary totals) have
                        nothing month-wise - hidden here (user 2026-10-09); the YTD screens keep them. */}
                    {form.fields.filter((f) => !(f.monthlyTracked === false && c.name.toLowerCase() === "membership")).map((f) => {
                      // Annual-only field (baseline, RAG, Summary, Total Giving, Youth "Existing/Total",
                      // Public Image Other Points + Suggestions): show its value, leave the months empty.
                      if (f.monthlyTracked === false) {
                        return (
                          <tr key={f.fieldId} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-medium text-slate-800 sticky left-0 z-10 bg-white">{monthlyFieldLabel(f)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">, </td>
                            <td className="px-2 py-1.5 text-right text-slate-700 whitespace-pre-line">{f.displayText ?? fmt(f.annualTarget)}</td>
                            {months.map((mo) => <td key={mo.month} colSpan={2} className="px-2 py-1.5 border-l border-slate-100" />)}
                            <td className="px-2 py-1.5 text-right text-slate-400">, </td>
                            <td className="px-2 py-1.5 text-right text-slate-400">, </td>
                          </tr>
                        );
                      }
                      // Cumulative Achieved to each month = baseline + Σ additions so far (matches the report).
                      let run = f.baseline ?? 0;
                      let last: number | null = null;
                      const cells = months.map((mo) => {
                        if (!mo.isAvailable) return null;
                        const v = f.monthly?.[mo.month];
                        run += (v ?? 0);
                        last = run;
                        return run;
                      });
                      const tgts = runningTargets(f, months);
                      return (
                        <tr key={f.fieldId} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-medium text-slate-800 sticky left-0 z-10 bg-white">{monthlyFieldLabel(f)}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">{fmt(f.baseline)}</td>
                          <td className="px-2 py-1.5 text-right text-slate-700">{fmt(f.annualTarget)}</td>
                          {cells.map((v, j) => [
                            <td key={`${j}t`} className="px-2 py-1.5 text-right text-slate-500 border-l border-slate-100">{fmt(tgts[j])}</td>,
                            <td key={`${j}a`} className="px-2 py-1.5 text-right text-slate-800">{v === null ? "–" : fmt(v)}</td>,
                          ])}
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-800">{last === null ? "–" : fmt(last)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{pctAchieved(f.baseline, f.annualTarget, last)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
