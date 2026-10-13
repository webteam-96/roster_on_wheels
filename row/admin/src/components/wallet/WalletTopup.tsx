"use client";

import { useCallback, useEffect, useState } from "react";
import { getClubCreditBalance, getDistrictCreditBalance, createWalletTopupOrder, verifyWalletTopup } from "@/services/api";

import { appLocale, currencySymbol } from "@/lib/appFormat";
// Client-side pricing MIRRORS the server (server is authoritative on the actual credit + charge).
const PRICING = {
  WhatsApp: { rate: 1, min: 1000, label: "WhatsApp" },
  Email: { rate: 0.3, min: 500, label: "Email" },
} as const;
const GST_PERCENT = 18;

type CreditType = "WhatsApp" | "Email";
type Scope = "club" | "district";

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

const inr = (n: number) => `${currencySymbol()}${n.toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalletTopup({ scope, clubId, districtId }: { scope: Scope; clubId?: number | null; districtId?: number | null }) {
  const [balance, setBalance] = useState<any>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [creditType, setCreditType] = useState<CreditType>("WhatsApp");
  const [amount, setAmount] = useState<string>("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const scopeId = scope === "club" ? clubId : districtId;
  const cfg = PRICING[creditType];
  const amt = parseFloat(amount) || 0;
  const belowMin = amt < cfg.min;
  const credits = amt > 0 ? Math.floor(amt / cfg.rate) : 0;
  const gst = Math.round(amt * GST_PERCENT) / 100;
  const total = amt + gst;

  const loadBalance = useCallback(async () => {
    if (!scopeId) return;
    setLoadingBalance(true);
    try {
      const b = scope === "club" ? await getClubCreditBalance(scopeId) : await getDistrictCreditBalance(scopeId);
      setBalance(b);
    } catch {
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [scope, scopeId]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  // Default the amount to the minimum whenever the credit type changes.
  useEffect(() => { setAmount(String(PRICING[creditType].min)); }, [creditType]);

  async function handlePay() {
    setError(null); setSuccess(null);
    if (!scopeId) { setError("Could not determine your club/district."); return; }
    if (belowMin) { setError(`Minimum top-up for ${cfg.label} is ${currencySymbol()}${cfg.min}.`); return; }
    setBusy(true);
    try {
      const order = await createWalletTopupOrder({
        scope, clubId: clubId ?? undefined, districtId: districtId ?? undefined, creditType, amount: amt,
      });
      const ok = await loadRazorpayScript();
      if (!ok) { setError("Could not load the payment gateway. Please try again."); setBusy(false); return; }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "ROW",
        description: `${creditType} credits top-up`,
        handler: async (resp: any) => {
          try {
            const v = await verifyWalletTopup({
              topupOrderId: order.topupOrderId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            });
            if (v.isSuccess) {
              setSuccess(`Payment successful — ${v.creditCount} ${creditType} credit(s) added to your wallet.`);
              await loadBalance();
            } else {
              setError(v.message || "Payment verification failed. If money was deducted it will reconcile shortly.");
            }
          } catch {
            setError("Payment verification failed. If money was deducted it will reconcile shortly.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: "#17458f" },
      });
      rzp.on("payment.failed", () => { setError("Payment failed. Please try again."); setBusy(false); });
      rzp.open();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not start the payment. Please try again.");
      setBusy(false);
    }
  }

  const waRemaining = balance?.whatsAppRemaining ?? 0;
  const emailRemaining = balance?.emailRemaining ?? 0;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#17458f]">Wallet &amp; Credits</h1>
        <p className="text-sm text-gray-500">Top up your {scope === "club" ? "club" : "district"} WhatsApp &amp; Email notification credits.</p>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-5">
          <div className="text-sm text-gray-500">WhatsApp balance</div>
          <div className="text-3xl font-bold text-emerald-600">{loadingBalance ? "…" : waRemaining}</div>
          <div className="text-xs text-gray-400">credits remaining</div>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <div className="text-sm text-gray-500">Email balance</div>
          <div className="text-3xl font-bold text-blue-600">{loadingBalance ? "…" : emailRemaining}</div>
          <div className="text-xs text-gray-400">credits remaining</div>
        </div>
      </div>

      {/* Top-up card */}
      <div className="rounded-xl border bg-white p-5 space-y-4">
        <div className="font-semibold text-gray-800">Add balance</div>

        {/* Credit type toggle */}
        <div className="flex gap-2">
          {(["WhatsApp", "Email"] as CreditType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setCreditType(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${creditType === t ? "bg-[#17458f] text-white border-[#17458f]" : "bg-white text-gray-700 border-gray-300"}`}
            >
              {t} <span className="opacity-70">({t === "WhatsApp" ? "₹1 / msg" : "₹0.30 / email"})</span>
            </button>
          ))}
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Amount ({currencySymbol()}) <span className="text-gray-400">— minimum {currencySymbol()}{cfg.min}</span></label>
          <input
            type="number"
            min={cfg.min}
            step={creditType === "WhatsApp" ? 100 : 50}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-[#17458f] focus:outline-none"
          />
          {belowMin && amount !== "" && <p className="text-xs text-red-600">Minimum for {cfg.label} is {currencySymbol()}{cfg.min}.</p>}
        </div>

        {/* Breakdown */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-1.5">
          <div className="flex justify-between"><span className="text-gray-600">Credits you'll receive</span><span className="font-semibold">{credits.toLocaleString(appLocale())} {creditType}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Amount</span><span>{inr(amt)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">GST ({GST_PERCENT}%)</span><span>{inr(gst)}</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-[#17458f]"><span>Total payable</span><span>{inr(total)}</span></div>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}
        {success && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm p-3">{success}</div>}

        <button
          type="button"
          disabled={busy || belowMin || !scopeId}
          onClick={handlePay}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[#17458f] text-white font-medium disabled:opacity-50"
        >
          {busy ? "Processing…" : `Pay ${inr(total)} with Razorpay`}
        </button>
        <p className="text-xs text-gray-400">Credits are valid for 1 year from purchase. GST is charged on top of the credit amount.</p>
      </div>
    </div>
  );
}
