"use client";

/**
 * Advertisements v2 — Add Advertisement.
 *
 * Extracted from the v1 inline Add/Edit dialog in
 * `app/clubs/[id]/website-data/advertisements/page.tsx`. Every field, every
 * API call, every validation rule preserved verbatim. Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 *
 * Validations preserved from v1:
 *   - Advertisement image required
 *   - Rotary year required
 *   - Max 10 active advertisements per year — guarded BEFORE the API call
 *     so the form fails cheaply when the user tries to activate an 11th
 *   - Description capped at 500 characters
 *   - Image upload goes through the shared crop dialog (free aspect, same as v1)
 *   - Document upload is optional, accepted types: PDF/DOC/DOCX/XLS/XLSX/
 *     PPT/PPTX/JPG/JPEG/PNG
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import {
  Info, ImageIcon, Upload, X, FileText, Type, Power, Calendar,
} from "lucide-react";
import {
  getClub,
  getRotaryYears,
  getClubAdvertisements,
  createClubAdvertisement,
  uploadAdvertisementImage,
  uploadAdvertisementDocument,
  getPhotoUrl,
} from "@/services/api";
import { ClubAdvertisement } from "@/types/advertisement";
import { RotaryYear } from "@/types/rotaryYear";
import { fileNameOnly } from "@/lib/pathUtils";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";

const MAX_ACTIVE = 10;

// Ads are sponsor posters/flyers in many shapes, so the crop stays FREE-FORM
// (no locked aspect). Matches the upload validator's own 2560 px compression
// ceiling, so this never shrinks a realistic source.
const AD_MAX_WIDTH = 2560;
const TOP_MESSAGE =
  "Advertisements appear on the club website. Up to 10 ads can be active per year — extras must stay inactive. Crop the banner image to focus on the area you want shown.";

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

export default function AdvertisementsV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/advertisements/v2`);

  const [clubName, setClubName] = useState("");
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [existing, setExisting] = useState<ClubAdvertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [imagePath, setImagePath] = useState("");
  const [documentPath, setDocumentPath] = useState<string | undefined>(undefined);
  const [documentName, setDocumentName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState("1");
  const [yearId, setYearId] = useState<string>("");

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
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setAllYears(yrs);
        // Default to current year (matches v1 dialog default).
        const current = yrs.find((y) => y.isCurrent);
        const defaultYearId = current?.id ?? yrs[0]?.id;
        if (defaultYearId) {
          setYearId(String(defaultYearId));
          // Preload existing ads for this year so the active-count guard works.
          try {
            const ads = await getClubAdvertisements(clubId, defaultYearId);
            if (!cancelled) setExisting(ads);
          } catch { /* non-fatal; guard will skip if list empty */ }
        }
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

  // When the user changes the year, refresh the active-count baseline.
  useEffect(() => {
    if (!yearId) return;
    let cancelled = false;
    getClubAdvertisements(clubId, Number(yearId))
      .then((ads) => { if (!cancelled) setExisting(ads); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [yearId, clubId]);

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
    if (!imagePath) { setErrorMessage("Please upload an advertisement image."); return; }
    if (!yearId)    { setErrorMessage("Please select a rotary year."); return; }
    if (uploading || uploadingDoc) {
      setErrorMessage("Please wait for the upload to finish.");
      return;
    }

    const isActivating = isActive === "1";
    if (isActivating) {
      const currentActiveCount = existing.filter((a) => a.isActive).length;
      if (currentActiveCount >= MAX_ACTIVE) {
        setErrorMessage(`Maximum ${MAX_ACTIVE} active advertisements allowed per year.`);
        return;
      }
    }

    setSaving(true);
    try {
      const nextSort = existing.length > 0 ? Math.max(...existing.map((a) => a.sortOrder)) + 1 : 1;
      await createClubAdvertisement(clubId, {
        yearId: Number(yearId),
        advertisementImagePath: fileNameOnly(imagePath),
        documentPath: documentPath || undefined,
        linkUrl: linkUrl.trim() || undefined,
        description: description || undefined,
        sortOrder: nextSort,
        isActive: isActivating,
      });
      setSuccessMessage("Advertisement added successfully.");
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
          pageTitle="Add Advertisement"
          pageSubtitle="Create a new advertisement"
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
        pageTitle="Add Advertisement"
        pageSubtitle="Create a new advertisement"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Add Advertisement"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/website-data/advertisements/v2`}
        saving={saving}
        saveLabel="Save Advertisement"
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
          <FieldLabel dot="bg-amber-500" hint="(document or link — not both)">
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

        {/* 4. Status + Rotary Year */}
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
              <FieldLabel dot="bg-violet-500" required>
                <Calendar className="inline h-3 w-3 mr-1 mb-0.5" /> Rotary Year
              </FieldLabel>
              <select
                value={yearId}
                onChange={(e) => setYearId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Select a year</option>
                {allYears.map((y) => (
                  <option key={y.id} value={String(y.id)}>
                    {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                  </option>
                ))}
              </select>
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
          description={successMessage || "Advertisement added successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
