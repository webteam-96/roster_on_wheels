"use client";

/**
 * Club Monthly Report v2 — preview + upload to district.
 *
 * Read-only visual digest of the report (header card, TRF table, meetings
 * grouped by type, projects-by-service-type, members info, advisory note).
 *
 * Actions: Previous (back to wizard), Download PDF, Download Word,
 * Upload to District (generates PDF base64 + uploads + emails). All API
 * calls are identical to v1's preview; only visuals changed.
 *
 * v2 reads ONLY `?returnTo=` — after a successful upload the user is
 * routed back there (typically the e-Gov tab) instead of v1 CMR landing.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Upload, Calendar, DollarSign, Users, FolderOpen,
  FileText, Info,
} from "lucide-react";
import {
  getMonthlyReportPreview,
  uploadMonthlyReportToDistrict,
} from "@/services/api";
import { MonthlyReportPreview, ReportMeeting } from "@/types/clubMonthlyReport";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import LoadingButton from "@/components/v2/LoadingButton";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

const PROJECT_LABELS: Record<string, string> = {
  community_service:        "Community Service",
  vocational_service:       "Vocational Service",
  international_service:    "International Service",
  new_generation_service:   "New Generation Service",
  public_image_initiative:  "Public Image Initiative",
};

function formatReportDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day}, ${dd} ${mon} ${year} ${hh}:${mm}:${ss} ${ampm}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Section card matching the rest of v2 (slate-toned header, dot accents).
function SectionCard({
  icon: Icon, title, children,
}: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden print:shadow-none print:rounded-none">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex text-sm">
      <span className="font-medium text-slate-500 w-48 shrink-0">{label}</span>
      <span className="text-slate-800">: {value}</span>
    </div>
  );
}

function ClubMonthlyReportV2PreviewInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const yearId = Number(params.yearId);
  const month  = Number(params.month);

  const incomingReturnTo = searchParams.get("returnTo") || "";
  const returnToQuery = incomingReturnTo
    ? `?returnTo=${encodeURIComponent(incomingReturnTo)}`
    : "";

  const [report, setReport] = useState<MonthlyReportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function fetchPreview() {
      try {
        setLoading(true);
        setError("");
        const data = await getMonthlyReportPreview(clubId, yearId, month);
        setReport(data);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosErr = err as any;
        const respData = axiosErr?.response?.data;
        const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report preview");
        console.error("Preview error:", respData || err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    if (clubId && yearId && month) fetchPreview();
  }, [clubId, yearId, month]);

  const handlePrevious = () => {
    router.push(`/clubs/${clubId}/club-monthly-report/v2/${yearId}/${month}${returnToQuery}`);
  };

  const handleUpload = async () => {
    if (!report) return;
    try {
      setError("");
      setSuccess("");

      // 1. Upload to district. The server now builds the detailed PDF and emails it to the
      //    DG, AG, Club President and Club Secretary in the background — no client-side PDF.
      await uploadMonthlyReportToDistrict(clubId, report.reportId);

      // 2. Re-fetch preview to reflect the updated uploaded status.
      const updatedReport = await getMonthlyReportPreview(clubId, yearId, month);
      setReport(updatedReport);

      // 3. Show success then redirect back to returnTo (or v2 landing).
      setSuccess("Report uploaded to district successfully. The report PDF is being emailed to the DG, AG, President and Secretary.");
      setTimeout(() => {
        const next = incomingReturnTo || `/clubs/${clubId}/club-monthly-report/v2`;
        router.push(next);
      }, 4000);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to upload report to district");
      setError(msg);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RotaryLoader />
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="space-y-4">
        <ErrorAlert open={!!error} title="Error" description={error} onOk={() => setError("")} />
        <button
          type="button"
          onClick={handlePrevious}
          className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Back to Edit
        </button>
      </div>
    );
  }

  if (!report) return null;

  // Group meetings by type for the preview tables.
  const meetingsByType: Record<string, ReportMeeting[]> = {};
  for (const meeting of report.meetings) {
    const type = meeting.meetingType || "other";
    if (!meetingsByType[type]) meetingsByType[type] = [];
    meetingsByType[type].push(meeting);
  }

  return (
    <div className="space-y-5 print:space-y-3 print:max-w-full">
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError("")} />
      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess("")} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={handlePrevious}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Back to wizard"
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Monthly Report · Preview
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {report.clubName} · {report.monthName} {report.yearLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Report header card */}
      <SectionCard
        icon={FileText}
        title={`Club Monthly Report — ${report.monthName} ${report.yearLabel}`}
      >
        <p className="text-xs text-slate-500 mb-3">{formatReportDate(report.reportDate)}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
          <InfoRow label="Club Name"            value={report.clubName} />
          <InfoRow label="Prepared By"          value={report.preparedBy || "-"} />
          <InfoRow label="Rotary Club ID"       value={report.clubCode || "-"} />
          <InfoRow label="Designation"          value={report.designation || "-"} />
          <InfoRow label="Assistant Governor"   value={report.assistantGovernor || "N/A"} />
          <InfoRow label="No. Of Members"       value={report.currentMemberCount} />
          <InfoRow label="No. Of Meetings"      value={report.totalMeetings} />
          <InfoRow label="Average % of Attendance" value={`${report.averageAttendance}%`} />
        </div>
      </SectionCard>

      {/* TRF Contribution */}
      <SectionCard icon={DollarSign} title="TRF Contribution">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 mb-4">
          <InfoRow label="Current Month" value={`$${report.trfCurrentMonth.toFixed(2)}`} />
          <InfoRow label="This Year"     value={`$${report.trfThisYear.toFixed(2)}`} />
        </div>
        {report.trfEntries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-slate-200">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left border border-slate-200 w-12">#</th>
                  <th className="px-3 py-2 text-left border border-slate-200">Date</th>
                  <th className="px-3 py-2 text-left border border-slate-200">Name</th>
                  <th className="px-3 py-2 text-right border border-slate-200">Amount (USD)</th>
                  <th className="px-3 py-2 text-left border border-slate-200">Fund Type</th>
                </tr>
              </thead>
              <tbody>
                {report.trfEntries.map((entry, idx) => (
                  <tr key={entry.trfId}>
                    <td className="px-3 py-2 border border-slate-200 tabular-nums">{idx + 1}</td>
                    <td className="px-3 py-2 border border-slate-200 whitespace-nowrap">{formatDate(entry.trfDate)}</td>
                    <td className="px-3 py-2 border border-slate-200">{entry.donorName}</td>
                    <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">${entry.amountUSD.toFixed(2)}</td>
                    <td className="px-3 py-2 border border-slate-200">
                      {entry.fundType === "Other" && entry.otherFundName ? entry.otherFundName : entry.fundType}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">No TRF entries for this month.</p>
        )}
      </SectionCard>

      {/* Meetings */}
      <SectionCard icon={Calendar} title="Meetings">
        {Object.keys(meetingsByType).length === 0 ? (
          <p className="text-xs text-slate-500 italic">No meetings recorded for this month.</p>
        ) : (
          Object.entries(meetingsByType).map(([type, list]) => (
            <div key={type} className="mb-4 last:mb-0">
              <h4 className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">
                {MEETING_TYPE_LABELS[type] || type} ({list.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-slate-200">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left border border-slate-200 w-12">#</th>
                      <th className="px-3 py-2 text-left border border-slate-200">Date</th>
                      <th className="px-3 py-2 text-left border border-slate-200">Title</th>
                      <th className="px-3 py-2 text-right border border-slate-200">Attendance</th>
                      <th className="px-3 py-2 text-right border border-slate-200">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((meeting, idx) => (
                      <tr key={meeting.projectId}>
                        <td className="px-3 py-2 border border-slate-200 tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2 border border-slate-200 whitespace-nowrap">{formatDate(meeting.projectDate)}</td>
                        <td className="px-3 py-2 border border-slate-200">{meeting.title}</td>
                        <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{meeting.attendance ?? "-"}</td>
                        <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">
                          {meeting.attendancePercentage != null ? `${meeting.attendancePercentage}%` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </SectionCard>

      {/* Projects by service type */}
      {Object.entries(PROJECT_LABELS).map(([key, label]) => {
        const projects = report.projects[key];
        if (!projects || projects.length === 0) return null;
        const isCommunity = key === "community_service";
        return (
          <SectionCard key={key} icon={FolderOpen} title={label}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-slate-200">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left border border-slate-200 w-12">#</th>
                    <th className="px-3 py-2 text-left border border-slate-200">Date</th>
                    <th className="px-3 py-2 text-left border border-slate-200">Title</th>
                    {isCommunity ? (
                      <>
                        <th className="px-3 py-2 text-left border border-slate-200">Area of Focus</th>
                        <th className="px-3 py-2 text-left border border-slate-200">Category</th>
                        <th className="px-3 py-2 text-left border border-slate-200">Sub Category</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 text-left border border-slate-200">Category</th>
                        <th className="px-3 py-2 text-left border border-slate-200">Sub Category</th>
                      </>
                    )}
                    <th className="px-3 py-2 text-right border border-slate-200">Cost</th>
                    <th className="px-3 py-2 text-right border border-slate-200">Direct Beneficiaries</th>
                    <th className="px-3 py-2 text-right border border-slate-200">Man Hours</th>
                    <th className="px-3 py-2 text-right border border-slate-200">Rotarians</th>
                    <th className="px-3 py-2 text-right border border-slate-200">Rotaractors</th>
                    <th className="px-3 py-2 text-right border border-slate-200">RCC</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project, idx) => (
                    <tr key={project.projectId}>
                      <td className="px-3 py-2 border border-slate-200 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 border border-slate-200 whitespace-nowrap">{formatDate(project.projectDate)}</td>
                      <td className="px-3 py-2 border border-slate-200">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {project.title}
                          {(key === "community_service" || key === "public_image_initiative") && (
                            <>
                              {project.projectType && (
                                <span
                                  className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                                    project.projectType === "one_time"
                                      ? "bg-blue-50 text-blue-700 border-blue-200"
                                      : "bg-violet-50 text-violet-700 border-violet-200"
                                  }`}
                                >
                                  {project.projectType === "one_time" ? "One Time" : "Ongoing"}
                                </span>
                              )}
                              {project.parentProjectId && (
                                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                                  Child Project
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                      {isCommunity ? (
                        <>
                          <td className="px-3 py-2 border border-slate-200">{project.areaOfFocusName || "-"}</td>
                          <td className="px-3 py-2 border border-slate-200">{project.categoryName || "-"}</td>
                          <td className="px-3 py-2 border border-slate-200">{project.subCategoryName || "-"}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 border border-slate-200">{project.areaOfFocusName || "-"}</td>
                          <td className="px-3 py-2 border border-slate-200">{project.categoryName || "-"}</td>
                        </>
                      )}
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">
                        {project.projectCost != null ? project.projectCost.toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{project.directBeneficiaries ?? "-"}</td>
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{project.manHours ?? "-"}</td>
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{project.rotariansInvolved ?? "-"}</td>
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{project.rotaractorsInvolved ?? "-"}</td>
                      <td className="px-3 py-2 border border-slate-200 text-right tabular-nums">{project.rccInvolved ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        );
      })}

      {/* Members */}
      <SectionCard icon={Users} title="Members">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 mb-4">
          <InfoRow label="Member count as on last month" value={report.memberCountLastMonth} />
          <InfoRow label="Members Deleted/Terminated"    value={report.membersDeleted} />
          <InfoRow label="Members Added"                 value={report.membersAdded} />
          <InfoRow label="Current No. Of Members"        value={report.currentMemberCount} />
        </div>
        {report.additionalRemarks && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-700 mb-1">
              Additional achievement / participation / hosting of events / projects above club:
            </p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{report.additionalRemarks}</p>
          </div>
        )}
      </SectionCard>

      {/* Advisory */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2 print:shadow-none">
        <Info size={14} className="text-amber-700 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-800">
          <strong>Note:</strong> Agenda, MOM added in meetings &amp; photographs added in Club
          Meetings will not be shared to the District — only the content displayed here will be
          shared to the District.
        </p>
      </div>

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 -mx-2 sm:-mx-0 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button
          type="button"
          onClick={handlePrevious}
          className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Previous (Edit)
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <LoadingButton
            type="button"
            onAction={handleUpload}
            loadingLabel="Uploading…"
            spinnerSize={14}
            className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload size={14} /> Upload to District
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}

export default function ClubMonthlyReportV2PreviewPage() {
  useSyncClubIdFromUrl();
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="CMR Preview"
        pageSubtitle="Review and upload monthly report"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        <ClubMonthlyReportV2PreviewInner />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
