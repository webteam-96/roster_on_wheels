"use client";

// DGE sign-up at the booth (build spec 3.1). Public: a governor-elect picks the district and plan; ROW sets the
// district up once the payment is confirmed (a Super Admin marks it paid until online payment comes with Stripe).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const SELECT = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type Options = { open: boolean; districts: { id: number; number: string }[]; editions: { code: string; name: string }[] };

export default function BoothSignupPage() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [form, setForm] = useState({ districtId: 0, editionCode: "", memberBand: "", name: "", email: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/public/booth/options`).then((r) => r.json()).then(setOpts)
      .catch(() => setOpts({ open: false, districts: [], editions: [] }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/public/booth/signups`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, memberBand: form.memberBand || null }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "Sign-up failed. Please try again.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
      setState("idle");
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Sign your district up for ROW</h1>
      <p className="mt-2 text-muted-foreground">
        For governors-elect. Choose your plan; once the payment is confirmed, your district is set up for planning next
        Rotary year and you get an email to open your launchpad.
      </p>
      {opts === null ? (
        <div className="mt-8 space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : !opts.open ? (
        <p className="mt-8 rounded-lg border p-4">Sign-ups are not open at the moment.</p>
      ) : state === "done" ? (
        <p role="status" className="mt-8 rounded-lg border p-4">
          Thank you. Your sign-up is recorded; ROW sets your district up once the payment is confirmed.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="district">District</Label>
            <select id="district" required className={SELECT} value={form.districtId} onChange={(e) => setForm({ ...form, districtId: Number(e.target.value) })}>
              <option value={0} disabled>Pick your district</option>
              {opts.districts.map((d) => <option key={d.id} value={d.id}>District {d.number}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan">Plan</Label>
            <select id="plan" required className={SELECT} value={form.editionCode} onChange={(e) => setForm({ ...form, editionCode: e.target.value })}>
              <option value="" disabled>Pick a plan</option>
              {opts.editions.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="band">Member band (optional)</Label>
            <Input id="band" maxLength={20} placeholder="for example 1-1500" value={form.memberBand} onChange={(e) => setForm({ ...form, memberBand: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" required maxLength={150} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Your email</Label>
            <Input id="email" required type="email" maxLength={200} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <p className="text-xs text-muted-foreground">Use the email ROW knows you by, so planning starts with you as governor-elect.</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={state === "sending" || !form.districtId || !form.editionCode}>
            {state === "sending" ? "Sending..." : "Sign up"}
          </Button>
        </form>
      )}
    </main>
  );
}
