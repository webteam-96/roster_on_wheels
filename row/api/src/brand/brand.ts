import { AppConfig } from "../config/app-config";

/**
 * Instance brand (master plan WS1-01, Appendix A.1): everything that is
 * configuration rather than code. ROW reuses RIZones' architecture only; the
 * defaults below are ROW's, and deployment values (domains, contacts, logos)
 * come from config/brand.ROW.json (BRAND_FILE=brand.ROW.json).
 *
 * Never branch on instanceCode: read the value or the feature flag you need.
 */

export interface TaxRule {
  country: string;
  ratePercent: number;
  label: string;
  inclusive: boolean;
}

export interface BrandOptions {
  instanceCode: string;
  productName: string;
  shortName: string;
  domains: {
    adminOrigin: string;
    apiBase: string;
    clubSiteParent: string;
    clubSiteSuffixes: string[];
    allowedOriginSuffixes: string[];
    thirdPartyOriginSuffixes: string[];
  };
  support: {
    legalName: string;
    address: string;
    email: string;
    phones: string[];
    hours: string;
    noReplyEmail: string;
    internalCc: string[];
    privacyEmail: string;
  };
  look: {
    logoUrl: string;
    logoDarkUrl: string;
    faviconUrl: string;
    openGraphImageUrl: string;
    emailHeaderHtml: string;
    emailFooterHtml: string;
    pdfLogoPath: string;
  };
  locale: {
    defaultLanguage: string;
    languages: string[];
    numberLocale: string;
    defaultCurrency: string;
    currencies: string[];
    defaultTimeZone: string;
    instanceTimeZone: string;
    defaultCountryId: number;
  };
  providers: {
    payments: string[];
    whatsApp: string;
    sms: string;
    otpPolicy: Record<string, string[]>;
    taxRules: TaxRule[];
  };
  scope: {
    zones: string[];
    pulledZoneNames: string[];
    countries: string[];
    exemptDistricts: string[];
    cogClubId: number;
    whatsAppPilotClubId: number;
    whatsAppPilotDistrictId: number;
    testDistrictNumber: string;
    districtReportSendHour: number;
    districtReportDaysOfMonth: number[];
  };
  pricing: { platformFeePercent: number; products: Record<string, number> };
  legal: { privacyUrl: string; termsUrl: string; refundsUrl: string; cookiesUrl: string; policyVersion: string; cookieNotice: boolean };
  privacy: { consentRequiredFor: string[]; retentionDays: Record<string, number> };
  features: Record<string, boolean>;
}

/**
 * Feature flags (master plan Appendix C), with ROW's values. ROW shares only
 * RIZones' architecture, so these are ROW's defaults, not RIZones'.
 */
export const FEATURE_DEFAULTS: Readonly<Record<string, boolean>> = {
  "member.bloodGroup": false, // health data: not collected on ROW
  "member.familyDetails": false,
  "time.emitOffset": true, // timestamps are stored in UTC and sent with "Z"
  "time.districtZone": true,
  "payments.connect": true, // districts and clubs connect their own Stripe / PayPal account
  "payments.platformFeeLedger": true,
  "privacy.enabled": true,
  "masters.editable": false, // master data comes from seed files
  "documents.strictGlyphs": true,
  "sync.conditionalProfiles": true,
  "whatsapp.purposeCallback": true,
  "modules.citation": false, // Zones 4-8 award programmes: off until ROW decides (master plan Q9)
  "modules.zonalAwards": false,
  "modules.wallet": false,
  "modules.websitePurchase": false,
  "modules.assistant": false,
  "modules.pphCamps": false,
  "site.public": false, // no public marketing site until ROW content exists
};

/**
 * ROW's defaults. Values that only the deployment can know (domains, contacts,
 * logos, scope of zones) are empty and come from config/brand.ROW.json.
 */
export function defaultBrand(): BrandOptions {
  return {
    instanceCode: "ROW",
    productName: "Roster On Wheels",
    shortName: "ROW",
    domains: {
      adminOrigin: "",
      apiBase: "",
      clubSiteParent: "",
      clubSiteSuffixes: [],
      allowedOriginSuffixes: [],
      thirdPartyOriginSuffixes: [],
    },
    support: {
      legalName: "",
      address: "",
      email: "",
      phones: [],
      hours: "",
      noReplyEmail: "",
      internalCc: [],
      privacyEmail: "",
    },
    look: {
      logoUrl: "",
      logoDarkUrl: "",
      faviconUrl: "",
      openGraphImageUrl: "",
      emailHeaderHtml: "",
      emailFooterHtml: "",
      pdfLogoPath: "",
    },
    locale: {
      defaultLanguage: "en",
      // A language is listed only once its translation has been reviewed (master plan X8).
      languages: ["en"],
      numberLocale: "en-US",
      defaultCurrency: "USD",
      currencies: ["USD", "CAD", "EUR", "GBP", "BRL", "MXN", "JPY", "KRW", "AUD", "PHP", "ZAR", "NGN", "KES"],
      defaultTimeZone: "UTC",
      instanceTimeZone: "UTC",
      defaultCountryId: 0, // no default country: forms ask
    },
    providers: {
      payments: ["stripe", "paypal"],
      whatsApp: "meta",
      sms: "twilio",
      otpPolicy: { "*": ["email", "whatsapp", "sms"] },
      taxRules: [],
    },
    scope: {
      zones: [],
      pulledZoneNames: [],
      countries: [],
      exemptDistricts: [],
      cogClubId: 0,
      whatsAppPilotClubId: 0,
      whatsAppPilotDistrictId: 0,
      testDistrictNumber: "",
      districtReportSendHour: 7,
      districtReportDaysOfMonth: [1, 16],
    },
    pricing: { platformFeePercent: 0, products: {} },
    legal: {
      privacyUrl: "/privacy-policy",
      termsUrl: "/terms-and-conditions",
      refundsUrl: "/refunds-and-cancellations",
      cookiesUrl: "/cookies",
      policyVersion: "",
      cookieNotice: true,
    },
    privacy: {
      consentRequiredFor: ["greeting", "announcement", "event", "newsletter", "marketing"],
      retentionDays: { email_log_body: 180, whatsapp_log: 365, push_log: 90, login_audit: 365, otp: 7, export_files: 7, assistant_turns: 365 },
    },
    features: {},
  };
}

