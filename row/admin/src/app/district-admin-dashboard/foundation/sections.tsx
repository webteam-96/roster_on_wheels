"use client";

/**
 * district-admin-dashboard/foundation/sections.tsx
 * --------------------------------------------------------------------------
 * Inline listing sections rendered inside the two Foundation tabs (District
 * Projects / District Events).
 *
 * Each section:
 *   - Owns its own fetch loop (list + count) via the district APIs.
 *   - Renders a compact card: year selector + search + +Add button + table +
 *     pagination + delete-confirm modal.
 *   - Deep-links +Add and Edit to the standalone v2 add/edit pages with
 *     ?returnTo=<foundation URL including yearId>. Cancel / Save / Delete /
 *     Back on those pages all land back on Foundation with the same yearId.
 *
 * Sections do NOT render their own shell / back button — the parent Foundation
 * page already has DashboardShell + SectionHeader.
 */

import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  FolderKanban, Calendar, Search, Plus, Edit3, Trash2, Loader2, AlertTriangle, Eye,
} from "@/components/icons";
import {
  getDistrictProjects,
  deleteDistrictProject,
  getDistrictEventsList,
  deleteDistrictEventItem,
} from "@/services/api";
import AlertModal from "@/components/AlertModal";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import { formatMoney } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
const PAGE_SIZE = 15;

// ── helpers ──────────────────────────────────────────────────────────────

