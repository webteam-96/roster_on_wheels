"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import { getClubGoalForm, saveClubGoalForm, getClubMonthlyGoals, saveClubTargetSplit } from "@/services/api";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import type { GoalCategoryFormDto, SaveGoalEntriesRequest } from "@/types/goalSetting";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { CLUB_GOAL_SETTING_COMING_SOON } from "@/lib/clubGoalSetting";

export default function ClubAdminGoalSettingPage() {
  const { selectedClubId } = useAuth();
  // Follow the dashboard's global rotary-year picker (?yearId=). Past years load
  // read-only; the current/future year is editable (enforced server-side).
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;

  // Track the loaded form so the club↔district message thread targets the right
  // (category, district, club, year) — its ids come straight off the form response.
  const [form, setForm] = useState<GoalCategoryFormDto | null>(null);

  const fetchForm = useCallback((categoryId: number): Promise<GoalCategoryFormDto> => {
    return getClubGoalForm(categoryId, yearId, selectedClubId);
  }, [selectedClubId, yearId]);
  const saveForm = useCallback((categoryId: number, body: SaveGoalEntriesRequest): Promise<GoalCategoryFormDto> => {
    return saveClubGoalForm(categoryId, body, selectedClubId);
  }, [selectedClubId]);

  // Quarterly / month-wise split of the yearly target (user 2026-09-25). Follows whichever category
  // the panel above is showing; the yearly figure itself is only ever edited up there.
  const [monthly, setMonthly] = useState<GoalMonthlyForm | null>(null);
  const catId = form?.categoryId ?? null;
  useEffect(() => {
    if (catId == null || !selectedClubId) { setMonthly(null); return; }
    let cancelled = false;
    getClubMonthlyGoals(catId, yearId, selectedClubId)
      .then((m) => { if (!cancelled) setMonthly(m); })
      .catch(() => { if (!cancelled) setMonthly(null); });   // annual-only category → no split
    return () => { cancelled = true; };
  }, [catId, selectedClubId, yearId]);
  const saveSplit = useCallback(async (body: SaveGoalTargetSplitRequest) => {
    const m = await saveClubTargetSplit(catId!, body, selectedClubId);
    setMonthly(m);
    return m;
  }, [catId, selectedClubId]);

  // Club Goal Setting is parked (user 2026-10-01) - the form and its fetches stay in place below,
  // the screen just shows the placeholder until CLUB_GOAL_SETTING_COMING_SOON is turned off.
  if (CLUB_GOAL_SETTING_COMING_SOON) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200">
        <ClubGoalComingSoon />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GoalSettingPanel
        title="Goal Setting"
        subtitle="Set your club's targets for the year, by category"
        fetchForm={fetchForm}
        saveForm={saveForm}
        reloadKey={yearId ?? "current"}
        onFormLoaded={setForm}
        belowCategories={<GoalTargetSplitPanel form={monthly} onSave={saveSplit} reloadKey={`${catId}-${yearId ?? "cur"}`} />}
      />
    </div>
  );
}
