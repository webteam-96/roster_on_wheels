"use client";

// District Set Goals - District Admin view (user 2026-11-17).
//   Clubs     every club ranked by District Awards points (as in District Awards), with goal progress; open a club.
//   Goals     one question for all clubs, a goal per CLUB (user 2026-11-17; blank = no goal for that club).
//   Questions the District Awards questions themselves (same module, same data - no duplicates).

import { Button } from "@/components/ui/button";
import { LinkButton, ToggleButton } from "@/components/ui/text-buttons";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Save, Trophy, Target, ListChecks, Lock, LockOpen, Loader2, LayoutGrid, CalendarDays } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RccPeriodView from "./RccPeriodView";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import DsgOverview from "./DsgOverview";
import dynamic from "next/dynamic";
import { changedDsgGoals } from "@/lib/dsgGoalChanges";
import { getDistrictSetGoals, saveDistrictSetGoals, getDistrictSetGoalClubs, getDsgLocks, setDsgLocks, type GoalFlowLine } from "@/services/goalFlowApi";
import { sectionOfCategory, type DishaSection } from "@/lib/dishaRccGoals";
import { RCC_SECTIONS } from "@/lib/rccGoals";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import type { RankItem } from "./RankingList";
import RankingTable from "./RankingTable";
import ClubSetGoalsPanel from "./ClubSetGoalsPanel";
import { Banner, RisaoNote, isRisaoTitle, ReportButton } from "./common";
import { downloadDistrictSetGoalsAllClubsReport, downloadClubSetGoalsReport, getDistrictSetGoalsMonthly, getClubSetGoalsMonthly } from "@/services/dishaApi";
import GoalGridEditor, { type GridQuestion } from "./GoalGridEditor";

const DistrictAwardsModule = dynamic(() => import("@/components/dashboard/DistrictAwardsModule"), { ssr: false });
const key = (l: GoalFlowLine) => `${l.lineType}:${l.lineId}`;
type Tab = "overview" | "clubs" | "goals" | "questions";

