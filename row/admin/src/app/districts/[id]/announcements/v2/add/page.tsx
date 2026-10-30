"use client";

/**
 * District Announcements v2 — Add Announcement.
 *
 * District-scoped mirror of src/app/clubs/[id]/announcements/v2/add/page.tsx.
 * Same fields, same validation rules, same data shape — only scope differs
 * (district instead of club) and chrome swaps ClubAdminShell for
 * DistrictAdminShell.
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, Plus, Trash2, FileText, Bell, Image as ImageIcon,
} from "@/components/icons";
import {
  getDistrict,
  createDistrictAnnouncement,
  uploadDistrictAnnouncementImage,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictCommunicationTabBar from "@/components/dashboard/DistrictCommunicationTabBar";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import { useAuth } from "@/contexts/AuthContext";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

// The attached image is shown as a landscape poster on the detail view and is
// pushed out with email notifications — locked to 4:3 at 1200×900.
const IMAGE_ASPECT = 4 / 3;
const IMAGE_MAX_WIDTH = 1200;

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

type ReminderItem = {
  id: string;
  date: string;
  time: string;
};

// Inline mirror of useSyncClubIdFromUrl for district scope. Kept here (not a
// shared hook) to match the pattern used by district upcoming-events v2.
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

export default function DistrictAnnouncementsV2AddPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/announcements`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [isDisplayOnBanner, setIsDisplayOnBanner] = useState(false);
  const [isSendEmail, setIsSendEmail] = useState(false);
  const [isRepeatNotification, setIsRepeatNotification] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function init() {
      try {
        const district = await getDistrict(districtId);
        setDistrictName(`District ${district.districtNumber}`);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } | string } };
        if (e?.response?.status === 403) {
          setErrorMessage("You don't have permission to add announcements for this district.");
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

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) setTitle(val);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) setDescription(val);
  };

  const handleCroppedImage = async (blob: Blob) => {
    const file = new File([blob], `announcement-${Date.now()}.png`, { type: "image/png" });
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const result = await uploadDistrictAnnouncementImage(districtId, file);
      setImagePath(result.path);
    } catch {
      setImagePreview(null);
      setImagePath(null);
      setErrorMessage("Failed to upload image.");
    } finally {
      setImageUploading(false);
      imageCrop.cancel();
    }
  };

  const removeImage = () => {
    setImagePath(null);
    setImagePreview(null);
  };

  const addReminder = () => {
    setReminders((prev) => [
      ...prev,
      { id: Math.random().toString(36).substring(7), date: "", time: "" },
    ]);
  };

  const updateReminder = (id: string, field: "date" | "time", value: string) => {
    setReminders((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeReminder = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    const publishDT = new Date(`${publishDate}T${publishTime}:00`);
    if (publishDT < new Date()) { setErrorMessage("Publish Date & Time cannot be in the past."); return; }
    if (!expiryDate || !expiryTime) { setErrorMessage("Expiry Date & Time is required."); return; }
    const expiryDT = new Date(`${expiryDate}T${expiryTime}:00`);
    if (expiryDT < new Date()) { setErrorMessage("Expiry Date & Time cannot be in the past."); return; }
    if (expiryDT < publishDT) { setErrorMessage("Expiry Date & Time must be on or after Publish Date & Time."); return; }
    if (imageUploading) { setErrorMessage("Please wait for image to finish uploading."); return; }

    if (isRepeatNotification && reminders.length > 0) {
      for (const r of reminders) {
        if (r.date && r.time) {
          const reminderDT = new Date(`${r.date}T${r.time}:00`);
          if (reminderDT <= publishDT) {
            setErrorMessage("Repeat Notification date and time must be after the Publish Date & Time.");
            return;
          }
          if (reminderDT >= expiryDT) {
            setErrorMessage("Repeat Notification date and time must be before the Expiry Date & Time.");
            return;
          }
        }
      }
    }

    const reminderStrings: string[] | null = isRepeatNotification && reminders.length > 0
      ? reminders.filter((r) => r.date && r.time).map((r) => `${r.date}T${r.time}:00`)
      : null;

    setSaving(true);
    try {
      await createDistrictAnnouncement(districtId, {
        title: title.trim(),
        description: description.trim() || null,
        imagePath,
        publishDateTime: `${publishDate}T${publishTime}:00`,
        expiryDateTime: `${expiryDate}T${expiryTime}:00`,
        isDisplayOnBanner,
        isSendEmail,
        isRepeatNotification,
        reminders: reminderStrings,
      });
      setSuccessMessage("Announcement created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      if (e?.response?.status === 403) {
        setErrorMessage("You don't have permission to add announcements for this district.");
      } else {
        const msg = typeof e?.response?.data === "string"
          ? e.response.data
          : e?.response?.data?.message;
        setErrorMessage(msg || "Failed to save announcement.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Add District Announcement"
          activeNavHref="/district-admin-dashboard/communication"
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
        pageTitle="Add District Announcement"
        activeNavHref="/district-admin-dashboard/communication"
      >
      <div className="mb-4">
        <DistrictCommunicationTabBar />
      </div>
      <V2FormShell
        title="Add District Announcement"
        subtitle={districtName}
        defaultBack={`/districts/${districtId}/announcements`}
        saving={saving}
        saveLabel="Save Announcement"
        onSave={handleSave}
      >
        <div className="">
        <div className="min-w-0">
        {/* 1. Announcement Details */}
        <SectionCard number={1} icon={FileText} title="Announcement Details" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" dot="bg-[#17458F]" required>Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={handleTitleChange}
                placeholder="Announcement title"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 520 chars)" dot="bg-[#17458F]">Description</FieldLabel>
              <textarea
                value={description}
                onChange={handleDescriptionChange}
                placeholder="Describe the announcement…"
                rows={4}
                maxLength={520}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/520</p>
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]" required>Publish Date</FieldLabel>
              <DateField value={publishDate} onChange={setPublishDate} min={today} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]" required>Publish Time</FieldLabel>
              <input
                type="time"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]" required>Expiry Date</FieldLabel>
              <DateField value={expiryDate} onChange={setExpiryDate} min={today} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]" required>Expiry Time</FieldLabel>
              <input
                type="time"
                value={expiryTime}
                onChange={(e) => setExpiryTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
          </div>
        </SectionCard>

        {/* 2. Image */}
        <SectionCard number={2} icon={ImageIcon} title="Image" dot="bg-[#17458F]">
          <FieldLabel dot="bg-[#17458F]">Announcement Image</FieldLabel>
          {imagePreview ? (
            <div className="relative inline-block mt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Announcement" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border border-slate-200" />
              {imageUploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                  <RotaryLoader size="sm" />
                </div>
              )}
              <button
                type="button"
                onClick={removeImage}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg hover:border-blue-300 transition-colors text-slate-500"
              >
                <Upload className="h-4 w-4" />
                <span className="text-sm">Upload announcement image</span>
              </button>
              <p className="text-xs text-slate-400 mt-1">JPG, JPEG, PNG, GIF, WEBP</p>
            </div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.gif,.webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) imageCrop.startCrop(f); e.target.value = ""; }}
          />
          {imageCrop.error && <p className="text-xs text-rose-600 mt-1">{imageCrop.error}</p>}
        </SectionCard>

        {/* 3. Display & Notification Settings */}
        <SectionCard number={3} icon={Bell} title="Display & Notification Settings" dot="bg-[#17458F]">
          <div className="space-y-3">
            {/* "Display on Banner" hidden 2026-08-12 per request — kept for future use (value still saved). */}
            {false && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isDisplayOnBanner}
                onChange={(e) => setIsDisplayOnBanner(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Display on Banner</span>
            </label>
            )}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isSendEmail}
                onChange={(e) => setIsSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Notify members via Email</span>
              {isSendEmail && <RecipientBadge scope="district" districtId={districtId} reminderCount={reminders.length} />}
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isRepeatNotification}
                onChange={(e) => {
                  setIsRepeatNotification(e.target.checked);
                  if (!e.target.checked) setReminders([]);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Repeat Notification</span>
            </label>

            {isRepeatNotification && (
              <div className="space-y-3 pl-7 pt-1">
                {reminders.map((reminder) => (
                  <div key={reminder.id} className="flex flex-wrap items-center gap-2">
                    <DateField value={reminder.date} onChange={(v: string) => updateReminder(reminder.id, "date", v)} className="w-40 px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
                    <input
                      type="time"
                      value={reminder.time}
                      onChange={(e) => updateReminder(reminder.id, "time", e.target.value)}
                      className="w-32 px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                    />
                    <button
                      type="button"
                      onClick={() => removeReminder(reminder.id)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded text-rose-500 hover:bg-rose-50"
                      aria-label="Remove reminder"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addReminder}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-10 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Reminder
                </button>
              </div>
            )}
          </div>
        </SectionCard>
        </div>

        </div>

        <ImageCropDialog
          open={imageCrop.open}
          imageSrc={imageCrop.imageSrc}
          aspect={IMAGE_ASPECT}
          allowOrientation
          maxOutputWidth={IMAGE_MAX_WIDTH}
          title="Crop Announcement Image"
          saving={imageUploading}
          onCancel={imageCrop.cancel}
          onSave={handleCroppedImage}
        />
        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Announcement created successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
