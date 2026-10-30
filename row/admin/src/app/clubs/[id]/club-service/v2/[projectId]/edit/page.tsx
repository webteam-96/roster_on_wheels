"use client";

/**
 * Club Service v2 — Edit Meeting.
 *
 * Same data semantics as the v1 edit page: every field, every API call (incl.
 * the cross-year move flow), every validation rule is preserved verbatim. Only
 * the visual presentation differs (V2FormShell wrapper, dot-accented section
 * headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`. yearId comes from
 * a normal query param (?yearId=) since the API requires it.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Upload, X, Star, Info, FileText, Camera, Calendar, Users, FileUp,
} from "@/components/icons";
import {
  getClub,
  getProject,
  updateProject,
  moveProject,
  uploadProjectImage,
  uploadProjectDocument,
  getRotaryYears,
  getBoardOfDirectors,
  getClubMembersForAttendance,
} from "@/services/api";
import { ProjectPhotoInput } from "@/types/project";
import { RotaryYear } from "@/types/rotaryYear";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RecipientBadge from "@/components/RecipientBadge";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropQueue } from "@/hooks/useImageCropQueue";
import { ListPageSkeleton } from "@/components/row/AppKit";

// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

const TOP_MESSAGE = "Please post all the Club Services executed by your club. The content posted here will be displayed in the Club monthly report, District Website & ROW integrated Club website.";

const MEETING_TYPES = [
  { value: "regular",    label: "Regular" },
  { value: "fellowship", label: "Fellowship" },
  { value: "bod",        label: "BOD" },
  { value: "assembly",   label: "Assembly" },
  { value: "trust",      label: "Trust" },
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

function FieldLabel({ children, hint, dot, optional }: { children: React.ReactNode; hint?: string; dot: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {/* The coloured bullet marks a field you must fill. An optional field doesn't get one -
          Agenda and Minutes of Meeting read as required because of it (user 2026-10-05). */}
      {!optional && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <label className="text-xs font-semibold text-slate-700">
        {children}{!optional && <span className="text-rose-600 ml-0.5">*</span>}
        {optional && <span className="text-slate-400 font-normal ml-1">(optional)</span>}
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

function RadioPill({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium
        ${checked
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-slate-800"
        }`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${checked ? "border-blue-500" : "border-slate-400"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-blue-500" />}
      </div>
      {label}
    </label>
  );
}

export default function ClubServiceV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const projectId = Number(params.projectId);
  // Resolve the rotary year for the project fetch. Try, in order:
  //   1. ?yearId=        (direct edit from the club-service listing)
  //   2. ?frozenYearId=  (cross-flow from the Monthly Report wizard — its convention)
  //   3. the year embedded in ?returnTo= — the CMR flow's returnTo is always
  //      /clubs/{clubId}/club-monthly-report/v2/{yearId}/{month}, so we can recover
  //      the year even if a stale/out-of-sync build of the linking page dropped the
  //      explicit param. Without a year the project-fetch 404s with "Project not found".
  const yearIdFromReturnTo = (() => {
    const rt = searchParams.get("returnTo");
    if (!rt) return 0;
    try {
      const m = decodeURIComponent(rt).match(/club-monthly-report\/v2\/(\d+)\//);
      return m ? Number(m[1]) : 0;
    } catch { return 0; }
  })();
  const yearId =
    Number(searchParams.get("yearId") || searchParams.get("frozenYearId")) ||
    yearIdFromReturnTo ||
    0;
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/club-service/v2`);

  // Cross-flow from monthly report: lock the date input to the single month/year
  // the report cell is for. Parity with v1 edit page.
  const frozenMonth = searchParams.get("frozenMonth");
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
  // The URL's yearId may be wrong/missing (cross-flow links). Once the project loads,
  // trust ITS actual year for save/upload so those don't 404 on a mismatched year.
  const [effectiveYearId, setEffectiveYearId] = useState<number>(0);
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
        // club.totalMembers can be a stale aggregate; the active club_members
        // list returned by /attendance/members is the authoritative count used
        // for attendance validation (parity with the attendance module).
        const [club, project, years, members] = await Promise.all([
          getClub(clubId),
          getProject(clubId, yearId, projectId),
          getRotaryYears(),
          getClubMembersForAttendance(clubId).catch(() => [] as { id: number; memberName: string }[]),
        ]);
        setClubName(club.clubName);
        setClubMemberCount(members.length || club.totalMembers || 0);
        setRotaryYears(years);
        // Authoritative year for this project — used for update/photo calls below.
        setEffectiveYearId(project.yearId || yearId);

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
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load meeting.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, projectId, yearId]);

  function yearLabelForDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const month = d.getMonth() + 1;
    const startYear = month >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  }

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
        yr = label ? rotaryYears.find((y) => y.yearLabel === label) : undefined;
      } else {
        yr = rotaryYears.find((y) => y.isCurrent) ?? rotaryYears[0];
      }
      if (!yr) { if (!cancelled) setBodCount(0); return; }
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

  useEffect(() => {
    if (attendance === "" && effectiveTotal > 0 && meetingType) {
      setAttendance(String(effectiveTotal));
    }
  }, [effectiveTotal, attendance, meetingType]);

  const handleMeetingTypeChange = (value: string) => {
    setMeetingType(value);
    setAttendance("");
  };

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
      setPhotos((prev) => [...prev, {
        id, file, imagePath: "", description: "",
        isPrimary: prev.length === 0,
        uploading: true, previewUrl,
      }]);

      try {
        const result = await uploadProjectImage(clubId, file, projectId, effectiveYearId || yearId);
        setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, imagePath: result.path, uploading: false } : p));
      } catch (err: unknown) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        const e = err as { message?: string; response?: { data?: { message?: string } } };
        setErrorMessage(e?.message || e?.response?.data?.message || "Failed to upload photo.");
      }
    });

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      if (updated.length > 0 && !updated.some((p) => p.isPrimary)) {
        updated[0].isPrimary = true;
      }
      return updated;
    });
  };

  const setPrimaryPhoto = (id: string) => {
    setPhotos((prev) => prev.map((p) => ({ ...p, isPrimary: p.id === id })));
  };

  const handleDocUpload = async (file: File, type: "agenda" | "minutes") => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"].includes(ext)) {
      setErrorMessage("Only PDF, Word, Excel, PNG or JPEG files are allowed for Agenda / Minutes of Meeting.");
      return;
    }
    try {
      const result = await uploadProjectDocument(clubId, file);
      if (type === "agenda") { setAgendaDocument(result.path); setAgendaFileName(file.name); }
      else                  { setMinutesDocument(result.path); setMinutesFileName(file.name); }
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
    if (photos.some((p) => p.uploading)) { setErrorMessage("Please wait for photos to finish uploading."); return; }

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
      const moveInfo = await updateProject(clubId, effectiveYearId || yearId, projectId, saveData as any);
      if (moveInfo) {
        if (window.confirm(moveInfo.message)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const moved = await moveProject(clubId, moveInfo.fromYearId, projectId, saveData as any);
          window.alert(`Project moved to ${moved.newYearLabel}.`);
          router.push(`/clubs/${clubId}/club-service/v2`);
        }
        setSaving(false);
        return;
      }
      setSuccessMessage("Meeting updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update meeting.");
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
        pageTitle="Edit Club Service Meeting"
        pageSubtitle="Update club service meeting details"
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <V2FormShell
        title="Edit Club Service Meeting"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/club-service/v2`}
        saving={saving}
        saveLabel="Update Meeting"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Meeting Details */}
        <SectionCard number={1} icon={FileText} title="Meeting Details" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 50 chars)" dot="bg-[#17458F]">Title</FieldLabel>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Meeting title"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel hint="(max 1000 chars)" dot="bg-[#17458F]">Description</FieldLabel>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the meeting…"
                rows={4}
                maxLength={1000}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]">Date</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : new Date().toISOString().split("T")[0]} min={frozenMonth ? frozenDateMin : undefined} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
            </div>
          </div>
        </SectionCard>

        {/* 2. Meeting Type */}
        <SectionCard number={2} icon={Calendar} title="Meeting Type" dot="bg-[#17458F]">
          <FieldLabel dot="bg-[#17458F]">Select Meeting Type</FieldLabel>
          <div className="flex flex-wrap gap-2 mt-1">
            {MEETING_TYPES.map((mt) => (
              <RadioPill
                key={mt.value}
                checked={meetingType === mt.value}
                onChange={() => handleMeetingTypeChange(mt.value)}
                label={mt.label}
              />
            ))}
          </div>
        </SectionCard>

        {/* 3. Documents */}
        <SectionCard number={3} icon={FileUp} title="Documents" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-[#17458F]" optional>Agenda</FieldLabel>
              {agendaDocument ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm text-emerald-700 truncate flex-1">{agendaFileName}</span>
                  <button type="button" onClick={() => { setAgendaDocument(null); setAgendaFileName(""); }}>
                    <X className="h-4 w-4 text-slate-500 hover:text-slate-700" />
                  </button>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                    <Upload className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-500">Upload agenda document</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0], "agenda")} />
                  </label>
                  <p className="text-xs text-slate-400 mt-1">PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG</p>
                </div>
              )}
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]" optional>Minutes of Meeting</FieldLabel>
              {minutesDocument ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm text-emerald-700 truncate flex-1">{minutesFileName}</span>
                  <button type="button" onClick={() => { setMinutesDocument(null); setMinutesFileName(""); }}>
                    <X className="h-4 w-4 text-slate-500 hover:text-slate-700" />
                  </button>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                    <Upload className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-500">Upload minutes document</span>
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      onChange={(e) => e.target.files?.[0] && handleDocUpload(e.target.files[0], "minutes")} />
                  </label>
                  <p className="text-xs text-slate-400 mt-1">PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG</p>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* 4. Attendance */}
        <SectionCard number={4} icon={Users} title="Attendance" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-[#17458F]">{`Attendance (${effectiveLabel}: ${effectiveTotal})`}</FieldLabel>
              <input
                type="number"
                value={attendance}
                onChange={(e) => setAttendance(e.target.value)}
                placeholder="Number of attendees"
                min={0}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]">Attendance (%)</FieldLabel>
              <input
                type="number"
                value={attendancePercentage}
                onChange={(e) => setAttendancePercentage(e.target.value)}
                placeholder="Auto-calculated"
                step="0.01"
                min={0}
                max={100}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 mt-0.5">Auto-calculated, but you can change it</p>
            </div>
          </div>
        </SectionCard>

        {/* 5. Photos */}
        <SectionCard number={5} icon={Camera} title="Photos" dot="bg-[#17458F]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FieldLabel dot="bg-[#17458F]">Upload Photos (1 mandatory, max 5)</FieldLabel>
              <span className="text-xs text-slate-500">{photos.length}/5</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 items-start">
              {photos.map((photo) => (
                <div key={photo.id} className="space-y-1">
                  <div className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square">
                    {photo.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.previewUrl} alt="" className="w-full h-full object-contain" />
                    )}
                    {photo.uploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <RotaryLoader size="sm" />
                      </div>
                    )}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => setPrimaryPhoto(photo.id)}
                        className={`p-1 rounded-full ${photo.isPrimary ? "bg-amber-400 text-amber-900" : "bg-black/50 text-white hover:bg-amber-400 hover:text-amber-900"}`}>
                        <Star className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => removePhoto(photo.id)} className="p-1 rounded-full bg-black/50 text-white hover:bg-rose-500">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {photo.isPrimary && (
                      <div className="absolute bottom-0 left-0 right-0 bg-amber-400/90 text-amber-900 text-[10px] font-bold text-center py-0.5">PRIMARY</div>
                    )}
                  </div>
                  {/* Optional per-photo caption (e.g. "Community Service"). Not mandatory. */}
                  <input
                    type="text"
                    value={photo.description}
                    onChange={(e) => { const v = e.target.value; setPhotos((prev) => prev.map((p) => p.id === photo.id ? { ...p, description: v } : p)); }}
                    placeholder="Description (optional)"
                    maxLength={200}
                    className="w-full text-xs border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg aspect-square flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-blue-300 hover:text-blue-700"
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Add Photo</span>
                </button>
              )}
            </div>
            <input ref={photoInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
            <p className="text-xs text-slate-400">JPG, JPEG, PNG, GIF, WEBP · max 10 MB · caption optional per photo</p>
          </div>
        </SectionCard>

        {/* Email notification (Club Service is email-only) — a box left ticked on save re-sends to all members (same as the other avenues). */}
        <div className="rounded-xl border border-slate-200 p-4">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-blue-600 h-4 w-4" />
            <span className="text-sm font-medium text-slate-700">Send Email notification</span>
            {sendEmail && <RecipientBadge scope="club" clubId={clubId} />}
          </label>
        </div>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Meeting updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
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
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
