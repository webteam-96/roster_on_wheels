"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import AppFrame from "@/components/dashboard/AppFrame";
import FeatureGate from "@/components/FeatureGate";
import RoleGate from "@/components/RoleGate";

/**
 * Chooses the chrome for the current route. Public-website routes (the (site)
 * route group) render bare — the (site) layout provides their own header,
 * footer and full-bleed padding. Dashboards and V2 pages carry their own shell; every other
 * signed-in page gets AppFrame (same sidebar and top bar).
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
const BARE_PREFIXES = ["/pay/", "/invite/"]; // /invite/[token]: a guest's RSVP to a member's invite link
function isBareRoute(pathname: string): boolean {
  return BARE_PREFIXES.some((p) => pathname.startsWith(p));
}

// Pages shown without signing in: no frame.
const PUBLIC_PREFIXES = [
  "/login", "/forgot-password", "/exec-signin", "/reset-password", "/terms-and-conditions", "/refunds-and-cancellations",
  "/privacy-policy", "/cookies", "/data-processing-agreement", "/admin/about-us", "/admin/contact-us", "/admin/tutorial",
  "/report/", "/public/", "/unsubscribe/", "/sso", "/dues-approval/", "/club-dues-approval/", "/planning/accept/",
];
// Dashboards, V2 pages and greetings render a shell of their own, except these older district V2 lists.
const FRAMED_V2 = /^\/districts\/\d+\/(ag|citation|clubs|district-committee)\/v2(\/|$)/;
const OWN_SHELL = /^\/(club-admin|ag|district-admin)-dashboard(\/|$)|^\/goal-overviews(\/|$)|\/v2(\/|$)|^\/(clubs|districts)\/\d+\/greetings(\/|$)/;

export default function RootShell({ children }: { children: React.ReactNode }) {
  // From the route tree, not usePathname: under the "/admin" base path, the routes in app/admin get a different
  // pathname on the server and in the browser (the prefix is removed twice), which breaks hydration.
  const pathname = "/" + useSelectedLayoutSegments().filter((s) => !s.startsWith("(")).join("/");
  if (isSiteRoute(pathname) || isBareRoute(pathname)) return <>{children}</>;
  const isFramed = !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) && (!OWN_SHELL.test(pathname) || FRAMED_V2.test(pathname));
  return (
    <FeatureGate>
      <RoleGate>
        {isFramed ? (
          <AppFrame path={pathname}>{children}</AppFrame>
        ) : (
          <main className="row-main px-4 py-4 md:px-8">{children}</main>
        )}
      </RoleGate>
    </FeatureGate>
  );
}
