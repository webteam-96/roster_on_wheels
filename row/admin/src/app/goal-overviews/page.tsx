"use client";

// After-login Goal Setting oversight for RI Director / Zone Co-ordinator / District Assistant.
// Shows the SAME read-only Overview layout as the SuperAdmin settings page (GoalReadonlyViewer),
// but SCOPED to the member's assigned zones/districts. Reply permission (RI Director + SuperAdmin
// read-only) is enforced server-side inside the comment panels.

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import GoalOversightShell from "@/components/v2/GoalOversightShell";
import GoalOversightMatrix from "@/components/GoalOversightMatrix";
import GoalOversightMatrixZoneRole from "@/components/GoalOversightMatrixZoneRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, LockOpen } from "@/components/icons";
import {
  getMyGoalAssignments, getGoalOversightCategories, getScopedDistrictsGoalList,
  getCurrentRotaryYear, getRotaryYears, bulkLockGoalDistricts,
  setGoalViewAs,
} from "@/services/api";
import type { GoalMyAssignmentDto, GoalCategoryDto, GoalDistrictSummaryDto } from "@/types/goalSetting";
import type { RotaryYear } from "@/types/rotaryYear";

export default function GoalOversightPage() {
  const searchParams = useSearchParams();
  const { isSuperAdmin } = useAuth();
  // The role the member is acting as (from the "Goal Setting - <role>" switcher). Scopes the whole
  // dashboard to that role so a multi-role person sees each role's view separately.
  const actingAs = searchParams.get("as"); // "ri-director" | "zone-coordinator" | "district-assistant" | null

  // Observer "view as" (flagged SuperAdmins only): the member whose oversight we're observing.
  // Set the module-level override DURING RENDER so child fetch-effects (which run before the parent
  // effect) already carry ?asMemberId. Backend ignores it unless the caller is the gated observer.
  const viewAsMemberId = searchParams.get("asMemberId") ? Number(searchParams.get("asMemberId")) : null;
  setGoalViewAs(viewAsMemberId);
  useEffect(() => () => setGoalViewAs(null), []); // clear when leaving the dashboard

  const actingRoleType =
    actingAs === "ri-director" ? "AllCategoryAllDistrictsFewZones"
    : actingAs === "zone-coordinator" ? "AllDistrictsOneCategoryOneZone"
    : actingAs === "district-assistant" ? "FewDistrictsOneCategoryOneZone"
    : null;

  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<GoalMyAssignmentDto[]>([]);
  const [allCategories, setAllCategories] = useState<GoalCategoryDto[]>([]);
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [districts, setDistricts] = useState<GoalDistrictSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bulkLocking, setBulkLocking] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resilient load — one peripheral failure (categories/years) must NOT wipe assignments and
    // wrongly show "no access". Assignments is the gate; the rest are best-effort.
    (async () => {
      const [aR, cR, yR, ysR] = await Promise.allSettled([
        getMyGoalAssignments(), getGoalOversightCategories(), getCurrentRotaryYear(), getRotaryYears(),
      ]);
      if (cancelled) return;
      if (aR.status === "fulfilled") setAssignments(aR.value);
      else setError(aR.reason?.response?.data?.message || "Failed to load your oversight assignments.");
      if (cR.status === "fulfilled") setAllCategories(cR.value);
      if (yR.status === "fulfilled") setYearId(yR.value.id);
      if (ysR.status === "fulfilled") setYears(ysR.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // Reload when the observer switches to a different person (asMemberId changes the effective scope).
  }, [viewAsMemberId]);

  // Act as the GOAL ROLE, not SuperAdmin — scope to goal assignments even for a SuperAdmin. When
  // acting as a specific role, only that role's assignments drive the scope.
  const scopedAssignments = useMemo(
    () => (actingRoleType ? assignments.filter((a) => a.roleType === actingRoleType) : assignments),
    [assignments, actingRoleType],
  );
  const myZoneIds = useMemo(() => {
    const s = new Set<number>();
    scopedAssignments.forEach((a) => (a.zoneIds || []).forEach((z) => s.add(z)));
    return s;
  }, [scopedAssignments]);
  const myCategories = useMemo(() => {
    const ids = new Set(scopedAssignments.flatMap((a) => a.categoryIds));
    if (ids.size > 0) return allCategories.filter((c) => ids.has(c.id));
    // A SuperAdmin has full read access, so fall back to ALL categories (→ all zones) even when a
    // `?as=<role>` is in the URL and they hold no matching goal assignment. Without this, an observer
    // SuperAdmin viewing e.g. ?as=zone-coordinator with no ZC assignment sees an empty zone dropdown.
    return isSuperAdmin ? allCategories : [];
  }, [scopedAssignments, allCategories, isSuperAdmin]);
  const roleLabel = useMemo(() => {
    const types = new Set(scopedAssignments.map((a) => a.roleType));
    if (types.has("AllCategoryAllDistrictsFewZones")) return "RI Director";
    if (types.has("AllDistrictsOneCategoryOneZone")) return "Zone Co-ordinator";
    if (types.has("FewDistrictsOneCategoryOneZone")) return "District Assistant";
    return isSuperAdmin ? "Super Admin" : "Goal Setting";
  }, [scopedAssignments, isSuperAdmin]);
  const bulkAssignment = assignments.find((a) => a.canBulkLock);

  // Fetch the member's scoped districts once (any in-scope category) to derive the zones for the picker.
  useEffect(() => {
    const catId = myCategories[0]?.id;
    if (catId == null || yearId == null) { setDistricts([]); return; }
    let cancelled = false;
    getScopedDistrictsGoalList(catId, yearId)
      .then((rows) => { if (!cancelled) setDistricts(rows); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load districts."); });
    return () => { cancelled = true; };
  }, [myCategories, yearId]);

  // Zones in scope, from the scoped district list, restricted to the member's ASSIGNED zones.
  const zonesInScope = useMemo(() => {
    const map = new Map<number, string>();
    districts.forEach((d) => {
      if (d.zoneId && (myZoneIds.size === 0 || myZoneIds.has(d.zoneId)))
        map.set(d.zoneId, d.zoneName || `Zone ${d.zoneId}`);
    });
    return Array.from(map.entries())
      .map(([id, zoneName]) => ({ id, zoneName }))
      .sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }, [myZoneIds, districts]);

  async function handleBulkLock(locked: boolean) {
    if (yearId == null) return;
    setBulkLocking(true); setBulkResult(null); setError(null);
    try {
      const result = await bulkLockGoalDistricts({ yearId, categoryIds: null, zoneIds: null, locked });
      setBulkResult(`${locked ? "Locked" : "Unlocked"} ${result.affectedCount} district × category records.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Bulk lock failed.");
    } finally { setBulkLocking(false); }
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center py-20 min-h-[60vh]"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }

  if (assignments.length === 0 && !isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20 text-muted-foreground">
          <p>You have no Goal Setting oversight access.</p>
          <p className="text-sm mt-1">Contact SuperAdmin if you believe this is incorrect.</p>
        </div>
      </ProtectedRoute>
    );
  }

  // Page name is "Goal Overview" ONLY for Super Admin; RI Director / ZC / DA keep "Goal Setting".
  const displayName = roleLabel === "Super Admin" ? "Goal Overview" : "Goal Setting";

  return (
    <ProtectedRoute>
      <GoalOversightShell
        pageTitle={displayName}
        pageSubtitle="Read-only goals for your zones & districts"
        roleLabel={roleLabel}
        nav={[{ label: displayName, href: "/goal-overviews", active: true }]}
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

          {bulkAssignment && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> Bulk Lock: all your zones, all categories</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <Button size="sm" disabled={bulkLocking} onClick={() => handleBulkLock(true)} className="bg-amber-500 hover:bg-amber-600">
                  {bulkLocking ? <RotaryLoader size="sm" /> : <><Lock className="h-4 w-4 mr-1" />Lock All</>}
                </Button>
                <Button size="sm" variant="outline" disabled={bulkLocking} onClick={() => handleBulkLock(false)}>
                  {bulkLocking ? <RotaryLoader size="sm" /> : <><LockOpen className="h-4 w-4 mr-1" />Unlock All</>}
                </Button>
                {bulkResult && <span className="text-xs text-emerald-700">{bulkResult}</span>}
              </CardContent>
            </Card>
          )}

          {/* District-row overview. RI Director / Super Admin keep the original read-only component
              (DO NOT change). Zone Co-ordinator / District Assistant use a separate component that
              hides the single-zone selector and puts a COMPOSE-to-RI messages popup in place of the
              old below-matrix section. */}
          {roleLabel === "RI Director" || roleLabel === "Super Admin" ? (
            <GoalOversightMatrix
              zones={zonesInScope}
              yearId={yearId ?? 0}
              actingAs={actingAs}
              canFilterDistrict={true}
              showMessages={true}
              title={displayName}
            />
          ) : (
            <GoalOversightMatrixZoneRole
              zones={zonesInScope}
              yearId={yearId ?? 0}
              actingAs={actingAs}
              canFilterDistrict={roleLabel !== "District Assistant"}
            />
          )}
        </div>
      </GoalOversightShell>
    </ProtectedRoute>
  );
}
