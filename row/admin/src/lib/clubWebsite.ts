/**
 * Build a club-website URL from the stored subdomain.
 *
 * Some clubs have garbage in club_websites.Subdomain ("https//rcthanehills/",
 * "rcthanehills.rotaryindia.org/", etc), so strip protocol prefixes, stray slashes
 * and any trailing parent-domain suffix down to the bare subdomain.
 *
 * Mirrors the local helper in settings/global-search/page.tsx — kept identical so the
 * two screens resolve the same club to the same URL.
 */
export function clubWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const sub = raw
    .trim()
    .replace(/^https?:?\/+/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.(rotaryindia|rizones4567|rizones45678)\.org$/i, "")
    .trim()
    .toLowerCase();
  if (!sub) return null;
  return `https://${sub}.rotaryindia.org`;
}
