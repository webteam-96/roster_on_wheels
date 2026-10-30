"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getDistrictReportMonthDetail, sendReportReminder, getDistrict, getRotaryYears, getDistrictCreditBalance, getMonthlyReportPreview, downloadClubMonthlyReportWord } from "@/services/api";
import { downloadPDF } from "@/utils/reportDownload";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, CheckCircle2, XCircle, Send, Mail, Building2, AlertTriangle, RefreshCw, FileText, FileSpreadsheet, Loader2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictEgovernanceTabBar from "@/components/dashboard/DistrictEgovernanceTabBar";
import DistrictEgovernanceKpis from "@/components/dashboard/DistrictEgovernanceKpis";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
function formatDate(d: string | null) {
  if (!d) return "-";
  try { return new Date(d).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; }
}

function ReminderStatusBadge({ emailStatus, lastDate }: { emailStatus?: string; lastDate?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      {emailStatus && emailStatus !== "not_sent" && (
        <Badge variant={emailStatus === "sent" ? "default" : "destructive"} className="text-xs w-fit">
          <Mail className="h-3 w-3 mr-1" />{emailStatus === "sent" ? "Email Sent" : "Email Failed"}
        </Badge>
      )}
      {lastDate && <span className="text-xs text-muted-foreground">{formatDate(lastDate)}</span>}
    </div>
  );
}