/** Overlay the "Brand" configuration section onto the defaults. Keys are case-insensitive. */
export function loadBrand(config: AppConfig): BrandOptions {
  const brand = defaultBrand();
  const str = (key: string, current: string) => config.get(`Brand:${key}`) ?? current;
  const arr = (key: string, current: string[]) => {
    const a = config.getArray(`Brand:${key}`);
    // An explicitly empty list ("Key": []) cannot be told apart from absence in a flat
    // configuration; "Key": "" (empty string) clears it, as in .NET's binder.
    if (a.length) return a;
    return config.get(`Brand:${key}`) === "" ? [] : current;
  };
  const num = (key: string, current: number) => (config.get(`Brand:${key}`) !== undefined ? config.getNumber(`Brand:${key}`, current) : current);
  const bool = (key: string, current: boolean) => config.getBool(`Brand:${key}`, current);

  brand.instanceCode = str("InstanceCode", brand.instanceCode);
  brand.productName = str("ProductName", brand.productName);
  brand.shortName = str("ShortName", brand.shortName);

  const d = brand.domains;
  d.adminOrigin = str("Domains:AdminOrigin", d.adminOrigin);
  d.apiBase = str("Domains:ApiBase", d.apiBase);
  d.clubSiteParent = str("Domains:ClubSiteParent", d.clubSiteParent);
  d.clubSiteSuffixes = arr("Domains:ClubSiteSuffixes", d.clubSiteSuffixes);
  d.allowedOriginSuffixes = arr("Domains:AllowedOriginSuffixes", d.allowedOriginSuffixes);
  d.thirdPartyOriginSuffixes = arr("Domains:ThirdPartyOriginSuffixes", d.thirdPartyOriginSuffixes);

  const s = brand.support;
  s.legalName = str("Support:LegalName", s.legalName);
  s.address = str("Support:Address", s.address);
  s.email = str("Support:Email", s.email);
  s.phones = arr("Support:Phones", s.phones);
  s.hours = str("Support:Hours", s.hours);
  s.noReplyEmail = str("Support:NoReplyEmail", s.noReplyEmail);
  s.internalCc = arr("Support:InternalCc", s.internalCc);
  s.privacyEmail = str("Support:PrivacyEmail", s.privacyEmail);

  for (const k of Object.keys(brand.look) as (keyof BrandOptions["look"])[]) {
    brand.look[k] = str(`Look:${k}`, brand.look[k]);
  }

  const l = brand.locale;
  l.defaultLanguage = str("Locale:DefaultLanguage", l.defaultLanguage);
  l.languages = arr("Locale:Languages", l.languages);
  l.numberLocale = str("Locale:NumberLocale", l.numberLocale);
  l.defaultCurrency = str("Locale:DefaultCurrency", l.defaultCurrency);
  l.currencies = arr("Locale:Currencies", l.currencies);
  l.defaultTimeZone = str("Locale:DefaultTimeZone", l.defaultTimeZone);
  l.instanceTimeZone = str("Locale:InstanceTimeZone", l.instanceTimeZone);
  l.defaultCountryId = num("Locale:DefaultCountryId", l.defaultCountryId);

  const p = brand.providers;
  p.payments = arr("Providers:Payments", p.payments);
  p.whatsApp = str("Providers:WhatsApp", p.whatsApp);
  p.sms = str("Providers:Sms", p.sms);
  const otpKeys = config.childKeys("Brand:Providers:OtpPolicy");
  if (otpKeys.length) {
    p.otpPolicy = Object.fromEntries(otpKeys.map((k) => [k === "*" ? "*" : k.toUpperCase(), config.getArray(`Brand:Providers:OtpPolicy:${k}`)]));
  }
  const taxCount = config.childKeys("Brand:Providers:TaxRules").length;
  if (taxCount || config.get("Brand:Providers:TaxRules") === "") {
    p.taxRules = Array.from({ length: taxCount }, (_, i) => ({
      country: config.get(`Brand:Providers:TaxRules:${i}:Country`) ?? "",
      ratePercent: config.getNumber(`Brand:Providers:TaxRules:${i}:RatePercent`, 0),
      label: config.get(`Brand:Providers:TaxRules:${i}:Label`) ?? "",
      inclusive: config.getBool(`Brand:Providers:TaxRules:${i}:Inclusive`, false),
    }));
  }

  const sc = brand.scope;
  sc.zones = arr("Scope:Zones", sc.zones);
  sc.pulledZoneNames = arr("Scope:PulledZoneNames", sc.pulledZoneNames);
  sc.countries = arr("Scope:Countries", sc.countries);
  sc.exemptDistricts = arr("Scope:ExemptDistricts", sc.exemptDistricts);
  sc.cogClubId = num("Scope:CogClubId", sc.cogClubId);
  sc.whatsAppPilotClubId = num("Scope:WhatsAppPilotClubId", sc.whatsAppPilotClubId);
  sc.whatsAppPilotDistrictId = num("Scope:WhatsAppPilotDistrictId", sc.whatsAppPilotDistrictId);
  sc.testDistrictNumber = str("Scope:TestDistrictNumber", sc.testDistrictNumber);
  sc.districtReportSendHour = num("Scope:DistrictReportSendHour", sc.districtReportSendHour);
  const days = config.getArray("Brand:Scope:DistrictReportDaysOfMonth");
  if (days.length) sc.districtReportDaysOfMonth = days.map(Number);

  brand.pricing.platformFeePercent = num("Pricing:PlatformFeePercent", brand.pricing.platformFeePercent);
  for (const k of config.childKeys("Brand:Pricing:Products")) brand.pricing.products[k] = config.getNumber(`Brand:Pricing:Products:${k}`, 0);

  const lg = brand.legal;
  lg.privacyUrl = str("Legal:PrivacyUrl", lg.privacyUrl);
  lg.termsUrl = str("Legal:TermsUrl", lg.termsUrl);
  lg.refundsUrl = str("Legal:RefundsUrl", lg.refundsUrl);
  lg.cookiesUrl = str("Legal:CookiesUrl", lg.cookiesUrl);
  lg.policyVersion = str("Legal:PolicyVersion", lg.policyVersion);
  lg.cookieNotice = bool("Legal:CookieNotice", lg.cookieNotice);

  brand.privacy.consentRequiredFor = arr("Privacy:ConsentRequiredFor", brand.privacy.consentRequiredFor);
  for (const k of config.childKeys("Brand:Privacy:RetentionDays")) brand.privacy.retentionDays[k] = config.getInt(`Brand:Privacy:RetentionDays:${k}`, 0);

  // Feature keys contain dots ("member.bloodGroup"), which the flat configuration keeps intact.
  for (const k of config.childKeys("Brand:Features")) {
    const known = Object.keys(FEATURE_DEFAULTS).find((f) => f.toLowerCase() === k) ?? k;
    brand.features[known] = config.getBool(`Brand:Features:${k}`, FEATURE_DEFAULTS[known] ?? false);
  }
  return brand;
}

