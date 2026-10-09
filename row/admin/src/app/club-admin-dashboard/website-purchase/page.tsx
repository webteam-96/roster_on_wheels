"use client";

/**
 * Club Admin › Buy / Renew Club Website (Razorpay).
 * --------------------------------------------------------------------------
 * Self-service purchase of the club's public website (rc<name>.rotaryindia.org),
 * ₹10,999 + 18% GST for 12 months. Server is authoritative on price, subdomain
 * rules, validity and provisioning; on payment the site is auto-provisioned.
 *
 * Flow (New):  subdomain → confirm URL (immutable) → reminder days → pay → result
 * Flow (Renew): reminder days → pay → result  (subdomain fixed, shown read-only)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWebsiteQuote, checkWebsiteSubdomain, createWebsiteOrder, verifyWebsiteOrder,
} from "@/services/api";

type Step = "subdomain" | "confirm" | "reminder" | "pay" | "done";

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

export default function WebsitePurchasePage() {
  const { selectedClubId } = useAuth();
  const router = useRouter();

  const [quote, setQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("subdomain");
  const [subInput, setSubInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ available: boolean; reason?: string } | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [reminderDays, setReminderDays] = useState<string>("15");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const isRenewal = quote?.orderType === "Renewal";
  const parentDomain = quote?.parentDomain || "rotaryindia.org";
  const prefix = quote?.subdomainPrefix || "rc";
  const fullUrl = isRenewal
    ? `${quote?.currentSubdomain || ""}.${parentDomain}`
    : `${prefix}${subInput}.${parentDomain}`;

  const loadQuote = useCallback(async () => {
    if (!selectedClubId) return;
    setLoadingQuote(true); setLoadError(null);
    try {
      const q = await getWebsiteQuote(selectedClubId);
      setQuote(q);
      setStep(q.orderType === "Renewal" ? "reminder" : "subdomain");
      setReminderDays("15");
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || "Could not load pricing. Please try again.");
    } finally {
      setLoadingQuote(false);
    }
  }, [selectedClubId]);

  useEffect(() => { loadQuote(); }, [loadQuote]);

  // Debounced subdomain availability check.
  useEffect(() => {
    if (isRenewal) return;
    setCheck(null);
    const v = subInput.trim();
    if (v.length < 3) return;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await checkWebsiteSubdomain(v, selectedClubId ?? undefined);
        setCheck({ available: r.available, reason: r.reason });
      } catch {
        setCheck({ available: false, reason: "Could not check availability." });
      } finally {
        setChecking(false);
      }
    }, 500);
    return () => { clearTimeout(t); setChecking(false); };
  }, [subInput, isRenewal, selectedClubId]);

  function sanitize(v: string) {
    return v.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  }

  const rem = parseInt(reminderDays, 10);
  const reminderValid = !Number.isNaN(rem) && rem >= 1 && rem <= 90;
  const subValid = subInput.length >= 3 && subInput.length <= 30 && check?.available === true;

  async function handlePay() {
    if (!selectedClubId || !quote) return;
    setError(null); setBusy(true);
    try {
      const order = await createWebsiteOrder({
        clubId: selectedClubId,
        subdomainInput: isRenewal ? undefined : subInput,
        reminderDays: rem,
      });
      const ok = await loadRazorpayScript();
      if (!ok) { setError("Could not load the payment gateway. Please try again."); setBusy(false); return; }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "Rotary Zones 4, 5, 6, 7 & 8",
        description: `${order.orderType === "Renewal" ? "Club website renewal" : "New club website"} — ${order.subdomain}.${parentDomain}`,
        handler: async (resp: any) => {
          try {
            const v = await verifyWebsiteOrder({
              websiteOrderId: order.websiteOrderId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            });
            if (v.isSuccess) {
              setResult(v); setStep("done");
              // Provisioning runs in the background — tell the global toast to start tracking it.
              try { window.dispatchEvent(new Event("rc-website-provisioning-started")); } catch { /* ignore */ }
            } else setError(v.message || "Payment verification failed. If money was deducted it will reconcile shortly.");
          } catch {
            setError("Payment verification failed. If money was deducted it will reconcile shortly.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: "#003DA5" },
      });
      rzp.on("payment.failed", () => { setError("Payment failed. Please try again."); setBusy(false); });
      rzp.open();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not start the payment. Please try again.");
      setBusy(false);
    }
  }

  if (!selectedClubId) return <div className="p-6 text-sm text-slate-500">Select a club to buy or renew its website.</div>;
  if (loadingQuote) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (loadError) return <div className="p-6"><div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div></div>;

  // Active site with plenty of validity left — renewal isn't open yet.
  if (quote && quote.canPurchase === false) return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-xl border bg-white p-6 text-center space-y-3">
        <div className="text-3xl">✅</div>
        <h1 className="text-lg font-semibold text-[#003DA5]">Your club website is active</h1>
        <p className="text-sm text-slate-600">{quote.purchaseBlockedReason || "Renewal opens closer to expiry."}</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#003DA5]">{isRenewal ? "Renew Club Website" : "Buy Club Website"}</h1>
        <p className="text-sm text-slate-500">
          {isRenewal
            ? "Extend your club website for another year."
            : "Get your club's own website at rc<name>.rotaryindia.org."}
        </p>
      </div>

      {/* Price summary — always visible */}
      <div className="rounded-xl border bg-white p-5 text-sm space-y-1.5">
        {isRenewal && (
          <>
            <div className="flex justify-between"><span className="text-slate-600">Current site</span><span className="font-medium">{quote.currentSubdomain}.{parentDomain}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Current expiry</span><span>{fmtDate(quote.currentEndDate)}</span></div>
          </>
        )}
        <div className="flex justify-between"><span className="text-slate-600">New expiry after payment</span><span className="font-medium">{fmtDate(quote.newEndDate)}</span></div>
        <div className="flex justify-between"><span className="text-slate-600">Website ({quote.validityMonths} months)</span><span>{inr(quote.baseAmount)}</span></div>
        <div className="flex justify-between"><span className="text-slate-600">GST ({quote.gstPercent}%)</span><span>{inr(quote.gstAmount)}</span></div>
        <div className="flex justify-between border-t pt-1.5 font-semibold text-[#003DA5]"><span>Total payable</span><span>{inr(quote.totalAmount)}</span></div>
      </div>

      {/* Step: subdomain (New only) */}
      {step === "subdomain" && (
        <div className="rounded-xl border bg-white p-5 space-y-4">
          <div className="font-semibold text-slate-800">Choose your website address</div>
          <div className="flex items-stretch rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-[#003DA5]">
            <span className="flex items-center px-3 bg-slate-50 text-slate-500 text-sm border-r">{prefix}</span>
            <input
              autoFocus
              value={subInput}
              onChange={(e) => setSubInput(sanitize(e.target.value))}
              placeholder="yourclub"
              className="flex-1 px-3 py-2.5 outline-none text-sm"
            />
            <span className="flex items-center px-3 bg-slate-50 text-slate-500 text-sm border-l">.{parentDomain}</span>
          </div>
          <p className="text-xs text-slate-400">Lowercase letters and numbers only, 3–30 characters.</p>

          {subInput.length >= 3 && (
            <div className="text-sm">
              {checking ? <span className="text-slate-400">Checking availability…</span>
                : check?.available ? <span className="text-emerald-600 font-medium">✓ {prefix}{subInput}.{parentDomain} is available</span>
                : <span className="text-red-600">✗ {check?.reason || "Not available."}</span>}
            </div>
          )}

          <button
            type="button"
            disabled={!subValid}
            onClick={() => setStep("confirm")}
            className="px-6 py-2.5 rounded-lg bg-[#003DA5] text-white font-medium disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: confirm (hyper-focused, New only) */}
      {step === "confirm" && (
        <div className="rounded-xl border-2 border-[#003DA5] bg-white p-6 space-y-5 text-center">
          <div className="text-sm text-slate-500">Your website address will be</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-[#003DA5] break-all tracking-tight">
            {prefix}{subInput}.{parentDomain}
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-sm p-3 font-medium">
            ⚠️ Please check this carefully. Once created, this address <span className="underline">cannot be changed</span>.
          </div>
          <label className="flex items-center justify-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
            The address above is correct.
          </label>
          <div className="flex justify-center gap-3">
            <button type="button" onClick={() => { setConfirmChecked(false); setStep("subdomain"); }}
              className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium">Back</button>
            <button type="button" disabled={!confirmChecked} onClick={() => setStep("reminder")}
              className="px-6 py-2.5 rounded-lg bg-[#003DA5] text-white font-medium disabled:opacity-50">Confirm &amp; Continue</button>
          </div>
        </div>
      )}

      {/* Step: reminder */}
      {step === "reminder" && (
        <div className="rounded-xl border bg-white p-5 space-y-4">
          {!isRenewal && (
            <div className="text-sm text-slate-600">Address: <span className="font-semibold text-slate-800">{prefix}{subInput}.{parentDomain}</span></div>
          )}
          <div className="font-semibold text-slate-800">Expiry reminder</div>
          <div className="space-y-1.5">
            <label className="text-sm text-slate-700">Remind me this many days before expiry</label>
            <input
              type="number" min={1} max={90} value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-[#003DA5]"
            />
            {!reminderValid && reminderDays !== "" && <p className="text-xs text-red-600">Enter a value between 1 and 90 days.</p>}
          </div>
          <div className="flex gap-3">
            {!isRenewal && (
              <button type="button" onClick={() => setStep("confirm")}
                className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium">Back</button>
            )}
            <button type="button" disabled={!reminderValid} onClick={() => setStep("pay")}
              className="px-6 py-2.5 rounded-lg bg-[#003DA5] text-white font-medium disabled:opacity-50">Continue to Payment</button>
          </div>
        </div>
      )}

      {/* Step: pay */}
      {step === "pay" && (
        <div className="rounded-xl border bg-white p-5 space-y-4">
          <div className="font-semibold text-slate-800">Review &amp; pay</div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-600">Website</span><span className="font-medium">{isRenewal ? quote.currentSubdomain : prefix + subInput}.{parentDomain}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Valid until</span><span>{fmtDate(quote.newEndDate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Reminder</span><span>{rem} days before expiry</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold text-[#003DA5]"><span>Total payable</span><span>{inr(quote.totalAmount)}</span></div>
          </div>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep("reminder")}
              className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium">Back</button>
            <button type="button" disabled={busy} onClick={handlePay}
              className="px-6 py-2.5 rounded-lg bg-[#003DA5] text-white font-medium disabled:opacity-50">
              {busy ? "Processing…" : `Pay ${inr(quote.totalAmount)} with Razorpay`}
            </button>
          </div>
          <p className="text-xs text-slate-400">Valid for {quote.validityMonths} months from payment. GST is charged on top.</p>
        </div>
      )}

      {/* Step: done */}
      {step === "done" && result && (
        <div className="rounded-xl border bg-white p-6 space-y-4 text-center">
          <div className="text-4xl">🎉</div>
          <div className="text-lg font-semibold text-slate-800">Payment successful</div>
          {result.provisionStatus === "Active" ? (
            <>
              <p className="text-sm text-slate-600">Your website is live{result.endDate ? ` until ${fmtDate(result.endDate)}` : ""}:</p>
              {result.visitUrl && (
                <a href={result.visitUrl} target="_blank" rel="noreferrer"
                  className="inline-block text-[#003DA5] font-semibold hover:underline break-all">{result.visitUrl}</a>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Your website <span className="font-medium">{isRenewal ? quote.currentSubdomain : prefix + subInput}.{parentDomain}</span> is
              being set up in the background. You can safely leave this page — a notification will appear at the top-right and
              we&apos;ll <span className="font-medium">email you</span> as soon as it&apos;s live.
            </p>
          )}
          <div>
            <button type="button" onClick={() => router.push("/club-admin-dashboard/my-club-website")}
              className="px-6 py-2.5 rounded-lg bg-[#003DA5] text-white font-medium">Go to My Club Website</button>
          </div>
        </div>
      )}
    </div>
  );
}
