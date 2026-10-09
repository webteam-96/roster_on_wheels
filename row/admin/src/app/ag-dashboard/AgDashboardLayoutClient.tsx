"use client";

import { ReactNode, Suspense } from "react";
import { usePathname } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import AgYearSelector from "@/components/dashboard/AgYearSelector";
import { useAuth } from "@/contexts/AuthContext";
import { AG_NAV, AG_PAGE_TITLES } from "./nav";

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export default function AgDashboardLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/ag-dashboard";
  const { user } = useAuth();
  const name = user?.name ?? "Assistant Governor";
  const initials = getInitials(name);
  const title = AG_PAGE_TITLES[pathname] ?? "AG Dashboard";

  return (
    <DashboardGuard kind="ag">
      <DashboardShell
        brand="AG Dashboard"
        identityLabel="Signed in"
        identityName={name}
        identityRole="Assistant Governor"
        initials={initials || "AG"}
        nav={AG_NAV}
        footerText={<DashboardYearFooterText />}
        pageTitle={title}
        variant="icon"
        switcherKind="ag"
        topbarCenter={
          // Suspense: the selector reads useSearchParams().
          <Suspense fallback={null}>
            <AgYearSelector />
          </Suspense>
        }
      >
        {children}
      </DashboardShell>
    </DashboardGuard>
  );
}
