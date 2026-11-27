"use client";

/**
 * Upcoming Events v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Announcements v2 listing (KPI tiles, colored
 * status chips, dense table) but the data still comes from the existing v1
 * endpoints (getUpcomingEvents + deleteUpcomingEvent + getClub).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Calendar, CheckCircle2, Clock, Search, Plus, Trash2, AlertTriangle, X, MoreHorizontal, Eye, Pencil } from "@/components/icons";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getClub,
  getUpcomingEvents,
  deleteUpcomingEvent,
} from "@/services/api";
import { UpcomingEventListItem } from "@/types/upcomingEvent";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import SendStatusBadges from "@/components/SendStatusBadges";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
import { useFormat } from "@/hooks/useFormat";
import { useEventZone } from "@/hooks/useEventZone";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import { ClearButton } from "@/components/ui/text-buttons"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
const STATUS_OPTIONS = [
  { value: "all",         label: "All" },
  { value: "Published",   label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired",     label: "Expired" },
];

function statusChipStyle(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "published":   return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unpublished": return "bg-amber-50 text-amber-700 border-amber-200";
    case "expired":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:            return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "–";
  try {
    return new Date(dateStr).toLocaleString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function UpcomingEventsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const fmt = useFormat();
  const zone = useEventZone({ clubId });

  const [clubName, setClubName] = useState("");
  const [events, setEvents] = useState<UpcomingEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  // searchInput = what the user is typing; search = committed query that fires the API.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Published");
  const pageSize = 20;

  // Debounce search input → committed search (400ms after last keystroke).
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const commitSearch = () => {
    if (searchInput !== search) {
      setSearch(searchInput);
      setPage(1);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  // KPI aggregates — fetched once across all statuses (separate light query)
  const [kpiTotal, setKpiTotal] = useState(0);
  const [kpiPublished, setKpiPublished] = useState(0);
  const [kpiExpired, setKpiExpired] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<UpcomingEventListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/upcoming-events/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/upcoming-events/v2/add?returnTo=${returnTo}`;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const club = await getClub(clubId);
        if (cancelled) return;
        setClubName(club.clubName);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUpcomingEvents(
        clubId, page, pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined,
      );
      setEvents(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setEvents([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, pageSize, statusFilter, search]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Refresh KPI tiles whenever data may have changed (mount + after delete).
  const refreshKpis = useCallback(async () => {
    try {
      const [totalRes, publishedRes, expiredRes] = await Promise.all([
        getUpcomingEvents(clubId, 1, 1, undefined, undefined),
        getUpcomingEvents(clubId, 1, 1, "Published", undefined),
        getUpcomingEvents(clubId, 1, 1, "Expired", undefined),
      ]);
      setKpiTotal(totalRes.totalCount);
      setKpiPublished(publishedRes.totalCount);
      setKpiExpired(expiredRes.totalCount);
    } catch {
      // leave previous KPI values in place on transient errors
    }
  }, [clubId]);

  useEffect(() => {
    refreshKpis();
  }, [refreshKpis]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCount / pageSize)),
    [totalCount, pageSize],
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUpcomingEvent(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Event deleted successfully.");
      fetchEvents();
      refreshKpis();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete event.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Upcoming Events"
        pageSubtitle="Manage upcoming events"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Upcoming Events" description={<>{clubName || "–"} · Manage upcoming events</>} back={parentReturnTo ? decodeURIComponent(parentReturnTo) : `/clubs/${clubId}/dashboard`} />

        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Total Events" value={fmtInt(kpiTotal)}     subtitle="All-time"           icon={Calendar}       color="blue" />
          <KpiCard title="Published"    value={fmtInt(kpiPublished)} subtitle="Active in window"   icon={CheckCircle2}   color="green" />
          <KpiCard title="Expired"      value={fmtInt(kpiExpired)}   subtitle="Past expiry"        icon={Clock}          color="red" />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Event Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage upcoming events · {totalCount} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="w-auto"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </NativeSelect>
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search title…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitSearch(); } }}
                  className="pl-7 pr-7 sm:w-48"
                />
                {searchInput && (
                  <ClearButton
                    type="button"
                    onClick={clearSearch}
                    aria-label="Clear search" />
                )}
              </div>
              {canManage && (
                <Link
                  href={addUrl}
                  className="row-btn row-btn-primary"
                >
                  <Plus size={13} /> Add Event
                </Link>
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
                    <TableHead className="text-left">Title</TableHead>
                    <TableHead className="text-left">Status</TableHead>
                    <TableHead className="text-left">Event Date</TableHead>
                    <TableHead className="text-left">Publish Date</TableHead>
                    <TableHead className="text-left">Expiry Date</TableHead>
                    {canManage && <TableHead className="text-right w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e, i) => {
                    const detailHref = `/clubs/${clubId}/upcoming-events/${e.id}`;
                    const imgSrc = e.imagePath
                      ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${e.imagePath}`
                      : null;
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{(page - 1) * pageSize + i + 1}</TableCell>
                        <TableCell className="font-medium">
                          <div
                            role="link"
                            tabIndex={0}
                            onClick={() => router.push(detailHref)}
                            onKeyDown={(ev) => { if (ev.key === "Enter") router.push(detailHref); }}
                            className="flex items-center gap-2 cursor-pointer hover:text-blue-700"
                          >
                            {imgSrc && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={imgSrc}
                                alt=""
                                className="h-10 w-10 rounded object-cover border border-slate-200"
                              />
                            )}
                            <span>{e.title || "–"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${statusChipStyle(e.status)}`}>
                            {e.status || "–"}
                          </span>
                          <SendStatusBadges item={e} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{e.eventDate ? fmt.eventDateTime(e.eventDate, zone) : "-"}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(e.publishDate)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(e.expiryDate)}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  type="button"
                                   aria-label="Open actions menu"
                                >
                                  <MoreHorizontal size={14} />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => router.push(detailHref)}>
                                  <Eye className="mr-2 h-4 w-4" />View
                                </DropdownMenuItem>
                                {e.status !== "Expired" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      router.push(`/clubs/${clubId}/upcoming-events/v2/${e.id}/edit?returnTo=${returnTo}`)
                                    }
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteTarget(e)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {events.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 8 : 7} className="py-10 text-center text-muted-foreground">
                        {search || statusFilter !== "all"
                          ? "No events match your filters."
                          : "No events yet."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} event{totalCount === 1 ? "" : "s"}
          </div>
        </Card>

        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Delete confirm */}
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
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
