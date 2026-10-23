"use client";

// Club membership growth for the Rotary year (spec B.4 #34): target, members joined and left, net growth, and the
// prospect pipeline by stage. Shown on the club dashboard while the contacts_growth feature is on.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getClubGrowth, setClubGrowthTarget, type ClubGrowth } from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { CONTACTS_FEATURE, errorText, label } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Figure({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  );
}

export function StageChips({ stages }: { stages: { stage: string; count: number }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((s) => (
        <span key={s.stage} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
          <span className="text-slate-500">{label(s.stage)}</span> <span className="font-semibold tabular-nums text-slate-800">{s.count}</span>
        </span>
      ))}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-azure" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function GrowthCard({ clubId, yearId, canManage }: { clubId: number; yearId?: number | null; canManage: boolean }) {
  const on = useFeatureOn(CONTACTS_FEATURE);
  const [growth, setGrowth] = useState<ClubGrowth | null | undefined>(undefined); // undefined = loading, null = unavailable
  const [target, setTarget] = useState<string | null>(null); // the edit box, open when not null
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getClubGrowth(clubId, yearId).then(setGrowth).catch(() => setGrowth(null));
  }, [clubId, yearId]);
  useEffect(() => { if (on && clubId) load(); }, [on, clubId, load]);

  if (!on || growth === null) return null;
  if (growth === undefined) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }

  const save = async () => {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 0 || n > 1000) { setError("Enter a whole number from 0 to 1000."); return; }
    try { await setClubGrowthTarget(clubId, growth.yearId, n); setTarget(null); setError(null); load(); }
    catch (e) { setError(errorText(e, "Could not save the target.")); }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Membership growth</h3>
          <p className="text-xs text-slate-500">RY {growth.yearLabel}: members who joined minus members who left, against the club target</p>
        </div>
        <div className="flex gap-3 text-xs font-medium">
          <Link href="/club-admin-dashboard/contacts" className="text-azure hover:underline">Contacts and invites</Link>
          <Link href={`/clubs/${clubId}/rotary-network/potential-members/v2`} className="text-azure hover:underline">Prospects</Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure title="Target" value={growth.target ?? "Not set"} />
        <Figure title="Joined" value={growth.joined} />
        <Figure title="Left" value={growth.terminated} />
        <Figure title="Net growth" value={signed(growth.netGrowth)} />
      </div>

      {growth.progressPercent !== null && (
        <div className="mt-3 space-y-1">
          <ProgressBar percent={growth.progressPercent} />
          <p className="text-xs text-slate-500">{growth.progressPercent}% of the target</p>
        </div>
      )}

      {canManage && (target === null ? (
        <button type="button" className="mt-3 text-xs font-medium text-azure hover:underline" onClick={() => setTarget(String(growth.target ?? ""))}>
          {growth.target === null ? "Set the growth target" : "Change the target"}
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="growth-target" className="text-xs text-slate-600">Net new members this year</label>
          <Input id="growth-target" type="number" min={0} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-24" />
          <Button size="sm" className="h-8 bg-azure text-white hover:bg-mint-ink" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setTarget(null); setError(null); }}>Cancel</Button>
          {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
      ))}

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-slate-500">Prospects by stage</p>
        <StageChips stages={growth.prospectsByStage} />
      </div>
    </div>
  );
}
