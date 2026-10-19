"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getClubModerators, getAvailableClubsForModerator, saveClubModerator,
  deleteClubModeratorByMember, getModeratorClubs,
  searchMembersForModerator, getDistrict, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Shield, Search, X, Building2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface ModeratorGroup {
  memberId: number;
  memberName: string;
  mobile: string;
  email: string;
  profilePhoto: string | null;
  clubs: { id: number; clubId: number; clubName: string; clubRotaryId: string }[];
}

export default function ClubModeratorPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [districtName, setDistrictName] = useState("");
  const [moderators, setModerators] = useState<ModeratorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModeratorGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModeratorGroup | null>(null);

  // Form
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
        const [d, data] = await Promise.all([getDistrict(districtId), getClubModerators(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        groupModerators(data);
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  const groupModerators = (data: any[]) => {
    const map = new Map<number, ModeratorGroup>();
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
    setModerators(Array.from(map.values()));
  };

  const refreshData = async () => {
    try {
      const data = await getClubModerators(districtId);
      groupModerators(data);
    } catch {}
  };

  // Member search
  const handleMemberSearch = (val: string) => {
    setMemberSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); setShowSearchResults(false); return; }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchMembersForModerator(districtId, val);
        setSearchResults(results);
        setShowSearchResults(true);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  };

  const selectMember = async (m: any) => {
    setFormMemberId(m.memberId);
    setFormMemberName(m.name);
    setFormMemberPhoto(m.profilePhoto || "");
    setShowSearchResults(false);
    setMemberSearch("");
    // Load available clubs — keep currently selected clubs checked
    setLoadingClubs(true);
    try {
      const available = await getAvailableClubsForModerator(districtId);
      // Merge: keep previously selected clubs in the list even if not "available"
      const currentSelected = Array.from(formSelectedClubIds);
      const allClubs = [...available];
      if (currentSelected.length > 0 && editing) {
        for (const c of editing.clubs) {
          if (!allClubs.find((ac: any) => ac.id === c.clubId)) {
            allClubs.push({ id: c.clubId, clubName: c.clubName, clubRotaryId: c.clubRotaryId });
          }
        }
      }
      allClubs.sort((a: any, b: any) => a.clubName.localeCompare(b.clubName));
      setAvailableClubs(allClubs);
    } catch {}
    finally { setLoadingClubs(false); }
  };

  const openAddDialog = async () => {
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
    setDialogOpen(true);
  };

  const openEditDialog = async (mod: ModeratorGroup) => {
    setEditing(mod);
    setFormMemberId(mod.memberId);
    setFormMemberName(mod.memberName);
    setFormMemberPhoto(mod.profilePhoto || "");
    setFormSelectedClubIds(new Set(mod.clubs.map(c => c.clubId)));
    setClubSearchQuery("");
    setMemberSearch("");
    setSearchResults([]);
    setShowSearchResults(false);
    setDialogOpen(true);
    // Load all clubs (available + already assigned to this member)
    setLoadingClubs(true);
    try {
      const available = await getAvailableClubsForModerator(districtId, mod.memberId);
      // Merge: available clubs + currently assigned clubs
      const assigned = mod.clubs.map(c => ({ id: c.clubId, clubName: c.clubName, clubRotaryId: c.clubRotaryId }));
      const allClubs = [...assigned];
      for (const ac of available) {
        if (!allClubs.find((c: any) => c.id === ac.id)) allClubs.push(ac);
      }
      allClubs.sort((a: any, b: any) => a.clubName.localeCompare(b.clubName));
      setAvailableClubs(allClubs);
    } catch {}
    finally { setLoadingClubs(false); }
  };

  const toggleClub = (clubId: number) => {
    setFormSelectedClubIds(prev => {
      const next = new Set(prev);
      if (next.has(clubId)) next.delete(clubId);
      else next.add(clubId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!formMemberId) { setErrorMessage("Select a member."); return; }
    if (formSelectedClubIds.size === 0) { setErrorMessage("Select at least one club."); return; }
    setSaving(true);
    try {
      await saveClubModerator(districtId, {
        memberId: formMemberId,
        clubIds: Array.from(formSelectedClubIds),
        oldMemberId: editing && editing.memberId !== formMemberId ? editing.memberId : undefined,
      } as any);
      setDialogOpen(false);
      setSuccessMessage(editing ? "Club moderator updated." : "Club moderator added.");
      refreshData();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally { setSaving(false); }
  };

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClubModeratorByMember(districtId, deleteTarget.memberId);
      setDeleteTarget(null);
      setSuccessMessage("Club moderator removed.");
      refreshData();
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
                {districtName ? `${districtName} - Club Moderator` : "Club Moderator"}
              </h2>
              <p className="text-muted-foreground text-base">Assign club moderators</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Moderator</Button>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && moderators.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No club moderators</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Moderator" to assign.' : "No moderators assigned."}</p>
          </div>
        )}

        {!loading && moderators.length > 0 && (
          <div className="space-y-4">
            {moderators.map((mod) => (
              <Card key={mod.memberId} className="hover:shadow-md transition-all">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {mod.profilePhoto ? (
                        <img src={getPhotoUrl(mod.profilePhoto)} alt={mod.memberName} className="w-12 h-12 rounded-full object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">{mod.memberName?.charAt(0)}</div>
                      )}
                      <div>
                        <p className="font-semibold text-base">{mod.memberName}</p>
                        <p className="text-sm text-muted-foreground">{mod.mobile} | {mod.email}</p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(mod)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(mod)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mod.clubs.map((c) => (
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
              <DialogTitle>{editing ? "Edit Club Moderator" : "Add Club Moderator"}</DialogTitle>
              <DialogDescription>{editing ? "Update assigned clubs." : "Search a member and assign clubs."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Member Search */}
              {(
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
                      <p className="text-sm text-amber-600 mt-1">No members found.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Selected Member */}
              {formMemberId && (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  {formMemberPhoto ? (
                    <img src={getPhotoUrl(formMemberPhoto)} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{formMemberName?.charAt(0)}</div>
                  )}
                  <div>
                    <p className="font-medium text-sm text-green-800">{formMemberName}</p>
                    <p className="text-xs text-green-600">Selected as moderator</p>
                  </div>
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
              <Button onClick={handleSave} disabled={saving || !formMemberId || formSelectedClubIds.size === 0}>
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Remove Moderator</DialogTitle>
              <DialogDescription>Remove {deleteTarget?.memberName} as club moderator? All club assignments will be removed and a removal email will be sent.</DialogDescription>
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
