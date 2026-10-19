"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth, decodeJwt } from "@/contexts/AuthContext";
import { ArrowLeft } from "@/components/icons";

// A floating shortcut back to Global Search, shown ONLY to a SuperAdmin who has drilled into a
// District / Club / Zone / AG / Club-Moderator dashboard (those pages otherwise have no way back to
// the SuperAdmin search). A genuine DA/CA/AG/CM login is NOT a SuperAdmin, so they never see it.
//
// Hidden on the SuperAdmin's own areas (settings / admin / login) where dedicated navigation already
// exists — including the Global Search page itself, so we don't show "Back to Search" while on search.
const HIDE_PREFIXES = ["/settings", "/admin", "/login"];

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

  return (
    <button
      type="button"
      onClick={() => router.push("/settings/global-search")}
      title="Return to Global Search (SuperAdmin)"
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-black/10 transition hover:bg-primary/90 hover:shadow-xl"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Search
    </button>
  );
}
