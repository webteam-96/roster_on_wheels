"use client";
import { DataTable } from "@/components/ui/data-table";
import { ToggleButton } from "@/components/ui/text-buttons";

/**
 * Community Service v2 listing — Community Service avenue.
 *
 * No dedicated v1 folder existed; the original module is served from the
 * unified projects page at /clubs/[id]/projects?module=community_service.
 *
 * Visuals mimic the Club Admin Dashboard's NonClubAvenueSection (KPI tiles,
 * One-time / Ongoing sub-tabs, project table).
 * Data still comes from the existing v1 API endpoints, scoped to
 * moduleKey="community_service".
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 *
 * Pagination and search mirror v1 to keep parity
 * with the unified projects listing.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { HeartHandshake, Users, IndianRupee, Search, Plus, Edit3, Trash2, Download, AlertTriangle, Info, Puzzle } from "@/components/icons";
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
import { fmtInt, fmtDate, fmtInrShort } from "@/components/dashboard/formatters";
import { getCurrencySymbol, moneyTotals } from "@/lib/currency";
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

import { appLocale } from "@/lib/appFormat";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import AgreeText from "@/components/AgreeText";
const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const AGREE_MESSAGE = `The data I will enter is for a Community service project conducted by my club that has benefitted my community. E.g., Heart Surgeries, Tree Plantation, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

const PAGE_SIZE = 20;

function projectTypeChipStyle(t: string): string {
  const lo = (t || "").toLowerCase();
  if (lo.includes("one"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur") || lo.includes("ongoing")) return "bg-slate-50 text-slate-700 border-slate-200";
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
  return t || "–";
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Title", "Type", "Area of Focus", "Cost", "Direct Beneficiaries", "Location"];
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
    return row.join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }) /* BOM: Excel reads UTF-8 */;
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
  const myListingUrl = `/clubs/${clubId}/community-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Carry the selected listing year through to the add page: the photo upload needs
  // it, or a past-year admin is refused the picture (see uploadProjectImage).
  const addUrl = `/clubs/${clubId}/community-service/v2/add?returnTo=${returnTo}${selectedYearId ? `&yearId=${selectedYearId}` : ""}`;

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

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // KPI tiles — page-scoped totals (totalCount is full DB count; KPIs reflect
  // what's loaded into the current page). v1 also doesn't aggregate across the
  // full DB, so this is parity. Man Hours is intentionally not surfaced because
  // ProjectListItem doesn't carry it.
  const totalProjectsForYear = totalCount;
  const totalBeneficiaries = projects.reduce((sum, p) => sum + (p.directBeneficiaries ?? 0), 0);
  const totalCost = moneyTotals(projects.map((p) => ({ amount: p.projectCost, currency: p.currency })));

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

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Community Service"
        pageSubtitle="Community service projects"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Community Service Projects" description={<>RY {yearLabel} · {clubName || "–"}</>} back={`/clubs/${clubId}/dashboard`} />

        {/* KPI row — 3 tiles (Man Hours intentionally removed: ProjectListItem
            doesn't expose manHours, so showing a hard-coded 0 was misleading.
            The Club Admin dashboard's avenue-detail endpoint exposes it
            separately; revisit if needed.) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjectsForYear)} subtitle="Community Service" icon={HeartHandshake} color="green" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}    subtitle="Lives impacted (page)" icon={Users}      color="blue" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={totalCost}        subtitle="Project investment (page)" icon={IndianRupee} color="gold" />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Community Service</h3>
              <p className="text-xs text-slate-500 mt-0.5">Project records · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Project type" className="flex gap-2">
                <ToggleButton pressed={subTab === "one_time"}
                  type="button"
                  onClick={() => setSubTab("one_time")}
                >
                  One time Project
                </ToggleButton>
                <ToggleButton pressed={subTab === "ongoing"}
                  type="button"
                  onClick={() => setSubTab("ongoing")}
                >
                  Ongoing/Repeat Projects
                </ToggleButton>
              </div>
              <NativeSelect
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                className="w-auto"
              >
                {years.length === 0 && <option value="">No years</option>}
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}{y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </NativeSelect>
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-7 pr-3 sm:w-48"
                />
              </div>
              <Button
                type="button"
                onClick={handleSearch}
                variant="outline" size="sm"
              >
                Search
              </Button>
              {search && (
                <Button
                  type="button"
                  onClick={clearSearch}
                  variant="outline" size="sm"
                >
                  Clear
                </Button>
              )}
              <Button
                type="button"
                onClick={() => exportToCsv(visibleRows, yearLabel, clubName || "club")}
                variant="outline" size="sm"
              >
                <Download size={13} /> Export CSV
              </Button>
              {canManage && (
                <Button
                  type="button"
                  onClick={handleAddClick}
                >
                  <Plus size={13} /> Add Project
                </Button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <SkeletonRows />
            ) : (
              <DataTable
                caption="Community service projects"
                card={false}
                className="[&_table]:min-w-[640px] md:[&_table]:min-w-full"
                rows={visibleRows}
                rowKey={(p) => p.id}
                empty={search ? "No projects match your search." : "No projects in this section."}
                columns={[
{ key: "sr", header: "Sr", className: "w-10 text-muted-foreground", cell: (p, i) => (page - 1) * PAGE_SIZE + i + 1 },
{ key: "date", header: "Date", className: "whitespace-nowrap", cell: (p, i) => fmtDate(p.projectDate) },
{ key: "title", header: "Title", className: "font-medium", cell: (p, i) => p.title || "–" },
{ key: "type", header: "Type", cell: (p, i) => (<>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${projectTypeChipStyle(p.projectType)}`}>
                            {projectTypeLabel(p.projectType)}
                          </span>
