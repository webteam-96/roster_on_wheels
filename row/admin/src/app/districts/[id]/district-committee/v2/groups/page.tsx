"use client";

/**
 * District Committee — Groups V2 (dashboard palette).
 *
 * Mirrors `/districts/[id]/district-committee/groups/page.tsx` (V1) 1:1
 * in behaviour; only the visual chrome changes to the navy/gold palette from
 * `district-admin-dashboard/membership/page.tsx`. Every V1 state hook,
 * dialog, dropdown menu, search, pagination, add/edit/delete flow, drag
 * sort and auto-managed CP/CS lock behaviour is preserved verbatim; the
 * imports and service calls are identical to V1.
 *
 * ?returnTo=<url> — Back button honours it if present, otherwise falls
 * back to the V2 landing. Drilling into a specific group still goes to the
 * V1 `groups/[groupId]` page (not part of this task).
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getCommitteeGroups, getCommitteeGroupAvailableYears, createCommitteeGroup,
  updateCommitteeGroup, deleteCommitteeGroup, getRotaryYears, getDistrict, reorderCommitteeGroups,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, UsersRound, Users, MoreHorizontal, Layers, Lock, Search, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";

const PAGE_SIZE = 20;

// Auto-managed CP/CS groups — populated only via BOD; no manual edit/delete in UI.
// Pattern matches backend DcAutoGroupService.AutoGroupPattern (singular: "Club President" / "Club Secretary").
const isAutoManagedGroup = (groupName?: string): boolean => {
  if (!groupName) return false;
  return /^(Club Presidents?|Club Secretar(y|ies))( \d{4}-\d{2})?$/.test(groupName.trim());
};

export default function GroupCommitteeV2Page() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/districts/${districtId}/district-committee/v2${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const goBack = () => router.push(returnTo || fallbackBack);

  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [districtName, setDistrictName] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { dragProps } = useDragSort(groups, setGroups, async (ids) => {
    try { await reorderCommitteeGroups(districtId, ids); } catch { setErrorMessage("Failed to save order."); }
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [formGroupName, setFormGroupName] = useState("");
  const [formYearId, setFormYearId] = useState("");
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, allYrs, available] = await Promise.all([
          getDistrict(districtId), getRotaryYears(), getCommitteeGroupAvailableYears(districtId),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        setAllRotaryYears(allYrs);
        const availableIds = new Set(available.map((y: any) => Number(y.id)));
        const currentYear = allYrs.find((y: any) => y.isCurrent);
        if (currentYear) availableIds.add(currentYear.id);
        const filtered = allYrs.filter((y: any) => availableIds.has(y.id));
        setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
        const cy = filtered.find((y: any) => y.isCurrent) || filtered[0];
        if (cy) setSelectedYearId(String(cy.id));
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

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

  const handlePageChange = (newPage: number) => setPage(newPage);
  const handleSearch = () => { setPage(1); setSearchTerm(searchDraft.trim()); };
  const handleSearchKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } };
  const clearSearch = () => { setSearchDraft(""); setSearchTerm(""); setPage(1); };

  const refreshYears = async () => {
    try {
      const [av, allYrs] = await Promise.all([getCommitteeGroupAvailableYears(districtId), getRotaryYears()]);
      setAllRotaryYears(allYrs);
      const availableIds = new Set(av.map((y: any) => Number(y.id)));
      const currentYear = allYrs.find((y: any) => y.isCurrent);
      if (currentYear) availableIds.add(currentYear.id);
      const filtered = allYrs.filter((y: any) => availableIds.has(y.id));
      setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
    } catch {}
  };

  const openAddDialog = () => {
    setEditingGroup(null);
    setFormGroupName("");
    setFormYearId(selectedYearId);
    setDialogOpen(true);
  };

  const openEditDialog = (g: any) => {
    setEditingGroup(g);
    setFormGroupName(g.groupName);
    setFormYearId(String(g.yearId));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formGroupName.trim()) { setErrorMessage("Group name is required."); return; }
    setSaving(true);
    try {
      const payload = { groupName: formGroupName.trim(), yearId: Number(formYearId) };
      if (editingGroup) {
        await updateCommitteeGroup(districtId, editingGroup.id, payload);
        setSuccessMessage("Group updated.");
      } else {
        await createCommitteeGroup(districtId, payload);
        setSuccessMessage("Group created.");
      }
      setDialogOpen(false);
      fetchGroups(Number(selectedYearId), page, searchTerm);
      refreshYears();
    } catch { setErrorMessage("Failed to save."); }
    finally { setSaving(false); }
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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
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
              <h2 className="text-2xl font-bold tracking-tight text-ink">
                {districtName ? `${districtName} - Group Committee` : "Group Committee"}
              </h2>
              <p className="text-slate-600 text-base">Manage groups with members and sub-groups</p>
            </div>
          </div>
          {canManage && !loading && selectedYearId && (
            <Button
              onClick={openAddDialog}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Group
            </Button>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && allYears.length > 0 && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div className="w-full sm:w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {allYears.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9 pr-8 border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
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
                className="bg-azure hover:bg-mint-ink text-white"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g: any, idx: number) => (
              <div
                key={g.id}
                className={`cursor-pointer rounded-2xl border border-slate-200 shadow-sm bg-white transition-all hover:shadow-md hover:border-azure/30 ${navigatingId === g.id ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingId(g.id);
                  router.push(`/districts/${districtId}/district-committee/groups/${g.id}`);
                }}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    {canManage && (
                      <div {...dragProps(idx)} onClick={(e) => e.stopPropagation()} className="flex-shrink-0 mr-2 mt-1">
                        <GripVertical className="h-4 w-4 text-slate-400 cursor-grab" />
                      </div>
                    )}
                    <div className="flex items-center gap-3 flex-1">
                      {navigatingId === g.id ? <RotaryLoader size="sm" /> : <UsersRound className="h-8 w-8 text-ink flex-shrink-0" />}
                      <div>
                        <p className="font-semibold text-slate-800">{g.groupName}</p>
                        <p className="text-xs text-slate-500">{g.yearLabel}</p>
                      </div>
                    </div>
                    {canManage && !isAutoManagedGroup(g.groupName) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(g); }}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={(e) => { e.stopPropagation(); setDeleteTarget(g); }}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {isAutoManagedGroup(g.groupName) && (
                      <Badge
                        variant="secondary"
                        className="flex items-center gap-1 bg-slate-100 text-slate-600 border border-slate-200"
                        title="Auto-managed by BOD: edit via Board of Directors"
                      >
                        <Lock className="h-3 w-3" />Auto
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                      <Users className="h-4 w-4 text-slate-400" />
                      <span>{g.memberCount || 0} Members</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                      <Layers className="h-4 w-4 text-slate-400" />
                      <span>{g.subGroupCount || 0} Sub-Groups</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={PAGE_SIZE} onPageChange={handlePageChange} />
          </>
        )}

        {/* Add/Edit Group Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-ink">{editingGroup ? "Edit Group" : "Add Group"}</DialogTitle>
              <DialogDescription>{editingGroup ? "Update group name." : "Enter group name."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Group Name *</Label>
                <Input
                  value={formGroupName}
                  onChange={(e) => setFormGroupName(e.target.value)}
                  placeholder="Enter group name"
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Rotary Year *</Label>
                <Select value={formYearId} onValueChange={setFormYearId}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {allRotaryYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formGroupName.trim() || !formYearId}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editingGroup ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-red-600" title="Delete Group" description="Are you sure? This will delete the group, all its members, sub-groups, and sub-group members." confirmLabel="Delete" confirmClassName="bg-red-600 text-white hover:bg-red-700" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
