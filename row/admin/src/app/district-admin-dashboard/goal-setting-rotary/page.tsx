"use client";

// Rotary.org goals (owner 2026-11-09): the district's Rotary.org figures, the Excel reports and the
// DG "Sync from Rotary.org" panel. Part of the "goal_setting_rotary" module, off until a SuperAdmin
// switches it on in Settings > Features (the page and its menu link hide while it is off).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import RotaryOrgSync from "@/components/goal-rotary/RotaryOrgSync";
import {
  downloadGoalRotaryClubsReport,
  downloadGoalRotaryDistrictReport,
  getGoalRotaryOrgValues,
  getGoalRotaryYears,
  type GoalRotaryOrgValue,
  type GoalRotaryYear,
} from "@/services/api";

const panel = "rounded-xl border border-slate-200 bg-card p-5";

type Row = { item: string; byKind: Record<string, number | null> };

function toRows(values: GoalRotaryOrgValue[]): { rows: Row[]; kinds: string[] } {
  const kinds = Array.from(new Set(values.map((v) => v.kind)));
  const map = new Map<string, Row>();
  for (const v of values) {
    const row = map.get(v.itemName) ?? { item: v.itemName, byKind: {} };
    row.byKind[v.kind] = v.value;
    map.set(v.itemName, row);
  }
  return { rows: Array.from(map.values()).sort((a, b) => a.item.localeCompare(b.item)), kinds };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GoalSettingRotaryPage() {
  const { selectedDistrictId } = useAuth();
  const [years, setYears] = useState<GoalRotaryYear[] | null>(null);
  const [yearId, setYearId] = useState<number | null>(null);
  const [values, setValues] = useState<GoalRotaryOrgValue[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"district" | "clubs" | null>(null);

  useEffect(() => {
    getGoalRotaryYears()
      .then((y) => {
        setYears(y);
        const current = y.find((x) => x.isCurrent === true || x.isCurrent === 1) ?? y[0];
        setYearId(current?.id ?? null);
      })
      .catch(() => setError("Could not load the Rotary years."));
  }, []);

  const loadValues = useCallback(() => {
    if (!selectedDistrictId || !yearId) return;
    setValues(null);
    setError(null);
    getGoalRotaryOrgValues(yearId, selectedDistrictId)
      .then((r) => { setValues(r.values); setUpdatedAt(r.updatedAt); })
      .catch(() => setError("Could not load the Rotary.org figures for this district."));
  }, [selectedDistrictId, yearId]);

  useEffect(() => { loadValues(); }, [loadValues]);

  const table = useMemo(() => (values ? toRows(values) : null), [values]);

  const download = async (kind: "district" | "clubs") => {
    if (!selectedDistrictId || !yearId) return;
    setBusy(kind);
    try {
      const blob = kind === "district"
        ? await downloadGoalRotaryDistrictReport(selectedDistrictId, yearId)
        : await downloadGoalRotaryClubsReport(selectedDistrictId, yearId);
      saveBlob(blob, kind === "district" ? "District_Goals_RotaryOrg.xlsx" : "Club_Goals_RotaryOrg.xlsx");
    } catch {
      setError("The report could not be built. There may be no goal data for this year yet.");
    } finally {
      setBusy(null);
    }
  };

  if (!selectedDistrictId) return <p className={`${panel} text-sm text-slate-600`}>Select a district first.</p>;

  return (
    <div className="space-y-4">
      <section className={panel}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-800">Rotary.org goals</h2>
            <p className="text-xs text-slate-500">
              Figures read from Rotary.org for this district.{" "}
              {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}.` : "Not synced yet."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {years ? (
              <select
                aria-label="Rotary year"
                value={yearId ?? ""}
                onChange={(e) => setYearId(Number(e.target.value) || null)}
                className="h-9 rounded-md border border-slate-300 bg-card px-3 text-sm"
              >
                {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
              </select>
            ) : (
              <Skeleton className="h-9 w-28" />
            )}
            <button
              type="button"
              onClick={() => download("district")}
              disabled={busy !== null || !yearId}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "district" ? "Preparing..." : "District report (Excel)"}
            </button>
            <button
              type="button"
              onClick={() => download("clubs")}
              disabled={busy !== null || !yearId}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "clubs" ? "Preparing..." : "All clubs report (Excel)"}
            </button>
          </div>
        </div>
      </section>

      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Sync from Rotary.org</h3>
        <RotaryOrgSync districtId={selectedDistrictId} tone="light" onSynced={loadValues} />
      </section>

      <section className={panel}>
        {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
        {!table && !error && (
          <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        )}
        {table && table.rows.length === 0 && (
          <p className="text-sm text-slate-600">No Rotary.org figures for this district and year yet. Run a sync to load them.</p>
        )}
        {table && table.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-semibold">Goal</th>
                  {table.kinds.map((k) => <th key={k} className="py-2 pr-4 text-right font-semibold">{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.item} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-slate-800">{r.item}</td>
                    {table.kinds.map((k) => (
                      <td key={k} className="py-2 pr-4 text-right tabular-nums text-slate-700">
                        {r.byKind[k] == null ? "-" : Number(r.byKind[k]).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
