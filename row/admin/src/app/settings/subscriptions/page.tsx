"use client";

// Super Admin > Subscriptions (KIS/ROW/SUB/01): the yearly price of each subscription, and activating a payment
// made offline (exception 7). The server checks the Super Admin role on every call.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  activateSubscriptionOffline, getSubscriptionPrices, setSubscriptionPrice, type SubscriptionPrice,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import { SkeletonRows } from "@/components/row/AppKit";

type Kind = "district" | "club";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "district", label: "District subscription" },
  { kind: "club", label: "Club subscription" },
];

const messageOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function SubscriptionSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [prices, setPrices] = useState<Record<Kind, { amount: string; currency: string }>>({
    district: { amount: "", currency: "USD" }, club: { amount: "", currency: "USD" },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState({ kind: "club" as Kind, id: "", amount: "", currency: "USD" });

  useEffect(() => {
    if (!isSuperAdmin) return;
    getSubscriptionPrices()
      .then((list: SubscriptionPrice[]) => setPrices((p) => {
        const next = { ...p };
        for (const row of list) next[row.kind] = { amount: String(row.amount), currency: row.currency };
        return next;
      }))
      .catch((e) => setError(messageOf(e, "The prices could not be loaded.")))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  async function savePrice(kind: Kind) {
    const amount = Number(prices[kind].amount);
    if (!(amount > 0)) { setError("Enter a price above 0."); return; }
    setSaving(kind); setError(null); setSuccess(null);
    try {
      await setSubscriptionPrice(kind, amount, prices[kind].currency.trim().toUpperCase());
      setSuccess("Price saved. New orders use it; orders already started keep their amount.");
    } catch (e) { setError(messageOf(e, "The price could not be saved.")); }
    setSaving(null);
  }

  async function activate() {
    const id = Number(offline.id);
    const amount = Number(offline.amount);
    if (!(id > 0) || !(amount > 0)) { setError("Enter the record id and the amount received."); return; }
    setSaving("offline"); setError(null); setSuccess(null);
    try {
      const r = await activateSubscriptionOffline({
        kind: offline.kind, districtId: offline.kind === "district" ? id : 0, clubId: offline.kind === "club" ? id : 0,
        amount, currency: offline.currency.trim().toUpperCase(),
      });
      setSuccess(`Activated. Order ${r.orderId}. The executives on record with RI get their sign-in email.`);
      setOffline((o) => ({ ...o, id: "", amount: "" }));
    } catch (e) { setError(messageOf(e, "The subscription could not be activated.")); }
    setSaving(null);
  }

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings" aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Subscriptions</h2>
            <p className="text-muted-foreground text-base">Yearly prices, and activating a payment made offline</p>
          </div>
        </div>

        <SuccessAlert open={!!success} title="Done" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />

        <Card>
          <CardContent className="space-y-5 pt-6">
            <h3 className="text-lg font-semibold">Yearly price</h3>
            {loading ? <SkeletonRows rows={2} /> : KINDS.map(({ kind, label }) => (
              <div key={kind} className="flex flex-wrap items-end gap-3">
                <div className="w-56 text-[15px] font-medium">{label}</div>
                <div>
                  <Label htmlFor={`amount-${kind}`}>Amount</Label>
                  <Input id={`amount-${kind}`} type="number" min="0" step="0.01" className="w-36" value={prices[kind].amount}
                    onChange={(e) => setPrices((p) => ({ ...p, [kind]: { ...p[kind], amount: e.target.value } }))} />
                </div>
                <div>
                  <Label htmlFor={`currency-${kind}`}>Currency</Label>
                  <Input id={`currency-${kind}`} maxLength={3} className="w-24 uppercase" value={prices[kind].currency}
                    onChange={(e) => setPrices((p) => ({ ...p, [kind]: { ...p[kind], currency: e.target.value } }))} />
                </div>
                <Button type="button" onClick={() => savePrice(kind)} disabled={saving !== null}>
                  {saving === kind ? "Saving" : "Save"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h3 className="text-lg font-semibold">Activate an offline payment</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Starts one year today, or adds one year to the current term if the subscription still works. This cannot be undone here.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="offline-kind">Subscription</Label>
                <select id="offline-kind" className="h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"
                  value={offline.kind} onChange={(e) => setOffline((o) => ({ ...o, kind: e.target.value as Kind }))}>
                  {KINDS.map(({ kind, label }) => <option key={kind} value={kind}>{label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="offline-id">{offline.kind === "club" ? "Club id" : "District id"}</Label>
                <Input id="offline-id" type="number" min="1" className="w-32" value={offline.id}
                  onChange={(e) => setOffline((o) => ({ ...o, id: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="offline-amount">Amount received</Label>
                <Input id="offline-amount" type="number" min="0" step="0.01" className="w-36" value={offline.amount}
                  onChange={(e) => setOffline((o) => ({ ...o, amount: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="offline-currency">Currency</Label>
                <Input id="offline-currency" maxLength={3} className="w-24 uppercase" value={offline.currency}
                  onChange={(e) => setOffline((o) => ({ ...o, currency: e.target.value }))} />
              </div>
              <Button type="button" onClick={activate} disabled={saving !== null}>
                {saving === "offline" ? "Activating" : "Activate"}
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">The id is the number in the club or district address, also shown in Global Search results.</p>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
