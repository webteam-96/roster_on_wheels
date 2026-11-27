"use client";
import { DataTable } from "@/components/ui/data-table";
import { ClearButton } from "@/components/ui/text-buttons";

/**
 * Announcements v2 listing — frontend overhaul module.
 *
 * Visual pattern mirrors the Club Admin Dashboard listings (KPI tiles, colored
 * status chips, dense table) but the data still comes from the existing v1
 * endpoints (getAnnouncements + deleteAnnouncement + getClub).
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
import { Megaphone, CheckCircle2, Clock, Image as ImageIcon, Search, Plus, Trash2, AlertTriangle, X, MoreHorizontal, Eye, Pencil } from "@/components/icons";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getClub,
  getAnnouncements,
  deleteAnnouncement,
} from "@/services/api";
import { AnnouncementListItem } from "@/types/announcement";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import SendStatusBadges from "@/components/SendStatusBadges";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
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

function yesNoChip(value: boolean): string {
  return value
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-slate-50 text-slate-500 border-slate-200";
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

export default function AnnouncementsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  // searchInput = what the user is typing; search = committed query that fires the API.
  // Committed via Enter, the explicit search submit, or a 400ms debounce — never per keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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
  const [kpiBanners, setKpiBanners] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<AnnouncementListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/announcements/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  const addUrl = `/clubs/${clubId}/announcements/v2/add?returnTo=${returnTo}`;

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

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAnnouncements(
        clubId, page, pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined,
      );
      setAnnouncements(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setAnnouncements([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, pageSize, statusFilter, search]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // Refresh KPI tiles whenever data may have changed (mount + after delete).
  // Backend has no aggregate endpoint, so:
  //  • Total/Published/Expired come from server-side totalCount (cheap: pageSize=1).
  //  • Banners has no dedicated filter, so we page through using a large page size
  //    until we've seen every row. This keeps the count accurate even when clubs
  //    have >500 announcements.
  const refreshKpis = useCallback(async () => {
    try {
      const [totalRes, publishedRes, expiredRes] = await Promise.all([
        getAnnouncements(clubId, 1, 1, undefined, undefined),
        getAnnouncements(clubId, 1, 1, "Published", undefined),
        getAnnouncements(clubId, 1, 1, "Expired", undefined),
      ]);
      setKpiTotal(totalRes.totalCount);
      setKpiPublished(publishedRes.totalCount);
      setKpiExpired(expiredRes.totalCount);

      // Banner aggregate — page through to avoid the 500-row cap.
      const BANNER_PAGE = 500;
      let bannerCount = 0;
      let pageNo = 1;
      let seen = 0;
      const total = totalRes.totalCount;
      while (seen < total) {
        const chunk = await getAnnouncements(clubId, pageNo, BANNER_PAGE, undefined, undefined);
        if (!chunk.items.length) break;
        bannerCount += chunk.items.filter((a) => a.isDisplayOnBanner).length;
        seen += chunk.items.length;
        pageNo += 1;
        // Safety guard against runaway loops if backend totalCount disagrees with items length.
        if (pageNo > 50) break;
      }
      setKpiBanners(bannerCount);
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
      await deleteAnnouncement(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Announcement deleted successfully.");
      fetchAnnouncements();
      refreshKpis();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete announcement.");
    }
  };

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Announcements"
        pageSubtitle="Broadcast messages to members"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Announcements" description={<>{clubName || "–"} · Broadcast messages to members</>} back={parentReturnTo ? decodeURIComponent(parentReturnTo) : `/clubs/${clubId}/dashboard`} />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Announcements" value={fmtInt(kpiTotal)}     subtitle="All-time"             icon={Megaphone}    color="blue" />
          <KpiCard title="Published"           value={fmtInt(kpiPublished)} subtitle="Active in window"     icon={CheckCircle2} color="green" />
          <KpiCard title="Expired"             value={fmtInt(kpiExpired)}   subtitle="Past expiry"          icon={Clock}        color="red" />
          <KpiCard title="Banners"             value={fmtInt(kpiBanners)}   subtitle="Display on banner"    icon={ImageIcon}    color="gold" />
        </div>

        {/* Table card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="row-h3">Announcement Records</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage announcements · {totalCount} total
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
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </ClearButton>
                )}
              </div>
              {canManage && (
                <Link
                  href={addUrl}
                  className="row-btn row-btn-primary"
                >
                  <Plus size={13} /> Add Announcement
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <SkeletonRows />
            ) : (
              <DataTable
                caption="Announcements"
                card={false}
                className="[&_table]:min-w-[640px] md:[&_table]:min-w-full"
                rows={announcements}
                rowKey={(a) => a.id}
                empty={search || statusFilter !== "all" ? "No announcements match your filters." : "No announcements yet."}
                columns={[
                  { key: "sr", header: "Sr", className: "w-10 text-muted-foreground", cell: (_a, i) => (page - 1) * pageSize + i + 1 },
                  {
                    key: "title",
                    header: "Title",
                    className: "font-medium",
                    cell: (a) => {
                      const detailHref = `/clubs/${clubId}/announcements/${a.id}`;
                      const imgSrc = a.imagePath
                        ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${a.imagePath}`
                        : null;
                      return (
                        <div
                          role="link"
                          tabIndex={0}
                          onClick={() => router.push(detailHref)}
                          onKeyDown={(e) => { if (e.key === "Enter") router.push(detailHref); }}
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
                          <span>{a.title || "–"}</span>
                        </div>
                      );
                    },
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (a) => (
                      <>
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${statusChipStyle(a.status)}`}>
                          {a.status || "–"}
                        </span>
                        <SendStatusBadges item={a} />
                      </>
                    ),
                  },
                  { key: "publish", header: "Publish Date", className: "whitespace-nowrap", cell: (a) => formatDateTime(a.publishDateTime) },
                  { key: "expiry", header: "Expiry Date", className: "whitespace-nowrap", cell: (a) => formatDateTime(a.expiryDateTime) },
                  {
                    key: "banner",
                    header: "Banner",
                    align: "center",
                    cell: (a) => (
                      <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border ${yesNoChip(a.isDisplayOnBanner)}`}>
                        {a.isDisplayOnBanner ? "Yes" : "No"}
                      </span>
                    ),
                  },
                  ...(canManage
                    ? [{
                        key: "actions",
                        header: "",
                        align: "right" as const,
                        className: "w-12",
                        cell: (a: (typeof announcements)[number]) => {
                          const detailHref = `/clubs/${clubId}/announcements/${a.id}`;
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton type="button" aria-label="Open actions menu">
                                  <MoreHorizontal size={14} />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => router.push(detailHref)}>
                                  <Eye className="mr-2 h-4 w-4" />View
                                </DropdownMenuItem>
                                {a.status !== "Expired" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      router.push(`/clubs/${clubId}/announcements/v2/${a.id}/edit?returnTo=${returnTo}`)
                                    }
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteTarget(a)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        },
                      }]
                    : []),
                ]}
              />
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {totalCount} announcement{totalCount === 1 ? "" : "s"}
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
          title="Delete Announcement"
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
