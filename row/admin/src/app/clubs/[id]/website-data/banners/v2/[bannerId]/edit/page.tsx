"use client";

/**
 * Banner Photos v2 — Edit Banner.
 *
 * Same data semantics as the v1 edit dialog: every field, every API call, every
 * validation rule is preserved verbatim (8:3 crop, 1200px min-width guard,
 * max-10-active-per-year limit, no year change in edit mode). Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Upload, X, ImageIcon, FileText, ToggleLeft } from "@/components/icons";
import {
  getClub,
  getClubBanner,
  getClubBanners,
  updateClubBanner,
  uploadBannerDocument,
  uploadBannerImage,
  getPhotoUrl,
} from "@/services/api";
import { ClubBanner } from "@/types/banner";
import { fileNameOnly } from "@/lib/pathUtils";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

import { RemoveBadgeButton } from "@/components/ui/text-buttons"
import { Button } from "@/components/ui/button"
const MAX_ACTIVE = 6;

const BANNER_ASPECT = 8 / 3;
const BANNER_MAX_WIDTH = 1920;
// Banners render full-bleed (~1920 px) on the public site, so a narrower crop
// would be upscaled by the browser and look blurry. Rejected rather than stored.
const BANNER_MIN_WIDTH = 1200;

export default function BannerPhotosV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const bannerId = Number(params.bannerId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/banners/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Original record (used to keep sortOrder + yearId)
  const [original, setOriginal] = useState<ClubBanner | null>(null);

  // Form fields
  const [imagePath, setImagePath] = useState("");
  const [description, setDescription] = useState("");
  const [documentPath, setDocumentPath] = useState<string | undefined>(undefined);
  const [documentName, setDocumentName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [isActive, setIsActive] = useState("1");

  // Crop dialog state
  const bannerCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, rec] = await Promise.all([
          getClub(clubId),
          getClubBanner(clubId, bannerId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setOriginal(rec);
        setImagePath(rec.bannerImagePath);
        setDescription(rec.description || "");
        setDocumentPath(rec.documentPath || undefined);
        setDocumentName(rec.documentPath ? rec.documentPath.split("/").pop() || "Document" : "");
        setLinkUrl(rec.linkUrl || "");
        setIsActive(rec.isActive ? "1" : "0");
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to load banner.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, bannerId]);

  const handleCropSave = async (blob: Blob) => {
    const cropped = await createImageBitmap(blob);
    if (cropped.width < BANNER_MIN_WIDTH) {
      setErrorMessage(
        `Cropped area is only ${cropped.width}×${cropped.height} pixels. ` +
        `Banners need at least ${BANNER_MIN_WIDTH} pixels wide for a clean (non-blurry) display. ` +
        "Please upload a larger source image (recommended: 1920×720 or larger) or zoom out before cropping."
      );
      return;
    }
    setUploading(true);
    try {
      const file = new File([blob], "banner.png", { type: "image/png" });
      const { path, url } = await uploadBannerImage(clubId, file);
      setImagePath(url || path);
      bannerCrop.cancel();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string }; message?: string };
      const msg =
        (typeof e.response?.data === "object" && e.response?.data?.message) ||
        (typeof e.response?.data === "string" ? e.response.data : undefined) ||
        e.message || "Failed to upload image.";
      setErrorMessage(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!original) { setErrorMessage("Banner data not loaded."); return; }
    if (!imagePath) { setErrorMessage("Please upload a banner image."); return; }

    const activating = isActive === "1";

    setSaving(true);
    try {
      // Max-10-active enforcement (only relevant when ACTIVATING a previously
      // inactive banner). Skip the check if it was already active.
      if (activating && !original.isActive) {
        try {
          const existing = await getClubBanners(clubId, original.yearId);
          const currentActiveCount = existing.filter((b) => b.isActive && b.id !== original.id).length;
          if (currentActiveCount >= MAX_ACTIVE) {
            setErrorMessage(`Maximum ${MAX_ACTIVE} active banners allowed per year.`);
            setSaving(false);
            return;
          }
        } catch {
          // API will also enforce the limit; fall through.
        }
      }

      await updateClubBanner(clubId, original.id, {
        bannerImagePath: fileNameOnly(imagePath),
        documentPath: documentPath || undefined,
        linkUrl: linkUrl.trim() || undefined,
        description: description || undefined,
        sortOrder: original.sortOrder,
        isActive: activating,
      });
      setSuccessMessage("Banner updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { message?: string } | string }; message?: string };
      const apiMsg =
        (typeof anyErr.response?.data === "object" && anyErr.response?.data?.message) ||
        (typeof anyErr.response?.data === "string" ? anyErr.response.data : undefined) ||
        anyErr.message ||
        "Failed to save banner.";
      setErrorMessage(apiMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !original) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Banner"
          pageSubtitle="Update an existing website banner"
          activeNavHref="/club-admin-dashboard/my-club-website"
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
        pageTitle="Edit Banner"
        pageSubtitle="Update an existing website banner"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Edit Banner"
        subtitle={`${clubName} · RY ${original.yearLabel}`}
        defaultBack={`/clubs/${clubId}/website-data/banners/v2`}
        saving={saving}
        saveLabel="Update Banner"
        onSave={handleSave}
        banner={
          <>
            <b>Banner ratio is locked to 8:3 (wide).</b>{" "}
            For a sharp display on the public site, upload at least <b>1920 × 720 px</b>.
            Year cannot be changed in edit mode.
          </>
        }
      >
        {/* 1. Banner Image */}
        <SectionCard number={1} icon={ImageIcon} title="Banner Image">
          <FieldLabel required>Image</FieldLabel>
          {imagePath ? (
            <div className="relative aspect-[8/3] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
              <Image src={getPhotoUrl(imagePath)} alt="Banner preview" fill className="object-cover" unoptimized />
              <RemoveBadgeButton
                type="button"
                onClick={() => setImagePath("")}
                 aria-label="Remove image" />
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) bannerCrop.startCrop(f); e.target.value = ""; }}
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-28 w-full flex-col gap-1 border-dashed" variant="outline">
                <Upload size={20} />
                <span className="text-sm font-medium">Click to upload image</span>
                <span className="text-xs text-slate-400">Allowed: JPG, JPEG, PNG, GIF, WEBP</span>
              </Button>
              {bannerCrop.error && <p className="text-xs text-rose-600 mt-1.5">{bannerCrop.error}</p>}
            </div>
          )}
        </SectionCard>

        {/* 2. Description */}
        <SectionCard number={2} icon={FileText} title="Description">
          <FieldLabel hint="(max 500 chars)">Description</FieldLabel>
          <Textarea
            placeholder="Optional description for this banner"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
            className="resize-y"
          />
          <p className="text-xs text-slate-400 text-right mt-1">{description.length}/500</p>
        </SectionCard>

        {/* 3. Status */}
        <SectionCard number={3} icon={ToggleLeft} title="Status">
          <FieldLabel>Visibility</FieldLabel>
          <NativeSelect
            value={isActive}
            onChange={(e) => setIsActive(e.target.value)}
            
          >
            <option value="1">Active (shown on website)</option>
            <option value="0">Inactive (hidden)</option>
          </NativeSelect>
        </SectionCard>

        {/* Document or Link (optional) */}
        <SectionCard number={5} icon={FileText} title="Document or Link (optional)">
          <FieldLabel hint="(document or link. Not both)">Attached Document / Link</FieldLabel>
          <DocumentOrLinkField
            value={{ documentPath, documentName, linkUrl }}
            onChange={(v) => { setDocumentPath(v.documentPath); setDocumentName(v.documentName); setLinkUrl(v.linkUrl); }}
            uploadDocument={async (f) => (await uploadBannerDocument(clubId, f)).path}
            onError={setErrorMessage}
          />
        </SectionCard>

        {/* Image Crop Dialog */}
        <ImageCropDialog
          open={bannerCrop.open}
          imageSrc={bannerCrop.imageSrc}
          aspect={BANNER_ASPECT}
          maxOutputWidth={BANNER_MAX_WIDTH}
          minOutputWidth={BANNER_MIN_WIDTH}
          title="Crop Banner Image"
          saving={uploading}
          onCancel={bannerCrop.cancel}
          onSave={handleCropSave}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Banner updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
