"use client";

/**
 * Assistant Governor (AG) — District Admin Dashboard route
 * ---------------------------------------------------------------------------
 * Mirror of src/app/districts/[id]/ag/v2/page.tsx (READ-ONLY source) rendered
 * inside the DA dashboard navy sidebar shell.
 *
 * Differences vs the V2 source:
 *   • districtId comes from AuthContext (selectedDistrictId) — NOT from
 *     useParams — because this route has no [id] segment.
 *   • Back button falls back to /district-admin-dashboard/membership when
 *     no ?returnTo= is supplied. ?returnTo= is still honoured verbatim.
 *
 * Everything else is preserved verbatim: year filter (data-only years for
 * listing, all years for form), 400ms debounced member search, edit-mode
 * force-include of assigned clubs, club-search filter, save reconciliation,
 * deleteAGByMember with year, permission gating (SA || Admin), palette
 * (#17458f navy, #F7A81B gold, slate typography), rounded-2xl cards, all
 * dialogs and alerts.
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getAGs, getAGYearsWithData, getRotaryYears, getAvailableClubsForAG, saveAG,
  deleteAGByMember,
  searchMembersForAG, getDistrict, getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, UserCog, Search, Building2, Calendar } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictMembershipTabBar from "@/components/dashboard/DistrictMembershipTabBar";
import type { RotaryYear } from "@/types/rotaryYear";

interface AGGroup {
  memberId: number;
  memberName: string;
  mobile: string;
  email: string;
  profilePhoto: string | null;
  clubs: { id: number; clubId: number; clubName: string; clubRotaryId: string }[];
}

interface DataYear { id: number; yearLabel: string; isCurrent: boolean }

export default function DistrictAdminAGPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = "/district-admin-dashboard/membership";
  const goBack = () => router.push(returnTo || fallbackBack);

  const { isSuperAdmin, isAdmin, selectedDistrictId } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const districtId = selectedDistrictId ?? 0;

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

  // Global year filter — the top-bar (?yearId=) is the ONLY year source
  // for this page. Whatever year is in the URL wins; we don't filter it
  // against the "years-with-data" list because the user should see an
  // empty state when picking a year that has no AGs yet.
  const urlYearId = searchParams.get("yearId");

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, dy, allYrs] = await Promise.all([
          getDistrict(districtId), getAGYearsWithData(districtId), getRotaryYears(),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        setDataYears(dy);
        setAllYears(allYrs);
        // Trust the URL. If no URL yearId, fall back to current RY, then
        // first year with AG data.
        if (urlYearId) {
          setSelectedYearId(urlYearId);
        } else {
          const cy = allYrs.find((y: any) => y.isCurrent) || dy.find((y) => y.isCurrent) || dy[0];
          setSelectedYearId(cy ? String(cy.id) : "");
        }
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  // React to top-bar year changes. Always take the URL yearId — no
  // dataYears gating; empty state is fine.
  useEffect(() => {
    if (!urlYearId) return;
    if (urlYearId !== selectedYearId) setSelectedYearId(urlYearId);
  }, [urlYearId, selectedYearId]);

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
    if (!districtId) return;
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

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <DistrictMembershipTabBar />
        {/* ── Header card ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-800">
                  {districtName ? `${districtName} - Assistant Governor (AG)` : "Assistant Governor (AG)"}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">Assign assistant governors to clubs</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Year selector removed — top-bar year (?yearId=) is the
                  single source of truth. See useEffect on urlYearId. */}
              {canManage && (
                <Button
                  onClick={openAddDialog}
                  className="bg-azure hover:bg-mint-ink text-white"
                >
                  <Plus className="mr-2 h-4 w-4" />Add AG
                </Button>
              )}
            </div>
          </div>
        </div>

        {(loading || loadingList) && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && !loadingList && agList.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <UserCog className="h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-800">No assistant governors</h3>
              <p className="text-sm text-slate-500 mt-2">{canManage ? 'Click "Add AG" to assign.' : "No assistant governors assigned."}</p>
            </div>
          </div>
        )}

        {!loading && !loadingList && agList.length > 0 && (
          <div className="space-y-3">
            {agList.map((ag) => (
              <div
                key={ag.memberId}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                      {ag.profilePhoto ? (
                        <img
                          src={getPhotoUrl(ag.profilePhoto)}
                          alt={ag.memberName}
                          className="w-12 h-12 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
                          style={{ backgroundColor: "#17458f" }}
                        >
                          {ag.memberName?.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-base text-slate-800 truncate">{ag.memberName}</p>
                        <p className="text-sm text-slate-500 truncate">{ag.mobile} | {ag.email}</p>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(ag)}
                          className="text-slate-500 hover:text-ink hover:bg-slate-100"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(ag)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ag.clubs.map((c) => (
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

        {/* ── Add/Edit Dialog ───────────────────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-slate-800">
                {editing ? "Edit Assistant Governor" : "Add Assistant Governor"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                {editing ? "Update assigned clubs." : "Search a member and assign clubs."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Rotary Year (all years) */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Rotary Year *</Label>
                <Select value={formYearId} onValueChange={handleFormYearChange}>
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

              {/* Member Search */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Search Member *</Label>
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
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((r: any) => (
                        <div
                          key={r.memberId}
                          className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                          onClick={() => selectMember(r)}
                        >
                          {r.profilePhoto ? (
                            <img src={getPhotoUrl(r.profilePhoto)} alt="" className="rounded-full object-cover w-7 h-7 ring-1 ring-slate-200" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
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
                    <img src={getPhotoUrl(formMemberPhoto)} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-emerald-200" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: "#17458f" }}
                    >
                      {formMemberName?.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm text-emerald-800">{formMemberName}</p>
                    <p className="text-xs text-emerald-600">Selected as Assistant Governor</p>
                  </div>
                </div>
              )}

              {/* Club Selection */}
              {formMemberId && (
                <div className="space-y-2">
                  <Label className="text-slate-600 text-sm">
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
                  {loadingClubs && <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>}
                  {!loadingClubs && (
                    <div className="border border-slate-200 rounded-md max-h-60 overflow-y-auto bg-white">
                      {filteredClubs.length === 0 ? (
                        <p className="p-3 text-sm text-slate-500 text-center">No available clubs.</p>
                      ) : (
                        filteredClubs.map((c: any) => (
                          <div
                            key={c.id}
                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-slate-100 last:border-b-0 transition-colors ${
                              formSelectedClubIds.has(c.id)
                                ? "bg-azure/5 hover:bg-azure/10"
                                : "hover:bg-slate-50"
                            }`}
                            onClick={() => toggleClub(c.id)}
                          >
                            <Checkbox
                              checked={formSelectedClubIds.has(c.id)}
                              className="border-slate-300 data-[state=checked]:bg-azure data-[state=checked]:border-azure"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{c.clubName}</p>
                              {c.clubRotaryId && <p className="text-xs text-slate-500">{c.clubRotaryId}</p>}
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
                className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formYearId || !formMemberId || formSelectedClubIds.size === 0}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete confirmation ───────────────────────────────────── */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <AlertTriangle className="h-5 w-5 text-red-500" />Remove Assistant Governor
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Remove {deleteTarget?.memberName} as Assistant Governor? All club assignments will be removed and a removal email will be sent.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDelete}
                disabled={deleting}
              >
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
