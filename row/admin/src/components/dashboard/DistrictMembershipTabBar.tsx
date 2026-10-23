"use client";

/**
 * DistrictMembershipTabBar — the "Directory / District Committee / Assistant
 * Governors / Clubs" tab strip that appears on every one
 * of those pages so users can jump between modules without going back to
 * /district-admin-dashboard/membership first.
 *
 * Active tab is derived from the current URL pathname. Clicking a tab
 * navigates to the target module page and preserves ?yearId= from the
 * current URL (so year filter is inherited across module hops).
 *
 * Added 2026-07-10 per user request "tab bar should be constant" — was
 * previously only on the membership page.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "directory" | "districtCommittee" | "assistantGovernors" | "clubs";

const TAB_LABELS: Record<TabKey, string> = {
  directory: "Directory",
  districtCommittee: "District Committee",
  assistantGovernors: "Assistant Governors",
  clubs: "Clubs",
};

// Map each tab key to its landing path AND, in reverse, each landing path
// (or prefix) to its owning tab so the active-highlight can auto-derive.
const TAB_PATHS: Record<TabKey, string> = {
  directory: "/district-admin-dashboard/membership",
  districtCommittee: "/district-admin-dashboard/district-committee",
  assistantGovernors: "/district-admin-dashboard/ag",
  clubs: "/district-admin-dashboard/clubs",
};

function activeTabFromPath(pathname: string): TabKey {
  // Order matters — check most-specific paths first. Membership landing is
  // "/…/membership" so any URL that starts with it belongs to Directory.
  if (pathname.startsWith("/district-admin-dashboard/district-committee")) return "districtCommittee";
  if (pathname.startsWith("/district-admin-dashboard/ag")) return "assistantGovernors";
  if (pathname.startsWith("/district-admin-dashboard/clubs")) return "clubs";
  return "directory";
}

export default function DistrictMembershipTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const active = activeTabFromPath(pathname);

  const go = (key: TabKey) => {
    if (key === active) return;
    const params = new URLSearchParams();
    if (yearId) params.set("yearId", yearId);
    // When jumping to a non-directory tab, wire returnTo back to the
    // membership landing with the current tab preserved so Back on the
    // module page returns to the correct highlighted tab.
    if (key !== "directory") {
      const rt = new URLSearchParams();
      rt.set("tab", key);
      if (yearId) rt.set("yearId", yearId);
      params.set("returnTo", `/district-admin-dashboard/membership?${rt.toString()}`);
    }
    const qs = params.toString();
    router.push(qs ? `${TAB_PATHS[key]}?${qs}` : TAB_PATHS[key]);
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
