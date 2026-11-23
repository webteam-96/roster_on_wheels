import type { NavItem } from "@/components/dashboard/DashboardShell";

// moduleKey values map to module_master.ModuleKey. Hidden when the module is
// flagged Coming Soon (non-SuperAdmin). Overview is always visible — it's an
// internal district-wide rollup, not a single module.
export const DISTRICT_ADMIN_NAV: NavItem[] = [
  { to: "/district-admin-dashboard/overview",      label: "Overview" },
  { to: "/district-admin-dashboard/membership",    label: "Membership",     moduleKey: "directory" },
  // Flag membership_fields: FeatureGate hides the link while the module is off.
  { to: "/district-admin-dashboard/foundation-designations", label: "Foundation Designations", moduleKey: "directory" },
  // Flag engagement: FeatureGate hides the link while the module is off.
  { to: "/district-admin-dashboard/engagement",    label: "Engagement" },
  // Contacts, groups, imports, event invites. Hidden while the contacts_growth feature is off.
  { to: "/district-admin-dashboard/contacts",      label: "Contacts" },
  // Rotary Network moved into the E-Governance tab strip (after District Awards).
  { to: "/district-admin-dashboard/foundation",    label: "Projects / Events",     moduleKey: "trf_contribution" },
  { to: "/district-admin-dashboard/communication", label: "Communication",  moduleKey: "announcements" },
  // Enhanced committees (gap agent): platform switch "committees" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/committees",    label: "Committees" },
  // N5 Communication: allowance, templates, sender, bounces, Governor note (hidden while "communication" is off).
  { to: "/district-admin-dashboard/comms-settings", label: "Email Settings", moduleKey: "announcements" },
  // Reported messages in district groups (flag chat: FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/chat-moderation", label: "Chat Moderation" },
  // Job postings and B2B offers to approve or check (flag job_board: FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/job-board",     label: "Job Board" },
  { to: "/district-admin-dashboard/egovernance",   label: "E-Governance",   moduleKey: "reports" },
  { to: "/district-admin-dashboard/rcc-goals", label: "RCC & District Goals", moduleKey: "goal_setting" },
  { to: "/district-admin-dashboard/goal-setting",  label: "Goal Setting",   moduleKey: "goal_setting" },
  // Rotary.org figures + DG Sync. Hidden while the goal_setting_rotary module is off (Settings > Features).
  { to: "/district-admin-dashboard/goal-setting-rotary", label: "Rotary.org Goals" },
  // Grants: platform switch "grants" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/grants",        label: "Grants" },
  { to: "/district-admin-dashboard/surveys", label: "Surveys" },
  // Donation campaigns (gap agent): giving page, QR code, receipt letters.
  { to: "/district-admin-dashboard/donations", label: "Donations" },
  // Speaker bureau: platform switch "volunteers" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/speaker-bureau", label: "Speaker Bureau" },
  // Youth programs: platform switch "youth_programs" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/youth-programs",        label: "Youth Programs" },
  { to: "/district-admin-dashboard/custom-reports", label: "Report Builder" },
  // Member map + business directory (gap agent)
  { to: "/district-admin-dashboard/member-map", label: "Member Map" },
  { to: "/district-admin-dashboard/business-directory", label: "Business Directory" },
  // Live target against actual per club. Hidden while the target_dashboard feature is off.
  { to: "/district-admin-dashboard/targets",       label: "Targets" },
  // Year-end rollover (gap agent): committees and team into the next Rotary year, with undo.
  { to: "/district-admin-dashboard/rollover",      label: "Year-end Rollover" },
  // Service hours per club. Hidden while the service_hours feature is off.
  { to: "/district-admin-dashboard/service-hours", label: "Service Hours" },
  // Alerts from club president to AG to DG, rules and log. Hidden while the escalation feature is off.
  { to: "/district-admin-dashboard/escalation",    label: "Escalation Alerts" },
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
  // KIS/ROW/SUB/01: status, buy and renew. Always visible, and always open (the way out of a locked district).
  { to: "/district-admin-dashboard/subscription",   label: "Subscription" },
];

export const DISTRICT_ADMIN_PAGE_TITLES: Record<string, string> = {
  "/district-admin-dashboard":               "District Dashboard",
  "/district-admin-dashboard/subscription":  "Subscription",
  "/district-admin-dashboard/overview":      "District Dashboard",
  "/district-admin-dashboard/membership":    "Membership",
  "/district-admin-dashboard/foundation-designations": "Foundation Designations",
  "/district-admin-dashboard/engagement":    "Engagement",
  "/district-admin-dashboard/contacts":      "Contacts",
  "/district-admin-dashboard/rotary-network": "Rotary Network",
  "/district-admin-dashboard/foundation":    "Projects / Events",
  "/district-admin-dashboard/communication": "Communication",
  "/district-admin-dashboard/committees":    "Committees",
  "/district-admin-dashboard/comms-settings": "Email Settings",
  "/district-admin-dashboard/chat-moderation": "Chat Moderation",
  "/district-admin-dashboard/job-board":     "Job Board",
  "/district-admin-dashboard/egovernance":   "E-Governance & Reporting",
  "/district-admin-dashboard/rcc-goals": "RCC & District Goals",
  "/district-admin-dashboard/goal-setting":  "Goal Setting",
  "/district-admin-dashboard/goal-setting/clubs": "Club Goals",
  "/district-admin-dashboard/grants":        "Grants",
  "/district-admin-dashboard/surveys": "Surveys and Polls",
  "/district-admin-dashboard/donations": "Donations",
  "/district-admin-dashboard/speaker-bureau": "Speaker Bureau",
  "/district-admin-dashboard/youth-programs":        "Youth Programs",
  "/district-admin-dashboard/custom-reports": "Report Builder",
  "/district-admin-dashboard/member-map": "Member Map",
  "/district-admin-dashboard/business-directory": "Business Directory",
  "/district-admin-dashboard/targets":       "Targets",
  "/district-admin-dashboard/rollover":      "Year-end Rollover",
  "/district-admin-dashboard/service-hours": "Service Hours",
  "/district-admin-dashboard/escalation":    "Escalation Alerts",
  "/district-admin-dashboard/meeting-compliance": "Meeting Compliance",
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
