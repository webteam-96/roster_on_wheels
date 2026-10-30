"use client";

/**
 * Social Media Links v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Club Admin Dashboard listing modules
 * (KPI tiles, colored platform chips, dense table). All data still comes
 * from the existing v1 endpoints (getClubSocialLinks + getClub +
 * deleteClubSocialLink + reorderClubSocialLinksAll).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Share2, CheckCircle2, EyeOff, Link2, Loader2, Search, Plus, Edit3, Trash2,
  ArrowLeft, AlertTriangle, Download, GripVertical, ExternalLink,
} from "@/components/icons";
import {
  getClub,
  getClubSocialLinks,
  deleteClubSocialLink,
  reorderClubSocialLinksAll,
} from "@/services/api";
import { ClubSocialLink, SOCIAL_PLATFORMS } from "@/types/socialLink";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

function getPlatformLabel(value: string): string {
  return SOCIAL_PLATFORMS.find((p) => p.value === value)?.label || value;
}

function platformChipStyle(platform: string): string {
  switch (platform) {
    case "facebook":   return "bg-blue-50 text-blue-700 border-blue-200";
    case "instagram":  return "bg-pink-50 text-pink-700 border-pink-200";
    case "twitter":    return "bg-slate-100 text-slate-800 border-slate-200";
    case "linkedin":   return "bg-sky-50 text-sky-700 border-sky-200";
    case "youtube":    return "bg-rose-50 text-rose-700 border-rose-200";
    case "telegram":   return "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "pinterest":  return "bg-red-50 text-red-700 border-red-200";
    case "threads":    return "bg-zinc-100 text-zinc-800 border-zinc-200";
    case "googleplus": return "bg-orange-50 text-orange-700 border-orange-200";
    case "website":    return "bg-indigo-50 text-indigo-700 border-indigo-200";
    default:           return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function platformIconBg(platform: string): string {
  const map: Record<string, string> = {
    facebook: "bg-blue-600",
    instagram: "bg-[#A9C6EA]",
    twitter: "bg-black",
    linkedin: "bg-blue-700",
    youtube: "bg-red-600",
    telegram: "bg-sky-500",
    pinterest: "bg-red-700",
    threads: "bg-black",
    googleplus: "bg-red-500",
    website: "bg-slate-600",
  };
  return map[platform] || "bg-slate-500";
}

function exportToCsv(rows: ClubSocialLink[], clubName: string) {
  const header = ["Sr", "Platform", "Link URL", "Status"];
  const lines = rows.map((r, i) => [
    i + 1,
    `"${getPlatformLabel(r.platform).replace(/"/g, '""')}"`,
    `"${(r.linkUrl || "").replace(/"/g, '""')}"`,
    r.isActive ? "Active" : "Inactive",
  ].join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `social-media-links-${clubName.replace(/\s+/g, "-").toLowerCase()}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ensureHttp(url: string): string {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function SocialMediaLinksV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [records, setRecords] = useState<ClubSocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ClubSocialLink | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/website-data/social_media_links/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Back arrow honors parent returnTo (e.g. /club-admin-dashboard/my-club-website).
  const backHref = parentReturnTo || `/clubs/${clubId}/website-data`;

  const addUrl = `/clubs/${clubId}/website-data/social_media_links/v2/add?returnTo=${returnTo}`;

  // Drag-and-drop reorder — disabled while a search filter is active.
  const { dragProps } = useDragSort(records, setRecords, async (ids) => {
    try { await reorderClubSocialLinksAll(clubId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchRecords(); }
  });

  const fetchRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const data = await getClubSocialLinks(clubId);
      setRecords(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load social links.");
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    // Guard: useParams() can briefly yield an empty object during client-side
    // navigation/hydration, making clubId = NaN. Skip the fetch in that case;
    // the effect will re-run once params.id is populated.
    if (!Number.isFinite(clubId)) return;
    let cancelled = false;
    async function init() {
      // Fetch club name and records independently — a transient failure on
      // getClub (e.g. a 403 from the kill-switch check) must NOT prevent the
      // records from loading, or the listing would stay empty even though
      // the data exists.
      try {
        const club = await getClub(clubId);
        if (!cancelled) setClubName(club.clubName);
      } catch {
        // ignore — clubName falls back to "—" in the header
      }
      if (cancelled) return;
      await fetchRecords();
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, fetchRecords]);

  const filtered = useMemo<ClubSocialLink[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      getPlatformLabel(r.platform).toLowerCase().includes(q) ||
      (r.linkUrl || "").toLowerCase().includes(q) ||
      (r.isActive ? "active" : "inactive").includes(q)
    );
  }, [records, search]);

  // KPI aggregates
  const totalLinks = records.length;
  const activeLinks = records.filter((r) => r.isActive).length;
  const inactiveLinks = records.filter((r) => !r.isActive).length;
  const uniquePlatforms = new Set(records.map((r) => r.platform)).size;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteClubSocialLink(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Social link deleted successfully.");
      await fetchRecords();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete social link.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Social Media Links"
        pageSubtitle="Public website social links"
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
              <h1 className="text-lg font-semibold text-slate-800">Social Media Links</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · public social-handle directory
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Links"      value={fmtInt(totalLinks)}       subtitle="All platforms"        icon={Link2}        color="blue" />
          <KpiCard title="Active"           value={fmtInt(activeLinks)}      subtitle="Visible on website"   icon={CheckCircle2} color="green" />
          <KpiCard title="Inactive"         value={fmtInt(inactiveLinks)}    subtitle="Hidden"               icon={EyeOff}       color="gold" />
          <KpiCard title="Unique Platforms" value={fmtInt(uniquePlatforms)}  subtitle="Distinct channels"    icon={Share2}       color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Social Media Links</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · shown on the public club website
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <button
                type="button"
                onClick={() => exportToCsv(filtered, clubName || "club")}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download size={13} /> Export to Excel
              </button>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Social Link
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading || loadingRecords ? (
              <SkeletonRows />
            ) : (
              <table className="w-full min-w-[640px] md:min-w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left w-12"></th>
                    <th className="px-3 py-2.5 text-left">Platform</th>
                    <th className="px-3 py-2.5 text-left">Link URL</th>
                    <th className="px-3 py-2.5 text-left w-24">Status</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {canManage && <th className="px-3 py-2.5 text-center w-16">Sort</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r, i) => {
                    const recordsIdx = records.findIndex((rec) => rec.id === r.id);
                    const dragEnabled = canManage && !search;
                    const label = getPlatformLabel(r.platform);
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className={`h-8 w-8 rounded-full ${platformIconBg(r.platform)} flex items-center justify-center text-white text-xs font-bold`}>
                            {label.charAt(0).toUpperCase()}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${platformChipStyle(r.platform)}`}>
                            {label}
                          </span>
                        </td>
                        <td className="px-3 py-2 max-w-xs">
                          <a
                            href={ensureHttp(r.linkUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs truncate"
                            title={r.linkUrl}
                          >
                            <span className="truncate">{r.linkUrl}</span>
                            <ExternalLink size={11} className="flex-shrink-0" />
                          </a>
                        </td>
                        <td className="px-3 py-2">
                          {r.isActive ? (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Inactive
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/website-data/social_media_links/v2/${r.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit social link"
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
                              aria-label="Delete social link"
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
                      <td colSpan={canManage ? 8 : 5} className="px-4 py-10 text-center text-slate-400">
                        {search
                          ? "No social links match your search."
                          : "No social media links added yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filtered.length} link{filtered.length === 1 ? "" : "s"}
            {records.length !== filtered.length && ` · filtered from ${records.length}`}
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Social Link"
          description={
            <>Are you sure you want to delete the{" "}
              <span className="font-semibold text-foreground">{deleteTarget ? getPlatformLabel(deleteTarget.platform) : ""}</span>{" "}
              link? This action cannot be undone.
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
