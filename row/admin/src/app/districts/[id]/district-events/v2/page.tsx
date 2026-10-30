"use client";

/**
 * District Events V2 — listing.
 *
 * Same data semantics as v1 (src/app/districts/[id]/district-events/page.tsx):
 * every API call, every filter, every "no data → show current year" fallback
 * preserved verbatim. Only the chrome changes — wrapped in DistrictAdminShell
 * with the KPI-row + card + dense table pattern from clubs/[id]/documents/v2.
 *
 * v2 reads ONLY `?returnTo=` for header-back and for chaining into add/edit.
 *
 * NOTE: district-events is year-wise, so edit URLs also carry `?yearId=` (the
 * v1 pattern) because the detail/update/delete APIs are keyed by (yearId, id).
 * That query param sits alongside returnTo and is unrelated to it.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Calendar, CalendarDays, Loader2, Search, Plus, Edit3, Trash2,
  ArrowLeft, AlertTriangle,
} from "@/components/icons";
import {
  getDistrict,
  getDistrictEventsList,
  deleteDistrictEventItem,
  getDistrictEventAvailableYears,
  getRotaryYears,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";

import { appLocale } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
interface EventListItem {
  id: number;
  title: string | null;
  eventDate: string | null;
}

interface YearOption {
  id: number;
  yearLabel: string;
  isCurrent?: boolean;
}

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

function fmtDate(s?: string | null): string {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleDateString(appLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

export default function DistrictEventsV2Page() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);

  const [districtName, setDistrictName] = useState("");
  const [items, setItems] = useState<EventListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [years, setYears] = useState<YearOption[]>([]);
  const [yearId, setYearId] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: parent → this listing → add/edit → this listing → parent.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/districts/${districtId}/district-events/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const childReturnTo = encodeURIComponent(myListingUrl);
  const addUrl = `/districts/${districtId}/district-events/v2/add?returnTo=${childReturnTo}`;

  useEffect(() => {
    getDistrict(districtId)
      .then((d) => setDistrictName(`District ${d.districtNumber}`))
      .catch(() => {});
  }, [districtId]);

  // v1 parity: try available-years first, fall back to current rotary year.
  useEffect(() => {
    let cancelled = false;
    async function loadYears() {
      try {
        const available: YearOption[] = await getDistrictEventAvailableYears(districtId);
        if (cancelled) return;
        if (available.length > 0) {
          setYears(available);
          const c = available.find((y) => y.isCurrent) || available[0];
          setYearId(String(c.id));
        } else {
          const all: YearOption[] = await getRotaryYears();
          if (cancelled) return;
          const c = all.find((y) => y.isCurrent);
          if (c) {
            setYears([c]);
            setYearId(String(c.id));
          }
        }
      } catch {
        // silent — matches v1
      }
    }
    loadYears();
    return () => { cancelled = true; };
  }, [districtId]);

  const fetchData = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictEventsList(districtId, {
        yearId: Number(yearId),
        search: search || undefined,
        page,
        pageSize,
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const currentYearLabel = useMemo(() => {
    const y = years.find((x) => String(x.id) === yearId);
    return y ? y.yearLabel : "–";
  }, [years, yearId]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictEventItem(districtId, Number(yearId) || 0, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Event deleted.");
      fetchData();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  const applySearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="District Events"
        pageSubtitle={districtName ? `${districtName} · district-executed events for the website` : undefined}
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
                <h1 className="text-lg font-semibold text-slate-800">District Events</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Post all the events executed by your district · {districtName || "–"}
                </p>
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard title="Total Events"    value={fmtInt(totalCount)}            subtitle="In selected year"           icon={Calendar}     color="blue" />
            <KpiCard title="Selected Year"   value={currentYearLabel}              subtitle="Rotary year in view"        icon={CalendarDays} color="gold" />
            <KpiCard title="Available Years" value={fmtInt(years.length)}          subtitle="Years with data"            icon={CalendarDays} color="purple" />
          </div>

          {/* Table card */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Event List</h3>
                <p className="text-xs text-slate-500 mt-0.5">Filter by rotary year · search by event title</p>
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
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                    className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-56 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
                <button
                  type="button"
                  onClick={applySearch}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  <Search size={13} /> Search
                </button>
                <Link
                  href={addUrl}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full bg-[#17458F] text-white hover:bg-[#17458F]"
                >
                  <Plus size={13} /> Add Event
                </Link>
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
                      <th className="px-3 py-2.5 text-left">Date</th>
                      <th className="px-3 py-2.5 text-right w-16">Edit</th>
                      <th className="px-3 py-2.5 text-right w-16">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, i) => (
                      <tr key={item.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{(page - 1) * pageSize + i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{item.title || "–"}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(item.eventDate)}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/districts/${districtId}/district-events/v2/${item.id}/edit?yearId=${yearId}&returnTo=${childReturnTo}`}
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
                          {search
                            ? "No events match your search."
                            : "No events found. Click \"Add Event\" to create one."}
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
              pageSize={pageSize}
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
        </div>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
