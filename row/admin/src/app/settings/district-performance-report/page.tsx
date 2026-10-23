"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, Download, Eye, FileBarChart, Loader2, Mail, Printer } from "@/components/icons";
import { fileTimestamp } from "@/lib/dateUtils";
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

import { appLocale, appTimeZone } from "@/lib/appFormat";
const PCT_HEADER = "Percentage Achieved";

// Text columns align left, numbers right: the first column, plus the club name in "#"-ranked tables.
const isTextCol = (headers: string[] | null | undefined, i: number) =>
  i === 0 || (i === 1 && !!headers && headers[0] === "#");

// Same progress colours as the email: under 30% red, under 60% amber, otherwise green.
const ragColor = (pct: number) => (pct < 30 ? "#dc2626" : pct < 60 ? "#e59a10" : "#16a34a");

// RAG Analysis band rows ("RED (10 – 25)") in their own colour.
const bandColor = (text: string) =>
  text.startsWith("RED") ? "#dc2626" : text.startsWith("AMBER") ? "#e59a10" : text.startsWith("GREEN") ? "#16a34a" : null;

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
                        <div key={hi} className={`bg-white rounded-xl border border-slate-200 p-3 ${h.newRow ? "md:col-start-1" : ""}`}>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 whitespace-nowrap">{h.label}</div>
                          <div className="text-2xl font-bold tabular-nums" style={{ color: h.percent != null ? ragColor(h.percent) : "#17458f" }}>{h.value}</div>
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
                <div className="rounded-xl bg-azure px-4 py-3 mt-2">
                  <div className="text-[10px] uppercase tracking-widest text-blue-200">Part {pi + 1}</div>
                  <div className="text-lg font-bold text-white">{part}</div>
                  {partSections[0]?.partSubtitle && <div className="text-xs text-slate-300">{partSections[0].partSubtitle}</div>}
                </div>
              )}
            <div className="grid gap-4 md:grid-cols-2">
              {partSections.map((s, si) => {
                const wide = !!s.tableRows && s.tableRows.length > 0 && (s.tableHeaders?.length ?? 0) > 3;
                return (
                  <div key={si} className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${wide ? "md:col-span-2" : ""}`}>
                    <div className="px-4 py-2.5 bg-azure text-white text-sm font-medium">{s.title}</div>
                    {s.intro && <div className="px-4 py-2 text-xs italic text-slate-700 border-b border-slate-100">{s.intro}</div>}
                    {s.items.length > 0 && (
                      <table className="w-full table-fixed text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {s.items.map((it, i) => {
                            // A leading space in the label marks a sub-row (e.g. "   Banners") — indent it.
                            const sub = it.label.startsWith(" ");
                            return (
                              <tr key={i} className={i % 2 ? "bg-slate-50/50" : ""}>
                                <td className={`py-2 pr-2 w-3/5 ${sub ? "pl-8 text-slate-500" : "pl-4 text-slate-700"}`}>{it.label.trim()}</td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-900 tabular-nums [overflow-wrap:anywhere]">
                                  {it.url ? (
                                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900">{it.value}</a>
                                  ) : it.value}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {s.tableHeaders && s.tableRows && s.tableRows.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50 text-slate-600">
                              {s.tableHeaders.map((h, hi) => (
                                <th key={hi} className={`px-3 py-2 font-medium ${isTextCol(s.tableHeaders, hi) ? "text-left" : "text-right"}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {s.tableRows.map((row, ri) => (
                              <tr key={ri} className={ri % 2 ? "bg-slate-50/50" : ""}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className={`px-3 py-1.5 ${isTextCol(s.tableHeaders, ci) ? "text-left text-slate-700" : "text-right tabular-nums text-slate-900"} whitespace-pre-line`}>
                                    {isPctCol(s.tableHeaders?.[ci]) && !Number.isNaN(parseFloat(cell))
                                      ? <span className="font-semibold" style={{ color: ragColor(parseFloat(cell)) }}>{cell}</span>
                                      : ci === 0 && bandColor(cell)
                                        ? <span className="font-semibold" style={{ color: bandColor(cell)! }}>{cell}</span>
                                        : cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
  const router = useRouter();
  const [settings, setSettings] = useState<PerformanceReportSettings | null>(null);
  const [districts, setDistricts] = useState<PerformanceReportDistrictOption[]>([]);
  const [districtId, setDistrictId] = useState<number>(0);
  const [report, setReport] = useState<DistrictPerformanceReportView | null>(null);
  const [viewing, setViewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── Sent list (user 2026-09-29) ───────────────────────────────────────────────────────────────
  // The run log of the per-district DG mails. A live run writes one row per district, so
  // it is paged and summarised per run date.
  const SEND_PAGE_SIZE = 20;
  const [sendPage, setSendPage] = useState(1);

  const sendRows = settings?.recentRuns ?? [];
  const sendPageCount = Math.max(1, Math.ceil(sendRows.length / SEND_PAGE_SIZE));
  const sendStart = (sendPage - 1) * SEND_PAGE_SIZE;
  const sendPageRows = sendRows.slice(sendStart, sendStart + SEND_PAGE_SIZE);
  const sendRuns = (() => {
    const by = new Map<string, { date: string; sent: number; skipped: number; failed: number }>();
    for (const r of sendRows) {
      const d = new Date(r.createdDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
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

  const download = async () => {
    if (!districtId) return;
    setDownloading(true); setMsg(null);
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
    } finally { setDownloading(false); }
  };

  const sendTest = async () => {
    if (!districtId || !settings) return;
    const to = settings.testRecipients.join(", ");
    if (!confirm(`Send a TEST email of District ${selected?.districtNumber ?? ""}'s report to:\n\n${to}\n\nIt is NOT sent to the District Governor.`)) return;
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

  const scheduleText = !settings ? "" : !settings.scheduleEnabled
    ? "Automatic sending is OFF. Nothing is emailed on a schedule. Use the buttons below to check the report."
    : settings.mode === "Live"
      ? `LIVE: on day ${settings.liveDays.join(" & ")} of each month at ${settings.hour}:00 (${appTimeZone()}), every district's report goes to its District Governor (CC ${settings.liveCc.join(", ")}).`
      : `TEST: every morning at ${settings.hour}:00 (${appTimeZone()}): District ${settings.testDistricts.join(", ")} report to ${settings.testRecipients.join(", ")}.`;

  return (
    <ProtectedRoute>
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <button onClick={() => router.push("/settings")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </button>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileBarChart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Performance Report</h1>
            <p className="text-xs text-slate-500">District Governor progress report: current Rotary year, 1 July to today.</p>
          </div>
        </div>

        {settings && (
          <div className={`text-sm rounded-md px-3 py-2 border ${settings.scheduleEnabled ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-slate-50 border-slate-200 text-slate-700"}`}>
            {scheduleText}
            <div className="text-xs mt-1 text-slate-500">Test emails go to: {settings.testRecipients.join(", ")}</div>
          </div>
        )}

          <div className="space-y-5">
          <p className="text-xs text-slate-500">One district&apos;s report, exactly as its District Governor receives it.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label className="text-xs text-slate-500 mb-1">District</label>
            <select
              value={districtId || ""}
              onChange={(e) => { setDistrictId(Number(e.target.value)); setReport(null); setMsg(null); }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[220px]"
            >
              {districts.map((d) => (
                <option key={d.districtId} value={d.districtId}>
                  {d.districtNumber}{d.zoneName ? `: ${d.zoneName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={view} disabled={viewing || !districtId}>
            {viewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            View Report
          </Button>
          <Button variant="outline" onClick={download} disabled={downloading || !districtId}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {downloading ? "Preparing Excel…" : "Download Excel"}
          </Button>
          <Button onClick={sendTest} disabled={sending || !districtId || !settings} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {sending ? "Sending…" : "Send Test Email"}
          </Button>
          <Button variant="outline" onClick={printReport} disabled={printing || !districtId} title="Prints the report in the same format as the email">
            {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            {printing ? "Preparing…" : "Print Report"}
          </Button>
        </div>

        {msg && (
          <div className={`text-sm rounded-md px-3 py-2 border ${msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
            {msg.text}
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
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
            </div>

            <ReportBody highlights={report.highlights} sections={report.sections} scopeNote={report.scopeNote} tilesPerRow={4} />
            <p className="text-xs text-slate-500">
              The Excel adds the full listings: District, All Clubs (every module count per club), Synced Clubs, Non-Synced Clubs,
              Goals – District, Goals – Clubs (one sheet per category), Projects Ranking, Club Monthly Report Grid and Club Websites.
            </p>
          </div>
        )}
          </div>

        {settings && sendRows.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">
                Sends to District Governors
              </span>
              <span className="text-xs text-slate-400">the 1st and the 16th of each month</span>
            </div>

            {/* One line per run date, so "did the 1st go out?" is answered without reading the rows. */}
            <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-2">
              {sendRuns.map((g) => (
                <span key={g.date} className="inline-flex items-center gap-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  <span className="font-medium text-slate-700">{g.date}</span>
                  <span className="text-emerald-700">{g.sent} sent</span>
                  {g.skipped > 0 && <span className="text-amber-700">· {g.skipped} skipped</span>}
                  {g.failed > 0 && <span className="text-rose-700">· {g.failed} failed</span>}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left font-medium">When</th>
                    <th className="px-3 py-2 text-left font-medium">District</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">To</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sendPageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{new Date(r.createdDate).toLocaleString(appLocale())}</td>
                      <td className="px-3 py-1.5 text-slate-700">{r.districtNumber ?? "–"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.runType}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.toEmail ?? "–"}{r.ccEmails ? ` (cc ${r.ccEmails})` : ""}</td>
                      <td className={`px-3 py-1.5 font-medium ${r.status === "Sent" ? "text-emerald-700" : r.status === "Failed" ? "text-rose-700" : "text-amber-700"}`} title={r.message ?? ""}>
                        {r.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sendPageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100">
                <span className="text-xs text-slate-500">
                  Showing {sendStart + 1}–{Math.min(sendStart + SEND_PAGE_SIZE, sendRows.length)} of {sendRows.length}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={sendPage === 1} onClick={() => setSendPage(1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">First</button>
                  <button type="button" disabled={sendPage === 1} onClick={() => setSendPage((x) => x - 1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Previous</button>
                  <span className="text-xs text-slate-500 px-1">Page {sendPage} of {sendPageCount}</span>
                  <button type="button" disabled={sendPage === sendPageCount} onClick={() => setSendPage((x) => x + 1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
                  <button type="button" disabled={sendPage === sendPageCount} onClick={() => setSendPage(sendPageCount)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Last</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
