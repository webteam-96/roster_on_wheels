"use client";

/**
 * District or Club subscription: what is active, until when, and Buy / Renew (KIS/ROW/SUB/01 sections 4.1, 4.3, 4.5).
 * The price and who may buy come from the server; this page only shows them and sends the buyer to the checkout.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { checkoutReturnPath, readCheckoutReturn, sessionFrom, startCheckout } from "@/lib/checkout";
import {
  buySubscription, getClubSubscription, getDistrictSubscription, getSubscriptionPrices,
  type ClubSubscriptionStatus, type DistrictSubscriptionStatus, type SubscriptionPrice, type SubscriptionTerm,
} from "@/services/api";

type Kind = "club" | "district";

const getErrorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const LOCK_REASON: Record<string, string> = {
  subscription_required: "This area needs an active subscription.",
  club_subscription_required: "That feature is available with the Club subscription.",
  executives_only: "Under the District subscription only the club's executives on record with Rotary International can sign in.",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function formatMoney(p: SubscriptionPrice | undefined): string {
  if (!p) return "Price not set yet";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(p.amount); }
  catch { return `${p.amount} ${p.currency}`; }
}

/** One line on the state of a subscription, in words a buyer reads at a glance. */
function describe(term: SubscriptionTerm, graceDays: number): { label: string; tone: string; detail: string } {
  switch (term.state) {
    case "Active":
      return { label: "Active", tone: "bg-[#CFE2F6] text-[#0B3F7A]", detail: `Runs until ${formatDate(term.termEnd)}.` };
    case "Grace":
      return {
        label: "Grace period", tone: "bg-[#FFC65C] text-[#1B2C42]",
        detail: `The term ended on ${formatDate(term.termEnd)}. Everything keeps working for ${graceDays} days after that date. Renew to avoid a lock.`,
      };
    case "Expired":
      return { label: "Expired", tone: "bg-red-50 text-red-800", detail: `The term ended on ${formatDate(term.termEnd)}. Nothing was deleted. Renewing restores everything as it was.` };
    default:
      return { label: "Not subscribed", tone: "bg-[#EDF4FB] text-[#1B2C42]", detail: "No subscription yet." };
  }
}

