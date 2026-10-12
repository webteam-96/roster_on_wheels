import type { NavItem } from "@/components/dashboard/DashboardShell";

// URLs intentionally match the screenshot filename slugs (e.g. e-governance,
// my-club-website, membership-dues) — Phase A renames per user instruction.
// moduleKey values map to module_master.ModuleKey. Hidden when the module is
// flagged Coming Soon (non-SuperAdmin). "Dashboard" stays visible regardless —
// it's an internal aggregation across multiple modules, not a single module.
export const CLUB_ADMIN_NAV: NavItem[] = [
  // NOTE: `to` points at the dashboard root (which redirects to /overview)
  // rather than /dashboard/overview directly, so the active-highlight prefix
  // match (`pathname.startsWith(to + "/")`) catches all sibling sub-tabs
  // (/overview, /directory, /board-of-directors, /marketplace, /rotary-network)
  // instead of only /overview/. Clicking the link still lands on /overview
  // via the redirect page at app/club-admin-dashboard/dashboard/page.tsx.
  { to: "/club-admin-dashboard/dashboard",                           label: "Dashboard" },
  { to: "/club-admin-dashboard/foundation",                          label: "Foundation",                       moduleKey: "trf_contribution" },
  { to: "/club-admin-dashboard/membership",                          label: "Membership",                       moduleKey: "directory" },
  { to: "/club-admin-dashboard/service-projects-and-public-image",   label: "Service Projects & Public Image",  moduleKey: "community_service" },
  { to: "/club-admin-dashboard/e-governance",                        label: "E-Governance",                     moduleKey: "reports" },
  { to: "/club-admin-dashboard/goal-setting",                        label: "Goal Setting",                     moduleKey: "goal_setting" },
  { to: "/club-admin-dashboard/communication",                       label: "Communication",                    moduleKey: "announcements" },
  { to: "/club-admin-dashboard/my-club-website",                     label: "My Club Website",                  moduleKey: "website_data" },
  // Club Dues — enabled per user request (Phase 8). Access enforced at
  // the page: Club Admin sees own club only, SuperAdmin creates from /settings.
  { to: "/club-admin-dashboard/membership-dues",                     label: "Club Dues",                  moduleKey: "membership_dues" },
  // District Dues — the club's district dues, paid on the club's behalf. Only shown to
  // office bearers (President / Secretary / Treasurer); the layout filters this out
  // for everyone else (officerOnly). Access is re-enforced server-side per endpoint.
  { to: "/club-admin-dashboard/club-dues",                           label: "District Dues",                        officerOnly: true },
  // Payment Links removed from sidebar per user request (still reachable via
  // /club-admin-dashboard/payment-links if anyone bookmarked it).
  // Wallet — self-service credit top-up (Razorpay). No moduleKey => always visible.
  { to: "/club-admin-dashboard/wallet",                              label: "Wallet" },
];

// Page titles per route. Top-level keys are the canonical paths; old paths kept
// here too for the transition period (they 308-redirect via stub pages but the
// LayoutClient may briefly see the old URL during navigation).
export const CLUB_ADMIN_PAGE_TITLES: Record<string, string> = {
  "/club-admin-dashboard":                                            "Club Dashboard",
  "/club-admin-dashboard/dashboard":                                   "Club Dashboard",
  "/club-admin-dashboard/dashboard/overview":                          "Club Dashboard",
  "/club-admin-dashboard/dashboard/directory":                         "Club Dashboard - Directory",
  "/club-admin-dashboard/dashboard/board-of-directors":                "Club Dashboard - Board of Directors",
  "/club-admin-dashboard/dashboard/past-presidents":                   "Club Dashboard - Past Presidents",
  "/club-admin-dashboard/dashboard/marketplace":                       "Club Dashboard - Marketplace",
  "/club-admin-dashboard/dashboard/rotary-network":                    "Club Dashboard - Rotary Network",
  "/club-admin-dashboard/foundation":                                  "Foundation - The Rotary Foundation",
  "/club-admin-dashboard/membership":                                  "Membership",
  "/club-admin-dashboard/service-projects-and-public-image":           "Service Projects & Public Image",
  "/club-admin-dashboard/e-governance":                                "E-Governance & Reporting",
  "/club-admin-dashboard/goal-setting":                                "Goal Setting",
  "/club-admin-dashboard/communication":                               "Communication",
  "/club-admin-dashboard/my-club-website":                             "My Club Website",
  "/club-admin-dashboard/membership-dues":                             "Club Dues",
  "/club-admin-dashboard/club-dues":                                   "District Dues",
  "/club-admin-dashboard/payment-links":                               "Payment Links",
  // Legacy paths retained so a briefly-stale pathname still resolves a title.
  "/club-admin-dashboard/overview":                                    "Club Dashboard",
  "/club-admin-dashboard/avenue":                                      "Service Projects & Public Image",
  "/club-admin-dashboard/egovernance":                                 "E-Governance & Reporting",
  "/club-admin-dashboard/website":                                     "My Club Website",
  "/club-admin-dashboard/payments":                                    "Club Dues",
  "/club-admin-dashboard/wallet":                                      "Wallet & Credits",
};