</>) },
{ key: "aof", header: "Area of Focus", cell: (p, i) => {
                    const aof = p.areaOfFocusName || p.otherAreaOfFocus || "–";
return (<span className="text-slate-600">{aof}</span>);
} },
{ key: "cost", header: "Cost", align: "right", className: "whitespace-nowrap", cell: (p, i) => {
                    const cost = Number(p.projectCost ?? 0);
return (<span className="text-slate-600 whitespace-nowrap">{cost > 0 ? `${getCurrencySymbol(p.currency)}${cost.toLocaleString(appLocale())}` : "–"}</span>);
} },
{ key: "benf", header: "Direct Benf", align: "right", cell: (p, i) => {
                    const benf = Number(p.directBeneficiaries ?? 0);
return (<span className="text-slate-600">{benf > 0 ? fmtInt(benf) : "–"}</span>);
} },
...(canManage ? [{ key: "edit", header: "Edit", align: "right" as const, className: "w-16", cell: (p: (typeof visibleRows)[number], i: number) => (<>
                            <Link
                              href={`/clubs/${clubId}/community-service/v2/${p.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
                              className="row-icon-btn"
                              aria-label="Edit project"
                            >
                              <Edit3 size={13} />
                            </Link>
</>) }, { key: "delete", header: "Delete", align: "right" as const, className: "w-16", cell: (p: (typeof visibleRows)[number], i: number) => (<>
                            <IconButton
                              type="button"
                              onClick={() => setDeleteTarget(p)}
                              className="hover:text-red-700"
                              aria-label="Delete project"
                            >
                              <Trash2 size={13} />
                            </IconButton>
</>) }] : []),
...(isBotEnabled && installed === true ? [{ key: "rotary", header: "Rotary.org", align: "right" as const, className: "w-16", cell: (p: (typeof visibleRows)[number], i: number) => (<>
                            {canSync && (
                              <IconButton
                                type="button"
                                onClick={() => setSyncTarget(p)}
                                
                                aria-label="Add to Rotary Org"
                                title="Add to Rotary Org"
                              >
                                <Puzzle size={13} />
                              </IconButton>
                            )}
</>) }] : []),
                ]}
              />
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
        </Card>

        {/* Agree dialog (required disclaimer before creating a project) */}
        <AlertModal
          open={showAgreeDialog}
          onOpenChange={(o) => !o && setShowAgreeDialog(false)}
          icon={Info}
          iconClassName="text-blue-500"
          title="I Agree"
          description={
            <div className="whitespace-pre-line text-sm text-muted-foreground">
              <AgreeText text={AGREE_MESSAGE} />
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
