"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  // Rotary Network moved into the E-Governance tab strip (after District Awards).
];


// Visual mirrors the AvenueTabBar in
// /club-admin-dashboard/service-projects-and-public-image — same navy container,
// gold-on-navy active pill, white inactive text.
export default function DashboardTabs() {
  const pathname = usePathname() || "";

  return (
    <div className="overflow-x-auto mb-5">
      {/* Same light pill track as the shared Tabs (design.md 8.6): no azure band. */}
      <div className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
        {DASHBOARD_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex h-9 items-center px-4 text-sm font-semibold rounded-full whitespace-nowrap transition-colors",
                isActive ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"
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
