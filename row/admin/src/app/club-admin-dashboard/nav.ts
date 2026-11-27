import {
  Activity, Award, BadgeCheck, BadgeDollarSign, BookUser, Briefcase, Calculator, ClipboardList, Clock, Coins, CreditCard, FileBarChart, FolderKanban, GraduationCap, HandHeart, Handshake, Heart, Landmark, LayoutDashboard, ListChecks, Lock, Mail, MapPin, Megaphone, MessageSquare, Mic, Monitor, Receipt, RefreshCw, ShieldCheck, Target, TrendingUp, Trophy, Users, UsersRound, Wallet,
} from "@/components/icons";
import type { NavItem } from "@/components/dashboard/DashboardShell";

// URLs intentionally match the screenshot filename slugs (e.g. e-governance,
// my-club-website, membership-dues) — Phase A renames per user instruction.
// moduleKey values map to module_master.ModuleKey. Hidden when the module is
// flagged Coming Soon (non-SuperAdmin). "Dashboard" stays visible regardless —
// it's an internal aggregation across multiple modules, not a single module.
export const CLUB_ADMIN_NAV: NavItem[] = [
  // Items are listed in sidebar order; `group` is the heading they sit under.
  // NOTE: `to` points at the dashboard root (which redirects to /overview)
  // rather than /dashboard/overview directly, so the active-highlight prefix
  // match (`pathname.startsWith(to + "/")`) catches all sibling sub-tabs
  // (/overview, /directory, /board-of-directors, /rotary-network)
  // instead of only /overview/. Clicking the link still lands on /overview
  // via the redirect page at app/club-admin-dashboard/dashboard/page.tsx.
  { to: "/club-admin-dashboard/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/club-admin-dashboard/membership", label: "Membership", icon: Users, group: "Members", moduleKey: "directory" },
  // Member flexibility: tags, custom profile fields, smart lists.
  { to: "/club-admin-dashboard/member-lists", label: "Member Lists", icon: ListChecks, group: "Members", moduleKey: "directory" },
  // Flag membership_fields: FeatureGate hides the link while the module is off.
  { to: "/club-admin-dashboard/foundation-designations", label: "Foundation Designations", icon: BadgeCheck, group: "Members", moduleKey: "directory" },
  // RI data tools: officers vs Rotary International, transfer-in wizard (stored RI data only).
  { to: "/club-admin-dashboard/ri-data", label: "RI Data", icon: RefreshCw, group: "Members", moduleKey: "directory" },
  // Flag engagement: FeatureGate hides the link while the module is off.
  { to: "/club-admin-dashboard/engagement", label: "Engagement", icon: Activity, group: "Members" },
  // Contacts, groups, imports, event invites, guest prompts. Hidden while the contacts_growth feature is off.
  { to: "/club-admin-dashboard/contacts", label: "Contacts", icon: BookUser, group: "Members" },
  // Member map + business directory (gap agent)
  { to: "/club-admin-dashboard/member-map", label: "Member Map", icon: MapPin, group: "Members" },
  { to: "/club-admin-dashboard/business-directory", label: "Business Directory", icon: Briefcase, group: "Members" },
  // Enhanced committees (gap agent): platform switch "committees" (FeatureGate hides the link while it is off).
  { to: "/club-admin-dashboard/committees", label: "Committees", icon: UsersRound, group: "Members" },
  { to: "/club-admin-dashboard/foundation", label: "Projects / Events", icon: FolderKanban, group: "Service", moduleKey: "trf_contribution" },
  { to: "/club-admin-dashboard/service-projects-and-public-image", label: "Service Projects & Public Image", icon: HandHeart, group: "Service", moduleKey: "community_service" },
  // Grants: platform switch "grants" (FeatureGate hides the link while it is off).
  { to: "/club-admin-dashboard/grants", label: "Grants", icon: Award, group: "Service" },
  // Volunteers and speakers: platform switch "volunteers" (FeatureGate hides the links while it is off).
  { to: "/club-admin-dashboard/volunteers", label: "Volunteers", icon: Handshake, group: "Service" },
  { to: "/club-admin-dashboard/speakers", label: "Speakers & Duties", icon: Mic, group: "Service" },
  { to: "/club-admin-dashboard/speaker-bureau", label: "Speaker Bureau", icon: Megaphone, group: "Service" },
  // Youth programs: platform switch "youth_programs" (FeatureGate hides the link while it is off).
  { to: "/club-admin-dashboard/youth-programs", label: "Youth Programs", icon: GraduationCap, group: "Service" },
  // Service hours: platform switch "service_hours" (FeatureGate hides the link while it is off).
  { to: "/club-admin-dashboard/service-hours", label: "Service Hours", icon: Clock, group: "Service" },
  { to: "/club-admin-dashboard/e-governance", label: "E-Governance", icon: Landmark, group: "Goals and reports", moduleKey: "reports" },
  { to: "/club-admin-dashboard/rcc-goals", label: "RCC & District Goals", icon: Trophy, group: "Goals and reports", moduleKey: "goal_setting" },
  // New goal flow (RIZones 2026-11-17..23, ported 2026-11-27): RCC Goals (Rotary.org) and the goals the DG sets.
  { to: "/club-admin-dashboard/rcc", label: "RCC Goals", icon: Trophy, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/club-admin-dashboard/district-set-goals", label: "District Set Goals", icon: Target, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/club-admin-dashboard/goal-setting", label: "Goal Setting", icon: Target, group: "Goals and reports", moduleKey: "goal_setting" },
  { to: "/club-admin-dashboard/custom-reports", label: "Report Builder", icon: FileBarChart, group: "Goals and reports" },
  { to: "/club-admin-dashboard/surveys", label: "Surveys", icon: ClipboardList, group: "Goals and reports" },
  // The club's live target against actual. Hidden while the target_dashboard feature is off.
  { to: "/club-admin-dashboard/targets", label: "Targets", icon: TrendingUp, group: "Goals and reports" },
  { to: "/club-admin-dashboard/communication", label: "Communication", icon: MessageSquare, group: "Messages and website", moduleKey: "announcements" },
  // N5 Communication: allowance, templates per language, sender, bounces (hidden while the "communication" feature is off).
  { to: "/club-admin-dashboard/comms-settings", label: "Email Settings", icon: Mail, group: "Messages and website", moduleKey: "announcements" },
  // Reported chat messages (flag chat: FeatureGate hides the link while it is off).
  { to: "/club-admin-dashboard/chat-moderation", label: "Chat Moderation", icon: ShieldCheck, group: "Messages and website" },
  { to: "/club-admin-dashboard/my-club-website", label: "My Club Website", icon: Monitor, group: "Messages and website", moduleKey: "website_data" },
  // Club accounts (gap agent): chart, journal, P&L, balance sheet, budget.
  { to: "/club-admin-dashboard/accounts", label: "Accounts", icon: Calculator, group: "Finance" },
  // Donation campaigns (gap agent): giving page, QR code, receipt letters.
  { to: "/club-admin-dashboard/donations", label: "Donations", icon: Heart, group: "Finance" },
  // Club Dues — enabled per user request (Phase 8). Access enforced at
  // the page: Club Admin sees own club only, SuperAdmin creates from /settings.
  { to: "/club-admin-dashboard/membership-dues", label: "Club Dues", icon: Receipt, group: "Finance", moduleKey: "membership_dues" },
  // District Dues — the club's district dues, paid on the club's behalf. Only shown to
  // office bearers (President / Secretary / Treasurer); the layout filters this out
  // for everyone else (officerOnly). Access is re-enforced server-side per endpoint.
  { to: "/club-admin-dashboard/club-dues", label: "District Dues", icon: Coins, group: "Finance", officerOnly: true },
  // Payment Links removed from sidebar per user request (still reachable via
  // /club-admin-dashboard/payment-links if anyone bookmarked it).
  // Wallet — self-service credit top-up (Razorpay). No moduleKey => always visible.
  { to: "/club-admin-dashboard/wallet", label: "Wallet", icon: Wallet, group: "Finance", feature: "modules.wallet" },
  // Connect the club's own Stripe / PayPal account (instances without split payments).
  { to: "/club-admin-dashboard/payment-accounts", label: "Payments", icon: CreditCard, group: "Finance", feature: "payments.connect" },
  // KIS/ROW/SUB/01: status, buy and renew. Always visible, and always open (the way out of a locked club).
  { to: "/club-admin-dashboard/subscription", label: "Subscription", icon: BadgeDollarSign, group: "Account" },
  // Former members and GDPR erasure (ROW: privacy.enabled).
  { to: "/club-admin-dashboard/privacy", label: "Privacy", icon: Lock, group: "Account", feature: "privacy.enabled" },
];

