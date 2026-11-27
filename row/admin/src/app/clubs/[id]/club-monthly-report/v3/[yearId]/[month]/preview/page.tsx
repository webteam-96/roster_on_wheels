"use client";

/**
 * NEW CMR (v3) preview - SUPER ADMIN ONLY, DOWNLOAD ONLY (user 2026-11-10).
 * Reads the month's report (meetings, projects, AG, prepared by, upload status), the member counts from the
 * member records and Club Goals' month-wise Foundation / Membership - the same figures as the new CMR wizard.
 * "Upload to District" (user 2026-11-13): the same server upload as the old CMR (status + PDF emailed to the
 * DG, AG, President and Secretary). The old CMR preview (v2/.../preview) is not touched.
 *
 * Design B is the chosen one (user 2026-11-13) - see FIXED_DESIGN; A / C / D and the switch are hidden, kept in code.
 * Four designs to compare (user 2026-11-10), same content, switch kept in the link (?design=b|c|d):
 *   A = the A4 report look, B = printed-report style, C = timeline, D = infographic (CmrReportDesignA..D).
 * The PDF is a picture of the design on screen (cmrPdfFromPage), so page and PDF are always the same.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/text-buttons";
import { ArrowLeft, CheckCircle2, Download, FileText, Loader2, Upload } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import LoadingLink from "@/components/v2/LoadingLink";
import { useAuth } from "@/contexts/AuthContext";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { getMonthlyReportPreview, getTrfContributionsByMonth, uploadMonthlyReportToDistrict, downloadClubMonthlyReportWordV2 } from "@/services/api";
import type { MonthlyReportPreview } from "@/types/clubMonthlyReport";
import type { TrfContribution } from "@/types/trfContribution";
import {
  useClubMonthlyGoals, useFoundationSourceDates, foundationTable, membershipTable, MEMBERSHIP, FOUNDATION, type CmrMemberCounts,
} from "@/components/cmr/CmrGoalPanels";
import { cmrCalendarYear, cmrUploadDate } from "@/components/cmr/cmrLabels";
import CmrReportDesignA from "@/components/cmr/CmrReportDesignA";
import CmrReportDesignB from "@/components/cmr/CmrReportDesignB";
import CmrReportDesignC from "@/components/cmr/CmrReportDesignC";
import CmrReportDesignD from "@/components/cmr/CmrReportDesignD";

type Design = "a" | "b" | "c" | "d";
const DESIGNS: Design[] = ["a", "b", "c", "d"];
const DESIGN_NAMES: Record<Design, string> = { a: "Report", b: "Printed", c: "Timeline", d: "Infographic" };
// Boss picked Design B (user 2026-11-13): preview + PDF always use B; the switch and designs A / C / D are
// HIDDEN, not removed (add-only rule) - set SHOW_DESIGN_SWITCH true to bring the choice back.
const FIXED_DESIGN: Design = "b";
const SHOW_DESIGN_SWITCH = false;
import { downloadReportPdf, reportPdfBase64 } from "@/components/cmr/cmrPdfFromPage";
import { fileTimestamp } from "@/lib/dateUtils";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function DesignSwitch({ value, onChange }: { value: Design; onChange: (v: Design) => void }) {
  return (
    <div role="group" aria-label="Report design" className="inline-flex flex-wrap gap-2">
      {DESIGNS.map((d) => (
        <ToggleButton key={d} pressed={value === d} onClick={() => onChange(d)} title={DESIGN_NAMES[d]}>
          Design {d.toUpperCase()} <span className="font-normal opacity-70">· {DESIGN_NAMES[d]}</span>
        </ToggleButton>
      ))}
    </div>
  );
}

function PreviewInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const clubId = Number(params.id), yearId = Number(params.yearId), month = Number(params.month);
  const returnTo = searchParams.get("returnTo") || "";
  const editHref = `/clubs/${clubId}/club-monthly-report/v3/${yearId}/${month}?step=members${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const asked = searchParams.get("design") as Design | null;
  const design: Design = !SHOW_DESIGN_SWITCH ? FIXED_DESIGN : asked && DESIGNS.includes(asked) ? asked : "a";
  const setDesign = (d: Design) => {
    const q = new URLSearchParams(searchParams.toString());
    if (d !== "a") q.set("design", d); else q.delete("design");
    router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };

  const [report, setReport] = useState<MonthlyReportPreview | null>(null);
  const [counts, setCounts] = useState<CmrMemberCounts | null>(null);
  const [trf, setTrf] = useState<TrfContribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingWord, setDownloadingWord] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  // While the emailed PDF is drawn, the page already shows "Uploaded to District: <today>" (user 2026-11-13).
  const [stampUploaded, setStampUploaded] = useState<string | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const membershipForm = useClubMonthlyGoals(MEMBERSHIP, clubId, yearId);
  const foundationForm = useClubMonthlyGoals(FOUNDATION, clubId, yearId);
  const foundationDates = useFoundationSourceDates(clubId, yearId);   // "Updated from …" notes in the report

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // SAVED data only (user 2026-11-13): the PDF / Word = what is saved in the CMR, never live or typed
        // figures - if the screen differs, the club saves (and uploads) and the PDF follows.
        const [rep, trfRows] = await Promise.all([
          getMonthlyReportPreview(clubId, yearId, month),
          getTrfContributionsByMonth(clubId, yearId, month).catch(() => [] as TrfContribution[]),
        ]);
        if (cancelled) return;
        setReport(rep);
        setTrf(trfRows);
        setCounts({ start: rep.memberCountLastMonth, added: rep.membersAdded, terminated: rep.membersDeleted });
        setRemarks(rep.additionalRemarks ?? null);
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = (e as any)?.response?.data;
        if (!cancelled) setError(d?.message || d?.detail || (e instanceof Error ? e.message : "Failed to load the report."));
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, yearId, month]);

  const monthName = MONTHS[month] || `Month ${month}`;
  const foundation = useMemo(() => foundationTable(foundationForm, month, trf), [foundationForm, month, trf]);
  const membership = useMemo(() => (counts ? membershipTable(membershipForm, month, counts, monthName.slice(0, 3)) : []), [membershipForm, month, counts, monthName]);
  const ready = !!report && !!counts && membershipForm !== undefined && foundationForm !== undefined;
  // ?download=1 (the CMR list's PDF button, user 2026-11-13): download the Design B PDF once the page is ready.
  // ?embed=1: loaded in the list's hidden frame - tells the list when the PDF is done (or failed).
  const autoDownload = searchParams.get("download") === "1";
  const autoWord = searchParams.get("word") === "1";
  // ?view=1 (District E-Governance): look + download only - no "Upload to District", Back goes to the district page.
  const viewOnly = searchParams.get("view") === "1";   // the CMR list's Word button (user 2026-11-13)
  const embed = searchParams.get("embed") === "1";
  useEffect(() => {
    if (embed && error) window.parent?.postMessage({ type: "cmr-pdf", ok: false, month, message: error }, window.location.origin);
  }, [embed, error, month]);
  const autoDone = useRef(false);
  useEffect(() => {
    if (!(autoDownload || autoWord) || !ready || autoDone.current) return;
    autoDone.current = true;
    const t = setTimeout(() => document.getElementById(autoWord ? "cmr-download-word" : "cmr-download-pdf")?.click(), 300);   // after the page paints
    return () => clearTimeout(t);
  }, [autoDownload, autoWord, ready]);

  if (error) return <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  if (!report || !counts) return <div className="flex min-h-[400px] items-center justify-center"><RotaryLoader /></div>;

  const year = cmrCalendarYear(report.yearLabel, month);
  const uploadedLabel = stampUploaded ?? (report.isUploadedToDistrict ? cmrUploadDate(report.uploadedToDistrictDate) : null);
  const props = { report, monthName, calendarYear: year, foundation, membership, counts, remarks, uploadedLabel, foundationDates };

  const download = async () => {
    if (!paperRef.current) return;
    setDownloading(true);
    try {
      const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
      await downloadReportPdf(
        paperRef.current,
        `CMR_${safe(report.clubName)}_${monthName}_${year ?? ""}_${design.toUpperCase()}_${fileTimestamp()}.pdf`,
        `${report.clubName} | ${monthName} ${year ?? ""} | ${uploadedLabel ? `Uploaded to District: ${uploadedLabel}` : "Preview - not submitted to the district"}`,
      );
      if (embed) window.parent?.postMessage({ type: "cmr-pdf", ok: true, month }, window.location.origin);
    } catch { setError("The PDF could not be made. Please try again."); }
    finally { setDownloading(false); }
  };

  // Word (user 2026-11-13): the server builds the Design B Word; it gets the Foundation + Membership tables exactly as
  // shown here (saved data only), with their "Updated from …" dates.
  const downloadWord = async () => {
    setDownloadingWord(true);
    try {
      const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
      await downloadClubMonthlyReportWordV2(clubId, yearId, month, {
        foundation: { synced: foundation.synced, rows: foundation.rows, total: foundation.total },
        membership, rotaryOrgDate: foundationDates.sync, importDate: foundationDates.imp, memberDate: foundationDates.member,
        calendarYear: year,
      }, `CMR_${safe(report.clubName)}_${monthName}_${year ?? ""}_${fileTimestamp()}.docx`);
      if (embed) window.parent?.postMessage({ type: "cmr-pdf", ok: true, month }, window.location.origin);
    } catch { setError("The Word file could not be made. Please try again."); }
    finally { setDownloadingWord(false); }
  };

  // Upload to District - same as the old CMR preview (user 2026-11-13), but the emailed PDF is this Design B
  // page, stamped "Uploaded to District: <today>". If the PDF cannot be drawn, the server sends its own.
  const upload = async () => {
    setUploading(true); setError(null); setSuccess(null);
    try {
      let pdf: string | undefined;
      if (paperRef.current) {
        const today = cmrUploadDate(new Date().toISOString());
        setStampUploaded(today);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 80)));   // let the stamp paint
        try {
          pdf = await reportPdfBase64(paperRef.current, `${report.clubName} | ${monthName} ${year ?? ""} | Uploaded to District: ${today}`);
        } catch { pdf = undefined; }
      }
      await uploadMonthlyReportToDistrict(clubId, report.reportId, pdf);
      setReport(await getMonthlyReportPreview(clubId, yearId, month));
      setSuccess("Report uploaded to district successfully. The report PDF is being emailed to the DG, AG, President and Secretary.");
      setTimeout(() => router.push(returnTo || `/clubs/${clubId}/club-monthly-report/v2`), 4000);
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (e as any)?.response?.data;
      setError(d?.message || d?.detail || d?.title || (e instanceof Error ? e.message : "Failed to upload report to district"));
    } finally { setUploading(false); setStampUploaded(null); }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LoadingLink href={viewOnly && returnTo ? returnTo : editHref} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft size={14} /> {viewOnly ? "Back" : "Back to the report"}
        </LoadingLink>
        <div className="flex flex-wrap items-center gap-2">
          {SHOW_DESIGN_SWITCH && <DesignSwitch value={design} onChange={setDesign} />}
          <Button id="cmr-download-pdf" type="button" onClick={download} disabled={!ready || downloading}>
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download PDF
          </Button>
          <Button id="cmr-download-word" type="button" variant="outline" onClick={downloadWord} disabled={!ready || downloadingWord}>
            {downloadingWord ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Download Word
          </Button>
          {!viewOnly && <Button type="button" variant="outline" onClick={upload} disabled={!ready || uploading}>
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {report.isUploadedToDistrict ? "Upload again" : "Upload to District"}
          </Button>}
        </div>
      </div>
      {success && (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-100">
          <CheckCircle2 size={16} className="mt-px shrink-0" /> {success}
        </p>
      )}
      {/* The amber "Agenda, MOM … not shared to the District" note is removed from the preview (user 2026-11-13). */}

      {/* The report page (A4 width) on a grey desk - this exact element becomes the PDF. */}
      <div className="overflow-x-auto rounded-2xl bg-slate-200/70 p-4 sm:p-8">
        <div className="mx-auto w-[794px] ring-1 ring-slate-200">
          {design === "b" ? <CmrReportDesignB ref={paperRef} {...props} />
            : design === "c" ? <CmrReportDesignC ref={paperRef} {...props} />
            : design === "d" ? <CmrReportDesignD ref={paperRef} {...props} />
            : <CmrReportDesignA ref={paperRef} {...props} />}
        </div>
      </div>
    </div>
  );
}

// Opened to everyone who can open the club's CMR (user 2026-11-13); set NEW_CMR_FOR_ALL false to close again.
const NEW_CMR_FOR_ALL = true;
function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!NEW_CMR_FOR_ALL && !isSuperAdmin) return <p className="py-10 text-center text-sm text-slate-500">This new Club Monthly Report is not available yet.</p>;
  return <>{children}</>;
}

export default function ClubMonthlyReportV3PreviewPage() {
  // In a hidden frame (CMR list / District page PDF + Word): just the report, no page chrome - and it must NOT
  // change the viewer's selected club (a District Admin downloading a club's report stays on their district).
  const embed = useSearchParams().get("embed") === "1";
  useSyncClubIdFromUrl(!embed);
  if (embed) return <ProtectedRoute><SuperAdminOnly><PreviewInner /></SuperAdminOnly></ProtectedRoute>;
  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Monthly Report (New - Preview)"
        pageSubtitle="Preview and download - nothing is submitted"
        activeNavHref="/club-admin-dashboard/e-governance"
        hideYearSelector
      >
        <SuperAdminOnly><PreviewInner /></SuperAdminOnly>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
