"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ZoneListItem } from "@/types/zone";
import { PagedResult } from "@/types/member";
import { getZones, deleteZone, toggleZonalAwards, getZonalCoordinator, assignZonalCoordinator, removeZonalCoordinator, searchZoneMembers, resolveDashboardLanding } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ZoneCard from "@/components/ZoneCard";
import ZoneTable from "@/components/ZoneTable";
import ZoneFilters from "@/components/ZoneFilters";
import Pagination from "@/components/Pagination";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Globe, AlertCircle, Users, X, Search, Loader2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleBasedHome from "@/components/RoleBasedHome";
import PublicLanding from "@/components/public/PublicLanding";

export default function Home() {
  const { isSuperAdmin, isAdmin, isZonalCoordinator, isRIDirector, isAG, isClubModerator, isAuthenticated, loading: authLoading } = useAuth();
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

  // Coordinator dialog state
  const [coordinatorTarget, setCoordinatorTarget] = useState<ZoneListItem | null>(null);
  const [coordinator, setCoordinator] = useState<{ memberId: number; memberName: string; email: string; assignedDate: string } | null>(null);
  const [coordLoading, setCoordLoading] = useState(false);
  const [coordSearch, setCoordSearch] = useState("");
  const [coordSearchResults, setCoordSearchResults] = useState<{ memberId: number; memberName: string; email: string; clubName: string; districtNumber: string }[]>([]);
  const [coordSearching, setCoordSearching] = useState(false);
  const [coordAssigning, setCoordAssigning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isZonalOnly = !authLoading && isAuthenticated && isZonalCoordinator && !isSuperAdmin && !isAdmin;
  const isRIDirectorOnly = !authLoading && isAuthenticated && isRIDirector && !isSuperAdmin && !isAdmin && !isZonalCoordinator;

  // Users who should see the zones list landing: SuperAdmin only
  const showZonesList = isSuperAdmin;
  // Users who get a role-based dashboard instead of the zones list:
  // District Admin / Club Admin / AG / Moderator (without SuperAdmin / RI Director / ZC-only)
  const showRoleBasedDashboard = !authLoading && isAuthenticated && !showZonesList && !isZonalOnly && !isRIDirectorOnly
    && (isAdmin || isAG || isClubModerator);

  // Redirect ZonalCoordinator-only users to their dashboard
  useEffect(() => {
    if (isZonalOnly) {
      homeRouter.replace("/zonal-dashboard");
    }
  }, [isZonalOnly, homeRouter]);

  // Redirect RIDirector-only users to their dashboard (V2)
  useEffect(() => {
    if (isRIDirectorOnly) {
      homeRouter.replace("/ri-director/v2");
    }
  }, [isRIDirectorOnly, homeRouter]);

  // Redirect Club Admin / District Admin / AG / Club Moderator (non-SuperAdmin)
  // away from the home bento grid to their new role-specific dashboard. Same
  // routing decision the login page makes — keeps refreshes / stale sessions
  // landing in the right place.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (isSuperAdmin || isZonalOnly || isRIDirectorOnly) return;
    if (!(isAdmin || isAG || isClubModerator)) return;
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
  }, [authLoading, isAuthenticated, isSuperAdmin, isZonalOnly, isRIDirectorOnly, isAdmin, isAG, isClubModerator, homeRouter]);

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

  const openCoordinatorDialog = async (zone: ZoneListItem) => {
    setCoordinatorTarget(zone);
    setCoordinator(null);
    setCoordSearch("");
    setCoordSearchResults([]);
    setCoordLoading(true);
    try {
      const data = await getZonalCoordinator(zone.id);
      setCoordinator(data);
    } catch {
      setCoordinator(null);
    } finally {
      setCoordLoading(false);
    }
  };

  const handleCoordSearch = (value: string) => {
    setCoordSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!coordinatorTarget || value.length < 2) {
      setCoordSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setCoordSearching(true);
      try {
        const results = await searchZoneMembers(coordinatorTarget.id, value);
        setCoordSearchResults(results);
      } catch {
        setCoordSearchResults([]);
      } finally {
        setCoordSearching(false);
      }
    }, 400);
  };

  const handleAssignCoordinator = async (memberId: number) => {
    if (!coordinatorTarget) return;
    setCoordAssigning(true);
    try {
      await assignZonalCoordinator(memberId, coordinatorTarget.id);
      setDeleteSuccess("Zonal Coordinator assigned successfully.");
      setCoordSearch("");
      setCoordSearchResults([]);
      // Refresh coordinator
      const data = await getZonalCoordinator(coordinatorTarget.id);
      setCoordinator(data);
      fetchZones();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to assign Zonal Coordinator.");
    } finally {
      setCoordAssigning(false);
    }
  };

  const handleRemoveCoordinator = async () => {
    if (!coordinatorTarget) return;
    setCoordAssigning(true);
    try {
      await removeZonalCoordinator(coordinatorTarget.id);
      setCoordinator(null);
      setDeleteSuccess("Zonal Coordinator removed successfully.");
      fetchZones();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to remove Zonal Coordinator.");
    } finally {
      setCoordAssigning(false);
    }
  };

  const handleToggleZonalAwards = (zone: ZoneListItem) => {
    toggleZonalAwards(zone.id)
      .then((result) => {
        fetchZones();
        setDeleteSuccess(result.isZonalAwardsEnabled ? `Zonal Awards enabled for ${zone.zoneName}` : `Zonal Awards disabled for ${zone.zoneName}`);
      })
      .catch(() => {
        setErrorMessage("Failed to toggle Zonal Awards.");
      });
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

  // ZonalCoordinator-only and RIDirector-only users are redirected, don't render this page
  if (isZonalOnly || isRIDirectorOnly) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" />
      </div>
    );
  }

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
                  <ZoneCard key={zone.id} zone={zone} onDelete={setDeleteTarget} onCoordinator={openCoordinatorDialog} onToggleZonalAwards={handleToggleZonalAwards} isSuperAdmin={isSuperAdmin} />
                ))}
              </div>
            ) : (
              <ZoneTable zones={data.items} onDelete={setDeleteTarget} onCoordinator={openCoordinatorDialog} onToggleZonalAwards={handleToggleZonalAwards} isSuperAdmin={isSuperAdmin} />
            )}
            <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
          </>
        )}

        <DeleteDialog open={!!deleteTarget} memberName={deleteTarget ? deleteTarget.zoneName : ""} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!deleteSuccess} title="Success" description={deleteSuccess || ""} onOk={() => setDeleteSuccess(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Zonal Coordinator Dialog */}
        <Dialog open={!!coordinatorTarget} onOpenChange={(open) => { if (!open) setCoordinatorTarget(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Zonal Co-ordinator: {coordinatorTarget?.zoneName}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {coordLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : coordinator ? (
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-primary">{coordinator.memberName}</p>
                      <p className="text-sm text-muted-foreground">{coordinator.email}</p>
                      {coordinator.assignedDate && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Assigned: {new Date(coordinator.assignedDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Button variant="destructive" size="sm" disabled={coordAssigning} onClick={handleRemoveCoordinator}>
                      {coordAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No coordinator assigned.</p>
              )}

              {!coordLoading && !coordinator && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Search & assign a member from this zone:</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={coordSearch}
                      onChange={(e) => handleCoordSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {coordSearching && (
                    <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                  )}
                  {coordSearchResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                      {coordSearchResults.map((m) => (
                        <div key={m.memberId} className="flex items-center justify-between p-2 hover:bg-muted/50">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{m.memberName}</p>
                            <p className="text-xs text-muted-foreground truncate">Dist {m.districtNumber} • {m.clubName}</p>
                          </div>
                          <Button size="sm" variant="outline" disabled={coordAssigning} onClick={() => handleAssignCoordinator(m.memberId)}>
                            {coordAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {coordSearch.length >= 2 && !coordSearching && coordSearchResults.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">No members found.</p>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      )}
    </ProtectedRoute>
  );
}
