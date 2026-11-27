"use client";

// District Set Goals - Club Admin (user 2026-11-19): two tabs.
//   Overview (default)            the DG's Overview design for this one club (Goal / Achieved / % / Points per question,
//                                 locks shown read only, Month wise).
//   Add Goals & Manual Entry      the club's page as before (ClubSetGoalsPanel): Year view / Month-wise / Quarterly,
//                                 the club's own goals in unlocked sections + the Manual Entry answers, Save.

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "@/components/icons";
import { saveAs } from "file-saver";
import { getClubSetGoals, type GoalFlowLine } from "@/services/goalFlowApi";
import { downloadClubSetGoalsReport, getClubSetGoalsMonthly } from "@/services/dishaApi";
import { fileTimestamp } from "@/lib/dateUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { PageHeader, ReportButton } from "./common";
import DsgOverview from "./DsgOverview";
import ClubSetGoalsPanel from "./ClubSetGoalsPanel";
import RccPeriodView from "./RccPeriodView";

const key = (l: GoalFlowLine) => `${l.lineType}:${l.lineId}`;
type Tab = "overview" | "entry";

export default function ClubDsgTabs({ clubId, yearId }: { clubId: number; yearId: number | null }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Awaited<ReturnType<typeof getClubSetGoals>> | null>(null);
  const [month, setMonth] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getClubSetGoals(clubId, yearId)); }
    catch (e: any) { setErr(e?.response?.data?.message || "Failed to load District Set Goals."); }
  }, [clubId, yearId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const clubName = data?.clubName ?? "My club";

  // The DG's Overview data shape, for this one club.
  const overview = useMemo(() => !data ? null : ({
    yearId: data.yearId, clubCount: 1, canEdit: false, risaoAsOn: data.risaoAsOn,
    lines: data.lines.map((l) => ({ ...l, clubGoals: { [clubId]: l.goalValue } })),
    clubs: [{ id: clubId, name: clubName }],
    clubAnswers: Object.fromEntries(data.lines.map((l) => [key(l), { [clubId]: l.answerValue }])),
    clubPoints: Object.fromEntries(data.lines.map((l) => [key(l), { [clubId]: Number(l.pointsEarned ?? 0) }])),
  }), [data, clubId, clubName]);

  const tabs = (
    // Underline tabs in the page's navy (user 2026-11-20) - was a grey pill switch.
    <div role="tablist" aria-label="District Set Goals" className="flex gap-6 border-b border-go-border-strong">
      {([["overview", "Overview"], ["entry", "Add Goals & Manual Entry"]] as const).map(([id, label]) => (
        <Button variant="ghost" key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { if (id !== tab) { setTab(id); if (id === "overview") load(); } }}
          className={`-mb-px rounded-none border-b-[3px] px-1 ${tab === id ? "border-go-gold-500 text-go-navy-900" : "border-transparent"}`}>
          {label}
        </Button>
      ))}
    </div>
  );

  if (tab === "entry") return <ClubSetGoalsPanel clubId={clubId} yearId={yearId} tabs={tabs} />;

  if (!data || !overview) return (
    <><div className="py-16 flex justify-center"><RotaryLoader /></div>
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} /></>
  );

  return (
    <div className="space-y-4">
      <ErrorAlert open={!!err} title="Something went wrong" description={err ?? ""} onOk={() => setErr(null)} />
      <PageHeader title="District Set Goals" subtitle={clubName}>
        <Button variant="outline" type="button" onClick={() => setMonth(true)}>
          <CalendarDays size={15} /> Month wise
        </Button>
        <ReportButton light load={() => downloadClubSetGoalsReport(clubId, yearId)} fileName={`District_Set_Goals_${clubName.replace(/\s+/g, "_")}`} />
      </PageHeader>

      {tabs}

      <DsgOverview single data={overview} locks={{ [clubId]: data.locks ?? [] }} canLock={false} lockBusy={null} onLock={() => {}} />

      <Dialog open={month} onOpenChange={setMonth}>
        <DialogContent className="max-w-[98vw] sm:max-w-[98vw] w-[98vw] h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-8"><CalendarDays size={18} className="text-go-navy-700" /> Month-wise — {clubName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {month && <RccPeriodView dsg reloadKey={`c${clubId}-${yearId ?? "cur"}`} load={() => getClubSetGoalsMonthly(clubId, yearId)}
              onReport={async () => saveAs(await downloadClubSetGoalsReport(clubId, yearId), `District_Set_Goals_${clubName.replace(/\s+/g, "_")}_${fileTimestamp()}.xlsx`)} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
