"use client";

// District Set Goals for one club (user 2026-11-17): the District Awards questions of the club's district with
// the Goal the DG set. Auto answers are counted by the system (Refresh); manual answers are typed here and
// saved into District Awards with the same points, so both screens show the same answer.

import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Lock } from "@/components/icons";
import { refreshClubAutoPoints } from "@/services/api";
import { getClubSetGoals, saveClubSetGoalAnswers, saveClubSetGoalsGoals, type GoalFlowLine } from "@/services/goalFlowApi";
import { sectionOfCategory, type DishaSection } from "@/lib/dishaRccGoals";
import { SECTION_TABS, sectionHeading, type SectionKey } from "@/lib/goalRotaryLayout";
import RccPeriodView from "./RccPeriodView";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import { getClubSetGoalsMonthly, downloadClubSetGoalsReport } from "@/services/dishaApi";
import { ReportButton } from "./common";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { livePct } from "./common";
import { PageHeader, AnswerInput, TYPE_LABEL, RisaoNote, isRisaoTitle, livePoints, pointsHint, autoPointsHint, fmtPoints } from "./common";

const key = (l: GoalFlowLine) => `${l.lineType}:${l.lineId}`;
const SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };

// readOnly: the DG's view of a club (user 2026-11-18) - only the Club Admin types the Achieved.
export default function ClubSetGoalsPanel({ clubId, yearId, clubName, header, readOnly, tabs }: {
  clubId: number; yearId: number | null; clubName?: string; header?: React.ReactNode; readOnly?: boolean;
  tabs?: React.ReactNode;   // Club Admin: Overview / Add Goals & Manual Entry tabs under the banner (user 2026-11-19)
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getClubSetGoals>> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The club's own goals (user 2026-11-19, District Set Goals only): typed here while the District has not locked the section.
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [goalsDirty, setGoalsDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"year" | "month" | "quarter">("year");
  const [answersDirty, setAnswersDirty] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getClubSetGoals(clubId, yearId);
      setData(d);
      setAnswers(Object.fromEntries(d.lines.map((l) => [key(l), l.answerValue ?? ""])));
      setGoals(Object.fromEntries(d.lines.map((l) => [key(l), l.goalValue != null ? String(l.goalValue) : ""])));
      setGoalsDirty(false); setAnswersDirty(false);
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load District Set Goals."); }
  }, [clubId, yearId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const lines = data?.lines ?? [];
  // Achieved % - typed answers are worked out as you type (user 2026-11-18); Auto ones come from the API.
  const goalOf = (l: (typeof lines)[number]) => { const g = goals[key(l)]; return g == null || g === "" ? null : Number(g); };
  const pctOf = (l: (typeof lines)[number]) => l.isRcc ? null : l.source === "manual" ? livePct(l.answerType, goalOf(l), answers[key(l)])
    : goalsDirty ? livePct(l.answerType, goalOf(l), l.answerValue) : l.achievementPct;
  const stats = useMemo(() => {
    const withGoal = lines.filter((l) => l.answerType === "yesno" || (l.answerType === "number" && (l.goalValue ?? 0) > 0));
    return { total: lines.length, goals: withGoal.length, reached: withGoal.filter((l) => (pctOf(l) ?? 0) >= 100).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, answers]);

  // Points as District Awards: typed answers are counted as you type; Auto answers use the saved points.
  const pointsOf = (l: GoalFlowLine) => l.source === "manual" ? livePoints(l, answers[key(l)]) : Number(l.pointsEarned || 0);   // RCC: its own points (user 2026-11-23)
  const autoLines = lines.filter((l) => l.source !== "manual");
  const manualLines = lines.filter((l) => l.source === "manual");
  const autoPoints = autoLines.reduce((s, l) => s + pointsOf(l), 0);
  const manualPoints = manualLines.reduce((s, l) => s + pointsOf(l), 0);

  const save = async () => {
    const list = lines.filter((l) => l.source === "manual").map((l) => ({ lineId: l.lineId, answerValue: answers[key(l)] === "" ? null : answers[key(l)] }));
    setBusy("s");
    try { await saveClubSetGoalAnswers(clubId, list); setOk("Answers saved."); load(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to save."); }
    finally { setBusy(null); }
  };
  const lockedOf = (l: GoalFlowLine) => !!data?.locks?.includes(sectionOfCategory(l.categoryName));
  const canGoal = (l: GoalFlowLine) => !readOnly && !!data?.canSetGoals && l.answerType === "number" && !lockedOf(l);
  const saveGoals = async () => {
    if (!data) return;
    const list = lines.filter(canGoal).map((l) => ({ lineType: l.lineType, lineId: l.lineId, clubId, goalValue: goalOf(l) }));
    setBusy("g");
    try { const r = await saveClubSetGoalsGoals(clubId, data.yearId, list); setOk(r.message); load(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to save the goals."); }
    finally { setBusy(null); }
  };
  const refresh = async () => {
    if (!data) return;
    setBusy("r");
    try { await refreshClubAutoPoints(clubId, data.districtId); setOk("Auto answers refreshed."); load(); }
    catch { setErr("Failed to refresh."); }
    finally { setBusy(null); }
  };

  if (!data) return (
    <>{header}<div className="py-16 flex justify-center"><RotaryLoader /></div>
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} /></>
  );
  const canAnswer = data.canAnswer && !readOnly;

  // Sections in the Overview order (4 Rotary.org sections, then any extra category) - same grouping as DsgOverview.
  const groups = (() => {
    const out = SECTION_TABS.map((s, i) => ({
      key: s.key as string, heading: sectionHeading({ key: s.key as SectionKey, no: i + 1, title: s.title, labels: [], owners: [], cards: [] }),
      lines: lines.filter((l) => sectionOfCategory(l.categoryName) === s.key),
    }));
    const extra = Array.from(new Set(lines.filter((l) => sectionOfCategory(l.categoryName) === "other").map((l) => l.categoryName)));
    extra.forEach((c, i) => out.push({ key: `x:${c}`, heading: `${SECTION_TABS.length + i + 1}. ${c}`, lines: lines.filter((l) => l.categoryName === c) }));
    return out.filter((g) => g.lines.length > 0);
  })();
  const saveAll = async () => {
    if (goalsDirty) await saveGoals();
    if (answersDirty) { await save(); setAnswersDirty(false); }
  };

  const th = "border-b border-r border-go-border-strong last:border-r-0 bg-go-sunken px-3 py-3 text-go-label font-bold uppercase tracking-wide text-go-text-secondary";
  const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5 align-top";
  const numTd = `${td} text-right tabular-nums whitespace-nowrap font-semibold text-go-navy-900`;
  const field = "h-9 w-full rounded-go-sm border border-go-border-strong bg-go-surface px-2 text-right text-go-body tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 disabled:bg-go-sunken disabled:text-go-text-muted";
  const btn = "inline-flex items-center gap-2 h-10 px-4 rounded-go-md border border-go-border-strong bg-go-surface text-go-body font-semibold text-go-navy-700 hover:bg-go-navy-50 disabled:opacity-50";
  const dirty = goalsDirty || answersDirty;

  return (
    <div className="space-y-4">
      <SuccessAlert open={!!ok} title="Done" description={ok ?? ""} onOk={() => setOk(null)} />
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />
      {header}
      {/* Plain header (user 2026-11-20): title + club left, actions right - no navy banner. */}
      <PageHeader title="District Set Goals" subtitle={clubName ?? data.clubName ?? undefined}>
        {lines.some((l) => l.source === "auto") && canAnswer && (
          <Button variant="outline" type="button" onClick={refresh} disabled={!!busy}>
            <RefreshCw size={15} className={busy === "r" ? "animate-spin" : ""} /> Refresh auto
          </Button>
        )}
        <ReportButton light load={() => downloadClubSetGoalsReport(clubId, yearId)} fileName={`District_Set_Goals${clubName ? `_${clubName.replace(/\s+/g, "_")}` : ""}`} />
      </PageHeader>
      {tabs}

      {/* One plain summary strip instead of four gradient cards. */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 rounded-go-lg border border-go-border bg-go-surface divide-x divide-go-border">
        {[["Auto points", fmtPoints(autoPoints)], ["Manual points", fmtPoints(manualPoints)], ["Total points", fmtPoints(autoPoints + manualPoints)], ["Goals reached", `${stats.reached} of ${stats.goals}`]].map(([k, v]) => (
          <div key={k} className="px-4 py-3">
            <dt className="text-go-label font-semibold text-go-text-secondary">{k}</dt>
            <dd className="text-go-heading font-bold tabular-nums text-go-navy-900">{v}</dd>
          </div>
        ))}
      </dl>

      {!data.awardsEnabled && (
        <p className="rounded-go-md border border-amber-300 bg-amber-50 px-4 py-3 text-go-body text-amber-900">
          District Awards is switched off for this year, so answers are read-only.
        </p>
      )}

      {/* Year view / Month-wise / Quarterly */}
      <div role="tablist" aria-label="View" className="flex gap-6 border-b border-go-border">
        {(["year", "month", "quarter"] as const).map((v) => (
          <Button variant="ghost" key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`-mb-px rounded-none border-b-2 px-1 ${view === v ? "border-go-navy-900 text-go-navy-900" : "border-transparent"}`}>
            {v === "year" ? "Year view" : v === "month" ? "Month-wise" : "Quarterly"}
          </Button>
        ))}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-go-lg border border-dashed border-go-border-strong bg-go-surface p-10 text-center text-go-body text-go-text-muted">Your District has not set goals for this year yet.</p>
      ) : view !== "year" ? (
        <RccPeriodView dsg key={view} initial={view === "quarter" ? "quarter" : "month"} reloadKey={`${clubId}-${yearId ?? "cur"}`}
          load={() => getClubSetGoalsMonthly(clubId, yearId)}
          onReport={async () => saveAs(await downloadClubSetGoalsReport(clubId, yearId), `District_Set_Goals${clubName ? `_${clubName.replace(/\s+/g, "_")}` : ""}_${fileTimestamp()}.xlsx`)} />
      ) : (
        // One table, same design as the Overview: goals and Manual Entry answers are typed in the cells.
        <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-x-auto">
          <Table bare className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-go-body">
            <colgroup><col className="w-[13%]" /><col /><col className="w-[11%]" /><col className="w-[14%]" /><col className="w-[16%]" /><col className="w-[9%]" /></colgroup>
            <thead>
              <tr>
                <th className={`${th} text-left`}>Category</th>
                <th className={`${th} text-left`}>Question</th>
                <th className={`${th} text-right`}>RCC Goal</th>
                <th className={`${th} text-right`}>District Set Goal</th>
                <th className={`${th} text-right`}>Achieved</th>
                <th className={`${th} text-right`}>Points</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr><td colSpan={6} className="border-b border-go-border-strong bg-go-navy-900 px-3 py-2.5 text-go-title font-bold text-white">{g.heading}</td></tr>
                  {g.lines.map((l) => {
                    const sct = sectionOfCategory(l.categoryName);
                    const pts = pointsOf(l), auto = l.source !== "manual";
                    const hint = auto ? autoPointsHint(l) : pointsHint(l);
                    return (
                      <tr key={key(l)}>
                        <td className={`${td} font-semibold text-go-navy-700`}>{sct === "other" ? l.categoryName : SHORT[sct]}</td>
                        <td className={`${td} text-go-text-primary`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold leading-snug">{l.title}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-go-meta font-bold ${auto ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{l.isRcc ? "Auto Fetch · Rotary.org" : auto ? "Auto Fetch" : "Manual Entry"}</span>
                          </div>
                          <div className="mt-0.5 text-go-meta text-go-text-secondary">
                            {l.isRcc ? <>RCC goal - from Rotary.org{hint ? ` · ${hint}` : ""}</> : <>{TYPE_LABEL[l.answerType]}{hint ? ` · ${hint}` : ""}</>}
                            {auto && isRisaoTitle(l.title) && <> · <RisaoNote asOn={data.risaoAsOn} /></>}
                          </div>
                        </td>
                        <td className={`${numTd} bg-go-sunken`}>{l.isRcc ? (l.rccGoal != null ? Number(l.rccGoal).toLocaleString("en-IN") : "—") : "—"}</td>
                        <td className={`${numTd} bg-go-navy-50`}>
                          {canGoal(l)
                            ? <input className={field} type="number" min={0} step="any" placeholder="No goal" aria-label={`Goal for ${l.title}`} value={goals[key(l)] ?? ""}
                                onChange={(e) => { setGoals((x) => ({ ...x, [key(l)]: e.target.value.replace(/^-/, "") })); setGoalsDirty(true); }} />
                            : <span className="inline-flex items-center gap-1">
                                {l.answerType === "number" && lockedOf(l) && <Lock size={11} className="text-go-text-secondary" aria-label="Locked by the District" />}
                                {l.answerType === "number" ? (l.goalValue != null ? Number(l.goalValue).toLocaleString("en-IN") : "—") : l.answerType === "yesno" ? "Yes" : "—"}
                              </span>}
                        </td>
                        <td className={`${numTd} bg-go-sunken`}>
                          {auto ? (l.answerValue ?? "—") : (
                            <AnswerInput type={l.answerType} value={answers[key(l)] ?? ""} disabled={!canAnswer}
                              options={l.options.map((o) => ({ value: String(o.id), label: `${o.optionText} (${fmtPoints(Number(o.optionPoints || 0))} points)` }))}
                              onChange={(v) => { setAnswers((a) => ({ ...a, [key(l)]: v })); setAnswersDirty(true); }} />
                          )}
                        </td>
                        <td className={`${numTd} bg-go-navy-50 ${pts > 0 ? "" : "text-go-text-muted"}`}>{fmtPoints(pts)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {/* One save bar for goals and answers. */}
      {view === "year" && dirty && (
        <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded-go-md border border-go-border bg-go-surface px-4 py-2.5 shadow-go-card">
          <span className="text-go-body font-semibold text-amber-800">Unsaved {goalsDirty && answersDirty ? "goals and answers" : goalsDirty ? "goals" : "answers"}</span>
          <Button type="button" onClick={saveAll} disabled={!!busy}>
            <Save size={15} /> {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

const KPI_TONE = {
  default: { box: "border-slate-200 bg-white", icon: "bg-[#EEF3FB] text-[#0B2A5E]", label: "text-slate-500", value: "text-slate-900" },
  blue: { box: "border-blue-200 bg-gradient-to-br from-blue-50 to-white", icon: "bg-blue-600 text-white", label: "text-blue-800", value: "text-blue-900" },
  amber: { box: "border-amber-200 bg-gradient-to-br from-amber-50 to-white", icon: "bg-amber-500 text-white", label: "text-amber-800", value: "text-amber-900" },
  navy: { box: "border-[#0B2A5E] bg-gradient-to-br from-[#0B2A5E] to-[#17458F]", icon: "bg-[#F7A81B] text-[#0B2A5E]", label: "text-[#C9D6EE]", value: "text-white" },
  green: { box: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white", icon: "bg-emerald-600 text-white", label: "text-emerald-800", value: "text-emerald-900" },
} as const;

export function Kpi({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: React.ReactNode; tone?: keyof typeof KPI_TONE }) {
  const t = KPI_TONE[tone];
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm ${t.box}`}>
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ${t.icon}`}><Icon size={20} /></span>
      <div><div className={`text-xs font-medium ${t.label}`}>{label}</div><div className={`text-2xl font-extrabold tabular-nums ${t.value}`}>{value}</div></div>
    </div>
  );
}
