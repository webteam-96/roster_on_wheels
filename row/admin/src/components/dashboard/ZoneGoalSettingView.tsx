"use client";

/**
 * Zonal Coordinator — Goal Setting.
 *
 * The zone-level parallel to the District Admin's "Club Goals" flow
 * (/district-admin-dashboard/goal-setting/clubs): a category-tabbed list of every
 * district in the ZC's zone with its goal status, drilling into one district to
 * view / edit / lock its goals via the shared GoalSettingPanel.
 *
 * Rendered inline as a view inside the single-page /zonal-dashboard shell (not a
 * route), so "back" is local state — no returnTo needed. `zoneId` is passed only
 * when a SuperAdmin borrows a zone from Global Search; a real ZC omits it and the
 * backend resolves their own zone.
 */

import { useEffect, useState, useCallback } from "react";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import { getDistrictMonthlyGoalsScoped, type GoalMonthlyForm } from "@/services/api";
import { Building2, AlertCircle, ArrowLeft, CheckCircle2, Circle, Lock } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import {
  getGoalOversightCategories,
  getCurrentRotaryYear,
  getZoneDistrictsGoalList,
  getZoneDistrictGoalForm,
  saveZoneDistrictGoalForm,
  lockZoneDistrictGoals,
  unlockZoneDistrictGoals,
} from "@/services/api";
import type {
  GoalCategoryDto, GoalDistrictSummaryDto, GoalCategoryFormDto, SaveGoalEntriesRequest, GoalLockStatusDto,
} from "@/types/goalSetting";

export default function ZoneGoalSettingView({ zoneId }: { zoneId?: number }) {
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [yearId, setYearId] = useState<number | null>(null);
  const [districts, setDistricts] = useState<GoalDistrictSummaryDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GoalDistrictSummaryDto | null>(null);
  // Quarterly / month-wise split for the district being viewed, read-only.
  const [splitCatId, setSplitCatId] = useState<number | null>(null);
  const [splitForm, setSplitForm] = useState<GoalMonthlyForm | null>(null);
  useEffect(() => {
    if (splitCatId == null || !selected?.districtId) { setSplitForm(null); return; }
    let cancelled = false;
    getDistrictMonthlyGoalsScoped(splitCatId, selected.districtId, null)
      .then((m) => { if (!cancelled) setSplitForm(m); })
      .catch(() => { if (!cancelled) setSplitForm(null); });
    return () => { cancelled = true; };
  }, [splitCatId, selected?.districtId]);

  // Categories + current rotary year (goal-setting always targets the current year).
  useEffect(() => {
    let cancelled = false;
    Promise.all([getGoalOversightCategories(), getCurrentRotaryYear()])
      .then(([cats, yr]) => {
        if (cancelled) return;
        setCategories(cats);
        if (cats.length > 0) setActiveCategoryId(cats[0].id);
        setYearId(yr.id);
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load goal categories."); });
    return () => { cancelled = true; };
  }, []);

  const fetchDistricts = useCallback(() => {
    if (activeCategoryId == null || yearId == null) return;
    setLoading(true); setError(null);
    getZoneDistrictsGoalList(activeCategoryId, yearId, zoneId)
      .then((rows) => setDistricts(rows))
      .catch((e) => setError(e?.response?.data?.message || "Failed to load district goals."))
      .finally(() => setLoading(false));
  }, [activeCategoryId, yearId, zoneId]);

  // Reload the list when returning from a district (state may have changed) or switching category.
  useEffect(() => { if (!selected) fetchDistricts(); }, [fetchDistricts, selected]);

  // ── Detail (drill-in) callbacks — bound to the selected district ──
  const fetchForm = useCallback((catId: number): Promise<GoalCategoryFormDto> => {
    return getZoneDistrictGoalForm(catId, selected!.districtId, null);
  }, [selected]);
  const saveForm = useCallback((catId: number, body: SaveGoalEntriesRequest): Promise<GoalCategoryFormDto> => {
    return saveZoneDistrictGoalForm(catId, selected!.districtId, body);
  }, [selected]);
  const lockToggle = useCallback((catId: number, yrId: number, locked: boolean): Promise<GoalLockStatusDto> => {
    return locked
      ? lockZoneDistrictGoals(catId, selected!.districtId, yrId)
      : unlockZoneDistrictGoals(catId, selected!.districtId, yrId);
  }, [selected]);

  // ── Detail view ──
  if (selected) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
          <button
            onClick={() => setSelected(null)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">District {selected.districtNumber} Goals</h2>
            <p className="text-xs text-slate-500">View, edit, and lock this district&apos;s goals for the year.</p>
          </div>
        </div>

        <GoalSettingPanel
          title={`District ${selected.districtNumber} Goals`}
          fetchForm={fetchForm}
          saveForm={saveForm}
          lockToggle={lockToggle}
          initialCategoryId={activeCategoryId}
          onCategoryChange={setSplitCatId}
          belowCategories={
            /* READ ONLY — a zone view oversees, it does not enter the split (user 2026-09-25). */
            <GoalTargetSplitPanel
              form={splitForm}
              onSave={async () => { throw new Error("read only"); }}
              readOnly
              reloadKey={`${selected.districtId}-${splitCatId}`}
            />
          }
        />
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-800">District Goals</h2>
        <p className="text-xs text-slate-500">Review, edit, and lock each district&apos;s goals for the year.</p>
      </div>

      {categories && categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeCategoryId === c.id
                  ? "bg-azure text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <RotaryLoader size="lg" />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-200">
          <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
          <p className="text-slate-500">{error}</p>
        </div>
      )}

      {!loading && !error && districts && districts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-200">
          <Building2 className="h-10 w-10 text-slate-400 mb-3" />
          <p className="text-slate-500">No districts found in this zone.</p>
        </div>
      )}

      {!loading && !error && districts && districts.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-marigold" style={{ backgroundColor: "#17458f" }}>
                <th className="text-left px-4 py-2.5 text-white text-xs font-semibold uppercase tracking-wide">District</th>
                <th className="text-left px-4 py-2.5 text-white text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 text-white text-xs font-semibold uppercase tracking-wide">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {districts.map((d) => (
                <tr
                  key={d.districtId}
                  onClick={() => setSelected(d)}
                  className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50/70"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800">District {d.districtNumber}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {d.hasAnyGoalSet ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 size={13} /> Goals set
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                          <Circle size={13} /> Not set
                        </span>
                      )}
                      {d.isLocked && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          <Lock size={10} /> Locked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {d.lastUpdatedDate || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
