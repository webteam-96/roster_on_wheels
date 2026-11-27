import {
  Activity, AlertTriangle, Award, BadgeCheck, BadgeDollarSign, BookUser, Briefcase, ClipboardList, Clock, Coins, CreditCard, FileBarChart, FolderKanban, Globe, GraduationCap, Heart, Landmark, LayoutDashboard, Link2, Lock, Mail, MapPin, Megaphone, MessageSquare, Monitor, Newspaper, RotateCw, ShieldCheck, Target, TrendingUp, Trophy, Users, UsersRound, Wallet,
} from "@/components/icons";
import type { NavItem } from "@/components/dashboard/DashboardShell";

// moduleKey values map to module_master.ModuleKey. Hidden when the module is
// flagged Coming Soon (non-SuperAdmin). Overview is always visible — it's an
// internal district-wide rollup, not a single module.
export const DISTRICT_ADMIN_NAV: NavItem[] = [
  // Items are listed in sidebar order; `group` is the heading they sit under.
  { to: "/district-admin-dashboard/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/district-admin-dashboard/membership", label: "Membership", icon: Users, group: "Members", moduleKey: "directory" },
  // Flag membership_fields: FeatureGate hides the link while the module is off.
  { to: "/district-admin-dashboard/foundation-designations", label: "Foundation Designations", icon: BadgeCheck, group: "Members", moduleKey: "directory" },
  // Flag engagement: FeatureGate hides the link while the module is off.
  { to: "/district-admin-dashboard/engagement", label: "Engagement", icon: Activity, group: "Members" },
  // Contacts, groups, imports, event invites. Hidden while the contacts_growth feature is off.
  { to: "/district-admin-dashboard/contacts", label: "Contacts", icon: BookUser, group: "Members" },
  // Enhanced committees (gap agent): platform switch "committees" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/committees", label: "Committees", icon: UsersRound, group: "Members" },
  // Member map + business directory (gap agent)
  { to: "/district-admin-dashboard/member-map", label: "Member Map", icon: MapPin, group: "Members" },
  { to: "/district-admin-dashboard/business-directory", label: "Business Directory", icon: Briefcase, group: "Members" },
  // Rotary Network moved into the E-Governance tab strip (after District Awards).
  { to: "/district-admin-dashboard/foundation", label: "Projects / Events", icon: FolderKanban, group: "Service", moduleKey: "trf_contribution" },
  // Grants: platform switch "grants" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/grants", label: "Grants", icon: Award, group: "Service" },
  // Speaker bureau: platform switch "volunteers" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/speaker-bureau", label: "Speaker Bureau", icon: Megaphone, group: "Service" },
  // Youth programs: platform switch "youth_programs" (FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/youth-programs", label: "Youth Programs", icon: GraduationCap, group: "Service" },
  // Service hours per club. Hidden while the service_hours feature is off.
  { to: "/district-admin-dashboard/service-hours", label: "Service Hours", icon: Clock, group: "Service" },
  { to: "/district-admin-dashboard/egovernance", label: "E-Governance", icon: Landmark, group: "Goals and reports", moduleKey: "reports" },
  { to: "/district-admin-dashboard/rcc-goals", label: "RCC & District Goals", icon: Trophy, group: "Goals and reports", moduleKey: "goal_setting" },
  // New goal flow (ported 2026-11-27). Disha Goals: FeatureGate "disha_goals" hides the link while it is off (owner: off).
  { to: "/district-admin-dashboard/rcc", label: "RCC Goals", icon: Trophy, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/district-admin-dashboard/disha-goals", label: "Disha Goals", icon: Target, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/district-admin-dashboard/district-set-goals", label: "District Set Goals", icon: Target, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/district-admin-dashboard/goal-setting", label: "Goal Setting", icon: Target, group: "Goals and reports", moduleKey: "goal_setting" },
  // Rotary.org figures + DG Sync. Hidden while the goal_setting_rotary module is off (Settings > Features).
  { to: "/district-admin-dashboard/goal-setting-rotary", label: "Rotary.org Goals", icon: Globe, group: "Goals and reports" },
  { to: "/district-admin-dashboard/surveys", label: "Surveys", icon: ClipboardList, group: "Goals and reports" },
  { to: "/district-admin-dashboard/custom-reports", label: "Report Builder", icon: FileBarChart, group: "Goals and reports" },
  // Live target against actual per club. Hidden while the target_dashboard feature is off.
  { to: "/district-admin-dashboard/targets", label: "Targets", icon: TrendingUp, group: "Goals and reports" },
  // Year-end rollover (gap agent): committees and team into the next Rotary year, with undo.
  { to: "/district-admin-dashboard/rollover", label: "Year-end Rollover", icon: RotateCw, group: "Goals and reports" },
  // Alerts from club president to AG to DG, rules and log. Hidden while the escalation feature is off.
  { to: "/district-admin-dashboard/escalation", label: "Escalation Alerts", icon: AlertTriangle, group: "Goals and reports" },
  { to: "/district-admin-dashboard/communication", label: "Communication", icon: MessageSquare, group: "Messages and website", moduleKey: "announcements" },
  // N5 Communication: allowance, templates, sender, bounces, Governor note (hidden while "communication" is off).
  { to: "/district-admin-dashboard/comms-settings", label: "Email Settings", icon: Mail, group: "Messages and website", moduleKey: "announcements" },
  // Reported messages in district groups (flag chat: FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/chat-moderation", label: "Chat Moderation", icon: ShieldCheck, group: "Messages and website" },
  // Job postings and B2B offers to approve or check (flag job_board: FeatureGate hides the link while it is off).
  { to: "/district-admin-dashboard/job-board", label: "Job Board", icon: Newspaper, group: "Messages and website" },
  // Website Data → 6 tab pages (banners / advertisements / social media /
  // contact / menu list / about). No moduleKey — website data is core, always
  // visible for district admins.
  { to: "/district-admin-dashboard/my-district-website", label: "My District Website", icon: Monitor, group: "Messages and website" },
  // Quick Links → 3 tab pages (web-links / sub-groups / mass-email). No moduleKey
  // => always visible for district admins. Landing at /quick-links; sub-pages
  // under /quick-links/{web-links,sub-groups,mass-email}/*.
  { to: "/district-admin-dashboard/quick-links", label: "Quick Links", icon: Link2, group: "Messages and website" },
  // Donation campaigns (gap agent): giving page, QR code, receipt letters.
  { to: "/district-admin-dashboard/donations", label: "Donations", icon: Heart, group: "Finance" },
  // District Dues — district admins may edit their campaign's branding + email copy
  // (logos, email subject/body). Amounts, dates, clubs and splits stay SuperAdmin-only.
  { to: "/district-admin-dashboard/club-dues", label: "District Dues", icon: Coins, group: "Finance" },
  // Wallet — self-service credit top-up (Razorpay). No moduleKey => always visible.
  { to: "/district-admin-dashboard/wallet", label: "Wallet", icon: Wallet, group: "Finance", feature: "modules.wallet" },
  // Connect the district's own Stripe / PayPal account (instances without split payments).
  { to: "/district-admin-dashboard/payment-accounts", label: "Payments", icon: CreditCard, group: "Finance", feature: "payments.connect" },
  // Export or erase a member's data on request.
  { to: "/district-admin-dashboard/privacy", label: "Privacy Requests", icon: Lock, group: "Account", feature: "privacy.enabled" },
  // KIS/ROW/SUB/01: status, buy and renew. Always visible, and always open (the way out of a locked district).
  { to: "/district-admin-dashboard/subscription", label: "Subscription", icon: BadgeDollarSign, group: "Account" },
];

export const DISTRICT_ADMIN_PAGE_TITLES: Record<string, string> = {
  "/district-admin-dashboard":               "District Dashboard",
  "/district-admin-dashboard/subscription":  "Subscription",
  "/district-admin-dashboard/overview":      "District Dashboard",
  "/district-admin-dashboard/rcc": "RCC Goals",
  "/district-admin-dashboard/disha-goals": "Disha Goals",
  "/district-admin-dashboard/district-set-goals": "District Set Goals",
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
