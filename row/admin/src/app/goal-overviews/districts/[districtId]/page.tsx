"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import { getDistrictMonthlyGoalsScoped, type GoalMonthlyForm } from "@/services/api";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import GoalOversightShell from "@/components/v2/GoalOversightShell";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import GoalThreadPanel from "@/components/dashboard/GoalThreadPanel";
import {
  getScopedDistrictGoalForm, lockDistrictGoals, unlockDistrictGoals,
  getMyGoalAssignments, getGoalOversightCategories,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type { GoalCategoryFormDto, GoalLockStatusDto, GoalCategoryDto, GoalMyAssignmentDto } from "@/types/goalSetting";

export default function GoalOversightDistrictDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isSuperAdmin } = useAuth();

  const districtId = Number(params.districtId);
  const categoryId = searchParams.get("categoryId") ? Number(searchParams.get("categoryId")) : null;
  const yearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;

  const [assignments, setAssignments] = useState<GoalMyAssignmentDto[]>([]);
  const [allCategories, setAllCategories] = useState<GoalCategoryDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyGoalAssignments(), getGoalOversightCategories()])
      .then(([a, cats]) => { if (!cancelled) { setAssignments(a); setAllCategories(cats); } })
      .catch(() => { /* nav is best-effort: the page still works without the sidebar list */ });
    return () => { cancelled = true; };
  }, []);

  const myCategories = useMemo(() => {
    if (isSuperAdmin) return allCategories;
    const ids = new Set(assignments.flatMap((a) => a.categoryIds));
    return allCategories.filter((c) => ids.has(c.id));
  }, [assignments, allCategories, isSuperAdmin]);

  const roleLabel = useMemo(() => {
    if (isSuperAdmin) return "Super Admin";
    const types = new Set(assignments.map((a) => a.roleType));
    if (types.has("AllCategoryAllDistrictsFewZones")) return "RI Director";
    if (types.has("AllDistrictsOneCategoryOneZone")) return "Zone Co-ordinator";
    if (types.has("FewDistrictsOneCategoryOneZone")) return "District Assistant";
    return "Goal Setting";
  }, [assignments, isSuperAdmin]);

  const nav = myCategories.map((c) => ({
    label: c.name,
    href: `/goal-overviews?categoryId=${c.id}`,
    active: c.id === categoryId,
  }));

  const fetchForm = useCallback((catId: number): Promise<GoalCategoryFormDto> => {
    if (yearId == null) return Promise.reject(new Error("Missing yearId"));
    return getScopedDistrictGoalForm(catId, districtId, yearId);
  }, [districtId, yearId]);
  const lockToggle = useCallback((catId: number, yrId: number, locked: boolean): Promise<GoalLockStatusDto> => {
    return locked ? lockDistrictGoals(catId, yrId, districtId) : unlockDistrictGoals(catId, yrId, districtId);
  }, [districtId]);

  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(categoryId);
  const [splitForm, setSplitForm] = useState<GoalMonthlyForm | null>(null);
  useEffect(() => {
    if (activeCategoryId == null || !districtId) { setSplitForm(null); return; }
    let cancelled = false;
    getDistrictMonthlyGoalsScoped(activeCategoryId, districtId, yearId)
      .then((m) => { if (!cancelled) setSplitForm(m); })
      .catch(() => { if (!cancelled) setSplitForm(null); });
    return () => { cancelled = true; };
  }, [activeCategoryId, districtId, yearId]);
  const onFormLoaded = useCallback((f: GoalCategoryFormDto) => setActiveCategoryId(f.categoryId), []);

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <GoalOversightShell pageTitle="District Goals" pageSubtitle="Oversight view" roleLabel={roleLabel} nav={nav}>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
            <button
              onClick={() => router.push(`/goal-overviews?categoryId=${categoryId ?? ""}`)}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">District Goals</h2>
              <p className="text-xs text-slate-500">Oversight view. You can review goals, lock/unlock, and message.</p>
            </div>
          </div>

          <GoalSettingPanel
            title="District Goals"
            fetchForm={fetchForm}
            readOnly
            lockToggle={lockToggle}
            initialCategoryId={categoryId}
            onFormLoaded={onFormLoaded}
            belowCategories={
              /* READ ONLY here - only Club/District Admin may edit a split (user 2026-09-25). */
              <GoalTargetSplitPanel
                form={splitForm}
                onSave={async () => { throw new Error("read only"); }}
                readOnly
                reloadKey={`${districtId}-${yearId}-${activeCategoryId}`}
              />
            }
          />

          <GoalThreadPanel categoryId={activeCategoryId} districtId={districtId} yearId={yearId} />
        </div>
      </GoalOversightShell>
    </ProtectedRoute>
  );
}