export default function DistrictSetGoalsPanel({ districtId, yearId }: { districtId: number; yearId: number | null }) {
  const [tab, setTab] = useState<Tab>("overview");   // Overview first (user 2026-11-19)
  const [openClub, setOpenClub] = useState<{ id: number; name: string } | null>(null);
  // Month wise (user 2026-11-19, RCC design): the whole district (clubs added up) or one club.
  const [monthOf, setMonthOf] = useState<{ club: { id: number; name: string } | null } | null>(null);
  // The Overview's Club filter: the one Month wise button opens that club, or all clubs (user 2026-11-20).
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [clubs, setClubs] = useState<RankItem[] | null>(null);
  const [goalsData, setGoalsData] = useState<Awaited<ReturnType<typeof getDistrictSetGoals>> | null>(null);
  const [goals, setGoals] = useState<Record<string, Record<number, string>>>({});   // line -> club -> goal
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Lock / Unlock (user 2026-11-19, same as Disha): club -> locked sections; DG / Super Admin only.
  const [locks, setLocks] = useState<{ canLock: boolean; clubs: Record<number, string[]> } | null>(null);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  const loadLocks = useCallback(async () => {
    try { setLocks(await getDsgLocks(districtId, yearId)); } catch { setLocks(null); }
  }, [districtId, yearId]);
  const lockGoals = async (k: string, clubIds: number[] | null, sections: string[] | null, locked: boolean) => {
    if (!goalsData) return;
    setLockBusy(k);
    try { const r = await setDsgLocks(districtId, { yearId: goalsData.yearId, clubIds, sections, locked }); setOk(r.message); await loadLocks(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to update the lock."); }
    finally { setLockBusy(null); }
  };
  const SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };

  const loadClubs = useCallback(async () => {
    try {
      const d = await getDistrictSetGoalClubs(districtId, yearId);
      // Bar = total Achieved / total Goal x 100 (user 2026-11-19, option A).
      const n = (v: number | undefined) => Math.round(Number(v ?? 0)).toLocaleString("en-IN");
      setClubs(d.clubs.map((c) => ({ key: c.clubId, rank: c.rank, name: c.clubName, points: c.points, goals: c.goals, reached: c.reached, score: c.score,
        detail: !c.totalGoal ? "No goals set" : `${n(c.totalAchieved)} of ${n(c.totalGoal)} achieved · ${c.score ?? 0}%` })));
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load clubs."); setClubs([]); }
  }, [districtId, yearId]);
  const loadGoals = useCallback(async () => {
    try {
      const d = await getDistrictSetGoals(districtId, yearId);
      setGoalsData(d);
      setGoals(Object.fromEntries(d.lines.map((l) => [key(l), Object.fromEntries(
        Object.entries(l.clubGoals ?? {}).filter(([, v]) => v != null).map(([c, v]) => [Number(c), String(v)]))])));
      setDirty(false);
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load goals."); }
  }, [districtId, yearId]);
  useEffect(() => { setClubs(null); setGoalsData(null); loadClubs(); loadGoals(); }, [loadClubs, loadGoals]);
  useEffect(() => { if (tab === "goals" || tab === "overview") loadLocks(); }, [tab, loadLocks]);

  const saveGoals = async () => {
    if (!goalsData) return;
    // Only the goals that changed (user 2026-11-23: every club x every line - now with the 26 RCC lines - timed out).
    // Blank = no goal; a cleared goal is sent as null so it is cleared.
    const list = changedDsgGoals(goalsData.lines, goalsData.clubs.map((c) => c.id), goals);
    const links: { lineId: number; risaoKey: string | null }[] = [];   // RISAO = Auto questions now (user 2026-11-17)
    setBusy(true);
    try {
      const r = await saveDistrictSetGoals(districtId, goalsData.yearId, list, links);
      setOk(`${r?.message || "Goals saved."} Every club sees them in District Set Goals.`); loadGoals(); loadClubs();
    }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to save goals."); }
    finally { setBusy(false); }
  };

  if (openClub)
    return (
      <ClubSetGoalsPanel readOnly clubId={openClub.id} yearId={yearId} clubName={openClub.name}
        header={<LinkButton type="button" onClick={() => { setOpenClub(null); loadClubs(); }}><ArrowLeft size={15} /> Back to clubs</LinkButton>} />
    );

  const lines = goalsData?.lines ?? [];
  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "clubs", label: "Club Ranking", icon: Trophy }, { id: "questions", label: "Questions", icon: ListChecks }, { id: "goals", label: "Set Goals", icon: Target },
  ];

  return (
    <div className="space-y-4">
      <SuccessAlert open={!!ok} title="Done" description={ok ?? ""} onOk={() => setOk(null)} />
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />
      <Banner title="District Set Goals" subtitle="Goals you set for your clubs. The questions are your District Awards questions - Auto ones are filled by the system (fund figures come from Rotary.org), clubs type the Manual ones.">
        <Button onClick={() => setMonthOf({ club: tab === "overview" ? picked : null })}
          variant="onDark">
          <CalendarDays size={15} /> Month wise
        </Button>
        <ReportButton load={() => downloadDistrictSetGoalsAllClubsReport(districtId, yearId)} fileName="District_Set_Goals_All_Clubs" label="Download all clubs" />
      </Banner>

      <Dialog open={!!monthOf} onOpenChange={(o) => { if (!o) setMonthOf(null); }}>
        <DialogContent className="max-w-[98vw] sm:max-w-[98vw] w-[98vw] h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-8"><CalendarDays size={18} className="text-go-navy-700" /> Month-wise — {monthOf?.club ? monthOf.club.name : "All clubs"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {monthOf && (monthOf.club
              ? <RccPeriodView dsg reloadKey={`c${monthOf.club.id}-${yearId ?? "cur"}`} load={() => getClubSetGoalsMonthly(monthOf.club!.id, yearId)}
                  onReport={async () => saveAs(await downloadClubSetGoalsReport(monthOf.club!.id, yearId), `District_Set_Goals_${monthOf.club!.name.replace(/\s+/g, "_")}_${fileTimestamp()}.xlsx`)} />
              : <RccPeriodView dsg reloadKey={`d${districtId}-${yearId ?? "cur"}`} load={() => getDistrictSetGoalsMonthly(districtId, yearId)}
                  onReport={async () => saveAs(await downloadDistrictSetGoalsAllClubsReport(districtId, yearId), `District_Set_Goals_All_Clubs_${fileTimestamp()}.xlsx`)} />)}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {tabs.map((t) => (
          <ToggleButton pressed={tab === t.id} key={t.id} type="button" onClick={() => { if (tab === "questions" && t.id !== "questions") { loadGoals(); loadClubs(); } setPicked(null); setTab(t.id); }}>
            <t.icon size={15} /> {t.label}
          </ToggleButton>
        ))}
      </div>
      {/* Lock All / Unlock All on the tabs line (as Disha) - every club, every section; DG / Super Admin. */}
      {tab === "overview" && locks?.canLock && (
        <div className="flex items-center gap-2">
          <Button type="button" disabled={!!lockBusy} onClick={() => lockGoals("all-on", null, null, true)}>
            {lockBusy === "all-on" ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Lock All</Button>
          <Button variant="outline" type="button" disabled={!!lockBusy} onClick={() => lockGoals("all-off", null, null, false)}>
            {lockBusy === "all-off" ? <Loader2 size={15} className="animate-spin" /> : <LockOpen size={15} />} Unlock All</Button>
        </div>
      )}
      </div>

      {tab === "overview" && (goalsData == null ? <div className="py-16 flex flex-col items-center gap-3 text-sm text-slate-500"><RotaryLoader /> Loading…</div> : (
        <DsgOverview data={goalsData} locks={locks?.clubs ?? null} canLock={!!locks?.canLock} lockBusy={lockBusy}
          onLock={(k, clubIds, sections, locked) => lockGoals(k, clubIds, sections, locked)}
          onOpenClub={(c) => setOpenClub(c)} onPick={setPicked} />
      ))}

      {tab === "clubs" && (clubs == null ? <div className="py-16 flex justify-center"><RotaryLoader /></div> : (
        <RankingTable items={clubs} rankBy="points" pointsOnly searchable entityLabel="Club" showZone={false} emptyText="No clubs found in this district."
          onOpen={(id) => setOpenClub({ id, name: clubs.find((c) => c.key === id)?.name ?? "" })} />
      ))}

      {tab === "goals" && (goalsData == null ? <div className="py-16 flex justify-center"><RotaryLoader /></div> : lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No questions yet for this year. Add them in the <LinkButton type="button" onClick={() => setTab("questions")}>Questions</LinkButton> tab.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Lock All / Unlock All - every club, every section (as Disha). */}
          {locks?.canLock && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <span className="inline-flex items-center gap-2 font-semibold text-[#0B2A5E]"><Lock size={15} /> Bulk Lock - all clubs, all sections</span>
              <span className="flex-1" />
              <Button type="button" disabled={!!lockBusy} onClick={() => lockGoals("all-on", null, null, true)}>
                {lockBusy === "all-on" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock All</Button>
              <Button variant="outline" type="button" disabled={!!lockBusy} onClick={() => lockGoals("all-off", null, null, false)}>
                {lockBusy === "all-off" ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock All</Button>
            </div>
          )}
          <GoalGridEditor
            entityLabel="club" canEdit={goalsData.canEdit}
            emptyText="No questions yet for this year."
            entities={goalsData.clubs.map((c) => ({ id: c.id, name: c.name }))}
            goals={goals}
            answers={Object.fromEntries(lines.map((l) => {
              const opt = new Map(l.options.map((o) => [String(o.id), o.optionText]));
              const a = goalsData.clubAnswers[key(l)] ?? {};
              return [key(l), Object.fromEntries(Object.entries(a).map(([c, v]) => [Number(c), v != null && opt.has(v) ? opt.get(v)! : v]))];
            }))}
            onGoal={(k, id, v) => { setGoals((g) => ({ ...g, [k]: { ...(g[k] ?? {}), [id]: v } })); setDirty(true); }}
            // A locked section is read only for everyone until it is unlocked (user 2026-11-19, as Disha).
            isLocked={(k, id) => { const l = lines.find((x) => key(x) === k); return !!l && !!locks?.clubs[id]?.includes(sectionOfCategory(l.categoryName)); }}
            toolbar={(k, ids) => {
              const l = lines.find((x) => key(x) === k);
              if (!l || !locks) return null;
              const sct = sectionOfCategory(l.categoryName);
              const n = ids.filter((id) => locks.clubs[id]?.includes(sct)).length;
              return (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <Lock size={14} className="text-slate-500" />
                  <span className="text-sm text-slate-600">{SHORT[sct]} goals: <b>{n}</b> of {ids.length} clubs locked</span>
                  {locks.canLock && <>
                    <Button size="sm" type="button" disabled={!!lockBusy || n === ids.length} onClick={() => lockGoals(`s-on-${sct}`, ids, [sct], true)}>
                      {lockBusy === `s-on-${sct}` ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock all</Button>
                    <Button variant="outline" size="sm" type="button" disabled={!!lockBusy || n === 0} onClick={() => lockGoals(`s-off-${sct}`, ids, [sct], false)}>
                      {lockBusy === `s-off-${sct}` ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock all</Button>
                  </>}
                </div>
              );
            }}
            rowTag={(k, id) => {
              const l = lines.find((x) => key(x) === k);
              if (!l || !locks) return null;
              const sct = sectionOfCategory(l.categoryName);
              const on = !!locks.clubs[id]?.includes(sct), bk = `${id}-${sct}`;
              return locks.canLock ? (
                <ToggleButton pressed={on} type="button" disabled={!!lockBusy} onClick={() => lockGoals(bk, [id], [sct], !on)} title={on ? "Locked - click to unlock" : "Unlocked - click to lock"}
                  className="ml-auto shrink-0">
                  {lockBusy === bk ? <Loader2 size={11} className="animate-spin" /> : on ? <Lock size={11} /> : <LockOpen size={11} />} {on ? "Locked" : "Unlocked"}
                </ToggleButton>
              ) : on ? <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800"><Lock size={11} /> Locked</span> : null;
            }}
            hidePct
            questions={lines.map((l): GridQuestion => ({
              key: key(l), title: l.title, category: l.categoryName, source: l.isRcc ? "auto" : l.source, answerType: l.answerType,
              rccGoal: l.isRcc ? Object.fromEntries(Object.entries(l.clubRccGoals ?? {}).map(([c, v]) => [Number(c), v])) : undefined,
              extra: l.isRcc ? <span className="text-xs text-slate-500">RCC goal and Achieved from Rotary.org - set the District Set Goal</span>
                : l.source === "auto"
                ? (isRisaoTitle(l.title) ? <RisaoNote asOn={goalsData.risaoAsOn} /> : <span className="text-xs text-slate-500">Answer counted by the system</span>)
                : undefined,
            }))}
          />
          {goalsData.canEdit && (
            <div className="sticky bottom-3 flex items-center justify-end gap-3">
              {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 shadow">Unsaved changes</span>}
              <Button type="button" onClick={saveGoals} disabled={busy}>
                <Save size={15} /> {busy ? "Saving…" : "Save goals"}
              </Button>
            </div>
          )}
        </div>
      ))}

      {tab === "questions" && <DistrictAwardsModule districtId={districtId} rotarySections={RCC_SECTIONS} fetchEntryLabels rccPointsTab />}
    </div>
  );
}