function fmtDate(s?: string | null): string {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleDateString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return s; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. District Projects
// ═══════════════════════════════════════════════════════════════════════════

interface ProjectItem {
  id: number;
  title?: string | null;
  projectDate?: string | null;
  projectCost?: number | null;
  currency?: string | null;
  directBeneficiaries?: number | null;
  areaOfFocusName?: string | null;
}

export function DistrictProjectsSection({
  districtId,
  yearId,
  returnTo,
}: {
  districtId: number;
  /** Numeric rotary year id from the global topbar year selector.
   *  0 = unresolved (fetch skipped until it arrives). */
  yearId: number;
  returnTo: string;
}) {
  // District projects and events belong to the Rotary year on screen, which the
  // dashboard's year selector passes in as `yearId`.
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const { years: rotaryYears } = useRotaryYears();
  const fRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYear(fRights, yearId || undefined, isSuperAdmin);
  const editableYears = heldYearLabels(fRights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));

  const [items, setItems] = useState<ProjectItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  const addUrl = `/districts/${districtId}/projects/v2/add${qs}`;

  // Reset to first page whenever the global year changes.
  useEffect(() => { setPage(1); }, [yearId]);

  const fetchData = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictProjects(districtId, {
        yearId,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items || []);
      setTotalCount(res.totalCount || 0);
    } catch {
      setItems([]); setTotalCount(0);
    } finally { setLoading(false); }
  }, [districtId, yearId, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictProject(districtId, yearId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Project deleted.");
      fetchData();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {!canManage && (
        <ViewOnlyBadge editableYears={editableYears} className="mb-4" />
      )}

      <div className="bg-card rounded-2xl border border-slate-200 overflow-hidden">
        {/* Card header */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-500">
            <FolderKanban size={16} />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Project Library</h3>
              <p className="text-xs text-slate-500 mt-0.5">Year is set by the topbar · search across titles</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchData(); } }}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-52 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            {canManage && (
              <Link
                href={addUrl}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
              >
                <Plus size={13} /> Add Project
              </Link>
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
                  <th className="px-3 py-2.5 text-left">Title</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">Cost ({currencySymbol()})</th>
                  <th className="px-3 py-2.5 text-center">Beneficiaries</th>
                  <th className="px-3 py-2.5 text-left">Area of Focus</th>
                  <th className="px-3 py-2.5 text-right w-24 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{item.title || "–"}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(item.projectDate)}</td>
                    <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                      {item.projectCost != null
                        ? formatMoney(item.projectCost, item.currency)
                        : "–"}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">{item.directBeneficiaries ?? "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{item.areaOfFocusName || "–"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* View for everyone: a year you cannot edit is still one you can read (ROW-67). */}
                        <button
                          type="button"
                          onClick={() => setViewId(item.id)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-teal-700 hover:bg-teal-50"
                          aria-label="View project"
                          title="View"
                        >
                          <Eye size={13} />
                        </button>
                        {canManage && (<>
                        <Link
                          href={`/districts/${districtId}/projects/v2/${item.id}/edit?yearId=${yearId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                          aria-label="Edit project"
                        >
                          <Edit3 size={13} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                          aria-label="Delete project"
                        >
                          <Trash2 size={13} />
                        </button>
                        </>)}
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      {!yearId
                        ? "Waiting for year selection…"
                        : search
                          ? "No projects match your search."
                          : "No projects for the selected year. Click \"Add Project\" to create one."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          Showing {items.length} of {totalCount}
        </div>
      </div>

      {!loading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      <ProjectDetailModal
        clubId={0}
        districtId={districtId}
        yearId={yearId}
        projectId={viewId}
        onClose={() => setViewId(null)}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Project"
        description={
          <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title || "this project"}</span>? This action cannot be undone.</>
        }
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. District Events
// ═══════════════════════════════════════════════════════════════════════════

interface EventItem {
  id: number;
  title: string | null;
  eventDate: string | null;
}

export function DistrictEventsSection({
  districtId,
  yearId,
  returnTo,
}: {
  districtId: number;
  /** Numeric rotary year id from the global topbar year selector.
   *  0 = unresolved (fetch skipped until it arrives). */
  yearId: number;
  returnTo: string;
}) {
  // District projects and events belong to the Rotary year on screen, which the
  // dashboard's year selector passes in as `yearId`.
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const { years: rotaryYears } = useRotaryYears();
  const fRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYear(fRights, yearId || undefined, isSuperAdmin);
  const editableYears = heldYearLabels(fRights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));

  const [items, setItems] = useState<EventItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EventItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  const addUrl = `/districts/${districtId}/district-events/v2/add${qs}`;

  useEffect(() => { setPage(1); }, [yearId]);

  const fetchData = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictEventsList(districtId, {
        yearId,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items || []);
      setTotalCount(res.totalCount || 0);
    } catch {
      setItems([]); setTotalCount(0);
    } finally { setLoading(false); }
  }, [districtId, yearId, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictEventItem(districtId, yearId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Event deleted.");
      fetchData();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-500">
            <Calendar size={16} />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Event Library</h3>
              <p className="text-xs text-slate-500 mt-0.5">Year is set by the topbar · search across titles</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchData(); } }}
                className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-52 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            {canManage && (
              <Link
                href={addUrl}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
              >
                <Plus size={13} /> Add Event
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonRows />
          ) : (
            <table className="w-full min-w-[640px] md:min-w-full text-sm">
              <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr>
                  <th className="px-3 py-2.5 text-left w-10">Sr</th>
                  <th className="px-3 py-2.5 text-left">Title</th>
                  <th className="px-3 py-2.5 text-left">Event Date</th>
                  {canManage && <th className="px-3 py-2.5 text-right w-20 whitespace-nowrap">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{item.title || "–"}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(item.eventDate)}</td>
                    {canManage && (<>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/districts/${districtId}/district-events/v2/${item.id}/edit?yearId=${yearId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                          aria-label="Edit event"
                        >
                          <Edit3 size={13} />
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                          aria-label="Delete event"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>

                    </>)}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="px-4 py-10 text-center text-slate-400">
                      {!yearId
                        ? "Waiting for year selection…"
                        : search
                          ? "No events match your search."
                          : "No events for the selected year. Click \"Add Event\" to create one."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          Showing {items.length} of {totalCount}
        </div>
      </div>

      {!loading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Event"
        description={
          <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title || "this event"}</span>? This action cannot be undone.</>
        }
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
