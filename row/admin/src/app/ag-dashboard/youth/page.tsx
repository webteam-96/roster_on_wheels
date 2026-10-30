"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Star,
  Users,
  Globe,
  BookOpen,
  Briefcase,
 
  ChevronUp,
  ChevronDown,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getAgDashboardYouth } from "@/services/api";
import type { AgYouthResponse, AgYouthClubRow } from "@/types/agDashboard";
import { useAuth } from "@/contexts/AuthContext";
import { useAgYearId } from "@/hooks/useAgYearId";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import {
  fmtInt,
  ROTARY_BLUE,
  ROTARY_GOLD,
  truncate,
} from "@/components/dashboard/formatters";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ListPageSkeleton } from "@/components/row/AppKit";

const NEW_GEN_COLOR = ROTARY_GOLD;
const VOCATIONAL_COLOR = ROTARY_BLUE;
const INTERNATIONAL_COLOR = "#2A3F5C";

type SortKey =
  | "clubName"
  | "newGenerationService"
  | "vocationalService"
  | "internationalService"
  | "totalProjects"
  | "members";

function ProgressRow({
  label,
  value,
  total,
  clubCount,
}: {
  label: string;
  value: number;
  total: number;
  clubCount: number;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm font-bold text-amber-700 tabular-nums">
          {value}{" "}
          <span className="text-slate-400 font-normal">
            / {total} total
          </span>
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-2.5 rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: NEW_GEN_COLOR,
          }}
        />
      </div>
      <div className="text-[11px] text-slate-400 mt-1 text-right">
        {pct.toFixed(1)}% of all clubs ({clubCount})
      </div>
    </div>
  );
}

