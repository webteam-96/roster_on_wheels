"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, Settings, Calendar, Globe, Palette, Target, Layers, GitBranch, Wallet, Users, CreditCard, Shirt, LinkIcon, BadgeDollarSign, Coins, Trophy, Crown, History, Megaphone, Search, UserCog2, MonitorSmartphone, UserCircle2, FileBarChart, ClipboardList, ShieldCheck, Bell, Smartphone, Wrench, Mail, MessageCircle, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";

interface SettingsCard {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  disabled?: boolean;
}

// Order is tier-based so daily-use modules sit at the top: search/look-up first,
// then admin diagnostics, then weekly tasks, then setup/admin one-shots, then
// rarely-touched master data. Adjust order here when a new card is added or when
// usage patterns change.
const settingsCards: SettingsCard[] = [
  // ─── Tier 1: Daily-use (search + diagnostics + ops) ──────────────────────────
  {
    title: "Zone List",
    description: "Browse all zones → districts → clubs and open any club dashboard (SuperAdmin landing moved to Global Search)",
    icon: Layers,
    // Was "/" — the public website took over "/" when the (site) route group landed,
    // and this page moved to /admin, so "/" opened the public site instead of the zones.
    href: "/admin",
  },
  {
    title: "Global Search",
    description: "Search zones, districts or clubs and jump straight to the dashboard — empty on load, results appear as you type",
    icon: Search,
    href: "/settings/global-search",
  },
  {
    title: "Global Member Search",
    description: "Search members across all zones, districts and clubs",
    icon: Search,
    href: "/settings/global-member-search",
  },
  {
    title: "Mobile Login Check",
    description: "Diagnostic: enter a mobile number to see if it can login on the mobile app and what clubs would appear — no OTP sent",
    icon: Smartphone,
    href: "/settings/mobile-login-check",
  },
  {
    title: "App Maintenance",
    description: "Toggle mobile app routes / tabs under maintenance — global kill switch + per-route message + back-by date",
    icon: Wrench,
    href: "/settings/app-maintenance",
  },
  {
    title: "Daily Statistics Report",
    description: "Preview / download / send the daily stats email (sync & non-sync clubs, members, projects, photos) — auto-sent 6 AM IST",
    icon: FileBarChart,
    href: "/settings/daily-stats-report",
  },
  {
    title: "Performance Report",
    description: "RI Director (all districts, zone-wise) and DG (per district) progress reports — view, download the Excel, send a test email",
    icon: FileBarChart,
    href: "/settings/district-performance-report",
  },
  {
    title: "Audit Log",
    description: "System-wide action history & audit trail",
    icon: History,
    href: "/settings/audit-log",
  },
  {
    title: "Email Log",
    description: "Every email sent via Brevo — OTP, credentials, mass emails, citations. Click any row for the full HTML body.",
    icon: Mail,
    href: "/settings/email-log",
  },
  {
    title: "WhatsApp Log",
    description: "Every WhatsApp message sent via Interakt — Sent / Delivered / Failed per recipient.",
    icon: MessageCircle,
    href: "/settings/whatsapp-log",
  },
  {
    title: "Push Notification Logs",
    description: "Recent push notification activity and recipient status (last 5 days)",
    icon: Bell,
    href: "/settings/push-logs",
  },
  {
    title: "Reports",
    description: "Export Excel reports for zones, districts, clubs, members, settings & more",
    icon: FileBarChart,
    href: "/settings/reports",
  },

  // ─── Tier 2: Weekly / operational ─────────────────────────────────────────────
  {
    title: "Login Announcement",
    description: "Show popup message to users after login",
    icon: Megaphone,
    href: "/settings/login-announcement",
  },
  {
    title: "Club Leadership",
    description: "Add/Edit club Presidents & Secretaries across districts",
    icon: UserCog2,
    href: "/settings/club-leadership",
  },
  {
    title: "District Governor",
    description: "Manage district governors by year",
    icon: Crown,
    href: "/settings/district-governor",
  },
  {
    title: "Directory Data Collection",
    description: "Configure per-district member data collection forms (DC, BOD, Members) with OTP + reminders",
    icon: ClipboardList,
    href: "/settings/directory-data-collection",
  },
  {
    title: "Rotary.org",
    description: "Manually sync clubs and members between ROW and Rotary.org",
    icon: Globe,
    href: "/settings/rotary-org",
  },
  {
    title: "Project Sync",
    description: "Rotary.org project sync log per club — who clicked Sync, whether it was published, and every reset",
    icon: RefreshCw,
    href: "/settings/project-sync",
  },

  // ─── Tier 3: Admin / Setup (less frequent) ────────────────────────────────────
  {
    title: "Super Admin Role Config",
    description: "Promote or remove SuperAdmin access — OTP-gated by the approver on record",
    icon: ShieldCheck,
    href: "/settings/super-admin-role-config",
  },
  {
    title: "RI Director Management",
    description: "Assign or remove RI Director role",
    icon: Crown,
    href: "/settings/ri-director",
  },
  {
    title: "Goal Setting — Oversight Roles",
    description: "Assign zone/category-scoped Goal Setting oversight roles (view, lock, comment)",
    icon: Target,
    href: "/settings/goal-setting-roles",
  },
  {
    title: "Mobile App Version",
    description: "Manage mobile app versions for force/optional update on Android + iOS",
    icon: Smartphone,
    href: "/settings/mobile-version",
  },
  {
    title: "International President",
    description: "Manage RI President info per Rotary year (photo, name, designation, description)",
    icon: UserCircle2,
    href: "/settings/international-president",
  },
  {
    title: "Club Websites",
    description: "Manage club website subscriptions, templates & renewals",
    icon: MonitorSmartphone,
    href: "/settings/club-websites",
  },
  {
    title: "District Websites",
    description: "Manage district website subdomains (non-subscription)",
    icon: MonitorSmartphone,
    href: "/settings/district-websites",
  },
  {
    title: "Wallet",
    description: "WhatsApp & Email credits (Offline, Online, RI Director) and club-website pricing & pay-link reminders",
    icon: Wallet,
    href: "/settings/wallet",
  },
  {
    title: "Razorpay Route Accounts",
    description: "Manage Razorpay Route linked accounts used for club-website payments",
    icon: CreditCard,
    href: "/settings/razorpay-route-accounts",
  },
  {
    title: "Zonal Awards",
    description: "Manage zonal award questions & import data",
    icon: Trophy,
    href: "/settings/zonal-awards",
  },

  // ─── Tier 4: Master data (rarely edited) ─────────────────────────────────────
  {
    title: "Module Master",
    description: "Manage modules, categories & assignments",
    icon: LayoutGrid,
    href: "/settings/module-master",
  },
  {
    title: "Designations",
    description: "Manage board of directors designations",
    icon: Settings,
    href: "/settings/designations",
  },
  {
    title: "Rotary Years",
    description: "View rotary year records",
    icon: Calendar,
    href: "/settings/rotary-years",
  },
  // Hidden from Settings menu — page + API still work via direct URL `/settings/website-data-modules`.
  // Uncomment to restore the card.
  // {
  //   title: "Website Data Modules",
  //   description: "Manage website sub-module master list",
  //   icon: Globe,
  //   href: "/settings/website-data-modules",
  // },
  {
    title: "Themes",
    description: "Manage website themes and images",
    icon: Palette,
    href: "/settings/themes",
  },
  {
    title: "Project Categorization",
    description: "Areas of focus, categories & sub-categories",
    icon: Target,
    href: "/settings/project-categorization",
  },
  {
    title: "Funding",
    description: "Manage project funding sources",
    icon: Wallet,
    href: "/settings/funding",
  },
  {
    title: "Direct Beneficiaries Limit",
    description: "Set max direct beneficiaries per project",
    icon: Users,
    href: "/settings/direct-beneficiaries-limit",
  },
  {
    title: "Payments & Dues",
    description: "Payment gateway, event payments and Club Dues",
    icon: CreditCard,
    href: "/settings/payments-and-dues",
  },
  {
    title: "Email & WhatsApp Credits",
    description: "Manage credits for clubs, districts and RI Director",
    icon: Coins,
    href: "/settings/email-whatsapp-credits",
  },
  {
    title: "Currency",
    description: "Set each district's default currency for project-add forms — every district defaults to INR",
    icon: BadgeDollarSign,
    href: "/settings/currency",
  },
];

