"use client";

/**
 * DistrictCommunicationTabBar — the "Upcoming Events / Announcements / Shared
 * Documents / Newsletters / Greetings" tab strip that stays CONSTANT across the
 * Communication landing page AND every standalone add/edit page
 * (upcoming-events/announcements/documents/newsletters v2), so the user never
 * loses the section nav when they open a form. Same pattern as
 * DistrictFoundationTabBar / DistrictMembershipTabBar.
 *
 * Active tab is derived from the current URL:
 *   - /upcoming-events/v2…   → Upcoming Events
 *   - /announcements/v2…     → Announcements
 *   - /documents/v2…         → Shared Documents
 *   - /newsletters/v2…       → Newsletters
 *   - the communication page → ?tab= param (default "events")
 *
 * Clicking a tab lands on the communication page with ?tab=<key>, carrying
 * yearId (read directly, or parsed out of ?returnTo on the add/edit pages).
 *
 * Added 2026-07-10 per user request "static tab bar like foundation menu".
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "events" | "announcements" | "documents" | "newsletters" | "greetings";

const TAB_LABELS: Record<TabKey, string> = {
  events: "Upcoming Events",
  announcements: "Announcements",
  documents: "Documents",
  newsletters: "GML",
  greetings: "Greetings",
};

const COMMUNICATION_PATH = "/district-admin-dashboard/communication";

function activeTabFromPath(pathname: string, tabParam: string | null): TabKey {
  if (pathname.includes("/upcoming-events/v2")) return "events";
  if (pathname.includes("/announcements/v2")) return "announcements";
  if (pathname.includes("/documents/v2")) return "documents";
  if (pathname.includes("/newsletters/v2")) return "newsletters";
  if (
    tabParam === "announcements" ||
    tabParam === "documents" ||
    tabParam === "newsletters" ||
    tabParam === "greetings"
  ) {
    return tabParam;
  }
  return "events";
}

// yearId lives directly on the communication URL, but on the add/edit pages it
// is only inside the ?returnTo= value — pull it from whichever is present.
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

export default function DistrictCommunicationTabBar() {
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
    router.push(`${COMMUNICATION_PATH}?${params.toString()}`);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
      <Tabs value={active} onValueChange={(v) => go(v as TabKey)}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList
            className="h-auto flex-wrap gap-1 p-1.5"
            style={{ backgroundColor: "#1e3a5f" }}
          >
            {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
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
