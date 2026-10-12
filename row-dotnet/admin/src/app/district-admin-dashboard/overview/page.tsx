"use client";

/**
 * District Admin Dashboard — Overview page (Wave 13A4)
 * ---------------------------------------------------------------------------
 * Visual rebuild to match the new AG-Module reference design (Overview1.png +
 * Overview2.png). Layout:
 *
 *   1. 4 KPI tiles (colored top-border strip):
 *        Total Clubs · Total Members · TRF Contribution · District Citation
 *   2. 4-column single-row panel grid:
 *        Membership  ·  TRF Goal  ·  Service Projects  ·  District Citation
 *   3. Bottom row split 2/3 + 1/3:
 *        Top 20 Clubs — vertical bar chart
 *        Club Leaderboard — search + list + pagination + below-50 warning
 *
 * Data source: DistrictAdminDashboardCacheContext (populated by
 * GET /api/district-admin-dashboard/overview). Wave 13A4 added the following
 * fields to the response (accessed via a local view-model so this file stays
 * compile-safe when the shared types haven't picked them up yet):
 *   - maleMembers / femaleMembers / honoraryMembers / inactiveMembers
 *   - phfMembers / majorDonors
 *   - citation.categories[].maxPoints + completeClubs/partialClubs/incompleteClubs/status
 *   - clubLeaderboard[].percentile
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getDistrictAwardsConfig } from "@/services/api";
import {
  Users, Building2, Heart, Award, Loader2, Search, AlertTriangle,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import {
  fmtInt, fmtUsdShort, ROTARY_BLUE,
} from "@/components/dashboard/formatters";

/* ------------------------------------------------------------------ */
/*  Local view-model — accesses Wave 13A4 additive fields as optional  */
/* ------------------------------------------------------------------ */
interface AvenueRow {
  avenueKey?: string;
  avenueName?: string;
  name?: string;
  completed?: number;
  current?: number;
  target?: number;
}
interface CitationCategoryRow {
  categoryId?: number;
  categoryName?: string;
  category?: string;
  pointsEarned?: number;
  points?: number;
  maxPoints?: number;
  completeClubs?: number;
  partialClubs?: number;
  incompleteClubs?: number;
  status?: string;
}
interface TopClubRow {
  clubId?: number;
  clubName?: string;
  members?: number;
}
interface LeaderboardRow {
  clubId?: number;
  clubName?: string;
  score?: number;
  percentile?: number;
}

interface OverviewVM {
  district?: { districtNumber?: string; yearLabel?: string; totalClubs?: number };
  totalClubs?: number;
  totalMembers?: number;
  newMembersThisYear?: number;
  terminatedThisYear?: number;
  trfTotalInr?: number;
  districtCitationScore?: number;
  qualifiedCitationClubs?: number;

  maleMembers?: number;
  femaleMembers?: number;
  honoraryMembers?: number;
  inactiveMembers?: number;
  phfMembers?: number;
  majorDonors?: number;
  fundTypeBreakdown?: { fundName?: string; amountInr?: number }[];

  membershipGoal?: {
    current?: number;
    target?: number | null;
    delta?: number;
    isPending?: boolean;
  };
  trfGoal?: {
    percentAchieved?: number;
    raisedInr?: number;
    remainingInr?: number;
    totalTargetInr?: number | null;
    annualFundInr?: number;
    polioFundInr?: number;
    endowmentInr?: number;
    othersInr?: number;
    isPending?: boolean;
  };
  serviceProjects?: {
    totalProjects?: number;
    clubServicesCount?: number;
    totalTarget?: number | null;
    isPending?: boolean;
    avenues?: AvenueRow[];
  };
  citation?: {
    totalPoints?: number;
    qualifiedClubs?: number;
    categories?: CitationCategoryRow[];
  };
  top20ClubsByMembers?: TopClubRow[];
  clubLeaderboard?: LeaderboardRow[];
}

