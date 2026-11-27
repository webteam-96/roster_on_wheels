"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { useCallback, useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorState, KpiTile, PageHeader, Panel, rowTable } from "@/components/row/AppKit";
import { KpiTileSkeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { Download, Loader2, Mail, RefreshCw } from "@/components/icons";
import {
  getDailyStatsReportCounts,
  downloadDailyStatsReportExcel,
  sendDailyStatsReportNow,
  type DailyStatsBreakdown,
} from "@/services/api";
import { useDownloadProgress } from "@/lib/downloadProgress";
import { appLocale, appTimeZone, todayLocal } from "@/lib/appFormat";
import { groupStats, type Metric, type StatGroup } from "./groupStats";

// isProject comes with the rows: Club Service is the clubs' meetings, so it stays outside the project total.
type AvenueRow = DailyStatsBreakdown["rows"][number] & { isProject?: boolean };
type Report = { subject: string; metrics: Metric[]; breakdowns: DailyStatsBreakdown[]; at: Date };

const num = (v: number) => Number(v).toLocaleString(appLocale());

export default function DailyStatsReportPage() {
  return (
    <ProtectedRoute requireSuperAdmin>
      <DailyStatsReport />
    </ProtectedRoute>
  );
}

/** The figures of the daily statistics email, with the email's own actions. */
function DailyStatsReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const dl = useDownloadProgress(); // progress inside the clicked button

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await getDailyStatsReportCounts();
      setReport({ subject: r.subject || "", metrics: r.counts || [], breakdowns: r.breakdowns || [], at: new Date() });
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || "Could not load the figures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const downloadExcel = () =>
    dl.run("daily-stats-excel", async () => {
      setMsg(null);
      try {
        const blob = await downloadDailyStatsReportExcel();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ROW_Daily_Stats_${todayLocal()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e: any) {
        setMsg({ kind: "err", text: e?.response?.data?.message || "Could not download the Excel file." });
      }
    });

  const sendNow = async () => {
    setConfirming(false);
    setSending(true);
    setMsg(null);
    try {
      const r = await sendDailyStatsReportNow();
      setMsg({ kind: "ok", text: r.message || "The report was sent." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.response?.data?.message || "The report was not sent." });
    } finally {
      setSending(false);
    }
  };

  const stats = report && groupStats(report.metrics);

  return (
    <div className="space-y-6">
      <PageHeader
        back="/settings"
        title="Daily Statistics Report"
        description={`Emailed every day at 6:00 AM (${appTimeZone()}) to the configured recipients.`}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              )}
              Refresh
            </Button>
            <Button variant="outline" onClick={downloadExcel} disabled={dl.busy}>
              {dl.is("daily-stats-excel") ? (
                dl.bar("daily-stats-excel")
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Download Excel
                </>
              )}
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={sending}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Mail className="mr-2 h-4 w-4" aria-hidden />
              )}
              Send Email Now
            </Button>
          </>
        }
      />

      {msg && (
        <div
          role={msg.kind === "ok" ? "status" : "alert"}
          className={`rounded-md border px-4 py-3 text-sm ${
            msg.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Figures already on screen stay there while new ones load, or if they cannot be loaded. */}
      {loadError && <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />}

      {stats ? (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <p className="text-[13px] text-muted-foreground">
            Updated {report.at.toLocaleString(appLocale(), { dateStyle: "medium", timeStyle: "short" })}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.headline.map((m) => (
              <KpiTile key={m.label} label={m.label} value={num(m.count)} note={m.note} />
            ))}
          </div>

          {/* The first panel is the long one: the short ones stack beside it. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {stats.groups.map((g, i) => (
              <StatPanel key={g.title} group={g} className={i === 0 ? "lg:row-span-2 lg:self-stretch" : ""} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {report.breakdowns.map((b) => (
              <AvenueTable key={b.title} breakdown={b} />
            ))}
          </div>
        </div>
      ) : (
        loading && (
          <div className="space-y-6" aria-busy="true">
            <span className="sr-only" role="status">
              Loading
            </span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <KpiTileSkeleton key={i} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <TableSkeleton key={i} rows={4} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <TableSkeleton rows={7} />
              <TableSkeleton rows={7} />
            </div>
          </div>
        )
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send the report now?</AlertDialogTitle>
            <AlertDialogDescription>
              The daily statistics email, with the Excel file, goes to the configured recipients straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={sendNow}>Send email</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatPanel({ group, className }: { group: StatGroup; className: string }) {
  return (
    <Panel title={group.title} className={className}>
      <dl className="divide-y divide-[color:var(--row-line)]">
        {group.rows.map((m) => (
          <div key={m.label} className={`flex items-baseline justify-between gap-4 py-2.5 ${m.total ? "font-semibold" : ""}`}>
            <dt className={`text-[14px] ${m.total ? "text-foreground" : "text-muted-foreground"}`}>{m.label}</dt>
            <dd className="shrink-0 text-[15px] font-semibold tabular-nums text-foreground">{num(m.count)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function AvenueTable({ breakdown }: { breakdown: DailyStatsBreakdown }) {
  const rows = breakdown.rows as AvenueRow[];
  const projects = rows.filter((r) => r.isProject !== false);
  const meetings = rows.filter((r) => r.isProject === false);
  const sum = (k: "oneTime" | "ongoing" | "total") => projects.reduce((s, r) => s + Number(r[k]), 0);
  const cells = (r: { oneTime: number; ongoing: number; total: number }) => (
    <>
      <td className={`${rowTable.td} text-right tabular-nums`}>{num(r.oneTime)}</td>
      <td className={`${rowTable.td} text-right tabular-nums`}>{num(r.ongoing)}</td>
      <td className={`${rowTable.td} text-right font-semibold tabular-nums`}>{num(r.total)}</td>
    </>
  );
  return (
    <section className="row-card row-rise overflow-hidden">
      <h2 className="row-h2 px-6 pb-3 pt-5">
        {breakdown.title}: by avenue
      </h2>
      <div className={rowTable.wrap}>
        <Table className={`${rowTable.table} w-full`}>
          <TableHeader className={rowTable.head}>
            <TableRow>
              <TableHead className={rowTable.th}>Avenue</TableHead>
              <TableHead className={`${rowTable.th} whitespace-nowrap text-right`}>One-time</TableHead>
              <TableHead className={`${rowTable.th} text-right`}>Ongoing</TableHead>
              <TableHead className={`${rowTable.th} text-right`}>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={rowTable.body}>
            {projects.map((r) => (
              <TableRow key={r.avenue} className={rowTable.tr}>
                <TableCell className={rowTable.td}>{r.avenue}</TableCell>
                {cells(r)}
              </TableRow>
            ))}
            <TableRow className="h-[52px] bg-muted font-semibold">
              <TableCell className={rowTable.td}>Total projects</TableCell>
              {cells({ oneTime: sum("oneTime"), ongoing: sum("ongoing"), total: sum("total") })}
            </TableRow>
            {meetings.map((r) => (
              <TableRow key={r.avenue} className={rowTable.tr}>
                <TableCell className={rowTable.tdMuted}>{r.avenue} (meetings)</TableCell>
                {cells(r)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
