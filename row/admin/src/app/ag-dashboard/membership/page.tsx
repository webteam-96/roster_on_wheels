"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp, Users, BookOpen, ClipboardList, Globe, ChevronUp, ChevronDown,
  Activity, Award, ChevronLeft, ChevronRight, PieChart as PieIcon, BarChart3,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { getAgDashboardMembership } from "@/services/api";
import type { AgMembershipResponse, AgMembershipClubRow } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import SectionHeader from "@/components/dashboard/SectionHeader";
import KpiCard from "@/components/dashboard/KpiCard";
import {
  fmtInt, fmtInr, fmtInrShort, ROTARY_BLUE, ROTARY_GOLD, ROTARY_TEAL, ROTARY_GREEN, CLUB_PALETTE, truncate,
} from "@/components/dashboard/formatters";

import { appLocale } from "@/lib/appFormat";
// Wave 13A2: backend sends `goalsCitations` per club but the shared TS type
// hasn't been regenerated yet — extend it locally so we can render the GCs
// column without breaking the contract type.
type ClubRow = AgMembershipClubRow & { goalsCitations?: number };

type SortKey =
  | "clubName"
  | "members"
  | "clubService"
  | "totalProjects"
  | "trf"
  | "goalsCitations"
  | "projectRank";

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Pending chip — for fields the backend has not yet wired (e.g. national rank,
// data-as-of). Re-used across the page so the visual language stays uniform.
// ─────────────────────────────────────────────────────────────────────────────
function PendingChip({ label = "Pending" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      {label}
    </span>
  );
}

function Th({
  label, colKey, sortKey, sortDir, onSort, align = "left", className = "",
}: {
  label: string; colKey: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "left" | "right"; className?: string;
}) {
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`px-3 py-2.5 text-${align} text-xs font-semibold text-slate-600 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 transition-colors ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {sortKey === colKey ? (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
      </span>
    </th>
  );
}

export default function AgMembershipPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgMembershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("members");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    // Wave 9G: scope to AG-selected district when set.
    getAgDashboardMembership(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Failed to load membership."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "clubName" ? "asc" : "desc"); }
    setPage(1);
  };

  const sorted = useMemo<ClubRow[]>(() => {
    if (!data) return [];
    const rows = data.clubs as ClubRow[];
    return [...rows].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number | string;
      const bv = (b[sortKey] ?? 0) as number | string;
      const cmp = typeof av === "string"
        ? av.localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading membership…" />
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!data) return null;

  const clubCount = Math.max(1, data.clubs.length);
  const totalMembers = data.totalMembers || 0;

  // ── chart datasets ────────────────────────────────────────────────────────
  const barData = data.clubs.map((c, i) => ({
    name: truncate(c.clubName, 12),
    fullName: c.clubName,
    Members: c.members,
    "Club Service": c.clubService,
    Projects: c.totalProjects,
    color: CLUB_PALETTE[i % CLUB_PALETTE.length],
  }));

  // "Club Activity at a Glance" — stacked secondary view (totals per club).
  // Uses TRF-in-thousands so it fits on the same axis as Club Service/Projects.
  const activityData = data.clubs.map((c, i) => ({
    name: truncate(c.clubName, 12),
    fullName: c.clubName,
    Activity: c.clubService + c.totalProjects,
    "Club Service": c.clubService,
    Projects: c.totalProjects,
    color: CLUB_PALETTE[i % CLUB_PALETTE.length],
  }));

  const pieData = data.clubs.map((c, i) => ({
    name: c.clubName,
    value: c.members,
    color: CLUB_PALETTE[i % CLUB_PALETTE.length],
  }));

  // ── bottom 4 summary cards ────────────────────────────────────────────────
  // Spec calls for per-club summary (Members + growth + active count). Backend
  // does not yet provide growth or active separately, so we render:
  //   • headline club value (members)
  //   • % share of AG total
  //   • Pending chip for "MoM growth" which the API doesn't expose yet
  const summaryClubs = (data.clubs as ClubRow[]).slice(0, 4);

  // "Data as of" — backend has not yet exposed a timestamp on this endpoint;
  // fall back to "today" with a Pending chip so it's obvious to the AG that
  // this is not authoritative until Wave 13A2 ships the real field.
  const dataAsOf = new Date().toLocaleDateString(appLocale(), {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* ── PAGE HEADER ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 leading-tight">Membership</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>
              AG: <span className="font-medium text-slate-700">{data.ag.name || "–"}</span>
            </span>
            <span className="text-slate-300">·</span>
            <span>
              RY <span className="font-medium text-slate-700">{data.ag.yearLabel || "–"}</span>
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5">
              Data as of <span className="font-medium text-slate-700">{dataAsOf}</span>
              <PendingChip label="Live" />
            </span>
          </p>
        </div>
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
          {data.clubs.length} club{data.clubs.length === 1 ? "" : "s"} · District {data.ag.districtNumber || "–"}
        </div>
      </div>

      {/* ── SECTION BANNER + KPI TILES ────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-blue-50/40 p-5 space-y-4">
        <SectionHeader
          title="Membership Overview"
          subtitle={`All ${data.clubs.length} clubs · District ${data.ag.districtNumber || "–"} · Year ${data.ag.yearLabel || "–"}`}
          icon={TrendingUp}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Members"
            value={fmtInt(totalMembers)}
            subtitle={`Across ${data.clubs.length} club${data.clubs.length === 1 ? "" : "s"}`}
            icon={Users}
            color="blue"
          />
          <KpiCard
            title="Total Club Service"
            value={fmtInt(data.totalClubService)}
            subtitle={`Avg ${(data.totalClubService / clubCount).toFixed(1)} / club`}
            icon={BookOpen}
            color="green"
          />
          <KpiCard
            title="Total Projects"
            value={fmtInt(data.totalProjects)}
            subtitle={`Avg ${(data.totalProjects / clubCount).toFixed(1)} / club`}
            icon={ClipboardList}
            color="purple"
          />
          <KpiCard
            title="TRF Contributions"
            value={fmtInr(data.totalTrfInr)}
            subtitle="All TRF funds combined"
            icon={Globe}
            color="gold"
          />
        </div>
      </div>

      {/* ── CLUB-BY-CLUB COMPARISON BAR ───────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-slate-700 inline-flex items-center gap-2">
            <BarChart3 size={14} className="text-azure" />
            Club-by-Club Comparison
          </h3>
          <span className="text-[11px] text-slate-400">Members · Club Service · Projects</span>
        </div>
        <p className="text-xs text-slate-400 mb-4">Side-by-side activity across every club in the AG’s scope</p>
        {barData.length === 0 ? (
          <p className="text-xs text-slate-400">No clubs yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} angle={-30} textAnchor="end" interval={0} height={64} />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #d5dee8" }}
                labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ""}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="Members"  fill={ROTARY_BLUE} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Club Service" fill={ROTARY_GOLD} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Projects" fill={ROTARY_TEAL} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── CLUB ACTIVITY AT A GLANCE  +  MEMBERS DISTRIBUTION ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-bold text-slate-700 inline-flex items-center gap-2">
              <Activity size={14} className="text-emerald-600" />
              Club Activity at a Glance
            </h3>
            <span className="text-[11px] text-slate-400">Club Service vs Projects</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">A focused view comparing Club Service and projects per club</p>
          {activityData.length === 0 ? (
            <p className="text-xs text-slate-400">No activity yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={activityData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} angle={-30} textAnchor="end" interval={0} height={64} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={32} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #d5dee8" }}
                  labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ""}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="Club Service" stackId="a" fill={ROTARY_GOLD} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Projects" stackId="a" fill={ROTARY_GREEN} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-700 inline-flex items-center gap-2">
              <PieIcon size={14} className="text-azure" />
              Members Distribution
            </h3>
          </div>
          {pieData.length === 0 ? (
            <p className="text-xs text-slate-400">No clubs yet.</p>
          ) : (
            <>
              <div className="flex-1 flex items-center justify-center relative">
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={88}
                      dataKey="value"
                      paddingAngle={2}
                      stroke="#fcfdfe"
                      strokeWidth={2}
                    >
                      {pieData.map((e) => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [fmtInt(Number(v)) + " members", String(n)] as [string, string]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #d5dee8" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-slate-800 tabular-nums">{fmtInt(totalMembers)}</span>
                  <span className="text-[10px] uppercase text-slate-400 tracking-wide">Total Members</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 mt-3 max-h-40 overflow-y-auto pr-1">
                {pieData.map((d) => {
                  const pct = totalMembers > 0 ? (d.value / totalMembers) * 100 : 0;
                  return (
                    <span key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ background: d.color }} />
                      <span className="truncate flex-1" title={d.name}>{d.name}</span>
                      <span className="tabular-nums text-slate-700 font-medium">{d.value}</span>
                      <span className="tabular-nums text-slate-400 w-10 text-right">{pct.toFixed(1)}%</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── CLUB-WISE DETAIL TABLE ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-700">Club-wise Detail</h3>
          <span className="text-xs text-slate-400">Click headers to sort · {sorted.length} club{sorted.length === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th label="Club Name"     colKey="clubName"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="min-w-[200px]" />
                <Th label="Members"       colKey="members"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Club Service"  colKey="clubService"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Projects"      colKey="totalProjects" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="TRF"           colKey="trf"           sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="GCs"           colKey="goalsCitations" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="District Rank" colKey="projectRank"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-400">No clubs to show.</td>
                </tr>
              ) : pageRows.map((row, i) => {
                const gcs = row.goalsCitations;
                const gcsKnown = typeof gcs === "number";
                return (
                  <tr key={row.clubId} className={`border-b border-slate-50 hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                    <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[260px]">
                      <span className="block truncate" title={row.clubName}>{row.clubName}</span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800 tabular-nums text-right">{fmtInt(row.members)}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums text-right">{fmtInt(row.clubService)}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums text-right">{fmtInt(row.totalProjects)}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums text-right">{fmtInr(row.trf)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {gcsKnown ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold tabular-nums">
                          <Award size={11} className="text-amber-500" />
                          {fmtInt(gcs!)}
                        </span>
                      ) : (
                        <PendingChip />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums text-right">
                      {row.projectRank ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-slate-800">#{fmtInt(row.projectRank)}</span>
                          <span className="text-slate-400">/ {fmtInt(data.totalClubsInDistrict)}</span>
                        </span>
                      ) : (
                        <PendingChip />
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* AG Total row — only render when we’re showing the entire dataset on one page. */}
              {pageCount === 1 && sorted.length > 0 && (
                <tr className="bg-azure/5 border-t-2 border-azure/30 font-bold text-slate-800">
                  <td className="px-3 py-2.5 text-azure">AG Total ({data.clubs.length} Clubs)</td>
                  <td className="px-3 py-2.5 tabular-nums text-right">{fmtInt(data.totalMembers)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-right">{fmtInt(data.totalClubService)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-right">{fmtInt(data.totalProjects)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-right">{fmtInr(data.totalTrfInr)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-right">
                    {fmtInt((data.clubs as ClubRow[]).reduce((s, c) => s + (c.goalsCitations ?? 0), 0))}
                  </td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — only when > PAGE_SIZE */}
        {pageCount > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
            <span>
              Showing <span className="font-medium text-slate-700">{(page - 1) * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-slate-700">{Math.min(page * PAGE_SIZE, sorted.length)}</span>
              {" "}of <span className="font-medium text-slate-700">{sorted.length}</span> clubs
            </span>
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="px-2 tabular-nums">{page} / {pageCount}</span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM 4 PER-CLUB SUMMARY CARDS ───────────────────────────────── */}
      {summaryClubs.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-3 inline-flex items-center gap-2">
            <Award size={14} className="text-azure" />
            Club Highlights
            <span className="text-[11px] font-normal text-slate-400">Top {summaryClubs.length} by current sort</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryClubs.map((c, i) => {
              const color = CLUB_PALETTE[i % CLUB_PALETTE.length];
              const share = totalMembers > 0 ? (c.members / totalMembers) * 100 : 0;
              return (
                <div
                  key={c.clubId}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                >
                  <span className="absolute top-0 left-0 right-0 h-1" style={{ background: color }} />
                  <div className="flex items-start justify-between gap-2 mt-1">
                    <span className="text-xs text-slate-500 font-medium truncate flex-1" title={c.clubName}>
                      {c.clubName}
                    </span>
                    <PendingChip label="MoM" />
                  </div>
                  <span className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>
                    {fmtInt(c.members)}
                  </span>
                  <span className="text-[11px] text-slate-400 -mt-1">Members</span>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase text-slate-400 tracking-wide">Projects</span>
                      <span className="text-sm font-semibold text-slate-700 tabular-nums">{fmtInt(c.totalProjects)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase text-slate-400 tracking-wide">TRF</span>
                      <span className="text-sm font-semibold text-slate-700 tabular-nums">{fmtInrShort(c.trf)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-slate-500">Share of AG members</span>
                    <span className="font-semibold tabular-nums" style={{ color }}>{share.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FOOTNOTE ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <span className="font-semibold text-slate-600 mr-1">Notes:</span>
        Members = active members in club_members · Club Service = club_service entries filed this year ·
        GCs = goals/citations earned (district_citation_club_entry, points {">"} 0) ·
        District rank based on total projects among {fmtInt(data.totalClubsInDistrict)} clubs in this district.
      </div>
    </div>
  );
}
