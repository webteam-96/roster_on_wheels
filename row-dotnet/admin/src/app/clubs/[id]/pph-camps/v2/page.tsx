"use client";

/**
 * PPH Camps v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Club Admin Dashboard listings (KPI tiles,
 * colored chips, dense table) but the data still comes from the existing v1
 * endpoints (getPphCamps + deletePphCamp + getClub).
 *
 * The Attendance button links to the v2 attendance sub-page
 * (/clubs/[id]/pph-camps/v2/[campId]/attendance), which wraps the shared
 * PphAttendeesManager in ClubAdminShell so the V2 chrome is kept.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity, Users, Image as ImageIcon, CalendarClock, Loader2, Search, Plus,
  Edit3, Trash2, ArrowLeft, AlertTriangle, Download,
} from "lucide-react";
import {
  getClub,
  getPphCamps,
  deletePphCamp,
  getPphAttendeeReport,
} from "@/services/api";
import { PphCamp } from "@/types/pphCamp";
import { exportPphAttendeeReport } from "@/utils/pphAttendeeReport";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

// Rotary Year label (July–June) derived from a date string.
function rotaryYearLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getMonth() + 1;
  const startYear = month >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function currentRotaryYearLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const startYear = month >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function activeChipStyle(active: boolean): string {
  return active
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-50 text-slate-500 border-slate-200";
}

export default function PphCampsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [camps, setCamps] = useState<PphCamp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedYear, setSelectedYear] = useState<string>("all");

  const [deleteTarget, setDeleteTarget] = useState<PphCamp | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Download the CLUB-scoped attendee report (only this club's entries, never deduped).
  const handleDownloadReport = async () => {
    setDownloading(true);
    try {
      const rows = await getPphAttendeeReport(clubId);
      if (!rows.length) { setErrorMessage("No attendee entries to export for this club."); return; }
      exportPphAttendeeReport(rows, {
        filename: "PPH_Camp_Attendees_Club",
        title: "PPH Camp Attendee Report",
        subtitle: `${clubName || "Club"} — all attendee entries (club-wise)`,
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to download attendee report.");
    } finally {
      setDownloading(false);
    }
  };

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/pph-camps/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/pph-camps/v2/add?returnTo=${returnTo}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [club, campsData] = await Promise.all([
        getClub(clubId),
        getPphCamps(clubId),
      ]);
      setClubName(club.clubName);
      setCamps(campsData);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load PPH camps.");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Data-only year list: distinct RY labels derived from each camp's date.
  const years = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const c of camps) {
      const lbl = rotaryYearLabel(c.campDate);
      if (lbl) set.add(lbl);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [camps]);

  // Filter rows by year + search.
  const filtered = useMemo<PphCamp[]>(() => {
    const q = search.trim().toLowerCase();
    return camps.filter((c) => {
      if (selectedYear !== "all" && rotaryYearLabel(c.campDate) !== selectedYear) {
        return false;
      }
      if (!q) return true;
      const dateStr = c.campDate ? fmtDate(c.campDate).toLowerCase() : "";
      return (
        (c.title || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q) ||
        dateStr.includes(q)
      );
    });
  }, [camps, search, selectedYear]);

  // KPI aggregates.
  const currentYear = currentRotaryYearLabel();
  const todayIso = new Date().toISOString().split("T")[0];

  const totalCampsThisYear = useMemo(
    () => camps.filter((c) => rotaryYearLabel(c.campDate) === currentYear).length,
    [camps, currentYear],
  );
  const beneficiariesReached = useMemo(
    () => camps.reduce((sum, c) => sum + (c.attendanceCount || 0), 0),
    [camps],
  );
  const photosDocumented = useMemo(
    () => camps.filter((c) => !!c.campLogoPath).length,
    [camps],
  );
  const upcomingCamps = useMemo(
    () => camps.filter((c) => c.campDate && c.campDate.split("T")[0] >= todayIso).length,
    [camps, todayIso],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.attendanceCount > 0) {
      // v1 parity: block delete if there are attendance records.
      setErrorMessage(
        `The camp "${deleteTarget.title}" has ${deleteTarget.attendanceCount} attendance record(s). Please delete all attendance records first before deleting the camp.`,
      );
      setDeleteTarget(null);
      return;
    }
    try {
      await deletePphCamp(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Camp deleted successfully.");
      fetchAll();
    } catch (err: unknown) {
      setDeleteTarget(null);
      const respData = (err as { response?: { data?: { message?: string; detail?: string; title?: string } } })?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || "Failed to delete camp.",
      );
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="PPH Camps"
        pageSubtitle="Polio Plus Heart camps"
        activeNavHref="/club-admin-dashboard/foundation"
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
              <h1 className="text-lg font-semibold text-slate-800">PPH Camps</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "—"} · Preventive Public Health Camps
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Camps"          value={fmtInt(totalCampsThisYear)}    subtitle={`RY ${currentYear}`}      icon={Activity}      color="teal"   />
          <KpiCard title="Beneficiaries Reached" value={fmtInt(beneficiariesReached)} subtitle="Across all camps"          icon={Users}         color="green"  />
          <KpiCard title="Photos Documented"    value={fmtInt(photosDocumented)}      subtitle="Camps with logo"           icon={ImageIcon}     color="gold"   />
          <KpiCard title="Upcoming Camps"       value={fmtInt(upcomingCamps)}         subtitle="Scheduled on or after today" icon={CalendarClock} color="blue"   />
        </div>

        {/* Reference info (kept from v1 — parameter chart) */}
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs text-sky-800">
          <div className="font-semibold text-sky-900 mb-1">Normal Parameters For Reference</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div><span className="font-medium">Fasting Blood Sugar:</span> &lt; 100 mg/dl</div>
            <div><span className="font-medium">Random Blood Sugar:</span> &lt; 140 mg/dl</div>
            <div><span className="font-medium">Blood Pressure:</span> &lt; 130/90 mm Hg</div>
            <div><span className="font-medium">BMI:</span> &lt; 25</div>
          </div>
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Camp Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedYear === "all"
                  ? `${camps.length} camp${camps.length === 1 ? "" : "s"} on record`
                  : `RY ${selectedYear}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Years</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}{y === currentYear ? " · current" : ""}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search title, address, date…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleDownloadReport}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                title="Download this club's attendee report (Excel)"
              >
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Attendee Report
              </button>
              {canManage && (
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus size={13} /> Add Camp
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading camps…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left">Camp Name</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Location</th>
                    <th className="px-3 py-2.5 text-left">Beneficiaries</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-center w-28">Attendance</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((c, i) => (
                    <tr key={c.id} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{c.title || "—"}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{c.campDate ? fmtDate(c.campDate) : "—"}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-xs truncate">{c.address || "—"}</td>
                      <td className="px-3 py-2 text-slate-700 tabular-nums">{fmtInt(c.attendanceCount)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${activeChipStyle(c.isActive)}`}>
                          {c.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Link
                          href={`/clubs/${clubId}/pph-camps/v2/${c.id}/attendance?returnTo=${returnTo}`}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          <Users size={12} /> Attendance
                        </Link>
                      </td>
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/clubs/${clubId}/pph-camps/v2/${c.id}/edit?returnTo=${returnTo}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="Edit camp"
                          >
                            <Edit3 size={13} />
                          </Link>
                        </td>
                      )}
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            aria-label="Delete camp"
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
                        {search || selectedYear !== "all"
                          ? "No camps match your filters."
                          : "No PPH camps have been created yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filtered.length} camp{filtered.length === 1 ? "" : "s"} shown
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Camp"
          description={
            deleteTarget && deleteTarget.attendanceCount > 0 ? (
              <>
                The camp <span className="font-semibold text-foreground">{deleteTarget.title}</span> has {deleteTarget.attendanceCount} attendance record(s). Please delete all attendance records first before deleting the camp.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This action cannot be undone.
              </>
            )
          }
          confirmLabel={deleteTarget && deleteTarget.attendanceCount > 0 ? "OK" : "Delete"}
          confirmClassName={
            deleteTarget && deleteTarget.attendanceCount > 0
              ? undefined
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          }
          onConfirm={
            deleteTarget && deleteTarget.attendanceCount > 0
              ? () => setDeleteTarget(null)
              : handleDelete
          }
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
