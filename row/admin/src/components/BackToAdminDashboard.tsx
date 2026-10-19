"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth, decodeJwt } from "@/contexts/AuthContext";
import { resolveDashboardLanding, type DashboardEntry } from "@/services/api";
import DashboardSwitcher from "@/components/dashboard/DashboardSwitcher";

// A floating GLOBAL shortcut back to the member's OWN admin dashboard, shown ONLY to a member who is
// SuperAdmin AND ALSO holds an operational admin role (District/Club Admin, AG, ZC, RI Director, Club
// Moderator). Multi-role members land on their operational dashboard and can switch INTO Super Admin
// from the sidebar switcher (→ Global Search); this is the way BACK — visible on every SuperAdmin
// portal page. A pure SuperAdmin has no operational dashboard, so they never see it.
//
// Hidden on the operational dashboards themselves (they carry the sidebar switcher) and on login.
// Positioned bottom-LEFT so it never overlaps the bottom-right "Back to Search" button.

const HIDE_PREFIXES = [
  "/login",
  "/club-admin-dashboard",
  "/district-admin-dashboard",
  "/ag-dashboard",
  "/zonal-dashboard",
  "/club-moderator",
];

// Same priority the resolver uses for the default landing, minus SuperAdmin — picks which operational
// dashboard "Back to Admin" returns to when the member holds several.
const OPERATIONAL_ORDER = [
  "district-admin",
  "club-admin",
  "ri-director",
  "zonal-coordinator",
  "ag",
  "club-moderator",
  "goal-oversight",
];

function pickOperational(available: DashboardEntry[]): DashboardEntry | null {
  for (const kind of OPERATIONAL_ORDER) {
    const entry = available.find((e) => e.kind === kind);
    if (entry) return entry;
  }
  return null;
}

function readCachedAvailable(): DashboardEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("dashboard_available_v2");
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function BackToAdminDashboard() {
  const { token } = useAuth();
  const pathname = usePathname();
  // Prime from the login-written cache so the button paints instantly, then refresh from the server.
  const [available, setAvailable] = useState<DashboardEntry[]>(() => readCachedAvailable());

  // Read SuperAdmin from the JWT (not user.roles) — my-context strips SuperAdmin when a SA drills into
  // a scoped dashboard, but the login JWT always keeps the true roles.
  const isSuperAdminLogin = !!token && (decodeJwt(token)?.roles ?? []).includes("SuperAdmin");

  useEffect(() => {
    if (!isSuperAdminLogin) return;
    let cancelled = false;
    resolveDashboardLanding()
      .then((r) => {
        if (cancelled) return;
        if (r?.available && r.available.length > 0) setAvailable(r.available);
      })
      .catch(() => { /* keep cached: button just hides if nothing operational */ });
    return () => { cancelled = true; };
  }, [isSuperAdminLogin]);

  if (!isSuperAdminLogin) return null;
  if (HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  // Drilled V2 module pages (/clubs/{id}/.../v2/...) carry their own back-nav — keep this to the SA portal.
  if (/\/v2(\/|$)/.test(pathname)) return null;

  const target = pickOperational(available);
  if (!target) return null; // pure SuperAdmin — nothing to go back to

  // 2026-09-25: the full "Switch dashboard" list (every role the member holds), not a single
  // jump back to one dashboard. Opens upward from the bottom-left corner.
  return (
    <div className="fixed bottom-5 left-5 z-40 w-64 rounded-xl p-1.5 shadow-lg ring-1 ring-black/10" style={{ backgroundColor: "#1b2c42" }}>
      <Suspense fallback={null}>
        <DashboardSwitcher currentKind="super-admin" />
      </Suspense>
    </div>
  );
}
