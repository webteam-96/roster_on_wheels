"use client";

// V2 — under DA-dashboard shell. Additive port of V1 at
// rotary-frontend/src/app/districts/[id]/district-committee/groups/[groupId]/page.tsx.
// districtId from useAuth(); routes/returnTo use /district-admin-dashboard/... V2 paths.

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getGroupMembers, createGroupMember, updateGroupMember, deleteGroupMember,
  getCommitteeSubGroups, deleteCommitteeSubGroup,
  searchDistrictCommitteeMembers, uploadCommitteePhoto, getPhotoUrl,
  getCommitteeGroupById, reorderGroupMembers, reorderSubGroups, updateCommitteeGroup,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Users, Layers, Search, X, Upload, Lock } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Pagination from "@/components/Pagination";
import NonSyncRemovedCommitteeMembers from "@/components/dashboard/NonSyncRemovedCommitteeMembers";
import CommitteeDocumentsCard from "@/components/membership/CommitteeDocumentsCard";

import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

const PAGE_SIZE = 20;

// Committee photos render as small circular thumbnails in the list and on the
// public site — square crop, 500×500 stored for retina.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_OUTPUT = 500;

// Member / Non-Member chips — mirrors the visual treatment used on the Past Presidents page
// so the two modules stay consistent (green for member, slate for non-member).
function MemberChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      Member
    </span>
  );
}
function NonMemberChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      Non-Member
    </span>
  );
}

// Auto-managed CP/CS groups — populated only via BOD; member add/edit/delete blocked in UI.
// Pattern matches backend DcAutoGroupService.AutoGroupPattern (singular: "Club President" / "Club Secretary").
const isAutoManagedGroup = (groupName?: string): boolean => {
  if (!groupName) return false;
  return /^(Club Presidents?|Club Secretar(y|ies))( \d{4}-\d{2})?$/.test(groupName.trim());
};

