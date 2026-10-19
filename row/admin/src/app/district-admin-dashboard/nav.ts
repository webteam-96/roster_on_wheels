import type { NavItem } from "@/components/dashboard/DashboardShell";

// moduleKey values map to module_master.ModuleKey. Hidden when the module is
// flagged Coming Soon (non-SuperAdmin). Overview is always visible — it's an
// internal district-wide rollup, not a single module.
export const DISTRICT_ADMIN_NAV: NavItem[] = [
  { to: "/district-admin-dashboard/overview",      label: "Overview" },
  { to: "/district-admin-dashboard/membership",    label: "Membership",     moduleKey: "directory" },
  // Rotary Network moved into the E-Governance tab strip (after District Awards).
  { to: "/district-admin-dashboard/foundation",    label: "Projects / Events",     moduleKey: "trf_contribution" },
  { to: "/district-admin-dashboard/communication", label: "Communication",  moduleKey: "announcements" },
  { to: "/district-admin-dashboard/egovernance",   label: "E-Governance",   moduleKey: "reports" },
  { to: "/district-admin-dashboard/goal-setting",  label: "Goal Setting",   moduleKey: "goal_setting" },
  // Website Data → 6 tab pages (banners / advertisements / social media /
  // contact / menu list / about). No moduleKey — website data is core, always
  // visible for district admins.
  { to: "/district-admin-dashboard/my-district-website", label: "My District Website" },
  // Quick Links → 3 tab pages (web-links / sub-groups / mass-email). No moduleKey
  // => always visible for district admins. Landing at /quick-links; sub-pages
  // under /quick-links/{web-links,sub-groups,mass-email}/*.
  { to: "/district-admin-dashboard/quick-links",   label: "Quick Links" },
  // District Dues — district admins may edit their campaign's branding + email copy
  // (logos, email subject/body). Amounts, dates, clubs and splits stay SuperAdmin-only.
  { to: "/district-admin-dashboard/club-dues",     label: "District Dues" },
  // Wallet — self-service credit top-up (Razorpay). No moduleKey => always visible.
  { to: "/district-admin-dashboard/wallet",        label: "Wallet",         feature: "modules.wallet" },
  // Connect the district's own Stripe / PayPal account (instances without split payments).
  { to: "/district-admin-dashboard/payment-accounts", label: "Payments",    feature: "payments.connect" },
  // Export or erase a member's data on request.
  { to: "/district-admin-dashboard/privacy",        label: "Privacy Requests", feature: "privacy.enabled" },
];

export const DISTRICT_ADMIN_PAGE_TITLES: Record<string, string> = {
  "/district-admin-dashboard":               "District Dashboard",
  "/district-admin-dashboard/overview":      "District Dashboard",
  "/district-admin-dashboard/membership":    "Membership",
  "/district-admin-dashboard/rotary-network": "Rotary Network",
  "/district-admin-dashboard/foundation":    "Projects / Events",
  "/district-admin-dashboard/communication": "Communication",
  "/district-admin-dashboard/egovernance":   "E-Governance & Reporting",
  "/district-admin-dashboard/goal-setting":  "Goal Setting",
  "/district-admin-dashboard/goal-setting/clubs": "Club Goals",
  "/district-admin-dashboard/my-district-website": "My District Website",
  "/district-admin-dashboard/quick-links":   "Quick Links",
  "/district-admin-dashboard/quick-links/web-links":  "Web Links",
  "/district-admin-dashboard/quick-links/sub-groups": "Sub Groups",
  "/district-admin-dashboard/quick-links/mass-email": "Mass Email",
  "/district-admin-dashboard/club-dues":     "District Dues",
  "/district-admin-dashboard/wallet":        "Wallet & Credits",
  "/district-admin-dashboard/payment-accounts": "Payment Accounts",
  "/district-admin-dashboard/privacy":       "Privacy Requests",
};
