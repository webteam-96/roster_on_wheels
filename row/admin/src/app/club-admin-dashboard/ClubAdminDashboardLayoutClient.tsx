"use client";

import { ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearSelector from "@/components/dashboard/DashboardYearSelector";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import ClubAdminTopbarStatus from "@/components/dashboard/ClubAdminTopbarStatus";
import PlanningBanner from "@/components/planning/PlanningBanner";
import { useAuth } from "@/contexts/AuthContext";
import { ClubAdminDashboardCacheProvider, useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
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
  const { user, selectedClubId } = useAuth();
  const name = user?.name ?? "Club Admin";
  const initials = getInitials(name);
  const title = CLUB_ADMIN_PAGE_TITLES[pathname] ?? "Club Dashboard";
  const showYearSelector = !HIDE_YEAR_SELECTOR_PATHS.has(pathname);

  // Officer-only nav items (District Dues) are shown only when the signed-in member is a
  // President / Secretary / Treasurer of THE CLUB OPEN ON THIS DASHBOARD and that club's
  // district has an active dues campaign (user 2026-10-08: it used to follow the person, so an
  // officer of club A saw District Dues while viewing club B). Hidden until confirmed so
  // non-officers never see it flash in. Server re-enforces access on every officer endpoint.
  const [officerClubIds, setOfficerClubIds] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    getClubDuesOfficerClubs()
      .then((rows) => { if (alive) setOfficerClubIds(Array.isArray(rows) ? rows.map((r) => r.clubId) : []); })
      .catch(() => { if (alive) setOfficerClubIds([]); });
    return () => { alive = false; };
  }, []);

  return (
    <DashboardGuard kind="club-admin">
      {/* Suspense required because the cache provider + year selector both
          call useSearchParams() internally. */}
      <Suspense fallback={null}>
        <ClubAdminDashboardCacheProvider>
          <ClubAdminShell
            name={name}
            initials={initials}
            title={title}
            showYearSelector={showYearSelector}
            officerClubIds={officerClubIds}
            selectedClubId={selectedClubId}
          >
            {children}
          </ClubAdminShell>
        </ClubAdminDashboardCacheProvider>
      </Suspense>
    </DashboardGuard>
  );
}

// Inside the cache provider so the open club (overview) is known when no club is picked yet.
function ClubAdminShell({ name, initials, title, showYearSelector, officerClubIds, selectedClubId, children }: {
  name: string; initials: string; title: string; showYearSelector: boolean;
  officerClubIds: number[]; selectedClubId: number | null; children: ReactNode;
}) {
  const { overview } = useClubAdminCache();
  const openClubId = selectedClubId ?? overview?.club?.clubId ?? null;
  const isOfficer = openClubId != null && officerClubIds.includes(openClubId);
  const nav = useMemo(
    () => (isOfficer ? CLUB_ADMIN_NAV : CLUB_ADMIN_NAV.filter((n) => !n.officerOnly)),
    [isOfficer]
  );
  return (
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
      <PlanningBanner clubId={openClubId} />
      {children}
    </DashboardShell>
  );
}
