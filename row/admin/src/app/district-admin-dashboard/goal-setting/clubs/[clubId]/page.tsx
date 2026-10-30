"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import { getClubGoalForm, saveClubGoalForm,
         getClubMonthlyGoals, saveClubTargetSplit } from "@/services/api";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import type { GoalCategoryFormDto, SaveGoalEntriesRequest } from "@/types/goalSetting";

export default function DistrictAdminGoalClubDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const clubId = Number(params.clubId);
  const categoryId = searchParams.get("categoryId") ? Number(searchParams.get("categoryId")) : null;
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = "/district-admin-dashboard/goal-setting/clubs";
  const goBack = () => router.push(returnTo || fallbackBack);

  const [form, setForm] = useState<GoalCategoryFormDto | null>(null);

  const fetchForm = useCallback((catId: number): Promise<GoalCategoryFormDto> => {
    return getClubGoalForm(catId, yearId, clubId);
  }, [clubId, yearId]);
  const saveForm = useCallback((catId: number, body: SaveGoalEntriesRequest): Promise<GoalCategoryFormDto> => {
    return saveClubGoalForm(catId, body, clubId);
  }, [clubId]);

  // Quarterly / month-wise split for THIS club — a District Admin may edit it here, same as the club.
  const [monthly, setMonthly] = useState<GoalMonthlyForm | null>(null);
  const catId = form?.categoryId ?? categoryId ?? null;
  useEffect(() => {
    if (catId == null || !clubId) { setMonthly(null); return; }
    let cancelled = false;
    getClubMonthlyGoals(catId, yearId, clubId)
      .then((m) => { if (!cancelled) setMonthly(m); })
      .catch(() => { if (!cancelled) setMonthly(null); });   // annual-only category → no split
    return () => { cancelled = true; };
  }, [catId, clubId, yearId]);
  const saveSplit = useCallback(async (body: SaveGoalTargetSplitRequest) => {
    const m = await saveClubTargetSplit(catId!, body, clubId);
    setMonthly(m);
    return m;
  }, [catId, clubId]);

  if (!clubId) return null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
        <button
          onClick={goBack}
          className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Club Goals</h2>
          <p className="text-xs text-slate-500">View and edit this club&apos;s goals for the year.</p>
        </div>
      </div>

      <GoalSettingPanel
        title="Club Goals"
        fetchForm={fetchForm}
        saveForm={saveForm}
        initialCategoryId={categoryId}
        reloadKey={yearId ?? "current"}
        onFormLoaded={setForm}
        belowCategories={<GoalTargetSplitPanel form={monthly} onSave={saveSplit} reloadKey={`${catId}-${yearId ?? "cur"}`} />}
      />
    </div>
  );
}
