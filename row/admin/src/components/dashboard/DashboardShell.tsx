"use client";

import { PageHeader } from "@/components/row/AppKit";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, type LucideIcon } from "@/components/icons";
import {
  useAuth,
  useSelectedClub,
  useClubAdminClubs,
  useSelectedDistrict,
  useDistrictAdminDistricts,
  useAgDistricts,
  decodeJwt,
} from "@/contexts/AuthContext";
import Sidebar from "./Sidebar";
import ShellFrame from "./ShellFrame";
import ComingSoonStub from "./ComingSoonStub";
import ScopePicker from "./ScopePicker";
import TopBar, { ScopeLabel } from "./TopBar";
import TopBarAccount from "./TopBarAccount";
import { Button } from "@/components/ui/button";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { useBrand } from "@/contexts/BrandContext";
import { isFeatureOn } from "@/lib/brand";
import { withBase } from "@/lib/basePath";
import { getClub } from "@/services/api";

export interface NavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  /** Sidebar heading; consecutive items with the same group share one. */
  group?: string;
  /** Optional module_master.moduleKey — when set and the module is Coming Soon
   *  (and the user is NOT SuperAdmin), the item is hidden from the sidebar and
   *  visiting its URL directly shows a ComingSoonStub instead of the page. */
  moduleKey?: string;
  /** If true, the item is ALWAYS shown in the sidebar (never filtered out) AND
   *  a small "Coming Soon" pill is rendered next to the label. Use this when the
   *  module should be surfaced as a teaser even though it's not yet wired. */
  comingSoon?: boolean;
  /** If true, the item is shown ONLY to SuperAdmin (hidden from district/club/other
   *  admins). Use for a module not yet ready for general rollout. */
  superAdminOnly?: boolean;
  /** If true, the item is only shown to club office bearers (President / Secretary /
   *  Treasurer). The consuming layout resolves officer status and filters these out
   *  for everyone else BEFORE passing `nav` to the shell. */
  officerOnly?: boolean;
  /** If true, the item is hidden unless the viewer administers the Rotary year
   *  currently SELECTED in the dashboard year picker.
   *
   *  ⚠️ Note for wallet: club_credits carries no year — there is ONE credit pool
   *  per club, with FromDate/ToDate validity. So this shows the section on an
   *  administered past year even though the credits it spends are the current
   *  ones. That is a deliberate product decision (2026-09-21), not an oversight. */
  adminYearOnly?: boolean;
  /** Instance feature flag (lib/brand.ts FEATURE_DEFAULTS). When the flag is off the
   *  item is hidden for everyone, SuperAdmin included, and its URL shows a notice.
   *  Unlike moduleKey (per district/club), this is an instance-wide switch. */
  feature?: string;
}

export interface DashboardShellProps {
  brand: string;
  identityName: string;
  identityRole: string;
  initials: string;
  nav: NavItem[];
  footerText: ReactNode;
  pageTitle: string;
  pageSubtitle?: ReactNode;
  switcherKind?: "ag" | "club-admin" | "district-admin";
  /** Optional element rendered between the page title (left) and the scope
   *  picker (right) in the topbar. Used by Club Admin Dashboard to host the
   *  global Rotary-year selector — kept generic so other dashboards can
   *  inject their own controls without diverging the shell. */
  topbarCenter?: ReactNode;
  /** Optional element rendered FIRST (left-most) in the right-aligned topbar
   *  group — before the scope picker. Used to host status chips (e.g. credits). */
  topbarStart?: ReactNode;
  /** Optional element rendered in the sidebar footer, directly ABOVE the
   *  dashboard switcher ("role list"). Used by the District Admin dashboard to
   *  host its club switcher. */
  switcherTop?: ReactNode;
  children: ReactNode;
}

