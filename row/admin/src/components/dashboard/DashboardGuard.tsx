"use client";

import { useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import type { RoleScopeDto, DistrictScopeDto } from "@/types/scope";
import RotaryLoader from "@/components/RotaryLoader";

export type DashboardKind = "ag" | "club-admin" | "district-admin";

interface DashboardGuardProps {
  kind: DashboardKind;
  children: ReactNode;
}

function isAuthorized(
  kind: DashboardKind,
  roles: string[],
  scopedRoles: RoleScopeDto[] | undefined,
  districtClubAccess: DistrictScopeDto[] | undefined,
): boolean {
  if (roles.includes("SuperAdmin")) return true;
  if (kind === "ag") return roles.includes("AG");

  // For Club Admin vs District Admin, the role name is the SAME ("Admin").
  // Distinguish via the scope on member_roles: district-scoped → DA,
  // club-scoped → Club Admin. Use scopedRoles (Wave 9B) for the precise check.
  // Fallback: when scopedRoles isn't populated yet (older session), allow the
  // request through and let the backend's 403 catch any mismatch.
  const scoped = scopedRoles ?? [];
  if (kind === "club-admin") {
    // A District Admin with all-clubs access may act as club admin for any club
    // in their district — admit them here; the backend still enforces the exact
    // club→district match on every club-admin endpoint.
    if ((districtClubAccess ?? []).length > 0) return true;
    if (scoped.length === 0) return roles.includes("Admin");
    return scoped.some(
      (r) => r.roleName === "Admin" && r.scope === "club" && r.clubId != null,
    );
  }
  if (kind === "district-admin") {
    if (scoped.length === 0) return roles.includes("Admin");
    return scoped.some(
      (r) => r.roleName === "Admin" && r.scope === "district" && r.districtId != null,
    );
  }
  return false;
}

export default function DashboardGuard({ kind, children }: DashboardGuardProps) {
  const router = useRouter();
  const { user, isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    const roles = user?.roles ?? [];
    if (!isAuthorized(kind, roles, user?.scopedRoles, user?.districtClubAccess)) {
      router.replace("/");
    }
  }, [loading, isAuthenticated, user, kind, router]);

  if (loading || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RotaryLoader />
      </div>
    );
  }

  const roles = user?.roles ?? [];
  if (!isAuthorized(kind, roles, user?.scopedRoles, user?.districtClubAccess)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RotaryLoader />
      </div>
    );
  }

  return <>{children}</>;
}
