"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Users, Calendar, Briefcase, IndianRupee, User as UserIcon,
  ChevronLeft, ChevronRight,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { getAgDashboardClubs } from "@/services/api";
import type { AgClubsResponse, AgClubSummary } from "@/types/agDashboard";
import { fmtInt, fmtInrShort } from "@/components/dashboard/formatters";
import KpiCard from "@/components/dashboard/KpiCard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import { clubWebsiteUrl } from "@/lib/clubWebsite";

import { appLocale } from "@/lib/appFormat";
const PAGE_SIZE = 20;

/* ── Sync + website pills ─────────────────────────────────────────── */
function Pill({ label, tone }: { label: string; tone: "green" | "slate" | "red" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    slate: "bg-slate-100 text-slate-500 border-slate-200",
    red:   "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center text-[9px] font-semibold uppercase tracking-wide border rounded-full px-1.5 py-0.5 whitespace-nowrap ${tones[tone]}`}>
      {label}
    </span>
  );
}

/* ── 2x2 club-card stat cell ──────────────────────────────────────── */
function StatCell({
  icon: Icon, label, value,
}: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400 font-semibold">
        <Icon size={10} /> {label}
      </div>
      <div className="text-sm font-bold text-slate-800 tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}

function ClubCard({
  club, navigating, otherNavigating, onNavigate,
}: {
  club: AgClubSummary;
  navigating: boolean;
  otherNavigating: boolean;
  onNavigate: () => void;
}) {
  const websiteUrl = clubWebsiteUrl(club.clubWebsiteSubdomain);
  return (
    <Link
      href={`/ag-dashboard/clubs/${club.clubId}`}
      onClick={onNavigate}
      className={`block group relative ${otherNavigating ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Club detail can take a moment to load — cover the card so the click
          visibly registers instead of looking dead. */}
      {navigating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
          <RotaryLoader size="md" />
        </div>
      )}
      <div className={`rounded-lg border bg-white p-3 shadow-sm transition-all h-full ${
        navigating ? "border-azure/40" : "border-slate-200 hover:border-azure/40 hover:shadow-md"
      }`}>
        <h3 className="text-sm font-bold text-slate-800 leading-tight group-hover:text-azure transition-colors">
          {club.clubName}
        </h3>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {club.isSyncedFromRotaryOrg
            ? <Pill label="Sync" tone="green" />
            : <Pill label="Non-Sync" tone="slate" />}
          {/* An active site shows its URL instead of a "Yes" pill — the link says
              "yes" and is useful. Expired/none still need a pill to say so. */}
          {club.clubWebsiteStatus === "active" && websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-medium text-azure hover:underline truncate max-w-full"
            >
              {websiteUrl.replace(/^https:\/\//, "")}
            </a>
          ) : club.clubWebsiteStatus === "active" ? (
            // Active but the stored subdomain is unusable — don't claim a link we can't build.
            <Pill label="Website: Yes" tone="green" />
          ) : club.clubWebsiteStatus === "expired" ? (
            <Pill label="Website: Expired" tone="red" />
          ) : (
            <Pill label="Website: No" tone="slate" />
          )}
        </div>
        <div className="mt-1.5 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <UserIcon size={11} className="text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-600 truncate">
              <span className="text-slate-400 mr-1">President:</span>
              {club.presidentName || "N/A"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <UserIcon size={11} className="text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-600 truncate">
              <span className="text-slate-400 mr-1">Secretary:</span>
              {club.secretaryName || "N/A"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          <StatCell icon={Users}        label="Members"   value={fmtInt(club.members)} />
          <StatCell icon={Calendar}     label="Club Service" value={fmtInt(club.clubService)} />
          <StatCell icon={Briefcase}    label="Projects"  value={fmtInt(club.totalProjects)} />
          <StatCell icon={IndianRupee}  label="TRF (INR)" value={fmtInrShort(club.trfTotalInr)} />
        </div>
      </div>
    </Link>
  );
}

/* ── Footer date — falls back to today when API has no lastUpdated ── */
function formatAsOfDate(): string {
  const d = new Date();
  return d.toLocaleDateString(appLocale(), {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default function AgClubsPage() {
  // Wave 9H multi-scope: AG may belong to 1 or many districts. The topbar
  // scope picker writes the selection here; we refetch on change.
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgClubsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [navigatingClubId, setNavigatingClubId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgDashboardClubs(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Failed to load AG clubs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  // Reset to first page whenever search or scope changes
  useEffect(() => { setPage(1); }, [search, selectedDistrictId, yearId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.clubs;
    return data.clubs.filter(
      (c) =>
        c.clubName.toLowerCase().includes(q) ||
        (c.presidentName || "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading AG clubs…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const lastUpdated = formatAsOfDate();

  return (
    <div className="space-y-5">
      {/* KPI cards — same component every other dashboard uses */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Members"   value={fmtInt(data.totalMembers)}       icon={Users}       color="blue" />
        <KpiCard title="Total Club Service" value={fmtInt(data.totalClubService)} icon={Calendar}    color="teal" />
        <KpiCard title="Total Projects"  value={fmtInt(data.totalProjects)}      icon={Briefcase}   color="purple" />
        <KpiCard title="Total TRF (INR)" value={fmtInrShort(data.totalTrfInr)}   icon={IndianRupee} color="gold" />
      </div>

      {/* Search — left aligned */}
      <div className="relative w-full max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clubs..."
          className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-azure focus:border-azure"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-base leading-none font-bold"
          >
            ×
          </button>
        )}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Search size={32} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">
            {search ? "No clubs match your search." : "No clubs assigned to you yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {paged.map((club) => (
              <ClubCard
                key={club.clubId}
                club={club}
                navigating={navigatingClubId === club.clubId}
                otherNavigating={navigatingClubId !== null && navigatingClubId !== club.clubId}
                onNavigate={() => setNavigatingClubId(club.clubId)}
              />
            ))}
          </div>

          {/* Pagination — only when > 20 clubs match */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs text-slate-500 tabular-nums px-2">
                Page {page} of {totalPages} · {filtered.length} clubs
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Footer "Data as of …" */}
      <div className="pt-2 text-right text-xs text-slate-400">
        Data as of {lastUpdated}
      </div>
    </div>
  );
}
