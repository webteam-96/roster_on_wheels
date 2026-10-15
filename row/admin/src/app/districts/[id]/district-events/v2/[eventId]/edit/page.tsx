"use client";

/**
 * District Events V2 — Edit Event.
 *
 * Same data semantics as v1 (src/app/districts/[id]/district-events/[eventId]/edit/page.tsx):
 * every field, every API call, every validation rule preserved verbatim
 * (title English-only ≤50, description English-only — no length check on edit,
 * eventDate required, at least one photo, per-photo description ≤500, and the
 * date-crossed-year "move" flow). Only the chrome changes — wrapped in
 * DistrictAdminShell + V2FormShell with the dot-accented section cards used
 * by every other v2 form.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation.
 * `?yearId=` is a SEPARATE query param (year-wise routing key), unrelated to
 * returnTo — it identifies which rotary-year table the event lives in.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Upload, X, FileText, Image as ImageIcon, Info,
} from "lucide-react";
import {
  getDistrict,
  getDistrictEventDetail,
  updateDistrictEventItem,
  moveDistrictEvent,
  uploadDistrictEventPhoto,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictFoundationTabBar from "@/components/dashboard/DistrictFoundationTabBar";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const MAX_PHOTOS = 5;

// Event photos render as landscape tiles here and in the district website
// gallery — locked to 4:3 at 1200×900.
const PHOTO_ASPECT = 4 / 3;
const PHOTO_MAX_WIDTH = 1200;

const TOP_MESSAGE =
  "Please post all the Events executed by your District. The content posted here will be displayed on the District website.";

function FieldLabel({
  children, hint, dot, required = true,
}: {
  children: React.ReactNode; hint?: string; dot: string; required?: boolean;
}) {
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

export default function DistrictEventsV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const eventId = Number(params.eventId);
  const yearId = Number(searchParams.get("yearId")) || 0;
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
    getDistrict(districtId)
      .then((d) => setDistrictName(`District ${d.districtNumber}`))
      .catch(() => {});
  }, [districtId]);

  useEffect(() => {
    async function load() {
      try {
        const res = await getDistrictEventDetail(districtId, yearId, eventId);
        const evt = res.eventDetail;
        setTitle(evt.title || "");
        setDescription(evt.description || "");
        // Slice the raw ISO string instead of round-tripping through Date/UTC
        // so the calendar date the user picked is preserved verbatim in any
        // timezone. Matches the projects v2 edit page fix.
        if (evt.eventDate) setEventDate(String(evt.eventDate).slice(0, 10));
        if (res.photos) {
          setPhotos(
            res.photos.map((ph: { imagePath: string; description?: string | null }) => ({
              path: ph.imagePath,
              preview: `${API_URL}${ph.imagePath}`,
              description: ph.description || "",
            }))
          );
        }
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } | string } };
        if (e?.response?.status === 403) {
          setErrorMessage("You don't have permission to edit events for this district.");
        } else {
          const msg = typeof e?.response?.data === "string"
            ? e.response.data
            : e?.response?.data?.message;
          setErrorMessage(msg || "Failed to load event.");
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [districtId, yearId, eventId]);

  const handleCroppedPhoto = async (blob: Blob) => {
    const file = new File([blob], `district-event-${Date.now()}.png`, { type: "image/png" });
    setUploading(true);
    try {
      const res = await uploadDistrictEventPhoto(districtId, file, false);
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
    if (!eventDate) { setErrorMessage("Date is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least one photo is required."); return; }
    if (uploading) { setErrorMessage("Please wait for photo to finish uploading."); return; }

    const saveData = {
      title: title.trim(),
      description: description.trim() || null,
      eventDate,
      photos: photos.map((p, i) => ({
        imagePath: p.path,
        description: p.description.trim() || null,
        isPrimary: i === 0,
        sortOrder: i,
      })),
    };

    setSaving(true);
    try {
      const moveInfo = await updateDistrictEventItem(districtId, yearId, eventId, saveData);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          const moved = await moveDistrictEvent(districtId, moveInfo.fromYearId, eventId, saveData);
          window.alert(`Event moved to ${moved.newYearLabel}.`);
          router.push(`/districts/${districtId}/district-events/v2`);
        }
        setSaving(false);
        return;
      }
      setSuccessMessage("Event updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      if (e?.response?.status === 403) {
        setErrorMessage("You don't have permission to edit events for this district.");
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
          pageTitle="Edit District Event"
          activeNavHref="/district-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Edit District Event"
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <div className="mb-4">
          <DistrictFoundationTabBar />
        </div>
        <V2FormShell
          title="Edit District Event"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/district-events/v2`}
          saving={saving}
          saveLabel="Update Event"
          saveTone="bg-[#F7A81B] text-[#1e3a5f] hover:bg-[#e69a10]"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Event Details */}
          <SectionCard number={1} icon={FileText} title="Event Details" dot="bg-blue-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 50 chars)" dot="bg-blue-500">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 1000 chars)" dot="bg-blue-500" required={false}>Description</FieldLabel>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Event description"
                  rows={4}
                  maxLength={1000}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Date</FieldLabel>
                <DateField value={eventDate} onChange={setEventDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </SectionCard>

          {/* 2. Photos */}
          <SectionCard number={2} icon={ImageIcon} title={`Photos (max ${MAX_PHOTOS}, at least 1 mandatory)`} dot="bg-emerald-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="relative w-full h-40 group bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="absolute top-1 right-1 bg-rose-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="p-3 space-y-1">
                    <textarea
                      value={photo.description}
                      onChange={(e) => {
                        if (e.target.value.length <= 500) updatePhotoDescription(idx, e.target.value);
                      }}
                      placeholder="Photo description (max 500 chars)"
                      rows={3}
                      maxLength={500}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                    <p className="text-xs text-slate-400 text-right">{photo.description.length}/500</p>
                  </div>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-slate-50 transition-colors h-40 text-slate-500"
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
                </button>
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
            description={successMessage || "Event updated successfully."}
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
