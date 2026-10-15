"use client";

/**
 * Zonal Coordinator dashboard — V2 design.
 *
 * Two nav items:
 *   1. Report  — a REPLICA of the District Admin report module (reuses the shared
 *      DistrictReportContent so District/Club admin reports are never touched).
 *      Only difference: a mandatory district picker scoped to the zone's districts.
 *      The rotary-year picker lives inside DistrictReportContent. No "All districts"
 *      bulk option — downloads are per-district (one at a time), same as District Admin.
 *   2. Beneficiary Approvals — zone-wide approve/reject of direct-beneficiary
 *      requests (the ZC's core job), with district + status filters.
 *
 * Backend APIs unchanged (/api/zonal-dashboard/* + the shared district-report APIs).
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  getZonalDashboardInfo,
  getZonalApprovalRequests,
  getZonalApprovalDetail,
  getApprovalHistory,
  type ApprovalHistoryItem,
  zonalApprove,
  zonalReject,
  getZonalDistricts,
  getZoneInfo,
  getZoneDistricts,
  getZoneApprovalRequests,
  getZonalApprovalFilters,
  getZoneApprovalFilters,
  getDistrictReportAvailableYears,
} from "@/services/api";
import { formatMoney } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import Pagination from "@/components/Pagination";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import DistrictReportContent from "@/components/dashboard/DistrictReportContent";
import DashboardSwitcher from "@/components/dashboard/DashboardSwitcher";
import ZoneGoalSettingView from "@/components/dashboard/ZoneGoalSettingView";
import { Eye, CheckCircle, XCircle, Menu, X, LogOut, FileText, ArrowLeft } from "lucide-react";

import { appLocale } from "@/lib/appFormat";
interface ZoneInfo {
  zoneId: number;
  zoneName: string;
  zoneCode: string;
}

interface ApprovalItem {
  id: number;
  projectId: number;
  requestedBeneficiaries: number;
  currentLimit: number;
  approvalToken: string;
  status: string;
  remark: string | null;
  respondedDate: string | null;
  createdDate: string;
  projectTitle: string;
  projectDate: string | null;
  clubName: string;
  districtNumber: string;
  requestedByName: string;
}

interface ApprovalDetail {
  id: number;
  projectId: number;
  requestedBeneficiaries: number;
  currentLimit: number;
  approvalToken: string;
  status: string;
  remark: string | null;
  createdDate: string;
  projectTitle: string;
  projectDescription: string | null;
  projectDate: string | null;
  projectCost: number | null;
  currency?: string | null;
  currentBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  rccInvolved: number | null;
  clubName: string;
  districtNumber: string;
  zoneName: string;
  requestedByName: string;
  requestedByEmail: string;
  requestedByMobile: string;
  photoUrls: string[];
}

interface ZonalDistrict {
  id: number;
  districtNumber: string;
  districtName: string;
  totalClubs: number;
  totalMembers: number;
}

type View = "report" | "approvals" | "goals";

const SIDEBAR_BG = "#0f172a";
const ACTIVE_BG = "#F7A81B";
const ACTIVE_TEXT = "#1e3a5f";

const NAV: { key: View; label: string }[] = [
  { key: "approvals", label: "Beneficiary Approvals" },
  { key: "goals", label: "Goal Setting" },
  { key: "report", label: "Report" },
];

function getInitials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function ZonalDashboardInner() {
  const { isAuthenticated, isZonalCoordinator, isSuperAdmin, loading: authLoading, user, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // SuperAdmin opens a chosen zone from Global Search via ?zoneId — "borrow" that zone.
  const borrowZoneId = Number(searchParams.get("zoneId")) || 0;
  const superAdminBorrow = isSuperAdmin && !isZonalCoordinator && borrowZoneId > 0;
  const canView = isZonalCoordinator || superAdminBorrow;
  // Goal Setting is hidden from a real Zone Coordinator's menu — it stays only for a
  // SuperAdmin who has borrowed this zone (they manage/lock district goals here).
  const visibleNav = NAV.filter((n) => n.key !== "goals" || isSuperAdmin);

  const [zoneInfo, setZoneInfo] = useState<ZoneInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [districts, setDistricts] = useState<ZonalDistrict[]>([]);
  const [currentView, setCurrentView] = useState<View>("approvals");

  // Approvals: data-only filters — only years/districts that actually have approvals.
  const [approvalYears, setApprovalYears] = useState<{ id: number; label: string; isCurrent?: boolean }[]>([]);
  const [approvalDistricts, setApprovalDistricts] = useState<{ id: number; number: string }[]>([]);
  const [approvalYearFilter, setApprovalYearFilter] = useState<string>("all");
  // Zone-wide status counts (across ALL years + ALL districts of the zone) for the top tiles.
  const [approvalCounts, setApprovalCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 });
  // Report: the report's OWN (data-only) year list for the selected district.
  const [reportYears, setReportYears] = useState<{ id: number; yearLabel: string; isCurrent?: boolean }[]>([]);
  const [reportYearId, setReportYearId] = useState<string>("");

  // Report: mandatory district selection (zone-scoped).
  const [reportDistrictId, setReportDistrictId] = useState<string>("");

  // Approval requests (zone-wide, with a district filter)
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [approvalDistrictFilter, setApprovalDistrictFilter] = useState<string>("all");
  const pageSize = 20;

  const [viewDetail, setViewDetail] = useState<ApprovalDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Approval history (all attempts) for the project in the detail dialog.
  const [history, setHistory] = useState<ApprovalHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [actionDialog, setActionDialog] = useState<{ type: "approve" | "reject"; item: ApprovalItem } | null>(null);
  const [actionRemark, setActionRemark] = useState("");
  // Approve only: the beneficiary count the ZC approves (pre-filled with the requested amount, editable).
  const [approvedBenef, setApprovedBenef] = useState<string>("");
  const [actionSaving, setActionSaving] = useState(false);

  // Auth guard
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) { router.replace("/login"); return; }
    if (!canView) router.replace("/");
  }, [isAuthenticated, canView, authLoading, router]);

  // Load zone info + districts
  useEffect(() => {
    if (authLoading || !isAuthenticated || !canView) return;
    async function init() {
      try {
        const [info, dists, filters] = await Promise.all([
          superAdminBorrow ? getZoneInfo(borrowZoneId) : getZonalDashboardInfo(),
          superAdminBorrow ? getZoneDistricts(borrowZoneId) : getZonalDistricts(),
          (superAdminBorrow ? getZoneApprovalFilters(borrowZoneId) : getZonalApprovalFilters())
            .catch(() => ({ years: [], districts: [], counts: { pending: 0, approved: 0, rejected: 0 } })),
        ]);
        setZoneInfo(info);
        setDistricts([...dists].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
        setApprovalYears(filters.years || []);
        setApprovalDistricts(filters.districts || []);
        setApprovalCounts(filters.counts || { pending: 0, approved: 0, rejected: 0 });
        // Default the year filter to the CURRENT rotary year (if it has approvals);
        // otherwise leave it on "all". Status already defaults to Pending.
        const currentYr = (filters.years || []).find((y) => y.isCurrent);
        if (currentYr) setApprovalYearFilter(String(currentYr.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load zone information.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [authLoading, isAuthenticated, canView, superAdminBorrow, borrowZoneId]);

  const fetchApprovals = useCallback(async () => {
    setListLoading(true);
    try {
      const filterVal = statusFilter === "all" ? undefined : statusFilter;
      const distId = approvalDistrictFilter === "all" ? 0 : Number(approvalDistrictFilter);
      const yid = approvalYearFilter === "all" ? 0 : Number(approvalYearFilter);
      const data = superAdminBorrow
        ? await getZoneApprovalRequests(borrowZoneId, filterVal, page, pageSize, distId, yid)
        : await getZonalApprovalRequests(filterVal, page, pageSize, distId, yid);
      setApprovalItems(data.items || []);
      setTotalCount(data.totalCount || 0);
    } catch (err: any) {
      // Surface the failure instead of leaving stale/empty content with no feedback.
      setApprovalItems([]);
      setTotalCount(0);
      setErrorMessage(err?.response?.data?.message || "Failed to load approval requests.");
    } finally {
      setListLoading(false);
    }
  }, [page, statusFilter, approvalDistrictFilter, approvalYearFilter, superAdminBorrow, borrowZoneId]);

  useEffect(() => {
    if (currentView === "approvals") fetchApprovals();
  }, [currentView, fetchApprovals]);

  // Report: when a district is picked, load its OWN (data-only) available years.
  useEffect(() => {
    if (!reportDistrictId) { setReportYears([]); setReportYearId(""); return; }
    let cancelled = false;
    getDistrictReportAvailableYears(Number(reportDistrictId))
      .then((yrs: { id: number; yearLabel: string; isCurrent?: boolean }[]) => {
        if (cancelled) return;
        setReportYears(yrs || []);
        const cur = (yrs || []).find((y) => y.isCurrent);
        setReportYearId(String(cur?.id || yrs?.[0]?.id || ""));
      })
      .catch(() => { if (!cancelled) { setReportYears([]); setReportYearId(""); } });
    return () => { cancelled = true; };
  }, [reportDistrictId]);

  const selectView = (v: View) => {
    setSidebarOpen(false);
    setCurrentView(v);
    if (v === "approvals") setPage(1);
  };

  const handleView = async (item: ApprovalItem) => {
    setViewLoading(true);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const detail = await getZonalApprovalDetail(item.approvalToken);
      setViewDetail(detail);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load details.");
    } finally {
      setViewLoading(false);
    }
    // Load the project's full approval history (all attempts) for the timeline.
    try {
      const h = await getApprovalHistory(item.id);
      setHistory(h);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleAction = async () => {
    if (!actionDialog) return;
    if (actionDialog.type === "reject" && !actionRemark.trim()) {
      setErrorMessage("Remark is required when rejecting.");
      return;
    }
    let approvedNum: number | undefined;
    if (actionDialog.type === "approve") {
      const raw = approvedBenef.trim();
      if (raw === "" || !/^\d+$/.test(raw)) {
        setErrorMessage("Enter a valid beneficiary number (0 or more) to approve.");
        return;
      }
      approvedNum = Number(raw);
    }
    setActionSaving(true);
    try {
      if (actionDialog.type === "approve") {
        await zonalApprove(actionDialog.item.id, actionRemark || undefined, approvedNum);
        setSuccessMessage("Approved successfully. Beneficiaries updated.");
      } else {
        await zonalReject(actionDialog.item.id, actionRemark);
        setSuccessMessage("Rejected successfully.");
      }
      setActionDialog(null);
      setActionRemark("");
      setApprovedBenef("");
      fetchApprovals();
    } catch {
      setErrorMessage(`Failed to ${actionDialog.type} the request.`);
    } finally {
      setActionSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending</span>;
      case "approved":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Approved</span>;
      case "rejected":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Rejected</span>;
      default:
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" />
      </div>
    );
  }
  if (!zoneInfo) return null;

  const totalPages = Math.ceil(totalCount / pageSize);
  const identityName = user?.name ?? "Zonal Coordinator";
  const initials = getInitials(identityName) || "ZC";

  const pageTitle =
    currentView === "report" ? "Report"
    : currentView === "goals" ? "Goal Setting"
    : "Beneficiary Approvals";
  const pageSubtitle =
    currentView === "report" ? "District-wise reports for your zone"
    : currentView === "goals" ? "Set and lock district goals across your zone"
    : "Approve or reject direct-beneficiary requests";

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-white/10">
        <Image src="/brand/row-logo-badge.png" alt="Roster On Wheels" width={140} height={40} className="h-10 w-auto object-contain" priority />
        <p className="text-xs text-slate-400 mt-2 font-medium">Zonal Dashboard</p>
      </div>

      <div className="px-3 py-3 border-b border-white/10">
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>
          <Avatar className="h-9 w-9 rounded-md flex-shrink-0">
            <AvatarFallback className="text-xs font-bold rounded-md" style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{identityName}</p>
            <p className="text-slate-400 text-xs truncate">Zonal Coordinator</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2 px-1 tracking-wide uppercase truncate">{zoneInfo.zoneName}</p>
      </div>

      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-2">Navigation</p>
        <nav className="flex flex-col gap-0.5">
          {visibleNav.map(({ key, label }) => {
            const isActive = currentView === key;
            return (
              <button
                key={key}
                onClick={() => selectView(key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 mx-0.5 my-0.5 rounded-lg text-sm font-medium transition-all duration-150 text-left ${
                  isActive ? "font-semibold shadow-sm" : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
                style={isActive ? { backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT } : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? ACTIVE_TEXT : "#475569" }} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-white/10 mx-3" />

      <div className="px-3 py-3 space-y-2">
        {/* Multi-role: switch to another dashboard the member holds (District/Club Admin, etc.).
            Renders nothing for a Zonal-Coordinator-only member. */}
        <DashboardSwitcher currentKind="zonal-coordinator" onNavigate={() => setSidebarOpen(false)} />
        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
        <p className="text-slate-500 text-[11px] text-center tracking-widest uppercase">Rotary Year 2026-27</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex h-screen overflow-hidden bg-slate-50" style={{ top: 0, left: 0 }}>
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0" style={{ background: SIDEBAR_BG }}>
        {sidebarContent}
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative flex flex-col w-60 z-10 shadow-2xl" style={{ background: SIDEBAR_BG }}>
            <button className="absolute top-3 right-3 text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b-2 px-6 h-14 flex items-center justify-between flex-shrink-0 gap-3" style={{ borderBottomColor: ACTIVE_BG }}>
          <div className="flex items-center gap-3 min-w-0">
            <button className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            {/* SuperAdmin who opened this zone from Global Search gets a way back. */}
            {superAdminBorrow && (
              <button
                onClick={() => router.push("/settings/global-search")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold hover:opacity-90"
                style={{ backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT }}
                aria-label="Back to Search"
                title="Back to Search"
              >
                <ArrowLeft size={14} />
                <span>Back to Search</span>
              </button>
            )}
            <div className="min-w-0">
              <p className="text-slate-800 font-semibold text-base leading-tight truncate">{pageTitle}</p>
              <p className="text-slate-400 text-xs mt-0.5 truncate">{pageSubtitle}</p>
            </div>
          </div>
          <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[260px]">{zoneInfo.zoneName}</span>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {/* GOAL SETTING VIEW — SuperAdmin only (borrowed zone). Hidden entirely for a real
              Zone Coordinator: not in their menu, and not rendered even if reached by URL. */}
          {currentView === "goals" && isSuperAdmin && (
            <ZoneGoalSettingView zoneId={superAdminBorrow ? borrowZoneId : undefined} />
          )}

          {/* REPORT VIEW — replica of District Admin report, district mandatory */}
          {currentView === "report" && (
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <FileText className="h-4 w-4 text-slate-500" /> District
                    <span className="text-rose-600">*</span>
                  </div>
                  <Select value={reportDistrictId} onValueChange={setReportDistrictId}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                      <SelectValue placeholder="Select a district…" />
                    </SelectTrigger>
                    <SelectContent>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>District {d.districtNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {reportDistrictId && (
                    <>
                      <span className="text-sm font-semibold text-slate-800">Year</span>
                      <Select value={reportYearId} onValueChange={setReportYearId}>
                        <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Year" /></SelectTrigger>
                        <SelectContent>
                          {reportYears.map((y) => (
                            <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <p className="text-xs text-slate-400">Year list shows only years that have report data for the chosen district.</p>
                </div>
              </div>

              {reportDistrictId ? (
                <Suspense fallback={<div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>}>
                  <DistrictReportContent districtId={Number(reportDistrictId)} initialYearId={Number(reportYearId) || undefined} hideMembers />
                </Suspense>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <FileText className="h-12 w-12 text-slate-300 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-700">Select a district</h3>
                  <p className="text-slate-500 mt-2">Choose a district from the dropdown above to load its reports.</p>
                </div>
              )}
            </div>
          )}

          {/* APPROVALS VIEW */}
          {currentView === "approvals" && (
            <div className="space-y-4">
            {/* Zone-wide status counts (all years + all districts). Click a tile to filter the list by that status. */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => { setStatusFilter("pending"); setPage(1); }}
                className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "pending" ? "border-amber-400 ring-1 ring-amber-300" : "border-slate-200"}`}
              >
                <p className="text-2xl font-bold text-amber-600 tabular-nums">{approvalCounts.pending}</p>
                <p className="text-sm font-medium text-amber-700">Pending</p>
              </button>
              <button
                type="button"
                onClick={() => { setStatusFilter("approved"); setPage(1); }}
                className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "approved" ? "border-green-400 ring-1 ring-green-300" : "border-slate-200"}`}
              >
                <p className="text-2xl font-bold text-green-600 tabular-nums">{approvalCounts.approved}</p>
                <p className="text-sm font-medium text-green-700">Approved</p>
              </button>
              <button
                type="button"
                onClick={() => { setStatusFilter("rejected"); setPage(1); }}
                className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "rejected" ? "border-red-400 ring-1 ring-red-300" : "border-slate-200"}`}
              >
                <p className="text-2xl font-bold text-red-600 tabular-nums">{approvalCounts.rejected}</p>
                <p className="text-sm font-medium text-red-700">Rejected</p>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Beneficiary Approval Requests</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{zoneInfo.zoneName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={approvalYearFilter} onValueChange={(v) => { setApprovalYearFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Years" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {approvalYears.map((y) => (
                        <SelectItem key={y.id} value={String(y.id)}>{y.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={approvalDistrictFilter} onValueChange={(v) => { setApprovalDistrictFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-[170px]"><SelectValue placeholder="All Districts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Districts</SelectItem>
                      {approvalDistricts.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>District {d.number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {listLoading ? (
                <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
              ) : approvalItems.length === 0 ? (
                <p className="text-slate-500 text-sm py-12 text-center">No approval requests found.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Project Title</TableHead>
                          <TableHead>Club</TableHead>
                          <TableHead>District</TableHead>
                          <TableHead className="text-right">Limit</TableHead>
                          <TableHead className="text-right">Requested</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Requested By</TableHead>
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {approvalItems.map((item, i) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-slate-500 tabular-nums">{(page - 1) * pageSize + i + 1}</TableCell>
                            <TableCell className="font-medium max-w-[200px] truncate">{item.projectTitle}</TableCell>
                            <TableCell>{item.clubName}</TableCell>
                            <TableCell className="whitespace-nowrap">{item.districtNumber}</TableCell>
                            <TableCell className="text-right">{item.currentLimit}</TableCell>
                            <TableCell className="text-right font-semibold text-red-600">{item.requestedBeneficiaries}</TableCell>
                            <TableCell>{getStatusBadge(item.status)}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {new Date(item.createdDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })}
                            </TableCell>
                            <TableCell>{item.requestedByName}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleView(item)} title="View Details">
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {item.status === "pending" && (
                                  <>
                                    <Button variant="ghost" size="icon" className="text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => { setActionDialog({ type: "approve", item }); setActionRemark(""); setApprovedBenef(String(item.requestedBeneficiaries ?? "")); }} title="Approve">
                                      <CheckCircle className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setActionDialog({ type: "reject", item }); setActionRemark(""); }} title="Reject">
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {totalPages > 1 && (
                    <div className="p-4 border-t border-slate-100">
                      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} />
                    </div>
                  )}
                </>
              )}
            </div>
            </div>
          )}
        </main>
      </div>

      {/* View Detail Dialog */}
      <Dialog open={!!viewDetail} onOpenChange={() => setViewDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approval Request Details</DialogTitle>
            <DialogDescription>{viewDetail?.projectTitle}</DialogDescription>
          </DialogHeader>
          {viewDetail && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                {getStatusBadge(viewDetail.status)}
              </div>

              <div>
                <h4 className="font-semibold text-base mb-2">Project Details</h4>
                <div className="grid grid-cols-2 gap-2 bg-muted/30 rounded-lg p-3">
                  <div><span className="text-muted-foreground">Title:</span> <span className="font-medium">{viewDetail.projectTitle}</span></div>
                  <div><span className="text-muted-foreground">Date:</span> {viewDetail.projectDate ? new Date(viewDetail.projectDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "—"}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {viewDetail.projectDescription || "—"}</div>
                  <div><span className="text-muted-foreground">Cost:</span> {viewDetail.projectCost != null ? formatMoney(viewDetail.projectCost, viewDetail.currency) : "—"}</div>
                  <div><span className="text-muted-foreground">Man Hours:</span> {viewDetail.manHours ?? "—"}</div>
                  <div><span className="text-muted-foreground">Rotarians:</span> {viewDetail.rotariansInvolved ?? "—"}</div>
                  <div><span className="text-muted-foreground">Rotaractors:</span> {viewDetail.rotaractorsInvolved ?? "—"}</div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-base mb-2">Beneficiary Details</h4>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">Set Limit:</span> <span className="font-semibold">{viewDetail.currentLimit}</span></div>
                    <div><span className="text-muted-foreground">Requested:</span> <span className="font-semibold text-red-600">{viewDetail.requestedBeneficiaries}</span></div>
                  </div>
                </div>
              </div>

              {viewDetail.remark && (
                <div>
                  <h4 className="font-semibold text-base mb-2">Latest Remark</h4>
                  <p className="bg-muted/30 rounded-lg p-3">{viewDetail.remark}</p>
                </div>
              )}

              {viewDetail.photoUrls.length > 0 && (
                <div>
                  <h4 className="font-semibold text-base mb-2">Project Photos</h4>
                  <div className="flex flex-wrap gap-2">
                    {viewDetail.photoUrls.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt={`Photo ${i + 1}`} className="h-32 w-40 object-cover rounded-lg border" />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-semibold text-base mb-2">Club & Admin Details</h4>
                <div className="grid grid-cols-2 gap-2 bg-muted/30 rounded-lg p-3">
                  <div><span className="text-muted-foreground">District:</span> {viewDetail.districtNumber}</div>
                  <div><span className="text-muted-foreground">Club:</span> {viewDetail.clubName}</div>
                  <div><span className="text-muted-foreground">Admin:</span> {viewDetail.requestedByName}</div>
                  <div><span className="text-muted-foreground">Mobile:</span> {viewDetail.requestedByMobile}</div>
                  <div><span className="text-muted-foreground">Email:</span> {viewDetail.requestedByEmail}</div>
                </div>
              </div>

              {viewDetail.status === "pending" && (
                <div className="flex gap-3 justify-end pt-2">
                  <Button variant="outline" className="border-green-500 text-green-600 hover:bg-green-50" onClick={() => {
                    const token = viewDetail.approvalToken;
                    setViewDetail(null);
                    const item = approvalItems.find((a) => a.approvalToken === token);
                    if (item) { setActionDialog({ type: "approve", item }); setActionRemark(""); setApprovedBenef(String(item.requestedBeneficiaries ?? "")); }
                  }}>
                    <CheckCircle className="mr-2 h-4 w-4" /> Approve
                  </Button>
                  <Button variant="outline" className="border-red-500 text-red-600 hover:bg-red-50" onClick={() => {
                    const token = viewDetail.approvalToken;
                    setViewDetail(null);
                    const item = approvalItems.find((a) => a.approvalToken === token);
                    if (item) { setActionDialog({ type: "reject", item }); setActionRemark(""); }
                  }}>
                    <XCircle className="mr-2 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}

              {/* Approval history — shown BELOW the Approve/Reject buttons. Every attempt
                  (a project can be submitted for approval multiple times), newest first. */}
              <div className="pt-2 border-t border-slate-100">
                <h4 className="font-semibold text-base mb-2">Approval History</h4>
                {historyLoading ? (
                  <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>
                ) : history.length === 0 ? (
                  <p className="text-slate-500 text-sm">No history for this project.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h) => (
                      <div key={h.approvalId} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          {getStatusBadge(h.status)}
                          <span className="text-xs text-slate-500 whitespace-nowrap">Submitted {new Date(h.createdDate).toLocaleString(appLocale())}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1 text-xs">
                          <div><span className="text-muted-foreground">Requested:</span> <span className="font-semibold text-red-600">{h.requestedBeneficiaries}</span></div>
                          <div><span className="text-muted-foreground">Approved:</span> <span className="font-semibold text-green-700">{h.approvedBeneficiaries ?? "—"}</span></div>
                        </div>
                        {h.remark && <p className="mt-1.5 text-xs"><span className="text-muted-foreground">Remark:</span> {h.remark}</p>}
                        {(h.respondedDate || h.respondedByName) && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {h.status !== "pending" ? `${h.status.charAt(0).toUpperCase() + h.status.slice(1)} ` : ""}
                            {h.respondedByName ? `by ${h.respondedByName} ` : ""}
                            {h.respondedDate ? `on ${new Date(h.respondedDate).toLocaleString(appLocale())}` : ""}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve/Reject Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionDialog?.type === "approve" ? "Approve" : "Reject"} Request</DialogTitle>
            <DialogDescription>{actionDialog?.item.projectTitle} — {actionDialog?.item.clubName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <p><span className="text-muted-foreground">Set Limit:</span> <span className="font-semibold">{actionDialog?.item.currentLimit}</span></p>
              <p><span className="text-muted-foreground">Requested:</span> <span className="font-semibold text-red-600">{actionDialog?.item.requestedBeneficiaries}</span></p>
            </div>
            {actionDialog?.type === "approve" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Approved Beneficiaries <span className="text-destructive">*</span></label>
                <input
                  type="number"
                  min={0}
                  value={approvedBenef}
                  onChange={(e) => setApprovedBenef(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Beneficiaries to approve"
                />
                <p className="text-xs text-slate-500">Pre-filled with the requested amount — edit before approving. This value is saved to the project.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Remark{" "}
                {actionDialog?.type === "reject" ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(Optional)</span>}
              </label>
              <Textarea value={actionRemark} onChange={(e) => setActionRemark(e.target.value)} placeholder="Enter your remark..." rows={3} />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
              <Button onClick={handleAction} disabled={actionSaving} className={actionDialog?.type === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}>
                {actionSaving ? "Processing..." : actionDialog?.type === "approve" ? "Confirm Approve" : "Confirm Reject"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {viewLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-[70]">
          <RotaryLoader size="lg" />
        </div>
      )}

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}

export default function ZonalDashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}>
      <ZonalDashboardInner />
    </Suspense>
  );
}
