"use client";

/**
 * Attendance v2 listing — meeting / event attendance records.
 *
 * Visuals mirror the Club Admin Dashboard's Club Service tab (KPI tiles,
 * dense table, color-coded % chips). Data still comes from the existing v1
 * API endpoints (getAttendanceList + getAttendanceYears + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays, Users, Activity, Loader2, Search, Plus, Edit3, Trash2,
  Download, ArrowLeft, AlertTriangle, Layers, ChevronLeft, ChevronRight,
} from "@/components/icons";
import {
  getClub,
  getAttendanceList,
  getAttendanceYears,
  deleteAttendance,
} from "@/services/api";
import { AttendanceListItem } from "@/types/attendance";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
function attendancePercentChip(pct: number): string {
  if (pct >= 75) return "bg-emerald-100 text-emerald-700";
  if (pct >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

/** Derive a meeting-type label from the record's mix of attendee counts. */
function deriveEventType(item: AttendanceListItem): { label: string; cls: string } {
  const { membersCount, visitorsCount, rotariansCount, delegatesCount } = item;
  if (delegatesCount > 0) return { label: "District",     cls: "bg-rose-50 text-rose-700 border-rose-200" };
  if (rotariansCount > 0) return { label: "Inter-Club",   cls: "bg-violet-50 text-violet-700 border-violet-200" };
  if (visitorsCount  > 0) return { label: "Open Event",   cls: "bg-amber-50 text-amber-700 border-amber-200" };
  if (membersCount   > 0) return { label: "Members",      cls: "bg-blue-50 text-blue-700 border-blue-200" };
  return                        { label: "Event",         cls: "bg-slate-50 text-slate-700 border-slate-200" };
}

