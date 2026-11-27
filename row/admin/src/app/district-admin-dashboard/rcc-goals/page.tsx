"use client";

// "RCC & District Goals" (user 2026-11-16) - Super Admin only until go-live (menu item superAdminOnly).
// Tab RCC = the New Goal Setting (District Goals page) with the RCC changes of lib/rccGoals.ts, same design.
// Tab District Goals = District Awards as it is, plus the 4 Rotary.org sections in its Category dropdown.
// The existing District Goals / District Awards screens are not changed.

import { Button } from "@/components/ui/button";
import PillTabs from "@/components/row/PillTabs";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, Download, MessagesSquare } from "@/components/icons";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import { districtYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import RotaryOrgSync from "@/components/goal-rotary/RotaryOrgSync";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanelRotary";
import GoalTargetSplitPanelRotary from "@/components/dashboard/GoalTargetSplitPanelRotary";
import DistrictAwardsModule from "@/components/dashboard/DistrictAwardsModule";
import GroupMessages from "@/components/goal-messages/GroupMessages";
import { rccTransformForm, RCC_SECTIONS } from "@/lib/rccGoals";
import { getDistrictGoalForm, saveDistrictGoalForm,
         getDistrictMonthlyGoals, saveDistrictTargetSplit, getGoalDirectHasUnread, downloadRccDistrictReport } from "@/services/api";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import type { GoalCategoryFormDto, SaveGoalEntriesRequest } from "@/types/goalSetting";

const SPLIT_CATEGORIES = [1, 210];
type Tab = "rcc" | "district";

export default function DistrictRccGoalsPage() {
  const { selectedDistrictId } = useAuth();
  const [tab, setTab] = useState<Tab>("rcc");

  return (
    <div className="space-y-4">
      <PageHeader title="RCC & District Goals" description="Goals come from Rotary.org; the boxes Rotary.org does not fill are typed here." />
      <PillTabs items={[{ key: "rcc", label: "RCC" }, { key: "district", label: "District Goals" }] as const} active={tab} onChange={setTab} />
      {tab === "rcc" ? <RccTab /> : selectedDistrictId
        ? <DistrictAwardsModule districtId={selectedDistrictId} rotarySections={RCC_SECTIONS} />
        : <p className="text-sm text-slate-500">Select a district.</p>}
    </div>
  );
}

// Copy of the New Goal Setting District Goals page (district-admin-dashboard/goal-setting-rotary) with
// transformForm = the RCC changes.
function RccTab() {
  const { selectedDistrictId, user, isSuperAdmin } = useAuth();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const clubGoalsHref = `/district-admin-dashboard/goal-setting-rotary/clubs${yearId ? `?yearId=${yearId}` : ""}`;

  const { years, currentYearId } = useRotaryYears();
  const yearRights = useMemo(
    () => districtYearRights(user?.scopedRoles, selectedDistrictId ?? 0),
    [user?.scopedRoles, selectedDistrictId]);
  const viewingYearId = yearId ?? currentYearId;
  const isYearLimited = !yearRights.allYears && !yearRights.unknown && yearRights.yearIds.length > 0;
  const canEditThisYear = !isYearLimited || canEditYear(yearRights, viewingYearId, isSuperAdmin);
  const editableYears = heldYearLabels(yearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));
  const viewingYearLabel = years.find((y) => y.id === viewingYearId)?.yearLabel;

  const fetchForm = useCallback((categoryId: number): Promise<GoalCategoryFormDto> => {
    return getDistrictGoalForm(categoryId, yearId, selectedDistrictId);
  }, [selectedDistrictId, yearId]);
  const saveForm = useCallback((categoryId: number, body: SaveGoalEntriesRequest): Promise<GoalCategoryFormDto> => {
    return saveDistrictGoalForm(categoryId, body, selectedDistrictId);
  }, [selectedDistrictId]);

  const [forms, setForms] = useState<GoalCategoryFormDto[]>([]);
  const [syncTick, setSyncTick] = useState(0);
  const [tabCats, setTabCats] = useState<number[]>([]);
  const districtId = forms[0]?.districtId ?? selectedDistrictId ?? null;
  const formYearId = forms[0]?.yearId ?? yearId;

  const [monthly, setMonthly] = useState<Record<number, GoalMonthlyForm>>({});
  useEffect(() => {
    if (!selectedDistrictId) { setMonthly({}); return; }
    let cancelled = false;
    Promise.allSettled(SPLIT_CATEGORIES.map((c) => getDistrictMonthlyGoals(c, yearId, selectedDistrictId)))
      .then((res) => {
        if (cancelled) return;
        const next: Record<number, GoalMonthlyForm> = {};
        res.forEach((r, i) => { if (r.status === "fulfilled") next[SPLIT_CATEGORIES[i]] = r.value; });
        setMonthly(next);
      });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);
  const saveSplit = useCallback(async (categoryId: number, body: SaveGoalTargetSplitRequest) => {
    const m = await saveDistrictTargetSplit(categoryId, body, selectedDistrictId);
    setMonthly((prev) => ({ ...prev, [categoryId]: m }));
    return m;
  }, [selectedDistrictId]);

  const [msgOpen, setMsgOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
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

  const dl = useDownloadProgress();
  const downloadReport = () => dl.run("report", async () => {
    if (!districtId) return;
    try {
      // Combined report: RCC + RCC by club + District Goals (step 5, user 2026-11-16).
      saveAs(await downloadRccDistrictReport(districtId, formYearId), `RCC_District_Goals_${fileTimestamp()}.xlsx`);
    } catch { /* the button comes back so it can be tried again */ }
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <RotaryOrgSync districtId={districtId} tone="light" onSynced={() => setSyncTick((t) => t + 1)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={downloadReport} disabled={dl.busy || !districtId} title="RCC & District Goals report - RCC, RCC by club, District Goals">
            {dl.is("report") ? dl.bar("report") : <><Download /> Report</>}
          </Button>
          <Button type="button" variant="outline" onClick={() => setMsgOpen(true)} disabled={!districtId || !formYearId} className="relative">
            <MessagesSquare /> Messages
            {hasUnread && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-500" title="New message" />}
          </Button>
          <Button variant="outline" asChild>
            <Link href={clubGoalsHref}><Building2 /> View Club Goals</Link>
          </Button>
        </div>
      </div>

      <div>
        {!canEditThisYear && <div className="mb-3"><ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} /></div>}
        <GoalSettingPanel
          title="RCC"
          highlightEmpty
          readOnly={!canEditThisYear}
          subtitle="District goals for the year, by Rotary.org section"
          fetchForm={fetchForm}
          saveForm={saveForm}
          transformForm={rccTransformForm}
          onFormsLoaded={setForms}
          onTabChange={(_, ids) => setTabCats(ids)}
          categoryExtras={(f) => monthly[f.categoryId]
            ? <GoalTargetSplitPanelRotary form={monthly[f.categoryId]} onSave={(b) => saveSplit(f.categoryId, b)} onDownload={downloadReport} reloadKey={`${f.categoryId}-${yearId ?? "cur"}`} />
            : null}
          reloadKey={`${yearId ?? "current"}-${syncTick}`}
        />
      </div>
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-6xl w-[96vw] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2"><MessagesSquare size={18} className="text-blue-600" /> Messages</DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex-1 min-h-0 flex flex-col">
            {districtId && formYearId ? (
              <GroupMessages mode="district" districtId={districtId} yearId={formYearId} initialCategoryId={tabCats[0] ?? null} />
            ) : (
              <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
