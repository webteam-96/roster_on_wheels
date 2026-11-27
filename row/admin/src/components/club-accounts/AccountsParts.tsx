"use client";

/** Parts of Club Admin Dashboard › Accounts (gap agent 2026-11-19). */

import { ToggleButton } from "@/components/ui/text-buttons"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Plus, RotateCcw, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat, useToday } from "@/hooks/useFormat";
import { ACCOUNT_TYPES, draftTotals, parseAmount, rotaryYearRange, type DraftLine } from "@/lib/clubAccounts";
import {
  createJournalEntry, createQuickEntry, downloadAccountsReport, getBalanceSheet, getBudgetReport, getJournal,
  downloadVoucher, getProfitAndLoss, getRotaryYears, reverseJournalEntry, saveBudget, saveClubAccount,
  type AccountsReport, type ClubVendor, type BalanceSheet, type BudgetReport, type ClubAccount, type ClubAccountType, type JournalEntry,
  type LedgerReportLine, type ProfitAndLoss,
} from "@/services/api";
import type { RotaryYear } from "@/types/rotaryYear";
import { AgedBalances } from "./AccountsParts2";

const SELECT = "row-field w-full";
const TH = "p-3 font-medium";
const HEAD = "bg-muted text-[13px] text-muted-foreground";

export const errorText = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const day = (iso: string) => iso.slice(0, 10);

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const SOURCE_LABEL: Record<string, string> = { membership_dues_payment: "Dues payment" };

type Callbacks = { onError: (m: string) => void };

// ===== Entries table =====

/** A money-out entry: it credits a bank or cash account and is not itself a reversal. */
const isMoneyOut = (e: JournalEntry, assetIds: Set<number>) => !e.reversesEntryId && e.lines.some((l) => l.credit > 0 && assetIds.has(l.accountId));

