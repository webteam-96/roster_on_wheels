"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import { getRiDirectorUpcomingEvent, updateRiDirectorUpcomingEvent, uploadRiDirectorUpcomingEventImage } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Upload, X, CalendarClock, Send, Bell, Plus, Trash2, Users2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RiRecipientPicker, { RiRecipientValue } from "@/components/RiRecipientPicker";
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

function Req({ children }: { children: React.ReactNode }) { return <Label className="text-sm font-semibold">{children}<span className="text-destructive ml-0.5">*</span></Label>; }
function OptLabel({ children }: { children: React.ReactNode }) { return <Label className="text-sm font-semibold">{children}</Label>; }
function Section({ icon: Icon, title, number, children }: { icon: React.ElementType; title: string; number: number; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" /><h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

type ReminderItem = { id: string; date: string; time: string };

export default function RiDirectorUpcomingEventsEditPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = Number(params.eventId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [eventVenue, setEventVenue] = useState("");
  const [registrationLink, setRegistrationLink] = useState("");
  const [isSendEmail, setIsSendEmail] = useState(false);
  const [isRepeatNotification, setIsRepeatNotification] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [recipient, setRecipient] = useState<RiRecipientValue>({ target: "all", zoneIds: [], districtIds: [], subgroupIds: [] });

  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageCrop = useImageCropUpload();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    try {
      const d = await getRiDirectorUpcomingEvent(eventId);
      setTitle(d.title); setDescription(d.description || "");
      setImagePath(d.imagePath);
      if (d.imagePath) setImagePreview(`${API_URL}${d.imagePath}`);
      const setDT = (s: string, setD: (v: string) => void, setT: (v: string) => void) => {
        const { date, time } = toLocalDateParts(s);
        setD(date);
        setT(time);
      };
      if (d.eventDate) setDT(d.eventDate, setEventDate, setEventTime);
      if (d.publishDate) setDT(d.publishDate, setPublishDate, setPublishTime);
      if (d.expiryDate) setDT(d.expiryDate, setExpiryDate, setExpiryTime);
      setEventVenue(d.eventVenue || "");
      setRegistrationLink(d.registrationLink || "");
      setIsSendEmail(d.isSendEmail ?? false);
      setIsRepeatNotification(!!d.isRepeatNotification);
      const parseIds = (s: string | null | undefined): number[] => !s ? [] : s.split(",").map(x => parseInt(x.trim())).filter(x => !isNaN(x));
      setRecipient({ target: (d.recipientTarget as any) || "all", zoneIds: parseIds(d.recipientZoneIds), districtIds: parseIds(d.recipientDistrictIds), subgroupIds: parseIds(d.recipientSubgroupIds) });
      if (d.reminders?.length > 0) {
        setReminders(d.reminders.map((r: { reminderDateTime: string }) => {
          const { date, time } = toLocalDateParts(r.reminderDateTime);
          return { id: Math.random().toString(36).substring(7), date, time };
        }));
      }
    } catch { setErrorMessage("Failed to load event."); }
    finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleCroppedImage = async (blob: Blob) => {
    const file = new File([blob], `event-${Date.now()}.png`, { type: "image/png" });
    setImagePreview(URL.createObjectURL(file)); setImageUploading(true);
    try { const r = await uploadRiDirectorUpcomingEventImage(file); setImagePath(r.path); }
    catch { setImagePreview(null); setImagePath(null); setErrorMessage("Failed to upload image."); }
    finally { setImageUploading(false); imageCrop.cancel(); }
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (!eventDate || !eventTime || !publishDate || !publishTime || !expiryDate || !expiryTime) { setErrorMessage("All dates are required."); return; }
    if (recipient.target === "zones" && recipient.zoneIds.length === 0) { setErrorMessage("Select at least one zone."); return; }
    if (recipient.target === "districts" && recipient.districtIds.length === 0) { setErrorMessage("Select at least one district."); return; }
    if (recipient.target === "subgroups" && recipient.subgroupIds.length === 0) { setErrorMessage("Select at least one sub group."); return; }
    if (imageUploading) { setErrorMessage("Please wait for image upload."); return; }


    const reminderStrings = isRepeatNotification && reminders.length > 0
      ? reminders.filter(r => r.date && r.time).map(r => `${r.date}T${r.time}:00`)
      : null;

    setSaving(true);
    try {
      await updateRiDirectorUpcomingEvent(eventId, {
        title: title.trim(),
        description: description.trim() || null,
        imagePath,
        eventDate: new Date(`${eventDate}T${eventTime}:00`).toISOString(),
        publishDate: new Date(`${publishDate}T${publishTime}:00`).toISOString(),
        expiryDate: new Date(`${expiryDate}T${expiryTime}:00`).toISOString(),
        eventVenue: eventVenue.trim() || null,
        registrationLink: registrationLink.trim() || null,
        isSendEmail,
        isRepeatNotification,
        reminders: reminderStrings,
        recipientTarget: recipient.target,
        recipientZoneIds: recipient.zoneIds,
        recipientDistrictIds: recipient.districtIds,
        recipientSubgroupIds: recipient.subgroupIds,
      });
      setSuccessMessage("Event updated successfully.");
      setTimeout(() => router.push("/ri-director/upcoming-events"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to update event."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/upcoming-events"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div><h2 className="text-2xl font-bold tracking-tight text-primary">Edit Event</h2><p className="text-muted-foreground">RI Director</p></div>
        </div>

        <Section icon={CalendarClock} title="Event Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5"><Req>Title</Req><Input value={title} onChange={(e) => TEXT_INPUT_REGEX.test(e.target.value) && setTitle(e.target.value)} maxLength={50} /></div>
            <div className="sm:col-span-2 space-y-1.5"><OptLabel>Description</OptLabel><Textarea value={description} onChange={(e) => TEXT_INPUT_REGEX.test(e.target.value) && setDescription(e.target.value)} rows={4} maxLength={1000} /></div>
            <div className="sm:col-span-2 space-y-2">
              <OptLabel>Image</OptLabel>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="" className="h-32 w-auto max-w-[16rem] object-contain rounded-lg border" />
                  {imageUploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg"><RotaryLoader size="sm" /></div>}
                  <button onClick={() => { setImagePath(null); setImagePreview(null); }} className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white"><X className="h-3 w-3" /></button>
                </div>
              ) : (
                <div>
                  <button onClick={() => imageInputRef.current?.click()} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-muted-foreground">
                    <Upload className="h-4 w-4" /><span className="text-sm">Upload event image</span>
                  </button>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
              )}
              <input ref={imageInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) imageCrop.startCrop(f); e.target.value = ""; }} />
              {imageCrop.error && <p className="text-xs text-destructive mt-1">{imageCrop.error}</p>}
            </div>
            <div className="space-y-1.5"><Req>Event Date</Req><DateField value={eventDate} onChange={setEventDate} min={today} /></div>
            <div className="space-y-1.5"><Req>Event Time</Req><Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} /></div>
            <div className="space-y-1.5"><Req>Publish Date</Req><DateField value={publishDate} onChange={setPublishDate} min={today} /></div>
            <div className="space-y-1.5"><Req>Publish Time</Req><Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} /></div>
            <div className="space-y-1.5"><Req>Expiry Date</Req><DateField value={expiryDate} onChange={setExpiryDate} min={today} /></div>
            <div className="space-y-1.5"><Req>Expiry Time</Req><Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} /></div>
            <div className="sm:col-span-2 space-y-1.5"><OptLabel>Venue</OptLabel><Input value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} maxLength={255} /></div>
            <div className="sm:col-span-2 space-y-1.5"><OptLabel>Registration Link</OptLabel><Input type="url" value={registrationLink} onChange={(e) => setRegistrationLink(e.target.value)} /></div>
          </div>
        </Section>

        <Section icon={Users2} title="Recipients" number={2}>
          <RiRecipientPicker value={recipient} onChange={setRecipient} />
        </Section>

        <Section icon={Bell} title="Notification Settings" number={3}>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isSendEmail}
                onChange={(e) => setIsSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Notify members via Email</span>
              {isSendEmail && <RecipientBadge scope="ri" target={recipient.target} zoneIds={recipient.zoneIds} districtIds={recipient.districtIds} subgroupIds={recipient.subgroupIds} reminderCount={reminders.length} />}
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isRepeatNotification} onChange={(e) => { setIsRepeatNotification(e.target.checked); if (!e.target.checked) setReminders([]); }} className="h-4 w-4" />
              <span className="text-sm font-medium">Repeat Notification</span>
            </label>
            {isRepeatNotification && (
              <div className="space-y-3 pl-7">
                {reminders.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <DateField value={r.date} onChange={(v: string) => setReminders(p => p.map(x => x.id === r.id ? { ...x, date: v } : x))} className="w-40" />
                    <Input type="time" value={r.time} onChange={(e) => setReminders(p => p.map(x => x.id === r.id ? { ...x, time: e.target.value } : x))} className="w-36" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setReminders(p => p.filter(x => x.id !== r.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setReminders(p => [...p, { id: Math.random().toString(36).substring(7), date: "", time: "" }])}><Plus className="mr-2 h-4 w-4" />Add Reminder</Button>
              </div>
            )}
          </div>
        </Section>

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
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/upcoming-events")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
