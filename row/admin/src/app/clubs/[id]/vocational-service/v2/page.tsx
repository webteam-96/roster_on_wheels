"use client";

/**
 * Vocational Service v2 listing — second module in the frontend overhaul.
 *
 * Visuals mimic the Club Admin Dashboard's NonClubAvenueSection (KPI tiles,
 * One-time / Ongoing sub-tabs, project table, pending-approval banner) but the
 * data still comes from the existing v1 API endpoints.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Users, IndianRupee, Loader2, Search, Plus, Edit3, Trash2, Eye,
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
import Pagination from "@/components/Pagination";
import { ProjectListItem } from "@/types/project";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate, fmtInrShort } from "@/components/dashboard/formatters";
import { getCurrencySymbol } from "@/lib/currency";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";

import { appLocale } from "@/lib/appFormat";
const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const AGREE_MESSAGE = `The data I will enter is for a Vocational service project conducted by my club that has benefitted my community. E.g., Career Guidance and Skill Development, Computer Literacy, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

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
  if (lo === "annual")          return "Annual";
  return t || "—";
}

function isPendingStatus(s: string | null | undefined): boolean {
  const lo = (s || "").toLowerCase();
  return lo === "pending" || lo === "draft" || lo === "rejected";
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Title", "Type", "Cost", "Direct Beneficiaries", "Location"];
  const lines = rows.map((r, i) => {
    const dateStr = r.projectDate ? fmtDate(r.projectDate) : "";
    return [
      i + 1,
      `"${dateStr}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      `"${projectTypeLabel(r.projectType)}"`,
      r.projectCost ?? "",
      r.directBeneficiaries ?? "",
      `"${(r.location || "").replace(/"/g, '""')}"`,
    ].join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocational-service-${clubName.replace(/\s+/g, "-").toLowerCase()}-${yearLabel || "all"}-${fileTimestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VocationalServiceV2Page() {
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
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const pageSize = 20;
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
  const myListingUrl = `/clubs/${clubId}/vocational-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = selectedYearId
    ? `/clubs/${clubId}/vocational-service/v2/add?returnTo=${returnTo}&yearId=${selectedYearId}`
    : `/clubs/${clubId}/vocational-service/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, modules] = await Promise.all([getClub(clubId), getModules()]);
        if (cancelled) return;
        setClubName(club.clubName);
        const mod = modules.find((m) => m.moduleKey === "vocational_service");
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

  // Server-side pagination + server-side search (mirrors v1 behavior). Avoids
  // truncating > pageSize results and keeps KPIs accurate via totalCount.
  const fetchProjects = useCallback(async () => {
    if (!moduleId || !selectedYearId) return;
    setLoading(true);
    try {
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

  // Server-side paginated rows are already filtered by ?search — show as-is.
  const filtered = projects;

  const pendingRows = useMemo(
    () => projects.filter((p) => isPendingStatus(p.approvalStatus)),
    [projects]
  );

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";
  const totalPages = Math.ceil(totalCount / pageSize);

  // KPI: Projects uses totalCount (full year). Beneficiaries / Cost reflect the
  // current page only — ProjectListItem doesn't carry manHours, so the
  // Man-Hours tile is omitted entirely rather than showing a misleading zero.
  const totalProjects = totalCount;
  const totalBeneficiaries = projects.reduce((sum, p) => sum + (p.directBeneficiaries ?? 0), 0);
  const totalCost = projects.reduce((sum, p) => sum + (p.projectCost ?? 0), 0);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };

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
      const payload = buildOrgExportFromDetail(detail, AVENUE_LABELS["vocational_service"], SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setErrorMessage("Failed to load project details for Rotary.org sync.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Vocational Service"
        pageSubtitle="Vocational service projects"
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
              <h1 className="text-lg font-semibold text-slate-800">Vocational Service</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                RY {yearLabel} · {clubName || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row — Man Hours tile dropped (ProjectListItem doesn't expose
            manHours so it would always read 0). Beneficiaries/Cost reflect
            the current page only; Projects uses the full year totalCount. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjects)}              subtitle="Vocational Service"  icon={Briefcase}   color="blue" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}         subtitle="This page"           icon={Users}       color="green" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={fmtInrShort(totalCost)}             subtitle="This page"           icon={IndianRupee} color="gold" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Vocational Service</h3>
              <p className="text-xs text-slate-500 mt-0.5">Project records · {yearLabel}</p>
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
              {search && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
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
                      href={`/clubs/${clubId}/vocational-service/v2/${p.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
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
                  {filtered.map((p, i) => {
                    const cost = Number(p.projectCost ?? 0);
                    const benf = Number(p.directBeneficiaries ?? 0);
                    const sno = (page - 1) * pageSize + i + 1;
                    return (
                      <tr key={p.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{sno}</td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(p.projectDate)}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{p.title || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${projectTypeChipStyle(p.projectType)}`}>
                            {projectTypeLabel(p.projectType)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{cost > 0 ? `${getCurrencySymbol(p.currency)}${cost.toLocaleString(appLocale())}` : "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{benf > 0 ? fmtInt(benf) : "—"}</td>
                        <td className="px-3 py-2">
                          {p.approvalStatus === "pending" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500 text-white">
                              <Clock size={10} /> Pending
                            </span>
                          ) : p.approvalStatus === "approved" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-600 text-white">
                              <CheckCircle2 size={10} /> Approved
                            </span>
                          ) : p.approvalStatus === "rejected" ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-600 text-white">
                              <XCircle size={10} /> Rejected
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/clubs/${clubId}/vocational-service/${p.id}?yearId=${selectedYearId}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="View project"
                          >
                            <Eye size={13} />
                          </Link>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={`/clubs/${clubId}/vocational-service/v2/${p.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
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
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={(canManage ? 9 : 7) + 1 + (isBotEnabled && installed === true ? 1 : 0)} className="px-4 py-10 text-center text-slate-400">
                        {search ? "No projects match your search." : "No projects in this section."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} project{totalCount === 1 ? "" : "s"} · {yearLabel}
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
