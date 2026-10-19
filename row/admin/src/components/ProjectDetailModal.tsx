"use client";

/**
 * ProjectDetailModal — read-only project detail popup with ALL fields + ALL photos.
 * Fetches via getProject(clubId, yearId, projectId). Reused by the district-admin
 * club view and the V1/V2 district → club pages. Backend unchanged.
 */

import { useEffect, useState } from "react";
import { getProject, getPhotoUrl } from "@/services/api";
import { formatMoney } from "@/lib/currency";
import type { ProjectDetail } from "@/types/project";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import RotaryLoader from "@/components/RotaryLoader";
import { CalendarDays, MapPin, Users, Clock4, IndianRupee, Handshake, FileText, Percent } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
// Agenda / Minutes are served by the API, not the Next app (same base the club-service detail page uses).
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function fmtDate(d?: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? "–"
    : dt.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "–") return null;
  return (
    <div className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="text-slate-800 font-medium">{value}</span>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
      <Icon className="h-4 w-4 text-slate-400 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm font-semibold text-slate-800 truncate">{value}</div>
      </div>
    </div>
  );
}

export default function ProjectDetailModal({
  clubId,
  yearId,
  projectId,
  onClose,
  attendance,
}: {
  clubId: number;
  yearId: number;
  projectId: number | null;
  onClose: () => void;
  // Club Service only: the figures exactly as the listing shows them - a BOD meeting is measured
  // against that year's board, everything else against the roll, and the percentage is worked out
  // from that same base (user 2026-10-05). Without this the popup would print the stored percentage
  // and contradict the row the reader just clicked.
  attendance?: { attended: number; base: number; baseLabel: string; percent: number } | null;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    getProject(clubId, yearId, projectId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { status?: number; data?: { message?: string } } };
        setError(err?.response?.data?.message || (err?.response?.status === 403
          ? "You don't have access to this project's details."
          : "Failed to load project details."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId, yearId, projectId]);

  const areaOfFocus = detail?.areaOfFocusName || detail?.otherAreaOfFocus || "";
  const category = detail?.categoryName || detail?.otherCategory || "";
  const subCategory = detail?.subCategoryName || detail?.otherSubCategory || "";
  const cost =
    detail?.projectCost != null && detail.projectCost > 0
      ? formatMoney(detail.projectCost, detail.currency)
      : "";

  return (
    <Dialog open={!!projectId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.title || "Project Details"}</DialogTitle>
          <DialogDescription className="sr-only">Project detail</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>
        )}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {detail && !loading && (
          <div className="space-y-4">
            {/* Meta chips */}
            <div className="flex flex-wrap gap-2">
              {detail.yearLabel && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">RY {detail.yearLabel}</span>}
              {detail.projectType && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{detail.projectType === "one_time" ? "One-time" : "Ongoing / Repeat"}</span>}
              {areaOfFocus && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-azure/5 text-ink border border-azure/15">{areaOfFocus}</span>}
            </div>

            {/* Key info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <Row label="Date" value={fmtDate(detail.projectDate)} />
              <Row label="Location" value={detail.location} />
              <Row label="Category" value={category} />
              <Row label="Sub Category" value={subCategory} />
              <Row label="Funding" value={detail.fundingName} />
              <Row label="Meeting Type" value={detail.meetingType} />
              {detail.isJointProject && <Row label="Joint With" value={detail.coHostName} />}
              {detail.isJointProject && <Row label="Club Role" value={detail.clubRole} />}
            </div>

            {detail.description && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</div>
                <p className="text-sm text-slate-700 whitespace-pre-line">{detail.description}</p>
              </div>
            )}

            {/* Impact stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat icon={Users} label="Beneficiaries" value={detail.directBeneficiaries || 0} />
              <Stat icon={Clock4} label="Man Hours" value={detail.manHours || 0} />
              <Stat icon={Users} label="Rotarians" value={detail.rotariansInvolved || 0} />
              <Stat icon={Users} label="Rotaractors" value={detail.rotaractorsInvolved || 0} />
              <Stat icon={Users} label="RCC" value={detail.rccInvolved || 0} />
              <Stat icon={IndianRupee} label="Project Cost" value={cost} />
              {attendance
                ? <Stat icon={Users} label={`Attendance (of ${attendance.base} ${attendance.baseLabel})`} value={attendance.attended} />
                : (detail.attendance || 0) > 0 && <Stat icon={Users} label="Attendance" value={detail.attendance} />}
              {attendance
                ? <Stat icon={Percent} label="Attendance %" value={`${attendance.percent.toFixed(2)}%`} />
                : (detail.attendancePercentage || 0) > 0 && <Stat icon={Percent} label="Attendance %" value={`${Number(detail.attendancePercentage).toFixed(2)}%`} />}
            </div>

            {/* Funding-conditional (Global Grant / CSR) */}
            {(detail.globalGrantNumber || detail.csrCompanyName || (detail.amountSanctioned || 0) > 0) && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                <Row label="Global Grant #" value={detail.globalGrantNumber} />
                <Row label="CSR Company" value={detail.csrCompanyName} />
                <Row label="Sanctioned" value={detail.amountSanctioned ? formatMoney(detail.amountSanctioned, detail.currency) : ""} />
                <Row label="Received" value={detail.amountReceived ? formatMoney(detail.amountReceived, detail.currency) : ""} />
                <Row label="Spent" value={detail.amountSpent ? formatMoney(detail.amountSpent, detail.currency) : ""} />
                <Row label="Host Clubs/Districts" value={detail.hostClubsDistricts} />
                <Row label="Global Partners" value={detail.globalPartnerClubsDistricts} />
              </div>
            )}

            {/* Club Service documents - Agenda / Minutes of Meeting, opened or downloaded from the API. */}
            {(detail.agendaDocument || detail.minutesDocument) && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents</div>
                <div className="flex flex-wrap gap-2">
                  {detail.agendaDocument && (
                    <a
                      href={`${API_URL}${detail.agendaDocument}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    >
                      <FileText size={13} /> Agenda
                    </a>
                  )}
                  {detail.minutesDocument && (
                    <a
                      href={`${API_URL}${detail.minutesDocument}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    >
                      <FileText size={13} /> Minutes of Meeting
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* All photos */}
            {detail.photos && detail.photos.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  <Handshake className="h-3.5 w-3.5" /> Photos ({detail.photos.length})
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {detail.photos.map((ph) => (
                    <div key={ph.id} className="relative rounded-lg overflow-hidden border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getPhotoUrl(ph.imagePath)} alt={ph.description || "Project photo"} className="w-full h-32 object-contain" />
                      {ph.isPrimary && (
                        <span className="absolute top-1 left-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">Primary</span>
                      )}
                      {ph.description && (
                        <div className="px-2 py-1 text-[11px] text-slate-600 truncate">{ph.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
