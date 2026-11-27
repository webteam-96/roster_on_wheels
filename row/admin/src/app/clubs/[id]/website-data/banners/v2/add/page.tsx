"use client";

/**
 * Banner Photos v2 — Add Banner.
 *
 * Extracted from the v1 inline Add Banner dialog in
 * `app/clubs/[id]/website-data/banners/page.tsx`. Every field, every API call,
 * every validation rule is preserved verbatim — including the 8:3 ratio crop,
 * the 1200px minimum-width guard against blur, and the max-10-active-per-year
 * rule. Only the visual presentation differs (V2FormShell wrapper, dot-accented
 * section headers, sticky save bar).
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
import { Upload, X, ImageIcon, FileText, Calendar, ToggleLeft } from "@/components/icons";
import {
  getClub,
  getRotaryYears,
  getClubBanners,
  createClubBanner,
  uploadBannerDocument,
  uploadBannerImage,
  getPhotoUrl,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";
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

export default function BannerPhotosV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/banners/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [allYears, setAllYears] = useState<RotaryYear[]>([]);

  // Form fields
  const [imagePath, setImagePath] = useState("");
  const [description, setDescription] = useState("");
  const [documentPath, setDocumentPath] = useState<string | undefined>(undefined);
  const [documentName, setDocumentName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [isActive, setIsActive] = useState("1");
  const [yearId, setYearId] = useState<string>("");

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
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setAllYears(yrs);
        const current = yrs.find((y) => y.isCurrent);
        if (current) setYearId(String(current.id));
        else if (yrs.length > 0) setYearId(String(yrs[0].id));
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
    if (!imagePath) { setErrorMessage("Please upload a banner image."); return; }
    if (!yearId) { setErrorMessage("Please select a rotary year."); return; }

    const activating = isActive === "1";

    setSaving(true);
    try {
      // Enforce max-10-active for the target year before insert. We need a fresh
      // count for the year being added to (which may differ from the listing's
      // selected year).
      if (activating) {
        try {
          const existing = await getClubBanners(clubId, Number(yearId));
          const currentActiveCount = existing.filter((b) => b.isActive).length;
          if (currentActiveCount >= MAX_ACTIVE) {
            setErrorMessage(`Maximum ${MAX_ACTIVE} active banners allowed per year.`);
            setSaving(false);
            return;
          }
        } catch {
          // If the count check fails, fall through — the API also enforces the limit.
        }
      }

      // sortOrder: append to end of existing list for this year.
      let nextSort = 1;
      try {
        const existing = await getClubBanners(clubId, Number(yearId));
        nextSort = existing.length > 0 ? Math.max(...existing.map((b) => b.sortOrder)) + 1 : 1;
      } catch {
        // ignore — backend will normalize
      }

      await createClubBanner(clubId, {
        yearId: Number(yearId),
        bannerImagePath: fileNameOnly(imagePath),
        documentPath: documentPath || undefined,
        linkUrl: linkUrl.trim() || undefined,
        description: description || undefined,
        sortOrder: nextSort,
        isActive: activating,
      });
      setSuccessMessage("Banner added successfully.");
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

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Add Banner"
          pageSubtitle="Upload a new website banner"
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
        pageTitle="Add Banner"
        pageSubtitle="Upload a new website banner"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Add Banner"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/website-data/banners/v2`}
        saving={saving}
        saveLabel="Save Banner"
        onSave={handleSave}
        banner={
          <>
            <b>Banner ratio is locked to 8:3 (wide).</b>{" "}
            For a sharp display on the public site, upload at least <b>1920 × 720 px</b>.
            Up to {MAX_ACTIVE} banners can be active per year.
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

        {/* 4. Rotary Year */}
        <SectionCard number={4} icon={Calendar} title="Rotary Year">
          <FieldLabel required>Rotary Year</FieldLabel>
          <NativeSelect
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
            
          >
            <option value="">Select a year</option>
            {allYears.map((y) => (
              <option key={y.id} value={String(y.id)}>
                {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
              </option>
            ))}
          </NativeSelect>
        </SectionCard>

        {/* 5. Document or Link (optional) */}
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
          description={successMessage || "Banner added successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
