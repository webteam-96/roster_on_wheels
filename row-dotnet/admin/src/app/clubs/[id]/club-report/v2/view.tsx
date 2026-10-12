"use client";

/**
 * Club Report v2 — read-only summary + per-section Excel export.
 *
 * Visuals follow the Club Admin Dashboard's design system (KpiCard grid + dense
 * section rows with per-row Excel download buttons). Data and APIs are identical
 * to v1 — no new endpoints. Honors ?returnTo= and ?yearId= query params.
 *
 * Back default → /club-admin-dashboard/e-governance (the Reports tab home).
 */

import { useEffect, useMemo, useState } from "react";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { CLUB_GOAL_SETTING_COMING_SOON } from "@/lib/clubGoalSetting";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, MessageCircle, Mail } from "lucide-react";
import Link from "next/link";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { getCitationMatrix, getClub } from "@/services/api";
import { exportCitationMatrix, exportCitationMatrixVertical } from "@/utils/citationMatrixExport";

// Club Report v2 — full per-section report (Club Service, Community Service,
// etc. with the new "Photos" hyperlink column). The active view is
// ClubReportV2PageImpl (exported below). The old stub which only offered the
// District Awards matrix download is preserved as ClubReportV2PageStub in case
// we need to revert.
function ClubReportV2PageStub() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const yearIdRaw = searchParams.get("yearId");
  const yearId = yearIdRaw ? Number(yearIdRaw) : undefined;
  const returnToParam = searchParams.get("returnTo");
  const back = returnToParam ? decodeURIComponent(returnToParam) : "/club-admin-dashboard/e-governance";

  const [club, setClub] = useState<any>(null);
  const [downloading, setDownloading] = useState<null | "full" | "extended">(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const c = await getClub(clubId); if (!cancelled) setClub(c); }
      catch { if (!cancelled) setError("Failed to load club details."); }
    })();
    return () => { cancelled = true; };
  }, [clubId]);

  const handleDownload = async (compact: boolean) => {
    if (!club?.fkDistrictId) { setError("District not resolved for this club."); return; }
    setDownloading(compact ? "extended" : "full"); setError(null); setSuccess(null);
    try {
      const matrix = await getCitationMatrix(club.fkDistrictId, yearId, clubId);
      const slug = (club.clubName || `Club_${clubId}`).replace(/\s+/g, "_");
      const suffix = compact ? "District_Awards" : "District_Awards_Extended";
      const ok = exportCitationMatrix(matrix, { filenamePrefix: `${slug}_${suffix}`, compact });
      if (ok) setSuccess((compact ? "District Awards" : "District Awards Extended") + " exported.");
      else setError("No citation data to export for this club / year.");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to export.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <ClubAdminShell
      pageTitle="Club Report"
      pageSubtitle={club ? `${club.clubName} · District Awards` : "District Awards"}
      activeNavHref="/club-admin-dashboard/e-governance"
    >
      <div className="space-y-4">
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={14} /> Back
        </Link>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-blue-100 p-3">
              <Award className="h-6 w-6 text-blue-700" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-slate-800">District Awards</h2>
              <p className="text-sm text-slate-500 mt-1">
                Download for this club only. Year is picked from the global search dropdown
                (current year if none selected).
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDownload(true)}
                  disabled={downloading !== null || !club}
                  className="h-9 inline-flex items-center gap-1.5 px-4 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {downloading === "extended" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>District Awards</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(false)}
                  disabled={downloading !== null || !club}
                  className="h-9 inline-flex items-center gap-1.5 px-4 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                >
                  {downloading === "full" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>District Awards Extended</span>
                </button>
                {success && <span className="text-xs text-emerald-700">{success}</span>}
                {error && <span className="text-xs text-red-700">{error}</span>}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                District Awards: Total Points per question only. Extended: Base · Achieved · Total per question.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ClubAdminShell>
  );
}
import {
  Award,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Crown,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Loader2,
  Megaphone,
  Newspaper,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getClubReport, getClubReportAvailableYears, downloadClubReportWord, getClubDcAllMembers, getClubDcBod, getClubDcDc, getClubAttendanceMatrix, downloadOcvReportExcel, downloadOcvReportWord, downloadClubAnalyticsClub, downloadClubGoalExcel, getClubAdminDashboardRotaryNetwork, getRotaryOrgTerminatedMembers } from "@/services/api";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";
import { exportToCSV } from "@/utils/csvExport";
import { exportAttendanceMatrix } from "@/utils/attendanceMatrixExport";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import LoadingButton from "@/components/v2/LoadingButton";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

// Default back target — Reports tab on the Club Admin dashboard.
const DEFAULT_BACK = "/club-admin-dashboard/e-governance";

type CsvCol = {
  key: string;
  label: string;
  width?: number;
  hyperlink?: boolean;
  linkText?: string;
  wrap?: boolean;
  index?: boolean;
};

type YearRow = { id: number; yearLabel: string; isCurrent?: boolean };

