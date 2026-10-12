"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, Download, Loader2, Mail, RefreshCw } from "lucide-react";
import {
  getDailyStatsReportCounts,
  downloadDailyStatsReportExcel,
  sendDailyStatsReportNow,
  type DailyStatsBreakdown,
} from "@/services/api";

// SuperAdmin test/trigger page for the daily statistics report. Preview the counts, download the
// Excel, or send the email now. On a dev machine the "Send" is suppressed server-side (logs only);
// Preview + Download work everywhere for local testing before going live.
export default function DailyStatsReportPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<{ metric: string; count: number }[] | null>(null);
  const [breakdowns, setBreakdowns] = useState<DailyStatsBreakdown[]>([]);
  const [subject, setSubject] = useState<string>("");
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadCounts = async () => {
    setLoadingCounts(true); setMsg(null);
    try {
      const r = await getDailyStatsReportCounts();
      setCounts(r.counts || []);
      setBreakdowns(r.breakdowns || []);
      setSubject(r.subject || "");
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to load counts." });
    } finally { setLoadingCounts(false); }
  };

  const downloadExcel = async () => {
    setDownloading(true); setMsg(null);
    try {
      const blob = await downloadDailyStatsReportExcel();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ROW_Daily_Stats_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to download Excel." });
    } finally { setDownloading(false); }
  };

  const sendNow = async () => {
    if (!confirm("Send the daily statistics email now to the configured recipients?\n(On a dev machine no real email is sent — it only logs the counts.)")) return;
    setSending(true); setMsg(null);
    try {
      const r = await sendDailyStatsReportNow();
      setMsg({ kind: "ok", text: r.message || "Triggered." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "Failed to send." });
    } finally { setSending(false); }
  };

  return (
    <ProtectedRoute>
      <div className="max-w-3xl mx-auto p-6 space-y-5">
        <button onClick={() => router.push("/settings")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </button>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Daily Statistics Report</h1>
            <p className="text-xs text-slate-500">Auto-emailed daily at 6:00 AM IST to the configured recipients. Test it here first.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadCounts} disabled={loadingCounts}>
            {loadingCounts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Preview Counts
          </Button>
          <Button variant="outline" onClick={downloadExcel} disabled={downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Excel
          </Button>
          <Button onClick={sendNow} disabled={sending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Send Email Now
          </Button>
        </div>

        {msg && (
          <div className={`text-sm rounded-md px-3 py-2 border ${msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
            {msg.text}
          </div>
        )}

        {counts && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-medium text-slate-700">{subject || "Counts"}</div>
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {counts.map((c, i) => (
                  <tr key={i} className={i % 2 ? "bg-slate-50/50" : ""}>
                    <td className="px-4 py-2 text-slate-700">{c.metric}</td>
                    <td className="px-4 py-2 text-right font-semibold text-slate-900 tabular-nums">{Number(c.count).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {breakdowns.map((b, bi) => (
          <div key={bi} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-medium text-slate-700">{b.title} — by Avenue</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="px-4 py-2 text-left font-medium">Avenue</th>
                    <th className="px-4 py-2 text-right font-medium">One-Time</th>
                    <th className="px-4 py-2 text-right font-medium">Ongoing</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.rows.map((r, i) => (
                    <tr key={i} className={i % 2 ? "bg-slate-50/50" : ""}>
                      <td className="px-4 py-2 text-slate-700">{r.avenue}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{Number(r.oneTime).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{Number(r.ongoing).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">{Number(r.total).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold text-slate-900">
                    <td className="px-4 py-2">TOTAL</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.rows.reduce((s, r) => s + Number(r.oneTime), 0).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.rows.reduce((s, r) => s + Number(r.ongoing), 0).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.rows.reduce((s, r) => s + Number(r.total), 0).toLocaleString("en-IN")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </ProtectedRoute>
  );
}
