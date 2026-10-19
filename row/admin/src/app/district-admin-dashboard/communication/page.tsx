"use client";

/**
 * District Admin · Communication tab
 * --------------------------------------------------------------------------
 * Visual layout — mirrors /club-admin-dashboard/communication:
 *
 *   Header: "Communication" + subtitle
 *
 *   Row 1 - KPI strip (5 cards):
 *     Upcoming Events · Active Announcements · Newsletters
 *     · Shared Documents · Greetings Today
 *
 *   Row 2 - Tab strip (navy #17458f + gold #F7A81B pills — same visual as
 *   service-projects-and-public-image):
 *     Upcoming Events | Announcements | Shared Documents | Newsletters | Greetings
 *
 *   Row 3 - Only the selected tab's section renders below.
 *     Default = Upcoming Events.
 *
 * Data sources:
 *   - Events / Announcements / Documents / Newsletters — district-scoped
 *     endpoints (see ./sections.tsx). Add/Edit deep-link to the v1 pages
 *     under /districts/[id]/{module}/(add|[id]/edit).
 *   - Greetings — aggregated across all clubs in the district, taken
 *     straight from useDistrictAdminCache().communication.greetings.
 */

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Megaphone,
  FileText,
  CalendarDays,
  Folder,
  PartyPopper,
  Pencil,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { fmtInt } from "@/components/dashboard/formatters";
import type { DistrictAdminGreetingItem } from "@/types/districtAdminDashboard";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import DistrictCommunicationTabBar from "@/components/dashboard/DistrictCommunicationTabBar";
import {
  UpcomingEventsSection,
  AnnouncementsSection,
  DocumentsSection,
  NewslettersSection,
} from "./sections";

// ──────────────────────────────────────────────────────────────────────────
// Tab keys
// ──────────────────────────────────────────────────────────────────────────

type CommTab = "events" | "announcements" | "documents" | "newsletters" | "greetings";
type GreetingsBucket = "today" | "this_week" | "next_week";

function isCommTab(v: string | null): v is CommTab {
  return v === "events" || v === "announcements" || v === "documents" || v === "newsletters" || v === "greetings";
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function DistrictAdminCommunicationPage() {
  const { communication, status } = useDistrictAdminCache();
  const searchParams = useSearchParams();

  // Active tab is URL-driven (?tab=) so the constant DistrictCommunicationTabBar —
  // here AND on the standalone add/edit pages — stays in sync. Default = events.
  const tabParam = searchParams?.get("tab") ?? null;
  const activeTab: CommTab = isCommTab(tabParam) ? tabParam : "events";

  // Greetings sub-tab (component state only — the outer tab is chosen via ?tab=).
  const [greetingsBucket, setGreetingsBucket] = useState<GreetingsBucket>("today");

  if (status === "loading" && !communication) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading…" />
      </div>
    );
  }
  if (!communication) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load communication data.
      </div>
    );
  }

  const data = communication;
  const districtId = data.district.districtId;
  const documentsCount = data.documentCount ?? 0;
  const greetingsTodayCount = data.greetingsTodayCount ?? 0;

  return (
    <div className="space-y-6">
      {/* ────── Top KPI row (5 cards) ────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Upcoming Events"
          value={fmtInt(data.upcomingEventCount)}
          subtitle="Scheduled ahead"
          icon={CalendarDays}
          color="blue"
        />
        <KpiCard
          title="Active Announcements"
          value={fmtInt(data.announcementCount)}
          subtitle="Currently published"
          icon={Megaphone}
          color="purple"
        />
        <KpiCard
          title="GML"
          value={fmtInt(data.newsletterCount)}
          subtitle="Total published"
          icon={FileText}
          color="green"
        />
        <KpiCard
          title="Documents"
          value={documentsCount === null ? "–" : fmtInt(documentsCount)}
          subtitle="Available to members"
          icon={Folder}
          color="gold"
        />
        <KpiCard
          title="Greetings Today"
          value={greetingsTodayCount === null ? "–" : fmtInt(greetingsTodayCount)}
          subtitle="Birthdays & anniversaries"
          icon={PartyPopper}
          color="red"
        />
      </div>

      {/* ────── Tab strip (constant — shared with the add/edit pages) ────── */}
      <DistrictCommunicationTabBar />

      {/* ────── Selected tab's section ────── */}
      {activeTab === "events"        && <UpcomingEventsSection districtId={districtId} />}
      {activeTab === "announcements" && <AnnouncementsSection  districtId={districtId} />}
      {activeTab === "documents"     && <DocumentsSection      districtId={districtId} />}
      {activeTab === "newsletters"   && <NewslettersSection    districtId={districtId} />}
      {activeTab === "greetings"     && (
        <GreetingsSection
          districtId={districtId}
          bucket={greetingsBucket}
          onBucketChange={setGreetingsBucket}
          greetings={data.greetings ?? []}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Greetings — aggregated across all clubs in the district
// ──────────────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtGreetingDate(s: string | null | undefined): string {
  if (!s) return "–";
  // Backend returns either "MM-DD" or "YYYY-MM-DD".
  const mmdd = s.length === 5 ? s : s.slice(5);
  const [m, d] = mmdd.split("-").map((x) => parseInt(x, 10));
  if (!m || !d) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1] ?? ""}`.trim();
}

function GreetingsSection({
  districtId,
  bucket,
  onBucketChange,
  greetings,
}: {
  districtId: number;
  bucket: GreetingsBucket;
  onBucketChange: (b: GreetingsBucket) => void;
  greetings: DistrictAdminGreetingItem[];
}) {
  const filtered = greetings.filter((g) => g.bucket === bucket);
  const tabs: { key: GreetingsBucket; label: string }[] = [
    { key: "today",     label: "Today" },
    { key: "this_week", label: "This Week" },
    { key: "next_week", label: "Next Week" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <PartyPopper size={16} className="text-rose-600" />
        <h3 className="text-sm font-semibold text-slate-800">Greetings</h3>
        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href={`/districts/${districtId}/greetings?returnTo=${encodeURIComponent("/district-admin-dashboard/communication?tab=greetings")}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
            title="Edit birthday & anniversary messages"
          >
            <Pencil size={12} /> Edit messages
          </Link>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            {fmtInt(filtered.length)}
          </span>
        </div>
      </div>

      <div className="px-3 pt-2 pb-1 border-b border-slate-100 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onBucketChange(t.key)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              bucket === t.key
                ? "bg-rose-100 text-rose-800 border border-rose-200"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center flex-1 flex flex-col items-center justify-center gap-2">
          <PartyPopper className="h-10 w-10 text-slate-300" />
          <p className="text-xs text-slate-400">
            No greetings {bucket === "today" ? "today" : bucket === "this_week" ? "this week" : "next week"}.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 flex-1 max-h-[600px] overflow-y-auto">
          {filtered.map((g) => (
            <li key={g.memberId + "-" + g.kind + "-" + g.date} className="px-5 py-2.5 flex items-center gap-3">
              <Avatar className="h-9 w-9 flex-shrink-0">
                {g.photoPath && <AvatarImage src={g.photoPath} alt={g.name} />}
                <AvatarFallback className="text-[11px] font-semibold bg-slate-100 text-slate-600">
                  {initials(g.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{g.name}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {g.clubName ?? "–"}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  g.kind === "birthday"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-pink-50 text-pink-700 border-pink-200"
                }`}>
                  {g.kind === "birthday" ? "Birthday" : "Anniversary"}
                </span>
                <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">{fmtGreetingDate(g.date)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
