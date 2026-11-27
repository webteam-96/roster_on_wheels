"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClubListItem } from "@/types/club";
import { PagedResult } from "@/types/member";
import { getDistrict, getClubs, deleteClub } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ClubCard from "@/components/ClubCard";
import ClubTable from "@/components/ClubTable";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Building2, AlertCircle, LayoutGrid, List, Search, Plus } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictClubsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const isModuleView = searchParams.get("view") === "module";
  const { isSuperAdmin } = useAuth();
  const [districtNumber, setDistrictNumber] = useState("");
  // upstream 2026-10-21: district or its zone inactive, so this is a SuperAdmin-only view.
  const [districtInactive, setDistrictInactive] = useState(false);
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
        setDistrictInactive(d.isChainActive === false || !d.isActive);
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
        districtId,
        undefined, undefined, undefined, undefined, true
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
      districtId,
      undefined, undefined, undefined, undefined, true
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

  const backHref = `/districts/${districtId}/dashboard`;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title={districtNumber ? `District ${districtNumber} - Clubs` : "Clubs"}
          description="Clubs in this district"
          back={backHref}
          actions={!isModuleView && isSuperAdmin && (
            <Button asChild>
              <Link href={`/clubs/new?districtId=${districtId}`}><Plus className="mr-2 h-4 w-4" />Add Club</Link>
            </Button>
          )}
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input placeholder="Search by club name or Rotary ID..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleKeyDown} className="pl-9" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSearch} size="sm">
              <Search className="mr-2 h-4 w-4" />Search
            </Button>
            <div className="flex items-center rounded-md border ml-auto">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} aria-label="Grid view" aria-pressed={viewMode === "grid"} size="icon" className="rounded-r-none" onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === "table" ? "default" : "ghost"} aria-label="Table view" aria-pressed={viewMode === "table"} size="icon" className="rounded-l-none" onClick={() => setViewMode("table")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {!loading && !error && data && data.items.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Filter clubs..." />
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {districtInactive && (
          <p className="text-sm font-semibold text-red-700">
            This district (or its zone) is inactive and hidden everywhere. Only SuperAdmin can see this.
          </p>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="row-h2">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => fetchClubs()}>Try Again</Button>
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No clubs found</h3>
            <p className="text-muted-foreground mt-2">No clubs in this district yet.</p>
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
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="row-h2">No results found</h3>
                  <p className="text-muted-foreground mt-2">No clubs match your filter. Try a different term.</p>
                </div>
              ) : (
                <>
                  {viewMode === "grid" ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredItems.map((club) => (
                        <ClubCard key={club.id} club={club} parentInactive={districtInactive} onDelete={setDeleteTarget} isSuperAdmin={!isModuleView && isSuperAdmin} districtId={districtId} viewOnly={isModuleView} />
                      ))}
                    </div>
                  ) : (
                    <ClubTable clubs={filteredItems} parentInactive={districtInactive} onDelete={setDeleteTarget} isSuperAdmin={!isModuleView && isSuperAdmin} districtId={districtId} viewOnly={isModuleView} />
                  )}
                  <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
                </>
              )}
            </>
          );
        })()}

        {!isModuleView && (
          <>
            <DeleteDialog open={!!deleteTarget} memberName={deleteTarget ? deleteTarget.clubName : ""} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
            <SuccessAlert open={!!deleteSuccess} title="Club Deleted" description={`${deleteSuccess} has been deleted successfully.`} onOk={() => setDeleteSuccess(null)} />
            <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
