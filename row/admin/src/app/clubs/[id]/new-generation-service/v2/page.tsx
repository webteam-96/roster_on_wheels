"use client";

/**
 * New Generation Service v2 listing — frontend overhaul, additive only.
 *
 * Visuals mimic NonClubAvenueSection from the Club Admin Dashboard's Service
 * Projects & Public Image page (KPI tiles, colored type chips, dense table)
 * but the data still comes from the existing v1 API endpoints
 * (getProjects + getProjectYears + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Briefcase, Users, IndianRupee, Clock4, Search, Plus, Edit3, Trash2, Download, AlertTriangle, Info, Eye, Puzzle } from "@/components/icons";
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
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { fileTimestamp } from "@/lib/dateUtils";
import { getCurrencySymbol, moneyTotals } from "@/lib/currency";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";

import { currencySymbol } from "@/lib/appFormat";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
import AgreeText from "@/components/AgreeText";
import { ToggleButton } from "@/components/ui/text-buttons"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const AGREE_MESSAGE = `The data I will enter is for a New generation Service Project conducted by my club that has benefitted my community. E.g., Formation of an Interact Club, Formation of a Rotaract Club, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

function projectTypeChipStyle(t: string): string {
  const lo = (t || "").toLowerCase();
  if (lo.includes("one"))    return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur"))  return "bg-slate-50 text-slate-700 border-slate-200";
  if (lo.includes("annual")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (lo.includes("ongoing")) return "bg-slate-50 text-slate-700 border-slate-200";
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
  if (!value || value < 1000) return `${currencySymbol()}${value || 0}`;
  if (value >= 10000000) return `${currencySymbol()}${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000)   return `${currencySymbol()}${(value / 100000).toFixed(1)}L`;
  if (value >= 1000)     return `${currencySymbol()}${(value / 1000).toFixed(1)}K`;
  return `${currencySymbol()}${value}`;
}

function exportToCsv(rows: ProjectListItem[], yearLabel: string, clubName: string) {
  const header = ["Sr", "Date", "Title", "Type", "Category", "Location", "Cost"];
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
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }) /* BOM: Excel reads UTF-8 */;
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
  const myListingUrl = `/clubs/${clubId}/new-generation-service/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Carry the selected listing year through to the add page: the photo upload needs
  // it, or a past-year admin is refused the picture (see uploadProjectImage).
  const addUrl = `/clubs/${clubId}/new-generation-service/v2/add?returnTo=${returnTo}${selectedYearId ? `&yearId=${selectedYearId}` : ""}`;

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

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "–";

  // KPIs computed from the current page only (server pagination means we don't
  // hold the full year in memory). `totalProjects` uses totalCount from the API
  // so it remains accurate across pages; the other KPIs are scoped to this page.
  const totalProjects     = totalCount;
  const totalBeneficiaries = projects.reduce((s, p) => s + (p.directBeneficiaries ?? 0), 0);
  const totalCost          = moneyTotals(projects.map((p) => ({ amount: p.projectCost, currency: p.currency })));
  // ProjectListItem doesn't carry manHours — KPI uses 0 unless backend later adds it.
  const totalManHours      = 0;

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
        <PageHeader title="New Generation Service" description={<>RY {yearLabel} · {clubName || "–"}</>} back={`/clubs/${clubId}/dashboard`} />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Projects"      value={fmtInt(totalProjects)}        subtitle="New Generation Service" icon={Briefcase}   color="blue" />
          <KpiCard title="Beneficiaries" value={fmtInt(totalBeneficiaries)}   subtitle="Lives impacted"         icon={Users}       color="green" />
          {/* Sums raw cost across rows regardless of currency — not currency-pure once
              mixed-currency projects exist on one page. Known limitation, not a bug. */}
          <KpiCard title="Amount Spent"  value={totalCost}  subtitle="Project investment"     icon={IndianRupee} color="gold" />
          <KpiCard title="Man Hours"     value={fmtInt(totalManHours)}        subtitle="Volunteer time"         icon={Clock4}      color="purple" />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">New Generation Service</h3>
              <p className="text-xs text-slate-500 mt-0.5">Project records · {yearLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Project type" className="flex flex-wrap gap-2">
                <ToggleButton
                  type="button"
                  onClick={() => setSubTab("one_time")}
                  pressed={subTab === "one_time"}>
                  One time Project
                </ToggleButton>
                <ToggleButton
                  type="button"
                  onClick={() => setSubTab("ongoing")}
                  pressed={subTab === "ongoing"}>
                  Ongoing/Repeat Projects
                </ToggleButton>
              </div>
              <NativeSelect
                value={selectedYearId ?? ""}
                onChange={(e) => { setSelectedYearId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
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
                  placeholder="Search title or location…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-7 pr-3 sm:w-56"
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
                onClick={() => exportToCsv(filtered, yearLabel, clubName || "club")}
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
              <Table className="min-w-[640px] md:min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-10">Sr</TableHead>
                    <TableHead className="text-left whitespace-nowrap">Date</TableHead>
                    <TableHead className="text-left">Title</TableHead>
                    <TableHead className="text-left">Category</TableHead>
                    <TableHead className="text-left">Type</TableHead>
                    <TableHead className="text-left">Location</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Direct Benf</TableHead>
                    <TableHead className="text-right w-16">View</TableHead>
                    {canManage && <TableHead className="text-right w-16">Edit</TableHead>}
                    {canManage && <TableHead className="text-right w-16">Delete</TableHead>}
                    {isBotEnabled && installed === true && <TableHead className="text-right w-16">Rotary.org</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m, i) => {
                    const typeLabel = m.projectType || "–";
                    return (
                      <TableRow key={m.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(m.projectDate)}</TableCell>
                        <TableCell className="font-medium">{m.title || "–"}</TableCell>
                        <TableCell>{m.areaOfFocusName || m.otherAreaOfFocus || "–"}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${projectTypeChipStyle(typeLabel)}`}>
                            {typeLabel}
                          </span>
                        </TableCell>
                        <TableCell>{m.location || "–"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {m.projectCost && m.projectCost > 0 ? shortCurrency(Number(m.projectCost), m.currency) : "–"}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.directBeneficiaries && m.directBeneficiaries > 0 ? fmtInt(m.directBeneficiaries) : "–"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/clubs/${clubId}/new-generation-service/${m.id}?yearId=${selectedYearId}`}
                            className="row-icon-btn"
                            aria-label="View project"
                          >
                            <Eye size={13} />
                          </Link>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Link
                              href={`/clubs/${clubId}/new-generation-service/v2/${m.id}/edit?returnTo=${returnTo}&yearId=${selectedYearId}`}
                              className="row-icon-btn"
                              aria-label="Edit project"
                            >
                              <Edit3 size={13} />
                            </Link>
                          </TableCell>
                        )}
                        {canManage && (
                          <TableCell className="text-right">
                            <IconButton
                              type="button"
                              onClick={() => setDeleteTarget(m)}
                              className="hover:text-red-700"
                              aria-label="Delete project"
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </TableCell>
                        )}
                        {isBotEnabled && installed === true && (
                          <TableCell className="text-right">
                            {canSync && (
                              <IconButton
                                type="button"
                                onClick={() => setSyncTarget(m)}
                                 aria-label="Add to Rotary Org"
                                title="Add to Rotary Org"
                              >
                                <Puzzle size={13} />
                              </IconButton>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8 /* Sr, Date, Title, Category, Type, Location, Cost, Direct Benf */
                          + 1 /* View: always visible */
                          + (canManage ? 2 /* Edit, Delete */ : 0)
                          + (isBotEnabled && installed === true ? 1 : 0)} className="py-10 text-center text-muted-foreground"
                      >
                        {search ? "No projects match your search." : "No projects in this section."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-500">
            <span>
              {totalCount} total project{totalCount === 1 ? "" : "s"} · {yearLabel}
              {search && ` · matching "${search}"`}
            </span>
          </div>
          {totalPages > 1 && <div className="px-5 py-3 border-t border-slate-100"><Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} /></div>}
        </Card>

        {/* Agree dialog (kept from v1 — required disclaimer before creating a project) */}
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
