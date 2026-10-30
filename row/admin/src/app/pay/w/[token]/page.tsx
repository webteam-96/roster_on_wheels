"use client";

/**
 * Public (open, no-login) Wallet pay page.
 * --------------------------------------------------------------------------
 * Reached from the SuperAdmin's encrypted Wallet links (/pay/w/{token}). Handles email
 * credit top-ups (club + district) inline, and hands website links back to the club-website flow.
 * "Common" links carry no entity — the payer smart-searches and picks their club/district first
 * (search stays visible; the selection shows below with a "Change" option). Credit pricing
 * (rate/GST) is always re-resolved server-side, so nothing about the amount is client-supplied.
 *
 * Layout: two columns on desktop — the payer's path down the left (find → status → top up),
 * a running payment summary + reassurance rail on the right that sticks while they scroll.
 * All three link purposes share this layout; only the copy and the accent icon change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Search, Mail, Globe, Megaphone, BarChart3,
  CheckCircle2, ShieldCheck, Zap, Lock, Check,
} from "@/components/icons";
import PayPageShell from "@/components/PayPageShell";
import { PayCard as Card, PayHelpCard, PayBenefits, PayTrustRows, supportPhone } from "@/components/PayCard";
import {
  getPublicWallet, searchPublicWallet, getPublicWalletEntity, getPublicWalletQuote,
  resolvePublicWalletWebsiteToken, createPublicWalletOrder, verifyPublicWalletOrder,
  type PublicWalletInfo, type PublicWalletSearchResult, type PublicWalletQuote,
} from "@/services/api";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { SkeletonRows } from "@/components/row/AppKit";
const PRESETS = [500, 1000, 2000, 5000];
const POPULAR = 1000;                         // the tile carrying the "Popular" flag

/**
 * Purpose-specific copy. The layout is shared across all three link types — only the words
 * and the accent icon change, so a club officer always meets the same shape of page.
 */
