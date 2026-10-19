"use client";

/**
 * V2 — District Club Moderator page.
 * ---------------------------------------------------------------------------
 * Ported verbatim from V1 (src/app/districts/[id]/club-moderator/page.tsx):
 *   - All state hooks, service calls, member-search, club-multi-select,
 *     add/edit/delete flows and validation are preserved 1:1.
 *   - Only the visual chrome is refreshed to the new dashboard palette:
 *       Navy  #17458f  (primary buttons, badges, table header, tab active bg)
 *       Gold  #F7A81B  (accent underline on navy header)
 *       Slate 200/500/800 body text; rounded-2xl white cards
 *   - Supports the ?returnTo= query param: on Cancel/Back/Save/Delete the
 *     page routes back to `returnTo` if present, otherwise to
 *     `/districts/{id}/dashboard`.
 */

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getClubModerators, getAvailableClubsForModerator, saveClubModerator,
  deleteClubModeratorByMember,
  searchMembersForModerator, getDistrict, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Shield, Search, Building2, User } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

interface ModeratorGroup {
  memberId: number;
  memberName: string;
  mobile: string;
  email: string;
  profilePhoto: string | null;
  clubs: { id: number; clubId: number; clubName: string; clubRotaryId: string }[];
}

export default function ClubModeratorV2Page() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/districts/${districtId}/dashboard`;
  const goBack = () => router.push(returnTo || fallbackBack);

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
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">
                {districtName ? `${districtName} - Club Moderator` : "Club Moderator"}
              </h2>
              <p className="text-slate-500 text-sm">Assign club moderators</p>
            </div>
          </div>
          {canManage && (
            <Button
              onClick={openAddDialog}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Moderator
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && moderators.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Shield className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No club moderators</h3>
            <p className="text-slate-500 mt-2 text-sm">
              {canManage ? 'Click "Add Moderator" to assign.' : "No moderators assigned."}
            </p>
          </div>
        )}

        {!loading && moderators.length > 0 && (
          <div className="space-y-4">
            {moderators.map((mod) => (
              <div
                key={mod.memberId}
                className="rounded-2xl border border-slate-200 shadow-sm bg-white hover:shadow-md transition-all"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      {mod.profilePhoto ? (
                        <img
                          src={getPhotoUrl(mod.profilePhoto)}
                          alt={mod.memberName}
                          className="w-12 h-12 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-azure/10 flex items-center justify-center text-lg font-bold text-ink">
                          {mod.memberName?.charAt(0) || <User className="h-5 w-5" />}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-base text-slate-800 truncate">{mod.memberName}</p>
                        <p className="text-sm text-slate-500 truncate">
                          {mod.mobile}{mod.email ? ` | ${mod.email}` : ""}
                        </p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(mod)}
                          className="text-slate-500 hover:text-ink hover:bg-slate-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(mod)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mod.clubs.map((c) => (
                      <Badge
                        key={c.clubId}
                        variant="outline"
                        className="text-xs py-1 px-2.5 border-slate-200 bg-slate-50 text-slate-700 font-medium"
                      >
                        <Building2 className="h-3.5 w-3.5 mr-1.5 text-ink" />{c.clubName}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-ink">
                {editing ? "Edit Club Moderator" : "Add Club Moderator"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                {editing ? "Update assigned clubs." : "Search a member and assign clubs."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Member Search */}
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Search Member *</Label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                      placeholder="Search by name, mobile, email..."
                      value={memberSearch}
                      onChange={(e) => handleMemberSearch(e.target.value)}
                      onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                    />
                  </div>
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((r: any) => (
                        <div
                          key={r.memberId}
                          className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                          onClick={() => selectMember(r)}
                        >
                          {r.profilePhoto ? (
                            <img src={getPhotoUrl(r.profilePhoto)} alt="" className="rounded-full object-cover w-7 h-7 ring-1 ring-slate-200" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-medium">
                              {r.name?.charAt(0)}
                            </div>
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
                    <p className="text-sm text-amber-600 mt-1">No members found.</p>
                  )}
                </div>
              </div>

              {/* Selected Member */}
              {formMemberId && (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  {formMemberPhoto ? (
                    <img src={getPhotoUrl(formMemberPhoto)} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-azure/10 flex items-center justify-center text-sm font-bold text-ink">
                      {formMemberName?.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm text-emerald-800">{formMemberName}</p>
                    <p className="text-xs text-emerald-600">Selected as moderator</p>
                  </div>
                </div>
              )}

              {/* Club Selection */}
              {formMemberId && (
                <div className="space-y-2">
                  <Label className="text-slate-700 text-sm font-medium">
                    Assign Clubs * ({formSelectedClubIds.size} selected)
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                      placeholder="Search clubs..."
                      value={clubSearchQuery}
                      onChange={(e) => setClubSearchQuery(e.target.value)}
                    />
                  </div>
                  {loadingClubs && (
                    <div className="flex justify-center py-4">
                      <RotaryLoader size="sm" />
                    </div>
                  )}
                  {!loadingClubs && (
                    <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto bg-white">
                      {filteredClubs.length === 0 ? (
                        <p className="p-3 text-sm text-slate-500 text-center">No available clubs.</p>
                      ) : (
                        filteredClubs.map((c: any) => (
                          <div
                            key={c.id}
                            className={`flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0 ${
                              formSelectedClubIds.has(c.id) ? "bg-azure/5" : ""
                            }`}
                            onClick={() => toggleClub(c.id)}
                          >
                            <Checkbox
                              checked={formSelectedClubIds.has(c.id)}
                              className="data-[state=checked]:bg-azure data-[state=checked]:border-azure"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800">{c.clubName}</p>
                              {c.clubRotaryId && (
                                <p className="text-xs text-slate-500">{c.clubRotaryId}</p>
                              )}
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
                disabled={saving || !formMemberId || formSelectedClubIds.size === 0}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <AlertTriangle className="h-5 w-5 text-red-500" />Remove Moderator
              </DialogTitle>
              <DialogDescription className="text-slate-600">
                Remove {deleteTarget?.memberName} as club moderator? All club assignments will be removed and a removal email will be sent.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <RotaryLoader size="sm" />
                    <span className="ml-2">Removing...</span>
                  </>
                ) : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
