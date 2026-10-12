"use client";

/**
 * Community Service v2 listing — Community Service avenue.
 *
 * No dedicated v1 folder existed; the original module is served from the
 * unified projects page at /clubs/[id]/projects?module=community_service.
 *
 * Visuals mimic the Club Admin Dashboard's NonClubAvenueSection (KPI tiles,
 * One-time / Ongoing sub-tabs, project table, pending-approval banner).
 * Data still comes from the existing v1 API endpoints, scoped to
 * moduleKey="community_service".
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 *
 * Pagination, search, and Approval-Status column mirror v1 to keep parity
 * with the unified projects listing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  HeartHandshake, Users, IndianRupee, Loader2, Search, Plus, Edit3, Trash2,
  Download, ArrowLeft, AlertTriangle, Info, BadgeAlert, Clock, CheckCircle2, XCircle, Puzzle,
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
import { fmtInt, fmtDate, fmtInrShort } from "@/components/dashboard/formatters";
import { getCurrencySymbol } from "@/lib/currency";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";

const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const AGREE_MESSAGE = `The data I will enter is for a Community service project conducted by my club that has benefitted my community. E.g., Heart Surgeries, Tree Plantation, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

const PAGE_SIZE = 20;

function projectTypeChipStyle(t: string): string {
  const lo = (t || "").toLowerCase();
  if (lo.includes("one"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur") || lo.includes("ongoing")) return "bg-purple-50 text-purple-700 border-purple-200";
  if (lo.includes("annual")) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function projectTypeLabel(t: string | null | undefined): string {
  const lo = (t || "").toLowerCase();
  if (lo === "one_time")        return "One-time";
  if (lo === "ongoing_parent")  return "Ongoing";
  if (lo === "ongoing_instance") return "Recurring";
  if (lo === "ongoing_repeat")  return "Ongoing/Repeat";
  if (lo === "annual")          return "Annual";
  return t || "—";
}

function isPendingStatus(s: string | null | undefined): boolean {
  const lo = (s || "").toLowerCase();
  return lo === "pending" || lo === "draft" || lo === "rejected";
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string, includeStatus: boolean) {
  const header = ["Sr", "Date", "Title", "Type", "Area of Focus", "Cost", "Direct Beneficiaries", "Location"];
  if (includeStatus) header.push("Approval Status");
  const lines = rows.map((r, i) => {
    const dateStr = r.projectDate ? fmtDate(r.projectDate) : "";
    const row = [
      i + 1,
      `"${dateStr}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      `"${projectTypeLabel(r.projectType)}"`,
      `"${(r.areaOfFocusName || r.otherAreaOfFocus || "").replace(/"/g, '""')}"`,
      r.projectCost ?? "",
      r.directBeneficiaries ?? "",
      `"${(r.location || "").replace(/"/g, '""')}"`,
    ];
    if (includeStatus) row.push(`"${r.approvalStatus || ""}"`);
    return row.join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `community-service-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CommunityServiceV2Page() {
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
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
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
  const myListingUrl = `/clubs/${clubId}/community-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/community-service/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, modules] = await Promise.all([getClub(clubId), getModules()]);
        if (cancelled) return;
        setClubName(club.clubName);
        const mod = modules.find((m) => m.moduleKey === "community_service");
        if (mod) {
          setModuleId(mod.id);
          const projectYears = await getProjectYears(clubId, mod.id);
          if (cancelled) return;
          setYears(projectYears);
          const current = projectYears.find((y) => y.isCurrent);
          setSelectedYearId(current ? current.id : projectYears[0]?.id ?? null);
        }
        checkClubHasModerator(clubId).then((r) => { if (!cancelled) setHasModerator(r.hasModerator); }).catch(() => {});
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  // Server-side paginated + searched fetch — matches v1's getProjects() call.
  const fetchProjects = useCallback(async () => {
    if (!moduleId || !selectedYearId) return;
    setLoading(true);
    try {
      const result = await getProjects(clubId, moduleId, selectedYearId, page, PAGE_SIZE, search || undefined);
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

  // Reset to page 1 when year/sub-tab/search changes.
  useEffect(() => { setPage(1); }, [selectedYearId, subTab, search]);

  // Split rows by sub-tab (One-time vs Ongoing/Repeat).
  const visibleRows = useMemo(() => {
    if (subTab === "one_time") {
      return projects.filter((p) => (p.projectType || "").toLowerCase() === "one_time");
    }
    return projects.filter((p) => (p.projectType || "").toLowerCase() !== "one_time");
  }, [projects, subTab]);

  const pendingRows = useMemo(
    () => projects.filter((p) => isPendingStatus(p.approvalStatus)),
    [projects]
  );

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";

  // KPI tiles — page-scoped totals (totalCount is full DB count; KPIs reflect
  // what's loaded into the current page). v1 also doesn't aggregate across the
  // full DB, so this is parity. Man Hours is intentionally not surfaced because
  // ProjectListItem doesn't carry it.
  const totalProjectsForYear = totalCount;
  const totalBeneficiaries = projects.reduce((sum, p) => sum + (p.directBeneficiaries ?? 0), 0);
  const totalCost = projects.reduce((sum, p) => sum + (p.projectCost ?? 0), 0);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleSearch = () => { setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); };

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
      const payload = buildOrgExportFromDetail(detail, AVENUE_LABELS["community_service"], SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setErrorMessage("Failed to load project details for Rotary.org sync.");
    }
  };

  const renderApprovalBadge = (status: string | null | undefined) => {
    const lo = (status || "").toLowerCase();
    if (lo === "pending") return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
        <Clock className="h-3 w-3" /> Pending
      </span>
    );
    if (lo === "approved") return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
    if (lo === "rejected") return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-rose-100 text-rose-700 border-rose-200">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
    return <span className="text-slate-400 text-xs">—</span>;
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Community Service"
        pageSubtitle="Community service projects"
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
              <h1 className="text-lg font-semibold text-slate-800">Community Service Projects</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row — 3 tiles (Man Hours intentionally removed: ProjectListItem
            doesn't expose manHours, so showing a hard-coded 0 was misleading.
            The Club Admin dashboard's avenue-detail endpoint exposes it
            separately; revisit if needed.) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjectsForYear)} subtitle="Community Service" icon={HeartHandshake} color="green" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}    subtitle="Lives impacted (page)" icon={Users}      color="blue" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={fmtInrShort(totalCost)}        subtitle="Project investment (page)" icon={IndianRupee} color="gold" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Community Service</h3>
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
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
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
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => exportToCsv(visibleRows, yearLabel, clubName || "club", hasModerator)}
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
          {pendingRows.length > 0 && (
            <div className="border-b border-slate-100 bg-amber-50/40 divide-y divide-amber-100">
              {pendingRows.map((p) => (
                <div key={p.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-slate-700 truncate max-w-[280px]">{p.title}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                    <BadgeAlert size={10} /> {(p.approvalStatus || "pending").toLowerCase()}
                  </span>
                  <span className="text-slate-500 whitespace-nowrap">{fmtDate(p.projectDate)}</span>
                  {canManage && (
                    <Link
                      href={`/clubs/${clubId}/community-service/v2/${p.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
                      className="ml-auto inline-flex items-center gap-1 text-blue-700 hover:underline"
                    >
                      fix <Edit3 size={10} />
                    </Link>
                  )}
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
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Area of Focus</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    <th className="px-3 py-2.5 text-right">Direct Benf</th>
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">Status</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {isBotEnabled && installed === true && <th className="px-3 py-2.5 text-right w-16">Rotary.org</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((p, i) => {
                    const cost = Number(p.projectCost ?? 0);
                    const benf = Number(p.directBeneficiaries ?? 0);
                    const aof = p.areaOfFocusName || p.otherAreaOfFocus || "—";
                    return (
                      <tr key={p.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(p.projectDate)}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{p.title || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle(p.projectType)}`}>
                            {projectTypeLabel(p.projectType)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{aof}</td>
                        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{cost > 0 ? `${getCurrencySymbol(p.currency)}${cost.toLocaleString("en-IN")}` : "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{benf > 0 ? fmtInt(benf) : "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{renderApprovalBadge(p.approvalStatus)}</td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/community-service/v2/${p.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
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
                              onClick={() => setDeleteTarget(p)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                              aria-label="Delete project"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                        {isBotEnabled && installed === true && (
                          <td className="px-3 py-2 text-right">
                            {canSyncRow(p) && (
                              <button
                                type="button"
                                onClick={() => setSyncTarget(p)}
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
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={8 + (canManage ? 2 : 0) + (isBotEnabled && installed === true ? 1 : 0)} className="px-4 py-10 text-center text-slate-400">
                        {search ? "No projects match your search." : "No projects in this section."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between flex-wrap gap-2">
            <span>{totalCount} project{totalCount === 1 ? "" : "s"} · {yearLabel}</span>
          </div>

          {totalPages > 1 && (
            <div className="px-5 pb-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>

        {/* Agree dialog (required disclaimer before creating a project) */}
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
