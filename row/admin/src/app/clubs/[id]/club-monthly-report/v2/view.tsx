"use client";
import { DataTable } from "@/components/ui/data-table";

/**
 * Club Monthly Report v2 — landing page (year + month picker table).
 *
 * Visual parity with /club-admin-dashboard/e-governance: dot-accented KPI
 * tiles, slate-toned status chips, soft progress bar, dense table. Data and
 * API surface are identical to v1 (same getMonthlyReportYears /
 * getMonthlyReportMonths / getMonthlyReportPreview / downloadPDF /
 * downloadWord) — only presentation changed.
 *
 * v2 reads ONLY `?returnTo=` — back/edit/create flows route to that target
 * (the e-Gov tab in the typical case) instead of the legacy club dashboard.
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Calendar, ClipboardList, CheckCircle2, Clock, AlertCircle, Plus, Pencil, FileText, FileSpreadsheet, Loader2, BarChart3 } from "@/components/icons";
import {
  getMonthlyReportYears,
  getMonthlyReportMonths,
  getMonthlyReportPreview,
  getClub,
  downloadClubMonthlyReportWord,
} from "@/services/api";
import {
  MonthlyReportListItem,
  ReportYear,
} from "@/types/clubMonthlyReport";
import { downloadPDF } from "@/utils/reportDownload";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtDate, fmtInt } from "@/components/dashboard/formatters";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import LoadingLink from "@/components/v2/LoadingLink";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { Eye, Upload } from "@/components/icons";

// The old CMR wizard (v2) is hidden from the list since the new CMR saves + uploads (RIZones 2026-11-13). Kept, not removed.
const SHOW_OLD_CMR = false;

type RowStatus = "Submitted" | "In Progress" | "Not Started";

function rowStatus(m: MonthlyReportListItem): RowStatus {
  if (m.isUploadedToDistrict) return "Submitted";
  if (m.isCreated) return "In Progress";
  return "Not Started";
}

function statusChipClass(s: RowStatus): string {
  if (s === "Submitted")   return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "In Progress") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function rowStatusIcon(s: RowStatus) {
  if (s === "Submitted")   return <CheckCircle2 size={12} />;
  if (s === "In Progress") return <Clock size={12} />;
  return <AlertCircle size={12} />;
}

// Named export — embeddable view. Rendered inline by the Club Admin E-Governance
// page's "Club Monthly Report" tab; the route's default export (page.tsx) wraps
// it in the dashboard shell.
export function ClubMonthlyReportV2View({ clubId: propClubId, embedded = false, yearId: globalYearId = null }: { clubId?: number; embedded?: boolean; yearId?: number | null } = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);

  // returnTo chain. When EMBEDDED in the dashboard's e-Gov tab, the month wizard /
  // preview must return straight back to that tab (carrying the active year), not to
  // the standalone CMR listing — the user opened Edit/Create from inside the tab.
  // When standalone, keep the classic two-hop (wizard → this listing → caller).
  const incomingReturnTo = searchParams.get("returnTo") || "";
  const backHref = incomingReturnTo || `/clubs/${clubId}/dashboard`;
  const myListingUrl = `/clubs/${clubId}/club-monthly-report/v2${incomingReturnTo ? `?returnTo=${encodeURIComponent(incomingReturnTo)}` : ""}`;
  const eGovReturnUrl = `/club-admin-dashboard/e-governance${globalYearId != null ? `?yearId=${globalYearId}` : ""}`;
  const monthReturnTarget = embedded ? eGovReturnUrl : myListingUrl;
  const returnToQuery = `?returnTo=${encodeURIComponent(monthReturnTarget)}`;

  // Design B PDF from the list (user 2026-11-13): the month being drawn in the hidden frame (null = none).
  const [pdfMonth, setPdfMonth] = useState<number | null>(null);
  // Which file the hidden frame makes: Design B PDF or the new Word (user 2026-11-13).
  const [pdfKind, setPdfKind] = useState<"pdf" | "word">("pdf");
  const [pdfError, setPdfError] = useState<string | null>(null);
  useEffect(() => {
    if (pdfMonth == null) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "cmr-pdf") return;
      if (!e.data.ok) setPdfError(e.data.message || "The PDF could not be made. Please try again.");
      setPdfMonth(null);
    };
    window.addEventListener("message", onMsg);
    const giveUp = setTimeout(() => { setPdfMonth(null); setPdfError("The download is taking too long. Please try again."); }, 300000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(giveUp); };
  }, [pdfMonth]);

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [months, setMonths] = useState<MonthlyReportListItem[]>([]);
  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadingMonth, setDownloadingMonth] = useState<number | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"pdf" | "word" | null>(null);

  // Load years on mount — year filter is DATA-ONLY (only years with reports).
  useEffect(() => {
    async function fetchYears() {
      setLoadingYears(true);
      try {
        const [club, data] = await Promise.all([
          getClub(clubId),
          getMonthlyReportYears(clubId),
        ]);
        setClubName(club.clubName);
        setYears(data);
        // Embedded (dashboard) mode: the GLOBAL dashboard year drives the module — don't auto-select
        // the module's own current/first data-year (a separate effect syncs to globalYearId).
        if (globalYearId == null) {
          const currentYear = data.find((y) => y.isCurrent);
          if (currentYear) setSelectedYearId(currentYear.id);
          else if (data.length > 0) setSelectedYearId(data[0].id);
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report years."));
      } finally {
        setLoadingYears(false);
      }
    }
    fetchYears();
  }, [clubId]);

  // Embedded in the dashboard → follow the GLOBAL dashboard year, not the module's own dropdown.
  useEffect(() => {
    if (globalYearId != null) setSelectedYearId(globalYearId);
  }, [globalYearId]);

  useEffect(() => {
    if (selectedYearId === null) return;
    async function fetchMonths() {
      setLoadingMonths(true);
      try {
        const data = await getMonthlyReportMonths(clubId, selectedYearId!);
        setMonths(data);
      } catch (err: unknown) {
        setMonths([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report months."));
      } finally {
        setLoadingMonths(false);
      }
    }
    fetchMonths();
  }, [clubId, selectedYearId]);

  const counts = useMemo(() => {
    const submitted  = months.filter((m) => m.isUploadedToDistrict).length;
    const inProgress = months.filter((m) => m.isCreated && !m.isUploadedToDistrict).length;
    const notStarted = months.length - submitted - inProgress;
    return { submitted, inProgress, notStarted, total: Math.max(months.length, 0) };
  }, [months]);

  const submissionRate = counts.total > 0 ? (counts.submitted / counts.total) * 100 : 0;
  const cmrCardColor: "green" | "gold" = submissionRate >= 80 ? "green" : "gold";

  const selectedYear = years.find((y) => y.id === selectedYearId);

  // Old server PDF / Word - kept (not removed) but no longer used by the list (new Design B PDF + Word, 2026-11-13).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDownload = async (month: number, format: "pdf" | "word") => {
    if (!selectedYearId) return;
    if (downloadingMonth != null || pdfMonth != null) return;   // one download at a time (user 2026-11-13)
    try {
      setDownloadingMonth(month);
      setDownloadFormat(format);
      const preview = await getMonthlyReportPreview(clubId, selectedYearId, month);
      if (format === "pdf") {
        downloadPDF(preview);
      } else {
        // Detailed server-side Word (summary + all avenues + photos).
        const base = `${preview.clubName}_Monthly_Report_${preview.monthName}_${preview.yearLabel}`;
        await downloadClubMonthlyReportWord(clubId, selectedYearId, month, base);
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to download report.");
      setErrorMessage(msg);
    } finally {
      setDownloadingMonth(null);
      setDownloadFormat(null);
    }
  };

  // Admin rights are per Rotary year: creating or editing a month's report needs
  // rights for the year the report belongs to. Reading it never does.
  const { user, isSuperAdmin } = useAuth();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const canManage = canEditYear(yearRights, selectedYearId, isSuperAdmin);
  const editableYears = heldYearLabels(yearRights, years.map((y) => ({ id: y.id, label: y.yearLabel })));
  const viewingYearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel;

  const isLoading = loadingYears || loadingMonths;
  const monthBase = (m: number) =>
    `/clubs/${clubId}/club-monthly-report/v2/${selectedYearId}/${m}${returnToQuery}`;

  return (
    <div className="space-y-5">
      {!canManage && selectedYearId && (
        <ViewOnlyBadge yearLabel={viewingYearLabel} editableYears={editableYears} />
      )}

      {/* Header */}
      {!embedded && (
        <PageHeader
          title="Club Monthly Reports"
          description={<>{clubName || "–"} {selectedYear ? ` · RY ${selectedYear.yearLabel}` : ""}</>}
          back={backHref}
          actions={!loadingYears && years.length > 0 && (
          <NativeSelect
            value={selectedYearId ?? ""}
            onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
            className="w-auto"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.yearLabel}{y.isCurrent ? " · current" : ""}
              </option>
            ))}
          </NativeSelect>
        )}
        />
      )}

      {/* KPI row — submission status overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="CMR Submission"
          value={`${counts.submitted}/${counts.total}`}
          subtitle={`${counts.submitted} submitted of ${counts.total} months`}
          icon={ClipboardList}
          color={cmrCardColor}
        />
        <KpiCard
          title="Submitted"
          value={fmtInt(counts.submitted)}
          subtitle="Uploaded to district"
          icon={CheckCircle2}
          color="green"
        />
        <KpiCard
          title="In Progress"
          value={fmtInt(counts.inProgress)}
          subtitle="Created, not yet uploaded"
          icon={Clock}
          color="gold"
        />
        <KpiCard
          title="Not Started"
          value={fmtInt(counts.notStarted)}
          subtitle="No data captured"
          icon={AlertCircle}
          color="red"
        />
      </div>

      {/* Submission progress bar */}
      {counts.total > 0 && (
        <Card className="p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="row-h3">Submission Progress</h3>
            <span className="text-xs text-slate-500 tabular-nums">
              {counts.submitted} of {counts.total} submitted ({Math.round(submissionRate)}%)
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                submissionRate >= 80 ? "bg-emerald-500" : submissionRate >= 50 ? "bg-amber-500" : "bg-rose-500"
              }`}
              style={{ width: `${Math.min(100, submissionRate)}%` }}
            />
          </div>
        </Card>
      )}

      <ErrorAlert
        open={!!errorMessage}
        title="Error"
        description={errorMessage || ""}
        onOk={() => setErrorMessage(null)}
      />
      <ErrorAlert
        open={!!pdfError}
        title="PDF"
        description={pdfError || ""}
        onOk={() => setPdfError(null)}
      />
      {/* Hidden frame that draws the Design B report and downloads its PDF (PDF button, user 2026-11-13).
          Off-screen, not display:none - the report must be laid out to be drawn. */}
      {pdfMonth != null && selectedYearId && (
        <iframe
          title="CMR PDF"
          aria-hidden
          tabIndex={-1}
          src={`/clubs/${clubId}/club-monthly-report/v3/${selectedYearId}/${pdfMonth}/preview?embed=1&${pdfKind === "word" ? "word" : "download"}=1`}
          style={{ position: "fixed", left: -10000, top: 0, width: 1100, height: 1400, border: 0 }}
        />
      )}

      {/* Month table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Monthly Reports</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedYear ? `RY ${selectedYear.yearLabel}` : "Select a year"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <BarChart3 size={13} className="text-slate-400" />
            <span>
              {canManage
                ? "Tap a month to create or edit its report"
                : "Tap a month to read its report"}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <RotaryLoader size="lg" />
          </div>
        ) : months.length === 0 ? (
          <div className="px-5 py-12 text-center text-slate-500">
            <Calendar size={28} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No months available</p>
            <p className="text-xs text-slate-500 mt-1">
              {years.length === 0
                ? "No rotary years have been configured yet."
                : "No report months found for the selected year."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              caption="Monthly reports"
              card={false}
              className="[&_table]:min-w-[640px] md:[&_table]:min-w-full"
              rows={months}
              rowKey={(item) => item.month}
              columns={[
{ key: "n", header: "#", className: "w-12 tabular-nums text-muted-foreground", cell: (item, index) => index + 1 },
{ key: "month", header: "Month", className: "font-medium whitespace-nowrap", cell: (item, index) => (<>
                        <div className="inline-flex items-center gap-2">
                          <Calendar size={13} className="text-slate-400" />
                          {item.monthName}
                        </div>
</>) },
{ key: "updated", header: "Last Updated", className: "text-xs whitespace-nowrap", cell: (item, index) => (<>
                        {fmtDate(item.modifiedDate ?? item.createdDate)}
</>) },
{ key: "status", header: "Status", cell: (item, index) => {
                  const s = rowStatus(item);
return (<>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${statusChipClass(s)}`}
                        >
                          {rowStatusIcon(s)} {s}
                        </span>
                        {item.isUploadedToDistrict && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700">
                            District
                          </span>
                        )}
