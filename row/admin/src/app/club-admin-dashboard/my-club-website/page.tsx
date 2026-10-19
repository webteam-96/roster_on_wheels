"use client";

/**
 * My Club Website — Club Admin dashboard tab.
 *
 * Reads website status + counts from the dashboard cache (prefetched by the
 * layout). Surfaces 4 KPI tiles, two large media tiles (Banner Photos +
 * Advertisement Area) with progress bars, and an 8-card grid linking to v2
 * Website Data sub-modules under /clubs/[clubId]/website-data/*.
 *
 * v2 sub-pages are built in a follow-up phase; these links may 404 until then.
 */

import Link from "next/link";
import {
  Globe,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Megaphone,
  Share2,
  Building2,
  ListChecks,
  Palette,
  PhoneCall,
  Info,
  Plus,
  Calendar,
  ChevronRight,
  ExternalLink,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import ClubTrainingSection from "@/components/training/ClubTrainingSection";

import { appLocale } from "@/lib/appFormat";
// ───────────────────────────────────────────────────────────────────────────
// Status chip config

type StatusKey =
  | "active"
  | "trial"
  | "trial_expired"
  | "expired"
  | "inactive"
  | "killed"
  | "not_configured";

const STATUS_CHIP: Record<
  StatusKey,
  { label: string; tone: string; dot: string; live: boolean }
> = {
  active:         { label: "Live",          tone: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", live: true  },
  trial:          { label: "Trial",         tone: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500",   live: true  },
  trial_expired:  { label: "Trial Expired", tone: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500",     live: false },
  expired:        { label: "Expired",       tone: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500",     live: false },
  inactive:       { label: "Inactive",      tone: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400",   live: false },
  killed:         { label: "Disabled",      tone: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400",   live: false },
  not_configured: { label: "Not Set Up",    tone: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400",   live: false },
};

function chipFor(status: string) {
  return (STATUS_CHIP as Record<string, (typeof STATUS_CHIP)[StatusKey]>)[status] ?? STATUS_CHIP.not_configured;
}

// ───────────────────────────────────────────────────────────────────────────
// Management cards config

type MgmtCard = {
  title: string;
  description: string;
  href: (clubId: number, qs: string) => string;
  icon: typeof ImageIcon;
  accent: string;   // icon foreground
  bg: string;       // icon background tile
  ring: string;     // hover ring colour
  gradient: string; // subtle background tint on the card
};

// Encode current tab so v2 pages can route their back arrow back here.
// The query-suffix is built INSIDE the component so the currently-selected
// yearId (from ?yearId= URL) can be propagated to sub-listings — otherwise
// banners/ads etc. would forget the year context.
const RETURN_TO = "/club-admin-dashboard/my-club-website";

const MGMT_CARDS: MgmtCard[] = [
  {
    title: "Banner Photos",
    description: "Hero banners shown on the homepage carousel.",
    href: (id, qs) => `/clubs/${id}/website-data/banners/v2${qs}`,
    icon: ImageIcon,
    accent: "text-blue-600",
    bg: "bg-blue-50",
    ring: "hover:ring-blue-200",
    gradient: "bg-blue-50/60",
  },
  {
    title: "Advertisement Area",
    description: "Sponsor and promo blocks displayed on the site.",
    href: (id, qs) => `/clubs/${id}/website-data/advertisements/v2${qs}`,
    icon: Megaphone,
    accent: "text-purple-600",
    bg: "bg-purple-50",
    ring: "hover:ring-purple-200",
    gradient: "bg-purple-50/60",
  },
  {
    title: "Social Media Links",
    description: "Connect your club's social channels to the site.",
    href: (id, qs) => `/clubs/${id}/website-data/social_media_links/v2${qs}`,
    icon: Share2,
    accent: "text-pink-600",
    bg: "bg-pink-50",
    ring: "hover:ring-pink-200",
    gradient: "bg-pink-50/60",
  },
  {
    title: "Logos",
    description: "Upload Club Logo + Rotary Logo (3:1 horizontal crop). Same Club Logo column as the profile page: change here reflects everywhere.",
    href: (id, qs) => `/clubs/${id}/website-data/logos${qs}`,
    icon: ImageIcon,
    accent: "text-amber-600",
    bg: "bg-amber-50",
    ring: "hover:ring-amber-200",
    gradient: "bg-amber-50/60",
  },
  {
    title: "Menu List",
    description: "Reorder, rename, and toggle visible menu items.",
    href: (id, qs) => `/clubs/${id}/website-data/menu_list/v2${qs}`,
    icon: ListChecks,
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "hover:ring-emerald-200",
    gradient: "bg-emerald-50/60",
  },
  {
    title: "Change Theme",
    description: "Pick a colour palette and visual style.",
    href: (id, qs) => `/clubs/${id}/website-data/theme/v2${qs}`,
    icon: Palette,
    accent: "text-fuchsia-600",
    bg: "bg-fuchsia-50",
    ring: "hover:ring-fuchsia-200",
    gradient: "bg-fuchsia-50/60",
  },
  {
    title: "Contact Details",
    description: "Phone, email, address shown in the footer.",
    href: (id, qs) => `/clubs/${id}/website-data/contact_details/v2${qs}`,
    icon: PhoneCall,
    accent: "text-teal-600",
    bg: "bg-teal-50",
    ring: "hover:ring-teal-200",
    gradient: "bg-teal-50/60",
  },
  {
    title: "About",
    description: "Edit the About section that introduces your club.",
    href: (id, qs) => `/clubs/${id}/website-data/about/v2${qs}`,
    icon: Info,
    accent: "text-rose-600",
    bg: "bg-rose-50",
    ring: "hover:ring-rose-200",
    gradient: "bg-rose-50/60",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Small helpers

// Strip scheme + trailing slash + whitespace; reject obvious placeholders ("NA", "N/A", etc.).
// Mirrors the backend NormalizeHost so we never produce links like https://NA or https://https://x/.
function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim();
  const schemeIdx = h.indexOf("//");
  if (schemeIdx >= 0 && schemeIdx <= 8) h = h.slice(schemeIdx + 2);
  const slash = h.indexOf("/");
  if (slash >= 0) h = h.slice(0, slash);
  h = h.replace(/^\.+|\.+$/g, "").trim().toLowerCase();
  if (!h) return null;
  if (["na", "n/a", "none", "null", "-", "tbd", "tba"].includes(h)) return null;
  if (/[\s\\@:?#"']/.test(h)) return null;
  return h;
}

function publicUrlFor(subdomain: string | null | undefined, thirdParty: string | null | undefined) {
  // 1. ClientDomain (third party) wins — but only if it's a real domain (has a dot).
  const tp = normalizeHost(thirdParty);
  if (tp && tp.includes(".")) return tp;
  // 2. Otherwise fall back to {subdomain}.{parent}.
  const sub = normalizeHost(subdomain);
  if (sub) return sub.includes(".") ? sub : `${sub}.portal.example.org`;
  return null;
}

function externalHref(url: string | null) {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

function fmtShortDate(s?: string | null) {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short" });
  } catch {
    return "–";
  }
}

// ───────────────────────────────────────────────────────────────────────────

export default function ClubAdminMyClubWebsitePage() {
  const { website, status: cacheStatus, yearId } = useClubAdminCache();
  // returnTo brings the user back here; yearId propagates the global-topbar
  // year selection into sub-listings (banners, ads, etc.) so they filter
  // by the same year the dashboard is showing.
  const RETURN_TO_QS = `?returnTo=${encodeURIComponent(RETURN_TO)}${yearId ? `&yearId=${yearId}` : ""}`;

  if (cacheStatus === "loading" && !website) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading website…" />
      </div>
    );
  }

  if (!website) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load website data. Please refresh the page.
      </div>
    );
  }

  const chip = chipFor(website.status);
  const clubId = website.club.clubId;
  // Renewal opens 30 days before expiry (matches the backend's purchase-window
  // check) — so the button must show before the site actually expires, not just after.
  const daysUntilExpiry = website.expiryDate
    ? Math.ceil((new Date(website.expiryDate).getTime() - Date.now()) / 86_400_000)
    : null;
  const withinRenewalWindow = daysUntilExpiry !== null && daysUntilExpiry <= 30;
  const showRenewButton =
    website.configured &&
    (website.status === "expired" || website.status === "trial_expired" || withinRenewalWindow);
  // Prefer the backend-resolved URL (handles probe + sanitisation). Fall back to local construction
  // for older API responses or if backend couldn't resolve.
  const publicHref =
    externalHref(website.visitUrl ?? null)
    ?? externalHref(publicUrlFor(website.subdomain, website.thirdPartyDomain));
  const publicUrl = publicHref ? publicHref.replace(/^https?:\/\//, "") : null;

  // Banner / Ad progress metrics — we don't have a hard cap from the API,
  // so visualise occupancy against a reasonable target (10 for banners,
  // 6 for ads). Caps at 100%.
  const BANNER_TARGET = 10;
  const AD_TARGET = 6;
  const bannerPct = Math.min(100, Math.round((website.bannerCount / BANNER_TARGET) * 100));
  // Reuse announcementCount as a proxy "ad slots filled" until a dedicated
  // ad count is exposed by the API — keeps the visual but stays accurate.
  const adCount = website.announcementCount;
  const adPct = Math.min(100, Math.round((adCount / AD_TARGET) * 100));

  return (
    <div className="space-y-6">
      {/* ─────────────────── Header row ─────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-azure/10 text-azure">
            <Globe size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-800 leading-tight">My Club Website</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {publicUrl ? (
                publicHref ? (
                  <a
                    href={publicHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-azure hover:underline inline-flex items-center gap-1"
                  >
                    {publicUrl}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">{publicUrl}</span>
                )
              ) : (
                <span className="text-xs text-slate-500">Website not yet configured</span>
              )}
              {/* Simplified Yes / Expired / No per user request 2026-06-12. */}
              {(() => {
                const expired = website.status === "expired" || website.status === "trial_expired";
                const noSite  = website.status === "not_configured" || !website.configured;
                const label   = noSite ? "No" : expired ? "Expired" : "Yes";
                const tone    = noSite
                  ? "bg-slate-100 text-slate-600 border-slate-200"
                  : expired
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200";
                const dot     = noSite ? "bg-slate-400" : expired ? "bg-red-500" : "bg-emerald-500";
                return (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    {label}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>

        {showRenewButton && (
          <Link
            href="/club-admin-dashboard/website-purchase"
            className="inline-flex items-center gap-2 self-start rounded-lg bg-azure px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-azure"
          >
            <Plus size={16} />
            Renew Club Website
          </Link>
        )}
      </div>

      {/* Kill switch banner */}
      {website.killSwitchOn && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong className="font-semibold">Kill switch enabled</strong>: your website is hidden by district administration.
          </div>
        </div>
      )}

      {/* Not-configured CTA — replaces KPI/media tiles entirely */}
      {!website.configured ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Globe size={28} className="text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Your club website is not yet set up</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
            Get your club its own website at rc&lt;name&gt;.example.org: manage banners, menus,
            events and more, renewed yearly.
          </p>
          <Link
            href="/club-admin-dashboard/website-purchase"
            className="inline-flex items-center gap-2 rounded-lg bg-azure px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-azure"
          >
            <Plus size={16} />
            Buy Club Website
          </Link>
        </div>
      ) : (
        <>
          {/* ─────────────────── Top KPI row ─────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Simplified Website Status per user request 2026-06-12:
                  Yes (active/trial — both have a live page) + expiry date
                  Expired (expired/trial_expired)
                  No (not_configured)
                Menus card removed. */}
            {(() => {
              const expired = website.status === "expired" || website.status === "trial_expired";
              const noSite  = website.status === "not_configured" || !website.configured;
              const yesLabel = noSite ? "No" : expired ? "Expired" : "Yes";
              const yesColor = noSite ? "slate" : expired ? "red" : "emerald";
              const yesIcon  = noSite ? AlertTriangle : expired ? AlertTriangle : CheckCircle2;
              const expSub   = noSite
                ? "No website set up"
                : expired
                  ? (website.expiryDate ? `Expired ${fmtShortDate(website.expiryDate)}` : "Expired")
                  : (website.expiryDate ? `Expiry ${fmtShortDate(website.expiryDate)}` : "No expiry on file");
              return (
                <KpiCard
                  title="Website Status"
                  value={
                    <span className={`text-${yesColor}-700`}>{yesLabel}</span>
                  }
                  subtitle={expSub}
                  icon={yesIcon}
                  color={noSite ? "red" : expired ? "red" : "green"}
                />
              );
            })()}
            <KpiCard
              title="Subscription"
              value={chip.live ? "Active" : chip.label}
              subtitle={website.expiryDate ? `Expires ${fmtShortDate(website.expiryDate)}` : "No expiry set"}
              icon={CheckCircle2}
              color="blue"
            />
            <KpiCard
              title="Last Updated"
              value={fmtShortDate(website.activatedDate)}
              subtitle={website.activatedDate ? fmtDate(website.activatedDate) : "–"}
              icon={Calendar}
              color="purple"
            />
            {/* Menus card removed per user request 2026-06-12. */}
          </div>

          {/* ─────────────────── Banner & Ad tiles ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MediaTile
              title="Banner Photos"
              count={website.bannerCount}
              target={BANNER_TARGET}
              percent={bannerPct}
              icon={ImageIcon}
              barClass="bg-blue-500"
              tintFrom="bg-blue-50"
              accent="text-blue-600"
              bg="bg-blue-50"
              addLabel="+ Add Banner"
              addHref={`/clubs/${clubId}/website-data/banners/v2${RETURN_TO_QS}`}
            />
            <MediaTile
              title="Advertisement Area"
              count={adCount}
              target={AD_TARGET}
              percent={adPct}
              icon={Megaphone}
              barClass="bg-purple-500"
              tintFrom="bg-purple-50"
              accent="text-purple-600"
              bg="bg-purple-50"
              addLabel="+ Add Ad"
              addHref={`/clubs/${clubId}/website-data/advertisements/v2${RETURN_TO_QS}`}
            />
          </div>
        </>
      )}

      {/* Website Training — book/reschedule a 30-min session (active subscription only) */}
      <ClubTrainingSection clubId={clubId} active={(website.status === "active" || website.status === "trial") && website.configured} />

      {/* ─────────────────── Website Management grid ─────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Website Management</h2>
            <p className="text-xs text-slate-500 mt-0.5">Configure every section of your club site.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MGMT_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.title}
                href={card.href(clubId, RETURN_TO_QS)}
                className={`group relative rounded-xl border border-slate-200 ${card.gradient} p-4 transition hover:shadow-md hover:-translate-y-0.5 ring-1 ring-transparent ${card.ring}`}
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${card.bg} ${card.accent} mb-3`}>
                  <Icon size={20} />
                </div>
                <p className="text-sm font-semibold text-slate-800 leading-tight">{card.title}</p>
                <p className="text-xs text-slate-500 mt-1 leading-snug">{card.description}</p>
                <span className={`absolute top-3 right-3 ${card.accent} opacity-0 group-hover:opacity-100 transition`}>
                  <ChevronRight size={16} />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MediaTile — large banner / ad summary card with a progress bar + CTA

interface MediaTileProps {
  title: string;
  count: number;
  target: number;
  percent: number;
  icon: typeof ImageIcon;
  barClass: string;
  tintFrom: string;
  accent: string;
  bg: string;
  addLabel: string;
  addHref: string;
}

function MediaTile({
  title,
  count,
  target,
  percent,
  icon: Icon,
  barClass,
  tintFrom,
  accent,
  bg,
  addLabel,
  addHref,
}: MediaTileProps) {
  return (
    <div className={`relative rounded-2xl border border-slate-200 ${tintFrom} p-5 overflow-hidden`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg} ${accent}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{title}</p>
              <p className="text-2xl font-extrabold text-slate-800 tabular-nums leading-tight">{fmtInt(count)}</p>
            </div>
          </div>
        </div>

        <Link
          href={addHref}
          className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg ${bg} ${accent} hover:brightness-95 transition flex-shrink-0`}
        >
          <Plus size={12} />
          {addLabel.replace(/^\+\s*/, "")}
        </Link>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-slate-500">
            {count} of {target} slots used
          </span>
          <span className="text-[11px] font-semibold text-slate-600">{percent}%</span>
        </div>
        <div className="h-2 bg-white/70 border border-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barClass} transition-all`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
