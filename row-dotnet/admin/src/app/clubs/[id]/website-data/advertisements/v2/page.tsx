"use client";

/**
 * Advertisements v2 listing — frontend overhaul module (Website Data).
 *
 * Visual pattern mirrors the Club Admin Dashboard listings (KPI tiles,
 * marketplace-style ad card grid, sticky header) but the data still comes
 * from the existing v1 endpoints:
 *   - getClubAdvertisements, getClubAdvertisementAvailableYears,
 *     updateClubAdvertisement (status toggle), deleteClubAdvertisement,
 *     reorderClubAdvertisementsAll, getClub, getPhotoUrl
 *
 * v2 reads ONLY `?returnTo=` — never any other param name. The Add and Edit
 * routes both pass the encoded current URL via `?returnTo=` so the form's
 * Cancel/Save returns the user here.
 *
 * Data semantics preserved verbatim from v1:
 *   - Year filter dropdown shows only years with data (data-only rule)
 *   - Max 10 active advertisements per year (status toggle respects this)
 *   - Drag-and-drop reorder is disabled while a search filter is active
 *   - Image and document upload happen inside the Add/Edit pages
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Megaphone, CheckCircle2, EyeOff, FileText as FileTextIcon, Loader2, Search, Plus,
  Edit3, Trash2, ArrowLeft, AlertTriangle, GripVertical, Image as ImageIcon,
  ExternalLink, Eye,
} from "lucide-react";
import {
  getClub,
  getClubAdvertisements,
  getClubAdvertisementAvailableYears,
  deleteClubAdvertisement,
  updateClubAdvertisement,
  reorderClubAdvertisementsAll,
  getPhotoUrl,
} from "@/services/api";
import { ClubAdvertisement } from "@/types/advertisement";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const MAX_ACTIVE = 10;

export default function AdvertisementsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  // Year now comes from the global topbar (?yearId= URL param). We still fetch
  // the available-year list so we can render its label and fall back to the
  // current year when the URL param is absent — but there is no local dropdown.
  const [dataYears, setDataYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;
  const currentYearFromList = dataYears.find((y) => y.isCurrent)?.id ?? dataYears[0]?.id ?? null;
  const selectedYearId = urlYearId ?? currentYearFromList;
  const [records, setRecords] = useState<ClubAdvertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ClubAdvertisement | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  // Preserve yearId through the two-hop chain so Add/Edit save comes back to
  // THIS listing on the SAME year.
  const listingQs: string[] = [];
  if (parentReturnTo) listingQs.push(`returnTo=${encodeURIComponent(parentReturnTo)}`);
  if (urlYearId) listingQs.push(`yearId=${urlYearId}`);
  const myListingUrl = `/clubs/${clubId}/website-data/advertisements/v2${listingQs.length ? `?${listingQs.join("&")}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Back arrow honors parent returnTo (e.g. /club-admin-dashboard/my-club-website).
  const backHref = parentReturnTo || `/clubs/${clubId}/website-data`;

  const addUrl = `/clubs/${clubId}/website-data/advertisements/v2/add?returnTo=${returnTo}`;

  // Drag & drop reorder — saved across ALL records of the year (v1 endpoint
  // `reorderClubAdvertisementsAll` rewrites every sort_order). Disabled while
  // a search filter is active, since reordering a filtered subset is wrong.
  const { dragProps } = useDragSort(records, setRecords, async (ids) => {
    try { await reorderClubAdvertisementsAll(clubId, ids); }
    catch { setErrorMessage("Failed to save order."); if (selectedYearId) fetchRecords(selectedYearId); }
  });

  useEffect(() => {
    // Guard: useParams() can briefly yield an empty object during client-side
    // navigation/hydration, making clubId = NaN. Skip the fetch in that case;
    // the effect will re-run once params.id is populated.
    if (!Number.isFinite(clubId)) return;
    let cancelled = false;
    async function init() {
      // Run club + years independently — a transient failure on getClub (e.g.
      // a 403 from the kill-switch check) should NOT block the year list and
      // record fetch, otherwise the listing stays empty and KPIs show 0.
      const [clubRes, dyearsRes] = await Promise.allSettled([
        getClub(clubId),
        getClubAdvertisementAvailableYears(clubId),
      ]);
      if (cancelled) return;

      if (clubRes.status === "fulfilled") {
        setClubName(clubRes.value.clubName);
      }

      if (dyearsRes.status === "fulfilled") {
        setDataYears(dyearsRes.value);
      } else {
        const e = dyearsRes.reason as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load year list.");
      }
      setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchRecords = useCallback(async (yearId: number) => {
    setLoadingRecords(true);
    try {
      const ads = await getClubAdvertisements(clubId, yearId);
      setRecords(ads);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load advertisements.");
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) fetchRecords(selectedYearId);
    else setRecords([]);
  }, [selectedYearId, fetchRecords]);

  // After delete, refresh year list; the URL param stays in the driver's seat.
  const refreshAfterMutation = async () => {
    try {
      const dyears = await getClubAdvertisementAvailableYears(clubId);
      setDataYears(dyears);
      if (selectedYearId) fetchRecords(selectedYearId);
      else setRecords([]);
    } catch {
      // ignore — listing will refresh on next year change
    }
  };

  const filtered = useMemo<ClubAdvertisement[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      (r.description || "").toLowerCase().includes(q) ||
      (r.isActive ? "active" : "inactive").includes(q),
    );
  }, [records, search]);

  const yearLabel = dataYears.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";

  // Aggregate KPIs for the current year's records.
  const totalAds = records.length;
  const activeCount = records.filter((r) => r.isActive).length;
  const inactiveCount = totalAds - activeCount;
  const withDocs = records.filter((r) => !!r.documentPath).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteClubAdvertisement(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Advertisement deleted successfully.");
      await refreshAfterMutation();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete advertisement.");
    }
  };

  const handleToggleActive = async (ad: ClubAdvertisement) => {
    if (!ad.isActive && activeCount >= MAX_ACTIVE) {
      setErrorMessage(`Maximum ${MAX_ACTIVE} active advertisements allowed per year.`);
      return;
    }
    try {
      await updateClubAdvertisement(clubId, ad.id, {
        advertisementImagePath: ad.advertisementImagePath,
        documentPath: ad.documentPath || undefined,
        description: ad.description,
        sortOrder: ad.sortOrder,
        isActive: !ad.isActive,
      });
      setSuccessMessage(ad.isActive ? "Advertisement deactivated." : "Advertisement activated.");
      if (selectedYearId) fetchRecords(selectedYearId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update advertisement status.");
    }
  };

  const handleViewDocument = (docPath: string) => {
    const url = getPhotoUrl(docPath);
    if (url) window.open(url, "_blank");
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Advertisements"
        pageSubtitle="Public website advertisements"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Advertisements</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Ads"          value={fmtInt(totalAds)}      subtitle={`RY ${yearLabel}`}      icon={Megaphone}    color="blue" />
          <KpiCard title="Active"             value={`${activeCount}/${MAX_ACTIVE}`} subtitle="Live on website"        icon={CheckCircle2} color="green" />
          <KpiCard title="Inactive"           value={fmtInt(inactiveCount)} subtitle="Hidden from public"     icon={EyeOff}       color="gold" />
          <KpiCard title="With Document"      value={fmtInt(withDocs)}      subtitle="Attached PDF / file"    icon={FileTextIcon} color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Advertisement Area</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sponsored banners and ads shown on the club website
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus size={13} /> Add Advertisement
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading || loadingRecords ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading advertisements…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left w-20">Banner</th>
                    <th className="px-3 py-2.5 text-left">Description</th>
                    <th className="px-3 py-2.5 text-left w-24">Document</th>
                    <th className="px-3 py-2.5 text-left w-24">Status</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Toggle</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {canManage && <th className="px-3 py-2.5 text-center w-16">Sort</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r, i) => {
                    const photoUrl = getPhotoUrl(r.advertisementImagePath);
                    const recordsIdx = records.findIndex((rec) => rec.id === r.id);
                    const dragEnabled = canManage && !search;
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="relative h-10 w-16 overflow-hidden rounded bg-slate-100">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={r.description || "Advertisement"} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-slate-400">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.description ? (
                            <span className="line-clamp-2">{r.description}</span>
                          ) : (
                            <span className="text-slate-400 italic">No description</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.documentPath ? (
                            <button
                              type="button"
                              onClick={() => handleViewDocument(r.documentPath!)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                            >
                              <ExternalLink size={12} /> View
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                            r.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-50 text-slate-500 border-slate-200"
                          }`}>
                            {r.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(r)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                              aria-label={r.isActive ? "Deactivate advertisement" : "Activate advertisement"}
                              title={r.isActive ? "Deactivate" : "Activate"}
                            >
                              {r.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/website-data/advertisements/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit advertisement"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(r)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                              aria-label="Delete advertisement"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                        {canManage && (
                          <td
                            className="px-3 py-2 text-center"
                            title={dragEnabled ? "Drag to reorder" : "Clear search to enable reorder"}
                            {...(dragEnabled ? dragProps(recordsIdx) : {})}
                          >
                            <GripVertical className={`h-4 w-4 inline-block ${dragEnabled ? "text-slate-400 cursor-grab" : "text-slate-300 cursor-not-allowed"}`} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 9 : 5} className="px-4 py-10 text-center text-slate-400">
                        {search
                          ? "No advertisements match your search."
                          : dataYears.length === 0
                            ? "No advertisements recorded yet."
                            : "No advertisements for the selected year."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {filtered.length} advertisement{filtered.length === 1 ? "" : "s"} · {yearLabel}
            </span>
            <span className={activeCount >= MAX_ACTIVE ? "text-rose-600 font-medium" : ""}>
              {activeCount}/{MAX_ACTIVE} active
            </span>
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Advertisement"
          description={
            <>
              Are you sure you want to delete this advertisement
              {deleteTarget?.description ? (
                <> &mdash; <span className="font-semibold text-foreground">{deleteTarget.description}</span></>
              ) : null}
              ? This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
