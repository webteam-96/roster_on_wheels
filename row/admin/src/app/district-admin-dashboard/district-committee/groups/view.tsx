"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * District Committee — Groups (DA-dashboard palette).
 *
 * Mirrors `/districts/[id]/district-committee/v2/groups/page.tsx` 1:1 in
 * behaviour, but rendered inside the DistrictAdminDashboardLayoutClient shell.
 * Reads districtId from AuthContext (selectedDistrictId) instead of the URL,
 * and defaults returnTo/back to the DA-dashboard landing page. Drilling into
 * a specific group still routes to the V1 `groups/[groupId]` page (out of
 * scope this round).
 */

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getCommitteeGroups, getCommitteeGroupAvailableYears,
  deleteCommitteeGroup, getRotaryYears, getDistrict, reorderCommitteeGroups,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, Pencil, Trash2, AlertTriangle, UsersRound, Lock, Search, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";

const PAGE_SIZE = 10000; // no pagination — full list so drag-sort works across all groups

// Auto-managed CP/CS groups — populated only via BOD; no manual edit/delete in UI.
// Pattern matches backend DcAutoGroupService.AutoGroupPattern (singular: "Club President" / "Club Secretary").
const isAutoManagedGroup = (groupName?: string): boolean => {
  if (!groupName) return false;
  return /^(Club Presidents?|Club Secretar(y|ies))( \d{4}-\d{2})?$/.test(groupName.trim());
};

