"use client";

/**
 * District Projects V2 — listing.
 *
 * Same data semantics as v1 (src/app/districts/[id]/projects/page.tsx):
 * every API call, every filter, every pagination behaviour preserved.
 * Only the chrome changes — wrapped in DistrictAdminShell so the DA sidebar
 * is present, and the table + delete flow reuse the club-documents v2
 * pattern (dense table, chip actions, AlertModal confirm).
 *
 * v2 reads / writes `?returnTo=` per the shell contract. Default fallback for
 * add + edit links is `/districts/{districtId}/projects/v2` (self URL).
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Search, Edit3, Trash2, AlertTriangle, Loader2, FolderKanban,
} from "@/components/icons";
import {
  getDistrict,
  getDistrictProjects,
  deleteDistrictProject,
  getDistrictProjectAvailableYears,
  getRotaryYears,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import { formatMoney } from "@/lib/currency";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
// Inline mirror of useSyncClubIdFromUrl for district scope. Kept here (not a
// shared hook) until a second v2 district page needs it.
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

interface ProjectItem {
  id: number;
  title?: string | null;
  projectDate?: string | null;
  projectCost?: number | null;
  currency?: string | null;
  directBeneficiaries?: number | null;
  areaOfFocusName?: string | null;
}

interface RotaryYear {
  id: number;
  yearLabel: string;
  isCurrent?: boolean;
}

const PAGE_SIZE = 20;

export default function DistrictProjectsV2Page() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);

  const [districtName, setDistrictName] = useState("");
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/districts/${districtId}/projects/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const childReturnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/districts/${districtId}/projects/v2/add?returnTo=${childReturnTo}`;

  useEffect(() => {
    getDistrict(districtId)
      .then((d) => setDistrictName(`District ${d.districtNumber}`))
      .catch(() => {});
  }, [districtId]);

  useEffect(() => {
    async function loadYears() {
      try {
        const available = await getDistrictProjectAvailableYears(districtId);
        if (available.length > 0) {
          setYears(available);
          const c = available.find((y: RotaryYear) => y.isCurrent) || available[0];
          setYearId(String(c.id));
        } else {
          // No data yet — show current year so user can add.
          const all = await getRotaryYears();
          const c = all.find((y: RotaryYear) => y.isCurrent);
          if (c) { setYears([c]); setYearId(String(c.id)); }
        }
      } catch {}
    }
    loadYears();
  }, [districtId]);

  const fetchData = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictProjects(districtId, {
        yearId: Number(yearId),
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items || []);
      setTotalCount(res.totalCount || 0);
    } catch {
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [districtId, yearId, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictProject(districtId, Number(yearId) || 0, deleteTarget.id);
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
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="District Projects"
        pageSubtitle={districtName || "–"}
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Link
                href={`/districts/${districtId}/dashboard`}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-slate-800">District Projects</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Post all the Projects executed by your District · {districtName || "–"}
                </p>
              </div>
            </div>
          </div>

          {/* Table card */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-500">
                <FolderKanban size={16} />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Project Library</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Filter by rotary year · search across titles</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={yearId}
                  onChange={(e) => { setYearId(e.target.value); setPage(1); }}
                  className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                >
                  {years.map((y) => (
                    <option key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                    </option>
                  ))}
                </select>
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
                <button
                  type="button"
                  onClick={() => { setPage(1); fetchData(); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  <Search size={13} /> Search
                </button>
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Project
                </Link>
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
                      <th className="px-3 py-2.5 text-right w-16">Edit</th>
                      <th className="px-3 py-2.5 text-right w-16">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, i) => (
                      <tr key={item.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {item.title || "–"}
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {item.projectDate
                            ? new Date(item.projectDate).toLocaleDateString(appLocale())
                            : "–"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                          {item.projectCost
                            ? formatMoney(item.projectCost, item.currency)
                            : "–"}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {item.directBeneficiaries ?? "–"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {item.areaOfFocusName || "–"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/districts/${districtId}/projects/v2/${item.id}/edit?yearId=${yearId}&returnTo=${childReturnTo}`}
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
                          {search
                            ? "No projects match your search."
                            : "No projects found. Click \"Add Project\" to create one."}
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

          {/* Delete confirm */}
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
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