function SortTh({
  label,
  field,
  align = "left",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortKey;
  align?: "left" | "center" | "right";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === field;
  const alignClass =
    align === "right" ? "text-right justify-end" : align === "center" ? "text-center justify-center" : "text-left";
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-4 py-3 font-semibold cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap text-xs uppercase tracking-wide ${align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"}`}
    >
      <div className={`inline-flex items-center gap-1 ${alignClass}`}>
        {label}
        {active ? (
          sortDir === "desc" ? (
            <ChevronDown size={13} className="text-blue-500" />
          ) : (
            <ChevronUp size={13} className="text-blue-500" />
          )
        ) : (
          <ChevronDown size={13} className="text-slate-300" />
        )}
      </div>
    </th>
  );
}

function ClubDetailCard({
  club,
  rank,
}: {
  club: AgYouthClubRow;
  rank: number;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <CardHeader
        className="text-white py-3 px-4"
        style={{ background: ROTARY_BLUE }}
      >
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="truncate">{club.clubName}</span>
          <span className="text-[10px] font-medium text-blue-100 bg-white/15 px-2 py-0.5 rounded-full whitespace-nowrap">
            #{rank}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-4 space-y-2.5">
        <div className="flex items-center justify-between text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: NEW_GEN_COLOR }}
            />
            <span className="text-slate-600">New Generation</span>
          </div>
          <span className="font-semibold text-slate-800 tabular-nums">
            {club.newGenerationService}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: VOCATIONAL_COLOR }}
            />
            <span className="text-slate-600">Vocational</span>
          </div>
          <span className="font-semibold text-slate-800 tabular-nums">
            {club.vocationalService}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: INTERNATIONAL_COLOR }}
            />
            <span className="text-slate-600">International</span>
          </div>
          <span className="font-semibold text-slate-800 tabular-nums">
            {club.internationalService}
          </span>
        </div>
        <div className="border-t border-slate-100 pt-2.5 mt-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Total Projects
          </span>
          <span className="text-base font-bold text-amber-700 tabular-nums">
            {club.totalProjects}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Members</span>
          <span className="tabular-nums font-medium">{club.members}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgYouthPage() {
  const { selectedDistrictId } = useAuth();
  const yearId = useAgYearId();
  const [data, setData] = useState<AgYouthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalProjects");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Wave 9G / 13A2: scope to AG-selected district when set.
    getAgDashboardYouth(yearId, null, selectedDistrictId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load youth services.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDistrictId, yearId]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "clubName" ? "asc" : "desc");
    }
  };

  const sortedClubs = useMemo(() => {
    if (!data) return [];
    return [...data.clubs].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.clubs
      .filter(
        (c) =>
          c.newGenerationService +
            c.vocationalService +
            c.internationalService >
          0,
      )
      .map((c) => ({
        name: truncate(c.clubName, 18),
        fullName: c.clubName,
        "New Generation": c.newGenerationService,
        Vocational: c.vocationalService,
        International: c.internationalService,
      }));
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }
  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  if (!data) return null;

  const clubCount = data.clubs.length;
  const totalMembers = data.clubs.reduce((s, c) => s + c.members, 0);
  const yearLabel = data.ag.yearLabel || "–";

  // Top 4 clubs by total projects for the detail cards row.
  const topDetailClubs = [...data.clubs]
    .sort((a, b) => b.totalProjects - a.totalProjects)
    .slice(0, 4);

  return (
    <div className="space-y-8">
      <SectionHeader
        title="Youth & New Generation Services"
        subtitle={`New generation service activities across all ${clubCount} clubs: Rotary Year ${yearLabel}`}
        icon={Star}
      />

      {/* 4 numbered KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="New Generation Service"
          value={fmtInt(data.totalNewGeneration)}
          subtitle={`across ${clubCount} clubs`}
          icon={Star}
          color="gold"
        />
        <KpiCard
          title="Vocational Service"
          value={fmtInt(data.totalVocational)}
          subtitle={`across ${clubCount} clubs`}
          icon={Users}
          color="blue"
        />
        <KpiCard
          title="International Service"
          value={fmtInt(data.totalInternational)}
          subtitle={`across ${clubCount} clubs`}
          icon={Globe}
          color="green"
        />
        <KpiCard
          title="Total Projects"
          value={fmtInt(data.totalProjects)}
          subtitle="all service categories"
          icon={BookOpen}
          color="purple"
        />
      </div>

      {/* Per-Club New Generation Service Count */}
      <div className="bg-white rounded-[20px] border border-slate-200 p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Per-Club New Generation Service Count
        </h3>
        <p className="text-xs text-slate-500 mb-5">
          New Generation Service activities by club
        </p>
        {data.clubs.length === 0 ? (
          <p className="text-xs text-slate-400">No clubs in scope.</p>
        ) : (
          data.clubs.map((club) => (
            <ProgressRow
              key={club.clubId}
              label={club.clubName}
              value={club.newGenerationService}
              total={data.totalNewGeneration || 1}
              clubCount={clubCount}
            />
          ))
        )}
      </div>

      {/* Stacked Per-Club Service Breakdown */}
      <div className="bg-white rounded-[20px] border border-slate-200 p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Per-Club Service Breakdown
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          New generation, vocational and international service activities per
          club
        </p>
        {chartData.length === 0 ? (
          <p className="text-xs text-slate-400">No service activities yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 24, left: 0, bottom: 50 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#edf4fb" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#64748b" }}
                angle={-25}
                textAnchor="end"
                interval={0}
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelFormatter={(label, payload) => {
                  const arr = Array.isArray(payload) ? payload : [];
                  const p = arr[0]?.payload as { fullName?: string } | undefined;
                  return p?.fullName ?? (label as string);
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar
                dataKey="New Generation"
                stackId="services"
                fill={NEW_GEN_COLOR}
              />
              <Bar
                dataKey="Vocational"
                stackId="services"
                fill={VOCATIONAL_COLOR}
              />
              <Bar
                dataKey="International"
                stackId="services"
                fill={INTERNATIONAL_COLOR}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Club-wise Service Activity table */}
      <div className="bg-white rounded-[20px] border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">
            Club-wise Service Activity
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Service category counts per club · RY {yearLabel}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#EDF4FB] text-slate-500 border-b border-slate-200">
              <tr>
                <SortTh
                  label="Club Name"
                  field="clubName"
                  align="left"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh
                  label="New Generation"
                  field="newGenerationService"
                  align="center"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh
                  label="Vocational"
                  field="vocationalService"
                  align="center"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh
                  label="International"
                  field="internationalService"
                  align="center"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh
                  label="Total Projects"
                  field="totalProjects"
                  align="center"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh
                  label="Members"
                  field="members"
                  align="center"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {sortedClubs.map((row) => {
                const isZero =
                  row.newGenerationService +
                    row.vocationalService +
                    row.internationalService ===
                  0;
                return (
                  <tr
                    key={row.clubId}
                    className={`border-t border-slate-100 ${
                      isZero ? "bg-slate-50/60" : "hover:bg-blue-50/40"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <span
                        className={
                          isZero ? "text-slate-400" : "text-slate-800"
                        }
                      >
                        {row.clubName}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-center tabular-nums ${
                        isZero
                          ? "text-slate-300"
                          : "font-semibold text-slate-800"
                      }`}
                    >
                      {row.newGenerationService || "–"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-center tabular-nums ${
                        isZero
                          ? "text-slate-300"
                          : "font-semibold text-slate-800"
                      }`}
                    >
                      {row.vocationalService || "–"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-center tabular-nums ${
                        isZero
                          ? "text-slate-300"
                          : "font-semibold text-slate-800"
                      }`}
                    >
                      {row.internationalService || "–"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-center font-bold tabular-nums ${
                        isZero ? "text-slate-300" : "text-amber-700"
                      }`}
                    >
                      {row.totalProjects || "–"}
                    </td>
                    <td className="px-4 py-2.5 text-center text-slate-600 tabular-nums">
                      {row.members}
                    </td>
                  </tr>
                );
              })}
              {sortedClubs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-400 text-sm"
                  >
                    No clubs in scope.
                  </td>
                </tr>
              )}
            </tbody>
            {sortedClubs.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
                  <td className="px-4 py-3">All Clubs Total</td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {data.totalNewGeneration}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {data.totalVocational}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {data.totalInternational}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-amber-700">
                    {data.totalProjects}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {totalMembers}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* New Generation Service Detail by Club */}
      {topDetailClubs.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Briefcase size={16} className="text-slate-500" />
            <h3 className="text-base font-semibold text-slate-800">
              New Generation Service Detail by Club
            </h3>
            <span className="text-xs text-slate-400">
              · Top {topDetailClubs.length} by total projects
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topDetailClubs.map((club, idx) => (
              <ClubDetailCard
                key={club.clubId}
                club={club}
                rank={idx + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
