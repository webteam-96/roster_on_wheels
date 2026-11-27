"use client";

// Shared bits of the new goal flow screens (user 2026-11-17): Disha Goals and District Set Goals.

import { Button } from "@/components/ui/button";
import { MenuItemButton } from "@/components/ui/text-buttons";
import { NativeSelect } from "@/components/ui/native-select";
import { useState } from "react";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { ChevronDown, Zap, Edit3, Download } from "@/components/icons";
import { goalRagClass, fmtGoalPct } from "@/components/awards/GoalAchievement";

export const TYPE_LABEL: Record<string, string> = { number: "Number", yesno: "Yes / No", choose_one: "Choose one", text: "Text" };

export const inputCls = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2A5E]/40 disabled:bg-slate-50 disabled:text-slate-500";

// dp = decimals: Membership whole, Foundation (fund figures) 2 - same as Goal Setting (user rule).
export function PctBadge({ pct, dp = 0 }: { pct: number | null; dp?: number }) {
  const text = dp === 0 ? fmtGoalPct(pct, 0)
    : pct == null || Number.isNaN(pct) ? "—" : `${pct.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
  return <span className={`inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 tabular-nums ${goalRagClass(pct)}`}>{text}</span>;
}

/** Goal Setting's % for a Disha question that is a Goal Setting box (user 2026-11-18): Membership
 *  = (Achieved - 1 July) / (Goal - 1 July); Youth (goal = planned new) = (Achieved - 1 July) / Goal. */
export function gsAdjust(goal: number, achieved: number, baseline: number | null | undefined, youth?: boolean): [number, number] {
  if (baseline == null) return [goal, achieved];
  return [youth ? goal : goal - baseline, Math.max(0, achieved - baseline)];
}

export function SourceBadge({ source }: { source: string }) {
  // Rotary.org fund figures are part of Auto (user 2026-11-17) - the badge says Auto; the screen adds "Updated from RISAO as on".
  if (source === "rcc") return null;   // a Goal Setting box in Disha - no tag (user 2026-11-18: no "RCC" in Disha)
  return source === "auto" || source === "risao"
    ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200">Auto Fetch</span>
    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">Manual Entry</span>;
}

// Answer box for one question. Choose-one values: District Set Goals stores the option id, Disha the option text.
export function AnswerInput({ type, value, options, disabled, onChange }: {
  type: string; value: string; disabled?: boolean;
  options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  if (type === "yesno")
    return (
      <NativeSelect className="h-9 px-2 py-0" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </NativeSelect>
    );
  if (type === "choose_one")
    return (
      <NativeSelect className="h-9 px-2 py-0" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    );
  if (type === "text")
    return <input className={inputCls} value={value} disabled={disabled} maxLength={2000} onChange={(e) => onChange(e.target.value)} />;
  return (
    <input className={`${inputCls} text-right tabular-nums`} type="number" min={0} step="any" value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/^-/, ""))} />
  );
}

// Points of an answer - EXACTLY the District Awards club form (citation/v2/view.tsx updateManualAnswer),
// user 2026-11-18: Number = value x points (bonus: min/max), Yes/No = points if Yes, Choose one = the option's points.
export interface PointRule {
  answerType: string; points?: number; perUnit?: number; isBonus?: boolean; bonusPoints?: number; minBonus?: number; maxBonus?: number;
  options?: { id: number; optionPoints?: number }[];
}
export function livePoints(q: PointRule, value: string | null | undefined): number {
  const v = value ?? "";
  const pts = Number(q.points || 0);
  if (q.answerType === "number") {
    const n = Number(v) || 0;
    let points = n * pts, bonus = 0;
    if (q.isBonus) {
      const min = Number(q.minBonus || 0), max = Number(q.maxBonus || 0);
      if (min === 0 && max === 0) bonus = Number(q.bonusPoints || 0);
      else {
        if (n >= min && min > 0) bonus = Number(q.bonusPoints || 0);
        if (max > 0 && n > max) points = max * pts;
      }
    }
    if (n === 0) { points = 0; bonus = 0; }
    return points + bonus;
  }
  if (q.answerType === "yesno") return v === "yes" ? pts : 0;
  if (q.answerType === "choose_one") return Number(q.options?.find((o) => String(o.id) === v)?.optionPoints || 0);
  return 0;
}
/** Auto: "50 points for every 5" (user 2026-11-18, option B). */
export function autoPointsHint(q: PointRule): string | null {
  const pts = Number(q.points || 0), every = Number(q.perUnit || 1);
  if (!pts && !q.isBonus) return null;
  let h = every > 1 ? `${pts.toLocaleString("en-IN")} points for every ${every.toLocaleString("en-IN")}` : `${pts.toLocaleString("en-IN")} points each`;
  if (q.isBonus) h += ` · bonus ${Number(q.bonusPoints || 0).toLocaleString("en-IN")}`;
  return h;
}

/** "x 10 · bonus 5 (min 3, max 10)" / "10 if Yes" - the same hint District Awards shows next to the box. */
export function pointsHint(q: PointRule): string | null {
  const pts = Number(q.points || 0);
  if (q.answerType === "number") {
    if (!pts && !q.isBonus) return null;
    let h = `× ${pts.toLocaleString("en-IN")} points`;
    if (q.isBonus) {
      h += ` · bonus ${Number(q.bonusPoints || 0).toLocaleString("en-IN")}`;
      const min = Number(q.minBonus || 0), max = Number(q.maxBonus || 0);
      if (min > 0 || max > 0) h += ` (${[min > 0 ? `from ${min}` : "", max > 0 ? `counted up to ${max}` : ""].filter(Boolean).join(", ")})`;
    }
    return h;
  }
  if (q.answerType === "yesno") return pts ? `${pts.toLocaleString("en-IN")} points if Yes` : null;
  return null;
}
/** "RISAO - Endowment Fund" -> "Endowment Fund" (user 2026-11-18: never show "RISAO" in a name). */
export const plainName = (n: string | null | undefined) => (n ?? "").replace(/^\s*RISAO\s*-\s*/i, "");
export const plainActivities = <T extends { activityName?: string }>(rows: T[]): T[] =>
  (rows ?? []).map((r) => ({ ...r, activityName: plainName(r.activityName) }));

/** Achieved % of a typed answer, worked out as you type (same rule as the API's Pct: Number = answer / goal,
 *  2 decimals; Yes / No = 100 / 0; others none). */
export function livePct(answerType: string, goal: number | null | undefined, value: string | null | undefined): number | null {
  const v = value ?? "";
  if (answerType === "yesno") return v === "" ? null : v === "yes" ? 100 : 0;
  if (answerType !== "number" || !(Number(goal) > 0) || v === "" || Number.isNaN(Number(v))) return null;
  return Math.round((Number(v) / Number(goal)) * 10000) / 100;
}

export const fmtPoints = (n: number) => Math.round(n).toLocaleString("en-IN");
/** Points on the RI Director's Disha screens (user 2026-11-18): hidden for now, NOT removed - set true to show
 *  them again. The DG's own Disha page and District Set Goals always show points. */
export const RID_SHOW_POINTS = false;
/** Disha has NO points system (user 2026-11-20): the DG's Disha page and the DG's Disha report hide points too.
 *  Hidden, not removed - set true to show them again. District Set Goals keeps its points (= District Awards). */
export const DISHA_DG_SHOW_POINTS = false;

/** Goals reached among the questions that have a goal. */
export function goalStats(rows: { answerType: string; goalValue: number | null; achievementPct: number | null }[]) {
  const withGoal = rows.filter((l) => l.answerType === "yesno" || (l.answerType === "number" && (l.goalValue ?? 0) > 0));
  return { goals: withGoal.length, reached: withGoal.filter((l) => (l.achievementPct ?? 0) >= 100).length };
}

/** Auto / Manual question section, opened and closed like an accordion (user 2026-11-18). Blue = Auto, amber = Manual. */
const ACC_TONE = {
  auto: {
    edge: "border-l-blue-600", head: "from-blue-50 via-white to-white", icon: "bg-blue-600 text-white shadow-blue-600/30",
    title: "text-blue-900", chip: "bg-blue-100 text-blue-800", bar: "bg-blue-600", track: "bg-blue-100",
    points: "bg-blue-600 text-white shadow-blue-600/25", chev: "text-blue-700 ring-blue-200", body: "border-t-blue-100",
  },
  manual: {
    edge: "border-l-amber-500", head: "from-amber-50 via-white to-white", icon: "bg-amber-500 text-white shadow-amber-500/30",
    title: "text-amber-900", chip: "bg-amber-100 text-amber-800", bar: "bg-amber-500", track: "bg-amber-100",
    points: "bg-amber-500 text-white shadow-amber-500/25", chev: "text-amber-700 ring-amber-200", body: "border-t-amber-100",
  },
} as const;

export function QuestionAccordion({ kind, open, onToggle, count, points, goals, reached, subtitle, children, hidePoints }: {
  kind: "auto" | "manual"; open: boolean; onToggle: () => void; count: number; points: number; hidePoints?: boolean;
  goals: number; reached: number; subtitle: string; children: React.ReactNode;
}) {
  const t = ACC_TONE[kind];
  const Icon = kind === "auto" ? Zap : Edit3;
  const pctReached = goals > 0 ? Math.round((reached / goals) * 100) : 0;
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 border-l-4 ${t.edge} bg-white shadow-sm transition hover:shadow-md`}>
      <MenuItemButton onClick={onToggle} aria-expanded={open}
        className={`gap-4 rounded-none bg-gradient-to-r ${t.head} px-5 py-4`}>
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-lg ${t.icon}`}>
          <Icon size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-bold ${t.title}`}>{kind === "auto" ? "Auto Fetch" : "Manual Entry"}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${t.chip}`}>{count}</span>
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">{subtitle}</span>
          {goals > 0 && (
            <span className="mt-2.5 flex max-w-md items-center gap-3">
              <span className={`h-2 flex-1 overflow-hidden rounded-full ${t.track}`}>
                <span className={`block h-full rounded-full ${t.bar} transition-all`} style={{ width: `${pctReached}%` }} />
              </span>
              <span className="shrink-0 text-xs font-semibold text-slate-700">{reached} / {goals} goals reached</span>
            </span>
          )}
        </span>
        {!hidePoints && (
          <span className={`flex min-w-24 flex-col items-center rounded-xl px-4 py-2 shadow-lg ${t.points}`}>
            <span className="text-2xl font-extrabold leading-none tabular-nums">{fmtPoints(points)}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-90">points</span>
          </span>
        )}
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white ring-1 transition-transform ${t.chev} ${open ? "rotate-180" : ""}`}>
          <ChevronDown size={18} />
        </span>
      </MenuItemButton>
      {open && <div className={`border-t ${t.body}`}>{children}</div>}
    </section>
  );
}

