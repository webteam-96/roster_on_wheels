"use client";

/**
 * DistrictEgovernanceTabBar — the e-governance tab strip (Club Monthly Report /
 * PPH Camp / District Awards / Reports) that stays CONSTANT across the egovernance
 * landing page AND the standalone PPH Camp add/edit/listing pages, so the section
 * nav is never lost when a form opens. Same pattern as DistrictFoundationTabBar.
 *
 * Active tab from URL: any /pph-camps… path → PPH Camp; else the ?tab= param.
 * Clicking a tab lands on the egovernance page with ?tab=<key>, carrying yearId
 * (read directly, or parsed out of ?returnTo on the add/edit pages).
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";

type TabKey = "cmr" | "pps" | "citation" | "reports";

const TAB_LABELS: Record<TabKey, string> = {
  cmr: "Club Monthly Report",
  pps: "PPH Camp",
  citation: "District Awards",
  reports: "Reports",
};
const TAB_KEYS = Object.keys(TAB_LABELS) as TabKey[];

const EGOV_PATH = "/district-admin-dashboard/egovernance";

function activeTabFromPath(pathname: string, tabParam: string | null): TabKey {
  if (pathname.includes("/pph-camps")) return "pps";
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
  const { selectedDistrictId } = useAuth();
  const active = activeTabFromPath(pathname, searchParams.get("tab"));
  const yearId = resolveYearId(searchParams);

  // districtId: from /districts/{id}/… path, else ?districtId= query (used when a
  // club page like /clubs/{id}/citation/v2 is opened from the district), else scope.
  const pathMatch = /\/districts\/(\d+)(?:\/|$)/.exec(pathname);
  const queryDistrictId = Number(searchParams.get("districtId")) || 0;
  const districtId = pathMatch ? Number(pathMatch[1]) : (queryDistrictId || (selectedDistrictId ?? 0));

  const go = (key: TabKey) => {
    // "PPH Camp" jumps straight to the full PPH management page, not the egovernance
    // summary tab. Carries a returnTo back to the egovernance PPH tab.
    if (key === "pps") {
      if (active === "pps" && pathname.includes("/pph-camps")) return;
      const rt = encodeURIComponent(`${EGOV_PATH}?tab=pps`);
      router.push(`/districts/${districtId}/pph-camps/v2?returnTo=${rt}`);
      return;
    }
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
            style={{ backgroundColor: "#1e3a5f" }}
          >
            {TAB_KEYS.map((k) => (
              <TabsTrigger
                key={k}
                value={k}
                className="text-sm font-semibold px-3.5 py-1.5 rounded-md text-white hover:bg-white/10 data-[state=active]:bg-[#F7A81B] data-[state=active]:text-[#1e3a5f] data-[state=active]:shadow-sm"
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
