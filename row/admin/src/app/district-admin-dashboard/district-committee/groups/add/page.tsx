"use client";

// Group District Committee — ADD (all-in-one create page).
//
// Replaces the old "Add Group" popup. A group is created together with its
// members in a single Save: you type the group name + pick the year, stage one
// or more members (smart-search a Rotarian or add a non-member), and only on
// Save is the group persisted followed by each staged member. Validation
// enforces at least ONE member — a group can never exist empty. On success we
// land on the new group's detail page so sub-groups can be added next.

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  createCommitteeGroup, createGroupMember, getRotaryYears, getDistrict,
  searchDistrictCommitteeMembers, uploadCommitteePhoto, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Pencil, Trash2, Users, Search, X, Upload } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { ListPageSkeleton } from "@/components/row/AppKit";

const PHOTO_ASPECT = 1;
const PHOTO_MAX_OUTPUT = 500;

// Member/Non-Member chips — mirror the detail page.
function MemberChip() {
  return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Member</span>;
}
function NonMemberChip() {
  return <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Non-Member</span>;
}

// A member staged locally before the group is persisted. `key` is a client-only
// id used for list rendering / edit / remove until the real row id exists.
type StagedMember = {
  key: number;
  isMember: boolean;
  memberId: number | null;
  name: string;
  mobile: string;
  email: string;
  districtDesignation: string;
  clubId: number | null;
  clubName: string;
  districtRemark: string;
  profilePhoto: string;
};

