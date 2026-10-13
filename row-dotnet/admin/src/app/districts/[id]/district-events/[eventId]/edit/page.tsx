"use client";
import { useState, useEffect } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getDistrict, getDistrictEventDetail, updateDistrictEventItem, moveDistrictEvent, uploadDistrictEventPhoto } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Upload, X, Send, Info } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { toLocalDateParts } from "@/lib/dateUtils";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";

// Event photos render as landscape tiles here and in the district website
// gallery — locked to 4:3 at 1200×900.
const PHOTO_ASPECT = 4 / 3;
const PHOTO_MAX_WIDTH = 1200;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function DistrictEventEditPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const eventId = Number(params.eventId);
  const yearId = Number(searchParams.get("yearId")) || 0;
  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [photos, setPhotos] = useState<{ path: string; preview: string; description: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { getDistrict(districtId).then(d => setDistrictName(`District ${d.districtNumber}`)).catch(() => {}); }, [districtId]);

  useEffect(() => {
    async function load() {
      try {
        const res = await getDistrictEventDetail(districtId, yearId, eventId);
        const evt = res.eventDetail;
        setTitle(evt.title || "");
        setDescription(evt.description || "");
        if (evt.eventDate) setEventDate(toLocalDateParts(evt.eventDate).date);
        if (res.photos) setPhotos(res.photos.map((ph: any) => ({ path: ph.imagePath, preview: `${API_URL}${ph.imagePath}`, description: ph.description || "" })));
      } catch { setErrorMessage("Failed to load event."); }
      finally { setLoading(false); }
    }
    load();
  }, [districtId, eventId]);

  const photoCrop = useImageCropUpload();

  const handleCroppedPhoto = async (blob: Blob) => {
    const file = new File([blob], `district-event-${Date.now()}.png`, { type: "image/png" });
    setUploading(true);
    try {
      const res = await uploadDistrictEventPhoto(districtId, file, false);
      setPhotos(prev => [...prev, { path: res.path, preview: URL.createObjectURL(file), description: "" }]);
    } catch (err: any) { setErrorMessage(err?.message || err?.response?.data?.message || "Failed to upload photo."); }
    finally { setUploading(false); photoCrop.cancel(); }
  };

  const removePhoto = (idx: number) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  const updatePhotoDescription = (idx: number, value: string) =>
    setPhotos(prev => prev.map((p, i) => (i === idx ? { ...p, description: value } : p)));

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!TEXT_INPUT_REGEX.test(title)) { setErrorMessage("Title cannot contain emoji."); return; }
    if (description && !TEXT_INPUT_REGEX.test(description)) { setErrorMessage("Description cannot contain emoji."); return; }
    if (!eventDate) { setErrorMessage("Date is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least one photo is required."); return; }

    const saveData = {
      title: title.trim(), description: description.trim() || null, eventDate,
      photos: photos.map((p, i) => ({ imagePath: p.path, description: p.description.trim() || null, isPrimary: i === 0, sortOrder: i })),
    };

    setSaving(true);
    try {
      const moveInfo = await updateDistrictEventItem(districtId, yearId, eventId, saveData);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          const moved = await moveDistrictEvent(districtId, moveInfo.fromYearId, eventId, saveData);
          window.alert(`Event moved to ${moved.newYearLabel}.`);
          router.push(`/districts/${districtId}/district-events`);
        }
        setSaving(false);
        return;
      }
      setSuccessMessage("Event updated successfully.");
      setTimeout(() => router.push(`/districts/${districtId}/district-events`), 2000);
    } catch (err: any) { setErrorMessage(err?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
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
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/districts/${districtId}/district-events`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/district-events`}><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div><h2 className="text-2xl font-bold tracking-tight text-primary">Edit District Event</h2><p className="text-muted-foreground">{districtName}</p></div>
        </div>

        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800"><Info className="h-4 w-4 shrink-0 mt-0.5" /><p>Please post all the Events executed by your District. The content posted here will be displayed on the District website.</p></div>

        <Card><CardHeader><CardTitle>Event Details</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="space-y-2"><Label>Title <span className="text-destructive">*</span> <span className="text-muted-foreground text-xs">(max 50 chars)</span></Label><Input value={title} onChange={e => setTitle(e.target.value)} maxLength={50} /><p className="text-xs text-muted-foreground text-right">{title.length}/50</p></div>
          <div className="space-y-2"><Label>Description <span className="text-muted-foreground text-xs">(max 1000 chars)</span></Label><Textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={4} /><p className="text-xs text-muted-foreground text-right">{description.length}/1000</p></div>
          <div className="space-y-2 max-w-xs"><Label>Date <span className="text-destructive">*</span></Label><DateField value={eventDate} onChange={setEventDate} /></div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Photos <span className="text-destructive">*</span> <span className="text-muted-foreground text-sm font-normal">(Max 5, min 1)</span></CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {photos.map((photo, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <div className="relative w-full h-40 group bg-muted">
                  <img src={photo.preview} alt="" className="w-full h-full object-contain" />
                  <button onClick={() => removePhoto(idx)} className="absolute top-1 right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
                </div>
                <div className="p-3 space-y-2">
                  <Textarea
                    value={photo.description}
                    onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(idx, e.target.value); }}
                    placeholder="Photo description (max 500 chars)"
                    rows={3}
                    maxLength={500}
                    className="text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right">{photo.description.length}/500</p>
                </div>
              </div>
            ))}
            {photos.length < 5 && (
              <label className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors h-40">
                {uploading ? <RotaryLoader size="sm" /> : <><Upload className="h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground mt-1">Upload</span></>}
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f && photos.length < 5) photoCrop.startCrop(f); e.target.value = ""; }}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
          {photoCrop.error && <p className="text-xs text-destructive mt-1">{photoCrop.error}</p>}
        </CardContent></Card>

        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg">{saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Event</>}</Button>
        </div>
      </div>
    </ProtectedRoute>
  );
}