export function EntryTable({ entries, onReverse, voucher }: {
  entries: JournalEntry[]; onReverse?: (e: JournalEntry) => void;
  voucher?: { clubId: number; assetIds: Set<number>; onError: (m: string) => void };
}) {
  const fmt = useFormat();
  const [printing, setPrinting] = useState<number | null>(null);
  const printVoucher = async (e: JournalEntry) => {
    if (!voucher) return;
    setPrinting(e.id);
    try {
      saveBlob(await downloadVoucher(voucher.clubId, e.id), `voucher-PV-${e.id}.pdf`);
    } catch {
      voucher.onError("The voucher could not be built.");
    } finally {
      setPrinting(null);
    }
  };
  const actions = !!onReverse || !!voucher;
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table className="w-full min-w-[760px] text-sm">
          <TableHeader className={HEAD}>
            <TableRow className="border-b">
              <TableHead className={TH}>Date</TableHead>
              <TableHead className={TH}>Description</TableHead>
              <TableHead className={TH}>Accounts</TableHead>
              <TableHead className={`${TH} text-right`}>Amount</TableHead>
              <TableHead className={TH}>Status</TableHead>
              {actions && <TableHead className={TH}><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id} className="border-b align-top last:border-0">
                <TableCell className="whitespace-nowrap p-3">{fmt.date(day(e.entryDate))}</TableCell>
                <TableCell className="p-3">
                  <p className="font-medium">{e.memo}</p>
                  <p className="text-xs text-muted-foreground">
                    Entry {e.id}{e.sourceType ? `, ${SOURCE_LABEL[e.sourceType] ?? e.sourceType}` : ""}{e.vendorName ? `, paid to ${e.vendorName}` : ""}
                    {e.reference ? `, ref. ${e.reference}` : ""}{e.createdByName ? `, by ${e.createdByName}` : ""}
                  </p>
                </TableCell>
                <TableCell className="p-3">
                  {e.lines.map((l, i) => (
                    <p key={i} className="tabular-nums">
                      {l.debit ? "Dr" : "Cr"} {l.code} {l.name} {fmt.money(l.debit || l.credit)}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="p-3 text-right tabular-nums">{fmt.money(e.total)}</TableCell>
                <TableCell className="p-3 text-xs">
                  {e.reversesEntryId ? `Reverses entry ${e.reversesEntryId}` : e.reversedByEntryId ? `Reversed by entry ${e.reversedByEntryId}` : "Posted"}
                </TableCell>
                {actions && (
                  <TableCell className="space-y-1.5 p-3 text-right">
                    {voucher && isMoneyOut(e, voucher.assetIds) && (
                      <Button size="sm" variant="outline" disabled={printing === e.id} onClick={() => printVoucher(e)}>
                        {printing === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Voucher
                      </Button>
                    )}
                    {onReverse && !e.reversesEntryId && !e.reversedByEntryId && (
                      <Button size="sm" variant="outline" onClick={() => onReverse(e)}>
                        <RotateCcw className="h-4 w-4" /> Reverse
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ===== Treasurer's quick entry =====

export function QuickEntry({ clubId, accounts, vendors, onSaved, onError }: { clubId: number; accounts: ClubAccount[]; vendors: ClubVendor[]; onSaved: () => void } & Callbacks) {
  const today = useToday();
  const [kind, setKind] = useState<"in" | "out">("in");
  const banks = accounts.filter((a) => a.isActive && a.type === "asset" && (a.isBank || a.systemKey === "cash"));
  const categories = accounts.filter((a) => a.isActive && a.type === (kind === "in" ? "income" : "expense"));
  const [bankId, setBankId] = useState<number | "">(banks[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(today);
  const [vendorId, setVendorId] = useState<number | "">("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const value = parseAmount(amount);

  const submit = async () => {
    if (!value || !bankId || !categoryId) return;
    setBusy(true);
    try {
      await createQuickEntry(clubId, {
        kind, entryDate: date, categoryAccountId: categoryId, bankAccountId: bankId, amount: value, memo: memo.trim(),
        vendorId: kind === "out" && vendorId ? vendorId : null, reference: reference.trim() || null,
      });
      setAmount(""); setMemo(""); setCategoryId(""); setVendorId(""); setReference(""); setSaved(true);
      onSaved();
    } catch (err) {
      onError(errorText(err, "Could not record the entry."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="row-h2">Record money in or out</h3>
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Direction">
            {(["in", "out"] as const).map((k) => (
              <ToggleButton pressed={kind === k} key={k} type="button"
                onClick={() => { setKind(k); setCategoryId(""); setSaved(false); }}>
                {k === "in" ? "Money in" : "Money out"}
              </ToggleButton>
            ))}
          </div>
        </div>
        <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="q-date">Date</Label>
            <Input id="q-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="q-cat">{kind === "in" ? "Income account" : "Expense account"}</Label>
            <NativeSelect id="q-cat"  required value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value) || "")}>
              <option value="">Choose</option>
              {categories.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-bank">{kind === "in" ? "Paid into" : "Paid from"}</Label>
            <NativeSelect id="q-bank"  required value={bankId} onChange={(e) => setBankId(Number(e.target.value) || "")}>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-amount">Amount</Label>
            <Input id="q-amount" inputMode="decimal" required value={amount} aria-invalid={amount !== "" && !value}
              onChange={(e) => { setAmount(e.target.value); setSaved(false); }} />
          </div>
          {kind === "out" && (
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="q-vendor">Paid to</Label>
              <NativeSelect id="q-vendor"  value={vendorId} onChange={(e) => setVendorId(Number(e.target.value) || "")}>
                <option value="">No payee</option>
                {vendors.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="q-ref">Cheque or reference</Label>
            <Input id="q-ref" maxLength={40} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className={`space-y-1.5 ${kind === "out" ? "md:col-span-2" : "md:col-span-4"}`}>
            <Label htmlFor="q-memo">Description</Label>
            <Input id="q-memo" required maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full" disabled={busy || !value || !bankId || !categoryId || !memo.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Record
            </Button>
          </div>
        </form>
        {amount !== "" && !value && <p className="text-sm text-destructive">Type an amount such as 1250.50.</p>}
        {saved && <p className="text-sm text-muted-foreground" role="status">Recorded.</p>}
      </CardContent>
    </Card>
  );
}

// ===== Journal =====

export function JournalTab({ clubId, accounts, onChanged, onError }: { clubId: number; accounts: ClubAccount[]; onChanged: () => void } & Callbacks) {
  const today = useToday();
  const year = rotaryYearRange(today);
  const [from, setFrom] = useState(year.from);
  const [to, setTo] = useState(year.to);
  const [accountId, setAccountId] = useState<number | "">("");
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<number | null>(null);

  const load = () => {
    setEntries(null);
    getJournal(clubId, { from, to, accountId: accountId || undefined })
      .then(setEntries)
      .catch((err) => { setEntries([]); onError(errorText(err, "Could not load the journal.")); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clubId, from, to, accountId]);

  const reverse = async (e: JournalEntry) => {
    if (!window.confirm(`Reverse entry ${e.id} (${e.memo})? A mirror entry dated today cancels it.`)) return;
    setReversing(e.id);
    try {
      await reverseJournalEntry(clubId, e.id, { entryDate: today });
      load();
      onChanged();
    } catch (err) {
      onError(errorText(err, "Could not reverse the entry."));
    } finally {
      setReversing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="j-from">From</Label>
          <Input id="j-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="j-to">To</Label>
          <Input id="j-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[14rem] space-y-1.5">
          <Label htmlFor="j-acct">Account</Label>
          <NativeSelect id="j-acct"  value={accountId} onChange={(e) => setAccountId(Number(e.target.value) || "")}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </NativeSelect>
        </div>
        <div className="ml-auto flex gap-2">
          <ExportButtons clubId={clubId} report="journal" params={{ from, to }} onError={onError} />
          {!adding && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New entry</Button>}
        </div>
      </div>
      {adding && (
        <EntryForm clubId={clubId} accounts={accounts} onError={onError} onDone={(saved) => { setAdding(false); if (saved) { load(); onChanged(); } }} />
      )}
      {reversing && <p className="text-sm text-muted-foreground" role="status">Reversing entry {reversing}.</p>}
      {entries === null ? (
        <TableSkeleton rows={5} />
      ) : entries.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No entries in this period.</CardContent></Card>
      ) : (
        <EntryTable entries={entries} onReverse={reverse}
          voucher={{ clubId, assetIds: new Set(accounts.filter((a) => a.type === "asset").map((a) => a.id)), onError }} />
      )}
    </div>
  );
}

function EntryForm({ clubId, accounts, onDone, onError }: { clubId: number; accounts: ClubAccount[]; onDone: (saved: boolean) => void } & Callbacks) {
  const fmt = useFormat();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: null, debit: "", credit: "" }, { accountId: null, debit: "", credit: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const totals = draftTotals(lines);
  const active = accounts.filter((a) => a.isActive);
  const set = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setBusy(true);
    try {
      await createJournalEntry(clubId, {
        entryDate: date, memo: memo.trim(),
        lines: lines.filter((l) => l.accountId && (l.debit.trim() || l.credit.trim())).map((l) => ({
          accountId: l.accountId!, debit: parseAmount(l.debit) ?? 0, credit: parseAmount(l.credit) ?? 0, description: null,
        })),
      });
      onDone(true);
    } catch (err) {
      onError(errorText(err, "Could not post the entry."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h3 className="row-h2">New journal entry</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-date">Date</Label>
            <Input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label htmlFor="e-memo">Description</Label>
            <Input id="e-memo" maxLength={255} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
        <Table className="w-full text-sm">
          <TableHeader><TableRow><TableHead className="pb-1">Account</TableHead><TableHead className="w-36 pb-1">Debit</TableHead><TableHead className="w-36 pb-1">Credit</TableHead></TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="py-1 pr-2">
                  <NativeSelect aria-label={`Account, line ${i + 1}`}  value={l.accountId ?? ""} onChange={(e) => set(i, { accountId: Number(e.target.value) || null })}>
                    <option value="">Choose</option>
                    {active.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </NativeSelect>
                </TableCell>
                <TableCell className="py-1 pr-2"><Input aria-label={`Debit, line ${i + 1}`} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value })} /></TableCell>
                <TableCell className="py-1"><Input aria-label={`Credit, line ${i + 1}`} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value })} /></TableCell>
              </TableRow>
            ))}
            <TableRow className="font-medium">
              <TableCell className="pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { accountId: null, debit: "", credit: "" }])}>
                  <Plus className="h-4 w-4" /> Add line
                </Button>
              </TableCell>
              <TableCell className="pt-2 tabular-nums">{fmt.money(totals.debit)}</TableCell>
              <TableCell className="pt-2 tabular-nums">{fmt.money(totals.credit)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {totals.problem && <p className="text-sm text-muted-foreground">{totals.problem}</p>}
        <div className="flex gap-2">
          <Button disabled={busy || !totals.balanced || !memo.trim()} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Post entry
          </Button>
          <Button variant="outline" onClick={() => onDone(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Chart of accounts =====

const BLANK = { code: "", name: "", type: "expense" as ClubAccountType, isBank: false, bankName: "", accountLast4: "", isActive: true };

export function ChartTab({ clubId, accounts, onChanged, onError }: { clubId: number; accounts: ClubAccount[]; onChanged: () => void } & Callbacks) {
  const fmt = useFormat();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const open = (a: ClubAccount | null) => {
    setEditing(a ? a.id : "new");
    setForm(a ? { code: a.code, name: a.name, type: a.type, isBank: a.isBank, bankName: a.bankName ?? "", accountLast4: a.accountLast4 ?? "", isActive: a.isActive } : BLANK);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await saveClubAccount(clubId, editing === "new" ? null : editing, {
        ...form, code: form.code.trim(), name: form.name.trim(),
        bankName: form.isBank ? form.bankName.trim() || null : null, accountLast4: form.isBank ? form.accountLast4.trim() || null : null,
      });
      setEditing(null);
      onChanged();
    } catch (err) {
      onError(errorText(err, "Could not save the account."));
    } finally {
      setBusy(false);
    }
  };

  const current = editing && editing !== "new" ? accounts.find((a) => a.id === editing) : null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3">
        <p className="text-sm text-muted-foreground">Every club starts with this chart. Add accounts, rename them, or switch off ones you do not use. An account with entries keeps its type.</p>
        {editing === null && <Button onClick={() => open(null)}><Plus className="h-4 w-4" /> Add account</Button>}
      </div>
      {editing !== null && (
        <Card>
          <CardContent className="p-5">
            <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div className="space-y-1.5">
                <Label htmlFor="a-code">Code</Label>
                <Input id="a-code" required maxLength={10} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <Label htmlFor="a-name">Name</Label>
                <Input id="a-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="a-type">Type</Label>
                <NativeSelect id="a-type"  value={form.type} disabled={!!current?.used}
                  onChange={(e) => { const type = e.target.value as ClubAccountType; setForm({ ...form, type, isBank: type === "asset" && form.isBank }); }}>
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </NativeSelect>
              </div>
              {form.type === "asset" && (
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input type="checkbox" checked={form.isBank} onChange={(e) => setForm({ ...form, isBank: e.target.checked })} /> This is a bank account
                </label>
              )}
              {form.isBank && (
                <>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="a-bank">Bank</Label>
                    <Input id="a-bank" maxLength={120} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="a-last4">Last 4 digits</Label>
                    <Input id="a-last4" inputMode="numeric" maxLength={4} value={form.accountLast4} onChange={(e) => setForm({ ...form, accountLast4: e.target.value })} />
                  </div>
                </>
              )}
              <label className="flex items-center gap-2 text-sm md:col-span-6">
                <input type="checkbox" checked={form.isActive} disabled={!!current?.systemKey} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> In use
              </label>
              <div className="flex gap-2 md:col-span-6">
                <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="w-full min-w-[640px] text-sm">
            <TableHeader className={HEAD}>
              <TableRow className="border-b"><TableHead className={TH}>Code</TableHead><TableHead className={TH}>Account</TableHead><TableHead className={TH}>Type</TableHead><TableHead className={`${TH} text-right`}>Balance</TableHead><TableHead className={TH}><span className="sr-only">Actions</span></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className={`border-b last:border-0 ${a.isActive ? "" : "text-muted-foreground"}`}>
                  <TableCell className="p-3 tabular-nums">{a.code}</TableCell>
                  <TableCell className="p-3">
                    {a.name}
                    {a.isBank && <span className="text-xs text-muted-foreground"> {[a.bankName, a.accountLast4 && `ending ${a.accountLast4}`].filter(Boolean).join(", ")}</span>}
                    {!a.isActive && <span className="text-xs"> (not in use)</span>}
                  </TableCell>
                  <TableCell className="p-3">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}</TableCell>
                  <TableCell className="p-3 text-right tabular-nums">{fmt.money(a.balance)}</TableCell>
                  <TableCell className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => open(a)}>Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Reports =====

export function ExportButtons({ clubId, report, params, onError }: { clubId: number; report: AccountsReport; params: Record<string, string | number> } & Callbacks) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (format: "csv" | "xlsx" | "pdf") => {
    setBusy(format);
    try {
      saveBlob(await downloadAccountsReport(clubId, report, format, params), `${report}.${format}`);
    } catch {
      onError("The download could not be built.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex gap-1.5">
      {(["csv", "xlsx", "pdf"] as const).map((f) => (
        <Button key={f} variant="outline" size="sm" disabled={!!busy} onClick={() => go(f)}>
          {busy === f ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {f === "xlsx" ? "Excel" : f.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: LedgerReportLine[]; total: number; totalLabel: string }) {
  const fmt = useFormat();
  return (
    <>
      <TableRow className="border-b"><TableCell colSpan={2} className="px-3 pb-1 pt-4 font-semibold">{title}</TableCell></TableRow>
      {lines.length === 0 && <TableRow><TableCell colSpan={2} className="px-3 py-2 text-muted-foreground">Nothing in this period.</TableCell></TableRow>}
      {lines.map((l) => (
        <TableRow key={l.accountId} className="border-b"><TableCell className="px-3 py-2">{l.code} {l.name}</TableCell><TableCell className="px-3 py-2 text-right tabular-nums">{fmt.money(l.amount)}</TableCell></TableRow>
      ))}
      <TableRow className="border-b font-medium"><TableCell className="px-3 py-2">{totalLabel}</TableCell><TableCell className="px-3 py-2 text-right tabular-nums">{fmt.money(total)}</TableCell></TableRow>
    </>
  );
}

export function ReportsTab({ clubId, accounts, onError }: { clubId: number; accounts: ClubAccount[] } & Callbacks) {
  const today = useToday();
  const [report, setReport] = useState<"profit-loss" | "balance-sheet" | "budget" | "aged">("profit-loss");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Report">
        {([["profit-loss", "Profit and loss"], ["balance-sheet", "Balance sheet"], ["budget", "Budget against actual"], ["aged", "Dues owed by age"]] as const).map(([k, label]) => (
          <ToggleButton pressed={report === k} key={k} type="button" onClick={() => setReport(k)}
           >{label}</ToggleButton>
        ))}
      </div>
      {report === "profit-loss" && <ProfitLossReport clubId={clubId} today={today} onError={onError} />}
      {report === "balance-sheet" && <BalanceSheetReport clubId={clubId} today={today} onError={onError} />}
      {report === "budget" && <BudgetVsActual clubId={clubId} accounts={accounts} onError={onError} />}
      {report === "aged" && <AgedBalances clubId={clubId} today={today} onError={onError} />}
    </div>
  );
}

function ProfitLossReport({ clubId, today, onError }: { clubId: number; today: string } & Callbacks) {
  const fmt = useFormat();
  const year = rotaryYearRange(today);
  const [from, setFrom] = useState(year.from);
  const [to, setTo] = useState(year.to);
  const [data, setData] = useState<ProfitAndLoss | null>(null);
  useEffect(() => {
    if (!from || !to) return;
    setData(null);
    getProfitAndLoss(clubId, from, to).then(setData).catch((err) => onError(errorText(err, "Could not build the report.")));
  }, [clubId, from, to, onError]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="pl-from">From</Label><Input id="pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pl-to">To</Label><Input id="pl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto"><ExportButtons clubId={clubId} report="profit-loss" params={{ from, to }} onError={onError} /></div>
      </div>
      {!data ? <TableSkeleton rows={6} /> : (
        <Card><CardContent className="overflow-x-auto p-0">
          <Table className="w-full text-sm"><TableBody>
            <Section title="Income" lines={data.income} total={data.totalIncome} totalLabel="Total income" />
            <Section title="Expenses" lines={data.expenses} total={data.totalExpenses} totalLabel="Total expenses" />
            <TableRow className="font-semibold"><TableCell className="px-3 py-3">{data.net < 0 ? "Deficit" : "Surplus"}</TableCell><TableCell className="px-3 py-3 text-right tabular-nums">{fmt.money(data.net)}</TableCell></TableRow>
          </TableBody></Table>
        </CardContent></Card>
      )}
    </div>
  );
}

function BalanceSheetReport({ clubId, today, onError }: { clubId: number; today: string } & Callbacks) {
  const fmt = useFormat();
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<BalanceSheet | null>(null);
  useEffect(() => {
    if (!asOf) return;
    setData(null);
    getBalanceSheet(clubId, asOf).then(setData).catch((err) => onError(errorText(err, "Could not build the report.")));
  }, [clubId, asOf, onError]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="bs-asof">As of</Label><Input id="bs-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        <div className="ml-auto"><ExportButtons clubId={clubId} report="balance-sheet" params={{ asOf }} onError={onError} /></div>
      </div>
      {!data ? <TableSkeleton rows={6} /> : (
        <Card><CardContent className="overflow-x-auto p-0">
          <Table className="w-full text-sm"><TableBody>
            <Section title="Assets" lines={data.assets} total={data.totalAssets} totalLabel="Total assets" />
            <Section title="Liabilities" lines={data.liabilities} total={data.totalLiabilities} totalLabel="Total liabilities" />
            <Section title="Club funds" lines={[...data.equity, { accountId: -1, code: "", name: "Surplus to date", amount: data.currentEarnings }]}
              total={data.totalEquity} totalLabel="Total club funds" />
            <TableRow className="font-semibold">
              <TableCell className="px-3 py-3">Liabilities and club funds</TableCell>
              <TableCell className="px-3 py-3 text-right tabular-nums">{fmt.money(data.totalLiabilities + data.totalEquity)}</TableCell>
            </TableRow>
          </TableBody></Table>
          {!data.balanced && <p className="p-3 text-sm text-destructive">The books do not balance. Tell ROW support.</p>}
        </CardContent></Card>
      )}
    </div>
  );
}

function BudgetVsActual({ clubId, accounts, onError }: { clubId: number; accounts: ClubAccount[] } & Callbacks) {
  const fmt = useFormat();
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [data, setData] = useState<BudgetReport | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getRotaryYears()
      .then((ys) => {
        const sorted = [...ys].sort((a, b) => b.startDate.localeCompare(a.startDate));
        setYears(sorted);
        setYearId(sorted.find((y) => y.isCurrent)?.id ?? sorted[0]?.id ?? null);
      })
      .catch(() => onError("Could not load the Rotary years."));
  }, [onError]);

  const load = () => {
    if (!yearId) return;
    setData(null);
    getBudgetReport(clubId, yearId)
      .then((r) => { setData(r); setEdits({}); })
      .catch((err) => onError(errorText(err, "Could not build the report.")));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clubId, yearId]);

  const budgetable = accounts.filter((a) => a.isActive && (a.type === "income" || a.type === "expense"));
  const lineFor = (id: number) => data?.report.lines.find((l) => l.accountId === id);
  const invalid = Object.values(edits).some((v) => v.trim() !== "" && parseAmount(v) === null);

  const save = async () => {
    if (!yearId) return;
    setBusy(true);
    try {
      await saveBudget(clubId, yearId, Object.entries(edits).map(([id, v]) => ({ accountId: Number(id), amount: parseAmount(v) ?? 0 })));
      setSaved(true);
      load();
    } catch (err) {
      onError(errorText(err, "Could not save the budget."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] space-y-1.5">
          <Label htmlFor="b-year">Rotary year</Label>
          <NativeSelect id="b-year"  value={yearId ?? ""} onChange={(e) => { setYearId(Number(e.target.value)); setSaved(false); }}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
          </NativeSelect>
        </div>
        <div className="ml-auto flex gap-2">
          {yearId && <ExportButtons clubId={clubId} report="budget" params={{ yearId }} onError={onError} />}
          <Button disabled={busy || invalid || Object.keys(edits).length === 0} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save budget
          </Button>
        </div>
      </div>
      {saved && <p className="text-sm text-muted-foreground" role="status">Budget saved.</p>}
      {!data ? <TableSkeleton rows={8} /> : (
        <Card><CardContent className="overflow-x-auto p-0">
          <Table className="w-full min-w-[720px] text-sm">
            <TableHeader className={HEAD}>
              <TableRow className="border-b">
                <TableHead className={TH}>Account</TableHead><TableHead className={`${TH} w-40`}>Budget</TableHead><TableHead className={`${TH} text-right`}>Actual</TableHead>
                <TableHead className={`${TH} text-right`}>Variance</TableHead><TableHead className={`${TH} text-right`}>Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["income", "expense"] as const).map((type) => (
                <BudgetRows key={type} title={type === "income" ? "Income" : "Expenses"}
                  accounts={budgetable.filter((a) => a.type === type)} lineFor={lineFor} edits={edits}
                  onEdit={(id, v) => { setEdits((e) => ({ ...e, [id]: v })); setSaved(false); }} money={fmt.money} />
              ))}
              <TableRow className="font-medium">
                <TableCell className="p-3">Planned surplus / actual surplus</TableCell>
                <TableCell className="p-3 tabular-nums">{fmt.money(data.report.budgetIncome - data.report.budgetExpenses)}</TableCell>
                <TableCell className="p-3 text-right tabular-nums">{fmt.money(data.report.actualIncome - data.report.actualExpenses)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
          <p className="p-3 text-xs text-muted-foreground">Variance is positive when it helps the club: more income than planned, or less spent.</p>
        </CardContent></Card>
      )}
    </div>
  );
}

function BudgetRows({ title, accounts, lineFor, edits, onEdit, money }: {
  title: string; accounts: ClubAccount[]; lineFor: (id: number) => { budget: number; actual: number; variance: number; percentUsed: number | null } | undefined;
  edits: Record<number, string>; onEdit: (id: number, v: string) => void; money: (n: number) => string;
}) {
  return (
    <>
      <TableRow className="border-b"><TableCell colSpan={5} className="px-3 pb-1 pt-4 font-semibold">{title}</TableCell></TableRow>
      {accounts.map((a) => {
        const l = lineFor(a.id);
        const value = edits[a.id] ?? (l?.budget ? String(l.budget) : "");
        return (
          <TableRow key={a.id} className="border-b">
            <TableCell className="p-3">{a.code} {a.name}</TableCell>
            <TableCell className="p-2"><Input aria-label={`Budget for ${a.name}`} inputMode="decimal" value={value} onChange={(e) => onEdit(a.id, e.target.value)} /></TableCell>
            <TableCell className="p-3 text-right tabular-nums">{money(l?.actual ?? 0)}</TableCell>
            <TableCell className={`p-3 text-right tabular-nums ${(l?.variance ?? 0) < 0 ? "text-destructive" : ""}`}>{l ? money(l.variance) : ""}</TableCell>
            <TableCell className="p-3 text-right tabular-nums">{l?.percentUsed != null ? `${l.percentUsed}%` : ""}</TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
