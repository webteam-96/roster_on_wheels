"use client";

// District rollup of club membership growth (spec B.4 #34): targets, joins, terminations, net growth and open
// prospects per club, plus the district's prospect pipeline by stage. Hidden while contacts_growth is off.

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useState } from "react";
import { getDistrictGrowth, type DistrictGrowth } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE } from "@/lib/contacts";
import { growthTotals } from "@/lib/growthTotals";
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

  // The figures follow the search; without one they are the district's own totals.
  const searching = search.trim() !== "";
  const totals = useMemo(() => (growth && searching ? growthTotals(clubs, growth.prospectsByStage) : growth), [growth, searching, clubs]);

  if (!on || growth === null || totals === null) return null;
  if (growth === undefined || totals === undefined) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="row-h3">Membership growth by club</h3>
          <p className="text-xs text-slate-500">RY {growth.yearLabel}: club targets against members who joined minus members who left</p>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clubs" aria-label="Search clubs" className="row-field-sm w-56" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Figure title="Targets set" value={`${totals.clubsWithTarget} clubs`} />
        <Figure title="Target total" value={totals.targetTotal} />
        <Figure title="Joined" value={totals.joined} />
        <Figure title="Left" value={totals.terminated} />
        <Figure title="Clubs at target" value={`${totals.clubsReached} of ${totals.clubsWithTarget}`} />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-slate-500">{searching ? "Prospects by stage, matching clubs" : "Prospects by stage, all clubs"}</p>
        <StageChips stages={totals.prospectsByStage} />
      </div>

      <Card className="mt-4 max-h-96 overflow-auto">
        <Table bare className="min-w-full text-sm">
          <TableHeader className="sticky top-0">
            <TableRow>
              <TableHead className="px-3 text-left">Club</TableHead>
              <TableHead className="px-3 text-right">Target</TableHead>
              <TableHead className="px-3 text-right">Joined</TableHead>
              <TableHead className="px-3 text-right">Left</TableHead>
              <TableHead className="px-3 text-right">Net</TableHead>
              <TableHead className="w-40 px-3 text-left">Progress</TableHead>
              <TableHead className="px-3 text-right">Open prospects</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {clubs.map((c) => (
              <TableRow key={c.clubId}>
                <TableCell className="px-3 py-2 text-slate-800">{c.clubName}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-slate-600">{c.target ?? "-"}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-slate-600">{c.joined}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-slate-600">{c.terminated}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{c.netGrowth}</TableCell>
                <TableCell className="px-3 py-2">
                  {c.progressPercent === null ? <span className="text-xs text-slate-400">No target</span> : (
                    <div className="flex flex-wrap items-center gap-2"><ProgressBar percent={c.progressPercent} /><span className="text-xs tabular-nums text-slate-500">{c.progressPercent}%</span></div>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-slate-600">{c.openProspects}</TableCell>
              </TableRow>
            ))}
            {clubs.length === 0 && <TableRow><TableCell colSpan={7} className="px-3 py-6 text-center text-slate-400">No clubs match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </Card>
  );
}
