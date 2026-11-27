"use client";

// Disha Goals - RI Director / Super Admin (user 2026-11-17): District Awards moved one level up.
//   Questions          the District Awards screens (copy): 4 RCC default categories + extra, Auto (incl. RISAO) / Manual, points
//   Districts ranking  districts ranked by points (like District Awards' Club Points), with goal progress; open one
//   Set goals          one question for all districts, a goal per district (blank = no goal)
// Only Rotary.org districts (synced clubs), never Zone 0; zone filter. Super Admin only until tested.

import { Button } from "@/components/ui/button";
import { LinkButton, ToggleButton } from "@/components/ui/text-buttons";
import { NativeSelect } from "@/components/ui/native-select";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Save, Trophy, Target, ListChecks, MapPin, RefreshCw, LayoutGrid, Download, Lock, LockOpen, Loader2 } from "@/components/icons";
import { useDownloadProgress } from "@/lib/downloadProgress";
import DishaMessages from "@/components/goal-flow/DishaMessages";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import GoalOversightShell from "@/components/v2/GoalOversightShell";
import { type RankItem } from "@/components/goal-flow/RankingList";
import RankingTable from "@/components/goal-flow/RankingTable";
import DishaGoalsPanel from "@/components/goal-flow/DishaGoalsPanel";
import GoalGridEditor from "@/components/goal-flow/GoalGridEditor";
import DishaOverview from "@/components/goal-flow/DishaOverview";
import { Banner, RisaoNote, RID_SHOW_POINTS } from "@/components/goal-flow/common";
import { RCC_SECTIONS } from "@/lib/rccGoals";
import { getDishaAwardsDistricts, getDishaAwardsGoals, saveDishaAwardsGoals, refreshDishaAwardsAll, type DishaZone,
  getDishaGoalState, saveDishaRccGoals, setDishaLocks } from "@/services/dishaApi";
import { SECTION_TABS } from "@/lib/goalRotaryLayout";
import { SHOW_GOAL_SETTING_FOR_GOAL_ROLES } from "@/lib/goalMenus";
import { goalFieldOf, existingGoalOf, orderSection, sectionOfCategory, SECTION_NAMES, DISHA_GOAL_KEYS, type DishaSection } from "@/lib/dishaRccGoals";
import { useDishaRccCards } from "@/components/goal-flow/useDishaRccCards";
import { downloadDishaReport } from "@/lib/dishaReport";
import type { GridQuestion } from "@/components/goal-flow/GoalGridEditor";

// Goal Overview's select (chevron 12px in from the edge).
const selCls = "h-11 min-w-[13rem] pl-10";
const DishaAwardsModule = dynamic(() => import("@/components/goal-flow/DishaAwardsModule"), { ssr: false });
type Tab = "overview" | "questions" | "ranking" | "goals";

