"use client";

// Disha Goals - the DG's "Goal Setting" tab (user 2026-11-18). One list per section (Membership, Foundation,
// Public Image, Youth Service) in the Goal Setting order: every Disha question and Goal Setting box of the district,
//   Question | As on July 1st | Goal (DG types; read only when the RI Director / SA locked the section) |
//   Achieved (Manual Entry: DG types - never locked; Auto Fetch / Goal Setting boxes: read only) | Achieved % | Points.
// Goals are the DISTRICT's (Disha) - never set on clubs. One Save: goals + Manual Entry answers.

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, LockOpen, Save, Loader2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { AnswerInput, PctBadge, livePct, livePoints, fmtPoints, RisaoNote, inputCls, DISHA_DG_SHOW_POINTS } from "@/components/goal-flow/common";
import { SECTION_TABS, overviewLabel, type SectionCard } from "@/lib/goalRotaryLayout";
import { goalFieldOf, existingGoalOf, withDishaGoal, orderSection, sectionOfCategory, SECTION_NAMES, type DishaSection } from "@/lib/dishaRccGoals";
import { useDishaRccCards } from "@/components/goal-flow/useDishaRccCards";
import {
  getDishaAwardsDistrict, getDishaDistrictGoalState, saveDishaDistrictGoals, saveDishaAwardsAnswers, type DishaDistrictLine,
} from "@/services/dishaApi";

const SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };
const GROWTH_BASE: Record<string, string> = { new_clubs: "total_clubs", new_members: "total_members", new_women_members: "existing_women_members" };
const SHOW_PTS = DISHA_DG_SHOW_POINTS;   // Disha: no points (user 2026-11-20)
const COLS = SHOW_PTS ? "sm:grid-cols-[1fr_7rem_8rem_10rem_6rem_5rem]" : "sm:grid-cols-[1fr_7rem_8rem_10rem_6rem]";
const fmt = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

