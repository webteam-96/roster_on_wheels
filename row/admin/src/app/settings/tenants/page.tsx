"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  applyTenantEdition, getDistricts, getEditions, getTenant, setTenant,
  type Edition, type TenantDetail, type TenantSubscription,
} from "@/services/api";
import type { DistrictListItem } from "@/types/district";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Loader2, Save } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import TenantPlanningCard from "@/components/planning/TenantPlanningCard";

// Super Admin > Tenants (ROW Wave 1, build spec items 1 and 5): a district's subscription, its planning state,
// and applying its editions (switches district and club modules on or off; no module data is deleted).
const EMPTY: TenantSubscription = {
  editionCode: "district", memberBand: null, termStart: null, termEnd: null, state: "live", region: null,
  bridgeStart: null, bridgeEnd: null, setupFeeWaived: false, platformFeePct: null, platformFeeFixed: null, feeWaiverUntil: null,
};
const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
// API dates come back as ISO date-times; the date input wants yyyy-mm-dd. Empty must stay null (the API rejects "").
const day = (v: string | null) => (v ? v.slice(0, 10) : null);

export default function TenantsPage() {
  const { isSuperAdmin } = useAuth();
  const [districts, setDistricts] = useState<DistrictListItem[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [form, setForm] = useState<TenantSubscription>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const planningOn = useFeatureLoadedOn("planning_mode");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isSuperAdmin) return;
    // shortcut: loads the first 500 districts, add search when ROW passes that.
    Promise.all([getDistricts(1, 500), getEditions()])
      .then(([d, e]) => {
        setDistricts(d.items);
        setEditions(e);
        if (d.items[0]) setDistrictId(d.items[0].id);
      })
      .catch(() => setErrorMessage("Could not load districts."))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  useEffect(() => {
    if (districtId == null) return;
    setDetail(null);
    setConfirmApply(false);
    getTenant(districtId)
      .then((t) => {
        setDetail(t);
        setForm(t.subscription ? { ...t.subscription, termStart: day(t.subscription.termStart), termEnd: day(t.subscription.termEnd),
          bridgeStart: day(t.subscription.bridgeStart), bridgeEnd: day(t.subscription.bridgeEnd), feeWaiverUntil: day(t.subscription.feeWaiverUntil) } : EMPTY);
      })
      .catch(() => setErrorMessage("Could not load this district's subscription."));
  }, [districtId, reloadKey]);

  const set = <K extends keyof TenantSubscription>(k: K, v: TenantSubscription[K]) => setForm((f) => ({ ...f, [k]: v }));
  const orNull = (v: string) => (v === "" ? null : v);

  async function save() {
    if (districtId == null) return;
    setBusy(true);
    try {
      const r = await setTenant(districtId, { ...form, region: form.region || null });
      setDetail(await getTenant(districtId));
      setSuccessMessage(`Subscription saved. ${r.clubsProvisioned} new club(s) provisioned.`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not save the subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (districtId == null) return;
    setBusy(true);
    setConfirmApply(false);
    try {
      const r = await applyTenantEdition(districtId);
      setSuccessMessage(`Edition applied. District: ${r.districtOn} on, ${r.districtOff} off. Clubs: ${r.clubOn} on, ${r.clubOff} off.`);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not apply the edition.");
    } finally {
      setBusy(false);
    }
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

  const dateField = (k: "termStart" | "termEnd" | "bridgeStart" | "bridgeEnd" | "feeWaiverUntil", label: string) => (
    <div className="space-y-2">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type="date" value={form[k] ?? ""} onChange={(e) => set(k, orNull(e.target.value))} />
    </div>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings" aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Tenants</h2>
            <p className="text-muted-foreground text-base">District subscriptions, planning state and editions</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Before a district goes live, share the{" "}
          <Link href="/data-processing-agreement" target="_blank" className="font-medium text-primary underline-offset-2 hover:underline">
            data processing agreement
          </Link>{" "}
          with it (a draft that still needs legal review).
        </p>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-10 w-full max-w-xs animate-pulse rounded-md bg-muted" />
            <div className="h-80 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="district">District</Label>
              <select id="district" className={SELECT} value={districtId ?? ""} onChange={(e) => setDistrictId(Number(e.target.value))}>
                {districts.map((d) => <option key={d.id} value={d.id}>District {d.districtNumber}</option>)}
              </select>
            </div>

            {!detail ? (
              <div className="h-80 w-full animate-pulse rounded-md bg-muted" aria-busy="true" />
            ) : (
              <>
                <Card>
                  <CardContent className="space-y-6 p-6">
                    {!detail.subscription && <p className="text-sm text-muted-foreground">No subscription yet. Saving creates one and provisions every club.</p>}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="edition">Edition</Label>
                        <select id="edition" className={SELECT} value={form.editionCode} onChange={(e) => set("editionCode", e.target.value)}>
                          {editions.map((e) => <option key={e.code} value={e.code}>{e.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State</Label>
                        <select id="state" className={SELECT} value={form.state} onChange={(e) => set("state", e.target.value as TenantSubscription["state"])}>
                          <option value="live">Live</option>
                          <option value="planning">Planning (current year read-only)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="region">Region</Label>
                        <select id="region" className={SELECT} value={form.region ?? ""} onChange={(e) => set("region", (orNull(e.target.value) as TenantSubscription["region"]))}>
                          <option value="">Not set</option>
                          {["US", "EU", "APAC", "IN"].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="band">Member band</Label>
                        <Input id="band" maxLength={20} value={form.memberBand ?? ""} onChange={(e) => set("memberBand", orNull(e.target.value))} placeholder="1-1500" />
                      </div>
                      {dateField("termStart", "Term start")}
                      {dateField("termEnd", "Term end")}
                      {dateField("bridgeStart", "Bridge start")}
                      {dateField("bridgeEnd", "Bridge end")}
                      {dateField("feeWaiverUntil", "Fee waiver until")}
                      <div className="space-y-2">
                        <Label htmlFor="pct">Platform fee (%)</Label>
                        <Input id="pct" type="number" min={0} max={100} step="0.01" value={form.platformFeePct ?? ""}
                          onChange={(e) => set("platformFeePct", e.target.value === "" ? null : Number(e.target.value))} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fixed">Platform fee (fixed)</Label>
                        <Input id="fixed" type="number" min={0} step="0.01" value={form.platformFeeFixed ?? ""}
                          onChange={(e) => set("platformFeeFixed", e.target.value === "" ? null : Number(e.target.value))} />
                      </div>
                      <label className="flex items-center gap-2 self-end pb-2 text-sm">
                        <Checkbox checked={form.setupFeeWaived} onCheckedChange={(v) => set("setupFeeWaived", v === true)} />
                        Setup fee waived
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button onClick={save} disabled={busy}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save subscription
                      </Button>
                      {detail.subscription && !confirmApply && (
                        <Button variant="outline" onClick={() => setConfirmApply(true)} disabled={busy}>Apply edition</Button>
                      )}
                      {confirmApply && (
                        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
                          <span>Switch modules for this district and its {detail.clubs.length} clubs to their editions? Module data is kept.</span>
                          <Button size="sm" onClick={apply}>Apply</Button>
                          <Button size="sm" variant="outline" onClick={() => setConfirmApply(false)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {planningOn && detail.subscription && districtId != null && (
                  <TenantPlanningCard districtId={districtId} subscription={detail.subscription}
                    onChanged={() => setReloadKey((k) => k + 1)} onDone={setSuccessMessage} onError={setErrorMessage} />
                )}

                {detail.clubs.length > 0 && (
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="mb-3 text-base font-semibold">Clubs ({detail.clubs.length})</h3>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">Club</th><th className="py-2 font-medium">Edition</th></tr></thead>
                        <tbody>
                          {detail.clubs.map((c) => (
                            <tr key={c.clubId} className="border-b last:border-0">
                              <td className="py-2">{c.clubName}</td>
                              <td className="py-2">{editions.find((e) => e.code === c.editionCode)?.name ?? c.editionCode}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        <SuccessAlert open={!!successMessage} title="Done" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
