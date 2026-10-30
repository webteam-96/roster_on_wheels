"use client";

/**
 * Documents v2 listing — frontend overhaul.
 *
 * Visuals mimic the Club Admin Dashboard tabs (KPI tiles, access-type chip
 * styled like marketplace badges, dense table). The data still comes from the
 * existing v1 API endpoints (getDocuments, deleteDocument).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FileText, ShieldCheck, Eye, Download, Loader2, Search, Plus, Edit3, Trash2,
  ArrowLeft, AlertTriangle,
} from "@/components/icons";
import {
  getClub,
  getDocuments,
  deleteDocument,
} from "@/services/api";
import { DocumentListItem } from "@/types/document";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
function fmtDateTime(s?: string | null): string {
  if (!s) return "–";
  try {
    const d = new Date(s);
    return d.toLocaleString(appLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const STATUS_OPTIONS = [
  { value: "all",         label: "All Status" },
  { value: "Published",   label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired",     label: "Expired" },
];

const ACCESS_OPTIONS = [
  { value: "all",          label: "All Access" },
  { value: "view_only",    label: "View Only" },
  { value: "downloadable", label: "Downloadable" },
];

function accessChipStyle(accessType: string): string {
  return accessType === "view_only"
    ? "bg-orange-50 text-orange-700 border-orange-200"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function statusChipStyle(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "published":   return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unpublished": return "bg-amber-50 text-amber-700 border-amber-200";
    case "expired":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:            return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function isActiveNow(d: DocumentListItem): boolean {
  const now = Date.now();
  const pub = d.publishDateTime ? new Date(d.publishDateTime).getTime() : null;
  const exp = d.expiryDateTime ? new Date(d.expiryDateTime).getTime() : null;
  if (pub == null || exp == null) return false;
  return pub <= now && exp >= now;
}

export default function DocumentsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [statusFilter, setStatusFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/documents/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/documents/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const club = await getClub(clubId);
        if (cancelled) return;
        setClubName(club.clubName);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      // Server-side pagination + status/search filtering (v1 parity).
      // accessFilter remains client-side over the current page.
      const result = await getDocuments(
        clubId,
        page,
        pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined
      );
      setDocuments(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setDocuments([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, statusFilter, search]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // status + search are server-side; accessFilter is client-side over the current page.
  const filtered = useMemo<DocumentListItem[]>(() => {
    if (accessFilter === "all") return documents;
    return documents.filter((d) => d.accessType === accessFilter);
  }, [documents, accessFilter]);

  // KPIs: Total comes from server total; the breakdowns reflect the current page.
  const totalDocs = totalCount;
  const activeCount = documents.filter(isActiveNow).length;
  const viewOnlyCount = documents.filter((d) => d.accessType === "view_only").length;
  const downloadableCount = documents.filter((d) => d.accessType === "downloadable").length;

  const totalPages = Math.ceil(totalCount / pageSize);

  // Reset to page 1 whenever the server-side filters change.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDocument(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Document deleted successfully.");
      fetchDocuments();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete document.");
    }
  };

  const triggerDownload = async (doc: DocumentListItem) => {
    if (!doc.filePath) return;
    try {
      const res = await fetch(`${API_URL}${doc.filePath}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.originalFileName || doc.title || "document";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_URL}${doc.filePath}`, "_blank");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Documents"
        pageSubtitle="Club document repository"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={`/clubs/${clubId}/dashboard`}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Documents</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Constitution, bylaws, forms &amp; attachments · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Documents" value={fmtInt(totalDocs)}         subtitle="All uploads"                  icon={FileText}    color="blue" />
          <KpiCard title="Active"          value={fmtInt(activeCount)}       subtitle="On this page"                 icon={ShieldCheck} color="green" />
          <KpiCard title="View Only"       value={fmtInt(viewOnlyCount)}     subtitle="On this page"                 icon={Eye}         color="gold" />
          <KpiCard title="Downloadable"    value={fmtInt(downloadableCount)} subtitle="On this page"                 icon={Download}    color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Document Library</h3>
              <p className="text-xs text-slate-500 mt-0.5">Filter by status &amp; access type · search across titles &amp; filenames</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select
                value={accessFilter}
                onChange={(e) => setAccessFilter(e.target.value)}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                {ACCESS_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
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
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Document
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
                    <th className="px-3 py-2.5 text-left">Access Type</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-left">Publish Date &amp; Time</th>
                    <th className="px-3 py-2.5 text-left">Expiry Date &amp; Time</th>
                    <th className="px-3 py-2.5 text-center w-16">Download</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((d, i) => (
                    <tr key={d.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        <div className="flex flex-col">
                          <span>{d.title || "–"}</span>
                          {d.originalFileName && (
                            <span className="text-xs text-slate-400 truncate max-w-[280px]">{d.originalFileName}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${accessChipStyle(d.accessType)}`}>
                          {d.accessType === "view_only" ? "View Only" : "Downloadable"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${statusChipStyle(d.status)}`}>
                          {d.status || "–"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDateTime(d.publishDateTime)}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDateTime(d.expiryDateTime)}</td>
                      <td className="px-3 py-2 text-center">
                        {d.filePath ? (
                          d.accessType === "downloadable" ? (
                            <button
                              type="button"
                              onClick={() => triggerDownload(d)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                              aria-label="Download document"
                            >
                              <Download size={13} />
                            </button>
                          ) : (
                            <a
                              href={`${API_URL}${d.filePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="View document"
                            >
                              <Eye size={13} />
                            </a>
                          )
                        ) : (
                          <span className="text-slate-300">, </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          {d.status !== "Expired" ? (
                            <Link
                              href={`/clubs/${clubId}/documents/v2/${d.id}/edit?returnTo=${returnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit document"
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
                            onClick={() => setDeleteTarget(d)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            aria-label="Delete document"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 9 : 7} className="px-4 py-10 text-center text-slate-400">
                        {search || statusFilter !== "all" || accessFilter !== "all"
                          ? "No documents match your filters."
                          : "No documents uploaded yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {accessFilter !== "all"
              ? <>Showing {filtered.length} of {documents.length} on this page · {totalCount} total</>
              : <>Showing {documents.length} of {totalCount}</>}
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
          title="Delete Document"
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
