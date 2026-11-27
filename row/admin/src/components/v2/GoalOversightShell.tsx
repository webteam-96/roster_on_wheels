"use client";

/**
 * GoalOversightShell — V2 sidebar + topbar chrome for the SuperAdmin Goal Overview
 * (/goal-overviews). Visually mirrors DistrictAdminShell
 * (dark sidebar, amber active pill, identity card, sign-out) but carries no district/club
 * machinery — the nav items are passed in by the page (its goal categories), and the goal
 * content renders inside. Auth is handled by the page's own ProtectedRoute.
 */

import { ReactNode, useCallback, useState } from "react";
import Sidebar from "@/components/dashboard/Sidebar";
import ShellFrame from "@/components/dashboard/ShellFrame";
import TopBar, { ScopeLabel } from "@/components/dashboard/TopBar";
import TopBarAccount from "@/components/dashboard/TopBarAccount";
import { useAuth } from "@/contexts/AuthContext";

export interface GoalOversightNavItem {
  label: string;
  href: string;
  active?: boolean;
}

function getInitials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export default function GoalOversightShell({
  pageTitle,
  pageSubtitle,
  roleLabel,
  nav,
  children,
  headerRight,
}: {
  pageTitle: string;
  pageSubtitle?: string;
  roleLabel?: string;                 // e.g. "Super Admin"
  nav: GoalOversightNavItem[];
  children: ReactNode;
  headerRight?: ReactNode;            // top-right header slot (e.g. the global Year picker)
}) {
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { logout, user } = useAuth();
  const identityName = user?.name ?? "Goal Setting";
  const initials = getInitials(identityName) || "GS";
  // Brand caption: "Goal Overview" for Super Admin (the Goal Overview page), "Goal Setting" otherwise.
  const brand = roleLabel === "Super Admin" ? "Goal Overview" : "Goal Setting";

  const sidebar = (
    <Sidebar
      brand={brand}
      identityName={identityName}
      identityRole={roleLabel || brand}
      initials={initials}
      nav={nav.map((item) => ({ label: item.label, to: item.href, group: "Categories", active: !!item.active }))}
      emptyText="No categories in your scope."
      footerText={`Rotary ${brand}`}
      switcherKind="goal-oversight"
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
        <TopBar onMenu={() => setOpen(true)} left={roleLabel && <ScopeLabel label="Role" name={roleLabel} />} right={<>{headerRight}<TopBarAccount /></>} />
      }
    >
      {children}
    </ShellFrame>
  );
}
