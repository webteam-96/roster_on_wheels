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
  brand: "ROW — India",
  // Legal/registered name on Cashfree merchant account:
  legalName: "ROW Multi-District Initiative",
  // Operational support contact shown publicly:
  email: "support@example.org",
  // Help line — both lines are reachable during published working hours.
  phone: "",
  phoneSecondary: "",
  address: {
    line1: "ROW Secretariat",
    line2: "Mumbai, Maharashtra, India",
    pin: "400001",
  },
  workingHours: "Monday to Friday, 10:00 AM to 6:30 PM IST",
  // Optional — uncomment if applicable:
  // gstin: "27AAAAA0000A1Z5",
  // cin: "U00000MH2020NPL000000",
} as const;
