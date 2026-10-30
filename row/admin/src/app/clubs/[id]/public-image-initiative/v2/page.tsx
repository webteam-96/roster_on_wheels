"use client";

/**
 * Public Image Initiative v2 listing.
 *
 * Visuals mirror the Club Admin Dashboard's NonClubAvenueSection (KPI tiles,
 * one-time/ongoing sub-tab strip, dense table with colored type chips). The
 * data still comes from the existing v1 API endpoints (getProjects +
 * getProjectYears + getClub).
 *
 * Preserved from v1:
 *   - Project type filter (all / one_time / ongoing_repeat).
 *   - Expandable-parent rows: ongoing parents collapse/expand to show child
 *     sub-projects (parent/child detected via parentProjectId).
 *   - I-Agree disclaimer dialog before opening Add.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Users, IndianRupee, Clock4, Loader2, Search, Plus, Edit3, Trash2,
  Download, ArrowLeft, AlertTriangle, Info, ChevronDown, ChevronRight,
  Eye, X, Puzzle,
} from "@/components/icons";
import {
  getClub,
  getModules,
  getProjects,
  deleteProject,
  getProjectYears,
  getProject,
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
import { getCurrencySymbol } from "@/lib/currency";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";

import { currencySymbol } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const MODULE_KEY = "public_image_initiative";

const AGREE_MESSAGE = `The data I will enter is for a Public Image Initiative conducted by my club. E.g., Hoardings, Marathons, Rotary Stories on News Papers / Radio / TV ads, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

// Type chip colors mirror the Club Admin dashboard NonClubAvenueSection palette.
function projectTypeChipStyle(t: string): string {
  switch ((t || "").toLowerCase()) {
    case "one_time":       return "bg-blue-50 text-blue-700 border-blue-200";
    case "ongoing_repeat": return "bg-violet-50 text-violet-700 border-violet-200";
    case "child":          return "bg-amber-50 text-amber-700 border-amber-200";
    default:               return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function shortCurrency(value: number, currency?: string | null): string {
  const symbol = getCurrencySymbol(currency);
  if (!value || value < 1000) return `${symbol}${value || 0}`;
  if (value >= 10000000) return `${symbol}${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000)   return `${symbol}${(value / 100000).toFixed(1)}L`;
  if (value >= 1000)     return `${symbol}${(value / 1000).toFixed(1)}K`;
  return `${symbol}${value}`;
}

// Short amount in the brand's currency ($4.9M style; the original used lakh / crore)
function shortInr(value: number): string {
  if (!value || value < 1000) return `${currencySymbol()}${value || 0}`;
  if (value >= 1e9) return `${currencySymbol()}${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${currencySymbol()}${(value / 1e6).toFixed(1)}M`;
  return `${currencySymbol()}${(value / 1000).toFixed(1)}K`;
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Title", "Type", "Category", "Location", "Cost"];
  const lines = rows.map((r, i) => {
    const typeLabel = r.projectType === "one_time" ? "One Time"
      : (r.parentProjectId != null && r.parentProjectId > 0) ? "Child"
      : "Ongoing";
    const dateStr = r.projectDate ? fmtDate(r.projectDate) : "";
    return [
      i + 1,
      `"${dateStr}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      `"${typeLabel}"`,
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
  a.download = `public-image-initiative-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PublicImageInitiativeV2Page() {
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
  // Server-side search (parity with v1) — typed into searchInput, committed to
  // search on Enter / button click. Without this, projects beyond the first
  // page are invisible to client-side filtering.
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Type filter preserved from v1.
  const [projectTypeFilter, setProjectTypeFilter] = useState<"all" | "one_time" | "ongoing_repeat">("all");
  // Sub-tab matches the Club Admin Dashboard NonClubAvenueSection design.
  const [subTab, setSubTab] = useState<"one_time" | "ongoing">("one_time");
  // Expandable ongoing parents (preserved from v1).
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());

  const [showAgreeDialog, setShowAgreeDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // RI Flow-Bot: push an EXISTING project to rotary.org (as opposed to the
  // add-page's auto-trigger right after a new project is saved).
  const installed = useExtensionStatus();
  const isBotEnabled = isFlowBotEnabled(clubId);
  const [syncTarget, setSyncTarget] = useState<ProjectListItem | null>(null);
  const canSync = isBotEnabled && installed === true && canManage;

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/public-image-initiative/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/public-image-initiative/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, modules] = await Promise.all([getClub(clubId), getModules()]);
        if (cancelled) return;
        setClubName(club.clubName);
        const mod = modules.find((m) => m.moduleKey === MODULE_KEY);
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
      // Parity with v1 — server-side pagination + SQL search across the
      // whole DB (anything beyond row 500 would otherwise be invisible).
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

  // Separate parent rows from child rows — child = parentProjectId set.
  const { parents, childrenByParent } = useMemo(() => {
    const parents: ProjectListItem[] = [];
    const map = new Map<number, ProjectListItem[]>();
    for (const p of projects) {
      const isChild = p.parentProjectId != null && p.parentProjectId > 0;
      if (isChild) {
        const arr = map.get(p.parentProjectId!) || [];
        arr.push(p);
        map.set(p.parentProjectId!, arr);
      } else {
        parents.push(p);
      }
    }
    return { parents, childrenByParent: map };
  }, [projects]);

  // Apply project-type filter on parents only (children always inherit their parent's visibility).
  const typeFilteredParents = useMemo(() => {
    if (projectTypeFilter === "all") return parents;
    return parents.filter((p) => p.projectType === projectTypeFilter);
  }, [parents, projectTypeFilter]);

  // Sub-tab partition (one-time vs ongoing_repeat parents).
  const subTabFilteredParents = useMemo(() => {
    return typeFilteredParents.filter((p) =>
      subTab === "one_time" ? p.projectType === "one_time" : p.projectType === "ongoing_repeat"
    );
  }, [typeFilteredParents, subTab]);

  // Search is server-side (passed to getProjects) — listing the sub-tab/type
  // filtered parents is the final visible set.
  const visible = subTabFilteredParents;

  const totalPages = Math.ceil(totalCount / pageSize);
  const handleSearchSubmit = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // Aggregate KPIs from the current year's projects (parents + children — every row counts).
  const totalProjects = projects.length;
  const totalBeneficiaries = projects.reduce((s, p) => s + (p.directBeneficiaries ?? 0), 0);
  const totalAmountSpent = projects.reduce((s, p) => s + (p.projectCost ?? 0), 0);
  // Man hours isn't on ProjectListItem; KPI tile preserved for visual parity but shows 0
  // unless backed by a future endpoint. (NonClubAvenueSection on the dashboard fetches
  // this from getServiceProjectsAvenue — but v2 reuses v1 list APIs only.)
  const totalManHours = 0;

  const toggleExpand = (projectId: number) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

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
      const payload = buildOrgExportFromDetail(detail, AVENUE_LABELS["public_image_initiative"], SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setErrorMessage("Failed to load project details for Rotary.org sync.");
    }
  };

  const renderRow = (project: ProjectListItem, index: number, isChild: boolean) => {
    const children = childrenByParent.get(project.id) || [];
    const childCount = children.length;
    const isOngoingParent = !isChild && project.projectType === "ongoing_repeat";
    const isExpanded = expandedParents.has(project.id);
    const typeChip = isChild
      ? <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle("child")}`}>Child</span>
      : project.projectType === "one_time"
        ? <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle("one_time")}`}>One Time</span>
        : (
          <button
            type="button"
            onClick={() => childCount > 0 && toggleExpand(project.id)}
            disabled={childCount === 0}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle("ongoing_repeat")} ${childCount > 0 ? "hover:brightness-95" : "cursor-default"}`}
          >
            Ongoing
            {childCount > 0 && (
              <>
                <span className="bg-[#17458F] text-white rounded-full px-1.5 py-0 text-[10px] ml-0.5">{childCount}</span>
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </>
            )}
          </button>
        );

    return (
      <tr key={project.id} className={isChild ? "bg-slate-50/60" : "hover:bg-blue-50/40"}>
        <td className="px-3 py-2 text-slate-500">{isChild ? "" : (page - 1) * pageSize + index + 1}</td>
        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(project.projectDate)}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {isChild && <span className="text-slate-400 ml-2">&#8627;</span>}
            <span className="font-medium text-slate-800">{project.title || "–"}</span>
          </div>
        </td>
        <td className="px-3 py-2">{typeChip}</td>
        <td className="px-3 py-2 text-slate-600">{project.areaOfFocusName || project.otherAreaOfFocus || "–"}</td>
        <td className="px-3 py-2 text-slate-600">{project.location || "–"}</td>
        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{project.projectCost ? shortCurrency(Number(project.projectCost), project.currency) : "–"}</td>
        {canManage && (
          <td className="px-3 py-2 text-right">
            <Link
              href={`/clubs/${clubId}/public-image-initiative/${project.id}?yearId=${selectedYearId}`}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
              aria-label="View project"
              title="View"
            >
              <Eye size={13} />
            </Link>
          </td>
        )}
        {canManage && (
          <td className="px-3 py-2 text-right">
            <Link
              href={`/clubs/${clubId}/public-image-initiative/v2/${project.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
              aria-label="Edit project"
              title="Edit"
            >
              <Edit3 size={13} />
            </Link>
          </td>
        )}
        {canManage && (
          <td className="px-3 py-2 text-right">
            <button
              type="button"
              onClick={() => setDeleteTarget(project)}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
              aria-label="Delete project"
            >
              <Trash2 size={13} />
            </button>
          </td>
        )}
        {isBotEnabled && installed === true && (
          <td className="px-3 py-2 text-right">
            {canSync && (
              <button
                type="button"
                onClick={() => setSyncTarget(project)}
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
  };

  const colCount = 7 + (canManage ? 3 : 0) + (isBotEnabled && installed === true ? 1 : 0);

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Public Image Initiative"
        pageSubtitle="Public Image projects"
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
              <h1 className="text-lg font-semibold text-slate-800">Public Image Initiative</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} &middot; {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjects)}            subtitle={`RY ${yearLabel}`}     icon={Briefcase}   color="blue" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}       subtitle="Lives impacted"        icon={Users}       color="green" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={shortInr(Number(totalAmountSpent))} subtitle="Project investment"  icon={IndianRupee} color="gold" />
          <KpiCard title="Man Hours"     value={fmtInt(totalManHours)}            subtitle="Volunteer time"        icon={Clock4}      color="purple" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Project Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">Hoardings, marathons, press, social posts &amp; more &middot; {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Sub-tabs (one-time / ongoing-repeat) */}
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => { setSubTab("one_time"); setPage(1); }}
                  className={`px-3 py-1.5 ${subTab === "one_time" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  One-time
                </button>
                <button
                  type="button"
                  onClick={() => { setSubTab("ongoing"); setPage(1); }}
                  className={`px-3 py-1.5 border-l border-slate-200 ${subTab === "ongoing" ? "bg-[#17458F] text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Ongoing-Repeat
                </button>
              </div>
              {/* Project type filter (preserved from v1 — chip-style tab strip) */}
              <select
                value={projectTypeFilter}
                onChange={(e) => { setProjectTypeFilter(e.target.value as "all" | "one_time" | "ongoing_repeat"); setPage(1); }}
                className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                <option value="all">All Types</option>
                <option value="one_time">One Time</option>
                <option value="ongoing_repeat">Ongoing / Repeat</option>
              </select>
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
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearchSubmit(); }}
                  className="pl-7 pr-7 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleSearchSubmit}
                className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => exportToCsv(visible, yearLabel, clubName || "club")}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download size={13} /> Export to Excel
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={handleAddClick}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Project
                </button>
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
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Title</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Category</th>
                    <th className="px-3 py-2.5 text-left">Location</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">View</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {isBotEnabled && installed === true && <th className="px-3 py-2.5 text-right w-16">Rotary.org</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((parent, i) => (
                    <Fragment key={parent.id}>
                      {renderRow(parent, i, false)}
                      {expandedParents.has(parent.id) && (childrenByParent.get(parent.id) || []).map((child) =>
                        renderRow(child, 0, true)
                      )}
                    </Fragment>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-10 text-center text-slate-400">
                        {search ? "No projects match your search." : "No projects in this section."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {visible.length} {subTab === "one_time" ? "one-time" : "ongoing"} project{visible.length === 1 ? "" : "s"} &middot; {yearLabel}
          </div>
        </div>

        {/* Server-side pagination (parity with v1) */}
        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Agree dialog */}
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
