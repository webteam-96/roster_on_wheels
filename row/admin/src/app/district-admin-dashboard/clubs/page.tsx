"use client";

/**
 * District Admin Dashboard — Clubs listing (table-only)
 * ---------------------------------------------------------------------------
 * Mirrors `src/app/districts/[id]/clubs/v2/page.tsx` inside the DA dashboard
 * shell. Key differences:
 *   - districtId comes from `useAuth().selectedDistrictId` (NOT useParams)
 *   - Back button fallback is `/district-admin-dashboard/membership`
 *   - Row click navigates to `/district-admin-dashboard/clubs/{clubId}` with
 *     `?returnTo=<current-url>`
 *   - LIST-ONLY view: viewMode/grid toggle removed, table only
 *
 * Palette:
 *   Navy   #1e3a5f  — primary buttons, table header, toggle active bg
 *   Navy H #152a44  — button hover
 *   Gold   #F7A81B  — accent underline on table header
 *   Slate  text/backgrounds/rings
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ClubListItem } from "@/types/club";
import { PagedResult } from "@/types/member";
import { getDistrict, getClubs, deleteClub, getPhotoUrl } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { clubWebsiteUrl } from "@/lib/clubWebsite";
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
import {
  Building2, AlertCircle, ArrowLeft, Search,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import Pagination from "@/components/Pagination";

// -----------------------------------------------------------------------------
// DA-dashboard table (list-only view; V2 grid toggle removed).
// -----------------------------------------------------------------------------
function ClubTableDA({
  clubs, onDelete, isSuperAdmin, districtId, buildDetailHref,
}: {
  clubs: ClubListItem[];
  onDelete: (club: ClubListItem) => void;
  isSuperAdmin: boolean;
  districtId: number;
  buildDetailHref: (clubId: number) => string;
}) {
  const router = useRouter();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  const handleRowClick = (club: ClubListItem) => {
    if (navigatingId || !club.isActive) return;
    setNavigatingId(club.id);
    router.push(buildDetailHref(club.id));
  };

  return (
    <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
      <Table>
        <TableHeader>
          <TableRow
            className="hover:opacity-100 border-b-2 border-[#F7A81B]"
            style={{ backgroundColor: "#1e3a5f" }}
          >
            <TableHead className="w-12 text-white/90"></TableHead>
            <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Club Name</TableHead>
            <TableHead className="hidden md:table-cell text-white text-xs font-semibold uppercase tracking-wide">Club ID</TableHead>
            <TableHead className="hidden md:table-cell text-white text-xs font-semibold uppercase tracking-wide">District</TableHead>
            <TableHead className="hidden lg:table-cell text-white text-xs font-semibold uppercase tracking-wide">Meeting Day</TableHead>
            <TableHead className="hidden md:table-cell text-white text-xs font-semibold uppercase tracking-wide">City</TableHead>
            <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Members</TableHead>
            <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Sync</TableHead>
            <TableHead className="min-w-[240px] text-white text-xs font-semibold uppercase tracking-wide">Website</TableHead>
            <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Status</TableHead>
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
                <TableCell className="text-slate-700 text-sm">
                  {club.totalMembers ?? 0}
                  {(club.honoraryMembers ?? 0) > 0 && (
                    <span className="ml-1 text-[11px] text-amber-600" title="Honorary members">+{club.honoraryMembers} hon.</span>
                  )}
                </TableCell>
                <TableCell>
                  {/* Sync badge — reflects club_master.IsSyncedFromRotaryOrg */}
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-medium ${
                      club.isSyncedFromRotaryOrg
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {club.isSyncedFromRotaryOrg ? "Sync" : "Not Sync"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {/* Website cell — 3-state:
                       • has row + not expired → URL link (client domain or subdomain)
                       • has row + past EndDate → "Expired" chip
                       • no row → "No" chip */}
                  {(() => {
                    if (!club.websiteSubdomain) {
                      return (
                        <Badge variant="outline" className="text-[10px] font-medium border-slate-200 bg-slate-50 text-slate-600">
                          No
                        </Badge>
                      );
                    }
                    const now = new Date();
                    const end = club.websiteEndDate ? new Date(club.websiteEndDate) : null;
                    const expired = !!end && end < now;
                    if (expired) {
                      return (
                        <Badge variant="outline" className="text-[10px] font-medium border-red-200 bg-red-50 text-red-700">
                          Expired
                        </Badge>
                      );
                    }
                    // A custom client domain wins; otherwise resolve the subdomain via the
                    // shared helper so this matches the club-admin / AG / global-search
                    // screens. The helper strips any protocol/slash/parent-domain junk (some
                    // clubs store a FULL host like "club.example.org" in Subdomain) before
                    // rebuilding, so we never double-append a parent domain.
                    const clientDomain = club.websiteClientDomain?.trim();
                    const url = clientDomain
                      ? (clientDomain.startsWith("http") ? clientDomain : `https://${clientDomain}`)
                      : clubWebsiteUrl(club.websiteSubdomain);
                    if (!url) {
                      return (
                        <Badge variant="outline" className="text-[10px] font-medium border-slate-200 bg-slate-50 text-slate-600">
                          No
                        </Badge>
                      );
                    }
                    const host = url.replace(/^https?:\/\//i, "");
                    return (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-[#1e3a5f] underline decoration-slate-300 hover:decoration-[#1e3a5f] break-all"
                        title={url}
                      >
                        {host}
                      </a>
                    );
                  })()}
                </TableCell>
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DistrictAdminClubsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { isSuperAdmin, selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/district-admin-dashboard/membership`;
  const goBack = () => router.push(returnTo || fallbackBack);

  const [districtNumber, setDistrictNumber] = useState("");
  const [data, setData] = useState<PagedResult<ClubListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // searchQuery / client-side quick filter removed — server search only.
  const [deleteTarget, setDeleteTarget] = useState<ClubListItem | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!districtId) return;
    async function fetchDistrict() {
      try {
        const d = await getDistrict(districtId);
        setDistrictNumber(d.districtNumber);
      } catch { /* ignore */ }
    }
    fetchDistrict();
  }, [districtId]);

  const fetchClubs = useCallback(async (pageNum?: number) => {
    if (!districtId) return;
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
    if (!districtId) return;
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

  // Forward the CURRENT DA-dashboard URL as returnTo so Back-from-detail
  // returns to this listing.
  const buildDetailHref = (clubId: number) => {
    const qs = searchParams.toString();
    const currentUrl = qs ? `${pathname}?${qs}` : pathname;
    const suffix = `?returnTo=${encodeURIComponent(currentUrl)}`;
    return `/district-admin-dashboard/clubs/${clubId}${suffix}`;
  };

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <DistrictMembershipTabBar />

        {/* Search */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by club name or Club ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9 border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSearch}
              size="sm"
              className="bg-[#1e3a5f] hover:bg-[#152a44] text-white"
            >
              <Search className="mr-2 h-4 w-4" />Search
            </Button>
            {/* Total Clubs — highlighted, next to search. */}
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-[#F7A81B] px-3 py-1.5 shadow-sm">
              <span className="text-base font-bold leading-none tabular-nums text-[#1e3a5f]">
                {data ? data.totalCount.toLocaleString() : "—"}
              </span>
              <span className="text-xs font-semibold text-[#1e3a5f]">Total Clubs</span>
            </div>
          </div>
        </div>

        {/* Client-side filter box removed — the server-side search above
            already searches by club name and Rotary ID. */}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
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

        {!loading && !error && data && data.items.length > 0 && (
          <>
            <ClubTableDA
              clubs={data.items}
              onDelete={setDeleteTarget}
              isSuperAdmin={isSuperAdmin}
              districtId={districtId}
              buildDetailHref={buildDetailHref}
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              totalCount={data.totalCount}
              pageSize={data.pageSize}
              onPageChange={handlePageChange}
            />
          </>
        )}

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
      </div>
    </ProtectedRoute>
  );
}
