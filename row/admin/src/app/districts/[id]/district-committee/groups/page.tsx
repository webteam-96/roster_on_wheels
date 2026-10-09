"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getCommitteeGroups, getCommitteeGroupAvailableYears, createCommitteeGroup,
  updateCommitteeGroup, deleteCommitteeGroup, getRotaryYears, getDistrict, reorderCommitteeGroups,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, UsersRound, Users, MoreHorizontal, Layers, Lock, Search, X } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";

const PAGE_SIZE = 20;

// Auto-managed CP/CS groups — populated only via BOD; no manual edit/delete in UI.
// Pattern matches backend DcAutoGroupService.AutoGroupPattern (singular: "Club President" / "Club Secretary").
const isAutoManagedGroup = (groupName?: string): boolean => {
  if (!groupName) return false;
  return /^(Club Presidents?|Club Secretar(y|ies))( \d{4}-\d{2})?$/.test(groupName.trim());
};

export default function GroupCommitteePage() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
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
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/district-committee`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtName ? `${districtName} - Group Committee` : "Group Committee"}
              </h2>
              <p className="text-muted-foreground text-base">Manage groups with members and sub-groups</p>
            </div>
          </div>
          {canManage && !loading && selectedYearId && (
            <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Group</Button>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && allYears.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {allYears.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 pr-8"
                placeholder="Search by group name..."
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={handleSearchKey}
              />
              {searchTerm && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={clearSearch} type="button">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleSearch} type="button">Search</Button>
          </div>
        )}

        {loadingGroups && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingGroups && selectedYearId && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UsersRound className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">{searchTerm ? "No matches found" : "No groups yet"}</h3>
            <p className="text-muted-foreground mt-2">
              {searchTerm ? `No groups match "${searchTerm}".` : (canManage ? 'Click "Add Group" to create a group.' : "No groups created yet.")}
            </p>
          </div>
        )}

        {!loading && !loadingGroups && groups.length > 0 && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g: any, idx: number) => (
              <Card
                key={g.id}
                className={`cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${navigatingId === g.id ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingId(g.id);
                  router.push(`/districts/${districtId}/district-committee/groups/${g.id}`);
                }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    {canManage && <div {...dragProps(idx)} onClick={(e) => e.stopPropagation()} className="flex-shrink-0 mr-2 mt-1"><GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" /></div>}
                    <div className="flex items-center gap-3">
                      {navigatingId === g.id ? <RotaryLoader size="sm" /> : <UsersRound className="h-8 w-8 text-primary flex-shrink-0" />}
                      <div>
                        <p className="font-semibold">{g.groupName}</p>
                        <p className="text-xs text-muted-foreground">{g.yearLabel}</p>
                      </div>
                    </div>
                    {canManage && !isAutoManagedGroup(g.groupName) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(g); }}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(g); }}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {isAutoManagedGroup(g.groupName) && (
                      <Badge variant="secondary" className="flex items-center gap-1" title="Auto-managed by BOD — edit via Board of Directors">
                        <Lock className="h-3 w-3" />Auto
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{g.memberCount || 0} Members</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Layers className="h-4 w-4" />
                      <span>{g.subGroupCount || 0} Sub-Groups</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={PAGE_SIZE} onPageChange={handlePageChange} />
          </>
        )}

        {/* Add/Edit Group Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingGroup ? "Edit Group" : "Add Group"}</DialogTitle>
              <DialogDescription>{editingGroup ? "Update group name." : "Enter group name."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Group Name *</Label>
                <Input value={formGroupName} onChange={(e) => setFormGroupName(e.target.value)} placeholder="Enter group name" />
              </div>
              <div className="space-y-2">
                <Label>Rotary Year *</Label>
                <Select value={formYearId} onValueChange={setFormYearId}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {allRotaryYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formGroupName.trim() || !formYearId}>
                {saving ? "Saving..." : editingGroup ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Group" description="Are you sure? This will delete the group, all its members, sub-groups, and sub-group members." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
