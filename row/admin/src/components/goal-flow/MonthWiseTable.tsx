"use client";

// Month-wise view (user 2026-11-18, option A) for Disha Goals and District Set Goals: every question with its goal,
// the achieved figure for each month Jul..Jun (Auto = counted by month, fund figures = the monthly Rotary.org import), the year's
// total and %. Manual questions are answered once a year - their months show "—".

import { Table } from "@/components/ui/table";
import { useEffect, useState } from "react";
import RotaryLoader from "@/components/RotaryLoader";
import type { MonthlyLine } from "@/services/dishaApi";
import { PctBadge, SourceBadge, RisaoNote, groupBy, gsAdjust } from "./common";

const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Quarterly (user 2026-11-19): Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun - the months added up.
const QUARTERS = [{ label: "Q1 (Jul-Sep)", months: [7, 8, 9] }, { label: "Q2 (Oct-Dec)", months: [10, 11, 12] },
  { label: "Q3 (Jan-Mar)", months: [1, 2, 3] }, { label: "Q4 (Apr-Jun)", months: [4, 5, 6] }];

export default function MonthWiseTable({ load, reloadKey, only, bare, period = "month" }: {
  period?: "month" | "quarter";
  load: () => Promise<{ months: number[]; risaoAsOn: string | null; lines: MonthlyLine[] }>; reloadKey?: string;
  only?: "auto" | "manual";   // Auto / Manual section (user 2026-11-18)
  bare?: boolean;             // inside an accordion section - no own border
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    load().then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || "Failed to load month-wise figures."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>;
  if (!data) return <div className="py-16 flex justify-center"><RotaryLoader /></div>;
  const shownLines = only ? data.lines.filter((l) => (l.source === "manual") === (only === "manual")) : data.lines;
  if (shownLines.length === 0) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No questions yet.</div>;

  const total = (l: MonthlyLine) => l.monthly ? Object.values(l.monthly).reduce((a, b) => a + Number(b || 0), 0) : null;
  const ansNum = (l: MonthlyLine) => (l.answerValue != null && l.answerValue !== "" ? Number(l.answerValue) : null);
  // Goal Setting box: Achieved = 1 July + the months (= Goal Setting's Achieved), % = Goal Setting's formula.
  const yearly = (l: MonthlyLine) => {
    if (l.answerType !== "number") return null;
    const t = total(l);
    if (l.baseline != null) return t != null ? l.baseline + t : ansNum(l);
    return t ?? ansNum(l);
  };
  const pct = (l: MonthlyLine) => {
    if (l.answerType === "yesno") return l.answerValue ? (l.answerValue === "yes" ? 100 : 0) : null;
    const y = yearly(l); const g = Number(l.goalValue);
    if (y == null || !(g > 0)) return null;
    const [g2, y2] = gsAdjust(g, y, l.baseline, l.youth);
    return g2 > 0 ? Math.round((y2 / g2) * 10000) / 100 : null;
  };

  return (
    <div className={bare ? "overflow-x-auto" : "rounded-2xl border border-slate-200 bg-white overflow-x-auto"}>
      <Table bare className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left min-w-[16rem]">Question</th>
            <th className="px-2 py-2 text-right">Goal</th>
            {period === "quarter"
              ? QUARTERS.map((qq) => <th key={qq.label} className="px-2 py-2 text-right">{qq.label}</th>)
              : data.months.map((m) => <th key={m} className="px-2 py-2 text-right">{MONTH[m]}</th>)}
            <th className="px-2 py-2 text-right">Achieved</th>
            <th className="px-2 py-2 text-center">Achieved %</th>
          </tr>
        </thead>
        <tbody>
          {groupBy(shownLines, (l) => l.categoryName).map(([cat, rows]) => (
            <FragmentRows key={cat} cat={cat} span={(period === "quarter" ? QUARTERS.length : data.months.length) + 4}>
              {rows.map((l) => {
                const y = yearly(l);
                return (
                  <tr key={`${l.lineType}:${l.lineId}`} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <div className="font-medium text-slate-800">{l.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2"><SourceBadge source={l.source} />{l.isRisao && <RisaoNote asOn={data.risaoAsOn} />}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.answerType === "number" ? (l.goalValue != null ? fmt(Number(l.goalValue)) : "—") : l.answerType === "yesno" ? "Yes" : "—"}</td>
                    {period === "quarter"
                      ? QUARTERS.map((qq) => (
                          <td key={qq.label} className="px-2 py-2 text-right tabular-nums text-slate-700">
                            {l.monthly ? fmt(qq.months.reduce((t, m) => t + Number(l.monthly![m] ?? 0), 0)) : <span className="text-slate-300">—</span>}
                          </td>
                        ))
                      : data.months.map((m) => (
                          <td key={m} className="px-2 py-2 text-right tabular-nums text-slate-700">
                            {l.monthly ? (l.monthly[m] != null ? fmt(Number(l.monthly[m])) : "0") : <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                    <td className="px-2 py-2 text-right font-bold tabular-nums">
                      {l.answerType === "number" ? (y != null ? fmt(y) : "—") : (l.answerValue ? (l.answerType === "yesno" ? (l.answerValue === "yes" ? "Yes" : "No") : l.answerValue) : "—")}
                    </td>
                    <td className="px-2 py-2 text-center"><PctBadge dp={l.isRisao ? 2 : 0} pct={pct(l)} /></td>
                  </tr>
                );
              })}
            </FragmentRows>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function FragmentRows({ cat, span, children }: { cat: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-[#EEF3FB]"><td colSpan={span} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#0B2A5E]">{cat}</td></tr>
      {children}
    </>
  );
}
