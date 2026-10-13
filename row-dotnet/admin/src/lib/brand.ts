/**
 * Instance brand: everything on screen that differs from one instance to another
 * (name, logos, support contacts, locale defaults, legal links, feature flags).
 *
 * The API serves the instance's brand at GET /api/public/brand (master plan
 * WS1-03). Until that response arrives, or when the endpoint is absent, ROW's
 * defaults below apply.
 *
 * Server-safe module: no "use client", so server components (policy pages,
 * generateMetadata) can import it. Client components use useBrand() from
 * contexts/BrandContext.
 *
 * Never branch on instanceCode. Read the value you need, or a feature flag.
 */

export interface BrandSupport {
  email: string;
  phones: string[];
  hours: string;
  address: string;
  legalName: string;
  privacyEmail: string;
}

export interface BrandLocale {
  defaultLanguage: string;
  languages: string[];
  defaultCurrency: string;
  currencies: string[];
  defaultTimeZone: string;
  numberLocale: string;
  defaultCountryId: number;
}

export interface BrandLegal {
  privacyUrl: string;
  termsUrl: string;
  refundsUrl: string;
  cookiesUrl: string;
  policyVersion: string;
}

export interface BrandDomains {
  adminOrigin: string;
  clubSiteParent: string;
}

export interface Brand {
  instanceCode: string;
  productName: string;
  shortName: string;
  /** Logo for dark backgrounds (header, login card). */
  logoUrl: string;
  /** Logo for light backgrounds (public header). Falls back to logoUrl when empty. */
  logoDarkUrl: string;
  faviconUrl: string;
  openGraphImageUrl: string;
  support: BrandSupport;
  locale: BrandLocale;
  legal: BrandLegal;
  domains: BrandDomains;
  paymentGateways: string[];
  features: Record<string, boolean>;
}

/**
 * Feature flags (master plan Appendix C) with ROW's values. The API sends every
 * flag already resolved; this map only covers the moment before the first
 * response and a missing endpoint.
 */
export const FEATURE_DEFAULTS: Readonly<Record<string, boolean>> = {
  "member.bloodGroup": false,
  "member.familyDetails": false,
  "time.emitOffset": true,
  "time.districtZone": true,
  "payments.connect": true,
  "payments.platformFeeLedger": true,
  "privacy.enabled": true,
  "masters.editable": false,
  "documents.strictGlyphs": true,
  "sync.conditionalProfiles": true,
  "whatsapp.purposeCallback": true,
  "modules.citation": false,
  "modules.zonalAwards": false,
  "modules.wallet": false,
  "modules.websitePurchase": false,
  "modules.assistant": false,
  "modules.pphCamps": false,
  "site.public": false,
};

/**
 * ROW's defaults. Deployment values (domains, contacts, logos) are empty here
 * and arrive from the API's brand configuration.
 */
export const DEFAULT_BRAND: Brand = {
  instanceCode: "ROW",
  productName: "Roster On Wheels",
  shortName: "ROW",
  // ROW logo shipped with the portal: on a white card for dark backgrounds, transparent for light ones.
  logoUrl: "/brand/row-logo-badge.png",
  logoDarkUrl: "/brand/row-logo.png",
  faviconUrl: "",
  openGraphImageUrl: "/brand/row-logo-badge.png",
  support: {
    email: "",
    phones: [],
    hours: "",
    address: "",
    legalName: "",
    privacyEmail: "",
  },
  locale: {
    defaultLanguage: "en",
    languages: ["en"],
    defaultCurrency: "USD",
    currencies: ["USD", "CAD", "EUR", "GBP", "BRL", "MXN", "JPY", "KRW", "AUD", "PHP", "ZAR", "NGN", "KES"],
    defaultTimeZone: "UTC",
    numberLocale: "en-US",
    defaultCountryId: 0,
  },
  legal: {
    privacyUrl: "/privacy-policy",
    termsUrl: "/terms-and-conditions",
    refundsUrl: "/refunds-and-cancellations",
    cookiesUrl: "/cookies",
    policyVersion: "",
  },
  domains: {
    adminOrigin: "",
    clubSiteParent: "",
  },
  paymentGateways: ["stripe", "paypal"],
  features: { ...FEATURE_DEFAULTS },
};

export const BRAND_ENDPOINT = "/api/public/brand";

/** Fill anything the API left out with the default, one level deep. */
export function mergeBrand(partial: Partial<Brand> | null | undefined): Brand {
  if (!partial || typeof partial !== "object") return DEFAULT_BRAND;
  const pick = <T extends object>(base: T, over: unknown): T =>
    over && typeof over === "object" ? { ...base, ...(over as Partial<T>) } : base;
  const nonEmpty = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
  return {
    instanceCode: nonEmpty(partial.instanceCode, DEFAULT_BRAND.instanceCode),
    productName: nonEmpty(partial.productName, DEFAULT_BRAND.productName),
    shortName: nonEmpty(partial.shortName, DEFAULT_BRAND.shortName),
    logoUrl: nonEmpty(partial.logoUrl, DEFAULT_BRAND.logoUrl),
    logoDarkUrl: nonEmpty(partial.logoDarkUrl, nonEmpty(partial.logoUrl, DEFAULT_BRAND.logoDarkUrl)),
    faviconUrl: nonEmpty(partial.faviconUrl, DEFAULT_BRAND.faviconUrl),
    openGraphImageUrl: nonEmpty(partial.openGraphImageUrl, DEFAULT_BRAND.openGraphImageUrl),
    support: pick(DEFAULT_BRAND.support, partial.support),
    locale: pick(DEFAULT_BRAND.locale, partial.locale),
    legal: pick(DEFAULT_BRAND.legal, partial.legal),
    domains: pick(DEFAULT_BRAND.domains, partial.domains),
    paymentGateways: Array.isArray(partial.paymentGateways) ? partial.paymentGateways : DEFAULT_BRAND.paymentGateways,
    features: pick(DEFAULT_BRAND.features, partial.features),
  };
}

// The brand the client is currently showing, for browser-side code that runs
// outside React (Excel and PDF exports). BrandProvider keeps it current.
let activeBrand: Brand = DEFAULT_BRAND;

export function setActiveBrand(brand: Brand): void {
  activeBrand = brand;
}

/** Browser-side only; server code uses getServerBrand(). */
export function getActiveBrand(): Brand {
  return activeBrand;
}

/** A flag missing from the brand takes its ROW default; an unknown flag is off. */
export function isFeatureOn(brand: Brand, key: string): boolean {
  if (key in brand.features) return brand.features[key];
  if (key in FEATURE_DEFAULTS) return FEATURE_DEFAULTS[key];
  if (process.env.NODE_ENV === "development") {
    console.warn(`[brand] unknown feature flag "${key}"; add it to FEATURE_DEFAULTS`);
  }
  return false;
}

/** "" -> "tel:" */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Host name of a URL, for display ("https://portal.example.org" -> "portal.example.org"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/**
 * Server-side fetch for server components and generateMetadata. Cached for an
 * hour, like the endpoint's own response cache. Any failure yields the defaults
 * so a page never fails to render because the brand could not be read.
 */
export async function getServerBrand(): Promise<Brand> {
  const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
  try {
    const res = await fetch(`${base}${BRAND_ENDPOINT}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return DEFAULT_BRAND;
    return mergeBrand(await res.json());
  } catch {
    return DEFAULT_BRAND;
  }
}
