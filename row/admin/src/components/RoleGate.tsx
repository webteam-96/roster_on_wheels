"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import RotaryLoader from "@/components/RotaryLoader";
import type { RoleScopeDto } from "@/types/scope";

// Pages for one role only. A typed or bookmarked URL from another role goes to the role home before the page loads,
// instead of opening a page whose API calls all answer 403 (crawl as Club Admin, District Admin and AG, 2026-10-26).
// The API refuses those calls anyway; this is the page-level twin of DashboardGuard.
// "/settings/membership-dues" stays open: club admins create their dues plans there (payments on hold).
const SUPER_ADMIN_ONLY = /^\/(settings(?!\/membership-dues(\/|$))|goal-overviews)(\/|$)/;
const DISTRICT_PAGE = /^\/districts\/(\d+)(\/|$)/;

export function mayOpen(
  path: string,
  user: { isSuperAdmin: boolean; roles: string[]; scopedRoles?: RoleScopeDto[] },
): boolean {
  if (user.isSuperAdmin) return true;
  if (SUPER_ADMIN_ONLY.test(path)) return false;
  const district = DISTRICT_PAGE.exec(path);
  if (district) {
    const scoped = user.scopedRoles ?? [];
    // An older session without scopes: let it through, the API still checks (as DashboardGuard does).
    if (scoped.length === 0) return user.roles.includes("Admin");
    return scoped.some((r) => r.roleName === "Admin" && r.scope === "district" && r.districtId === Number(district[1]));
  }
  return true;
}

export default function RoleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isSuperAdmin, loading } = useAuth();
  const guarded = SUPER_ADMIN_ONLY.test(pathname) || DISTRICT_PAGE.test(pathname);
  const allowed =
    !guarded || (!loading && (!isAuthenticated ||
      mayOpen(pathname, { isSuperAdmin, roles: user?.roles ?? [], scopedRoles: user?.scopedRoles })));

  // "/admin" is the role home; "/" is the public site, which sends a signed-in user to the login page.
  useEffect(() => {
    if (guarded && !loading && !allowed) router.replace("/admin");
  }, [guarded, loading, allowed, router]);

  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RotaryLoader />
      </div>
    );
  }
  return <>{children}</>;
}
