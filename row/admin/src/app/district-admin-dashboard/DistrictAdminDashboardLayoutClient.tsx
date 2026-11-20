"use client";

import { ReactNode, Suspense, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import DistrictAdminYearSelector from "@/components/dashboard/DistrictAdminYearSelector";
import DistrictAdminTopbarStatus from "@/components/dashboard/DistrictAdminTopbarStatus";
import DistrictAdminHeaderSubtitle from "@/components/dashboard/DistrictAdminHeaderSubtitle";
import PlanningBanner from "@/components/planning/PlanningBanner";
import SubscriptionLock, { useSubscriptionLevel } from "@/components/subscriptions/SubscriptionLock";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYear } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { DistrictAdminDashboardCacheProvider } from "@/contexts/DistrictAdminDashboardCacheContext";
import { DISTRICT_ADMIN_NAV, DISTRICT_ADMIN_PAGE_TITLES } from "./nav";

// District Dues: the dues is picked from its own dropdown and each dues has a fixed year, so the year
// selector would change nothing there (user 2026-11-10, same as the Club Dues member list).
const HIDE_YEAR_SELECTOR_PATHS = new Set(["/district-admin-dashboard/club-dues"]);

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export default function DistrictAdminDashboardLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/district-admin-dashboard";
  const { user, selectedDistrictId, isSuperAdmin } = useAuth();
  const name = user?.name ?? "District Admin";
  const initials = getInitials(name);
  const title = DISTRICT_ADMIN_PAGE_TITLES[pathname] ?? "District Dashboard";

  // Wallet holds one balance, spent NOW — so it belongs to the current year's
  // admin, not to someone who only administers a past year.
  // The dashboard's global year picker writes ?yearId=; fall back to the current
  // year when it is absent (first load).
  const searchParams = useSearchParams();
  const { currentYearId } = useRotaryYears();
  const selectedYearId = searchParams?.get("yearId")
    ? Number(searchParams.get("yearId")) : currentYearId;
  const isAdminForSelectedYear = canEditYear(
    districtYearRights(user?.scopedRoles, selectedDistrictId ?? 0), selectedYearId, isSuperAdmin);
  const nav = useMemo(
    () => DISTRICT_ADMIN_NAV.filter((n) => !n.adminYearOnly || isAdminForSelectedYear),
    [isAdminForSelectedYear]
  );
  // KIS/ROW/SUB/01 section 4.5 step 4: district modules lock when the District subscription stops working.
  const subscription = useSubscriptionLevel("district", selectedDistrictId);

  return (
    <DashboardGuard kind="district-admin">
      {/* Suspense required because the cache provider + year selector both
          call useSearchParams() internally. */}
      <Suspense fallback={null}>
        <DistrictAdminDashboardCacheProvider>
          <DashboardShell
            brand="District Dashboard"
            identityLabel="Signed in"
            identityName={name}
            identityRole="District Admin"
            initials={initials || "DA"}
            nav={nav}
            footerText={<DashboardYearFooterText />}
            pageTitle={title}
            pageSubtitle={<DistrictAdminHeaderSubtitle />}
            variant="dot"
            switcherKind="district-admin"
            topbarStart={<DistrictAdminTopbarStatus />}
            topbarCenter={HIDE_YEAR_SELECTOR_PATHS.has(pathname) ? undefined : <DistrictAdminYearSelector />}
          >
            <PlanningBanner districtId={selectedDistrictId} />
            <SubscriptionLock kind="district" level={subscription.level} loading={subscription.loading}>{children}</SubscriptionLock>
          </DashboardShell>
        </DistrictAdminDashboardCacheProvider>
      </Suspense>
    </DashboardGuard>
  );
}
