"use client";

/**
 * Public giving page, no login: /public/donate/{id}. The QR code, the club website and the app link here. The donor
 * picks or types an amount; the API checks it against the campaign and opens the hosted checkout (the payment
 * provider's page). Back from the checkout, ?order=...&checkout=... shows the result and the receipt download.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Download, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { ProgressBar } from "@/components/donations/DonationCampaigns";
import { useFormat } from "@/hooks/useFormat";
import { donationImageUrl, downloadDonorReceipt, getDonationOrder, getPublicDonationCampaign, startDonation } from "@/services/api";
import type { DonationOrder, PublicDonationCampaign } from "@/types/donations";

// useSearchParams needs a Suspense boundary for the static build.
export default function PublicDonatePage() {
  return <Suspense fallback={null}><DonatePage /></Suspense>;
}

function DonatePage() {
  const id = Number(useParams().id);
  const search = useSearchParams();
  const orderId = search.get("order");
  const checkout = search.get("checkout");
  const fmt = useFormat();
  const [page, setPage] = useState<PublicDonationCampaign | null>(null);
  const [missing, setMissing] = useState(false);
  const [order, setOrder] = useState<DonationOrder | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [hideAmount, setHideAmount] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPublicDonationCampaign(id).then(setPage).catch(() => setMissing(true));
    if (orderId && checkout) getDonationOrder(id, orderId, checkout).then(setOrder).catch(() => setOrder(null));
  }, [id, orderId, checkout]);

  const chosen = custom.trim() ? Number(custom) : amount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || chosen <= 0) { setError("Choose or enter an amount."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await startDonation(id, { name: name.trim(), email: email.trim(), message: message.trim() || null, anonymous, hideAmount, amount: chosen, website });
      window.location.assign(r.redirectUrl);
    } catch (err: any) {
      setError(err?.response?.status === 429
        ? "Too many attempts from this connection. Please try again in a few minutes."
        : err?.response?.data?.message || "Could not start the payment. Please try again.");
      setBusy(false);
    }
  };

  const c = page?.campaign;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      {missing ? (
        <Card><CardContent className="p-6 text-sm">This campaign is not available. Please ask the club for a current link.</CardContent></Card>
      ) : !page || !c ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <header className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{page.organisation}</p>
            <h1 className="text-3xl font-bold tracking-tight text-primary">{c.title}</h1>
            {c.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={donationImageUrl(c.imageUrl)!} alt="" className="max-h-72 w-full rounded-sm object-cover" />
            )}
            {c.description && <p className="whitespace-pre-line pt-1 text-base">{c.description}</p>}
          </header>

          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-lg font-semibold tabular-nums">
                {fmt.money(c.progress.raised, c.currency)}
                {c.goalAmount > 0 && <span className="font-normal text-muted-foreground"> raised of {fmt.money(c.goalAmount, c.currency)}</span>}
              </p>
              {c.goalAmount > 0 && <ProgressBar percent={c.progress.percent} />}
              <p className="text-sm text-muted-foreground">
                {c.progress.donors === 1 ? "1 donor" : `${fmt.number(c.progress.donors)} donors`}
                {c.endDate ? `, until ${fmt.date(c.endDate)}` : ""}
              </p>
            </CardContent>
          </Card>

          {orderId && (
            <Card>
              <CardContent className="space-y-3 p-5" role="status">
                {order?.status === "paid" ? (
                  <>
                    <p className="text-base font-semibold">Thank you, {order.donorName}.</p>
                    <p className="text-sm">
                      Your donation of {fmt.money(order.amount, order.currency)} is received. A receipt letter is on its way to
                      your email.
                    </p>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadDonorReceipt(id, orderId, checkout!).catch(() => setError("Could not download the receipt."))}>
                      <Download className="h-4 w-4" /> Download receipt
                    </Button>
                  </>
                ) : (
                  <p className="text-sm">Your payment was not completed. You can try again below.</p>
                )}
              </CardContent>
            </Card>
          )}

          {!c.isOpen ? (
            <Card><CardContent className="p-6 text-sm">This campaign is not taking donations now.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <form className="space-y-5" onSubmit={submit}>
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-base font-semibold">Your gift ({c.currency})</legend>
                    <div className="flex flex-wrap gap-2">
                      {c.tiers.map((t) => (
                        <Button key={t} type="button" variant={amount === t && !custom ? "default" : "outline"}
                          aria-pressed={amount === t && !custom} onClick={() => { setAmount(t); setCustom(""); }}>
                          {fmt.money(t, c.currency)}
                        </Button>
                      ))}
                    </div>
                    {c.allowCustom && (
                      <div className="space-y-1.5 pt-1 sm:w-1/2">
                        <Label htmlFor="dn-amount">Other amount</Label>
                        <Input id="dn-amount" type="number" inputMode="decimal" min={c.minAmount} step="0.01" value={custom} onChange={(e) => setCustom(e.target.value)} />
                      </div>
                    )}
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="dn-name">Your name</Label>
                      <Input id="dn-name" required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dn-email">Your email (for the receipt)</Label>
                      <Input id="dn-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dn-msg">Message (optional)</Label>
                    <Textarea id="dn-msg" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} /> Show me as Anonymous on this page
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={hideAmount} onCheckedChange={(v) => setHideAmount(v === true)} /> Do not show my amount on this page
                  </label>
                  {/* Bots fill every field; people never see this one. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label htmlFor="dn-website">Website</label>
                    <input id="dn-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <Button type="submit" disabled={busy || !chosen} className="gap-1.5">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {chosen ? `Donate ${fmt.money(chosen, c.currency)}` : "Donate"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    You pay on the payment provider&apos;s secure page. Your email is used only for your receipt.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}

          {page.recentDonors.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Recent supporters</h2>
              <ul className="divide-y rounded-sm border">
                {page.recentDonors.map((d, i) => (
                  <li key={i} className="flex justify-between gap-3 p-3 text-sm">
                    <span>
                      <span className="block font-medium">{d.name}</span>
                      {d.message && <span className="block text-muted-foreground">{d.message}</span>}
                    </span>
                    {d.amount != null && <span className="tabular-nums">{fmt.money(d.amount, c.currency)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <footer className="flex gap-4 text-xs text-muted-foreground">
        <Link href="/terms-and-conditions" className="hover:underline">Terms of service</Link>
        <Link href="/privacy-policy" className="hover:underline">Privacy policy</Link>
      </footer>
    </div>
  );
}
