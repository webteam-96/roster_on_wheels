"use client";

/**
 * Public (open, no-login) Club Website purchase page.
 * --------------------------------------------------------------------------
 * Reached from the SuperAdmin's encrypted reminder link (/pay/club-website/{token}).
 * The token carries only { clubId, yearId, expiry }; the price, GST and gateway are
 * resolved server-side per-club/year, so nothing about the amount is client-supplied.
 *
 * Flow (New):   subdomain → confirm URL (immutable) → pay → done
 * Flow (Renew): confirm → pay → done  (subdomain fixed, shown read-only)
 *
 * Layout matches the wallet top-up page: the payer's path down the left, a sticky
 * payment-summary + reassurance rail on the right.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Globe, ShieldCheck, Megaphone, Link2, CheckCircle2, Lock, Check, AlertTriangle,
} from "lucide-react";
import PayPageShell from "@/components/PayPageShell";
import { PayCard as Card, PayHelpCard, PayBenefits, PayTrustRows, SUPPORT_PHONE } from "@/components/PayCard";
import {
  getPublicClubWebsite, checkPublicClubWebsiteSubdomain,
  createPublicClubWebsiteOrder, verifyPublicClubWebsiteOrder,
} from "@/services/api";

type Step = "subdomain" | "confirm" | "pay" | "done";

const BENEFITS = [
  { icon: Globe, text: "Keep your club website active and visible" },
  { icon: ShieldCheck, text: "Hosting, security and renewals handled for you" },
  { icon: Megaphone, text: "Give your club a public home online" },
] as const;

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

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function PublicClubWebsitePayPage() {
  const params = useParams();
  const token = String(params.token || "");

  const [info, setInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("subdomain");
  const [subInput, setSubInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ available: boolean; reason?: string } | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const isRenewal = info?.orderType === "Renewal";
  const parentDomain = info?.parentDomain || "example.org";
  const prefix = info?.subdomainPrefix || "rc";

  const loadInfo = useCallback(async () => {
    if (!token) return;
    setLoadingInfo(true); setLoadError(null);
    try {
      const d = await getPublicClubWebsite(token);
      setInfo(d);
      setStep(d.orderType === "Renewal" ? "confirm" : "subdomain");
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || "This link is invalid or has expired.");
    } finally {
      setLoadingInfo(false);
    }
  }, [token]);

  useEffect(() => { loadInfo(); }, [loadInfo]);

  // Debounced subdomain availability check (New only).
  useEffect(() => {
    if (isRenewal) return;
    setCheck(null);
    const v = subInput.trim();
    if (v.length < 3) return;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await checkPublicClubWebsiteSubdomain(token, v);
        setCheck({ available: r.available, reason: r.reason });
      } catch {
        setCheck({ available: false, reason: "Could not check availability." });
      } finally {
        setChecking(false);
      }
    }, 500);
    return () => { clearTimeout(t); setChecking(false); };
  }, [subInput, isRenewal, token]);

  function sanitize(v: string) { return v.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30); }
  const subValid = subInput.length >= 3 && subInput.length <= 30 && check?.available === true;

  async function handlePay() {
    if (!info) return;
    setError(null); setBusy(true);
    try {
      const order = await createPublicClubWebsiteOrder(token, { subdomainInput: isRenewal ? undefined : subInput });
      const ok = await loadRazorpayScript();
      if (!ok) { setError("Could not load the payment gateway. Please try again."); setBusy(false); return; }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "ROW",
        description: `Club website ${order.orderType} — ${order.clubName || `${order.subdomain}.${parentDomain}`}`,
        handler: async (resp: any) => {
          try {
            const v = await verifyPublicClubWebsiteOrder(token, {
              websiteOrderId: order.websiteOrderId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            });
            if (v.isSuccess) { setResult(v); setStep("done"); }
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

  if (loadingInfo) return (
    <PayPageShell wide>
      <div className="py-24 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#17458F]" />
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </div>
    </PayPageShell>
  );

  if (loadError) return (
    <PayPageShell wide>
      <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
        <h1 className="text-lg font-bold text-red-800">This link doesn&apos;t work</h1>
        <p className="mt-2 text-sm text-red-700">{loadError}</p>
        <p className="mt-4 text-xs text-red-600">Ask your district team for a fresh link, or call {SUPPORT_PHONE}.</p>
      </div>
    </PayPageShell>
  );

  // Active site with plenty of time left — nothing to pay for yet.
  if (info && info.canPurchase === false) return (
    <PayPageShell wide>
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <Check className="h-7 w-7 text-emerald-600" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Your club website is active</h1>
        <p className="mt-1 text-sm text-slate-500">{info.clubName}</p>
        {info.currentEndDate && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700">Valid until</div>
            <div className="text-xl font-bold text-emerald-800">{fmtDate(info.currentEndDate)}</div>
          </div>
        )}
        <p className="mt-4 text-sm text-slate-600">{info.purchaseBlockedReason || "Renewal opens closer to expiry."}</p>
        {info.currentSubdomain && (
          <a href={`https://${info.currentSubdomain}.${parentDomain}`} target="_blank" rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 break-all font-semibold text-[#17458F] hover:underline">
            <Link2 className="h-4 w-4 shrink-0" />
            {info.currentSubdomain}.{parentDomain}
          </a>
        )}
      </div>
    </PayPageShell>
  );

  const siteAddress = isRenewal ? `${info.currentSubdomain}.${parentDomain}` : `${prefix}${subInput}.${parentDomain}`;

  // Step 4 is terminal — show it on its own, like the wallet page's receipt.
  if (step === "done" && result) return (
    <PayPageShell wide>
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <Check className="h-7 w-7 text-emerald-600" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Payment received</h1>
        {result.provisionStatus === "Active" ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Your website is live{result.endDate ? <> until <b className="text-slate-900">{fmtDate(result.endDate)}</b></> : ""}.
            </p>
            {result.visitUrl && (
              <a href={result.visitUrl} target="_blank" rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 break-all rounded-xl border border-[#17458F]/25 bg-blue-50/70 px-4 py-3 font-semibold text-[#17458F] hover:underline">
                <Link2 className="h-4 w-4 shrink-0" />
                {result.visitUrl}
              </a>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Your website <span className="font-semibold text-slate-900">{siteAddress}</span> is being set up in the
            background. We&apos;ll email your club as soon as it&apos;s live.
          </p>
        )}
      </div>
    </PayPageShell>
  );

  /** Right rail: why it matters, the running total, and how to reach a human. */
  const rail = (
    <aside className="space-y-4 lg:sticky lg:top-6">
      <Card title="Why a club website?">
        <PayBenefits items={BENEFITS} />
      </Card>

      <Card title="Payment summary">
        <dl className="space-y-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Club</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-slate-900">{info.clubName}</dd>
          </div>
          {isRenewal && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-slate-500">Current expiry</dt>
              <dd className="tabular-nums text-slate-700">{fmtDate(info.currentEndDate)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Valid until</dt>
            <dd className="font-semibold tabular-nums text-emerald-600">{fmtDate(info.newEndDate)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Website ({info.validityMonths} months)</dt>
            <dd className="tabular-nums text-slate-700">{inr(info.baseAmount)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">GST ({info.gstPercent}%)</dt>
            <dd className="tabular-nums text-slate-700">{inr(info.gstAmount)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-4">
          <span className="text-sm font-bold text-[#17458F]">Total payable</span>
          <span className="text-lg font-bold tabular-nums text-[#17458F]">{inr(info.totalAmount)}</span>
        </div>
        <PayTrustRows activationNote="Your site is set up as soon as payment succeeds." />
      </Card>

      <PayHelpCard />
    </aside>
  );

  const steps: { key: Step; label: string }[] = isRenewal
    ? [{ key: "confirm", label: "Confirm" }, { key: "pay", label: "Pay" }]
    : [{ key: "subdomain", label: "Address" }, { key: "confirm", label: "Confirm" }, { key: "pay", label: "Pay" }];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <PayPageShell wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        {/* ── Left: the payer's path ─────────────────────────────────────── */}
        <div className="space-y-5">
          <header>
            <h1 className="text-3xl font-bold tracking-tight text-[#17458F] sm:text-[2.5rem] sm:leading-[1.1]">
              {info?.clubName || "Club website"}
            </h1>
            <div className="mt-3 h-1 w-16 rounded-full bg-[#F7A81B]" />
            <p className="mt-4 text-sm text-slate-600">
              {isRenewal ? "Renew your club's website and keep it online." : "Set up your club's website and get it online."}
            </p>
          </header>

          {/* Where the payer is in the flow — this really is a sequence. */}
          <ol className="flex items-center gap-2 text-[12px] font-medium">
            {steps.map((s, i) => {
              const done = i < stepIndex, current = i === stepIndex;
              return (
                <li key={s.key} className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    done ? "bg-emerald-600 text-white"
                      : current ? "bg-[#17458F] text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}>
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={current ? "text-[#17458F]" : done ? "text-slate-600" : "text-slate-400"}>{s.label}</span>
                  {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200" />}
                </li>
              );
            })}
          </ol>

          {/* Step: subdomain (New only) */}
          {step === "subdomain" && (
            <Card icon={Globe} title="Choose your website address" subtitle="Lowercase letters and numbers only, 3–30 characters.">
              <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300 transition focus-within:border-[#17458F] focus-within:ring-2 focus-within:ring-[#17458F]/20">
                <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">{prefix}</span>
                <input
                  autoFocus value={subInput} onChange={(e) => setSubInput(sanitize(e.target.value))}
                  aria-label="Website address" placeholder="yourclub"
                  className="min-w-0 flex-1 px-3 py-3 text-sm outline-none"
                />
                <span className="flex items-center border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">.{parentDomain}</span>
              </div>

              {subInput.length >= 3 && (
                <div className="mt-3 text-sm">
                  {checking ? (
                    <span className="text-slate-400">Checking availability…</span>
                  ) : check?.available ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" /> {prefix}{subInput}.{parentDomain} is available
                    </span>
                  ) : (
                    <span className="text-red-600">{check?.reason || "Not available."}</span>
                  )}
                </div>
              )}

              <button
                type="button" disabled={!subValid} onClick={() => setStep("confirm")}
                className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#17458F] to-[#0F3168] py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
              >
                Continue
              </button>
            </Card>
          )}

          {/* Step: confirm */}
          {step === "confirm" && (
            <Card icon={Link2} title="Confirm your website address">
              <p className="text-[13px] text-slate-500">Your website address {isRenewal ? "is" : "will be"}</p>
              <div className="mt-3 rounded-xl border border-[#17458F]/25 bg-blue-50/70 px-4 py-5 text-center">
                <span className="break-all text-xl font-extrabold tracking-tight text-[#17458F] sm:text-2xl">{siteAddress}</span>
              </div>

              {!isRenewal && (
                <>
                  <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Please check this carefully. Once created, this address <b>cannot be changed</b>.</p>
                  </div>
                  <label className="mt-4 flex items-center gap-2.5 text-sm text-slate-700">
                    <input
                      type="checkbox" checked={confirmChecked}
                      onChange={(e) => setConfirmChecked(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#17458F] focus:ring-[#17458F]"
                    />
                    The address above is correct.
                  </label>
                </>
              )}

              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                {!isRenewal && (
                  <button type="button" onClick={() => { setConfirmChecked(false); setStep("subdomain"); }}
                    className="rounded-xl border border-slate-300 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:order-1">
                    Back
                  </button>
                )}
                <button
                  type="button" disabled={!isRenewal && !confirmChecked} onClick={() => setStep("pay")}
                  className="flex-1 rounded-xl bg-gradient-to-r from-[#17458F] to-[#0F3168] py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
                >
                  Confirm and continue
                </button>
              </div>
            </Card>
          )}

          {/* Step: pay */}
          {step === "pay" && (
            <Card icon={Lock} title="Review and pay">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <dl className="space-y-2">
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-slate-600">Website</dt>
                    <dd className="min-w-0 break-all text-right font-semibold text-slate-900">{siteAddress}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Valid until</dt>
                    <dd className="tabular-nums text-slate-700">{fmtDate(info.newEndDate)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">Website ({info.validityMonths} months)</dt>
                    <dd className="tabular-nums text-slate-700">{inr(info.baseAmount)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">GST ({info.gstPercent}%)</dt>
                    <dd className="tabular-nums text-slate-700">{inr(info.gstAmount)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3">
                  <span className="font-bold text-[#17458F]">Total payable</span>
                  <span className="text-base font-bold tabular-nums text-[#17458F]">{inr(info.totalAmount)}</span>
                </div>
              </div>

              {error && (
                <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <button type="button" onClick={() => setStep("confirm")}
                  className="rounded-xl border border-slate-300 px-6 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:order-1">
                  Back
                </button>
                <button
                  type="button" disabled={busy} onClick={handlePay}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#17458F] to-[#0F3168] py-4 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:order-2"
                >
                  <Lock className="h-4 w-4" />
                  {busy ? "Processing…" : `Pay ${inr(info.totalAmount)}`}
                </button>
              </div>

              <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
                <ShieldCheck className="mr-1 inline-block h-3.5 w-3.5 align-[-3px]" />
                Secure payment via Razorpay. Valid for {info.validityMonths} months from payment.
              </p>
            </Card>
          )}
        </div>

        {/* ── Right: summary + reassurance ───────────────────────────────── */}
        {rail}
      </div>
    </PayPageShell>
  );
}
