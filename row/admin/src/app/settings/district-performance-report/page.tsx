"use client";
import { ToggleButton } from "@/components/ui/text-buttons";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, Eye, Loader2, Mail, Printer } from "@/components/icons";
import SearchableCombo from "@/components/SearchableCombo";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KpiTile, PageHeader, Panel, SkeletonRows, rowTable } from "@/components/row/AppKit";
import { fileTimestamp } from "@/lib/dateUtils";
import { useDownloadProgress } from "@/lib/downloadProgress";
import {
  getDistrictPerformanceReportSettings,
  getDistrictPerformanceReportDistricts,
  getDistrictPerformanceReportView,
  downloadDistrictPerformanceReportExcel,
  sendDistrictPerformanceReportTest,
  type PerformanceReportHighlight,
  type PerformanceReportSection,
  type DistrictPerformanceReportView,
  type PerformanceReportDistrictOption,
  type PerformanceReportSettings,
} from "@/services/api";

import { appLocale } from "@/lib/appFormat";
import Pagination from "@/components/Pagination";
const PCT_HEADER = "Percentage Achieved";

// Text columns align left, numbers right: the first column, plus the club name in "#"-ranked tables.
const isTextCol = (headers: string[] | null | undefined, i: number) =>
  i === 0 || (i === 1 && !!headers && headers[0] === "#");

// Same progress colours as the email: under 30% red, under 60% amber, otherwise green.
const ragColor = (pct: number) => (pct < 30 ? "var(--go-danger-600)" : pct < 60 ? "var(--go-warning-600)" : "var(--go-success-600)");

// RAG Analysis band rows ("RED (10 – 25)") in their own colour.
const bandColor = (text: string) =>
  text.startsWith("RED") ? "var(--go-danger-600)" : text.startsWith("AMBER") ? "var(--go-warning-600)" : text.startsWith("GREEN") ? "var(--go-success-600)" : null;

// % columns show the figure only (no bar), coloured red / amber / green.
const isPctCol = (header: string | undefined) => !!header && (header === PCT_HEADER || header.endsWith("%"));

// Print = the email body itself (the API returns it with the view), so a printed copy is identical to
// what the DG receives. The window is opened on the click (never after an await, or the
// pop-up blocker stops it), shows "Preparing…", and prints itself once the report is in.
function openPrintWindow(): Window | null {
  const w = window.open("", "_blank");
  if (!w) return null;
  w.document.write("<p style='font-family:Arial,sans-serif;color:#2A3F5C;padding:24px'>Preparing the report…</p>");
  return w;
}

function writePrintDoc(w: Window, html: string, title: string) {
  const head = `<head><meta charset="utf-8"><title>${title}</title><style>
      @page { margin: 10mm; }
      html, body { background: #fcfdfe !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    </style><script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);}</script></head>`;
  w.document.open();
  w.document.write(html.includes("<html>") ? html.replace("<html>", `<html>${head}`) : `<html>${head}<body>${html}</body></html>`);
  w.document.close();
}