/** A category heading inside an accordion section. */
export function CategoryStrip({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 border-y border-slate-100 bg-[#EEF3FB] px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#0B2A5E]">
      <span className="h-2 w-2 rounded-full bg-[#F7A81B]" />{name}
    </div>
  );
}

/** Expand all / Collapse all. */
export function ExpandCollapse({ onAll }: { onAll: (open: boolean) => void }) {
  const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B2A5E] shadow-sm hover:bg-[#EEF3FB]";
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" type="button" onClick={() => onAll(true)}>Expand all</Button>
      <Button variant="outline" size="sm" type="button" onClick={() => onAll(false)}>Collapse all</Button>
    </div>
  );
}

export function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r) || "Other"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
  return Array.from(m.entries());
}

/** Plain page header (user 2026-11-20): title + subtitle left, actions right - replaces the navy Banner on the
 *  District Set Goals club pages. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-go-kpi font-bold text-go-navy-900">{title}</h2>
        {subtitle && <div className="text-go-body text-go-text-secondary">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

export function Banner({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-go-lg bg-[#0B2A5E] text-white px-6 py-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-extrabold">{title}</h2>
        <p className="text-sm text-[#C9D6EE] mt-1">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A Rotary.org fund figure (Auto line). No "RISAO" in names any more (user 2026-11-18); old names still match. */
