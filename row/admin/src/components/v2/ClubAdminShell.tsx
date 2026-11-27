"use client";

/**
 * ClubAdminShell — V2 wrapper that gives any V2 page the same sidebar +
 * topbar chrome as the Club Admin dashboard.
 *
 * Why a duplicate of DashboardShell?
 *   V2 pages live at URLs like /clubs/[id]/board-of-directors/v2/add — not
 *   under /club-admin-dashboard/*. The original DashboardShell derives the
 *   active sidebar item and the page title from `usePathname()`, which would
 *   never match a V2 URL. This shell takes both as explicit props so V2 pages
 *   can declare them.
 *
 *   The sidebar, drawer and frame are the shared Sidebar and ShellFrame, so every
 *   dashboard and V2 page looks and moves the same.
 *
 *   DashboardGuard is re-used here (orthogonal auth infrastructure). The
 *   ClubAdminDashboardCacheProvider is deliberately NOT included — V2 pages
 *   do not consume that cache (verified: only the 9 /club-admin-dashboard/*
 *   pages call useClubAdminCache). Wrapping it here would fire 9 prefetch
 *   API calls on every V2 page mount for data nothing reads, which exhausts
 *   the MySQL connection pool during navigation. Dashboard pages keep their
 *   provider via the /club-admin-dashboard layout — unaffected.
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
 *   <ClubAdminShell
 *     pageTitle="Add Board Member"
 *     pageSubtitle="Create a new BOD entry"
 *     activeNavHref="/club-admin-dashboard/dashboard"
 *   >
 *     {bodyJsx}
 *   </ClubAdminShell>
 */

import { ReactNode, Suspense, useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth, useSelectedClub, useClubAdminClubs } from "@/contexts/AuthContext";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardYearSelector from "@/components/dashboard/DashboardYearSelector";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import Sidebar from "@/components/dashboard/Sidebar";
import ShellFrame from "@/components/dashboard/ShellFrame";
import TopBar, { ScopeLabel } from "@/components/dashboard/TopBar";
import ClubTopbarStatus from "@/components/dashboard/ClubTopbarStatus";
import TopBarAccount from "@/components/dashboard/TopBarAccount";
import ComingSoonStub from "@/components/dashboard/ComingSoonStub";
import ScopePicker from "@/components/dashboard/ScopePicker";
import { useBrand } from "@/contexts/BrandContext";
import { isFeatureOn } from "@/lib/brand";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { CLUB_ADMIN_NAV } from "@/app/club-admin-dashboard/nav";

const BRAND = "Club Dashboard";
const IDENTITY_ROLE = "Club Admin";

export interface ClubAdminShellProps {
  /** Page title shown in the topbar. V2 pages know their own title; pathname
   *  lookup wouldn't find a match for V2 paths. */
  pageTitle: string;
  /** Optional secondary line under the page title. */
  pageSubtitle?: string;
  /** When set, the sidebar item whose `to` exactly equals this value is the
   *  active one. Use this from V2 pages whose URLs are NOT under
   *  /club-admin-dashboard/*. Omit on regular dashboard pages to fall back to
   *  the original pathname-prefix rule. */
  activeNavHref?: string;
  /** Hide the global year selector - for pages that show ONE record whose year is fixed (e.g. one
   *  dues' member list): a year picked there would change nothing (user 2026-11-10). */
  hideYearSelector?: boolean;
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

export default function ClubAdminShell({
  pageTitle,
  pageSubtitle,
  activeNavHref,
  hideYearSelector,
  children,
}: ClubAdminShellProps) {
  return (
    <DashboardGuard kind="club-admin">
      <ClubAdminShellInner
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        activeNavHref={activeNavHref}
        hideYearSelector={hideYearSelector}
      >
        {children}
      </ClubAdminShellInner>
    </DashboardGuard>
  );
}

function ClubAdminShellInner({
  pageTitle,
  pageSubtitle,
  activeNavHref,
  hideYearSelector,
  children,
}: ClubAdminShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { logout, user, selectScope } = useAuth();
  const selectedClub = useSelectedClub();
  const clubAdminClubs = useClubAdminClubs();
  const isSuperAdmin = user?.roles?.includes("SuperAdmin") ?? false;
  const { byKey: comingSoonByKey } = useComingSoonModules();

  const identityName = user?.name ?? "Club Admin";
  const initials = getInitials(identityName) || "CA";
  const brandInfo = useBrand();
  const nav = CLUB_ADMIN_NAV.filter((n) => !n.feature || isFeatureOn(brandInfo, n.feature));

  // SuperAdmin sees everything regardless of Coming Soon flags. Goal Setting is for
  // Rotary.org-synced clubs only — hidden for a non-sync club (non-SuperAdmin).
  const clubSynced = selectedClub?.isSynced ?? false;
  void clubSynced; // (Goal Setting no longer gated on sync — always visible now.)
  const visibleNav = isSuperAdmin
    ? nav
    : nav.filter((n) => {
        if (n.superAdminOnly) return false;
        // Goal Setting is now ALWAYS visible to every club admin (no sync / coming-soon gate).
        if (n.moduleKey === "goal_setting") return true;
        return !n.moduleKey || !comingSoonByKey[n.moduleKey]?.isComingSoon;
      });

  // Coming-soon kill-switch for the CURRENT route. Only meaningful when the
  // user landed on a real /club-admin-dashboard/* URL; for V2 pages
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
      footerText={<Suspense fallback={<>Rotary Year , </>}><DashboardYearFooterText /></Suspense>}
      switcherKind="club-admin"
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
            // A club opened from outside the user's own clubs (SuperAdmin global search) is shown read-only:
            // the picker would fall back to their first own club.
            clubAdminClubs.length > 0 && (!selectedClub || clubAdminClubs.some((c) => c.id === selectedClub.id)) ? (
              <ScopePicker label="Club" items={clubAdminClubs} selectedId={selectedClub?.id ?? null} onSelect={(id) => selectScope({ clubId: id })} />
            ) : selectedClub ? (
              <ScopeLabel label="Club" name={selectedClub.name} />
            ) : null
          }
          right={
            <>
              <ClubTopbarStatus clubId={selectedClub?.id ?? null} />
              {/* Writes ?yearId= to the URL; every listing on the page refetches through it. */}
              {!hideYearSelector && (
                <Suspense fallback={null}>
                  <DashboardYearSelector />
                </Suspense>
              )}
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
