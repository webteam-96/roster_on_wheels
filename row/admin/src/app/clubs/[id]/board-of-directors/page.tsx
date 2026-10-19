"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { BoardDirector, Designation } from "@/types/boardDirector";
import { ClubMemberSearchResult } from "@/types/pastPresident";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getBoardOfDirectors,
  getBoardYearsByClub,
  createBoardDirector,
  updateBoardDirector,
  deleteBoardDirector,
  searchBoardMembers,
  getDesignations,
  getRotaryYears,
  getClub,
  getPhotoUrl,
  reorderBoardOfDirectors,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
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
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Users, User, Search, AlertTriangle, GripVertical } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function BoardOfDirectorsPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin, isAG } = useAuth();

  const [clubName, setClubName] = useState("");
  const [records, setRecords] = useState<BoardDirector[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [filterYears, setFilterYears] = useState<RotaryYear[]>([]);
  const [selectedFilterYearId, setSelectedFilterYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Board dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BoardDirector | null>(null);
  const [saving, setSaving] = useState(false);

  // Board form fields
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState("");
  const [selectedMemberPhoto, setSelectedMemberPhoto] = useState<string | null>(null);
  const [selectedDesignationId, setSelectedDesignationId] = useState<string>("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // Member search
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<ClubMemberSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<BoardDirector | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Drag & drop reorder — disabled while a search filter is active (would reorder filtered subset only)
  const { dragProps } = useDragSort(records, setRecords, async (ids) => {
    if (!selectedFilterYearId) return;
    try { await reorderBoardOfDirectors(clubId, Number(selectedFilterYearId), ids); }
    catch { setErrorMessage("Failed to save order."); }
  });

  useEffect(() => {
    async function fetchClub() {
      try {
        const c = await getClub(clubId);
        setClubName(c.clubName);
      } catch { /* ignore */ }
    }
    fetchClub();
  }, [clubId]);

  // Initial load: designations, all years, filter years
  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [des, yrs, boardYrs] = await Promise.all([
        getDesignations(),
        getRotaryYears(),
        getBoardYearsByClub(clubId),
      ]);
      setDesignations(des);
      setAllYears(yrs);
      setFilterYears(boardYrs);

      // Default to current year if it has data, else latest year with data
      const currentYear = boardYrs.find(y => y.isCurrent);
      const defaultYear = currentYear || boardYrs[0];
      if (defaultYear) {
        setSelectedFilterYearId(String(defaultYear.id));
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  // Fetch records when filter year changes
  const fetchRecords = useCallback(async (yearId: number) => {
    setLoadingRecords(true);
    try {
      const bd = await getBoardOfDirectors(clubId, yearId);
      setRecords(bd);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load board of directors.");
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedFilterYearId) {
      fetchRecords(Number(selectedFilterYearId));
    } else {
      setRecords([]);
    }
  }, [selectedFilterYearId, fetchRecords]);

  // Member search with debounce
  useEffect(() => {
    if (!memberSearch.trim()) {
      setMemberResults([]);
      setShowResults(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchBoardMembers(clubId, memberSearch);
        setMemberResults(results);
        setShowResults(true);
      } catch { /* ignore */ }
      finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch, clubId]);

  const handleFilterYearChange = (value: string) => {
    setSelectedFilterYearId(value);
  };

  const openAddDialog = () => {
    setEditingRecord(null);
    setSelectedMemberId(null);
    setSelectedMemberName("");
    setSelectedMemberPhoto(null);
    setSelectedDesignationId("");
    setCustomDesignation("");
    setSelectedYearId("");
    setMemberSearch("");
    setMemberResults([]);
    setShowResults(false);
    setDialogOpen(true);
  };

  const openEditDialog = (record: BoardDirector) => {
    setEditingRecord(record);
    setSelectedMemberId(record.memberId);
    setSelectedMemberName(record.memberName);
    setSelectedMemberPhoto(record.profilePhotoPath);
    setSelectedDesignationId(String(record.designationId));
    setCustomDesignation(record.customDesignation || "");
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
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  };

  const refreshAfterSave = async () => {
    // Refresh filter years (new year may have been added)
    const boardYrs = await getBoardYearsByClub(clubId);
    setFilterYears(boardYrs);
    // If current filter year still valid, refresh records; else select latest
    if (selectedFilterYearId && boardYrs.some(y => String(y.id) === selectedFilterYearId)) {
      fetchRecords(Number(selectedFilterYearId));
    } else if (boardYrs.length > 0) {
      const currentYear = boardYrs.find(y => y.isCurrent);
      const defaultYear = currentYear || boardYrs[0];
      setSelectedFilterYearId(String(defaultYear.id));
    }
  };

  // "Other" designation => a free-text designation name is required.
  const isOtherDesignation =
    designations.find((d) => String(d.id) === selectedDesignationId)?.designationName === "Other";

  const handleSave = async () => {
    if (!selectedMemberId) { setErrorMessage("Please select a member."); return; }
    if (!selectedDesignationId) { setErrorMessage("Please select a designation."); return; }
    if (isOtherDesignation && !customDesignation.trim()) { setErrorMessage("Please enter the designation name for \"Other\"."); return; }
    if (!selectedYearId) { setErrorMessage("Please select a rotary year."); return; }
    setSaving(true);
    try {
      // v1 dialog only handles existing members; non-member fields are always null here.
      const data = { memberId: selectedMemberId, nonMemberName: null, nonMemberMobile: null, nonMemberEmail: null, designationId: Number(selectedDesignationId), customDesignation: isOtherDesignation ? customDesignation.trim() : null, yearId: Number(selectedYearId) };
      if (editingRecord) {
        await updateBoardDirector(clubId, editingRecord.id, data);
        setSuccessMessage("Board director updated successfully.");
      } else {
        await createBoardDirector(clubId, data);
        setSuccessMessage("Board director added successfully.");
      }
      setDialogOpen(false);
      await refreshAfterSave();
    } catch (err: unknown) {
      // API now returns 400 with { message } for CP/CS uniqueness rule (and other business errors).
      // Surface that message verbatim instead of the old generic 500-fallback string.
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
      await deleteBoardDirector(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Board director record deleted.");
      await refreshAfterSave();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete record.");
    }
  };

  const canManage = isSuperAdmin || isAdmin || isAG;

  const filteredRecords = records.filter((rec) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (rec.memberName || "").toLowerCase().includes(q) ||
      (rec.designationName || "").toLowerCase().includes(q)
    );
  });

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
                {clubName ? `${clubName} - Board of Directors` : "Board of Directors"}
              </h2>
              <p className="text-muted-foreground text-base">Club board members by designation and year</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Board Director
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Year filter — only shown when data exists */}
        {!loading && filterYears.length > 0 && (
          <div className="max-w-xs">
            <Select value={selectedFilterYearId} onValueChange={handleFilterYearChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {filterYears.map((y) => (
                  <SelectItem key={y.id} value={String(y.id)}>
                    {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loadingRecords && (
          <div className="flex items-center justify-center py-12">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && !loadingRecords && filterYears.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No board of directors recorded</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Board Director" to add a record.' : "No records have been added yet."}
            </p>
          </div>
        )}

        {!loading && !loadingRecords && records.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by member name, designation..."
          />
        )}

        {!loading && !loadingRecords && filteredRecords.length === 0 && records.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No board directors match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && !loadingRecords && selectedFilterYearId && records.length === 0 && filterYears.length > 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No records for the selected year.</p>
          </div>
        )}

        {!loading && !loadingRecords && filteredRecords.length > 0 && (
          <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-3">
              {filteredRecords.map((rec) => {
                const photoUrl = getPhotoUrl(rec.profilePhotoPath);
                return (
                  <Card key={rec.id} className="border-primary/20">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                          {photoUrl ? (
                            <Image src={photoUrl} alt={rec.memberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                              <User className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-primary truncate">{rec.memberName}</p>
                          <p className="text-sm text-muted-foreground">{rec.designationName}</p>
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
                    <TableHead className="w-12 text-primary-foreground"></TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Member Name</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Designation</TableHead>
                    {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                    {canManage && <TableHead className="w-16 text-primary-foreground text-center text-base font-semibold">Sort</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((rec) => {
                    const photoUrl = getPhotoUrl(rec.profilePhotoPath);
                    // Drag uses the row's index in the FULL records array — disabled while search filter is active.
                    const recordsIdx = records.findIndex((r) => r.id === rec.id);
                    const dragEnabled = canManage && !searchQuery;
                    return (
                      <TableRow key={rec.id} className="hover:bg-primary/5 transition-colors">
                        <TableCell>
                          <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={rec.memberName} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                <User className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold text-primary">{rec.memberName}</TableCell>
                        <TableCell>{rec.designationName}</TableCell>
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
                        {canManage && (
                          <TableCell
                            className="text-center"
                            title={dragEnabled ? "Drag to reorder" : "Clear search to enable reorder"}
                            {...(dragEnabled ? dragProps(recordsIdx) : {})}
                          >
                            <GripVertical className={`h-4 w-4 inline-block ${dragEnabled ? "text-muted-foreground cursor-grab" : "text-muted-foreground/30 cursor-not-allowed"}`} />
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

        {/* Add/Edit Board Director Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRecord ? "Edit Board Director" : "Add Board Director"}</DialogTitle>
              <DialogDescription>
                {editingRecord ? "Update the member, designation, or year." : "Select a member, designation, and rotary year."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Selected member display */}
              <div className="space-y-2">
                <Label>Member</Label>
                {selectedMemberId ? (
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
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedMemberId(null); setSelectedMemberName(""); setSelectedMemberPhoto(null); }}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search club members..."
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
                      <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
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
                    {showResults && memberResults.length === 0 && memberSearch.trim() && !searchLoading && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Designation dropdown */}
              <div className="space-y-2">
                <Label>Designation</Label>
                <Select value={selectedDesignationId} onValueChange={setSelectedDesignationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a designation" />
                  </SelectTrigger>
                  <SelectContent>
                    {designations.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.designationName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isOtherDesignation && (
                  <div className="pt-2">
                    <Label>Designation name</Label>
                    <Input
                      placeholder="Enter the designation name"
                      value={customDesignation}
                      maxLength={150}
                      onChange={(e) => setCustomDesignation(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Year dropdown — ALL years */}
              <div className="space-y-2">
                <Label>Rotary Year</Label>
                <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a year" />
                  </SelectTrigger>
                  <SelectContent>
                    {allYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>
                        {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
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
              <Button onClick={handleSave} disabled={saving || !selectedMemberId || !selectedDesignationId || !selectedYearId || (isOtherDesignation && !customDesignation.trim())}>
                {saving ? "Saving..." : editingRecord ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Board Director confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Board Director"
          description={
            <>
              Are you sure you want to delete the record for{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.memberName}</span> ({deleteTarget?.designationName}, {deleteTarget?.yearLabel})?
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
