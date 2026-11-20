"use client";

/**
 * District Admin Dashboard › Service Hours (flagged module "service_hours"): approved service hours, volunteer sheet
 * hours and contributions per club for a Rotary year, with an Excel export. Clubs approve their members' entries.
 */

import { useEffect, useState } from "react";
import { Download, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { moneyLine, reportFileName, saveBlob } from "@/lib/serviceHours";
import { exportServiceReport, getDistrictServiceReport } from "@/services/api";
import type { ServiceReport } from "@/types/serviceHours";

const TH = "p-3 font-medium";
const message = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function DistrictServiceHoursPage() {
  const { selectedDistrictId: districtId } = useAuth();
  const fmt = useFormat();
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [yearId, setYearId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!districtId) return;
    setReport(null);
    setFailed(false);
    getDistrictServiceReport(districtId, yearId)
      .then(setReport)
      .catch((err) => { setFailed(true); setError(message(err, "Could not load the service report.")); });
  }, [districtId, yearId]);

  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  const money = (list: ServiceReport["totals"]["cash"]) => moneyLine(list, (a, c) => fmt.money(a, c));

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      saveBlob(await exportServiceReport("districts", districtId, report.yearId), reportFileName(report.scopeName, report.yearLabel));
    } catch (err) {
      setError(message(err, "Could not download the report."));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Service Hours</h2>
          <p className="text-base text-muted-foreground">
            Hours members logged and their clubs approved, hours recorded on volunteer sheets, and cash and in-kind
            contributions, per club.
          </p>
        </div>
        {report && (
          <div className="flex items-center gap-2">
            <Label htmlFor="dsh-year" className="text-sm">Rotary year</Label>
            <select id="dsh-year" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={report.yearId}
              onChange={(e) => setYearId(Number(e.target.value))}>
              {report.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
            <Button variant="outline" className="gap-1.5" onClick={download} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </Button>
          </div>
        )}
      </div>

      {!report ? (
        failed
          ? <Card><CardContent className="p-5 text-sm text-muted-foreground">The report could not be loaded. Reload the page to try again.</CardContent></Card>
          : <div aria-busy="true"><TableSkeleton rows={6} /></div>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div><dt className="text-muted-foreground">Approved hours</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(report.totals.hours)}</dd></div>
            <div><dt className="text-muted-foreground">Volunteer sheet hours</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(report.totals.volunteerHours)}</dd></div>
            <div><dt className="text-muted-foreground">Members who served</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(report.totals.members)}</dd></div>
            <div><dt className="text-muted-foreground">Waiting for club review</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(report.totals.pendingEntries)}</dd></div>
            <div><dt className="text-muted-foreground">Cash</dt><dd className="text-xl font-semibold">{money(report.totals.cash) || "None"}</dd></div>
            <div><dt className="text-muted-foreground">In kind</dt><dd className="text-xl font-semibold">{money(report.totals.inKind) || "None"}</dd></div>
          </dl>
          {report.byClub.length === 0 ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">No club has approved service hours or contributions in {report.yearLabel} yet.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr className="border-b text-left">
                      <th className={TH}>Club</th>
                      <th className={`${TH} text-right`}>Logged hours</th>
                      <th className={`${TH} text-right`}>Volunteer sheet hours</th>
                      <th className={`${TH} text-right`}>Members</th>
                      <th className={TH}>Cash</th>
                      <th className={TH}>In kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byClub.map((c) => (
                      <tr key={c.clubId} className="border-b last:border-0">
                        <td className="p-3 font-medium">{c.clubName}</td>
                        <td className="p-3 text-right tabular-nums">{fmt.number(c.hours)}</td>
                        <td className="p-3 text-right tabular-nums">{fmt.number(c.volunteerHours)}</td>
                        <td className="p-3 text-right tabular-nums">{fmt.number(c.members)}</td>
                        <td className="p-3">{money(c.cash)}</td>
                        <td className="p-3">{money(c.inKind)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
