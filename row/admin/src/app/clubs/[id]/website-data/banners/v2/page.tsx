"use client";

/**
 * Banner Photos v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Club Admin Dashboard listings (KPI tiles, colored
 * chips, dense table) but the data still comes from the existing v1 endpoints
 * (getClubBanners + getClubBannerAvailableYears + updateClubBanner +
 *  deleteClubBanner + reorderClubBannersAll + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ImageIcon, CheckCircle2, EyeOff, Loader2, Search, Plus,
  Edit3, Trash2, ArrowLeft, AlertTriangle, GripVertical, Eye,
} from "lucide-react";
import {
  getClub,
  getClubBanners,
  getClubBannerAvailableYears,
  deleteClubBanner,
  updateClubBanner,
  reorderClubBannersAll,
  getPhotoUrl,
} from "@/services/api";
import { ClubBanner } from "@/types/banner";
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

const MAX_ACTIVE = 6;

function statusChipStyle(isActive: boolean): string {
  return isActive
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-50 text-slate-500 border-slate-200";
}

export default function BannerPhotosV2Page() {
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
  const [filterYears, setFilterYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;
  const currentYearFromList = filterYears.find((y) => y.isCurrent)?.id ?? filterYears[0]?.id ?? null;
  const selectedYearId = urlYearId ?? currentYearFromList;
  const [records, setRecords] = useState<ClubBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ClubBanner | null>(null);
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
  const myListingUrl = `/clubs/${clubId}/website-data/banners/v2${listingQs.length ? `?${listingQs.join("&")}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Back arrow honors parent returnTo (e.g. /club-admin-dashboard/my-club-website)
  // so users land back on the upstream dashboard tab instead of the legacy hub.
  const backHref = parentReturnTo || `/clubs/${clubId}/website-data`;

  const addUrl = `/clubs/${clubId}/website-data/banners/v2/add?returnTo=${returnTo}`;

  // Drag & drop reorder — disabled while a search filter is active (would reorder filtered subset only)
  const { dragProps } = useDragSort(records, setRecords, async (ids) => {
    try { await reorderClubBannersAll(clubId, ids); }
    catch { setErrorMessage("Failed to save order."); }
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
        getClubBannerAvailableYears(clubId),
      ]);
      if (cancelled) return;

      if (clubRes.status === "fulfilled") {
        setClubName(clubRes.value.clubName);
      }

      if (dyearsRes.status === "fulfilled") {
        setFilterYears(dyearsRes.value);
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
      const data = await getClubBanners(clubId, yearId);
      setRecords(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load banners.");
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) {
      fetchRecords(selectedYearId);
    } else {
      setRecords([]);
    }
  }, [selectedYearId, fetchRecords]);

  const filtered = useMemo<ClubBanner[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      (r.description || "").toLowerCase().includes(q) ||
      (r.isActive ? "active" : "inactive").includes(q)
    );
  }, [records, search]);

  const yearLabel = filterYears.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";

  // Aggregate KPIs from the current year's records.
  const totalBanners = records.length;
  const activeBanners = records.filter((r) => r.isActive).length;
  const inactiveBanners = totalBanners - activeBanners;

  const refreshAfterChange = async () => {
    try {
      const dyears = await getClubBannerAvailableYears(clubId);
      setFilterYears(dyears);
      if (selectedYearId) fetchRecords(selectedYearId);
      else setRecords([]);
    } catch {
      // ignore — listing will refresh on next year change
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteClubBanner(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Banner deleted successfully.");
      await refreshAfterChange();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete banner.");
    }
  };

  const handleToggleActive = async (banner: ClubBanner) => {
    if (!banner.isActive && activeBanners >= MAX_ACTIVE) {
      setErrorMessage(`Maximum ${MAX_ACTIVE} active banners allowed per year.`);
      return;
    }
    try {
      await updateClubBanner(clubId, banner.id, {
        bannerImagePath: banner.bannerImagePath,
        description: banner.description,
        sortOrder: banner.sortOrder,
        isActive: !banner.isActive,
      });
      setSuccessMessage(banner.isActive ? "Banner deactivated." : "Banner activated.");
      if (selectedYearId) fetchRecords(selectedYearId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update banner status.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Banners"
        pageSubtitle="Public website banners"
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
              <h1 className="text-lg font-semibold text-slate-800">Banner Photos</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Total Banners"   value={fmtInt(totalBanners)}    subtitle={`RY ${yearLabel}`}      icon={ImageIcon}    color="blue" />
          <KpiCard title="Active"          value={`${fmtInt(activeBanners)}/${MAX_ACTIVE}`} subtitle="Shown on website" icon={CheckCircle2} color="green" />
          <KpiCard title="Inactive"        value={fmtInt(inactiveBanners)} subtitle="Hidden / draft"        icon={EyeOff}       color="gold" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Banner Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "—"} · website banner photos
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
                  <Plus size={13} /> Add Banner
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading || loadingRecords ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading banners…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left w-24">Thumbnail</th>
                    <th className="px-3 py-2.5 text-left">Description</th>
                    <th className="px-3 py-2.5 text-left w-24">Status</th>
                    {canManage && <th className="px-3 py-2.5 text-center w-20">Toggle</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {canManage && <th className="px-3 py-2.5 text-center w-16">Sort</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r, i) => {
                    const photoUrl = getPhotoUrl(r.bannerImagePath);
                    const recordsIdx = records.findIndex((rec) => rec.id === r.id);
                    const dragEnabled = canManage && !search;
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="relative h-10 w-20 overflow-hidden rounded bg-slate-100 border border-slate-200">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={r.description || "Banner"} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-blue-50 text-blue-600">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.description ? (
                            <span className="line-clamp-2 max-w-md">{r.description}</span>
                          ) : (
                            <span className="text-slate-400 italic">No description</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${statusChipStyle(r.isActive)}`}>
                            {r.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(r)}
                              title={r.isActive ? "Deactivate" : "Activate"}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                              aria-label={r.isActive ? "Deactivate banner" : "Activate banner"}
                            >
                              {r.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/website-data/banners/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit banner"
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
                              aria-label="Delete banner"
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
                      <td colSpan={canManage ? 8 : 4} className="px-4 py-10 text-center text-slate-400">
                        {search
                          ? "No banners match your search."
                          : filterYears.length === 0
                            ? "No banners recorded yet."
                            : "No banners for the selected year."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filtered.length} banner{filtered.length === 1 ? "" : "s"} · {yearLabel}
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Banner"
          description={
            <>
              Are you sure you want to delete this banner
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
