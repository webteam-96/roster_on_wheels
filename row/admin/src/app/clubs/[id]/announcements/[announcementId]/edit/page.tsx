"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import {
  getClub,
  getAnnouncement,
  updateAnnouncement,
  uploadAnnouncementImage,
  getClubCreditBalance,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X,
  FileText, Send, Bell, Plus, Trash2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import { toLocalDateParts } from "@/lib/dateUtils";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";

// The attached image is shown as a landscape poster on the detail view and is
// pushed out with email notifications — locked to 4:3 at 1200×900.
const IMAGE_ASPECT = 4 / 3;
const IMAGE_MAX_WIDTH = 1200;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function Req({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <Label className="text-sm font-semibold text-foreground">
      {children}<span className="text-destructive ml-0.5">*</span>
      {hint && <span className="text-muted-foreground font-normal ml-1">{hint}</span>}
    </Label>
  );
}

function OptLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-sm font-semibold text-foreground">{children}</Label>
  );
}

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

type ReminderItem = {
  id: string;
  date: string;
  time: string;
};

export default function AnnouncementEditPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const announcementId = Number(params.announcementId);

  const [clubName, setClubName] = useState("");
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

  // Track original dates to allow existing past dates
  const [originalPublishDateTime, setOriginalPublishDateTime] = useState("");
  const [originalExpiryDateTime, setOriginalExpiryDateTime] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function init() {
      try {
        const [club, ann] = await Promise.all([
          getClub(clubId),
          getAnnouncement(clubId, announcementId),
        ]);
        setClubName(club.clubName);

        setTitle(ann.title || "");
        setDescription(ann.description || "");
        setImagePath(ann.imagePath || null);
        if (ann.imagePath) {
          setImagePreview(`${API_URL}${ann.imagePath}`);
        }

        // Split publishDateTime into date and time parts
        if (ann.publishDateTime) {
          const { date: pd, time: pt } = toLocalDateParts(ann.publishDateTime);
          setPublishDate(pd);
          setPublishTime(pt);
          setOriginalPublishDateTime(`${pd}T${pt}:00`);
        }

        if (ann.expiryDateTime) {
          const { date: ed, time: et } = toLocalDateParts(ann.expiryDateTime);
          setExpiryDate(ed);
          setExpiryTime(et);
          setOriginalExpiryDateTime(`${ed}T${et}:00`);
        }

        setIsDisplayOnBanner(ann.isDisplayOnBanner);
        setIsSendEmail(ann.isSendEmail ?? false);
        setIsRepeatNotification(ann.isRepeatNotification);

        if (ann.reminders && ann.reminders.length > 0) {
          setReminders(ann.reminders.map(r => {
            const { date, time } = toLocalDateParts(r.reminderDateTime);
            return { id: String(r.id), date, time };
          }));
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load announcement.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, announcementId]);

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
    const file = new File([blob], `announcement-${Date.now()}.png`, { type: "image/png" });
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const result = await uploadAnnouncementImage(clubId, file);
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
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    const publishDTStr = `${publishDate}T${publishTime}:00`;
    const publishDT = new Date(publishDTStr);
    // Only validate past date if the datetime was changed from original
    if (publishDTStr !== originalPublishDateTime && publishDT < new Date()) {
      setErrorMessage("Publish Date & Time cannot be in the past."); return;
    }
    if (!expiryDate || !expiryTime) { setErrorMessage("Expiry Date & Time is required."); return; }
    const expiryDTStr = `${expiryDate}T${expiryTime}:00`;
    const expiryDT = new Date(expiryDTStr);
    if (expiryDTStr !== originalExpiryDateTime && expiryDT < new Date()) {
      setErrorMessage("Expiry Date & Time cannot be in the past."); return;
    }
    if (expiryDT < publishDT) { setErrorMessage("Expiry Date & Time must be on or after Publish Date & Time."); return; }
    if (imageUploading) { setErrorMessage("Please wait for image to finish uploading."); return; }

    // Validate reminder date/time must be after publish and before expiry
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
      ? reminders.filter(r => r.date && r.time).map(r => `${r.date}T${r.time}:00`)
      : null;

    setSaving(true);
    try {
      await updateAnnouncement(clubId, announcementId, {
        title: title.trim(),
        description: description.trim() || null,
        imagePath,
        publishDateTime: publishDTStr,
        expiryDateTime: expiryDTStr,
        isDisplayOnBanner,
        isSendEmail,
        isRepeatNotification,
        reminders: reminderStrings,
      });
      setSuccessMessage("Announcement updated successfully.");
      setTimeout(() => router.push(`/clubs/${clubId}/announcements`), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update announcement.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/announcements`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Announcement</h2>
            <p className="text-muted-foreground text-base">{clubName}</p>
          </div>
        </div>

        {/* 1. Announcement Details */}
        <Section icon={FileText} title="Announcement Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars)">Title</Req>
              <Input value={title} onChange={handleTitleChange} placeholder="Announcement title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <OptLabel>Description <span className="text-muted-foreground font-normal text-xs">(max 520 chars)</span></OptLabel>
              <Textarea value={description} onChange={handleDescriptionChange} placeholder="Describe the announcement..." rows={4} maxLength={520} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/520</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <OptLabel>Image</OptLabel>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="Announcement" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border" />
                  {imageUploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                      <RotaryLoader size="sm" />
                    </div>
                  )}
                  <button onClick={removeImage} className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg hover:border-primary/40 transition-colors text-muted-foreground"
                  >
                    <Upload className="h-4 w-4" />
                    <span className="text-sm">Upload announcement image</span>
                  </button>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
              )}
              <input ref={imageInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) imageCrop.startCrop(f); e.target.value = ""; }} />
              {imageCrop.error && <p className="text-xs text-destructive mt-1">{imageCrop.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Req>Publish Date</Req>
              <DateField value={publishDate} onChange={setPublishDate} />
            </div>
            <div className="space-y-1.5">
              <Req>Publish Time</Req>
              <Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Req>Expiry Date</Req>
              <DateField value={expiryDate} onChange={setExpiryDate} />
            </div>
            <div className="space-y-1.5">
              <Req>Expiry Time</Req>
              <Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} />
            </div>
          </div>
        </Section>

        {/* 2. Display & Notification Settings */}
        <Section icon={Bell} title="Display & Notification Settings" number={2}>
          <div className="space-y-4">
            {/* "Display on Banner" hidden 2026-08-12 per request — kept for future use (value still saved). */}
            {false && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isDisplayOnBanner}
                onChange={(e) => setIsDisplayOnBanner(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Is Display On Banner</span>
            </label>
            )}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isSendEmail}
                onChange={(e) => setIsSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Notify members via Email</span>
              {isSendEmail && <RecipientBadge scope="club" clubId={clubId} reminderCount={reminders.length} />}
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isRepeatNotification}
                onChange={(e) => {
                  setIsRepeatNotification(e.target.checked);
                  if (!e.target.checked) setReminders([]);
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Do you want to Repeat Notification?</span>
            </label>

            {isRepeatNotification && (
              <div className="space-y-3 pl-7">
                {reminders.map((reminder) => (
                  <div key={reminder.id} className="flex items-center gap-3">
                    <DateField value={reminder.date} onChange={(v: string) => updateReminder(reminder.id, "date", v)} className="w-40" />
                    <Input
                      type="time"
                      value={reminder.time}
                      onChange={(e) => updateReminder(reminder.id, "time", e.target.value)}
                      className="w-36"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeReminder(reminder.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addReminder}>
                  <Plus className="mr-2 h-4 w-4" />Add Reminder
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* Save Button */}
        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Announcement</>}
          </Button>
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
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/clubs/${clubId}/announcements`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
