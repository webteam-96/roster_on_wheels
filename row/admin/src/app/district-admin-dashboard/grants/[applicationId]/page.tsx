"use client";

/**
 * District Admin Dashboard › Grants › one application: review (information, adjustment, approve with amount,
 * reject with reason), recorded payments, the final report and closure. Flagged module "grants".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ActionPanel, AttachmentList, DetailSkeleton, GrantHeader, GrantHistory, GrantSummary, Section,
} from "@/components/grants/GrantParts";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat, useToday } from "@/hooks/useFormat";
import { getGrantApplication, grantAction, grantComment, recordGrantPayment } from "@/services/api";
import { PAYMENT_METHODS, STATUS_LABEL, orNull } from "@/lib/grants";
import type { GrantApplication, RecordGrantPayment } from "@/types/grants";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function DistrictGrantApplicationPage() {
  const { selectedDistrictId: districtId } = useAuth();
  const id = Number(useParams().applicationId);
  const [app, setApp] = useState<GrantApplication | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!districtId || !id) return;
    setApp(null);
    getGrantApplication("district", districtId, id).then(setApp).catch(() => setMissing(true));
  }, [districtId, id]);

  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  if (missing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">This grant application was not found in your district.</p>
        <Link href="/district-admin-dashboard/grants" className="text-sm text-primary underline">Back to grants</Link>
      </div>
    );
  }
  if (!app) return <div className="p-6"><DetailSkeleton /></div>;

  const run = async (work: () => Promise<GrantApplication>, done: (a: GrantApplication) => string) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      setApp(next);
      setNotice(done(next));
    } catch (err: any) {
      setError(err?.response?.data?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 p-6">
      <Button variant="outline" size="sm" asChild className="gap-1.5">
        <Link href="/district-admin-dashboard/grants"><ArrowLeft className="h-4 w-4" /> All grants</Link>
      </Button>
      <GrantHeader app={app} />
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      <GrantSummary app={app} />
      <AttachmentList app={app} side="district" scopeId={districtId} />
      {app.canRecordPayment && (
        <PaymentForm key={app.payments.length} app={app} busy={busy}
          onSave={(body) => run(() => recordGrantPayment(districtId, id, body), (a) => `Payment recorded. The grant is ${STATUS_LABEL[a.status].toLowerCase()}.`)} />
      )}
      <ActionPanel key={`${app.status}-${app.events.length}`} app={app} busy={busy}
        onAct={(action, body) => run(() => grantAction("district", districtId, id, action, body),
          (a) => `Done. The application is now ${STATUS_LABEL[a.status].toLowerCase()}.`)}
        onComment={(comment) => run(() => grantComment("district", districtId, id, comment), () => "Comment posted.")} />
      <GrantHistory app={app} />

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

/** A disbursement the district has made outside the platform (no money moves here). */
function PaymentForm({ app, busy, onSave }: { app: GrantApplication; busy: boolean; onSave: (body: RecordGrantPayment) => void }) {
  const fmt = useFormat();
  const today = useToday();
  const left = Math.max(0, Math.round(((app.amountApproved ?? 0) - app.paid) * 100) / 100);
  const [amount, setAmount] = useState(left ? String(left) : "");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  return (
    <Section title="Record a payment">
      <p className="text-sm text-muted-foreground">
        Record a payment the district has made. No money moves through this page. {fmt.money(left)} of {fmt.money(app.amountApproved ?? 0)} is left to pay.
      </p>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        onSave({ amount: Number(amount), paidOn, method, reference: orNull(reference), note: orNull(note) });
      }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input id="pay-amount" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Paid on</Label>
            <Input id="pay-date" type="date" required value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <select id="pay-method" className={SELECT} value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer or cheque number" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-note">Note</Label>
          <Input id="pay-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy || left <= 0 || !amount} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Record payment
        </Button>
      </form>
    </Section>
  );
}
