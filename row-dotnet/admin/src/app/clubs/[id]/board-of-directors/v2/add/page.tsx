"use client";

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

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { User, Search, UserCircle, Award, Calendar, UserPlus, Info } from "lucide-react";
import {
  getClub,
  getDesignations,
  getRotaryYears,
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

function FieldLabel({
  children, hint, dot, required = false,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children, allowOverflow = false,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode; allowOverflow?: boolean }) {
  // NOTE: When `allowOverflow` is true, we drop `overflow-hidden` on the outer
  // wrapper so an absolutely-positioned popover (e.g. member-search dropdown)
  // can escape the card. We compensate by rounding the header's top corners
  // explicitly so the gradient still hugs the rounded card.
  return (
    <div className={`rounded-xl border border-slate-200 mb-4 ${allowOverflow ? "" : "overflow-hidden"}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 ${allowOverflow ? "rounded-t-xl" : ""}`}>
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

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
  const pastYearSelected = !!selectedYear && new Date(selectedYear.endDate) < new Date();

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
          <RotaryLoader size="lg" />
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
        <SectionCard number={1} icon={UserCircle} title="Board Member" dot="bg-blue-600" allowOverflow>
          {/* Person-type toggle — "Non-member" is only selectable for PAST rotary years. */}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 mb-3">
            <button
              type="button"
              onClick={() => setPersonType("member")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${personType === "member" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Existing member
            </button>
            <button
              type="button"
              disabled={!pastYearSelected}
              onClick={() => { if (pastYearSelected) setPersonType("nonmember"); }}
              title={!pastYearSelected ? "Select a past Rotary year below to add a non-member" : undefined}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                personType === "nonmember"
                  ? "bg-white text-blue-700 shadow-sm"
                  : pastYearSelected
                    ? "text-slate-500 hover:text-slate-700"
                    : "text-slate-300 cursor-not-allowed"
              }`}
            >
              Non-member
            </button>
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
                <FieldLabel dot="bg-blue-500" required>Name</FieldLabel>
                <input
                  type="text"
                  placeholder="Full name"
                  value={nonMemberName}
                  onChange={(e) => setNonMemberName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500" required>Mobile Number</FieldLabel>
                <input
                  type="tel"
                  placeholder="Mobile number"
                  value={nonMemberMobile}
                  onChange={(e) => setNonMemberMobile(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500" required>Email</FieldLabel>
                <input
                  type="email"
                  placeholder="Email address"
                  value={nonMemberEmail}
                  onChange={(e) => setNonMemberEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ) : (
          <>
          <FieldLabel dot="bg-blue-500" required>Club Member</FieldLabel>
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
              <button
                type="button"
                onClick={() => { setSelectedMemberId(null); setSelectedMemberName(""); setSelectedMemberPhoto(null); }}
                className="text-xs font-medium px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search club members…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <RotaryLoader size="sm" />
                </div>
              )}
              {showResults && memberResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-md">
                  {memberResults.map((m) => {
                    const photoUrl = getPhotoUrl(m.profilePhotoPath);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-blue-50 text-left transition-colors"
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
                      </button>
                    );
                  })}
                </div>
              )}
              {showResults && memberResults.length === 0 && memberSearch.trim() && !searchLoading && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-md">
                  No members found
                </div>
              )}
            </div>
          )}
          </>
          )}
        </SectionCard>

        {/* 2. Designation */}
        <SectionCard number={2} icon={Award} title="Designation" dot="bg-amber-600">
          <FieldLabel dot="bg-amber-500" required>Designation</FieldLabel>
          <select
            value={selectedDesignationId}
            onChange={(e) => setSelectedDesignationId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select a designation</option>
            {designations.map((d) => (
              <option key={d.id} value={String(d.id)}>{d.designationName}</option>
            ))}
          </select>
          {isOtherDesignation && (
            <div className="mt-3">
              <FieldLabel dot="bg-amber-500" required>Designation name</FieldLabel>
              <input
                type="text"
                placeholder="Enter the designation name"
                value={customDesignation}
                maxLength={150}
                onChange={(e) => setCustomDesignation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </SectionCard>

        {/* 3. Rotary Year */}
        <SectionCard number={3} icon={Calendar} title="Rotary Year" dot="bg-emerald-600">
          <FieldLabel dot="bg-emerald-500" required>Rotary Year</FieldLabel>
          <select
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select a year</option>
            {allYears.map((y) => (
              <option key={y.id} value={String(y.id)}>
                {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
              </option>
            ))}
          </select>
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
