"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { PastPresident, ClubMemberSearchResult } from "@/types/pastPresident";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getPastPresidents,
  createPastPresident,
  updatePastPresident,
  deletePastPresident,
  searchClubMembers,
  getRotaryYears,
  getClub,
  getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Crown, User, Search, AlertTriangle, UserPlus, Camera as ImageIcon } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { ListPageSkeleton } from "@/components/row/AppKit";

// Past-president photos render in round avatars everywhere (cards, table, member
// search results), so the crop is locked square and stored at 500×500.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_WIDTH = 500;

// Small chip helpers — keep visual treatment consistent across cards + table.
function MemberChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      Member
    </span>
  );
}
function NonMemberChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      Non-Member
    </span>
  );
}

export default function PastPresidentsPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [records, setRecords] = useState<PastPresident[]>([]);
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PastPresident | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields — either selectedMemberId (Member entry) OR nonMemberName (Non-Member entry) is set.
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState("");
  const [selectedMemberPhoto, setSelectedMemberPhoto] = useState<string | null>(null);
  const [nonMemberName, setNonMemberName] = useState("");
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // Non-member profile photo. existingPhotoUrl = the loaded record's photo (edit mode);
  // photoFile/photoPreview = a newly-picked file; removePhoto clears the existing one.
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  // Member search (debounced 300ms)
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<ClubMemberSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<PastPresident | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const photoCrop = useImageCropUpload();

  useEffect(() => {
    async function fetchClub() {
      try {
        const c = await getClub(clubId);
        setClubName(c.clubName);
      } catch { /* ignore */ }
    }
    fetchClub();
  }, [clubId]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const [pp, yrs] = await Promise.all([
        getPastPresidents(clubId),
        getRotaryYears(),
      ]);
      setRecords(pp);
      setYears(yrs);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load past presidents.");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Debounced member search — 300ms.
  useEffect(() => {
    if (!memberSearch.trim()) {
      setMemberResults([]);
      setShowResults(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchClubMembers(clubId, memberSearch);
        setMemberResults(results);
        setShowResults(true);
      } catch { /* ignore */ }
      finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch, clubId]);

  const clearNewPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  };

  const handleCroppedPhoto = (blob: Blob) => {
    const f = new File([blob], `past-president-${Date.now()}.png`, { type: "image/png" });
    setPhotoFile(f);
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setRemovePhoto(false);
    photoCrop.cancel();
  };

  const removePhotoNow = () => {
    clearNewPhoto();
    setRemovePhoto(true); // clears the existing photo on save
  };

  const resetFormState = () => {
    setSelectedMemberId(null);
    setSelectedMemberName("");
    setSelectedMemberPhoto(null);
    setNonMemberName("");
    setSelectedYearId("");
    setMemberSearch("");
    setMemberResults([]);
    setShowResults(false);
    setExistingPhotoUrl(null);
    clearNewPhoto();
    setRemovePhoto(false);
  };

  const openAddDialog = () => {
    setEditingRecord(null);
    resetFormState();
    setDialogOpen(true);
  };

  const openEditDialog = (record: PastPresident) => {
    setEditingRecord(record);
    if (record.isMember) {
      // Member entry — name+photo read-only, only year is editable.
      setSelectedMemberId(record.memberId);
      setSelectedMemberName(record.memberName);
      setSelectedMemberPhoto(record.profilePhotoPath);
      setNonMemberName("");
    } else {
      // Non-Member entry — show editable text, and allow conversion via Smart Search.
      setSelectedMemberId(null);
      setSelectedMemberName("");
      setSelectedMemberPhoto(null);
      setNonMemberName(record.nonMemberName || record.memberName);
    }
    setExistingPhotoUrl(record.isMember ? null : record.profilePhotoPath);
    clearNewPhoto();
    setRemovePhoto(false);
    setSelectedYearId(String(record.yearId));
    setMemberSearch("");
    setMemberResults([]);
    setShowResults(false);
    setDialogOpen(true);
  };

  const handleSelectMember = (member: ClubMemberSearchResult) => {
    setSelectedMemberId(member.id);
    setSelectedMemberName(member.memberName);
    setSelectedMemberPhoto(member.profilePhotoPath);
    // Picking a member supersedes any typed non-member text — keep state mutually exclusive.
    setNonMemberName("");
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  };

  const handleAddAsNonMember = (typed: string) => {
    const name = typed.trim();
    if (!name) return;
    setNonMemberName(name);
    setSelectedMemberId(null);
    setSelectedMemberName("");
    setSelectedMemberPhoto(null);
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  };

  const handleSave = async () => {
    const hasMember = selectedMemberId !== null;
    const hasNonMember = nonMemberName.trim().length > 0;
    if (!hasMember && !hasNonMember) {
      setErrorMessage("Please select a member or add a non-member name.");
      return;
    }
    if (!selectedYearId) {
      setErrorMessage("Please select a rotary year.");
      return;
    }
    const yearIdNum = Number(selectedYearId);
    // Client-side duplicate check — block before hitting the API. Skip the record being edited.
    const conflict = records.find(
      (r) => r.yearId === yearIdNum && (!editingRecord || r.id !== editingRecord.id)
    );
    if (conflict) {
      setErrorMessage(
        `A Past President (${conflict.memberName}) already exists for ${conflict.yearLabel}. Only one is allowed per year.`
      );
      return;
    }
    setSaving(true);
    try {
      // Mutually exclusive: prefer the member pick if both are somehow set.
      const data = hasMember
        ? { memberId: selectedMemberId, nonMemberName: null, yearId: yearIdNum }
        : { memberId: null, nonMemberName: nonMemberName.trim(), yearId: yearIdNum };
      if (editingRecord) {
        await updatePastPresident(
          clubId, editingRecord.id, data,
          hasMember ? null : photoFile,
          hasMember ? false : removePhoto,
        );
        setSuccessMessage("Past president updated successfully.");
      } else {
        await createPastPresident(clubId, data, hasMember ? null : photoFile);
        setSuccessMessage("Past president added successfully.");
      }
      setDialogOpen(false);
      fetchRecords();
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { message?: string } | string }; message?: string };
      const apiMsg =
        (typeof anyErr.response?.data === "object" && anyErr.response?.data?.message) ||
        (typeof anyErr.response?.data === "string" ? anyErr.response.data : undefined) ||
        anyErr.message ||
        "Failed to save.";
      setErrorMessage(apiMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePastPresident(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Past president record deleted.");
      fetchRecords();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete record.");
    }
  };

  const canManage = isSuperAdmin || isAdmin;

  const filteredRecords = records.filter((rec) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (rec.memberName || "").toLowerCase().includes(q) ||
      (rec.yearLabel || "").toLowerCase().includes(q)
    );
  });

  // Determine if the editing dialog is for a locked Member entry (no name change allowed).
  const editingLockedMember = !!editingRecord && editingRecord.isMember;

  // Save-button enablement.
  const canSave =
    !!selectedYearId &&
    (selectedMemberId !== null || nonMemberName.trim().length > 0);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Past Presidents` : "Past Presidents"}
              </h2>
              <p className="text-muted-foreground text-base">Historical record of club presidents by year</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Past President
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && records.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by member name, year..."
          />
        )}

        {!loading && records.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No past presidents recorded</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? "Click \"Add Past President\" to add a record." : "No records have been added yet."}
            </p>
          </div>
        )}

        {!loading && filteredRecords.length === 0 && records.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No past presidents match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filteredRecords.length > 0 && (
          <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-3">
              {filteredRecords.map((rec) => {
                const photoUrl = getPhotoUrl(rec.profilePhotoPath);
                return (
                  <Card
                    key={rec.id}
                    className={rec.isMember ? "border-primary/20" : "border-slate-300 bg-slate-100"}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full ${
                            rec.isMember ? "bg-muted" : "bg-slate-200"
                          }`}
                        >
                          {photoUrl ? (
                            <Image src={photoUrl} alt={rec.memberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div
                              className={`flex h-full w-full items-center justify-center ${
                                rec.isMember ? "bg-primary/10 text-primary" : "bg-slate-200 text-slate-500"
                              }`}
                            >
                              <User className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-primary truncate">{rec.memberName}</p>
                            {rec.isMember ? <MemberChip /> : <NonMemberChip />}
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.yearLabel}</p>
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(rec)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(rec)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12"></TableHead>
                    <TableHead className="text-base font-semibold">Member Name</TableHead>
                    <TableHead className="text-base font-semibold">Rotary Year</TableHead>
                    {canManage && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((rec) => {
                    const photoUrl = getPhotoUrl(rec.profilePhotoPath);
                    // Non-Member rows get the grey muted background for the whole row.
                    const rowClass = rec.isMember
                      ? "hover:bg-primary/5 transition-colors"
                      : "bg-slate-100 hover:bg-slate-200 transition-colors";
                    return (
                      <TableRow key={rec.id} className={rowClass}>
                        <TableCell>
                          <div
                            className={`relative h-8 w-8 overflow-hidden rounded-full ${
                              rec.isMember ? "bg-muted" : "bg-slate-200"
                            }`}
                          >
                            {photoUrl ? (
                              <Image src={photoUrl} alt={rec.memberName} fill className="object-cover" unoptimized />
                            ) : (
                              <div
                                className={`flex h-full w-full items-center justify-center ${
                                  rec.isMember ? "bg-primary/10 text-primary" : "bg-slate-200 text-slate-500"
                                }`}
                              >
                                <User className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold text-primary">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{rec.memberName}</span>
                            {rec.isMember ? <MemberChip /> : <NonMemberChip />}
                          </div>
                        </TableCell>
                        <TableCell>{rec.yearLabel}</TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(rec)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(rec)}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRecord ? "Edit Past President" : "Add Past President"}</DialogTitle>
              <DialogDescription>
                {editingRecord
                  ? editingLockedMember
                    ? "This entry is linked to a club member. You can update the year only."
                    : "Update the non-member name, search for a member to convert this entry, or change the year."
                  : "Search for a club member, or add a non-member by name. Then pick a past rotary year."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Member / Non-Member section */}
              <div className="space-y-2">
                <Label>{editingLockedMember ? "Member" : "Member / Non-Member"}</Label>

                {/* Case 1: Editing a Member entry — show read-only card, no change allowed. */}
                {editingLockedMember ? (
                  <div className="flex items-center gap-3 p-3 border rounded-md bg-primary/5">
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                      {selectedMemberPhoto ? (
                        <Image src={getPhotoUrl(selectedMemberPhoto)} alt={selectedMemberName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                          <User className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <span className="font-medium flex-1">{selectedMemberName}</span>
                    <MemberChip />
                  </div>
                ) : (
                  <>
                    {/* Case 2: a Member has been picked from search — show the picked member card with Change. */}
                    {selectedMemberId !== null ? (
                      <div className="flex items-center gap-3 p-3 border rounded-md bg-primary/5">
                        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                          {selectedMemberPhoto ? (
                            <Image src={getPhotoUrl(selectedMemberPhoto)} alt={selectedMemberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                              <User className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{selectedMemberName}</span>
                            <MemberChip />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedMemberId(null);
                            setSelectedMemberName("");
                            setSelectedMemberPhoto(null);
                          }}
                        >
                          Change
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/* Smart search input — debounced 300ms via useEffect above. */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search Member by Name"
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            className="pl-9"
                            autoFocus
                          />
                          {searchLoading && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <RotaryLoader size="sm" />
                            </div>
                          )}
                          {showResults && memberResults.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md">
                              {memberResults.map((m) => {
                                const photoUrl = getPhotoUrl(m.profilePhotoPath);
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    className="flex items-center gap-3 w-full px-3 py-2 hover:bg-accent text-left transition-colors"
                                    onClick={() => handleSelectMember(m)}
                                  >
                                    <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                                      {photoUrl ? (
                                        <Image src={photoUrl} alt={m.memberName} fill className="object-cover" unoptimized />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                          <User className="h-4 w-4" />
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-sm font-medium">{m.memberName}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {/* No-results state — offer "Add as Non-Member" */}
                          {showResults && memberResults.length === 0 && memberSearch.trim() && !searchLoading && (
                            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-3 shadow-md">
                              <p className="text-sm text-muted-foreground mb-2">No members found.</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => handleAddAsNonMember(memberSearch)}
                              >
                                <UserPlus className="mr-2 h-4 w-4" />
                                {`Add "${memberSearch.trim()}" as Non-Member`}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Editable non-member name (always available; also lets edit-mode user tweak the existing NM name). */}
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Or enter a Non-Member name</Label>
                          <Input
                            placeholder="Non-Member full name"
                            value={nonMemberName}
                            onChange={(e) => setNonMemberName(e.target.value)}
                          />
                        </div>

                        {/* Selection preview chip */}
                        {(selectedMemberId !== null || nonMemberName.trim().length > 0) && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Selected:</span>
                            <span className="font-medium">
                              {selectedMemberId !== null ? selectedMemberName : nonMemberName.trim()}
                            </span>
                            {selectedMemberId !== null ? <MemberChip /> : <NonMemberChip />}
                          </div>
                        )}

                        {/* Non-Member profile photo — only for non-member selections */}
                        {selectedMemberId === null && nonMemberName.trim().length > 0 && (() => {
                          const shownPhoto = photoPreview || (!removePhoto ? getPhotoUrl(existingPhotoUrl) : "");
                          return (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Profile Photo (optional)</Label>
                              <div className="flex items-center gap-3">
                                <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                                  {shownPhoto ? (
                                    <Image src={shownPhoto} alt={nonMemberName} fill className="object-cover" unoptimized />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-slate-500">
                                      <ImageIcon className="h-5 w-5" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="cursor-pointer text-xs font-medium px-3 py-1.5 rounded-full border text-foreground hover:bg-accent">
                                    {shownPhoto ? "Change" : "Upload"}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => { const f = e.target.files?.[0]; if (f) photoCrop.startCrop(f); e.target.value = ""; }}
                                    />
                                  </label>
                                  {shownPhoto && (
                                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={removePhotoNow}>
                                      Remove
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or GIF · cropped square.</p>
                              {photoCrop.error && <p className="text-xs text-destructive">{photoCrop.error}</p>}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Year dropdown — past years only (current + future are intentionally hidden).
                  When editing, also include the row's existing year even if it now equals or exceeds today,
                  so the dropdown still shows a value for legacy/in-flight records. */}
              <div className="space-y-2">
                <Label>Rotary Year</Label>
                <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a year" />
                  </SelectTrigger>
                  <SelectContent>
                    {years
                      .filter((y) => {
                        const isPast = new Date(y.endDate) < new Date();
                        return isPast || (editingRecord && editingRecord.yearId === y.id);
                      })
                      .map((y) => (
                        <SelectItem key={y.id} value={String(y.id)}>
                          {y.yearLabel}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !canSave}>
                {saving ? "Saving..." : editingRecord ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.imageSrc}
          aspect={PHOTO_ASPECT}
          maxOutputWidth={PHOTO_MAX_WIDTH}
          title="Crop Profile Photo"
          onCancel={photoCrop.cancel}
          onSave={handleCroppedPhoto}
        />

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Past President"
          description={
            <>
              Are you sure you want to delete the record for{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.memberName}</span> ({deleteTarget?.yearLabel})?
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
