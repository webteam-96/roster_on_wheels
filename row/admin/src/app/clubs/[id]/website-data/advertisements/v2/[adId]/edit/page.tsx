"use client";

/**
 * Advertisements v2 — Edit Advertisement.
 *
 * Same data semantics as the v1 inline dialog: every field, every API call,
 * every validation rule preserved verbatim. Only the visual presentation
 * differs (V2FormShell wrapper, dot-accented section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 *
 * Validations preserved from v1:
 *   - Advertisement image required
 *   - Description capped at 500 characters
 *   - Max 10 active advertisements per year — guarded BEFORE the API call
 *     (counts every OTHER ad in this year, so flipping THIS row's status
 *     doesn't double-count)
 *   - The year field is NOT editable on Edit (matches v1 dialog); year stays
 *     fixed to the value the record was created with.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import {
  Info, ImageIcon, Upload, X, FileText, Type, Power, Calendar,
} from "@/components/icons";
import {
  getClub,
  getClubAdvertisements,
  getClubAdvertisement,
  updateClubAdvertisement,
  uploadAdvertisementImage,
  uploadAdvertisementDocument,
  getPhotoUrl,
} from "@/services/api";
import { ClubAdvertisement } from "@/types/advertisement";
import { fileNameOnly } from "@/lib/pathUtils";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const MAX_ACTIVE = 10;

// Ads are sponsor posters/flyers in many shapes, so the crop stays FREE-FORM
// (no locked aspect). Matches the upload validator's own 2560 px compression
// ceiling, so this never shrinks a realistic source.
const AD_MAX_WIDTH = 2560;
const TOP_MESSAGE =
  "Edit this advertisement. The Rotary year cannot be changed once saved; delete and re-create to move it.";

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
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function AdvertisementsV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const adId = Number(params.adId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/advertisements/v2`);

  const [clubName, setClubName] = useState("");
  const [record, setRecord] = useState<ClubAdvertisement | null>(null);
  const [siblings, setSiblings] = useState<ClubAdvertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [imagePath, setImagePath] = useState("");
  const [documentPath, setDocumentPath] = useState<string | undefined>(undefined);
  const [documentName, setDocumentName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState("1");

  // Image crop state
  const adCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, rec] = await Promise.all([
          getClub(clubId),
          getClubAdvertisement(clubId, adId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setRecord(rec);
        setImagePath(rec.advertisementImagePath);
        setDocumentPath(rec.documentPath || undefined);
        setDocumentName(rec.documentPath ? rec.documentPath.split("/").pop() || "Document" : "");
        setLinkUrl(rec.linkUrl || "");
        setDescription(rec.description || "");
        setIsActive(rec.isActive ? "1" : "0");
        // Preload sibling ads in the same year so the active-count guard
        // can ignore THIS row when checking the max-active limit.
        try {
          const ads = await getClubAdvertisements(clubId, rec.yearId);
          if (!cancelled) setSiblings(ads);
        } catch { /* non-fatal */ }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to load advertisement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, adId]);

  const handleCropSave = async (blob: Blob) => {
    setUploading(true);
    try {
      const file = new File([blob], "advertisement.png", { type: "image/png" });
      const { path, url } = await uploadAdvertisementImage(clubId, file);
      setImagePath(url || path);
      adCrop.cancel();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string } };
      const msg = (typeof e.response?.data === "object" && e.response?.data?.message)
        || (typeof e.response?.data === "string" ? e.response.data : undefined)
        || "Failed to upload image.";
      setErrorMessage(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDocumentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingDoc(true);
    try {
      const { path } = await uploadAdvertisementDocument(clubId, file);
      setDocumentPath(path);
      setDocumentName(file.name);
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } | string } };
      const msg = (typeof e2.response?.data === "object" && e2.response?.data?.message)
        || (typeof e2.response?.data === "string" ? e2.response.data : undefined)
        || "Failed to upload document.";
      setErrorMessage(msg);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleSave = async () => {
    if (!record) return;
    if (!imagePath) { setErrorMessage("Please upload an advertisement image."); return; }
    if (uploading || uploadingDoc) {
      setErrorMessage("Please wait for the upload to finish.");
      return;
    }

    const isActivating = isActive === "1";
    if (isActivating) {
      // Count every OTHER active ad in this year so flipping THIS row doesn't double-count.
      const currentActiveCount = siblings.filter((a) => a.isActive && a.id !== record.id).length;
      if (currentActiveCount >= MAX_ACTIVE) {
        setErrorMessage(`Maximum ${MAX_ACTIVE} active advertisements allowed per year.`);
        return;
      }
    }

    setSaving(true);
    try {
      await updateClubAdvertisement(clubId, record.id, {
        advertisementImagePath: fileNameOnly(imagePath),
        documentPath: documentPath || undefined,
        linkUrl: linkUrl.trim() || undefined,
        description: description || undefined,
        sortOrder: record.sortOrder,
        isActive: isActivating,
      });
      setSuccessMessage("Advertisement updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string }; message?: string };
      const apiMsg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        e.message ||
        "Failed to save advertisement.";
      setErrorMessage(apiMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Advertisement"
          pageSubtitle="Update an existing advertisement"
          activeNavHref="/club-admin-dashboard/my-club-website"
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
        pageTitle="Edit Advertisement"
        pageSubtitle="Update an existing advertisement"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Edit Advertisement"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/website-data/advertisements/v2`}
        saving={saving}
        saveLabel="Update Advertisement"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Advertisement Image */}
        <SectionCard number={1} icon={ImageIcon} title="Advertisement Image" dot="bg-blue-600">
          <FieldLabel dot="bg-blue-500" required hint="(JPG, JPEG, PNG, GIF, WEBP)">
            Banner Image
          </FieldLabel>
          {imagePath ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <Image src={getPhotoUrl(imagePath)} alt="Advertisement preview" fill className="object-cover" unoptimized />
              <button
                type="button"
                onClick={() => setImagePath("")}
                className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-white hover:bg-rose-700 shadow"
                aria-label="Remove image"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) adCrop.startCrop(f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1 w-full h-28 border-2 border-dashed border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/40 transition-colors text-slate-500"
              >
                <Upload className="h-5 w-5" />
                <span className="text-sm">Click to upload banner image</span>
              </button>
              <p className="text-xs text-slate-400 mt-1.5">
                You will be able to crop and zoom before uploading.
              </p>
              {adCrop.error && <p className="text-xs text-rose-600 mt-1.5">{adCrop.error}</p>}
            </div>
          )}
        </SectionCard>

        {/* 2. Document or Link (optional) */}
        <SectionCard number={2} icon={FileText} title="Document or Link (optional)" dot="bg-amber-600">
          <FieldLabel dot="bg-amber-500" hint="(document or link. Not both)">
            Attached Document / Link
          </FieldLabel>
          <DocumentOrLinkField
            value={{ documentPath, documentName, linkUrl }}
            onChange={(v) => { setDocumentPath(v.documentPath); setDocumentName(v.documentName); setLinkUrl(v.linkUrl); }}
            uploadDocument={async (f) => (await uploadAdvertisementDocument(clubId, f)).path}
            onError={setErrorMessage}
          />
        </SectionCard>

        {/* 3. Description */}
        <SectionCard number={3} icon={Type} title="Description" dot="bg-emerald-600">
          <FieldLabel dot="bg-emerald-500" hint="(optional, max 500 chars)">Caption</FieldLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 500))}
            placeholder="Optional description for this advertisement"
            rows={3}
            maxLength={500}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/500</p>
        </SectionCard>

        {/* 4. Status + Rotary Year (year is read-only on Edit, matches v1) */}
        <SectionCard number={4} icon={Power} title="Status & Rotary Year" dot="bg-violet-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-violet-500" required>Status</FieldLabel>
              <select
                value={isActive}
                onChange={(e) => setIsActive(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Max {MAX_ACTIVE} active ads per year.
              </p>
            </div>
            <div>
              <FieldLabel dot="bg-violet-500">
                <Calendar className="inline h-3 w-3 mr-1 mb-0.5" /> Rotary Year
              </FieldLabel>
              <input
                type="text"
                value={record?.yearLabel || ""}
                readOnly
                disabled
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-600 cursor-not-allowed"
              />
              <p className="text-xs text-slate-400 mt-1">Fixed once saved: delete to re-create.</p>
            </div>
          </div>
        </SectionCard>

        {/* Image Crop Dialog */}
        <ImageCropDialog
          open={adCrop.open}
          imageSrc={adCrop.imageSrc}
          maxOutputWidth={AD_MAX_WIDTH}
          allowOrientation
          title="Crop Advertisement Image"
          saving={uploading}
          onCancel={adCrop.cancel}
          onSave={handleCropSave}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Advertisement updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
