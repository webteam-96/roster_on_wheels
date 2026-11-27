"use client";

/**
 * DistrictAdminShell — V2 wrapper that gives any V2 page the same sidebar +
 * topbar chrome as the District Admin dashboard.
 *
 * Mirror of ClubAdminShell, adapted for District Admin context. V2 pages live
 * at URLs like /districts/[id]/.../v2/... — not under /district-admin-dashboard/*.
 * The original DashboardShell derives the active sidebar item and the page
 * title from `usePathname()`, which would never match a V2 URL. This shell
 * takes both as explicit props so V2 pages can declare them.
 *
 *   The sidebar, drawer and frame are the shared Sidebar and ShellFrame, so every
 *   dashboard and V2 page looks and moves the same.
 *
 *   DashboardGuard is re-used here (orthogonal auth infrastructure). No
 *   district-admin dashboard cache provider is included — V2 pages do not
 *   consume that cache. Same reasoning as ClubAdminShell which removed the
 *   ClubAdminDashboardCacheProvider for performance.
 *
 * Active-highlight rules:
 *   - If `activeNavHref` is passed, the matching nav.to is the active item
 *     (exact equality). Use this from V2 pages.
 *   - Otherwise the original DashboardShell rule applies:
 *       pathname === to || pathname.startsWith(to + "/")
 *     This is the fallback for any future caller that still wants pathname-
 *     based highlighting.
 *
 * Usage:
 *   <DistrictAdminShell
 *     pageTitle="Set Membership Goal"
 *     pageSubtitle="Define this RY's district membership target"
 *     activeNavHref="/district-admin-dashboard/membership"
 *   >
 *     {bodyJsx}
 *   </DistrictAdminShell>
 */

