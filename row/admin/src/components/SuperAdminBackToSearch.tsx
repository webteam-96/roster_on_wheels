"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth, decodeJwt } from "@/contexts/AuthContext";
import { ArrowLeft } from "@/components/icons";

// A floating shortcut back to Global Search, shown ONLY to a SuperAdmin who has drilled into a
// District / Club / Zone / AG dashboard (those pages otherwise have no way back to
// the SuperAdmin search). A genuine DA/CA/AG login is NOT a SuperAdmin, so they never see it.
//
// Hidden on the SuperAdmin's own areas (settings / admin / login) where dedicated navigation already
// exists — including the Global Search page itself, so we don't show "Back to Search" while on search.
const HIDE_PREFIXES = ["/settings", "/admin", "/login"];
// Public policy pages have their own header, and add/edit forms have a pinned save bar this button would cover.
const PUBLIC_PAGES = ["/forgot-password", "/reset-password", "/about-us", "/contact-us", "/terms-and-conditions", "/refunds-and-cancellations",
  "/privacy-policy", "/cookies", "/data-processing-agreement", "/tutorial", "/pay", "/report"];
const isFormPage = (path: string) => /\/(add|edit|new|create)(\/|$)/.test(path);

export default function SuperAdminBackToSearch() {
  const { token } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Read SuperAdmin from the JWT, NOT from `user.roles`: when a SuperAdmin drills into a
  // District/Club/Zone dashboard, my-context strips SuperAdmin from the scoped user.roles (so
  // `isSuperAdmin` would be false there). The login JWT always keeps the true roles, so this stays
  // true for a drilled SuperAdmin and false for a genuine DA/CA/AG/CM login.
  const isSuperAdminLogin = !!token && (decodeJwt(token)?.roles ?? []).includes("SuperAdmin");

  if (!isSuperAdminLogin) return null;
  if (pathname === "/" || HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/")) || isFormPage(pathname)) return null;

  // Sits in the AppHeader (not floating), so it never covers page content such as pagination.
  return (
    <button
      type="button"
      onClick={() => router.push("/settings/global-search")}
      title="Return to Global Search (SuperAdmin)"
      aria-label="Back to Search"
      className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-3 sm:px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="hidden sm:inline">Back to Search</span>
    </button>
  );
}