const COPY = {
  email: {
    icon: Mail,
    landingTitle: "Email credits",
    lede: "Recharge your club's email credits and stay connected.",
    topUpTitle: "Top up Email credits",
    benefits: [
      { icon: Mail, text: "Reach every member's inbox directly" },
      { icon: Zap, text: "Credits are added the moment payment succeeds" },
      { icon: Megaphone, text: "Send notices, agendas and reports in one go" },
    ],
  },
  website: {
    icon: Globe,
    landingTitle: "Club website",
    lede: "Set up or renew your club's website.",
    topUpTitle: "Club website",
    benefits: [
      { icon: Globe, text: "Keep your club website active and visible" },
      { icon: ShieldCheck, text: "Hosting, security and renewals handled for you" },
      { icon: Megaphone, text: "Give your club a public home online" },
    ],
  },
} as const;

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && (window as any).Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const inr = (n: number) => `${currencySymbol()}${Number(n || 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "–");
const num = (n?: number | null) => Number(n ?? 0).toLocaleString(appLocale());

export default function PublicWalletPayPage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token || "");

  const [link, setLink] = useState<PublicWalletInfo | null>(null);   // scope/purpose + (specific) entity
  const [entity, setEntity] = useState<PublicWalletInfo | null>(null); // resolved entity (name + status)
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pick (common links)
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PublicWalletSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);

  // Credit purchase
  const [amount, setAmount] = useState<string>(String(PRESETS[1]));
  const [quote, setQuote] = useState<PublicWalletQuote | null>(null);
  const [presetCredits, setPresetCredits] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const purpose = link?.purpose;                       // "website" | "email"
  const isCredit = purpose === "email";
  const creditLabel = "Email";
  const isCommon = !!link?.requiresPick;               // link carries no entity — payer must pick
  const status = entity?.status || null;
  const copy = COPY[(purpose as keyof typeof COPY) || "email"] ?? COPY.email;
  const PurposeIcon = copy.icon;
  const entityWord = link?.scope === "district" ? "district" : "club";
  // GST rate is server config, so derive the percentage from the amounts rather than hardcoding it.
  const gstPct = quote && !quote.error && quote.baseAmount > 0
    ? Math.round((quote.gstAmount / quote.baseAmount) * 100) : null;

  const loadInfo = useCallback(async () => {
    if (!token) return;
    setLoadingInfo(true); setLoadError(null);
    try {
      const l = await getPublicWallet(token);
      setLink(l);
      if (!l.requiresPick) setEntity(l);               // specific link — entity already resolved
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || "This link is invalid or has expired.");
    } finally {
      setLoadingInfo(false);
    }
  }, [token]);

  useEffect(() => { loadInfo(); }, [loadInfo]);

  // Debounced smart search (common links).
  useEffect(() => {
    if (!isCommon) return;
    const v = term.trim();
    if (v.length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setResults(await searchPublicWallet(token, v)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [term, isCommon, token]);

  const pickEntity = async (id: number) => {
    setPicking(true); setError(null);
    try { setEntity(await getPublicWalletEntity(token, id)); setResults([]); setTerm(""); }
    catch (e: any) { setError(e?.response?.data?.message || "Could not load that selection."); }
    finally { setPicking(false); }
  };
  const clearEntity = () => { setEntity(null); setResults([]); setTerm(""); setError(null); setResult(null); };

  // Preset credit counts (once, for credit links) — labels the quick-pick buttons.
  const presetsFetched = useRef(false);
  useEffect(() => {
    if (!isCredit || presetsFetched.current) return;
    presetsFetched.current = true;
    (async () => {
      const entries = await Promise.all(PRESETS.map(async (amt) => {
        try { const q = await getPublicWalletQuote(token, amt); return [amt, q.creditCount] as const; }
        catch { return [amt, 0] as const; }
      }));
      setPresetCredits(Object.fromEntries(entries));
    })();
  }, [isCredit, token]);

  // Live quote for the entered amount.
  useEffect(() => {
    if (!isCredit) return;
    const amt = Number(amount);
    if (!amt || Number.isNaN(amt)) { setQuote(null); return; }
    const t = setTimeout(async () => {
      try { setQuote(await getPublicWalletQuote(token, amt)); }
      catch { setQuote(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [amount, isCredit, token]);

  async function handleWebsite() {
    if (!entity) return;
    setBusy(true); setError(null);
    try {
      const { websiteToken } = await resolvePublicWalletWebsiteToken(token, entity.entityId);
      router.push(`/pay/club-website/${websiteToken}`);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not continue to the website purchase.");
      setBusy(false);
    }
  }

  async function handleCreditPay() {
    if (!entity) return;
    const amt = Number(amount);
    if (!amt || Number.isNaN(amt)) { setError("Enter an amount."); return; }
    setBusy(true); setError(null);
    try {
      const order = await createPublicWalletOrder(token, { entityId: entity.entityId, amount: amt });
      const ok = await loadRazorpayScript();
      if (!ok) { setError("Could not load the payment gateway. Please try again."); setBusy(false); return; }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "ROW",
        description: `${creditLabel} credits: ${entity.entityName}`,
        handler: async (resp: any) => {
          try {
            const v = await verifyPublicWalletOrder(token, {
              topupOrderId: order.topupOrderId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            });
            if (v.isSuccess) { setResult(v); }
            else setError(v.message || "Payment verification failed. If money was deducted it will reconcile shortly.");
          } catch {
            setError("Payment verification failed. If money was deducted it will reconcile shortly.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: "#17458F" },
      });
      rzp.on("payment.failed", () => { setError("Payment failed. Please try again."); setBusy(false); });
      rzp.open();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not start the payment. Please try again.");
      setBusy(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  /** Right rail: why this matters, the running total, and how to reach a human. */
  const rail = (
    <aside className="space-y-4 lg:sticky lg:top-6">
      <Card title={purpose === "website" ? "Why a club website?" : "Why recharge?"}>
        <PayBenefits items={copy.benefits} />
      </Card>

      {isCredit && entity && quote && !quote.error && (
        <Card title="Payment summary">
          <dl className="space-y-2.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{entityWord === "district" ? "District" : "Club"}</dt>
              <dd className="min-w-0 truncate text-right font-semibold text-slate-900">{entity.entityName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{creditLabel} credits</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{num(quote.creditCount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Base amount</dt>
              <dd className="tabular-nums text-slate-700">{inr(quote.baseAmount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">GST{gstPct != null ? ` (${gstPct}%)` : ""}</dt>
              <dd className="tabular-nums text-slate-700">{inr(quote.gstAmount)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-4">
            <span className="text-sm font-bold text-azure">Total payable</span>
            <span className="text-lg font-bold tabular-nums text-azure">{inr(quote.totalAmount)}</span>
          </div>
          <PayTrustRows activationNote="Credits are added as soon as payment succeeds." />
        </Card>
      )}

      <PayHelpCard />
    </aside>
  );

  let body: React.ReactNode;

  if (loadingInfo) {
    body = (
      <div className="py-24 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-azure" />
        <SkeletonRows />
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
        <h1 className="text-lg font-bold text-red-800">This link doesn&apos;t work</h1>
        <p className="mt-2 text-sm text-red-700">{loadError}</p>
        <p className="mt-4 text-xs text-red-600">
          Ask your district team for a fresh link, {supportPhone() ? <> or call {supportPhone()}</> : null}.
        </p>
      </div>
    );
  } else if (result) {
    body = (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <Check className="h-7 w-7 text-emerald-600" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Payment received</h1>
        <p className="mt-2 text-sm text-slate-600">
          <b className="text-slate-900">{num(result.creditCount)}</b> {creditLabel.toLowerCase()} credits added to{" "}
          <span className="font-semibold text-slate-900">{entity?.entityName}</span>.
        </p>
        {result.newBalance && (
          <div className="mt-6 grid grid-cols-1 gap-3 text-left">
            {[
              ["Email credits", result.newBalance.emailRemaining],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{label as string}</div>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{num(val as number)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        {/* ── Left: the payer's path ─────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Header — club name once it's known, otherwise the purpose. Gold rule ties it to Rotary. */}
          <header className="relative overflow-hidden">
            <h1 className="text-3xl font-bold tracking-tight text-azure sm:text-[2.5rem] sm:leading-[1.1]">
              {entity?.entityName || copy.landingTitle}
            </h1>
            <div className="mt-3 h-1 w-16 rounded-full bg-marigold" />
            <p className="mt-4 text-sm text-slate-600">
              {entity ? copy.lede : `Find your ${entityWord} to check its balance and continue.`}
            </p>
          </header>

          {/* Find your club — only on "any club" links. */}
          {isCommon && (
            <Card
              icon={Search}
              title={`Find your ${entityWord}`}
              subtitle={`Search and select your ${entityWord} to continue.`}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
                  aria-label={`Search by ${entityWord} name`}
                  placeholder={entityWord === "district" ? "Search by district number…" : "Search by club name…"}
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-azure focus:ring-2 focus:ring-azure/20"
                />
              </div>

              {searching && <p className="mt-2 text-xs text-slate-400">Searching…</p>}

              {results.length > 0 && (
                <ul className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button" disabled={picking} onClick={() => pickEntity(r.id)}
                        className="w-full px-4 py-3 text-left transition hover:bg-blue-50/60 disabled:opacity-50"
                      >
                        <div className="text-sm font-medium text-slate-800">{r.name}</div>
                        {r.districtNumber && link?.scope === "club" && (
                          <div className="text-xs text-slate-400">District {r.districtNumber}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!searching && term.trim().length >= 2 && results.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">
                  No {entityWord}s match “{term.trim()}”. Try a shorter name.
                </p>
              )}

              {entity && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-azure/25 bg-blue-50/70 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-azure/70">
                      Selected {entityWord}
                    </div>
                    <div className="truncate text-[15px] font-bold text-azure">{entity.entityName}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <button type="button" onClick={clearEntity}
                      className="text-[13px] font-semibold text-azure hover:underline">
                      Change
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Status + buy (once an entity is known) */}
          {entity && status && (
            <>
              <Card icon={BarChart3} title="Current status">
                <dl className="space-y-2.5 text-sm">
                  {entity.scope === "club" && status.websiteOrderType && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-slate-600">Club website</dt>
                      <dd className="min-w-0 text-right">
                        {status.websiteOrderType === "Renewal"
                          ? <>Active until <b className="text-emerald-600">{fmtDate(status.websiteCurrentEndDate)}</b></>
                          : <span className="font-medium text-amber-700">Not set up yet</span>}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Email credits</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{num(status.emailRemaining)}</dd>
                  </div>
                </dl>
              </Card>

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Website: hand off to the club-website flow */}
              {purpose === "website" && (
                <Card icon={Globe} title="Club website">
                  {status.websiteCanPurchase === false ? (
                    <p className="text-sm text-slate-600">
                      {status.websitePurchaseBlockedReason || "This website is active with plenty of time left. Nothing to pay yet."}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-slate-600">
                        {status.websiteOrderType === "Renewal"
                          ? "Renew this club's website."
                          : "Set up a new website for this club."}
                      </p>
                      <button onClick={handleWebsite} disabled={busy}
                        className="mt-4 w-full rounded-full bg-azure py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60">
                        {busy ? "Loading…" : "Continue to website purchase →"}
                      </button>
                    </>
                  )}
                </Card>
              )}

              {/* Credits: preset + custom amount */}
              {isCredit && (
                <Card icon={PurposeIcon} title={copy.topUpTitle} subtitle="Choose a quick amount or enter your own.">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {PRESETS.map((amt) => {
                      const selected = Number(amount) === amt;
                      return (
                        <button
                          key={amt} type="button" onClick={() => setAmount(String(amt))}
                          aria-pressed={selected}
                          className={`relative rounded-xl border px-2 pb-3 pt-3.5 text-center transition ${
                            selected
                              ? "border-azure bg-blue-50/70 ring-1 ring-azure"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          {amt === POPULAR && (
                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-azure px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                              Popular
                            </span>
                          )}
                          <div className={`text-sm font-bold ${selected ? "text-azure" : "text-slate-900"}`}>
                            {inr(amt)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {presetCredits[amt] != null ? `${num(presetCredits[amt])} credits` : "…"}
                          </div>
                          <span className={`mx-auto mt-2 block h-4 w-4 rounded-full border-2 ${
                            selected ? "border-azure bg-azure" : "border-slate-300"
                          }`}>
                            {selected && <Check className="h-3 w-3 text-white" strokeWidth={3.5} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5">
                    <label htmlFor="wallet-amount" className="text-xs font-medium text-slate-500">
                      Or enter an amount ({currencySymbol()})
                    </label>
                    <input
                      id="wallet-amount" type="number" min={0} value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-azure focus:ring-2 focus:ring-azure/20"
                    />
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    {quote?.error ? (
                      <p className="text-red-600">{quote.error}</p>
                    ) : quote ? (
                      <>
                        <dl className="space-y-2">
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">{creditLabel} credits</dt>
                            <dd className="font-semibold tabular-nums text-slate-900">{num(quote.creditCount)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">Base</dt>
                            <dd className="tabular-nums text-slate-700">{inr(quote.baseAmount)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-600">GST{gstPct != null ? ` (${gstPct}%)` : ""}</dt>
                            <dd className="tabular-nums text-slate-700">{inr(quote.gstAmount)}</dd>
                          </div>
                        </dl>
                        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3">
                          <span className="font-bold text-azure">Total payable</span>
                          <span className="text-base font-bold tabular-nums text-azure">{inr(quote.totalAmount)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-slate-500">Enter an amount to see the total.</p>
                    )}
                  </div>

                  <button
                    onClick={handleCreditPay} disabled={busy || !quote || !!quote?.error}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-azure py-4 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Lock className="h-4 w-4" />
                    {busy ? "Processing…" : `Pay ${quote && !quote.error ? inr(quote.totalAmount) : ""}`}
                  </button>

                  <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
                    <ShieldCheck className="mr-1 inline-block h-3.5 w-3.5 align-[-3px]" />
                    Secure payment via Razorpay. Credits are added automatically once payment succeeds.
                  </p>
                </Card>
              )}
            </>
          )}
        </div>

        {/* ── Right: summary + reassurance ───────────────────────────────── */}
        {rail}
      </div>
    );
  }

  return <PayPageShell wide>{body}</PayPageShell>;
}