import { ReactNode, useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import {
  useAuth,
  useSelectedDistrict,
  useDistrictAdminDistricts,
} from "@/contexts/AuthContext";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import Sidebar from "@/components/dashboard/Sidebar";
import ShellFrame from "@/components/dashboard/ShellFrame";
import TopBar, { ScopeLabel } from "@/components/dashboard/TopBar";
import TopBarAccount from "@/components/dashboard/TopBarAccount";
import ComingSoonStub from "@/components/dashboard/ComingSoonStub";
import ScopePicker from "@/components/dashboard/ScopePicker";
import DistrictAdminTopbarStatus from "@/components/dashboard/DistrictAdminTopbarStatus";
import { useBrand } from "@/contexts/BrandContext";
import { isFeatureOn } from "@/lib/brand";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { DISTRICT_ADMIN_NAV } from "@/app/district-admin-dashboard/nav";

const BRAND = "District Dashboard";
const IDENTITY_ROLE = "District Admin";
const FOOTER_TEXT = "Rotary Year 2026-27";

export interface DistrictAdminShellProps {
  /** Page title shown in the topbar. V2 pages know their own title; pathname
   *  lookup wouldn't find a match for V2 paths. */
  pageTitle: string;
  /** Optional secondary line under the page title. */
  pageSubtitle?: string;
  /** When set, the sidebar item whose `to` exactly equals this value is the
   *  active one. Use this from V2 pages whose URLs are NOT under
   *  /district-admin-dashboard/*. Omit on regular dashboard pages to fall back
   *  to the original pathname-prefix rule. */
  activeNavHref?: string;
  children: ReactNode;
}

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export default function DistrictAdminShell({
  pageTitle,
  pageSubtitle,
  activeNavHref,
  children,
}: DistrictAdminShellProps) {
  return (
    <DashboardGuard kind="district-admin">
      <DistrictAdminShellInner
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        activeNavHref={activeNavHref}
      >
        {children}
      </DistrictAdminShellInner>
    </DashboardGuard>
  );
}

function DistrictAdminShellInner({
  pageTitle,
  pageSubtitle,
  activeNavHref,
  children,
}: DistrictAdminShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { logout, user, selectScope } = useAuth();
  const selectedDistrict = useSelectedDistrict();
  const districtAdminDistricts = useDistrictAdminDistricts();
  const isSuperAdmin = user?.roles?.includes("SuperAdmin") ?? false;
  const { byKey: comingSoonByKey } = useComingSoonModules();

  const identityName = user?.name ?? "District Admin";
  const initials = getInitials(identityName) || "DA";
  const brandInfo = useBrand();
  const nav = DISTRICT_ADMIN_NAV.filter((n) => !n.feature || isFeatureOn(brandInfo, n.feature));

  // SuperAdmin sees everything regardless of Coming Soon flags. Goal Setting is for
  // Rotary.org-synced districts only — hidden for a non-sync district (non-SuperAdmin).
  const districtSynced = selectedDistrict?.isSynced ?? false;
  void districtSynced; // (Goal Setting no longer gated on sync — always visible now.)
  const visibleNav = isSuperAdmin
    ? nav
    : nav.filter((n) => {
        if (n.superAdminOnly) return false;
        // Goal Setting is now ALWAYS visible to every district admin (no sync / coming-soon gate).
        if (n.moduleKey === "goal_setting") return true;
        return !n.moduleKey || !comingSoonByKey[n.moduleKey]?.isComingSoon;
      });

  // Coming-soon kill-switch for the CURRENT route. Only meaningful when the
  // user landed on a real /district-admin-dashboard/* URL; for V2 pages
  // (activeNavHref provided) we resolve the "current" item from the explicit
  // prop instead so the same kill-switch covers V2 deep links.
  const currentItem = activeNavHref
    ? nav.find((n) => n.to === activeNavHref)
    : nav.find(
        (n) => pathname === n.to || pathname?.startsWith(n.to + "/")
      );
  const currentIsComingSoon =
    !isSuperAdmin &&
    !!currentItem?.moduleKey &&
    !!comingSoonByKey[currentItem.moduleKey]?.isComingSoon;
  const currentComingSoonDate = currentIsComingSoon && currentItem?.moduleKey
    ? comingSoonByKey[currentItem.moduleKey]?.comingSoonDate ?? null
    : null;

  const sidebar = (
    <Sidebar
      brand={BRAND}
      identityName={identityName}
      identityRole={IDENTITY_ROLE}
      initials={initials}
      nav={visibleNav}
      pathname={pathname}
      activeHref={activeNavHref}
      footerText={FOOTER_TEXT}
      switcherKind="district-admin"
      onNavigate={closeMenu}
      onSignOut={() => logout()}
    />
  );

  return (
    <ShellFrame
      sidebar={sidebar}
      open={open}
      onClose={closeMenu}
      title={pageTitle}
      subtitle={pageSubtitle}
      header={
        <TopBar
          onMenu={() => setOpen(true)}
          left={
            // A district opened from outside the user's own districts is shown read-only (see ClubAdminShell).
            districtAdminDistricts.length > 0 && (!selectedDistrict || districtAdminDistricts.some((d) => d.id === selectedDistrict.id)) ? (
              <ScopePicker
                label="District"
                items={districtAdminDistricts.map((d) => ({ id: d.id, name: d.number }))}
                selectedId={selectedDistrict?.id ?? null}
                onSelect={(id) => selectScope({ districtId: id })}
              />
            ) : selectedDistrict ? (
              <ScopeLabel label="District" name={selectedDistrict.number} />
            ) : null
          }
          right={
            <>
              <DistrictAdminTopbarStatus districtId={selectedDistrict?.id ?? null} />
              <TopBarAccount />
            </>
          }
        />
      }
    >
          {currentIsComingSoon && currentItem ? (
            <ComingSoonStub
              moduleName={currentItem.label}
              comingSoonDate={currentComingSoonDate}
            />
          ) : (
            children
          )}
    </ShellFrame>
  );
}
