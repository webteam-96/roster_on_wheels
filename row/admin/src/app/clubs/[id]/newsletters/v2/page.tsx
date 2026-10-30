"use client";

/**
 * Newsletters v2 listing — frontend overhaul replacement for the v1 page.
 *
 * Data semantics are identical to v1: same APIs (getNewsletters,
 * deleteNewsletter, getNewsletterYears, getClub), same year-scoped paging,
 * same status filter values. Only the visual layer is new — KPI tiles,
 * type/status chips, dense table, sticky add bar.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Newspaper, FileText, Archive, Link2, Loader2, Search, Plus, Edit3, Trash2,
  Download, ExternalLink, ArrowLeft, AlertTriangle,
} from "@/components/icons";
import {
  getClub,
  getNewsletters,
  deleteNewsletter,
  getNewsletterYears,
} from "@/services/api";
import { NewsletterListItem } from "@/types/newsletter";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import SendStatusBadges from "@/components/SendStatusBadges";

import { appLocale } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const STATUS_OPTIONS = [
  { value: "all",         label: "All Status" },
  { value: "Published",   label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired",     label: "Expired" },
];

const TYPE_OPTIONS = [
  { value: "all",  label: "All Types" },
  { value: "file", label: "File" },
  { value: "link", label: "Link" },
];

function statusChipStyle(status: string): string {
  switch (status) {
    case "Published":   return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Unpublished": return "bg-amber-50 text-amber-700 border-amber-200";
    case "Expired":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:            return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function typeChipStyle(type: string): string {
  return type === "link"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
}

export default function NewslettersV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  // Two-hop returnTo chain: dashboard/OCV → listing → add/edit → listing → up.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → upstream caller.
  const inboundReturnTo = searchParams.get("returnTo");
  const urlYearId = searchParams.get("yearId");
  const parentReturnTo = inboundReturnTo || "";
  const listingQueryParts: string[] = [];
  if (urlYearId) listingQueryParts.push(`yearId=${urlYearId}`);
  if (parentReturnTo) listingQueryParts.push(`returnTo=${encodeURIComponent(parentReturnTo)}`);
  const myListingUrl = `/clubs/${clubId}/newsletters/v2${listingQueryParts.length ? `?${listingQueryParts.join("&")}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);
  // Back arrow honors inbound returnTo too; otherwise default to club dashboard.
  const backUrl = inboundReturnTo ? inboundReturnTo : `/clubs/${clubId}/dashboard`;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);

  const [newsletters, setNewsletters] = useState<NewsletterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Search box (uncommitted) vs committed search (sent to API on Enter / button).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [deleteTarget, setDeleteTarget] = useState<NewsletterListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const addUrl = `/clubs/${clubId}/newsletters/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, nlYears] = await Promise.all([
          getClub(clubId),
          getNewsletterYears(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(nlYears);
        // Honor inbound ?yearId= (deep-links from OCV/GOV) when valid; else default to current year.
        if (urlYearId && nlYears.some((y) => y.id === Number(urlYearId))) {
          setSelectedYearId(Number(urlYearId));
        } else {
          const current = nlYears.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : nlYears[0]?.id ?? null);
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
    // urlYearId is consumed once at mount; including it would re-trigger init when query string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const fetchNewsletters = useCallback(async () => {
    if (!selectedYearId) { setLoading(false); return; }
    setLoading(true);
    try {
      // v1 parity: server-side paging + status/search filters (no 500-record cap).
      const result = await getNewsletters(
        clubId, selectedYearId, page, pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined,
      );
      setNewsletters(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setNewsletters([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, selectedYearId, page, statusFilter, search]);

  useEffect(() => {
    fetchNewsletters();
  }, [fetchNewsletters]);

  // Status + search are filtered server-side (v1 parity). typeFilter is a v2-only
  // UI affordance that narrows the current page client-side.
  const filtered = useMemo<NewsletterListItem[]>(() => {
    return newsletters.filter((nl) => {
      if (typeFilter !== "all" && nl.attachmentType !== typeFilter) return false;
      return true;
    });
  }, [newsletters, typeFilter]);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // Aggregate KPIs: Total reflects the server year-total; breakdowns reflect the
  // currently loaded page (server-side paging + filters limit what we can sum here).
  const publishedCount = newsletters.filter((n) => n.status === "Published").length;
  const expiredCount   = newsletters.filter((n) => n.status === "Expired").length;
  const fileCount      = newsletters.filter((n) => n.attachmentType === "file").length;
  const linkCount      = newsletters.filter((n) => n.attachmentType === "link").length;
  const totalPages     = Math.ceil(totalCount / pageSize);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteNewsletter(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Newsletter deleted successfully.");
      fetchNewsletters();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete newsletter.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Newsletters"
        pageSubtitle="Club newsletters"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={backUrl}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Newsletters</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Newsletters"
            value={fmtInt(totalCount)}
            subtitle={`RY ${yearLabel}`}
            icon={Newspaper}
            color="blue"
          />
          <KpiCard
            title="Published"
            value={fmtInt(publishedCount)}
            subtitle="Currently live"
            icon={FileText}
            color="green"
          />
          <KpiCard
            title="Archive"
            value={fmtInt(expiredCount)}
            subtitle="Expired newsletters"
            icon={Archive}
            color="gold"
          />
          <KpiCard
            title="Files vs Links"
            value={`${fmtInt(fileCount)} / ${fmtInt(linkCount)}`}
            subtitle="File / Link split"
            icon={Link2}
            color="purple"
          />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Newsletter Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">Publications &amp; reading material · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedYearId ?? ""}
                onChange={(e) => { setSelectedYearId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search title…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                  className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              {(search || searchInput) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Newsletter
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <SkeletonRows />
            ) : (
              <table className="w-full min-w-[640px] md:min-w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left">Title</th>
                    <th className="px-3 py-2.5 text-left w-20">Type</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Publish Date</th>
                    <th className="px-3 py-2.5 text-left w-20">Year</th>
                    <th className="px-3 py-2.5 text-left w-24">Status</th>
                    <th className="px-3 py-2.5 text-center w-16">Open</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((nl, i) => {
                    const isLink = nl.attachmentType === "link";
                    return (
                      <tr key={nl.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {nl.title || "–"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${typeChipStyle(nl.attachmentType)}`}>
                            {isLink ? <Link2 size={11} /> : <FileText size={11} />}
                            {isLink ? "Link" : "File"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {formatDateTime(nl.publishDateTime)}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{yearLabel}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${statusChipStyle(nl.status)}`}>
                            {nl.status || "–"}
                          </span>
                          <div className="mt-1"><SendStatusBadges item={nl} /></div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isLink && nl.linkUrl ? (
                            <a
                              href={nl.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                              aria-label="Open link"
                            >
                              <ExternalLink size={13} />
                            </a>
                          ) : !isLink && nl.filePath ? (
                            <a
                              href={`${API_URL}${nl.filePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              download
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-violet-600 hover:text-violet-800 hover:bg-violet-50"
                              aria-label="Download file"
                            >
                              <Download size={13} />
                            </a>
                          ) : (
                            <span className="text-slate-300">, </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            {nl.status !== "Expired" ? (
                              <Link
                                href={`/clubs/${clubId}/newsletters/v2/${nl.id}/edit?returnTo=${returnTo}`}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                                aria-label="Edit newsletter"
                              >
                                <Edit3 size={13} />
                              </Link>
                            ) : (
                              <span className="text-slate-300">, </span>
                            )}
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(nl)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                              aria-label="Delete newsletter"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 10 : 8} className="px-4 py-10 text-center text-slate-400">
                        {search || statusFilter !== "all" || typeFilter !== "all"
                          ? "No newsletters match your filters."
                          : "No newsletters recorded for this year."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} newsletter{totalCount === 1 ? "" : "s"} · {yearLabel}
          </div>
        </div>

        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Newsletter"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This action cannot be undone.</>
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
