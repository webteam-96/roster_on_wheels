"use client";

// "RCC & District Goals" (user 2026-11-16) - Super Admin only until go-live (menu item superAdminOnly).
// Tab RCC = the New Goal Setting (District Goals page) with the RCC changes of lib/rccGoals.ts, same design.
// Tab District Goals = District Awards as it is, plus the 4 Rotary.org sections in its Category dropdown.
// The existing District Goals / District Awards screens are not changed.

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
  const { isSuperAdmin, selectedDistrictId } = useAuth();
  const [tab, setTab] = useState<Tab>("rcc");
  if (!isSuperAdmin) return <p className="p-6 text-sm text-slate-500">This page is not available yet.</p>;

  const tabCls = (on: boolean) => `px-4 py-2 rounded-lg text-sm font-semibold transition ${
    on ? "bg-marigold text-navy-950" : "text-white hover:bg-white/10"}`;
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-navy-950 p-1.5">
        <button type="button" onClick={() => setTab("rcc")} className={tabCls(tab === "rcc")}>RCC</button>
        <button type="button" onClick={() => setTab("district")} className={tabCls(tab === "district")}>District Goals</button>
      </div>
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

  const headBtn = "inline-flex items-center gap-2 text-sm font-bold min-h-11 px-4 rounded-xl border border-navy-400 text-white hover:bg-white/10 disabled:opacity-60";
  return (
    <div>
      <div className="rounded-[20px] bg-navy-950 text-white px-6 pt-5 pb-24 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white flex flex-wrap items-center gap-2.5">Sync Club Goals Summary from Rotary.org <span className="rounded-full bg-marigold px-2.5 py-0.5 text-xs font-bold text-navy-950">Rotary.org</span></h2>
          <p className="text-sm text-navy-200 mt-1">Goals come from Rotary.org; the boxes Rotary.org does not fill are typed here.</p>
          <div className="mt-3"><RotaryOrgSync districtId={districtId} onSynced={() => setSyncTick((t) => t + 1)} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={downloadReport} disabled={dl.busy || !districtId}
            title="RCC & District Goals report - RCC, RCC by club, District Goals" className={headBtn}>
            {dl.is("report") ? dl.bar("report") : <><Download size={15} /> Report</>}
          </button>
          <button type="button" onClick={() => setMsgOpen(true)} disabled={!districtId || !formYearId} className={`relative ${headBtn}`}>
            <MessagesSquare size={16} /> Messages
            {hasUnread && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 ring-2 ring-navy-950" title="New message" />}
          </button>
          <Link href={clubGoalsHref}
            className="inline-flex items-center gap-2 text-sm font-bold min-h-11 px-4 rounded-xl bg-marigold text-navy-950 hover:bg-gold-light">
            <Building2 size={15} /> View Club Goals
          </Link>
        </div>
      </div>

      <div className="-mt-16 mx-2 sm:mx-5">
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
