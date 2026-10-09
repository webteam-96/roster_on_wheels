/**
 * The merchant identity surfaced on every public page (landing, footer,
 * contact-us, terms, refunds, privacy, about-us), derived from the instance
 * brand (lib/brand.ts).
 *
 * Server-safe plain TypeScript module (no "use client") so React Server
 * Components (the policy pages) can use it.
 *
 *   Server component:  const MERCHANT = merchantFrom(await getServerBrand());
 *   Client component:  const MERCHANT = merchantFrom(useBrand());
 */

import { Brand, DEFAULT_BRAND } from "@/lib/brand";

export interface Merchant {
  brand: string;
  legalName: string;
  email: string;
  privacyEmail: string;
  phone: string;
  phoneSecondary: string;
  phones: string[];
  addressLines: string[];
  workingHours: string;
}

export function merchantFrom(brand: Brand): Merchant {
  const { support } = brand;
  return {
    brand: brand.productName,
    legalName: support.legalName,
    email: support.email,
    privacyEmail: support.privacyEmail || support.email,
    phone: support.phones[0] ?? "",
    phoneSecondary: support.phones[1] ?? "",
    phones: support.phones,
    addressLines: support.address.split("\n").map((l) => l.trim()).filter(Boolean),
    workingHours: support.hours,
  };
}

/** The default identity, for code that runs before any brand is known. */
export const MERCHANT: Merchant = merchantFrom(DEFAULT_BRAND);
