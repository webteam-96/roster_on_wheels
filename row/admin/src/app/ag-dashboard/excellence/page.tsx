"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award, Target, TrendingUp, Star, BarChart2, Trophy,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import { getAgDashboardExcellence } from "@/services/api";
import type { AgExcellenceResponse, AgMonthlyTrackingPoint } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import {
  fmtInt, fmtInr, CLUB_PALETTE,
} from "@/components/dashboard/formatters";

// ---------------------------------------------------------------------------
// Wave 13A2 — Club Excellence rebuild.
// The page is rebuilt to match the new "Goals & Club Excellence" mock:
//   1. 4 KPI tiles (Awards Achieved / Goals On Track / Avg Citation / Top
//      Scoring Club).
//   2. Stacked bar — District Citation Scores by Club (Membership/TRF/Service/
//      Public Image/Youth/Foundation).
//   3. Category Breakdown table.
//   4. Goals Achievement Grid — one card per club with progress bars
//      (Membership Growth, Service Projects, Meeting Attendance,
//      MyRotary Registrations, New Members). MyRotary renders "Pending" when
//      `myRotaryIsPending` is true (backend marker).
//   5. Club Excellence Award Status table — colored chips for Presidential
//      Citation, District Citation, Membership Excellence. The whole table
//      renders a "Pending — data entry needed" placeholder when
//      `awardStatusIsPending` is true.
//   6. Line chart — Monthly Goal Tracking (Service Projects / Meetings / TRF).
//
// Backend contract additions used here are still optional on the FE type —
// the page reads them with safe casts so a stale API build won't crash.
// ---------------------------------------------------------------------------

const CITATION_CATEGORIES: Array<{ key: keyof CitCat; label: string; color: string }> = [
  { key: "membership",  label: "Membership",    color: CLUB_PALETTE[0] },
  { key: "trf",         label: "TRF",           color: CLUB_PALETTE[1] },
  { key: "service",     label: "Service",       color: CLUB_PALETTE[2] },
  { key: "publicImage", label: "Public Image",  color: "#F59E0B" },
  { key: "youth",       label: "Youth",         color: "#8B5CF6" },
  { key: "foundation",  label: "Foundation",    color: "#EC4899" },
];
type CitCat = { membership: number; trf: number; service: number; publicImage: number; youth: number; foundation: number };

// Goals shown in each club card. Targets are the Rotary defaults; the
// achievement-count rolls these up into the "Goals On Track" KPI.
const GOALS = [
  { key: "membershipGrowth",  label: "Membership Growth",      target: 5,  unit: "%"   },
  { key: "serviceProjects",   label: "Service Projects",       target: 12, unit: ""    },
  { key: "meetingAttendance", label: "Meeting Attendance",     target: 60, unit: "%"   },
  { key: "myRotary",          label: "MyRotary Registrations", target: 80, unit: "%"   },
  { key: "newMembers",        label: "New Members",            target: 3,  unit: ""    },
] as const;

// ---------------------------------------------------------------------------
// Inline DTO shapes for the Wave 13A2 contract additions. The shared
// `@/types/agDashboard` file is intentionally left untouched per task scope;
// these mirrors live here.
// ---------------------------------------------------------------------------
interface AwardStatusRow {
  clubId: number;
  clubName: string;
  onTrack: boolean;
  achieved: boolean;
  presidentialCitation: string;
  districtCitation: string;
  membershipExcellence: string;
  isPending: boolean;
}

// ---------------------------------------------------------------------------
// Small reusable bits
// ---------------------------------------------------------------------------

