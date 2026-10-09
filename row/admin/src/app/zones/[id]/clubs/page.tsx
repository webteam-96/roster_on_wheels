"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { ClubListItem } from "@/types/club";
import { DistrictListItem } from "@/types/district";
import { PagedResult } from "@/types/member";
import { getClubs, deleteClub, getDistricts, getZone } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ClubCard from "@/components/ClubCard";
import ClubTable from "@/components/ClubTable";
import ClubFilters from "@/components/ClubFilters";
import Pagination from "@/components/Pagination";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Building2, AlertCircle, ArrowLeft } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function ZoneClubsPage() {
  const params = useParams();
  const zoneId = Number(params.id);
  const { isSuperAdmin } = useAuth();
  const [zoneName, setZoneName] = useState("");
  const [data, setData] = useState<PagedResult<ClubListItem> | null>(null);
  const [districts, setDistricts] = useState<DistrictListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [city, setCity] = useState("");
  const [meetingDay, setMeetingDay] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [deleteTarget, setDeleteTarget] = useState<ClubListItem | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function fetchZone() {
      try {
        const z = await getZone(zoneId);
        setZoneName(z.zoneName);
      } catch { /* ignore */ }
    }
    fetchZone();
  }, [zoneId]);

  useEffect(() => {
    async function fetchDistricts() {
      try {
        const result = await getDistricts(1, 100, undefined, undefined, zoneId);
        setDistricts([...result.items].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch { /* ignore */ }
    }
    fetchDistricts();
  }, [zoneId]);

  const fetchClubs = useCallback(async (pageNum?: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getClubs(
        pageNum || page, 20,
        search || undefined,
        districtId ? parseInt(districtId) : undefined,
        city || undefined,
        meetingDay || undefined,
        undefined,
        zoneId
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch clubs");
    } finally {
      setLoading(false);
    }
  }, [page, search, districtId, city, meetingDay, zoneId]);

  useEffect(() => { fetchClubs(); }, [fetchClubs]);

  const handleSearch = () => {
    setPage(1);
    fetchClubs(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    setError(null);
    getClubs(
      newPage, 20,
      search || undefined,
      districtId ? parseInt(districtId) : undefined,
      city || undefined,
      meetingDay || undefined,
      undefined,
      zoneId
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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/admin"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {zoneName ? `${zoneName} - Clubs` : "Clubs"}
              </h2>
              <p className="text-muted-foreground text-base">Clubs in this zone</p>
            </div>
          </div>
          {isSuperAdmin && (
            <Button asChild>
              <Link href="/clubs/new"><Plus className="mr-2 h-4 w-4" />Add Club</Link>
            </Button>
          )}
        </div>

        <ClubFilters search={search} onSearchChange={setSearch} districtId={districtId} onDistrictChange={setDistrictId} city={city} onCityChange={setCity} meetingDay={meetingDay} onMeetingDayChange={setMeetingDay} viewMode={viewMode} onViewModeChange={setViewMode} districts={districts} onSearch={handleSearch} />

        {!loading && !error && data && data.items.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Filter clubs..." />
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
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
            <p className="text-muted-foreground mt-2">No clubs in this zone yet.</p>
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
                      {filteredItems.map((club) => <ClubCard key={club.id} club={club} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />)}
                    </div>
                  ) : (
                    <ClubTable clubs={filteredItems} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />
                  )}
                  <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
                </>
              )}
            </>
          );
        })()}

        <DeleteDialog open={!!deleteTarget} memberName={deleteTarget?.clubName || ""} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!deleteSuccess} title="Club Deleted" description={`${deleteSuccess} has been deleted successfully.`} onOk={() => setDeleteSuccess(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
