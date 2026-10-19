"use client";

/**
 * District Committee — Members V2 (dashboard palette).
 *
 * Mirrors `/districts/[id]/district-committee/committee/page.tsx` (V1) 1:1
 * in behaviour; only the visual chrome changes to the navy/gold palette from
 * `district-admin-dashboard/membership/page.tsx`. Every V1 state hook,
 * dialog field, dropdown, search, pagination, add/edit/delete flow, drag
 * sort, member-vs-non-member chip logic, photo upload, and smart search is
 * preserved verbatim — the imports and service calls are identical to V1.
 *
 * ?returnTo=<url> — Back button honours it if present, otherwise falls
 * back to the V2 landing.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getCommitteeMembers, getCommitteeMemberAvailableYears, createCommitteeMember,
  updateCommitteeMember, deleteCommitteeMember, searchDistrictCommitteeMembers,
  uploadCommitteePhoto, getRotaryYears, getDistrict, getPhotoUrl, reorderCommitteeMembers,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { GripVertical } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Users, Search, X, Upload } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Pagination from "@/components/Pagination";
import NonSyncRemovedCommitteeMembers from "@/components/dashboard/NonSyncRemovedCommitteeMembers";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import ProtectedRoute from "@/components/ProtectedRoute";

const PAGE_SIZE = 20;

// Committee photos render as small circular thumbnails in the list and on the
// public site — square crop, 500×500 stored for retina.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_OUTPUT = 500;

// Member / Non-Member chips — visual language matches Past Presidents page
// (green for member, slate for non-member).
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

export default function DistrictCommitteeMembersV2Page() {
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
  const [members, setMembers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drag & drop sort — only meaningful when the full set fits on one page.
  // Server still accepts the reorder against ids in the current page.
  const { dragProps } = useDragSort(members, setMembers, async (ids) => {
    try { await reorderCommitteeMembers(districtId, ids); } catch { setErrorMessage("Failed to save order."); }
  });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Form fields
  const [formYearId, setFormYearId] = useState("");
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

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, allYrs, available] = await Promise.all([
          getDistrict(districtId), getRotaryYears(), getCommitteeMemberAvailableYears(districtId),
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

  const fetchMembers = useCallback(async (yearId: number, pageNum: number = 1, search?: string) => {
    setLoadingMembers(true);
    try {
      const data = await getCommitteeMembers(districtId, yearId, pageNum, PAGE_SIZE, search || undefined);
      // Backwards-compat in case any callsite still returns a bare array.
      if (Array.isArray(data)) {
        setMembers(data);
        setTotalCount(data.length);
        setTotalPages(1);
      } else {
        setMembers(Array.isArray(data?.items) ? data.items : []);
        setTotalCount(Number(data?.totalCount || 0));
        setTotalPages(Number(data?.totalPages || 0));
      }
    } catch { setErrorMessage("Failed to load members."); }
    finally { setLoadingMembers(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchMembers(Number(selectedYearId), page, searchTerm);
    else { setMembers([]); setTotalCount(0); setTotalPages(0); }
  }, [selectedYearId, page, searchTerm, fetchMembers]);

  // Reset to page 1 whenever the year changes (avoid stuck "page 4 of 1").
  useEffect(() => { setPage(1); }, [selectedYearId]);

  const handlePageChange = (newPage: number) => setPage(newPage);
  const handleSearch = () => { setPage(1); setSearchTerm(searchDraft.trim()); };
  const handleSearchKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } };
  const clearSearch = () => { setSearchDraft(""); setSearchTerm(""); setPage(1); };

  const refreshYears = async () => {
    try {
      const [av, allYrs] = await Promise.all([getCommitteeMemberAvailableYears(districtId), getRotaryYears()]);
      setAllRotaryYears(allYrs);
      const availableIds = new Set(av.map((y: any) => Number(y.id)));
      const currentYear = allYrs.find((y: any) => y.isCurrent);
      if (currentYear) availableIds.add(currentYear.id);
      const filtered = allYrs.filter((y: any) => availableIds.has(y.id));
      setAllYears(filtered.length > 0 ? filtered : currentYear ? [currentYear] : []);
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
    setFormIsMember(false);
    setFormMemberId(null);
    setFormName("");
    setFormMobile("");
    setFormEmail("");
    setFormClubId(null);
    setFormClubName("");
    setFormPhoto("");
  };

  const openAddDialog = () => {
    setEditing(null);
    setFormYearId(selectedYearId);
    clearMember();
    setFormDesignation("");
    setFormRemark("");
    setMemberSearch("");
    setSearchResults([]);
    setShowSearchResults(false);
    setDialogOpen(true);
  };

  const openEditDialog = (m: any) => {
    setEditing(m);
    setFormYearId(String(m.yearId));
    setFormIsMember(!!m.isMember);
    setFormMemberId(m.memberId || null);
    setFormName(m.name || "");
    setFormMobile(m.mobile || "");
    setFormEmail(m.email || "");
    setFormDesignation(m.districtDesignation || "");
    setFormClubId(m.clubId || null);
    setFormClubName(m.clubName || "");
    setFormRemark(m.districtRemark || "");
    setFormPhoto(m.profilePhoto || "");
    setMemberSearch("");
    setSearchResults([]);
    setShowSearchResults(false);
    setDialogOpen(true);
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
      const result = await uploadCommitteePhoto(districtId, cropped, formIsMember && !!formMemberId, formClubId);
      setFormPhoto(result.path);
    } catch { setErrorMessage("Failed to upload photo."); }
    finally { setPhotoUploading(false); photoCrop.cancel(); }
  };

  const handleSave = async () => {
    if (!formName.trim()) { setErrorMessage("Name is required."); return; }
    setSaving(true);
    try {
      const payload = {
        yearId: Number(formYearId),
        memberId: formMemberId,
        isMember: formIsMember,
        name: formName.trim(),
        mobile: formMobile.trim(),
        email: formEmail.trim(),
        districtDesignation: formDesignation.trim(),
        clubId: formClubId,
        clubName: formClubName.trim(),
        districtRemark: formRemark.trim(),
        profilePhoto: formPhoto,
      };
      if (editing) {
        await updateCommitteeMember(districtId, editing.id, payload);
        setSuccessMessage("Member updated.");
      } else {
        await createCommitteeMember(districtId, payload);
        setSuccessMessage("Member added.");
      }
      setDialogOpen(false);
      fetchMembers(Number(selectedYearId), page, searchTerm);
      refreshYears();
    } catch { setErrorMessage("Failed to save."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCommitteeMember(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Member deleted.");
      fetchMembers(Number(selectedYearId), page, searchTerm);
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
                {districtName ? `${districtName} - District Committee` : "District Committee"}
              </h2>
              <p className="text-slate-600 text-base">Manage committee members</p>
            </div>
          </div>
          {canManage && !loading && selectedYearId && (
            <Button
              onClick={openAddDialog}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Member
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
                placeholder="Search by name, mobile, email, club..."
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

        {loadingMembers && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingMembers && selectedYearId && members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Users className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">{searchTerm ? "No matches found" : "No committee members yet"}</h3>
            <p className="text-slate-600 mt-2">
              {searchTerm ? `No members match "${searchTerm}". Try a different search.` : (canManage ? 'Click "Add Member" to add committee members.' : "No committee members added yet.")}
            </p>
          </div>
        )}

        {!loading && !loadingMembers && members.length > 0 && (
          <>
          <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
            <Table>
              <TableHeader>
                <TableRow
                  className="hover:opacity-100 border-b-2 border-marigold"
                  style={{ backgroundColor: "#17458f" }}
                >
                  <TableHead className="w-12 text-white text-xs font-semibold uppercase tracking-wide">#</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Photo</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Name</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Mobile</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Email</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Designation</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Club</TableHead>
                  <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Remark</TableHead>
                  {canManage && <TableHead className="text-right text-white text-xs font-semibold uppercase tracking-wide">Actions</TableHead>}
                  {canManage && <TableHead className="text-center w-14 text-white text-xs font-semibold uppercase tracking-wide">Sort</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m: any, idx: number) => (
                  <TableRow
                    key={m.id}
                    className={`transition-colors border-slate-100 ${!m.isMember ? "bg-slate-100 hover:bg-slate-200" : "hover:bg-slate-50/70"}`}
                  >
                    <TableCell className="text-slate-600">{(page - 1) * PAGE_SIZE + idx + 1}</TableCell>
                    <TableCell>
                      {m.profilePhoto ? (
                        <img src={getPhotoUrl(m.profilePhoto)} alt={m.name} className="rounded-full object-cover w-9 h-9 ring-1 ring-slate-200" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 ring-1 ring-slate-200">{m.name?.charAt(0)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{m.name}</span>
                        {m.isMember ? <MemberChip /> : <NonMemberChip />}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm">{m.mobile || "-"}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{m.email || "-"}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{m.districtDesignation || "-"}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{m.clubName || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-slate-600 text-sm">{m.districtRemark || "-"}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-ink hover:bg-slate-100" onClick={() => openEditDialog(m)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteTarget(m)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    )}
                    {canManage && (
                      <TableCell className="text-center" {...dragProps(idx)}>
                        <GripVertical className="h-4 w-4 text-slate-400 inline-block cursor-grab" />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={PAGE_SIZE} onPageChange={handlePageChange} />
          {canManage && (
            <NonSyncRemovedCommitteeMembers districtId={districtId} level="committee" yearId={selectedYearId ? Number(selectedYearId) : undefined} onAdded={() => fetchMembers(Number(selectedYearId), page)} />
          )}
          </>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-ink">{editing ? "Edit Committee Member" : "Add Committee Member"}</DialogTitle>
              <DialogDescription>{editing ? "Update the member details." : "Search for a member or add a non-member."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Year */}
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

              {/* Smart Search */}
              {!editing && (
                <div className="space-y-2">
                  <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Search Member</Label>
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          className="pl-9 border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                          placeholder="Search by name, mobile, email..."
                          value={memberSearch}
                          onChange={(e) => handleMemberSearch(e.target.value)}
                          onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                        />
                      </div>
                      {formIsMember && formMemberId && (
                        <Button variant="outline" size="sm" onClick={clearMember} type="button" className="border-slate-200 text-slate-700 hover:bg-slate-50">
                          <X className="h-4 w-4 mr-1" />Clear
                        </Button>
                      )}
                    </div>
                    {showSearchResults && searchResults.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {searchResults.map((r: any) => (
                          <div key={r.memberId} className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2" onClick={() => selectMember(r)}>
                            {r.profilePhoto ? (
                              <img src={getPhotoUrl(r.profilePhoto)} alt="" className="rounded-full object-cover w-7 h-7 ring-1 ring-slate-200" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-500 ring-1 ring-slate-200">{r.name?.charAt(0)}</div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-slate-800">{r.name}</p>
                              <p className="text-xs text-slate-500">{r.mobile} | {r.clubName}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {showSearchResults && memberSearch.length >= 2 && searchResults.length === 0 && !searchLoading && (
                      <p className="text-sm text-amber-600 mt-1">No members found. Fill details below to add as non-member.</p>
                    )}
                  </div>
                  {formIsMember && formMemberId && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">Member Selected: {formName}</Badge>
                  )}
                </div>
              )}

              {/* Name */}
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Name *</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={formIsMember && !!formMemberId}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>

              {/* Mobile */}
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Mobile Number</Label>
                <Input
                  value={formMobile}
                  onChange={(e) => setFormMobile(e.target.value)}
                  disabled={formIsMember && !!formMemberId}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Email</Label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  disabled={formIsMember && !!formMemberId}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>

              {/* District Designation */}
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">District Designation</Label>
                <Input
                  value={formDesignation}
                  onChange={(e) => setFormDesignation(e.target.value)}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>

              {/* Club: auto (read-only) for member, editable text for non-member */}
              {(formIsMember && formMemberId) ? (
                formClubName ? (
                  <div className="space-y-2">
                    <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Club</Label>
                    <Input
                      value={formClubName}
                      disabled
                      className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                    />
                  </div>
                ) : null
              ) : (
                <div className="space-y-2">
                  <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Club Name</Label>
                  <Input
                    value={formClubName}
                    onChange={(e) => setFormClubName(e.target.value)}
                    placeholder="Enter club name"
                    className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                  />
                </div>
              )}

              {/* District Remark */}
              <div className="space-y-2">
                <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">District Remark</Label>
                <Input
                  value={formRemark}
                  onChange={(e) => setFormRemark(e.target.value)}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>

              {/* Photo - only for non-member */}
              {(!formIsMember || !formMemberId) && (
                <div className="space-y-2">
                  <Label className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Profile Photo</Label>
                  <div className="flex items-center gap-3">
                    {formPhoto && (
                      <img src={getPhotoUrl(formPhoto)} alt="Photo" className="rounded-full object-cover w-12 h-12 ring-1 ring-slate-200" />
                    )}
                    <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" ref={fileInputRef} className="hidden" onChange={handlePhotoSelected} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      <Upload className="h-4 w-4 mr-1" />Upload Photo
                    </Button>
                  </div>
                  {photoCrop.error && <p className="text-xs text-red-600 mt-1">{photoCrop.error}</p>}
                  <p className="text-xs text-slate-500 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
              )}
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
                disabled={saving || !formName.trim() || !formYearId}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editing ? "Update" : "Add"}
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

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-red-600" title="Delete Committee Member" description="Are you sure? This action cannot be undone." confirmLabel="Delete" confirmClassName="bg-red-600 text-white hover:bg-red-700" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
