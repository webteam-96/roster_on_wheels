"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, MessagesSquare } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import DistrictGoalMessages from "@/components/goal-messages/DistrictGoalMessages";
import { getDistrictGoalForm, saveDistrictGoalForm,
         getDistrictMonthlyGoals, saveDistrictTargetSplit } from "@/services/api";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import type { GoalCategoryFormDto, SaveGoalEntriesRequest } from "@/types/goalSetting";

export default function DistrictAdminGoalSettingPage() {
  const { selectedDistrictId, user, isSuperAdmin } = useAuth();
  const [threadKey, setThreadKey] = useState<{ categoryId: number; districtId: number; yearId: number } | null>(null);
  // Follow the dashboard's global rotary-year picker (?yearId=). Past years load
  // read-only; the current/future year is editable (enforced server-side).
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const clubGoalsHref = `/district-admin-dashboard/goal-setting/clubs${yearId ? `?yearId=${yearId}` : ""}`;

  // District goals belong to a Rotary year. ⚠️ A Zonal Coordinator reaches this
  // screen too and holds NO district admin row — rights.any is false for them,
  // and the server deliberately lets that through (their authority is the zone
  // role). So only narrow the UI when the member actually has district rights.
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
  const onFormLoaded = useCallback((f: GoalCategoryFormDto) => {
    if (f.districtId != null) setThreadKey({ categoryId: f.categoryId, districtId: f.districtId, yearId: f.yearId });
    setCatId(f.categoryId);
  }, []);

  // Quarterly / month-wise split of the yearly target (user 2026-09-25). Follows whichever category
  // the panel above is showing; the yearly figure itself is only ever edited up there.
  const [catId, setCatId] = useState<number | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [monthly, setMonthly] = useState<GoalMonthlyForm | null>(null);
  useEffect(() => {
    if (catId == null || !selectedDistrictId) { setMonthly(null); return; }
    let cancelled = false;
    getDistrictMonthlyGoals(catId, yearId, selectedDistrictId)
      .then((m) => { if (!cancelled) setMonthly(m); })
      .catch(() => { if (!cancelled) setMonthly(null); });   // annual-only category → no split
    return () => { cancelled = true; };
  }, [catId, selectedDistrictId, yearId]);
  const saveSplit = useCallback(async (body: SaveGoalTargetSplitRequest) => {
    const m = await saveDistrictTargetSplit(catId!, body, selectedDistrictId);
    setMonthly(m);
    return m;
  }, [catId, selectedDistrictId]);

  return (
    <div className="space-y-6">
      <Card className="p-5 flex items-center justify-between">
        <div>
          <h2 className="row-h2">District Goal Setting</h2>
          <p className="text-xs text-slate-500">Set the district's own targets, or review each club's goals.</p>
        </div>
        <Link
          href={clubGoalsHref}
          className="row-btn row-btn-primary"
        >
          <Building2 size={13} /> View Club Goals
        </Link>
      </Card>

      {!canEditThisYear && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} />
      )}
      <GoalSettingPanel
        title="District Goals"
        subtitle="District-level targets for the year, by category"
        fetchForm={fetchForm}
        saveForm={saveForm}
        onFormLoaded={onFormLoaded}
        belowCategories={
          <div className="flex flex-wrap items-start gap-3">
            {/* Messages for the category selected above (user 2026-10-09): opens that category's box. */}
            <Button
              type="button"
              onClick={() => setMsgOpen(true)}
              disabled={catId == null}
              variant="outline"
            >
              <MessagesSquare size={14} /> Messages
            </Button>
            <div className="flex-1 min-w-0">
              <GoalTargetSplitPanel form={monthly} onSave={saveSplit} reloadKey={`${catId}-${yearId ?? "cur"}`} />
            </div>
          </div>
        }
        reloadKey={yearId ?? "current"}
        readOnly={!canEditThisYear}
      />
      {/* District Admin / District Governor → Super Admin, for the category selected above
          (user 2026-10-09). Read-only for the Super Admin; no replies. */}
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2"><MessagesSquare size={18} className="text-blue-600" /> Messages</DialogTitle>
          </DialogHeader>
          <DistrictGoalMessages districtId={threadKey?.districtId ?? selectedDistrictId ?? null}
            yearId={threadKey?.yearId ?? yearId} initialCategoryId={catId} lockCategory />
        </DialogContent>
      </Dialog>
    </div>
  );
}
