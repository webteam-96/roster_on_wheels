"use client";

// One question for everyone, a different goal for each club / district (user 2026-11-17).
// Left: the questions (with how many have a goal). Right: the picked question - every club / district with its own
// Goal box (blank = no goal), its answer and %. "Same goal for all" fills the shown rows; search + "No goal yet" filter.

import { Button } from "@/components/ui/button";
import { MenuItemButton } from "@/components/ui/text-buttons";
import { useEffect, useMemo, useState } from "react";
import { Search, Check, X, CheckCircle2, Circle } from "@/components/icons";
import { PctBadge, SourceBadge, TYPE_LABEL, inputCls, groupBy, gsAdjust } from "./common";

export interface GridQuestion {
  key: string; title: string; category: string; source: string; answerType: string;
  extra?: React.ReactNode;           // e.g. RISAO picker, Edit / Delete
  baseline?: Record<number, number | null>;  // Goal Setting box: "as on 1 July" per entity -> Goal Setting's % (Disha)
  youth?: boolean;
  pctDp?: number;
  // District Set Goals RCC line (user 2026-11-23): each club's Rotary.org RCC goal shown next to its District Set
  // Goal; no % for these lines. Other screens pass nothing and are unchanged.
  rccGoal?: Record<number, number | null>;
}
export interface GridEntity { id: number; name: string; sub?: string }

const pctOf = (type: string, goal: string, answer: string | null, baseline?: number | null, youth?: boolean): number | null => {
  if (type === "yesno") return answer ? (answer === "yes" ? 100 : 0) : null;
  if (type === "number" && goal && answer != null && answer !== "" && baseline != null) {
    const [g2, a2] = gsAdjust(Number(goal), Number(answer), baseline, youth);
    return g2 > 0 ? Math.round((a2 / g2) * 100) : null;
  }
  const g = Number(goal), a = Number(answer);
  if (type !== "number" || !goal || !(g > 0) || answer == null || answer === "" || Number.isNaN(a)) return null;
  return Math.round((a / g) * 10000) / 100;
};

