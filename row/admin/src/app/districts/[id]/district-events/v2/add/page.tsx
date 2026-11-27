"use client";
import { RemoveBadgeButton, UploadZone } from "@/components/ui/text-buttons";

/**
 * District Events V2 — Add Event.
 *
 * Same data semantics as v1 (src/app/districts/[id]/district-events/add/page.tsx):
 * every field, every API call, every validation rule preserved verbatim
 * (title English-only ≤50, description English-only ≤1000, eventDate required,
 * at least one photo, per-photo description ≤500). Only the chrome changes —
 * wrapped in DistrictAdminShell + V2FormShell with the dot-accented section
 * cards used by every other v2 form.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, FileText, Image as ImageIcon, Info,
} from "@/components/icons";
import {
  getDistrict,
  createDistrictEventItem,
  uploadDistrictEventPhoto,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const MAX_PHOTOS = 5;

// Event photos render as landscape tiles here and in the district website
// gallery — locked to 4:3 at 1200×900.
const PHOTO_ASPECT = 4 / 3;
const PHOTO_MAX_WIDTH = 1200;

const TOP_MESSAGE =
  "Please post all the Events executed by your District. The content posted here will be displayed on the District website.";

type PhotoItem = { path: string; preview: string; description: string };

// Inline mirror of useSyncClubIdFromUrl for district scope. Kept here (not a
// shared hook) until a second v2 district page needs it.
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

export default function DistrictEventsV2AddPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/district-events/v2`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoCrop = useImageCropUpload();

  const photoInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const d = await getDistrict(districtId);
        setDistrictName(`District ${d.districtNumber}`);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } | string } };
        if (e?.response?.status === 403) {
          setErrorMessage("You don't have permission to add events for this district.");
        } else {
          const msg = typeof e?.response?.data === "string"
            ? e.response.data
            : e?.response?.data?.message;
          setErrorMessage(msg || "Failed to initialize.");
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId]);

  const handleCroppedPhoto = async (blob: Blob) => {
    const file = new File([blob], `district-event-${Date.now()}.png`, { type: "image/png" });
    setUploading(true);
    try {
      const res = await uploadDistrictEventPhoto(districtId, file, true);
      setPhotos((prev) => [
        ...prev,
        { path: res.path, preview: URL.createObjectURL(file), description: "" },
      ]);
    } catch (err: unknown) {
      const ex = err as { message?: string; response?: { data?: { message?: string } } };
      setErrorMessage(ex?.message || ex?.response?.data?.message || "Failed to upload photo.");
    } finally {
      setUploading(false);
      photoCrop.cancel();
    }
  };

  const removePhoto = (idx: number) =>
    setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const updatePhotoDescription = (idx: number, value: string) =>
    setPhotos((prev) => prev.map((p, i) => (i === idx ? { ...p, description: value } : p)));

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!TEXT_INPUT_REGEX.test(title)) { setErrorMessage("Title cannot contain emoji."); return; }
    if (description && !TEXT_INPUT_REGEX.test(description)) { setErrorMessage("Description cannot contain emoji."); return; }
    if (description && description.length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!eventDate) { setErrorMessage("Date is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least one photo is required."); return; }
    if (uploading) { setErrorMessage("Please wait for photo to finish uploading."); return; }

    setSaving(true);
    try {
      await createDistrictEventItem(districtId, {
        title: title.trim(),
        description: description.trim() || null,
        eventDate,
        photos: photos.map((p, i) => ({
          imagePath: p.path,
          description: p.description.trim() || null,
          isPrimary: i === 0,
          sortOrder: i,
        })),
      });
      setSuccessMessage("Event created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      if (e?.response?.status === 403) {
        setErrorMessage("You don't have permission to add events for this district.");
      } else {
        const msg = typeof e?.response?.data === "string"
          ? e.response.data
          : e?.response?.data?.message;
        setErrorMessage(msg || "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Add District Event"
          activeNavHref="/district-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Add District Event"
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <V2FormShell
          title="Add District Event"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/district-events/v2`}
          saving={saving}
          saveLabel="Save Event"
          saveTone="bg-[#17458F] text-[#F7F9FC] hover:bg-[#12376F]"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Event Details */}
          <SectionCard number={1} icon={FileText} title="Event Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title"
                  maxLength={50}
                  
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 1000 chars)" required={false}>Description</FieldLabel>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Event description"
                  rows={4}
                  maxLength={1000}
                  className="resize-y"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
              </div>
              <div>
                <FieldLabel required>Date</FieldLabel>
                <DateField value={eventDate} onChange={setEventDate} className="row-field w-full" />
              </div>
            </div>
          </SectionCard>

          {/* 2. Photos */}
          <SectionCard number={2} icon={ImageIcon} title={`Photos (max ${MAX_PHOTOS}, at least 1 mandatory)`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="relative w-full h-40 group bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview || `${API_URL}${photo.path}`}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                    <RemoveBadgeButton onClick={() => removePhoto(idx)} aria-label="Remove photo" />
                  </div>
                  <div className="p-3 space-y-1">
                    <Textarea
                      value={photo.description}
                      onChange={(e) => {
                        if (e.target.value.length <= 500) updatePhotoDescription(idx, e.target.value);
                      }}
                      placeholder="Photo description (max 500 chars)"
                      rows={3}
                      maxLength={500}
                      className="resize-none"
                    />
                    <p className="text-xs text-slate-400 text-right">{photo.description.length}/500</p>
                  </div>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <UploadZone shape="box"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full h-40"
                  disabled={uploading}
                >
                  {uploading ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <>
                      <Upload className="h-5 w-5" />
                      <span className="text-xs mt-1">Upload</span>
                    </>
                  )}
                </UploadZone>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f && photos.length < MAX_PHOTOS) photoCrop.startCrop(f); e.target.value = ""; }}
                disabled={uploading}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">Allowed: JPG, JPEG, PNG, GIF, WEBP · up to 5 MB · auto-compressed if larger</p>
            {photoCrop.error && <p className="text-xs text-rose-600 mt-1">{photoCrop.error}</p>}
          </SectionCard>

          <ImageCropDialog
            open={photoCrop.open}
            imageSrc={photoCrop.imageSrc}
            aspect={PHOTO_ASPECT}
            allowOrientation
            maxOutputWidth={PHOTO_MAX_WIDTH}
            title="Crop Event Photo"
            saving={uploading}
            onCancel={photoCrop.cancel}
            onSave={handleCroppedPhoto}
          />
          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Event created successfully."}
            onOk={() => {
              setShowSuccessDialog(false);
              setSuccessMessage(null);
              navigateAfterSave();
            }}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
