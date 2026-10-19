"use client";

/**
 * District Upcoming Events V2 — Add Event.
 *
 * Same data semantics as v1 (src/app/districts/[id]/upcoming-events/add/page.tsx):
 * every field, every API call, every validation rule preserved verbatim. Only
 * the chrome changes — wrapped in DistrictAdminShell + V2FormShell with the
 * dot-accented section cards used by every other v2 form.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation. The DA
 * Communication tab's District Events row click links here with
 * `?returnTo=/district-admin-dashboard/communication`.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, FileText, Bell, Plus, Trash2, Info,
} from "@/components/icons";
import {
  getDistrict,
  createDistrictUpcomingEvent,
  uploadDistrictUpcomingEventImage,
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

// The attached image is shown as a landscape poster on the detail view and is
// pushed out with email notifications — locked to 4:3 at 1200×900.
const IMAGE_ASPECT = 4 / 3;
const IMAGE_MAX_WIDTH = 1200;

const TOP_MESSAGE =
  "District events appear to all clubs in the district during the configured publish window. After the expiry date the event is archived but stays viewable in the listing.";

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

export default function DistrictUpcomingEventsV2AddPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/upcoming-events`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [eventVenue, setEventVenue] = useState("");
  const [registrationLink, setRegistrationLink] = useState("");
  const [isSendEmail, setIsSendEmail] = useState(false);
  const [isRepeatNotification, setIsRepeatNotification] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const now = new Date();
  const todayMin = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  useEffect(() => {
    async function init() {
      try {
        const district = await getDistrict(districtId);
        setDistrictName(`District ${district.districtNumber}`);
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

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) {
      setTitle(val);
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) {
      setDescription(val);
    }
  };

  const handleCroppedImage = async (blob: Blob) => {
    const file = new File([blob], `event-${Date.now()}.png`, { type: "image/png" });
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const result = await uploadDistrictUpcomingEventImage(districtId, file);
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
    setReminders(prev => [...prev, { id: Math.random().toString(36).substring(7), date: "", time: "" }]);
  };

  const updateReminder = (id: string, field: "date" | "time", value: string) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!eventDate) { setErrorMessage("Event Date is required."); return; }
    if (new Date(eventDate) < new Date()) { setErrorMessage("Event Date cannot be in the past."); return; }
    if (!publishDate) { setErrorMessage("Publish Date is required."); return; }
    if (new Date(publishDate) < new Date()) { setErrorMessage("Publish Date cannot be in the past."); return; }
    if (new Date(publishDate) > new Date(eventDate)) { setErrorMessage("Publish Date must be on or before Event Date."); return; }
    if (!expiryDate) { setErrorMessage("Expiry Date is required."); return; }
    if (new Date(expiryDate) < new Date()) { setErrorMessage("Expiry Date cannot be in the past."); return; }
    if (new Date(expiryDate) < new Date(eventDate)) { setErrorMessage("Expiry Date must be on or after Event Date."); return; }
    if (new Date(expiryDate) < new Date(publishDate)) { setErrorMessage("Expiry Date must be on or after Publish Date."); return; }
    if (imageUploading) { setErrorMessage("Please wait for image to finish uploading."); return; }

    // Repeat Notification requires at least one complete reminder (date + time).
    if (isRepeatNotification) {
      const validReminders = reminders.filter(r => r.date && r.time);
      if (validReminders.length === 0) {
        setErrorMessage("Please add at least one reminder, or uncheck Repeat Notification.");
        return;
      }
    }

    if (isRepeatNotification && reminders.length > 0) {
      const publishDateTime = new Date(publishDate);
      const eventDateTime = new Date(eventDate);
      for (const r of reminders) {
        if (r.date && r.time) {
          const reminderDT = new Date(`${r.date}T${r.time}:00`);
          if (reminderDT <= publishDateTime) {
            setErrorMessage("Repeat Notification date and time must be after the Publish Date.");
            return;
          }
          if (reminderDT >= eventDateTime) {
            setErrorMessage("Repeat Notification date and time must be before the Event Date.");
            return;
          }
        }
      }
    }

    const reminderStrings: string[] | null = isRepeatNotification && reminders.length > 0
      ? reminders.filter(r => r.date && r.time).map(r => `${r.date}T${r.time}:00`)
      : null;

    setSaving(true);
    try {
      await createDistrictUpcomingEvent(districtId, {
        title: title.trim(),
        description: description.trim() || null,
        imagePath,
        eventDate,
        publishDate,
        expiryDate,
        eventVenue: eventVenue.trim() || null,
        registrationLink: registrationLink.trim() || null,
        isSendEmail,
        isRepeatNotification,
        reminders: reminderStrings,
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
        setErrorMessage(msg || "Failed to save event.");
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
          activeNavHref="/district-admin-dashboard/communication"
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
        pageTitle="Add District Event"
        activeNavHref="/district-admin-dashboard/communication"
      >
        <div className="mb-4">
          <DistrictCommunicationTabBar />
        </div>
        <V2FormShell
          title="Add District Event"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/upcoming-events`}
          saving={saving}
          saveLabel="Save Event"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          <div className="">
          <div className="min-w-0">
          {/* 1. Event Details */}
          <SectionCard number={1} icon={FileText} title="Event Details" dot="bg-blue-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 50 chars)" dot="bg-blue-500">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Event title"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 450 chars)" dot="bg-blue-500" required={false}>Description</FieldLabel>
                <textarea
                  value={description}
                  onChange={handleDescriptionChange}
                  placeholder="Describe the event..."
                  rows={4}
                  maxLength={450}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/450</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-blue-500" required={false}>Image</FieldLabel>
                {imagePreview ? (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Event" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border" />
                    {imageUploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                        <RotaryLoader size="sm" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-red-500"
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
                      <span className="text-sm">Upload event image</span>
                    </button>
                    <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
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
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Event Date</FieldLabel>
                <input
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  min={todayMin}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Publish Date</FieldLabel>
                <input
                  type="datetime-local"
                  value={publishDate}
                  onChange={(e) => setPublishDate(e.target.value)}
                  min={todayMin}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Expiry Date</FieldLabel>
                <input
                  type="datetime-local"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  min={todayMin}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel hint="(max 70 chars)" dot="bg-blue-500" required={false}>Event Venue</FieldLabel>
                <input
                  type="text"
                  value={eventVenue}
                  onChange={(e) => setEventVenue(e.target.value)} maxLength={70}
                  placeholder="Venue name or address"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              <p className="text-xs text-slate-400 text-right mt-0.5">{eventVenue.length}/70</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-blue-500" required={false}>Registration Link</FieldLabel>
                <input
                  type="url"
                  value={registrationLink}
                  onChange={(e) => setRegistrationLink(e.target.value)}
                  placeholder="https://www.google.com/"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </SectionCard>

          {/* 2. Notification Settings */}
          <SectionCard number={2} icon={Bell} title="Notification Settings" dot="bg-emerald-600">
            <div className="space-y-4">
              <label className="flex w-fit items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSendEmail}
                  onChange={(e) => setIsSendEmail(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Notify members via Email</span>
                {isSendEmail && <RecipientBadge scope="district" districtId={districtId} reminderCount={reminders.length} />}
              </label>
              <label className="flex w-fit items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRepeatNotification}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsRepeatNotification(checked);
                    if (checked) {
                      // Add one default reminder so there's always at least one when enabled.
                      setReminders((prev) => prev.length === 0
                        ? [{ id: Math.random().toString(36).substring(7), date: "", time: "" }]
                        : prev);
                    } else {
                      setReminders([]);
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm font-medium text-slate-700">Do you want to Repeat Notification?</span>
              </label>

              {isRepeatNotification && (
                <div className="space-y-3 pl-7">
                  {reminders.map((reminder, idx) => (
                    <div key={reminder.id} className="flex items-center gap-3">
                      <DateField value={reminder.date} onChange={(v: string) => updateReminder(reminder.id, "date", v)} className="w-40 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      <input
                        type="time"
                        value={reminder.time}
                        onChange={(e) => updateReminder(reminder.id, "time", e.target.value)}
                        className="w-36 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      {/* Show delete even for a single reminder so one added by mistake can be removed. */}
                      {reminders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => removeReminder(reminder.id)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-rose-600 hover:bg-rose-50"
                          title="Remove reminder"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {idx === reminders.length - 1 && (
                        <button
                          type="button"
                          onClick={addReminder}
                          title="Add another reminder"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {/* When every reminder has been removed, keep a way to add one back
                      (the inline "+" lives inside the last row, which no longer renders). */}
                  {reminders.length === 0 && (
                    <button
                      type="button"
                      onClick={addReminder}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                    >
                      <Plus className="h-4 w-4" /> Add reminder
                    </button>
                  )}
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
            title="Crop Event Image"
            saving={imageUploading}
            onCancel={imageCrop.cancel}
            onSave={handleCroppedImage}
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
