"use client";

/**
 * District Admin · Foundation
 * --------------------------------------------------------------------------
 * Landing page for the Foundation section. Shows the CONSTANT
 * DistrictFoundationTabBar (District Projects / District Events) followed by
 * the active section's listing. The active tab is URL-driven (?tab=) so the
 * same tab bar can live on the standalone add/edit pages and highlight
 * correctly there too.
 */

import { useSearchParams } from "next/navigation";
import { Loader2 } from "@/components/icons";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import DistrictFoundationTabBar from "@/components/dashboard/DistrictFoundationTabBar";
import { DistrictProjectsSection, DistrictEventsSection } from "./sections";

export default function DistrictAdminFoundationPage() {
  const { foundation, status } = useDistrictAdminCache();
  const searchParams = useSearchParams();

  /* ───────────── loading / error / no-data ───────────── */
  if (status === "loading" && !foundation) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (status === "error" && !foundation) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load foundation.
      </div>
    );
  }
  if (!foundation) return null;

  const district = foundation.district;
  const districtId = district.districtId;
  // Global rotary year picked in the topbar. Sections use ONLY this value —
  // they don't render their own year dropdown. 0 = not-yet-resolved (fetch
  // skipped until the topbar plants the current year in the URL).
  const currentYearIdParam = searchParams?.get("yearId") ?? "";
  const activeYearId = Number(currentYearIdParam) || 0;

  // Which section is showing — driven by ?tab= so the constant tab bar (here
  // AND on the add/edit pages) stays in sync. Default = projects.
  const activeTab = searchParams?.get("tab") === "events" ? "events" : "projects";

  // returnTo preserves BOTH the active tab and the topbar year so add/edit/
  // delete/back on the v2 pages land back on the correct tab + year.
  const returnTo =
    `/district-admin-dashboard/foundation?tab=${activeTab}` +
    (currentYearIdParam ? `&yearId=${currentYearIdParam}` : "");

  return (
    <div className="space-y-6">
      <DistrictFoundationTabBar />

      <div>
        {activeTab === "projects" ? (
          <DistrictProjectsSection districtId={districtId} yearId={activeYearId} returnTo={returnTo} />
        ) : (
          <DistrictEventsSection districtId={districtId} yearId={activeYearId} returnTo={returnTo} />
        )}
      </div>
    </div>
  );
}
