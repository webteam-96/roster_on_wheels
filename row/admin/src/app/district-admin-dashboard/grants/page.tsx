"use client";
import { DataTable } from "@/components/ui/data-table";

/**
 * District Admin Dashboard › Grants (flagged module "grants"): one cycle per Rotary year with its DDF budget and
 * qualification rules, the applications by status, the archive, the cash flow of recorded payments and a CSV export.
 */

import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
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
  downloadGrantsCsv, getDistrictGrantApplications, getGrantCashFlow, getGrantCycles, getGrantYearSummary, getRotaryYears,
  saveGrantCycle, sendGrantReportReminders,
} from "@/services/api";
import { REVIEW_ORDER, STATUS_LABEL, dayInput, orNull } from "@/lib/grants";
import { GrantEmailTemplates, MonthlyCashFlow, QualifiedClubs } from "@/components/grants/GrantExtras";
import type { GrantApplicationListItem, GrantCashFlow, GrantCycle, GrantStatus, GrantYearSummary, SaveGrantCycle } from "@/types/grants";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "row-field w-full";
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
  const [summary, setSummary] = useState<GrantYearSummary[] | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  useEffect(() => {
    if (!districtId) return;
    setSummary(null);
    setSummaryFailed(false);
    getGrantYearSummary(districtId).then(setSummary).catch(() => setSummaryFailed(true));
  }, [districtId, cycles]);

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

  const remind = async () => {
    setReminding(true);
    setNotice(null);
    try {
      const { sent } = await sendGrantReportReminders(districtId);
      setNotice(sent === 0
        ? "No reminders were due. Each club gets one reminder a week before a report is due and one once it is overdue."
        : `${sent} report reminder${sent === 1 ? "" : "s"} sent to the clubs (in the app and by email).`);
    } catch (err) {
      setError(message(err, "Could not send the reminders."));
    } finally {
      setReminding(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grants"
        description="District grant cycles, club applications, payments and final reports."
        actions={
          <>
{cycle && (
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
            </Button>
          )}
          {cycles && cycles.length > 0 && (
            <Button variant="outline" onClick={remind} disabled={reminding}>
              {reminding && <Loader2 className="h-4 w-4 animate-spin" />} Send report reminders
            </Button>
          )}
          <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New cycle</Button>
          </>
        }
      />
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

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
              <NativeSelect id="cycle"  value={cycleId ?? ""} onChange={(e) => { setCycleId(Number(e.target.value)); setStatus(""); }}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.yearLabel} ({c.status})</option>)}
              </NativeSelect>
            </div>
            {cycle && (
              <Button variant="outline" onClick={() => setEditing(cycle)}>
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
                <Card key={label} className="p-5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                </Card>
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
                <DataTable
                  caption="Grant applications"
                  rows={apps}
                  rowKey={(a) => a.id}
                  className="[&_table]:min-w-[820px]"
                  columns={[
                    { key: "club", header: "Club", cell: (a) => a.clubName },
                    { key: "project", header: "Project", cell: (a) => <Link href={`/district-admin-dashboard/grants/${a.id}`} className="font-medium text-primary hover:underline">{a.title}</Link> },
                    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
                    { key: "requested", header: "Requested", align: "right", className: "tabular-nums", cell: (a) => fmt.money(a.amountRequested) },
                    { key: "approved", header: "Approved", align: "right", className: "tabular-nums", cell: (a) => (a.amountApproved != null ? fmt.money(a.amountApproved) : "") },
                    { key: "paid", header: "Paid", align: "right", className: "tabular-nums", cell: (a) => (a.paid ? fmt.money(a.paid) : "") },
                    { key: "updated", header: "Updated", cell: (a) => fmt.date(a.updatedAt) },
                  ]}
                />
              )}
            </section>
          )}

          <section className="space-y-3">
            <h3 className="row-h2">By Rotary year</h3>
            {summaryFailed ? (
              <Card><CardContent className="p-5 text-sm text-red-700" role="alert">Could not load the yearly summary.</CardContent></Card>
            ) : summary === null ? (
              <TableSkeleton rows={3} />
            ) : summary.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">No grant years yet.</CardContent></Card>
            ) : (
              <DataTable
                caption="Grants by Rotary year"
                rows={summary}
                rowKey={(y) => y.cycleId}
                className="[&_table]:min-w-[720px]"
                columns={[
                  { key: "year", header: "Year", cell: (y) => y.yearLabel },
                  { key: "budget", header: "DDF budget", align: "right", className: "tabular-nums", cell: (y) => fmt.money(y.budget) },
                  { key: "approved", header: "Approved", align: "right", className: "tabular-nums", cell: (y) => fmt.money(y.approved) },
                  { key: "paid", header: "Paid", align: "right", className: "tabular-nums", cell: (y) => fmt.money(y.paid) },
                  { key: "outstanding", header: "Outstanding", align: "right", className: "tabular-nums", cell: (y) => fmt.money(y.outstanding) },
                  { key: "spent", header: "Reported spent", align: "right", className: "tabular-nums", cell: (y) => fmt.money(y.reportedSpent) },
                ]}
              />
            )}
          </section>

          {cycle && (
            <section className="space-y-3">
              <h3 className="row-h2">Cash flow</h3>
              {flow === null ? (
                <TableSkeleton rows={3} />
              ) : flow.rows.length === 0 ? (
                <Card><CardContent className="p-5 text-sm text-muted-foreground">No payments recorded in this cycle yet.</CardContent></Card>
              ) : (
                <DataTable
                  caption="Grant cash flow"
                  rows={flow.rows}
                  rowKey={(_, i) => i}
                  className="[&_table]:min-w-[720px]"
                  columns={[
                    { key: "paidOn", header: "Paid on", cell: (r) => fmt.date(r.paidOn) },
                    { key: "club", header: "Club and project", cell: (r) => <>{r.clubName}<span className="block text-xs text-muted-foreground">{r.title}{r.reference ? `, ${r.reference}` : ""}</span></> },
                    { key: "amount", header: "Amount", align: "right", className: "tabular-nums", cell: (r) => fmt.money(r.amount) },
                    { key: "cumulative", header: "Paid so far", align: "right", className: "tabular-nums", cell: (r) => fmt.money(r.cumulativePaid) },
                    { key: "balance", header: "Budget left", align: "right", className: "tabular-nums", cell: (r) => fmt.money(r.balance) },
                  ]}
                />
              )}
            </section>
          )}
          {cycle && (
            <>
              <MonthlyCashFlow key={`flow-${cycle.id}`} districtId={districtId} cycleId={cycle.id} yearLabel={cycle.yearLabel} onError={setError} />
              <QualifiedClubs key={`qual-${cycle.yearId}`} districtId={districtId} yearId={cycle.yearId} yearLabel={cycle.yearLabel} onError={setError} />
            </>
          )}
          <GrantEmailTemplates districtId={districtId} onError={setError} />
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
    interimDueOn: dayInput(cycle?.interimDueOn) || null,
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

  const date = (k: "opensOn" | "closesOn" | "interimDueOn" | "reportDueOn", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cy-${k}`}>{label}</Label>
      <Input id={`cy-${k}`} type="date" value={form[k] ?? ""} onChange={(e) => set(k, orNull(e.target.value))} />
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5">
        <form className="space-y-4" onSubmit={save}>
          <h3 className="row-h2">{cycle ? `Grant cycle ${cycle.yearLabel}` : "New grant cycle"}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cy-year">Rotary year</Label>
              {cycle ? (
                <Input id="cy-year" value={cycle.yearLabel} disabled />
              ) : years === null ? (
                <div className="h-10 animate-pulse rounded-md bg-muted" aria-busy="true" />
              ) : (
                <NativeSelect id="cy-year"  value={form.yearId} onChange={(e) => set("yearId", Number(e.target.value))}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</option>)}
                </NativeSelect>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cy-status">Status</Label>
              <NativeSelect id="cy-status"  value={form.status} onChange={(e) => set("status", e.target.value as SaveGrantCycle["status"])}>
                <option value="draft">Draft (clubs do not see it)</option>
                <option value="open">Open for applications</option>
                <option value="closed">Closed to new applications</option>
              </NativeSelect>
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
            {date("interimDueOn", "Interim reports due")}
            {date("reportDueOn", "Final reports due")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cy-rules">Qualification rules</Label>
            <Textarea id="cy-rules" rows={4} maxLength={4000} value={form.rules ?? ""} onChange={(e) => set("rules", orNull(e.target.value))}
              placeholder="For example: the club has signed the district MOU and two members attended the grant management seminar." />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !form.yearId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save cycle
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
