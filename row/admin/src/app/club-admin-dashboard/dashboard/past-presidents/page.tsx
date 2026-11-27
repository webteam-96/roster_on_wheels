"use client";

/**
 * Club Admin Dashboard · Past Presidents tab.
 * Listing (photo / name / year) with Add / Edit / Delete. Add & Edit deep-link to
 * the V2 form pages under /clubs/[id]/past-presidents/v2/(add|[id]/edit), carrying
 * a returnTo back to this tab. Delete uses deletePastPresident with a confirm.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Award, Plus, Edit3, Trash2, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { getPastPresidents, deletePastPresident, getPhotoUrl } from "@/services/api";
import type { PastPresident } from "@/types/pastPresident";
import { ListPageSkeleton } from "@/components/row/AppKit";

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
  const { selectedClubId, loading: authLoading, user, isSuperAdmin, isAdmin } = useAuth();
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

  // Each past president is filed under a Rotary year, and this page can show
  // ALL years at once — so the rule is per row, not per page.
  const yearRights = useMemo(
    () => clubYearRights(user?.scopedRoles, clubId ?? 0), [user?.scopedRoles, clubId]);
  const isClubAdmin = isSuperAdmin || isAdmin;
  const canEditRow = (yearId: number) => isClubAdmin && canEditYear(yearRights, yearId, isSuperAdmin);
  // Adding one defaults to the year on screen; in all-years mode there is no
  // single year to add into, so fall back to the current selection.
  const canAdd = isClubAdmin && canEditYear(yearRights, effectiveYear, isSuperAdmin);
  const editableYears = heldYearLabels(
    yearRights,
    [...new Map(rows.map((r) => [r.yearId, { id: r.yearId, label: r.yearLabel }])).values()],
  );
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
    return <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>;
  }
  if (!clubId) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">No club selected.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="row-h2">Past Presidents</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Club leadership history · {showAllYears ? "All years" : selectedYearLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAdd && (
          <Link
            href={`/clubs/${clubId}/past-presidents/v2/add?returnTo=${encodeURIComponent(RETURN_TO)}`}
            className="row-btn row-btn-primary row-btn-sm"
          >
            <Plus size={13} /> Add Past President
          </Link>
          )}
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

      <Card className="overflow-hidden">
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
            <Table className="w-full min-w-[640px] md:min-w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 text-left w-14">#</TableHead>
                  <TableHead className="px-4 text-left w-16">Photo</TableHead>
                  <TableHead className="px-4 text-left">Name</TableHead>
                  <TableHead className="px-4 text-left">Rotary Year</TableHead>
                  <TableHead className="px-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {filtered.map((r, i) => {
                  const photoUrl = getPhotoUrl(r.profilePhotoPath);
                  return (
                    <TableRow key={r.id} className="hover:bg-blue-50/40">
                      <TableCell className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</TableCell>
                      <TableCell className="px-4 py-2.5">
                        {photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                            {r.memberName?.charAt(0)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 font-medium text-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{r.memberName}</span>
                          <span
                            className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ${
                              r.isMember ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {r.isMember ? "Member" : "Non-Member"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-slate-600">{r.yearLabel}</TableCell>
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEditRow(r.yearId) && (
                            <Link
                              href={`/clubs/${clubId}/past-presidents/v2/${r.id}/edit?returnTo=${encodeURIComponent(RETURN_TO)}`}
                              className="row-btn row-btn-secondary row-btn-sm"
                            >
                              <Edit3 className="h-3.5 w-3.5" />Edit
                            </Link>
                          )}
                          <Button
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            variant="outline" size="sm" className="text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

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
