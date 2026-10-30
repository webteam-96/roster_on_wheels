"use client";

/**
 * District Admin Dashboard › Grants (flagged module "grants"): one cycle per Rotary year with its DDF budget and
 * qualification rules, the applications by status, the archive, the cash flow of recorded payments and a CSV export.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Edit, Loader2, Plus, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { StatusBadge } from "@/components/grants/GrantParts";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import {
  downloadGrantsCsv, getDistrictGrantApplications, getGrantCashFlow, getGrantCycles, getRotaryYears, saveGrantCycle,
} from "@/services/api";
import { REVIEW_ORDER, STATUS_LABEL, dayInput, orNull } from "@/lib/grants";
import type { GrantApplicationListItem, GrantCashFlow, GrantCycle, GrantStatus, SaveGrantCycle } from "@/types/grants";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

export default function DistrictGrantsPage() {
  const { selectedDistrictId: districtId } = useAuth();
  const fmt = useFormat();
  const [cycles, setCycles] = useState<GrantCycle[] | null>(null);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [editing, setEditing] = useState<GrantCycle | "new" | null>(null);
  const [status, setStatus] = useState<GrantStatus | "">("");
  const [archived, setArchived] = useState(false);
  const [apps, setApps] = useState<GrantApplicationListItem[] | null>(null);
  const [flow, setFlow] = useState<GrantCashFlow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCycles = useCallback(async (select?: number) => {
    if (!districtId) return;
    try {
      const list = await getGrantCycles(districtId);
      setCycles(list);
      setCycleId((current) => select ?? (list.some((c) => c.id === current) ? current : list[0]?.id ?? null));
    } catch (err) {
      setCycles([]);
      setError(message(err, "Could not load the grant cycles."));
    }
  }, [districtId]);

  useEffect(() => { setCycles(null); loadCycles(); }, [loadCycles]);

  useEffect(() => {
    if (!districtId || !cycleId) { setApps([]); setFlow(null); return; }
    setApps(null);
    getDistrictGrantApplications(districtId, { cycleId, status: status || undefined, archived: status ? undefined : archived })
      .then(setApps)
      .catch((err) => { setApps([]); setError(message(err, "Could not load the applications.")); });
  }, [districtId, cycleId, status, archived]);

  useEffect(() => {
    if (!districtId || !cycleId) return;
    setFlow(null);
    getGrantCashFlow(districtId, cycleId).then(setFlow).catch(() => setFlow({ budget: 0, committed: 0, paid: 0, rows: [] }));
  }, [districtId, cycleId, cycles]);

  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  const cycle = cycles?.find((c) => c.id === cycleId) ?? null;

  const exportCsv = async () => {
    if (!cycle) return;
    setExporting(true);
    try {
      await downloadGrantsCsv(districtId, cycle.id, cycle.yearLabel);
    } catch (err) {
      setError(message(err, "Could not export."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Grants</h2>
          <p className="text-base text-muted-foreground">District grant cycles, club applications, payments and final reports.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cycle && (
            <Button variant="outline" className="gap-1.5" onClick={exportCsv} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
            </Button>
          )}
          <Button className="gap-1.5" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New cycle</Button>
        </div>
      </div>

      {editing && (
        <CycleForm districtId={districtId} cycle={editing === "new" ? null : editing} onError={setError}
          onClose={() => setEditing(null)} onSaved={(c) => { setEditing(null); loadCycles(c.id); }} />
      )}

      {cycles === null ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          <TableSkeleton rows={5} />
        </div>
      ) : cycles.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No grant cycle yet. Open one for the Rotary year the clubs will apply in.</CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56 space-y-1.5">
              <Label htmlFor="cycle">Rotary year</Label>
              <select id="cycle" className={SELECT} value={cycleId ?? ""} onChange={(e) => { setCycleId(Number(e.target.value)); setStatus(""); }}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.yearLabel} ({c.status})</option>)}
              </select>
            </div>
            {cycle && (
              <Button variant="outline" className="gap-1.5" onClick={() => setEditing(cycle)}>
                <Edit className="h-4 w-4" /> Edit cycle
              </Button>
            )}
          </div>

          {cycle && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["DDF budget", fmt.money(cycle.ddfBudget)],
                ["Approved", fmt.money(cycle.committed)],
                ["Paid", fmt.money(cycle.paid)],
                ["Not yet committed", fmt.money(cycle.ddfBudget - cycle.committed)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-card p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}

          {cycle && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={status === "" ? "default" : "outline"} onClick={() => setStatus("")}>All</Button>
                {REVIEW_ORDER.filter((s) => cycle.statusCounts[s]).map((s) => (
                  <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                    {STATUS_LABEL[s]} ({cycle.statusCounts[s]})
                  </Button>
                ))}
                {!status && (
                  <label className="ml-auto flex items-center gap-2 text-sm">
                    <Checkbox checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
                    Show the archive (closed, rejected, cancelled)
                  </label>
                )}
              </div>
              {apps === null ? (
                <TableSkeleton rows={5} />
              ) : apps.length === 0 ? (
                <Card><CardContent className="p-5 text-sm text-muted-foreground">No applications here.</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="overflow-x-auto p-0">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="p-3 font-medium">Club</th>
                          <th className="p-3 font-medium">Project</th>
                          <th className="p-3 font-medium">Status</th>
                          <th className="p-3 text-right font-medium">Requested</th>
                          <th className="p-3 text-right font-medium">Approved</th>
                          <th className="p-3 text-right font-medium">Paid</th>
                          <th className="p-3 font-medium">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apps.map((a) => (
                          <tr key={a.id} className="border-b last:border-0">
                            <td className="p-3">{a.clubName}</td>
                            <td className="p-3"><Link href={`/district-admin-dashboard/grants/${a.id}`} className="font-medium text-primary hover:underline">{a.title}</Link></td>
                            <td className="p-3"><StatusBadge status={a.status} /></td>
                            <td className="p-3 text-right tabular-nums">{fmt.money(a.amountRequested)}</td>
                            <td className="p-3 text-right tabular-nums">{a.amountApproved != null ? fmt.money(a.amountApproved) : ""}</td>
                            <td className="p-3 text-right tabular-nums">{a.paid ? fmt.money(a.paid) : ""}</td>
                            <td className="p-3">{fmt.date(a.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </section>
          )}

          {cycle && (
            <section className="space-y-3">
              <h3 className="text-lg font-semibold">Cash flow</h3>
              {flow === null ? (
                <TableSkeleton rows={3} />
              ) : flow.rows.length === 0 ? (
                <Card><CardContent className="p-5 text-sm text-muted-foreground">No payments recorded in this cycle yet.</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="overflow-x-auto p-0">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="p-3 font-medium">Paid on</th>
                          <th className="p-3 font-medium">Club and project</th>
                          <th className="p-3 text-right font-medium">Amount</th>
                          <th className="p-3 text-right font-medium">Paid so far</th>
                          <th className="p-3 text-right font-medium">Budget left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flow.rows.map((r, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="p-3">{fmt.date(r.paidOn)}</td>
                            <td className="p-3">{r.clubName}<span className="block text-xs text-muted-foreground">{r.title}{r.reference ? `, ${r.reference}` : ""}</span></td>
                            <td className="p-3 text-right tabular-nums">{fmt.money(r.amount)}</td>
                            <td className="p-3 text-right tabular-nums">{fmt.money(r.cumulativePaid)}</td>
                            <td className="p-3 text-right tabular-nums">{fmt.money(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </section>
          )}
        </>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function CycleForm({ districtId, cycle, onSaved, onClose, onError }: {
  districtId: number;
  cycle: GrantCycle | null;
  onSaved: (c: GrantCycle) => void;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [years, setYears] = useState<RotaryYear[] | null>(cycle ? [] : null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<SaveGrantCycle>(() => ({
    yearId: cycle?.yearId ?? 0,
    status: cycle?.status ?? "draft",
    ddfBudget: cycle?.ddfBudget ?? 0,
    maxRequest: cycle?.maxRequest ?? null,
    minQualifiedMembers: cycle?.minQualifiedMembers ?? 0,
    opensOn: dayInput(cycle?.opensOn) || null,
    closesOn: dayInput(cycle?.closesOn) || null,
    reportDueOn: dayInput(cycle?.reportDueOn) || null,
    rules: cycle?.rules ?? null,
  }));
  const set = <K extends keyof SaveGrantCycle>(k: K, v: SaveGrantCycle[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (cycle) return;
    getRotaryYears()
      .then((ys) => {
        // The current year and the ones after it: the usual case is next year's cycle.
        const current = ys.find((y) => y.isCurrent);
        const open = ys.filter((y) => !current || y.startDate >= current.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
        setYears(open);
        setForm((f) => ({ ...f, yearId: open.find((y) => !y.isCurrent)?.id ?? open[0]?.id ?? 0 }));
      })
      .catch(() => setYears([]));
  }, [cycle]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await saveGrantCycle(districtId, form, cycle?.id));
    } catch (err) {
      onError(message(err, "Could not save the cycle."));
    } finally {
      setBusy(false);
    }
  };

  const date = (k: "opensOn" | "closesOn" | "reportDueOn", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cy-${k}`}>{label}</Label>
      <Input id={`cy-${k}`} type="date" value={form[k] ?? ""} onChange={(e) => set(k, orNull(e.target.value))} />
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5">
        <form className="space-y-4" onSubmit={save}>
          <h3 className="text-base font-semibold">{cycle ? `Grant cycle ${cycle.yearLabel}` : "New grant cycle"}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cy-year">Rotary year</Label>
              {cycle ? (
                <Input id="cy-year" value={cycle.yearLabel} disabled />
              ) : years === null ? (
                <div className="h-10 animate-pulse rounded-md bg-muted" aria-busy="true" />
              ) : (
                <select id="cy-year" className={SELECT} value={form.yearId} onChange={(e) => set("yearId", Number(e.target.value))}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-status">Status</Label>
              <select id="cy-status" className={SELECT} value={form.status} onChange={(e) => set("status", e.target.value as SaveGrantCycle["status"])}>
                <option value="draft">Draft (clubs do not see it)</option>
                <option value="open">Open for applications</option>
                <option value="closed">Closed to new applications</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-budget">DDF budget</Label>
              <Input id="cy-budget" type="number" min={0} step="0.01" value={form.ddfBudget} onChange={(e) => set("ddfBudget", Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-max">Largest grant per application</Label>
              <Input id="cy-max" type="number" min={0} step="0.01" value={form.maxRequest ?? ""} placeholder="No limit"
                onChange={(e) => set("maxRequest", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-members">Qualified members needed</Label>
              <Input id="cy-members" type="number" min={0} max={50} value={form.minQualifiedMembers} onChange={(e) => set("minQualifiedMembers", Number(e.target.value) || 0)} />
            </div>
            {date("opensOn", "Applications open")}
            {date("closesOn", "Applications close")}
            {date("reportDueOn", "Final reports due")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cy-rules">Qualification rules</Label>
            <Textarea id="cy-rules" rows={4} maxLength={4000} value={form.rules ?? ""} onChange={(e) => set("rules", orNull(e.target.value))}
              placeholder="For example: the club has signed the district MOU and two members attended the grant management seminar." />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !form.yearId} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save cycle
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
