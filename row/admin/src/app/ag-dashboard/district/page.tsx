"use client";

// AG District View — Wave 13A2 redesign.
// Title "Club Performance Comparison" + 4 leaderboards (TRF / Projects / Members / Club Service),
// sortable head-to-head table (National Rank = Pending), 2x2 metric-bar grid,
// 4-axis radar (Members / Projects / Goals / Club Service) overlaying every club,
// and a blue gradient AG-group combined-totals band.
//
// Backend contract: getAgDashboardDistrict(yearId, clubId, districtId) — AgDistrictResponse
// from types/agDashboard.ts. The Wave 13A2 fields described in the brief
// (citationTotal/goalsScore/headToHeadTable/metricBars/radarData) are not yet present
// on the live DTO, so we adapt: DCK = ocv (district citation surrogate),
// Goals axis = ocv (citation total surrogate), nationalRank always "Pending".

import { useEffect, useMemo, useState } from "react";
import {
  Trophy, Users, Briefcase, Calendar, Star, ArrowUpDown, ArrowUp, ArrowDown,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";
import { getAgDashboardDistrict } from "@/services/api";
import type { AgDistrictResponse, AgDistrictClubRow } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import {
  fmtInt, fmtUsd, ROTARY_BLUE, ROTARY_GOLD, ROTARY_GREEN, POLIO_PURPLE, CLUB_PALETTE,
} from "@/components/dashboard/formatters";

// ───────────────────────────────────────────────────────────────────────────
// Leaderboard card — gradient header tile for #1 + ranked list 2-4 below.
// ───────────────────────────────────────────────────────────────────────────
type LeaderTone = "blue" | "purple" | "green" | "gold";

const TONE_GRADIENT: Record<LeaderTone, string> = {
  blue:   ROTARY_BLUE,
  purple: POLIO_PURPLE,
  green:  ROTARY_GREEN,
  gold:   ROTARY_GOLD,
};

function LeaderCard({
  icon: Icon, title, clubs, accessor, formatter, tone,
}: {
  icon: typeof Star;
  title: string;
  clubs: AgDistrictClubRow[];
  accessor: (c: AgDistrictClubRow) => number;
  formatter: (v: number) => string;
  tone: LeaderTone;
}) {
  if (clubs.length === 0) {
    return (
      <div className="border border-slate-200 rounded-xl bg-white p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
        </div>
        <p className="text-xs text-slate-400">No data</p>
      </div>
    );
  }
  const sorted = [...clubs].sort((a, b) => accessor(b) - accessor(a)).slice(0, 4);
  const leader = sorted[0];

  return (
    <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="pt-4 px-5 pb-2 flex items-center gap-2">
        <Icon size={18} className="text-slate-500" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</span>
      </div>
      <div className="px-5 pb-5">
        <div className="rounded-lg px-4 py-3 mb-3 shadow-sm" style={{ background: TONE_GRADIENT[tone] }}>
          <div className="flex items-start gap-2">
            <Trophy size={16} className="text-yellow-300 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-white font-bold text-base leading-tight truncate">{leader.clubName}</p>
              <p className="text-yellow-200 font-semibold text-lg mt-0.5">{formatter(accessor(leader))}</p>
            </div>
          </div>
        </div>
        <ol className="space-y-1.5">
          {sorted.slice(1).map((club, i) => (
            <li key={club.clubId} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-gray-600 min-w-0">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 bg-slate-400">
                  {i + 2}
                </span>
                <span className="truncate max-w-[160px]">{club.clubName}</span>
              </span>
              <span className="font-semibold text-gray-800 whitespace-nowrap">{formatter(accessor(club))}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Head-to-head sortable column key + helper.
// ───────────────────────────────────────────────────────────────────────────
type SortKey =
  | "clubName" | "members" | "clubService" | "totalProjects" | "trfTotalInr"
  | "ocv" | "vocationalService" | "internationalService" | "newGenerationService";

type SortDir = "asc" | "desc";

// ───────────────────────────────────────────────────────────────────────────
export default function AgDistrictPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgDistrictResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgDashboardDistrict(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Failed to load district view."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  const sortedClubs = useMemo(() => {
    if (!data) return [];
    if (!sortKey) return data.clubs;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...data.clubs].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [data, sortKey, sortDir]);

  // 4-axis radar: Members / Projects / Goals / Club Service. Each metric normalised
  // to 0-100 across all clubs so they can be overlaid on the same polygon.
  const radarPoints = useMemo(() => {
    if (!data || data.clubs.length === 0) return [];
    const axes: Array<{ key: string; fn: (c: AgDistrictClubRow) => number }> = [
      { key: "Members",  fn: (c) => c.members },
      { key: "Projects", fn: (c) => c.totalProjects },
      // Wave 13A2 spec asks for a "Goals" axis. The live DTO has no goalsScore
      // field yet, so we use `ocv` (district citation surrogate) as proxy.
      { key: "Goals",    fn: (c) => c.ocv },
      { key: "Club Service", fn: (c) => c.clubService },
    ];
    return axes.map(({ key, fn }) => {
      const values = data.clubs.map(fn);
      const max = Math.max(...values, 1);
      const point: Record<string, number | string> = { metric: key };
      data.clubs.forEach((c) => { point[c.clubName] = Math.round((fn(c) / max) * 100); });
      return point;
    });
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading district view…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) return null;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "clubName" ? "asc" : "desc");
    }
  };

  const sortIcon = (k: SortKey) => {
    if (sortKey !== k) return <ArrowUpDown size={12} className="opacity-50" />;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const headers: Array<{ label: string; key: SortKey | null; align?: "left" | "right" }> = [
    { label: "Club",          key: "clubName",             align: "left" },
    { label: "Members",       key: "members",              align: "right" },
    { label: "Club Service",  key: "clubService",          align: "right" },
    { label: "Projects",      key: "totalProjects",        align: "right" },
    { label: "TRF (USD)",     key: "trfTotalInr",          align: "right" },
    { label: "DCK",           key: "ocv",                  align: "right" },
    { label: "National Rank", key: null,                   align: "right" },
    { label: "Vocational",    key: "vocationalService",    align: "right" },
    { label: "International", key: "internationalService", align: "right" },
    { label: "NewGen",        key: "newGenerationService", align: "right" },
  ];

  const numCell = "px-3 py-3 text-sm text-gray-700 whitespace-nowrap text-right tabular-nums";

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: ROTARY_BLUE }}>Club Performance Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">How your {data.clubs.length} clubs compare across key metrics</p>
        <p className="text-xs text-gray-400 mt-0.5">
          AG: {data.ag.name || "–"} · District {data.ag.districtNumber || "–"} · RY {data.ag.yearLabel || "–"}
        </p>
      </div>

      {/* LEADERBOARDS — 4 cards: TRF (blue), Projects (purple), Members (green), Club Service (gold) */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-widest">Leaderboards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <LeaderCard
            icon={Star} title="Top TRF Giving" tone="blue"
            clubs={data.clubs} accessor={(c) => c.trfTotalInr} formatter={fmtUsd}
          />
          <LeaderCard
            icon={Briefcase} title="Most Projects" tone="purple"
            clubs={data.clubs} accessor={(c) => c.totalProjects} formatter={(v) => `${fmtInt(v)} projects`}
          />
          <LeaderCard
            icon={Users} title="Largest Club" tone="green"
            clubs={data.clubs} accessor={(c) => c.members} formatter={(v) => `${fmtInt(v)} members`}
          />
          <LeaderCard
            icon={Calendar} title="Most Active" tone="gold"
            clubs={data.clubs} accessor={(c) => c.clubService} formatter={(v) => `${fmtInt(v)} club service`}
          />
        </div>
      </section>

      {/* HEAD-TO-HEAD COMPARISON — sortable table; National Rank = Pending */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-widest">Head-to-Head Comparison</h2>
        <div className="border border-gray-200 shadow-sm rounded-xl bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr style={{ backgroundColor: ROTARY_BLUE }}>
                  {headers.map((h) => (
                    <th
                      key={h.label}
                      onClick={() => h.key && toggleSort(h.key)}
                      className={`px-3 py-3 text-xs font-semibold text-white uppercase tracking-wide whitespace-nowrap select-none ${h.align === "right" ? "text-right" : "text-left"} ${h.key ? "cursor-pointer hover:bg-white/10" : ""}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${h.align === "right" ? "flex-row-reverse" : ""}`}>
                        {h.label}
                        {h.key && sortIcon(h.key)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedClubs.map((c, idx) => (
                  <tr key={c.clubId} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CLUB_PALETTE[idx % CLUB_PALETTE.length] }} />
                        <span className="text-sm font-semibold text-gray-800">{c.clubName}</span>
                      </div>
                    </td>
                    <td className={numCell}>{fmtInt(c.members)}</td>
                    <td className={numCell}>{fmtInt(c.clubService)}</td>
                    <td className={numCell}>{fmtInt(c.totalProjects)}</td>
                    <td className={numCell}>{fmtUsd(c.trfTotalInr)}</td>
                    <td className={numCell}>{fmtInt(c.ocv)}</td>
                    <td className="px-3 py-3 text-sm whitespace-nowrap text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">
                        Pending
                      </span>
                    </td>
                    <td className={numCell}>{fmtInt(c.vocationalService)}</td>
                    <td className={numCell}>{fmtInt(c.internationalService)}</td>
                    <td className={numCell}>{fmtInt(c.newGenerationService)}</td>
                  </tr>
                ))}
                {sortedClubs.length === 0 && (
                  <tr>
                    <td colSpan={headers.length} className="px-3 py-8 text-center text-sm text-gray-400">
                      No club data available for this AG group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
            Click any column header to sort. National Rank is awaiting publication and shown as Pending.
          </div>
        </div>
      </section>

      {/* CLUB METRICS AT A GLANCE — 2x2 bar-chart grid */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-widest">Club Metrics at a Glance</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(["members", "totalProjects", "trfTotalInr", "clubService"] as const).map((key, ki) => {
            const titles: Record<string, string> = {
              members:       "Members per Club",
              totalProjects: "Projects per Club",
              trfTotalInr:   "TRF Giving per Club (USD)",
              clubService:   "Club Service per Club",
            };
            const chartData = data.clubs.map((c, i) => ({
              name: c.clubName,
              value: c[key] as number,
              color: CLUB_PALETTE[i % CLUB_PALETTE.length],
            }));
            return (
              <div key={ki} className="border border-gray-200 shadow-sm rounded-xl bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">{titles[key]}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "#4A5A70" }}
                      angle={-25}
                      textAnchor="end"
                      interval={0}
                      height={60}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#8796AA" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(v) => key === "trfTotalInr" ? fmtUsd(Number(v)) : fmtInt(Number(v))}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={60}>
                      {chartData.map((entry, index) => (<Cell key={index} fill={entry.color} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      </section>

      {/* MULTI-METRIC RADAR — 4 axes (Members / Projects / Goals / Club Service), one polygon per club */}
      {radarPoints.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-widest">Multi-Metric Radar</h2>
          <p className="text-xs text-gray-400 mb-3">
            All metrics normalised 0-100 so clubs can be compared across dimensions. Outer edge = leader in that axis.
          </p>
          <div className="border border-gray-200 shadow-sm rounded-xl bg-white p-4">
            <ResponsiveContainer width="100%" height={420}>
              <RadarChart data={radarPoints} margin={{ top: 16, right: 40, bottom: 16, left: 40 }}>
                <PolarGrid stroke="#d5dee8" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: "#2A3F5C", fontWeight: 600 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: "#8796aa" }} tickCount={5} />
                {data.clubs.map((c, idx) => (
                  <Radar
                    key={c.clubId}
                    name={c.clubName}
                    dataKey={c.clubName}
                    stroke={CLUB_PALETTE[idx % CLUB_PALETTE.length]}
                    fill={CLUB_PALETTE[idx % CLUB_PALETTE.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* AG GROUP COMBINED TOTALS — gradient blue band */}
      <section>
        <div
          className="rounded-xl shadow-sm border-0 p-6"
          style={{ background: ROTARY_BLUE }}
        >
          <p className="text-white text-xs uppercase tracking-widest font-semibold mb-4 opacity-80">
            AG Group Combined Totals
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Members",  value: fmtInt(data.totalMembers) },
              { label: "Total Club Service", value: fmtInt(data.totalClubService) },
              { label: "Total Projects", value: fmtInt(data.totalProjects) },
              { label: "Total TRF",      value: fmtUsd(data.totalTrfInr) },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-white text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-blue-100 text-xs mt-1 opacity-90">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
