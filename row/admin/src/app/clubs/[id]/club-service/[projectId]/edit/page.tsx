"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ProjectPhotoInput } from "@/types/project";
import {
  getClub,
  getProject,
  updateProject,
  moveProject,
  uploadProjectImage,
  uploadProjectDocument,
  getRotaryYears,
  getBoardOfDirectors,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X, Star, Info,
  FileText, Camera, Send, Calendar, Users, FileUp,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";
import { ListPageSkeleton } from "@/components/row/AppKit";

// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

const TOP_MESSAGE = "Please post all the Club Services executed by your club. The content posted here will be displayed in the Club monthly report, District Website & ROW integrated Club website.";

const MEETING_TYPES = [
  { value: "regular", label: "Regular" },
  { value: "fellowship", label: "Fellowship" },
  { value: "bod", label: "BOD" },
  { value: "assembly", label: "Assembly" },
  { value: "trust", label: "Trust" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

type PhotoItem = {
  id: string;
  file?: File;
  imagePath: string;
  description: string;
  isPrimary: boolean;
  uploading: boolean;
  previewUrl?: string;
};

function Req({ children, hint, optional }: { children: React.ReactNode; hint?: string; optional?: boolean }) {
  return (
    <Label className="text-sm font-semibold text-foreground">
      {children}{!optional && <span className="text-destructive ml-0.5">*</span>}
      {optional && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
      {hint && <span className="text-muted-foreground font-normal ml-1">{hint}</span>}
    </Label>
  );
}

function RadioPill({ name, checked, onChange, label }: {
  name: string; value?: string; checked: boolean; onChange: () => void; label: string;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium
        ${checked
          ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/20"
          : "border-muted-foreground/20 hover:border-primary/40 text-muted-foreground hover:text-foreground"
        }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-all
        ${checked ? "border-primary" : "border-muted-foreground/40"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-primary" />}
      </div>
      {label}
    </label>
  );
}

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-[20px] border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function ClubServiceEditPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const projectId = Number(params.projectId);
  // Accept either ?yearId= (direct edit) or ?frozenYearId= (cross-flow from the
  // Club Monthly Report Edit link, which sends frozenYearId only). Without this,
  // yearId resolves to 0 and the project fails to load ("Project not found").
  const yearId = Number(searchParams.get("yearId") || searchParams.get("frozenYearId")) || 0;
  const returnUrl = searchParams.get("returnUrl");
  const frozenMonth = searchParams.get("frozenMonth");

  // Compute frozen date range if redirected from monthly report
  const frozenDateMin = frozenMonth ? (() => {
    const m = Number(frozenMonth);
    const now = new Date();
    const y = m >= 7 ? (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1) : (now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear());
    return `${y}-${String(m).padStart(2, "0")}-01`;
  })() : undefined;
  const frozenDateMax = frozenMonth ? (() => {
    const m = Number(frozenMonth);
    const now = new Date();
    const y = m >= 7 ? (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1) : (now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear());
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  })() : undefined;

  const [clubName, setClubName] = useState("");
  const [clubMemberCount, setClubMemberCount] = useState(0);
  const [bodCount, setBodCount] = useState(0);
  const [rotaryYears, setRotaryYears] = useState<RotaryYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectDate, setProjectDate] = useState("");
  const [meetingType, setMeetingType] = useState("");
  const [agendaDocument, setAgendaDocument] = useState<string | null>(null);
  const [agendaFileName, setAgendaFileName] = useState("");
  const [minutesDocument, setMinutesDocument] = useState<string | null>(null);
  const [minutesFileName, setMinutesFileName] = useState("");
  const [attendance, setAttendance] = useState("");
  const [attendancePercentage, setAttendancePercentage] = useState("");
  const [sendEmail, setSendEmail] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const photoCrop = useImageCropQueue();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [club, project, years] = await Promise.all([
          getClub(clubId),
          getProject(clubId, yearId, projectId),
          getRotaryYears(),
        ]);
        setClubName(club.clubName);
        setClubMemberCount(club.totalMembers || 0);
        setRotaryYears(years);

        // Populate form fields
        setTitle(project.title || "");
        setDescription(project.description || "");
        setProjectDate(project.projectDate ? project.projectDate.split("T")[0] : "");
        setMeetingType(project.meetingType || "");
        setAgendaDocument(project.agendaDocument || null);
        setAgendaFileName(project.agendaDocument ? project.agendaDocument.split("/").pop() || "Agenda" : "");
        setMinutesDocument(project.minutesDocument || null);
        setMinutesFileName(project.minutesDocument ? project.minutesDocument.split("/").pop() || "Minutes" : "");
        setAttendance(project.attendance != null ? String(project.attendance) : "");
        setAttendancePercentage(project.attendancePercentage != null ? String(project.attendancePercentage) : "");
        setSendEmail(project.sendEmail ?? false);

        // Populate photos
        if (project.photos && project.photos.length > 0) {
          setPhotos(project.photos.map((p) => ({
            id: String(p.id),
            imagePath: p.imagePath,
            description: p.description || "",
            isPrimary: p.isPrimary,
            uploading: false,
            previewUrl: `${API_URL}${p.imagePath}`,
          })));
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load meeting.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, projectId]);

  // Rotary year label for a calendar date — "YYYY-YY" (matches RotaryYearHelper.EnsureRotaryYearAsync).
  function yearLabelForDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const month = d.getMonth() + 1;
    const startYear = month >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  }

  // BOD meeting type → total members from board_of_directors for the project's rotary year.
  useEffect(() => {
    let cancelled = false;
    async function refreshBod() {
      if (meetingType !== "bod" || rotaryYears.length === 0) {
        if (!cancelled) setBodCount(0);
        return;
      }
      let yr: { id: number; yearLabel: string; isCurrent: boolean } | undefined;
      if (projectDate) {
        const label = yearLabelForDate(projectDate);
        yr = label ? rotaryYears.find(y => y.yearLabel === label) : undefined;
      } else {
        yr = rotaryYears.find(y => y.isCurrent) ?? rotaryYears[0];
      }
      if (!yr) {
        if (!cancelled) setBodCount(0);
        return;
      }
      try {
        const bd = await getBoardOfDirectors(clubId, yr.id);
        if (!cancelled) setBodCount(bd.length);
      } catch {
        if (!cancelled) setBodCount(0);
      }
    }
    refreshBod();
    return () => { cancelled = true; };
  }, [meetingType, projectDate, rotaryYears, clubId]);

  const effectiveTotal = meetingType === "bod" ? bodCount : clubMemberCount;
  const effectiveLabel = meetingType === "bod" ? "BOD Members" : "Total Members";

  // Auto-fill attendance with the effective total when it becomes known and attendance is
  // currently empty (admin just clicked a different meeting type). Skipped on initial load
  // because the project's saved attendance is non-empty after the init effect runs.
  useEffect(() => {
    if (attendance === "" && effectiveTotal > 0 && meetingType) {
      setAttendance(String(effectiveTotal));
    }
  }, [effectiveTotal, attendance, meetingType]);

  // Clearing here (not in a useEffect) avoids wiping the project's saved value on mount.
  const handleMeetingTypeChange = (value: string) => {
    setMeetingType(value);
    setAttendance("");
  };

  // Auto-calculate attendance percentage against the effective total.
  useEffect(() => {
    if (attendance && effectiveTotal > 0) {
      const pct = (Number(attendance) / effectiveTotal) * 100;
      setAttendancePercentage(pct.toFixed(2));
    } else {
      setAttendancePercentage("");
    }
  }, [attendance, effectiveTotal]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 5 - photos.length - photoCrop.pending;
    const toAdd = Array.from(files).slice(0, Math.max(0, remaining));

    const accepted = toAdd;
    e.target.value = "";
    // Queue the selection for the crop dialog — nothing uploads until each
    // photo is confirmed there, one after another.
    const queueErrors = await photoCrop.enqueue(accepted);
    if (queueErrors.length > 0) setErrorMessage(queueErrors[0]);
  };

  const handleCropSave = (blob: Blob) =>
    photoCrop.commit(async () => {
      const file = new File([blob], `project-photo-${Date.now()}.png`, { type: "image/png" });
      const id = Math.random().toString(36).substring(7);
      const previewUrl = URL.createObjectURL(blob);
      setPhotos(prev => [...prev, {
        id, file, imagePath: "", description: "",
        isPrimary: prev.length === 0,
        uploading: true, previewUrl,
      }]);

      try {
        const result = await uploadProjectImage(clubId, file, projectId, yearId);
        setPhotos(prev => prev.map(p => p.id === id ? { ...p, imagePath: result.path, uploading: false } : p));
      } catch (err: any) {
        setPhotos(prev => prev.filter(p => p.id !== id));
        setErrorMessage(err?.message || err?.response?.data?.message || "Failed to upload photo.");
      }
    });

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      const updated = prev.filter(p => p.id !== id);
      if (updated.length > 0 && !updated.some(p => p.isPrimary)) {
        updated[0].isPrimary = true;
      }
      return updated;
    });
  };

  const setPrimaryPhoto = (id: string) => {
    setPhotos(prev => prev.map(p => ({ ...p, isPrimary: p.id === id })));
  };

  const handleDocUpload = async (file: File, type: "agenda" | "minutes") => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"].includes(ext)) {
      setErrorMessage("Only PDF, Word, Excel, PNG or JPEG files are allowed for Agenda / Minutes of Meeting.");
      return;
    }
    try {
      const result = await uploadProjectDocument(clubId, file);
      if (type === "agenda") {
        setAgendaDocument(result.path);
        setAgendaFileName(file.name);
      } else {
        setMinutesDocument(result.path);
        setMinutesFileName(file.name);
      }
    } catch (err: unknown) {
      // Show the real reason (size cap from the upload validator, or the API's file-type message).
      const e = err as { message?: string; response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || e?.message || `Failed to upload ${type} document.`);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!description.trim()) { setErrorMessage("Description is required."); return; }
    if (description.trim().length > 1000) { setErrorMessage("Description must be 1000 characters or less."); return; }
    if (!projectDate) { setErrorMessage("Date is required."); return; }
    if (new Date(projectDate) > new Date()) { setErrorMessage("Date cannot be in the future."); return; }
    if (!meetingType) { setErrorMessage("Meeting Type is required."); return; }
    // Agenda + Minutes of Meeting are optional per user request — drop required.
    if (!attendance) { setErrorMessage("Attendance is required."); return; }
    if (photos.length === 0) { setErrorMessage("At least 1 photo is required."); return; }
    if (photos.some(p => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }

    const photoInputs: ProjectPhotoInput[] = photos.map((p, i) => ({
      imagePath: p.imagePath,
      description: p.description || null,
      isPrimary: p.isPrimary,
      sortOrder: i,
    }));

    const saveData: Record<string, unknown> = {
      projectType: "one_time",
      isJointProject: false,
      title: title.trim(),
      description: description.trim(),
      projectDate,
      meetingType,
      agendaDocument,
      minutesDocument,
      attendance: Number(attendance),
      attendancePercentage: attendancePercentage ? Number(attendancePercentage) : null,
      sendEmail,
      photos: photoInputs,
    };

    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const moveInfo = await updateProject(clubId, yearId, projectId, saveData as any);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const moved = await moveProject(clubId, moveInfo.fromYearId, projectId, saveData as any);
          window.alert(`Project moved to ${moved.newYearLabel}.`);
          router.push(`/clubs/${clubId}/club-service/${moved.newId}?yearId=${moved.newYearId}`);
        }
        setSaving(false);
        return;
      }
      setShowSuccessDialog(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update meeting.");
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
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={returnUrl || `/clubs/${clubId}/club-service`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Meeting</h2>
            <p className="text-muted-foreground text-base">{clubName}</p>
          </div>
        </div>

        {/* Top message */}
        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-800">
          <Info className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{TOP_MESSAGE}</p>
        </div>

        {/* 1. Meeting Details */}
        <Section icon={FileText} title="Meeting Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars)">Title</Req>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 1000 chars)">Description</Req>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the meeting..." rows={4} maxLength={1000} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/1000</p>
            </div>
            <div className="space-y-1.5">
              <Req>Date</Req>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : new Date().toISOString().split("T")[0]} min={frozenMonth ? frozenDateMin : undefined} />
            </div>
          </div>
        </Section>

        {/* 2. Meeting Type */}
        <Section icon={Calendar} title="Meeting Type" number={2}>
          <div>
            <Req>Select Meeting Type</Req>
            <div className="flex flex-wrap gap-3 mt-2">
              {MEETING_TYPES.map(mt => (
                <RadioPill key={mt.value} name="meetingType" value={mt.value} checked={meetingType === mt.value} onChange={() => handleMeetingTypeChange(mt.value)} label={mt.label} />
              ))}
            </div>
          </div>
        </Section>

        {/* 3. Documents */}
        <Section icon={FileUp} title="Documents" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Req optional>Agenda</Req>
              {agendaDocument ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <FileText className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 truncate flex-1">{agendaFileName}</span>
                  <button onClick={() => { setAgendaDocument(null); setAgendaFileName(""); }}>
                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/40 transition-colors">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Upload agenda document</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0], "agenda")} />
                  </label>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG</p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Req optional>Minutes of Meeting</Req>
              {minutesDocument ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <FileText className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 truncate flex-1">{minutesFileName}</span>
                  <button onClick={() => { setMinutesDocument(null); setMinutesFileName(""); }}>
                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/40 transition-colors">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Upload minutes document</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0], "minutes")} />
                  </label>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG</p>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* 4. Attendance */}
        <Section icon={Users} title="Attendance" number={4}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Req>{`Attendance (${effectiveLabel}: ${effectiveTotal})`}</Req>
              <Input type="number" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder="Number of attendees" min={0} />
            </div>
            <div className="space-y-1.5">
              <Req>Attendance (%)</Req>
              <Input type="number" value={attendancePercentage} onChange={(e) => setAttendancePercentage(e.target.value)} placeholder="Auto-calculated" step="0.01" min={0} max={100} />
              <p className="text-xs text-muted-foreground">Auto-calculated, but you can change it</p>
            </div>
          </div>
        </Section>

        {/* 5. Photos */}
        <Section icon={Camera} title="Photos" number={5}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Req>Upload Photos (1 mandatory, max 5)</Req>
              <span className="text-sm text-muted-foreground">{photos.length}/5</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group rounded-lg overflow-hidden border aspect-square">
                  {photo.previewUrl && (
                    <img src={photo.previewUrl} alt="" className="w-full h-full object-contain" />
                  )}
                  {photo.uploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <RotaryLoader size="sm" />
                    </div>
                  )}
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPrimaryPhoto(photo.id)}
                      className={`p-1 rounded-full ${photo.isPrimary ? "bg-yellow-400 text-yellow-900" : "bg-black/50 text-white hover:bg-yellow-400 hover:text-yellow-900"}`}>
                      <Star className="h-3 w-3" />
                    </button>
                    <button onClick={() => removePhoto(photo.id)} className="p-1 rounded-full bg-black/50 text-white hover:bg-red-500">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {photo.isPrimary && (
                    <div className="absolute bottom-0 left-0 right-0 bg-yellow-400/90 text-yellow-900 text-[10px] font-bold text-center py-0.5">PRIMARY</div>
                  )}
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg aspect-square flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Add Photo</span>
                </button>
              )}
            </div>
            <input ref={photoInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
          </div>
        </Section>

        {/* Email notification (Club Service is email-only) — a box left ticked on save re-sends to all members (same as the other avenues). */}
        <div className="rounded-xl border p-4 mb-6">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-blue-600 h-4 w-4" />
            <span className="text-sm font-medium">Send Email notification</span>
            {sendEmail && <RecipientBadge scope="club" clubId={clubId} />}
          </label>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Meeting</>}
          </Button>
        </div>

        {/* Success Dialog */}
        <Dialog open={showSuccessDialog} onOpenChange={() => {}}>
          <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Meeting Updated Successfully</DialogTitle>
              <DialogDescription className="sr-only">Meeting update confirmation</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground py-2">
              <p>Your meeting has been updated successfully.</p>
            </div>
            <Button className="w-full" onClick={() => {
              setShowSuccessDialog(false);
              router.push(returnUrl || `/clubs/${clubId}/club-service`);
            }}>
              OK
            </Button>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.current?.dataUrl ?? null}
          aspect={PROJECT_PHOTO_ASPECT}
          allowOrientation
          maxOutputWidth={PROJECT_PHOTO_MAX_WIDTH}
          title={photoCrop.pending > 1 ? `Crop Photo (${photoCrop.pending} left)` : "Crop Photo"}
          saving={photoCrop.saving}
          onCancel={photoCrop.skip}
          onSave={handleCropSave}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
