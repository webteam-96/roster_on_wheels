"use client";

/**
 * Upcoming Events v2 — Edit Event.
 *
 * Same data semantics as the v1 edit page: every field, every API call, every
 * validation rule is preserved verbatim (including the "originalDate grace"
 * so existing past dates are allowed when unchanged). Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, Plus, Trash2, FileText, Bell, Image as ImageIcon,
} from "@/components/icons";
import {
  getClub,
  getUpcomingEvent,
  updateUpcomingEvent,
  uploadUpcomingEventImage,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

import { RemoveBadgeButton } from "@/components/ui/text-buttons"
// The attached image is shown as a landscape poster on the detail view and is
// pushed out with email notifications — locked to 4:3 at 1200×900.
const IMAGE_ASPECT = 4 / 3;
const IMAGE_MAX_WIDTH = 1200;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

type ReminderItem = {
  id: string;
  date: string;
  time: string;
};

export default function UpcomingEventsV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const eventId = Number(params.eventId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/upcoming-events/v2`);

  const [clubName, setClubName] = useState("");
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

  // Track original dates to allow existing past dates (only block future moves into the past).
  const [originalEventDate, setOriginalEventDate] = useState("");
  const [originalPublishDate, setOriginalPublishDate] = useState("");
  const [originalExpiryDate, setOriginalExpiryDate] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const formatForInput = (dt: string) => {
    if (!dt) return "";
    const d = new Date(dt);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => {
    async function init() {
      try {
        const [club, evt] = await Promise.all([
          getClub(clubId),
          getUpcomingEvent(clubId, eventId),
        ]);
        setClubName(club.clubName);

        setTitle(evt.title || "");
        setDescription(evt.description || "");
        setImagePath(evt.imagePath || null);
        if (evt.imagePath) setImagePreview(`${API_URL}${evt.imagePath}`);

        const ed = formatForInput(evt.eventDate || "");
        const pd = formatForInput(evt.publishDate || "");
        const xd = formatForInput(evt.expiryDate || "");
        setEventDate(ed);
        setPublishDate(pd);
        setExpiryDate(xd);
        setOriginalEventDate(ed);
        setOriginalPublishDate(pd);
        setOriginalExpiryDate(xd);

        setEventVenue(evt.eventVenue || "");
        setRegistrationLink(evt.registrationLink || "");
        setIsSendEmail(evt.isSendEmail);
        setIsRepeatNotification(evt.isRepeatNotification);

        if (evt.reminders && evt.reminders.length > 0) {
          setReminders(evt.reminders.map((r) => {
            const dt = new Date(r.reminderDateTime);
            const pad = (n: number) => String(n).padStart(2, "0");
            return {
              id: String(r.id),
              date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
              time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
            };
          }));
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load event.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, eventId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) setTitle(val);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) setDescription(val);
  };

  const handleCroppedImage = async (blob: Blob) => {
    const file = new File([blob], `event-${Date.now()}.png`, { type: "image/png" });
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const result = await uploadUpcomingEventImage(clubId, file);
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
    if (!eventDate) { setErrorMessage("Event Date is required."); return; }
    // Only validate past date if the date was changed from original
    if (eventDate !== originalEventDate && new Date(eventDate) < new Date()) {
      setErrorMessage("Event Date cannot be in the past."); return;
    }
    if (!publishDate) { setErrorMessage("Publish Date is required."); return; }
    if (publishDate !== originalPublishDate && new Date(publishDate) < new Date()) {
      setErrorMessage("Publish Date cannot be in the past."); return;
    }
    if (new Date(publishDate) > new Date(eventDate)) { setErrorMessage("Publish Date must be on or before Event Date."); return; }
    if (!expiryDate) { setErrorMessage("Expiry Date is required."); return; }
    if (expiryDate !== originalExpiryDate && new Date(expiryDate) < new Date()) {
      setErrorMessage("Expiry Date cannot be in the past."); return;
    }
    if (new Date(expiryDate) < new Date(eventDate)) { setErrorMessage("Expiry Date must be on or after Event Date."); return; }
    if (new Date(expiryDate) < new Date(publishDate)) { setErrorMessage("Expiry Date must be on or after Publish Date."); return; }
    if (imageUploading) { setErrorMessage("Please wait for image to finish uploading."); return; }

    // Repeat Notification requires at least one complete reminder (date + time).
    if (isRepeatNotification) {
      const validReminders = reminders.filter((r) => r.date && r.time);
      if (validReminders.length === 0) {
        setErrorMessage("Please add at least one reminder, or uncheck Repeat Notification.");
        return;
      }
    }

    // Validate reminder date/time must be after publish date and before event date
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
      ? reminders.filter((r) => r.date && r.time).map((r) => `${r.date}T${r.time}:00`)
      : null;

    setSaving(true);
    try {
      await updateUpcomingEvent(clubId, eventId, {
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
      setSuccessMessage("Event updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update event.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Event"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <V2FormShell
        title="Edit Event"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/upcoming-events/v2`}
        saving={saving}
        saveLabel="Update Event"
        onSave={handleSave}
      >
        <div>
        <div className="min-w-0">
        {/* 1. Event Details */}
        <SectionCard number={1} icon={FileText} title="Event Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" required>Title</FieldLabel>
              <Input
                type="text"
                value={title}
                onChange={handleTitleChange}
                placeholder="Event title"
                maxLength={50}
                
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 450 chars)">Description</FieldLabel>
              <Textarea
                value={description}
                onChange={handleDescriptionChange}
                placeholder="Describe the event…"
                rows={4}
                maxLength={450}
                
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/450</p>
            </div>
            <div>
              <FieldLabel required>Event Date</FieldLabel>
              <Input
                type="datetime-local"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                
              />
            </div>
            <div>
              <FieldLabel required>Publish Date</FieldLabel>
              <Input
                type="datetime-local"
                value={publishDate}
                onChange={(e) => setPublishDate(e.target.value)}
                
              />
            </div>
            <div>
              <FieldLabel required>Expiry Date</FieldLabel>
              <Input
                type="datetime-local"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                
              />
            </div>
            <div>
              <FieldLabel hint="(max 70 chars)">Event Venue</FieldLabel>
              <Input
                type="text"
                value={eventVenue}
                onChange={(e) => setEventVenue(e.target.value)} maxLength={70}
                placeholder="Venue name or address"
                
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{eventVenue.length}/70</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Registration Link</FieldLabel>
              <Input
                type="text"
                value={registrationLink}
                onChange={(e) => setRegistrationLink(e.target.value)}
                placeholder="https://www.google.com/"
                
              />
            </div>
          </div>
        </SectionCard>

        {/* 2. Image */}
        <SectionCard number={2} icon={ImageIcon} title="Image">
          <FieldLabel>Event Image</FieldLabel>
          {imagePreview ? (
            <div className="relative inline-block mt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Event" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border border-slate-200" />
              {imageUploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                  <RotaryLoader size="sm" />
                </div>
              )}
              <RemoveBadgeButton
                type="button"
                onClick={removeImage}
                aria-label="Remove image" />
            </div>
          ) : (
            <div>
              <Button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="h-auto py-3 border-dashed" variant="outline">
                <Upload className="h-4 w-4" />
                <span className="text-sm">Upload event image</span>
              </Button>
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

        {/* 3. Notification Settings */}
        <SectionCard number={3} icon={Bell} title="Notification Settings">
          <div className="space-y-3">
            <label className="flex w-fit items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isSendEmail}
                onChange={(e) => setIsSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Notify members via Email</span>
              {isSendEmail && <RecipientBadge scope="club" clubId={clubId} reminderCount={reminders.length} />}
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
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">Repeat Notification</span>
            </label>

            {isRepeatNotification && (
              <div className="space-y-3 pl-7 pt-1">
                {reminders.map((reminder, idx) => (
                  <div key={reminder.id} className="flex flex-wrap items-center gap-2">
                    <DateField value={reminder.date} onChange={(v: string) => updateReminder(reminder.id, "date", v)} className="row-field w-40" />
                    <Input
                      type="time"
                      value={reminder.time}
                      onChange={(e) => updateReminder(reminder.id, "time", e.target.value)}
                      className="w-32"
                    />
                    {/* Show delete even for a single reminder so one added by mistake can be removed. */}
                    {reminders.length > 0 && (
                      <IconButton
                        type="button"
                        onClick={() => removeReminder(reminder.id)}
                        className="hover:text-red-700"
                        aria-label="Remove reminder"
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    )}
                    {idx === reminders.length - 1 && (
                      <IconButton
                        type="button"
                        onClick={addReminder}
                        title="Add another reminder"
                        aria-label="Add reminder"
                        
                      >
                        <Plus className="h-4 w-4" />
                      </IconButton>
                    )}
                  </div>
                ))}
                {/* When every reminder has been removed, keep a way to add one back
                    (the inline "+" lives inside the last row, which no longer renders). */}
                {reminders.length === 0 && (
                  <Button
                    type="button"
                    onClick={addReminder}
                    variant="outline" size="sm"
                  >
                    <Plus className="h-4 w-4" /> Add reminder
                  </Button>
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
          description={successMessage || "Event updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
