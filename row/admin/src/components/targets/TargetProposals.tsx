"use client";

// District target setting (build spec B.29, feature target_dashboard): the district proposes a target per club and
// metric; the club accepts or counters with its own value and a note; both see the status. No locking (module sheet).

import { useCallback, useEffect, useState } from "react";
import {
  answerTargetProposal, getClubTargetProposals, getDistrictClubs, getDistrictTargetProposals, proposeClubTarget,
  type ProposalMetric, type TargetProposal,
} from "@/services/api";
import { useFeatureOn } from "@/components/FeatureGate";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TARGETS_FEATURE } from "@/lib/targets";
import { errorText } from "./ClubTargets";

export const PROPOSAL_METRICS: { key: ProposalMetric; label: string }[] = [
  { key: "membership_growth", label: "Membership growth (net members)" },
  { key: "meetings", label: "Meetings held" },
  { key: "dues_collection", label: "Dues collected (%)" },
  { key: "service_projects", label: "Service projects" },
  { key: "foundation_giving", label: "Foundation giving (USD)" },
];
const label = (m: ProposalMetric) => PROPOSAL_METRICS.find((x) => x.key === m)?.label ?? m;
const STATUS_TEXT: Record<TargetProposal["status"], string> = { proposed: "Waiting for the club", accepted: "Accepted", countered: "Countered" };
const panel = "rounded-xl border border-slate-200 bg-white p-5";
const SELECT = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function Status({ p }: { p: TargetProposal }) {
  return (
    <span className="text-sm">
      {STATUS_TEXT[p.status]}
      {p.status === "countered" && <> with <strong>{p.counterValue}</strong>{p.clubNote && <>: “{p.clubNote}”</>}</>}
    </span>
  );
}

export function DistrictTargetProposals({ districtId, yearId }: { districtId: number | null; yearId: number | null }) {
  const on = useFeatureOn(TARGETS_FEATURE);
  const [rows, setRows] = useState<TargetProposal[] | null>(null);
  const [clubs, setClubs] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState<{ clubId: number; metric: ProposalMetric; value: string }>({ clubId: 0, metric: "membership_growth", value: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!districtId) return;
    getDistrictTargetProposals(districtId, yearId).then(setRows).catch((e) => { setError(errorText(e)); setRows([]); });
  }, [districtId, yearId]);
  useEffect(() => { if (on) load(); }, [on, load]);
  useEffect(() => {
    if (on && districtId) getDistrictClubs(districtId).then((c) => setClubs(c.map((x) => ({ id: x.id, name: x.clubName })))).catch(() => {});
  }, [on, districtId]);

  if (!on || !districtId) return null;
  const propose = async (clubId: number, metric: ProposalMetric, value: number) => {
    setBusy(true);
    setError(null);
    try {
      await proposeClubTarget(districtId, { clubId, yearId, metric, value });
      setForm((f) => ({ ...f, value: "" }));
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${panel} mt-6 space-y-4`} aria-labelledby="proposals-h">
      <div>
        <h3 id="proposals-h" className="text-lg font-semibold">Target proposals to clubs</h3>
        <p className="text-sm text-muted-foreground">Propose a target; the club accepts it or counters. A new value asks the club again.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">Club
          <select className={SELECT} value={form.clubId} onChange={(e) => setForm({ ...form, clubId: Number(e.target.value) })}>
            <option value={0}>Pick a club</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Target
          <select className={SELECT} value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as ProposalMetric })}>
            {PROPOSAL_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Value
          <Input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </label>
        <Button disabled={busy || !form.clubId || form.value === ""} onClick={() => propose(form.clubId, form.metric, Number(form.value))}>Propose</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows === null ? <Skeleton className="h-24" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No proposals for this Rotary year yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left"><th className="py-2 pr-3">Club</th><th className="pr-3">Target</th><th className="pr-3">Proposed</th><th className="pr-3">Status</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{p.clubName}</td>
                  <td className="pr-3">{label(p.metric)}</td>
                  <td className="pr-3 tabular-nums">{p.proposedValue}</td>
                  <td className="pr-3"><Status p={p} /></td>
                  <td className="text-right">
                    {p.status === "countered" && p.counterValue != null && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => propose(p.clubId, p.metric, p.counterValue!)}>
                        Take {p.counterValue}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ClubTargetProposals({ clubId, yearId }: { clubId: number | null; yearId: number | null }) {
  const on = useFeatureOn(TARGETS_FEATURE);
  const [rows, setRows] = useState<TargetProposal[] | null>(null);
  const [counter, setCounter] = useState<Record<number, { value: string; note: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!clubId) return;
    getClubTargetProposals(clubId, yearId).then(setRows).catch((e) => { setError(errorText(e)); setRows([]); });
  }, [clubId, yearId]);
  useEffect(() => { if (on) load(); }, [on, load]);

  if (!on || !clubId) return null;
  const answer = async (p: TargetProposal, a: { accept: true } | { value: number; note?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await answerTargetProposal(clubId, p.id, a);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${panel} mt-6 space-y-4`} aria-labelledby="club-proposals-h">
      <div>
        <h3 id="club-proposals-h" className="text-lg font-semibold">Targets proposed by the district</h3>
        <p className="text-sm text-muted-foreground">Accept a target, or counter with the value your club can commit to.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows === null ? <Skeleton className="h-24" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">The district has not proposed targets for this Rotary year.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((p) => {
            const c = counter[p.id] ?? { value: "", note: "" };
            return (
              <li key={p.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><strong>{label(p.metric)}</strong>: <span className="tabular-nums">{p.proposedValue}</span></span>
                  <Status p={p} />
                </div>
                {p.status === "proposed" && (
                  <div className="grid gap-2 sm:grid-cols-[auto_8rem_1fr_auto] sm:items-center">
                    <Button size="sm" disabled={busy} onClick={() => answer(p, { accept: true })}>Accept</Button>
                    <Input aria-label={`Counter value for ${label(p.metric)}`} type="number" min={0} placeholder="Counter"
                      value={c.value} onChange={(e) => setCounter({ ...counter, [p.id]: { ...c, value: e.target.value } })} />
                    <Input aria-label="Note to the district" maxLength={500} placeholder="Note to the district (optional)"
                      value={c.note} onChange={(e) => setCounter({ ...counter, [p.id]: { ...c, note: e.target.value } })} />
                    <Button size="sm" variant="outline" disabled={busy || c.value === ""}
                      onClick={() => answer(p, { value: Number(c.value), note: c.note || undefined })}>Counter</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
