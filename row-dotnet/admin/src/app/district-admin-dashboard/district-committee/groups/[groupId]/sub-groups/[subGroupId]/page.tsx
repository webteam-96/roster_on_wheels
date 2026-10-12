"use client";

// V2 — under DA-dashboard shell. Additive port of V1 at
// rotary-frontend/src/app/districts/[id]/district-committee/groups/[groupId]/sub-groups/[subGroupId]/page.tsx.
// districtId from useAuth(); routes/returnTo use /district-admin-dashboard/... V2 paths.

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getSubGroupCommitteeMembers, createSubGroupCommitteeMember, updateSubGroupCommitteeMember,
  deleteSubGroupCommitteeMember, searchDistrictCommitteeMembers, uploadCommitteePhoto,
  getPhotoUrl, getCommitteeSubGroups, reorderSubGroupMembers, updateCommitteeSubGroup,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "lucide-react";
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
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Users, Search, X, Upload } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import NonSyncRemovedCommitteeMembers from "@/components/dashboard/NonSyncRemovedCommitteeMembers";

import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

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

export default function DistrictAdminDashboardSubGroupDetailPage() {
  const params = useParams();
  const groupId = Number(params.groupId);
  const subGroupId = Number(params.subGroupId);
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
  const goBack = () => router.push(
    `/district-admin-dashboard/district-committee/groups/${groupId}${backQs ? `?${backQs}` : ""}`,
  );

  const [subGroupName, setSubGroupName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { dragProps } = useDragSort(members, setMembers, async (ids) => {
    try { await reorderSubGroupMembers(districtId, subGroupId, ids); } catch { setErrorMessage("Failed to save order."); }
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

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

  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<any>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop step between file-select and upload.
  const photoCrop = useImageCropUpload();
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!districtId) return;
    // Parallel fan-out: the sub-groups list (for this sub-group's name) and this
    // sub-group's members. Both run at once; slowest wins.
    async function fetchInitial() {
      setLoading(true);
      try {
        const [subGroups, memberList] = await Promise.all([
          getCommitteeSubGroups(districtId, groupId),
          getSubGroupCommitteeMembers(districtId, subGroupId).catch(() => []),
        ]);
        const sg = subGroups.find((x: any) => x.id === subGroupId);
        if (sg) setSubGroupName(sg.subGroupName);
        setMembers(Array.isArray(memberList) ? memberList : []);
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId, groupId, subGroupId]);

  const fetchMembers = async () => {
    try {
      const data = await getSubGroupCommitteeMembers(districtId, subGroupId);
      setMembers(Array.isArray(data) ? data : []);
    } catch {}
  };

  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); setShowSearchResults(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try { const r = await searchDistrictCommitteeMembers(districtId, val); setSearchResults(r); setShowSearchResults(true); }
      catch { setSearchResults([]); } finally { setSearchLoading(false); }
    }, 400);
  };

  const selectMember = (m: any) => {
    setFormIsMember(true); setFormMemberId(m.memberId); setFormName(m.name || ""); setFormMobile(m.mobile || "");
    setFormEmail(m.email || ""); setFormClubId(m.clubId || null); setFormClubName(m.clubName || "");
    setFormPhoto(m.profilePhoto || ""); setShowSearchResults(false); setMemberSearch("");
  };

  const clearMember = () => {
    setFormIsMember(false); setFormMemberId(null); setFormName(""); setFormMobile("");
    setFormEmail(""); setFormClubId(null); setFormClubName(""); setFormPhoto("");
  };

  const openAddDialog = () => {
    setEditingMember(null); clearMember(); setFormDesignation(""); setFormRemark("");
    setMemberSearch(""); setSearchResults([]); setShowSearchResults(false); setDialogOpen(true);
  };

  const openEditDialog = (m: any) => {
    setEditingMember(m); setFormIsMember(!!m.isMember); setFormMemberId(m.memberId || null);
    setFormName(m.name || ""); setFormMobile(m.mobile || ""); setFormEmail(m.email || "");
    setFormDesignation(m.districtDesignation || ""); setFormClubId(m.clubId || null);
    setFormClubName(m.clubName || ""); setFormRemark(m.districtRemark || ""); setFormPhoto(m.profilePhoto || "");
    setMemberSearch(""); setSearchResults([]); setShowSearchResults(false); setDialogOpen(true);
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
      const r = await uploadCommitteePhoto(districtId, cropped);
      setFormPhoto(r.path);
    } catch { setErrorMessage("Failed to upload photo."); }
    finally { setPhotoUploading(false); photoCrop.cancel(); }
  };

  const handleSave = async () => {
    if (!formName.trim()) { setErrorMessage("Name is required."); return; }
    setSaving(true);
    try {
      const payload = {
        memberId: formMemberId, isMember: formIsMember, name: formName.trim(), mobile: formMobile.trim(),
        email: formEmail.trim(), districtDesignation: formDesignation.trim(), clubId: formClubId,
        clubName: formClubName.trim(),
        districtRemark: formRemark.trim(), profilePhoto: formPhoto,
      };
      if (editingMember) { await updateSubGroupCommitteeMember(districtId, subGroupId, editingMember.id, payload); setSuccessMessage("Member updated."); }
      else { await createSubGroupCommitteeMember(districtId, subGroupId, payload); setSuccessMessage("Member added."); }
      setDialogOpen(false); fetchMembers();
    } catch { setErrorMessage("Failed to save."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteSubGroupCommitteeMember(districtId, subGroupId, deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Member deleted."); fetchMembers(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
  };

  // Inline rename of the sub-group (replaces the old list popup).
  const startRename = () => { setNameDraft(subGroupName); setEditingName(true); };
  const saveRename = async () => {
    const next = nameDraft.trim();
    if (!next) { setErrorMessage("Sub-group name is required."); return; }
    if (next === subGroupName) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateCommitteeSubGroup(districtId, groupId, subGroupId, { subGroupName: next });
      setSubGroupName(next);
      setEditingName(false);
      setSuccessMessage("Sub-group name updated.");
    } catch { setErrorMessage("Failed to rename sub-group."); }
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
                    className="h-9 w-72 text-lg font-bold text-[#1e3a5f]"
                    placeholder="Sub-group name"
                  />
                  <Button size="sm" onClick={saveRename} disabled={savingName || !nameDraft.trim()} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white">
                    {savingName ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingName(false)} disabled={savingName} className="border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</Button>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">
                    District Committee — {subGroupName || "Sub Group"}
                  </h2>
                  {canManage && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100" onClick={startRename} title="Rename sub-group">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#1e3a5f] flex items-center gap-2">
                <Users className="h-5 w-5" />Members <span className="text-slate-400 font-normal">({members.length})</span>
              </h3>
              {canManage && (
                <Button onClick={openAddDialog} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white"><Plus className="mr-2 h-4 w-4" />Add Member</Button>
              )}
            </div>

            {members.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No members yet</h3>
                <p className="text-muted-foreground mt-2">{canManage ? "Add members to this sub group." : "No members in this sub group."}</p>
              </div>
            )}

            {members.length > 0 && (
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
                        {canManage && <TableHead className="text-right">Actions</TableHead>}
                        {canManage && <TableHead className="text-center w-14">Sort</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((m: any, idx: number) => (
                        <TableRow key={m.id} className={!m.isMember ? "bg-slate-100 hover:bg-slate-200" : ""}>
                          <TableCell>{idx + 1}</TableCell>
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
                          {canManage && (
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(m)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(m)}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          )}
                          {canManage && (
                            <TableCell className="text-center" {...dragProps(idx)}>
                              <GripVertical className="h-4 w-4 text-muted-foreground inline-block cursor-grab" />
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            {canManage && (
              <NonSyncRemovedCommitteeMembers districtId={districtId} level="subgroup" subGroupId={subGroupId} onAdded={() => fetchMembers()} />
            )}
          </>
        )}

        {/* Member Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                {saving ? "Saving..." : editingMember ? "Update" : "Add"}
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

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Member" description="Are you sure? This action cannot be undone." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
