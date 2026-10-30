"use client";

// A prominent header shortcut BACK to the member's own operational dashboard (District/Club Admin,
// AG), shown ONLY to a SuperAdmin who ALSO holds such a role.
// Multi-role members land on their operational dashboard and switch INTO Super Admin from the
// sidebar; the SuperAdmin portal (Global Search / Settings) has no sidebar switcher, so this — plus
// the floating bottom-left "Back to Admin Dashboard" button — is the way back. A pure SuperAdmin has
// no operational dashboard, so nothing renders.

import { useEffect, useState } from "react";
import { useAuth, decodeJwt } from "@/contexts/AuthContext";
import { resolveDashboardLanding, type DashboardEntry } from "@/services/api";
import { LayoutDashboard } from "@/components/icons";

const OPERATIONAL_ORDER = ["district-admin", "club-admin", "ag"];

function pickOperational(available: DashboardEntry[]): DashboardEntry | null {
  for (const kind of OPERATIONAL_ORDER) {
    const e = available.find((x) => x.kind === kind);
    if (e) return e;
  }
  return null;
}

function readCache(): DashboardEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("dashboard_available_v2");
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

const KIND_LABEL: Record<string, string> = {
  "district-admin": "District Admin",
  "club-admin": "Club Admin",
  "ag": "AG Dashboard",
};

export default function HeaderAdminDashboardLink() {
  const { token, selectScope } = useAuth();
  const [available, setAvailable] = useState<DashboardEntry[]>(() => readCache());
  const isSuperAdminLogin = !!token && (decodeJwt(token)?.roles ?? []).includes("SuperAdmin");

  useEffect(() => {
    if (!isSuperAdminLogin) return;
    let cancelled = false;
    resolveDashboardLanding()
      .then((r) => { if (!cancelled && r?.available?.length) setAvailable(r.available); })
      .catch(() => { /* keep cache */ });
    return () => { cancelled = true; };
  }, [isSuperAdminLogin]);

  if (!isSuperAdminLogin) return null;
  const target = pickOperational(available);
  if (!target) return null;

  const label = KIND_LABEL[target.kind] ?? "My Dashboard";
  const scopeName = target.districtNumber ? ` (D${target.districtNumber})` : target.clubName ? ` (${target.clubName})` : "";

  const goBack = () => {
    const scopeArgs: { clubId?: number | null; districtId?: number | null; zoneId?: number | null } = {};
    if (target.clubId != null) scopeArgs.clubId = target.clubId;
    if (target.districtId != null) scopeArgs.districtId = target.districtId;
    if (target.zoneId != null) scopeArgs.zoneId = target.zoneId;
    if (Object.keys(scopeArgs).length > 0) selectScope(scopeArgs);
    window.location.assign(target.route);
  };

  return (
    <button
      type="button"
      onClick={goBack}
      title={`Back to ${label}${scopeName}`}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold bg-white/20 text-primary-foreground hover:bg-white/30 transition"
    >
      <LayoutDashboard className="h-4 w-4" />
      <span className="hidden sm:inline">Back to {label}{scopeName}</span>
      <span className="sm:hidden">Dashboard</span>
    </button>
  );
}
