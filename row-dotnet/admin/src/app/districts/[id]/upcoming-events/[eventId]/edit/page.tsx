"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import {
  getDistrict,
  getDistrictUpcomingEvent,
  updateDistrictUpcomingEvent,
  uploadDistrictUpcomingEventImage,
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
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import WhatsAppRecipientBadge from "@/components/WhatsAppRecipientBadge";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// The attached image is shown as a landscape poster on the detail view and is
// pushed out with WhatsApp/email notifications — locked to 4:3 at 1200×900.
const IMAGE_ASPECT = 4 / 3;
const IMAGE_MAX_WIDTH = 1200;

const ENGLISH_ONLY_REGEX = /^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/;

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

export default function DistrictUpcomingEventEditPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const eventId = Number(params.eventId);

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
  const [isSendWhatsapp, setIsSendWhatsapp] = useState(false);
  const [isSendEmail, setIsSendEmail] = useState(false);
  const [isRepeatNotification, setIsRepeatNotification] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  const [originalEventDate, setOriginalEventDate] = useState("");
  const [originalPublishDate, setOriginalPublishDate] = useState("");
  const [originalExpiryDate, setOriginalExpiryDate] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const now = new Date();
  const todayMin = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const formatForInput = (dt: string) => {
    if (!dt) return "";
    const d = new Date(dt);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => {
    async function init() {
      try {
        const [district, evt] = await Promise.all([
          getDistrict(districtId),
          getDistrictUpcomingEvent(districtId, eventId),
        ]);
        setDistrictName(`District ${district.districtNumber}`);

        setTitle(evt.title || "");
        setDescription(evt.description || "");
        setImagePath(evt.imagePath || null);
        if (evt.imagePath) {
          setImagePreview(`${API_URL}${evt.imagePath}`);
        }

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
        setIsSendWhatsapp(evt.isSendWhatsapp);
        setIsSendEmail(evt.isSendEmail ?? false);
        setIsRepeatNotification(evt.isRepeatNotification);

        if (evt.reminders && evt.reminders.length > 0) {
          setReminders(evt.reminders.map((r: any) => {
            const dt = new Date(r.reminderDateTime);
            const pad = (n: number) => String(n).padStart(2, "0");
            return {
              id: String(r.id),
              date: `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`,
              time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
            };
          }));
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load event.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId, eventId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (ENGLISH_ONLY_REGEX.test(val)) {
      setTitle(val);
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (ENGLISH_ONLY_REGEX.test(val)) {
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
      await updateDistrictUpcomingEvent(districtId, eventId, {
        title: title.trim(),
        description: description.trim() || null,
        imagePath,
        eventDate,
        publishDate,
        expiryDate,
        eventVenue: eventVenue.trim() || null,
        registrationLink: registrationLink.trim() || null,
        isSendWhatsapp,
        isSendEmail,
        isRepeatNotification,
        reminders: reminderStrings,
      });
      setSuccessMessage("Event updated successfully.");
      setTimeout(() => router.push(`/districts/${districtId}/upcoming-events`), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update event.");
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
            <Link href={`/districts/${districtId}/upcoming-events`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Event</h2>
            <p className="text-muted-foreground text-base">{districtName}</p>
          </div>
        </div>

        {/* 1. Event Details */}
        <Section icon={FileText} title="Event Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars, English only)">Title</Req>
              <Input value={title} onChange={handleTitleChange} placeholder="Event title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <OptLabel>Description <span className="text-muted-foreground font-normal text-xs">(max 450 chars, English only)</span></OptLabel>
              <Textarea value={description} onChange={handleDescriptionChange} placeholder="Describe the event..." rows={4} maxLength={450} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/450</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <OptLabel>Image</OptLabel>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="Event" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border" />
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
                    <span className="text-sm">Upload event image</span>
                  </button>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
              )}
              <input ref={imageInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) imageCrop.startCrop(f); e.target.value = ""; }} />
              {imageCrop.error && <p className="text-xs text-destructive mt-1">{imageCrop.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Req>Event Date</Req>
              <Input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Req>Publish Date</Req>
              <Input type="datetime-local" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Req>Expiry Date</Req>
              <Input type="datetime-local" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <OptLabel>Event Venue <span className="text-muted-foreground font-normal text-xs">(max 70 chars)</span></OptLabel>
              <Input value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} maxLength={70} placeholder="Venue name or address" />
              <p className="text-xs text-slate-400 text-right mt-0.5">{eventVenue.length}/70</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <OptLabel>Registration Link</OptLabel>
              <Input value={registrationLink} onChange={(e) => setRegistrationLink(e.target.value)} placeholder="https://www.google.com/" />
            </div>
          </div>
        </Section>

        {/* 2. Notification Settings */}
        <Section icon={Bell} title="Notification Settings" number={2}>
          <div className="space-y-4">
            {/* WhatsApp notify checkbox hidden 2026-09-07 per request — re-enable later. Value still submits (default off). */}
            {false && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isSendWhatsapp} onChange={(e) => setIsSendWhatsapp(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <span className="text-sm font-medium">Notify members via WhatsApp</span>
              {isSendWhatsapp && <WhatsAppRecipientBadge scope="district" districtId={districtId} reminderCount={reminders.length} />}
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
              {isSendEmail && <WhatsAppRecipientBadge channel="email" scope="district" districtId={districtId} reminderCount={reminders.length} />}
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
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Event</>}
          </Button>
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
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/districts/${districtId}/upcoming-events`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
