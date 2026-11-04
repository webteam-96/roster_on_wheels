// Multilingual websites (build spec 3.11): this request's language and texts. The middleware turns a /fr/... prefix
// or the site-lang cookie into the x-site-lang header and passes the unprefixed path as x-site-path. null when the
// module is off or the API is down: the site then shows its default texts, as before.
// shortcut: the themes' own labels (headings, empty states, the fallback nav) stay in the platform language; only the
// club's content follows the visitor. Upgrade when the public sites get a string catalogue.

import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { fetchJson } from "./api";
import type { SiteLanguage } from "./siteLanguagePath";

export * from "./siteLanguagePath";

/** One API call per request: layout, metadata and page share it. */
export const getSiteLanguage = cache(async (clubId: number): Promise<SiteLanguage | null> => {
  const asked = headers().get("x-site-lang");
  return fetchJson<SiteLanguage>(
    `/api/public/website-languages/club/${clubId}${asked ? `?lang=${encodeURIComponent(asked)}` : ""}`);
});

/** This page's path without the language prefix. */
export function sitePath(): string {
  return headers().get("x-site-path") || "/";
}

/** Base for the absolute hreflang URLs. */
export function siteOrigin(): URL | undefined {
  const host = headers().get("x-tenant-host") || headers().get("host");
  const proto = headers().get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  try {
    return host ? new URL(`${proto}://${host}`) : undefined;
  } catch {
    return undefined;
  }
}

/** A language in its own words for the switcher: "Français", "Deutsch". */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}