export default function DishaGoalsPage() {
  // Every goal role (user 2026-11-18); the API limits the districts to the member's Goal Setting scope and
  // says whether they may change questions / goals (RI Director, Super Admin) - the others view only.
  const [canManage, setCanManage] = useState(false);
  const searchParams = useSearchParams();
  const asQ = searchParams.get("as") ? `as=${searchParams.get("as")}` : "";   // keep the acting goal role on the links
  // Same as goal-overviews-rotary: ?as= on every Goal Setting call (Messages, the Goal Setting boxes), cleared on leave.
  const { years, currentYearId } = useRotaryYears();
  const [yearId, setYearId] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [zones, setZones] = useState<DishaZone[]>([]);
  // Common filter (user 2026-11-18): one Zone + District for every tab.
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [districtOpts, setDistrictOpts] = useState<{ id: number; number: string }[]>([]);
  const dl = useDownloadProgress();
  const [tab, setTab] = useState<Tab>("overview");   // tab order: Overview (default, user 2026-11-18), District Ranking, Questions, Set Goals
  const [ranking, setRanking] = useState<RankItem[] | null>(null);
  const [goalsData, setGoalsData] = useState<Awaited<ReturnType<typeof getDishaAwardsGoals>> | null>(null);
  // Lock / Unlock in Set Goals too (user 2026-11-18) - the same locks as the Overview: district -> locked sections.
  const [goalLocks, setGoalLocks] = useState<Record<number, string[]>>({});
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  // Locks changed on the Overview show here at once: reload them every time Set Goals is opened (user 2026-11-18).
  useEffect(() => {
    if (tab !== "goals" || !yearId) return;
    let cancelled = false;
    getDishaGoalState(yearId, zoneId)
      .then((st) => { if (!cancelled) setGoalLocks(Object.fromEntries(Object.entries(st.districts).map(([id, ds]) => [Number(id), ds.locks]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, yearId, zoneId]);
  const [goals, setGoals] = useState<Record<string, Record<number, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<{ id: number; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (yearId == null && currentYearId) setYearId(currentYearId); }, [currentYearId, yearId]);
  useEffect(() => { setDistrictId(null); }, [zoneId]);
  useEffect(() => { if (zones.length === 1 && zoneId == null) setZoneId(zones[0].id); }, [zones, zoneId]);

  const loadRanking = useCallback(async () => {
    if (!yearId) return;
    setRanking(null);
    try {
      const d = await getDishaAwardsDistricts(yearId, zoneId);
      setZones(d.zones);
      setCanManage(!!d.canManage);
      setDistrictOpts(d.districts.map((x) => ({ id: x.districtId, number: x.districtNumber }))
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })));
      const items = d.districts.map((x) => ({ key: x.districtId, rank: x.rank, name: `District ${x.districtNumber}`, sub: zoneId ? undefined : x.zoneName,
        points: x.points, goals: x.goals, reached: x.reached, score: x.score }));
      // Points hidden for the RI Director (user 2026-11-18): rank by Achieved instead.
      setRanking(RID_SHOW_POINTS ? items : [...items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((x, i) => ({ ...x, rank: i + 1 })));
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load districts."); setRanking([]); }
  }, [yearId, zoneId]);
  const loadGoals = useCallback(async () => {
    if (!yearId) return;
    try {
      const [d, st] = await Promise.all([getDishaAwardsGoals(yearId, zoneId), getDishaGoalState(yearId, zoneId).catch(() => null)]);
      setGoalsData(d);
      setGoalLocks(Object.fromEntries(Object.entries(st?.districts ?? {}).map(([id, ds]) => [Number(id), ds.locks])));
      const g: Record<string, Record<number, string>> = Object.fromEntries(Object.entries(d.goals).map(([k, m]) => [k, Object.fromEntries(
        Object.entries(m).filter(([, v]) => v != null).map(([id, v]) => [Number(id), String(v)]))]));
      // Disha goals of the Goal Setting / RCC boxes (user 2026-11-18) - set here too, as "rcc:<field key>" rows.
      Object.entries(st?.districts ?? {}).forEach(([id, ds]) => Object.entries(ds.rccGoals).forEach(([k, v]) => {
        if (v != null) (g[`rcc:${k}`] ??= {})[Number(id)] = String(v);
      }));
      setGoals(g);
      setDirty(false);
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to load goals."); }
  }, [yearId, zoneId]);
  useEffect(() => { if (!open) { loadRanking(); loadGoals(); } }, [open, loadRanking, loadGoals]);

  const saveGoals = async () => {
    if (!goalsData) return;
    const list = goalsData.lines.filter((l) => l.answerType === "number").flatMap((l) => goalsData.districts.map((d) => {
      const v = goals[l.key]?.[d.id] ?? "";
      return { lineType: l.lineType, lineId: l.lineId, districtId: d.id, goalValue: v === "" ? null : Number(v) };
    }));
    const rccList = rccQuestions.flatMap((q) => goalsData.districts.map((d) => {
      const v = goals[q.key]?.[d.id] ?? "";
      return { districtId: d.id, fieldKey: q.key.slice(4), goalValue: v === "" ? null : Number(v) };
    }));
    setBusy("g");
    try {
      await saveDishaAwardsGoals(goalsData.yearId, list);
      if (rccList.length > 0) await saveDishaRccGoals(goalsData.yearId, rccList);
      setOk("Goals saved."); loadGoals(); loadRanking();
    }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to save goals."); }
    finally { setBusy(null); }
  };
  // Download for the common filter: one district, the zone, or all (user 2026-11-18).
  // Same report as before + the Goal Setting boxes as extra rows (user 2026-11-19, option A).
  const downloadScope = () => dl.run("scope", async () => {
    if (!yearId) return;
    try {
      await downloadDishaReport({ yearId, yearLabel: years.find((y) => y.id === yearId)?.yearLabel ?? null, zoneId,
        zoneName: zones.find((z) => z.id === zoneId)?.name ?? "", districtId });
    } catch (e: any) {
      let msg = e?.message && !e?.response ? e.message : "Could not download the report.";
      try { const t = await (e?.response?.data as Blob)?.text?.(); if (t) msg = JSON.parse(t)?.message || msg; } catch { /* keep */ }
      setErr(msg);
    }
  });
  const SECTION_SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };
  const lockGoals = async (key: string, districtIds: number[], section: DishaSection, locked: boolean) => {
    if (!yearId || districtIds.length === 0) return;
    setLockBusy(key);
    try {
      const r = await setDishaLocks({ yearId, zoneId, districtIds, sections: [section], locked });
      setOk(r.message);
      const st = await getDishaGoalState(yearId, zoneId);
      setGoalLocks(Object.fromEntries(Object.entries(st.districts).map(([id, ds]) => [Number(id), ds.locks])));
    } catch (e: any) { setErr(e?.response?.data?.message || "Failed to update the lock."); }
    finally { setLockBusy(null); }
  };
  const [lockTick, setLockTick] = useState(0);
  const lockAll = async (locked: boolean) => {
    if (!yearId) return;
    setLockBusy(locked ? "all-on" : "all-off");
    try { const r = await setDishaLocks({ yearId, zoneId, districtIds: districtId ? [districtId] : null, sections: null, locked }); setOk(r.message); setLockTick((n) => n + 1); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to update the lock."); }
    finally { setLockBusy(null); }
  };
  const refreshAll = async () => {
    setBusy("r");
    try { const r = await refreshDishaAwardsAll(yearId, zoneId); setOk(r?.message || "Auto answers refreshed."); loadRanking(); loadGoals(); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to refresh."); }
    finally { setBusy(null); }
  };

  const lines = goalsData?.lines ?? [];
  // Set Goals (user 2026-11-18): the RCC / Goal Setting boxes get their Disha goal here too, in the Goal Setting order.
  const goalDistrictIds = useMemo(() => (tab === "goals" && goalsData ? goalsData.districts.map((d) => d.id) : null), [tab, goalsData]);
  const { byDistrict: rccCards } = useDishaRccCards(goalDistrictIds, yearId, years.find((y) => y.id === yearId)?.yearLabel ?? null);
  const firstRcc = goalDistrictIds?.map((id) => rccCards[id]).find((x) => !!x) ?? null;
  const { gridQuestions, rccQuestions, rccAnswers, rccExisting, qSection } = useMemo(() => {
    const lineQ = (l: (typeof lines)[number]): GridQuestion => ({ key: l.key, title: l.title, category: l.categoryName, source: l.source, answerType: l.answerType,
      extra: l.isRisao ? <RisaoNote asOn={null} /> : undefined,
      baseline: goalsData?.baselines?.[l.key] ? Object.fromEntries(Object.entries(goalsData.baselines[l.key]).map(([id, v]) => [Number(id), v])) : undefined,
      youth: l.youth, pctDp: l.isRisao ? 2 : 0 });
    const out: GridQuestion[] = [], rq: GridQuestion[] = [];
    const ans: Record<string, Record<number, string | null>> = {};
    const existing: Record<string, Record<number, string>> = {};
    const sec: Record<string, DishaSection> = {};
    lines.forEach((l) => { sec[l.key] = sectionOfCategory(l.categoryName); });   // the goal already in Goal Setting (shown until a Disha goal is set)
    const growthBase: Record<string, string> = { new_clubs: "total_clubs", new_members: "total_members", new_women_members: "existing_women_members" };
    for (const s of SECTION_TABS) {
      const secLines = lines.filter((l) => sectionOfCategory(l.categoryName) === s.key);
      const category = secLines[0]?.categoryName ?? SECTION_NAMES[s.key];
      for (const it of orderSection(secLines, firstRcc?.cards[s.key] ?? [])) {
        if (it.kind === "line") { out.push(lineQ(it.line)); continue; }
        const gf = goalFieldOf(it.card);
        if (!gf) continue;
        const key = `rcc:${gf.fieldKey}`;
        const base: Record<number, number | null> = {};
        ans[key] = {};
        goalDistrictIds?.forEach((id) => {
          const c = rccCards[id]?.cards[s.key]?.find((x) => x.name === it.card.name);
          const a = c?.fields.find((f) => /achieved$/.test(f.fieldKey))?.numericValue;
          ans[key][id] = a == null ? null : String(a);
          const ex = existingGoalOf(c);
          if (ex != null) (existing[key] ??= {})[id] = String(ex);
          if (growthBase[gf.fieldKey]) base[id] = c?.fields.find((f) => f.fieldKey === growthBase[gf.fieldKey])?.numericValue ?? null;
        });
        sec[key] = DISHA_GOAL_KEYS[gf.fieldKey] ?? s.key;
        const q: GridQuestion = { key, title: it.card.name, category, source: "rcc", answerType: "number",
          baseline: growthBase[gf.fieldKey] ? base : undefined, pctDp: gf.dataType === "Currency" ? 2 : 0 };
        out.push(q); rq.push(q);
      }
    }
    lines.filter((l) => sectionOfCategory(l.categoryName) === "other").forEach((l) => out.push(lineQ(l)));
    return { gridQuestions: out, rccQuestions: rq, rccAnswers: ans, rccExisting: existing, qSection: sec };
  }, [lines, goalsData, firstRcc, rccCards, goalDistrictIds]);
  // Questions only for those who may change them; everyone in scope sees the ranking and the goals.
  const tabs: { id: Tab; label: string; icon: any }[] = useMemo(() => [
    { id: "overview", label: "Overview", icon: LayoutGrid },   // Goal Setting overview design (user 2026-11-18)
    { id: "ranking", label: "District Ranking", icon: Trophy },
    ...(canManage ? [{ id: "questions" as Tab, label: "Questions", icon: ListChecks }] : []),
    { id: "goals", label: canManage ? "Set Goals" : "Goals", icon: Target },
  ], [canManage]);

  return (
    <ProtectedRoute>
      <GoalOversightShell
        pageTitle="Disha Goals"
        nav={[...(!SHOW_GOAL_SETTING_FOR_GOAL_ROLES ? [] : [{ label: "Goal Setting", href: `/goal-overviews-rotary${asQ ? `?${asQ}` : ""}` }]),
          { label: "RCC Goals", href: `/goal-overviews-rotary?view=rcc${asQ ? `&${asQ}` : ""}` },
          { label: "Disha Goals", href: `/disha-goals${asQ ? `?${asQ}` : ""}`, active: true }]}
        headerRight={years.length > 0 ? (
          <NativeSelect value={yearId ?? ""} onChange={(e) => { setOpen(null); setYearId(Number(e.target.value)); }} className="h-9 w-auto py-0">
            {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</option>)}
          </NativeSelect>
        ) : undefined}
      >
        <SuccessAlert open={!!ok} title="Done" description={ok ?? ""} onOk={() => setOk(null)} />
        <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />
        {open ? (
            <DishaGoalsPanel readOnly hideRefresh={!canManage} hidePoints={!RID_SHOW_POINTS} districtId={open.id} yearId={yearId} districtLabel={open.label}
              header={<LinkButton type="button" onClick={() => setOpen(null)}><ArrowLeft size={15} /> Back to districts</LinkButton>} />
          ) : (
            <div className="space-y-4">
              <Banner title="Disha Goals" subtitle="Same as District Awards, for your districts: categories, Auto Fetch and Manual Entry questions with points, and a goal for each district.">
              </Banner>

              {/* Common filter (user 2026-11-18): Zone + District once for every tab, Goal Overview design; the tab's
                  buttons after it (District Ranking: Refresh + Download; Overview: Download + Messages). */}
              <div className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card px-6 py-5 flex flex-wrap items-end gap-4">
                {zones.length > 1 && (
                  <label className="relative w-full sm:w-auto flex flex-col gap-1.5 text-go-label font-semibold text-go-text-secondary">
                    Zone
                    <MapPin size={16} aria-hidden className="pointer-events-none absolute left-3.5 bottom-3.5 text-go-navy-700" />
                    <NativeSelect className={selCls} value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">All zones</option>
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </NativeSelect>
                  </label>
                )}
                <label className="relative w-full sm:w-auto flex flex-col gap-1.5 text-go-label font-semibold text-go-text-secondary">
                  District
                  <MapPin size={16} aria-hidden className="pointer-events-none absolute left-3.5 bottom-3.5 text-go-navy-700" />
                  <NativeSelect className={selCls} value={districtId ?? ""} disabled={districtOpts.length === 0}
                    onChange={(e) => setDistrictId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">All districts</option>
                    {districtOpts.map((d) => <option key={d.id} value={d.id}>{d.number}</option>)}
                  </NativeSelect>
                </label>
                <span className="hidden sm:block flex-1" />
                {tab === "ranking" && canManage && (
                  <Button variant="outline" type="button" onClick={refreshAll} disabled={!!busy}
                    className="w-full sm:w-auto">
                    <RefreshCw size={15} className={busy === "r" ? "animate-spin" : ""} /> Refresh auto answers
                  </Button>
                )}
                {(tab === "ranking" || tab === "overview") && districtOpts.length > 0 && (
                  <Button type="button" disabled={dl.busy} onClick={downloadScope}
                    className="w-full sm:w-auto min-w-[200px]">
                    {dl.is("scope") ? dl.bar("scope") : <><Download size={15} />
                      {districtId ? "Download this district" : zoneId ? "Download report (zone)" : "Download report (all)"}</>}
                  </Button>
                )}
                {(
                  <DishaMessages zoneId={zoneId} zoneName={zones.find((z) => z.id === zoneId)?.name ?? ""} yearId={yearId} actingAs={searchParams.get("as")} onError={setErr} />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  {tabs.map((t) => (
                    <ToggleButton pressed={tab === t.id} key={t.id} type="button" onClick={() => { if (tab === "questions" && t.id !== "questions") { loadGoals(); loadRanking(); } setTab(t.id); }}>
                      <t.icon size={15} /> {t.label}
                    </ToggleButton>
                  ))}
                </div>
                {/* Lock All / Unlock All (user 2026-11-19): on the tabs line, right; follows the filter - one district,
                    the zone, or all your districts. */}
                {tab === "overview" && canManage && (
                  <div className="flex items-center gap-2">
                    <Button type="button" disabled={!!lockBusy} onClick={() => lockAll(true)}>
                      {lockBusy === "all-on" ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Lock All</Button>
                    <Button variant="outline" type="button" disabled={!!lockBusy} onClick={() => lockAll(false)}>
                      {lockBusy === "all-off" ? <Loader2 size={15} className="animate-spin" /> : <LockOpen size={15} />} Unlock All</Button>
                  </div>
                )}
              </div>

              {tab === "overview" && <DishaOverview lockTick={lockTick} zoneId={zoneId} districtFilter={districtId} yearId={yearId} yearLabel={years.find((y) => y.id === yearId)?.yearLabel ?? null} zones={zones} />}   {/* no View details on the district cards (user 2026-11-19) */}

              {tab === "questions" && <DishaAwardsModule rotarySections={RCC_SECTIONS} />}

              {tab === "ranking" && (ranking == null ? <div className="py-16 flex justify-center"><RotaryLoader /></div>
                : <RankingTable showZone={!zoneId} items={districtId ? ranking.filter((i) => i.key === districtId) : ranking} rankBy={RID_SHOW_POINTS ? "points" : "score"} emptyText="No districts in your scope."
                    onOpen={(id) => setOpen({ id, label: ranking.find((i) => i.key === id)?.name ?? "" })} />)}

              {tab === "goals" && (goalsData == null ? <div className="py-16 flex justify-center"><RotaryLoader /></div> : (
                <>
                  <GoalGridEditor
                    entityLabel="district" canEdit={canManage}
                    emptyText="No questions yet - add them in the Questions tab."
                    entities={goalsData.districts.filter((d) => !districtId || d.id === districtId).map((d) => ({ id: d.id, name: `District ${d.districtNumber}`, sub: zoneId ? undefined : d.zoneName }))}
                    goals={Object.keys(rccExisting).length === 0 ? goals : { ...goals, ...Object.fromEntries(Object.entries(rccExisting).map(([k, m]) =>
                      [k, { ...m, ...(goals[k] ?? {}) }])) }}
                    answers={{ ...Object.fromEntries(Object.entries(goalsData.answers).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([id, v]) => [Number(id), v]))])), ...rccAnswers }}
                    onGoal={(k, id, v) => { setGoals((g) => ({ ...g, [k]: { ...(g[k] ?? {}), [id]: v } })); setDirty(true); }}
                    questions={gridQuestions}
                    showBaseline
                    isLocked={(k, id) => !!qSection[k] && !!goalLocks[id]?.includes(qSection[k])}
                    // Lock / Unlock per section (same locks as the Overview): RI Director / SA; a locked section stops only the DG.
                    toolbar={(k, ids) => {
                      const sct = qSection[k];
                      if (!sct) return null;
                      const n = ids.filter((id) => goalLocks[id]?.includes(sct)).length;
                      return (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                          <Lock size={14} className="text-slate-500" />
                          <span className="text-sm text-slate-600">{SECTION_SHORT[sct]} goals: <b>{n}</b> of {ids.length} districts locked</span>
                          {canManage && <>
                            <Button size="sm" type="button" disabled={!!lockBusy || n === ids.length} onClick={() => lockGoals(`all-on-${sct}`, ids, sct, true)}>
                              {lockBusy === `all-on-${sct}` ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock all</Button>
                            <Button variant="outline" size="sm" type="button" disabled={!!lockBusy || n === 0} onClick={() => lockGoals(`all-off-${sct}`, ids, sct, false)}>
                              {lockBusy === `all-off-${sct}` ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock all</Button>
                          </>}
                        </div>
                      );
                    }}
                    rowTag={(k, id) => {
                      const sct = qSection[k];
                      if (!sct) return null;
                      const on = !!goalLocks[id]?.includes(sct), bk = `${id}-${sct}`;
                      return canManage ? (
                        <ToggleButton pressed={on} type="button" disabled={!!lockBusy} onClick={() => lockGoals(bk, [id], sct, !on)} title={on ? "Locked - click to unlock" : "Unlocked - click to lock"}
                          className="ml-auto shrink-0">
                          {lockBusy === bk ? <Loader2 size={11} className="animate-spin" /> : on ? <Lock size={11} /> : <LockOpen size={11} />} {on ? "Locked" : "Unlocked"}
                        </ToggleButton>
                      ) : on ? <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800"><Lock size={11} /> Locked</span> : null;
                    }}
                  />
                  {canManage && lines.length > 0 && (
                    <div className="sticky bottom-3 flex items-center justify-end gap-3">
                      {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 shadow">Unsaved changes</span>}
                      <Button type="button" onClick={saveGoals} disabled={!!busy || !dirty}>
                        <Save size={15} /> {busy === "g" ? "Saving…" : "Save goals"}
                      </Button>
                    </div>
                  )}
                </>
              ))}
            </div>
          )}
      </GoalOversightShell>
    </ProtectedRoute>
  );
}
