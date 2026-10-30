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
import { Building2, AlertCircle, ArrowLeft, LayoutGrid, List, Search, Plus } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictClubsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const isModuleView = searchParams.get("view") === "module";
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

  const backHref = `/districts/${districtId}/dashboard`;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backHref}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtNumber ? `District ${districtNumber} - Clubs` : "Clubs"}
              </h2>
              <p className="text-muted-foreground text-base">Clubs in this district</p>
            </div>
          </div>
          {!isModuleView && isSuperAdmin && (
            <Button asChild>
              <Link href={`/clubs/new?districtId=${districtId}`}><Plus className="mr-2 h-4 w-4" />Add Club</Link>
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input placeholder="Search by club name or Rotary ID..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleKeyDown} className="pl-9 border-primary/30 focus:border-primary text-base" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSearch} size="sm">
              <Search className="mr-2 h-4 w-4" />Search
            </Button>
            <div className="flex items-center rounded-md border ml-auto">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("table")}>
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

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => fetchClubs()}>Try Again</Button>
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No clubs found</h3>
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
                  <h3 className="text-lg font-semibold">No results found</h3>
                  <p className="text-muted-foreground mt-2">No clubs match your filter. Try a different term.</p>
                </div>
              ) : (
                <>
                  {viewMode === "grid" ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredItems.map((club) => (
                        <ClubCard key={club.id} club={club} onDelete={setDeleteTarget} isSuperAdmin={!isModuleView && isSuperAdmin} districtId={districtId} viewOnly={isModuleView} />
                      ))}
                    </div>
                  ) : (
                    <ClubTable clubs={filteredItems} onDelete={setDeleteTarget} isSuperAdmin={!isModuleView && isSuperAdmin} districtId={districtId} viewOnly={isModuleView} />
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
