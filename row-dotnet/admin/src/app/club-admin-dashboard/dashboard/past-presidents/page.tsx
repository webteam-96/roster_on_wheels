"use client";

/**
 * Club Admin Dashboard · Past Presidents tab.
 * Listing (photo / name / year) with Add / Edit / Delete. Add & Edit deep-link to
 * the V2 form pages under /clubs/[id]/past-presidents/v2/(add|[id]/edit), carrying
 * a returnTo back to this tab. Delete uses deletePastPresident with a confirm.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Award, Plus, Edit3, Trash2, AlertTriangle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { useAuth } from "@/contexts/AuthContext";
import { getPastPresidents, deletePastPresident, getPhotoUrl } from "@/services/api";
import type { PastPresident } from "@/types/pastPresident";

const RETURN_TO = "/club-admin-dashboard/dashboard/past-presidents";

export default function DashboardPastPresidentsPage() {
  // yearId is the GLOBAL dashboard rotary year (driven by the shared top-bar year
  // selector). The listing filters on this — there is no page-local year dropdown.
  // Source it from the URL param FIRST: it updates atomically when the user
  // changes year and is present on load, whereas the cache's yearId is briefly
  // null while the cache resets to EMPTY_STATE + refetches — which used to flash
  // the full (unfiltered) list before snapping to the year. Fall back to the
  // cache value only when the URL hasn't carried the param yet.
  const { overview, yearId: cacheYearId } = useClubAdminCache();
  const searchParams = useSearchParams();
  const urlYearRaw = searchParams.get("yearId");
  const urlYear = urlYearRaw ? parseInt(urlYearRaw, 10) || null : null;
  const effectiveYear = urlYear ?? cacheYearId;
  const { selectedClubId, loading: authLoading } = useAuth();
  // Use selectedClubId from auth as the primary source so this page fires its
  // own fast query immediately, instead of waiting for the 9-endpoint dashboard
  // cache batch (Promise.allSettled) to settle. Fall back to the cached overview.
  const clubId = selectedClubId ?? overview?.club?.clubId ?? null;

  const [rows, setRows] = useState<PastPresident[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PastPresident | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      setRows(await getPastPresidents(clubId));
    } catch {
      setErrorMessage("Failed to load past presidents.");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // The full history is the useful default here, so we show every year on load and
  // only filter once the user actually picks a year from the global selector.
  // "Picked" can't be inferred from the year having a value — it always does, on
  // load too. So we remember the year we arrived with and latch once it changes;
  // the latch stays on afterwards, so re-picking the arrival year still filters
  // rather than snapping back to all-years.
  const arrivalYearRef = useRef<number | null>(null);
  const [yearPicked, setYearPicked] = useState(false);
  useEffect(() => {
    if (effectiveYear == null) return;
    if (arrivalYearRef.current === null) {
      arrivalYearRef.current = effectiveYear;
      return;
    }
    if (effectiveYear !== arrivalYearRef.current) setYearPicked(true);
  }, [effectiveYear]);

  const showAllYears = !yearPicked;
  // Label for the picked year. Sourced from the rows themselves, so a year with no
  // records has no label to show — fall back to generic wording rather than a blank.
  const selectedYearLabel =
    rows.find((r) => r.yearId === effectiveYear)?.yearLabel ?? "Selected year";
  const filtered = useMemo(() => {
    const base = showAllYears || effectiveYear == null
      ? rows
      : rows.filter((r) => r.yearId === effectiveYear);
    return [...base].sort((a, b) => (b.yearLabel || "").localeCompare(a.yearLabel || ""));
  }, [rows, effectiveYear, showAllYears]);

  const handleDelete = async () => {
    if (!deleteTarget || !clubId) return;
    try {
      await deletePastPresident(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Past President deleted.");
      load();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  // Only block on THIS page's own fetch — not the heavy dashboard cache batch.
  // Also hold the loader while auth is still hydrating clubId (avoids a flash of
  // "No club selected" before selectedClubId is restored from storage). No need to
  // wait on the year any more: all-years IS the load state, so there is nothing to
  // snap from once the year resolves.
  if (authLoading || (clubId && loading && rows.length === 0)) {
    return <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" label="Loading Past Presidents…" /></div>;
  }
  if (!clubId) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">No club selected.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Past Presidents</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Club leadership history · {showAllYears ? "All years" : selectedYearLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/clubs/${clubId}/past-presidents/v2/add?returnTo=${encodeURIComponent(RETURN_TO)}`}
            className="inline-flex items-center gap-1.5 h-9 text-xs font-semibold px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Plus size={13} /> Add Past President
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard
          title="Past Presidents"
          value={fmtInt(filtered.length)}
          subtitle={showAllYears ? "All years" : selectedYearLabel}
          icon={Award}
          color="gold"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-slate-500">
            <Award className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            {rows.length > 0 ? (
              <>
                <p className="text-sm font-medium text-slate-700">No past presidents for {selectedYearLabel}</p>
                <p className="text-xs text-slate-500 mt-1">Change the year above to see other records.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">No past presidents yet</p>
                <p className="text-xs text-slate-500 mt-1">Click &quot;Add Past President&quot; to create one.</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left w-14">#</th>
                  <th className="px-4 py-2.5 text-left w-16">Photo</th>
                  <th className="px-4 py-2.5 text-left">Name</th>
                  <th className="px-4 py-2.5 text-left">Rotary Year</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, i) => {
                  const photoUrl = getPhotoUrl(r.profilePhotoPath);
                  return (
                    <tr key={r.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        {photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                            {r.memberName?.charAt(0)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <span>{r.memberName}</span>
                          <span
                            className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${
                              r.isMember ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {r.isMember ? "Member" : "Non-Member"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{r.yearLabel}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/clubs/${clubId}/past-presidents/v2/${r.id}/edit?returnTo=${encodeURIComponent(RETURN_TO)}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                          >
                            <Edit3 className="h-3.5 w-3.5" />Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Past President"
        description={<>Delete <span className="font-semibold text-foreground">{deleteTarget?.memberName}</span> ({deleteTarget?.yearLabel})? This cannot be undone.</>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
