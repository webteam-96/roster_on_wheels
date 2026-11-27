"use client";
import { DataTable } from "@/components/ui/data-table";

/**
 * District Admin Dashboard › Service Hours (flagged module "service_hours"): approved service hours, volunteer sheet
 * hours and contributions per club for a Rotary year, with an Excel export. Clubs approve their members' entries.
 */

import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
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
    <div className="space-y-6">
      <PageHeader
        title="Service Hours"
        description="Hours members logged and their clubs approved, hours recorded on volunteer sheets, and cash and in-kind contributions, per club."
        actions={report && (
          <div className="flex items-center gap-2">
            <Label htmlFor="dsh-year" className="text-sm">Rotary year</Label>
            <NativeSelect id="dsh-year" className="w-auto" value={report.yearId}
              onChange={(e) => setYearId(Number(e.target.value))}>
              {report.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </NativeSelect>
            <Button variant="outline" onClick={download} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </Button>
          </div>
        )}
      />

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
            <DataTable
              caption="Service hours by club"
              rows={report.byClub}
              rowKey={(c) => c.clubId}
              className="[&_table]:min-w-[760px]"
              columns={[
                { key: "club", header: "Club", className: "font-medium", cell: (c) => c.clubName },
                { key: "hours", header: "Logged hours", align: "right", className: "tabular-nums", cell: (c) => fmt.number(c.hours) },
                { key: "volunteer", header: "Volunteer sheet hours", align: "right", className: "tabular-nums", cell: (c) => fmt.number(c.volunteerHours) },
                { key: "members", header: "Members", align: "right", className: "tabular-nums", cell: (c) => fmt.number(c.members) },
                { key: "cash", header: "Cash", cell: (c) => money(c.cash) },
                { key: "inKind", header: "In kind", cell: (c) => money(c.inKind) },
              ]}
            />
          )}
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
