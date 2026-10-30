"use client";

/**
 * Club Admin · Communication tab
 * --------------------------------------------------------------------------
 * Visual layout:
 *
 *   Header: "Communication" + subtitle
 *
 *   Row 1 - KPI strip (5 cards):
 *     Upcoming Events · Active Announcements · Newsletters
 *     · Shared Documents · Greetings Today
 *
 *   Row 2 - Tab strip (navy/gold pill style — same as service-projects-and-public-image):
 *     Upcoming Events | Announcements | Shared Documents | Newsletters | Greetings
 *
 *   Row 3 - Only the selected tab's section renders below.
 *     Default = Upcoming Events.
 *
 * Data comes from `useClubAdminCache().communication`
 * (ClubAdminCommunicationResponse).
 *
 * "View All" link targets:
 *   - Upcoming Events  → /clubs/[clubId]/upcoming-events           (no v2 yet)
 *   - Announcements    → /clubs/[clubId]/announcements/v2
 *   - Greetings        → /clubs/[clubId]/greetings                 (no v2 yet)
 *   - Documents        → /clubs/[clubId]/documents/v2
 *   - Newsletters      → /clubs/[clubId]/newsletters/v2
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Megaphone,
  FileText,
  CalendarDays,
  Folder,
  PartyPopper,
  Pencil,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { fmtInt } from "@/components/dashboard/formatters";
import {
  UpcomingEventsSection,
  AnnouncementsSection,
  DocumentsSection,
  NewslettersSection,
} from "./sections";
import MassEmailSection from "./MassEmailSection";
import SubGroupsSection from "./SubGroupsSection";
import WebLinksSection from "./WebLinksSection";
import { ListPageSkeleton } from "@/components/row/AppKit";

// ──────────────────────────────────────────────────────────────────────────
// Tab keys
// ──────────────────────────────────────────────────────────────────────────

type CommTab = "events" | "announcements" | "documents" | "newsletters" | "greetings" | "massemail" | "subgroups" | "weblinks";
type GreetingsSubTab = "today" | "week" | "month";

const COMM_TABS: { key: CommTab; label: string }[] = [
  { key: "events",        label: "Upcoming Events" },
  { key: "announcements", label: "Announcements" },
  { key: "documents",     label: "Documents" },
  { key: "newsletters",   label: "Newsletters" },
  { key: "greetings",     label: "Greetings" },
  { key: "massemail",     label: "Mass Email" },
  { key: "subgroups",     label: "Subgroups" },
  { key: "weblinks",      label: "Web Links" },
];

function isCommTab(v: string | null): v is CommTab {
  return v === "events" || v === "announcements" || v === "documents" || v === "newsletters" || v === "greetings" || v === "massemail" || v === "subgroups" || v === "weblinks";
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function ClubAdminCommunicationPage() {
  const { communication, status } = useClubAdminCache();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Main tab from URL ?tab= — default "events" (Upcoming Events selected first).
  const initialTab: CommTab = (() => {
    const t = searchParams?.get("tab");
    return isCommTab(t) ? t : "events";
  })();
  const [activeTab, setActiveTab] = useState<CommTab>(initialTab);

  // Greetings sub-tab (Today / Week / Month) — component state only, no URL
  // persistence (the greetings tab itself is chosen via ?tab=).
  const [greetingsSubTab, setGreetingsSubTab] = useState<GreetingsSubTab>("today");

  const handleTabChange = (next: CommTab) => {
    setActiveTab(next);
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    if (next === "events") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (status === "loading" && !communication) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
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
  const clubId = data.club.clubId;
  const documentsCount = data.documentCount ?? 0;
  const greetingsTodayCount = data.greetingsTodayCount ?? 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Communication"
        subtitle={`${data.club.clubName} · Events, announcements, newsletters, documents & greetings`}
        icon={Megaphone}
      />

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
          title="Newsletters"
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

      {/* ────── Tab strip (navy/gold — same as service-projects-and-public-image) ────── */}
      <CommTabBar active={activeTab} onChange={handleTabChange} />

      {/* ────── Selected tab's section ────── */}
      {activeTab === "events"        && <UpcomingEventsSection clubId={clubId} />}
      {activeTab === "announcements" && <AnnouncementsSection  clubId={clubId} />}
      {activeTab === "documents"     && <DocumentsSection      clubId={clubId} />}
      {activeTab === "newsletters"   && <NewslettersSection    clubId={clubId} />}
      {activeTab === "greetings"     && (
        <GreetingsColumn
          clubId={clubId}
          tab={greetingsSubTab}
          onTabChange={setGreetingsSubTab}
          birthdays={data.birthdaysThisMonth ?? []}
          anniversaries={data.anniversariesThisMonth ?? []}
        />
      )}
      {activeTab === "massemail"     && <MassEmailSection clubId={clubId} />}
      {activeTab === "subgroups"     && <SubGroupsSection clubId={clubId} />}
      {activeTab === "weblinks"      && <WebLinksSection clubId={clubId} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tab strip — visual parity with service-projects-and-public-image
// ──────────────────────────────────────────────────────────────────────────

function CommTabBar({ active, onChange }: { active: CommTab; onChange: (k: CommTab) => void }) {
  return (
    <div className="overflow-x-auto">
      <div
        className="inline-flex items-center gap-1 rounded-full p-1.5 bg-muted"
      >
        {COMM_TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`inline-flex h-9 items-center px-4 text-sm font-semibold rounded-full whitespace-nowrap transition-colors ${
                isActive ? "bg-card text-foreground ring-1 ring-[color:var(--row-line)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
// Column: Greetings
// ──────────────────────────────────────────────────────────────────────────

function GreetingsColumn({
  clubId, tab, onTabChange, birthdays, anniversaries,
}: {
  clubId: number;
  tab: GreetingsSubTab;
  onTabChange: (t: GreetingsSubTab) => void;
  birthdays: { name: string; mobile: string | null; day: number; kind: string }[];
  anniversaries: { name: string; mobile: string | null; day: number; kind: string }[];
}) {
  const todayDay = new Date().getDate();
  // Inclusive 7-day window starting today. Month wraps are rare (only matters
  // for last-week-of-month tabs), so a simple [today, today+6] is fine.
  const weekEnd = todayDay + 6;
  const all = [...birthdays, ...anniversaries];
  const filtered = all.filter((r) => {
    if (tab === "today") return r.day === todayDay;
    if (tab === "week") return r.day >= todayDay && r.day <= weekEnd;
    return true; // month
  }).sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));

  const tabs: { key: GreetingsSubTab; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <PartyPopper size={16} className="text-rose-600" />
        <h3 className="text-sm font-semibold text-slate-800">Greetings</h3>
        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href={`/clubs/${clubId}/greetings?returnTo=${encodeURIComponent("/club-admin-dashboard/communication?tab=greetings")}`}
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
            onClick={() => onTabChange(t.key)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              tab === t.key
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
          <p className="text-xs text-slate-400">No greetings {tab === "today" ? "today" : tab === "week" ? "this week" : "this month"}.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 flex-1 max-h-72 overflow-y-auto">
          {filtered.slice(0, 30).map((r, i) => (
            <li key={i} className="px-5 py-2 flex items-center gap-2">
              <span className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold border ${
                r.kind === "birthday"
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-pink-50 text-pink-700 border-pink-200"
              }`} title={r.kind === "birthday" ? "Birthday" : "Anniversary"}>
                {r.day}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{r.mobile || "–"}</p>
              </div>
              <span className={`text-[10px] font-semibold uppercase shrink-0 ${
                r.kind === "birthday" ? "text-blue-600" : "text-pink-600"
              }`}>
                {r.kind === "birthday" ? "bday" : "anniv"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