// Hidden cards (page still exists, just not listed). Email & WhatsApp Credits: everything it
// opened now lives in Settings › Wallet (Offline / Online / RI Director Credits buttons).
const HIDDEN_HREFS = new Set<string>(["/settings/email-whatsapp-credits"]);

export default function SettingsPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [navigatingHref, setNavigatingHref] = useState<string | null>(null);

  // Pinned quick-access modules — always shown as small cards in one row above the listing (in this
  // exact order), and removed from the main (searchable) listing below.
  const PINNED_HREFS = [
    "/settings/global-search",
    "/settings/global-member-search",
    "/settings/rotary-org",
    "/settings/email-log",
    "/settings/whatsapp-log",
    "/settings/payments-and-dues",
  ];
  const pinnedCards = PINNED_HREFS
    .map((href) => settingsCards.find((c) => c.href === href && !HIDDEN_HREFS.has(c.href)))
    .filter((c): c is SettingsCard => !!c);
  const pinnedSet = new Set(PINNED_HREFS);

  const q = query.trim().toLowerCase();
  const filtered = settingsCards
    .filter((c) => !HIDDEN_HREFS.has(c.href))
    .filter((c) => !pinnedSet.has(c.href))
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Settings</h2>
            <p className="text-muted-foreground text-base">System configuration and master data</p>
          </div>
        </div>

        {/* Pinned quick-access modules — one row of small cards, always visible. */}
        {pinnedCards.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {pinnedCards.map((card) => (
              <button
                key={card.href}
                type="button"
                onClick={() => { setNavigatingHref(card.href); router.push(card.href); }}
                disabled={navigatingHref === card.href}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2.5 text-center shadow-sm transition hover:border-primary/40 hover:shadow-md ${navigatingHref === card.href ? "opacity-70 pointer-events-none" : ""}`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {navigatingHref === card.href ? <RotaryLoader size="sm" /> : <card.icon className="h-4 w-4" />}
                </div>
                <span className="text-xs font-medium text-primary leading-tight">{card.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9 pr-8"
            placeholder="Search settings by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={() => setQuery("")} type="button">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-slate-200 bg-white">
            <Search className="h-10 w-10 text-slate-400 mb-3" />
            <h3 className="text-base font-semibold text-slate-800">No settings match “{query}”</h3>
            <p className="text-slate-500 text-sm mt-1">Try a different word.</p>
          </div>
        )}

        {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {(() => {
            const perCol = Math.ceil(filtered.length / 3);
            const columns = [0, 1, 2].map((n) => ({
              items: filtered.slice(n * perCol, (n + 1) * perCol),
              offset: n * perCol,
            }));
            return columns.map((col, colIdx) => (
              <div key={colIdx} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left w-12">#</th>
                      <th className="px-4 py-3 text-left w-16">Icon</th>
                      <th className="px-4 py-3 text-left">Title</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {col.items.map((card, i) => (
                      <tr
                        key={card.title}
                        className={`${card.disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50/70"} ${navigatingHref === card.href ? "opacity-70 pointer-events-none" : ""}`}
                        onClick={() => { if (!card.disabled) { setNavigatingHref(card.href); router.push(card.href); } }}
                      >
                        <td className="px-4 py-3 text-slate-500 tabular-nums align-middle">{col.offset + i + 1}</td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                            {navigatingHref === card.href ? <RotaryLoader size="sm" /> : <card.icon className="h-5 w-5" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="font-medium text-primary">{card.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{card.description}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ));
          })()}
        </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
