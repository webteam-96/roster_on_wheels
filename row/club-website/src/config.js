// ─────────────────────────────────────────────────────────────────────────────
// Mirror of Faster_ClubWebsite/Web.config <appSettings>.
//
// The ASP.NET site reads these with ConfigurationManager.AppSettings[...]; this
// SPA reads the same KEYS from Vite env vars (VITE_<KEY>) with the same defaults
// and the same meanings, so the resolution chains ported from C# behave
// identically. Set them in .env / .env.local.
//
// ⚠ Before publishing: blank DevHostOverride, DevThemeOverride, DevThemePortMap
//   and DefaultWebsiteId — exactly as in the ASP.NET tree.
// ─────────────────────────────────────────────────────────────────────────────
// `|| {}` so the pure helpers below can also be imported by a plain Node script
// (selfcheck.mjs) where import.meta.env doesn't exist.
const env = import.meta.env || {}

function s(key, fallback = '') {
  const v = env['VITE_' + key]
  return v === undefined || v === null ? fallback : String(v)
}

export const appSettings = {
  /** JSON API base, e.g. https://test.rosteronwheels.com/api (no trailing slash). */
  ApiBaseUrl: s('ApiBaseUrl', '').replace(/\/+$/, ''),

  /** Media/file base for absolutising paths, e.g. https://test.rosteronwheels.com (no /api). */
  MediaBaseUrl: s('MediaBaseUrl', '').replace(/\/+$/, ''),

  /** 0 = instant (admin edits reflect immediately); >0 = cross-request cache TTL. */
  CacheTimeInMinutes: Number(s('CacheTimeInMinutes', '0')) || 0,

  /** Local: resolve this club host instead of localhost. BLANK in production. */
  DevHostOverride: s('DevHostOverride', ''),

  /** Local: force a theme key. BLANK in production. */
  DevThemeOverride: s('DevThemeOverride', ''),

  /** Local: per-port theme pins, "8091=warm-modern;8092=civic-bold". BLANK in production. */
  DevThemePortMap: s('DevThemePortMap', ''),

  /** PRODUCTION per-club pin, "12=gold;myclub=warm-modern". */
  ClubThemeMap: s('ClubThemeMap', ''),

  /** PRODUCTION global lock — pins every club to one theme. Blank = per-club DB themes. */
  ForcedTheme: s('ForcedTheme', ''),

  /** Shared key that unlocks ?theme=X&pk=KEY live previews. Blank = feature inert. */
  ThemePreviewKey: s('ThemePreviewKey', ''),

  /**
   * Local: comma-separated photo URLs used to preview the home event section.
   * BLANK in production — these are third-party images and 1307 club sites must
   * not publish them. Also gated by isLocalRequest() at the point of use.
   */
  PreviewEventImages: s('PreviewEventImages', ''),

  /** Local: fallback club id when the host doesn't resolve. BLANK in production. */
  DefaultWebsiteId: s('DefaultWebsiteId', ''),

  /** HTTP timeout in seconds (ASP.NET default 20). */
  ApiTimeoutSeconds: Number(s('ApiTimeoutSeconds', '20')) || 20,

  /** Admin login target used by every theme's header. */
  AdminLoginUrl: s('AdminLoginUrl', ''),

  /** Renewal page used when the API gives no per-club pay link (ExpiredWebsite). */
  RenewUrl: s('RenewUrl', ''),

  /** Support contact on the Expired / Not-configured pages. Blank = that line is not shown. */
  SupportEmail: s('SupportEmail', ''),
  SupportPhone: s('SupportPhone', ''),
  /** SupportPhone may hold several numbers, comma-separated; each renders as its own tel: link. */
  SupportPhones: s('SupportPhone', '').split(',').map((p) => p.trim()).filter(Boolean),

  /** ROW Terms of Service / Privacy Policy, linked in every footer (shared/FooterLegal.jsx). Blank = hidden. */
  TermsUrl: s('TermsUrl', ''),
  PrivacyUrl: s('PrivacyUrl', ''),

  /**
   * Footer visitor counter. BLANK = the count comes from localStorage and
   * describes one browser only (NOT IP-deduped, not shared between visitors).
   * Set it to an endpoint returning {"total":n,"today":n} for ?club=<clubId>
   * and the counter becomes a real per-IP site total. See shared/visitorCount.jsx.
   */
  VisitorCountUrl: s('VisitorCountUrl', '').replace(/\/+$/, ''),

  /**
   * Baseline added to the footer counter's all-time figure — the carry-over
   * from the site this one replaced. Applies to LOCAL mode only; in server mode
   * the endpoint owns the number. It also switches the caption to "Visitors",
   * because a seeded figure is a claim about the SITE, not about the person
   * reading it. 0 = no baseline.
   */
  // PER CLUB, "clubId=count;clubId=count" (e.g. "1=3026"): one flat number gave
  // EVERY club the same 3,026 head start. A bare number still applies to all.
  VisitorCountSeed: s('VisitorCountSeed', ''),
}

/**
 * Browser equivalent of HttpRequest.IsLocal — gates the ?theme= and
 * DevThemePortMap overrides so production clubs can't be theme-spoofed.
 */
export function isLocalRequest() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

export default appSettings
