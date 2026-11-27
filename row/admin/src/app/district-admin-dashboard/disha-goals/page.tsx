"use client";

// Disha Goals - District Admin / DG (user 2026-11-17, redesigned 2026-11-18). Super Admin only until tested.
//   Overview      the RI Director's Overview, for this district only - read only (lock state shown, no Lock buttons)
//   Goal Setting  the DG sets the DISTRICT's goals (never the clubs') except in sections the RI Director / SA locked,
//                 and types the Achieved of the Manual Entry questions; points shown here.
// Messages = the District Goals page's Messages (the same chat, unchanged).

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, MessagesSquare } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { getGoalDirectHasUnread } from "@/services/api";
import { downloadDishaReport } from "@/lib/dishaReport";
import DishaOverview from "@/components/goal-flow/DishaOverview";
import DishaDgGoalSetting from "@/components/goal-flow/DishaDgGoalSetting";
import GroupMessages from "@/components/goal-messages/GroupMessages";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/goal-flow/common";

type Tab = "overview" | "goals";

export default function DistrictDishaGoalsPage() {
  const { selectedDistrictId } = useAuth();
  const sp = useSearchParams();
  const { years, currentYearId } = useRotaryYears();
  const yearId = sp.get("yearId") ? Number(sp.get("yearId")) : currentYearId ?? null;
  const yearLabel = years.find((y) => y.id === yearId)?.yearLabel ?? null;
  const districtId = selectedDistrictId ?? null;
  const [tab, setTab] = useState<Tab>("overview");
  const [reload, setReload] = useState(0);
  const dl = useDownloadProgress();

  // Messages - same as the District Goals page (red dot: a chat sent to this DG not opened; every minute, on focus, after closing).
  const [msgOpen, setMsgOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const formYearId = yearId;
  useEffect(() => {
    if (!districtId || !formYearId) { setHasUnread(false); return; }
    let cancelled = false;
    const check = () => getGoalDirectHasUnread(formYearId, { districtId })
      .then((u) => { if (!cancelled) setHasUnread(u); }).catch(() => {});
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [districtId, formYearId, msgOpen]);

  const downloadReport = () => dl.run("report", async () => {
    if (!districtId) return;
    if (!yearId) return;
    // Same report as before + the Goal Setting boxes as extra rows (user 2026-11-19, option A).
    try { await downloadDishaReport({ yearId, yearLabel, districtId, dg: true }); }
    catch { /* the button comes back so it can be tried again */ }
  });

  if (!districtId) return <p className="p-6 text-sm text-slate-500">Select a district.</p>;

  const headBtn = "relative inline-flex items-center gap-2 h-10 px-4 rounded-go-md border border-go-border-strong bg-go-surface text-go-body font-semibold text-go-navy-700 hover:bg-go-navy-50 disabled:opacity-40";
  return (
    <div className="space-y-4">
      <PageHeader title="Disha Goals" subtitle="Your district's goals set by the RI Director: Overview, and Goal Setting for your district.">
        <Button variant="outline" type="button" onClick={downloadReport} disabled={dl.busy} title="Disha Goals report of your district">
          {dl.is("report") ? dl.bar("report") : <><Download size={15} /> Report</>}
        </Button>
        <Button variant="outline" type="button" onClick={() => setMsgOpen(true)} disabled={!districtId || !formYearId} className="relative">
          <MessagesSquare size={15} /> Messages
          {hasUnread && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 ring-2 ring-go-surface" title="New message" />}
        </Button>
      </PageHeader>

      {/* Underline tabs, as ClubDsgTabs (user 2026-11-20) - was a grey pill switch. */}
      <div role="tablist" aria-label="Disha Goals" className="flex gap-6 border-b border-go-border-strong">
        {([["overview", "Overview"], ["goals", "Goal Setting"]] as const).map(([id, label]) => (
          <Button variant="ghost" key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setReload((n) => n + 1); }}
            className={`-mb-px rounded-none border-b-[3px] px-1 ${tab === id ? "border-go-gold-500 text-go-navy-900" : "border-transparent"}`}>
            {label}
          </Button>
        ))}
      </div>

      {tab === "overview" && yearId && (
        <DishaOverview key={`o-${reload}`} dgDistrictId={districtId} districtFilter={districtId} zoneId={null} zones={[]} yearId={yearId} yearLabel={yearLabel} />
      )}
      {tab === "goals" && <DishaDgGoalSetting key={`g-${reload}`} districtId={districtId} yearId={yearId} yearLabel={yearLabel} />}

      {/* Messages - the District Goals page's, unchanged. */}
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-6xl w-[96vw] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><MessagesSquare size={18} className="text-blue-600" /> Messages</DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex-1 min-h-0 flex flex-col">
            {districtId && formYearId ? (
              <GroupMessages mode="district" districtId={districtId} yearId={formYearId} initialCategoryId={null} />
            ) : (
              <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
