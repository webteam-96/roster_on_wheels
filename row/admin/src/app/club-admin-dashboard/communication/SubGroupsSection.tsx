"use client";

/**
 * Club Admin · Communication → Subgroups (V2, inside the club-admin shell).
 * A faithful port of the V1 module (src/app/clubs/[id]/sub-groups/page.tsx) rendered
 * inline as a Communication tab: year filter, list, add/edit dialog with the two-panel
 * member picker, view-members dialog, and delete. clubId comes from the tab prop.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { SubGroup, SubGroupDetail, SubGroupMember } from "@/types/subGroup";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getSubGroups, getSubGroupDetail, createSubGroup, updateSubGroup, deleteSubGroup,
  getSubGroupClubMembers, getRotaryYears, getClubSubGroupAvailableYears, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, Pencil, Trash2, MoreHorizontal, Users, User, Search, AlertTriangle, X, Eye } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";

export default function SubGroupsSection({ clubId }: { clubId: number }) {
  const { isSuperAdmin, isAdmin } = useAuth();

  const [groups, setGroups] = useState<SubGroup[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);           // listing filter (years with data + current)
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]); // full list — Add dialog dropdown
  const [dialogYearId, setDialogYearId] = useState<string>("");
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SubGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");

  const [allMembers, setAllMembers] = useState<SubGroupMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set());
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [viewGroup, setViewGroup] = useState<SubGroupDetail | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [loadingView, setLoadingView] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SubGroup | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  const fetchInitialData = useCallback(async () => {
    if (!clubId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [availableYears, allYearsData] = await Promise.all([
        getClubSubGroupAvailableYears(clubId),
        getRotaryYears(),
      ]);
      setAllRotaryYears(allYearsData);
      const availableIds = new Set<number>(availableYears.map((y: { id: number }) => y.id));
      const currentYear = allYearsData.find((y) => y.isCurrent);
      if (currentYear) availableIds.add(currentYear.id);
      const filtered = allYearsData.filter((y) => availableIds.has(y.id));
      setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
      const defaultYear = filtered.find((y) => y.isCurrent) || filtered[0];
      if (defaultYear) setSelectedYearId(String(defaultYear.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  const fetchGroups = useCallback(async (yearId: number) => {
    setLoadingGroups(true);
    try {
      setGroups(await getSubGroups(clubId, yearId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load sub groups.");
    } finally {
      setLoadingGroups(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) fetchGroups(Number(selectedYearId));
    else setGroups([]);
  }, [selectedYearId, fetchGroups]);

  const loadAllMembers = async () => {
    setLoadingMembers(true);
    try {
      setAllMembers(await getSubGroupClubMembers(clubId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load club members.");
    } finally {
      setLoadingMembers(false);
    }
  };

  const openAddDialog = async () => {
    setEditingGroup(null);
    setGroupName("");
    setSelectedMemberIds(new Set());
    setMemberSearchQuery("");
    setDialogYearId(selectedYearId);
    setDialogOpen(true);
    await loadAllMembers();
  };

  const openEditDialog = async (group: SubGroup) => {
    setEditingGroup(group);
    setGroupName(group.groupName);
    setMemberSearchQuery("");
    setDialogOpen(true);
    setLoadingMembers(true);
    try {
      const [members, detail] = await Promise.all([
        getSubGroupClubMembers(clubId),
        getSubGroupDetail(clubId, group.id),
      ]);
      setAllMembers(members);
      setSelectedMemberIds(new Set(detail.members.map((m) => m.memberId)));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load members.");
    } finally {
      setLoadingMembers(false);
    }
  };

  const openViewDialog = async (group: SubGroup) => {
    setLoadingView(true);
    setViewDialogOpen(true);
    try {
      setViewGroup(await getSubGroupDetail(clubId, group.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load group details.");
      setViewDialogOpen(false);
    } finally {
      setLoadingView(false);
    }
  };

  const selectedMembers = useMemo(
    () => allMembers.filter((m) => selectedMemberIds.has(m.memberId)),
    [allMembers, selectedMemberIds]
  );

  const availableMembers = useMemo(() => {
    const available = allMembers.filter((m) => !selectedMemberIds.has(m.memberId));
    if (!memberSearchQuery.trim()) return available;
    const q = memberSearchQuery.toLowerCase();
    return available.filter((m) =>
      (m.memberName || "").toLowerCase().includes(q) ||
      (m.mobileNumber || "").toLowerCase().includes(q) ||
      (m.email || "").toLowerCase().includes(q)
    );
  }, [allMembers, selectedMemberIds, memberSearchQuery]);

  const toggleMember = (memberId: number) => setSelectedMemberIds((prev) => {
    const next = new Set(prev);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    return next;
  });
  const removeMember = (memberId: number) => setSelectedMemberIds((prev) => {
    const next = new Set(prev); next.delete(memberId); return next;
  });
  const selectAllAvailable = (checked: boolean) => setSelectedMemberIds((prev) => {
    const next = new Set(prev);
    availableMembers.forEach((m) => checked ? next.add(m.memberId) : next.delete(m.memberId));
    return next;
  });

  const handleSave = async () => {
    if (!groupName.trim()) { setErrorMessage("Please enter a group name."); return; }
    setSaving(true);
    try {
      const memberIds = Array.from(selectedMemberIds);
      if (editingGroup) {
        await updateSubGroup(clubId, editingGroup.id, { groupName: groupName.trim(), memberIds });
        setSuccessMessage("Sub group updated successfully.");
      } else {
        if (!dialogYearId) { setErrorMessage("Please select a Rotary Year."); setSaving(false); return; }
        await createSubGroup(clubId, { yearId: Number(dialogYearId), groupName: groupName.trim(), memberIds });
        setSuccessMessage("Sub group created successfully.");
        if (dialogYearId !== selectedYearId) {
          setSelectedYearId(dialogYearId);
          setAllYears((prev) => {
            if (prev.some((y) => String(y.id) === dialogYearId)) return prev;
            const yr = allRotaryYears.find((y) => String(y.id) === dialogYearId);
            return yr ? [...prev, yr].sort((a, b) => b.yearLabel.localeCompare(a.yearLabel)) : prev;
          });
        }
      }
      setDialogOpen(false);
      fetchGroups(Number(editingGroup ? selectedYearId : dialogYearId));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save sub group.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSubGroup(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Sub group deleted successfully.");
      fetchGroups(Number(selectedYearId));
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete sub group.");
    }
  };

  const filteredGroups = groups.filter((g) =>
    !searchQuery || (g.groupName || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Users className="h-4 w-4" />
          <span className="text-sm font-semibold">Subgroups: organise members into groups (used as Mass email recipient lists)</span>
        </div>
        {canManage && !loading && selectedYearId && (
          <Button onClick={openAddDialog} className="bg-azure hover:bg-mint-ink text-white">
            <Plus className="mr-2 h-4 w-4" />Add Sub Group
          </Button>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-16"><RotaryLoader size="lg" /></div>}

      {/* Year filter */}
      {!loading && allYears.length > 0 && (
        <div className="max-w-xs">
          <Select value={selectedYearId} onValueChange={setSelectedYearId}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {allYears.map((y) => (
                <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loadingGroups && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

      {!loading && !loadingGroups && selectedYearId && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No sub groups found</h3>
          <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Sub Group" to create one.' : "No sub groups have been created yet."}</p>
        </div>
      )}

      {!loading && !loadingGroups && groups.length > 0 && (
        <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search by group name..." />
      )}

      {!loading && !loadingGroups && filteredGroups.length === 0 && groups.length > 0 && searchQuery && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No results found</h3>
          <p className="text-muted-foreground mt-2">No sub groups match your search &quot;{searchQuery}&quot;.</p>
        </div>
      )}

      {!loading && !loadingGroups && filteredGroups.length > 0 && (
        <>
          {/* Mobile cards */}
          <div className="block sm:hidden space-y-3">
            {filteredGroups.map((group) => (
              <Card key={group.id} className="border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <button className="font-semibold text-primary truncate hover:underline text-left" onClick={() => openViewDialog(group)}>
                        {group.groupName}
                      </button>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary"><Users className="mr-1 h-3 w-3" />{group.memberCount} {group.memberCount === 1 ? "member" : "members"}</Badge>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openViewDialog(group)}><Eye className="mr-2 h-4 w-4" />View Members</DropdownMenuItem>
                        {canManage && (<>
                          <DropdownMenuItem onClick={() => openEditDialog(group)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(group)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                        </>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:opacity-100" style={{ backgroundColor: "#17458f" }}>
                  <TableHead className="text-white text-base font-semibold">Group Name</TableHead>
                  <TableHead className="text-white text-base font-semibold text-center">Members</TableHead>
                  <TableHead className="w-12 text-white"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGroups.map((group) => (
                  <TableRow key={group.id} className="hover:bg-slate-50 transition-colors">
                    <TableCell>
                      <button className="font-semibold text-primary hover:underline text-left" onClick={() => openViewDialog(group)}>{group.groupName}</button>
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary"><Users className="mr-1 h-3 w-3" />{group.memberCount}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openViewDialog(group)}><Eye className="mr-2 h-4 w-4" />View Members</DropdownMenuItem>
                          {canManage && (<>
                            <DropdownMenuItem onClick={() => openEditDialog(group)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(group)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Sub Group" : "Add Sub Group"}</DialogTitle>
            <DialogDescription>{editingGroup ? "Update the group name and manage members." : "Create a new sub group and add members."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 flex-1 overflow-hidden flex flex-col">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input id="groupName" placeholder="Enter group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Rotary Year</Label>
              {editingGroup ? (
                <div className="px-3 py-2 border rounded-md bg-muted text-sm">
                  {allRotaryYears.find((y) => y.id === editingGroup.yearId)?.yearLabel ||
                    allYears.find((y) => String(y.id) === selectedYearId)?.yearLabel || "–"}
                </div>
              ) : (
                <Select value={dialogYearId} onValueChange={setDialogYearId}>
                  <SelectTrigger><SelectValue placeholder="Select Rotary Year" /></SelectTrigger>
                  <SelectContent>
                    {allRotaryYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
              <Label>Members</Label>
              {loadingMembers ? (
                <div className="flex items-center justify-center py-8"><RotaryLoader size="md" /></div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 overflow-hidden">
                  {/* Available */}
                  <div className="border rounded-md flex flex-col overflow-hidden">
                    <div className="px-3 py-2 border-b bg-muted/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">Available Members</span>
                        <span className="text-xs text-muted-foreground">{availableMembers.length} available</span>
                      </div>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="Search by name, mobile, email..." value={memberSearchQuery} onChange={(e) => setMemberSearchQuery(e.target.value)} className="pl-8 h-8 text-sm" />
                        {memberSearchQuery && (
                          <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setMemberSearchQuery("")}><X className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </div>
                    {availableMembers.length > 0 && (
                      <div className="px-3 py-1.5 border-b flex items-center gap-2">
                        <Checkbox id="selectAll" checked={availableMembers.length > 0 && availableMembers.every((m) => selectedMemberIds.has(m.memberId))} onCheckedChange={(checked) => selectAllAvailable(!!checked)} />
                        <label htmlFor="selectAll" className="text-xs font-medium cursor-pointer">Select All ({availableMembers.length})</label>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto max-h-[280px]">
                      {availableMembers.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">{memberSearchQuery ? "No members match search" : "No available members"}</div>
                      ) : (
                        availableMembers.map((member) => {
                          const photoUrl = getPhotoUrl(member.profilePhotoPath);
                          return (
                            <div key={member.memberId} className="flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors cursor-pointer border-b last:border-b-0" onClick={() => toggleMember(member.memberId)}>
                              <Checkbox checked={selectedMemberIds.has(member.memberId)} onCheckedChange={() => toggleMember(member.memberId)} onClick={(e) => e.stopPropagation()} />
                              <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                                {photoUrl ? <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><User className="h-3.5 w-3.5" /></div>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{member.memberName}</p>
                                <p className="text-xs text-muted-foreground truncate">{[member.mobileNumber, member.email].filter(Boolean).join(" | ") || "–"}</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Selected */}
                  <div className="border rounded-md flex flex-col overflow-hidden">
                    <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
                      <span className="text-sm font-semibold">Selected Members</span>
                      <Badge variant="secondary" className="text-xs">{selectedMemberIds.size} selected</Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[324px]">
                      {selectedMembers.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">No members selected</div>
                      ) : (
                        selectedMembers.map((member) => {
                          const photoUrl = getPhotoUrl(member.profilePhotoPath);
                          return (
                            <div key={member.memberId} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0">
                              <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                                {photoUrl ? <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><User className="h-3.5 w-3.5" /></div>}
                              </div>
                              <span className="text-sm font-medium flex-1 truncate">{member.memberName}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeMember(member.memberId)}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !groupName.trim()} className="bg-azure hover:bg-mint-ink text-white">
              {saving ? "Saving..." : editingGroup ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Members Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{viewGroup?.groupName || "Sub Group Members"}</DialogTitle>
            <DialogDescription>
              {viewGroup ? `${viewGroup.members.length} ${viewGroup.members.length === 1 ? "member" : "members"} in this group` : "Loading..."}
            </DialogDescription>
          </DialogHeader>
          {loadingView ? (
            <div className="flex items-center justify-center py-12"><RotaryLoader size="md" /></div>
          ) : viewGroup && viewGroup.members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center"><Users className="h-10 w-10 text-muted-foreground mb-3" /><p className="text-muted-foreground">No members in this group.</p></div>
          ) : viewGroup ? (
            <div className="flex-1 overflow-y-auto space-y-1">
              {viewGroup.members.map((member) => {
                const photoUrl = getPhotoUrl(member.profilePhotoPath);
                return (
                  <div key={member.memberId} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors">
                    <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                      {photoUrl ? <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><User className="h-4 w-4" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{member.memberName}</p>
                      <p className="text-xs text-muted-foreground truncate">{[member.mobileNumber, member.email].filter(Boolean).join(" | ") || "–"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Sub Group"
        description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.groupName}</span>? This will remove the group and its member associations.</>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />

      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
