"use client";

/**
 * Club Service v2 listing — pilot module for the frontend overhaul.
 *
 * Visuals mimic the Club Admin Dashboard's Club Service tab (KPI tiles,
 * colored attendance chips, dense table) but the data still comes from the
 * existing v1 API endpoints (getProjects + getProjectYears + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays, Users, Loader2, Search, Plus, Edit3, Trash2,
  Download, ArrowLeft, AlertTriangle, Info,
} from "@/components/icons";
import {
  getClub,
  getModules,
  getProjects,
  deleteProject,
  getProjectYears,
} from "@/services/api";
import { ProjectListItem } from "@/types/project";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular:    "Regular",
  fellowship: "Fellowship",
  bod:        "BOD",
  assembly:   "Assembly",
  trust:      "Trust",
};

const AGREE_MESSAGE = `The data I will enter is for a Meeting / Event conducted by my club. E.g., Installation, Navratri Celebration, Weekly Meetings, Etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

function meetingTypeChipStyle(t: string): string {
  switch ((t || "").toLowerCase()) {
    case "regular":    return "bg-blue-50 text-blue-700 border-blue-200";
    case "fellowship": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "bod":        return "bg-violet-50 text-violet-700 border-violet-200";
    case "assembly":   return "bg-amber-50 text-amber-700 border-amber-200";
    case "trust":      return "bg-rose-50 text-rose-700 border-rose-200";
    default:           return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function attendancePercentChip(pct: number): string {
  if (pct >= 75) return "bg-emerald-100 text-emerald-700";
  if (pct >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Meeting Type", "Title", "Attendance", "Attendance %"];
  const lines = rows.map((r, i) => {
    const meetingLabel = MEETING_TYPE_LABELS[r.meetingType || ""] || r.meetingType || "";
    const dateStr = r.projectDate ? fmtDate(r.projectDate) : "";
    return [
      i + 1,
      `"${dateStr}"`,
      `"${meetingLabel}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      r.attendance ?? "",
      r.attendancePercentage ?? "",
    ].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `club-service-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ClubServiceV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Server-side pagination + search (parity with v1)
  const pageSize = 20;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [showAgreeDialog, setShowAgreeDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // No RI Flow-Bot "Add to Rotary.org" on Club Service meetings (the other 5 avenues keep it).

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/club-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Carry the selected listing year through to the add page (parity with v1)
  const addUrl = `/clubs/${clubId}/club-service/v2/add?returnTo=${returnTo}${selectedYearId ? `&yearId=${selectedYearId}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, modules] = await Promise.all([getClub(clubId), getModules()]);
        if (cancelled) return;
        setClubName(club.clubName);
        setMemberCount(club.totalMembers || 0);
        const mod = modules.find((m) => m.moduleKey === "club_service");
        if (mod) {
          setModuleId(mod.id);
          const projectYears = await getProjectYears(clubId, mod.id);
          if (cancelled) return;
          setYears(projectYears);
          const current = projectYears.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : projectYears[0]?.id ?? null);
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchProjects = useCallback(async () => {
    if (!moduleId || !selectedYearId) return;
    setLoading(true);
    try {
      // Server-side pagination + search (parity with v1: pageSize 20).
      const result = await getProjects(clubId, moduleId, selectedYearId, page, pageSize, search || undefined);
      setProjects(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setProjects([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, moduleId, selectedYearId, page, search]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // Aggregate KPIs from the current page's meetings.
  const meetingsHeld = projects.length;
  const avgAttPct = meetingsHeld > 0
    ? Math.round(projects.reduce((sum, p) => sum + (p.attendancePercentage ?? 0), 0) / meetingsHeld)
    : 0;

  const router = useRouter();
  const handleAddClick = () => setShowAgreeDialog(true);

  const handleAgreeAndContinue = () => {
    setShowAgreeDialog(false);
    router.push(addUrl);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !selectedYearId) return;
    try {
      await deleteProject(clubId, selectedYearId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Meeting deleted successfully.");
      fetchProjects();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete meeting.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Service"
        pageSubtitle="Club service meetings and projects"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
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
              <h1 className="text-lg font-semibold text-slate-800">Club Service Meetings</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row — "Avg Attendance Stayed" tile intentionally dropped: the
            underlying field is only available on the dashboard's KPI endpoint
            (ServiceProjectsAvenueKpis.avgAttendanceStayedPercent), not on the
            project listing. v1 didn't show it either. */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard title="Meetings Held"         value={fmtInt(meetingsHeld)}    subtitle={`RY ${yearLabel}`}    icon={CalendarDays} color="blue" />
          <KpiCard title="Avg Attendance"        value={`${avgAttPct}%`}         subtitle="Across meetings"      icon={Users}        color="green" />
          <KpiCard title="Members on Roll"       value={fmtInt(memberCount)}     subtitle="Active members"       icon={Users}        color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Meeting Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">Weekly meetings, fellowship, BOD &amp; more · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedYearId ?? ""}
                onChange={(e) => { setSelectedYearId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => exportToCsv(projects, yearLabel, clubName || "club")}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download size={13} /> Export to Excel
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={handleAddClick}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus size={13} /> Add Meeting
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading meetings…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Meeting Type</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Attendance</th>
                    <th className="px-3 py-2.5 text-left">Att %</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projects.map((m, i) => {
                    const meetingLabel = MEETING_TYPE_LABELS[m.meetingType || ""] || m.meetingType || "–";
                    const pct = Number(m.attendancePercentage ?? 0);
                    return (
                      <tr key={m.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(m.projectDate)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${meetingTypeChipStyle(m.meetingType || "")}`}>
                            {meetingLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <div className="flex items-center gap-2">
                            {m.primaryPhotoPath && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`${API_URL}${m.primaryPhotoPath}`}
                                alt=""
                                className="h-10 w-10 rounded object-cover"
                              />
                            )}
                            <span>{m.title || "–"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {/* No member-on-roll denominator: ProjectListItem has no
                              membersOnRoll field and the current club count is
                              misleading for past years / BOD meetings. v1 just
                              showed the raw attendance value. */}
                          {m.attendance ?? "–"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${attendancePercentChip(pct)}`}>
                            {Math.round(pct)}%
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/club-service/v2/${m.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit meeting"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </td>
                        )}
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(m)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                              aria-label="Delete meeting"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {projects.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 8 : 6} className="px-4 py-10 text-center text-slate-400">
                        {search ? "No meetings match your search." : "No meetings recorded for this year."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} meeting{totalCount === 1 ? "" : "s"} · {yearLabel}
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

        {/* Agree dialog (kept from v1 — required disclaimer before creating a meeting) */}
        <AlertModal
          open={showAgreeDialog}
          onOpenChange={(o) => !o && setShowAgreeDialog(false)}
          icon={Info}
          iconClassName="text-blue-500"
          title="I Agree"
          description={
            <div className="whitespace-pre-line text-sm text-muted-foreground">
              {AGREE_MESSAGE}
            </div>
          }
          confirmLabel="I Agree & Continue"
          onConfirm={handleAgreeAndContinue}
          cancelLabel="Cancel"
          onCancel={() => setShowAgreeDialog(false)}
        />

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Meeting"
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
