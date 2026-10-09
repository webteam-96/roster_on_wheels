"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import DashboardGuard from "@/components/dashboard/DashboardGuard";
import DashboardShell from "@/components/dashboard/DashboardShell";
import DashboardYearFooterText from "@/components/dashboard/DashboardYearFooterText";
import { useAuth } from "@/contexts/AuthContext";
import { CLUB_MODERATOR_NAV, CLUB_MODERATOR_PAGE_TITLES } from "./nav";

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export default function ClubModeratorV2LayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/club-moderator/v2";
  const { user } = useAuth();
  const name = user?.name ?? "Club Moderator";
  const initials = getInitials(name);
  const title = CLUB_MODERATOR_PAGE_TITLES[pathname] ?? "Club Moderator";

  return (
    <DashboardGuard kind="club-moderator">
      <DashboardShell
        brand="Club Moderator"
        identityLabel="Signed in"
        identityName={name}
        identityRole="Club Moderator"
        initials={initials || "CM"}
        nav={CLUB_MODERATOR_NAV}
        footerText={<DashboardYearFooterText />}
        pageTitle={title}
        variant="icon"
        switcherKind="club-moderator"
      >
        {children}
      </DashboardShell>
    </DashboardGuard>
  );
}
