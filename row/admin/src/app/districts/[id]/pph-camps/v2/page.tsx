"use client";

/**
 * District PPH Camps V2 — listing.
 *
 * Same data semantics as v1 (src/app/districts/[id]/pph-camps/page.tsx): same
 * API calls (list / delete / toggle-active), same card layout, same delete
 * guard when attendance records exist. Only the chrome changes — wrapped in
 * DistrictAdminShell, and Add/Edit deep-link to the standalone v2 form pages
 * instead of an inline dialog.
 *
 * districtId comes from URL params and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays in sync.
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PphCamp } from "@/types/pphCamp";
import {
  getDistrict,
  getDistrictPphCamps,
  deleteDistrictPphCamp,
  toggleDistrictPphCampActive,
  getPhotoUrl,
  getDistrictPphAttendeeReport,
} from "@/services/api";
import { exportPphAttendeeReport } from "@/utils/pphAttendeeReport";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictEgovernanceTabBar from "@/components/dashboard/DistrictEgovernanceTabBar";
import DistrictEgovernanceKpis from "@/components/dashboard/DistrictEgovernanceKpis";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Plus, Search, Edit3, Trash2, AlertTriangle, Users, ImageIcon, FolderOpen, Info, Download, Loader2,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();
  useEffect(() => {
    if (Number.isFinite(urlDistrictId) && urlDistrictId > 0 && urlDistrictId !== selectedDistrictId) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

export default function DistrictPphCampsV2Page() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [districtName, setDistrictName] = useState("");
  const [camps, setCamps] = useState<PphCamp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PphCamp | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Download the DISTRICT-scoped attendee report (all clubs in this district, never deduped).
  const handleDownloadReport = async () => {
    setDownloading(true);
    try {
      const rows = await getDistrictPphAttendeeReport(districtId);
      if (!rows.length) { setErrorMessage("No attendee entries to export for this district."); return; }
      exportPphAttendeeReport(rows, {
        filename: "PPH_Camp_Attendees_District",
        title: "PPH Camp Attendee Report",
        subtitle: `${districtName || "District"}: all attendee entries across clubs (club-wise)`,
      });
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to download attendee report.");
    } finally {
      setDownloading(false);
    }
  };

  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/districts/${districtId}/pph-camps/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const childReturnTo = encodeURIComponent(myListingUrl);
  const addUrl = `/districts/${districtId}/pph-camps/v2/add?returnTo=${childReturnTo}`;

  const fetchCamps = useCallback(async () => {
    setLoading(true);
    try {
      const [d, campsData] = await Promise.all([
        getDistrict(districtId),
        getDistrictPphCamps(districtId),
      ]);
      setDistrictName(`District ${d.districtNumber}`);
      setCamps(campsData);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load PPH camps.");
    } finally {
      setLoading(false);
    }
  }, [districtId]);

  useEffect(() => { fetchCamps(); }, [fetchCamps]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictPphCamp(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Camp deleted successfully.");
      fetchCamps();
    } catch (err: any) {
      setDeleteTarget(null);
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to delete camp.");
    }
  };

  const handleToggleActive = async (camp: PphCamp) => {
    try {
      await toggleDistrictPphCampActive(districtId, camp.id);
      setCamps((prev) => prev.map((c) => (c.id === camp.id ? { ...c, isActive: !c.isActive } : c)));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to toggle active status.");
    }
  };

  const formatDate = (dateStr: string | null) =>
    dateStr ? new Date(dateStr).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "-";

  const filteredCamps = camps.filter((camp) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (camp.title || "").toLowerCase().includes(q) ||
      (camp.address || "").toLowerCase().includes(q) ||
      (camp.campDate ? formatDate(camp.campDate).toLowerCase().includes(q) : false)
    );
  });

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="PPH Camps"
        pageSubtitle={districtName || "–"}
        activeNavHref="/district-admin-dashboard/egovernance"
      >
        <div className="space-y-5">
          <DistrictEgovernanceKpis districtId={districtId} />
          <DistrictEgovernanceTabBar />
          {/* Compact reference-parameters strip + Add Camp on ONE row (saves space). */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex-1 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2">
              <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] text-sky-800">
                <span className="inline-flex items-center gap-1 font-semibold text-sky-900">
                  <Info className="h-3.5 w-3.5 text-sky-600" />Normal Parameters:
                </span>
                <span><span className="font-medium">FBS</span> &lt; 100 mg/dl</span>
                <span>· <span className="font-medium">RBS</span> &lt; 140 mg/dl</span>
                <span>· <span className="font-medium">BP</span> &lt; 130/90 mm Hg</span>
                <span>· <span className="font-medium">BMI</span> &lt; 25</span>
                <span className="text-sky-600">(for reference only)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadReport}
              disabled={downloading}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-9 text-xs font-semibold px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Download the district's attendee report across all clubs (Excel)"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Attendee Report
            </button>
            {canManage && (
              <Link
                href={addUrl}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 h-9 text-xs font-semibold px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus size={13} /> Add Camp
              </Link>
            )}
          </div>

          {/* Search */}
          {!loading && camps.length > 0 && (
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title, address, date…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
          ) : camps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="h-12 w-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">No PPH camps found</h3>
              <p className="text-slate-500 mt-2 text-sm">
                {canManage ? 'Click "Add Camp" to create your first camp.' : "No camps have been created yet."}
              </p>
            </div>
          ) : filteredCamps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderOpen className="h-12 w-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">No results found</h3>
              <p className="text-slate-500 mt-2 text-sm">No camps match your search.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left w-12">#</th>
                    <th className="px-4 py-2.5 text-left">Camp</th>
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-center">Attendees</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCamps.map((camp, i) => (
                    <tr key={camp.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {camp.campLogoPath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={getPhotoUrl(camp.campLogoPath)} alt="" className="h-9 w-9 rounded object-cover shrink-0" />
                          ) : (
                            <div className="h-9 w-9 rounded bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon className="h-4 w-4 text-slate-300" /></div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate">{camp.title}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(camp.campDate)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
                          <Users className="h-3 w-3" />{camp.attendanceCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {canManage ? (
                          <Switch checked={camp.isActive} onCheckedChange={() => handleToggleActive(camp)} />
                        ) : (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${camp.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                            {camp.isActive ? "Active" : "Inactive"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => router.push(`/districts/${districtId}/pph-camps/v2/${camp.id}/attendance?returnTo=${childReturnTo}`)}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                          >
                            <Users className="h-3.5 w-3.5" />Attendance
                          </button>
                          {canManage && (
                            <>
                              <Link
                                href={`/districts/${districtId}/pph-camps/v2/${camp.id}/edit?returnTo=${childReturnTo}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                              >
                                <Edit3 className="h-3.5 w-3.5" />Edit
                              </Link>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(camp)}
                                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <AlertModal
            open={!!deleteTarget}
            onOpenChange={(o) => !o && setDeleteTarget(null)}
            icon={AlertTriangle}
            iconClassName="text-destructive"
            title="Delete Camp"
            description={
              deleteTarget && deleteTarget.attendanceCount > 0 ? (
                <>
                  The camp <span className="font-semibold text-foreground">{deleteTarget.title}</span> has{" "}
                  {deleteTarget.attendanceCount} attendance record(s). Please delete all attendance records first
                  before deleting the camp.
                </>
              ) : (
                <>
                  Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>?
                  This action cannot be undone.
                </>
              )
            }
            confirmLabel="Delete"
            confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onConfirm={deleteTarget && deleteTarget.attendanceCount > 0 ? () => setDeleteTarget(null) : handleDelete}
            cancelLabel="Cancel"
            onCancel={() => setDeleteTarget(null)}
          />
          <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </div>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
