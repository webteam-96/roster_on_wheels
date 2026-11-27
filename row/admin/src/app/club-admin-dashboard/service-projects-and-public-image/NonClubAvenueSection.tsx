"use client";

import { LinkButton, ToggleButton } from "@/components/ui/text-buttons";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Users,
  Clock4,
  Search,
  Edit3,
  Trash2,
  Eye,
  Puzzle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import AlertModal from "@/components/AlertModal";
import AddToOrgConfirmDialog from "@/components/AddToOrgConfirmDialog";
import AgreeAddButton from "@/components/AgreeAddButton";
import { AGREE_MESSAGES } from "@/lib/agreeMessages";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, AVENUE_LABELS, buildOrgExportFromDetail, triggerAddToOrg } from "@/lib/addToOrg";
import { deleteProject, getProject, resetRotaryOrgSync } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { shortMoney } from "@/lib/currency";
import type { ServiceProjectsAvenueDetailResponse, ServiceProjectsProjectRow } from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import Pagination from "@/components/Pagination";
import { SYNC_API_URL, SLUG_MAP, projectTypeChipStyle, moneyIcon } from "./spiHelpers";

export function useAvenuePermissions(
  clubId: number,
  selectedYearId: number | null | undefined,
  availableYears: { id: number; yearLabel: string }[],
) {
  const { user, isSuperAdmin } = useAuth();
  const rights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const canManage = canEditYear(rights, selectedYearId, isSuperAdmin);
  return {
    canManage,
    canView: true,
    editableYears: heldYearLabels(rights, availableYears.map((y) => ({ id: y.id, label: y.yearLabel }))),
    viewingYearLabel: availableYears.find((y) => y.id === selectedYearId)?.yearLabel,
  };
}

