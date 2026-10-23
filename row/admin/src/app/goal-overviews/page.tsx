"use client";

// SuperAdmin Goal Overview: the read-only goal matrix for every zone and district.
// Other members see a no-access notice; the API enforces the same.

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import GoalOversightShell from "@/components/v2/GoalOversightShell";
import GoalOversightMatrix from "@/components/GoalOversightMatrix";
import {
  getGoalCategories, getScopedDistrictsGoalList,
  getCurrentRotaryYear, getRotaryYears,
} from "@/services/api";
import type { GoalCategoryDto, GoalDistrictSummaryDto } from "@/types/goalSetting";
import type { RotaryYear } from "@/types/rotaryYear";

export default function GoalOversightPage() {
  const { isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [allCategories, setAllCategories] = useState<GoalCategoryDto[]>([]);
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [districts, setDistricts] = useState<GoalDistrictSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Best-effort load: a failed list (categories/years) leaves its part empty.
    (async () => {
      const [cR, yR, ysR] = await Promise.allSettled([
        getGoalCategories(), getCurrentRotaryYear(), getRotaryYears(),
      ]);
      if (cancelled) return;
      if (cR.status === "fulfilled") setAllCategories(cR.value);
      if (yR.status === "fulfilled") setYearId(yR.value.id);
      if (ysR.status === "fulfilled") setYears(ysR.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch the districts once (any category) to derive the zones for the picker.
  useEffect(() => {
    const catId = allCategories[0]?.id;
    if (catId == null || yearId == null) { setDistricts([]); return; }
    let cancelled = false;
    getScopedDistrictsGoalList(catId, yearId)
      .then((rows) => { if (!cancelled) setDistricts(rows); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load districts."); });
    return () => { cancelled = true; };
  }, [allCategories, yearId]);

  // Zones, from the district list.
  const zonesInScope = useMemo(() => {
    const map = new Map<number, string>();
    districts.forEach((d) => {
      if (d.zoneId) map.set(d.zoneId, d.zoneName || `Zone ${d.zoneId}`);
    });
    return Array.from(map.entries())
      .map(([id, zoneName]) => ({ id, zoneName }))
      .sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }, [districts]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center py-20 min-h-[60vh]"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20 text-muted-foreground">
          <p>You have no Goal Overview access.</p>
          <p className="text-sm mt-1">Contact SuperAdmin if you believe this is incorrect.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <GoalOversightShell
        pageTitle="Goal Overview"
        pageSubtitle="Read-only goals for your zones & districts"
        roleLabel="Super Admin"
        nav={[{ label: "Goal Overview", href: "/goal-overviews", active: true }]}
        headerRight={
          years.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span className="hidden sm:inline font-medium">Year</span>
              <select
                value={yearId ?? ""}
                onChange={(e) => setYearId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</option>)}
              </select>
            </label>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          <GoalOversightMatrix
            zones={zonesInScope}
            yearId={yearId ?? 0}
            canFilterDistrict={true}
            showMessages={true}
            title="Goal Overview"
          />
        </div>
      </GoalOversightShell>
    </ProtectedRoute>
  );
}