/** Inline progress-bar row used in club Goal cards. */
function GoalBar({
  label, value, target, unit, isPending,
}: { label: string; value: number; target: number; unit: string; isPending?: boolean }) {
  if (isPending) {
    return (
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">{label}</span>
          <PendingChip />
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-2.5 rounded-full bg-slate-200" style={{ width: "100%" }} />
        </div>
      </div>
    );
  }
  const pct = target === 0 ? 0 : Math.min((value / target) * 100, 150);
  const clamp = Math.min(pct, 100);
  const color = pct >= 100 ? "#059669" : pct >= 60 ? "#D97706" : "#DC2626";
  const display = unit === "INR" ? fmtInr(value) : unit === "%" ? `${value.toFixed(1)}%` : value.toString();
  const targetDisplay = unit === "INR" ? fmtInr(target) : unit === "%" ? `${target}%` : target.toString();

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-xs text-slate-500 shrink-0 ml-2">
          {display}<span className="text-slate-400"> / {targetDisplay}</span>
        </span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-2.5 rounded-full" style={{ width: `${clamp}%`, background: color }} />
      </div>
    </div>
  );
}

/** Small grey "Pending" chip used as a placeholder when backend marks fields
 *  isPending (data-entry not yet complete in this RY). */
function PendingChip({ label = "Pending" }: { label?: string }) {
  return (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
      {label}
    </span>
  );
}

