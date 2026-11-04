"use client";

import { useEffect, useState } from "react";
import { readCheckoutReturn } from "@/lib/checkout";
import type { CheckoutStatus } from "@/types/payments";

const TEXT: Record<CheckoutStatus, string> = {
  paid: "Payment received. Thank you.",
  pending: "Your payment is still being confirmed. This page will update once it is.",
  failed: "The payment did not go through. You can try again.",
  cancelled: "The payment was cancelled. Nothing was charged.",
};

/** Shows how a hosted checkout ended when the payer lands back on the page that started it. */
export default function CheckoutReturnNotice({ onPaid }: { onPaid?: () => void }) {
  const [status, setStatus] = useState<CheckoutStatus | null>(null);

  useEffect(() => {
    readCheckoutReturn().then((s) => {
      setStatus(s);
      if (s === "paid") onPaid?.();
    });
    // Runs once: the return token is removed from the URL after the first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;
  return (
    <p
      role={status === "paid" ? "status" : "alert"}
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
        status === "paid" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      {TEXT[status]}
    </p>
  );
}
