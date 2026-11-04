"use client";

/**
 * Stand-in for a gateway's hosted payment page while Payments:Provider=simulated. No money moves and no card details
 * are asked for: the tester picks the outcome, the API settles the order the way a gateway confirmation will.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PayPageShell from "@/components/PayPageShell";
import { Button } from "@/components/ui/button";
import { getCheckoutSession, simulateCheckout, type CheckoutSessionView } from "@/services/api";

type Outcome = "paid" | "failed" | "cancelled";

const FINAL_TEXT: Record<string, string> = {
  paid: "Simulated payment recorded. You can close this page.",
  failed: "Simulated decline recorded. No payment was recorded.",
  cancelled: "Simulated payment cancelled. No payment was recorded.",
};

function withCheckoutToken(url: string, token: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}checkout=${encodeURIComponent(token)}`;
}

export default function SimulatedCheckoutPage() {
  const token = String(useParams<{ token: string }>()?.token ?? "");
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCheckoutSession(token)
      .then(setSession)
      .catch(() => setError("This payment session was not found."))
      .finally(() => setLoading(false));
  }, [token]);

  const choose = async (outcome: Outcome) => {
    setBusy(outcome);
    setError(null);
    try {
      const updated = await simulateCheckout(token, outcome);
      setSession(updated);
      const next = updated.status === "paid" ? updated.returnUrl : updated.cancelUrl;
      if (updated.status !== "open" && next) {
        window.location.assign(withCheckoutToken(next, token));
        return;
      }
      if (updated.status === "open") setError("This payment session has expired. Please start again.");
    } catch {
      setError("The payment could not be recorded. Please try again.");
    }
    setBusy(null);
  };

  const amount = session
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: session.currency }).format(session.amount)
    : "";
  const isOpen = session?.status === "open" && !session.expired;

  return (
    <PayPageShell title="Test payment">
      <div className="rounded-[20px] border border-[color:var(--row-line)] bg-card p-6">
        <p className="rounded-xl bg-[color:var(--row-cream-2)] px-4 py-3 text-sm font-medium text-foreground">
          Simulated payment. No money moves and no card is charged.
        </p>

        {loading ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <div className="h-5 w-2/3 animate-pulse rounded bg-[color:var(--row-cream-2)]" />
            <div className="h-9 w-1/3 animate-pulse rounded bg-[color:var(--row-cream-2)]" />
            <div className="h-11 w-full animate-pulse rounded bg-[color:var(--row-cream-2)]" />
          </div>
        ) : session ? (
          <>
            <p className="mt-6 text-sm text-muted-foreground">{session.description}</p>
            <p className="mt-1 text-3xl font-semibold text-foreground">{amount}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">Order {session.merchantOrderId}</p>

            {isOpen ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={() => choose("paid")} disabled={busy !== null}>
                  {busy === "paid" ? "Recording…" : `Pay ${amount}`}
                </Button>
                <Button variant="outline" onClick={() => choose("failed")} disabled={busy !== null}>
                  Simulate a decline
                </Button>
                <Button variant="ghost" onClick={() => choose("cancelled")} disabled={busy !== null}>
                  Cancel
                </Button>
              </div>
            ) : (
              <p className="mt-6 text-sm font-medium text-foreground" role="status">
                {session.expired ? "This payment session has expired. Please start again." : FINAL_TEXT[session.status]}
              </p>
            )}
          </>
        ) : null}

        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </PayPageShell>
  );
}
