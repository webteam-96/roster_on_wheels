"use client";

/**
 * New Generation Service v2 listing — frontend overhaul, additive only.
 *
 * Visuals mimic NonClubAvenueSection from the Club Admin Dashboard's Service
 * Projects & Public Image page (KPI tiles, colored type chips, dense table)
 * but the data still comes from the existing v1 API endpoints
 * (getProjects + getProjectYears + getClub + checkClubHasModerator).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Users, IndianRupee, Clock4, Loader2, Search, Plus, Edit3, Trash2,
  Download, ArrowLeft, AlertTriangle, Info, BadgeAlert, Eye,
  Clock, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Puzzle,
} from "lucide-react";
import {
  getClub,
  getModules,
  getProjects,
  deleteProject,
  getProjectYears,
  checkClubHasModerator,
  getProject,
} from "@/services/api";
import { ProjectListItem } from "@/types/project";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { getCurrencySymbol } from "@/lib/currency";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";

const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const AGREE_MESSAGE = `The data I will enter is for a New generation Service Project conducted by my club that has benefitted my community. E.g., Formation of an Interact Club, Formation of a Rotaract Club, etc.

Please Note: The content posted here will be displayed on the Rotary Zones 4, 5, 6, 7 & 8 Website, District Website, Club Monthly Report & Rotary Zones 4, 5, 6, 7 & 8 Integrated Club Website`;

function projectTypeChipStyle(t: string): string {
  const lo = (t || "").toLowerCase();
  if (lo.includes("one"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur"))  return "bg-purple-50 text-purple-700 border-purple-200";
  if (lo.includes("annual")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (lo.includes("ongoing")) return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function shortCurrency(value: number, currency?: string | null): string {
  const symbol = getCurrencySymbol(currency);
  if (!value || value < 1000) return `${symbol}${value || 0}`;
  if (value >= 10000000) return `${symbol}${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000)   return `${symbol}${(value / 100000).toFixed(1)}L`;
  if (value >= 1000)     return `${symbol}${(value / 1000).toFixed(1)}K`;
  return `${symbol}${value}`;
}

function shortInr(value: number): string {
  if (!value || value < 1000) return `₹${value || 0}`;
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000)   return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000)     return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value}`;
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Title", "Type", "Category", "Location", "Cost (INR)"];
  const lines = rows.map((r, i) => {
    const dateStr = r.projectDate ? fmtDate(r.projectDate) : "";
    return [
      i + 1,
      `"${dateStr}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      `"${(r.projectType || "").replace(/"/g, '""')}"`,
      `"${(r.areaOfFocusName || r.otherAreaOfFocus || "").replace(/"/g, '""')}"`,
      `"${(r.location || "").replace(/"/g, '""')}"`,
      r.projectCost ?? "",
    ].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `new-generation-service-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NewGenerationServiceV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Server-side search: searchInput is what the user is typing; search is the
  // applied term submitted on Enter / Search-button click. Listing requeries
  // when `search` or `page` changes.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;
  const [subTab, setSubTab] = useState<"one_time" | "ongoing">("one_time");
  const [hasModerator, setHasModerator] = useState(false);

  const [showAgreeDialog, setShowAgreeDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // RI Flow-Bot: push an EXISTING project to rotary.org (as opposed to the
  // add-page's auto-trigger right after a new project is saved).
  const installed = useExtensionStatus();
  const isBotEnabled = isFlowBotEnabled(clubId);
  const [syncTarget, setSyncTarget] = useState<ProjectListItem | null>(null);
  const canSyncRow = (p: ProjectListItem) => {
    const status = (p.approvalStatus || "").toLowerCase();
    return isBotEnabled && installed === true && canManage && (status === "" || status === "approved");
  };

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/new-generation-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/new-generation-service/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, modules] = await Promise.all([getClub(clubId), getModules()]);
        if (cancelled) return;
        setClubName(club.clubName);
        const mod = modules.find((m) => m.moduleKey === "new_generation_service");
        if (mod) {
          setModuleId(mod.id);
          const projectYears = await getProjectYears(clubId, mod.id);
          if (cancelled) return;
          setYears(projectYears);
          const current = projectYears.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : projectYears[0]?.id ?? null);
        }
        checkClubHasModerator(clubId).then((r) => {
          if (!cancelled) setHasModerator(r.hasModerator);
        }).catch(() => {});
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
      // Server-side pagination + search — restored from v1 so clubs with >200
      // projects in a year are not silently truncated and the search term is
      // forwarded to the API (full-table match, not just the current page).
      const result = await getProjects(
        clubId, moduleId, selectedYearId, page, pageSize, search || undefined
      );
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

  // Sub-tab filter is client-side only — applied to the current page of rows.
  const activeRows = useMemo<ProjectListItem[]>(() => {
    if (subTab === "one_time") {
      return projects.filter((p) => (p.projectType || "").toLowerCase().includes("one"));
    }
    return projects.filter((p) => !((p.projectType || "").toLowerCase().includes("one")));
  }, [projects, subTab]);

  const filtered = activeRows;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleSearch = () => { setPage(1); setSearch(searchInput.trim()); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";

  // KPIs computed from the current page only (server pagination means we don't
  // hold the full year in memory). `totalProjects` uses totalCount from the API
  // so it remains accurate across pages; the other KPIs are scoped to this page.
  const totalProjects     = totalCount;
  const totalBeneficiaries = projects.reduce((s, p) => s + (p.directBeneficiaries ?? 0), 0);
  const totalCost          = projects.reduce((s, p) => s + (p.projectCost ?? 0), 0);
  // ProjectListItem doesn't carry manHours — KPI uses 0 unless backend later adds it.
  const totalManHours      = 0;

  // Pending-approval banner rows (visible when this club has a moderator).
  const pendingApprovals = useMemo(
    () => projects.filter((p) => (p.approvalStatus || "").toLowerCase() === "pending"),
    [projects]
  );

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
      setSuccessMessage("Project deleted successfully.");
      fetchProjects();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete project.");
    }
  };

  const handleSyncConfirm = async () => {
    const target = syncTarget;
    setSyncTarget(null);
    if (!target || !selectedYearId) return;
    try {
      const detail = await getProject(clubId, selectedYearId, target.id);
      const payload = buildOrgExportFromDetail(detail, AVENUE_LABELS["new_generation_service"], SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setErrorMessage("Failed to load project details for Rotary.org sync.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="New Generation Service"
        pageSubtitle="New Generation service projects"
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
              <h1 className="text-lg font-semibold text-slate-800">New Generation Service</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjects)}        subtitle="New Generation Service" icon={Briefcase}   color="blue" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}   subtitle="Lives impacted"         icon={Users}       color="green" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={shortInr(Number(totalCost))}  subtitle="Project investment"     icon={IndianRupee} color="gold" />
          <KpiCard title="Man Hours"     value={fmtInt(totalManHours)}        subtitle="Volunteer time"         icon={Clock4}      color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">New Generation Service</h3>
              <p className="text-xs text-slate-500 mt-0.5">Project records · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setSubTab("one_time")}
                  className={`px-3 py-1.5 ${subTab === "one_time" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  One time Project
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab("ongoing")}
                  className={`px-3 py-1.5 border-l border-slate-200 ${subTab === "ongoing" ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Ongoing/Repeat Projects
                </button>
              </div>
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
                  placeholder="Search title or location…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => exportToCsv(filtered, yearLabel, clubName || "club")}
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
                  <Plus size={13} /> Add Project
                </button>
              )}
            </div>
          </div>

          {/* Pending approval banner row(s) — above the table */}
          {hasModerator && pendingApprovals.length > 0 && (
            <div className="border-b border-slate-100 bg-amber-50/40 divide-y divide-amber-100">
              {pendingApprovals.map((p) => (
                <div key={p.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-slate-800 truncate max-w-[260px]">{p.title || "Untitled"}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                    <BadgeAlert size={10} /> {p.approvalStatus || "pending"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <Loader2 className="animate-spin mr-2" size={16} /> Loading projects…
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Date</th>
                    <th className="px-3 py-2.5 text-left">Title</th>
                    <th className="px-3 py-2.5 text-left">Category</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Location</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    <th className="px-3 py-2.5 text-right">Direct Benf</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-right w-16">View</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {isBotEnabled && installed === true && <th className="px-3 py-2.5 text-right w-16">Rotary.org</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((m, i) => {
                    const typeLabel = m.projectType || "—";
                    return (
                      <tr key={m.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(m.projectDate)}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{m.title || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{m.areaOfFocusName || m.otherAreaOfFocus || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle(typeLabel)}`}>
                            {typeLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{m.location || "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                          {m.projectCost && m.projectCost > 0 ? shortCurrency(Number(m.projectCost), m.currency) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {m.directBeneficiaries && m.directBeneficiaries > 0 ? fmtInt(m.directBeneficiaries) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {m.approvalStatus === "pending" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              <Clock size={11} /> Pending
                            </span>
                          ) : m.approvalStatus === "approved" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={11} /> Approved
                            </span>
                          ) : m.approvalStatus === "rejected" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                              <XCircle size={11} /> Rejected
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/clubs/${clubId}/new-generation-service/${m.id}?yearId=${selectedYearId}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                            aria-label="View project"
                          >
                            <Eye size={13} />
                          </Link>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/new-generation-service/v2/${m.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              aria-label="Edit project"
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
                              aria-label="Delete project"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                        {isBotEnabled && installed === true && (
                          <td className="px-3 py-2 text-right">
                            {canSyncRow(m) && (
                              <button
                                type="button"
                                onClick={() => setSyncTarget(m)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-blue-700 hover:bg-blue-50"
                                aria-label="Add to Rotary Org"
                                title="Add to Rotary Org"
                              >
                                <Puzzle size={13} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8 /* Sr, Date, Title, Category, Type, Location, Cost, Direct Benf */
                          + 1 /* View — always visible */
                          + 1
                          + (canManage ? 2 /* Edit, Delete */ : 0)
                          + (isBotEnabled && installed === true ? 1 : 0)}
                        className="px-4 py-10 text-center text-slate-400"
                      >
                        {search ? "No projects match your search." : "No projects in this section."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
            <span>
              {totalCount} total project{totalCount === 1 ? "" : "s"} · {yearLabel}
              {search && ` · matching "${search}"`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Agree dialog (kept from v1 — required disclaimer before creating a project) */}
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
          title="Delete Project"
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

        {isBotEnabled && (
          <AddToOrgConfirmDialog
            open={!!syncTarget}
            onCancel={() => setSyncTarget(null)}
            onConfirm={handleSyncConfirm}
          />
        )}
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
