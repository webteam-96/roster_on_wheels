"use client";

/**
 * My District Website — District Admin dashboard landing (built 2026-07-04).
 * -------------------------------------------------------------------------
 * 6-card grid linking to the V2 website-data sub-pages built under
 * /district-admin-dashboard/my-district-website/*:
 *   - banners            (Banner Photos)
 *   - advertisements     (Advertisement Area)
 *   - social-media-links (Social Media Links)
 *   - contact-details    (Contact Details)
 *   - menu-list          (Menu List)
 *   - about              (About)
 *
 * districtId comes from useAuth().selectedDistrictId — the page lives under
 * the DA dashboard shell, no /districts/[id] URL param.
 *
 * Back button honours ?returnTo=; otherwise falls back to overview. Each
 * sub-page card carries returnTo forward pointing back at this landing so
 * Save/Cancel/Back on any sub-page lands here.
 */

import { TileButton } from "@/components/ui/text-buttons";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getDistrictWebsiteStatus } from "@/services/api";
import { AlertCircle, ImageIcon, Megaphone, Share2, Phone, List, Info, Globe, ExternalLink, Languages, LayoutGrid, Palette } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useIsPathOff } from "@/components/FeatureGate";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

type ModuleKey = "banners" | "advertisements" | "social-media-links" | "contact-details" | "menu-list" | "about" | "languages" | "pages" | "extras" | "theme";

interface Mod {
  key: ModuleKey;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MODULES: Mod[] = [
  { key: "banners",            name: "Banner Photos",       description: "Homepage banner rotation & captions",   icon: ImageIcon },
  { key: "advertisements",     name: "Advertisement Area",  description: "Sponsored slots displayed on the site",  icon: Megaphone },
  { key: "social-media-links", name: "Social Media Links",  description: "Facebook, X, LinkedIn, YouTube, etc.",   icon: Share2 },
  { key: "contact-details",    name: "Contact Details",     description: "Phone, email, address on Contact page",  icon: Phone },
  { key: "menu-list",          name: "Menu List",           description: "Top navigation & footer menu items",     icon: List },
  { key: "about",              name: "About",               description: "About-us content on the public site",    icon: Info },
  { key: "languages",          name: "Languages",           description: "The site in more languages, with machine translation", icon: Languages },
  { key: "pages",              name: "Pages and Layout",    description: "Custom pages and the home page layout",  icon: LayoutGrid },
  { key: "extras",             name: "Website extras",      description: "Social feeds, Google Analytics and QR codes", icon: Share2 },
  { key: "theme",              name: "Website Theme",       description: "Which of the seven designs the public site uses", icon: Palette },
];

export default function MyDistrictWebsitePage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  // returnTo removed from local state — back button was removed on user
  // request; the sub-pages still get an explicit returnTo=/my-district-website
  // in `suffix` below.
  const currentYearId = searchParams.get("yearId");

  // Back button removed on user's request 2026-07-04 — goBack no longer needed.

  // Forward returnTo + yearId to the sub-pages so their own Back button
  // returns HERE (landing) and their yearId stays in sync with the top bar.
  const forwardParams = new URLSearchParams();
  forwardParams.set("returnTo", "/district-admin-dashboard/my-district-website");
  if (currentYearId) forwardParams.set("yearId", currentYearId);
  const suffix = `?${forwardParams.toString()}`;

  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingKey, setNavigatingKey] = useState<ModuleKey | null>(null);
  const isPathOff = useIsPathOff(); // the cards navigate with router.push, so FeatureGate cannot hide them itself

  useEffect(() => {
    if (!districtId) return;
    async function fetchData() {
      try {
        // Pull the district's website subdomain/URL from the district_websites
        // table (via /api/districts/{id}/website-status). Prefers ClientDomain
        // if configured, else falls back to {Subdomain}.example.org
        // resolved on the backend.
        const ws = await getDistrictWebsiteStatus(districtId).catch(() => null);
        // visitUrl comes back like "https://club.example.org/" — for
        // display, strip the scheme AND any trailing slash. We re-add https://
        // on the <a href>. Note: some district_websites rows store the FULL
        // URL (with scheme + slash) in both Subdomain and ClientDomain
        // columns, so we sanitize on the frontend to survive either shape.
        const raw = ws?.visitUrl ?? null;
        setWebsiteUrl(raw ? raw.replace(/^https?:\/\//, "").replace(/\/+$/, "") : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load website info");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [districtId]);

  // URL displayed in the header — sourced from district_websites via the
  // API when configured; otherwise nothing (banner-card shows "not yet
  // configured" text).
  const publicUrl = websiteUrl;

  if (!districtId) return null;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────── */}
      {/* Layout mirrors /club-admin-dashboard/my-club-website:
            small globe icon tile + "My District Website" title, then a
            hyperlinked public URL under it + a Yes/Expired/No status chip.
          Back button removed on user's request 2026-07-04.               */}
      <PageHeader
          title="My District Website"
          description={<><div className="flex items-center gap-2 mt-1 flex-wrap">
              {publicUrl ? (
                <a
                  href={`https://${publicUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-ink hover:underline inline-flex items-center gap-1"
                >
                  {publicUrl}
                  <ExternalLink size={12} />
                </a>
              ) : (
                <span className="text-xs text-slate-500">Website not yet configured</span>
              )}
              {/* Yes/No/Expired status chip removed — the district website
                  is free + compulsory, so no purchase/expiry state to
                  surface. Same reason there's no "Renew" CTA either. */}
            </div></>}
        />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      )}

      {error && (
        <Card className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="row-h2">Error</h3>
          <p className="text-slate-500 mt-2 max-w-md">{error}</p>
        </Card>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.filter((mod) => !isPathOff(`/district-admin-dashboard/my-district-website/${mod.key}`)).map((mod) => {
            const Icon = mod.icon;
            const busy = navigatingKey === mod.key;
            return (
              <TileButton
                key={mod.key}
                onClick={() => {
                  setNavigatingKey(mod.key);
                  router.push(`/district-admin-dashboard/my-district-website/${mod.key}${suffix}`);
                }}
                disabled={busy}
                className={`${busy ? "opacity-60 pointer-events-none" : ""}`}
              >
                <div>
                  <div className="row-tile-icon">
                    {busy ? <RotaryLoader size="sm" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="row-h3">{mod.name}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{mod.description}</p>
                  </div>
                </div>
              </TileButton>
            );
          })}
        </div>
      )}

      {/* District website — open panel. The public district site sends
          X-Frame-Options: SAMEORIGIN, so browsers refuse to embed it inline;
          this panel opens it in a new tab instead (always works). Once the
          site allows framing (CSP frame-ancestors), we can switch back to an
          inline <iframe>. */}
      {!loading && !error && publicUrl && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <Globe size={16} className="text-ink" />
            <h3 className="row-h3">District Website</h3>
          </div>
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-azure/10 text-ink">
              <Globe size={30} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Your public district website</p>
              <a
                href={`https://${publicUrl}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-ink hover:underline"
              >
                {publicUrl}
              </a>
            </div>
            <a
              href={`https://${publicUrl}`}
              target="_blank"
              rel="noreferrer"
              className="row-btn row-btn-primary"
            >
              Open District Website <ExternalLink size={15} />
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
