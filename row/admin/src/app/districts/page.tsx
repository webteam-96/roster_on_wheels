"use client";

import { useState, useCallback } from "react";
import { DistrictListItem } from "@/types/district";
import { PagedResult } from "@/types/member";
import { getDistricts, deleteDistrict } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import DistrictCard from "@/components/DistrictCard";
import DistrictTable from "@/components/DistrictTable";
import DistrictFilters from "@/components/DistrictFilters";
import Pagination from "@/components/Pagination";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, MapPin, AlertCircle, ArrowLeft, Search } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function DistrictsPage() {
  const { isSuperAdmin } = useAuth();
  const [data, setData] = useState<PagedResult<DistrictListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [deleteTarget, setDeleteTarget] = useState<DistrictListItem | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchDistricts = useCallback(async (pageNum?: number) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const isActive = status ? parseInt(status) : undefined;
      const result = await getDistricts(pageNum || page, 20, search || undefined, isActive);
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch districts";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  const handleSearch = () => {
    setPage(1);
    fetchDistricts(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Fetch with new page
    setLoading(true);
    setError(null);
    const isActive = status ? parseInt(status) : undefined;
    getDistricts(newPage, 20, search || undefined, isActive)
      .then(result => setData(result))
      .catch(err => setError(err instanceof Error ? err.message : "Failed to fetch districts"))
      .finally(() => setLoading(false));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const name = `District ${deleteTarget.districtNumber}`;
    try {
      await deleteDistrict(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteSuccess(name);
      if (hasSearched) fetchDistricts();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete district.");
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Districts</h2>
              <p className="text-muted-foreground text-base">Search by district number</p>
            </div>
          </div>
          {isSuperAdmin && (
            <Button asChild>
              <Link href="/districts/new"><Plus className="mr-2 h-4 w-4" />Add District</Link>
            </Button>
          )}
        </div>

        <DistrictFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} viewMode={viewMode} onViewModeChange={setViewMode} onSearch={handleSearch} />

        {hasSearched && !loading && !error && data && data.items.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Filter results..." />
        )}

        {!hasSearched && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Search Districts</h3>
            <p className="text-muted-foreground mt-2">Enter a district number and click Search to find districts.</p>
          </div>
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
            <Button variant="outline" className="mt-4" onClick={() => fetchDistricts()}>Try Again</Button>
          </div>
        )}

        {hasSearched && !loading && !error && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No districts found</h3>
            <p className="text-muted-foreground mt-2">Try a different search term.</p>
          </div>
        )}

        {hasSearched && !loading && !error && data && data.items.length > 0 && (() => {
          const q = searchQuery.toLowerCase();
          const filteredItems = q
            ? data.items.filter((district) =>
                [district.districtNumber, district.zoneName, String(district.totalClubs), String(district.totalMembers)]
                  .some((val) => val && String(val).toLowerCase().includes(q))
              )
            : data.items;
          return (
            <>
              {filteredItems.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No results found</h3>
                  <p className="text-muted-foreground mt-2">No districts match your filter. Try a different term.</p>
                </div>
              ) : (
                <>
                  {viewMode === "grid" ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredItems.map((district) => (
                        <DistrictCard key={district.id} district={district} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />
                      ))}
                    </div>
                  ) : (
                    <DistrictTable districts={filteredItems} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />
                  )}
                  <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
                </>
              )}
            </>
          );
        })()}

        <DeleteDialog open={!!deleteTarget} memberName={deleteTarget ? `District ${deleteTarget.districtNumber}` : ""} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!deleteSuccess} title="District Deleted" description={`${deleteSuccess} has been deleted successfully.`} onOk={() => setDeleteSuccess(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
