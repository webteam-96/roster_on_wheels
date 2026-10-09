"use client";

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

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getCommitteeGroups, getCommitteeGroupAvailableYears,
  deleteCommitteeGroup, getRotaryYears, getDistrict, reorderCommitteeGroups,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, UsersRound, Users, MoreHorizontal, Layers, Lock, Search, X } from "lucide-react";
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
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
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

  const canManage = isSuperAdmin || isAdmin;

  const [districtName, setDistrictName] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
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
        {!embedded && <DistrictMembershipTabBar />}
        {!embedded && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={goBack}
                className="border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">
                  {districtName ? `${districtName} - Group Committee` : "Group Committee"}
                </h2>
                <p className="text-slate-600 text-sm">Manage groups with members and sub-groups</p>
              </div>
            </div>
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && allYears.length > 0 && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-slate-50 p-4 rounded-2xl border border-slate-200">
            {/* Year Select removed — top-bar year (?yearId=) drives filter. */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9 pr-8 border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                placeholder="Search by group name..."
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={handleSearchKey}
              />
              {searchTerm && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-slate-500 hover:text-slate-800" onClick={clearSearch} type="button">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleSearch}
                type="button"
                className="bg-[#1e3a5f] hover:bg-[#152a44] text-white"
              >
                <Search className="mr-2 h-4 w-4" />Search
              </Button>
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSearch}
                  className="text-slate-600 hover:text-slate-800"
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
                  className="bg-[#1e3a5f] hover:bg-[#152a44] text-white"
                >
                  <Plus className="mr-2 h-4 w-4" />Add Group
                </Button>
              )}
            </div>
          </div>
        )}

        {loadingGroups && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingGroups && selectedYearId && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <UsersRound className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">{searchTerm ? "No matches found" : "No groups yet"}</h3>
            <p className="text-slate-600 mt-2">
              {searchTerm ? `No groups match "${searchTerm}".` : (canManage ? 'Click "Add Group" to create a group.' : "No groups created yet.")}
            </p>
          </div>
        )}

        {!loading && !loadingGroups && groups.length > 0 && (
          <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left w-12">#</th>
                  <th className="px-4 py-3 text-left">Group Name</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3 text-right">Sub-Groups</th>
                  <th className="px-4 py-3 text-right w-16">Actions</th>
                  {canManage && <th className="px-3 py-3 text-center w-14">Sort</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g: any, idx: number) => (
                  <tr
                    key={g.id}
                    className={`hover:bg-slate-50/60 ${navigatingId === g.id ? "opacity-70 pointer-events-none" : ""}`}
                  >
                    <td className="px-4 py-2.5 text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {navigatingId === g.id ? <RotaryLoader size="sm" /> : <UsersRound className="h-5 w-5 text-[#1e3a5f] flex-shrink-0" />}
                        <span className="font-medium text-slate-800">{g.groupName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {isAutoManagedGroup(g.groupName) ? (
                        <Badge
                          variant="secondary"
                          className="flex w-fit items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200"
                          title="Auto-managed by BOD — edit via Board of Directors"
                        >
                          <Lock className="h-3 w-3" />Auto
                        </Badge>
                      ) : (
                        <span className="text-slate-500">Manual</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{g.memberCount || 0}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{g.subGroupCount || 0}</td>
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && !isAutoManagedGroup(g.groupName) && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100" onClick={() => { setNavigatingId(g.id); router.push(`/district-admin-dashboard/district-committee/groups/${g.id}${backQs ? `?${backQs}` : ""}`); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteTarget(g)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2.5 text-center" {...dragProps(idx)} onClick={(e) => e.stopPropagation()}>
                        <GripVertical className="h-4 w-4 text-slate-400 inline-block cursor-grab" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-red-600" title="Delete Group" description="Are you sure? This will delete the group, all its members, sub-groups, and sub-group members." confirmLabel="Delete" confirmClassName="bg-red-600 text-white hover:bg-red-700" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
  );
  return embedded ? body : <ProtectedRoute>{body}</ProtectedRoute>;
}
