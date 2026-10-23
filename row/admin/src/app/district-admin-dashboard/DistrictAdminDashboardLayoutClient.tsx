"use client";

import { ReactNode, Suspense } from "react";
import { usePathname } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import DistrictAdminYearSelector from "@/components/dashboard/DistrictAdminYearSelector";
import DistrictAdminTopbarStatus from "@/components/dashboard/DistrictAdminTopbarStatus";
import DistrictAdminHeaderSubtitle from "@/components/dashboard/DistrictAdminHeaderSubtitle";
import PlanningBanner from "@/components/planning/PlanningBanner";
import { useAuth } from "@/contexts/AuthContext";
import { DistrictAdminDashboardCacheProvider } from "@/contexts/DistrictAdminDashboardCacheContext";
import { DISTRICT_ADMIN_NAV, DISTRICT_ADMIN_PAGE_TITLES } from "./nav";

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
  const { user, selectedDistrictId } = useAuth();
  const name = user?.name ?? "District Admin";
  const initials = getInitials(name);
  const title = DISTRICT_ADMIN_PAGE_TITLES[pathname] ?? "District Dashboard";

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
            nav={DISTRICT_ADMIN_NAV}
            footerText={<DashboardYearFooterText />}
            pageTitle={title}
            pageSubtitle={<DistrictAdminHeaderSubtitle />}
            variant="dot"
            switcherKind="district-admin"
            topbarStart={<DistrictAdminTopbarStatus />}
            topbarCenter={<DistrictAdminYearSelector />}
          >
            <PlanningBanner districtId={selectedDistrictId} />
            {children}
          </DashboardShell>
        </DistrictAdminDashboardCacheProvider>
      </Suspense>
    </DashboardGuard>
  );
}
