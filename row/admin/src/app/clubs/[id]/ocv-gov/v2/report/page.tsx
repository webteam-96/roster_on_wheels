"use client";

/**
 * OCV / GOV v2 Report — frontend overhaul replacement for the v1 report page.
 *
 * Same APIs as v1: getOcvReport, getTrfYears, getClub,
 * downloadOcvDocumentBlob. Filters: year, module (categoryName), status
 * (all/yes/no). Groups results by category, shows summary KPIs, supports
 * "Download All as Excel" and per-row View / Download.
 *
 * `?returnTo=` honored on the back arrow; defaults to /clubs/[id]/ocv-gov/v2.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Calendar, Download, Eye, FileSpreadsheet, FileText, Loader2,
  CheckCircle2, AlertCircle, BarChart3,
} from "@/components/icons";
import {
  getClub, getTrfYears, getOcvReport, downloadOcvDocumentBlob,
  downloadOcvReportWord, downloadOcvReportExcel,
} from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import type { OcvReportItem } from "@/types/ocvGov";
import type { ReportYear } from "@/types/clubMonthlyReport";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { SkeletonRows } from "@/components/row/AppKit";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function OcvReportV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const urlYearId = searchParams.get("yearId");
  const inboundReturnTo = searchParams.get("returnTo");

  const backHref = inboundReturnTo || `/clubs/${clubId}/ocv-gov/v2`;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(
    urlYearId ? Number(urlYearId) : null,
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [items, setItems] = useState<OcvReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloadingWord, setDownloadingWord] = useState(false);
  // The Excel is generated server-side (report/excel) — gate the button while it downloads.
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initial: club + years
  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(yrs);
        if (!selectedYearId) {
          const cur = yrs.find((y) => y.isCurrent);
          setSelectedYearId(cur ? cur.id : yrs[0]?.id ?? null);
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (err as any)?.response?.data;
        if (!cancelled) setErrorMessage(e?.message || "Failed to load years.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, cmrOn]);

  // Report on year/status change
  useEffect(() => {
    if (!selectedYearId) return;
    let cancelled = false;
    async function load() {
      setLoadingReport(true);
      try {
        const data = await getOcvReport(
          clubId,
          selectedYearId!,
          statusFilter === "all" ? undefined : statusFilter,
        );
        if (!cancelled) setItems(data);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (err as any)?.response?.data;
        if (!cancelled) {
          setErrorMessage(e?.message || "Failed to load report.");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoadingReport(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clubId, selectedYearId, statusFilter]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.categoryName))),
    [items],
  );

  const filteredItems = useMemo(
    () => (categoryFilter === "all" ? items : items.filter((i) => i.categoryName === categoryFilter)),
    [items, categoryFilter],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, OcvReportItem[]>();
    for (const item of filteredItems) {
      const existing = map.get(item.categoryName);
      if (existing) existing.push(item);
      else map.set(item.categoryName, [item]);
    }
    return Array.from(map.entries()).map(([categoryName, list]) => ({ categoryName, items: list }));
  }, [filteredItems]);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "";
  const uploadedCount = filteredItems.filter((i) => i.isUploaded).length;
  const pendingCount  = filteredItems.length - uploadedCount;
  const compliancePct = filteredItems.length > 0
    ? Math.round((uploadedCount / filteredItems.length) * 100)
    : 0;

  function handleView(filePath: string) {
    window.open(`${API_URL}${filePath}`, "_blank", "noopener,noreferrer");
  }

  async function handleDownload(item: OcvReportItem) {
    try {
      if (item.documentId == null) throw new Error("no document id");
      const blob = await downloadOcvDocumentBlob(clubId, item.documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.originalFileName || "document";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      if (item.filePath) {
        window.open(`${API_URL}${item.filePath}`, "_blank", "noopener,noreferrer");
      }
    }
  }

  // Server-generated HTML-table .xls — an exact match of the legacy OCVList….xls: header block,
  // one row per document-type across all categories with "Download Here" hyperlinks, plus Live
  // Documents and Newsletters sections. Full report — the page's status/module filters don't narrow it.
  async function handleExcelDownload() {
    if (!selectedYearId) return;
    setDownloadingExcel(true);
    try {
      await downloadOcvReportExcel(
        clubId,
        selectedYearId,
        `OCV_Report_${clubName}_${fileTimestamp()}`,
      );
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (err as any)?.response?.data;
      let message: string | undefined;
      if (data instanceof Blob) {
        try {
          message = JSON.parse(await data.text())?.message;
        } catch {
          // not JSON — fall through to the generic message
        }
      } else {
        message = data?.message;
      }
      setErrorMessage(message || "Failed to generate the Excel report.");
    } finally {
      setDownloadingExcel(false);
    }
  }

  // Full-year Word report (all categories + live module snapshots + newsletters) — the page
  // filters don't narrow it, so it stays available regardless of the current view.
  async function handleWordDownload() {
    if (!selectedYearId) return;
    setDownloadingWord(true);
    try {
      await downloadOcvReportWord(clubId, selectedYearId, `OCV_Report_${clubName}_${yearLabel}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (err as any)?.response?.data;
      // responseType: "blob" means an error JSON body also arrives as a Blob,
      // not a parsed object — read it back out so the real backend message shows.
      let message: string | undefined;
      if (data instanceof Blob) {
        try {
          message = JSON.parse(await data.text())?.message;
        } catch {
          // not JSON — fall through to the generic message
        }
      } else {
        message = data?.message;
      }
      setErrorMessage(message || "Failed to generate the Word report.");
    } finally {
      setDownloadingWord(false);
    }
  }

  const isLoading = loading || loadingReport;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="OCV Report"
        pageSubtitle="Year-wise document completeness"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-800 leading-tight">OCV Report</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName || "–"} · Document compliance overview
              </p>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Compliance"
            value={`${compliancePct}%`}
            subtitle={`${uploadedCount}/${filteredItems.length} uploaded`}
            icon={BarChart3}
            color={compliancePct >= 80 ? "green" : compliancePct >= 50 ? "gold" : "red"}
          />
          <KpiCard
            title="Uploaded"
            value={fmtInt(uploadedCount)}
            subtitle="Document types covered"
            icon={CheckCircle2}
            color="green"
          />
          <KpiCard
            title="Pending"
            value={fmtInt(pendingCount)}
            subtitle="Still to upload"
            icon={AlertCircle}
            color="red"
          />
          <KpiCard
            title="Total Types"
            value={fmtInt(filteredItems.length)}
            subtitle={yearLabel ? `RY ${yearLabel}` : "–"}
            icon={FileText}
            color="blue"
          />
        </div>

        {/* Filters strip */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Year */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Rotary Year</label>
              <div className="relative">
                <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  value={selectedYearId ?? ""}
                  onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                >
                  {years.length === 0 && <option value="">No years</option>}
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " · current" : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Module */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Module</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                <option value="all">All Modules</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              >
                <option value="all">All</option>
                <option value="yes">Uploaded</option>
                <option value="no">Not Uploaded</option>
              </select>
            </div>

            {/* Download all */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-transparent select-none">.</label>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleExcelDownload}
                  disabled={!selectedYearId || downloadingExcel}
                  title="Full OCV checklist with document download links (matches the official OCV Excel)"
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {downloadingExcel ? (
                    <>
                      <Loader2 className="animate-spin" size={13} /> Preparing…
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet size={13} /> Download All as Excel
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleWordDownload}
                  disabled={!selectedYearId || downloadingWord}
                  title="Documents, photos and live module data in one Word file"
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  {downloadingWord ? (
                    <>
                      <Loader2 className="animate-spin" size={13} /> Generating…
                    </>
                  ) : (
                    <>
                      <FileText size={13} /> Download in Word Document
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {filteredItems.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs font-medium text-slate-600">Compliance progress</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {uploadedCount} of {filteredItems.length} uploaded · {compliancePct}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    compliancePct >= 80 ? "bg-emerald-500" : compliancePct >= 50 ? "bg-amber-500" : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(100, compliancePct)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <SkeletonRows />
        )}

        {/* Empty */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <Calendar size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No report data</p>
            <p className="text-xs text-slate-400 mt-1">No documents found for the selected filters.</p>
          </div>
        )}

        {/* Grouped tables */}
        {!isLoading && grouped.length > 0 && (() => {
          let serial = 0;
          return grouped.map((group) => {
            const groupUploaded = group.items.filter((i) => i.isUploaded).length;
            return (
              <div key={group.categoryName} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">{group.categoryName}</h3>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 tabular-nums">
                    {groupUploaded}/{group.items.length} uploaded
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] md:min-w-full text-sm">
                    <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                      <tr>
                        <th className="px-3 py-2.5 text-left w-12">Sr</th>
                        <th className="px-3 py-2.5 text-left">Document Type</th>
                        <th className="px-3 py-2.5 text-center w-32">Status</th>
                        <th className="px-3 py-2.5 text-left">File Name</th>
                        <th className="px-3 py-2.5 text-right w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.items.map((it) => {
                        serial += 1;
                        return (
                          <tr key={`${it.categoryId}-${it.typeId}`} className="hover:bg-blue-50/40">
                            <td className="px-3 py-2 text-slate-500">{serial}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{it.typeName}</td>
                            <td className="px-3 py-2 text-center">
                              {it.isUploaded ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                                  <CheckCircle2 size={11} /> Uploaded
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                                  <AlertCircle size={11} /> Pending
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm text-slate-600 max-w-[260px] truncate" title={it.originalFileName || ""}>
                              {it.originalFileName || "–"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {it.isUploaded && it.filePath ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleView(it.filePath!)}
                                    title="View"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                                  >
                                    <Eye size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(it)}
                                    title="Download"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-violet-700 hover:bg-violet-50"
                                  >
                                    <Download size={13} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-300 text-xs">, </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          });
        })()}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