// Highlights ("At a glance") + parts/sections of the District report.
// tilesPerRow: 4 on the District report (two rows of four).
function ReportBody({ highlights, sections, scopeNote, tilesPerRow = 3 }: { highlights: PerformanceReportHighlight[]; sections: PerformanceReportSection[]; scopeNote?: string | null; tilesPerRow?: 3 | 4 }) {
  return (
    <>
            {highlights?.length > 0 && (
              <div className="space-y-3">
                {/* Tiles are grouped: one unnamed group on the DG report. */}
                {Array.from(new Set(highlights.map((h) => h.group ?? ""))).map((group) => (
                  <div key={group}>
                    <div className="text-sm font-semibold text-slate-800 mb-2">{group || "At a glance"}</div>
                    <div className={`grid gap-3 grid-cols-2 ${tilesPerRow === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                      {highlights.filter((h) => (h.group ?? "") === group).map((h, hi) => (
                        <div key={hi} className={`row-rise rounded-xl border border-[color:var(--row-line)] bg-card p-4 ${h.newRow ? "md:col-start-1" : ""}`}>
                          <div className="text-[13px] font-semibold text-muted-foreground">{h.label}</div>
                          <div className="text-2xl font-bold tabular-nums" style={{ color: h.percent != null ? ragColor(h.percent) : "var(--go-navy-900)" }}>{h.value}</div>
                          {h.sub && <div className="text-xs text-slate-500">{h.sub}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Plain scope line under the tiles — no box, no colour. */}
            {scopeNote && <p className="text-xs text-slate-700 -mt-1">{scopeNote}</p>}

            {Array.from(new Set(sections.map((s) => s.part))).map((part, pi) => {
              const partSections = sections.filter((s) => s.part === part);
              return (
            <div key={part || pi} className="space-y-3">
              {part && (
                <div className="mt-2 rounded-xl bg-azure px-6 py-4">
                  <div className="text-[13px] text-[#cfe2f6]">Part {pi + 1}</div>
                  <div className="text-lg font-bold text-white">{part}</div>
                  {partSections[0]?.partSubtitle && <div className="text-xs text-slate-300">{partSections[0].partSubtitle}</div>}
                </div>
              )}
            <div className="grid gap-4 md:grid-cols-2">
              {partSections.map((s, si) => {
                const wide = !!s.tableRows && s.tableRows.length > 0 && (s.tableHeaders?.length ?? 0) > 3;
                return (
                  <div key={si} className={`overflow-hidden rounded-xl border border-[color:var(--row-line)] bg-card ${wide ? "md:col-span-2" : ""}`}>
                    <h3 className="row-h2 px-4 pb-2 pt-4">{s.title}</h3>
                    {s.intro && <div className="px-4 py-2 text-xs italic text-slate-700 border-b border-slate-100">{s.intro}</div>}
                    {s.items.length > 0 && (
                      <Table className="w-full table-fixed text-sm">
                        <TableBody className="divide-y divide-slate-100">
                          {s.items.map((it, i) => {
                            // A leading space in the label marks a sub-row (e.g. "   Banners") — indent it.
                            const sub = it.label.startsWith(" ");
                            return (
                              <TableRow key={i} className={i % 2 ? "bg-slate-50/50" : ""}>
                                <TableCell className={`py-2 pr-2 w-3/5 ${sub ? "pl-8 text-slate-500" : "pl-4 text-slate-700"}`}>{it.label.trim()}</TableCell>
                                <TableCell className="px-4 py-2 text-right font-semibold text-slate-900 tabular-nums [overflow-wrap:anywhere]">
                                  {it.url ? (
                                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900">{it.value}</a>
                                  ) : it.value}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                    {s.tableHeaders && s.tableRows && s.tableRows.length > 0 && (
                      <div className="overflow-x-auto">
                        <Table className="w-full min-w-[640px] md:min-w-full text-sm">
                          <TableHeader>
                            <TableRow>
                              {s.tableHeaders.map((h, hi) => (
                                <TableHead key={hi} className={`px-3 py-2 font-medium ${isTextCol(s.tableHeaders, hi) ? "text-left" : "text-right"}`}>{h}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody className="divide-y divide-slate-100">
                            {s.tableRows.map((row, ri) => (
                              <TableRow key={ri} className={ri % 2 ? "bg-slate-50/50" : ""}>
                                {row.map((cell, ci) => (
                                  <TableCell key={ci} className={`px-3 py-1.5 ${isTextCol(s.tableHeaders, ci) ? "text-left text-slate-700" : "text-right tabular-nums text-slate-900"} whitespace-pre-line`}>
                                    {isPctCol(s.tableHeaders?.[ci]) && !Number.isNaN(parseFloat(cell))
                                      ? <span className="font-semibold" style={{ color: ragColor(parseFloat(cell)) }}>{cell}</span>
                                      : ci === 0 && bandColor(cell)
                                        ? <span className="font-semibold" style={{ color: bandColor(cell)! }}>{cell}</span>
                                        : cell}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    {s.note && <div className="px-4 py-2 text-xs italic text-slate-700 border-t border-slate-100">{s.note}</div>}
                  </div>
                );
              })}
            </div>
            </div>
              );
            })}
    </>
  );
}

// SuperAdmin page for the District Performance Report (DG progress report). Pick a district, view the
// counts exactly as the email shows them, download the Excel, or send a TEST email to the configured
// test recipients. The report only goes to District Governors once the schedule is switched to Live.
export default function DistrictPerformanceReportPage() {
  const [settings, setSettings] = useState<PerformanceReportSettings | null>(null);
  const [districts, setDistricts] = useState<PerformanceReportDistrictOption[]>([]);
  const [districtId, setDistrictId] = useState<number>(0);
  const [report, setReport] = useState<DistrictPerformanceReportView | null>(null);
  const [viewing, setViewing] = useState(false);
  // Report downloads: progress inside the clicked button, one at a time on this page.
  const dl = useDownloadProgress();
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [runDate, setRunDate] = useState<string | null>(null); // null = every run
  const [printing, setPrinting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── Sent list (user 2026-09-29) ───────────────────────────────────────────────────────────────
  // The run log of the per-district DG mails. A live run writes one row per district, so
  // it is paged and summarised per run date.
  const SEND_PAGE_SIZE = 20;
  const [sendPage, setSendPage] = useState(1);

  const allRuns = settings?.recentRuns ?? [];
  const runDay = (d: string) =>
    new Date(d).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  const sendRows = runDate ? allRuns.filter((r) => runDay(r.createdDate) === runDate) : allRuns;
  const sendPageCount = Math.max(1, Math.ceil(sendRows.length / SEND_PAGE_SIZE));
  const sendStart = (sendPage - 1) * SEND_PAGE_SIZE;
  const sendPageRows = sendRows.slice(sendStart, sendStart + SEND_PAGE_SIZE);
  const sendRuns = (() => {
    const by = new Map<string, { date: string; sent: number; skipped: number; failed: number }>();
    for (const r of allRuns) {
      const d = runDay(r.createdDate);
      const g = by.get(d) ?? { date: d, sent: 0, skipped: 0, failed: 0 };
      if (r.status === "Sent") g.sent++;
      else if (r.status === "Failed") g.failed++;
      else g.skipped++;
      by.set(d, g);
    }
    return Array.from(by.values()).slice(0, 6);
  })();

  const loadSettings = async () => {
    try { setSettings(await getDistrictPerformanceReportSettings()); } catch { /* screen still usable */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([getDistrictPerformanceReportSettings(), getDistrictPerformanceReportDistricts()]);
        setSettings(s);
        setDistricts(d);
        const preferred = d.find((x) => s.testDistricts.includes(x.districtNumber)) ?? d[0];
        if (preferred) setDistrictId(preferred.districtId);
      } catch (e: any) {
        setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to load districts." });
      }
    })();
  }, []);

  const selected = districts.find((d) => d.districtId === districtId);

  const view = async () => {
    if (!districtId) return;
    setViewing(true); setMsg(null);
    try {
      setReport(await getDistrictPerformanceReportView(districtId));
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to build the report." });
    } finally { setViewing(false); }
  };

  const download = () => dl.run("district-excel", async () => {
    if (!districtId) return;
    setMsg(null);
    try {
      const blob = await downloadDistrictPerformanceReportExcel(districtId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `District_${selected?.districtNumber ?? districtId}_Performance_Report_${fileTimestamp()}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg({ kind: "err", text: "Failed to download the Excel." });
    }
  });

  const sendTest = async () => {
    if (!districtId || !settings) return;
    setConfirming(false);
    setSending(true); setMsg(null);
    try {
      const r = await sendDistrictPerformanceReportTest(districtId);
      setMsg({ kind: "ok", text: r.message || "Test email sent." });
      loadSettings();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to send the test email." });
      loadSettings();
    } finally { setSending(false); }
  };

  // Prints one district's report in the email's own format (builds it first if it is not on screen).
  const printReport = async () => {
    if (!districtId) return;
    const w = openPrintWindow();
    if (!w) { setMsg({ kind: "err", text: "Allow pop-ups for this site to print the report." }); return; }
    setPrinting(true); setMsg(null);
    try {
      const r = report?.html ? report : await getDistrictPerformanceReportView(districtId);
      if (!report?.html) setReport(r);
      if (!r.html) throw new Error("The report could not be prepared for printing.");
      writePrintDoc(w, r.html, `District ${r.districtNumber} Performance Report`);
    } catch (e: any) {
      w.close();
      setMsg({ kind: "err", text: e?.response?.data?.message || e?.message || "Failed to build the report." });
    } finally { setPrinting(false); }
  };

  const list = (v?: string[]) => (v ?? []).map((x) => x.trim()).filter(Boolean).join(", ");
  const testTo = list(settings?.testRecipients);
  const liveCc = list(settings?.liveCc);
  const live = settings?.mode === "Live";
  const scheduleText = !settings
    ? ""
    : !settings.scheduleEnabled
      ? "Nothing is emailed on a schedule. Use the buttons below to check a report."
      : live
        ? `On day ${settings.liveDays.join(" and ")} of each month at ${settings.hour}:00 in the district's own time zone, each District Governor gets their district's report.`
        : `Every morning at ${settings.hour}:00 in the district's time zone, District ${settings.testDistricts.join(", ")}'s report goes to the test recipients.`;
  const lastRun = sendRuns[0];

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          back="/settings"
          title="Performance Report"
          description="Each district's progress report for its District Governor: this Rotary year, 1 July to today."
        />

        {!settings ? (
          !msg && <SkeletonRows rows={3} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel
              title="Schedule"
              className="lg:col-span-2"
              headerRight={
                <span
                  className={`shrink-0 rounded border px-3 py-1 text-[13px] font-semibold ${
                    !settings.scheduleEnabled
                      ? "border-[color:var(--row-line)] bg-muted text-foreground"
                      : live
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {!settings.scheduleEnabled ? "Off" : live ? "Live" : "Test"}
                </span>
              }
            >
              <p className="max-w-[64ch] text-[15px] text-foreground">{scheduleText}</p>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[13px] font-semibold text-muted-foreground">Copy to</dt>
                  <dd className="break-words text-[14px] text-foreground">{liveCc || "Nobody"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted-foreground">Test emails go to</dt>
                  <dd className="break-words text-[14px] text-foreground">{testTo || "Nobody. Set test recipients on the server first."}</dd>
                </div>
              </dl>
            </Panel>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <KpiTile label="Sent in the last run" value={lastRun ? lastRun.sent : "–"} note={lastRun?.date ?? "No run yet"} />
              <KpiTile
                label="Not sent"
                value={lastRun ? lastRun.skipped + lastRun.failed : "–"}
                note={lastRun ? `${lastRun.skipped} skipped, ${lastRun.failed} failed` : undefined}
              />
            </div>
          </div>
        )}

        <Panel title="One district" subtitle="Exactly as its District Governor receives it.">
          <div className="space-y-4">
            <div className="max-w-[420px] space-y-1.5">
              <Label>District</Label>
              <SearchableCombo
                value={districtId ? String(districtId) : ""}
                onChange={(v) => { setDistrictId(Number(v) || 0); setReport(null); setMsg(null); }}
                options={districts.map((d) => ({
                  value: String(d.districtId),
                  label: `${d.districtNumber}${d.zoneName ? `: ${d.zoneName}` : ""}`,
                }))}
                placeholder="Choose a district"
                searchPlaceholder="District number or zone"
                emptyText="No district matches."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={view} disabled={viewing || !districtId}>
                {viewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Eye className="mr-2 h-4 w-4" aria-hidden />}
                View report
              </Button>
              <Button variant="outline" onClick={download} disabled={dl.busy || !districtId}>
                {dl.is("district-excel") ? dl.bar("district-excel") : <><Download className="mr-2 h-4 w-4" aria-hidden />Download Excel</>}
              </Button>
              <Button variant="outline" onClick={printReport} disabled={printing || !districtId}>
                {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Printer className="mr-2 h-4 w-4" aria-hidden />}
                {printing ? "Preparing" : "Print"}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(true)} disabled={sending || !districtId || !testTo}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Mail className="mr-2 h-4 w-4" aria-hidden />}
                {sending ? "Sending" : "Send test email"}
              </Button>
            </div>
          </div>
        </Panel>

        {msg && (
          <div role={msg.kind === "ok" ? "status" : "alert"} className={`rounded-md border px-4 py-3 text-sm ${msg.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            {msg.text}
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <Card className="p-5">
              <div className="text-base font-semibold text-slate-800">District {report.districtNumber}</div>
              <div className="text-xs text-slate-500">{report.zoneName} · Rotary Year {report.yearLabel} · {report.periodLabel}</div>
              {report.governorEmail ? (
                <div className="text-sm text-slate-700 mt-2">
                  District Governor: <span className="font-medium">{report.governorName}</span> · {report.governorEmail}
                  {report.governorMobile ? ` · ${report.governorMobile}` : ""}
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  No District Governor email on record. This district would be skipped when the report goes live.
                </div>
              )}
            </Card>

            <ReportBody highlights={report.highlights} sections={report.sections} scopeNote={report.scopeNote} tilesPerRow={4} />
            <p className="text-xs text-slate-500">
              The Excel adds the full listings: District, All Clubs (every module count per club), Synced Clubs, Non-Synced Clubs,
              Goals – District, Goals – Clubs (one sheet per category), Projects Ranking, Club Monthly Report Grid and Club Websites.
            </p>
          </div>
        )}

        {settings && allRuns.length > 0 && (
          <section className="row-card row-rise overflow-hidden">
            <div className="px-6 pb-4 pt-5">
              <h2 className="row-h2">Sends to District Governors</h2>
              {/* One button per run, so "did the 1st go out?" is answered without reading the rows. */}
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by run">
                {[null, ...sendRuns].map((g) => {
                  const on = (g?.date ?? null) === runDate;
                  return (
                    <ToggleButton
                      key={g?.date ?? "all"}
                      pressed={on}
                      onClick={() => { setRunDate(g?.date ?? null); setSendPage(1); }}
                    >
                      {g ? (
                        <>
                          <span className="font-semibold">{g.date}</span>: {g.sent} sent, {g.skipped} skipped{g.failed > 0 ? `, ${g.failed} failed` : ""}
                        </>
                      ) : (
                        <span className="font-semibold">All runs</span>
                      )}
                    </ToggleButton>
                  );
                })}
              </div>
            </div>

            <div className={rowTable.wrap}>
              <Table className={`${rowTable.table} w-full min-w-[720px]`}>
                <TableHeader className={rowTable.head}>
                  <TableRow>
                    <TableHead className={rowTable.th}>District</TableHead>
                    <TableHead className={rowTable.th}>Result</TableHead>
                    <TableHead className={rowTable.th}>Sent to</TableHead>
                    <TableHead className={rowTable.th}>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={rowTable.body}>
                  {sendPageRows.map((r) => (
                    <TableRow key={r.id} className={rowTable.tr}>
                      <TableCell className={`${rowTable.td} font-semibold`}>{r.districtNumber ?? "–"}</TableCell>
                      <TableCell className={rowTable.td}>
                        <span
                          className={`inline-flex rounded border px-2.5 py-0.5 text-[12px] font-semibold ${
                            r.status === "Sent"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : r.status === "Failed"
                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.status !== "Sent" && r.message && <span className="ml-2 text-[13px] text-muted-foreground">{r.message}</span>}
                      </TableCell>
                      <TableCell className={rowTable.tdMuted}>
                        {r.toEmail ?? "–"}
                        {r.ccEmails ? `, copy to ${r.ccEmails}` : ""}
                      </TableCell>
                      <TableCell className={`${rowTable.tdMuted} whitespace-nowrap`}>
                        {new Date(r.createdDate).toLocaleString(appLocale(), { dateStyle: "medium", timeStyle: "short" })}
                        {r.runType === "ScheduledLive" ? "" : r.runType === "ScheduledTest" ? " (test run)" : ` (${r.runType})`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {sendPageCount > 1 && (
              <div className="border-t border-[color:var(--row-line)] px-6 py-3"><Pagination page={sendPage} totalPages={sendPageCount} totalCount={sendRows.length} pageSize={SEND_PAGE_SIZE} onPageChange={setSendPage} /></div>
            )}
          </section>
        )}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send a test email?</AlertDialogTitle>
              <AlertDialogDescription>
                District {selected?.districtNumber ?? ""}&apos;s report goes to {testTo}. The District Governor does not get it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={sendTest}>Send test email</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ProtectedRoute>
  );
}