export default function DistrictAdminDashboardGroupDetailPage() {
  const params = useParams();
  const groupId = Number(params.groupId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const canManage = isSuperAdmin || isAdmin;

  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");
  const backParams = new URLSearchParams();
  if (returnTo) backParams.set("returnTo", returnTo);
  if (currentYearId) backParams.set("yearId", currentYearId);
  const backQs = backParams.toString();
  // Back returns to the district-committee LANDING (GDC list embedded there),
  // not the intermediate /groups route.
  const goBack = () => router.push(
    `/district-admin-dashboard/district-committee${backQs ? `?${backQs}` : ""}`,
  );

  const [groupName, setGroupName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const isAutoManaged = isAutoManagedGroup(groupName);
  const canManageMembers = canManage && !isAutoManaged;
  const [members, setMembers] = useState<any[]>([]);
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotalCount, setMemberTotalCount] = useState(0);
  const [memberTotalPages, setMemberTotalPages] = useState(0);
  const [memberSearchTerm, setMemberSearchTerm] = useState("");
  const [memberSearchDraft, setMemberSearchDraft] = useState("");
  const [subGroups, setSubGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drag & drop sort
  const { dragProps: memberDragProps } = useDragSort(members, setMembers, async (ids) => {
    try { await reorderGroupMembers(districtId, groupId, ids); } catch { setErrorMessage("Failed to save order."); }
  });
  const { dragProps: subGroupDragProps } = useDragSort(subGroups, setSubGroups, async (ids) => {
    try { await reorderSubGroups(districtId, groupId, ids); } catch { setErrorMessage("Failed to save order."); }
  });

  // Member dialog
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [savingMember, setSavingMember] = useState(false);
  const [deleteMemberTarget, setDeleteMemberTarget] = useState<any>(null);

  // Member form
  const [formIsMember, setFormIsMember] = useState(true);
  const [formMemberId, setFormMemberId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formMobile, setFormMobile] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formDesignation, setFormDesignation] = useState("");
  const [formClubId, setFormClubId] = useState<number | null>(null);
  const [formClubName, setFormClubName] = useState("");
  const [formRemark, setFormRemark] = useState("");
  const [formPhoto, setFormPhoto] = useState("");

  // Smart search
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<any>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop step between file-select and upload.
  const photoCrop = useImageCropUpload();
  const [photoUploading, setPhotoUploading] = useState(false);

  // Sub group delete + navigation state
  const [deleteSubGroupTarget, setDeleteSubGroupTarget] = useState<any>(null);
  const [navigatingSubGroupId, setNavigatingSubGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (!districtId) return;
    // All four initial fetches fan out in parallel — none of them depend on
    // each other's data. Previous version chained getDistrict →
    // getCommitteeGroupById → (members + sub-groups) which was 3 sequential
    // round-trips. Now the slowest single call is the total wait.
    async function fetchInitial() {
      setLoading(true);
      try {
        await Promise.all([
          getCommitteeGroupById(districtId, groupId).then((g) => { if (g?.groupName) setGroupName(g.groupName); }).catch(() => {}),
          fetchMembers(1, ""),
          fetchSubGroups(),
        ]);
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId, groupId]);

  const fetchMembers = async (pageNum: number = memberPage, search: string = memberSearchTerm) => {
    try {
      const data = await getGroupMembers(districtId, groupId, pageNum, PAGE_SIZE, search || undefined);
      if (Array.isArray(data)) {
        setMembers(data); setMemberTotalCount(data.length); setMemberTotalPages(1);
      } else {
        setMembers(Array.isArray(data?.items) ? data.items : []);
        setMemberTotalCount(Number(data?.totalCount || 0));
        setMemberTotalPages(Number(data?.totalPages || 0));
      }
    } catch {}
  };

  // Reload members whenever page/search changes after initial mount.
  useEffect(() => {
    if (!loading) fetchMembers(memberPage, memberSearchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberPage, memberSearchTerm]);

  const handleMemberPageChange = (newPage: number) => setMemberPage(newPage);
  const runMemberSearch = () => { setMemberPage(1); setMemberSearchTerm(memberSearchDraft.trim()); };
  const handleMemberSearchKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); runMemberSearch(); } };
  const clearMemberSearch = () => { setMemberSearchDraft(""); setMemberSearchTerm(""); setMemberPage(1); };

  const fetchSubGroups = async () => {
    try {
      const data = await getCommitteeSubGroups(districtId, groupId);
      setSubGroups(Array.isArray(data) ? data : []);
    } catch {}
  };

  // Smart search
  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); setShowSearchResults(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchDistrictCommitteeMembers(districtId, val);
        setSearchResults(results);
        setShowSearchResults(true);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  };

  const selectMember = (m: any) => {
    setFormIsMember(true);
    setFormMemberId(m.memberId);
    setFormName(m.name || "");
    setFormMobile(m.mobile || "");
    setFormEmail(m.email || "");
    setFormClubId(m.clubId || null);
    setFormClubName(m.clubName || "");
    setFormPhoto(m.profilePhoto || "");
    setShowSearchResults(false);
    setMemberSearch("");
  };

  const clearMember = () => {
    setFormIsMember(false); setFormMemberId(null); setFormName(""); setFormMobile("");
    setFormEmail(""); setFormClubId(null); setFormClubName(""); setFormPhoto("");
  };

  const openAddMemberDialog = () => {
    setEditingMember(null); clearMember(); setFormDesignation(""); setFormRemark("");
    setMemberSearch(""); setSearchResults([]); setShowSearchResults(false); setMemberDialogOpen(true);
  };

  const openEditMemberDialog = (m: any) => {
    setEditingMember(m); setFormIsMember(!!m.isMember); setFormMemberId(m.memberId || null);
    setFormName(m.name || ""); setFormMobile(m.mobile || ""); setFormEmail(m.email || "");
    setFormDesignation(m.districtDesignation || ""); setFormClubId(m.clubId || null);
    setFormClubName(m.clubName || ""); setFormRemark(m.districtRemark || ""); setFormPhoto(m.profilePhoto || "");
    setMemberSearch(""); setSearchResults([]); setShowSearchResults(false); setMemberDialogOpen(true);
  };

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) photoCrop.startCrop(file);
    e.target.value = "";
  };

  const handlePhotoCropSave = async (blob: Blob) => {
    setPhotoUploading(true);
    try {
      const cropped = new File([blob], `committee-photo-${Date.now()}.png`, { type: "image/png" });
      // Route the upload to the correct legacy folder:
      //   rotarian → /Documents/directory/, non-member → /Documents/DistrictCommittee/Group<clubId|districtId>/
      const r = await uploadCommitteePhoto(districtId, cropped, formIsMember && !!formMemberId, formClubId);
      setFormPhoto(r.path);
    } catch { setErrorMessage("Failed to upload photo."); }
    finally { setPhotoUploading(false); photoCrop.cancel(); }
  };

  const handleSaveMember = async () => {
    if (!formName.trim()) { setErrorMessage("Name is required."); return; }
    setSavingMember(true);
    try {
      const payload = {
        memberId: formMemberId, isMember: formIsMember, name: formName.trim(), mobile: formMobile.trim(),
        email: formEmail.trim(), districtDesignation: formDesignation.trim(), clubId: formClubId,
        clubName: formClubName.trim(),
        districtRemark: formRemark.trim(), profilePhoto: formPhoto,
      };
      if (editingMember) { await updateGroupMember(districtId, groupId, editingMember.id, payload); setSuccessMessage("Member updated."); }
      else { await createGroupMember(districtId, groupId, payload); setSuccessMessage("Member added."); }
      setMemberDialogOpen(false);
      fetchMembers(memberPage, memberSearchTerm);
    } catch { setErrorMessage("Failed to save."); }
    finally { setSavingMember(false); }
  };

  const handleDeleteMember = async () => {
    if (!deleteMemberTarget) return;
    try { await deleteGroupMember(districtId, groupId, deleteMemberTarget.id); setDeleteMemberTarget(null); setSuccessMessage("Member deleted."); fetchMembers(memberPage, memberSearchTerm); }
    catch { setDeleteMemberTarget(null); setErrorMessage("Failed to delete."); }
  };

  // Sub group delete (add/edit now happen on dedicated pages, not a popup)
  const handleDeleteSubGroup = async () => {
    if (!deleteSubGroupTarget) return;
    try { await deleteCommitteeSubGroup(districtId, groupId, deleteSubGroupTarget.id); setDeleteSubGroupTarget(null); setSuccessMessage("Sub group deleted."); fetchSubGroups(); }
    catch { setDeleteSubGroupTarget(null); setErrorMessage("Failed to delete."); }
  };

  // Inline rename of the group (replaces the old list popup). Auto-managed
  // CP/CS groups are renamed via BOD, never here.
  const startRename = () => { setNameDraft(groupName); setEditingName(true); };
  const saveRename = async () => {
    const next = nameDraft.trim();
    if (!next) { setErrorMessage("Group name is required."); return; }
    if (next === groupName) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateCommitteeGroup(districtId, groupId, { groupName: next });
      setGroupName(next);
      setEditingName(false);
      setSuccessMessage("Group name updated.");
    } catch { setErrorMessage("Failed to rename group."); }
    finally { setSavingName(false); }
  };

  if (!districtId) return null; // wait for auth

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <DistrictMembershipTabBar />
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
            <div className="flex items-center gap-2">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveRename(); } if (e.key === "Escape") setEditingName(false); }}
                    autoFocus
                    className="h-9 w-72 text-lg font-bold text-ink"
                    placeholder="Group name"
                  />
                  <Button size="sm" onClick={saveRename} disabled={savingName || !nameDraft.trim()} className="bg-azure hover:bg-mint-ink text-white">
                    {savingName ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingName(false)} disabled={savingName} className="border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</Button>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-bold tracking-tight text-ink">
                    District Committee: {groupName || "Group"}
                  </h2>
                  {canManage && !isAutoManaged && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-ink hover:bg-slate-100" onClick={startRename} title="Rename group">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
              {isAutoManaged && (
                <Badge variant="secondary" className="flex items-center gap-1" title="Auto-managed by BOD: members are added/removed via Board of Directors">
                  <Lock className="h-3 w-3" />Auto
                </Badge>
              )}
            </div>
            {isAutoManaged && (
              <p className="text-slate-600 text-base">
                <span className="text-amber-600">(Members managed via BOD)</span>
              </p>
            )}
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && (
          <div className="space-y-8">
            {/* ---- Members ---- */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-ink flex items-center gap-2">
                <Users className="h-5 w-5" />Members <span className="text-slate-400 font-normal">({memberTotalCount})</span>
              </h3>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9 pr-8"
                    placeholder="Search by name, mobile, email, club..."
                    value={memberSearchDraft}
                    onChange={(e) => setMemberSearchDraft(e.target.value)}
                    onKeyDown={handleMemberSearchKey}
                  />
                  {memberSearchTerm && (
                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={clearMemberSearch} type="button">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={runMemberSearch} type="button">Search</Button>
                {canManageMembers && (
                  <div className="ml-auto">
                    <Button onClick={openAddMemberDialog} className="bg-azure hover:bg-mint-ink text-white"><Plus className="mr-2 h-4 w-4" />Add Member</Button>
                  </div>
                )}
              </div>
              {members.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">{memberSearchTerm ? "No matches found" : "No members yet"}</h3>
                  <p className="text-muted-foreground mt-2">
                    {memberSearchTerm
                      ? `No members match "${memberSearchTerm}". Try a different search.`
                      : (isAutoManaged
                        ? "Members appear automatically when Club President/Secretary is assigned in Board of Directors."
                        : canManage ? "Add members to this group." : "No members in this group.")}
                  </p>
                </div>
              )}
              {members.length > 0 && (
                <>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Photo</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Mobile</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Designation</TableHead>
                          <TableHead>Club</TableHead>
                          <TableHead>Remark</TableHead>
                          {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
                          {canManageMembers && <TableHead className="text-center w-14">Sort</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((m: any, idx: number) => (
                          <TableRow key={m.id} className={!m.isMember ? "bg-slate-100 hover:bg-slate-200" : ""}>
                            <TableCell>{(memberPage - 1) * PAGE_SIZE + idx + 1}</TableCell>
                            <TableCell>
                              {m.profilePhoto ? (
                                <img src={getPhotoUrl(m.profilePhoto)} alt={m.name} className="rounded-full object-cover w-9 h-9" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{m.name?.charAt(0)}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{m.name}</span>
                                {m.isMember ? <MemberChip /> : <NonMemberChip />}
                              </div>
                            </TableCell>
                            <TableCell>{m.mobile || "-"}</TableCell>
                            <TableCell>{m.email || "-"}</TableCell>
                            <TableCell>{m.districtDesignation || "-"}</TableCell>
                            <TableCell>{m.clubName || "-"}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{m.districtRemark || "-"}</TableCell>
                            {canManageMembers && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openEditMemberDialog(m)}><Pencil className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteMemberTarget(m)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </TableCell>
                            )}
                            {canManageMembers && (
                              <TableCell className="text-center" {...memberDragProps(idx)}>
                                <GripVertical className="h-4 w-4 text-muted-foreground inline-block cursor-grab" />
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Pagination page={memberPage} totalPages={memberTotalPages} totalCount={memberTotalCount} pageSize={PAGE_SIZE} onPageChange={handleMemberPageChange} />
                {canManageMembers && (
                  <NonSyncRemovedCommitteeMembers districtId={districtId} level="group" groupId={groupId} onAdded={() => fetchMembers()} />
                )}
                </>
              )}
            </div>

            {/* ---- Sub Groups (stacked below members; add on top, table with edit/delete/sort) ---- */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-ink flex items-center gap-2">
                  <Layers className="h-5 w-5" />Sub Groups <span className="text-slate-400 font-normal">({subGroups.length})</span>
                </h3>
                {canManage && (
                  <Button onClick={() => router.push(`/district-admin-dashboard/district-committee/groups/${groupId}/sub-groups/add${backQs ? `?${backQs}` : ""}`)} className="bg-azure hover:bg-mint-ink text-white"><Plus className="mr-2 h-4 w-4" />Add Sub Group</Button>
                )}
              </div>
              {subGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center rounded-2xl border border-dashed border-slate-300 bg-white">
                  <Layers className="h-10 w-10 text-slate-400 mb-3" />
                  <h4 className="text-base font-semibold text-slate-800">No sub-groups yet</h4>
                  <p className="text-slate-500 text-sm mt-1">{canManage ? "Click \"Add Sub Group\" to create one." : "No sub-groups in this group."}</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left w-12">#</th>
                        <th className="px-4 py-3 text-left">Sub-Group Name</th>
                        <th className="px-4 py-3 text-right">Members</th>
                        <th className="px-4 py-3 text-right w-16">Actions</th>
                        {canManage && <th className="px-3 py-3 text-center w-14">Sort</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {subGroups.map((sg: any, idx: number) => (
                        <tr
                          key={sg.id}
                          className={`hover:bg-slate-50/60 ${navigatingSubGroupId === sg.id ? "opacity-70 pointer-events-none" : ""}`}
                        >
                          <td className="px-4 py-2.5 text-slate-500 tabular-nums">{idx + 1}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              {navigatingSubGroupId === sg.id ? <RotaryLoader size="sm" /> : <Layers className="h-5 w-5 text-ink flex-shrink-0" />}
                              <span className="font-medium text-slate-800">{sg.subGroupName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{sg.memberCount || 0}</td>
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {canManage && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-ink hover:bg-slate-100" onClick={() => { setNavigatingSubGroupId(sg.id); router.push(`/district-admin-dashboard/district-committee/groups/${groupId}/sub-groups/${sg.id}${backQs ? `?${backQs}` : ""}`); }}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteSubGroupTarget(sg)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                          {canManage && (
                            <td className="px-3 py-2.5 text-center" {...subGroupDragProps(idx)} onClick={(e) => e.stopPropagation()}>
                              <GripVertical className="h-4 w-4 text-slate-400 inline-block cursor-grab" />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Member Dialog */}
        <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingMember ? "Edit Member" : "Add Member"}</DialogTitle>
              <DialogDescription>{editingMember ? "Update the member details." : "Search for a member or add a non-member."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {!editingMember && (
                <div className="space-y-2">
                  <Label>Search Member</Label>
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input className="pl-9" placeholder="Search by name, mobile, email..." value={memberSearch}
                          onChange={(e) => handleMemberSearch(e.target.value)}
                          onFocus={() => searchResults.length > 0 && setShowSearchResults(true)} />
                      </div>
                      {formIsMember && formMemberId && (
                        <Button variant="outline" size="sm" onClick={clearMember} type="button"><X className="h-4 w-4 mr-1" />Clear</Button>
                      )}
                    </div>
                    {showSearchResults && searchResults.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {searchResults.map((r: any) => (
                          <div key={r.memberId} className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => selectMember(r)}>
                            {r.profilePhoto ? (
                              <img src={getPhotoUrl(r.profilePhoto)} alt="" className="rounded-full object-cover w-7 h-7" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs">{r.name?.charAt(0)}</div>
                            )}
                            <div><p className="text-sm font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.mobile} | {r.clubName}</p></div>
                          </div>
                        ))}
                      </div>
                    )}
                    {showSearchResults && memberSearch.length >= 2 && searchResults.length === 0 && !searchLoading && (
                      <p className="text-sm text-amber-600 mt-1">No members found. Fill details below to add as non-member.</p>
                    )}
                  </div>
                  {formIsMember && formMemberId && <Badge className="bg-green-100 text-green-700 border-green-300">Member Selected: {formName}</Badge>}
                </div>
              )}
              <div className="space-y-2"><Label>Name *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} disabled={formIsMember && !!formMemberId} placeholder="Enter full name" /></div>
              <div className="space-y-2"><Label>Mobile Number</Label><Input value={formMobile} onChange={(e) => setFormMobile(e.target.value)} disabled={formIsMember && !!formMemberId} placeholder="Enter mobile number" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} disabled={formIsMember && !!formMemberId} placeholder="Enter email address" /></div>
              <div className="space-y-2"><Label>District Designation</Label><Input value={formDesignation} onChange={(e) => setFormDesignation(e.target.value)} placeholder="Enter district designation" /></div>
              {(formIsMember && formMemberId)
                ? (formClubName && <div className="space-y-2"><Label>Club</Label><Input value={formClubName} disabled /></div>)
                : <div className="space-y-2"><Label>Club Name</Label><Input value={formClubName} onChange={(e) => setFormClubName(e.target.value)} placeholder="Enter club name" /></div>}
              <div className="space-y-2"><Label>District Remark</Label><Input value={formRemark} onChange={(e) => setFormRemark(e.target.value)} placeholder="Enter remark" /></div>
              {(!formIsMember || !formMemberId) && (
                <div className="space-y-2">
                  <Label>Profile Photo</Label>
                  <div className="flex items-center gap-3">
                    {formPhoto && <img src={getPhotoUrl(formPhoto)} alt="Photo" className="rounded-full object-cover w-12 h-12" />}
                    <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" ref={fileInputRef} className="hidden" onChange={handlePhotoSelected} />
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Upload Photo</Button>
                  </div>
                  {photoCrop.error && <p className="text-xs text-destructive mt-1">{photoCrop.error}</p>}
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMemberDialogOpen(false)} disabled={savingMember}>Cancel</Button>
              <Button onClick={handleSaveMember} disabled={savingMember || !formName.trim()}>
                {savingMember ? "Saving..." : editingMember ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.imageSrc}
          aspect={PHOTO_ASPECT}
          maxOutputWidth={PHOTO_MAX_OUTPUT}
          title="Crop Profile Photo"
          saving={photoUploading}
          onCancel={photoCrop.cancel}
          onSave={handlePhotoCropSave}
        />

        <CommitteeDocumentsCard districtId={districtId} groupId={groupId} />

        <AlertModal open={!!deleteMemberTarget} onOpenChange={(o) => !o && setDeleteMemberTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Member" description="Are you sure? This action cannot be undone." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteMember} cancelLabel="Cancel" onCancel={() => setDeleteMemberTarget(null)} />
        <AlertModal open={!!deleteSubGroupTarget} onOpenChange={(o) => !o && setDeleteSubGroupTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Sub Group" description="Are you sure? This will delete the sub group and all its members." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDeleteSubGroup} cancelLabel="Cancel" onCancel={() => setDeleteSubGroupTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
