/**
 * Starting and confirming a payment (master plan WS6-09). Each district or
 * club takes payments on its own Stripe or PayPal account; the API creates the
 * session and returns a URL to send the payer to. Nothing gateway-specific
 * runs in the browser, so no gateway script is ever loaded here.
 */
import type { CheckoutSession, CheckoutStatus, CheckoutUrls } from "@/types/payments";

/** The return and cancel URLs for a pay page, with our order id added by the API as ?orderId=. */
export function checkoutUrls(returnPath: string, cancelPath?: string): CheckoutUrls {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { returnUrl: `${origin}${returnPath}`, cancelUrl: `${origin}${cancelPath ?? window.location.pathname}` };
}

/** Pull the session out of an API response that carries it under `checkout` (or is the session itself). */
export function sessionFrom(response: unknown): CheckoutSession | null {
  const r = response as { checkout?: CheckoutSession; kind?: string } | null;
  const s = (r?.checkout ?? (r?.kind ? (r as unknown as CheckoutSession) : null)) as CheckoutSession | null;
  return s && s.kind === "Redirect" && typeof s.redirectUrl === "string" && s.redirectUrl ? s : null;
}

/** Send the payer to the gateway. Throws when the response carries no usable session. */
export function startCheckout(response: unknown): CheckoutSession {
  const session = sessionFrom(response);
  if (!session) throw new Error("The payment could not be started. Please try again.");
  window.location.assign(session.redirectUrl);
  return session;
}

/**
 * Poll a verify call until the payment is settled one way or the other. Gateways
 * confirm by webhook, which can land a few seconds after the payer returns, so
 * "pending" is retried; anything still pending after the timeout is reported as
 * pending (the receipt follows by email once the webhook arrives).
 */
export async function pollPaymentStatus(
  verify: () => Promise<CheckoutStatus>,
  { intervalMs = 3000, timeoutMs = 60000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<CheckoutStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let status: CheckoutStatus = "pending";
    try {
      status = await verify();
    } catch {
      status = "pending";
    }
    if (status !== "pending" || Date.now() >= deadline) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Map a verify endpoint's body to a status. Accepts { status } or the older { success, isPaid } shapes. */
export function toCheckoutStatus(body: unknown): CheckoutStatus {
  const b = (body ?? {}) as { status?: string; success?: boolean; isPaid?: boolean; paymentStatus?: string };
  const s = (b.status ?? b.paymentStatus ?? "").toString().toLowerCase();
  if (s === "paid" || s === "success" || s === "completed" || s === "captured" || b.isPaid === true) return "paid";
  if (s === "failed" || s === "failure" || s === "declined") return "failed";
  if (s === "cancelled" || s === "canceled" || s === "expired") return "cancelled";
  if (b.success === true && !s) return "paid";
  return "pending";
}
