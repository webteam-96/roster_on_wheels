"use client";

// Live target dashboard (spec B.3 #30, feature target_dashboard): target against actual per club and in total for the
// Rotary year, with Assistant Governor group and status filters and a drill-in per club. The API decides which clubs
// this viewer sees (district managers: all; an AG: their group; a club admin: their club).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDistrictTargets, type TargetDashboardData } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { METRICS, STATUS, TARGETS_FEATURE, filterClubs, formatMetric } from "@/lib/targets";
import { ClubTargetCard, MetricGrid, StatusChip, TargetsNote, errorText } from "./ClubTargets";

// Meetings are part of the attendance figure in the table; the drill-in shows them on their own.
const COLUMNS = METRICS.filter((m) => m.key !== "meetings");
const panel = "rounded-xl border border-slate-200 bg-white p-5";

export default function TargetDashboard({ districtId, yearId, clubPageHref }: {
  districtId: number | null;
  yearId: number | null;
  clubPageHref?: (clubId: number) => string;
}) {
  const on = useFeatureOn(TARGETS_FEATURE);
  const [data, setData] = useState<TargetDashboardData | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [openClub, setOpenClub] = useState<number | null>(null);

  useEffect(() => {
    if (!on || !districtId) return;
    setData(undefined);
    setError(null);
    setOpenClub(null);
    getDistrictTargets(districtId, yearId).then(setData).catch((e) => setError(errorText(e)));
  }, [on, districtId, yearId]);

  const rows = useMemo(() => (data ? filterClubs(data.clubs, { group, status, search }) : []), [data, group, status, search]);

  if (!on) return null;
  if (!districtId) return <p className={`${panel} text-sm text-slate-600`}>Select a district first.</p>;
  if (error) return <p className={`${panel} text-sm text-slate-600`}>{error}</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <div className={`space-y-3 ${panel}`}>
          <Skeleton className="h-4 w-64" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{METRICS.map((m) => <Skeleton key={m.key} className="h-20" />)}</div>
        </div>
        <div className={`space-y-2 ${panel}`}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      </div>
    );
  }

  const club = openClub === null ? undefined : data.clubs.find((c) => c.clubId === openClub);
  return (
    <div className="space-y-4">
      <section className={panel}>
        <div className="mb-4 space-y-1">
          <h2 className="text-base font-semibold text-slate-800">
            {data.wholeDistrict ? "District total" : data.clubs.length === 1 ? "Your club" : "Your clubs together"}, RY {data.yearLabel}
          </h2>
          <TargetsNote elapsed={data.yearElapsedPercent} />
          {data.wholeDistrict && (
            <p className="text-xs text-slate-500">
              Totals use the district&apos;s own goal where Goal Setting has one, otherwise the sum of the club targets.
            </p>
          )}
        </div>
        <MetricGrid metrics={data.totals} />
      </section>

      {club ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setOpenClub(null)}>Back to all clubs</Button>
            {clubPageHref && <Link href={clubPageHref(club.clubId)} className="text-sm text-azure hover:underline">Open the club page</Link>}
          </div>
          <ClubTargetCard row={club} yearLabel={data.yearLabel} />
        </div>
      ) : (
        <section className={panel}>
          <div className="flex flex-wrap items-center gap-3">
            {data.agGroups.length > 0 && (
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger className="h-8 w-60" aria-label="Assistant Governor group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assistant Governor groups</SelectItem>
                  {data.agGroups.map((g) => <SelectItem key={g.memberId} value={String(g.memberId)}>{g.name} ({g.clubs})</SelectItem>)}
                  <SelectItem value="none">No Assistant Governor</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-44" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(["red", "amber", "green", "none"] as const).map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clubs" aria-label="Search clubs" className="h-8 w-56" />
            <span className="text-xs text-slate-500">{rows.length} of {data.clubs.length} clubs</span>
          </div>

          <div className="mt-4 max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr>
                  <th className="px-3 py-2 text-left">Club</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Assistant Governor</th>
                  {COLUMNS.map((m) => <th key={m.key} className="px-3 py-2 text-right" title={m.hint}>{m.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.clubId}>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpenClub(r.clubId)} className="text-left font-medium text-azure hover:underline">
                        {r.clubName}
                      </button>
                    </td>
                    <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                    <td className="px-3 py-2 text-slate-600">{r.agName ?? "-"}</td>
                    {COLUMNS.map((m) => {
                      const v = r.metrics[m.key];
                      return (
                        <td key={m.key} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${STATUS[v.status].cell}`} title={STATUS[v.status].label}>
                          {formatMetric(m.key, v, r.metrics.meetings.actual)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={3 + COLUMNS.length} className="px-3 py-6 text-center text-slate-400">No clubs match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
