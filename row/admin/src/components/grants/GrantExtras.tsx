"use client";

/**
 * Grants extras on the district grants page (api/Services/GrantService.Extras.cs): qualified clubs per Rotary year,
 * the monthly cash flow with recorded receipts and its Excel export, and the editable notification email templates.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useState } from "react";
import { Download, Loader2, Save, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat, useToday } from "@/hooks/useFormat";
import {
  addGrantReceipt, deleteGrantReceipt, downloadGrantMonthlyCashFlow, getClubMembersForAttendance, getGrantEmailTemplates,
  getGrantMonthlyCashFlow, getGrantQualifications, getGrantSettings, previewGrantEmailTemplate, saveGrantSettings, resetGrantEmailTemplate, saveGrantEmailTemplate,
  saveGrantQualification,
} from "@/services/api";
import { dayInput, orNull } from "@/lib/grants";
import type { ClubMemberSimple } from "@/types/attendance";
import type {
  GrantClubQualification, GrantEmailTemplate, GrantMonthlyCashFlow, SaveGrantQualification,
} from "@/types/grants";

const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const SELECT = "row-field w-full";

function Panel({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="row-h2">{title}</h3>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ===== Qualified clubs =====

export function QualifiedClubs({ districtId, yearId, yearLabel, onError }: {
  districtId: number; yearId: number; yearLabel: string; onError: (m: string) => void;
}) {
  const fmt = useFormat();
  const [rows, setRows] = useState<GrantClubQualification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<GrantClubQualification | null>(null);
  const [required, setRequired] = useState<boolean | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);

  useEffect(() => {
    setRequired(null);
    getGrantSettings(districtId).then((s) => setRequired(s.requireQualification)).catch(() => setRequired(false));
  }, [districtId]);

  const toggleRequired = async (value: boolean) => {
    setSavingSetting(true);
    try {
      setRequired((await saveGrantSettings(districtId, { requireQualification: value })).requireQualification);
    } catch (err) {
      onError(message(err, "Could not save the setting."));
    } finally {
      setSavingSetting(false);
    }
  };

  useEffect(() => {
    setRows(null);
    setFailed(false);
    getGrantQualifications(districtId, yearId).then(setRows).catch(() => setFailed(true));
  }, [districtId, yearId]);

  const qualified = rows?.filter((r) => r.qualified).length ?? 0;
  return (
    <Panel title={`Qualified clubs, ${yearLabel}`}
      hint="The MOU signed and grant training attended for this year. Unqualified clubs are warned, or blocked when you require qualification.">
      {required === null ? (
        <div className="h-6 w-80 animate-pulse rounded-md bg-muted" aria-busy="true" />
      ) : (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={required} disabled={savingSetting} onCheckedChange={(v) => toggleRequired(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium">Require club qualification to submit</span>
            <span className="block text-xs text-muted-foreground">
              {required
                ? "On: a club that is not qualified for the year cannot submit or resubmit an application."
                : "Off: a club that is not qualified sees a warning but can still submit."}
            </span>
          </span>
        </label>
      )}
      {failed ? (
        <Card><CardContent className="p-5 text-sm text-red-700" role="alert">Could not load the clubs.</CardContent></Card>
      ) : rows === null ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No active clubs in this district.</CardContent></Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{qualified} of {rows.length} clubs qualified.</p>
          {editing && (
            <QualificationForm key={editing.clubId} districtId={districtId} yearId={yearId} row={editing} onError={onError}
              onClose={() => setEditing(null)}
              onSaved={(q) => { setRows((list) => list?.map((r) => (r.clubId === q.clubId ? q : r)) ?? null); setEditing(null); }} />
          )}
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table className="w-full min-w-[760px] text-sm">
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="p-3">Club</TableHead>
                    <TableHead className="p-3">Status</TableHead>
                    <TableHead className="p-3">MOU signed</TableHead>
                    <TableHead className="p-3">Training</TableHead>
                    <TableHead className="p-3">Expires</TableHead>
                    <TableHead className="p-3">Trained members</TableHead>
                    <TableHead className="p-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.clubId} className="border-b last:border-0">
                      <TableCell className="p-3">{r.clubName}</TableCell>
                      <TableCell className="p-3">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${r.qualified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                          title={r.problem ?? undefined}>
                          {r.qualified ? "Qualified" : r.expiresOn && r.mouSignedOn && r.trainingOn ? "Expired" : "Not qualified"}
                        </span>
                      </TableCell>
                      <TableCell className="p-3">{r.mouSignedOn ? fmt.date(r.mouSignedOn) : ""}</TableCell>
                      <TableCell className="p-3">{r.trainingOn ? fmt.date(r.trainingOn) : ""}</TableCell>
                      <TableCell className="p-3">{r.expiresOn ? fmt.date(r.expiresOn) : ""}</TableCell>
                      <TableCell className="p-3">{r.members.length || ""}</TableCell>
                      <TableCell className="p-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </Panel>
  );
}

function QualificationForm({ districtId, yearId, row, onSaved, onClose, onError }: {
  districtId: number; yearId: number; row: GrantClubQualification;
  onSaved: (q: GrantClubQualification) => void; onClose: () => void; onError: (m: string) => void;
}) {
  const [form, setForm] = useState<SaveGrantQualification>(() => ({
    mouSignedOn: dayInput(row.mouSignedOn) || null,
    trainingOn: dayInput(row.trainingOn) || null,
    expiresOn: dayInput(row.expiresOn) || null,
    note: row.note,
    members: row.members.map((m) => ({ ...m, trainedOn: dayInput(m.trainedOn) || null })),
  }));
  const [roster, setRoster] = useState<ClubMemberSimple[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getClubMembersForAttendance(row.clubId).then(setRoster).catch(() => setRoster([]));
  }, [row.clubId]);

  const set = <K extends keyof SaveGrantQualification>(k: K, v: SaveGrantQualification[K]) => setForm((f) => ({ ...f, [k]: v }));
  const date = (k: "mouSignedOn" | "trainingOn" | "expiresOn", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`q-${k}`}>{label}</Label>
      <Input id={`q-${k}`} type="date" value={form[k] ?? ""} onChange={(e) => set(k, orNull(e.target.value))} />
    </div>
  );
  const available = (roster ?? []).filter((m) => !form.members.some((x) => x.memberId === m.id));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await saveGrantQualification(districtId, row.clubId, yearId, form));
    } catch (err) {
      onError(message(err, "Could not save the qualification."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <form className="space-y-4" onSubmit={save}>
          <h4 className="row-h2">{row.clubName}</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            {date("mouSignedOn", "MOU signed on")}
            {date("trainingOn", "Grant training attended on")}
            {date("expiresOn", "Qualification expires on")}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Members trained</p>
            {form.members.length === 0 && <p className="text-sm text-muted-foreground">No members listed.</p>}
            {form.members.map((m, i) => (
              <div key={m.memberId} className="grid items-center gap-2 sm:grid-cols-[1fr_11rem_auto]">
                <span className="text-sm">{m.memberName ?? roster?.find((r) => r.id === m.memberId)?.memberName ?? `Member ${m.memberId}`}</span>
                <Input aria-label="Trained on" type="date" value={m.trainedOn ?? ""}
                  onChange={(e) => set("members", form.members.map((x, j) => (j === i ? { ...x, trainedOn: orNull(e.target.value) } : x)))} />
                <Button type="button" variant="ghost" aria-label="Remove member"
                  onClick={() => set("members", form.members.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {roster === null ? (
              <div className="h-10 w-72 animate-pulse rounded-md bg-muted" aria-busy="true" />
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-72 space-y-1.5">
                  <Label htmlFor="q-pick">Add a trained member</Label>
                  <NativeSelect id="q-pick"  value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Choose a member</option>
                    {available.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
                  </NativeSelect>
                </div>
                <Button type="button" variant="outline" disabled={!pick} onClick={() => {
                  const m = roster.find((r) => r.id === Number(pick));
                  if (m) set("members", [...form.members, { memberId: m.id, memberName: m.memberName, trainedOn: form.trainingOn }]);
                  setPick("");
                }}>Add</Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-note">Note</Label>
            <Input id="q-note" maxLength={500} value={form.note ?? ""} onChange={(e) => set("note", e.target.value || null)} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ===== Monthly cash flow =====

export function MonthlyCashFlow({ districtId, cycleId, yearLabel, onError }: {
  districtId: number; cycleId: number; yearLabel: string; onError: (m: string) => void;
}) {
  const fmt = useFormat();
  const today = useToday();
  const [flow, setFlow] = useState<GrantMonthlyCashFlow | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [source, setSource] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    setFlow(null);
    setFailed(false);
    getGrantMonthlyCashFlow(districtId, cycleId).then(setFlow).catch(() => setFailed(true));
  }, [districtId, cycleId]);

  const work = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try { await fn(); } catch (err) { onError(message(err, fallback)); } finally { setBusy(false); }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    work(async () => {
      setFlow(await addGrantReceipt(districtId, cycleId, { amount: Number(amount), receivedOn, source: source.trim(), reference: orNull(reference) }));
      setAmount(""); setSource(""); setReference("");
    }, "Could not record the receipt.");
  };
  const remove = (id: number) => {
    if (!window.confirm("Delete this receipt?")) return;
    work(async () => {
      await deleteGrantReceipt(districtId, cycleId, id);
      setFlow(await getGrantMonthlyCashFlow(districtId, cycleId));
    }, "Could not delete the receipt.");
  };

  return (
    <Panel title="Cash flow by month"
      hint="Approved grants, payments out and money received (DDF from the Foundation, club refunds). Balance is received minus paid out."
      action={
        <Button variant="outline" disabled={busy || !flow}
          onClick={() => work(() => downloadGrantMonthlyCashFlow(districtId, cycleId, yearLabel), "Could not export.")}>
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      }>
      {failed ? (
        <Card><CardContent className="p-5 text-sm text-red-700" role="alert">Could not load the cash flow.</CardContent></Card>
      ) : flow === null ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          {flow.months.length === 0 ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">No approvals, payments or receipts in this year yet.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table className="w-full min-w-[620px] text-sm">
                  <TableHeader>
                    <TableRow className="border-b">
                      <TableHead className="p-3">Month</TableHead>
                      <TableHead className="p-3 text-right">Approved</TableHead>
                      <TableHead className="p-3 text-right">Paid out</TableHead>
                      <TableHead className="p-3 text-right">Received</TableHead>
                      <TableHead className="p-3 text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flow.months.map((m) => (
                      <TableRow key={m.month} className="border-b">
                        <TableCell className="p-3">{m.month}</TableCell>
                        <TableCell className="p-3 text-right tabular-nums">{fmt.money(m.approved)}</TableCell>
                        <TableCell className="p-3 text-right tabular-nums">{fmt.money(m.paidOut)}</TableCell>
                        <TableCell className="p-3 text-right tabular-nums">{fmt.money(m.receipts)}</TableCell>
                        <TableCell className={`p-3 text-right tabular-nums ${m.balance < 0 ? "text-red-700" : ""}`}>{fmt.money(m.balance)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell className="p-3">Total</TableCell>
                      <TableCell className="p-3 text-right tabular-nums">{fmt.money(flow.approved)}</TableCell>
                      <TableCell className="p-3 text-right tabular-nums">{fmt.money(flow.paidOut)}</TableCell>
                      <TableCell className="p-3 text-right tabular-nums">{fmt.money(flow.receipts)}</TableCell>
                      <TableCell className="p-3 text-right tabular-nums">{fmt.money(flow.balance)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 p-5">
              <h4 className="row-h2">Money received</h4>
              {flow.receiptList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipts recorded.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {flow.receiptList.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {fmt.date(r.receivedOn)}, {r.source}{r.reference ? `, ${r.reference}` : ""}
                        <span className="block text-xs text-muted-foreground">{r.recordedByName ?? ""}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{fmt.money(r.amount)}</span>
                        <Button size="sm" variant="ghost" aria-label={`Delete receipt ${r.source}`} disabled={busy} onClick={() => remove(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={add}>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-amount">Amount</Label>
                  <Input id="rc-amount" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-date">Received on</Label>
                  <Input id="rc-date" type="date" required max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-source">From</Label>
                  <Input id="rc-source" required maxLength={150} value={source} onChange={(e) => setSource(e.target.value)} placeholder="DDF from the Foundation" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-ref">Reference</Label>
                  <Input id="rc-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={busy || !amount || !source.trim()}>Record receipt</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </Panel>
  );
}

// ===== Email templates =====

const TEMPLATE_TITLE: Record<string, string> = {
  status: "Status and update emails",
  reminder: "Report reminder emails",
};

export function GrantEmailTemplates({ districtId, onError }: { districtId: number; onError: (m: string) => void }) {
  const [data, setData] = useState<{ templates: GrantEmailTemplate[]; placeholders: string[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    getGrantEmailTemplates(districtId).then(setData).catch(() => setFailed(true));
  }, [districtId]);

  return (
    <Panel title="Grant email templates"
      hint="The subject and text of the grant emails your district sends. Placeholders are filled in for each email.">
      {failed ? (
        <Card><CardContent className="p-5 text-sm text-red-700" role="alert">Could not load the templates.</CardContent></Card>
      ) : data === null ? (
        <TableSkeleton rows={3} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Placeholders: {data.placeholders.map((p) => `{{${p}}}`).join(", ")}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.templates.map((t) => (
              <TemplateEditor key={`${t.kind}-${t.isDefault}-${t.subject}`} districtId={districtId} template={t} onError={onError}
                onSaved={(n) => setData((d) => d && { ...d, templates: d.templates.map((x) => (x.kind === n.kind ? n : x)) })} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function TemplateEditor({ districtId, template, onSaved, onError }: {
  districtId: number; template: GrantEmailTemplate; onSaved: (t: GrantEmailTemplate) => void; onError: (m: string) => void;
}) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `tpl-${template.kind}`;

  const work = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try { await fn(); } catch (err) { onError(message(err, fallback)); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="row-h2">{TEMPLATE_TITLE[template.kind] ?? template.kind}</h4>
          <span className="text-xs text-muted-foreground">{template.isDefault ? "Built-in" : "Edited"}</span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-subject`}>Subject</Label>
          <Input id={`${id}-subject`} maxLength={250} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-body`}>Text</Label>
          <Textarea id={`${id}-body`} rows={7} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !subject.trim() || !body.trim()}
            onClick={() => work(async () => onSaved({ ...(await saveGrantEmailTemplate(districtId, template.kind, { subject, body })), isDefault: false }), "Could not save the template.")}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button variant="outline" disabled={busy || !subject.trim() || !body.trim()}
            onClick={() => work(async () => setPreview(await previewGrantEmailTemplate(districtId, template.kind, { subject, body })), "Could not preview.")}>
            Preview
          </Button>
          {!template.isDefault && (
            <Button variant="ghost" disabled={busy}
              onClick={() => work(async () => onSaved(await resetGrantEmailTemplate(districtId, template.kind)), "Could not reset.")}>
              Use the built-in email
            </Button>
          )}
        </div>
        {preview && (
          <div className="space-y-1 rounded-md border p-3">
            <p className="text-sm font-medium">{preview.subject}</p>
            {/* Server-rendered: the template text and every value are HTML-encoded (GrantService.RenderTemplate). */}
            <div className="text-sm" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
