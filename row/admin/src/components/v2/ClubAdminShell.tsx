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
 *   The visual structure (sidebar, topbar, identity card, switcher, footer,
 *   coming-soon kill-switch, mobile overlay) is intentionally duplicated from
 *   src/components/dashboard/DashboardShell.tsx — that file is frozen as the
 *   reference design. Keep the two visually in sync by hand if the design
 *   changes; do NOT factor a shared base out.
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

import { ReactNode, Suspense, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, LogOut } from "lucide-react";
import HelplineBar from "@/components/v2/HelplineBar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth, useSelectedClub, useClubAdminClubs } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardSwitcher from "@/components/dashboard/DashboardSwitcher";
import DashboardYearSelector from "@/components/dashboard/DashboardYearSelector";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import ComingSoonStub from "@/components/dashboard/ComingSoonStub";
import ScopePicker from "@/components/dashboard/ScopePicker";
import { useComingSoonModules } from "@/hooks/useComingSoonModules";
import { CLUB_ADMIN_NAV } from "@/app/club-admin-dashboard/nav";

const SIDEBAR_BG = "#0f172a";
const ACTIVE_BG = "#F7A81B";
const ACTIVE_TEXT = "#1e3a5f";

const BRAND = "Club Dashboard";
const IDENTITY_LABEL = "Signed in";
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
  children,
}: ClubAdminShellProps) {
  return (
    <DashboardGuard kind="club-admin">
      <ClubAdminShellInner
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        activeNavHref={activeNavHref}
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
  children,
}: ClubAdminShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { logout, user, selectScope } = useAuth();
  const selectedClub = useSelectedClub();
  const clubAdminClubs = useClubAdminClubs();
  const isSuperAdmin = user?.roles?.includes("SuperAdmin") ?? false;
  const { byKey: comingSoonByKey } = useComingSoonModules();

  const identityName = user?.name ?? "Club Admin";
  const initials = getInitials(identityName) || "CA";
  const nav = CLUB_ADMIN_NAV;

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

  // Active item: explicit prop wins; otherwise fall back to pathname rule.
  const isItemActive = (to: string): boolean => {
    if (activeNavHref) return to === activeNavHref;
    return pathname === to || (pathname?.startsWith(to + "/") ?? false);
  };

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

  // See DashboardShell.tsx — must be a JSX value, NOT an inline function
  // component, or parent re-renders unmount + remount the DashboardSwitcher
  // (resetting its `open` state to false on every render — the actual cause
  // of "dropdown closes immediately").
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <Image
          src="/images/rotary-white-live.png"
          alt="Rotary"
          width={140}
          height={40}
          className="h-10 w-auto object-contain"
          priority
        />
        <p className="text-xs text-slate-400 mt-2 font-medium">{BRAND}</p>
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
            <p className="text-slate-400 text-xs truncate">{IDENTITY_ROLE}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2 px-1 tracking-wide uppercase">
          {IDENTITY_LABEL}
        </p>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-2">
          Navigation
        </p>
        <nav className="flex flex-col gap-0.5">
          {visibleNav.map(({ to, label }) => {
            const isActive = isItemActive(to);
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
                {/* Variant fixed to "dot" — matches the Club Admin layout's
                    existing call site, which is the only kind of caller for
                    this shell. */}
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: isActive ? ACTIVE_TEXT : "#475569" }}
                />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-white/10 mx-3" />

      {/* Footer + switcher + logout */}
      <div className="px-3 py-3 space-y-2">
        <DashboardSwitcher currentKind="club-admin" onNavigate={() => setOpen(false)} />
        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
        <p className="text-slate-500 text-[11px] text-center tracking-widest uppercase">
          {/* Reads ?yearId= from the URL so the footer follows whatever year the
              topbar selector is currently showing on this V2 page. */}
          <Suspense fallback={<>Rotary Year —</>}>
            <DashboardYearFooterText />
          </Suspense>
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
        {/* Support helpline strip — pinned above the header on every Club Admin page. */}
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
            <div className="min-w-0">
              <p className="text-slate-800 font-semibold text-base leading-tight truncate">
                {pageTitle}
              </p>
              {pageSubtitle && (
                <p className="text-slate-400 text-xs mt-0.5 truncate">{pageSubtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Global year selector — same component the /club-admin-dashboard
                topbar uses, so a year change here writes ?yearId= to the URL
                and every listing on this V2 page refetches through it. */}
            <Suspense fallback={null}>
              <DashboardYearSelector />
            </Suspense>
            {/* Wave 9C: current-club indicator / quick switcher. Shown only when
                the user actually has a club-scoped Admin assignment (clubAdminClubs).
                SuperAdmins drilling into a club fall back to selectedClub via
                accessibleClubs single-item branch. */}
            {selectedClub && clubAdminClubs.length > 0 && !clubAdminClubs.some((c) => c.id === selectedClub.id) ? (
              // Club opened from outside the user's own Club Admin clubs (e.g. SuperAdmin global
              // search). ScopePicker would fall back to their first own club — show the real one.
              <span className="hidden sm:flex items-center gap-1.5 text-sm text-slate-500 max-w-[320px] truncate">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">Club</span>
                <span className="font-bold text-base text-blue-700 truncate">{selectedClub.name}</span>
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
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {currentIsComingSoon && currentItem ? (
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
