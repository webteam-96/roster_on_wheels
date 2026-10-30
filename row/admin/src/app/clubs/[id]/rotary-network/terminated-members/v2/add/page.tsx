"use client";

/**
 * Terminated Members v2 — Add (Terminate Member).
 *
 * Same data semantics as the v1 club-members "Remove from club" flow:
 * select an active member, confirm the impact preview, and call the same
 * `removeClubMember` API v1 uses. Per memory rule "Club termination cascade
 * rules" we do NOT redo the cascade — the backend handles BOD, district
 * committee, subgroup soft-deletes and stamps TerminationDate +
 * TerminationReason on club_members.
 *
 * Validations:
 *   - Member must be selected and currently active in this club.
 *   - Termination date cannot be in the future (UI-side check only).
 *   - Termination reason must be picked from the standard dropdown.
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import Image from "next/image";
import {
  Info, User, Search, UserMinus, Calendar, MessageSquare, AlertTriangle,
} from "@/components/icons";
import {
  getClub,
  getClubMembers,
  getMemberRemovalPreview,
  removeClubMember,
  getPhotoUrl,
} from "@/services/api";
import { ClubMemberItem } from "@/types/club";
import { MemberRemovalPreview } from "@/types/memberRemoval";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

const TOP_MESSAGE =
  "Terminating a member soft-deletes their membership for THIS club only. " +
  "Their master profile, login, and other-club memberships are preserved. " +
  "The backend stamps today's date and the reason you select below on the club_members row " +
  "and cascades to BOD, district committee, and sub-group entries for this club.";

// Standard reason list — chip colour-coded in the listing.
const TERMINATION_REASONS = [
  { value: "Lack of Participation", label: "Lack of Participation" },
  { value: "Business Relocation",   label: "Business Relocation" },
  { value: "Personal / Health",     label: "Personal / Health" },
  { value: "Transfer to Other Club", label: "Transfer to Other Club" },
  { value: "Resigned",              label: "Resigned" },
  { value: "Other",                 label: "Other" },
];

function FieldLabel({ children, hint, dot, required = true }: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
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
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function TerminatedMembersV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/rotary-network/terminated-members/v2`);

  const [clubName, setClubName] = useState("");
  const [activeMembers, setActiveMembers] = useState<ClubMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [selectedMember, setSelectedMember] = useState<ClubMemberItem | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const [terminationDate, setTerminationDate] = useState<string>(today);
  const [terminationReason, setTerminationReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Member autocomplete
  const [memberSearch, setMemberSearch] = useState("");
  const [showResults, setShowResults] = useState(false);

  // Confirmation step — fetch the same impact preview the v1 Members page uses.
  // If the preview endpoint fails (e.g. 403 for non-SuperAdmin, network blip, server
  // hiccup), we fall back to a minimal preview built from data already in hand so
  // the user can still proceed with the termination. The actual termination call
  // has its own server-side guards.
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<MemberRemovalPreview | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [club, members] = await Promise.all([
          getClub(clubId),
          // Pull a large page — we filter for currently-active members client-side.
          getClubMembers(clubId, 1, 1000),
        ]);
        setClubName(club.clubName);
        setActiveMembers((members.items as ClubMemberItem[]).filter((m) => m.membershipActive));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } | string } };
        const apiMsg =
          (typeof e.response?.data === "object" && e.response?.data?.message) ||
          (typeof e.response?.data === "string" ? e.response.data : undefined) ||
          "Failed to initialize.";
        setErrorMessage(apiMsg);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // Client-side filter on the active-member list.
  const memberResults = useMemo<ClubMemberItem[]>(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return [];
    return activeMembers
      .filter((m) =>
        (m.memberName || "").toLowerCase().includes(q) ||
        (m.rotaryId || "").toLowerCase().includes(q) ||
        (m.emailId || "").toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [memberSearch, activeMembers]);

  const handleSelectMember = useCallback((member: ClubMemberItem) => {
    setSelectedMember(member);
    setMemberSearch("");
    setShowResults(false);
  }, []);

  const clearSelectedMember = () => {
    setSelectedMember(null);
  };

  const validate = (): string | null => {
    if (!selectedMember) return "Please select a member to terminate.";
    if (!terminationDate) return "Termination date is required.";
    if (new Date(terminationDate) > new Date()) return "Termination date cannot be in the future.";
    if (!terminationReason) return "Please select a termination reason.";
    if (notes.trim().length > 1000) return "Notes must be 1000 characters or less.";
    return null;
  };

  const handleProceed = async () => {
    const err = validate();
    if (err) {
      setErrorMessage(err);
      return;
    }
    if (!selectedMember) return;
    setShowConfirm(true);
    setPreviewLoading(true);
    setPreview(null);
    setPreviewWarning(null);
    try {
      const p = await getMemberRemovalPreview(clubId, selectedMember.id);
      setPreview(p);
    } catch (err: unknown) {
      // Graceful fallback — preview is informational only; the actual termination
      // call has its own server-side guards. Surface the underlying message as
      // a warning, but build a minimal preview from data already on hand so the
      // user can still proceed.
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      const apiMsg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        "Could not load impact preview.";
      setPreviewWarning(apiMsg);
      setPreview({
        memberId: selectedMember.id,
        memberName: selectedMember.memberName,
        emailId: selectedMember.emailId || null,
        clubId,
        clubName,
        isLastClub: false,
        otherClubs: [],
        rolesInThisClub: selectedMember.roles || [],
        allRoleNames: selectedMember.roles || [],
        bodEntries: [],
        dcGroupMemberships: [],
        subGroupMemberships: [],
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmTerminate = async () => {
    if (!selectedMember) return;
    setSaving(true);
    setShowConfirm(false);
    try {
      // Single API call — same one v1 uses. Backend stamps TerminationDate
      // + TerminationReason (from the reason we pass here) and runs the full
      // cascade (BOD, DC, sub-groups).
      await removeClubMember(clubId, selectedMember.id, terminationReason);
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string } };
      const apiMsg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        "Failed to terminate member.";
      setErrorMessage(apiMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Add Terminated Member"
          pageSubtitle="Club Admin Dashboard"
          activeNavHref="/club-admin-dashboard/dashboard"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Terminated Member"
        pageSubtitle="Club Admin Dashboard"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <V2FormShell
        title="Terminate Member"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/rotary-network/terminated-members/v2`}
        saving={saving}
        saveLabel="Review &amp; Terminate"
        onSave={handleProceed}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Member */}
        <SectionCard number={1} icon={UserMinus} title="Member" dot="bg-[#17458F]">
          <FieldLabel dot="bg-[#17458F]">Select an Active Club Member</FieldLabel>
          {selectedMember ? (
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-amber-50/60 border-amber-100">
              <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white border border-slate-200">
                {selectedMember.profilePhotoPath ? (
                  <Image
                    src={getPhotoUrl(selectedMember.profilePhotoPath)}
                    alt={selectedMember.memberName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <User className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 truncate">{selectedMember.memberName}</div>
                <div className="text-xs text-slate-500 truncate">
                  {selectedMember.rotaryId ? `#${selectedMember.rotaryId}` : "No Rotary ID"}
                  {selectedMember.emailId ? ` · ${selectedMember.emailId}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={clearSelectedMember}
                className="text-xs font-medium px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-white"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search active members by name, Rotary ID, email…"
                value={memberSearch}
                onChange={(e) => { setMemberSearch(e.target.value); setShowResults(true); }}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                autoFocus
              />
              {showResults && memberSearch.trim() && memberResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {memberResults.map((m) => {
                    const photoUrl = getPhotoUrl(m.profilePhotoPath);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectMember(m)}
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-amber-50/60 text-left transition-colors"
                      >
                        <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-slate-100 border border-slate-200">
                          {photoUrl ? (
                            <Image src={photoUrl} alt={m.memberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-400">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800 truncate">{m.memberName}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {m.rotaryId ? `#${m.rotaryId}` : "–"}
                            {m.emailId ? ` · ${m.emailId}` : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {showResults && memberSearch.trim() && memberResults.length === 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-lg">
                  No active members found
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Only currently active members of this club can be terminated.
              </p>
            </div>
          )}
        </SectionCard>

        {/* 2. Termination Details */}
        <SectionCard number={2} icon={Calendar} title="Termination Details (will be ignored by backend: pending API)" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-[#17458F]">Termination Date <span className="text-slate-400 font-normal">(ignored by API)</span></FieldLabel>
              <DateField value={terminationDate} onChange={setTerminationDate} max={today} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
              <p className="text-xs text-slate-400 mt-0.5">Defaults to today. Backend stamps its own date.</p>
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]">Termination Reason</FieldLabel>
              <select
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                <option value="">Select a reason…</option>
                {TERMINATION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-0.5">Recorded on the member's termination record.</p>
            </div>
          </div>
        </SectionCard>

        {/* 3. Notes */}
        <SectionCard number={3} icon={MessageSquare} title="Notes (will be ignored by backend: pending API)" dot="bg-slate-600">
          <FieldLabel dot="bg-slate-500" hint="(optional, max 1000 chars: ignored by API)" required={false}>Additional Context</FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any context to record alongside the termination… (not persisted)"
            rows={4}
            maxLength={1000}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{notes.length}/1000</p>
        </SectionCard>

        {/* Confirm dialog — same impact preview the v1 Members page shows. */}
        <AlertModal
          open={showConfirm}
          onOpenChange={(o) => !o && setShowConfirm(false)}
          icon={AlertTriangle}
          iconClassName="text-amber-600"
          title={preview?.isLastClub ? "Fully Remove Member" : "Terminate Member"}
          description={
            previewLoading || !preview ? (
              <span className="text-sm text-slate-500">Loading impact preview…</span>
            ) : (
              <div className="space-y-3 text-sm text-left">
                {previewWarning && (
                  <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 text-xs">
                    Impact preview unavailable ({previewWarning}). You can still proceed , 
                    the server will run its standard termination cascade.
                  </p>
                )}
                <p>
                  Terminating <span className="font-semibold">{preview.memberName}</span>
                  {preview.emailId ? <span className="text-slate-500"> ({preview.emailId})</span> : null}
                  {" "}from <span className="font-semibold">{preview.clubName}</span>
                  {" "}on <span className="font-semibold">{terminationDate}</span>
                  {" "}({terminationReason}).
                </p>
                {preview.isLastClub && (
                  <p className="text-rose-700">
                    This is the member&apos;s last active club: their login will be disabled
                    and all roles revoked.
                  </p>
                )}
                {!preview.isLastClub && preview.otherClubs.length > 0 && (
                  <p className="text-slate-600">
                    Other club memberships ({preview.otherClubs.map((c) => c.clubName).join(", ")}) will be preserved.
                  </p>
                )}
                {preview.bodEntries.length > 0 && (
                  <p className="text-slate-600">
                    Board of Directors entries to be removed: {preview.bodEntries.map((b) => `${b.designationName} (${b.yearLabel})`).join("; ")}.
                  </p>
                )}
                {preview.dcGroupMemberships.length > 0 && (
                  <p className="text-slate-600">
                    District committee groups to be cleaned: {preview.dcGroupMemberships.map((g) => g.groupName).join(", ")}.
                  </p>
                )}
              </div>
            )
          }
          confirmLabel={saving ? "Terminating…" : "Terminate"}
          confirmClassName="bg-rose-600 text-white hover:bg-rose-700"
          onConfirm={handleConfirmTerminate}
          cancelLabel="Cancel"
          onCancel={() => setShowConfirm(false)}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Member Terminated"
          description="The member has been terminated from this club. Backend stamped the termination date and reason on the club_members row."
          onOk={() => { setShowSuccessDialog(false); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