export default function MonthDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const yearId = Number(params.yearId);
  const month = Number(params.month);
  const returnTo = searchParams.get("returnTo");
  const backHref = returnTo ? decodeURIComponent(returnTo) : `/districts/${districtId}/club-monthly-report`;
  // When reached from the e-governance CMR tab (returnTo present), show the static tab bar.
  const fromEgov = !!returnTo && returnTo.includes("egovernance");
  const { isSuperAdmin, isAdmin, selectedDistrictId, selectScope } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  // Keep the dashboard shell's scope-picker in sync with the URL district.
  useEffect(() => {
    if (Number.isFinite(districtId) && districtId > 0 && districtId !== selectedDistrictId) {
      selectScope({ districtId });
    }
  }, [districtId, selectedDistrictId, selectScope]);

  const [districtName, setDistrictName] = useState("");
  const [yearLabel, setYearLabel] = useState("");
  const [monthName, setMonthName] = useState("");
  const [submitted, setSubmitted] = useState<any[]>([]);
  const [notSubmitted, setNotSubmitted] = useState<any[]>([]);
  const [emailBalance, setEmailBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reminder dialog
  const [reminderOpen, setReminderOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);

  // View toggle (Submitted / Not Submitted) + AG filter.
  const [view, setView] = useState<"submitted" | "notSubmitted">("submitted");
  const [agId, setAgId] = useState<string>("all");

  // Per-club report download (PDF/Word) — same detailed report the club admin gets.
  const [downloading, setDownloading] = useState<{ clubId: number; format: "pdf" | "word" } | null>(null);
  const [downloadingAll, setDownloadingAll] = useState<"pdf" | "word" | null>(null);

  // Unique AGs across both lists (for the AG dropdown) + AG-filtered lists.
  const uniqueAgs = Array.from(
    new Map(
      [...submitted, ...notSubmitted]
        .filter((c: any) => c.agMemberId != null && c.agName)
        .map((c: any) => [String(c.agMemberId), { id: String(c.agMemberId), name: c.agName as string }]),
    ).values(),
  );
  const byAg = (c: any) => agId === "all" || String(c.agMemberId) === agId;
  const filteredSubmitted = submitted.filter(byAg);
  const filteredNotSubmitted = notSubmitted.filter(byAg);

  // Identical to the club-admin CMR download: fetch the same preview, render PDF with
  // downloadPDF(preview), and the server-side Word via downloadClubMonthlyReportWord
  // with the same filename base.
  const downloadOneClub = async (clubId: number, _clubName: string, format: "pdf" | "word") => {
    const preview = await getMonthlyReportPreview(clubId, yearId, month);
    if (format === "pdf") {
      downloadPDF(preview);
    } else {
      const base = `${preview.clubName}_Monthly_Report_${preview.monthName}_${preview.yearLabel}`;
      await downloadClubMonthlyReportWord(clubId, yearId, month, base);
    }
  };

  const handleDownloadClub = async (clubId: number, clubName: string, format: "pdf" | "word") => {
    try {
      setDownloading({ clubId, format });
      await downloadOneClub(clubId, clubName, format);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || `Failed to download ${clubName}'s report.`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAll = async (format: "pdf" | "word") => {
    if (submitted.length === 0) return;
    setDownloadingAll(format);
    let failures = 0;
    for (const c of submitted) {
      try {
        // Sequential so the browser doesn't block a burst of downloads.
        await downloadOneClub(c.clubId, c.clubName, format);
      } catch { failures++; }
    }
    setDownloadingAll(null);
    if (failures > 0) setErrorMessage(`${failures} of ${submitted.length} club report(s) could not be downloaded.`);
    else setSuccessMessage(`Downloaded ${submitted.length} club report(s) as ${format.toUpperCase()}.`);
  };

  const fetchCredits = async () => {
    try {
      const balance = await getDistrictCreditBalance(districtId);
      const eb = balance.emailRemaining || 0;
      setEmailBalance(eb);
      setSendEmail(eb > 0);
    } catch {}
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [d, detail, allYears] = await Promise.all([
        getDistrict(districtId),
        getDistrictReportMonthDetail(districtId, yearId, month),
        getRotaryYears(),
      ]);
      setDistrictName(`District ${d.districtNumber}`);
      setSubmitted(detail.submitted || []);
      setNotSubmitted(detail.notSubmitted || []);

      const yr = allYears.find((y: any) => y.id === yearId);
      if (yr) setYearLabel(yr.yearLabel);

      const startYear = yr ? new Date(yr.startDate).getFullYear() : new Date().getFullYear();
      const mDate = new Date(month >= 7 ? startYear : startYear + 1, month - 1, 1);
      setMonthName(mDate.toLocaleDateString(appLocale(), { month: "long", year: "numeric" }));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); fetchCredits(); }, [districtId, yearId, month]);

  const handleSendReminder = async () => {
    if (!sendEmail) {
      setErrorMessage("Select Email to send reminders.");
      return;
    }
    setSending(true);
    try {
      // AG selected → send only to that AG's not-submitted clubs; "All" → every not-submitted club.
      const result = await sendReportReminder(districtId, yearId, month, {
        sendEmail,
        agMemberId: agId === "all" ? null : Number(agId),
      });
      setReminderOpen(false);
      setSuccessMessage(result.message || "Reminders are being sent in background.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to send reminders.");
    } finally {
      setSending(false);
    }
  };

  const noEmailCredits = emailBalance <= 0;

  // Count how many emails will be sent — for the AG-filtered set that
  // the send will actually target (all not-submitted when AG = All).
  const emailCount = filteredNotSubmitted.reduce((count: number, c: any) => {
    let n = 0;
    if (c.presidentEmail) n++;
    if (c.secretaryEmail) n++;
    return count + n;
  }, 0);

  const content = (
      <div className="space-y-6">
        {/* Static E-Governance KPI cards + tab bar when opened from the CMR tab. */}
        {fromEgov && (
          <div className="space-y-4">
            <DistrictEgovernanceKpis districtId={districtId} yearId={yearId} />
            <DistrictEgovernanceTabBar />
          </div>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backHref}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {monthName || "Monthly Report"}
              </h2>
              <p className="text-muted-foreground text-base">{districtName} - {yearLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}

        {!loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-green-200 bg-green-50/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">{submitted.length}</p>
                    <p className="text-sm text-green-600">Submitted</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <XCircle className="h-8 w-8 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold text-red-600">{notSubmitted.length}</p>
                    <p className="text-sm text-red-500">Not Submitted</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <Building2 className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="text-2xl font-bold text-blue-700">{submitted.length + notSubmitted.length}</p>
                    <p className="text-sm text-blue-600">Total Clubs</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Toolbar — view radio (Submitted / Not Submitted) + AG filter (applies to both). */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView("submitted")}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${view === "submitted" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  <span className={`h-3.5 w-3.5 rounded-full ${view === "submitted" ? "bg-white ring-2 ring-emerald-600" : "border border-slate-400"}`} />
                  Submitted ({filteredSubmitted.length})
                </button>
                <button
                  type="button"
                  onClick={() => setView("notSubmitted")}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${view === "notSubmitted" ? "bg-rose-600 text-white border-rose-600" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  <span className={`h-3.5 w-3.5 rounded-full ${view === "notSubmitted" ? "bg-white ring-2 ring-rose-600" : "border border-slate-400"}`} />
                  Not Submitted ({filteredNotSubmitted.length})
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={agId} onValueChange={setAgId}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="All AGs" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All AGs</SelectItem>
                    {uniqueAgs.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {canManage && view === "notSubmitted" && filteredNotSubmitted.length > 0 && (
                  <Button onClick={() => setReminderOpen(true)} className="bg-amber-600 hover:bg-amber-700">
                    <Send className="mr-2 h-4 w-4" />Send Reminder ({filteredNotSubmitted.length} Clubs)
                  </Button>
                )}
              </div>
            </div>

            {/* Not Submitted Section */}
            {view === "notSubmitted" && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />Not Submitted ({filteredNotSubmitted.length})
              </h3>
              {filteredNotSubmitted.length === 0 ? (
                <Card><CardContent className="p-6 text-center text-muted-foreground">All clubs have submitted!</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Club Name</TableHead>
                          <TableHead>Club Code</TableHead>
                          <TableHead>President</TableHead>
                          <TableHead>Secretary</TableHead>
                          <TableHead>Reminder Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredNotSubmitted.map((c: any, idx: number) => (
                          <TableRow key={c.clubId} className="bg-red-50/30">
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell className="font-medium">{c.clubName}</TableCell>
                            <TableCell>{c.clubRotaryId}</TableCell>
                            <TableCell>
                              {c.presidentName ? (
                                <div className="text-xs space-y-0.5">
                                  <p className="font-medium">{c.presidentName}</p>
                                  {c.presidentMobile && <p className="text-muted-foreground">{c.presidentMobile}</p>}
                                  {c.presidentEmail && <p className="text-muted-foreground truncate max-w-[150px]">{c.presidentEmail}</p>}
                                </div>
                              ) : <span className="text-xs text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell>
                              {c.secretaryName ? (
                                <div className="text-xs space-y-0.5">
                                  <p className="font-medium">{c.secretaryName}</p>
                                  {c.secretaryMobile && <p className="text-muted-foreground">{c.secretaryMobile}</p>}
                                  {c.secretaryEmail && <p className="text-muted-foreground truncate max-w-[150px]">{c.secretaryEmail}</p>}
                                </div>
                              ) : <span className="text-xs text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell>
                              <ReminderStatusBadge emailStatus={c.lastEmailStatus} lastDate={c.lastReminderDate} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
            )}

            {/* Submitted Section */}
            {view === "submitted" && (
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />Submitted ({filteredSubmitted.length})
                </h3>
              </div>
              {filteredSubmitted.length === 0 ? (
                <Card><CardContent className="p-6 text-center text-muted-foreground">No clubs have submitted yet.</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Club Name</TableHead>
                          <TableHead>Assistant Governor</TableHead>
                          <TableHead>Submitted Date &amp; Time</TableHead>
                          <TableHead className="text-right">Report</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSubmitted.map((c: any, idx: number) => (
                          <TableRow key={c.clubId}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell className="font-medium">{c.clubName}</TableCell>
                            <TableCell>{c.agName || <span className="text-muted-foreground">-</span>}</TableCell>
                            <TableCell>{formatDate(c.submittedDate)}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline" size="sm"
                                  onClick={() => handleDownloadClub(c.clubId, c.clubName, "pdf")}
                                  disabled={!!downloading || !!downloadingAll}
                                >
                                  {downloading?.clubId === c.clubId && downloading?.format === "pdf"
                                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    : <FileText className="h-3.5 w-3.5 mr-1 text-rose-500" />}
                                  PDF
                                </Button>
                                <Button
                                  variant="outline" size="sm"
                                  onClick={() => handleDownloadClub(c.clubId, c.clubName, "word")}
                                  disabled={!!downloading || !!downloadingAll}
                                >
                                  {downloading?.clubId === c.clubId && downloading?.format === "word"
                                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    : <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-blue-500" />}
                                  Word
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
            )}
          </>
        )}

        {/* Send Reminder Dialog */}
        <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Send Reminder</DialogTitle>
              <DialogDescription>
                Send reminder to President & Secretary of {filteredNotSubmitted.length} club(s){agId !== "all" ? ` under AG ${uniqueAgs.find((a) => a.id === agId)?.name ?? ""}` : ""} that have not submitted their monthly report for {monthName}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center space-x-3">
                <Checkbox id="sendEmail" checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} disabled={noEmailCredits} />
                <Label htmlFor="sendEmail" className={`flex items-center gap-2 cursor-pointer ${noEmailCredits ? "opacity-50" : ""}`}>
                  <Mail className="h-4 w-4 text-blue-600" />Send Email Reminder <span className="text-muted-foreground font-normal">({emailCount} emails)</span>
                </Label>
              </div>
              {noEmailCredits && (
                <p className="text-xs text-red-500 flex items-center gap-1 ml-7">
                  <AlertTriangle className="h-3 w-3" />Your email balance is low. No email credits available.
                </p>
              )}

              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-blue-600" />
                    <span>Email Balance:</span>
                    <strong className={emailBalance > 0 ? "text-blue-700" : "text-red-600"}>{emailBalance}</strong>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Reminders will be sent in background. Click Refresh to check status.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReminderOpen(false)} disabled={sending}>Cancel</Button>
              <Button onClick={handleSendReminder} disabled={sending || !sendEmail} className="bg-amber-600 hover:bg-amber-700">
                {sending ? "Sending..." : "Send Reminder"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
  );

  // From the e-governance dashboard → keep the district-admin dashboard chrome
  // (side menu + topbar). From the SuperAdmin district-reports flow → bare page.
  return (
    <ProtectedRoute>
      {fromEgov ? (
        <DistrictAdminShell pageTitle="Club Monthly Report" activeNavHref="/district-admin-dashboard/egovernance">
          {content}
        </DistrictAdminShell>
      ) : content}
    </ProtectedRoute>
  );
}