/**
 * Brand.Current: the instance brand for code that cannot take it by injection
 * (static helpers in the C#). Set once at startup.
 */
export class Brand {
  private static current: BrandOptions | null = null;

  static initialise(brand: BrandOptions): void {
    Brand.current = brand;
  }

  static get Current(): BrandOptions {
    if (!Brand.current) throw new Error("Brand has not been initialised");
    return Brand.current;
  }

  /** The configured value, else the default above; an unknown flag throws in development and is off otherwise. */
  static feature(key: string, development = process.env.APP_ENVIRONMENT === "Development"): boolean {
    const brand = Brand.current;
    if (brand && key in brand.features) return brand.features[key];
    if (key in FEATURE_DEFAULTS) return FEATURE_DEFAULTS[key];
    if (development) throw new Error(`Unknown feature flag "${key}"`);
    return false;
  }

  /** Every flag, resolved, for the public brand endpoint. */
  static resolvedFeatures(): Record<string, boolean> {
    return { ...FEATURE_DEFAULTS, ...Brand.Current.features };
  }
}

/**
 * WS1-02: the configuration keys the ported code reads ("FrontendUrl",
 * "BackendUrl", ...) are filled from the brand unless set explicitly.
 */
export function applyLegacyOverlay(config: AppConfig, brand: BrandOptions): void {
  if (brand.domains.adminOrigin) {
    config.setDefault("FrontendUrl", brand.domains.adminOrigin);
    config.setDefault("PublicFrontend:BaseUrl", brand.domains.adminOrigin);
  }
  if (brand.domains.apiBase) {
    config.setDefault("BackendUrl", brand.domains.apiBase);
    config.setDefault("Api:BaseUrl", brand.domains.apiBase);
    config.setDefault("WebhookBaseUrl", brand.domains.apiBase);
  }
  config.setDefault("Brevo:SenderName", brand.productName);
  if (brand.support.noReplyEmail) config.setDefault("Brevo:SenderEmail", brand.support.noReplyEmail);
}
