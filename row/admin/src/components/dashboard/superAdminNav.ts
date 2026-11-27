import {
  Building2, ClipboardList, Coins, CreditCard, FileBarChart, Globe, History, Layers, LayoutGrid, Mail, MapPin, Monitor, Search, Settings, ShieldCheck, UserCheck, Wallet,
} from "@/components/icons";
import type { NavItem } from "./DashboardShell";

// The Super Admin sidebar: the daily pages. Everything else is one click away in "All settings".
export const SUPER_ADMIN_NAV: NavItem[] = [
  { to: "/settings/global-search", label: "Global Search", icon: Search },
  { to: "/settings/global-member-search", label: "Member Search", icon: UserCheck },
  { to: "/admin", label: "Zones", icon: Layers, group: "Organisation" },
  { to: "/districts", label: "Districts", icon: MapPin, group: "Organisation" },
  { to: "/clubs", label: "Clubs", icon: Building2, group: "Organisation" },
  { to: "/settings/club-websites", label: "Club Websites", icon: Globe, group: "Websites" },
  { to: "/settings/district-websites", label: "District Websites", icon: Monitor, group: "Websites" },
  { to: "/settings/subscriptions", label: "Subscriptions", icon: CreditCard, group: "Money" },
  { to: "/settings/wallet", label: "Wallet", icon: Wallet, group: "Money" },
  { to: "/settings/currency", label: "Currency", icon: Coins, group: "Money" },
  { to: "/settings/reports", label: "Reports", icon: FileBarChart, group: "Logs and reports" },
  { to: "/settings/email-log", label: "Email Log", icon: Mail, group: "Logs and reports" },
  { to: "/settings/audit-log", label: "Audit Log", icon: History, group: "Logs and reports" },
  { to: "/admin/login-logs", label: "Login Logs", icon: ClipboardList, group: "Logs and reports" },
  { to: "/admin/modules", label: "Modules", icon: LayoutGrid, group: "Setup" },
  { to: "/settings/features", label: "Features", icon: ShieldCheck, group: "Setup" },
  { to: "/settings", label: "All settings", icon: Settings, group: "Setup" },
];
