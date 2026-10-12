import type { NavItem } from "@/components/dashboard/DashboardShell";

// Club Moderator is a single-purpose role — one section: Project Approvals.
// No moduleKey => always visible.
export const CLUB_MODERATOR_NAV: NavItem[] = [
  { to: "/club-moderator/v2", label: "Project Approvals" },
];

export const CLUB_MODERATOR_PAGE_TITLES: Record<string, string> = {
  "/club-moderator/v2": "Project Approvals",
};
