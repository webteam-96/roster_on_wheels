"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getServiceProjectsAvenue } from "@/services/api";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ServiceProjectsAvenueDetailResponse } from "@/types/clubAdminDashboard";
import { ListPageSkeleton } from "@/components/row/AppKit";
import { AvenueTab, isAvenueTab } from "./spiHelpers";
import { AvenueHeader, AvenueTabBar, OverviewSection, AvenueSection } from "./SpiAvenueSections";


export default function ServiceProjectsAndPublicImagePage() {
  const { serviceProjectsOverview, status } = useClubAdminCache();
  const { selectedClubId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial tab is read from ?tab= — falls back to "all" when absent or unknown.
  const initialTab: AvenueTab = (() => {
    const t = searchParams?.get("tab");
    return isAvenueTab(t) ? t : "all";
  })();

  const [activeTab, setActiveTab] = useState<AvenueTab>(initialTab);
  // Year now comes from the global topbar selector via URL ?yearId= — local
  // dropdown removed per user request (2026-06-12, items #11 & #12).
  const urlYearStr = searchParams?.get("yearId");
  const yearId = urlYearStr ? parseInt(urlYearStr, 10) || null : null;
  const [avenueData, setAvenueData] = useState<ServiceProjectsAvenueDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep ?tab= in sync with the active tab. Uses router.replace so each tab
  // click does not push a new history entry. Omits ?tab= for "all" (default)
  // so the URL stays clean on first paint.
  const handleTabChange = (next: AvenueTab) => {
    setActiveTab(next);
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Overview is served from the context cache (prefetched at layout mount).
  const overview = serviceProjectsOverview;

  // Per-avenue cache keyed on `${tab}|${yearId}` so re-clicking a tab + year
  // combo doesn't re-hit the API, AND switching year naturally misses the
  // cache (the previous design used a separate invalidation useEffect which
  // raced the fetch effect — stale data leaked through when topbar year
  // changed while a non-All tab was active).
  const [avenueCache, setAvenueCache] = useState<Map<string, ServiceProjectsAvenueDetailResponse>>(
    () => new Map(),
  );
  // Club is part of the cache key so a multi-club admin swapping clubs never sees
  // another club's cached avenue data.
  const cacheKey = `${activeTab}|${yearId ?? 0}|${selectedClubId ?? 0}`;

  // Avenue detail loads when a non-All tab is selected. Cached results render
  // instantly; only a cache miss triggers a fresh fetch.
  useEffect(() => {
    if (activeTab === "all") { setAvenueData(null); setLoading(false); return; }
    const cached = avenueCache.get(cacheKey);
    if (cached) { setAvenueData(cached); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setAvenueData(null);
    getServiceProjectsAvenue(activeTab, yearId, selectedClubId)
      .then((d) => {
        if (cancelled) return;
        setAvenueData(d);
        setAvenueCache((prev) => {
          const next = new Map(prev);
          next.set(cacheKey, d);
          return next;
        });
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load avenue."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // avenueCache intentionally excluded — cache writes from a successful fetch
    // would otherwise re-run this effect and re-render twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, yearId, cacheKey]);

  // Called by AvenueSection after a successful delete — drops the cached copy
  // for the current tab+year combo and re-fetches so KPIs and rows are fresh.
  const refreshCurrentAvenue = useCallback(async () => {
    if (activeTab === "all") return;
    setAvenueCache((prev) => {
      const next = new Map(prev);
      next.delete(cacheKey);
      return next;
    });
    setLoading(true);
    try {
      const d = await getServiceProjectsAvenue(activeTab, yearId, selectedClubId);
      setAvenueData(d);
      setAvenueCache((prev) => {
        const next = new Map(prev);
        next.set(cacheKey, d);
        return next;
      });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to refresh avenue.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, yearId, cacheKey]);

  if (status === "loading" && !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (status === "error" && !overview) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load.</div>;
  }
  if (!overview) return null;

  return (
    <div className="space-y-5">
      <AvenueHeader club={overview.club} />
      <AvenueTabBar active={activeTab} onChange={handleTabChange} />

      {activeTab === "all" ? (
        <OverviewSection overview={overview} />
      ) : (
        <AvenueSection
          tab={activeTab}
          data={avenueData}
          loading={loading}
          yearId={yearId}
          clubId={overview.club.clubId}
          onRefresh={refreshCurrentAvenue}
        />
      )}
    </div>
  );
}

// ── Top header ─────────────────────────────────────────────────────────