/* ------------------------------------------------------------------ */
/*  KPI tile — colored top border strip                                */
/* ------------------------------------------------------------------ */
function KpiTile({
  label, value, subtitle, subtitleTone = "muted", accent,
}: {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleTone?: "muted" | "gold" | "red";
  accent: "blue" | "green" | "gold" | "red";
}) {
  const borderMap: Record<string, string> = {
    blue: "border-t-blue-600",
    green: "border-t-emerald-500",
    gold: "border-t-amber-500",
    red: "border-t-rose-500",
  };
  const subMap: Record<string, string> = {
    muted: "text-slate-400",
    gold: "text-amber-600",
    red: "text-rose-600",
  };
  return (
    <div className={`bg-white rounded-lg border border-slate-200 border-t-2 ${borderMap[accent]} shadow-sm p-4`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1 leading-tight">{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1 ${subMap[subtitleTone]}`}>{subtitle}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel shell                                                        */
/* ------------------------------------------------------------------ */
function Panel({
  title, subtitle, headerRight, children, footer,
}: {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      <div className="flex-1 px-5 pb-3">{children}</div>
      {footer && (
        <div className="border-t border-slate-100 px-5 py-2.5 flex items-center justify-between text-xs">
          {footer}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Metric row (mini progress bar)                                     */
/* ------------------------------------------------------------------ */
function MetricRow({
  label, value, percent, color,
}: {
  label: string;
  value: React.ReactNode;
  percent: number;
  color: string;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-800 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Donut                                                              */
/* ------------------------------------------------------------------ */
function Donut({
  percent, color, size = 150, thickness = 14,
  centerTop, centerBottom,
}: {
  percent: number;
  color: string;
  size?: number;
  thickness?: number;
  centerTop: React.ReactNode;
  centerBottom?: React.ReactNode;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const data = [
    { name: "done", value: p },
    { name: "rest", value: 100 - p },
  ];
  const outer = size / 2;
  const inner = outer - thickness;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="#f1f5f9" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3">
        <span
          className="font-bold tabular-nums leading-none text-center"
          style={{
            color,
            // Shrink the center number as it gets longer so large totals stay inside the ring.
            fontSize:
              typeof centerTop === "string" && centerTop.length > 9 ? "0.9rem"
              : typeof centerTop === "string" && centerTop.length > 7 ? "1.05rem"
              : typeof centerTop === "string" && centerTop.length > 5 ? "1.25rem"
              : "1.5rem",
          }}
        >
          {centerTop}
        </span>
        {centerBottom && (
          <span className="text-[11px] text-slate-500 mt-1">{centerBottom}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Avenue colours (Service Projects card)                             */
/* ------------------------------------------------------------------ */
const AVENUE_COLOR: Record<string, string> = {
  community_service: "#2563EB",       // blue
  vocational_service: "#10B981",      // emerald
  new_generation_service: "#8B5CF6",  // violet
  public_image_initiative: "#F59E0B", // amber
  international_service: "#0EA5E9",   // sky
};

/* ------------------------------------------------------------------ */
/*  Fund-Type row colours (TRF Contribution card) — cycled by index    */
/*  since the fund list is dynamic (trf_fund_master).                  */
/* ------------------------------------------------------------------ */
const FUND_COLORS = [
  "#F59E0B", // amber   — first fund (usually Annual)
  "#8B5CF6", // violet  — PHF / Endowment
  "#EAB308", // yellow  — Major Donors
  "#10B981", // emerald
  "#0EA5E9", // sky
  "#EC4899", // pink
  "#EF4444", // rose    — Others
];

/* ------------------------------------------------------------------ */
/*  Category dot colours (District Citation card) — cycle through 5    */
/* ------------------------------------------------------------------ */
const CATEGORY_DOT_COLORS = [
  "#10B981", // emerald — Membership Growth
  "#F59E0B", // amber — Service Projects
  "#F59E0B",
  "#F59E0B",
  "#F59E0B",
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function DistrictAdminOverviewPage() {
  const { overview, status } = useDistrictAdminCache();
  const data = (overview as unknown as OverviewVM) ?? null;

  /* ---- Local UI state for the Club Leaderboard ---- */
  const [lbSearch, setLbSearch] = useState("");
  const [lbPage, setLbPage] = useState(1);
  const LB_PAGE_SIZE = 10;

  /* ---- District Awards activation flag (per district+year). Disabled/not-created ⇒ show a
         "not activated" message on the District Awards panel instead of the (0-point) circle. ---- */
  const { selectedDistrictId } = useAuth();
  const searchParams = useSearchParams();
  const awardsYearId = searchParams?.get("yearId") ? Number(searchParams.get("yearId")) : null;
  const [awardsEnabled, setAwardsEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!selectedDistrictId || !awardsYearId) { setAwardsEnabled(null); return; }
    getDistrictAwardsConfig(selectedDistrictId, awardsYearId)
      .then((c) => { if (!cancelled) setAwardsEnabled(c.isEnabled); })
      .catch(() => { if (!cancelled) setAwardsEnabled(false); });
    return () => { cancelled = true; };
  }, [selectedDistrictId, awardsYearId]);

  /* ---- Derived: leaderboard filter + pagination ---- */
  const filteredLeaderboard = useMemo(() => {
    const rows = data?.clubLeaderboard ?? [];
    const q = lbSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => (r.clubName ?? "").toLowerCase().includes(q));
  }, [data, lbSearch]);

  const lbTotalPages = Math.max(1, Math.ceil(filteredLeaderboard.length / LB_PAGE_SIZE));
  const lbEffectivePage = Math.min(lbPage, lbTotalPages);
  const lbPageRows = filteredLeaderboard.slice(
    (lbEffectivePage - 1) * LB_PAGE_SIZE,
    lbEffectivePage * LB_PAGE_SIZE,
  );
  // Clubs that haven't earned any District Citation points yet — surfaced
  // as a warning chip so admins can chase them (mirrors the Club Points
  // tab on /districts/[id]/citation which highlights zero-point clubs).
  const lbZeroPoints = (data?.clubLeaderboard ?? []).filter(
    r => (r.score ?? 0) === 0,
  ).length;

  /* ---- Loading / error ---- */
  if (status === "loading" && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="animate-spin mr-2" /> Loading district overview…
      </div>
    );
  }
  if (status === "error" && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load overview.
      </div>
    );
  }
  if (!data) return null;

  /* ---- Derived: cell values ---- */
  const totalClubs = data.totalClubs ?? data.district?.totalClubs ?? 0;
  const totalMembers = data.totalMembers ?? 0;
  const trfRaised = data.trfGoal?.raisedInr ?? data.trfTotalInr ?? 0;
  const trfRemaining = data.trfGoal?.remainingInr ?? 0;
  const trfPct = data.trfGoal?.percentAchieved ?? 0;
  const citationPoints = data.citation?.totalPoints ?? Math.round(data.districtCitationScore ?? 0);
  const qualifiedClubs = data.citation?.qualifiedClubs ?? data.qualifiedCitationClubs ?? 0;

  const male = data.maleMembers ?? 0;
  const female = data.femaleMembers ?? 0;
  const honorary = data.honoraryMembers ?? 0;
  const inactive = data.inactiveMembers ?? 0;
  const active = Math.max(0, totalMembers - inactive);
  const newThisYear = data.newMembersThisYear ?? 0;
  const terminated = data.terminatedThisYear ?? 0;

  const yearLabel = data.district?.yearLabel ?? "";
  const districtBaseTotal = data.district?.totalClubs ?? totalClubs;

  const memMax = Math.max(active, male, female, honorary, inactive, 1);

  // Fund-Type breakdown (dynamic — every active fund in trf_fund_master
  // aggregated across every club in the district for the selected year).
  // Show ALL funds even at ₹0 so admins can see which funds are unused.
  const fundRows = data.fundTypeBreakdown ?? [];
  const fundRowMax = Math.max(1, ...fundRows.map(r => r.amountInr ?? 0));
  const fundTotal = fundRows.reduce((s, r) => s + (r.amountInr ?? 0), 0);

  const avenues = data.serviceProjects?.avenues ?? [];
  const totalProjects = data.serviceProjects?.totalProjects ?? 0;
  const clubServicesCount = data.serviceProjects?.clubServicesCount ?? 0;
  const avenueMax = Math.max(
    1,
    clubServicesCount,
    ...avenues.map(a => a.completed ?? a.current ?? 0),
  );

  const categories = data.citation?.categories ?? [];
  const categoryAvgOutOf1000 = citationPoints > 0 && totalClubs > 0
    ? Math.round(citationPoints / totalClubs)
    : citationPoints;
  const categoryDonutPct = Math.min(100, (categoryAvgOutOf1000 / 1000) * 100);

  const topClubs = data.top20ClubsByMembers ?? [];

  return (
    <div className="space-y-4">
      {/* ─── 1. KPI TILES ─────────────────────────────────────────── */}
      {/* District Citation tile was removed — its value duplicates the
          "District Citation" panel in the row below and the tile added
          little on its own. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          accent="blue"
          label="Total Clubs"
          value={fmtInt(totalClubs)}
          subtitle={data.district?.districtNumber ? `District ${data.district.districtNumber}` : "In district"}
        />
        <KpiTile
          accent="green"
          label="Total Members"
          value={fmtInt(totalMembers)}
          subtitle="Across all clubs"
        />
        <KpiTile
          accent="gold"
          label="TRF Contribution"
          value={fmtUsdShort(trfRaised)}
          subtitleTone="gold"
          subtitle="All funds combined"
        />
        <KpiTile
          accent="blue"
          label="Total Projects"
          value={fmtInt(totalProjects)}
          subtitle="5 service avenues (excl. Club Services)"
        />
      </div>

      {/* ─── 2. FOUR-PANEL ROW ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Membership -------------------------------------------------- */}
        <Panel
          title="Membership"
          subtitle={
            districtBaseTotal
              ? `All ${fmtInt(districtBaseTotal)} clubs${yearLabel ? " · RY " + yearLabel : ""}`
              : yearLabel ? `RY ${yearLabel}` : undefined
          }
          headerRight={
            newThisYear > 0
              ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  +{fmtInt(newThisYear)} new
                </span>
              ) : undefined
          }
          footer={
            <>
              <span className="text-slate-500">Terminated this RY</span>
              <span className="text-slate-800 font-semibold tabular-nums">{fmtInt(terminated)}</span>
            </>
          }
        >
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 tabular-nums leading-none">
              {fmtInt(totalMembers)}
            </span>
            <span className="text-xs text-slate-500">total members</span>
          </div>
          <MetricRow label="Active"   value={fmtInt(active)}   percent={(active / memMax) * 100}   color="#2563EB" />
          <MetricRow label="Male"     value={fmtInt(male)}     percent={(male / memMax) * 100}     color="#3B82F6" />
          <MetricRow label="Female"   value={fmtInt(female)}   percent={(female / memMax) * 100}   color="#EC4899" />
          <MetricRow label="Honorary" value={fmtInt(honorary)} percent={(honorary / memMax) * 100} color="#8B5CF6" />
          <MetricRow label="Inactive" value={fmtInt(inactive)} percent={(inactive / memMax) * 100} color="#94A3B8" />
        </Panel>

        {/* TRF Contribution -------------------------------------------- */}
        {/* Every ACTIVE fund from trf_fund_master (global, admin-managed).
            Zero-amount funds still appear so admins see which funds are
            unused this year. No "goal" language — just raw contribution
            aggregates per fund. */}
        <Panel
          title="TRF Contribution"
          subtitle="District aggregate · all clubs"
          footer={
            <>
              <span className="text-slate-500">Total contributions</span>
              <span className="text-slate-800 font-semibold tabular-nums">
                {fmtUsdShort(fundTotal || trfRaised)}
              </span>
            </>
          }
        >
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 tabular-nums leading-none">
              {fmtUsdShort(fundTotal || trfRaised)}
            </span>
            <span className="text-xs text-slate-500">raised</span>
          </div>
          {fundRows.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              No fund types configured.
            </p>
          ) : (
            <div>
              {fundRows.map((row, i) => {
                const name = row.fundName ?? "—";
                const amt = row.amountInr ?? 0;
                const color = FUND_COLORS[i % FUND_COLORS.length];
                return (
                  <MetricRow
                    key={`${name}-${i}`}
                    label={name}
                    value={fmtUsdShort(amt)}
                    percent={(amt / fundRowMax) * 100}
                    color={color}
                  />
                );
              })}
            </div>
          )}
        </Panel>

        {/* Service Projects & Public Image ----------------------------- */}
        <Panel
          title="Service Projects & Public Image"
          subtitle="Project completion this RY"
          footer={
            <>
              <span className="text-slate-500">Total projects</span>
              <span className="text-slate-800 font-semibold tabular-nums">{fmtInt(totalProjects + clubServicesCount)}</span>
            </>
          }
        >
          {avenues.length === 0 && clubServicesCount === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No project data available.</p>
          ) : (
            <div>
              {/* Club Services (club meetings) — shown here but excluded from Total projects. */}
              <MetricRow
                label="Club Services"
                value={fmtInt(clubServicesCount)}
                percent={(clubServicesCount / avenueMax) * 100}
                color="#64748B"
              />
              {avenues.map((row, i) => {
                const key = (row.avenueKey ?? "").toLowerCase();
                const label = row.avenueName ?? row.name ?? row.avenueKey ?? "—";
                const count = row.completed ?? row.current ?? 0;
                const color = AVENUE_COLOR[key] ?? ROTARY_BLUE;
                return (
                  <MetricRow
                    key={(row.avenueKey ?? label ?? i).toString()}
                    label={label}
                    value={fmtInt(count)}
                    percent={(count / avenueMax) * 100}
                    color={color}
                  />
                );
              })}
            </div>
          )}
        </Panel>

        {/* District Awards ------------------------------------------- */}
        <Panel
          title="District Awards"
          subtitle="Total points · all clubs"
        >
          {(awardsEnabled === false || categories.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Award className="h-9 w-9 text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-500">
                District Awards is not activated{yearLabel ? ` for RY ${yearLabel}` : ""}
              </p>
            </div>
          ) : (
          <>
          <div className="mb-4 flex flex-col items-center">
            <Donut
              percent={100}
              color="#1e3a5f"
              size={130}
              thickness={12}
              centerTop={fmtInt(citationPoints)}
              centerBottom="points"
            />
          </div>
          {categories.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">No categories configured.</p>
          ) : (
            <ul className="space-y-1.5">
              {categories.map((row, i) => {
                const dotColor = CATEGORY_DOT_COLORS[i] ?? "#1e3a5f";
                const name = row.categoryName ?? row.category ?? "—";
                const pts = row.pointsEarned ?? row.points ?? 0;
                return (
                  <li
                    key={(row.categoryId ?? name ?? i).toString()}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: dotColor }}
                      />
                      <span className="text-slate-700 truncate">{name}</span>
                    </span>
                    <span className="text-slate-800 font-semibold tabular-nums flex-shrink-0 ml-2">
                      {fmtInt(pts)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          </>
          )}
        </Panel>
      </div>

      {/* ─── 3. BOTTOM ROW — Top 20 clubs + Leaderboard ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Top 20 Clubs — vertical bar chart -------------------------- */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm">
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">Top 10 Clubs — Member Count</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Members by club (highest first)</p>
          </div>
          <div className="px-2 pb-3">
            {topClubs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">No club data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height={330}>
                <BarChart
                  data={topClubs.slice(0, 10).map(c => ({
                    shortName: shortenClubName(c.clubName),
                    fullName: c.clubName ?? "",
                    members: c.members ?? 0,
                  }))}
                  margin={{ top: 8, right: 12, left: 8, bottom: 30 }}
                  barCategoryGap={6}
                >
                  <XAxis
                    dataKey="shortName"
                    interval={0}
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    angle={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(148,163,184,0.15)" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    labelFormatter={(_, p) => p?.[0]?.payload?.fullName ?? ""}
                    formatter={(v) => [fmtInt(Number(v)), "Members"]}
                  />
                  <Bar dataKey="members" fill="#1E40AF" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Club Leaderboard ------------------------------------------ */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="px-5 pt-4 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Club Leaderboard</h3>
          </div>
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search club..."
                value={lbSearch}
                onChange={e => { setLbSearch(e.target.value); setLbPage(1); }}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
            </div>
          </div>
          <div className="flex-1">
            {lbPageRows.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                {filteredLeaderboard.length === 0 ? "No clubs to show." : "No matches."}
              </p>
            ) : (
              <ol>
                {lbPageRows.map((c, idx) => {
                  const rank = (lbEffectivePage - 1) * LB_PAGE_SIZE + idx + 1;
                  const score = c.score ?? 0;
                  const isTopFive = rank <= 5;
                  return (
                    <li
                      key={c.clubId ?? rank}
                      className={`flex items-center gap-3 px-4 py-2.5 text-xs border-b border-slate-100 last:border-b-0 ${
                        isTopFive ? "bg-emerald-50/60" : ""
                      }`}
                    >
                      <span className="text-slate-500 tabular-nums w-5 text-right">{rank}</span>
                      <span className="flex-1 min-w-0 text-slate-800 truncate">
                        {c.clubName ?? "—"}
                      </span>
                      <span
                        className={`font-semibold tabular-nums ${
                          isTopFive ? "text-emerald-700" : "text-slate-700"
                        }`}
                      >
                        {fmtInt(score)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {/* pagination footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              {filteredLeaderboard.length === 0 ? "0" : `${(lbEffectivePage - 1) * LB_PAGE_SIZE + 1}–${
                Math.min(lbEffectivePage * LB_PAGE_SIZE, filteredLeaderboard.length)
              }`}{" "}
              of {fmtInt(filteredLeaderboard.length)}
            </span>
            <span className="inline-flex gap-1">
              <button
                type="button"
                disabled={lbEffectivePage <= 1}
                onClick={() => setLbPage(p => Math.max(1, p - 1))}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 disabled:opacity-40"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                disabled={lbEffectivePage >= lbTotalPages}
                onClick={() => setLbPage(p => Math.min(lbTotalPages, p + 1))}
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 disabled:opacity-40"
              >
                <ChevronRight size={12} />
              </button>
            </span>
          </div>
          {lbZeroPoints > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-rose-600">
              <AlertTriangle size={12} />
              {fmtInt(lbZeroPoints)} club{lbZeroPoints === 1 ? "" : "s"} with 0 points
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Strip common "Rotary Club of "/"RC " prefixes and truncate long names so
 *  20 club labels can share the X-axis width. */
function shortenClubName(name: string | undefined): string {
  if (!name) return "";
  let n = name;
  n = n.replace(/^Rotary\s+Club\s+of\s+/i, "");
  n = n.replace(/^RC\s+/i, "");
  if (n.length > 10) n = n.slice(0, 9) + "…";
  return n;
}
