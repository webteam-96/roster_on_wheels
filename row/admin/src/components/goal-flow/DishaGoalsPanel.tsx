"use client";

// Disha Goals - one district (user 2026-11-17). Like a club in District Awards, one level up: the questions the
// RI Director set (with points) and THIS district's goal; the District Admin types the Manual answers, Auto answers
// are counted over the district's clubs (RISAO figures from the monthly import) - Refresh, and every night.

import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/text-buttons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Target, Trophy, Zap, Edit3 } from "@/components/icons";
import { getDishaAwardsDistrict, saveDishaAwardsAnswers, refreshDishaAwardsDistrict, downloadDishaDistrictReport } from "@/services/dishaApi";
import { ReportButton } from "./common";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { livePct } from "./common";
import { Banner, PctBadge, SourceBadge, AnswerInput, groupBy, TYPE_LABEL, RisaoNote, livePoints, pointsHint, autoPointsHint, fmtPoints, QuestionAccordion, CategoryStrip, ExpandCollapse, goalStats } from "./common";
import { Kpi } from "./ClubSetGoalsPanel";
import { loadDishaPeriod, dishaPeriodGroup } from "@/lib/dishaReport";
import RccPeriodView from "./RccPeriodView";

// readOnly: the RI Director's view of a district (user 2026-11-18) - only the DG types the Achieved.
export default function DishaGoalsPanel({ districtId, yearId, districtLabel, header, readOnly, hideRefresh, hidePoints }: {
  districtId: number; yearId: number | null; districtLabel?: string; header?: React.ReactNode; readOnly?: boolean;
  hideRefresh?: boolean;
  hidePoints?: boolean;    // RI Director's view (user 2026-11-18): points hidden for now (RID_SHOW_POINTS)   // view-only goal roles (user 2026-11-18): only the RI Director / DG refresh
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getDishaAwardsDistrict>> | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"year" | "month" | "quarter">("year");
  const [openAuto, setOpenAuto] = useState(false);   // closed on load (user 2026-11-18)
  const [openManual, setOpenManual] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getDishaAwardsDistrict(districtId, yearId);
      setData(d);
      setAnswers(Object.fromEntries(d.lines.filter((l) => l.source === "manual").map((l) => [l.lineId, l.answerValue ?? ""])));
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load Disha Goals."); }
  }, [districtId, yearId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const lines = data?.lines ?? [];
  // Achieved % - typed answers are worked out as you type (user 2026-11-18); Auto ones come from the API.
  const pctOf = (l: (typeof lines)[number]) => l.source === "manual" ? livePct(l.answerType, l.goalValue, answers[l.lineId]) : l.achievementPct;
  const stats = useMemo(() => {
    const withGoal = lines.filter((l) => l.answerType === "yesno" || (l.answerType === "number" && (l.goalValue ?? 0) > 0));
    return { total: lines.length, goals: withGoal.length, reached: withGoal.filter((l) => (pctOf(l) ?? 0) >= 100).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, answers]);

  // Points: Manual = District Awards (counted as you type); Auto = from the API (Achieved % when it has a goal).
  const pointsOf = (l: (typeof lines)[number]) => l.source === "manual" ? livePoints(l, answers[l.lineId]) : Number(l.pointsEarned || 0);
  const autoLines = lines.filter((l) => l.source !== "manual");
  const manualLines = lines.filter((l) => l.source === "manual");
  const autoPoints = autoLines.reduce((s, l) => s + pointsOf(l), 0);
  const manualPoints = manualLines.reduce((s, l) => s + pointsOf(l), 0);

  const save = async () => {
    const list = lines.filter((l) => l.source === "manual").map((l) => ({ subCriteriaId: l.lineId, answerValue: answers[l.lineId] === "" ? null : answers[l.lineId] }));
    setBusy("a");
    try { await saveDishaAwardsAnswers(districtId, list); setOk("Answers saved."); load(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to save answers."); }
    finally { setBusy(null); }
  };
  const refresh = async () => {
    setBusy("r");
    try { const r = await refreshDishaAwardsDistrict(districtId, data?.yearId); setOk(r?.message || "Auto answers refreshed."); load(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to refresh."); }
    finally { setBusy(null); }
  };

  if (!data) return (
    <>{header}<div className="py-16 flex justify-center"><RotaryLoader /></div>
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} /></>
  );

  const canAnswer = data.canAnswer && !readOnly;

  return (
    <div className="space-y-4">
      <SuccessAlert open={!!ok} title="Done" description={ok ?? ""} onOk={() => setOk(null)} />
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />
      {header}
      <Banner title="Disha Goals" subtitle={`${districtLabel ? `${districtLabel} · ` : ""}Goals your RI Director set for the district. Auto answers fill themselves; type the Manual ones.`}>
        <ReportButton load={() => downloadDishaDistrictReport(districtId, yearId)} fileName={`Disha_Goals${districtLabel ? `_${districtLabel.replace(/\s+/g, "_")}` : ""}`} />
        {autoLines.length > 0 && !hideRefresh && (
          <Button variant="onDark" onClick={refresh} disabled={!!busy}>
            <RefreshCw size={15} className={busy === "r" ? "animate-spin" : ""} /> Refresh auto
          </Button>
        )}
      </Banner>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {hidePoints ? <>
          <Kpi tone="blue" icon={Zap} label="Auto Fetch" value={String(autoLines.length)} />
          <Kpi tone="amber" icon={Edit3} label="Manual Entry" value={String(manualLines.length)} />
          <Kpi tone="navy" icon={Trophy} label="Goals set" value={String(stats.goals)} />
        </> : <>
          <Kpi tone="blue" icon={Zap} label="Auto points" value={fmtPoints(autoPoints)} />
          <Kpi tone="amber" icon={Edit3} label="Manual points" value={fmtPoints(manualPoints)} />
          <Kpi tone="navy" icon={Trophy} label="Total points" value={fmtPoints(autoPoints + manualPoints)} />
        </>}
        <Kpi tone="green" icon={Target} label="Goals reached" value={`${stats.reached} / ${stats.goals}`} />
      </div>

      {/* Year view / Month-wise (user 2026-11-18) + Expand / Collapse all */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {(["year", "month", "quarter"] as const).map((v) => (
            <ToggleButton pressed={view === v} key={v} type="button" onClick={() => setView(v)}>
              {v === "year" ? "Year view" : v === "month" ? "Month-wise" : "Quarterly"}
            </ToggleButton>
          ))}
        </div>
        <ExpandCollapse onAll={(o) => { setOpenAuto(o); setOpenManual(o); }} />
      </div>

      {lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">The RI Director has not set Disha goals for this year yet.</div>
      ) : view !== "year" ? (
        // Month-wise / Quarterly in the RCC Goals design (user 2026-11-19).
        <RccPeriodView key={view} initial={view === "quarter" ? "quarter" : "month"} reloadKey={`${districtId}-${yearId ?? "cur"}`}
          groupOf={dishaPeriodGroup} load={() => loadDishaPeriod(districtId, yearId, null)} />
      ) : (["auto", "manual"] as const).map((k) => {
        const list = k === "auto" ? autoLines : manualLines;
        const gst = goalStats(list.map((l) => ({ ...l, achievementPct: pctOf(l) })));
        return (
          <QuestionAccordion key={k} kind={k} open={k === "auto" ? openAuto : openManual}
            onToggle={() => (k === "auto" ? setOpenAuto((o) => !o) : setOpenManual((o) => !o))}
            count={list.length} points={k === "auto" ? autoPoints : manualPoints} goals={gst.goals} reached={gst.reached} hidePoints={hidePoints}
            subtitle={k === "auto" ? "Filled by the system from Goal Setting, Rotary.org and the RISAO import" : (canAnswer ? "Type the Achieved - points count as you type, then Save" : "Typed by the District Governor")}>
            {list.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No {k === "auto" ? "Auto Fetch" : "Manual Entry"} questions.</p>
              : groupBy(list, (l) => l.categoryName).map(([cat, rows]) => (
                <div key={cat}>
                  <CategoryStrip name={cat} />
                  <div className={`hidden sm:grid ${hidePoints ? "grid-cols-[1fr_7rem_12rem_6rem]" : "grid-cols-[1fr_7rem_12rem_5rem_6rem]"} gap-3 border-b border-slate-100 px-5 py-2 text-[11px] font-semibold uppercase text-slate-400`}>
                    <span>Question</span><span className="text-right">Goal</span><span className="text-right">Achieved</span>{!hidePoints && <span className="text-right">Points</span>}<span className="text-center">Achieved %</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {rows.map((l) => (
                      <li key={`${l.lineType}:${l.lineId}`} className={`grid gap-2 px-5 py-3.5 transition hover:bg-slate-50/50 ${hidePoints ? "sm:grid-cols-[1fr_7rem_12rem_6rem]" : "sm:grid-cols-[1fr_7rem_12rem_5rem_6rem]"} sm:items-center sm:gap-3`}>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">{l.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2"><SourceBadge source={l.source} /><span className="text-[11px] text-slate-500">{TYPE_LABEL[l.answerType]}</span>
                            {l.isRisao && <RisaoNote asOn={data.risaoAsOn} />}</div>
                        </div>
                        <div className="text-sm sm:text-right"><span className="sm:hidden text-xs text-slate-500">Goal: </span>
                          <span className="font-semibold tabular-nums text-slate-700">{l.answerType === "number" ? (l.goalValue != null ? Number(l.goalValue).toLocaleString("en-IN") : <span className="text-xs font-normal text-slate-400">No goal</span>) : l.answerType === "yesno" ? "Yes" : "—"}</span></div>
                        <div>
                          {l.source !== "manual"
                            ? <>
                                <div className="text-right text-base font-bold tabular-nums text-slate-900">{l.answerValue != null && l.answerValue !== "" && !Number.isNaN(Number(l.answerValue)) ? Number(l.answerValue).toLocaleString("en-IN") : (l.answerValue ?? "—")}</div>
                                {!hidePoints && autoPointsHint(l) && <div className="mt-0.5 text-right text-[11px] text-slate-500">{autoPointsHint(l)}</div>}
                              </>
                            : <>
                                <AnswerInput type={l.answerType} value={answers[l.lineId] ?? ""} disabled={!canAnswer}
                                  options={l.options.map((o) => ({ value: String(o.id), label: hidePoints ? o.optionText : `${o.optionText} (${fmtPoints(Number(o.optionPoints || 0))} points)` }))}
                                  onChange={(v) => setAnswers((a) => ({ ...a, [l.lineId]: v }))} />
                                {!hidePoints && pointsHint(l) && <div className="mt-1 text-right text-[11px] text-slate-500">{pointsHint(l)}</div>}
                              </>}
                        </div>
                        {!hidePoints && <div className="text-sm sm:text-right tabular-nums"><span className="sm:hidden text-xs text-slate-500">Points: </span>
                          <span className={pointsOf(l) > 0 ? "font-bold text-emerald-700" : "text-slate-400"}>{fmtPoints(pointsOf(l))}</span></div>}
                        <div className="sm:text-center"><PctBadge dp={l.isRisao ? 2 : 0} pct={pctOf(l)} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </QuestionAccordion>
        );
      })}
      {view === "year" && openManual && canAnswer && manualLines.length > 0 && (
        <div className="sticky bottom-3 flex justify-end">
          <Button type="button" onClick={save} disabled={!!busy}>
            <Save size={15} /> {busy === "a" ? "Saving…" : "Save answers"}
          </Button>
        </div>
      )}
    </div>
  );
}
