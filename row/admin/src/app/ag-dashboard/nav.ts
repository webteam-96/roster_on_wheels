import {
  LayoutDashboard,
  TrendingUp,
  Briefcase,
  BarChart3,
  FileText,
} from "lucide-react";
import type { NavItem } from "@/components/dashboard/DashboardShell";

// moduleKey values map to module_master.ModuleKey rows. When a module is set
// to Coming Soon, the matching sidebar entry is hidden (non-SuperAdmin) and
// visiting its URL directly shows a ComingSoonStub.
// "My Clubs" / "District View" have no module key — they are AG-only aggregated
// views, so they remain visible regardless of module flags.
export const AG_NAV: NavItem[] = [
  { to: "/ag-dashboard/clubs",      label: "My Clubs",          icon: LayoutDashboard },
  { to: "/ag-dashboard/membership", label: "Membership",        icon: TrendingUp,      moduleKey: "directory" },
  // Hidden from the AG sidebar on request: "Foundation & TRF" (/ag-dashboard/trf),
  // "Goals" (/ag-dashboard/excellence) and "Youth Services" (/ag-dashboard/youth).
  // Pages and endpoints are left intact — only the nav entries are removed.
  //   = non-breaking spaces. The ONLY normal space is after "&", so when the label
  // wraps it always breaks there: "Service Projects &" / "Public Image".
  { to: "/ag-dashboard/projects",   label: "Service Projects & Public Image", icon: Briefcase, moduleKey: "community_service" },
  { to: "/ag-dashboard/district",   label: "District View",     icon: BarChart3 },
  // Replica of the District Admin report, scoped to this AG's clubs + selected year.
  { to: "/ag-dashboard/reports",    label: "Reports",           icon: FileText },
];

export const AG_PAGE_TITLES: Record<string, string> = {
  "/ag-dashboard":            "My Clubs",
  "/ag-dashboard/clubs":      "My Clubs",
  "/ag-dashboard/membership": "Membership",
  "/ag-dashboard/trf":        "TRF & Foundation",
  "/ag-dashboard/excellence": "Club Excellence",
  "/ag-dashboard/youth":      "Youth Services",
  "/ag-dashboard/projects":   "Service Projects & Public Image",
  "/ag-dashboard/district":   "District View",
  "/ag-dashboard/reports":    "Reports",
};
