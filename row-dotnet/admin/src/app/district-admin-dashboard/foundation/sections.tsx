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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FolderKanban, Calendar, Search, Plus, Edit3, Trash2, Loader2, AlertTriangle,
} from "lucide-react";
import {
  getDistrictProjects,
  deleteDistrictProject,
  getDistrictEventsList,
  deleteDistrictEventItem,
} from "@/services/api";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import { formatMoney } from "@/lib/currency";

import { appLocale, currencySymbol } from "@/lib/appFormat";
const PAGE_SIZE = 15;

// ── helpers ──────────────────────────────────────────────────────────────

function fmtDate(s?: string | null): string {
  if (!s) return "—";
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
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchData(); } }}
                className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Link
              href={addUrl}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus size={13} /> Add Project
            </Link>
          </div>
        </div>

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
                  <th className="px-3 py-2.5 text-left">Title</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">Cost ({currencySymbol()})</th>
                  <th className="px-3 py-2.5 text-center">Beneficiaries</th>
                  <th className="px-3 py-2.5 text-left">Area of Focus</th>
                  <th className="px-3 py-2.5 text-right w-16">Edit</th>
                  <th className="px-3 py-2.5 text-right w-16">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{item.title || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(item.projectDate)}</td>
                    <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                      {item.projectCost != null
                        ? formatMoney(item.projectCost, item.currency)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">{item.directBeneficiaries ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{item.areaOfFocusName || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/districts/${districtId}/projects/v2/${item.id}/edit?yearId=${yearId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                        aria-label="Edit project"
                      >
                        <Edit3 size={13} />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                        aria-label="Delete project"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-500">
            <Calendar size={16} />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Event Library</h3>
              <p className="text-xs text-slate-500 mt-0.5">Year is set by the topbar · search across titles</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchData(); } }}
                className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Link
              href={addUrl}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus size={13} /> Add Event
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading events…
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left w-10">Sr</th>
                  <th className="px-3 py-2.5 text-left">Title</th>
                  <th className="px-3 py-2.5 text-left">Event Date</th>
                  <th className="px-3 py-2.5 text-right w-16">Edit</th>
                  <th className="px-3 py-2.5 text-right w-16">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{item.title || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(item.eventDate)}</td>
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
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
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
