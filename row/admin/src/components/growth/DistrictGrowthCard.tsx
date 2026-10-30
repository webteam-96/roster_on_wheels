"use client";

// District rollup of club membership growth (spec B.4 #34): targets, joins, terminations, net growth and open
// prospects per club, plus the district's prospect pipeline by stage. Hidden while contacts_growth is off.

import { useEffect, useMemo, useState } from "react";
import { getDistrictGrowth, type DistrictGrowth } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Input } from "@/components/ui/input";
import { Figure, ProgressBar, StageChips } from "./GrowthCard";

export default function DistrictGrowthCard({ districtId, yearId }: { districtId: number; yearId?: number | null }) {
  const on = useFeatureOn(CONTACTS_FEATURE);
  const [growth, setGrowth] = useState<DistrictGrowth | null | undefined>(undefined);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!on || !districtId) return;
    setGrowth(undefined);
    getDistrictGrowth(districtId, yearId).then(setGrowth).catch(() => setGrowth(null));
  }, [on, districtId, yearId]);

  const clubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (growth?.clubs ?? []).filter((c) => !q || c.clubName.toLowerCase().includes(q));
  }, [growth, search]);

  if (!on || growth === null) return null;
  if (growth === undefined) {
    return (
      <div className="space-y-3 rounded-[20px] border border-slate-200 bg-white p-5">
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Membership growth by club</h3>
          <p className="text-xs text-slate-500">RY {growth.yearLabel}: club targets against members who joined minus members who left</p>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clubs" aria-label="Search clubs" className="h-8 w-56" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Figure title="Targets set" value={`${growth.clubsWithTarget} clubs`} />
        <Figure title="Target total" value={growth.targetTotal} />
        <Figure title="Joined" value={growth.joined} />
        <Figure title="Left" value={growth.terminated} />
        <Figure title="Clubs at target" value={`${growth.clubsReached} of ${growth.clubsWithTarget}`} />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-slate-500">Prospects by stage, all clubs</p>
        <StageChips stages={growth.prospectsByStage} />
      </div>

      <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-[#EDF4FB] text-[13px] text-[#64748B]">
            <tr>
              <th className="px-3 py-2 text-left">Club</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Joined</th>
              <th className="px-3 py-2 text-right">Left</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="w-40 px-3 py-2 text-left">Progress</th>
              <th className="px-3 py-2 text-right">Open prospects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clubs.map((c) => (
              <tr key={c.clubId}>
                <td className="px-3 py-2 text-slate-800">{c.clubName}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{c.target ?? "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{c.joined}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{c.terminated}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{c.netGrowth}</td>
                <td className="px-3 py-2">
                  {c.progressPercent === null ? <span className="text-xs text-slate-400">No target</span> : (
                    <div className="flex flex-wrap items-center gap-2"><ProgressBar percent={c.progressPercent} /><span className="text-xs tabular-nums text-slate-500">{c.progressPercent}%</span></div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{c.openProspects}</td>
              </tr>
            ))}
            {clubs.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No clubs match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
