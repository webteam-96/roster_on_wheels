"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClubMemberItem } from "@/types/club";
import { PagedResult } from "@/types/member";
import { getClub, getClubMembers, getClubMemberYears, removeClubMember, getPhotoUrl, assignRole, removeRole, getMemberRemovalPreview, getDistricts, getRotaryYears, updateCogDesignation, getRiCodes } from "@/services/api";
import { MemberRemovalPreview } from "@/types/memberRemoval";
import { formatDMY } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import Pagination from "@/components/Pagination";
import MemberRemovalDialog from "@/components/MemberRemovalDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Search, User, Users, Plus, MoreVertical, MoreHorizontal, Pencil, Trash2, ShieldCheck, ShieldOff, Mail, Phone, IdCard, Calendar, LayoutGrid, List, X, MapPin } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import MemberDetailDialog from "@/components/MemberDetailDialog";
import SearchableCombo from "@/components/SearchableCombo";

export default function ClubMembersPage() {
  const params = useParams();
  const clubId = Number(params.id);
  // Preserve the current URL's districtId + returnTo so the back button to the
  // club dashboard keeps the chain intact (e.g. Global Search → Dashboard →
  // Directory → back → Dashboard → back → Global Search).
  const searchParams = useSearchParams();
  const dashboardBackQs = (() => {
    const p = new URLSearchParams();
    const dId = searchParams.get("districtId");
    const rt = searchParams.get("returnTo");
    if (dId) p.set("districtId", dId);
    if (rt) p.set("returnTo", rt);
    const q = p.toString();
    return q ? `?${q}` : "";
  })();
  const { isSuperAdmin } = useAuth();
  const [clubName, setClubName] = useState("");
  const [, setDistrictId] = useState<number | null>(null);
  const [data, setData] = useState<PagedResult<ClubMemberItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: number; name: string } | null>(null);
  const [removalPreview, setRemovalPreview] = useState<MemberRemovalPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // RI termination reasons (build spec 3.12) for the removal dialog
  const [terminationReasons, setTerminationReasons] = useState<{ code: string; label: string }[]>([]);
  const [reasonCode, setReasonCode] = useState("");
  useEffect(() => {
    getRiCodes().then((c) => setTerminationReasons(c.filter((x) => x.kind === "termination_reason"))).catch(() => {});
  }, []);
  const [roleLoading, setRoleLoading] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);

  // COG (club 31598) — past-District-Governor roster. The generic search box
  // above only matches name + mobile; these extra fields are exact, dedicated
  // filters (see ClubService.GetMembersAsync) so a district-number lookup
  // can't collide with an unrelated Rotary ID or mobile number substring.
  const isCog = clubId === 31598;
  // COG's Edit goes to the v2 member form — that's the only edit form carrying the
  // District/Year pickers that replace COG's (meaningless) Date of Joining. Every
  // other club keeps the v1 route it has always used.
  const editHref = (memberId: number) =>
    isCog ? `/members/edit-v2/${memberId}?clubId=${clubId}` : `/members/edit/${memberId}?clubId=${clubId}`;
  const [filterEmail, setFilterEmail] = useState("");
  const [filterRotaryId, setFilterRotaryId] = useState("");
  const [filterDistrictNumber, setFilterDistrictNumber] = useState("");
  const [filterDesignation, setFilterDesignation] = useState("");
  const [filterClassification, setFilterClassification] = useState("");
  const [filterFamilyMemberName, setFilterFamilyMemberName] = useState("");
  const [filterYear, setFilterYear] = useState<string>("");
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  // Option lists for the COG district/year pickers. District numbers come from
  // district_master, Rotary years from rotary_year_master (labels like "2025-26";
  // a few legacy rows are malformed, so only well-formed labels are offered).
  const [districtNumbers, setDistrictNumbers] = useState<string[]>([]);
  const [rotaryYearLabels, setRotaryYearLabels] = useState<string[]>([]);

  // SuperAdmin "Set District & Year" dialog (COG only).
  const [cogEditTarget, setCogEditTarget] = useState<ClubMemberItem | null>(null);
  const [cogEditDistrict, setCogEditDistrict] = useState("");
  const [cogEditYear, setCogEditYear] = useState("");
  const [cogSaving, setCogSaving] = useState(false);

  useEffect(() => {
    async function fetchClub() {
      try {
        const c = await getClub(clubId);
        setClubName(c.clubName);
        setDistrictId(c.fkDistrictId);
      } catch { /* ignore */ }
    }
    fetchClub();
  }, [clubId]);

  useEffect(() => {
    if (!isCog) return;
    getClubMemberYears(clubId).then(setAvailableYears).catch(() => {});
    getDistricts(1, 400)
      .then((d) => setDistrictNumbers(
        Array.from(new Set(d.items.map((x) => (x.districtNumber ?? "").trim()).filter((x) => /^\d{3,5}$/.test(x))))
          .sort((a, b) => Number(a) - Number(b))
      ))
      .catch(() => {});
    getRotaryYears()
      .then((y) => setRotaryYearLabels(
        y.map((x) => x.yearLabel).filter((l) => /^\d{4}-\d{2}$/.test(l)).sort((a, b) => b.localeCompare(a))
      ))
      .catch(() => {});
  }, [isCog, clubId]);

  // COG advanced-filter values, packaged for getClubMembers — undefined (not
  // just falsy) when not the COG club, so other clubs' requests are unaffected.
  const cogFilterOptions = useCallback(() => (
    isCog
      ? {
          year: filterYear ? Number(filterYear) : undefined,
          email: filterEmail || undefined,
          rotaryId: filterRotaryId || undefined,
          districtNumber: filterDistrictNumber || undefined,
          designation: filterDesignation || undefined,
          classification: filterClassification || undefined,
          familyMemberName: filterFamilyMemberName || undefined,
        }
      : undefined
  ), [isCog, filterYear, filterEmail, filterRotaryId, filterDistrictNumber, filterDesignation, filterClassification, filterFamilyMemberName]);

  const fetchMembers = useCallback(async (pageNum?: number) => {
    setLoading(true);
    try {
      const result = await getClubMembers(clubId, pageNum || page, 20, search || undefined, cogFilterOptions());
      setData(result);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [clubId, page, search, cogFilterOptions]);

  // Load members on page load
  useEffect(() => { fetchMembers(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchMembers(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    getClubMembers(clubId, newPage, 20, search || undefined, cogFilterOptions())
      .then(result => setData(result))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // When a member is selected for removal, fetch the impact preview to show in the dialog.
  useEffect(() => {
    if (!removeTarget) {
      setRemovalPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      setRemovalPreview(null);
      try {
        const preview = await getMemberRemovalPreview(clubId, removeTarget.id);
        if (!cancelled) setRemovalPreview(preview);
      } catch {
        if (!cancelled) {
          setErrorMessage("Failed to load removal preview.");
          setRemoveTarget(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [removeTarget, clubId]);

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    const wasLast = removalPreview?.isLastClub === true;
    try {
      await removeClubMember(clubId, removeTarget.id, undefined, reasonCode || undefined);
      setReasonCode("");
      const name = removeTarget.name;
      setRemoveTarget(null);
      setRemovalPreview(null);
      setSuccessMessage(wasLast
        ? `${name} fully removed (login disabled, all roles revoked).`
        : `${name} removed from club. Other club memberships kept.`);
      fetchMembers();
    } catch {
      setRemoveTarget(null);
      setRemovalPreview(null);
      setErrorMessage("Failed to remove member.");
    }
  };

  const handleMakeAdmin = async (memberId: number, memberName: string) => {
    setRoleLoading(memberId);
    try {
      await assignRole({ memberId, roleId: 2, clubId });
      setSuccessMessage(`${memberName} has been made Admin.`);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to assign Admin role.");
    } finally {
      setRoleLoading(null);
    }
  };

  // COG only. Opens the dialog pre-filled with whatever the member's current
  // designation parses to (blank when the label isn't year-structured).
  const openCogEdit = (member: ClubMemberItem) => {
    setCogEditTarget(member);
    setCogEditDistrict(member.cogDistrictNumber || "");
    setCogEditYear(member.cogYear || "");
  };

  const handleSaveCogDesignation = async () => {
    if (!cogEditTarget || !cogEditDistrict || !cogEditYear) return;
    setCogSaving(true);
    try {
      await updateCogDesignation(clubId, cogEditTarget.id, { districtNumber: cogEditDistrict, yearLabel: cogEditYear });
      const name = cogEditTarget.memberName;
      setCogEditTarget(null);
      setSuccessMessage(`${name}: district ${cogEditDistrict}, year ${cogEditYear} saved.`);
      // Year list is derived from the stored designations — refresh it too.
      getClubMemberYears(clubId).then(setAvailableYears).catch(() => {});
      fetchMembers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMessage(axiosErr?.response?.data?.message || "Failed to save district and year.");
    } finally {
      setCogSaving(false);
    }
  };

  const handleRemoveAdmin = async (memberId: number, memberName: string) => {
    setRoleLoading(memberId);
    try {
      await removeRole({ memberId, roleId: 2, clubId });
      setSuccessMessage(`Admin role removed from ${memberName}.`);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to remove Admin role.");
    } finally {
      setRoleLoading(null);
    }
  };

  const filteredMembers = (data?.items || []).filter((member) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      member.memberName?.toLowerCase().includes(q) ||
      member.emailId?.toLowerCase().includes(q) ||
      member.primaryMobileNumber?.toLowerCase().includes(q) ||
      member.rotaryId?.toLowerCase().includes(q) ||
      String(member.id).includes(q) ||
      member.roles?.some(r => r.toLowerCase().includes(q))
    );
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/dashboard${dashboardBackQs}`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{clubName} - Members</h2>
              <p className="text-muted-foreground text-base">
                {isCog ? "Search by name or mobile number. Use Advanced Filters below for everything else" : "Search by member name, email, or Rotary ID"}
              </p>
              {data && (data.memberCount != null || data.honoraryCount != null) && (
                <div className="mt-1 flex items-center gap-3 text-sm">
                  <span className="font-medium text-slate-700">Members: {data.memberCount ?? 0}</span>
                  <span className="text-amber-600">Honorary: {data.honoraryCount ?? 0}</span>
                </div>
              )}
            </div>
          </div>
          {isSuperAdmin && (
            <Button asChild>
              <Link href={`/members/new?clubId=${clubId}`}><Plus className="mr-2 h-4 w-4" />Add Member</Link>
            </Button>
          )}
        </div>

        {/* Search bar + View toggle */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input placeholder={isCog ? "Search by member name or mobile number..." : "Search by member name, email, or Rotary ID..."} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleKeyDown} className="pl-9 border-primary/30 focus:border-primary text-base" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSearch} size="sm">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>

            {search && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); }}>
                <X className="mr-1 h-4 w-4" />Clear
              </Button>
            )}

            <div className="flex items-center rounded-md border ml-auto">
              <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("table")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Advanced filters — COG (club 31598) only. Each field targets one
            exact column server-side instead of the fuzzy multi-field search
            box above, so a district-number lookup can't collide with an
            unrelated Rotary ID/mobile-number substring. */}
        {isCog && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 bg-muted/30 p-4 rounded-lg border">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input value={filterEmail} onChange={(e) => setFilterEmail(e.target.value)} onKeyDown={handleKeyDown} placeholder="Email" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Rotary ID</label>
              <Input value={filterRotaryId} onChange={(e) => setFilterRotaryId(e.target.value)} onKeyDown={handleKeyDown} placeholder="Rotary ID" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">District Number</label>
              <SearchableCombo
                value={filterDistrictNumber}
                onChange={setFilterDistrictNumber}
                options={districtNumbers.map((d) => ({ value: d, label: d }))}
                placeholder="All districts"
                searchPlaceholder="Type a district number…"
                emptyText="No district found."
                allowClear
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Designation</label>
              <Input value={filterDesignation} onChange={(e) => setFilterDesignation(e.target.value)} onKeyDown={handleKeyDown} placeholder="Designation" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Classification</label>
              <Input value={filterClassification} onChange={(e) => setFilterClassification(e.target.value)} onKeyDown={handleKeyDown} placeholder="Classification" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Family Member Name</label>
              <Input value={filterFamilyMemberName} onChange={(e) => setFilterFamilyMemberName(e.target.value)} onKeyDown={handleKeyDown} placeholder="Family member name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Year</label>
              {/* Values are the Rotary-year START year (what the API filters on);
                  the label shows the full "2025-26" span. */}
              <SearchableCombo
                value={filterYear}
                onChange={setFilterYear}
                options={availableYears.map((y) => ({ value: String(y), label: `${y}-${String((y + 1) % 100).padStart(2, "0")}` }))}
                placeholder="All years"
                searchPlaceholder="Type a year…"
                emptyText="No year found."
                allowClear
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch} size="sm" className="w-full">
                <Search className="mr-2 h-4 w-4" />Apply Filters
              </Button>
              {(filterEmail || filterRotaryId || filterDistrictNumber || filterDesignation || filterClassification || filterFamilyMemberName || filterYear) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    setFilterEmail(""); setFilterRotaryId(""); setFilterDistrictNumber("");
                    setFilterDesignation(""); setFilterClassification(""); setFilterFamilyMemberName(""); setFilterYear("");
                    setPage(1);
                    // Fetch directly with explicit empty filters — state setters
                    // above haven't re-rendered yet, so fetchMembers()'s
                    // cogFilterOptions() would still see the OLD values if called
                    // synchronously here.
                    setLoading(true);
                    try {
                      const result = await getClubMembers(clubId, 1, 20, search || undefined);
                      setData(result);
                    } catch { /* ignore */ }
                    finally { setLoading(false); }
                  }}
                >
                  <X className="mr-1 h-4 w-4" />Clear
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Quick filter */}
        {!loading && data && data.items.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Quick filter by name, email, mobile, Rotary ID..."
            className="max-w-md"
          />
        )}

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && data && data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No members found</h3>
            <p className="text-muted-foreground mt-2">Try a different search term.</p>
          </div>
        )}

        {!loading && data && filteredMembers.length === 0 && searchQuery && data.items.length > 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No members match your filter &quot;{searchQuery}&quot;. Try a different term.</p>
          </div>
        )}

        {!loading && data && filteredMembers.length > 0 && (
          <>
            {viewMode === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredMembers.map((member) => {
                  const photoUrl = getPhotoUrl(member.profilePhotoPath);
                  return (
                    <Card key={member.id} className={`overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group relative ${roleLoading === member.id ? "opacity-60 pointer-events-none" : ""}`} onClick={() => setDetailMemberId(member.id)}>
                      {roleLoading === member.id && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 rounded-lg">
                          <RotaryLoader size="sm" />
                        </div>
                      )}
                      <CardContent className="p-0">
                        <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
                          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white">
                                <User className="h-8 w-8" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Long names previously truncated, pushing the 3-dot menu off-screen on
                                narrow viewports. Now the name wraps to multiple lines (break-words +
                                leading-snug) and the 3-dot menu is flex-shrink-0 + self-start so it
                                stays anchored top-right even when the name takes 2-3 lines. */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base text-white break-words leading-snug">{member.memberName}</h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {(() => {
                                    const displayRoles = member.roles?.filter(r => !(r === "Member" && member.roles.some(x => x === "Admin" || x === "Club Admin" || x === "District Admin" || x === "SuperAdmin")));
                                    return displayRoles && displayRoles.length > 0 ? displayRoles.map((role) => (
                                      <Badge key={role} className="text-xs bg-white/20 text-white border-white/30">{role}</Badge>
                                    )) : (
                                      <Badge className="text-xs bg-white/20 text-white border-white/30">Member</Badge>
                                    );
                                  })()}
                                </div>
                              </div>
                              {isSuperAdmin && (
                                <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0 self-start">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem asChild>
                                        <Link href={editHref(member.id)}>
                                          <Pencil className="mr-2 h-4 w-4" />Edit
                                        </Link>
                                      </DropdownMenuItem>
                                      {isCog && (
                                        <DropdownMenuItem onClick={() => openCogEdit(member)}>
                                          <MapPin className="mr-2 h-4 w-4" />Set District &amp; Year
                                        </DropdownMenuItem>
                                      )}
                                      {!member.roles?.includes("SuperAdmin") && (
                                        member.hasAdminRole ? (
                                          <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName)}>
                                            <ShieldOff className="mr-2 h-4 w-4" />Remove Admin
                                          </DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem onClick={() => handleMakeAdmin(member.id, member.memberName)}>
                                            <ShieldCheck className="mr-2 h-4 w-4" />Make Admin
                                          </DropdownMenuItem>
                                        )
                                      )}
                                      <DropdownMenuItem className="text-destructive" onClick={() => setRemoveTarget({ id: member.id, name: member.memberName })}>
                                        <Trash2 className="mr-2 h-4 w-4" />Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
                          {member.rotaryId && (
                            <div className="flex items-center gap-2">
                              <IdCard className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.rotaryId}</span>
                            </div>
                          )}
                          {member.emailId && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{member.emailId}</span>
                            </div>
                          )}
                          {member.primaryMobileNumber && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                              <span>{member.primaryMobileNumber}</span>
                            </div>
                          )}
                          {/* COG shows District + Rotary Year instead of the admission/
                              joining date — COG is a past-Governors roster, not a club
                              anyone joins, so the date was meaningless there. The API
                              already returns joinedDate as null for COG; this guard keeps
                              the intent explicit. */}
                          {isCog ? (
                            <>
                              {member.cogDistrictNumber && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                  <span>District {member.cogDistrictNumber}</span>
                                </div>
                              )}
                              {member.cogYear && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                                  <span>{member.cogYear}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            member.joinedDate && (
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                                <span>Joined {formatDMY(member.joinedDate)}</span>
                              </div>
                            )
                          )}
                          <Badge variant={member.membershipActive ? "default" : "destructive"} className="text-xs">
                            {member.membershipActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Table view */
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="w-12 text-primary-foreground"></TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Member Name</TableHead>
                      <TableHead className="hidden md:table-cell text-primary-foreground text-base font-semibold">Rotary ID</TableHead>
                      <TableHead className="hidden md:table-cell text-primary-foreground text-base font-semibold">Email</TableHead>
                      <TableHead className="hidden lg:table-cell text-primary-foreground text-base font-semibold">Phone</TableHead>
                      {isCog && <TableHead className="text-primary-foreground text-base font-semibold">District</TableHead>}
                      {isCog && <TableHead className="text-primary-foreground text-base font-semibold">Year</TableHead>}
                      <TableHead className="text-primary-foreground text-base font-semibold">Roles</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Status</TableHead>
                      <TableHead className="w-12 text-primary-foreground"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.map((member) => {
                      const photoUrl = getPhotoUrl(member.profilePhotoPath);
                      return (
                        <TableRow key={member.id} className={`hover:bg-primary/5 transition-colors cursor-pointer ${roleLoading === member.id ? "opacity-60 pointer-events-none" : ""}`} onClick={() => setDetailMemberId(member.id)}>
                          <TableCell>
                            <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                              {photoUrl ? (
                                <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                  <User className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold text-primary break-words max-w-[14rem] whitespace-normal">{member.memberName}</TableCell>
                          <TableCell className="hidden md:table-cell">{member.rotaryId || "-"}</TableCell>
                          <TableCell className="hidden md:table-cell">{member.emailId || "-"}</TableCell>
                          <TableCell className="hidden lg:table-cell">{member.primaryMobileNumber || "-"}</TableCell>
                          {isCog && <TableCell>{member.cogDistrictNumber || "-"}</TableCell>}
                          {isCog && <TableCell>{member.cogYear || "-"}</TableCell>}
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(() => {
                                const displayRoles = member.roles?.filter(r => !(r === "Member" && member.roles.some(x => x === "Admin" || x === "Club Admin" || x === "District Admin" || x === "SuperAdmin")));
                                return displayRoles && displayRoles.length > 0 ? displayRoles.map((role) => (
                                  <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>
                                )) : (
                                  <Badge variant="secondary" className="text-xs">Member</Badge>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={member.membershipActive ? "default" : "destructive"} className="text-xs">
                              {member.membershipActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {isSuperAdmin && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link href={editHref(member.id)}>
                                      <Pencil className="mr-2 h-4 w-4" />Edit
                                    </Link>
                                  </DropdownMenuItem>
                                  {isCog && (
                                    <DropdownMenuItem onClick={() => openCogEdit(member)}>
                                      <MapPin className="mr-2 h-4 w-4" />Set District &amp; Year
                                    </DropdownMenuItem>
                                  )}
                                  {member.hasAdminRole ? (
                                    <DropdownMenuItem onClick={() => handleRemoveAdmin(member.id, member.memberName)}>
                                      <ShieldOff className="mr-2 h-4 w-4" />Remove Admin
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem onClick={() => handleMakeAdmin(member.id, member.memberName)}>
                                      <ShieldCheck className="mr-2 h-4 w-4" />Make Admin
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem className="text-destructive" onClick={() => setRemoveTarget({ id: member.id, name: member.memberName })}>
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} pageSize={data.pageSize} onPageChange={handlePageChange} />
          </>
        )}

        <MemberRemovalDialog
          open={!!removeTarget}
          loading={previewLoading}
          preview={removalPreview}
          onConfirm={handleRemoveMember}
          onCancel={() => setRemoveTarget(null)}
          terminationReasons={terminationReasons}
          reasonCode={reasonCode}
          onReasonCodeChange={setReasonCode}
        />
        {/* COG (club 31598) SuperAdmin editor. Saves district number + Rotary year
            back into that member's COG membership row only — the member's own club
            keeps its own designation untouched. */}
        <Dialog open={!!cogEditTarget} onOpenChange={(o) => { if (!o) setCogEditTarget(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Set District &amp; Year</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{cogEditTarget?.memberName}</p>
              <div className="space-y-2">
                <Label>District Number<span className="text-destructive ml-1">*</span></Label>
                <SearchableCombo
                  value={cogEditDistrict}
                  onChange={setCogEditDistrict}
                  options={districtNumbers.map((d) => ({ value: d, label: d }))}
                  placeholder="Select district"
                  searchPlaceholder="Type a district number…"
                  emptyText="No district found."
                />
              </div>
              <div className="space-y-2">
                <Label>Year<span className="text-destructive ml-1">*</span></Label>
                <SearchableCombo
                  value={cogEditYear}
                  onChange={setCogEditYear}
                  options={rotaryYearLabels.map((y) => ({ value: y, label: y }))}
                  placeholder="Select Rotary year"
                  searchPlaceholder="Type a year…"
                  emptyText="No year found."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCogEditTarget(null)} disabled={cogSaving}>Cancel</Button>
              <Button onClick={handleSaveCogDesignation} disabled={cogSaving || !cogEditDistrict || !cogEditYear}>
                {cogSaving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <MemberDetailDialog memberId={detailMemberId} open={detailMemberId !== null} onClose={() => setDetailMemberId(null)} />
      </div>
    </ProtectedRoute>
  );
}