// PRESERVED — full Club Report implementation. Re-enable by swapping the
// default export at the top of this file. Do not delete.
// Named export — embeddable view. Rendered inline by the Club Admin E-Governance
// page; the route's prop-less default export (top of file) wraps it.
export function ClubReportV2PageImpl({ clubId: propClubId, embedded = false, yearId: globalYearId = null }: { clubId?: number; embedded?: boolean; yearId?: number | null } = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);

  // ── ?returnTo= and ?yearId= ────────────────────────────────────────────
  const urlReturnTo = searchParams.get("returnTo") || "";
  const backHref = urlReturnTo || DEFAULT_BACK;
  const urlYearId = searchParams.get("yearId");

  // ── state ──────────────────────────────────────────────────────────────
  const [years, setYears] = useState<YearRow[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Rotary Network (terminated + potential) — cached, same source as the club's dashboard, so the
  // report counts match what the admin sees. Fetched per (club, year); used for real counts + export.
  const [rnet, setRnet] = useState<{ terminated: any[]; potential: any[] } | null>(null);
  // Terminated Members in the report must MATCH the "Rotary Network" tab, which shows the LIVE
  // Rotary.org terminated list (larger than the locally soft-deleted subset). Fetch the same source;
  // fall back to the DB list (rnet.terminated) if the live fetch fails.
  const [liveTerminated, setLiveTerminated] = useState<any[] | null>(null);
  const [liveTermLoading, setLiveTermLoading] = useState(true);
  // District Awards (citation matrix) — fetched up front so the row shows a REAL count (0 when the
  // club has no citation data → button disabled) instead of a hardcoded "1", and export reuses it.
  const [citMatrix, setCitMatrix] = useState<any>(null);
  const [citLoading, setCitLoading] = useState(false);

  // ── load available years on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const yrs: YearRow[] = await getClubReportAvailableYears(clubId);
        if (cancelled) return;
        setYears(yrs || []);
        // Embedded (dashboard) mode: the GLOBAL year drives it (a separate effect syncs it) — don't
        // auto-select the module's own current/first data-year.
        if (globalYearId != null) {
          setSelectedYearId(String(globalYearId));
        } else if (urlYearId) {
          setSelectedYearId(urlYearId);
        } else if (yrs && yrs.length > 0) {
          const cur = yrs.find((y) => y.isCurrent);
          setSelectedYearId(String(cur?.id ?? yrs[0].id));
        }
      } catch {
        if (!cancelled) setErrorMessage("Failed to load years.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, urlYearId]);

  // Embedded in the dashboard → follow the GLOBAL dashboard year, not the module's own dropdown.
  useEffect(() => {
    if (globalYearId != null) setSelectedYearId(String(globalYearId));
  }, [globalYearId]);

  // ── load report whenever year changes ─────────────────────────────────
  useEffect(() => {
    if (!selectedYearId) return;
    let cancelled = false;
    (async () => {
      setReportLoading(true);
      try {
        const data = await getClubReport(clubId, Number(selectedYearId));
        if (!cancelled) setReport(data);
      } catch (err: any) {
        if (!cancelled) {
          setErrorMessage(err?.response?.data?.message || "Failed to load report.");
        }
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, selectedYearId]);

  // Rotary Network (cached) for the Terminated + Potential download rows.
  useEffect(() => {
    if (!clubId || !selectedYearId) { setRnet(null); return; }
    let cancelled = false;
    getClubAdminDashboardRotaryNetwork(Number(selectedYearId), clubId)
      .then((d) => { if (!cancelled) setRnet({ terminated: d.terminatedMembers || [], potential: d.potentialMembers || [] }); })
      .catch(() => { if (!cancelled) setRnet({ terminated: [], potential: [] }); });
    return () => { cancelled = true; };
  }, [clubId, selectedYearId]);

  // Live Rotary.org terminated members — same source the Rotary Network tab uses, so the report's
  // Terminated Members count/listing matches (e.g. 265) instead of the smaller local-DB subset.
  useEffect(() => {
    if (!clubId) { setLiveTerminated(null); setLiveTermLoading(false); return; }
    let cancelled = false;
    setLiveTermLoading(true);
    getRotaryOrgTerminatedMembers(clubId)
      .then((res) => { if (!cancelled) setLiveTerminated(res.members || []); })
      .catch(() => { if (!cancelled) setLiveTerminated(null); })   // null → fall back to rnet.terminated
      .finally(() => { if (!cancelled) setLiveTermLoading(false); });
    return () => { cancelled = true; };
  }, [clubId]);

  // District Awards citation matrix — fetch once so the count is real (and export reuses it).
  useEffect(() => {
    const dId = report?.club?.fkDistrictId;
    if (!dId || !clubId) { setCitMatrix(null); return; }
    let cancelled = false;
    setCitLoading(true);
    getCitationMatrix(dId, Number(selectedYearId) || undefined, clubId)
      .then((m) => { if (!cancelled) setCitMatrix(m); })
      .catch(() => { if (!cancelled) setCitMatrix(null); })
      .finally(() => { if (!cancelled) setCitLoading(false); });
    return () => { cancelled = true; };
  }, [report?.club?.fkDistrictId, clubId, selectedYearId]);

  // Real citation count: 1 when the club has citation data (questions + a row), else 0.
  const citCount = (citMatrix && (citMatrix.rows?.length ?? 0) > 0 && (citMatrix.columns?.length ?? 0) > 0) ? 1 : 0;

  // ── derived ────────────────────────────────────────────────────────────
  const yearLabel = useMemo(
    () => years.find((y) => String(y.id) === selectedYearId)?.yearLabel || "",
    [years, selectedYearId],
  );
  const clubName: string = report?.club?.clubName || "";

  // Excel export helper — adds clubName + yearLabel as title/subtitle so the
  // generated workbook is self-describing. Filename timestamp is appended
  // automatically by exportToCSV → fileTimestamp().
  const exportSection = async (
    data: any[],
    sectionName: string,
    columns: CsvCol[],
  ): Promise<void> => {
    if (!data || data.length === 0) return;
    exportToCSV(
      data,
      `${clubName || "Club"}_${sectionName.replace(/\s+/g, "_")}`,
      columns,
      {
        title: `${sectionName} — ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      },
    );
    // No success toast — browser's file-download UI is the confirmation.
  };

  // ── render ─────────────────────────────────────────────────────────────
  if (loading) {
    const loadingBody = (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading…
      </div>
    );
    if (embedded) return loadingBody;
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Club Report"
          pageSubtitle="Year-wise club data summary"
          activeNavHref="/club-admin-dashboard/e-governance"
        >
          {loadingBody}
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  // Projects-by-module export column sets (Club Service omits AOF/Cat/Sub-Cat).
  const projectColsFor = (moduleKey: string): CsvCol[] => {
    const isClubService = moduleKey === "club_service";
    return isClubService
      ? [
          { key: "title", label: "Title", width: 25 },
          { key: "projectDate", label: "Date", width: 15 },
          { key: "location", label: "Location", width: 20 },
          { key: "projectCost", label: "Cost", width: 12 },
          { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
          { key: "manHours", label: "Man Hours", width: 12 },
          { key: "funding", label: "Funding", width: 15 },
          { key: "approvalStatus", label: "Status", width: 14 },
          { key: "publicPhotoUrl", label: "Photos", width: 12, hyperlink: true, linkText: "Photos" },
        ]
      : [
          { key: "title", label: "Title", width: 25 },
          { key: "projectDate", label: "Date", width: 15 },
          { key: "areaOfFocus", label: "Area of Focus", width: 20 },
          { key: "category", label: "Category", width: 18 },
          { key: "subCategory", label: "Sub Category", width: 18 },
          { key: "location", label: "Location", width: 20 },
          { key: "projectCost", label: "Cost", width: 12 },
          { key: "directBeneficiaries", label: "Beneficiaries", width: 14 },
          { key: "manHours", label: "Man Hours", width: 12 },
          { key: "funding", label: "Funding", width: 15 },
          { key: "approvalStatus", label: "Status", width: 14 },
          { key: "publicPhotoUrl", label: "Photos", width: 12, hyperlink: true, linkText: "Photos" },
        ];
  };

  const body = (
      <div className="space-y-6">
        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />

        {/* ── Header: Back + title + year selector ───────────────────── */}
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start ${embedded ? "sm:justify-end" : "sm:justify-between"}`}>
          {!embedded && (
          <div className="flex items-start gap-2">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <SectionHeader
              title="Club Report"
              subtitle={`${clubName || "—"}${yearLabel ? ` · RY ${yearLabel}` : ""} — comprehensive club activity report`}
              icon={BarChart3}
            />
          </div>
          )}

          {!embedded && years.length > 0 && (
            <select
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-56"
            >
              {years.map((y) => (
                <option key={y.id} value={String(y.id)}>
                  {y.yearLabel}
                  {y.isCurrent ? " · current" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {reportLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading report…
          </div>
        ) : !report ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
            No report data available.
          </div>
        ) : (
          <>
            {/* Summary KPI grid removed — backend still returns report.summary
                but the UI no longer renders the cards. Matches the cleanup
                done on DistrictReportContent so the export-only workflow
                isn't blocked by stat-card rendering. */}

            {/* ── Communication logs (WhatsApp / Email delivery) — opened from Reports ── */}
            {embedded && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Communication Logs</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Delivery status of WhatsApp &amp; Email sent to your club&apos;s members</p>
                </div>
                <div className="p-4 flex flex-wrap gap-3">
                  <Link href="/club-admin-dashboard/whatsapp-log" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200">
                    <MessageCircle size={14} /> WhatsApp Log
                  </Link>
                  <Link href="/club-admin-dashboard/email-log" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200">
                    <Mail size={14} /> Email Log
                  </Link>
                </div>
              </div>
            )}

            {/* ── Per-section export rows ─────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">
                  Section Exports
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Download each module as a styled Excel workbook · RY {yearLabel}
                </p>
              </div>

              <ul className="divide-y divide-slate-100">
                {/* ── MEMBERS subsection ────────────────────────────────── */}
                <SubsectionHeader title="Members" />

                {/* Rotary Network — Terminated Members (this club; cached, same as the dashboard). */}
                <SectionRow
                  title="Terminated Members"
                  icon={Users}
                  loading={liveTermLoading}
                  count={(liveTerminated ?? rnet?.terminated ?? []).length}
                  onExport={async () => {
                    const rows = (liveTerminated ?? rnet?.terminated ?? []).map((m: any) => ({
                      memberId: m.memberId,
                      name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(" ").trim(),
                      memberType: m.memberType,
                      admissionDate: m.admissionDate ? new Date(m.admissionDate).toLocaleDateString("en-GB") : "",
                      terminationDate: m.terminationDate ? new Date(m.terminationDate).toLocaleDateString("en-GB") : "",
                      terminationReason: m.terminationReason || "",
                      mobile: m.mobile || "",
                      email: m.email || "",
                    }));
                    await exportSection(rows, "Terminated Members", [
                      { key: "srNo", label: "Sr. No.", width: 8, index: true },
                      { key: "memberId", label: "Member ID", width: 14 },
                      { key: "name", label: "Name", width: 28 },
                      { key: "memberType", label: "Member Type", width: 16 },
                      { key: "admissionDate", label: "Admission Date", width: 16 },
                      { key: "terminationDate", label: "Termination Date", width: 16 },
                      { key: "terminationReason", label: "Termination Reason", width: 30 },
                      { key: "mobile", label: "Mobile", width: 16 },
                      { key: "email", label: "Email", width: 28 },
                    ]);
                  }}
                />

                {/* Rotary Network — Potential Members (this club; cached, same as the dashboard). */}
                <SectionRow
                  title="Potential Members"
                  icon={Users}
                  count={rnet?.potential.length ?? 0}
                  onExport={async () => {
                    const rows = (rnet?.potential || []).map((m: any) => ({
                      name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(" ").trim(),
                      email: m.email || "",
                      mobile: m.mobile || "",
                      referenceDetails: m.notes || "",
                    }));
                    await exportSection(rows, "Potential Members", [
                      { key: "srNo", label: "Sr. No.", width: 8, index: true },
                      { key: "name", label: "Name", width: 28 },
                      { key: "email", label: "Email", width: 28 },
                      { key: "mobile", label: "Mobile", width: 16 },
                      { key: "referenceDetails", label: "Reference Details", width: 40 },
                    ]);
                  }}
                />

                {/* 1. Mobile-app active users (LastDeviceName populated) */}
                <SectionRow
                  title="Members (Active users in ROW App)"
                  icon={Users}
                  count={report.appUsers?.length || 0}
                  onExport={() =>
                    exportSection(report.appUsers, "App_Active_Users", [
                      { key: "memberName", label: "Member Name", width: 25 },
                      { key: "mobile",     label: "Mobile Number", width: 16 },
                      { key: "email",      label: "Email Id",     width: 30 },
                      { key: "deviceName", label: "Device Name",  width: 14 },
                    ])
                  }
                />

                {/* 2. BOD — with inline designation filter dropdown */}
                <BodSectionRow
                  bod={report.bod || []}
                  yearLabel={yearLabel}
                  clubName={clubName}
                />

                {/* 3. All Members — full 19-field report.
                    DOB / DOA: day + short month only (no year, no time —
                    project rule, birthdays carry year=1900 placeholder).
                    RI Admission Date: date only, no time. */}
                <SectionRow
                  title="Members"
                  icon={Users}
                  count={report.members?.length || 0}
                  onExport={() => {
                    const fmtDayMonth = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                    };
                    const fmtDateOnly = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                    };
                    const data = (report.members || []).map((r: any) => ({
                      ...r,
                      dob:             fmtDayMonth(r.dob),
                      doa:             fmtDayMonth(r.doa),
                      riAdmissionDate: fmtDateOnly(r.riAdmissionDate),
                    }));
                    return exportSection(data, "Members", [
                      { key: "clubName",        label: "Club Name",         width: 25 },
                      { key: "memberName",      label: "Member Name",       width: 25 },
                      { key: "profilePhoto",    label: "Profile Photo",     width: 14, hyperlink: true, linkText: "Photo" },
                      { key: "classification",  label: "Classification",    width: 22 },
                      { key: "clubDesignation", label: "Club Designation",  width: 20 },
                      { key: "memberType",      label: "Active/HON.",       width: 12 },
                      { key: "country",         label: "Country",           width: 14 },
                      { key: "mobile",          label: "Mobile",            width: 16 },
                      { key: "email",           label: "EmailId",           width: 30 },
                      { key: "gender",          label: "Gender",            width: 10 },
                      { key: "address",         label: "Personal Address",  width: 40 },
                      { key: "businessAddress", label: "Business Address",  width: 40 },
                      { key: "primaryLanguage", label: "Primary Language",  width: 16 },
                      { key: "youthFlag",       label: "Youth Flag",        width: 10 },
                      { key: "dob",             label: "DOB",               width: 14 },
                      { key: "doa",             label: "DOA",               width: 14 },
                      { key: "bloodGroup",      label: "Blood Group",       width: 12 },
                      { key: "deviceName",      label: "Device Name",       width: 14 },
                      { key: "downloaded",      label: "Downloaded",        width: 12 },
                      { key: "rotaryId",        label: "Rotary Id",         width: 14 },
                      // COG (club 31598): the whole report is that one club, so the
                      // admission-date column is replaced outright by the DG district +
                      // Rotary year rather than left as a blank column. Every other club
                      // exports exactly the same columns as before.
                      ...(clubId === 31598
                        ? [
                            { key: "cogDistrictNumber", label: "District",    width: 14 },
                            { key: "cogYear",           label: "Rotary Year", width: 14 },
                          ]
                        : [{ key: "riAdmissionDate", label: "RI Admission Date", width: 16 }]),
                    ]);
                  }}
                />

                {/* 4. Family details — flat, filterable sheet. Source rows are one per
                    (member × family member); we show the member's own columns ONCE (on
                    their first family row) and leave them BLANK on the member's remaining
                    family rows, so the member block reads once but the sheet stays a single
                    filterable table. DOB/DOA/Family dates = day + short month only. */}
                <SectionRow
                  title="Family details"
                  icon={Users}
                  count={report.family?.length || 0}
                  onExport={() => {
                    const fmtDayMonth = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                    };
                    // Member-identity columns blanked on repeat rows (rows are already
                    // ordered by member, so a member's family rows are contiguous).
                    const memberKeys = ["clubName", "memberName", "mobile", "email", "dob", "doa", "rotaryId", "address"];
                    const seen = new Set<string>();
                    const data = (report.family || []).map((r: any) => {
                      const key = String(r.rotaryId || `name:${r.memberName || ""}`);
                      const firstOfMember = !seen.has(key);
                      seen.add(key);
                      const out: any = {
                        ...r,
                        dob:               fmtDayMonth(r.dob),
                        doa:               fmtDayMonth(r.doa),
                        familyDob:         fmtDayMonth(r.familyDob),
                        familyAnniversary: fmtDayMonth(r.familyAnniversary),
                      };
                      if (!firstOfMember) for (const k of memberKeys) out[k] = "";
                      return out;
                    });
                    return exportSection(data, "Family_Details", [
                      { key: "clubName",          label: "Club Name",            width: 25 },
                      { key: "memberName",        label: "Member Name",          width: 25 },
                      { key: "mobile",            label: "Mobile",               width: 16 },
                      { key: "email",             label: "EmailId",              width: 30 },
                      { key: "dob",               label: "DOB",                  width: 14 },
                      { key: "doa",               label: "DOA",                  width: 14 },
                      { key: "rotaryId",          label: "Rotary Id",            width: 14 },
                      { key: "address",           label: "Address",              width: 40 },
                      { key: "familyRelation",    label: "Family Relation",      width: 16 },
                      { key: "familyName",        label: "Family Name",          width: 25 },
                      { key: "familyMobile",      label: "Family Mobile Number", width: 18 },
                      { key: "familyEmail",       label: "Family EmailId",       width: 30 },
                      { key: "familyDob",         label: "Family DOB",           width: 14 },
                      { key: "familyAnniversary", label: "Family Anniversary",   width: 16 },
                      { key: "familyBloodGroup",  label: "Family Blood Group",   width: 14 },
                    ]);
                  }}
                />

                {/* 4b. Blood Group — emergency call-list: every member AND their family
                    members as rows, each with their own blood group + contact. Member row
                    first, then their family beneath. Filter by Blood Group in Excel to find
                    donors fast. Club report omits District Number + Club Name. */}
                <SectionRow
                  title="Blood Group"
                  icon={Users}
                  count={report.bloodGroups?.length || 0}
                  onExport={() =>
                    exportSection(report.bloodGroups || [], "Blood_Group", [
                      { key: "sr",         label: "Sr No",         width: 8, index: true },
                      { key: "personName", label: "Member Name",   width: 28 },
                      { key: "relation",   label: "Relation",      width: 16 },
                      { key: "mobile",     label: "Mobile Number", width: 18 },
                      { key: "email",      label: "Email Id",      width: 30 },
                      { key: "bloodGroup", label: "Blood Group",   width: 14 },
                    ])
                  }
                />

                {/* 5–7. Data Collection reports — render ONLY when this club's
                    district has an active district_directory_config for the
                    selected year. When the config is absent, report.dataCollection
                    is null and these 3 rows disappear entirely (including titles). */}
                {report.dataCollection && (
                  <>
                    <SectionRow
                      title="Data Collection (All Members)"
                      icon={Users}
                      count={1}
                      onExport={async () => {
                        try {
                          const rows = await getClubDcAllMembers(clubId, Number(selectedYearId));
                          exportSection(rows, "Data_Collection_All_Members",
                            report.dataCollection.columns.allMembers.map((c: any) => ({ key: c.key, label: c.label, width: 18, greenWhen100Percent: c.key === "donePercent" })));
                        } catch (err: any) { alert("Failed to load Data Collection (All Members)."); }
                      }}
                    />
                    <SectionRow
                      title="Data Collection (BOD (Club President & Secretary))"
                      icon={UserCircle}
                      count={1}
                      onExport={async () => {
                        try {
                          const rows = await getClubDcBod(clubId, Number(selectedYearId));
                          exportSection(rows, "Data_Collection_President_and_Secretary",
                            report.dataCollection.columns.bod.map((c: any) => ({ key: c.key, label: c.label, width: 18, greenWhen100Percent: c.key === "donePercent" })));
                        } catch (err: any) { alert("Failed to load Data Collection (BOD)."); }
                      }}
                    />
                    <SectionRow
                      title="Data Collection (District Committee (DC))"
                      icon={UserCircle}
                      count={1}
                      onExport={async () => {
                        try {
                          const rows = await getClubDcDc(clubId, Number(selectedYearId));
                          exportSection(rows, "Data_Collection_District_Committee",
                            report.dataCollection.columns.dc.map((c: any) => ({ key: c.key, label: c.label, width: 18, greenWhen100Percent: c.key === "donePercent" })));
                        } catch (err: any) { alert("Failed to load Data Collection (DC)."); }
                      }}
                    />
                  </>
                )}

                {/* ── CLUBS subsection ───────────────────────────────────── */}
                <SubsectionHeader title="Clubs" />

                {/* Club Analytics — this club's per-avenue project / meeting / member / etc. COUNTS (.xlsx). */}
                <SectionRow
                  title="Club Analytics"
                  icon={BarChart3}
                  count={1}
                  onExport={async () => {
                    const blob = await downloadClubAnalyticsClub(Number(selectedYearId) || undefined, clubId);
                    saveAs(blob, `Club_Analytics_${(clubName || "club").replace(/\s+/g, "-")}_${fileTimestamp()}.xlsx`);
                  }}
                />

                {/* Goal Setting — this club's Month wise & Till date goals (all categories, 2 sheets). */}
                <SectionRow
                  title="Goal Setting (Month wise & Till date)"
                  icon={BarChart3}
                  count={1}
                  comingSoon={CLUB_GOAL_SETTING_COMING_SOON}
                  onExport={async () => {
                    const blob = await downloadClubGoalExcel(Number(selectedYearId) || undefined, clubId);
                    saveAs(blob, `Goal_Setting_${(clubName || "club").replace(/\s+/g, "-")}_${fileTimestamp()}.xlsx`);
                  }}
                />

                {/* 1 + 2. Attendance reports — ALWAYS shown, even with zero
                    meetings/records (per request), so the club still sees the
                    attendance report rows (and can export the headers). Counts
                    are null-safe → 0 when nothing has been recorded yet. */}
                {(
                  <>
                    <SectionRow
                      title="Attendance (Meeting Wise)"
                      icon={CalendarDays}
                      count={report.attendanceMeetingWise?.length || 0}
                      onExport={() => {
                        const fmtDate = (v: any) => {
                          if (!v) return "";
                          const d = new Date(v);
                          if (isNaN(d.getTime())) return "";
                          return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                        };
                        const data = (report.attendanceMeetingWise || []).map((r: any) => ({ ...r, date: fmtDate(r.date) }));
                        return exportSection(data, "Attendance_Meeting_Wise", [
                          { key: "date",             label: "Date",             width: 14 },
                          { key: "title",            label: "Event Name",       width: 30 },
                          { key: "description",      label: "Description",      width: 35 },
                          { key: "membersPresent",   label: "Members Present",  width: 16 },
                          { key: "totalMembers",     label: "Total Members",    width: 14 },
                          { key: "attendancePercent",label: "Attendance %",     width: 14 },
                          { key: "anns",             label: "Anns",             width: 8  },
                          { key: "annets",           label: "Annets",           width: 8  },
                          { key: "visitors",         label: "Visitors",         width: 10 },
                          { key: "rotarians",        label: "Rotarians",        width: 10 },
                          { key: "delegates",        label: "Delegates",        width: 10 },
                        ]);
                      }}
                    />
                    <SectionRow
                      title="Attendance (Member Wise)"
                      icon={Users}
                      count={report.attendanceMemberWise?.length || 0}
                      onExport={async () => {
                        // Matrix layout: members down the left, each event across the top
                        // (event name + date/time), cells = P (present) / A (absent) + a
                        // Total Present column. Fetched on demand — the matrix is large.
                        try {
                          const matrix = await getClubAttendanceMatrix(clubId, Number(selectedYearId));
                          const slug = (clubName || `Club_${clubId}`).replace(/\s+/g, "_");
                          const ok = exportAttendanceMatrix(matrix, { filenamePrefix: `${slug}_Member_Wise_Attendance` });
                          if (!ok) setErrorMessage("No attendance data to export for this year.");
                        } catch (err: any) {
                          setErrorMessage(err?.response?.data?.message || "Failed to export the member-wise attendance.");
                        }
                      }}
                    />
                  </>
                )}

                {/* 3. Club Dues (OCV) — this club's dues by type (District / Rotary News Trust /
                    RI Semi Annual 1 & 2 / Others …), exported horizontally with a Total. */}
                {(report.duesReportOcv?.length ?? 0) > 0 && (() => {
                  const types = (report.duesReportOcv as any[]).slice().sort(
                    (a, b) => (Number(a.typeSort) - Number(b.typeSort)) || String(a.documentType).localeCompare(String(b.documentType)),
                  );
                  return (
                    <SectionRow
                      title={`Club Dues (${types.map((t) => String(t.documentType)).join(", ")})`}
                      icon={IndianRupee}
                      count={types.length}
                      onExport={() => {
                        const fmtD = (v: any) => {
                          if (!v) return "";
                          const d = new Date(v);
                          return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
                        };
                        // Club download → no District Number / Club Name columns (redundant for a single club).
                        const row: any = { srNo: 1 };
                        const cols: any[] = [
                          { key: "srNo", label: "Sr.No.", width: 8 },
                        ];
                        for (const t of types) {
                          // Yes/No (uploaded?) + latest Date per dues type.
                          row[`type_${t.typeId}`] = Number(t.isUploaded) === 1 ? "Yes" : "No";
                          row[`date_${t.typeId}`] = t.paidOn ? fmtD(t.paidOn) : "";
                          cols.push({ key: `type_${t.typeId}`, label: String(t.documentType), width: 16 });
                          cols.push({ key: `date_${t.typeId}`, label: "Date", width: 14 });
                        }
                        return exportSection([row], "Club_Dues", cols);
                      }}
                    />
                  );
                })()}

                {/* 4. Club Monthly Report — Jul→Jun order (backend),
                    with totals row appended client-side. */}
                <SectionRow
                  title="Club Monthly Report"
                  icon={BarChart3}
                  count={report.monthlyReport?.length || 0}
                  onExport={() => {
                    const rows = report.monthlyReport || [];
                    const numCols = ["clubService", "trf", "projects", "cost", "beneficiaries", "manHours", "rotariansInvolved", "rotaractors", "rcc"];
                    const totals: Record<string, any> = { month: "Total" };
                    for (const k of numCols) {
                      totals[k] = rows.reduce((s: number, r: any) => s + (Number(r[k]) || 0), 0);
                    }
                    const data = rows.length > 0 ? [...rows, totals] : rows;
                    return exportSection(data, "Club_Monthly_Report", [
                      { key: "month",             label: "Month",              width: 18 },
                      { key: "clubService",       label: "Club Service",       width: 12 },
                      { key: "trf",               label: "TRF",                width: 14 },
                      { key: "projects",          label: "Projects",           width: 12 },
                      { key: "cost",              label: "Cost",               width: 14 },
                      { key: "beneficiaries",     label: "Beneficiaries",      width: 14 },
                      { key: "manHours",          label: "Man Hours",          width: 12 },
                      { key: "rotariansInvolved", label: "Rotarians Involved", width: 18 },
                      { key: "rotaractors",       label: "Rotaractors",        width: 14 },
                      { key: "rcc",              label: "RCC",                width: 12 },
                    ]);
                  }}
                />

                {/* 5. Avenue of Service — single row with avenue dropdown */}
                <AvenueOfServiceRow
                  attendance={report.attendanceMeetingWise || []}
                  projectsByModule={report.projectsByModule || {}}
                  clubName={clubName}
                  yearLabel={yearLabel}
                />

                {/* Annual Report (Word) — book-like: membership + club service +
                    all avenues for the year, each item detailed with photos. */}
                <WordReportRow
                  title="Annual Report (Word)"
                  subtitle="Club Service + all avenues + membership · with photos"
                  icon={FileText}
                  onDownload={() =>
                    downloadClubReportWord(
                      clubId,
                      Number(selectedYearId),
                      "annual-report",
                      `${clubName}_Annual_Report_${yearLabel}`,
                    )
                  }
                />

                {/* Governor's Official Visit (OCV/GOV) — this club, Excel + Word */}
                <SubsectionHeader title="Governor's Official Visit" />
                <OcvClubReportRow
                  clubId={clubId}
                  yearId={Number(selectedYearId)}
                  clubName={clubName}
                  yearLabel={yearLabel}
                />

                {/* Word .docx raw-data reports removed for now (will do later). */}

                {/* 8 + 9. PPH Camp + Attendees — ALWAYS shown (even with no camps/attendees:
                    count 0 + disabled download), matching the district report. */}
                <>
                {/* 8. PPH Camp */}
                <SectionRow
                  title="PPH Camp"
                  icon={Award}
                  count={report.pphCamps?.length || 0}
                  onExport={() => {
                    const fmtDt = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                    };
                    const data = (report.pphCamps || []).map((r: any) => ({ ...r, campDate: fmtDt(r.campDate) }));
                    return exportSection(data, "PPH_Camp", [
                      { key: "campDate",        label: "Camp Date",        width: 14 },
                      { key: "campName",        label: "Camp Name",        width: 32 },
                      { key: "campAddress",     label: "Camp Address",     width: 40 },
                      { key: "totalAttendees",  label: "Total Attendees",  width: 16 },
                      { key: "campDescription", label: "Camp Description", width: 60, wrap: true },
                    ]);
                  }}
                />

                {/* 9. PPH Camp Attendees — always shown. */}
                <SectionRow
                  title="PPH Camp Attendees"
                  icon={Users}
                  count={report.pphCampAttendees?.length || 0}
                  onExport={() => {
                    const fmtDt = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                    };
                    // One row per medical reading (camps in the selected Rotary year).
                    const data = (report.pphCampAttendees || []).map((r: any) => ({ ...r, campDate: fmtDt(r.campDate), readingDate: fmtDt(r.readingDate) }));
                    return exportSection(data, "PPH_Camp_Attendees", [
                      { key: "campDate",          label: "Camp Date",         width: 14 },
                      { key: "readingDate",       label: "Reading Date",      width: 14 },
                      { key: "serialNumber",      label: "Serial Number",     width: 14 },
                      { key: "name",              label: "Name",              width: 25 },
                      { key: "mobileNumber",      label: "Mobile Number",     width: 16 },
                      { key: "address",           label: "Address",           width: 40 },
                      { key: "gender",            label: "Gender",            width: 10 },
                      { key: "approvalForSms",    label: "Approval for SMS",  width: 14 },
                      { key: "age",               label: "Age",               width: 8  },
                      { key: "bpSystolic",        label: "BP (Systolic)",     width: 14 },
                      { key: "bpDiastolic",       label: "BP (Diastolic)",    width: 14 },
                      { key: "fbs",               label: "FBS mg/dl",         width: 12 },
                      { key: "rbs",               label: "RBS mg/dl",         width: 12 },
                      { key: "height",            label: "Height (Cms)",      width: 12 },
                      { key: "weight",            label: "Weight (kg)",       width: 12 },
                      { key: "bmi",               label: "BMI",               width: 10 },
                      { key: "diabetes",          label: "Diabetes",          width: 22 },
                      { key: "highBloodPressure", label: "High Blood Pressure", width: 22 },
                      { key: "obese",             label: "Obese",             width: 10 },
                      { key: "overweight",        label: "Overweight",        width: 12 },
                      { key: "remarks",           label: "Remarks",           width: 30 },
                      { key: "campName",          label: "Camp Name",         width: 32 },
                    ]);
                  }}
                />
                  </>

                {/* 10. TRF Contributions */}
                <SectionRow
                  title="TRF Contributions"
                  icon={IndianRupee}
                  count={report.trf?.length || 0}
                  onExport={() => {
                    const fmtDt = (v: any) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                    };
                    const data = (report.trf || []).map((r: any) => ({ ...r, trfDate: fmtDt(r.trfDate) }));
                    return exportSection(data, "TRF_Contributions", [
                      { key: "trfDate",   label: "Date",         width: 14 },
                      { key: "donorName", label: "Member Name",  width: 25 },
                      { key: "fundName",  label: "Fund",         width: 20 },
                      { key: "amountUsd", label: "Amount (USD)", width: 15 },
                    ]);
                  }}
                />

                {/* 11–14. Announcements / Events / Newsletters / Documents —
                    moved here from the District subsection per spec. Newsletter
                    and Document include an "Open" hyperlink column built from
                    the backend's filePath (already CONCAT'd to a /Documents/...
                    URL — csvExport prepends the API host to make it clickable). */}
                <SectionRow
                  title="Announcements"
                  icon={Megaphone}
                  count={report.announcements?.length || 0}
                  onExport={() =>
                    exportSection(report.announcements, "Announcements", [
                      { key: "title", label: "Title", width: 25 },
                      { key: "description", label: "Description", width: 30 },
                      {
                        key: "imagePath",
                        label: "Image",
                        width: 14,
                        hyperlink: true,
                        linkText: "Image",
                      },
                      { key: "publishDate", label: "Publish Date", width: 18 },
                      { key: "expiryDate", label: "Expiry Date", width: 18 },
                      { key: "status", label: "Status", width: 14 },
                    ])
                  }
                />

                <SectionRow
                  title="Upcoming Events"
                  icon={CalendarClock}
                  count={report.events?.length || 0}
                  onExport={() =>
                    exportSection(report.events, "Upcoming_Events", [
                      { key: "title", label: "Title", width: 25 },
                      { key: "description", label: "Description", width: 30 },
                      { key: "eventDate", label: "Event Date", width: 18 },
                      { key: "eventVenue", label: "Venue", width: 20 },
                      {
                        key: "imagePath",
                        label: "Image",
                        width: 14,
                        hyperlink: true,
                        linkText: "Image",
                      },
                      {
                        key: "registrationLink",
                        label: "Registration",
                        width: 14,
                        hyperlink: true,
                        linkText: "Link",
                      },
                      { key: "publishDate", label: "Publish Date", width: 18 },
                      { key: "status", label: "Status", width: 14 },
                    ])
                  }
                />

                <SectionRow
                  title="Newsletters"
                  icon={Newspaper}
                  count={report.newsletters?.length || 0}
                  onExport={() => {
                    // Backend returns filePath (uploaded file) AND linkUrl
                    // (external URL). One or the other is set depending on
                    // attachmentType. Coalesce so the Open column always
                    // works regardless of which was used.
                    const data = (report.newsletters || []).map((r: any) => ({
                      ...r,
                      openUrl: r.filePath || r.linkUrl || "",
                    }));
                    return exportSection(data, "Newsletters", [
                      { key: "title", label: "Title", width: 25 },
                      { key: "publishDate", label: "Publish Date", width: 18 },
                      { key: "openUrl", label: "Open Newsletter", width: 16, hyperlink: true, linkText: "Open" },
                    ]);
                  }}
                />

                <SectionRow
                  title="Documents"
                  icon={FileText}
                  count={report.documents?.length || 0}
                  onExport={() =>
                    exportSection(report.documents, "Documents", [
                      { key: "title", label: "Title", width: 25 },
                      { key: "accessType", label: "Access", width: 14 },
                      { key: "publishDate", label: "Publish", width: 18 },
                      { key: "expiryDate", label: "Expiry", width: 18 },
                      // "Open Document" → backend filePath already includes the
                      // /Documents/documentsafe/Group{id}/ prefix.
                      { key: "filePath", label: "Open Document", width: 16, hyperlink: true, linkText: "Open" },
                    ])
                  }
                />

                {/* ── DISTRICT subsection ───────────────────────────────── */}
                <SubsectionHeader title="District" />

                {/* Per-avenue project rows (Community / Club / Vocational /
                    International / Public Image) intentionally removed from the
                    District subsection — those reports already live under the
                    Avenue of Service dropdown in the CLUBS subsection.
                    Announcements / Events / Newsletters / Documents moved up
                    to the CLUBS subsection per spec. */}

                {/* District Awards + District Awards Extended — club print layout.
                    Uses the VERTICAL exporter (one question per row, grouped by
                    category, like the Club Analytics print report) since this is a
                    single-club download. The district egov dashboard keeps the wide
                    matrix; only the club report is vertical. */}
                {report.club?.fkDistrictId && (
                  <>
                    {/* Swapped meaning (user request): "District Awards" = Total Points
                        only (compact); "District Awards Extended" = Base + Achieved + Total. */}
                    <SectionRow
                      title="District Awards"
                      icon={Award}
                      count={citCount}
                      loading={citLoading}
                      onExport={async () => {
                        if (!citMatrix) return;
                        const slug = (clubName || `Club_${clubId}`).replace(/\s+/g, "_");
                        exportCitationMatrixVertical(citMatrix, { filenamePrefix: `${slug}_District_Awards`, compact: true });
                      }}
                    />
                    <SectionRow
                      title="District Awards Extended"
                      icon={Award}
                      count={citCount}
                      loading={citLoading}
                      onExport={async () => {
                        if (!citMatrix) return;
                        const slug = (clubName || `Club_${clubId}`).replace(/\s+/g, "_");
                        exportCitationMatrixVertical(citMatrix, { filenamePrefix: `${slug}_District_Awards_Extended` });
                      }}
                    />
                  </>
                )}

                {/* Attendance row intentionally removed from District section —
                    it already lives under the CLUBS subsection (Attendance
                    Meeting Wise + Member Wise). */}
                {false && (
                <SectionRow
                  title="Attendance"
                  icon={CheckSquare}
                  count={report.attendance?.length || 0}
                  onExport={() =>
                    exportSection(report.attendance, "Attendance", [
                      { key: "eventName", label: "Event", width: 25 },
                      { key: "eventDateTime", label: "Date", width: 18 },
                      { key: "membersPresent", label: "Members Present", width: 16 },
                      { key: "visitors", label: "Visitors", width: 10 },
                      { key: "rotarians", label: "Rotarians", width: 10 },
                      { key: "totalMembers", label: "Total Active", width: 12 },
                      { key: "attendancePercent", label: "Attendance %", width: 14 },
                    ])
                  }
                />
                )}

              </ul>
            </div>
          </>
        )}
      </div>
  );

  if (embedded) return body;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Report"
        pageSubtitle="Year-wise club data summary"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        {body}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

// Disabled placeholder row used for reports still being built ("Coming Soon").
// Keeps the title visible but disables the Excel button so users know it's on
// the roadmap. Used for District Dues + the two Word .docx reports per spec.
// A real Word .docx download row (parallels SectionRow but for server-generated Word).
function WordReportRow({
  title,
  subtitle,
  icon: Icon,
  onDownload,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  onDownload: () => Promise<void> | void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-blue-50/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5] ring-1 ring-blue-100 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
      </div>
      <LoadingButton
        onAction={async () => { await onDownload(); }}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
      >
        <Download size={13} /> Word
      </LoadingButton>
    </li>
  );
}

// Governor's Official Visit (OCV/GOV) row — Excel + Word icons for THIS club. Uses the same
// rich per-club report the district module downloads (documents/{...}/report/{excel|word}).
function OcvClubReportRow({ clubId, yearId, clubName, yearLabel }: {
  clubId: number; yearId: number; clubName: string; yearLabel: string;
}) {
  const base = `${(clubName || `Club_${clubId}`).replace(/\s+/g, "_")}_OCV_${yearLabel}`;
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-blue-50/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5] ring-1 ring-blue-100 shrink-0">
          <Crown size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Governor&apos;s Official Visit (OCV/GOV)</p>
          <p className="text-xs text-slate-500 truncate">All sub-modules + uploaded documents · RY {yearLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <LoadingButton
          onAction={async () => { await downloadOcvReportExcel(clubId, yearId, base); }}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
        >
          <FileSpreadsheet size={13} /> Excel
        </LoadingButton>
        <LoadingButton
          onAction={async () => { await downloadOcvReportWord(clubId, yearId, base); }}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
        >
          <FileText size={13} /> Word
        </LoadingButton>
      </div>
    </li>
  );
}

function ComingSoonRow({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 opacity-60">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 truncate">{title}</p>
          <p className="text-xs text-amber-600">Coming Soon</p>
        </div>
      </div>
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-400 cursor-not-allowed"
      >
        <Download size={13} /> Excel
      </button>
    </li>
  );
}

// ── Avenue of Service row with inline avenue dropdown ───────────────────
// Single download button + dropdown. Columns and dataset switch based on
// selection so the generated Excel matches the legacy per-avenue layout:
//   Club Service        → meeting-style 10 cols (date, title, attendance ...)
//   Community/Int'l/Voc/Public Image → project-style 19 cols
//   All                 → unified 23-col layout (meetings + every project)
function AvenueOfServiceRow({
  attendance,
  projectsByModule,
  clubName,
  yearLabel,
}: {
  attendance: any[];
  projectsByModule: Record<string, any[]>;
  clubName: string;
  yearLabel: string;
}) {
  type Avenue = "all" | "club_service" | "community_service" | "international_service" | "vocational_service" | "public_image_initiative";
  const [avenue, setAvenue] = useState<Avenue>("all");

  const AVENUE_LABELS: Record<Avenue, string> = {
    all:                     "All",
    club_service:            "Club Service",
    community_service:       "Community Service",
    international_service:   "International Service",
    vocational_service:      "Vocational Service",
    public_image_initiative: "Public Image Initiative",
  };

  // Row count for display — what the download will contain.
  const count = useMemo(() => {
    if (avenue === "all") {
      const projCount = Object.values(projectsByModule).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      return attendance.length + projCount;
    }
    if (avenue === "club_service") return attendance.length;
    return (projectsByModule[avenue] || []).length;
  }, [avenue, attendance, projectsByModule]);

  const hasData = count > 0;

  const fmtDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };

  // 10-col Club Service columns (meeting-style).
  const clubServiceCols: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }[] = [
    { key: "date",             label: "Date",            width: 14 },
    { key: "title",            label: "Title",           width: 30 },
    { key: "description",      label: "Description",     width: 40 },
    { key: "meeting",          label: "Meeting",         width: 14 },
    { key: "membersPresent",   label: "Attendance",      width: 14 },
    { key: "attendancePercent",label: "Attendance(%)",   width: 14 },
    { key: "url",              label: "URL",             width: 16 },
    { key: "linkAgenda",       label: "Link Agenda",     width: 16 },
    { key: "linkMom",          label: "Link MOM",        width: 16 },
  ];

  // 24-col project columns (used for All + Community Service) — +Image hyperlink.
  const projectColsWide: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }[] = [
    { key: "typeOfProject",        label: "Type of Project",          width: 18 },
    { key: "clubRole",             label: "Your Club Role",           width: 16 },
    { key: "coHostName",           label: "Co-host Name",             width: 18 },
    { key: "areaOfFocus",          label: "Area of Focus",            width: 22 },
    { key: "category",             label: "Category",                 width: 22 },
    { key: "subCategory",          label: "Sub Category",             width: 18 },
    { key: "projectDate",          label: "Date",                     width: 14 },
    { key: "title",                label: "Title",                    width: 28 },
    { key: "description",          label: "Description",              width: 40 },
    { key: "location",             label: "Project Location",         width: 20 },
    { key: "projectCost",          label: "Project Cost",             width: 14 },
    { key: "funding",              label: "Funding",                  width: 16 },
    { key: "globalGrantNumber",    label: "Global Grant Number",      width: 18 },
    { key: "csrCompanyName",       label: "Name of the CSR Company",  width: 22 },
    { key: "amountSanctioned",     label: "Amount Sanctioned",        width: 16 },
    { key: "amountReceived",       label: "Amount Received",          width: 16 },
    { key: "amountSpent",          label: "Amount spent till date",   width: 18 },
    { key: "hostClubsDistricts",   label: "Host Clubs/Districts",     width: 22 },
    { key: "globalPartners",       label: "Global Partner Clubs/Districts", width: 22 },
    { key: "beneficiaries",        label: "Beneficiaries",            width: 14 },
    { key: "manHours",             label: "Man Hours",                width: 12 },
    { key: "rotariansInvolved",    label: "Rotarians Involved",       width: 18 },
    { key: "publicPhotoUrl",       label: "Image",                    width: 14, hyperlink: true, linkText: "Image" },
  ];

  // 20-col project columns (Int'l / Vocational / Public Image legacy layout) — +Image hyperlink.
  const projectColsNarrow: { key: string; label: string; width?: number; hyperlink?: boolean; linkText?: string }[] = [
    { key: "category",             label: "Category",                 width: 22 },
    { key: "subCategory",          label: "Sub Category",             width: 18 },
    { key: "projectDate",          label: "Date",                     width: 14 },
    { key: "title",                label: "Title",                    width: 28 },
    { key: "description",          label: "Description",              width: 40 },
    { key: "location",             label: "Project Location",         width: 20 },
    { key: "projectCost",          label: "Project Cost",             width: 14 },
    { key: "funding",              label: "Funding",                  width: 16 },
    { key: "globalGrantNumber",    label: "Global Grant Number",      width: 18 },
    { key: "csrCompanyName",       label: "Name of the CSR Company",  width: 22 },
    { key: "amountSanctioned",     label: "Amount Sanctioned",        width: 16 },
    { key: "amountReceived",       label: "Amount Received",          width: 16 },
    { key: "amountSpent",          label: "Amount spent till date",   width: 18 },
    { key: "hostClubsDistricts",   label: "Host Clubs/Districts",     width: 22 },
    { key: "globalPartners",       label: "Global Partner Clubs/Districts", width: 22 },
    { key: "beneficiaries",        label: "Beneficiaries",            width: 14 },
    { key: "manHours",             label: "Man Hours",                width: 12 },
    { key: "rotariansInvolved",    label: "Rotarians Involved",       width: 18 },
    { key: "publicPhotoUrl",       label: "Image",                    width: 14, hyperlink: true, linkText: "Image" },
  ];

  // Map the project's moduleKey to its human-readable avenue label. Used as the
  // "Type of Project" column value in the wide layout — admins want to see which
  // avenue each row belongs to (Club Service / Community Service / Vocational
  // Service / International Service / Public Image Initiative), not the raw
  // project_type enum.
  const AVENUE_LABEL_MAP: Record<string, string> = {
    club_service:            "Club Service",
    community_service:       "Community Service",
    vocational_service:      "Vocational Service",
    international_service:   "International Service",
    public_image_initiative: "Public Image Initiative",
  };

  // Project rows from the year-wise payload → normalised to the wide column shape.
  // publicPhotoUrl is already provided by the backend (CONCAT('{frontendUrl}/public/project/', id, '?year=', yearId))
  // so the Image column renders as a clickable hyperlink in the exported workbook.
  const projectToWide = (p: any): Record<string, any> => ({
    typeOfProject:     AVENUE_LABEL_MAP[p.moduleKey] || p.moduleName || "Project",
    clubRole:          p.clubRole || "",
    coHostName:        p.coHostName || "",
    areaOfFocus:       p.areaOfFocus || "",
    category:          p.category || "",
    subCategory:       p.subCategory || "",
    projectDate:       fmtDate(p.projectDate),
    title:             p.title || "",
    description:       p.description || "",
    location:          p.location || "",
    projectCost:       p.projectCost ?? "",
    funding:           p.funding || "",
    globalGrantNumber: p.globalGrantNumber || "",
    csrCompanyName:    p.csrCompanyName || "",
    amountSanctioned:  p.amountSanctioned ?? "",
    amountReceived:    p.amountReceived ?? "",
    amountSpent:       p.amountSpent ?? "",
    hostClubsDistricts:p.hostClubsDistricts || "",
    globalPartners:    p.globalPartnerClubs || p.globalPartners || "",
    beneficiaries:     p.directBeneficiaries ?? "",
    manHours:          p.manHours ?? "",
    rotariansInvolved: p.rotariansInvolved ?? "",
    publicPhotoUrl:    p.publicPhotoUrl || "",
  });

  const meetingToWide = (m: any): Record<string, any> => ({
    typeOfProject:     "Club Service",
    projectDate:       fmtDate(m.date),
    title:             m.title,
    description:       m.description || "",
    membersPresent:    m.membersPresent ?? 0,
    attendancePercent: m.attendancePercent ?? 0,
  });

  const meetingToClubService = (m: any): Record<string, any> => ({
    date:              fmtDate(m.date),
    title:             m.title,
    description:       m.description || "",
    meeting:           "Regular",
    membersPresent:    m.membersPresent ?? 0,
    attendancePercent: m.attendancePercent ?? 0,
    url:               "",
    linkAgenda:        "",
    linkMom:           "",
  });

  const onExport = async () => {
    if (!hasData) return;
    const clubSafe  = (clubName || "Club").replace(/\s+/g, "_");
    const labelSafe = AVENUE_LABELS[avenue].replace(/\s+/g, "_");

    if (avenue === "club_service") {
      const rows = attendance.map(meetingToClubService);
      exportToCSV(rows, `${clubSafe}_Club_Service`, clubServiceCols, {
        title: `Club Service — ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      return;
    }

    if (avenue === "all") {
      const meetingRows = attendance.map(meetingToWide);
      const projectRows = Object.values(projectsByModule)
        .flat()
        .map(projectToWide);
      exportToCSV([...meetingRows, ...projectRows], `${clubSafe}_All_Avenue_of_service_Projects`, projectColsWide, {
        title: `All Avenues of Service — ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}`,
      });
      return;
    }

    const projects = (projectsByModule[avenue] || []).map(projectToWide);
    const cols = avenue === "community_service" ? projectColsWide : projectColsNarrow;
    exportToCSV(projects, `${clubSafe}_${labelSafe}`, cols, {
      title: `${AVENUE_LABELS[avenue]} — ${clubName}`,
      subtitle: `Rotary Year: ${yearLabel}`,
    });
  };

  return (
    <li className={`flex items-center justify-between gap-3 px-5 py-3 ${hasData ? "hover:bg-blue-50/40" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5] ring-1 ring-blue-100 shrink-0">
          <Award size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Avenue of Service</p>
          <p className="text-xs text-slate-500">
            {count} {count === 1 ? "record" : "records"}
            <span className="text-slate-400"> · {AVENUE_LABELS[avenue]}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={avenue}
          onChange={(e) => setAvenue(e.target.value as Avenue)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
        >
          <option value="all">All</option>
          <option value="club_service">Club Service</option>
          <option value="community_service">Community Service</option>
          <option value="international_service">International Service</option>
          <option value="vocational_service">Vocational Service</option>
          <option value="public_image_initiative">Public Image Initiative</option>
        </select>
        <LoadingButton
          onAction={async () => { await onExport(); }}
          disabled={!hasData}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={13} /> Excel
        </LoadingButton>
      </div>
    </li>
  );
}

// ── BOD row with inline designation dropdown ────────────────────────────
// Designation picker is built from the DISTINCT designations actually
// present in this club's BOD for the selected year — keeps the dropdown
// short and meaningful. "All" downloads every BOD row.
function BodSectionRow({
  bod,
  yearLabel,
  clubName,
}: {
  bod: any[];
  yearLabel: string;
  clubName: string;
}) {
  const [designation, setDesignation] = useState<string>("__all__");
  const designations = useMemo(() => {
    const set = new Set<string>();
    for (const r of bod) {
      const d = (r?.designation || "").toString().trim();
      if (d) set.add(d);
    }
    return Array.from(set).sort();
  }, [bod]);
  const filtered = designation === "__all__"
    ? bod
    : bod.filter((r) => (r?.designation || "").toString().trim() === designation);
  const hasData = filtered.length > 0;

  const onExport = async () => {
    if (!hasData) return;
    const safe = (clubName || "Club").replace(/\s+/g, "_");
    const suffix = designation === "__all__" ? "All" : designation.replace(/\s+/g, "_");
    exportToCSV(
      filtered,
      `${safe}_Board_of_Directors_${suffix}`,
      [
        { key: "clubName",   label: "Club Name",     width: 25 },
        { key: "designation",label: "Designation",   width: 22 },
        { key: "memberName", label: "Member Name",   width: 25 },
        { key: "email",      label: "Email ID",      width: 30 },
        { key: "mobile",     label: "Mobile Number", width: 16 },
        { key: "autoManual", label: "Auto_Manual",   width: 14 },
      ],
      {
        title: `Board of Directors — ${clubName}`,
        subtitle: `Rotary Year: ${yearLabel}${designation === "__all__" ? "" : ` · ${designation}`}`,
      },
    );
  };

  return (
    <li className={`flex items-center justify-between gap-3 px-5 py-3 ${hasData ? "hover:bg-blue-50/40" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5] ring-1 ring-blue-100 shrink-0">
          <UserCircle size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">Board of Directors (BOD)</p>
          <p className="text-xs text-slate-500">
            {filtered.length} {filtered.length === 1 ? "record" : "records"}
            {designation !== "__all__" && <span className="text-slate-400"> · filtered</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[180px]"
        >
          <option value="__all__">All Designations</option>
          {designations.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <LoadingButton
          onAction={async () => { await onExport(); }}
          disabled={!hasData}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={13} /> Excel
        </LoadingButton>
      </div>
    </li>
  );
}

// ── Subsection divider used to group export rows ────────────────────────
// Renders as a small sticky-looking header inside the export list.
// Body is empty for now; the user assigns existing SectionRows beneath
// each header iteratively.
function SubsectionHeader({ title }: { title: string }) {
  return (
    <li className="bg-slate-50/80 px-5 py-2 border-b border-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
    </li>
  );
}

// ── Single export row: icon + title + count + LoadingButton download ────
function SectionRow({
  title,
  icon: Icon,
  count,
  onExport,
  loading = false,
  comingSoon = false,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  onExport: () => Promise<void> | void;
  loading?: boolean;
  comingSoon?: boolean;
}) {
  const hasData = !loading && count > 0 && !comingSoon;
  return (
    <li
      className={`flex items-center justify-between gap-3 px-5 py-3 ${
        hasData ? "hover:bg-blue-50/40" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5] ring-1 ring-blue-100 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{title}</p>
          <p className="text-xs text-slate-500">
            {comingSoon ? "Coming soon" : loading ? "Loading…" : `${count} ${count === 1 ? "record" : "records"}`}
          </p>
        </div>
      </div>
      {comingSoon ? (
        <ClubGoalComingSoon compact />
      ) : (
      <LoadingButton
        onAction={async () => {
          await onExport();
        }}
        disabled={!hasData}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={13} /> Excel
      </LoadingButton>
      )}
    </li>
  );
}
