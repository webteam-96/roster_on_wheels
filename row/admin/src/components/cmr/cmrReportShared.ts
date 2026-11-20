// Shared figures for the NEW CMR report designs C and D (A and B keep their own copies). Same numbers as
// every other design: everything comes from foundationTable / membershipTable / the report itself.

import type { CmrReportProps } from "@/components/cmr/CmrReportDesignA";
import { CMR_PROJECT_LABELS, groupCmrMeetings } from "@/components/cmr/cmrLabels";
import { appLocale } from "@/lib/appFormat";

export const reportDay = (iso: string | null, withYear = false) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(appLocale(), withYear ? { day: "2-digit", month: "short", year: "numeric" } : { day: "2-digit", month: "short" });
};

const num = (s: string | undefined) => {
  const t = String(s ?? "").replace(/[,+\s]/g, "");
  if (t === "" || t === "–") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

// Achievement % the Goal Setting way: Membership whole numbers, Foundation 2 decimals, never capped.
export const achievedPct = (a: number | null, b: number | null, dp: number) =>
  a == null || b == null || b === 0 ? null : Math.round((a / b) * 100 * 10 ** dp) / 10 ** dp;

export function reportFigures(p: CmrReportProps) {
  const { report, membership, counts, foundation } = p;
  const groups = groupCmrMeetings(report.meetings);
  const pcts = report.meetings.map((m) => m.attendancePercentage).filter((v): v is number => v != null);
  const avgAttendance = pcts.length ? Math.round(pcts.reduce((s, v) => s + Number(v), 0) / pcts.length) : null;
  const projectTypes = Object.keys(CMR_PROJECT_LABELS).filter((k) => (report.projects[k]?.length ?? 0) > 0);
  const projectCount = projectTypes.reduce((s, k) => s + report.projects[k].length, 0);
  const row = (label: string) => membership.find((r) => r.label === label);
  const membersNow = counts.start + counts.added - counts.terminated;
  const memberTarget = num(row("Members now")?.yearTarget);
  const july1 = num(row("Members at start")?.ytd);
  const netGrowth = num(row("Members now")?.ytd);
  const womenNow = num(row("Women members now")?.ytd);
  const womenTarget = num(row("Women members now")?.yearTarget);
  return {
    groups, avgAttendance, projectTypes, projectCount, row, membersNow, memberTarget, july1, netGrowth, womenNow, womenTarget,
    memberPct: achievedPct(membersNow, memberTarget, 0),
    womenPct: achievedPct(womenNow, womenTarget, 0),
    foundationPct: foundation.synced ? achievedPct(foundation.total.ytd, foundation.total.yearTarget, 2) : null,
  };
}