// Page titles per route. Top-level keys are the canonical paths; old paths kept
// here too for the transition period (they 308-redirect via stub pages but the
// LayoutClient may briefly see the old URL during navigation).
export const CLUB_ADMIN_PAGE_TITLES: Record<string, string> = {
  "/club-admin-dashboard":                                            "Club Dashboard",
  "/club-admin-dashboard/subscription":                               "Subscription",
  "/club-admin-dashboard/website-purchase":                              "Club Website",
  "/club-admin-dashboard/dashboard":                                   "Club Dashboard",
  "/club-admin-dashboard/dashboard/overview":                          "Club Dashboard",
  "/club-admin-dashboard/dashboard/directory":                         "Club Dashboard - Directory",
  "/club-admin-dashboard/dashboard/board-of-directors":                "Club Dashboard - Board of Directors",
  "/club-admin-dashboard/dashboard/past-presidents":                   "Club Dashboard - Past Presidents",
  "/club-admin-dashboard/dashboard/rollover":                          "Club Dashboard - Year-end Rollover",
  "/club-admin-dashboard/dashboard/rotary-network":                    "Club Dashboard - Rotary Network",
  "/club-admin-dashboard/dashboard/anniversaries":                     "Club Dashboard - Anniversaries",
  "/club-admin-dashboard/dashboard/profile-updates":                   "Club Dashboard - Profile Updates",
  "/club-admin-dashboard/foundation":                                  "Projects / Events",
  "/club-admin-dashboard/membership":                                  "Membership",
  "/club-admin-dashboard/member-lists":                                "Member Lists",
  "/club-admin-dashboard/foundation-designations":                     "Foundation Designations",
  "/club-admin-dashboard/ri-data":                                     "RI Data",
  "/club-admin-dashboard/engagement":                                  "Engagement",
  "/club-admin-dashboard/contacts":                                    "Contacts",
  "/club-admin-dashboard/contacts/friends":                            "Friends of the club",
  "/club-admin-dashboard/service-projects-and-public-image":           "Service Projects & Public Image",
  "/club-admin-dashboard/e-governance":                                "E-Governance & Reporting",
  "/club-admin-dashboard/rcc-goals":                                   "RCC & District Goals",
  "/club-admin-dashboard/rcc": "RCC Goals",
  "/club-admin-dashboard/district-set-goals": "District Set Goals",
  "/club-admin-dashboard/goal-setting":                                "Goal Setting",
  "/club-admin-dashboard/grants":                                      "Grants",
  "/club-admin-dashboard/accounts":                                    "Accounts",
  "/club-admin-dashboard/custom-reports":                              "Report Builder",
  "/club-admin-dashboard/volunteers":                                  "Volunteers",
  "/club-admin-dashboard/surveys": "Surveys and Polls",
  "/club-admin-dashboard/service-hours":                               "Service Hours",
  "/club-admin-dashboard/speakers":                                    "Speakers and Meeting Duties",
  "/club-admin-dashboard/donations": "Donations",
  "/club-admin-dashboard/speaker-bureau":                              "Speaker Bureau",
  "/club-admin-dashboard/youth-programs":                                    "Youth Programs",
  "/club-admin-dashboard/member-map": "Member Map",
  "/club-admin-dashboard/business-directory": "Business Directory",
  "/club-admin-dashboard/targets":                                     "Targets",
  "/club-admin-dashboard/communication":                               "Communication",
  "/club-admin-dashboard/committees":                                  "Committees",
  "/club-admin-dashboard/comms-settings":                              "Email Settings",
  "/club-admin-dashboard/chat-moderation":                             "Chat Moderation",
  "/club-admin-dashboard/my-club-website":                             "My Club Website",
  "/club-admin-dashboard/membership-dues":                             "Club Dues",
  "/club-admin-dashboard/club-dues":                                   "District Dues",
  "/club-admin-dashboard/payment-links":                               "Payment Links",
  "/club-admin-dashboard/privacy":                                     "Privacy",
  // Legacy paths retained so a briefly-stale pathname still resolves a title.
  "/club-admin-dashboard/overview":                                    "Club Dashboard",
  "/club-admin-dashboard/avenue":                                      "Service Projects & Public Image",
  "/club-admin-dashboard/egovernance":                                 "E-Governance & Reporting",
  "/club-admin-dashboard/website":                                     "My Club Website",
  "/club-admin-dashboard/payments":                                    "Club Dues",
  "/club-admin-dashboard/wallet":                                      "Wallet & Credits",
  "/club-admin-dashboard/payment-accounts":                            "Payment Accounts",
};
