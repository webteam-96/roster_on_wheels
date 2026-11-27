"use client";
import { LinkButton } from "@/components/ui/text-buttons";

// Club invoices and statements (gap #7): dues and item invoices, recorded payments, balances, statements, products
// and the QuickBooks export. All rules (numbering, splits, validation) live in the API; this page only collects input.
import { NativeSelect } from "@/components/ui/native-select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Mail, Plus, Receipt } from "@/components/icons";
import { ErrorState, PageHeader, SkeletonRows } from "@/components/row/AppKit";
import { useFormat, useToday } from "@/hooks/useFormat";
import { getClubMembersForAttendance, getMembershipDuesList } from "@/services/api";
import {
  createClubInvoices, downloadInvoiceFile, emailClubInvoices, generateDuesInvoices, getClubInvoice, getClubInvoices,
  getInvoiceProducts, getInvoiceReceipts, getMemberBalances, getMemberStatement, recordInvoicePayment, saveInvoiceProduct,
  voidClubInvoice, type ClubInvoice, type InvoiceDetail, type InvoiceProduct, type InvoiceReceipt, type InvoiceStatus,
  type MemberBalance, type MemberStatement,
} from "@/services/api";
import type { ClubMemberSimple } from "@/types/attendance";
import MealsTab from "./MealsTab";

const STATUS_LABEL: Record<InvoiceStatus, string> = { open: "Open", part_paid: "Part paid", paid: "Paid", void: "Void" };
const SELECT = "row-field w-full";

function errText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === "string" && m ? m : fallback;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const v = status === "paid" ? "default" : status === "void" ? "secondary" : "outline";
  return <Badge variant={v}>{STATUS_LABEL[status]}</Badge>;
}

// A list the user waits for: skeleton, error with retry, empty text, or the rows.
function Async<T>({ state, empty, children }: { state: Load<T>; empty: string; children: (data: T) => React.ReactNode }) {
  if (state.loading) return <SkeletonRows rows={5} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} retryLabel="Try again" />;
  if (!state.data || (Array.isArray(state.data) && state.data.length === 0)) return <p className="py-8 text-center text-muted-foreground">{empty}</p>;
  return <>{children(state.data)}</>;
}

