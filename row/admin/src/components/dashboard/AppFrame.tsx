"use client";

import { Suspense, useCallback, useState, type ReactNode } from "react";
import { useAuth, useAgDistricts, useClubAdminClubs, useDistrictAdminDistricts, useSelectedClub, useSelectedDistrict } from "@/contexts/AuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { isFeatureOn } from "@/lib/brand";
import { CLUB_ADMIN_NAV } from "@/app/club-admin-dashboard/nav";
import { DISTRICT_ADMIN_NAV } from "@/app/district-admin-dashboard/nav";
import { AG_NAV } from "@/app/ag-dashboard/nav";
import { SUPER_ADMIN_NAV } from "./superAdminNav";
import { navMatch } from "./navMatch";
import ClubTopbarStatus from "./ClubTopbarStatus";
import DistrictAdminTopbarStatus from "./DistrictAdminTopbarStatus";
import DashboardYearFooterText from "./DashboardYearFooterText";
import Sidebar from "./Sidebar";
import ShellFrame from "./ShellFrame";
import TopBar, { ScopeLabel } from "./TopBar";
import TopBarAccount from "./TopBarAccount";

const initialsOf = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "R";

/** The frame of every signed-in page that is not inside a role dashboard: same sidebar, top bar and width, with the
 *  menu of the role the user works in. */
export default function AppFrame({ path, children }: { path: string; children: ReactNode }) {
  const { user, isSuperAdmin, isAuthenticated, logout } = useAuth();
  const selectedClub = useSelectedClub();
  const district = useSelectedDistrict();
  const clubAdminClubs = useClubAdminClubs();
  const districtAdminDistricts = useDistrictAdminDistricts();
  const agDistricts = useAgDistricts();
  const brand = useBrand();
  const { byKey: comingSoon } = useComingSoonModules();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);

  const isDistrictPath = path.startsWith("/districts");
  // On /clubs/<id>/... the page is about that club: show it in the top bar when the user administers it, not the saved
  // choice (live QA 27 Nov: a club admin who is also a member elsewhere saw the other club and a 403 on its balance).
  const routeClubId = Number(path.match(/^\/clubs\/(\d+)/)?.[1]) || 0;
  const club = clubAdminClubs.find((c) => c.id === routeClubId) ?? selectedClub;
  const role = isSuperAdmin
    ? { kind: "super-admin" as const, label: "Super Admin", nav: SUPER_ADMIN_NAV, scope: null }
    : districtAdminDistricts.length > 0 && (isDistrictPath || clubAdminClubs.length === 0)
      ? { kind: "district-admin" as const, label: "District Admin", nav: DISTRICT_ADMIN_NAV, scope: district && { label: "District", name: district.number } }
      : clubAdminClubs.length > 0
        ? { kind: "club-admin" as const, label: "Club Admin", nav: CLUB_ADMIN_NAV, scope: club && { label: "Club", name: club.name } }
        : agDistricts.length > 0
          ? { kind: "ag" as const, label: "Assistant Governor", nav: AG_NAV, scope: district && { label: "District", name: district.number } }
          : null;

  const nav = (role?.nav ?? []).filter(
    (n) =>
      (!n.feature || isFeatureOn(brand, n.feature)) &&
      (isSuperAdmin || (!n.superAdminOnly && (n.moduleKey === "goal_setting" || !n.moduleKey || !comingSoon[n.moduleKey]?.isComingSoon))),
  );
  const current = navMatch(nav.map((n) => n.to), path);
  const name = user?.name ?? "";

  return (
    <ShellFrame
      open={open}
      onClose={closeMenu}
      sidebar={
        <Sidebar
          brand={role?.label ?? brand.productName}
          identityName={name}
          identityRole={role?.label ?? ""}
          initials={initialsOf(name)}
          nav={nav.map((n) => ({ ...n, active: n.to === current }))}
          footerText={<Suspense fallback={null}><DashboardYearFooterText /></Suspense>}
          switcherKind={isAuthenticated ? role?.kind : undefined}
          onNavigate={closeMenu}
          onSignOut={() => logout()}
        />
      }
      header={
        <TopBar
          onMenu={() => setOpen(true)}
          left={role?.scope ? <ScopeLabel {...role.scope} /> : <ScopeLabel label="Role" name={role?.label ?? brand.productName} />}
          right={
            <>
              {role?.kind === "club-admin" && <ClubTopbarStatus clubId={club?.id ?? null} />}
              {role?.kind === "district-admin" && <DistrictAdminTopbarStatus districtId={district?.id ?? null} />}
              <TopBarAccount backLinks />
            </>
          }
        />
      }
    >
      {children}
    </ShellFrame>
  );
}
