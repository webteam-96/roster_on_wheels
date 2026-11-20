"use client";

/** Club Admin Dashboard › Accounts, second package (gap agent 2026-11-20): payees, bank reconciliation, dues owed by age. */

import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Plus, Save, Undo2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat, useToday } from "@/hooks/useFormat";
import { parseAmount } from "@/lib/clubAccounts";
import {
  addStatementLines, autoMatchStatement, deleteStatementLine, getAgedBalances, getReconciliation, importStatementCsv,
  matchStatementLine, saveClubVendor, unmatchStatementLine,
  type AgedReport, type ClubAccount, type ClubVendor, type Reconciliation,
} from "@/services/api";
import { ExportButtons, errorText } from "./AccountsParts";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const TH = "p-3 font-medium";
const HEAD = "bg-[#EDF4FB] text-[13px] text-[#64748B]";
const day = (iso: string) => iso.slice(0, 10);

type Callbacks = { onError: (m: string) => void };

// ===== Payees =====

const NO_VENDOR = { name: "", email: "", phone: "", address: "", notes: "", isActive: true };

export function VendorsTab({ clubId, vendors, onChanged, onError }: { clubId: number; vendors: ClubVendor[]; onChanged: () => void } & Callbacks) {
  const fmt = useFormat();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(NO_VENDOR);
  const [busy, setBusy] = useState(false);

  const open = (v: ClubVendor | null) => {
    setEditing(v ? v.id : "new");
    setForm(v ? { name: v.name, email: v.email ?? "", phone: v.phone ?? "", address: v.address ?? "", notes: v.notes ?? "", isActive: v.isActive } : NO_VENDOR);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const blank = (s: string) => s.trim() || null;
      await saveClubVendor(clubId, editing === "new" ? null : editing, {
        name: form.name.trim(), email: blank(form.email), phone: blank(form.phone), address: blank(form.address), notes: blank(form.notes), isActive: form.isActive,
      });
      setEditing(null);
      onChanged();
    } catch (err) {
      onError(errorText(err, "Could not save the payee."));
    } finally {
      setBusy(false);
    }
  };

  const field = (id: keyof typeof NO_VENDOR, label: string, max: number, span = "") => (
    <div className={`space-y-1.5 ${span}`}>
      <Label htmlFor={`v-${id}`}>{label}</Label>
      <Input id={`v-${id}`} maxLength={max} required={id === "name"} type={id === "email" ? "email" : "text"}
        value={form[id] as string} onChange={(e) => setForm({ ...form, [id]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3">
        <p className="text-sm text-muted-foreground">People and businesses the club pays. Choose a payee when you record money out, and print a voucher for it.</p>
        {editing === null && <Button className="gap-1.5" onClick={() => open(null)}><Plus className="h-4 w-4" /> Add payee</Button>}
      </div>
      {editing !== null && (
        <Card><CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {field("name", "Name", 150, "md:col-span-3")}
            {field("email", "Email", 150, "md:col-span-2")}
            {field("phone", "Phone", 40)}
            {field("address", "Address", 300, "md:col-span-3")}
            {field("notes", "Notes", 500, "md:col-span-3")}
            <label className="flex items-center gap-2 text-sm md:col-span-6">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> In use
            </label>
            <div className="flex gap-2 md:col-span-6">
              <Button type="submit" disabled={busy || !form.name.trim()} className="gap-1.5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </CardContent></Card>
      )}
      {vendors.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No payees yet.</CardContent></Card>
      ) : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className={HEAD}>
              <tr className="border-b text-left"><th className={TH}>Payee</th><th className={TH}>Contact</th><th className={`${TH} text-right`}>Paid this Rotary year</th><th className={TH}><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className={`border-b last:border-0 ${v.isActive ? "" : "text-muted-foreground"}`}>
                  <td className="p-3">{v.name}{!v.isActive && <span className="text-xs"> (not in use)</span>}</td>
                  <td className="p-3">{[v.email, v.phone].filter(Boolean).join(", ")}</td>
                  <td className="p-3 text-right tabular-nums">{fmt.money(v.paidThisYear)}</td>
                  <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => open(v)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}

// ===== Bank reconciliation =====

export function ReconcileTab({ clubId, accounts, onError }: { clubId: number; accounts: ClubAccount[] } & Callbacks) {
  const fmt = useFormat();
  const today = useToday();
  const banks = accounts.filter((a) => a.type === "asset" && (a.isBank || a.systemKey === "cash"));
  const [accountId, setAccountId] = useState<number | null>(banks[0]?.id ?? null);
  const [data, setData] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [line, setLine] = useState({ date: today, description: "", amount: "" });
  const [picking, setPicking] = useState<Record<number, number | "">>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!accountId) return;
    getReconciliation(clubId, accountId).then(setData).catch((err) => onError(errorText(err, "Could not load the reconciliation.")));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [clubId, accountId]);

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await action();
      setNote(msg || null);
      load();
    } catch (err) {
      onError(errorText(err, "Could not do that."));
    } finally {
      setBusy(null);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file || !accountId) return;
    run("import", async () => {
      try {
        const r = await importStatementCsv(clubId, accountId, file);
        setProblems(r.problems);
        return `${r.added} statement lines added.`;
      } catch (err) {
        const data = (err as { response?: { data?: { problems?: string[] } } })?.response?.data;
        setProblems(data?.problems ?? []);
        throw err;
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const amount = line.amount.trim().startsWith("-") ? parseAmount(line.amount.trim().slice(1)) : parseAmount(line.amount);
  const signed = amount === null ? null : line.amount.trim().startsWith("-") ? -amount : amount;

  if (banks.length === 0) return <Card><CardContent className="p-5 text-sm text-muted-foreground">Add a bank account in the chart of accounts first.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] space-y-1.5">
          <Label htmlFor="r-acct">Bank account</Label>
          <select id="r-acct" className={SELECT} value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
            {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="r-file" onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Import statement CSV
          </Button>
          <Button disabled={!!busy || !data} onClick={() => accountId && run("auto", async () => `${(await autoMatchStatement(clubId, accountId)).matched} lines matched.`)}>
            {busy === "auto" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Match same amounts
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">CSV columns: date, description, amount. Money into the bank is positive, money out negative. Dates as 2026-11-20 or 20/11/2026.</p>
      {note && <p className="text-sm" role="status">{note}</p>}
      {problems.length > 0 && (
        <Card><CardContent className="p-4 text-sm">
          <p className="font-medium">Lines not added</p>
          <ul className="list-disc pl-5">{problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}</ul>
        </CardContent></Card>
      )}

      {!data ? <TableSkeleton rows={6} /> : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Balance in the books", data.bookBalance],
              ["Reconciled balance", data.reconciledBalance],
              ["Not yet on a statement", data.unreconciledBook],
              ["Statement lines total", data.statementTotal],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-md border bg-card p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{fmt.money(value as number)}</p>
              </div>
            ))}
          </section>

          <Card><CardContent className="space-y-3 p-5">
            <h3 className="text-lg font-semibold">Add a statement line</h3>
            <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => {
              e.preventDefault();
              if (signed === null || !accountId) return;
              run("add", async () => {
                await addStatementLines(clubId, accountId, [{ lineDate: line.date, description: line.description.trim(), amount: signed }]);
                setLine({ date: today, description: "", amount: "" });
                return "Statement line added.";
              });
            }}>
              <div className="space-y-1.5"><Label htmlFor="s-date">Date</Label><Input id="s-date" type="date" required value={line.date} onChange={(e) => setLine({ ...line, date: e.target.value })} /></div>
              <div className="space-y-1.5 md:col-span-3"><Label htmlFor="s-desc">Description</Label><Input id="s-desc" required maxLength={255} value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="s-amt">Amount (minus for money out)</Label><Input id="s-amt" inputMode="decimal" required value={line.amount} aria-invalid={line.amount !== "" && signed === null} onChange={(e) => setLine({ ...line, amount: e.target.value })} /></div>
              <div className="flex items-end"><Button type="submit" className="w-full gap-1.5" disabled={!!busy || signed === null || !line.description.trim()}><Plus className="h-4 w-4" /> Add</Button></div>
            </form>
          </CardContent></Card>

          <section className="space-y-2">
            <h3 className="text-lg font-semibold">Statement</h3>
            {data.statement.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">No statement lines yet. Import the bank's CSV or add lines by hand.</CardContent></Card>
            ) : (
              <Card><CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className={HEAD}>
                    <tr className="border-b text-left"><th className={TH}>Date</th><th className={TH}>Description</th><th className={`${TH} text-right`}>Amount</th><th className={TH}>Matched to</th><th className={TH}><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {data.statement.map((s) => {
                      const candidates = data.unmatchedBook.filter((b) => b.amount === s.amount);
                      return (
                        <tr key={s.id} className="border-b align-top last:border-0">
                          <td className="whitespace-nowrap p-3">{fmt.date(day(s.lineDate))}</td>
                          <td className="p-3">{s.description}</td>
                          <td className="p-3 text-right tabular-nums">{fmt.money(s.amount)}</td>
                          <td className="p-3">
                            {s.journalLineId ? (
                              <span>Entry {s.journalEntryId}: {s.journalMemo}</span>
                            ) : candidates.length === 0 ? (
                              <span className="text-muted-foreground">No book entry with this amount yet</span>
                            ) : (
                              <select aria-label={`Book entry for ${s.description}`} className={SELECT} value={picking[s.id] ?? ""}
                                onChange={(e) => setPicking({ ...picking, [s.id]: Number(e.target.value) || "" })}>
                                <option value="">Choose a book entry</option>
                                {candidates.map((b) => <option key={b.journalLineId} value={b.journalLineId}>{day(b.entryDate)} entry {b.entryId}: {b.memo}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="space-x-1.5 whitespace-nowrap p-3 text-right">
                            {s.journalLineId ? (
                              <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => run(`u${s.id}`, async () => { await unmatchStatementLine(clubId, s.id); })}>
                                <Undo2 className="h-4 w-4" /> Undo
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" disabled={!!busy || !picking[s.id]} onClick={() => run(`m${s.id}`, async () => { await matchStatementLine(clubId, s.id, picking[s.id] as number); })}>Match</Button>
                                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`d${s.id}`, async () => { await deleteStatementLine(clubId, s.id); })}>Remove</Button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent></Card>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-lg font-semibold">In the books, not yet on a statement</h3>
            {data.unmatchedBook.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">Every book entry on this account is reconciled.</CardContent></Card>
            ) : (
              <Card><CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className={HEAD}><tr className="border-b text-left"><th className={TH}>Date</th><th className={TH}>Entry</th><th className={`${TH} text-right`}>Amount</th></tr></thead>
                  <tbody>
                    {data.unmatchedBook.map((b) => (
                      <tr key={b.journalLineId} className="border-b last:border-0">
                        <td className="p-3">{fmt.date(day(b.entryDate))}</td>
                        <td className="p-3">Entry {b.entryId}: {b.memo}{b.reference ? `, ref. ${b.reference}` : ""}</td>
                        <td className="p-3 text-right tabular-nums">{fmt.money(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent></Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ===== Aged balances =====

export function AgedBalances({ clubId, today, onError }: { clubId: number; today: string } & Callbacks) {
  const fmt = useFormat();
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<AgedReport | null>(null);
  useEffect(() => {
    if (!asOf) return;
    setData(null);
    getAgedBalances(clubId, asOf).then(setData).catch((err) => onError(errorText(err, "Could not build the report.")));
  }, [clubId, asOf, onError]);
  const cols = [["notDue", "Not yet due"], ["days0To30", "0 to 30 days"], ["days31To60", "31 to 60"], ["days61To90", "61 to 90"], ["over90", "Over 90"], ["total", "Total"]] as const;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="ag-asof">As of</Label><Input id="ag-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        <div className="ml-auto"><ExportButtons clubId={clubId} report="aged" params={{ asOf }} onError={onError} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Membership dues not yet paid, by days since they fell due. Dues fall due when the club raises them; a second half falls due six months later.</p>
      {!data ? <TableSkeleton rows={6} /> : data.rows.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No member owes dues on this date.</CardContent></Card>
      ) : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className={HEAD}>
              <tr className="border-b text-left"><th className={TH}>Member</th>{cols.map(([, label]) => <th key={label} className={`${TH} text-right`}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {[...data.rows, data.totals].map((r) => (
                <tr key={r.memberId} className={`border-b last:border-0 ${r.memberId === 0 ? "font-semibold" : ""}`}>
                  <td className="p-3" title={r.items.map((i) => `${i.item}: ${fmt.money(i.amount)}`).join("\n")}>{r.memberName}</td>
                  {cols.map(([key]) => (
                    <td key={key} className={`p-3 text-right tabular-nums ${key === "over90" && r.over90 > 0 ? "text-destructive" : ""}`}>{r[key] ? fmt.money(r[key]) : ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}