export default function DishaDgGoalSetting({ districtId, yearId, yearLabel, onSaved }: {
  districtId: number; yearId: number | null; yearLabel?: string | null; onSaved?: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getDishaAwardsDistrict>> | null>(null);
  const [st, setSt] = useState<Awaited<ReturnType<typeof getDishaDistrictGoalState>> | null>(null);
  const [goals, setGoals] = useState<Record<string, string>>({});      // "<lineType>:<lineId>" or "rcc:<field key>"
  const [answers, setAnswers] = useState<Record<number, string>>({});  // Manual Entry: lineId -> answer
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([getDishaAwardsDistrict(districtId, yearId), getDishaDistrictGoalState(districtId, yearId)]);
      setData(d); setSt(s);
      const g: Record<string, string> = {};
      d.lines.forEach((l) => { if (l.goalValue != null) g[`${l.lineType}:${l.lineId}`] = String(l.goalValue); });
      Object.entries(s.rccGoals).forEach(([k, v]) => { if (v != null) g[`rcc:${k}`] = String(v); });
      setGoals(g);
      setAnswers(Object.fromEntries(d.lines.filter((l) => l.source === "manual").map((l) => [l.lineId, l.answerValue ?? ""])));
      setDirty(false);
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load Disha Goals."); }
  }, [districtId, yearId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const ids = useMemo(() => [districtId], [districtId]);
  const { byDistrict, ready } = useDishaRccCards(data ? ids : null, data?.yearId ?? yearId, yearLabel);
  const cards = byDistrict[districtId]?.cards;

  if (!data || !st || !ready || !cards)
    return <><div className="py-20 flex flex-col items-center gap-3 text-sm text-slate-500"><RotaryLoader /> Loading…</div>
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} /></>;

  const locked = (s: DishaSection) => st.locks.includes(s);
  const canGoal = (s: DishaSection) => st.canSetGoals && !locked(s);
  const canAnswer = data.canAnswer;
  const sections: { key: DishaSection; title: string }[] = [
    ...SECTION_TABS.map((s) => ({ key: s.key as DishaSection, title: SECTION_NAMES[s.key] })),
    ...(data.lines.some((l) => sectionOfCategory(l.categoryName) === "other") ? [{ key: "other" as DishaSection, title: "Other" }] : []),
  ];
  // The figure "as on July 1st" of a box (Goal Setting's), when it has one.
  const baseOf = (c: SectionCard | undefined) => {
    if (!c) return null;
    const gf = goalFieldOf(c);
    const k = gf ? GROWTH_BASE[gf.fieldKey] : undefined;
    const f = c.fields.find((x) => (k ? x.fieldKey === k : /as on july/i.test(x.fieldLabel)));
    return f ? { label: overviewLabel(f.fieldLabel), value: f.numericValue } : null;
  };
  const setGoal = (k: string, v: string) => { setGoals((g) => ({ ...g, [k]: v.replace(/^-/, "") })); setDirty(true); };

  // % of a question: typed answers as you type; Auto Fetch from the API, again on a changed goal (Goal Setting's rule).
  const pctOfLine = (l: DishaDistrictLine, card?: SectionCard) => {
    const g = goals[`${l.lineType}:${l.lineId}`];
    const goal = g == null || g === "" ? null : Number(g);
    if (l.source === "manual") return livePct(l.answerType, goal, answers[l.lineId]);
    if (l.answerType !== "number") return l.achievementPct;
    if (goal == null || l.answerValue == null || l.answerValue === "") return null;
    const base = baseOf(card)?.value;
    const a = Number(l.answerValue);
    if (base != null) { const den = goal - Number(base); return den > 0 ? Math.round(((a - Number(base)) / den) * 100) : null; }
    return goal > 0 ? Math.round((a / goal) * (l.isRisao ? 10000 : 100)) / (l.isRisao ? 100 : 1) : null;
  };
  const pointsOfLine = (l: DishaDistrictLine) => (l.source === "manual" ? livePoints(l, answers[l.lineId]) : Number(l.pointsEarned || 0));
  const totalPoints = data.lines.reduce((s, l) => s + pointsOfLine(l), 0);

  async function save() {
    if (!data || !cards) return;
    const num = (v: string | undefined) => (v == null || v.trim() === "" ? null : Number(v));
    setBusy(true);
    try {
      const msgs: string[] = [];
      if (st!.canSetGoals) {
        const r = await saveDishaDistrictGoals(districtId, {
          yearId: data.yearId,
          questionGoals: data.lines.filter((l) => l.answerType === "number" && canGoal(sectionOfCategory(l.categoryName)))
            .map((l) => ({ lineType: l.lineType, lineId: l.lineId, districtId, goalValue: num(goals[`${l.lineType}:${l.lineId}`]) })),
          rccGoals: SECTION_TABS.filter((s) => canGoal(s.key)).flatMap((s) => (cards[s.key] ?? []).map(goalFieldOf).filter((f) => !!f)
            .filter((f) => goals[`rcc:${f!.fieldKey}`] !== undefined)
            .map((f) => ({ fieldKey: f!.fieldKey, goalValue: num(goals[`rcc:${f!.fieldKey}`]) }))),
        });
        msgs.push(r.message);
      }
      if (canAnswer) {
        await saveDishaAwardsAnswers(districtId, data.lines.filter((l) => l.source === "manual")
          .map((l) => ({ subCriteriaId: l.lineId, answerValue: answers[l.lineId] === "" ? null : answers[l.lineId] })));
        msgs.push("Achieved saved.");
      }
      setOk(msgs.join(" ")); await load(); onSaved?.();
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <SuccessAlert open={!!ok} title="Saved" description={ok ?? ""} onOk={() => setOk(null)} />
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <span className="text-sm text-slate-600">Set your district&apos;s goals and type the Achieved of the Manual Entry questions, then Save.</span>
        <span className="flex-1" />
        {SHOW_PTS && <span className="rounded-xl bg-[#0B2A5E] px-4 py-2 text-sm font-bold text-white">Total points: {fmtPoints(totalPoints)}</span>}
      </div>

      {sections.map((s) => {
        const lines = data.lines.filter((l) => sectionOfCategory(l.categoryName) === s.key);
        const items = orderSection(lines, s.key === "other" ? [] : cards[s.key as keyof typeof cards] ?? [])
          .filter((it) => it.kind === "line" || !!goalFieldOf(it.card));
        if (items.length === 0) return null;
        return (
          <section key={s.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-[#EEF3FB] px-5 py-3">
              <h3 className="text-base font-bold text-[#0B2A5E]">{s.title} ({SHORT[s.key]})</h3>
              {locked(s.key)
                ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800"><Lock size={12} /> Goals locked by the RI Director</span>
                : <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"><LockOpen size={12} /> Unlocked</span>}
            </div>
            <div className={`hidden sm:grid ${COLS} gap-3 border-b border-slate-100 px-5 py-2 text-[11px] font-semibold uppercase text-slate-500`}>
              <span>Question</span><span className="text-right">As on July 1st</span><span className="text-right">Goal</span>
              <span className="text-right">Achieved</span><span className="text-center">Achieved %</span>{SHOW_PTS && <span className="text-right">Points</span>}
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((it) => {
                if (it.kind === "line") {
                  const l = it.line, k = `${l.lineType}:${l.lineId}`;
                  const base = baseOf(it.card);
                  const pts = pointsOfLine(l);
                  return (
                    <li key={k} className={`grid gap-2 px-5 py-3 ${COLS} sm:items-center sm:gap-3`}>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">{l.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.source === "manual" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{l.source === "manual" ? "Manual Entry" : "Auto Fetch"}</span>
                          {l.isRisao && <RisaoNote asOn={data.risaoAsOn} />}
                        </div>
                      </div>
                      <span className="text-sm sm:text-right tabular-nums text-slate-600" title={base?.label}>{base ? fmt(base.value) : "—"}</span>
                      <div>{l.answerType === "number"
                        ? <input className={`${inputCls} text-right tabular-nums`} type="number" min={0} step="any" placeholder="No goal"
                            disabled={!canGoal(s.key)} value={goals[k] ?? ""} onChange={(e) => setGoal(k, e.target.value)} />
                        : <span className="block text-right text-sm text-slate-500">{l.answerType === "yesno" ? "Yes" : "—"}</span>}</div>
                      <div>{l.source === "manual"
                        ? <AnswerInput type={l.answerType} value={answers[l.lineId] ?? ""} disabled={!canAnswer}
                            options={l.options.map((o) => ({ value: String(o.id), label: SHOW_PTS ? `${o.optionText} (${fmtPoints(Number(o.optionPoints || 0))} points)` : o.optionText }))}
                            onChange={(v) => { setAnswers((a) => ({ ...a, [l.lineId]: v })); setDirty(true); }} />
                        : <span className="block text-right text-base font-bold tabular-nums text-slate-900">{fmt(l.answerValue)}</span>}</div>
                      <span className="sm:text-center"><PctBadge dp={l.isRisao ? 2 : 0} pct={pctOfLine(l, it.card)} /></span>
                      {SHOW_PTS && <span className={`text-sm sm:text-right tabular-nums ${pts > 0 ? "font-bold text-emerald-700" : "text-slate-400"}`}>{fmtPoints(pts)}</span>}
                    </li>
                  );
                }
                const gf = goalFieldOf(it.card)!;
                const k = `rcc:${gf.fieldKey}`;
                const typed = goals[k];
                const shown = typed ?? (existingGoalOf(it.card) != null ? String(existingGoalOf(it.card)) : "");
                const card = withDishaGoal(it.card, shown === "" ? null : Number(shown));
                const pct = card.fields.find((f) => f.dataType === "Percentage")?.numericValue ?? null;
                const ach = it.card.fields.find((f) => /achieved$/.test(f.fieldKey));
                const base = baseOf(it.card);
                return (
                  <li key={k} className={`grid gap-2 px-5 py-3 ${COLS} sm:items-center sm:gap-3`}>
                    <div className="min-w-0 font-semibold text-slate-800">{it.card.name}</div>
                    <span className="text-sm sm:text-right tabular-nums text-slate-600" title={base?.label}>{base ? fmt(base.value) : "—"}</span>
                    <input className={`${inputCls} text-right tabular-nums`} type="number" min={0} step="any" placeholder="No goal"
                      disabled={!canGoal(s.key)} value={shown} onChange={(e) => setGoal(k, e.target.value)} />
                    <span className="block text-right text-base font-bold tabular-nums text-slate-900">{fmt(ach?.numericValue)}</span>
                    <span className="sm:text-center"><PctBadge dp={gf.dataType === "Currency" ? 2 : 0} pct={pct == null ? null : Number(pct)} /></span>
                    {SHOW_PTS && <span className="text-sm sm:text-right text-slate-400">—</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {(st.canSetGoals || canAnswer) && (
        <div className="sticky bottom-3 flex items-center justify-end gap-3">
          {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 shadow">Unsaved changes</span>}
          <Button type="button" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
