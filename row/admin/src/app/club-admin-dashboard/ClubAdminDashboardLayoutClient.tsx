"use client";

import { ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearSelector from "@/components/dashboard/DashboardYearSelector";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import ClubAdminTopbarStatus from "@/components/dashboard/ClubAdminTopbarStatus";
import { useAuth } from "@/contexts/AuthContext";
import { ClubAdminDashboardCacheProvider } from "@/contexts/ClubAdminDashboardCacheContext";
import { getClubDuesOfficerClubs } from "@/services/api";
import { CLUB_ADMIN_NAV, CLUB_ADMIN_PAGE_TITLES } from "./nav";

// Pages that list every rotary year at once — the global year selector has nothing
// to act on there, so we hide it rather than leave a control that appears dead.
// Matched exactly, never by prefix: sibling routes must opt in on their own.
const HIDE_YEAR_SELECTOR_PATHS = new Set(["/club-admin-dashboard/dashboard/past-presidents"]);

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export default function ClubAdminDashboardLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/club-admin-dashboard";
  const { user } = useAuth();
  const name = user?.name ?? "Club Admin";
  const initials = getInitials(name);
  const title = CLUB_ADMIN_PAGE_TITLES[pathname] ?? "Club Dashboard";
  const showYearSelector = !HIDE_YEAR_SELECTOR_PATHS.has(pathname);

  // Officer-only nav items (District Dues) are shown only to members who are a
  // President / Secretary / Treasurer of an active club-dues campaign. Resolved
  // once via the officer endpoint; hidden until confirmed so non-officers never
  // see it flash in. Server re-enforces access on every officer endpoint.
  const [isOfficer, setIsOfficer] = useState(false);
  useEffect(() => {
    let alive = true;
    getClubDuesOfficerClubs()
      .then((rows) => { if (alive) setIsOfficer(Array.isArray(rows) && rows.length > 0); })
      .catch(() => { if (alive) setIsOfficer(false); });
    return () => { alive = false; };
  }, []);
  const nav = useMemo(
    () => (isOfficer ? CLUB_ADMIN_NAV : CLUB_ADMIN_NAV.filter((n) => !n.officerOnly)),
    [isOfficer]
  );

  return (
    <DashboardGuard kind="club-admin">
      {/* Suspense required because the cache provider + year selector both
          call useSearchParams() internally. */}
      <Suspense fallback={null}>
        <ClubAdminDashboardCacheProvider>
          <DashboardShell
            brand="Club Dashboard"
            identityLabel="Signed in"
            identityName={name}
            identityRole="Club Admin"
            initials={initials || "CA"}
            nav={nav}
            footerText={<DashboardYearFooterText />}
            pageTitle={title}
            variant="dot"
            switcherKind="club-admin"
            topbarCenter={
              <>
                <ClubAdminTopbarStatus />
                {showYearSelector && <DashboardYearSelector />}
              </>
            }
          >
            {children}
          </DashboardShell>
        </ClubAdminDashboardCacheProvider>
      </Suspense>
    </DashboardGuard>
  );
}
