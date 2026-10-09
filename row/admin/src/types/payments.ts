// Connected payment accounts (master plan WS6-07, WS6-12; tables in Appendix B.9).
// A district or club connects its own gateway account; the platform never holds
// the money and takes no split.

export type GatewayCode = "stripe" | "paypal" | "cashfree" | "razorpay";
export type AccountOwnerType = "district" | "club";

export interface PaymentAccount {
  id: number;
  ownerType: AccountOwnerType;
  ownerId: number;
  gateway: GatewayCode;
  displayName: string;
  currency: string;
  isActive: boolean;
  /** ISO timestamp of the last successful verification call, null if never verified. */
  verifiedAt: string | null;
  /** Secrets are write-only; the API returns only their last four characters. */
  secretLast4: string | null;
  /** URL the owner registers with the gateway, including this account's reference. */
  webhookUrl: string;
}

/** Which gateways can receive payments in the owner's country (seed table payment_gateway_coverage). */
export interface GatewayCoverage {
  countryIso: string | null;
  countryName: string | null;
  gateways: GatewayCode[];
}

/** The keys each gateway needs; field names match the API's credentials object. */
export interface ConnectAccountRequest {
  ownerType: AccountOwnerType;
  ownerId: number;
  gateway: GatewayCode;
  displayName: string;
  currency: string;
  credentials: Record<string, string>;
}

/**
 * Gateway-neutral checkout session (master plan WS6-09). Every "create order" /
 * "pay" endpoint returns one under `checkout`. Stripe gives a Checkout Session
 * URL, PayPal an order's approve link; either way the browser is redirected,
 * and the return page confirms through the verify endpoint, never the redirect.
 */
export interface CheckoutSession {
  kind: "Redirect";
  redirectUrl: string;
  /** Our order id (e.g. DUES-ROW-1042-638...), echoed on the return URL. */
  merchantOrderId: string;
  gateway: GatewayCode;
}

/** Sent with every create-order request so the API can build the gateway's return and cancel URLs. */
export interface CheckoutUrls {
  returnUrl: string;
  cancelUrl: string;
}

/** Result of a verify call made from a return page. */
export type CheckoutStatus = "paid" | "pending" | "failed" | "cancelled";
