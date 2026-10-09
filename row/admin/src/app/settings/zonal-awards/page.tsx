"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getRotaryYears, getZonalAwardsAvailableYears, importZonalAwardsAuto,
  downloadZonalAwardsSampleExcel, getZonalAwardsImportLogs, downloadZonalAwardsYearlyExcel,
  downloadZonalAwardsMonthlyExcel, exportZonalAwardsStructure,
  getZones, getZoneAwards, saveZoneAwards,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { fileTimestamp } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Upload, Download, History, FileSpreadsheet, Trophy, Save } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function ZonalAwardsSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [allYears, setAllYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);

  // Import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMonth, setImportMonth] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [downloadingMonthly, setDownloadingMonthly] = useState(false);
  const [exportingStructure, setExportingStructure] = useState(false);
  const [importLogs, setImportLogs] = useState<any[]>([]);

  // Zone Cricket Match state
  const [allZones, setAllZones] = useState<any[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [zoneAwardsData, setZoneAwardsData] = useState<any>(null);
  // optionId -> districtId ("" for none)
  const [zoneSelections, setZoneSelections] = useState<Record<number, string>>({});
  const [loadingZoneAwards, setLoadingZoneAwards] = useState(false);
  const [savingZoneAwards, setSavingZoneAwards] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [years, avYears] = await Promise.all([getRotaryYears(), getZonalAwardsAvailableYears()]);
        const current = years.find((y: any) => y.isCurrent);
        const avIds = new Set(avYears.map((y: any) => y.id));
        if (current && !avIds.has(current.id)) avYears.push({ id: current.id, label: current.yearLabel, isCurrent: true });
        setAllYears(avYears.length > 0 ? avYears : (current ? [{ id: current.id, label: current.yearLabel, isCurrent: true }] : []));
        const hasCurrent = avYears.find((y: any) => y.isCurrent);
        setSelectedYearId(hasCurrent ? hasCurrent.id : avYears[0]?.id || current?.id || null);
      } catch { setErrorMessage("Failed to load years."); }
      finally { setLoading(false); }
    })();
  }, []);

  const fetchImportLogs = useCallback(async () => {
    if (!selectedYearId) return;
    try { setImportLogs(await getZonalAwardsImportLogs(selectedYearId)); } catch {}
  }, [selectedYearId]);

  useEffect(() => { fetchImportLogs(); }, [fetchImportLogs]);

  // Load zones once for the Cricket Match card — no default selection
  useEffect(() => {
    (async () => {
      try {
        const zonesResp = await getZones(1, 500);
        const zoneList = (zonesResp?.items as any[]) || [];
        setAllZones(zoneList);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const fetchZoneAwards = useCallback(async () => {
    if (!selectedZoneId || !selectedYearId) { setZoneAwardsData(null); return; }
    setLoadingZoneAwards(true);
    try {
      const data = await getZoneAwards(selectedZoneId, selectedYearId);
      setZoneAwardsData(data);
      // Build selections map from current selections
      const sel: Record<number, string> = {};
      for (const o of (data.options || [])) sel[o.id] = ""; // default empty
      for (const s of (data.selections || [])) {
        if (Number(s.enteredCounts) > 0) sel[s.optionId] = String(s.districtId);
      }
      setZoneSelections(sel);
    } catch { setZoneAwardsData(null); }
    finally { setLoadingZoneAwards(false); }
  }, [selectedZoneId, selectedYearId]);

  useEffect(() => { fetchZoneAwards(); }, [fetchZoneAwards]);

  const handleSaveZoneAwards = async () => {
    if (!selectedZoneId || !selectedYearId || !zoneAwardsData) return;
    setSavingZoneAwards(true);
    try {
      const entries = (zoneAwardsData.options || []).map((o: any) => ({
        optionId: o.id,
        districtId: zoneSelections[o.id] ? Number(zoneSelections[o.id]) : null,
      }));
      const result = await saveZoneAwards(selectedZoneId, selectedYearId, entries);
      setSuccessMessage(result?.message || "Zone awards saved.");
      await fetchZoneAwards();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save zone awards.");
    } finally { setSavingZoneAwards(false); }
  };

  const handleImport = async () => {
    if (!importFile || !importMonth || !selectedYearId) { setErrorMessage("Select file and month."); return; }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("yearId", String(selectedYearId));
      fd.append("month", importMonth);
      const result = await importZonalAwardsAuto(fd);
      setSuccessMessage(result.message);
      setImportFile(null);
      setImportMonth("");
      fetchImportLogs();
    } catch { setErrorMessage("Import failed."); }
    finally { setImporting(false); }
  };

  const handleDownloadSample = async () => {
    if (!selectedYearId) return;
    setDownloadingSample(true);
    try {
      const blob = await downloadZonalAwardsSampleExcel(selectedYearId);
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a"); a.href = url; a.download = `zonal_awards_foundation_sample_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to download sample."); }
    finally { setDownloadingSample(false); }
  };

  const handleDownloadReport = async () => {
    if (!selectedYearId) return;
    setDownloadingReport(true);
    try {
      const blob = await downloadZonalAwardsYearlyExcel(selectedYearId);
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a"); a.href = url; a.download = `zonal_awards_yearly_report_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to download report."); }
    finally { setDownloadingReport(false); }
  };

  const handleDownloadMonthly = async () => {
    if (!selectedYearId) return;
    setDownloadingMonthly(true);
    try {
      const blob = await downloadZonalAwardsMonthlyExcel(selectedYearId);
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a"); a.href = url; a.download = `zonal_awards_monthly_report_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to download monthly report."); }
    finally { setDownloadingMonthly(false); }
  };

  const handleExportStructure = async () => {
    if (!selectedYearId) return;
    setExportingStructure(true);
    try {
      const blob = await exportZonalAwardsStructure(selectedYearId);
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a"); a.href = url; a.download = `zonal_awards_structure_${fileTimestamp()}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to export structure."); }
    finally { setExportingStructure(false); }
  };

  const allMonths = [
    { value: "7", label: "July" }, { value: "8", label: "August" }, { value: "9", label: "September" },
    { value: "10", label: "October" }, { value: "11", label: "November" }, { value: "12", label: "December" },
    { value: "1", label: "January" }, { value: "2", label: "February" }, { value: "3", label: "March" },
    { value: "4", label: "April" }, { value: "5", label: "May" }, { value: "6", label: "June" },
  ];
  const monthName = (m: number) => allMonths.find(x => x.value === String(m))?.label || `Month ${m}`;

  // Only show months from July (start of rotary year) up to the current calendar month.
  // For past rotary years, allow all 12 months. For the current year, stop at today's month.
  const selectedYear = allYears.find((y: any) => y.id === selectedYearId);
  const isCurrentYear = selectedYear?.isCurrent === true;
  const months = (() => {
    if (!isCurrentYear) return allMonths; // past year → all 12 months uploadable
    const now = new Date();
    const curMonth = now.getMonth() + 1; // 1-12
    // Rotary year runs Jul→Jun. Jul=7..Dec=12 are in calendar year N, Jan=1..Jun=6 are in N+1.
    // Walk Jul→Jun in order and stop once we pass the current month.
    const result: typeof allMonths = [];
    const order = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
    for (const m of order) {
      result.push(allMonths.find(x => x.value === String(m))!);
      if (m === curMonth) break;
    }
    return result;
  })();

  if (loading) return <ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;
  if (!isSuperAdmin) return <ProtectedRoute><div className="flex flex-col items-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Zonal Awards</h2>
              <p className="text-muted-foreground text-base">Import auto points & download reports</p>
            </div>
          </div>
          <Select value={String(selectedYearId || "")} onValueChange={v => setSelectedYearId(Number(v))}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select Year" /></SelectTrigger>
            <SelectContent>
              {allYears.map((y: any) => (
                <SelectItem key={y.id} value={String(y.id)}>{y.label || y.yearLabel} {y.isCurrent ? "(Current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Zone Cricket Match (Inter District) — yearly, no month-wise */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4" />Inter District Cricket Match (Zone-level, yearly)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <Label>Zone *</Label>
                <Select value={String(selectedZoneId || "")} onValueChange={v => setSelectedZoneId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select Zone" /></SelectTrigger>
                  <SelectContent>
                    {allZones.map((z: any) => {
                      // Phase 4 kill-switch: show Inactive label inline so SA knows the chain is broken.
                      const zInactive = z.isActive === false || z.isActive === 0;
                      return (
                        <SelectItem key={z.id} value={String(z.id)}>
                          {z.zoneName || z.ZoneName || `Zone ${z.id}`}{zInactive ? "  (Inactive)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingZoneAwards ? (
              <div className="flex justify-center py-6"><RotaryLoader size="md" /></div>
            ) : !zoneAwardsData || (zoneAwardsData.questions?.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No zone-level questions found for the selected year.</p>
            ) : (
              <>
                {(zoneAwardsData.questions || []).map((q: any) => {
                  const qOpts = (zoneAwardsData.options || []).filter((o: any) => o.questionId === q.id);
                  return (
                    <div key={q.id} className="space-y-3 border rounded-lg p-4 bg-muted/20">
                      <h4 className="font-semibold text-sm">{q.srNo ? `${q.srNo}. ` : ""}{q.category}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {qOpts.map((opt: any) => (
                          <div key={opt.id} className="space-y-1">
                            <Label className="text-xs">{opt.label} <span className="text-primary font-semibold">({opt.points} pts)</span></Label>
                            <Select
                              value={zoneSelections[opt.id] || "none"}
                              onValueChange={v => setZoneSelections(prev => ({ ...prev, [opt.id]: v === "none" ? "" : v }))}
                            >
                              <SelectTrigger className="h-9"><SelectValue placeholder="Select district" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— None —</SelectItem>
                                {(zoneAwardsData.districts || []).map((d: any) => (
                                  <SelectItem key={d.id} value={String(d.id)}>{d.DistrictNumber || d.districtNumber}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-end">
                  {(() => {
                    // Phase 4 kill-switch: block save when the selected zone is inactive.
                    const selectedZone = allZones.find((z: any) => z.id === selectedZoneId);
                    const zoneInactive = !!selectedZone && (selectedZone.isActive === false || selectedZone.isActive === 0);
                    return (
                      <Button
                        onClick={handleSaveZoneAwards}
                        disabled={savingZoneAwards || zoneInactive}
                        title={zoneInactive ? "Inactive — reactivate from Zones page" : undefined}
                      >
                        {savingZoneAwards ? <><RotaryLoader size="sm" /><span className="ml-2">Saving...</span></> : <><Save className="h-4 w-4 mr-2" />Save Zone Awards</>}
                      </Button>
                    );
                  })()}
                </div>

                {/* Summary table: districts × options */}
                {(zoneAwardsData.districts || []).length > 0 && (
                  <div className="border rounded-lg overflow-x-auto mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>District</TableHead>
                          {(zoneAwardsData.options || []).map((o: any) => (
                            <TableHead key={o.id} className="text-center text-xs">{o.label}</TableHead>
                          ))}
                          <TableHead className="text-center">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(zoneAwardsData.districts || []).map((d: any) => {
                          const dId = d.id;
                          const rowTotal = (zoneAwardsData.selections || [])
                            .filter((s: any) => s.districtId === dId && Number(s.enteredCounts) > 0)
                            .reduce((sum: number, s: any) => sum + Number(s.receivedPoints || 0), 0);
                          return (
                            <TableRow key={dId}>
                              <TableCell className="font-medium">{d.DistrictNumber || d.districtNumber}</TableCell>
                              {(zoneAwardsData.options || []).map((o: any) => {
                                const hasIt = (zoneAwardsData.selections || []).some(
                                  (s: any) => s.optionId === o.id && s.districtId === dId && Number(s.enteredCounts) > 0
                                );
                                return (
                                  <TableCell key={o.id} className="text-center">
                                    {hasIt ? <span className="text-green-600 font-semibold">{o.points}</span> : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-center font-bold text-primary">{rowTotal || "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Import Section */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" />Import Auto Points from Excel</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Month *</Label>
                <Select value={importMonth} onValueChange={setImportMonth}>
                  <SelectTrigger><SelectValue placeholder="Select Month" /></SelectTrigger>
                  <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Excel File *</Label>
                <Input type="file" accept=".xlsx,.xls" onChange={e => setImportFile(e.target.files?.[0] || null)} />
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: XLSX, XLS</p>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={handleImport} disabled={importing || !importFile || !importMonth}>
                  {importing ? <><RotaryLoader size="sm" /><span className="ml-2">Importing...</span></> : <><Upload className="h-4 w-4 mr-2" />Import</>}
                </Button>
                <Button variant="outline" onClick={handleDownloadSample} disabled={downloadingSample}>
                  {downloadingSample ? <RotaryLoader size="sm" /> : <><Download className="h-4 w-4 mr-2" />Sample</>}
                </Button>
                <Button variant="outline" onClick={handleExportStructure} disabled={exportingStructure} title="Export all questions & options with criteria for review / correction">
                  {exportingStructure ? <RotaryLoader size="sm" /> : <><FileSpreadsheet className="h-4 w-4 mr-2" />Export Structure</>}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Excel format (Foundation only): Col A = Sr, B = RowKey (hidden — do not edit), C = Foundation Question, D = Input Type,
              E onwards = District Numbers (only shown for districts in zones where Zonal Awards is enabled).
              Count rows: enter a number. Yes/No rows: enter <b>Yes</b> or <b>No</b>. Empty cells are skipped; 0/No clears existing.
            </p>
          </CardContent>
        </Card>

        {/* Reports Section */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" />Reports</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleDownloadReport} disabled={downloadingReport}>
              {downloadingReport ? <><RotaryLoader size="sm" /><span className="ml-2">Downloading...</span></> : <><Download className="h-4 w-4 mr-2" />Year-wise Report (All Districts)</>}
            </Button>
            <Button variant="outline" onClick={handleDownloadMonthly} disabled={downloadingMonthly}>
              {downloadingMonthly ? <><RotaryLoader size="sm" /><span className="ml-2">Downloading...</span></> : <><Download className="h-4 w-4 mr-2" />Month-wise + Till-Date Report</>}
            </Button>
          </CardContent>
        </Card>

        {/* Import History */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Import History</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {importLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No imports yet for this year.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>#</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="text-center">Districts</TableHead>
                    <TableHead className="text-center">Options</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importLogs.map((log: any, i: number) => (
                    <TableRow key={log.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{monthName(log.month)}</TableCell>
                      <TableCell className="text-sm">{log.fileName}</TableCell>
                      <TableCell className="text-center">{log.totalDistricts}</TableCell>
                      <TableCell className="text-center">{log.totalQuestions}</TableCell>
                      <TableCell className="text-sm">{new Date(log.uploadedDate).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
