"use client";

import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import SuperAdminBackToSearch from "@/components/SuperAdminBackToSearch";

/**
 * Chooses the chrome for the current route. Public-website routes (the (site)
 * route group) render bare — the (site) layout provides their own header,
 * footer and full-bleed padding. Every other route keeps the admin chrome
 * (AppHeader + padded main) exactly as before.
 */
const SITE_PREFIXES = [
  "/about-us",
  "/contact-us",
  "/tutorial",
  "/projects",
  "/our-leaders",
  "/regional-leaders",
  "/district-governors",
  "/committee",
  "/websites",
  "/international-national",
  "/events",
  "/past-events",
  "/download",
  "/prospective-member",
];

function isSiteRoute(pathname: string): boolean {
  return pathname === "/" || SITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Full-bleed public routes that render their own chrome (e.g. PayPageShell). They must NOT get the
// admin padded <main>, otherwise the branded header/footer leave white gutters at the screen edges.
const BARE_PREFIXES = ["/pay/"];
function isBareRoute(pathname: string): boolean {
  return BARE_PREFIXES.some((p) => pathname.startsWith(p));
}

export default function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isSiteRoute(pathname) || isBareRoute(pathname)) return <>{children}</>;
  return (
    <>
      <AppHeader />
      <main className="px-8 py-4">{children}</main>
      {/* SuperAdmin-only floating shortcut back to Global Search (hidden for real DA/CA/AG/CM logins). */}
      <SuperAdminBackToSearch />
      {/* The floating bottom-left role switcher was REMOVED (user 2026-09-29): the dashboards already
          carry the switcher in their sidebar, so a second list of every role on the SuperAdmin portal
          pages was just confusing. The header "Back to <dashboard>" button is the way back. */}
    </>
  );
}
