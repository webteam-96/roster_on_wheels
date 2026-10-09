/**
 * Single source of truth for the merchant identity surfaced on every public
 * page (landing, footer, contact-us, terms, refunds, privacy, about-us).
 *
 * IMPORTANT: this file is a server-safe plain TypeScript module — NO
 * "use client" directive — so that React Server Components (the policy
 * pages) can dot into MERCHANT.* without tripping the "Cannot access X on
 * the server. You cannot dot into a client module from a server component."
 * error.
 *
 * Both server components (policy pages) and client components (PublicFooter,
 * PublicHeader, PublicLanding) import from here.
 *
 * REPLACE the placeholders below before submitting the Cashfree
 * whitelisting request. Cashfree may verify these against the merchant KYC
 * account — name and phone, especially.
 */

export const MERCHANT = {
  brand: "Rotary Zones 4, 5, 6, 7 & 8 — India",
  // Legal/registered name on Cashfree merchant account:
  legalName: "Rotary Zones 4-8 Multi-District Initiative",
  // Operational support contact shown publicly:
  email: "support@rizones45678.org",
  // Help line — both lines are reachable during published working hours.
  phone: "+91 8424064369",
  phoneSecondary: "+91 8928755144",
  address: {
    line1: "Rotary Zones 4-8 Secretariat",
    line2: "Mumbai, Maharashtra, India",
    pin: "400001",
  },
  workingHours: "Monday to Friday, 10:00 AM to 6:30 PM IST",
  // Optional — uncomment if applicable:
  // gstin: "27AAAAA0000A1Z5",
  // cin: "U00000MH2020NPL000000",
} as const;
