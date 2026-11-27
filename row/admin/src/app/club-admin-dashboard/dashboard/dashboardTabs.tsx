"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Glide from "@/components/motion/Glide";
import { cn } from "@/lib/utils";

interface DashboardTab {
  href: string;
  label: string;
}

const DASHBOARD_TABS: DashboardTab[] = [
  { href: "/club-admin-dashboard/dashboard/overview",            label: "Overview" },
  { href: "/club-admin-dashboard/dashboard/directory",           label: "Directory" },
  { href: "/club-admin-dashboard/dashboard/board-of-directors",  label: "Board of Directors" },
  { href: "/club-admin-dashboard/dashboard/past-presidents",     label: "Past Presidents" },
  { href: "/club-admin-dashboard/dashboard/anniversaries",       label: "Anniversaries" },
  { href: "/club-admin-dashboard/dashboard/profile-updates",     label: "Profile Updates" },
  { href: "/club-admin-dashboard/dashboard/rollover",            label: "Year-end Rollover" },
  // Rotary Network moved into the E-Governance tab strip (after District Awards).
];


export default function DashboardTabs() {
  const pathname = usePathname() || "";

  return (
    <div className="overflow-x-auto mb-5">
      <div className="relative inline-flex items-center rounded-lg bg-muted p-1">
        <Glide className="rounded bg-card ring-1 ring-[color:var(--row-line)]" />
        {DASHBOARD_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative inline-flex h-8 items-center px-3.5 text-sm font-semibold rounded whitespace-nowrap transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