export default function GoalGridEditor({ questions, entities, entityLabel, goals, answers, canEdit, onGoal, emptyText, toolbar, rowTag, showBaseline, isLocked, hidePct }: {
  questions: GridQuestion[]; entities: GridEntity[]; entityLabel: string;     // "club" / "district"
  goals: Record<string, Record<number, string>>;                                // question -> entity -> goal ("" = none)
  answers: Record<string, Record<number, string | null>>;                       // question -> entity -> answer
  canEdit: boolean; onGoal: (qKey: string, entityId: number, value: string) => void; emptyText: string;
  // Optional (Disha Set Goals - Lock / Unlock, user 2026-11-18); other screens pass nothing and are unchanged.
  toolbar?: (qKey: string, shownIds: number[]) => React.ReactNode;
  rowTag?: (qKey: string, entityId: number) => React.ReactNode;
  // Disha (user 2026-11-18): an "As on July 1st" column for questions with a baseline - the goal is a total.
  showBaseline?: boolean;
  // Disha (user 2026-11-18): a locked district section is read only for everyone until it is unlocked.
  isLocked?: (qKey: string, entityId: number) => boolean;
  // District Set Goals (user 2026-11-23): no % column at all. Other screens pass nothing and are unchanged.
  hidePct?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(questions[0]?.key ?? null);
  const [q, setQ] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [bulk, setBulk] = useState("");
  useEffect(() => { if (!questions.some((x) => x.key === sel)) setSel(questions[0]?.key ?? null); }, [questions, sel]);

  const cur = questions.find((x) => x.key === sel) ?? null;
  const hasGoalBox = cur?.answerType === "number";
  const baseCol = !!showBaseline && !!cur?.baseline;
  const rccCol = !!cur?.rccGoal;
  const noPct = rccCol || !!hidePct;
  const cols = rccCol ? "sm:grid-cols-[1fr_7rem_8rem_8rem]" : noPct ? "sm:grid-cols-[1fr_8rem_8rem]" : baseCol ? "sm:grid-cols-[1fr_7rem_8rem_8rem_5.5rem]" : "sm:grid-cols-[1fr_8rem_8rem_5.5rem]";
  const g = (sel && goals[sel]) || {};
  const shown = useMemo(() => entities.filter((e) =>
    `${e.name} ${e.sub ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()) && (!onlyEmpty || !g[e.id])), [entities, q, onlyEmpty, g]);
  const setCount = (key: string) => entities.filter((e) => !!goals[key]?.[e.id]).length;

  if (questions.length === 0)
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{emptyText}</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
      {/* Questions */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden self-start lg:sticky lg:top-3">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-500">Questions</div>
        <div className="max-h-[70vh] overflow-y-auto">
          {groupBy(questions, (x) => x.category).map(([cat, rows]) => (
            <div key={cat}>
              <div className="bg-[#EEF3FB] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#0B2A5E]">{cat}</div>
              {rows.map((x) => {
                const n = setCount(x.key);
                return (
                  <MenuItemButton selected={sel === x.key} key={x.key} type="button" onClick={() => setSel(x.key)}
                    className="block rounded-none px-4 py-2.5">
                    <div className="text-sm font-semibold text-slate-800 leading-snug">{x.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <SourceBadge source={x.source} />
                      {x.answerType === "number"
                        ? <span className={n === entities.length ? "text-emerald-700" : n === 0 ? "text-red-600" : ""}>{n}/{entities.length} goals</span>
                        : <span>{TYPE_LABEL[x.answerType]}</span>}
                    </div>
                  </MenuItemButton>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* The picked question */}
      {cur && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase text-slate-500">{cur.category}</div>
                <h3 className="text-lg font-bold text-slate-900">{cur.title}</h3>
                <div className="mt-1 flex items-center gap-2"><SourceBadge source={cur.source} /><span className="text-xs text-slate-500">{TYPE_LABEL[cur.answerType]}</span></div>
              </div>
              {cur.extra && <div className="flex flex-wrap items-center gap-2">{cur.extra}</div>}
            </div>
            {hasGoalBox ? (
              canEdit && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-600">Same goal for {shown.length === entities.length ? `all ${entities.length}` : `the ${shown.length} shown`} {entityLabel}s:</span>
                  <input className={`${inputCls} w-28 text-right`} type="number" min={0} step="any" value={bulk} onChange={(e) => setBulk(e.target.value.replace(/^-/, ""))} />
                  <Button size="sm" type="button" disabled={bulk === ""} onClick={() => shown.filter((e) => !isLocked?.(cur.key, e.id)).forEach((e) => onGoal(cur.key, e.id, bulk))}><Check size={14} /> Apply</Button>
                  <Button variant="outline" size="sm" type="button" onClick={() => shown.filter((e) => !isLocked?.(cur.key, e.id)).forEach((e) => onGoal(cur.key, e.id, ""))}><X size={14} /> Clear</Button>
                </div>
              )
            ) : (
              <p className="text-xs text-slate-500">{cur.answerType === "yesno" ? "Yes / No question - the goal is “Yes” for everyone." : "No goal number for this type - only the answer is shown."}</p>
            )}
            {toolbar && toolbar(cur.key, shown.map((e) => e.id))}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 min-w-48 items-center gap-2 rounded-lg border border-slate-200 px-3">
                <Search size={14} className="text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${entityLabel}…`} className="h-9 flex-1 bg-transparent text-sm outline-none" />
              </div>
              {hasGoalBox && (
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> No goal yet
                </label>
              )}
            </div>
          </div>

          <div className={`hidden sm:grid ${cols} gap-3 px-5 py-1.5 text-[11px] font-semibold uppercase text-slate-500 border-b border-slate-100`}>
            <span className="capitalize">{entityLabel}</span>{baseCol && <span className="text-right">As on July 1st</span>}{rccCol && <span className="text-right">RCC Goal</span>}<span className="text-right">{rccCol ? "District Set Goal" : "Goal"}</span><span className="text-right">Achieved</span>{!noPct && <span className="text-center">Achieved %</span>}
          </div>
          <ul className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
            {shown.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">Nothing to show.</li>}
            {shown.map((e) => {
              const goal = g[e.id] ?? "";
              const ans = answers[cur.key]?.[e.id] ?? null;
              return (
                <li key={e.id} className={`grid gap-2 px-5 py-2 ${cols} sm:gap-3 sm:items-center`}>
                  <div className="min-w-0 flex items-center gap-2">
                    {hasGoalBox && (goal ? <CheckCircle2 size={14} className="shrink-0 text-emerald-600" /> : <Circle size={14} className="shrink-0 text-slate-300" />)}
                    <span className="truncate font-medium text-slate-800">{e.name}</span>
                    {e.sub && <span className="shrink-0 text-xs text-slate-500">{e.sub}</span>}
                    {rowTag && rowTag(cur.key, e.id)}
                  </div>
                  {baseCol && <span className="text-sm sm:text-right tabular-nums text-slate-600">{cur.baseline?.[e.id] != null ? Number(cur.baseline[e.id]).toLocaleString("en-IN") : "—"}</span>}
                  {rccCol && <span className="text-sm sm:text-right tabular-nums text-slate-600" title="RCC goal from Rotary.org">{cur.rccGoal?.[e.id] != null ? Number(cur.rccGoal[e.id]).toLocaleString("en-IN") : "—"}</span>}
                  <div>
                    {hasGoalBox
                      ? <input className={`${inputCls} text-right tabular-nums`} type="number" min={0} step="any" placeholder="No goal"
                          value={goal} disabled={!canEdit || !!isLocked?.(cur.key, e.id)} onChange={(ev) => onGoal(cur.key, e.id, ev.target.value.replace(/^-/, ""))} />
                      : <span className="block text-right text-sm text-slate-500">{cur.answerType === "yesno" ? "Yes" : "—"}</span>}
                  </div>
                  <span className="text-sm sm:text-right tabular-nums font-semibold text-slate-800">{ans ?? "—"}</span>
                  {!noPct && <span className="sm:text-center"><PctBadge dp={cur.pctDp ?? 0} pct={pctOf(cur.answerType, hasGoalBox ? goal : "1", ans, cur.baseline?.[e.id], cur.youth)} /></span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