type Load<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };
function useLoad<T>(fn: () => Promise<T>, failMsg: string): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true); setError(null);
    fn().then(setData).catch((e) => setError(errText(e, failMsg))).finally(() => setLoading(false));
  }, [fn, failMsg]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export default function ClubInvoicesPage() {
  const clubId = Number(useParams().id);
  const { money } = useFormat();
  const today = useToday();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<"new" | "dues" | "pay" | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const invoices = useLoad(useCallback(() => getClubInvoices(clubId, status ? { status } : undefined), [clubId, status]), "Could not load invoices.");
  const balances = useLoad(useCallback(() => getMemberBalances(clubId), [clubId]), "Could not load balances.");
  const receipts = useLoad(useCallback(() => getInvoiceReceipts(clubId), [clubId]), "Could not load payments.");
  const products = useLoad(useCallback(() => getInvoiceProducts(clubId), [clubId]), "Could not load products.");
  const members = useLoad(useCallback(() => getClubMembersForAttendance(clubId), [clubId]), "Could not load members.");

  const refreshMoney = () => { invoices.reload(); balances.reload(); receipts.reload(); };
  const done = (text: string) => { setNotice({ ok: true, text }); setSelected(new Set()); refreshMoney(); };
  const fail = (e: unknown, fallback: string) => setNotice({ ok: false, text: errText(e, fallback) });

  const download = async (path: string, name: string, params?: Record<string, string>) => {
    try { save(await downloadInvoiceFile(clubId, path, params), name); } catch (e) { fail(e, "Download failed."); }
  };

  const email = async (ids: number[]) => {
    setBusy(true);
    try {
      const r = await emailClubInvoices(clubId, ids);
      done(`Sent ${r.sent} invoice email${r.sent === 1 ? "" : "s"}.${r.skipped ? ` Skipped ${r.skipped}: ${r.problems.join("; ")}.` : ""}`);
    } catch (e) { fail(e, "Could not send the emails."); } finally { setBusy(false); }
  };

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="Invoices and statements"
          description="Bill members for dues, meals and items, record payments, and send statements."
          back={`/clubs/${clubId}/dashboard`}
          actions={<>
                <Button variant="outline" onClick={() => setDialog("dues")}>Invoice dues</Button>
                <Button variant="outline" onClick={() => setDialog("new")}><Plus className="mr-2 h-4 w-4" />New invoice</Button>
                <Button onClick={() => setDialog("pay")}><Receipt className="mr-2 h-4 w-4" />Record payment</Button>
              </>}
        />

        {notice && (
          <div role="status" className={`rounded-md border px-4 py-3 text-sm ${notice.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {notice.text} <LinkButton type="button" onClick={() => setNotice(null)} className="ml-2">Dismiss</LinkButton>
          </div>
        )}

        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="meals">Meals</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="export">QuickBooks</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Label htmlFor="inv-status">Status</Label>
                <NativeSelect id="inv-status"  value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | "")}>
                  <option value="">All</option>
                  {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </NativeSelect>
              </div>
              <Button variant="outline" disabled={selected.size === 0 || busy} onClick={() => email([...selected])}>
                <Mail className="mr-2 h-4 w-4" />Email selected ({selected.size})
              </Button>
            </div>
            <Async state={invoices} empty="No invoices yet. Use Invoice dues or New invoice to raise one.">
              {(rows) => (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>
                      <TableHead>Invoice</TableHead><TableHead>Member</TableHead><TableHead>For</TableHead><TableHead>Due</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead><TableHead>Emailed</TableHead><TableHead>Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell><Checkbox aria-label={`Select ${i.invoiceNo}`} checked={selected.has(i.id)} disabled={i.status === "void"} onCheckedChange={() => toggle(i.id)} /></TableCell>
                          <TableCell><LinkButton onClick={() => setDetailId(i.id)}>{i.invoiceNo}</LinkButton></TableCell>
                          <TableCell>{i.memberName}</TableCell>
                          <TableCell className="max-w-[240px] truncate" title={i.description ?? ""}>{i.description}</TableCell>
                          <TableCell>{i.dueDate}</TableCell>
                          <TableCell className="text-right">{money(i.amount)}</TableCell>
                          <TableCell className="text-right">{money(i.balance)}</TableCell>
                          <TableCell><StatusBadge status={i.status} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{i.emailCount ? `${i.emailCount}x` : "Not yet"}</TableCell>
                          <TableCell className="space-x-2 whitespace-nowrap text-sm">
                            <LinkButton type="button" onClick={() => download(`${i.id}/pdf`, `${i.invoiceNo}.pdf`)}>PDF</LinkButton>
                            {i.status !== "void" && <LinkButton type="button" disabled={busy} onClick={() => email([i.id])}>{i.emailCount ? "Resend" : "Email"}</LinkButton>}
                            {i.status !== "void" && i.paidAmount === 0 && <LinkButton type="button" onClick={() => setVoidId(i.id)} tone="danger">Void</LinkButton>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Async>
          </TabsContent>

          <TabsContent value="balances">
            <BalancesTab clubId={clubId} state={balances} money={money} today={today} download={download} />
          </TabsContent>

          <TabsContent value="payments">
            <Async state={receipts} empty="No payments recorded yet.">
              {(rows: InvoiceReceipt[]) => (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Member</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Applied</TableHead><TableHead className="text-right">Credit</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.receiptDate.slice(0, 10)}</TableCell><TableCell>{r.memberName}</TableCell>
                          <TableCell className="capitalize">{r.method}</TableCell><TableCell>{r.reference ?? `RCPT-${r.id}`}</TableCell>
                          <TableCell className="text-right">{money(r.amount)}</TableCell><TableCell className="text-right">{money(r.applied)}</TableCell>
                          <TableCell className="text-right">{money(r.amount - r.applied)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Async>
          </TabsContent>

          <TabsContent value="meals">
            <MealsTab clubId={clubId} today={today} money={money} onBilled={done} />
          </TabsContent>

          <TabsContent value="products">
            <ProductsTab clubId={clubId} state={products} money={money} onError={fail} />
          </TabsContent>

          <TabsContent value="export">
            <ExportTab today={today} download={download} />
          </TabsContent>
        </Tabs>

        {dialog === "dues" && <DuesDialog clubId={clubId} today={today} onClose={() => setDialog(null)}
          onDone={(n) => { setDialog(null); done(`Created ${n.created} dues invoice${n.created === 1 ? "" : "s"}.${n.skipped ? ` ${n.skipped} member(s) owe nothing for this fee.` : ""}`); }} />}
        {dialog === "new" && <NewInvoiceDialog clubId={clubId} today={today} members={members.data ?? []}
          products={(products.data ?? []).filter((p) => p.isActive)} money={money} onClose={() => setDialog(null)}
          onDone={(n) => { setDialog(null); done(`Created ${n} invoice${n === 1 ? "" : "s"}.`); }} />}
        {dialog === "pay" && <PaymentDialog clubId={clubId} today={today} members={members.data ?? []} money={money} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); done("Payment recorded."); }} />}
        {detailId != null && <DetailDialog clubId={clubId} id={detailId} money={money} onClose={() => setDetailId(null)} />}
        {voidId != null && <VoidDialog clubId={clubId} id={voidId} onClose={() => setVoidId(null)} onDone={() => { setVoidId(null); done("Invoice voided."); }} />}
      </div>
    </ProtectedRoute>
  );
}

type Money = (n: number) => string;
type Download = (path: string, name: string, params?: Record<string, string>) => Promise<void>;

function BalancesTab({ clubId, state, money, today, download }: { clubId: number; state: Load<MemberBalance[]>; money: Money; today: string; download: Download }) {
  const [member, setMember] = useState<MemberBalance | null>(null);
  const [from, setFrom] = useState(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`);
  const [to, setTo] = useState(today);
  const [stmt, setStmt] = useState<{ data: MemberStatement | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });

  const loadStatement = useCallback(() => {
    if (!member) return;
    setStmt({ data: null, loading: true, error: null });
    getMemberStatement(clubId, member.memberId, from, to)
      .then((data) => setStmt({ data, loading: false, error: null }))
      .catch((e) => setStmt({ data: null, loading: false, error: errText(e, "Could not load the statement.") }));
  }, [clubId, member, from, to]);
  useEffect(() => { loadStatement(); }, [loadStatement]);

  return (
    <div className="space-y-6">
      <Async state={state} empty="Every member is paid up.">
        {(rows) => (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Member</TableHead><TableHead className="text-right">Open invoices</TableHead><TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Credit</TableHead><TableHead>Oldest due</TableHead><TableHead>Statement</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.memberId}>
                    <TableCell>{b.memberName}</TableCell><TableCell className="text-right">{b.openInvoices}</TableCell>
                    <TableCell className="text-right">{money(b.outstanding)}</TableCell><TableCell className="text-right">{money(b.credit)}</TableCell>
                    <TableCell>{b.oldestDue?.slice(0, 10) ?? ""}</TableCell>
                    <TableCell><LinkButton type="button" onClick={() => setMember(b)}>View</LinkButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Async>

      {member && (
        <section className="space-y-3 rounded-xl border border-[color:var(--row-line)] p-5">
          <div className="flex flex-wrap items-end gap-3">
            <h3 className="row-h2 mr-auto">Statement for {member.memberName}</h3>
            <div><Label htmlFor="st-from">From</Label><Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label htmlFor="st-to">To</Label><Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button variant="outline" onClick={() => download(`members/${member.memberId}/statement/pdf`, `statement-${member.memberId}.pdf`, { from, to })}>
              <Download className="mr-2 h-4 w-4" />PDF
            </Button>
          </div>
          {stmt.loading ? <SkeletonRows rows={4} /> : stmt.error ? <ErrorState message={stmt.error} onRetry={loadStatement} retryLabel="Try again" /> : stmt.data && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Description</TableHead>
                <TableHead className="text-right">Charge</TableHead><TableHead className="text-right">Payment</TableHead><TableHead className="text-right">Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>{stmt.data.from}</TableCell><TableCell /><TableCell>Opening balance</TableCell><TableCell /><TableCell />
                  <TableCell className="text-right">{money(stmt.data.opening)}</TableCell></TableRow>
                {stmt.data.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.date}</TableCell><TableCell>{r.reference}</TableCell><TableCell>{r.description}</TableCell>
                    <TableCell className="text-right">{r.isCharge ? money(r.amount) : ""}</TableCell>
                    <TableCell className="text-right">{r.isCharge ? "" : money(r.amount)}</TableCell>
                    <TableCell className="text-right">{money(r.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow><TableCell /><TableCell /><TableCell className="font-semibold">Closing balance</TableCell><TableCell /><TableCell />
                  <TableCell className="text-right font-semibold">{money(stmt.data.closing)}</TableCell></TableRow>
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}

function ProductsTab({ clubId, state, money, onError }: { clubId: number; state: Load<InvoiceProduct[]>; money: Money; onError: (e: unknown, f: string) => void }) {
  const [edit, setEdit] = useState<{ id?: number; name: string; description: string; unitAmount: string; isActive: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await saveInvoiceProduct(clubId, { ...edit, unitAmount: Number(edit.unitAmount) });
      setEdit(null); state.reload();
    } catch (e) { onError(e, "Could not save the product."); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={() => setEdit({ name: "", description: "", unitAmount: "", isActive: true })}><Plus className="mr-2 h-4 w-4" />Add product</Button>
      <Async state={state} empty="No products yet. Add the items you bill members for, such as meals or event fees.">
        {(rows) => (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell><TableCell>{p.description}</TableCell><TableCell className="text-right">{money(p.unitAmount)}</TableCell>
                  <TableCell><Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "Active" : "Hidden"}</Badge></TableCell>
                  <TableCell><LinkButton type="button" onClick={() => setEdit({ id: p.id, name: p.name, description: p.description ?? "", unitAmount: String(p.unitAmount), isActive: p.isActive })}>Edit</LinkButton></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Async>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{edit.id ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label htmlFor="p-name">Name</Label><Input id="p-name" maxLength={150} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div><Label htmlFor="p-desc">Description</Label><Input id="p-desc" maxLength={300} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div><Label htmlFor="p-price">Price</Label><Input id="p-price" type="number" min="0" step="0.01" value={edit.unitAmount} onChange={(e) => setEdit({ ...edit, unitAmount: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={edit.isActive} onCheckedChange={(c) => setEdit({ ...edit, isActive: c === true })} />Active (offered on new invoices)</label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
              <Button disabled={saving || !edit.name.trim() || edit.unitAmount === ""} onClick={submit}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ExportTab({ today, download }: { today: string; download: Download }) {
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const files: { format: string; label: string; note: string; ext: string }[] = [
    { format: "iif", label: "QuickBooks Desktop (IIF)", note: "Invoices and payments in one file. In QuickBooks: File, Utilities, Import, IIF Files.", ext: "iif" },
    { format: "csv-invoices", label: "QuickBooks Online invoices (CSV)", note: "Sales, Invoices, Import invoices. Pick the MM/dd/yyyy date format.", ext: "csv" },
    { format: "csv-payments", label: "QuickBooks Online payments (CSV)", note: "One row per invoice a payment paid, plus any unapplied credit.", ext: "csv" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div><Label htmlFor="x-from">From</Label><Input id="x-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="x-to">To</Label><Input id="x-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <ul className="space-y-3">
        {files.map((f) => (
          <li key={f.format} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--row-line)] p-4">
            <div><p className="font-medium">{f.label}</p><p className="text-sm text-muted-foreground">{f.note}</p></div>
            <Button variant="outline" onClick={() => download("export/quickbooks", `quickbooks-${f.format}-${from}-${to}.${f.ext}`, { format: f.format, from, to })}>
              <Download className="mr-2 h-4 w-4" />Download
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Void invoices are left out. Account names in the IIF file: Accounts Receivable, Club Dues and Fees Income, Undeposited Funds.</p>
    </div>
  );
}

function DialogShell({ title, description, onClose, children, footer }: { title: string; description?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormError({ text }: { text: string | null }) {
  return text ? <p role="alert" className="text-sm text-red-700">{text}</p> : null;
}

function DuesDialog({ clubId, today, onClose, onDone }: { clubId: number; today: string; onClose: () => void; onDone: (r: { created: number; skipped: number }) => void }) {
  const dues = useLoad(useCallback(() => getMembershipDuesList({ clubId }) as Promise<{ id: number; purpose?: string; rotaryYear?: string }[]>, [clubId]), "Could not load dues.");
  const [duesId, setDuesId] = useState("");
  const [feeType, setFeeType] = useState("1");
  const [issue, setIssue] = useState(today);
  const [due, setDue] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setErr(null);
    try { onDone(await generateDuesInvoices(clubId, { duesId: Number(duesId), feeType: Number(feeType), issueDate: issue, dueDate: due })); }
    catch (e) { setErr(errText(e, "Could not create the invoices.")); } finally { setSaving(false); }
  };
  return (
    <DialogShell title="Invoice dues" description="One invoice per member who owes this fee. Members already invoiced for it are skipped." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!duesId || saving} onClick={submit}>Create invoices</Button></>}>
      <Async state={dues} empty="This club has no membership dues yet. Set them up under Membership Dues first.">
        {(rows) => (
          <div className="space-y-3">
            <div><Label htmlFor="d-dues">Dues</Label>
              <NativeSelect id="d-dues"  value={duesId} onChange={(e) => setDuesId(e.target.value)}>
                <option value="">Choose dues</option>
                {rows.map((d) => <option key={d.id} value={d.id}>{[d.purpose || "Club dues", d.rotaryYear].filter(Boolean).join(", ")}</option>)}
              </NativeSelect></div>
            <div><Label htmlFor="d-fee">Fee</Label>
              <NativeSelect id="d-fee"  value={feeType} onChange={(e) => setFeeType(e.target.value)}>
                <option value="1">Annual</option><option value="2">Semi Annual 1</option><option value="3">Semi Annual 2</option>
              </NativeSelect></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="d-issue">Issue date</Label><Input id="d-issue" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
              <div><Label htmlFor="d-due">Due date</Label><Input id="d-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            </div>
          </div>
        )}
      </Async>
      <FormError text={err} />
    </DialogShell>
  );
}

type LineDraft = { productId: string; description: string; quantity: string; unitAmount: string };

function NewInvoiceDialog({ clubId, today, members, products, money, onClose, onDone }: {
  clubId: number; today: string; members: ClubMemberSimple[]; products: InvoiceProduct[]; money: Money; onClose: () => void; onDone: (n: number) => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ productId: "", description: "", quantity: "1", unitAmount: "" }]);
  const [issue, setIssue] = useState(today);
  const [due, setDue] = useState(today);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = useMemo(() => members.filter((m) => m.memberName.toLowerCase().includes(search.toLowerCase())), [members, search]);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitAmount) || 0), 0);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, id: string) => {
    const p = products.find((x) => String(x.id) === id);
    setLine(i, p ? { productId: id, description: p.name, unitAmount: String(p.unitAmount) } : { productId: "" });
  };
  const submit = async () => {
    setSaving(true); setErr(null);
    try {
      const r = await createClubInvoices(clubId, {
        memberIds: [...picked], issueDate: issue, dueDate: due, notes: notes || undefined,
        lines: lines.map((l) => ({ productId: l.productId ? Number(l.productId) : null, description: l.description, quantity: Number(l.quantity), unitAmount: Number(l.unitAmount) })),
      });
      onDone(r.created);
    } catch (e) { setErr(errText(e, "Could not create the invoices.")); } finally { setSaving(false); }
  };
  return (
    <DialogShell title="New invoice" description="Pick one member, or several to send each of them the same invoice." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={saving || picked.size === 0 || total <= 0} onClick={submit}>Create {picked.size > 1 ? `${picked.size} invoices` : "invoice"}</Button></>}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="n-search">Members ({picked.size} chosen)</Label>
          <Input id="n-search" placeholder="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[color:var(--row-line)] p-2">
            {members.length === 0 ? <p className="text-sm text-muted-foreground">No members loaded.</p> : shown.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.has(m.id)} onCheckedChange={() => setPicked((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
                {m.memberName}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <NativeSelect aria-label="Product" className="col-span-3" value={l.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                <option value="">Other item</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
              <Input aria-label="Description" className="col-span-4" maxLength={300} placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <Input aria-label="Quantity" className="col-span-2" type="number" min="0" step="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Input aria-label="Unit price" className="col-span-2" type="number" min="0" step="0.01" placeholder="Price" value={l.unitAmount} onChange={(e) => setLine(i, { unitAmount: e.target.value })} />
              <Button variant="ghost" className="col-span-1" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>x</Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { productId: "", description: "", quantity: "1", unitAmount: "" }])}>Add line</Button>
            <p className="font-semibold">Total per member: {money(total)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="n-issue">Issue date</Label><Input id="n-issue" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
          <div><Label htmlFor="n-due">Due date</Label><Input id="n-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
        <div><Label htmlFor="n-notes">Notes on the invoice</Label><Input id="n-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <FormError text={err} />
      </div>
    </DialogShell>
  );
}

function PaymentDialog({ clubId, today, members, money, onClose, onDone }: {
  clubId: number; today: string; members: ClubMemberSimple[]; money: Money; onClose: () => void; onDone: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState<{ data: ClubInvoice[]; loading: boolean }>({ data: [], loading: false });
  const [split, setSplit] = useState<Record<number, string>>({});
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "cheque" | "bank">("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    setOpen({ data: [], loading: true }); setSplit({});
    getClubInvoices(clubId, { memberId: Number(memberId) })
      .then((rows) => setOpen({ data: rows.filter((r) => r.status === "open" || r.status === "part_paid"), loading: false }))
      .catch((e) => { setOpen({ data: [], loading: false }); setErr(errText(e, "Could not load the member's invoices.")); });
  }, [clubId, memberId]);

  const applied = Object.values(split).reduce((s, v) => s + (Number(v) || 0), 0);
  const submit = async () => {
    setSaving(true); setErr(null);
    const splits = Object.entries(split).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ invoiceId: Number(id), amount: Number(v) }));
    try {
      await recordInvoicePayment(clubId, { memberId: Number(memberId), receiptDate: date, method, reference: reference || undefined, amount: Number(amount), notes: notes || undefined, splits: splits.length ? splits : undefined });
      onDone();
    } catch (e) { setErr(errText(e, "Could not record the payment.")); } finally { setSaving(false); }
  };
  return (
    <DialogShell title="Record payment" description="Cash, cheque or bank transfer. Split it across the member's open invoices; anything left stays as credit. Card payments are not taken here." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving || !memberId || !(Number(amount) > 0)} onClick={submit}>Record payment</Button></>}>
      <div className="space-y-4">
        <div><Label htmlFor="pay-member">Member</Label>
          <NativeSelect id="pay-member"  value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Choose a member</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
          </NativeSelect></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="pay-amount">Amount</Label><Input id="pay-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label htmlFor="pay-date">Date received</Label><Input id="pay-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label htmlFor="pay-method">Method</Label>
            <NativeSelect id="pay-method"  value={method} onChange={(e) => setMethod(e.target.value as "cash" | "cheque" | "bank")}>
              <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank">Bank transfer</option>
            </NativeSelect></div>
          <div><Label htmlFor="pay-ref">{method === "cheque" ? "Cheque number" : "Reference"}</Label><Input id="pay-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        {memberId && (open.loading ? <SkeletonRows rows={2} /> : open.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">This member has no open invoices. The payment will be kept as credit.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Leave the split empty to pay the oldest invoices first. A dues invoice is paid in full only.</p>
            {open.data.map((i) => (
              <div key={i.id} className="grid grid-cols-12 items-center gap-2 text-sm">
                <span className="col-span-3 font-medium">{i.invoiceNo}</span>
                <span className="col-span-5 truncate" title={i.description ?? ""}>{i.description}</span>
                <span className="col-span-2 text-right">{money(i.balance)}</span>
                <Input aria-label={`Amount for ${i.invoiceNo}`} className="col-span-2" type="number" min="0" step="0.01" value={split[i.id] ?? ""}
                  onChange={(e) => setSplit((s) => ({ ...s, [i.id]: e.target.value }))} />
              </div>
            ))}
            <p className="text-right text-sm">Applied {money(applied)}, credit {money(Math.max(0, (Number(amount) || 0) - applied))}</p>
          </div>
        ))}
        <div><Label htmlFor="pay-notes">Notes</Label><Input id="pay-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <FormError text={err} />
      </div>
    </DialogShell>
  );
}

function DetailDialog({ clubId, id, money, onClose }: { clubId: number; id: number; money: Money; onClose: () => void }) {
  const d = useLoad<InvoiceDetail>(useCallback(() => getClubInvoice(clubId, id), [clubId, id]), "Could not load the invoice.");
  return (
    <DialogShell title={d.data?.invoice.invoiceNo ?? "Invoice"} description={d.data ? `${d.data.invoice.memberName}, due ${d.data.invoice.dueDate}` : undefined} onClose={onClose}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <Async state={d} empty="Invoice not found.">
        {({ invoice, lines, payments }) => (
          <div className="space-y-4 text-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => <TableRow key={i}><TableCell>{l.description}</TableCell><TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right">{money(l.unitAmount)}</TableCell><TableCell className="text-right">{money(l.amount)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
            <p className="text-right">Total {money(invoice.amount)}, paid {money(invoice.paidAmount)}, balance <strong>{money(invoice.balance)}</strong> <StatusBadge status={invoice.status} /></p>
            {invoice.voidReason && <p>Void reason: {invoice.voidReason}</p>}
            <div>
              <h4 className="mb-1 font-semibold">Payments applied</h4>
              {payments.length === 0 ? <p className="text-muted-foreground">None yet.</p> : (
                <ul className="space-y-1">{payments.map((p, i) => <li key={i}>{p.date.slice(0, 10)}, {p.method}, {p.reference}: {money(p.amount)}</li>)}</ul>
              )}
            </div>
          </div>
        )}
      </Async>
    </DialogShell>
  );
}

function VoidDialog({ clubId, id, onClose, onDone }: { clubId: number; id: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setErr(null);
    try { await voidClubInvoice(clubId, id, reason); onDone(); } catch (e) { setErr(errText(e, "Could not void the invoice.")); } finally { setSaving(false); }
  };
  return (
    <DialogShell title="Void invoice" description="The invoice stays on record, marked void, and drops out of balances and exports." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={saving || !reason.trim()} onClick={submit}>Void invoice</Button></>}>
      <div><Label htmlFor="v-reason">Reason</Label><Input id="v-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <FormError text={err} />
    </DialogShell>
  );
}
