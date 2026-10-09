"use client";

/**
 * PPH Camps v2 — Edit Camp.
 *
 * Same data semantics as the v1 inline Edit dialog (in app/clubs/[id]/pph-camps/page.tsx):
 * title (required), description, address, campDate (required), camp logo file
 * (kept when not re-uploaded), isActive flag. The API still goes through
 * updatePphCamp(clubId, campId, FormData) — multipart upload. Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * Since v1 has no single-camp GET endpoint, we load via getPphCamps and find
 * by id (mirroring the v1 list-then-edit flow).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, FileText, Image as ImageIcon,
} from "lucide-react";
import {
  getClub,
  getPphCamps,
  updatePphCamp,
  getPhotoUrl,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// The camp logo fills a landscape header tile on the camp cards — locked to
// 16:9 at 1200×675.
const LOGO_ASPECT = 16 / 9;
const LOGO_MAX_WIDTH = 1200;
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
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function PphCampsV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const campId = Number(params.campId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/pph-camps/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [campDate, setCampDate] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [existingLogoPath, setExistingLogoPath] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [club, allCamps] = await Promise.all([
          getClub(clubId),
          getPphCamps(clubId),
        ]);
        setClubName(club.clubName);
        const camp = allCamps.find((c) => c.id === campId);
        if (!camp) {
          setErrorMessage("Camp not found.");
          return;
        }
        setTitle(camp.title || "");
        setDescription(camp.description || "");
        setAddress(camp.address || "");
        setCampDate(camp.campDate ? camp.campDate.split("T")[0] : "");
        setIsActive(camp.isActive);
        setExistingLogoPath(camp.campLogoPath);
        if (camp.campLogoPath) setLogoPreview(getPhotoUrl(camp.campLogoPath));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load camp.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, campId]);

  const handleCroppedLogo = (blob: Blob) => {
    const file = new File([blob], `pph-camp-logo-${Date.now()}.png`, { type: "image/png" });
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    logoCrop.cancel();
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setExistingLogoPath(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (!campDate) { setErrorMessage("Camp date is required."); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("address", address.trim());
      fd.append("campDate", campDate);
      fd.append("isActive", isActive ? "true" : "false");
      if (logoFile) {
        fd.append("logo", logoFile);
      }
      await updatePphCamp(clubId, campId, fd);
      setSuccessMessage("Camp updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: { message?: string; detail?: string; title?: string } } })?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || "Failed to update camp.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit PPH Camp"
          pageSubtitle="Record a Foundation contribution"
          activeNavHref="/club-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit PPH Camp"
        pageSubtitle="Record a Foundation contribution"
        activeNavHref="/club-admin-dashboard/foundation"
      >
      <V2FormShell
        title="Edit PPH Camp"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/pph-camps/v2`}
        saving={saving}
        saveLabel="Update Camp"
        onSave={handleSave}
      >
        {/* 1. Camp Details */}
        <SectionCard number={1} icon={FileText} title="Camp Details" dot="bg-blue-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel dot="bg-blue-500" required>Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter camp title"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel dot="bg-blue-500">Description</FieldLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter camp description"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel dot="bg-blue-500">Address</FieldLabel>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter camp address / location"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-blue-500" required>Date</FieldLabel>
              <DateField value={campDate} onChange={setCampDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </SectionCard>

        {/* 2. Camp Logo */}
        <SectionCard number={2} icon={ImageIcon} title="Camp Logo" dot="bg-rose-600">
          <FieldLabel dot="bg-rose-500">Camp Logo</FieldLabel>
          {logoPreview ? (
            <div className="relative inline-block mt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoPreview} alt="Camp logo" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border border-slate-200" />
              <button
                type="button"
                onClick={removeLogo}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-rose-500"
                aria-label="Remove logo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg hover:border-blue-300 transition-colors text-slate-500"
              >
                <Upload className="h-4 w-4" />
                <span className="text-sm">Upload camp logo</span>
              </button>
              <p className="text-xs text-slate-400 mt-1">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            </div>
          )}
          <input
            ref={logoInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.gif,.webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) logoCrop.startCrop(f); e.target.value = ""; }}
          />
          {logoCrop.error && <p className="text-xs text-rose-600 mt-1">{logoCrop.error}</p>}
          {existingLogoPath && !logoFile && (
            <p className="text-xs text-slate-400 mt-2">Current logo will be kept if no new file is selected.</p>
          )}
        </SectionCard>

        {/* Active/Inactive is controlled from the camp listing (toggle), not this form.
            The loaded isActive is still sent on save so it's preserved unchanged. */}

        <ImageCropDialog
          open={logoCrop.open}
          imageSrc={logoCrop.imageSrc}
          aspect={LOGO_ASPECT}
          maxOutputWidth={LOGO_MAX_WIDTH}
          title="Crop Camp Logo"
          onCancel={logoCrop.cancel}
          onSave={handleCroppedLogo}
        />
        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Camp updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