</>);
} },
{ key: "actions", header: "Actions", align: "right", cell: (item, index) => {
                  const detailHref = monthBase(item.month);
                  const isDownloading = downloadingMonth === item.month;
                  const busy = pdfMonth != null || downloadingMonth != null;
                  const lockCls = busy ? " pointer-events-none opacity-50" : "";
return (<>
                        <div className="flex flex-wrap items-center justify-end gap-2 flex-wrap">
                          {item.isCreated ? (
                            <>
                              {/* Same route either way — the month page IS the report.
                                  Only the promise changes, so a year you cannot edit
                                  still opens, it just says View.
                                  User 2026-11-13: "Edit" below opens the NEW CMR for everyone, and the new CMR now
                                  saves + uploads to district too, so this old one ("Submit CMR") is HIDDEN - not
                                  removed. Set SHOW_OLD_CMR true to bring it back. */}
                              {SHOW_OLD_CMR && !isSuperAdmin && canManage && <LoadingLink
                                href={detailHref}
                                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                              >
                                {canManage
                                  ? <><Upload size={12} /> Submit CMR</>
                                  : <><Eye size={12} /> View</>}
                              </LoadingLink>}
                              {/* NEW CMR (Foundation / Membership from Goal Setting) - for everyone since 2026-11-13. */}
                              {(
                                <LoadingLink
                                  href={detailHref.replace("/club-monthly-report/v2/", "/club-monthly-report/v3/")}
                                  aria-disabled={busy}
                                  tabIndex={busy ? -1 : undefined}
                                  className={`row-btn row-btn-secondary row-btn-sm ${lockCls}`}
                                  title="Club Monthly Report - view, preview and download (Design B)"
                                >
                                  {/* Was "New CMR" (user 2026-11-13: rename to Edit). */}
                                  {canManage || isSuperAdmin ? <><Pencil size={12} /> Edit</> : <><Eye size={12} /> View</>}
                                </LoadingLink>
                              )}
                              {/* PDF / Word download only after the report is uploaded to district.
                                  While "In Progress" the data is still live/unfrozen, so we hide the
                                  download to avoid handing out a not-yet-submitted copy. */}
                              {item.isUploadedToDistrict && (
                                <>
                                  {/* PDF = Design B, downloaded right here (user 2026-11-13): the new CMR preview is
                                      drawn in a hidden frame which downloads it; the list stays. The old server PDF
                                      (handleDownload "pdf") is kept, not used. */}
                                  <Button
                                    type="button"
                                    onClick={() => { setPdfKind("pdf"); setPdfMonth(item.month); }}
                                    disabled={busy}
                                    variant="outline" size="sm"
                                  >
                                    {pdfMonth === item.month && pdfKind === "pdf"
                                      ? <Loader2 className="animate-spin" size={12} />
                                      : <FileText size={12} className="text-rose-500" />}
                                    PDF
                                  </Button>
                                  <Button
                                    type="button"
                                    // New Word (Design B layout, user 2026-11-13) via the same hidden frame; the old
                                    // server Word (handleDownload "word") is kept, not used.
                                    onClick={() => { setPdfKind("word"); setPdfMonth(item.month); }}
                                    disabled={busy}
                                    variant="outline" size="sm"
                                  >
                                    {(pdfMonth === item.month && pdfKind === "word") || (isDownloading && downloadFormat === "word") ? (
                                      <Loader2 className="animate-spin" size={12} />
                                    ) : (
                                      <FileSpreadsheet size={12} className="text-blue-500" />
                                    )}
                                    Word
                                  </Button>
                                </>
                              )}
                            </>
                          ) : canManage ? (
                            // Create opens the NEW CMR (it creates the month like the old one) - user 2026-11-13.
                            <LoadingLink
                              href={SHOW_OLD_CMR ? detailHref : detailHref.replace("/club-monthly-report/v2/", "/club-monthly-report/v3/")}
                              aria-disabled={busy}
                              tabIndex={busy ? -1 : undefined}
                              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-[#17458F] text-white hover:bg-[#17458F]${lockCls}`}
                            >
                              <Plus size={12} /> Create
                            </LoadingLink>
                          ) : (
                            // Nothing was ever filled in for this month, and this is
                            // not your year to fill it — say so instead of an empty cell.
                            <span className="text-xs text-slate-400">Not created</span>
                          )}
                        </div>
</>);
} },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