function totalAttendees(item: AttendanceListItem): number {
  return (item.membersCount || 0)
       + (item.annsCount     || 0)
       + (item.annetsCount   || 0)
       + (item.visitorsCount || 0)
       + (item.rotariansCount|| 0)
       + (item.delegatesCount|| 0);
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "–";
  try {
    return new Date(dateStr).toLocaleString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function exportToCsv(rows: AttendanceListItem[], yearLabel: string, clubName: string, memberCount: number) {
  const header = ["Sr", "Event Name", "Event Date", "Members", "Anns", "Annets", "Visitors", "Rotarians", "Delegates", "Total", "Attendance %"];
  const lines = rows.map((r, i) => {
    const total = totalAttendees(r);
    const pct = memberCount > 0 ? Math.round((r.membersCount / memberCount) * 100) : 0;
    return [
      i + 1,
      `"${(r.eventName || "").replace(/"/g, '""')}"`,
      `"${formatDateTime(r.eventDateTime)}"`,
      r.membersCount,
      r.annsCount,
      r.annetsCount,
      r.visitorsCount,
      r.rotariansCount,
      r.delegatesCount,
      total,
      pct,
    ].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 20;

// Named export — embeddable view (see ocv-gov/v2 for the rationale). The route's
// prop-less default export is below.
export function AttendanceV2View({ clubId: propClubId, embedded = false }: { clubId?: number; embedded?: boolean } = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [records, setRecords] = useState<AttendanceListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Year-wide aggregate for KPIs (independent of current page / search).
  const [yearTotalRecords, setYearTotalRecords] = useState(0);
  const [yearAttendees, setYearAttendees] = useState(0);
  const [yearAvgAttPct, setYearAvgAttPct] = useState(0);
  // "This Year" tile reads across ALL years, so it stays correct when viewing a past year.
  const [currentYearCount, setCurrentYearCount] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<AttendanceListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // Child Add/Edit pages get returnTo = the listing URL (with the listing's own
  // returnTo nested inside). Save → back to listing. Back on listing → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/attendance/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const childReturnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/attendance/v2/add?returnTo=${childReturnTo}`;

  // Read the global yearId from URL — set by the dashboard topbar selector.
  // When absent (page opened directly), fall back to current rotary year.
  const urlYearStr = searchParams.get("yearId");
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, attYears] = await Promise.all([getClub(clubId), getAttendanceYears(clubId)]);
        if (cancelled) return;
        setClubName(club.clubName);
        setMemberCount(club.totalMembers || 0);
        setYears(attYears);
        // Prefer URL yearId from the global topbar selector; fall back to current.
        if (urlYearId && attYears.some((y) => y.id === urlYearId)) {
          setSelectedYearId(urlYearId);
        } else {
          const current = attYears.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : attYears[0]?.id ?? null);
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) {
          setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
          setLoading(false);
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  // React to global topbar year change — pick up the new ?yearId= without a
  // full reload. Only applies once the years list has loaded.
  useEffect(() => {
    if (!urlYearId || years.length === 0) return;
    if (urlYearId === selectedYearId) return;
    if (years.some((y) => y.id === urlYearId)) {
      setSelectedYearId(urlYearId);
      setPage(1);
    }
  }, [urlYearId, years, selectedYearId]);

  const fetchRecords = useCallback(async () => {
    if (!selectedYearId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Backend pagination + backend search (v1 parity — clubs may have 500+ records).
      const result = await getAttendanceList(
        clubId, selectedYearId, page, PAGE_SIZE,
        search || undefined,
      );
      setRecords(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setRecords([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, selectedYearId, page, search]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Year-wide KPI aggregate: fetch the full year unfiltered so the KPI tiles reflect
  // the whole year, not just the current paginated/search-filtered slice.
  useEffect(() => {
    let cancelled = false;
    async function loadYearAgg() {
      if (!selectedYearId) {
        setYearTotalRecords(0);
        setYearAttendees(0);
        setYearAvgAttPct(0);
        return;
      }
      try {
        const result = await getAttendanceList(clubId, selectedYearId, 1, 10000, undefined);
        if (cancelled) return;
        const items = result.items || [];
        setYearTotalRecords(result.totalCount ?? items.length);
        setYearAttendees(items.reduce((sum, r) => sum + totalAttendees(r), 0));
        setYearAvgAttPct(
          memberCount > 0 && items.length > 0
            ? Math.round(items.reduce((sum, r) => sum + (r.membersCount / memberCount) * 100, 0) / items.length)
            : 0,
        );
      } catch {
        if (!cancelled) {
          setYearTotalRecords(0);
          setYearAttendees(0);
          setYearAvgAttPct(0);
        }
      }
    }
    loadYearAgg();
    return () => { cancelled = true; };
  }, [clubId, selectedYearId, memberCount]);

  // "This Year" tile: count of records whose event date falls in the current RY,
  // across ALL years — so it stays meaningful when the user views a past year.
  useEffect(() => {
    let cancelled = false;
    async function loadCurrentYear() {
      const current = years.find((y) => y.isCurrent);
      if (!current) { setCurrentYearCount(0); return; }
      try {
        const result = await getAttendanceList(clubId, current.id, 1, 1, undefined);
        if (!cancelled) setCurrentYearCount(result.totalCount ?? 0);
      } catch {
        if (!cancelled) setCurrentYearCount(0);
      }
    }
    loadCurrentYear();
    return () => { cancelled = true; };
  }, [clubId, years]);

  // Server-side search drives the table — local memo is just a pass-through.
  const filtered: AttendanceListItem[] = records;

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleSearchSubmit = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };
  const handleSearchClear = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  // KPI values are now year-wide aggregates (NOT page-slice aggregates).
  const totalRecords  = yearTotalRecords;
  const thisYearCount = currentYearCount;
  const avgAttPct     = yearAvgAttPct;
  const totalAttendeesAgg = yearAttendees;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAttendance(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Attendance deleted successfully.");
      fetchRecords();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete attendance.");
    }
  };

  const body = (
      <div className="space-y-5">
        {/* Header */}
        {!embedded && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={parentReturnTo ? decodeURIComponent(parentReturnTo) : `/clubs/${clubId}/dashboard`}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Attendance</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>
        )}

        {/* KPI row removed per user request 2026-06-12 (item #14). The cards
            "Total Records", "This Year", "Avg Attendance", "Total Attendees"
            all duplicated info already visible in the table footer + the
            E-Gov dashboard, and were noisy on a page that's primarily a list. */}

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Attendance Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">Meetings, fellowship, inter-club &amp; district events · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Local year picker removed — global topbar year selector
                  drives ?yearId= which this page reads on load + on change. */}
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearchSubmit(); }}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleSearchSubmit}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  // Export the full year (not just the current page slice).
                  if (!selectedYearId) {
                    exportToCsv(records, yearLabel, clubName || "club", memberCount);
                    return;
                  }
                  try {
                    const result = await getAttendanceList(clubId, selectedYearId, 1, 10000, undefined);
                    exportToCsv(result.items || [], yearLabel, clubName || "club", memberCount);
                  } catch {
                    exportToCsv(records, yearLabel, clubName || "club", memberCount);
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download size={13} /> Export to Excel
              </button>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus size={13} /> Add Attendance
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading attendance…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left">Title</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Attendance</th>
                    <th className="px-3 py-2.5 text-left">Att %</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r, i) => {
                    const evt = deriveEventType(r);
                    const total = totalAttendees(r);
                    const pct = memberCount > 0 ? Math.round((r.membersCount / memberCount) * 100) : 0;
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {r.eventName || "–"}
                          {r.meetingMode && r.meetingMode !== "in_person" && (
                            <span className="ml-2 rounded-full bg-cream-2 px-2 py-0.5 text-xs font-medium text-azure">
                              {r.meetingMode === "online" ? "Online" : "Hybrid"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(r.eventDateTime)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${evt.cls}`}>
                            {evt.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {r.membersCount}/{memberCount || "–"} <span className="text-slate-400 text-xs">· {total} total</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${attendancePercentChip(pct)}`}>
                            {pct}%
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/attendance/v2/${r.id}/edit?returnTo=${childReturnTo}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit attendance"
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
                              aria-label="Delete attendance"
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
                      <td colSpan={canManage ? 8 : 6} className="px-4 py-10 text-center text-slate-400">
                        {search ? "No records match your search." : "No attendance records for this year."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
            <span>
              {totalCount > 0
                ? `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount} record${totalCount === 1 ? "" : "s"} · ${yearLabel}`
                : `0 records · ${yearLabel}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center justify-center h-7 w-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-2">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center justify-center h-7 w-7 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Attendance"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.eventName}</span>? This action cannot be undone.</>
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
  );

  if (embedded) return body;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Attendance"
        pageSubtitle="Manage meeting attendance"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        {body}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