function StatePill({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold ${tone}`}>{label}</span>;
}

export default function SubscriptionPanel({ kind, ownerId }: { kind: Kind; ownerId: number | null }) {
  const searchParams = useSearchParams();
  const lockReason = LOCK_REASON[searchParams?.get("locked") ?? ""];
  const [club, setClub] = useState<ClubSubscriptionStatus | null>(null);
  const [district, setDistrict] = useState<DistrictSubscriptionStatus | null>(null);
  const [prices, setPrices] = useState<SubscriptionPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true); setError(null);
    try {
      const [status, priceList] = await Promise.all([
        kind === "club" ? getClubSubscription(ownerId) : getDistrictSubscription(ownerId),
        getSubscriptionPrices(),
      ]);
      if (kind === "club") setClub(status as ClubSubscriptionStatus); else setDistrict(status as DistrictSubscriptionStatus);
      setPrices(priceList);
    } catch (e) {
      setError(getErrorMessage(e, "The subscription could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [kind, ownerId]);

  // Back from the hosted checkout. Runs once: the token leaves the address on the first read, and the club id arrives
  // later, so reading it together with load() lost the message (ROW-65).
  useEffect(() => {
    readCheckoutReturn().then((outcome) => {
      if (!outcome) return;
      setNotice(outcome === "paid" ? "Payment received. The subscription is active."
        : outcome === "pending" ? "The payment is being confirmed. This page updates once it is."
        : "The payment did not go through. Nothing has changed. You can try again.");
    });
  }, []);

  // The status is read again once the outcome is known.
  useEffect(() => { load(); }, [load, notice]);

  const term: SubscriptionTerm | null = kind === "club" ? club?.clubSubscription ?? null : district;
  const graceDays = (kind === "club" ? club?.graceDays : district?.graceDays) ?? 30;
  const canBuy = (kind === "club" ? club?.canBuy : district?.canBuy) ?? false;
  const price = prices.find((p) => p.kind === kind);
  const working = term?.state === "Active" || term?.state === "Grace";
  const name = kind === "club" ? club?.clubName ?? "your club" : district ? `District ${district.districtNumber}` : "your district";

  async function handleBuy() {
    if (!ownerId) return;
    setBusy(true); setError(null);
    try {
      const order = await buySubscription(kind, kind === "club" ? club?.districtId ?? 0 : ownerId, kind === "club" ? ownerId : 0, checkoutReturnPath());
      if (sessionFrom(order)) { startCheckout(order); return; }
      setError("Online payment is not set up yet. Contact ROW support to activate the subscription.");
    } catch (e) {
      setError(getErrorMessage(e, "The payment could not be started."));
    }
    setBusy(false);
  }

  const title = kind === "club" ? "Club subscription" : "District subscription";
  const description = kind === "club"
    ? "Unlocks the full club module: communication, website, events, membership dues and the member app."
    : "Gives the district office its district modules, and the executives of every club access to club reporting.";

  return (
    <div className="w-full space-y-6">
      <PageHeader title={title} description={description} />
      {lockReason && (
        <p role="status" className="rounded-[20px] border border-[color:var(--row-line)] bg-[#EDF4FB] px-6 py-4 text-[15px] text-[#1B2C42]">
          {lockReason}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-[20px] border border-[color:var(--row-line)] bg-[#CFE2F6] px-6 py-4 text-[15px] text-[#0B3F7A]">
          {notice}
        </p>
      )}
      {error && <ErrorState message={error} onRetry={load} retryLabel="Try again" />}

      <Panel title={name} subtitle={working ? "Renewing adds one year to the end of the current term." : "One year from the day of payment."}>
        {!ownerId ? (
          <p className="text-[15px] text-[#64748B]">Open a {kind} first, then come back to this page.</p>
        ) : loading || !term ? <SkeletonRows rows={3} /> : (
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-2">
              <StatePill {...describe(term, graceDays)} />
              <p className="max-w-[60ch] text-[15px] text-[#1B2C42]">{describe(term, graceDays).detail}</p>
              {kind === "club" && club && club.level === "Reporting" && (
                <p className="max-w-[60ch] text-[14px] text-[#64748B]">
                  Your district is subscribed, so club executives can use reporting: projects, monthly report, attendance, goals, club details and the member list.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
              <p className="font-display text-[24px] font-semibold text-[#1B2C42]">
                {formatMoney(price)} {price && <span className="text-[14px] font-normal text-[#64748B]">per year</span>}
              </p>
              <Button type="button" onClick={handleBuy} disabled={busy || !canBuy || !price}>
                {busy ? "Opening checkout" : working ? "Renew for one year" : "Subscribe"}
              </Button>
              {/* Without this the greyed-out button reads as broken (ROW-65). */}
              {!price && (
                <p className="max-w-[36ch] text-[13px] text-[#64748B] md:text-right">
                  Subscriptions open once this year&apos;s price is published.
                </p>
              )}
              {price && !canBuy && (
                <p className="max-w-[36ch] text-[13px] text-[#64748B] md:text-right">
                  {kind === "club"
                    ? "Only a current club executive on record with Rotary International can buy this."
                    : "Only the District Governor, Governor-Elect or District Secretary can buy this."}
                </p>
              )}
            </div>
          </div>
        )}
      </Panel>

      {kind === "district" && district?.flaggedClubs && district.flaggedClubs.length > 0 && (
        <Panel title="Clubs that need attention" subtitle="Nobody from these clubs was invited. Ask them to update My Rotary, then the nightly sync picks them up.">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="text-[13px] text-[#64748B]">
                <tr><th className="py-2 pr-4 font-semibold">Club</th><th className="py-2 pr-4 font-semibold">Reason</th><th className="py-2 font-semibold">Last checked</th></tr>
              </thead>
              <tbody>
                {district.flaggedClubs.map((c) => (
                  <tr key={c.clubId} className="border-t border-[color:var(--row-line)]">
                    <td className="py-2 pr-4 text-[#1B2C42]">{c.clubName}</td>
                    <td className="py-2 pr-4 text-[#1B2C42]">{c.reason}</td>
                    <td className="py-2 text-[#64748B]">{c.syncedAt ? formatDate(c.syncedAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
