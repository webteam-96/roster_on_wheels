"use client";

/**
 * Past Presidents v2 — Add.
 *
 * Same data semantics as the v1 inline dialog: every field, every API call,
 * every validation rule preserved verbatim. Only the visual presentation
 * differs (V2FormShell wrapper, dot-accented section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 *
 * Validations preserved from v1:
 *   - Member selection required
 *   - Rotary year required
 *   - Past year only (per memory rule "Past Presidents past-year-only")
 *   - One PP per year (client-side duplicate check before API call)
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Info, User, Search, Crown, Calendar, UserPlus, Camera as ImageIcon } from "lucide-react";
import Image from "next/image";
import {
  getClub,
  getRotaryYears,
  getPastPresidents,
  createPastPresident,
  searchClubMembers,
  getPhotoUrl,
} from "@/services/api";
import { PastPresident, ClubMemberSearchResult } from "@/types/pastPresident";
import { RotaryYear } from "@/types/rotaryYear";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

// Past-president photos render in round avatars everywhere, so the crop is
// locked square and stored at 500×500.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_WIDTH = 500;

const TOP_MESSAGE = "Search for a current or former club member, or add a historical Non-Member entry if the past president is no longer in the system. Only past Rotary years are selectable, and at most one past president is allowed per year.";

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
    <div className="rounded-xl border border-slate-200 mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 rounded-t-xl">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function PastPresidentsV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/past-presidents/v2`);

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [existing, setExisting] = useState<PastPresident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields. Exactly ONE of selectedMemberId / nonMemberName is filled.
  //   - Member flow: selectedMemberId set + nonMemberName === ""
  //   - Non-Member flow: selectedMemberId === null + nonMemberName has a value
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState("");
  const [selectedMemberPhoto, setSelectedMemberPhoto] = useState<string | null>(null);
  const [nonMemberName, setNonMemberName] = useState<string>("");
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // Non-member profile photo (only used for non-member entries).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Member autocomplete
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<ClubMemberSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const photoCrop = useImageCropUpload();

  useEffect(() => {
    async function init() {
      try {
        const [club, yrs, pp] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
          getPastPresidents(clubId),
        ]);
        setClubName(club.clubName);
        setYears(yrs);
        setExisting(pp);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // Debounced member search (same 300ms as v1 dialog).
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

  const clearPhoto = useCallback(() => {
    setPhotoFile(null);
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  const handleCroppedPhoto = (blob: Blob) => {
    const f = new File([blob], `past-president-${Date.now()}.png`, { type: "image/png" });
    setPhotoFile(f);
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    photoCrop.cancel();
  };

  const handleSelectMember = useCallback((member: ClubMemberSearchResult) => {
    setSelectedMemberId(member.id);
    setSelectedMemberName(member.memberName);
    setSelectedMemberPhoto(member.profilePhotoPath);
    setNonMemberName(""); // mutually exclusive with non-member path
    clearPhoto();          // photo is non-member only
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  }, [clearPhoto]);

  const handleSelectNonMember = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNonMemberName(trimmed);
    setSelectedMemberId(null);
    setSelectedMemberName("");
    setSelectedMemberPhoto(null);
    setMemberSearch("");
    setShowResults(false);
    setMemberResults([]);
  }, []);

  const clearSelectedMember = () => {
    setSelectedMemberId(null);
    setSelectedMemberName("");
    setSelectedMemberPhoto(null);
    setNonMemberName("");
    clearPhoto();
  };

  // Past-year-only dropdown — current + future intentionally hidden (matches v1).
  const yearOptions = years.filter((y) => new Date(y.endDate) < new Date());

  const handleSave = async () => {
    const hasMember = selectedMemberId != null;
    const hasNonMember = nonMemberName.trim().length > 0;
    // Backend enforces exactly-one-of; mirror that here so we surface the
    // friendlier copy before the API rejection.
    if (!hasMember && !hasNonMember) {
      setErrorMessage("Please select a member or enter a non-member name.");
      return;
    }
    if (hasMember && hasNonMember) {
      setErrorMessage("Choose either a member or a non-member entry, not both.");
      return;
    }
    if (!selectedYearId) {
      setErrorMessage("Please select a rotary year.");
      return;
    }
    const yearIdNum = Number(selectedYearId);
    // Client-side duplicate check — block before hitting the API (one PP per year).
    const conflict = existing.find((r) => r.yearId === yearIdNum);
    if (conflict) {
      setErrorMessage(
        `A Past President (${conflict.memberName}) already exists for ${conflict.yearLabel}. Only one is allowed per year.`,
      );
      return;
    }

    setSaving(true);
    try {
      await createPastPresident(clubId, {
        memberId: hasMember ? selectedMemberId : null,
        nonMemberName: hasNonMember ? nonMemberName.trim() : null,
        yearId: yearIdNum,
      }, hasNonMember ? photoFile : null);
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      // API returns 400 with { message } for duplicate or current/future year. Surface it.
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
        pageTitle="Add Past President"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <V2FormShell
        title="Add Past President"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/past-presidents/v2`}
        saving={saving}
        saveLabel="Save Past President"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Member / Non-Member */}
        <SectionCard number={1} icon={Crown} title="Past President" dot="bg-blue-600">
          <FieldLabel dot="bg-blue-500">Select a Club Member or add a Non-Member</FieldLabel>
          {selectedMemberId ? (
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-blue-50/60 border-blue-100">
              <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white border border-slate-200">
                {selectedMemberPhoto ? (
                  <Image
                    src={getPhotoUrl(selectedMemberPhoto)}
                    alt={selectedMemberName}
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
              <span className="font-medium flex-1 text-slate-800">{selectedMemberName}</span>
              <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                Member
              </span>
              <button
                type="button"
                onClick={clearSelectedMember}
                className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-white"
              >
                Change
              </button>
            </div>
          ) : nonMemberName ? (
            <>
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-slate-100 border-slate-200">
                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white border border-slate-200">
                  {photoPreview ? (
                    <Image src={photoPreview} alt={nonMemberName} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      <UserPlus className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={nonMemberName}
                    onChange={(e) => setNonMemberName(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-slate-800 border-0 border-b border-slate-300 focus:outline-none focus:border-slate-500"
                    placeholder="Non-member name"
                  />
                </div>
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  Non-Member
                </span>
                <button
                  type="button"
                  onClick={clearSelectedMember}
                  className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-white"
                >
                  Change
                </button>
              </div>

              {/* Profile photo — NON-MEMBER only */}
              <div className="mt-3">
                <FieldLabel dot="bg-slate-400" required={false} hint="(optional)">Profile Photo</FieldLabel>
                <div className="flex items-center gap-3">
                  <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white border border-slate-200">
                    {photoPreview ? (
                      <Image src={photoPreview} alt="Profile preview" fill className="object-cover" unoptimized />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <ImageIcon className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer text-xs font-medium px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50">
                      {photoPreview ? "Change photo" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) photoCrop.startCrop(f); e.target.value = ""; }}
                      />
                    </label>
                    {photoPreview && (
                      <button
                        type="button"
                        onClick={clearPhoto}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">JPG, PNG, WEBP or GIF · cropped square.</p>
                {photoCrop.error && <p className="text-xs text-rose-600 mt-1">{photoCrop.error}</p>}
              </div>
            </>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search club members by name…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <RotaryLoader size="sm" />
                </div>
              )}
              {showResults && (memberResults.length > 0 || memberSearch.trim()) && !searchLoading && (
                <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {memberResults.map((m) => {
                    const photoUrl = getPhotoUrl(m.profilePhotoPath);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectMember(m)}
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-blue-50/60 text-left transition-colors"
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
                        <span className="text-sm font-medium text-slate-800 flex-1">{m.memberName}</span>
                        <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          Member
                        </span>
                      </button>
                    );
                  })}
                  {/* Non-Member fallback — always shown when a search term is present */}
                  {memberSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => handleSelectNonMember(memberSearch)}
                      className="flex items-center gap-3 w-full px-3 py-2 border-t border-slate-100 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                    >
                      <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-white border border-slate-200 flex items-center justify-center">
                        <UserPlus className="h-4 w-4 text-slate-500" />
                      </div>
                      <span className="text-sm text-slate-700 flex-1">
                        Add <span className="font-semibold">&ldquo;{memberSearch.trim()}&rdquo;</span> as Non-Member
                      </span>
                      <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                        Non-Member
                      </span>
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Pick a current/former member from the dropdown, or add a Non-Member if the person is not in the system.
              </p>
            </div>
          )}
        </SectionCard>

        {/* 2. Rotary Year */}
        <SectionCard number={2} icon={Calendar} title="Rotary Year" dot="bg-amber-600">
          <FieldLabel dot="bg-amber-500" hint="(past years only)">Year of Presidency</FieldLabel>
          <select
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">Select a year…</option>
            {yearOptions.map((y) => (
              <option key={y.id} value={String(y.id)}>
                {y.yearLabel}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Only one past president can be recorded per year.
          </p>
        </SectionCard>

        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.imageSrc}
          aspect={PHOTO_ASPECT}
          maxOutputWidth={PHOTO_MAX_WIDTH}
          title="Crop Profile Photo"
          onCancel={photoCrop.cancel}
          onSave={handleCroppedPhoto}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description="Past president added successfully."
          onOk={() => { setShowSuccessDialog(false); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
