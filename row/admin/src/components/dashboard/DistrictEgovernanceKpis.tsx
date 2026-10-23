"use client";

/**
 * DistrictEgovernanceKpis — the e-governance KPI tiles (Monthly Reports / Avg Awards
 * Score) shown on the egovernance landing. Extracted so the SAME tiles stay STATIC on
 * the standalone CMR month and club citation pages (which live outside the
 * district-admin-dashboard cache provider, so they fetch their own copy here).
 */

import { useEffect, useState } from "react";
import KpiCard from "@/components/dashboard/KpiCard";
import { getDistrictAdminEGovernance } from "@/services/api";
import { FileSpreadsheet, Award } from "@/components/icons";

// Session-lived cache (per district+year) so the tiles repaint INSTANTLY with the
// last-known values on every mount — no flash to empty when navigating between the
// egovernance sections (CMR / District Awards / Reports).
const kpiCache = new Map<string, any>();

export default function DistrictEgovernanceKpis({ districtId, yearId }: { districtId: number; yearId?: number | null }) {
  const cacheKey = `${districtId}:${yearId ?? "cur"}`;
  const [data, setData] = useState<any>(() => kpiCache.get(cacheKey) ?? null);

  useEffect(() => {
    let alive = true;
    const cached = kpiCache.get(cacheKey);
    if (cached) setData(cached); // paint immediately from cache, then refresh below
    getDistrictAdminEGovernance(yearId ?? null, districtId)
      .then((d) => { if (alive) { kpiCache.set(cacheKey, d); setData(d); } })
      .catch(() => { /* keep tiles rendered with cached/fallback values */ });
    return () => { alive = false; };
  }, [districtId, yearId, cacheKey]);

  const monthlyReports = data?.kpis?.monthlyReports ?? data?.totalCmrSubmitted ?? 0;
  const avgCitationScore = data?.kpis?.avgCitationScore ?? null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <KpiCard title="Monthly Reports" value={String(monthlyReports)} subtitle="Submitted on time" icon={FileSpreadsheet} color="blue" />
      <KpiCard
        title="Avg Awards Score"
        value={avgCitationScore == null ? "–" : `${Math.round(avgCitationScore)}/1000`}
        subtitle={avgCitationScore == null ? "Pending" : "All clubs"}
        icon={Award}
        color="gold"
      />
    </div>
  );
}
