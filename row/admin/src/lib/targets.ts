// Live target dashboard (N10, feature target_dashboard): metric list, labels, formatting and the table filter.
// The API computes every figure and status (api/Services/TargetDashboardService.cs); this file only presents them.

import type { TargetClubRow, TargetMetric, TargetMetricKey, TargetStatus } from "@/services/api";
import { fmtInt, fmtUsd } from "@/components/dashboard/formatters";

export const TARGETS_FEATURE = "target_dashboard";

export const METRICS: { key: TargetMetricKey; label: string; hint: string }[] = [
  { key: "members", label: "Members", hint: "Active members now, honorary members left out" },
  { key: "growth", label: "Net growth", hint: "Members who joined minus members who left this Rotary year, against the club's growth target" },
  { key: "newMembers", label: "New members", hint: "Members who joined this Rotary year, against the new member target in Goal Setting" },
  { key: "dues", label: "District dues paid", hint: "Members paid on the District Dues roster, against the members on it" },
  { key: "attendance", label: "Attendance", hint: "Average share of members present at the meetings in the attendance register" },
  { key: "meetings", label: "Meetings", hint: "Meetings in the attendance register this Rotary year" },
  { key: "projects", label: "Service projects", hint: "Projects in the five avenues of service" },
  { key: "foundation", label: "Foundation giving", hint: "Contributions in USD, against the Foundation targets in Goal Setting" },
];

export const STATUS: Record<TargetStatus, { label: string; dot: string; cell: string }> = {
  green: { label: "On track", dot: "bg-emerald-500", cell: "bg-emerald-50 text-emerald-900" },
  amber: { label: "Slightly behind", dot: "bg-amber-500", cell: "bg-amber-50 text-amber-900" },
  red: { label: "Behind", dot: "bg-red-500", cell: "bg-red-50 text-red-900" },
  none: { label: "No target", dot: "bg-slate-300", cell: "text-slate-700" },
};

function value(key: TargetMetricKey, n: number): string {
  if (key === "foundation") return fmtUsd(n);
  if (key === "attendance") return `${n}%`;
  return fmtInt(n);
}

/** "2 of 5" when there is a target, the figure alone otherwise. Net growth keeps its sign; attendance with no
 *  meetings shows "-" rather than 0%. */
export function formatMetric(key: TargetMetricKey, m: TargetMetric, meetings?: number): string {
  if (key === "attendance" && meetings === 0) return "-";
  const actual = key === "growth" && m.actual > 0 ? `+${value(key, m.actual)}` : value(key, m.actual);
  return m.target === null ? actual : `${actual} of ${value(key, m.target)}`;
}

export interface TargetFilter {
  group: string; // "all", "none" (no Assistant Governor) or an AG member id
  status: string; // "all" or a TargetStatus
  search: string;
}

export function filterClubs(rows: TargetClubRow[], f: TargetFilter): TargetClubRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) =>
    (f.group === "all" || (f.group === "none" ? r.agMemberId === null : String(r.agMemberId) === f.group))
    && (f.status === "all" || r.status === f.status)
    && (!q || r.clubName.toLowerCase().includes(q)));
}
