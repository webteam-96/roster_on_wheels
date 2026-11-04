// Support contact details shown on the trial-expired and paid-expired popups,
// plus the "Contact for renewal" CTA. Values come from env vars so the support
// team can change them via .env.production without a code rebuild.

export interface SupportContact {
  email: string;
  phone: string;
  contactUrl?: string;     // optional pre-built contact form URL
  purchaseUrl?: string;    // optional purchase landing page URL
}

export function getSupportContact(): SupportContact {
  return {
    email:       process.env.NEXT_PUBLIC_SUPPORT_EMAIL       || "",
    phone:       process.env.NEXT_PUBLIC_SUPPORT_PHONE       || "",
    contactUrl:  process.env.NEXT_PUBLIC_SUPPORT_CONTACT_URL || undefined,
    purchaseUrl: process.env.NEXT_PUBLIC_PURCHASE_URL        || undefined,
  };
}
