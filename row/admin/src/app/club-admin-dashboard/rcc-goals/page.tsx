"use client";

// "RCC & District Goals" for a club (user 2026-11-16; open to club admins from 2026-11-23, owner) (menu item
// superAdminOnly). Club level has the RCC tab only (District Goals is set by the district).
// = the New Goal Setting Club Goals page with the RCC changes of lib/rccGoals.ts, same design.
// The existing Club Goals screen is not changed.

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "@/components/icons";
import { saveAs } from "file-saver";
import { useAuth } from "@/contexts/AuthContext";
import { fileTimestamp } from "@/lib/dateUtils";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanelRotary";
import GoalTargetSplitPanelRotary from "@/components/dashboard/GoalTargetSplitPanelRotary";
import RotaryOrgSync from "@/components/goal-rotary/RotaryOrgSync";
import { rccTransformForm } from "@/lib/rccGoals";
import { getClubGoalForm, saveClubGoalForm, getClubMonthlyGoals, saveClubTargetSplit, downloadRccClubReport } from "@/services/api";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import type { GoalCategoryFormDto, SaveGoalEntriesRequest } from "@/types/goalSetting";

const SPLIT_CATEGORIES = [1, 210];

export default function ClubRccGoalsPage() {
  return <ClubRcc />;
}

function ClubRcc() {
  const { selectedClubId, user, isSuperAdmin } = useAuth();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const [forms, setForms] = useState<GoalCategoryFormDto[]>([]);

  const { years, currentYearId } = useRotaryYears();
  const yearRights = useMemo(
    () => clubYearRights(user?.scopedRoles, selectedClubId ?? 0),
    [user?.scopedRoles, selectedClubId]);
  const viewingYearId = yearId ?? currentYearId;
  const canEditThisYear = canEditYear(yearRights, viewingYearId, isSuperAdmin);
  const editableYears = heldYearLabels(yearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));
  const viewingYearLabel = years.find((y) => y.id === viewingYearId)?.yearLabel;

  const fetchForm = useCallback((categoryId: number): Promise<GoalCategoryFormDto> => {
    return getClubGoalForm(categoryId, yearId, selectedClubId);
  }, [selectedClubId, yearId]);
  const saveForm = useCallback((categoryId: number, body: SaveGoalEntriesRequest): Promise<GoalCategoryFormDto> => {
    return saveClubGoalForm(categoryId, body, selectedClubId);
  }, [selectedClubId]);

  const [syncTick, setSyncTick] = useState(0);
  const onSynced = useCallback(() => setSyncTick((t) => t + 1), []);

  const [monthly, setMonthly] = useState<Record<number, GoalMonthlyForm>>({});
  useEffect(() => {
    if (!selectedClubId) { setMonthly({}); return; }
    let cancelled = false;
    Promise.allSettled(SPLIT_CATEGORIES.map((c) => getClubMonthlyGoals(c, yearId, selectedClubId)))
      .then((res) => {
        if (cancelled) return;
        const next: Record<number, GoalMonthlyForm> = {};
        res.forEach((r, i) => { if (r.status === "fulfilled") next[SPLIT_CATEGORIES[i]] = r.value; });
        setMonthly(next);
      });
    return () => { cancelled = true; };
  }, [selectedClubId, yearId, syncTick]);
  const saveSplit = useCallback(async (categoryId: number, body: SaveGoalTargetSplitRequest) => {
    const m = await saveClubTargetSplit(categoryId, body, selectedClubId);
    setMonthly((prev) => ({ ...prev, [categoryId]: m }));
    return m;
  }, [selectedClubId]);

  const dl = useDownloadProgress();
  const downloadReport = () => dl.run("report", async () => {
    const clubId = forms[0]?.clubId ?? selectedClubId;
    if (!clubId) return;
    // Combined report: RCC + District Goals (step 5, user 2026-11-16).
    try { saveAs(await downloadRccClubReport(clubId, forms[0]?.yearId ?? yearId), `RCC_Club_Goals_${fileTimestamp()}.xlsx`); } catch { /* try again */ }
  });

  return (
    <div>
      <PageHeader
        title="RCC & District Goals"
        description="Goals come from Rotary.org; the boxes Rotary.org does not fill are typed here."
        actions={
          <Button type="button" variant="outline" onClick={downloadReport} disabled={dl.busy || forms.length === 0} title="RCC & District Goals report - RCC and District Goals">
            {dl.is("report") ? dl.bar("report") : <><Download /> Report</>}
          </Button>
        }
      />
      {selectedClubId && viewingYearId === currentYearId && (
        <div className="mb-4"><RotaryOrgSync clubId={selectedClubId} tone="light" onSynced={onSynced} /></div>
      )}
      <div>
        {!canEditThisYear && <div className="mb-3"><ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} /></div>}
        <GoalSettingPanel
          title="RCC"
          highlightEmpty
          readOnly={!canEditThisYear}
          subtitle={forms[0] ? `${forms[0].entityName} · RY ${forms[0].yearLabel}` : "Club goals for the year, by Rotary.org section"}
          fetchForm={fetchForm}
          saveForm={saveForm}
          transformForm={rccTransformForm}
          reloadKey={`${yearId ?? "current"}-${syncTick}`}
          onFormsLoaded={setForms}
          categoryExtras={(f) => monthly[f.categoryId]
            ? <GoalTargetSplitPanelRotary form={monthly[f.categoryId]} onSave={(b) => saveSplit(f.categoryId, b)} onDownload={downloadReport} reloadKey={`${f.categoryId}-${yearId ?? "cur"}`} />
            : null}
        />
      </div>
    </div>
  );
}
