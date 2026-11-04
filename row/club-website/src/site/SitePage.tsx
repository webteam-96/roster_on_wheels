// One server-rendered page of a club website: resolves the club (lib/pageShell), applies the trial/expiry gate,
// loads the page's data, then renders the theme's shell and the theme's own view of the page (or the shared
// view when the theme has none). Every public route goes through here.

import { headers } from "next/headers";
import type { ReactNode } from "react";
import { buildShell, type PageShell } from "@/lib/pageShell";
import { SiteNotFound } from "@/components/SiteNotFound";
import { StatusOverlay } from "@/components/StatusOverlay";
import { getAdminLoginUrl } from "@/components/AdminLoginLink";
import { THEME_ASSETS } from "@/themes/assets";
import type { PageKey } from "@/themes/registry";
import { ThemeLayout, ThemePage } from "./ThemeViews.jsx";
import { ClubProvider } from "./ClubContext.jsx";
import ThemeScripts from "./ThemeScripts.jsx";
import { defaultMenus } from "./menus.js";

export interface ClubState {
  clubId: number;
  clubName: string;
  clubDisplayName: string;
  subdomain: string | null;
  themeKey: string;
  status: string;
  daysRemaining: number;
  years: { id: number; yearLabel: string; isCurrent: boolean }[];
  selectedYearId: number | null;
  selectedYearLabel: string | null;
  currency: string;
  /** The club's IANA time zone; event times are wall-clock times in it ("" when unknown). */
  timeZone: string;
  about: PageShell["about"];
  menus: unknown[];
  adminLoginUrl: string;
  /** The host this page was requested on, and the club's own domain (shared links prefer it). */
  host: string;
  tenant: { clientDomain: string | null };
}

function clubState(shell: PageShell): ClubState {
  const { tenant, about, years, currentYearId, menus, themeKey } = shell;
  const clubName = tenant.clubName || about?.clubName || "";
  return {
    clubId: tenant.clubId,
    clubName,
    clubDisplayName: clubName || "Rotary Club",
    subdomain: tenant.subdomain,
    themeKey,
    status: tenant.status,
    daysRemaining: tenant.daysRemaining,
    years: years ?? [],
    selectedYearId: currentYearId,
    selectedYearLabel: years?.find((y) => y.id === currentYearId)?.yearLabel ?? null,
    currency: about?.currency || "USD",
    timeZone: about?.timeZone || "",
    about,
    menus: menus && menus.length > 0 ? menus : defaultMenus(),
    adminLoginUrl: getAdminLoginUrl(),
    host: (headers().get("x-tenant-host") || headers().get("host") || "").replace(/:\d+$/, ""),
    tenant: { clientDomain: tenant.clientDomain },
  };
}

type Loader = (shell: PageShell) => Promise<Record<string, unknown>>;

/** The themed page; `page` "Home" is the theme's home page. */
export async function SitePage({ page, load }: { page: PageKey | "Home"; load?: Loader }) {
  const shell = await buildShell();
  if (!shell) return <SiteNotFound host="" />;
  const { tenant } = shell;
  if (tenant.status === "trial_expired" || tenant.status === "expired") return <StatusOverlay tenant={tenant} />;

  const data = load ? await load(shell) : {};

  return (
    <ThemedShell shell={shell}>
      <StatusOverlay tenant={tenant} />
      <ThemePage themeKey={shell.themeKey} page={page} data={data} />
    </ThemedShell>
  );
}

/** The theme's stylesheets, club context and shell around any content; also used by ROW's own pages (join, profile). */
export function ThemedShell({ shell, children }: { shell: PageShell; children: ReactNode }) {
  return (
    <ClubProvider value={clubState(shell)}>
      {(THEME_ASSETS[shell.themeKey]?.styles ?? []).map((href) => <link key={href} rel="stylesheet" href={href} />)}
      <ThemeLayout themeKey={shell.themeKey}>{children}</ThemeLayout>
      <ThemeScripts scripts={THEME_ASSETS[shell.themeKey]?.scripts ?? []} />
    </ClubProvider>
  );
}
