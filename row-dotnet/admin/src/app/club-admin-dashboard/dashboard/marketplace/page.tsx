"use client";

import { useEffect, useState } from "react";
import {
  Store, ListChecks, IdCard, Globe, ExternalLink, Clock, Hourglass,
  Construction,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import { getClubAdminDashboardMarketplace } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type { ClubAdminDashboardMarketplaceResponse } from "@/types/clubAdminDashboard";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";

// Marketplace is temporarily shown as Coming Soon per user request
// (2026-06-12). The full implementation lives below as MarketplaceImpl —
// DO NOT remove. To re-enable, change the default export back to
// MarketplaceImpl and delete the ComingSoonBanner export. Targeted re-enable
// next week.
export default function DashboardMarketplacePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="rounded-full bg-amber-100 p-5 mb-5">
        <Construction className="h-10 w-10 text-amber-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Marketplace — Coming Soon</h2>
      <p className="text-slate-500 max-w-md text-sm">
        The Club Marketplace is under final review and will be available shortly.
        Listings, member discounts, and club services will appear here once enabled.
      </p>
    </div>
  );
}

// Note: the dynamic "Coming Soon — Launches on {date}" copy is rendered
// globally by ComingSoonStub (DashboardShell mounts it whenever the route's
// module is flagged Coming Soon). The static banner below is just the
// feature-not-yet-built placeholder shown when SA has NOT toggled the
// marketplace module to Coming Soon.

function listingStatusChip(status: string) {
  const s = status.toLowerCase();
  if (s.includes("open")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (s.includes("close")) return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

// PRESERVED — the full marketplace implementation. Will be re-enabled when
// listings + member-discount feature lands (next week). Do not delete.
function MarketplaceImpl() {
  const { selectedClubId } = useAuth();
  const [data, setData] = useState<ClubAdminDashboardMarketplaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClubAdminDashboardMarketplace(null, selectedClubId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load marketplace."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedClubId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading marketplace…" />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Coming Soon banner — the Rotary Web Marketplace integration is not yet live. */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <Hourglass size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-amber-900">Coming Soon</h2>
          <p className="text-xs text-amber-800 mt-0.5">
            The Rotary Web Marketplace feature is currently under development and not yet
            available. The information below is a preview of the upcoming experience —
            listings, subscriptions, and account details shown here are not live data.
          </p>
        </div>
      </div>

      {/* Everything below the Coming Soon banner is preview content only — wrap
          in a non-interactive container so KPIs, listings, account details, and
          the (disabled) Launch button cannot be clicked while the feature ships. */}
      <div className="pointer-events-none select-none opacity-95 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Subscription"
            value="Coming Soon"
            subtitle="Rotary Web Marketplace"
            icon={Clock}
            color="gold"
          />
          <KpiCard
            title="Club Listings"
            value={fmtInt(data.clubListingsCount)}
            subtitle="Published on marketplace"
            icon={ListChecks}
            color="blue"
          />
          <KpiCard
            title="Member ID"
            value={data.memberId}
            subtitle="Registered club account"
            icon={IdCard}
            color="purple"
          />
          <KpiCard
            title="Platform"
            value={data.platform}
            subtitle={data.platformUrl}
            icon={Globe}
            color="gold"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Store size={22} />
          </div>
          <h2 className="text-base font-bold text-slate-800">Rotary Web Marketplace</h2>
          <p className="text-xs text-slate-500 mt-0.5">{data.platformUrl}</p>
          <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto">
            The ROW Web Marketplace is an external platform for clubs to list and discover
            member businesses, services, products, and social enterprises. Click below to open your
            club&apos;s marketplace portal.
          </p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-slate-200 text-slate-500 cursor-not-allowed"
          >
            <ExternalLink size={14} /> Launch Marketplace
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">What is the Marketplace?</h3>
            <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4">
              <li>List member businesses, products, and professional services</li>
              <li>Browse offerings from Rotary members across the district</li>
              <li>Promote social enterprises and NGO initiatives</li>
              <li>Create event listings with online payment links</li>
              <li>Connect with fellow Rotarian entrepreneurs</li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Your Club&apos;s Listings</h3>
              <span className="text-xs text-slate-400">Recently published on marketplace</span>
            </div>
            {data.listings.length === 0 ? (
              <p className="text-xs text-slate-400">No active listings yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.listings.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{l.title}</p>
                      <p className="text-slate-500">{fmtDate(l.date)}</p>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${listingStatusChip(l.status)}`}>
                      {l.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Account Details</h3>
            <dl className="text-xs space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Club</dt>
                <dd className="font-medium text-slate-800 text-right truncate max-w-[60%]">{data.account.clubName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Marketplace ID</dt>
                <dd className="font-medium text-slate-800">{data.account.marketplaceId}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">District</dt>
                <dd className="font-medium text-slate-800">{data.account.districtNumber || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Subscription</dt>
                <dd className="font-medium text-emerald-700">{data.account.subscription}</dd>
              </div>
              {data.account.contactSupport && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Contact Support</dt>
                  <dd className="font-medium text-slate-800 truncate max-w-[60%]">{data.account.contactSupport}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
