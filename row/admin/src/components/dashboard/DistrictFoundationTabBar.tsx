"use client";

/**
 * DistrictFoundationTabBar — the "District Projects / District Events" tab strip
 * that stays CONSTANT across the Foundation landing page AND the standalone
 * add/edit pages (projects/v2 + district-events/v2), so the user never loses the
 * section nav when they open a form. Same pattern as DistrictMembershipTabBar.
 *
 * Active tab is derived from the current URL:
 *   - any /projects/v2… path            → District Projects
 *   - any /district-events/v2… path     → District Events
 *   - the foundation landing            → ?tab= param (default "projects")
 *
 * Clicking a tab always lands on the foundation page with ?tab=<key>, carrying
 * yearId (read directly, or parsed out of ?returnTo on the add/edit pages).
 *
 * Added 2026-07-10 per user request "tab bar should be constant / static".
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "projects" | "events";

const TAB_LABELS: Record<TabKey, string> = {
  projects: "District Projects",
  events: "District Events",
};

const FOUNDATION_PATH = "/district-admin-dashboard/foundation";

function activeTabFromPath(pathname: string, tabParam: string | null): TabKey {
  if (pathname.includes("/projects/v2")) return "projects";
  if (pathname.includes("/district-events/v2")) return "events";
  return tabParam === "events" ? "events" : "projects";
}

// yearId lives directly on the foundation URL, but on the add/edit pages it is
// only inside the ?returnTo= value — pull it from whichever is present.
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

export default function DistrictFoundationTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeTabFromPath(pathname, searchParams.get("tab"));
  const yearId = resolveYearId(searchParams);

  const go = (key: TabKey) => {
    if (key === active) return;
    const params = new URLSearchParams();
    params.set("tab", key);
    if (yearId) params.set("yearId", yearId);
    router.push(`${FOUNDATION_PATH}?${params.toString()}`);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
      <Tabs value={active} onValueChange={(v) => go(v as TabKey)}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList
            className="h-auto flex-wrap gap-1 p-1.5"
            style={{ backgroundColor: "#17458f" }}
          >
            {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
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
