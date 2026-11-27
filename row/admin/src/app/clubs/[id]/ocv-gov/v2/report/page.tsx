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

import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Calendar, Download, Eye, FileSpreadsheet, FileText, CheckCircle2, AlertCircle, BarChart3 } from "@/components/icons";
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
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
  // Download progress (user 2026-11-13). The server first builds the whole file - that time cannot be measured,
  // so the bar moves on an estimate up to 85% ("Preparing…"), then shows the real download of the file.
  const [progress, setProgress] = useState<{ kind: "word" | "excel"; pct: number; phase: "prepare" | "download" | "done" } | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startProgress = (kind: "word" | "excel") => {
    setProgress({ kind, pct: 3, phase: "prepare" });
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => setProgress((p) => p && p.phase === "prepare"
      ? { ...p, pct: p.pct + (85 - p.pct) * (kind === "word" ? 0.02 : 0.06) } : p), 500);
  };
  const onFileProgress = (f: number) => setProgress((p) => p ? { ...p, phase: "download", pct: Math.max(p.pct, 85 + 15 * f) } : p);
  const endProgress = (ok: boolean) => {
    if (progressTimer.current) { clearInterval(progressTimer.current); progressTimer.current = null; }
    if (!ok) { setProgress(null); return; }
    setProgress((p) => p ? { ...p, pct: 100, phase: "done" } : p);
    setTimeout(() => setProgress(null), 1200);
  };
  useEffect(() => () => { if (progressTimer.current) clearInterval(progressTimer.current); }, []);
  const anyDownload = downloadingWord || downloadingExcel;   // one report at a time
  // Progress shown INSIDE the clicked button (user 2026-11-13): the label hides while it runs and comes back when done.
  const btnProgress = (kind: "word" | "excel") => {
    const pct = progress?.kind === kind ? Math.min(100, Math.round(progress.pct)) : 0;
    return (
      <span className="flex w-full items-center gap-2" role="status" aria-live="polite">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
          <span className={`block h-full rounded-full transition-all duration-500 ${kind === "word" ? "bg-blue-600" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
        </span>
        <span className="tabular-nums">{pct}%</span>
      </span>
    );
  };
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

  // Server-generated real .xlsx (same layout as the legacy OCV list): header block,
  // one row per document-type across all categories with "Download Here" hyperlinks, plus Live
  // Documents and Newsletters sections. Full report — the page's status/module filters don't narrow it.
  async function handleExcelDownload() {
    if (!selectedYearId) return;
    if (anyDownload) return;
    setDownloadingExcel(true);
    startProgress("excel");
    let ok = false;
    try {
      await downloadOcvReportExcel(
        clubId,
        selectedYearId,
        `OCV_Report_${clubName}_${fileTimestamp()}`,
        onFileProgress,
      );
      ok = true;
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
      endProgress(ok);
    }
  }

  // Full-year Word report (all categories + live module snapshots + newsletters) — the page
  // filters don't narrow it, so it stays available regardless of the current view.
  async function handleWordDownload() {
    if (!selectedYearId) return;
    if (anyDownload) return;
    setDownloadingWord(true);
    startProgress("word");
    let ok = false;
    try {
      await downloadOcvReportWord(clubId, selectedYearId, `OCV_Report_${clubName}_${yearLabel}`, onFileProgress);
      ok = true;
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
      endProgress(ok);
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
        <PageHeader title="OCV Report" description={<>{clubName || "–"} · Document compliance overview</>} back={backHref} />

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
        <Card className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Year */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Rotary Year</label>
              <div className="relative">
                <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <NativeSelect
                  value={selectedYearId ?? ""}
                  onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                  className="pl-7 pr-3"
                >
                  {years.length === 0 && <option value="">No years</option>}
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " · current" : ""}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {/* Module */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Particulars</label>
              <NativeSelect
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                
              >
                <option value="all">All Particulars</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Status</label>
              <NativeSelect
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                
              >
                <option value="all">All</option>
                <option value="yes">Uploaded</option>
                <option value="no">Not Uploaded</option>
              </NativeSelect>
            </div>

            {/* Download all */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-transparent select-none">.</label>
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  onClick={handleExcelDownload}
                  disabled={!selectedYearId || anyDownload}
                  title="Full OCV checklist with document download links (matches the official OCV Excel)"
                  variant="outline" size="sm" className="w-full"
                >
                  {downloadingExcel || progress?.kind === "excel" ? btnProgress("excel") : (
                    <>
                      <FileSpreadsheet size={13} /> Download All as Excel
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={handleWordDownload}
                  disabled={!selectedYearId || anyDownload}
                  title="Documents, photos and live module data in one Word file"
                  variant="outline" size="sm" className="w-full"
                >
                  {downloadingWord || progress?.kind === "word" ? btnProgress("word") : (
                    <>
                      <FileText size={13} /> Download in Word Document
                    </>
                  )}
                </Button>
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
        </Card>

        {/* Loading */}
        {isLoading && (
          <SkeletonRows />
        )}

        {/* Empty */}
        {!isLoading && filteredItems.length === 0 && (
          <Card className="p-10 text-center">
            <Calendar size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No report data</p>
            <p className="text-xs text-slate-400 mt-1">No documents found for the selected filters.</p>
          </Card>
        )}

        {/* Grouped tables */}
        {!isLoading && grouped.length > 0 && (() => {
          let serial = 0;
          return grouped.map((group) => {
            const groupUploaded = group.items.filter((i) => i.isUploaded).length;
            return (
              <Card key={group.categoryName} className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="row-h3">{group.categoryName}</h3>
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 tabular-nums">
                    {groupUploaded}/{group.items.length} uploaded
                  </span>
                </div>
                <div className="overflow-x-auto">
                  {/* Fixed column widths - Status / File Name / Actions line up in every category table. */}
                  <Table className="min-w-[720px] table-fixed">
                    <colgroup>
                      <col className="w-14" />
                      <col />
                      <col className="w-36" />
                      <col className="w-[30%]" />
                      <col className="w-32" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left">Sr</TableHead>
                        <TableHead className="text-left">Document Type</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-left">File Name</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.items.map((it, idx) => {
                        serial += 1;
                        return (
                          <TableRow key={`${it.categoryId}-${it.typeId}-${it.documentId ?? idx}`}>
                            <TableCell>{serial}</TableCell>
                            <TableCell className="font-medium">{it.typeName}</TableCell>
                            <TableCell className="text-center">
                              {it.isUploaded ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                                  <CheckCircle2 size={11} /> Uploaded
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                                  <AlertCircle size={11} /> Pending
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="truncate" title={it.originalFileName || ""}>
                              {it.originalFileName || "–"}
                            </TableCell>
                            <TableCell className="text-right">
                              {it.isUploaded && it.filePath ? (
                                <div className="flex items-center justify-end gap-1">
                                  <IconButton
                                    type="button"
                                    onClick={() => handleView(it.filePath!)}
                                    title="View"
                                    
                                  >
                                    <Eye size={13} />
                                  </IconButton>
                                  <IconButton
                                    type="button"
                                    onClick={() => handleDownload(it)}
                                    title="Download"
                                    
                                  >
                                    <Download size={13} />
                                  </IconButton>
                                </div>
                              ) : (
                                <span className="text-slate-300 text-xs">–</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            );
          });
        })()}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
