"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Heart, DollarSign, TrendingUp, Award, BarChart2, Trophy, PieChart,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getAgDashboardTrf } from "@/services/api";
import type { AgTrfResponse, AgClubTrf } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import {
  fmtUsd, fmtUsdShort, ROTARY_BLUE, ROTARY_GOLD, POLIO_PURPLE, ROTARY_GREEN, truncate,
} from "@/components/dashboard/formatters";

// Backend (Wave 12A) attaches PercentOfAgTotal at the club row level.
// The TS type doesn't yet expose it, so we read it via a narrow widening cast.
type AgClubTrfWithPct = AgClubTrf & { percentOfAgTotal?: number };

const MEDALS = ["1st", "2nd", "3rd"];

type SortField = "name" | "annual" | "polio" | "endowment" | "other" | "total";

// Same helper used by KpiCard — but we need to recompute when API is missing the field.
const pctOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export default function AgTrfPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgTrfResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("total");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Wave 9G / 13A2: scope to AG-selected district.
    getAgDashboardTrf(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Failed to load TRF data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const valueOf = (c: AgClubTrf) => {
      switch (sortBy) {
        case "name": return c.clubName;
        case "annual": return c.trf.annualInr;
        case "polio": return c.trf.polioInr;
        case "endowment": return c.trf.endowment;
        case "other": return c.trf.others;
        default: return c.trf.totalInr;
      }
    };
    return [...data.clubs].sort((a, b) => {
      const va = valueOf(a); const vb = valueOf(b);
      if (typeof va === "string") return asc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return asc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [data, sortBy, asc]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading TRF…" />
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

  const stacked = data.clubs
    .filter((c) => c.trf.totalInr > 0)
    .map((c) => ({
      name: truncate(c.clubName, 13),
      fullName: c.clubName,
      "Annual Fund": c.trf.annualInr,
      PolioPlus: c.trf.polioInr,
      Endowment: c.trf.endowment,
      "Other Funds": c.trf.others,
    }));
  const givingClubs = data.clubs.filter((c) => c.trf.totalInr > 0);
  const ranked = [...givingClubs].sort((a, b) => b.trf.totalInr - a.trf.totalInr);
  const top4 = ranked.slice(0, 4);

  // Per-club contribution rows — keep zero-giving clubs out so the bar list stays meaningful.
  // Sort descending so the biggest contributor sits on top, matching the reference design.
  const contributions = ranked.map((c) => {
    const pct = (c as AgClubTrfWithPct).percentOfAgTotal ?? pctOf(c.trf.totalInr, data.totals.totalInr);
    return { club: c, pct };
  });

  const handleSort = (f: SortField) => {
    if (sortBy === f) setAsc((v) => !v);
    else { setSortBy(f); setAsc(false); }
  };
  const SortIcon = ({ field }: { field: SortField }) => sortBy !== field
    ? <span className="text-slate-300 ml-1">↕</span>
    : <span className="text-blue-600 ml-1">{asc ? "↑" : "↓"}</span>;

  return (
    <div className="space-y-6">
      {/* ── Hero banner ───────────────────────────────────────────────── */}
      <SectionHeader
        title="The Rotary Foundation Giving"
        subtitle={`Charitable contributions · RY ${data.ag.yearLabel || "–"} · AG: ${data.ag.name || "–"}`}
        icon={Heart}
      />

      {/* ── KPI tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Giving (INR)"
          value={fmtUsd(data.totals.totalInr)}
          subtitle="All TRF funds combined"
          icon={DollarSign}
          color="gold"
        />
        <KpiCard
          title="Annual Fund"
          value={fmtUsd(data.totals.annualInr)}
          subtitle="Unrestricted annual giving"
          icon={TrendingUp}
          color="blue"
        />
        <KpiCard
          title="PolioPlus Fund"
          value={fmtUsd(data.totals.polioInr)}
          subtitle="Polio eradication"
          icon={Heart}
          color="purple"
        />
        <KpiCard
          title="Other / Endowment"
          value={fmtUsd(data.totals.endowment + data.totals.others)}
          subtitle="Designated & special"
          icon={Award}
          color="green"
        />
      </div>

      {/* ── Total TRF Giving Summary (gradient orange) ───────────────── */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden shadow-md"
        style={{
          background: ROTARY_BLUE,
        }}
      >
        {/* decorative blur dots */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 left-1/3 w-48 h-48 rounded-full bg-amber-300/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-5 flex-wrap">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur ring-1 ring-white/20">
            <Heart size={26} className="text-white" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-medium text-amber-100/90 uppercase tracking-wider mb-1">
              Total TRF Giving
            </p>
            <p className="text-4xl font-extrabold tracking-tight tabular-nums">
              {fmtUsd(data.totals.totalInr)}
            </p>
            <p className="text-blue-50 text-sm mt-1">
              AG: {data.ag.name || "–"} · {data.clubs.length} club{data.clubs.length === 1 ? "" : "s"}
              {" · RY "}{data.ag.yearLabel || "–"}
            </p>
          </div>
          <div className="hidden md:block text-right">
            <p className="text-xs uppercase tracking-wider text-amber-100/80">Annual + PolioPlus + Endowment + Other</p>
            <p className="text-sm text-blue-50 mt-1">Combined giving across {givingClubs.length} contributing club{givingClubs.length === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>

      {/* ── Stacked bar chart + Top Giving Clubs leaderboard ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-800">TRF Giving Breakdown by Club</h3>
              <p className="text-xs text-slate-400 mt-0.5">Stacked by fund type · clubs with giving only</p>
            </div>
            <BarChart2 size={18} className="text-slate-300" />
          </div>
          {stacked.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <BarChart2 size={36} className="mb-2 opacity-40" />
              <p className="text-sm">No TRF giving recorded yet.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={stacked} margin={{ top: 4, right: 16, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d5dee8" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={70}
                />
                <YAxis tickFormatter={fmtUsdShort} tick={{ fontSize: 11, fill: "#64748b" }} width={60} />
                <Tooltip
                  formatter={(v) => fmtUsd(Number(v))}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  labelFormatter={(label, payload) =>
                    payload && payload[0]
                      ? (payload[0].payload as { fullName: string }).fullName
                      : String(label)
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="Annual Fund" stackId="trf" fill={ROTARY_BLUE} />
                <Bar dataKey="PolioPlus"   stackId="trf" fill={POLIO_PURPLE} />
                <Bar dataKey="Endowment"   stackId="trf" fill={ROTARY_GOLD} />
                <Bar dataKey="Other Funds" stackId="trf" fill={ROTARY_GREEN} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-amber-500" />
              <h3 className="text-base font-semibold text-slate-800">Top Giving Clubs</h3>
            </div>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">My Clubs</span>
          </div>
          {top4.length === 0 ? (
            <p className="text-xs text-slate-400">No giving yet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {top4.map((club, i) => (
                <li
                  key={club.clubId}
                  className="flex items-center gap-3 py-3 px-1 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <span className="w-7 text-center text-lg leading-none">
                    {i < 3 ? <span className="text-sm font-bold text-marigold">{MEDALS[i]}</span> : <span className="text-sm font-bold text-slate-400">#{i + 1}</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{club.clubName}</p>
                    <p className="text-xs text-slate-400">{club.members} members</p>
                  </div>
                  <span className="text-sm font-bold text-blue-700 tabular-nums">{fmtUsd(club.trf.totalInr)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ── MY CLUBS TRF SUMMARY · Per-club contribution bars ────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart size={18} className="text-blue-700" />
            <h3 className="text-base font-semibold text-slate-800 tracking-wide">
              MY CLUBS TRF SUMMARY <span className="text-slate-400 font-normal">,  Per-club contribution</span>
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Combined giving across {givingClubs.length} club{givingClubs.length === 1 ? "" : "s"}
          </span>
        </div>
        {contributions.length === 0 ? (
          <p className="text-xs text-slate-400 px-5 py-10 text-center">No TRF contributions recorded yet.</p>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {contributions.map(({ club, pct }) => (
              <div key={club.clubId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <p className="font-medium text-slate-800 truncate">{club.clubName}</p>
                  <p className="font-semibold tabular-nums text-blue-700 whitespace-nowrap">
                    {fmtUsd(club.trf.totalInr)}
                  </p>
                </div>
                <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(2, pct))}%`,
                      background: ROTARY_BLUE,
                    }}
                  />
                  {pct >= 8 && (
                    <span
                      className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold text-white tabular-nums px-2"
                      style={{ left: `min(${Math.min(100, pct)}%, calc(100% - 38px))`, transform: "translate(-100%, -50%)" }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="flex justify-end">
                  <span className="text-xs text-slate-400 tabular-nums">{pct.toFixed(1)}% of AG total</span>
                </div>
              </div>
            ))}

            {/* AG Total footer row */}
            <div className="pt-3 border-t border-slate-200 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <p className="font-bold text-slate-800">AG Total (All Clubs)</p>
                <p className="font-bold tabular-nums text-amber-600 whitespace-nowrap">
                  {fmtUsd(data.totals.totalInr)}
                </p>
              </div>
              <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: "100%",
                    background: ROTARY_GOLD,
                  }}
                />
                <span
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white tabular-nums"
                >
                  100%
                </span>
              </div>
              <div className="flex justify-end">
                <span className="text-xs text-slate-400">Combined giving across {givingClubs.length} club{givingClubs.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Detailed TRF Giving Table ────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">Detailed TRF Giving Table</h3>
          <span className="text-xs text-slate-400">Click column headers to sort</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {([
                  ["Club Name", "name"],
                  ["Annual Fund", "annual"],
                  ["PolioPlus", "polio"],
                  ["Endowment", "endowment"],
                  ["Other Funds", "other"],
                  ["Total (INR)", "total"],
                ] as Array<[string, SortField]>).map(([label, field], i) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className={`px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 ${i > 0 ? "text-right" : "text-left"}`}
                  >
                    {label}<SortIcon field={field} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-sm">
                    No clubs found.
                  </td>
                </tr>
              ) : (
                sorted.map((club) => (
                  <tr key={club.clubId} className="hover:bg-blue-50/40">
                    <td className="px-3 py-2.5 font-medium text-slate-800">{club.clubName}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {club.trf.annualInr > 0 ? fmtUsd(club.trf.annualInr) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {club.trf.polioInr > 0 ? fmtUsd(club.trf.polioInr) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {club.trf.endowment > 0 ? fmtUsd(club.trf.endowment) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {club.trf.others > 0 ? fmtUsd(club.trf.others) : <span className="text-slate-300">, </span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                      {fmtUsd(club.trf.totalInr)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-slate-800 text-white">
              <tr>
                <td className="px-3 py-3 font-bold text-sm">AG Total</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{fmtUsd(data.totals.annualInr)}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{fmtUsd(data.totals.polioInr)}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {data.totals.endowment > 0 ? fmtUsd(data.totals.endowment) : <span className="text-slate-400">, </span>}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {data.totals.others > 0 ? fmtUsd(data.totals.others) : <span className="text-slate-400">, </span>}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums" style={{ color: ROTARY_GOLD }}>
                  {fmtUsd(data.totals.totalInr)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