export const isRisaoTitle = (title: string) =>
  /^(RISAO\s*-\s*)?(Annual Fund|PolioPlus Fund|Endowment Fund|Other Funds|Annual Fund per capita|Total Giving|CSR with RFI)\s*$/i.test(title);
/** Auto list items never offered (user 2026-11-18): Annual Fund (16) / PolioPlus (17) are already RCC goals. */
export const IN_RCC_ACTIVITY_IDS = [16, 17];
export function RisaoNote({ asOn }: { asOn: string | null | undefined }) {
  // Same message as Goal Setting (user 2026-11-18) - shown only when the RISAO import has brought figures.
  if (!asOn) return null;
  return <span className="text-[11px] font-medium text-amber-700">Updated from RISAO as on {asOn}</span>;
}

/** "Download report" for the navy banners (user 2026-11-18): real .xlsx, file name with a timestamp. */
/** light: navy button for a plain (non-banner) header (user 2026-11-20). */
export function ReportButton({ load, fileName, label = "Download report", light = false }: { load: () => Promise<Blob>; fileName: string; label?: string; light?: boolean }) {
  // Same progress bar + % inside the button as the other report downloads (lib/downloadProgress).
  const dl = useDownloadProgress();
  const [failed, setFailed] = useState<string | null>(null);
  const run = () => dl.run("report", async () => {
    setFailed(null);
    try {
      const blob = await load();
      saveAs(blob, `${fileName}_${fileTimestamp()}.xlsx`);
    } catch (e: any) {
      let msg = "Could not download the report.";
      try { const t = await (e?.response?.data as Blob)?.text?.(); if (t) msg = JSON.parse(t)?.message || msg; } catch { /* keep */ }
      setFailed(msg);
    }
  });
  return (
    <span className="inline-flex flex-col items-end">
      <Button onClick={run} disabled={dl.busy}
        className={light
          ? "min-w-[170px] disabled:opacity-90"
          : "min-w-[170px] border-transparent bg-[#F7A81B] text-[#0B2A5E] hover:bg-[#F7A81B] hover:brightness-95 disabled:opacity-90"}>
        {dl.is("report") ? dl.bar("report", light ? undefined : "bg-[#0B2A5E]") : <><Download size={15} /> {label}</>}
      </Button>
      {failed && <span className={`mt-1 text-[11px] ${light ? "text-go-danger-600" : "text-amber-200"}`}>{failed}</span>}
    </span>
  );
}

export const primaryBtn = "inline-flex items-center gap-2 text-sm font-bold min-h-10 px-4 rounded-xl bg-[#F7A81B] text-[#0B2A5E] hover:brightness-95 disabled:opacity-60";
