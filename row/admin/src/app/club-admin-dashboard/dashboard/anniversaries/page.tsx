"use client";

/**
 * Club Dashboard › Anniversaries: years of service, joining anniversaries and milestones (every fifth year plus the
 * district's engagement milestone years), birthdays and wedding anniversaries for a month. Printable and exportable
 * as CSV (the API builds the CSV). Data: GET api/clubs/{clubId}/anniversaries.
 */

import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "@/components/icons";
import KpiCard from "@/components/dashboard/KpiCard";
import { KpiTileSkeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate, fmtInt } from "@/components/dashboard/formatters";
import { apiMessage, selectCls } from "@/components/membership/FoundationDesignationsCard";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useSelectedClub } from "@/contexts/AuthContext";
import { downloadAnniversaryCsv, getAnniversaryReport, type AnniversaryReport, type AnniversaryRow } from "@/services/api";

type View = "month" | "all";

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString(undefined, { month: "long" });

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function ClubAnniversariesPage() {
  const club = useSelectedClub();
  const [period, setPeriod] = useState<{ year: number; month: number } | null>(null);
  const [report, setReport] = useState<AnniversaryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("month");
  const [busy, setBusy] = useState(false);
  const clubId = club?.id ?? 0;

  useEffect(() => {
    if (!(clubId > 0)) return;
    let live = true;
    setReport(null);
    setError(null);
    getAnniversaryReport(clubId, period?.year, period?.month)
      .then((r) => {
        if (!live) return;
        setReport(r);
        if (!period) setPeriod({ year: r.year, month: r.month });
      })
      .catch((err) => live && setError(apiMessage(err, "Could not load the anniversaries report.")));
    return () => {
      live = false;
    };
    // period starts null: the API picks this month in the club's time zone
  }, [clubId, period]);

  const rows = useMemo<AnniversaryRow[]>(() => {
    if (!report) return [];
    if (view === "all") return report.members;
    return report.members.filter((r) => r.joinAnniversaryDay || r.birthdayDay || r.weddingAnniversaryDay);
  }, [report, view]);

  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;

  const years = report ? Array.from({ length: 6 }, (_, i) => Number(report.today.slice(0, 4)) + 1 - i) : [];

  const exportCsv = async () => {
    if (!report) return;
    setBusy(true);
    setError(null);
    try {
      const url = URL.createObjectURL(await downloadAnniversaryCsv(clubId, report.year, report.month));
      const link = document.createElement("a");
      link.href = url;
      link.download = `anniversaries-${report.year}-${String(report.month).padStart(2, "0")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiMessage(err, "Could not export the report."));
    } finally {
      setBusy(false);
    }
  };

  // A clean printable page of the rows on screen, without the dashboard around it.
  const print = () => {
    if (!report) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      setError("Allow pop-ups for this site to print the report.");
      return;
    }
    const title = `${report.clubName}: anniversaries, ${monthName(report.month)} ${report.year}`;
    const body = rows.map((r) => `<TableRow><TableCell>${esc(r.memberName)}</TableCell><TableCell>${esc(fmtDate(r.joinedDate))}</TableCell><TableCell>${r.yearsOfService ?? ""}</TableCell>`
      + `<TableCell>${r.joinAnniversaryDay ? `${r.joinAnniversaryDay} (${r.anniversaryYears} yrs)` : ""}</TableCell><TableCell>${r.milestone ? "Milestone" : ""}</TableCell>`
      + `<TableCell>${r.birthdayDay ?? ""}</TableCell><TableCell>${r.weddingAnniversaryDay ?? ""}</TableCell></TableRow>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:Georgia,serif;margin:24px;color:rgb(31 41 55)}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid rgb(209 213 219);padding:4px 6px;text-align:left}th{background:rgb(243 244 246)}</style></head><body>
      <h1>${esc(title)}</h1><Table><TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Joined</TableHead><TableHead>Years of service</TableHead><TableHead>Joining anniversary</TableHead>
      <TableHead>Milestone</TableHead><TableHead>Birthday</TableHead><TableHead>Wedding anniversary</TableHead></TableRow></TableHeader><TableBody>${body}</TableBody></Table></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-40 space-y-1 text-xs font-semibold text-slate-700">
          <span>Month</span>
          <select className={selectCls} value={period?.month ?? ""} disabled={!period}
            onChange={(e) => period && setPeriod({ ...period, month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
          </select>
        </label>
        <label className="w-32 space-y-1 text-xs font-semibold text-slate-700">
          <span>Year</span>
          <select className={selectCls} value={period?.year ?? ""} disabled={!period}
            onChange={(e) => period && setPeriod({ ...period, year: Number(e.target.value) })}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="w-56 space-y-1 text-xs font-semibold text-slate-700">
          <span>Show</span>
          <select className={selectCls} value={view} onChange={(e) => setView(e.target.value as View)}>
            <option value="month">Occasions this month</option>
            <option value="all">All members (years of service)</option>
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" disabled={!report || busy} onClick={print}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button type="button" variant="outline" disabled={!report || busy} onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}

      {!report ? (
        !error && (
          <div className="space-y-4" aria-busy="true">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} />)}</div>
            <TableSkeleton rows={6} />
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard title="Milestones" value={fmtInt(report.counts.milestones)} subtitle="5, 10, 15... years" color="gold" />
            <KpiCard title="Joining anniversaries" value={fmtInt(report.counts.joiningAnniversaries)} color="blue" />
            <KpiCard title="Birthdays" value={fmtInt(report.counts.birthdays)} color="green" />
            <KpiCard title="Wedding anniversaries" value={fmtInt(report.counts.weddingAnniversaries)} color="teal" />
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Years of service</TableHead>
                  <TableHead>Joining anniversary</TableHead>
                  <TableHead>Birthday</TableHead>
                  <TableHead>Wedding anniversary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.memberId}>
                    <TableCell className="font-medium text-slate-800">{r.memberName}</TableCell>
                    <TableCell className="text-slate-600">{fmtDate(r.joinedDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.yearsOfService ?? "–"}</TableCell>
                    <TableCell>
                      {r.joinAnniversaryDay ? (
                        <span>
                          {r.joinAnniversaryDay} {monthName(report.month)}: {r.anniversaryYears} years
                          {r.milestone && <span className="ml-2 rounded border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-800">Milestone</span>}
                        </span>
                      ) : "–"}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.birthdayDay ? `${r.birthdayDay} ${monthName(report.month)}` : "–"}</TableCell>
                    <TableCell className="text-slate-600">{r.weddingAnniversaryDay ? `${r.weddingAnniversaryDay} ${monthName(report.month)}` : "–"}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      {view === "month"
                        ? `No joining anniversaries, birthdays or wedding anniversaries in ${monthName(report.month)}.`
                        : "The club has no active members."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
