"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  getRotaryYears, importGoalFoundationMonthly, importGoalFoundationClub, importGoalDistrictMembership,
  downloadGoalFoundationSample, downloadGoalFoundationClubSample, convertGoalFoundationClubFile,
} from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";
import type { GoalFoundationImportResultDto } from "@/types/goalSetting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Upload, FileSpreadsheet, AlertTriangle, Download } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function GoalImportsPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Foundation import.
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [impYearId, setImpYearId] = useState<string>("");
  const [impMonth, setImpMonth] = useState<string>("");   // month the district Excel is for (0/"" = annual only)
  const [impFile, setImpFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<GoalFoundationImportResultDto | null>(null);

  // Club Foundation import (Year → upload the MCR Excel; every district's clubs, matched by Club No).
  const [cfFile, setCfFile] = useState<File | null>(null);
  const [cfMonth, setCfMonth] = useState<string>("");
  const [cfImporting, setCfImporting] = useState(false);
  const [cfResult, setCfResult] = useState<GoalFoundationImportResultDto | null>(null);
  // Convert Rotary.org's raw MCR into our import file (synced clubs only, 2 decimals) - download only.
  const [cfConverting, setCfConverting] = useState(false);
  const convertInputRef = useRef<HTMLInputElement>(null);

  // District Membership import (user 2026-10-08): two Rotary.org files; the month comes from the file.
  const [dmMembers, setDmMembers] = useState<File | null>(null);
  const [dmGender, setDmGender] = useState<File | null>(null);
  const [dmRotaract, setDmRotaract] = useState<File | null>(null);
  const [dmInteract, setDmInteract] = useState<File | null>(null);
  const [dmImporting, setDmImporting] = useState(false);
  const [dmResult, setDmResult] = useState<GoalFoundationImportResultDto | null>(null);

  const load = useCallback(async () => {
    try {
      const y = await getRotaryYears();
      setYears(y);
      const current = y.find((yr) => yr.isCurrent) || y[0];
      if (current) setImpYearId(String(current.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load Rotary years.");
    }
  }, []);

  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, [load]);

  // ── Foundation import handlers ─────────────────────────────────────────────────────────────
  const [dlSample, setDlSample] = useState<"" | "district" | "club">("");
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const ts = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const handleDownloadDistrictSample = async () => {
    setDlSample("district");
    try { saveBlob(await downloadGoalFoundationSample(), `foundation_district_sample_${ts()}.xlsx`); }
    catch { setErrorMessage("Could not download the district sample."); }
    finally { setDlSample(""); }
  };
  const handleDownloadClubSample = async () => {
    setDlSample("club");
    try { saveBlob(await downloadGoalFoundationClubSample(), `foundation_club_sample_${ts()}.xlsx`); }
    catch { setErrorMessage("Could not download the club sample."); }
    finally { setDlSample(""); }
  };

  // Months available to import for the selected year: a past year → all 12 (Jul→Jun); the current
  // year → only up to the current calendar month. Each option carries the CALENDAR month number.
  const importMonths = (() => {
    const y = years.find((yr) => String(yr.id) === impYearId);
    if (!y || !y.startDate) return [] as { value: number; label: string }[];
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const start = new Date(y.startDate);
    const todayFirst = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const out: { value: number; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      if (d > todayFirst) break; // current year → stop at the current month
      out.push({ value: d.getMonth() + 1, label: `${labels[d.getMonth()]} ${d.getFullYear()}` });
    }
    return out;
  })();

  const handleImport = async () => {
    if (!impYearId) { setErrorMessage("Select a year."); return; }
    if (!impMonth) { setErrorMessage("Select the month this Excel is for."); return; }
    if (!impFile) { setErrorMessage("Choose an Excel file to import."); return; }
    setImporting(true); setImportResult(null);
    try {
      const res = await importGoalFoundationMonthly(Number(impYearId), impFile, Number(impMonth));
      setImportResult(res); setSuccessMessage(res.message || "Import complete."); setImpFile(null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Import failed.");
    } finally { setImporting(false); }
  };

  const handleConvertRotaryFile = async (file: File | undefined) => {
    if (!file) return;
    setCfConverting(true);
    try {
      const r = await convertGoalFoundationClubFile(file);
      saveBlob(r.blob, `foundation_club_import_${ts()}.xlsx`);
      setSuccessMessage(
        `Converted: ${r.filled} synced club(s) filled` +
        (r.missing > 0 ? `, ${r.missing} not in Rotary's file (left blank - their current values are kept; listed on the Notes sheet)` : "") +
        ". Check the file, then import it here with the month.");
    } catch (err: any) {
      let msg = "Could not convert the file.";
      const data = err?.response?.data;
      if (data instanceof Blob) { try { msg = JSON.parse(await data.text())?.message || msg; } catch { /* keep default */ } }
      setErrorMessage(msg);
    } finally {
      setCfConverting(false);
      if (convertInputRef.current) convertInputRef.current.value = "";
    }
  };

  const handleClubImport = async () => {
    if (!impYearId) { setErrorMessage("Select a year."); return; }
    if (!cfMonth) { setErrorMessage("Select the month this Excel is for."); return; }
    if (!cfFile) { setErrorMessage("Choose the MCR Excel file to import."); return; }
    setCfImporting(true); setCfResult(null);
    try {
      const res = await importGoalFoundationClub(Number(impYearId), cfFile, Number(cfMonth));
      setCfResult(res); setSuccessMessage(res.message || "Import complete."); setCfFile(null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Import failed.");
    } finally { setCfImporting(false); }
  };

  const handleMembershipImport = async () => {
    if (!impYearId) { setErrorMessage("Select a year."); return; }
    if (!dmMembers || !dmGender) { setErrorMessage("Choose both Rotary.org files."); return; }
    setDmImporting(true); setDmResult(null);
    try {
      const res = await importGoalDistrictMembership(Number(impYearId), dmMembers, dmGender, dmRotaract, dmInteract);
      setDmResult(res); setSuccessMessage(res.message || "Import complete.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Import failed.");
    } finally { setDmImporting(false); }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center py-20 min-h-[60vh]"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }
  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can import goal data.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Goal Setting: Data Import</h2>
            <p className="text-muted-foreground text-base">Foundation (district and club) and District Membership imports for goal setting.</p>
          </div>
        </div>

        <Tabs defaultValue="import" className="space-y-6">
          <TabsList>
            <TabsTrigger value="import">District Foundation Import</TabsTrigger>
            <TabsTrigger value="clubimport">Club Foundation Import</TabsTrigger>
            <TabsTrigger value="membershipimport">District Membership Import</TabsTrigger>
          </TabsList>

          {/* ── IMPORT TAB (default — used monthly) ── */}
          <TabsContent value="import" className="space-y-6 mt-0">

        {/* Foundation monthly benchmark import */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Foundation Benchmark Import (Till-Date)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Upload the official ROW district Foundation Excel (fields as rows, districts as columns).
              Only the 10 Foundation metrics are read into each field&apos;s <span className="font-medium">Achieved</span> value
              per district; other rows are ignored and any non-numeric characters in a cell are stripped. Re-importing overwrites with the latest figures.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Year</label>
                <Select value={impYearId} onValueChange={(v) => { setImpYearId(v); setImpMonth(""); setImportResult(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Month (this Excel is for)</label>
                <Select value={impMonth} onValueChange={(v) => { setImpMonth(v); setImportResult(null); }} disabled={!impYearId}>
                  <SelectTrigger><SelectValue placeholder={impYearId ? "Select month" : "Pick a year first"} /></SelectTrigger>
                  <SelectContent>
                    {importMonths.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Master Excel</label>
                <Input type="file" accept=".xlsx" onChange={(e) => setImpFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleImport} disabled={importing || !impFile || !impYearId || !impMonth}>
                {importing ? <RotaryLoader size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Import</>}
              </Button>
              <Button variant="outline" onClick={handleDownloadDistrictSample} disabled={dlSample !== ""}
                title="Download the district sample in the exact upload format: all current districts as columns, 0 baseline">
                {dlSample === "district" ? <RotaryLoader size="sm" /> : <><Download className="h-4 w-4 mr-2" />Download Sample</>}
              </Button>
            </div>
            {importResult && (
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="text-sm font-medium">
                  Imported {importResult.importedDistricts} district(s) · {importResult.valuesWritten} value(s) written.
                </div>
                {importResult.skippedRows.length > 0 ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 mb-1">
                      <AlertTriangle className="h-4 w-4" />{importResult.skippedRows.length} row(s) skipped
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-16">Row</TableHead>
                            <TableHead>District Number</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResult.skippedRows.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell>{s.row}</TableCell>
                              <TableCell className="font-medium">{s.districtNumber || "–"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-emerald-700">All rows imported. No skipped rows.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

          </TabsContent>

          {/* ── CLUB FOUNDATION IMPORT TAB — Year → upload the MCR Excel (all districts) ── */}
          <TabsContent value="clubimport" className="space-y-6 mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  Club Foundation Import (Monthly Contribution Report)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pick a year, then upload the Rotary <span className="font-medium">Monthly Contribution Report (MCR)</span> Excel.
                  The file lists <span className="font-medium">every district's clubs</span>: each club is matched by <span className="font-medium">Club No = Club Rotary ID</span> and has its Foundation goals filled: Goal Amount &amp; Goal % Achieved
                  (the club can edit these) and the AF Per Capita / Annual Fund / PolioPlus / Other / Endowment / Total figures (read-only).
                  Wrong-format files are rejected (the bad column is named); non-numeric characters are ignored; any Club No not found in the system is skipped and listed below.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Year</label>
                    <Select value={impYearId} onValueChange={(v) => { setImpYearId(v); setCfMonth(""); setCfResult(null); }}>
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Month (this Excel is for)</label>
                    <Select value={cfMonth} onValueChange={(v) => { setCfMonth(v); setCfResult(null); }} disabled={!impYearId}>
                      <SelectTrigger><SelectValue placeholder={impYearId ? "Select month" : "Pick a year first"} /></SelectTrigger>
                      <SelectContent>
                        {importMonths.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">MCR Excel</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => setCfFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleClubImport} disabled={cfImporting || !cfFile || !impYearId || !cfMonth}>
                    {cfImporting ? <RotaryLoader size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Import</>}
                  </Button>
                  <Button variant="outline" onClick={handleDownloadClubSample} disabled={dlSample !== ""}
                    title="Download the club sample in the exact MCR format: one row per current synced club, 0 baseline">
                    {dlSample === "club" ? <RotaryLoader size="sm" /> : <><Download className="h-4 w-4 mr-2" />Download Sample</>}
                  </Button>
                  <input ref={convertInputRef} type="file" accept=".xlsx" className="hidden"
                    onChange={(e) => handleConvertRotaryFile(e.target.files?.[0])} />
                  <Button variant="outline" onClick={() => convertInputRef.current?.click()} disabled={cfConverting}
                    title="Pick the Rotary.org Monthly Contribution Report as downloaded. You get back our import file: synced clubs only, amounts rounded to 2 decimals. Nothing is imported until you upload it with Import.">
                    {cfConverting ? <RotaryLoader size="sm" /> : <><FileSpreadsheet className="h-4 w-4 mr-2" />Convert Rotary.org File</>}
                  </Button>
                </div>
                {cfResult && (
                  <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-2">
                    <div>
                      <span className="font-medium">{cfResult.message}</span>
                      {cfResult.valuesWritten > 0 && <span className="text-emerald-700"> · {cfResult.valuesWritten} value(s) written.</span>}
                    </div>
                    {cfResult.skippedRows.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50">
                        <div className="px-3 py-2 text-xs font-semibold text-amber-800 border-b border-amber-200">
                          {cfResult.skippedRows.length} club row(s) skipped: Club No not found in the system
                        </div>
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-amber-100/80 text-amber-900">
                              <tr>
                                <th className="text-left px-3 py-1.5 font-medium">Row</th>
                                <th className="text-left px-3 py-1.5 font-medium">Club No</th>
                                <th className="text-left px-3 py-1.5 font-medium">Name</th>
                                <th className="text-left px-3 py-1.5 font-medium">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cfResult.skippedRows.map((s, i) => (
                                <tr key={i} className="border-t border-amber-100">
                                  <td className="px-3 py-1 tabular-nums">{s.row}</td>
                                  <td className="px-3 py-1 tabular-nums">{s.clubNo || "–"}</td>
                                  <td className="px-3 py-1">{s.clubName || "–"}</td>
                                  <td className="px-3 py-1 text-amber-800">{s.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DISTRICT MEMBERSHIP IMPORT TAB (user 2026-10-08) ── */}
          <TabsContent value="membershipimport" className="space-y-6 mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  District Membership Import (Rotary.org)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Upload the two Rotary.org files as downloaded. From <span className="font-medium">Rotary_Comparison_to_1_July</span>:
                  Clubs and Members on 1 July and on the report date. From <span className="font-medium">Members Admitted by Gender</span>:
                  women admitted minus women terminated (Rotary sheets only). Women on 1 July is the system&apos;s own count, fixed at the first import.
                  The month is taken from the report date (e.g. 30 September 2026 = Sep); earlier months stay blank.
                  Optional third file <span className="font-medium">Rotaract_Comparison_to_1_July</span>: fills Youth Service &rarr; Rotaract
                  &ldquo;Existing Clubs&rdquo;, &ldquo;Clubs Achieved&rdquo;, &ldquo;No. of Rotaractors as on July 1st&rdquo; and &ldquo;Rotaractors Achieved&rdquo;. Optional <span className="font-medium">Interact_Statistics</span>:
                  fills Youth Service &rarr; Interact &ldquo;Clubs Achieved&rdquo; (Total Active Clubs, sheet By District). Percentages are worked out as usual.
                  Only our districts (Zones 4-7) are written.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Year</label>
                    <Select value={impYearId} onValueChange={(v) => { setImpYearId(v); setDmResult(null); }}>
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotary Comparison to 1 July</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => { setDmMembers(e.target.files?.[0] || null); setDmResult(null); }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Members Admitted by Gender</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => { setDmGender(e.target.files?.[0] || null); setDmResult(null); }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rotaract Comparison to 1 July (optional)</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => { setDmRotaract(e.target.files?.[0] || null); setDmResult(null); }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Interact Statistics (optional)</label>
                    <Input type="file" accept=".xlsx" onChange={(e) => { setDmInteract(e.target.files?.[0] || null); setDmResult(null); }} />
                  </div>
                </div>
                <Button onClick={handleMembershipImport} disabled={dmImporting || !dmMembers || !dmGender || !impYearId}>
                  {dmImporting ? <RotaryLoader size="sm" /> : <><Upload className="h-4 w-4 mr-2" />Import</>}
                </Button>
                {dmResult && (
                  <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-2">
                    <div className="font-medium">{dmResult.message}</div>
                    {dmResult.skippedRows.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {dmResult.skippedRows.map((s, i) => (
                          <div key={i}>District {s.districtNumber}: {s.reason}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  );
}