export function NonClubAvenueSection({
  data, yearId, clubId, onRefresh,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  clubId: number;
  onRefresh: () => Promise<void> | void;
}) {
  const { canManage, editableYears, viewingYearLabel } =
    useAvenuePermissions(clubId, data.selectedYearId ?? yearId, data.availableYears);
  const k = data.kpis;
  const [subTab, setSubTab] = useState<"one_time" | "ongoing">("one_time");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const PAGE_SIZE = 20;
  const [deleteTarget, setDeleteTarget] = useState<ServiceProjectsProjectRow | null>(null);
  // Read-only popup with every field and every photo of the project (user 2026-10-05).
  const [viewTarget, setViewTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Shown as a page-level overlay between "user confirms Delete" and "list refresh done"
  // so the user sees a spinner rather than a silent gap while the API call + refetch run.
  const [isDeleting, setIsDeleting] = useState(false);

  // ── RI Flow-Bot: per-project "Add to Rotary.org" sync (Thane City View only) ──
  // Mirrors the /clubs/[id]/…/v2 listing's sync button so club admins can push a
  // project to Rotary.org straight from this dashboard listing.
  const installed = useExtensionStatus();
  const { isSuperAdmin } = useAuth();
  const avenueLabel = AVENUE_LABELS[data.avenueKey];
  // Column renders only when the extension is installed,
  // on avenues the extension understands.
  // Sync button: extension installed + an avenue the extension understands.
  // Reset: SuperAdmin only, and it must work WITHOUT the extension - support clears the flag from
  // their own machine after a club reports a project that reads "Synced" but never reached
  // Rotary.org (user 2026-10-05). So the column also opens for a SuperAdmin.
  const canSync = isFlowBotEnabled(clubId) && installed === true && !!avenueLabel;
  const syncColumnVisible = canSync || (isSuperAdmin && !!avenueLabel);
  const [syncTarget, setSyncTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<ServiceProjectsProjectRow | null>(null);
  const [resetting, setResetting] = useState(false);

  const handleSyncConfirm = async () => {
    const target = syncTarget;
    setSyncTarget(null); // close dialog first — see AddToOrgConfirmDialog pointer-events note
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!target || !effectiveYearId || !avenueLabel) return;
    try {
      const detail = await getProject(clubId, effectiveYearId, target.id);
      const payload = buildOrgExportFromDetail(detail, avenueLabel, SYNC_API_URL);
      setTimeout(() => triggerAddToOrg(target.id, payload, clubId), 0);
    } catch {
      setSyncError("Failed to load project details for Rotary.org sync.");
    }
  };

  // SuperAdmin clears the flag; the row goes back to "Sync" and the club can send it again. The
  // confirm box warns about the duplicate, because Rotary.org has no update - a second sync of a
  // project that WAS published creates a second initiative there.
  const handleResetConfirm = async () => {
    const target = resetTarget;
    if (!target) return;
    setResetting(true);
    try {
      await resetRotaryOrgSync(target.id, clubId);
      setResetTarget(null);
      await onRefresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setSyncError(e?.response?.data?.message || "Could not reset the sync status.");
    } finally { setResetting(false); }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const effectiveYearId = data.selectedYearId ?? yearId ?? 0;
    if (!effectiveYearId) {
      setDeleteError("Could not resolve the Rotary year for this record.");
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProject(clubId, effectiveYearId, deleteTarget.id);
      setDeleteTarget(null);
      await onRefresh();
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setDeleteError(err?.response?.data?.message || "Failed to delete project.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Per user spec (2026-06-10): only Community Service + Public Image have a
  // meaningful one-time-vs-ongoing distinction. Vocational, International,
  // New Generation are meeting-style avenues — hide the filter chip + the
  // "Type" column for them. DB values stay intact (cleanup deferred).
  const showTypeFilter =
    data.avenueKey === "community_service" ||
    data.avenueKey === "public_image_initiative";

  // Ongoing list now contains parents + children (from backend). Split them
  // here so the table renders parents with an expand-toggle and groups
  // children underneath their parent. Matches V1 /clubs/[id]/projects layout.
  const ongoingParents = data.ongoingProjects.filter(
    (r) => !(r.parentProjectId != null && r.parentProjectId > 0),
  );
  const ongoingChildMap = new Map<number, ServiceProjectsProjectRow[]>();
  for (const r of data.ongoingProjects) {
    if (r.parentProjectId != null && r.parentProjectId > 0) {
      const arr = ongoingChildMap.get(r.parentProjectId) ?? [];
      arr.push(r);
      ongoingChildMap.set(r.parentProjectId, arr);
    }
  }

  // Source rows for the current sub-tab (PARENTS only — children expand inline).
  const rows = showTypeFilter
    ? (subTab === "one_time" ? data.oneTimeProjects : ongoingParents)
    : [...data.oneTimeProjects, ...ongoingParents];
  const filtered = useMemo<ServiceProjectsProjectRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Reset to page 1 when filter inputs or sub-tab change
  useEffect(() => { setPage(1); }, [search, subTab, data.selectedYearId, data.avenueKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const toggleExpand = (parentId: number) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  // Encode the avenue tab key in returnTo so V2 form Save/Back returns here.
  const returnTo = encodeURIComponent(
    `/club-admin-dashboard/service-projects-and-public-image?tab=${data.avenueKey}`,
  );
  const slug = SLUG_MAP[data.avenueKey] ?? "projects";
  // The year goes with it: the photo upload needs it, or a past-year admin is
  // allowed to add the project but refused its picture (uploadProjectImage).
  const addUrl = `/clubs/${clubId}/${slug}/add?returnTo=${returnTo}${(data.selectedYearId ?? yearId) ? `&yearId=${data.selectedYearId ?? yearId}` : ""}`;

  return (
    <div className="space-y-5">
      {!canManage && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Projects"      value={fmtInt(k.projects ?? 0)}                  subtitle={data.avenueName}     icon={Briefcase}   color="blue" />
        <KpiCard title="Beneficiaries" value={fmtInt(k.beneficiaries ?? 0)}             subtitle="Lives impacted"      icon={Users}       color="green" />
        <KpiCard title="Amount Spent"  value={shortMoney(Number(k.amountSpent ?? 0), data.targetCurrency)}     subtitle="Project investment"  icon={moneyIcon(data.targetCurrency)} color="gold" />
        <KpiCard title="Man Hours"     value={fmtInt(k.manHours ?? 0)}                  subtitle="Volunteer time"      icon={Clock4}      color="purple" />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">{data.avenueName}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Project records · {data.selectedYearLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showTypeFilter && (
              <div role="group" aria-label="Project type"
                className="inline-flex rounded-full overflow-hidden text-xs p-1 gap-1 bg-muted"
              >
                <ToggleButton pressed={subTab === "one_time"}
                  onClick={() => setSubTab("one_time")}
                >
                  One time Project
                </ToggleButton>
                <ToggleButton pressed={subTab === "ongoing"}
                  onClick={() => setSubTab("ongoing")}
                >
                  Ongoing/Repeat Projects
                </ToggleButton>
              </div>
            )}
            {/* Local YearSelect removed — use global topbar year selector. */}
            <SearchBox value={search} onChange={setSearch} />
            {canManage && (
              <AgreeAddButton message={AGREE_MESSAGES[data.avenueKey] ?? ""} href={addUrl} label="Add Project" />
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="w-full min-w-[640px] md:min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3 text-left w-10">Sr</TableHead>
                <TableHead className="px-3 text-left whitespace-nowrap">Date</TableHead>
                <TableHead className="px-3 text-left">Title</TableHead>
                {showTypeFilter && <TableHead className="px-3 text-left">Type</TableHead>}
                <TableHead className="px-3 text-right">Cost</TableHead>
                <TableHead className="px-3 text-right">Direct Benf</TableHead>
                <TableHead className="px-3 text-right">Man Hours</TableHead>
                {/* One actions column. Delete used to be its own <TableHead>, which left a
                    header with nothing under it whenever the year was read-only. */}
                <TableHead className="px-3 text-right w-24 whitespace-nowrap">Actions</TableHead>
                {syncColumnVisible && <TableHead className="px-3 text-right w-16">Rotary.org</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {visibleRows.flatMap((r, i) => {
                const children = ongoingChildMap.get(r.id) ?? [];
                const isOngoingParent =
                  showTypeFilter &&
                  subTab === "ongoing" &&
                  (r.parentProjectId == null || r.parentProjectId === 0);
                const childCount = isOngoingParent ? children.length : 0;
                const isExpanded = expandedParents.has(r.id);

                const parentRow = (
                  <TableRow key={r.id} className="hover:bg-blue-50/40">
                    <TableCell className="px-3 py-2 text-slate-500">{r.sr ?? (safePage - 1) * PAGE_SIZE + i + 1}</TableCell>
                    <TableCell className="px-3 py-2 text-slate-700 whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    <TableCell className="px-3 py-2 font-medium text-slate-800">
                      {r.title || "–"}
                    </TableCell>
                    {showTypeFilter && (
                      <TableCell className="px-3 py-2">
                        {isOngoingParent ? (
                          <ToggleButton pressed={isExpanded} className="h-7 px-2 text-xs"
                            type="button"
                            onClick={() => childCount > 0 && toggleExpand(r.id)}
                            disabled={childCount === 0}
                          >
                            Ongoing
                            {childCount > 0 && (
                              <>
                                <span className="bg-emerald-600 text-white rounded px-1.5 py-0 text-[10px] ml-0.5">{childCount}</span>
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </>
                            )}
                          </ToggleButton>
                        ) : (
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${projectTypeChipStyle(r.type)}`}>
                            {r.type}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{r.cost > 0 ? shortMoney(Number(r.cost), r.currency) : "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-right text-slate-600">{r.directBeneficiaries > 0 ? fmtInt(r.directBeneficiaries) : "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-right text-slate-600">{r.manHours > 0 ? fmtInt(r.manHours) : "–"}</TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* View is always offered — a year you cannot edit is still a
                            year you can read. Opens in place so the year selector and
                            filters stay as the context you are reading the row in. */}
                        <IconButton
                          type="button"
                          onClick={() => setViewTarget(r)}
                          title="View"
                        >
                          <Eye size={14} />
                        </IconButton>
                        {canManage && (
                          <Link
                            href={`/clubs/${clubId}/${slug}/${r.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                            className="row-icon-btn"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </Link>
                        )}
                        {canManage && (
                          <IconButton
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            className="hover:text-red-700"
                            title="Delete"
                            aria-label="Delete project"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </div>
                    </TableCell>
                    {syncColumnVisible && (
                      <TableCell className="px-3 py-2 text-right">
                        {r.syncedToOrg ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700"
                              title="Marked as added to Rotary International's Service Project Center"
                            >
                              <CheckCircle2 size={12} /> Synced
                            </span>
                            {/* SuperAdmin only: clear the flag so the club can sync again. A club
                                admin who finds a project marked Synced that never reached
                                Rotary.org calls support, and support resets it here. */}
                            {isSuperAdmin && (
                              <IconButton
                                type="button"
                                onClick={() => setResetTarget(r)}
                                aria-label="Reset sync status"
                                title="Reset sync status (SuperAdmin)"
                              >
                                <RotateCcw size={13} />
                              </IconButton>
                            )}
                          </span>
                        ) : canSync ? (
                          <LinkButton size="sm"
                            type="button"
                            onClick={() => setSyncTarget(r)}
                            aria-label="Sync to Rotary Org"
                            title="Sync to Rotary Org"
                          >
                            <Puzzle size={12} /> Sync
                          </LinkButton>
                        ) : (
                          <span className="text-xs text-slate-300">–</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );

                if (!isOngoingParent || !isExpanded || childCount === 0) return [parentRow];

                const childRows = children.map((c) => (
                  <TableRow key={`child-${c.id}`} className="bg-slate-50/60 hover:bg-blue-50/40">
                    <TableCell className="px-3 py-2 text-slate-400"></TableCell>
                    <TableCell className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(c.date)}</TableCell>
                    <TableCell className="px-3 py-2 text-slate-700">
                      <span className="text-slate-400 mr-1">↳</span>{c.title || "–"}
                    </TableCell>
                    {showTypeFilter && (
                      <TableCell className="px-3 py-2">
                        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                          Child
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{c.cost > 0 ? shortMoney(Number(c.cost), c.currency) : "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-right text-slate-500">{c.directBeneficiaries > 0 ? fmtInt(c.directBeneficiaries) : "–"}</TableCell>
                    <TableCell className="px-3 py-2 text-right text-slate-500">{c.manHours > 0 ? fmtInt(c.manHours) : "–"}</TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* View is always offered — a year you cannot edit is still a
                            year you can read. Opens in place so the year selector and
                            filters stay as the context you are reading the row in. */}
                        <IconButton
                          type="button"
                          onClick={() => setViewTarget(c)}
                          title="View"
                        >
                          <Eye size={14} />
                        </IconButton>
                        {canManage && (
                          <Link
                            href={`/clubs/${clubId}/${slug}/${c.id}/edit?returnTo=${returnTo}&yearId=${data.selectedYearId ?? yearId ?? ""}`}
                            className="row-icon-btn"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </Link>
                        )}
                        {canManage && (
                          <IconButton
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            className="hover:text-red-700"
                            title="Delete"
                            aria-label="Delete project"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </div>
                    </TableCell>
                    {syncColumnVisible && (
                      <TableCell className="px-3 py-2 text-right">
                        {c.syncedToOrg ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700"
                              title="Marked as added to Rotary International's Service Project Center"
                            >
                              <CheckCircle2 size={12} /> Synced
                            </span>
                            {/* SuperAdmin only: clear the flag so the club can sync again. A club
                                admin who finds a project marked Synced that never reached
                                Rotary.org calls support, and support resets it here. */}
                            {isSuperAdmin && (
                              <IconButton
                                type="button"
                                onClick={() => setResetTarget(c)}
                                aria-label="Reset sync status"
                                title="Reset sync status (SuperAdmin)"
                              >
                                <RotateCcw size={13} />
                              </IconButton>
                            )}
                          </span>
                        ) : canSync ? (
                          <LinkButton size="sm"
                            type="button"
                            onClick={() => setSyncTarget(c)}
                            aria-label="Sync to Rotary Org"
                            title="Sync to Rotary Org"
                          >
                            <Puzzle size={12} /> Sync
                          </LinkButton>
                        ) : (
                          <span className="text-xs text-slate-300">–</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ));
                return [parentRow, ...childRows];
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={syncColumnVisible ? 11 : 10} className="px-4 py-8 text-center text-slate-400">No projects in this section.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-100"><Pagination page={safePage} totalPages={totalPages} totalCount={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
        )}
      </Card>

      <ProjectDetailModal
        clubId={clubId}
        yearId={Number(data.selectedYearId ?? yearId ?? 0)}
        projectId={viewTarget?.id ?? null}
        onClose={() => setViewTarget(null)}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Project"
        description={<>
          Are you sure you want to delete this project
          {deleteTarget?.title ? <>: <span className="font-semibold text-foreground">{deleteTarget.title}</span></> : null}?
          This action cannot be undone.
        </>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleConfirmDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      {deleteError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {deleteError}
          <LinkButton className="ml-2" onClick={() => setDeleteError(null)}>Dismiss</LinkButton>
        </div>
      )}

      {isDeleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40">
          <div className="flex items-center gap-3 rounded-lg bg-card px-5 py-4 shadow-xl">
            <RotaryLoader size="sm" />
            <span className="text-sm font-semibold text-slate-700">Deleting…</span>
          </div>
        </div>
      )}

      {/* RI Flow-Bot: confirm before handing the project to the extension. */}
      {/* SuperAdmin reset confirm. Spelled out because a reset + re-sync puts a SECOND
          initiative on Rotary.org when the first one really was published - support has to
          check there before confirming. */}
      {resetTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="row-h2">Reset the Rotary.org sync status?</h3>
                <p className="mt-1 text-sm text-slate-600 break-words">
                  <span className="font-medium">{resetTarget.title || "This project"}</span> is marked{" "}
                  <span className="font-medium text-emerald-700">Synced</span>. Resetting puts the{" "}
                  <span className="font-medium">Sync</span> button back so the club can send it to
                  Rotary.org again.
                </p>
                <p className="mt-2 text-sm font-medium text-rose-700">
                  Check on Rotary.org first. If the project is already published there, syncing again
                  creates a duplicate that the club has to delete on Rotary.org.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline"
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleResetConfirm}
                disabled={resetting}
                variant="outline"
              >
                {resetting ? "Resetting…" : "OK, reset"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AddToOrgConfirmDialog
        open={!!syncTarget}
        onCancel={() => setSyncTarget(null)}
        onConfirm={handleSyncConfirm}
      />

      {syncError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 shadow-lg">
          {syncError}
          <LinkButton className="ml-2" onClick={() => setSyncError(null)}>Dismiss</LinkButton>
        </div>
      )}
    </div>
  );
}

// ── Small shared bits ──────────────────────────────────────────────────

export function YearSelect({
  data, yearId, onYearChange,
}: {
  data: ServiceProjectsAvenueDetailResponse;
  yearId: number | null;
  onYearChange: (id: number | null) => void;
}) {
  return (
    <NativeSelect
      value={yearId ?? data.selectedYearId ?? ""}
      onChange={(e) => onYearChange(e.target.value ? Number(e.target.value) : null)}
      className="w-auto"
    >
      {data.availableYears.length === 0 && <option value="">No years</option>}
      {data.availableYears.map((y) => (
        <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " · current" : ""}</option>
      ))}
    </NativeSelect>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="relative">
      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input
        type="text"
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7 pr-3 w-44"
      />
    </div>
  );
}
