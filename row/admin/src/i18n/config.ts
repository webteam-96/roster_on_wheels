/**
 * Translation configuration (master plan WS2-02, Appendix J).
 *
 * No locale routing: the locale lives in the NEXT_LOCALE cookie, not the URL,
 * because the app has ~500 routes and locale-prefixed URLs would move them all.
 *
 * Message files: messages/<locale>/<namespace>.json. English is the source; a
 * missing key in another language falls back to English.
 */

export const SUPPORTED_LOCALES = ["en", "fr", "de", "it", "ja", "ko", "pt", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Pseudo-locale: every string bracketed, accented and lengthened, to find untranslated text. */
export const PSEUDO_LOCALE = "en-XA";

export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Loaded on every route. */
// privacy: the consent dialog can open on any route.
export const BASE_NAMESPACES = ["common", "errors", "privacy"] as const;

/**
 * Route prefix -> namespaces loaded on top of BASE_NAMESPACES. First match wins,
 * so more specific prefixes come first. Paths are matched with dynamic segments
 * as they appear in the URL (e.g. /clubs/123/members), so patterns use regexes.
 */
export const ROUTE_NAMESPACES: ReadonlyArray<{ pattern: RegExp; namespaces: string[] }> = [
  { pattern: /^\/(login|forgot-password|reset-password|sso)(\/|$)/, namespaces: ["auth"] },
  { pattern: /^\/(pay|report|dues-approval|club-dues-approval)(\/|$)/, namespaces: ["pay", "dues"] },
  { pattern: /^\/club-admin-dashboard(\/|$)/, namespaces: ["clubDashboard", "members", "content", "projects", "cmr", "dues", "goals", "foundation", "website", "payments"] },
  { pattern: /^\/district-admin-dashboard(\/|$)/, namespaces: ["districtDashboard", "members", "content", "projects", "cmr", "dues", "goals", "foundation", "website", "awards", "payments", "privacy"] },
  { pattern: /^\/(ag-dashboard|ag-reports)(\/|$)/, namespaces: ["ag", "cmr", "goals"] },
  { pattern: /^\/(ri-director|zones|zonal-dashboard)(\/|$)/, namespaces: ["riDirector", "goals"] },
  { pattern: /^\/goal-overviews(\/|$)/, namespaces: ["goals"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(members|board-of-directors|directory|past-presidents|sub-groups)(\/|$)/, namespaces: ["members"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(announcements|upcoming-events|newsletters|documents|weblinks|greetings|mass-emails)(\/|$)/, namespaces: ["content"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(club-monthly-report|club-report|district-report|attendance)(\/|$)/, namespaces: ["cmr"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(membership-dues|club-dues|event-payment-links|wallet)(\/|$)/, namespaces: ["dues", "payments"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(trf|foundation-goal|recognition)(\/|$)/, namespaces: ["foundation"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(goal-setting|membership-goal)(\/|$)/, namespaces: ["goals"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(website-data|my-club-website)(\/|$)/, namespaces: ["website"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(citation|zonal-awards)(\/|$)/, namespaces: ["awards"] },
  { pattern: /^\/(clubs|districts)\/[^/]+\/(projects|community-service|international-service|vocational-service|club-service|youth-service|new-generation-service|public-image)(\/|$)/, namespaces: ["projects"] },
  { pattern: /^\/(clubs|districts)(\/|$)/, namespaces: ["clubDashboard", "districtDashboard"] },
  { pattern: /^\/members(\/|$)/, namespaces: ["members"] },
  { pattern: /^\/(privacy-policy|terms-and-conditions|refunds-and-cancellations)(\/|$)/, namespaces: ["site"] },
];

export function namespacesFor(pathname: string): string[] {
  const match = ROUTE_NAMESPACES.find((r) => r.pattern.test(pathname));
  return [...BASE_NAMESPACES, ...(match?.namespaces ?? [])];
}

/** Language names in their own language, for the picker ("Deutsch", "日本語"). */
export function nativeLanguageName(code: string): string {
  if (code === PSEUDO_LOCALE) return "Pseudo (testing)";
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** "fr-CA" -> "fr"; anything unparseable -> "" */
function baseLanguage(tag: string | null | undefined): string {
  return (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * First match wins, and the result must be one of the instance's languages.
 * ROW lists only "en", so ROW always resolves to English.
 *
 * @param cookie         the NEXT_LOCALE cookie
 * @param memberLanguage the signed-in member's stored language (ISO code)
 * @param acceptLanguage browser languages, most preferred first
 */
export function resolveLocale(
  cookie: string | null | undefined,
  memberLanguage: string | null | undefined,
  acceptLanguage: readonly string[],
  brandDefault: string,
  brandLanguages: readonly string[],
  allowPseudo = false,
): string {
  if (allowPseudo && cookie === PSEUDO_LOCALE) return PSEUDO_LOCALE;
  const allowed = brandLanguages.filter((l) => (SUPPORTED_LOCALES as readonly string[]).includes(l));
  const pick = (tag: string | null | undefined) => {
    const base = baseLanguage(tag);
    return allowed.includes(base) ? base : null;
  };
  return (
    pick(cookie) ??
    pick(memberLanguage) ??
    acceptLanguage.map(pick).find((l): l is string => !!l) ??
    pick(brandDefault) ??
    allowed[0] ??
    DEFAULT_LOCALE
  );
}

/** Parse an Accept-Language header into tags, most preferred first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim(), q: q ? parseFloat(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((x) => x.tag && x.tag !== "*")
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}
