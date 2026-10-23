"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ZoneListItem } from "@/types/zone";
import { PagedResult } from "@/types/member";
import { getZones, deleteZone, resolveDashboardLanding } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ZoneCard from "@/components/ZoneCard";
import ZoneTable from "@/components/ZoneTable";
import ZoneFilters from "@/components/ZoneFilters";
import Pagination from "@/components/Pagination";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Globe, AlertCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleBasedHome from "@/components/RoleBasedHome";
import PublicLanding from "@/components/public/PublicLanding";

export default function Home() {
  const { isSuperAdmin, isAdmin, isAG, isAuthenticated, loading: authLoading } = useAuth();
  const homeRouter = useRouter();
  const [data, setData] = useState<PagedResult<ZoneListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [deleteTarget, setDeleteTarget] = useState<ZoneListItem | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchZones = useCallback(async (pageNum?: number) => {
    setLoading(true);
    setError(null);
    try {
      const isActive = status ? parseInt(status) : undefined;
      const result = await getZones(pageNum || page, 20, search || undefined, isActive);
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch zones";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  // Users who should see the zones list landing: SuperAdmin only
  const showZonesList = isSuperAdmin;
  // Users who get a role-based dashboard instead of the zones list:
  // District Admin / Club Admin / AG (without SuperAdmin)
  const showRoleBasedDashboard = !authLoading && isAuthenticated && !showZonesList
    && (isAdmin || isAG);

  // Redirect Club Admin / District Admin / AG (non-SuperAdmin)
  // away from the home bento grid to their new role-specific dashboard. Same
  // routing decision the login page makes — keeps refreshes / stale sessions
  // landing in the right place.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (isSuperAdmin) return;
    if (!(isAdmin || isAG)) return;
    let cancelled = false;
    resolveDashboardLanding()
      .then((landing) => {
        if (cancelled) return;
        if (landing?.route && landing.route !== "/") {
          if (landing.available && landing.available.length > 0) {
            localStorage.setItem("dashboard_available", JSON.stringify(landing.available));
          }
          homeRouter.replace(landing.route);
        }
      })
      .catch(() => { /* stay on home if resolver fails */ });
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated, isSuperAdmin, isAdmin, isAG, homeRouter]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && showZonesList) fetchZones();
  }, [fetchZones, authLoading, isAuthenticated, showZonesList]);

  // Unauthenticated visitors: skip the public landing entirely and send them
  // straight to /login. The landing component (PublicLanding) is kept in the
  // codebase so it can be restored later — just revert this redirect.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      homeRouter.replace("/login");
    }
  }, [authLoading, isAuthenticated, homeRouter]);

  const handleSearch = () => {
    setPage(1);
    fetchZones(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    setError(null);
    const isActive = status ? parseInt(status) : undefined;
    getZones(newPage, 20, search || undefined, isActive)
      .then(result => setData(result))
      .catch(err => setError(err instanceof Error ? err.message : "Failed to fetch zones"))
      .finally(() => setLoading(false));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.zoneName;
    try {
      await deleteZone(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteSuccess(`${name} has been deleted successfully.`);
      fetchZones();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete zone.");
    }
  };

  // Not logged in — show the public marketing landing page (Cashfree
  // whitelisting requirement). Carries hero, services, INR pricing, and a
  // footer with links to Contact Us, Terms, Refunds & Cancellations, and
  // Privacy Policy. Authenticated users skip this branch entirely and get
  // the role-based experience below — exactly as before.
  // Unauthenticated → render nothing while the useEffect above pushes /login.
  // The earlier branch returned <PublicLanding /> — that's now disabled per
  // user request. To restore the landing later, swap this for the PublicLanding
  // render and remove the redirect useEffect.
  if (!authLoading && !isAuthenticated) {
    return null;
  }

  return (
    <ProtectedRoute>
      {showRoleBasedDashboard ? (
        <RoleBasedHome />
      ) : (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Zones</h2>
            <p className="text-muted-foreground text-base">Manage Rotary zones</p>
          </div>
          {isSuperAdmin && (
            <Button asChild>
              <Link href="/zones/new"><Plus className="mr-2 h-4 w-4" />Add Zone</Link>
            </Button>
          )}
        </div>

        <ZoneFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} viewMode={viewMode} onViewModeChange={setViewMode} onSearch={handleSearch} />

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
            <Button variant="outline" className="mt-4" onClick={() => fetchZones()}>Try Again</Button>
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No zones found</h3>
            <p className="text-muted-foreground mt-2">No zones available yet.</p>
          </div>
        )}

        {!loading && !error && data && data.items.length > 0 && (
          <>
            {viewMode === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.items.map((zone) => (
                  <ZoneCard key={zone.id} zone={zone} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />
                ))}
              </div>
            ) : (
              <ZoneTable zones={data.items} onDelete={setDeleteTarget} isSuperAdmin={isSuperAdmin} />
            )}
            <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
          </>
        )}

        <DeleteDialog open={!!deleteTarget} memberName={deleteTarget ? deleteTarget.zoneName : ""} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!deleteSuccess} title="Success" description={deleteSuccess || ""} onOk={() => setDeleteSuccess(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

      </div>
      )}
    </ProtectedRoute>
  );
}