export function GroupCommitteeView({ embedded = false }: { embedded?: boolean } = {}) {
  const { selectedDistrictId, isSuperAdmin, isAdmin, user } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");
  // ALWAYS route back to the district-committee landing (not straight to
  // returnTo). The landing then honours returnTo. Chain: sub-page →
  // landing → returnTo. Carry returnTo + yearId forward.
  const backParams = new URLSearchParams();
  if (returnTo) backParams.set("returnTo", returnTo);
  if (currentYearId) backParams.set("yearId", currentYearId);
  const backQs = backParams.toString();
  const goBack = () => router.push(
    `/district-admin-dashboard/district-committee${backQs ? `?${backQs}` : ""}`,
  );


  const [districtName, setDistrictName] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // A committee group and its members belong to a Rotary year. Sub-groups hang
  // off a group, so the group's year governs those too.
  const { years: rotaryYears } = useRotaryYears();
  const rights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYear(rights, Number(selectedYearId) || undefined, isSuperAdmin);
  const editableYears = heldYearLabels(rights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { dragProps } = useDragSort(groups, setGroups, async (ids) => {
    try { await reorderCommitteeGroups(districtId, ids); } catch { setErrorMessage("Failed to save order."); }
  });

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  // Global year filter — the top-bar (?yearId=) is the ONLY year source
  // for this page. Trust it verbatim so empty years show empty state.
  const urlYearId = searchParams.get("yearId");

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, allYrs, available] = await Promise.all([
          getDistrict(districtId), getRotaryYears(), getCommitteeGroupAvailableYears(districtId),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        const availableIds = new Set(available.map((y: any) => Number(y.id)));
        const currentYear = allYrs.find((y: any) => y.isCurrent);
        if (currentYear) availableIds.add(currentYear.id);
        const filtered = allYrs.filter((y: any) => availableIds.has(y.id));
        setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
        if (urlYearId) {
          setSelectedYearId(urlYearId);
        } else {
          const cy = currentYear || filtered.find((y: any) => y.isCurrent) || filtered[0];
          if (cy) setSelectedYearId(String(cy.id));
        }
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  // React to top-bar year changes verbatim.
  useEffect(() => {
    if (!urlYearId) return;
    if (urlYearId !== selectedYearId) setSelectedYearId(urlYearId);
  }, [urlYearId, selectedYearId]);

  const fetchGroups = useCallback(async (yearId: number, pageNum: number = 1, search?: string) => {
    setLoadingGroups(true);
    try {
      const data = await getCommitteeGroups(districtId, yearId, pageNum, PAGE_SIZE, search || undefined);
      if (Array.isArray(data)) {
        setGroups(data); setTotalCount(data.length); setTotalPages(1);
      } else {
        setGroups(Array.isArray(data?.items) ? data.items : []);
        setTotalCount(Number(data?.totalCount || 0));
        setTotalPages(Number(data?.totalPages || 0));
      }
    } catch { setErrorMessage("Failed to load groups."); }
    finally { setLoadingGroups(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchGroups(Number(selectedYearId), page, searchTerm);
    else { setGroups([]); setTotalCount(0); setTotalPages(0); }
  }, [selectedYearId, page, searchTerm, fetchGroups]);

  useEffect(() => { setPage(1); }, [selectedYearId]);

  if (!districtId) return null; // wait for auth

  const handlePageChange = (newPage: number) => setPage(newPage);
  const handleSearch = () => { setPage(1); setSearchTerm(searchDraft.trim()); };
  const handleSearchKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } };
  const clearSearch = () => { setSearchDraft(""); setSearchTerm(""); setPage(1); };

  const refreshYears = async () => {
    try {
      const [av, allYrs] = await Promise.all([getCommitteeGroupAvailableYears(districtId), getRotaryYears()]);
      const availableIds = new Set(av.map((y: any) => Number(y.id)));
      const currentYear = allYrs.find((y: any) => y.isCurrent);
      if (currentYear) availableIds.add(currentYear.id);
      const filtered = allYrs.filter((y: any) => availableIds.has(y.id));
      setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
    } catch {}
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCommitteeGroup(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Group deleted.");
      fetchGroups(Number(selectedYearId), page, searchTerm);
      refreshYears();
    } catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
  };

  const body = (
      <div className="space-y-6">
        {!canManage && (
          <ViewOnlyBadge editableYears={editableYears} className="mb-4" />
        )}

        {!embedded && (
          <PageHeader title={districtName ? `${districtName} - Group Committee` : "Group Committee"} description="Manage groups with members and sub-groups" back={() => goBack()} />
        )}
        {!embedded && <DistrictMembershipTabBar />}

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && allYears.length > 0 && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Year Select removed — top-bar year (?yearId=) drives filter. */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9 pr-8"
                placeholder="Search by group name..."
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={handleSearchKey}
              />
              {searchTerm && (
                <Button aria-label="Clear search" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 w-6 w-6 w-6 h-6 w-6" onClick={clearSearch} type="button">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleSearch}
                type="button"
               
              >
                <Search className="mr-2 h-4 w-4" />Search
              </Button>
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSearch}
                 
                >
                  <X className="mr-1 h-4 w-4" />Clear
                </Button>
              )}
              {/* Add Group next to Search (moved out of the page header), matching the DC listing.
                  Navigates to the dedicated add page (name + mandatory members) — no popup. */}
              {canManage && selectedYearId && (
                <Button
                  size="sm"
                  onClick={() => router.push(`/district-admin-dashboard/district-committee/groups/add${backQs ? `?${backQs}` : ""}`)}
                 
                >
                  <Plus className="mr-2 h-4 w-4" />Add Group
                </Button>
              )}
            </div>
          </div>
        )}

        {loadingGroups && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingGroups && selectedYearId && groups.length === 0 && (
          <Card className="flex flex-col items-center justify-center py-20 text-center">
            <UsersRound className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="row-h2">{searchTerm ? "No matches found" : "No groups yet"}</h3>
            <p className="text-slate-600 mt-2">
              {searchTerm ? `No groups match "${searchTerm}".` : (canManage ? 'Click "Add Group" to create a group.' : "No groups created yet.")}
            </p>
          </Card>
        )}

        {!loading && !loadingGroups && groups.length > 0 && (
          <>
          <Card className="overflow-x-auto">
            <Table className="w-full min-w-[640px] md:min-w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 text-left w-12">#</TableHead>
                  <TableHead className="px-4 text-left">Group Name</TableHead>
                  <TableHead className="px-4 text-left">Type</TableHead>
                  <TableHead className="px-4 text-right">Members</TableHead>
                  <TableHead className="px-4 text-right">Sub-Groups</TableHead>
                  <TableHead className="px-4 text-right w-16">Actions</TableHead>
                  {canManage && <TableHead className="px-3 text-center w-14">Sort</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {groups.map((g: any, idx: number) => (
                  <TableRow
                    key={g.id}
                    className={`hover:bg-slate-50/60 ${navigatingId === g.id ? "opacity-70 pointer-events-none" : ""}`}
                  >
                    <TableCell className="px-4 py-2.5 text-slate-500 tabular-nums">{idx + 1}</TableCell>
                    <TableCell className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {navigatingId === g.id ? <RotaryLoader size="sm" /> : <UsersRound className="h-5 w-5 text-ink flex-shrink-0" />}
                        <span className="font-medium text-slate-800">{g.groupName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      {isAutoManagedGroup(g.groupName) ? (
                        <Badge
                          variant="secondary" className="flex w-fit items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200"
                          title="Auto-managed by BOD: edit via Board of Directors"
                        >
                          <Lock className="h-3 w-3" />Auto
                        </Badge>
                      ) : (
                        <span className="text-slate-500">Manual</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums text-slate-700">{g.memberCount || 0}</TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums text-slate-700">{g.subGroupCount || 0}</TableCell>
                    <TableCell className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && !isAutoManagedGroup(g.groupName) && (
                          <>
                            <Button aria-label="Edit" variant="ghost" size="icon" className="row-btn-sm" onClick={() => { setNavigatingId(g.id); router.push(`/district-admin-dashboard/district-committee/groups/${g.id}${backQs ? `?${backQs}` : ""}`); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button aria-label="Delete" variant="ghost" size="icon" className="text-red-600 row-btn-sm" onClick={() => setDeleteTarget(g)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell className="px-3 py-2.5 text-center" {...dragProps(idx)} onClick={(e) => e.stopPropagation()}>
                        <GripVertical className="h-4 w-4 text-slate-400 inline-block cursor-grab" />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          </>
        )}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-red-600" title="Delete Group" description="Are you sure? This will delete the group, all its members, sub-groups, and sub-group members." confirmLabel="Delete" confirmClassName="bg-red-600 text-white hover:bg-red-700" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
  );
  return embedded ? body : <ProtectedRoute>{body}</ProtectedRoute>;
}
