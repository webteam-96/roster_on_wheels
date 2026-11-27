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

import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Newspaper, FileText, Archive, Link2, Search, Plus, Edit3, Trash2, Download, ExternalLink, AlertTriangle } from "@/components/icons";
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
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
    : "bg-slate-50 text-slate-700 border-slate-200";
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
        <PageHeader title="Newsletters" description={<>RY {yearLabel} · {clubName || "–"}</>} back={backUrl} />

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
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Newsletter Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">Publications &amp; reading material · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={selectedYearId ?? ""}
                onChange={(e) => { setSelectedYearId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
                className="row-field-sm w-auto"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="row-field-sm w-auto"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="row-field-sm w-auto"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </NativeSelect>
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search title…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                  className="row-field-sm pl-7 pr-3 sm:w-48"
                />
              </div>
              <Button
                type="button"
                onClick={handleSearch}
                variant="outline" size="sm"
              >
                Search
              </Button>
              {(search || searchInput) && (
                <Button
                  type="button"
                  onClick={clearSearch}
                  variant="outline" size="sm"
                >
                  Clear
                </Button>
              )}
              {canManage && (
                <Link
                  href={addUrl}
                  className="row-btn row-btn-primary"
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
              <Table className="min-w-[640px] md:min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-10">Sr</TableHead>
                    <TableHead className="text-left">Title</TableHead>
                    <TableHead className="text-left w-20">Type</TableHead>
                    <TableHead className="text-left whitespace-nowrap">Publish Date</TableHead>
                    <TableHead className="text-left w-20">Year</TableHead>
                    <TableHead className="text-left w-24">Status</TableHead>
                    <TableHead className="text-center w-16">Open</TableHead>
                    {canManage && <TableHead className="text-right w-16">Edit</TableHead>}
                    {canManage && <TableHead className="text-right w-16">Delete</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((nl, i) => {
                    const isLink = nl.attachmentType === "link";
                    return (
                      <TableRow key={nl.id}>
                        <TableCell>{(page - 1) * pageSize + i + 1}</TableCell>
                        <TableCell className="font-medium">
                          {nl.title || "–"}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${typeChipStyle(nl.attachmentType)}`}>
                            {isLink ? <Link2 size={11} /> : <FileText size={11} />}
                            {isLink ? "Link" : "File"}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(nl.publishDateTime)}
                        </TableCell>
                        <TableCell>{yearLabel}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${statusChipStyle(nl.status)}`}>
                            {nl.status || "–"}
                          </span>
                          <div className="mt-1"><SendStatusBadges item={nl} /></div>
                        </TableCell>
                        <TableCell className="text-center">
                          {isLink && nl.linkUrl ? (
                            <a
                              href={nl.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="row-icon-btn w-7"
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
                              className="row-icon-btn w-7"
                              aria-label="Download file"
                            >
                              <Download size={13} />
                            </a>
                          ) : (
                            <span className="text-slate-300">–</span>
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            {nl.status !== "Expired" ? (
                              <Link
                                href={`/clubs/${clubId}/newsletters/v2/${nl.id}/edit?returnTo=${returnTo}`}
                                className="row-icon-btn w-7"
                                aria-label="Edit newsletter"
                              >
                                <Edit3 size={13} />
                              </Link>
                            ) : (
                              <span className="text-slate-300">–</span>
                            )}
                          </TableCell>
                        )}
                        {canManage && (
                          <TableCell className="text-right">
                            <IconButton
                              type="button"
                              onClick={() => setDeleteTarget(nl)}
                              className="hover:text-red-700 w-7"
                              aria-label="Delete newsletter"
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 10 : 8} className="py-10 text-center text-muted-foreground">
                        {search || statusFilter !== "all" || typeFilter !== "all"
                          ? "No newsletters match your filters."
                          : "No newsletters recorded for this year."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} newsletter{totalCount === 1 ? "" : "s"} · {yearLabel}
          </div>
        </Card>

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
