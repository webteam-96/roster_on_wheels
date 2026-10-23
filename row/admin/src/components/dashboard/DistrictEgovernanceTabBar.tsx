"use client";

/**
 * DistrictEgovernanceTabBar — the e-governance tab strip (Club Monthly Report /
 * District Awards / Reports) that stays CONSTANT across the egovernance
 * landing page AND the standalone CMR month and club citation pages, so the section
 * nav is never lost when a form opens. Same pattern as DistrictFoundationTabBar.
 *
 * Active tab from URL: /citation and /club-monthly-report paths pick their tab; else the ?tab= param.
 * Clicking a tab lands on the egovernance page with ?tab=<key>, carrying yearId
 * (read directly, or parsed out of ?returnTo on the add/edit pages).
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeatureOn } from "@/components/FeatureGate";

type TabKey = "cmr" | "citation" | "reports";

const TAB_LABELS: Record<TabKey, string> = {
  cmr: "Club Monthly Report",
  citation: "District Awards",
  reports: "Reports",
};
const TAB_KEYS = Object.keys(TAB_LABELS) as TabKey[];

const EGOV_PATH = "/district-admin-dashboard/egovernance";

function activeTabFromPath(pathname: string, tabParam: string | null): TabKey {
  if (pathname.includes("/citation")) return "citation";
  if (pathname.includes("/club-monthly-report")) return "cmr";
  const t = (tabParam || "") as TabKey;
  return TAB_KEYS.includes(t) ? t : "cmr";
}

function resolveYearId(sp: URLSearchParams): string | null {
  const direct = sp.get("yearId");
  if (direct) return direct;
  const rt = sp.get("returnTo");
  if (rt) {
    try {
      const m = /[?&]yearId=(\d+)/.exec(decodeURIComponent(rt));
      if (m) return m[1];
    } catch {
      /* ignore malformed returnTo */
    }
  }
  return null;
}

export default function DistrictEgovernanceTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeTabFromPath(pathname, searchParams.get("tab"));
  // ROW module switches (components/FeatureGate): skipped or switched-off modules lose their tab
  const tabOn: Record<TabKey, boolean> = { cmr: useFeatureOn("club_monthly_report"), citation: true, reports: true };
  const yearId = resolveYearId(searchParams);

  const go = (key: TabKey) => {
    if (key === active && pathname.includes(EGOV_PATH)) return;
    const params = new URLSearchParams();
    params.set("tab", key);
    if (yearId) params.set("yearId", yearId);
    router.push(`${EGOV_PATH}?${params.toString()}`);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
      <Tabs value={active} onValueChange={(v) => go(v as TabKey)}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList
            className="h-auto flex-wrap gap-1 p-1.5"
            style={{ backgroundColor: "#17458f" }}
          >
            {TAB_KEYS.filter((k) => tabOn[k]).map((k) => (
              <TabsTrigger
                key={k}
                value={k}
                className="text-sm font-semibold px-3.5 py-1.5 rounded-md text-white hover:bg-white/10 data-[state=active]:bg-marigold data-[state=active]:text-ink data-[state=active]:shadow-sm"
              >
                {TAB_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
    </div>
  );
}
