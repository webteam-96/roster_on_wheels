"use client";

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

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Calendar, ClipboardList, CheckCircle2, Clock, AlertCircle,
  Plus, Pencil, FileText, FileSpreadsheet, Loader2, BarChart3,
} from "@/components/icons";
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

  const handleDownload = async (month: number, format: "pdf" | "word") => {
    if (!selectedYearId) return;
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

  const isLoading = loadingYears || loadingMonths;
  const monthBase = (m: number) =>
    `/clubs/${clubId}/club-monthly-report/v2/${selectedYearId}/${m}${returnToQuery}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`flex items-start gap-3 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && (
        <div className="flex items-start gap-2">
          <LoadingLink
            href={backHref}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft size={15} />
          </LoadingLink>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Club Monthly Reports
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {clubName || "–"}
              {selectedYear ? ` · RY ${selectedYear.yearLabel}` : ""}
            </p>
          </div>
        </div>
        )}

        {/* Year filter — data-only. Hidden when embedded: the dashboard's global year drives it. */}
        {!embedded && !loadingYears && years.length > 0 && (
          <select
            value={selectedYearId ?? ""}
            onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.yearLabel}{y.isCurrent ? " · current" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

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
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-800">Submission Progress</h3>
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
        </div>
      )}

      <ErrorAlert
        open={!!errorMessage}
        title="Error"
        description={errorMessage || ""}
        onOk={() => setErrorMessage(null)}
      />

      {/* Month table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Monthly Reports</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedYear ? `RY ${selectedYear.yearLabel}` : "Select a year"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <BarChart3 size={13} className="text-slate-400" />
            <span>Tap a month to create or edit its report</span>
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
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left w-12">#</th>
                  <th className="px-4 py-2.5 text-left">Month</th>
                  <th className="px-4 py-2.5 text-left">Last Updated</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {months.map((item, index) => {
                  const s = rowStatus(item);
                  const detailHref = monthBase(item.month);
                  const isDownloading = downloadingMonth === item.month;
                  return (
                    <tr key={item.month} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{index + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <Calendar size={13} className="text-slate-400" />
                          {item.monthName}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                        {fmtDate(item.modifiedDate ?? item.createdDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusChipClass(s)}`}
                        >
                          {rowStatusIcon(s)} {s}
                        </span>
                        {item.isUploadedToDistrict && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
                            District
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {item.isCreated ? (
                            <>
                              <LoadingLink
                                href={detailHref}
                                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                              >
                                <Pencil size={12} /> Edit
                              </LoadingLink>
                              {/* PDF / Word download only after the report is uploaded to district.
                                  While "In Progress" the data is still live/unfrozen, so we hide the
                                  download to avoid handing out a not-yet-submitted copy. */}
                              {item.isUploadedToDistrict && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(item.month, "pdf")}
                                    disabled={isDownloading}
                                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                                  >
                                    {isDownloading && downloadFormat === "pdf" ? (
                                      <Loader2 className="animate-spin" size={12} />
                                    ) : (
                                      <FileText size={12} className="text-rose-500" />
                                    )}
                                    PDF
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(item.month, "word")}
                                    disabled={isDownloading}
                                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                                  >
                                    {isDownloading && downloadFormat === "word" ? (
                                      <Loader2 className="animate-spin" size={12} />
                                    ) : (
                                      <FileSpreadsheet size={12} className="text-blue-500" />
                                    )}
                                    Word
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <LoadingLink
                              href={detailHref}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              <Plus size={12} /> Create
                            </LoadingLink>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

