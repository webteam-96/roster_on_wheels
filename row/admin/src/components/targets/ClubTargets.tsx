"use client";

// One club's live targets (spec B.3 #30, feature target_dashboard): every figure against its target with a status.
// ClubTargetCard is the drill-in of the district dashboard; the default export loads a club on its own (club admin).

import { useEffect, useState } from "react";
import { getClubTargets, type TargetClubRow, type TargetDashboardData, type TargetMetric, type TargetMetricKey, type TargetStatus } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { ProgressBar } from "@/components/growth/GrowthCard";
import { METRICS, STATUS, TARGETS_FEATURE, formatMetric } from "@/lib/targets";

export function StatusChip({ status }: { status: TargetStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${STATUS[status].dot}`} aria-hidden="true" />
      {STATUS[status].label}
    </span>
  );
}

export function MetricTile({ metricKey, metric, meetings }: { metricKey: TargetMetricKey; metric: TargetMetric; meetings: number }) {
  const def = METRICS.find((m) => m.key === metricKey)!;
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2" title={def.hint}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-500">{def.label}</p>
        <StatusChip status={metric.status} />
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{formatMetric(metricKey, metric, meetings)}</p>
      {metric.percent !== null && (
        <div className="mt-1 flex items-center gap-2">
          <ProgressBar percent={metric.percent} />
          <span className="text-xs tabular-nums text-slate-500">{metric.percent}%</span>
        </div>
      )}
    </div>
  );
}

export function MetricGrid({ metrics }: { metrics: TargetClubRow["metrics"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {METRICS.map((m) => <MetricTile key={m.key} metricKey={m.key} metric={metrics[m.key]} meetings={metrics.meetings.actual} />)}
    </div>
  );
}

export function ClubTargetCard({ row, yearLabel }: { row: TargetClubRow; yearLabel: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{row.clubName}</h3>
          <p className="text-xs text-slate-500">RY {yearLabel}{row.agName ? `, Assistant Governor ${row.agName}` : ""}</p>
        </div>
        <StatusChip status={row.status} />
      </div>
      <MetricGrid metrics={row.metrics} />
    </section>
  );
}

export function TargetsNote({ elapsed }: { elapsed: number }) {
  return (
    <p className="text-xs text-slate-500">
      {elapsed}% of the Rotary year has passed. A figure is on track when it has reached at least that share of its
      target, slightly behind within a quarter of it, behind below that.
    </p>
  );
}

export const errorText = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || "Targets could not be loaded.";

export default function ClubTargets({ clubId, yearId }: { clubId: number | null; yearId: number | null }) {
  const on = useFeatureOn(TARGETS_FEATURE);
  const [data, setData] = useState<TargetDashboardData | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on || !clubId) return;
    setData(undefined);
    setError(null);
    getClubTargets(clubId, yearId).then(setData).catch((e) => setError(errorText(e)));
  }, [on, clubId, yearId]);

  if (!on) return null;
  if (!clubId) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Select a club first.</p>;
  if (error) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{error}</p>;
  if (!data) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{METRICS.map((m) => <Skeleton key={m.key} className="h-20" />)}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TargetsNote elapsed={data.yearElapsedPercent} />
      {data.clubs[0] && <ClubTargetCard row={data.clubs[0]} yearLabel={data.yearLabel} />}
    </div>
  );
}
