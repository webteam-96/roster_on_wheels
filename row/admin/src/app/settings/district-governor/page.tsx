"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getDistrictGovernors, createDistrictGovernor, updateDistrictGovernor,
  deleteDistrictGovernor, searchDistrictGovernorMembers,
  getDistricts, getRotaryYears,
  getDistrictGovernorFilterDistricts, getDistrictGovernorFilterYears,
  uploadDistrictGovernorPhoto, districtGovernorPhotoUrl, DISTRICT_GOVERNOR_PHOTO_PREFIX,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Crown, Search, X, Camera } from "lucide-react";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function DistrictGovernorPage() {
  const { isSuperAdmin } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Full lists for Add/Edit dialog
  const [districts, setDistricts] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  // Data-driven lists for listing-page filters (only districts/years that have DG records)
  const [filterDistricts, setFilterDistricts] = useState<any[]>([]);
  const [filterYears, setFilterYears] = useState<any[]>([]);
  const [filterDistrictId, setFilterDistrictId] = useState<string>("all");
  // Year filter defaults to the CURRENT rotary year — set once filterYears loads.
  // "All Years" option intentionally removed; the list is always year-scoped.
  const [filterYearId, setFilterYearId] = useState<string>("");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Form
  const [formDistrictId, setFormDistrictId] = useState("");
  const [formYearId, setFormYearId] = useState("");
  const [formMemberId, setFormMemberId] = useState<number | null>(null);
  const [formMemberName, setFormMemberName] = useState("");
  const [formProfilePhoto, setFormProfilePhoto] = useState("");
  // Some districts have a governor who is not a member of any club. That DG has no member record,
  // so the name, contacts and photo are entered here instead of being read from a profile.
  const [nonMember, setNonMember] = useState(false);
  const [formEmail, setFormEmail] = useState("");
  const [formMobile, setFormMobile] = useState("");
  const [uploading, setUploading] = useState(false);
  const photoCrop = useImageCropUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Member search
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const fetchItems = useCallback(async () => {
    // Year filter is mandatory (no "All Years"); skip the call until it's chosen.
    if (!filterYearId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await getDistrictGovernors(
        filterDistrictId !== "all" ? Number(filterDistrictId) : undefined,
        Number(filterYearId)
      );
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [filterDistrictId, filterYearId]);

  // Refreshable: districts/years that actually have DG records (drives the listing-page filter dropdowns).
  const refreshFilterDropdowns = useCallback(async () => {
    try {
      const [fd, fy] = await Promise.all([
        getDistrictGovernorFilterDistricts(),
        getDistrictGovernorFilterYears(),
      ]);
      setFilterDistricts(Array.isArray(fd) ? fd : []);
      const yearsArr = Array.isArray(fy) ? fy : [];
      setFilterYears(yearsArr);
      // Default the Year filter to the CURRENT year (if any DG records exist for it);
      // otherwise fall back to the most recent year with data. Only seed when no
      // year is currently selected — never overwrite the user's choice.
      setFilterYearId((prev) => {
        if (prev) return prev;
        const current = yearsArr.find((y: any) => y.isCurrent);
        if (current) return String(current.id);
        return yearsArr.length > 0 ? String(yearsArr[0].id) : "";
      });
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    // Full lists for the Add/Edit dialog (every district, every year).
    Promise.all([getDistricts(1, 1000), getRotaryYears()]).then(([d, y]) => {
      setDistricts((Array.isArray(d) ? d : (d as any).items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      setYears(Array.isArray(y) ? y : []);
    }).catch(() => {});
    refreshFilterDropdowns();
    fetchItems();
  }, [fetchItems, refreshFilterDropdowns]);

  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setMemberResults([]); setSearched(false); return; }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchDistrictGovernorMembers(val);
        setMemberResults(results || []);
      } catch { setMemberResults([]); }
      finally { setSearching(false); setSearched(true); }
    }, 400);
  };

  const selectMember = (m: any) => {
    setFormMemberId(m.memberId);
    setFormMemberName(m.memberName);
    setFormProfilePhoto(m.profilePhoto || "");
    setNonMember(false);
    setFormEmail("");
    setFormMobile("");
    setMemberSearch("");
    setMemberResults([]);
    setSearched(false);
  };

  // No member matched the search — keep what was typed as the name and let the rest be filled in.
  const useAsNonMember = () => {
    setFormMemberId(null);
    setFormMemberName(memberSearch.trim());
    setFormProfilePhoto("");
    setFormEmail("");
    setFormMobile("");
    setNonMember(true);
    setMemberResults([]);
    setSearched(false);
  };

  const clearMember = () => {
    setFormMemberId(null);
    setFormMemberName("");
    setFormProfilePhoto("");
    setFormEmail("");
    setFormMobile("");
    setNonMember(false);
    setSearched(false);
  };

  const openAdd = () => {
    setEditing(null);
    setFormDistrictId("");
    setFormYearId("");
    clearMember();
    setMemberSearch("");
    setMemberResults([]);
    setDialogOpen(true);
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = ""; }, 100);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setFormDistrictId(String(item.districtId));
    setFormYearId(String(item.yearId));
    setFormMemberId(item.memberId);
    setFormMemberName(item.memberName || "");
    setFormProfilePhoto(item.profilePhoto || "");
    // No member linked → this DG is not a member of any club; their own contacts are editable.
    setNonMember(!item.memberId);
    setFormEmail(item.memberId ? "" : (item.email || ""));
    setFormMobile(item.memberId ? "" : (item.mobile || ""));
    setMemberSearch("");
    setMemberResults([]);
    setSearched(false);
    setDialogOpen(true);
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = item.description || ""; }, 100);
  };

  const handleCropSave = async (blob: Blob) => {
    setUploading(true);
    try {
      const file = new File([blob], "dg-profile.png", { type: "image/png" });
      const { path } = await uploadDistrictGovernorPhoto(file);
      setFormProfilePhoto(path);
      photoCrop.cancel();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!formDistrictId) { setErrorMessage("District is required."); return; }
    if (!formYearId) { setErrorMessage("Rotary Year is required."); return; }
    if (!formMemberName.trim()) { setErrorMessage(nonMember ? "Name is required." : "Member is required."); return; }

    // Photos are stored filename-only; strip our folder back off a value loaded from a record.
    const photo = formProfilePhoto.includes(DISTRICT_GOVERNOR_PHOTO_PREFIX)
      ? formProfilePhoto.split(DISTRICT_GOVERNOR_PHOTO_PREFIX).pop() || null
      : formProfilePhoto || null;

    const payload = {
      districtId: Number(formDistrictId),
      yearId: Number(formYearId),
      memberId: formMemberId,
      memberName: formMemberName.trim(),
      description: editorRef.current?.innerHTML?.trim() || null,
      profilePhoto: photo,
      // Ignored by the API when a member is linked — their profile stays the source of truth.
      email: formEmail.trim() || null,
      mobile: formMobile.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateDistrictGovernor(editing.id, payload);
        setSuccessMessage("District Governor updated.");
      } else {
        await createDistrictGovernor(payload);
        setSuccessMessage("District Governor added.");
      }
      setDialogOpen(false);
      await Promise.all([fetchItems(), refreshFilterDropdowns()]);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictGovernor(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("District Governor deleted.");
      await Promise.all([fetchItems(), refreshFilterDropdowns()]);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to delete.");
      setDeleteTarget(null);
    }
  };

  const execCommand = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage District Governors.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">District Governor</h2>
              <p className="text-muted-foreground text-base">Manage district governors by rotary year</p>
            </div>
          </div>
          <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add District Governor</Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">District</Label>
                <Select value={filterDistrictId} onValueChange={(v) => { setFilterDistrictId(v); }}>
                  <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Districts</SelectItem>
                    {filterDistricts.map((d: any) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Rotary Year</Label>
                <Select value={filterYearId} onValueChange={(v) => { setFilterYearId(v); }}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {filterYears.map((y: any) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => fetchItems()} variant="outline" className="w-full">
                  <Search className="mr-2 h-4 w-4" />Apply
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No district governors found</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add District Governor&quot; to assign one.</p>
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
                    <TableHead>District</TableHead>
                    <TableHead>Rotary Year</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any, idx: number) => {
                    // Phase 4 kill-switch: row is "inactive" if its district or zone is inactive.
                    const rowInactive = item.isActive === 0 || item.isActive === false;
                    return (
                    <TableRow key={item.id}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>
                        {item.profilePhoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={districtGovernorPhotoUrl(item.profilePhoto)} alt={item.memberName} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{item.memberName?.charAt(0)}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{item.memberName}</span>
                          {!item.memberId && <Badge variant="outline">Not a member</Badge>}
                          {rowInactive && <Badge variant="destructive">Inactive</Badge>}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{item.districtNumber}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{item.yearLabel}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            disabled={rowInactive}
                            title={rowInactive ? "Inactive — reactivate from Districts page" : undefined}
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit District Governor" : "Add District Governor"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>District <span className="text-destructive">*</span></Label>
                  <Select value={formDistrictId} onValueChange={setFormDistrictId}>
                    <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                    <SelectContent>
                      {districts.map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Rotary Year <span className="text-destructive">*</span></Label>
                  <Select value={formYearId} onValueChange={setFormYearId}>
                    <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                    <SelectContent>
                      {years.map((y: any) => (
                        <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Member Search — a governor who is not a member of any club is entered by hand below */}
              <div className="space-y-1.5">
                <Label>Search Member <span className="text-destructive">*</span></Label>
                {nonMember ? (
                  <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">Not a member</Badge>
                      <button
                        type="button"
                        onClick={clearMember}
                        className="text-xs text-primary underline"
                      >
                        Search member instead
                      </button>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-primary/5 border-2 border-dashed border-primary/30 flex items-center justify-center">
                        {formProfilePhoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={districtGovernorPhotoUrl(formProfilePhoto)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Camera className="h-7 w-7 text-muted-foreground" />
                        )}
                      </div>
                      <div className="space-y-2">
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp"
                          className="hidden"
                          ref={fileInputRef}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) photoCrop.startCrop(f); e.target.value = ""; }}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                          <Camera className="mr-2 h-4 w-4" />{formProfilePhoto ? "Change Photo" : "Upload Photo"}
                        </Button>
                        {formProfilePhoto && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setFormProfilePhoto("")}>Remove</Button>
                        )}
                        <p className="text-xs text-muted-foreground">JPG, PNG or WEBP, max 5 MB.</p>
                        {photoCrop.error && <p className="text-xs text-destructive">{photoCrop.error}</p>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                      <Input value={formMemberName} onChange={(e) => setFormMemberName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Email</Label>
                        <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="name@example.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Mobile</Label>
                        <Input value={formMobile} onChange={(e) => setFormMobile(e.target.value)} placeholder="10-digit mobile" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Reports and emails for this district use these contacts, so add them if the governor should receive them.
                    </p>
                  </div>
                ) : formMemberId ? (
                  <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                    {formProfilePhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={districtGovernorPhotoUrl(formProfilePhoto)} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{formMemberName.charAt(0)}</div>
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{formMemberName}</p>
                    </div>
                    <button onClick={clearMember} className="text-destructive"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder="Search by name, mobile or email..."
                      value={memberSearch}
                      onChange={(e) => handleMemberSearch(e.target.value)}
                    />
                    {searching && <div className="absolute right-3 top-2.5"><RotaryLoader size="sm" /></div>}
                    {memberResults.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {memberResults.map((m: any) => (
                          <button
                            key={m.memberId}
                            className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 text-left border-b last:border-0"
                            onClick={() => selectMember(m)}
                          >
                            {m.profilePhoto ? (
                              <img src={`${API_URL}${m.profilePhoto}`} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{m.memberName?.charAt(0)}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{m.memberName}</p>
                              <p className="text-xs text-muted-foreground">{m.clubName} · {m.districtNumber}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searched && !searching && memberResults.length === 0 && memberSearch.trim().length >= 2 && (
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
                        <p className="text-sm text-muted-foreground">
                          No member found for &quot;{memberSearch.trim()}&quot;.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={useAsNonMember}>
                          Add as non-member
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Rich Text Editor */}
              <div className="space-y-1.5">
                <Label>Description</Label>
                <div className="flex flex-wrap gap-1 border rounded-t-lg p-2 bg-muted/50">
                  <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("bold")}><b>B</b></Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("italic")}><i>I</i></Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("underline")}><u>U</u></Button>
                  <span className="w-px bg-border mx-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("insertUnorderedList")}>UL</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("insertOrderedList")}>OL</Button>
                  <span className="w-px bg-border mx-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => {
                    const url = prompt("Enter image URL:");
                    if (url) execCommand("insertImage", url);
                  }}>IMG</Button>
                  <span className="w-px bg-border mx-1" />
                  <select className="text-xs border rounded px-1 h-8" onChange={(e) => { execCommand("fontSize", e.target.value); e.target.value = ""; }}>
                    <option value="">Size</option>
                    <option value="1">Small</option>
                    <option value="3">Normal</option>
                    <option value="5">Large</option>
                    <option value="7">Huge</option>
                  </select>
                  <input type="color" className="h-8 w-8 cursor-pointer border rounded" onChange={(e) => execCommand("foreColor", e.target.value)} title="Text Color" />
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  className="min-h-[150px] border border-t-0 rounded-b-lg p-4 focus:outline-none focus:ring-2 focus:ring-primary/20 prose prose-sm max-w-none"
                  suppressContentEditableWarning
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <RotaryLoader size="sm" /> : (editing ? "Update" : "Save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Crop dialog — square, to match the circular frames the photo appears in */}
        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.imageSrc}
          aspect={1}
          maxOutputWidth={1200}
          title="Crop Profile Photo"
          saving={uploading}
          onCancel={photoCrop.cancel}
          onSave={handleCropSave}
        />

        {/* Delete Confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete District Governor"
          description={`Are you sure you want to delete ${deleteTarget?.memberName}? This cannot be undone.`}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