export default function DistrictAdminDashboardGroupAddPage() {
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
  // Exit (back / cancel / after save) returns to the district-committee LANDING
  // (where the GDC list is embedded), not the intermediate /groups route.
  const landing = `/district-admin-dashboard/district-committee${backQs ? `?${backQs}` : ""}`;
  const goBack = () => router.push(landing);

  const [districtName, setDistrictName] = useState("");
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Group form
  const [groupName, setGroupName] = useState("");
  const [formYearId, setFormYearId] = useState("");

  // Staged members
  const [staged, setStaged] = useState<StagedMember[]>([]);
  const keyCounter = useRef(1);

  // Member dialog
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<number | null>(null);
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

  // Smart search inside the dialog
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchTimeout = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photoCrop = useImageCropUpload();
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, allYrs] = await Promise.all([getDistrict(districtId), getRotaryYears()]);
        setDistrictName(`District ${d.districtNumber}`);
        setAllRotaryYears(allYrs);
        if (currentYearId) {
          setFormYearId(currentYearId);
        } else {
          const cy = allYrs.find((y: any) => y.isCurrent) || allYrs[0];
          if (cy) setFormYearId(String(cy.id));
        }
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  // ---- Member dialog helpers ----
  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); setShowSearchResults(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchDistrictCommitteeMembers(districtId, val);
        setSearchResults(results); setShowSearchResults(true);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  };

  const selectMember = (m: any) => {
    setFormIsMember(true); setFormMemberId(m.memberId); setFormName(m.name || "");
    setFormMobile(m.mobile || ""); setFormEmail(m.email || ""); setFormClubId(m.clubId || null);
    setFormClubName(m.clubName || ""); setFormPhoto(m.profilePhoto || "");
    setShowSearchResults(false); setMemberSearch("");
  };

  const clearMember = () => {
    setFormIsMember(false); setFormMemberId(null); setFormName(""); setFormMobile("");
    setFormEmail(""); setFormClubId(null); setFormClubName(""); setFormPhoto("");
  };

  const resetMemberForm = () => {
    setEditingKey(null); clearMember(); setFormDesignation(""); setFormRemark("");
    setMemberSearch(""); setSearchResults([]); setShowSearchResults(false);
  };

  const openAddMemberDialog = () => { resetMemberForm(); setMemberDialogOpen(true); };

  const openEditMemberDialog = (m: StagedMember) => {
    setEditingKey(m.key); setFormIsMember(m.isMember); setFormMemberId(m.memberId);
    setFormName(m.name); setFormMobile(m.mobile); setFormEmail(m.email);
    setFormDesignation(m.districtDesignation); setFormClubId(m.clubId); setFormClubName(m.clubName);
    setFormRemark(m.districtRemark); setFormPhoto(m.profilePhoto);
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
      const cropped = new File([blob], "committee-photo.png", { type: "image/png" });
      const r = await uploadCommitteePhoto(districtId, cropped, formIsMember && !!formMemberId, formClubId);
      setFormPhoto(r.path);
    } catch { setErrorMessage("Failed to upload photo."); }
    finally { setPhotoUploading(false); photoCrop.cancel(); }
  };

  const commitMember = () => {
    if (!formName.trim()) { setErrorMessage("Name is required."); return; }
    const entry: StagedMember = {
      key: editingKey ?? keyCounter.current++,
      isMember: formIsMember, memberId: formMemberId, name: formName.trim(),
      mobile: formMobile.trim(), email: formEmail.trim(), districtDesignation: formDesignation.trim(),
      clubId: formClubId, clubName: formClubName.trim(), districtRemark: formRemark.trim(),
      profilePhoto: formPhoto,
    };
    setStaged((prev) => editingKey != null ? prev.map((m) => m.key === editingKey ? entry : m) : [...prev, entry]);
    setMemberDialogOpen(false);
  };

  const removeStaged = (key: number) => setStaged((prev) => prev.filter((m) => m.key !== key));

  // ---- Save group + members ----
  const handleSave = async () => {
    if (!groupName.trim()) { setErrorMessage("Group name is required."); return; }
    if (!formYearId) { setErrorMessage("Rotary year is required."); return; }
    if (staged.length === 0) { setErrorMessage("Add at least one member before saving the group."); return; }
    setSaving(true);
    try {
      const res = await createCommitteeGroup(districtId, { groupName: groupName.trim(), yearId: Number(formYearId) });
      const newGroupId = Number(res?.id);
      if (!newGroupId) throw new Error("no id");
      for (const m of staged) {
        await createGroupMember(districtId, newGroupId, {
          memberId: m.memberId, isMember: m.isMember, name: m.name, mobile: m.mobile,
          email: m.email, districtDesignation: m.districtDesignation, clubId: m.clubId,
          clubName: m.clubName, districtRemark: m.districtRemark, profilePhoto: m.profilePhoto,
        });
      }
      router.push(landing);
    } catch {
      setErrorMessage("Failed to create the group. Please try again.");
      setSaving(false);
    }
  };

  if (!districtId) return null; // wait for auth
  if (!canManage) { goBack(); return null; }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <DistrictMembershipTabBar />
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={goBack} className="border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">Add Group</h2>
            <p className="text-slate-600 text-sm">{districtName ? `${districtName}: ` : ""}Create a group and add at least one member</p>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}

        {!loading && (
          <>
            {/* Group details */}
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Group Name *</Label>
                    <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Enter group name"
                      className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20" />
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
              </CardContent>
            </Card>

            {/* Members */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-ink flex items-center gap-2">
                  <Users className="h-5 w-5" />Members <span className="text-slate-400 font-normal">({staged.length})</span>
                </h3>
                <Button onClick={openAddMemberDialog} className="bg-azure hover:bg-mint-ink text-white">
                  <Plus className="mr-2 h-4 w-4" />Add Member
                </Button>
              </div>

              {staged.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center rounded-2xl border border-dashed border-slate-300 bg-white">
                  <Users className="h-10 w-10 text-slate-400 mb-3" />
                  <p className="text-slate-700 font-medium">At least one member is required</p>
                  <p className="text-slate-500 text-sm mt-1">Click &quot;Add Member&quot; to add the first member of this group.</p>
                </div>
              ) : (
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
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {staged.map((m, idx) => (
                          <TableRow key={m.key} className={!m.isMember ? "bg-slate-100 hover:bg-slate-200" : ""}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>
                              {m.profilePhoto ? (
                                <img src={getPhotoUrl(m.profilePhoto)} alt={m.name} className="rounded-full object-cover w-9 h-9" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{m.name?.charAt(0)}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{m.name}</span>
                                {m.isMember ? <MemberChip /> : <NonMemberChip />}
                              </div>
                            </TableCell>
                            <TableCell>{m.mobile || "-"}</TableCell>
                            <TableCell>{m.email || "-"}</TableCell>
                            <TableCell>{m.districtDesignation || "-"}</TableCell>
                            <TableCell>{m.clubName || "-"}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditMemberDialog(m)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeStaged(m.key)}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Save bar */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={goBack} disabled={saving} className="border-slate-200 text-slate-700 hover:bg-slate-50">Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !groupName.trim() || !formYearId || staged.length === 0}
                className="bg-azure hover:bg-mint-ink text-white">
                {saving ? "Saving..." : "Save Group"}
              </Button>
            </div>
          </>
        )}

        {/* Member Dialog */}
        <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingKey != null ? "Edit Member" : "Add Member"}</DialogTitle>
              <DialogDescription>{editingKey != null ? "Update the member details." : "Search for a member or add a non-member."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {editingKey == null && (
                <div className="space-y-2">
                  <Label>Search Member</Label>
                  <div className="relative">
                    <div className="flex flex-wrap items-center gap-2">
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
              <Button variant="outline" onClick={() => setMemberDialogOpen(false)}>Cancel</Button>
              <Button onClick={commitMember} disabled={!formName.trim()}>{editingKey != null ? "Update" : "Add"}</Button>
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

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
