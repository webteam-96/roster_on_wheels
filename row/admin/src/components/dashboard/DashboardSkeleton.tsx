"use client";

/**
 * Shared skeleton primitives + a default dashboard-tab skeleton used by
 * every loading.tsx under /club-admin-dashboard/<tab>. Matches the rough
 * shape of a tab page: page title row, KPI tile grid, then 1-2 table blocks.
 */

import { Card } from "@/components/ui/card";
import { ReactNode } from "react";

export function Skeleton({
  className = "",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`row-skeleton rounded-md ${className}`}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-2 h-3 w-16" />
    </Card>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-44" />
      <div className="mt-4 w-full" style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    </Card>
  );
}

interface DashboardTabSkeletonProps {
  kpiCount?: number;
  tableCount?: number;
  showChart?: boolean;
}

/** Default page-level skeleton, sized to feel close to a real tab. */
export default function DashboardTabSkeleton({
  kpiCount = 4,
  tableCount = 1,
  showChart = false,
}: DashboardTabSkeletonProps) {
  return (
    <div className="space-y-6">
      {/* Page heading row */}
      <div>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      {/* KPI tile grid */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(kpiCount, 4)}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: kpiCount }).map((_, i) => (
          <KpiTileSkeleton key={i} />
        ))}
      </div>

      {/* Optional chart */}
      {showChart && <ChartSkeleton />}

      {/* Table blocks */}
      <div className="space-y-4">
        {Array.from({ length: tableCount }).map((_, i) => (
          <TableSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
