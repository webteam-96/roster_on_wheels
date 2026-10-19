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

const ACTIVE_BG = "#F7A81B";
const ACTIVE_TEXT = "#17458f";

// Visual mirrors the AvenueTabBar in
// /club-admin-dashboard/service-projects-and-public-image — same navy container,
// gold-on-navy active pill, white inactive text.
export default function DashboardTabs() {
  const pathname = usePathname() || "";

  return (
    <div className="overflow-x-auto mb-5">
      <div
        className="inline-flex items-center gap-1 rounded-xl p-1.5"
        style={{ backgroundColor: "#17458f" }}
      >
        {DASHBOARD_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition",
                isActive ? "shadow-sm" : "text-white hover:bg-white/10"
              )}
              style={isActive ? { backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT } : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