export default function DashboardShell({
  brand,
  identityName,
  identityRole,
  initials,
  nav,
  footerText,
  pageTitle,
  pageSubtitle,
  switcherKind,
  topbarCenter,
  topbarStart,
  switcherTop,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { logout, user, selectScope, selectedClubId, token } = useAuth();
  // The JWT keeps SuperAdmin even when a borrowed scope strips it from user.roles.
  const isSuperAdminLogin = !!token && (decodeJwt(token)?.roles ?? []).includes("SuperAdmin");
  const isSuperAdmin = user?.roles?.includes("SuperAdmin") ?? false;
  const { byKey: comingSoonByKey } = useComingSoonModules();

  // Wave 9C: scope-aware topbar indicator. Picks the right list per dashboard.
  const selectedClub = useSelectedClub();
  const clubAdminClubs = useClubAdminClubs();

  // District-Admin-opened club (id + name), remembered by the club switcher.
  // A district-access club isn't in accessibleClubs, so without this the topbar
  // would fall back to the DA's own admin club name. Read once on mount (the
  // switcher hard-reloads, so a fresh read is always current).
  const [daActiveClub, setDaActiveClub] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("da_active_club");
      setDaActiveClub(raw ? JSON.parse(raw) : null);
    } catch { setDaActiveClub(null); }
  }, []);
  // True when the DA is currently viewing a district-access club (not one of
  // their own real club-admin clubs).
  const viewingDaClub =
    !!daActiveClub &&
    daActiveClub.id === selectedClubId &&
    !clubAdminClubs.some((c) => c.id === selectedClubId);

  // A /clubs/{id}/... page opened by link names its own club; the header showed the session's selected club
  // instead (QA 2026-11-23: "Thane City View" on ROW Test Club pages). Look the URL's club up when they differ.
  const urlClubId = Number(/^\/clubs\/(\d+)(\/|$)/.exec(pathname ?? "")?.[1]) || null;
  const [urlClub, setUrlClub] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    if (!urlClubId || urlClubId === selectedClubId) { setUrlClub(null); return; }
    let cancelled = false;
    getClub(urlClubId).then((c) => { if (!cancelled) setUrlClub({ id: urlClubId, name: c.clubName }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [urlClubId, selectedClubId]);

  // Set when this club dashboard was opened from somewhere that wants a way back
  // (currently SuperAdmin's /settings/global-search "New Dashboard"). Only then do
  // we show a Back button — the normal club/district/AG flows never set it.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  // The district a SuperAdmin borrowed from global search (id + number/name). Needed because
  // useSelectedDistrict() falls back to accessibleDistricts[0] — i.e. the SA's OWN district —
  // for a district they don't belong to, which showed the wrong number in the topbar.
  const [saActiveDistrict, setSaActiveDistrict] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    try { setReturnTo(sessionStorage.getItem("club_dash_return_to")); } catch { setReturnTo(null); }
    try {
      const raw = localStorage.getItem("sa_active_district");
      setSaActiveDistrict(raw ? JSON.parse(raw) : null);
    } catch { setSaActiveDistrict(null); }
  }, []);

  // TRUE only for the SuperAdmin "New Dashboard" flow launched from /settings/global-search.
  // A normal District / Club / AG login NEVER sets club_dash_return_to, so everything gated on
  // this flag is invisible to them — their dashboards behave exactly as before.
  const fromSuperAdminSearch = !!returnTo && isSuperAdmin;
  const handleBack = () => {
    try {
      sessionStorage.removeItem("club_dash_return_to");
      localStorage.removeItem("da_active_club");
      localStorage.removeItem("sa_active_district");
    } catch { /* ignore */ }
    // Drop the borrowed scope (club AND district) so it doesn't linger on the SA's session.
    selectScope({ clubId: null, districtId: null });
    window.location.assign(withBase(returnTo || "/settings/global-search")); // OMS ROW-49: a raw path skipped the /admin base path and hit a 404
  };
  const selectedDistrict = useSelectedDistrict();
  const districtAdminDistricts = useDistrictAdminDistricts();
  // Wave 9G: AG district picker — list of distinct districts where the user is AG.
  const agDistricts = useAgDistricts();

  // SuperAdmin sees everything regardless of Coming Soon flags — matches the
  // existing pattern on the old club dashboard.
  const brandInfo = useBrand();
  const instanceNav = nav.filter((n) => !n.feature || isFeatureOn(brandInfo, n.feature));
  const visibleNav = isSuperAdmin
    ? instanceNav
    : instanceNav.filter((n) => !n.superAdminOnly && (!n.moduleKey || !comingSoonByKey[n.moduleKey]?.isComingSoon));

  // Does the CURRENT route map to a module that's Coming Soon? If so, render
  // the stub in place of the page content (covers users who hit a deep link
  // before we filtered the sidebar).
  const currentItem = nav.find(
    (n) => pathname === n.to || pathname?.startsWith(n.to + "/")
  );
  // Page is "Coming Soon" if EITHER:
  //   (a) the nav item is statically flagged `comingSoon: true` (always shown
  //       in sidebar with a Coming Soon pill — clicking it should land on the
  //       Coming Soon stub, not the actual page), OR
  //   (b) the nav item has a moduleKey and module_master flags it Coming Soon
  //       (and the user isn't SuperAdmin — SA always sees the real page so
  //       they can finish wiring it).
  const currentIsComingSoon =
    !!currentItem?.comingSoon ||
    (!isSuperAdmin &&
      !!currentItem?.moduleKey &&
      !!comingSoonByKey[currentItem.moduleKey]?.isComingSoon);
  const currentComingSoonDate = currentIsComingSoon && currentItem?.moduleKey
    ? comingSoonByKey[currentItem.moduleKey]?.comingSoonDate ?? null
    : null;

  // CRITICAL: do NOT define this as `const SidebarContent = () => (...)`.
  // Inline component definitions create a NEW function reference on every
  // render of DashboardShell, which React treats as a different component
  // type — unmounting + remounting the entire subtree (including the
  // DashboardSwitcher, whose `open` state would reset to false every time).
  // That was the real cause of "dropdown closes immediately": not a close
  // event, but a parent-re-render-triggered remount of the switcher.
  // Storing the JSX as a value (not a component) keeps the element type
  // stable across renders, so React reconciles instead of remounts.
  // A <Sidebar> ELEMENT stored as a value (stable module-level component type), so
  // React reconciles instead of remounting the DashboardSwitcher — see the note above.
  const sidebar = (
    <Sidebar
      brand={brand}
      identityName={identityName}
      identityRole={fromSuperAdminSearch ? "Super Admin" : identityRole}
      initials={initials}
      nav={visibleNav}
      pathname={pathname}
      footerText={footerText}
      switcherTop={switcherTop}
      switcherKind={switcherKind}
      fromSuperAdminSearch={fromSuperAdminSearch}
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
            switcherKind === "club-admin" ? (
              urlClub || viewingDaClub ? (
                <ScopeLabel label="Club" name={urlClub?.name ?? daActiveClub!.name} />
              ) : clubAdminClubs.length > 0 ? (
                <ScopePicker label="Club" items={clubAdminClubs} selectedId={selectedClub?.id ?? null} onSelect={(id) => selectScope({ clubId: id })} />
              ) : selectedClub ? (
                <ScopeLabel label="Club" name={selectedClub.name} />
              ) : null
            ) : switcherKind === "district-admin" ? (
              // A SuperAdmin's borrowed district is shown read-only: the picker would list their own.
              fromSuperAdminSearch && saActiveDistrict ? (
                <ScopeLabel label="District" name={saActiveDistrict.name} />
              ) : districtAdminDistricts.length > 0 ? (
                <ScopePicker
                  label="District"
                  items={districtAdminDistricts.map((d) => ({ id: d.id, name: d.number }))}
                  selectedId={selectedDistrict?.id ?? null}
                  onSelect={(id) => selectScope({ districtId: id })}
                />
              ) : selectedDistrict ? (
                <ScopeLabel label="District" name={selectedDistrict.number} />
              ) : null
            ) : switcherKind === "ag" && agDistricts.length > 1 ? (
              <ScopePicker
                label="District"
                items={agDistricts.map((d) => ({ id: d.id, name: d.number }))}
                selectedId={selectedDistrict?.id ?? null}
                onSelect={(id) => selectScope({ districtId: id })}
              />
            ) : null
          }
          right={
            <>
              <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
                {topbarStart}
                {topbarCenter}
              </div>
              {/* The way out of a dashboard borrowed from global search. */}
              {(fromSuperAdminSearch || isSuperAdminLogin) && (
                <Button type="button" variant="outline" size="sm" onClick={handleBack}>
                  <ArrowLeft /> Back to Search
                </Button>
              )}
              <TopBarAccount />
            </>
          }
        />
      }
    >
          {currentItem?.feature && !isFeatureOn(brandInfo, currentItem.feature) ? (
            <PageHeader title={currentItem.label} description={<>This section is not available on {brandInfo.productName}.</>} />
          ) : currentIsComingSoon && currentItem ? (
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
