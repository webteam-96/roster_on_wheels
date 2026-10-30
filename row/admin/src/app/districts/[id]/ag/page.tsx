"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  getAGs, getAGYearsWithData, getRotaryYears, getAvailableClubsForAG, saveAG,
  deleteAGByMember,
  searchMembersForAG, getDistrict, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, UserCog, Search, Building2, Calendar, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { RotaryYear } from "@/types/rotaryYear";
import { ListPageSkeleton } from "@/components/row/AppKit";

interface AGGroup {
  memberId: number;
  memberName: string;
  mobile: string;
  email: string;
  profilePhoto: string | null;
  clubs: { id: number; clubId: number; clubName: string; clubRotaryId: string }[];
}

interface DataYear { id: number; yearLabel: string; isCurrent: boolean }

export default function AGPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [districtName, setDistrictName] = useState("");
  const [agList, setAgList] = useState<AGGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Years: listing filter shows only years that HAVE data; the add/edit dialog shows ALL years.
  const [dataYears, setDataYears] = useState<DataYear[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const currentYearId = allYears.find((y) => y.isCurrent)?.id;

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AGGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AGGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form
  const [formYearId, setFormYearId] = useState<string>("");
  const [formMemberId, setFormMemberId] = useState<number | null>(null);
  const [formMemberName, setFormMemberName] = useState("");
  const [formMemberPhoto, setFormMemberPhoto] = useState("");
  const [formSelectedClubIds, setFormSelectedClubIds] = useState<Set<number>>(new Set());
  const [availableClubs, setAvailableClubs] = useState<any[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(false);
  const [clubSearchQuery, setClubSearchQuery] = useState("");

  // Member search
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchTimeout = useRef<any>(null);

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, dy, allYrs] = await Promise.all([
          getDistrict(districtId), getAGYearsWithData(districtId), getRotaryYears(),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        setDataYears(dy);
        setAllYears(allYrs);
        const cy = dy.find((y) => y.isCurrent) || dy[0];
        setSelectedYearId(cy ? String(cy.id) : "");
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  const groupAGs = (data: any[]) => {
    const map = new Map<number, AGGroup>();
    for (const row of data) {
      if (!map.has(row.memberId)) {
        map.set(row.memberId, {
          memberId: row.memberId,
          memberName: row.memberName,
          mobile: row.mobile,
          email: row.email,
          profilePhoto: row.profilePhoto,
          clubs: [],
        });
      }
      map.get(row.memberId)!.clubs.push({
        id: row.id,
        clubId: row.clubId,
        clubName: row.clubName,
        clubRotaryId: row.clubRotaryId,
      });
    }
    setAgList(Array.from(map.values()));
  };

  const fetchAGs = useCallback(async (yearId: number) => {
    setLoadingList(true);
    try {
      const data = await getAGs(districtId, yearId);
      groupAGs(data);
    } catch { setErrorMessage("Failed to load data."); }
    finally { setLoadingList(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchAGs(Number(selectedYearId));
    else setAgList([]);
  }, [selectedYearId, fetchAGs]);

  // Reconcile the listing year list + selection after a save/delete (a year may have just
  // gained its first record, or lost its last one). preferYearId selects that year if it has data.
  const reconcileAfterChange = async (preferYearId?: number) => {
    let dy: DataYear[] = [];
    try { dy = await getAGYearsWithData(districtId); } catch { return; }
    setDataYears(dy);
    if (preferYearId && dy.find((y) => y.id === preferYearId)) {
      // Switching year fires the [selectedYearId] effect (which fetches). But if the saved
      // year is the one already selected, setSelectedYearId is a no-op and the effect won't
      // re-run — so fetch explicitly to refresh the listing with the just-saved clubs.
      if (String(preferYearId) === selectedYearId) fetchAGs(preferYearId);
      else setSelectedYearId(String(preferYearId));
      return;
    }
    if (dy.find((y) => String(y.id) === selectedYearId)) { fetchAGs(Number(selectedYearId)); return; }
    const cy = dy.find((y) => y.isCurrent) || dy[0];
    if (cy) setSelectedYearId(String(cy.id));
    else { setSelectedYearId(""); setAgList([]); }
  };

  // Member search (year-scoped — excludes members already AG in the selected form year)
  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); setShowSearchResults(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchMembersForAG(districtId, val, formYearId ? Number(formYearId) : undefined);
        setSearchResults(results);
        setShowSearchResults(true);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  };

  const selectMember = (m: any) => {
    setFormMemberId(m.memberId);
    setFormMemberName(m.name);
    setFormMemberPhoto(m.profilePhoto || "");
    setShowSearchResults(false);
    setSearchResults([]);   // drop any pending list so it can't flash back
    setMemberSearch("");
  };

  const clearSelectedMember = () => {
    setFormMemberId(null);
    setFormMemberName("");
    setFormMemberPhoto("");
    setFormSelectedClubIds(new Set());
    setSearchResults([]);
    setShowSearchResults(false);
    setMemberSearch("");
  };

  // Available clubs are year-scoped — (re)load whenever the dialog opens, the member changes,
  // or the chosen year changes. Assigned clubs (edit mode) are force-included so they stay visible.
  useEffect(() => {
    if (!dialogOpen || !formMemberId || !formYearId) return;
    let cancelled = false;
    (async () => {
      setLoadingClubs(true);
      try {
        const available = await getAvailableClubsForAG(districtId, editing ? editing.memberId : undefined, Number(formYearId));
        const allClubs = [...available];
        if (editing) {
          for (const c of editing.clubs) {
            if (!allClubs.find((ac: any) => ac.id === c.clubId)) {
              allClubs.push({ id: c.clubId, clubName: c.clubName, clubRotaryId: c.clubRotaryId });
            }
          }
        }
        allClubs.sort((a: any, b: any) => a.clubName.localeCompare(b.clubName));
        if (!cancelled) setAvailableClubs(allClubs);
      } catch { if (!cancelled) setAvailableClubs([]); }
      finally { if (!cancelled) setLoadingClubs(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, formMemberId, formYearId]);

  const openAddDialog = () => {
    setEditing(null);
    setFormMemberId(null);
    setFormMemberName("");
    setFormMemberPhoto("");
    setFormSelectedClubIds(new Set());
    setAvailableClubs([]);
    setMemberSearch("");
    setSearchResults([]);
    setShowSearchResults(false);
    setClubSearchQuery("");
    // Add always defaults to the CURRENT year, regardless of which year the listing is filtered to.
    setFormYearId(currentYearId ? String(currentYearId) : (selectedYearId || (allYears[0] ? String(allYears[0].id) : "")));
    setDialogOpen(true);
  };

  const openEditDialog = (ag: AGGroup) => {
    setEditing(ag);
    setFormMemberId(ag.memberId);
    setFormMemberName(ag.memberName);
    setFormMemberPhoto(ag.profilePhoto || "");
    setFormSelectedClubIds(new Set(ag.clubs.map((c) => c.clubId)));
    setClubSearchQuery("");
    setMemberSearch("");
    setSearchResults([]);
    setShowSearchResults(false);
    setAvailableClubs([]);
    setFormYearId(selectedYearId);
    setDialogOpen(true);
  };

  // Clubs are year-specific, so clear the selection whenever the user switches year.
  const handleFormYearChange = (v: string) => {
    setFormYearId(v);
    setFormSelectedClubIds(new Set());
  };

  const toggleClub = (clubId: number) => {
    setFormSelectedClubIds((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) next.delete(clubId);
      else next.add(clubId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!formYearId) { setErrorMessage("Select a year."); return; }
    if (!formMemberId) { setErrorMessage("Select a member."); return; }
    if (formSelectedClubIds.size === 0) { setErrorMessage("Select at least one club."); return; }
    setSaving(true);
    try {
      await saveAG(districtId, {
        memberId: formMemberId,
        clubIds: Array.from(formSelectedClubIds),
        oldMemberId: editing ? editing.memberId : undefined,
        yearId: Number(formYearId),
      });
      setDialogOpen(false);
      setSuccessMessage(editing ? "Assistant Governor updated." : "Assistant Governor added.");
      await reconcileAfterChange(Number(formYearId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAGByMember(districtId, deleteTarget.memberId, selectedYearId ? Number(selectedYearId) : undefined);
      setDeleteTarget(null);
      setSuccessMessage("Assistant Governor removed.");
      await reconcileAfterChange();
    } catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
    finally { setDeleting(false); }
  };

  const filteredClubs = clubSearchQuery
    ? availableClubs.filter((c: any) => c.clubName.toLowerCase().includes(clubSearchQuery.toLowerCase()) || c.clubRotaryId?.toLowerCase().includes(clubSearchQuery.toLowerCase()))
    : availableClubs;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtName ? `${districtName} - Assistant Governor (AG)` : "Assistant Governor (AG)"}
              </h2>
              <p className="text-muted-foreground text-base">Assign assistant governors to clubs</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!loading && dataYears.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {dataYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {canManage && (
              <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add AG</Button>
            )}
          </div>
        </div>

        {(loading || loadingList) && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}

        {!loading && !loadingList && agList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCog className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No assistant governors</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add AG" to assign.' : "No assistant governors assigned."}</p>
          </div>
        )}

        {!loading && !loadingList && agList.length > 0 && (
          <div className="space-y-4">
            {agList.map((ag) => (
              <Card key={ag.memberId} className="hover:shadow-md transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {ag.profilePhoto ? (
                        <img src={getPhotoUrl(ag.profilePhoto)} alt={ag.memberName} className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">{ag.memberName?.charAt(0)}</div>
                      )}
                      <div>
                        <p className="font-semibold text-base">{ag.memberName}</p>
                        <p className="text-sm text-muted-foreground">{ag.mobile} | {ag.email}</p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(ag)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(ag)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ag.clubs.map((c) => (
                      <Badge key={c.clubId} variant="secondary" className="text-sm py-1 px-3">
                        <Building2 className="h-3.5 w-3.5 mr-1.5" />{c.clubName}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Assistant Governor" : "Add Assistant Governor"}</DialogTitle>
              <DialogDescription>{editing ? "Update assigned clubs." : "Search a member and assign clubs."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Rotary Year (all years) */}
              <div className="space-y-2">
                <Label>Rotary Year *</Label>
                <Select value={formYearId} onValueChange={handleFormYearChange}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {allYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Member Search — hidden once a member is selected (use the ✕ to change) */}
              {!formMemberId && (
              <div className="space-y-2">
                <Label>Search Member *</Label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search by name, mobile, email..." value={memberSearch}
                      onChange={(e) => handleMemberSearch(e.target.value)}
                      onFocus={() => searchResults.length > 0 && setShowSearchResults(true)} />
                  </div>
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((r: any) => (
                        <div
                          key={r.memberId}
                          className={`px-3 py-2 flex items-center gap-2 ${r.ineligibleReason ? "opacity-70 cursor-not-allowed bg-rose-50/40" : "hover:bg-muted cursor-pointer"}`}
                          onClick={() => { if (!r.ineligibleReason) selectMember(r); }}
                          title={r.ineligibleReason || undefined}
                        >
                          {r.profilePhoto ? (
                            <img src={getPhotoUrl(r.profilePhoto)} alt="" className="rounded-full object-cover w-7 h-7" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs">{r.name?.charAt(0)}</div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{r.name}</p>
                            <p className="text-xs text-muted-foreground">{r.mobile} | {r.clubName}</p>
                            {r.ineligibleReason && (
                              <p className="text-xs text-rose-600 font-medium flex items-center gap-1"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {r.ineligibleReason}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showSearchResults && memberSearch.length >= 2 && searchResults.length === 0 && !searchLoading && (
                    <p className="text-sm text-amber-600 mt-1">No members found.</p>
                  )}
                </div>
              </div>
              )}

              {/* Selected Member — with a ✕ to remove and search again */}
              {formMemberId && (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  {formMemberPhoto ? (
                    <img src={getPhotoUrl(formMemberPhoto)} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{formMemberName?.charAt(0)}</div>
                  )}
                  <div>
                    <p className="font-medium text-sm text-green-800">{formMemberName}</p>
                    <p className="text-xs text-green-600">Selected as Assistant Governor</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelectedMember}
                    title="Remove & search again"
                    aria-label="Remove selected member"
                    className="ml-auto shrink-0 text-green-700 hover:text-red-600 hover:bg-red-100 rounded-full p-1.5 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Club Selection */}
              {formMemberId && (
                <div className="space-y-2">
                  <Label>Assign Clubs * ({formSelectedClubIds.size} selected)</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search clubs..." value={clubSearchQuery} onChange={(e) => setClubSearchQuery(e.target.value)} />
                  </div>
                  {loadingClubs && <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>}
                  {!loadingClubs && (
                    <div className="border rounded-md max-h-60 overflow-y-auto">
                      {filteredClubs.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground text-center">No available clubs.</p>
                      ) : (
                        filteredClubs.map((c: any) => (
                          <div key={c.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-muted cursor-pointer border-b last:border-b-0 ${formSelectedClubIds.has(c.id) ? "bg-primary/5" : ""}`}
                            onClick={() => toggleClub(c.id)}>
                            <Checkbox checked={formSelectedClubIds.has(c.id)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{c.clubName}</p>
                              {c.clubRotaryId && <p className="text-xs text-muted-foreground">{c.clubRotaryId}</p>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formYearId || !formMemberId || formSelectedClubIds.size === 0}>
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Remove Assistant Governor</DialogTitle>
              <DialogDescription>Remove {deleteTarget?.memberName} as Assistant Governor? All club assignments will be removed and a removal email will be sent.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={deleting}>
                {deleting ? <><RotaryLoader size="sm" /><span className="ml-2">Removing...</span></> : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