/** Coloured status chip used in the Award Status table. */
function StatusChip({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const map: Record<string, { bg: string; text: string; border: string; label: string }> = {
    achieved:     { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Achieved" },
    "on-track":   { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "On Track" },
    on_track:     { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "On Track" },
    behind:       { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     label: "Behind"   },
    pending:      { bg: "bg-slate-100",  text: "text-slate-500",   border: "border-slate-200",   label: "Pending"  },
  };
  const c = map[s] || map.pending;
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Monthly line chart (Service Projects / Meetings / TRF)
// ---------------------------------------------------------------------------
function MonthlyChart({
  data, title, subtitle, clubNames,
}: { data: AgMonthlyTrackingPoint[]; title: string; subtitle: string; clubNames: string[] }) {
  // Flatten the `byClub` map onto a single row per month so recharts can
  // plot one <Line> per club via dataKey.
  const flat = data.map((p) => ({ month: p.month, ...p.byClub }));
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-slate-400">No monthly data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={flat} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
            {clubNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={CLUB_PALETTE[i % CLUB_PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AgExcellencePage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgExcellenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<"projects" | "meetings" | "trf">("projects");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Multi-district AG: pass the selected district id so the backend
    // scopes the response to just that district's clubs.
    getAgDashboardExcellence(yearId, null, selectedDistrictId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Failed to load excellence data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, yearId]);

  const clubNames = useMemo(() => {
    if (!data || data.monthlyProjects.length === 0) return [];
    return Object.keys(data.monthlyProjects[0].byClub);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading…" />
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!data) return null;

  // ---- Stacked-bar series for the citation chart ---------------------------
  const citationBarData = data.citation.map((c) => ({
    name: c.clubName,
    total: c.total,
    membership: c.membership, trf: c.trf, service: c.service,
    publicImage: c.publicImage, youth: c.youth, foundation: c.foundation,
  }));

  // ---- KPI rollups ---------------------------------------------------------
  // The contract only ships `averageCitationScore` and `topScoringClub`; the
  // award/goal counters are derived from the lists so this page works whether
  // or not the backend exposes pre-computed kpis.
  const awardStatusList = ((data as unknown) as { awardStatus?: AwardStatusRow[] }).awardStatus ?? [];
  const awardStatusIsPending =
    ((data as unknown) as { awardStatusIsPending?: boolean }).awardStatusIsPending ?? (awardStatusList.length === 0);

  const awardsTotal = awardStatusList.length;
  const awardsAchieved = awardStatusList.filter((r) => r.achieved).length;

  // Goals on track = goals at/above target across every club card. A goal
  // marked `myRotaryIsPending` is excluded from both numerator and denominator
  // so a pre-data-entry club isn't punished.
  let goalsOnTrack = 0;
  let goalsTotal = 0;
  data.goals.forEach((club) => {
    GOALS.forEach((g) => {
      const pending = g.key === "myRotary"
        && (((club as unknown) as { myRotaryIsPending?: boolean }).myRotaryIsPending === true);
      if (pending) return;
      goalsTotal += 1;
      const v = (club[g.key as keyof typeof club] as number) || 0;
      if ((v / g.target) * 100 >= 100) goalsOnTrack += 1;
    });
  });

  // "Total Scoring Club" tile shows the top club's citation total (matches
  // mock value e.g. 14,200) rather than the club name.
  const totalScoringClubPts = data.topScoringClub?.total ?? 0;
  const totalScoringClubName = data.topScoringClub?.clubName ?? "—";

  const monthlyDataMap = {
    projects: data.monthlyProjects,
    meetings: data.monthlyMeetings,
    trf: data.monthlyTrf,
  };

  return (
    <div className="space-y-8 pb-10">
      <SectionHeader
        title="Goals & Club Excellence"
        subtitle={`District Awards scores, goal tracking, and award status — RY ${data.ag.yearLabel || "—"}`}
        icon={Award}
      />

      {/* -- KPI ROW -------------------------------------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard
          title="Awards Achieved"
          value={`${awardsAchieved}/${awardsTotal}`}
          subtitle="Club excellence awards"
          icon={Trophy}
          color="gold"
        />
        <KpiCard
          title="Goals On Track"
          value={`${goalsOnTrack}/${goalsTotal}`}
          subtitle="Individual goal metrics"
          icon={Target}
          color="blue"
        />
        <KpiCard
          title="Avg Awards Score"
          value={fmtInt(data.averageCitationScore)}
          subtitle="District awards"
          icon={TrendingUp}
          color="green"
        />
        <KpiCard
          title="Top Scoring Club"
          value={fmtInt(totalScoringClubPts)}
          subtitle={totalScoringClubName}
          icon={Star}
          color="purple"
        />
      </div>

      {/* -- CITATION CHART + TABLE ---------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-slate-800">District Awards Scores</h2>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-800 mb-1">District Awards Scores by Club</h3>
          <p className="text-xs text-slate-400 mb-4">Stacked bar — each colour is a scoring category</p>
          {citationBarData.length === 0 ? (
            <p className="text-xs text-slate-400">No citation data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={citationBarData} barSize={56}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip
                  formatter={(v, n) => [Number(v).toLocaleString(), String(n)] as [string, string]}
                  contentStyle={{ borderRadius: 10, fontSize: 12 }}
                />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                {CITATION_CATEGORIES.map((cat) => (
                  <Bar
                    key={cat.key}
                    dataKey={cat.key}
                    name={cat.label}
                    stackId="a"
                    fill={cat.color}
                    radius={cat.key === "foundation" ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mt-4">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Category Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Club</th>
                  {CITATION_CATEGORIES.map((cat) => (
                    <th key={cat.key} className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {cat.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider bg-blue-50">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.citation.map((club, idx) => (
                  <tr key={club.clubId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <span className="text-slate-400 text-xs mr-2">#{idx + 1}</span>{club.clubName}
                    </td>
                    {CITATION_CATEGORIES.map((cat) => (
                      <td key={cat.key} className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {fmtInt(club[cat.key])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-blue-700 bg-blue-50">
                      {fmtInt(club.total)}
                    </td>
                  </tr>
                ))}
                {data.citation.length === 0 && (
                  <tr>
                    <td colSpan={CITATION_CATEGORIES.length + 2} className="px-4 py-6 text-center text-xs text-slate-400">
                      No citation data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* -- GOALS ACHIEVEMENT GRID ---------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Target size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-slate-800">Goals Achievement Grid</h2>
        </div>
        <p className="text-xs text-slate-400 mb-4 ml-7">
          Progress vs Rotary targets —{" "}
          <span className="text-green-600 font-semibold">green</span> = achieved,
          <span className="text-amber-500 font-semibold"> amber</span> = on track,
          <span className="text-red-500 font-semibold"> red</span> = behind
        </p>

        {data.goals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">
            No goal data yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {data.goals.map((club, ci) => {
              const myRotaryPending =
                ((club as unknown) as { myRotaryIsPending?: boolean }).myRotaryIsPending === true;
              const achievedCount = GOALS.filter((g) => {
                if (g.key === "myRotary" && myRotaryPending) return false;
                const v = (club[g.key as keyof typeof club] as number) || 0;
                return (v / g.target) * 100 >= 100;
              }).length;
              const goalsCountForCard = GOALS.filter(
                (g) => !(g.key === "myRotary" && myRotaryPending),
              ).length;
              return (
                <div
                  key={club.clubId}
                  className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4"
                >
                  <div>
                    <div
                      className="inline-block text-xs font-bold px-2 py-0.5 rounded-full text-white mb-2"
                      style={{ background: CLUB_PALETTE[ci % CLUB_PALETTE.length] }}
                    >
                      {club.members} members
                    </div>
                    <h4 className="text-sm font-semibold text-slate-800 leading-tight">{club.clubName}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {achievedCount} / {goalsCountForCard} goals achieved
                    </p>
                  </div>
                  <div className="space-y-3">
                    {GOALS.map((goal) => (
                      <GoalBar
                        key={goal.key}
                        label={goal.label}
                        value={(club[goal.key as keyof typeof club] as number) || 0}
                        target={goal.target}
                        unit={goal.unit}
                        isPending={goal.key === "myRotary" && myRotaryPending}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* -- AWARD STATUS TABLE -------------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-slate-800">Club Excellence Award Status</h2>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {awardStatusIsPending || awardStatusList.length === 0 ? (
            // The whole table degrades to a single explanatory placeholder
            // when `awardStatusIsPending` flag is set (or no rows arrived).
            <div className="p-8 text-center">
              <PendingChip label="Pending" />
              <p className="text-sm text-slate-600 mt-3">Award status — data entry needed.</p>
              <p className="text-xs text-slate-400 mt-1">
                Award statuses will appear here once club_award_status rows are populated for this RY.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Club</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">On Track</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Achieved</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Presidential Citation</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">District Awards</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Membership Excellence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {awardStatusList.map((row) => (
                    <tr key={row.clubId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.clubName}</td>
                      <td className="px-4 py-2.5 text-center">
                        {row.isPending ? <PendingChip /> : <StatusChip status={row.onTrack ? "on-track" : "behind"} />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.isPending ? <PendingChip /> : <StatusChip status={row.achieved ? "achieved" : "behind"} />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.isPending ? <PendingChip /> : <StatusChip status={row.presidentialCitation} />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.isPending ? <PendingChip /> : <StatusChip status={row.districtCitation} />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.isPending ? <PendingChip /> : <StatusChip status={row.membershipExcellence} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* -- MONTHLY GOAL TRACKING ----------------------------------------- */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-blue-600" />
          <h2 className="text-base font-semibold text-slate-800">Monthly Goal Tracking</h2>
        </div>
        <div
          className="rounded-xl p-1.5 inline-flex gap-1 mb-4"
          style={{ backgroundColor: "#1e3a5f" }}
        >
          {(["projects", "meetings", "trf"] as const).map((m) => {
            const isActive = metric === m;
            return (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`text-sm font-semibold px-3.5 py-1.5 rounded-md transition ${
                  isActive ? "shadow-sm" : "text-white hover:bg-white/10"
                }`}
                style={
                  isActive
                    ? { backgroundColor: "#F7A81B", color: "#1e3a5f" }
                    : undefined
                }
              >
                {m === "projects" ? "Service Projects" : m === "meetings" ? "Meetings Held" : "TRF (INR)"}
              </button>
            );
          })}
        </div>
        <MonthlyChart
          data={monthlyDataMap[metric]}
          title={`Monthly ${metric === "projects" ? "Service Projects" : metric === "meetings" ? "Meetings" : "TRF"}`}
          subtitle={`RY ${data.ag.yearLabel || "—"} · All clubs compared`}
          clubNames={clubNames}
        />
      </section>
    </div>
  );
}
