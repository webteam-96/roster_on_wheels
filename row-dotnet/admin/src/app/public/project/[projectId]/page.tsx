"use client";

/**
 * Public, no-auth project page — shareable URL pattern:
 *   https://portal.example.org/public/project/{projectId}?year={yearId}
 *
 * The "Photos" hyperlink in every District / Club Report Excel export points
 * here. Anyone with the link can view the project's title, description,
 * basic metadata, and full photo gallery — no login required.
 *
 * AppHeader hides itself on /public/* paths (see AppHeader.tsx), so this
 * page renders without the admin chrome.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { X, Download } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";

import { appLocale } from "@/lib/appFormat";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface PublicPhoto {
  imagePath: string;
  description?: string | null;
  isPrimary?: boolean;
}

interface PublicProject {
  id: number;
  title?: string | null;
  description?: string | null;
  projectDate?: string | null;
  location?: string | null;
  directBeneficiaries?: number | null;
  manHours?: number | null;
  rotariansInvolved?: number | null;
  rotaractorsInvolved?: number | null;
  rccInvolved?: number | null;
  areaOfFocus?: string | null;
  category?: string | null;
  subCategory?: string | null;
  funding?: string | null;
  clubName?: string | null;
  clubRotaryId?: string | null;
  clubCity?: string | null;
  clubState?: string | null;
  districtNumber?: string | null;
  zoneName?: string | null;
  // Club Service meetings (moduleKey 'club_service') show these instead of the project fields.
  moduleKey?: string | null;
  meetingType?: string | null;
  attendance?: number | null;
  attendancePercentage?: number | null;
  agendaDocument?: string | null;
  minutesDocument?: string | null;
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

interface PublicResponse {
  project: PublicProject;
  photos: PublicPhoto[];
}

function fmtDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function resolveImageUrl(imagePath: string): string {
  if (!imagePath) return "";
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  if (imagePath.startsWith("/")) return `${API_URL}${imagePath}`;
  return `${API_URL}/${imagePath}`;
}

export default function PublicProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = Number(params.projectId);
  const year = Number(searchParams.get("year") || "0");

  const [data, setData] = useState<PublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId || projectId <= 0) {
      setErrorMsg("Project not found.");
      setLoading(false);
      return;
    }
    const yearQs = year > 0 ? `?yearId=${year}` : "";
    fetch(`${API_URL}/api/public/projects/${projectId}${yearQs}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Project not found.");
          throw new Error(`Failed to load (${res.status}).`);
        }
        return res.json();
      })
      .then((json: PublicResponse) => setData(json))
      .catch((err: Error) => setErrorMsg(err.message || "Failed to load project."))
      .finally(() => setLoading(false));
  }, [projectId, year]);

  const closeLightbox = useCallback(() => setLightboxIdx(null), []);

  // Download every photo as a separate file. We fetch each one as a blob so
  // the browser saves it directly (anchor `download` alone fails when the
  // image lives on a different sub-path / API origin). A small inter-photo
  // delay keeps Chrome/Safari from blocking the burst as "multi-download".
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const handleDownloadAll = useCallback(async () => {
    if (!data?.photos?.length || bulkDownloading) return;
    setBulkDownloading(true);
    try {
      for (let i = 0; i < data.photos.length; i++) {
        const photo = data.photos[i];
        const src = resolveImageUrl(photo.imagePath);
        try {
          const res = await fetch(src, { credentials: "omit" });
          if (!res.ok) continue;
          const blob = await res.blob();
          const ext = (photo.imagePath.split(".").pop() || "jpg").toLowerCase();
          const safeName = `project_${data.project.id}_photo_${i + 1}.${ext}`;
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = safeName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(objectUrl);
        } catch { /* keep going on individual photo failure */ }
        // brief pacing — Chrome blocks rapid-fire downloads
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setBulkDownloading(false);
    }
  }, [data, bulkDownloading]);
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, closeLightbox]);

  const project = data?.project;
  const photos = data?.photos || [];
  const isClubService = project?.moduleKey === "club_service";
  const meetingTypeLabel = project?.meetingType
    ? MEETING_TYPE_LABELS[project.meetingType.toLowerCase()] || project.meetingType
    : "";
  const attendanceText = project?.attendance != null
    ? `${project.attendance}${project.attendancePercentage != null ? ` (${Math.round(Number(project.attendancePercentage) * 100) / 100}%)` : ""}`
    : "";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full" style={{ backgroundColor: "#0f172a" }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/row-logo-badge.png"
            alt="Roster On Wheels"
            className="h-14 object-contain"
          />
          <div className="text-white">
            <p className="text-2xl sm:text-3xl font-semibold">{isClubService ? "Club Service" : "Project Gallery"}</p>
          </div>
        </div>
        <div style={{ height: 4, backgroundColor: "#F7A81B" }} />
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        ) : errorMsg || !project ? (
          <div className="flex flex-col items-center py-20 text-center text-slate-500">
            <p className="text-lg font-medium">{errorMsg || "Project not found."}</p>
            <p className="text-xs mt-2">
              The link may be incorrect or the project may have been removed.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
              {project.title || "Untitled Project"}
            </h1>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 mb-5">
              {project.clubName && <span className="font-medium text-slate-800">{project.clubName}</span>}
              {project.districtNumber && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>District {project.districtNumber}</span>
                </>
              )}
              {project.projectDate && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{fmtDate(project.projectDate)}</span>
                </>
              )}
              {!isClubService && project.location && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{project.location}</span>
                </>
              )}
              {!isClubService && project.directBeneficiaries != null && project.directBeneficiaries > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{project.directBeneficiaries.toLocaleString(appLocale())} beneficiaries</span>
                </>
              )}
            </div>

            {/* Club Service meeting — only the Club Service add/edit fields. */}
            {isClubService && (meetingTypeLabel || attendanceText || project.agendaDocument || project.minutesDocument) && (
              <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
                <dl className="divide-y divide-slate-100 text-sm">
                  {meetingTypeLabel && (
                    <div className="flex gap-4 px-4 py-2.5">
                      <dt className="w-40 shrink-0 text-slate-500">Meeting Type</dt>
                      <dd className="text-slate-800">{meetingTypeLabel}</dd>
                    </div>
                  )}
                  {attendanceText && (
                    <div className="flex gap-4 px-4 py-2.5">
                      <dt className="w-40 shrink-0 text-slate-500">Attendance</dt>
                      <dd className="text-slate-800">{attendanceText}</dd>
                    </div>
                  )}
                  {project.agendaDocument && (
                    <div className="flex gap-4 px-4 py-2.5">
                      <dt className="w-40 shrink-0 text-slate-500">Agenda</dt>
                      <dd>
                        <a href={resolveImageUrl(project.agendaDocument)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Download</a>
                      </dd>
                    </div>
                  )}
                  {project.minutesDocument && (
                    <div className="flex gap-4 px-4 py-2.5">
                      <dt className="w-40 shrink-0 text-slate-500">Minutes of Meeting</dt>
                      <dd>
                        <a href={resolveImageUrl(project.minutesDocument)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Download</a>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {!isClubService && (project.areaOfFocus || project.category || project.subCategory) && (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {project.areaOfFocus && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                    {project.areaOfFocus}
                  </span>
                )}
                {project.category && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                    {project.category}
                  </span>
                )}
                {project.subCategory && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-100">
                    {project.subCategory}
                  </span>
                )}
              </div>
            )}

            {project.description && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-6">
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                  {project.description}
                </p>
              </div>
            )}

            {photos.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
                No photos uploaded for this {isClubService ? "meeting" : "project"}.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h2 className="text-sm font-semibold text-slate-700">
                    Photos ({photos.length})
                  </h2>
                  <button
                    type="button"
                    onClick={handleDownloadAll}
                    disabled={bulkDownloading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-wait"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {bulkDownloading ? "Downloading…" : `Download all (${photos.length})`}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {photos.map((photo, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightboxIdx(i)}
                      className="text-left bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition group"
                    >
                      <div className="aspect-square w-full bg-slate-100 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveImageUrl(photo.imagePath)}
                          alt={photo.description || `Photo ${i + 1}`}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </div>
                      {photo.description && (
                        <div className="px-3 py-2.5">
                          <p className="text-xs text-slate-600 line-clamp-3">
                            {photo.description}
                          </p>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <footer className="w-full mt-10 py-5 border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center text-xs text-slate-500">
          ROW &mdash; portal.example.org
        </div>
      </footer>

      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="max-w-5xl max-h-full flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveImageUrl(photos[lightboxIdx].imagePath)}
              alt={photos[lightboxIdx].description || "Photo"}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {photos[lightboxIdx].description && (
              <p className="text-sm text-white/90 text-center max-w-2xl">
                {photos[lightboxIdx].description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
