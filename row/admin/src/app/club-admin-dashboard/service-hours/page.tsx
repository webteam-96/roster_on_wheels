"use client";

/**
 * Club Admin Dashboard › Service Hours (flagged module "service_hours"). Members log their service hours in the app;
 * the club's admins approve or reject them here, record cash and in-kind contributions per project, and read the
 * year's report (logged hours plus hours recorded on volunteer sheets) with an Excel export.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, Plus, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat, useToday } from "@/hooks/useFormat";
import { moneyLine, parseAmount, reportFileName, saveBlob } from "@/lib/serviceHours";
import {
  addServiceContribution, deleteServiceContribution, exportServiceReport, getClubServiceReport, getServiceContributions,
  getServiceHours, getServiceProjects, reviewServiceHours,
} from "@/services/api";
import type { Contribution, ServiceHoursEntry, ServiceHoursStatus, ServiceProjectOption, ServiceReport } from "@/types/serviceHours";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const SELECT = "row-field";
const TH = "p-3 font-medium";
const message = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function ServiceHoursPage() {
  const { selectedClubId: clubId } = useAuth();
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [yearId, setYearId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    if (!clubId) return;
    setReport(null);
    getClubServiceReport(clubId, yearId)
      .then(setReport)
      .catch((err) => setError(message(err, "Could not load the service report.")));
  }, [clubId, yearId, reload]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  const year = report?.yearId ?? yearId;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Hours"
        description={<>Members log their service hours in the app. Approve them here, record what the club gave in cash and in kind, and see the year&apos;s totals. Hours recorded on volunteer sign-up sheets count in too.</>}
        actions={report && (
          <div className="flex items-center gap-2">
            <Label htmlFor="sh-year" className="text-sm">Rotary year</Label>
            <NativeSelect id="sh-year" className="w-auto" value={report.yearId} onChange={(e) => setYearId(Number(e.target.value))}>
              {report.years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </NativeSelect>
          </div>
        )}
      />

      <Tabs defaultValue="review">
        <TabsList>
          <TabsTrigger value="review">To review{report?.totals.pendingEntries ? ` (${report.totals.pendingEntries})` : ""}</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
        </TabsList>
        <TabsContent value="review">
          {year ? <Entries clubId={clubId} yearId={year} onChange={refresh} onError={setError} /> : <TableSkeleton rows={4} />}
        </TabsContent>
        <TabsContent value="report">
          <Report clubId={clubId} report={report} onError={setError} />
        </TabsContent>
        <TabsContent value="contributions">
          {year ? <Contributions clubId={clubId} yearId={year} onChange={refresh} onError={setError} /> : <TableSkeleton rows={4} />}
        </TabsContent>
      </Tabs>

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

interface PartProps {
  clubId: number;
  yearId: number;
  onChange: () => void;
  onError: (message: string) => void;
}

function Entries({ clubId, yearId, onChange, onError }: PartProps) {
  const fmt = useFormat();
  const [status, setStatus] = useState<ServiceHoursStatus | "">("pending");
  const [entries, setEntries] = useState<ServiceHoursEntry[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    setEntries(null);
    getServiceHours(clubId, yearId, status)
      .then(setEntries)
      .catch((err) => { setEntries([]); onError(message(err, "Could not load the entries.")); });
  }, [clubId, yearId, status, onError]);

  const review = async (e: ServiceHoursEntry, approve: boolean) => {
    setBusy(e.id);
    try {
      const saved = await reviewServiceHours(clubId, e.id, approve, notes[e.id]?.trim() || null);
      setEntries((list) => (list ?? []).flatMap((x) => (x.id !== e.id ? [x] : status && saved.status !== status ? [] : [saved])));
      onChange();
    } catch (err) {
      onError(message(err, "Could not save the review."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="sh-status" className="text-sm">Show</Label>
        <NativeSelect id="sh-status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as ServiceHoursStatus | "")}>
          <option value="pending">Waiting for review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </NativeSelect>
      </div>
      {!entries ? (
        <div aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : entries.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No entries here for this Rotary year.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[900px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className={TH}>Member</TableHead>
                  <TableHead className={TH}>Date</TableHead>
                  <TableHead className={TH}>Service</TableHead>
                  <TableHead className={`${TH} text-right`}>Hours</TableHead>
                  <TableHead className={TH}>Photo</TableHead>
                  <TableHead className={TH}>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id} className="border-b align-top last:border-0">
                    <TableCell className="p-3 font-medium">{e.memberName}</TableCell>
                    <TableCell className="p-3 whitespace-nowrap">{fmt.date(e.serviceDate.slice(0, 10))}</TableCell>
                    <TableCell className="p-3">
                      <div>{e.projectTitle ?? e.otherService ?? ""}</div>
                      {e.note && <div className="text-muted-foreground">{e.note}</div>}
                    </TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(e.hours)}</TableCell>
                    <TableCell className="p-3">
                      {e.photoPath && (
                        <a href={`${API}${e.photoPath}`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`${API}${e.photoPath}`} alt={`Service photo from ${e.memberName}`} className="h-12 w-12 rounded-md object-cover" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="p-3">
                      {e.status !== "pending" && (
                        <p className="mb-2">
                          {e.status === "approved" ? "Approved" : "Rejected"}
                          {e.reviewNote ? `: ${e.reviewNote}` : ""}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`Note for ${e.memberName}`}
                          placeholder="Note (optional)"
                          maxLength={300}
                          className="w-44"
                          value={notes[e.id] ?? ""}
                          onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                        />
                        {busy === e.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            {e.status !== "approved" && (
                              <Button size="sm" onClick={() => review(e, true)}><Check className="h-4 w-4" /> Approve</Button>
                            )}
                            {e.status !== "rejected" && (
                              <Button size="sm" variant="outline" onClick={() => review(e, false)}><X className="h-4 w-4" /> Reject</Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Report({ clubId, report, onError }: { clubId: number; report: ServiceReport | null; onError: (m: string) => void }) {
  const fmt = useFormat();
  const [downloading, setDownloading] = useState(false);
  if (!report) return <div aria-busy="true" className="pt-3"><TableSkeleton rows={5} /></div>;
  const money = (list: ServiceReport["totals"]["cash"]) => moneyLine(list, (a, c) => fmt.money(a, c)) || "None";

  const download = async () => {
    setDownloading(true);
    try {
      saveBlob(await exportServiceReport("clubs", clubId, report.yearId), reportFileName(report.scopeName, report.yearLabel));
    } catch (err) {
      onError(message(err, "Could not download the report."));
    } finally {
      setDownloading(false);
    }
  };

  const t = report.totals;
  return (
    <div className="space-y-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><dt className="text-muted-foreground">Approved hours</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(t.hours)}</dd></div>
          <div><dt className="text-muted-foreground">Volunteer sheet hours</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(t.volunteerHours)}</dd></div>
          <div><dt className="text-muted-foreground">Members who served</dt><dd className="text-xl font-semibold tabular-nums">{fmt.number(t.members)}</dd></div>
          <div><dt className="text-muted-foreground">Cash</dt><dd className="text-xl font-semibold">{money(t.cash)}</dd></div>
          <div><dt className="text-muted-foreground">In kind</dt><dd className="text-xl font-semibold">{money(t.inKind)}</dd></div>
        </dl>
        <Button variant="outline" onClick={download} disabled={downloading}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
        </Button>
      </div>

      <h3 className="row-h2">By project</h3>
      {report.byProject.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No approved hours or contributions in {report.yearLabel} yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[820px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className={TH}>Project</TableHead>
                  <TableHead className={`${TH} text-right`}>Logged hours</TableHead>
                  <TableHead className={`${TH} text-right`}>Volunteer sheet hours</TableHead>
                  <TableHead className={`${TH} text-right`}>Man-hours on project</TableHead>
                  <TableHead className={`${TH} text-right`}>Members</TableHead>
                  <TableHead className={TH}>Cash</TableHead>
                  <TableHead className={TH}>In kind</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byProject.map((p) => (
                  <TableRow key={p.projectId ?? "other"} className="border-b last:border-0">
                    <TableCell className="p-3 font-medium">{p.title}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(p.hours)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(p.volunteerHours)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{p.projectManHours == null ? "" : fmt.number(p.projectManHours)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(p.members)}</TableCell>
                    <TableCell className="p-3">{moneyLine(p.cash, (a, c) => fmt.money(a, c))}</TableCell>
                    <TableCell className="p-3">{moneyLine(p.inKind, (a, c) => fmt.money(a, c))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <h3 className="row-h2">By member</h3>
      {report.byMember.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No member has approved hours in {report.yearLabel} yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[560px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className={TH}>Member</TableHead>
                  <TableHead className={`${TH} text-right`}>Logged hours</TableHead>
                  <TableHead className={`${TH} text-right`}>Volunteer sheet hours</TableHead>
                  <TableHead className={`${TH} text-right`}>Entries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byMember.map((m) => (
                  <TableRow key={m.memberId} className="border-b last:border-0">
                    <TableCell className="p-3 font-medium">{m.name}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(m.hours)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(m.volunteerHours)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(m.entries)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Contributions({ clubId, yearId, onChange, onError }: PartProps) {
  const fmt = useFormat();
  const today = useToday();
  const [list, setList] = useState<Contribution[] | null>(null);
  const [projects, setProjects] = useState<ServiceProjectOption[] | null>(null);
  const [form, setForm] = useState({ projectId: "", kind: "cash" as "cash" | "in_kind", amount: "", contributor: "", description: "", date: today });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    setList(null);
    setProjects(null);
    Promise.all([getServiceContributions(clubId, yearId), getServiceProjects(clubId, yearId)])
      .then(([c, p]) => { setList(c); setProjects(p); })
      .catch((err) => { setList([]); setProjects([]); onError(message(err, "Could not load the contributions.")); });
  }, [clubId, yearId, onError]);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amount = parseAmount(form.amount);
    if (!form.projectId) return onError("Pick the project.");
    if (amount == null) return onError("Enter an amount more than 0, with at most two decimals.");
    setSaving(true);
    try {
      const saved = await addServiceContribution(clubId, {
        projectId: Number(form.projectId), yearId, kind: form.kind, amount, contributionDate: form.date,
        contributor: form.contributor.trim() || null, description: form.description.trim() || null,
      });
      setList((l) => [saved, ...(l ?? [])]);
      setForm((f) => ({ ...f, amount: "", contributor: "", description: "" }));
      onChange();
    } catch (err) {
      onError(message(err, "Could not record the contribution."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Contribution) => {
    if (!window.confirm("Remove this contribution?")) return;
    setDeleting(c.id);
    try {
      await deleteServiceContribution(clubId, c.id);
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
      onChange();
    } catch (err) {
      onError(message(err, "Could not remove the contribution."));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4 pt-3">
      <Card>
        <CardContent className="p-5">
          {!projects ? (
            <div aria-busy="true"><TableSkeleton rows={2} /></div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">The club has no projects in this Rotary year to record contributions against.</p>
          ) : (
            <form onSubmit={add} className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="ct-project">Project</Label>
                <NativeSelect id="ct-project"  required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                  <option value="">Choose a project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-kind">Kind</Label>
                <NativeSelect id="ct-kind"  value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "cash" | "in_kind" })}>
                  <option value="cash">Cash</option>
                  <option value="in_kind">In kind (estimated value)</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-amount">Amount{(() => { const c = projects.find((p) => String(p.id) === form.projectId)?.currency; return c ? ` (${c})` : ""; })()}</Label>
                <Input id="ct-amount" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-date">Date</Label>
                <Input id="ct-date" type="date" required max={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-from">Given by</Label>
                <Input id="ct-from" maxLength={150} value={form.contributor} onChange={(e) => setForm({ ...form, contributor: e.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="ct-desc">{form.kind === "in_kind" ? "What was given" : "Description (optional)"}</Label>
                <Input id="ct-desc" maxLength={300} required={form.kind === "in_kind"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {!list ? (
        <div aria-busy="true"><TableSkeleton rows={3} /></div>
      ) : list.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No contributions recorded for this Rotary year.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[760px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className={TH}>Date</TableHead>
                  <TableHead className={TH}>Project</TableHead>
                  <TableHead className={TH}>Kind</TableHead>
                  <TableHead className={`${TH} text-right`}>Amount</TableHead>
                  <TableHead className={TH}>Given by</TableHead>
                  <TableHead className={TH}>Description</TableHead>
                  <TableHead className={TH}><span className="sr-only">Remove</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => (
                  <TableRow key={c.id} className="border-b last:border-0">
                    <TableCell className="p-3 whitespace-nowrap">{fmt.date(c.contributionDate.slice(0, 10))}</TableCell>
                    <TableCell className="p-3">{c.projectTitle ?? ""}</TableCell>
                    <TableCell className="p-3">{c.kind === "cash" ? "Cash" : "In kind"}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.money(c.amount, c.currency)}</TableCell>
                    <TableCell className="p-3">{c.contributor ?? ""}</TableCell>
                    <TableCell className="p-3">{c.description ?? ""}</TableCell>
                    <TableCell className="p-3 text-right">
                      <Button size="sm" variant="ghost" aria-label="Remove contribution" disabled={deleting === c.id} onClick={() => remove(c)}>
                        {deleting === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
