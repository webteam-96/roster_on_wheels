// Common page-shell helpers used by every public route.
// Resolves tenant + about + menus + years once and picks the right theme.
// Year selection comes from the `rotary-year` cookie set by <YearSelector> —
// no URL params, so links stay clean.

import "server-only";
import { cache } from "react";
import { headers, cookies } from "next/headers";
import { resolveTenant, type TenantContext } from "./tenant";
import { getAboutV2, getClubData, getMenus, type AboutV2, type Menu, type YearOption } from "./publicApi";
import { getSiteLanguage, siteText, translateMenus, type SiteLanguage } from "./siteLanguage";
import { activeThemeKey, type ThemeKey } from "@/themes/registry";

const YEAR_COOKIE = "rotary-year";

export interface PageShell {
  tenant: TenantContext;
  themeKey: ThemeKey;
  about: AboutV2 | null; // content in the visitor's language
  menus: Menu[] | null; // in the visitor's language
  years: YearOption[] | null;
  currentYearId: number | null;
  lang: SiteLanguage | null; // null when the multilingual module is off
}

/** The club for this host; one lookup per request (layout, metadata and page share it). */
export const currentTenant = cache(() =>
  resolveTenant(headers().get("x-tenant-host") || headers().get("host") || ""));

export const buildShell = cache(async (): Promise<PageShell | null> => {
  const tenant = await currentTenant();
  if (!tenant) return null;

  // Don't bother fetching content for a non-active site — saves N database
  // round-trips for a banner that's about to show "expired" anyway.
  const isLocked = tenant.status === "trial_expired" || tenant.status === "expired";

  const [menus, years, lang] = isLocked
    ? [null as Menu[] | null, null as YearOption[] | null, null as SiteLanguage | null]
    : await Promise.all([
        getMenus(tenant.clubId),
        getClubData<YearOption[]>(tenant.clubId, "v2/years"),
        getSiteLanguage(tenant.clubId),
      ]);

  const yearCookie = cookies().get(YEAR_COOKIE)?.value;
  const currentYearId = pickCurrentYear(years, yearCookie);
  // The club's logos, contacts and socials follow the picked year, as on the RIZones site.
  const about = isLocked ? null : await getAboutV2(tenant.clubId, currentYearId);
  const aboutText = siteText(lang, "about")?.body;
  const themeKey = activeThemeKey(tenant.themeKey);
  return {
    tenant, themeKey,
    about: about && aboutText ? { ...about, content: aboutText } : about,
    menus: translateMenus(menus, lang), years, currentYearId, lang,
  };
});

function pickCurrentYear(years: YearOption[] | null, fromCookie: string | undefined): number | null {
  const q = fromCookie && /^\d+$/.test(fromCookie) ? Number(fromCookie) : null;
  if (q && years?.some((y) => y.id === q)) return q;
  if (!years || years.length === 0) return null;
  const cur = years.find((y) => y.isCurrent);
  return cur ? cur.id : years[0]?.id ?? null;
}
