"use client";
import { MenuItemButton, ToggleButton } from "@/components/ui/text-buttons";

/**
 * Board of Directors v2 — Add Board Director.
 *
 * Extracted from the v1 inline AddBoardMemberDialog in
 * `app/clubs/[id]/board-of-directors/page.tsx`. Every field, every API call,
 * every validation rule is preserved verbatim. Only the visual presentation
 * differs (V2FormShell wrapper, dot-accented section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { User, Search, UserCircle, Award, Calendar, UserPlus, Info } from "@/components/icons";
import {
  getClub,
  getDesignations,
  getRotaryYears,
  getBoardDirectorRules,
  createBoardDirector,
  searchBoardMembers,
  getPhotoUrl,
} from "@/services/api";
import { Designation } from "@/types/boardDirector";
import { ClubMemberSearchResult } from "@/types/pastPresident";
import { RotaryYear } from "@/types/rotaryYear";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function BoardOfDirectorsV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/board-of-directors/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [designations, setDesignations] = useState<Designation[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  // OMS ROW-51: the test district may also add non-members for the current year.
  const [nonMemberCurrentYear, setNonMemberCurrentYear] = useState(false);
  useEffect(() => {
    getBoardDirectorRules(clubId).then((r) => setNonMemberCurrentYear(!!r.nonMemberCurrentYear)).catch(() => {});
  }, [clubId]);

  // Form fields
  // personType decides which path is saved: an existing member, or (past years only)
  // a free-text non-member captured by Name + Mobile + Email — kept separate from members.
  const [personType, setPersonType] = useState<"member" | "nonmember">("member");
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState("");
  const [selectedMemberPhoto, setSelectedMemberPhoto] = useState<string | null>(null);
  const [nonMemberName, setNonMemberName] = useState("");
  const [nonMemberMobile, setNonMemberMobile] = useState("");
  const [nonMemberEmail, setNonMemberEmail] = useState("");
  const [selectedDesignationId, setSelectedDesignationId] = useState<string>("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // "Other" designation => a free-text designation name is required.
  const isOtherDesignation =
    designations.find((d) => String(d.id) === selectedDesignationId)?.designationName === "Other";

  // Member search
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<ClubMemberSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, des, yrs] = await Promise.all([
          getClub(clubId),
          getDesignations(),
          getRotaryYears(),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setDesignations(des);
        setAllYears(yrs);
        // Default-select current year if available
        const current = yrs.find((y) => y.isCurrent);
        if (current) setSelectedYearId(String(current.id));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  // Member search with debounce — matches the v1 dialog behaviour exactly.
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

  // Non-member entries are allowed ONLY for past rotary years (endDate < today).
  const selectedYear = allYears.find((y) => String(y.id) === selectedYearId);
  const pastYearSelected = !!selectedYear && (new Date(selectedYear.endDate) < new Date()
    || (nonMemberCurrentYear && new Date(selectedYear.startDate) <= new Date()));

  // If the user switches to a current/future year while in non-member mode, snap back to member.
  useEffect(() => {
    if (personType === "nonmember" && !pastYearSelected) setPersonType("member");
  }, [personType, pastYearSelected]);

  const handleSelectMember = (member: ClubMemberSearchResult) => {
    setSelectedMemberId(member.id);
    setSelectedMemberName(member.memberName);
    setSelectedMemberPhoto(member.profilePhotoPath);
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  };

  const handleSave = async () => {
    if (!selectedDesignationId) { setErrorMessage("Please select a designation."); return; }
    if (isOtherDesignation && !customDesignation.trim()) { setErrorMessage("Please enter the designation name for \"Other\"."); return; }
    if (!selectedYearId) { setErrorMessage("Please select a rotary year."); return; }

    const isNonMember = personType === "nonmember";
    if (isNonMember) {
      if (!pastYearSelected) { setErrorMessage("Non-member board members can only be added for past rotary years."); return; }
      if (!nonMemberName.trim() || !nonMemberMobile.trim() || !nonMemberEmail.trim()) {
        setErrorMessage("Non-member entries require Name, Mobile, and Email."); return;
      }
    } else {
      if (!selectedMemberId) { setErrorMessage("Please select a member."); return; }
    }

    setSaving(true);
    try {
      await createBoardDirector(clubId, {
        memberId: isNonMember ? null : selectedMemberId,
        nonMemberName: isNonMember ? nonMemberName.trim() : null,
        nonMemberMobile: isNonMember ? nonMemberMobile.trim() : null,
        nonMemberEmail: isNonMember ? nonMemberEmail.trim() : null,
        designationId: Number(selectedDesignationId),
        customDesignation: isOtherDesignation ? customDesignation.trim() : null,
        yearId: Number(selectedYearId),
      });
      setSuccessMessage("Board director added successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      // API may return 400 with { message } for CP/CS uniqueness or other rules.
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

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Board Member"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <V2FormShell
        title="Add Board Director"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/board-of-directors/v2`}
        saving={saving}
        saveLabel="Save Board Director"
        onSave={handleSave}
      >
        {/* 1. Member / Non-Member */}
        {/* allowOverflow: lets the absolute search-results popover escape
            the card's rounded clip so the dropdown is visible. */}
        <SectionCard number={1} icon={UserCircle} title="Board Member">
          {/* Person-type toggle — "Non-member" is only selectable for PAST rotary years. */}
          <div role="group" aria-label="Person type" className="flex flex-wrap gap-2 mb-3">
            <ToggleButton pressed={personType === "member"}
              type="button"
              onClick={() => setPersonType("member")}
            >
              Existing member
            </ToggleButton>
            <ToggleButton pressed={personType === "nonmember"} className="disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              disabled={!pastYearSelected}
              onClick={() => { if (pastYearSelected) setPersonType("nonmember"); }}
              title={!pastYearSelected ? "Select a past Rotary year below to add a non-member" : undefined}
            >
              Non-member
            </ToggleButton>
          </div>
          {!pastYearSelected && (
            <div className="flex items-start gap-2 mb-3 text-[11px] text-slate-500">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>Non-member entries are for past years only. Choose a past Rotary year below to enable them.</span>
            </div>
          )}

          {personType === "nonmember" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                <UserPlus className="h-3.5 w-3.5 text-slate-400" />
                Enter the details of a person who is not in the system. All three fields are required.
              </div>
              <div>
                <FieldLabel required>Name</FieldLabel>
                <Input
                  type="text"
                  placeholder="Full name"
                  value={nonMemberName}
                  onChange={(e) => setNonMemberName(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Mobile Number</FieldLabel>
                <Input
                  type="tel"
                  placeholder="Mobile number"
                  value={nonMemberMobile}
                  onChange={(e) => setNonMemberMobile(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Email</FieldLabel>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={nonMemberEmail}
                  onChange={(e) => setNonMemberEmail(e.target.value)}
                />
              </div>
            </div>
          ) : (
          <>
          <FieldLabel required>Club Member</FieldLabel>
          {selectedMemberId ? (
            <div className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-blue-50/50">
              <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
                {selectedMemberPhoto ? (
                  <Image src={getPhotoUrl(selectedMemberPhoto)} alt={selectedMemberName} fill className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-blue-100 text-blue-700">
                    <User className="h-5 w-5" />
                  </div>
                )}
              </div>
              <span className="font-medium text-sm flex-1 text-slate-800">{selectedMemberName}</span>
              <Button
                type="button"
                onClick={() => { setSelectedMemberId(null); setSelectedMemberName(""); setSelectedMemberPhoto(null); }}
                variant="outline" size="sm"
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search club members…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="pl-9 pr-3"
                autoFocus
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <RotaryLoader size="sm" />
                </div>
              )}
              {showResults && memberResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-card shadow-md">
                  {memberResults.map((m) => {
                    const photoUrl = getPhotoUrl(m.profilePhotoPath);
                    return (
                      <MenuItemButton
                        key={m.id}
                        type="button"

                        onClick={() => handleSelectMember(m)}
                      >
                        <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
                          {photoUrl ? (
                            <Image src={photoUrl} alt={m.memberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-blue-50 text-blue-700">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-medium text-slate-800">{m.memberName}</span>
                      </MenuItemButton>
                    );
                  })}
                </div>
              )}
              {showResults && memberResults.length === 0 && memberSearch.trim() && !searchLoading && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-card p-3 text-sm text-slate-500 shadow-md">
                  No members found
                </div>
              )}
            </div>
          )}
          </>
          )}
        </SectionCard>

        {/* 2. Designation */}
        <SectionCard number={2} icon={Award} title="Designation">
          <FieldLabel required>Designation</FieldLabel>
          <NativeSelect
            value={selectedDesignationId}
            onChange={(e) => setSelectedDesignationId(e.target.value)}
          >
            <option value="">Select a designation</option>
            {designations.map((d) => (
              <option key={d.id} value={String(d.id)}>{d.designationName}</option>
            ))}
          </NativeSelect>
          {isOtherDesignation && (
            <div className="mt-3">
              <FieldLabel required>Designation name</FieldLabel>
              <Input
                type="text"
                placeholder="Enter the designation name"
                value={customDesignation}
                maxLength={150}
                onChange={(e) => setCustomDesignation(e.target.value)}
              />
            </div>
          )}
        </SectionCard>

        {/* 3. Rotary Year */}
        <SectionCard number={3} icon={Calendar} title="Rotary Year">
          <FieldLabel required>Rotary Year</FieldLabel>
          <NativeSelect
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
          >
            <option value="">Select a year</option>
            {allYears.map((y) => (
              <option key={y.id} value={String(y.id)}>
                {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
              </option>
            ))}
          </NativeSelect>
        </SectionCard>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Board director added successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
