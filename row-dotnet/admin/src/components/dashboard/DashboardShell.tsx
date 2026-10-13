"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, LogOut, ArrowLeft, type LucideIcon } from "lucide-react";
import HelplineBar from "@/components/v2/HelplineBar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  useAuth,
  useSelectedClub,
  useClubAdminClubs,
  useSelectedDistrict,
  useDistrictAdminDistricts,
  useAgDistricts,
} from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import DashboardSwitcher from "./DashboardSwitcher";
import ComingSoonStub from "./ComingSoonStub";
import ScopePicker from "./ScopePicker";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { useBrand } from "@/contexts/BrandContext";
import { isFeatureOn } from "@/lib/brand";

export interface NavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
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
  /** Instance feature flag (lib/brand.ts FEATURE_DEFAULTS). When the flag is off the
   *  item is hidden for everyone, SuperAdmin included, and its URL shows a notice.
   *  Unlike moduleKey (per district/club), this is an instance-wide switch. */
  feature?: string;
}

export interface DashboardShellProps {
  brand: string;
  identityLabel: string;
  identityName: string;
  identityRole: string;
  initials: string;
  nav: NavItem[];
  footerText: ReactNode;
  pageTitle: string;
  pageSubtitle?: ReactNode;
  variant?: "icon" | "dot";
  switcherKind?: "ag" | "club-admin" | "district-admin" | "club-moderator";
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

const SIDEBAR_BG = "#0f172a";
const ACTIVE_BG = "#F7A81B";
const ACTIVE_TEXT = "#1e3a5f";

export default function DashboardShell({
  brand,
  identityLabel,
  identityName,
  identityRole,
  initials,
  nav,
  footerText,
  pageTitle,
  pageSubtitle,
  variant = "dot",
  switcherKind,
  topbarCenter,
  topbarStart,
  switcherTop,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { logout, user, selectScope, selectedClubId } = useAuth();
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
    window.location.assign(returnTo || "/settings/global-search");
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
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <Image
          src="/brand/row-logo-badge.png"
          alt="Roster On Wheels"
          width={140}
          height={40}
          className="h-10 w-auto object-contain"
          priority
        />
        <p className="text-xs text-slate-400 mt-2 font-medium">{brand}</p>
      </div>

      {/* Identity card */}
      <div className="px-3 py-3 border-b border-white/10">
        <div
          className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
          style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
        >
          <Avatar className="h-9 w-9 rounded-md flex-shrink-0">
            <AvatarFallback
              className="text-xs font-bold rounded-md"
              style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{identityName}</p>
            {/* Role label — normally the dashboard's own role (District Admin / Club Admin /
                AG), untouched for those logins. In the SuperAdmin global-search flow the SA is
                only borrowing this dashboard, so show their real role instead. */}
            <p className="text-slate-400 text-xs truncate">
              {fromSuperAdminSearch ? "Super Admin" : identityRole}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2 px-1 tracking-wide uppercase">
          {identityLabel}
        </p>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-2">
          Navigation
        </p>
        <nav className="flex flex-col gap-0.5">
          {visibleNav.map(({ to, label, icon: Icon }) => {
            const isActive = pathname === to || pathname?.startsWith(to + "/");
            return (
              <Link
                key={to}
                href={to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 mx-0.5 my-0.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                )}
                style={
                  isActive
                    ? { backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT }
                    : undefined
                }
              >
                {variant === "icon" && Icon ? (
                  <Icon size={17} className="flex-shrink-0" />
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: isActive ? ACTIVE_TEXT : "#475569" }}
                  />
                )}
                {/* Wrap rather than ellipsis: the only labels long enough to need it are
                    the 31-char "Service Projects & Public Image" entries, which were being
                    cut to "…Publi…". Everything else is <=19 chars and still fits one line.
                    Labels use non-breaking spaces to control WHERE the break lands. */}
                <span className="min-w-0 leading-tight">{label}</span>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-white/10 mx-3" />

      {/* Footer + switcher + logout.
          In the SuperAdmin global-search flow we hide BOTH the club list and the role/dashboard
          switcher — the SA is only borrowing this one club/district, so those lists are noise
          (and confusing). They return via the Back to Search button instead. Normal District /
          Club / AG logins are unaffected: fromSuperAdminSearch is false for them. */}
      <div className="px-3 py-3 space-y-2">
        {!fromSuperAdminSearch && switcherTop && (
          <div className="pb-3 mb-1 border-b border-white/10">{switcherTop}</div>
        )}
        {!fromSuperAdminSearch && switcherKind && (
          <DashboardSwitcher currentKind={switcherKind} onNavigate={() => setOpen(false)} />
        )}
        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
        <p className="text-slate-500 text-[11px] text-center tracking-widest uppercase">
          {footerText}
        </p>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex h-screen overflow-hidden bg-slate-50"
      style={{ top: 0, left: 0 }}
    >
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-60 flex-shrink-0"
        style={{ background: SIDEBAR_BG }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside
            className="relative flex flex-col w-60 z-10 shadow-2xl"
            style={{ background: SIDEBAR_BG }}
          >
            <button
              className="absolute top-3 right-3 text-slate-400 hover:text-white"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Support helpline strip — pinned above the header on every authenticated dashboard
            (Club Admin / District Admin / AG all render through this shell). */}
        <HelplineBar />

        <header
          className="bg-white border-b-2 px-6 h-14 flex items-center justify-between flex-shrink-0 gap-3"
          style={{ borderBottomColor: ACTIVE_BG }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            {/* Back — only for the SuperAdmin global-search flow. Deliberately loud: it's the
                SA's only way out of a borrowed dashboard, so it must not be missable. */}
            {fromSuperAdminSearch && (
              <button
                onClick={handleBack}
                title="Back to search"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold shadow-sm ring-1 ring-black/5 hover:brightness-95 active:brightness-90 transition-all flex-shrink-0"
                style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}
              >
                <ArrowLeft size={16} strokeWidth={2.5} />
                <span>Back to Search</span>
              </button>
            )}
            <div className="min-w-0">
              <p className="text-slate-800 font-semibold text-base leading-tight truncate">
                {pageTitle}
              </p>
              {pageSubtitle && (
                <p className="text-slate-400 text-xs mt-0.5 truncate">{pageSubtitle}</p>
              )}
            </div>
          </div>
          {/* Right-side cluster.
              Order per switcherKind:
                • club-admin:      Club picker → Year picker
                  (user request 2026-06-12 — "Club Name → Year")
                • district-admin:  District picker → Year picker
                  (user request 2026-07-09 — swap: district on left, year on right)
                • ag:              Year picker → District picker
                  (user request 2026-07-03 — "first rotary year then district")
              Hidden on mobile so the picker stays the prominent control. */}
          <div className="hidden md:flex items-center gap-3 flex-1 justify-end">
          {topbarStart}
          {switcherKind === "club-admin" ? (
            <>
              {viewingDaClub ? (
                // District Admin viewing a district-access club — show that club's name.
                <span className="hidden sm:block text-xs font-semibold text-slate-700 truncate max-w-[260px]">
                  {daActiveClub!.name}
                </span>
              ) : clubAdminClubs.length > 0 ? (
                <ScopePicker
                  label="Club"
                  items={clubAdminClubs}
                  selectedId={selectedClub?.id ?? null}
                  onSelect={(id) => selectScope({ clubId: id })}
                />
              ) : selectedClub ? (
                <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[260px]">
                  {selectedClub.name}
                </span>
              ) : null}
              {topbarCenter}
            </>
          ) : switcherKind === "district-admin" ? (
            <>
              {fromSuperAdminSearch && saActiveDistrict ? (
                // SuperAdmin borrowed THIS district from global search. Their own district
                // picker would show accessibleDistricts[0] (the SA's own district), so show
                // the borrowed one read-only instead.
                <span className="hidden sm:block text-xs font-semibold text-slate-700 truncate max-w-[260px]">
                  {saActiveDistrict.name}
                </span>
              ) : districtAdminDistricts.length > 0 ? (
                <ScopePicker
                  label="District"
                  items={districtAdminDistricts.map((d) => ({ id: d.id, name: d.number }))}
                  selectedId={selectedDistrict?.id ?? null}
                  onSelect={(id) => selectScope({ districtId: id })}
                />
              ) : selectedDistrict ? (
                <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[260px]">
                  {selectedDistrict.number}
                </span>
              ) : null}
              {topbarCenter}
            </>
          ) : switcherKind === "ag" ? (
            <>
              {topbarCenter}
              {agDistricts.length > 1 ? (
                // Only render when there is a real choice to make. A single-district AG
                // used to get a static district-number label here — noise, since they
                // can't act on it. Multi-district AGs still need the picker to scope data.
                <ScopePicker
                  label="District"
                  items={agDistricts.map((d) => ({ id: d.id, name: d.number }))}
                  selectedId={selectedDistrict?.id ?? null}
                  onSelect={(id) => selectScope({ districtId: id })}
                />
              ) : null}
            </>
          ) : (
            <>{topbarCenter}</>
          )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {currentItem?.feature && !isFeatureOn(brandInfo, currentItem.feature) ? (
            <div className="flex min-h-[60vh] items-center justify-center text-center">
              <div className="max-w-md rounded-2xl border bg-white p-8 shadow-sm">
                <h2 className="text-xl font-bold text-slate-800">{currentItem.label}</h2>
                <p className="mt-3 text-sm text-slate-600">This section is not available on {brandInfo.productName}.</p>
              </div>
            </div>
          ) : currentIsComingSoon && currentItem ? (
            <ComingSoonStub
              moduleName={currentItem.label}
              comingSoonDate={currentComingSoonDate}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
