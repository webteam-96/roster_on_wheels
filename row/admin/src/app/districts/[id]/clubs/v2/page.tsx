"use client";

/**
 * District Clubs — V2 (dashboard palette)
 * ---------------------------------------------------------------------------
 * 1:1 port of `src/app/districts/[id]/clubs/page.tsx` with new visual chrome
 * mirroring `src/app/district-admin-dashboard/membership/page.tsx`.
 *
 * Palette:
 *   Navy   #17458f  — primary buttons, table header, toggle active bg
 *   Navy H #1b2c42  — button hover
 *   Gold   #F7A81B  — accent underline on table header, view toggle active
 *   Slate  text/backgrounds/rings
 *
 * URL params preserved from V1:
 *   ?view=module  — hides Add/Edit/Delete affordances (view-only mode)
 *   ?returnTo=... — Back button target; also forwarded to detail pages so
 *                   back-from-detail returns to the ORIGINAL caller.
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ClubListItem } from "@/types/club";
import { PagedResult } from "@/types/member";
import { getDistrict, getClubs, deleteClub, getPhotoUrl } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { formatMeetingTime12Hour } from "@/lib/dateUtils";
import {
  Building2, AlertCircle, ArrowLeft, LayoutGrid, List, Search, Plus,
  MoreVertical, MoreHorizontal, Pencil, Trash2, Users, MapPin, Calendar, X,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Pagination from "@/components/Pagination";
import { ListPageSkeleton } from "@/components/row/AppKit";

// -----------------------------------------------------------------------------
// V2 Grid card — inline, dashboard palette. (V1's shared ClubCard is left
// untouched per the additive rule.)
// -----------------------------------------------------------------------------
function ClubCardV2({
  club, onDelete, isSuperAdmin, districtId, viewOnly, detailHref,
}: {
  club: ClubListItem;
  onDelete: (club: ClubListItem) => void;
  isSuperAdmin: boolean;
  districtId: number;
  viewOnly: boolean;
  detailHref: string;
}) {
  const logoUrl = getPhotoUrl(club.clubLogoPath);
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const handleClick = () => {
    if (navigating || !club.isActive) return;
    setNavigating(true);
    if (viewOnly && districtId) {
      router.push(detailHref);
    } else {
      router.push(`/clubs/${club.id}/dashboard${districtId ? `?districtId=${districtId}` : ""}`);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm bg-white transition-all duration-200 ${
        club.isActive ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "opacity-70 cursor-not-allowed"
      } ${navigating ? "opacity-60 pointer-events-none" : ""}`}
      onClick={handleClick}
      title={!club.isActive ? "Club is inactive. Click Edit to activate." : undefined}
    >
      {navigating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-2xl">
          <RotaryLoader size="sm" />
        </div>
      )}

      {/* Header band — navy w/ gold underline */}
      <div
        className="flex items-center gap-3 p-4 border-b-2 border-marigold text-white"
        style={{ backgroundColor: "#17458f" }}
      >
        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-white/15 ring-1 ring-white/30">
          {logoUrl ? (
            <Image src={logoUrl} alt={club.clubName} fill className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Building2 className="h-6 w-6 text-white/90" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm truncate">{club.clubName}</h3>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge className="text-[10px] bg-white/15 text-white border-white/30 hover:bg-white/15">
                  {club.clubRotaryId}
                </Badge>
                <Badge className="text-[10px] bg-white/15 text-white border-white/30 hover:bg-white/15">
                  {club.districtNumber}
                </Badge>
              </div>
            </div>
            {isSuperAdmin && (
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/15">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/clubs/edit/${club.id}${districtId ? `?districtId=${districtId}` : ""}`}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </Link>
                    </DropdownMenuItem>
                    {club.isActive && (
                      <DropdownMenuItem className="text-red-600" onClick={() => onDelete(club)}>
                        <Trash2 className="mr-2 h-4 w-4" />Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2 text-sm text-slate-600">
        {club.meetingDay && (
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <span>
              {club.meetingDay}
              {club.meetingFromTime ? ` | ${formatMeetingTime12Hour(club.meetingFromTime)}` : ""}
              {club.meetingToTime ? ` - ${formatMeetingTime12Hour(club.meetingToTime)}` : ""}
            </span>
          </div>
        )}
        {(club.city || club.state) && (
          <div className="flex flex-wrap items-center gap-2">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <span className="truncate">{[club.city, club.state].filter(Boolean).join(", ")}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
          <span>
            {club.totalMembers} Member{club.totalMembers !== 1 ? "s" : ""}
          </span>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] font-medium ${
            club.isActive
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {club.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// V2 Table — inline, dashboard palette.
// -----------------------------------------------------------------------------
function ClubTableV2({
  clubs, onDelete, isSuperAdmin, districtId, viewOnly, buildDetailHref,
}: {
  clubs: ClubListItem[];
  onDelete: (club: ClubListItem) => void;
  isSuperAdmin: boolean;
  districtId: number;
  viewOnly: boolean;
  buildDetailHref: (clubId: number) => string;
}) {
  const router = useRouter();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  const handleRowClick = (club: ClubListItem) => {
    if (navigatingId || !club.isActive) return;
    setNavigatingId(club.id);
    if (viewOnly && districtId) {
      router.push(buildDetailHref(club.id));
    } else {
      router.push(`/clubs/${club.id}/dashboard${districtId ? `?districtId=${districtId}` : ""}`);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
      <Table>
        <TableHeader>
          <TableRow
            className="hover:opacity-100 border-b-2 border-marigold"
            style={{ backgroundColor: "#17458f" }}
          >
            <TableHead className="w-12/90"></TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide">Club Name</TableHead>
            <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide">Rotary ID</TableHead>
            <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide">District</TableHead>
            <TableHead className="hidden lg:table-cell text-xs font-semibold uppercase tracking-wide">Meeting Day</TableHead>
            <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wide">City</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide">Members</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide">Status</TableHead>
            <TableHead className="w-12/90"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clubs.map((club) => {
            const logoUrl = getPhotoUrl(club.clubLogoPath);
            return (
              <TableRow
                key={club.id}
                className={`border-slate-100 transition-colors ${
                  club.isActive ? "cursor-pointer hover:bg-slate-50/70" : "opacity-70 cursor-not-allowed"
                } ${navigatingId === club.id ? "opacity-60 pointer-events-none" : ""}`}
                onClick={() => handleRowClick(club)}
                title={!club.isActive ? "Club is inactive. Click Edit to activate." : undefined}
              >
                <TableCell>
                  {navigatingId === club.id ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <div className="relative h-8 w-8 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                      {logoUrl ? (
                        <Image src={logoUrl} alt={club.clubName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-500">
                          <Building2 className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-semibold text-slate-800">{club.clubName}</TableCell>
                <TableCell className="hidden md:table-cell text-slate-600 text-sm">{club.clubRotaryId}</TableCell>
                <TableCell className="hidden md:table-cell text-slate-600 text-sm">{club.districtNumber}</TableCell>
                <TableCell className="hidden lg:table-cell text-slate-600 text-sm">{club.meetingDay || "-"}</TableCell>
                <TableCell className="hidden md:table-cell text-slate-600 text-sm">{club.city || "-"}</TableCell>
                <TableCell className="text-slate-700 text-sm">{club.totalMembers}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-medium ${
                      club.isActive
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {club.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {isSuperAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/clubs/edit/${club.id}${districtId ? `?districtId=${districtId}` : ""}`}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </Link>
                        </DropdownMenuItem>
                        {club.isActive && (
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={(e) => { e.stopPropagation(); onDelete(club); }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DistrictClubsV2Page() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const districtId = Number(params.id);

  const isModuleView = searchParams.get("view") === "module";
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/districts/${districtId}/dashboard`;
  const goBack = () => router.push(returnTo || fallbackBack);

  const { isSuperAdmin } = useAuth();
  const [districtNumber, setDistrictNumber] = useState("");
  const [data, setData] = useState<PagedResult<ClubListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ClubListItem | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDistrict() {
      try {
        const d = await getDistrict(districtId);
        setDistrictNumber(d.districtNumber);
      } catch { /* ignore */ }
    }
    fetchDistrict();
  }, [districtId]);

  const fetchClubs = useCallback(async (pageNum?: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getClubs(
        pageNum || page, 20,
        search || undefined,
        districtId
      );
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch clubs";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [districtId, page, search]);

  useEffect(() => { fetchClubs(); }, [fetchClubs]);

  const handleSearch = () => {
    setPage(1);
    fetchClubs(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    setError(null);
    getClubs(
      newPage, 20,
      search || undefined,
      districtId
    )
      .then(result => setData(result))
      .catch(err => setError(err instanceof Error ? err.message : "Failed to fetch clubs"))
      .finally(() => setLoading(false));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.clubName;
    try {
      await deleteClub(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteSuccess(name);
      fetchClubs();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete club.");
    }
  };

  // Forward returnTo when jumping to V2 detail so Back-from-detail returns to
  // the ORIGINAL caller, not this listing.
  const buildDetailHref = (clubId: number) => {
    const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    return `/districts/${districtId}/clubs/v2/${clubId}${suffix}`;
  };

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={goBack}
                className="border-slate-200 text-slate-700 hover:bg-slate-100"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-800">
                  {districtNumber ? `District ${districtNumber}: Clubs` : "Clubs"}
                </h2>
                <p className="text-slate-500 text-sm">Clubs in this district</p>
              </div>
            </div>
            {!isModuleView && isSuperAdmin && (
              <Button
                asChild
                size="sm"
                className="bg-azure hover:bg-mint-ink text-white"
              >
                <Link href={`/clubs/new?districtId=${districtId}`}>
                  <Plus className="mr-2 h-4 w-4" />Add Club
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* ── Search + view toggle ───────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by club name or Rotary ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9 border-slate-200 bg-white focus:border-azure focus:ring-azure/20 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSearch}
              size="sm"
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Search className="mr-2 h-4 w-4" />Search
            </Button>
            <div className="flex items-center rounded-md border border-slate-200 bg-white ml-auto overflow-hidden">
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-none ${
                  viewMode === "grid"
                    ? "bg-azure text-white hover:bg-mint-ink hover:text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-none ${
                  viewMode === "table"
                    ? "bg-azure text-white hover:bg-mint-ink hover:text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => setViewMode("table")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Client-side filter box (matches V1 SearchBox behaviour) ── */}
        {!loading && !error && data && data.items.length > 0 && (
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Filter clubs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 border-slate-200 bg-white focus:border-azure focus:ring-azure/20 text-sm"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-400 hover:text-slate-700"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">Error</h3>
            <p className="text-slate-500 mt-2 max-w-md">{error}</p>
            <Button
              variant="outline"
              className="mt-4 border-slate-200"
              onClick={() => fetchClubs()}
            >
              Try Again
            </Button>
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
            <Building2 className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No clubs found</h3>
            <p className="text-slate-500 mt-2">No clubs in this district yet.</p>
          </div>
        )}

        {!loading && !error && data && data.items.length > 0 && (() => {
          const q = searchQuery.toLowerCase();
          const filteredItems = q
            ? data.items.filter((club) =>
                [club.clubName, club.clubRotaryId, club.districtNumber, club.city, club.state, club.meetingDay, String(club.totalMembers)]
                  .some((val) => val && String(val).toLowerCase().includes(q))
              )
            : data.items;
          return (
            <>
              {filteredItems.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
                  <Building2 className="h-12 w-12 text-slate-400 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-800">No results found</h3>
                  <p className="text-slate-500 mt-2">No clubs match your filter. Try a different term.</p>
                </div>
              ) : (
                <>
                  {viewMode === "grid" ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredItems.map((club) => (
                        <ClubCardV2
                          key={club.id}
                          club={club}
                          onDelete={setDeleteTarget}
                          isSuperAdmin={!isModuleView && isSuperAdmin}
                          districtId={districtId}
                          viewOnly={isModuleView}
                          detailHref={buildDetailHref(club.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <ClubTableV2
                      clubs={filteredItems}
                      onDelete={setDeleteTarget}
                      isSuperAdmin={!isModuleView && isSuperAdmin}
                      districtId={districtId}
                      viewOnly={isModuleView}
                      buildDetailHref={buildDetailHref}
                    />
                  )}
                  <Pagination
                    page={data.page}
                    totalPages={data.totalPages}
                    totalCount={data.totalCount}
                    pageSize={data.pageSize}
                    onPageChange={handlePageChange}
                  />
                </>
              )}
            </>
          );
        })()}

        {!isModuleView && (
          <>
            <DeleteDialog
              open={!!deleteTarget}
              memberName={deleteTarget ? deleteTarget.clubName : ""}
              onConfirm={handleDelete}
              onCancel={() => setDeleteTarget(null)}
            />
            <SuccessAlert
              open={!!deleteSuccess}
              title="Club Deleted"
              description={`${deleteSuccess} has been deleted successfully.`}
              onOk={() => setDeleteSuccess(null)}
            />
            <ErrorAlert
              open={!!errorMessage}
              title="Error"
              description={errorMessage || ""}
              onOk={() => setErrorMessage(null)}
            />
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
