"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Heart, Briefcase, Award, AlertCircle, Calendar,
  BadgeCheck, Crown, UserCircle2, UserSquare2, Mail, ClipboardCheck,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import KpiCard from "@/components/dashboard/KpiCard";
import {
  fmtInt, fmtInr, fmtInrShort, fmtUsd, fmtUsdShort, fmtDate, ROTARY_BLUE,
} from "@/components/dashboard/formatters";
import AlertModal from "@/components/AlertModal";
import { getClubPendingOfflineApprovals } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import SyncProjectsToRotaryOrgCard from "@/components/dashboard/SyncProjectsToRotaryOrgCard";

export default function ClubAdminDashboardOverviewPage() {
  const { overview, status, yearId } = useClubAdminCache();
  const router = useRouter();
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;
  const clubIdForPending = overview?.club?.clubId ?? 0;
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ duesId: number; purpose: string; pendingCount: number }>>([]);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);

  // Show a popup on first dashboard render if any membership_dues for this
  // club has at least one pending offline payment awaiting approval.
  useEffect(() => {
    if (!canManage || !clubIdForPending) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getClubPendingOfflineApprovals(clubIdForPending);
        if (cancelled) return;
        if (Array.isArray(list) && list.length > 0) {
          setPendingApprovals(list);
          setPendingDialogOpen(true);
        }
      } catch { /* silently ignore: popup is a nudge */ }
    })();
    return () => { cancelled = true; };
  }, [clubIdForPending, canManage]);

  if (status === "loading" && !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading dashboard…" />
      </div>
    );
  }
  if (status === "error" && !overview) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load overview.</div>;
  }
  if (!overview) return null;
  const data = overview;

  const trfPct = data.trfGoalInr > 0 ? Math.round((data.trfRaisedInr / data.trfGoalInr) * 100) : 0;
  const websiteWarning = data.club.clubWebsiteExpiry && new Date(data.club.clubWebsiteExpiry) < new Date();
  const totalPending = pendingApprovals.reduce((s, r) => s + (r.pendingCount || 0), 0);
  const firstPending = pendingApprovals[0];

  return (
    <div className="space-y-5">
      <AlertModal
        open={pendingDialogOpen}
        onOpenChange={setPendingDialogOpen}
        icon={ClipboardCheck}
        iconClassName="text-amber-500"
        title="Offline payment approvals pending"
        description={
          firstPending
            ? `${totalPending} offline payment${totalPending === 1 ? "" : "s"} waiting for your approval across ${pendingApprovals.length} dues record${pendingApprovals.length === 1 ? "" : "s"}.${firstPending.purpose ? ` Open "${firstPending.purpose}" now?` : " Open the first one now?"}`
            : ""
        }
        confirmLabel="OK, review now"
        confirmClassName="bg-amber-600 hover:bg-amber-700"
        onConfirm={() => {
          setPendingDialogOpen(false);
          // Land on the Club Admin Club Dues tab (new design). The user
          // picks which dues record + drills into Members from there.
          router.push(`/club-admin-dashboard/membership-dues${yearId ? `?yearId=${yearId}` : ""}`);
        }}
        cancelLabel="Cancel"
        onCancel={() => setPendingDialogOpen(false)}
      />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
        {/* Rotary.org Sync — now dynamic, sourced from club_master.IsRotaryOrgSyncEnabled */}
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full ${data.club.rotaryOrgSyncEnabled ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`} />
          <span className={`text-xs font-semibold whitespace-nowrap ${data.club.rotaryOrgSyncEnabled ? "text-emerald-700" : "text-amber-700"}`}>
            Rotary.org Sync: {data.club.rotaryOrgSyncEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="w-px h-5 bg-slate-300 hidden sm:block" />
        <div className="flex items-center gap-1.5 min-w-0" title="Available Email credits">
          <Mail className="h-3.5 w-3.5 text-blue-600" />
          <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
            Email: <span className="tabular-nums">{fmtInt(data.club.emailCreditBalance ?? 0)}</span>
          </span>
        </div>
        <div className="w-px h-5 bg-slate-300 hidden sm:block" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-2 h-2 rounded-full ${websiteWarning ? "bg-red-500 animate-pulse" : data.club.clubWebsiteActive ? "bg-emerald-500" : "bg-slate-400"}`} />
          <span className={`text-xs font-semibold whitespace-nowrap ${websiteWarning ? "text-red-700" : data.club.clubWebsiteActive ? "text-emerald-700" : "text-slate-600"}`}>
            Club Website: {websiteWarning ? "Overdue" : data.club.clubWebsiteActive ? "Active" : "Not Configured"}
          </span>
          {data.club.clubWebsiteExpiry && (
            <span className="text-xs text-slate-400 whitespace-nowrap">· Expiry {fmtDate(data.club.clubWebsiteExpiry)}</span>
          )}
        </div>
      </div>

      {canManage && <SyncProjectsToRotaryOrgCard clubId={data.club.clubId} />}

      {/* 9-card strip: 5 per row on lg+, wraps to next row for the remaining 4.
          Order: Active, Male, Female, Honorary, Total, Avg Attendance, TRF Raised,
          Service Projects (4 avenues only), Citation Score. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* The API already leaves honorary OUT of totalMembers (user 2026-09-29), so subtracting them
            here took them off twice - the tile read 117 for a club of 121 + 4 honorary. */}
        <KpiCard title="Active Members"    value={fmtInt(data.totalMembers)}                      subtitle="Non-honorary"                                                              icon={BadgeCheck}  color="green" />
        <KpiCard title="Male"            value={fmtInt(data.maleMembers)}                          subtitle="Members"                                                                  icon={UserCircle2} color="blue" />
        <KpiCard title="Female"          value={fmtInt(data.femaleMembers)}                        subtitle="Members"                                                                  icon={UserSquare2} color="purple" />
        <KpiCard title="Honorary"        value={fmtInt(data.honoraryMembers)}                      subtitle="Members"                                                                  icon={Crown}       color="gold" />
        <KpiCard title="Total Members"   value={fmtInt(data.totalMembers)}                         subtitle={`+${data.newMembersThisYear} this RY`}                                    icon={Users}       color="blue" />
        <KpiCard title="Avg Attendance"  value={`${data.avgAttendance.toFixed(1)}%`}               subtitle="From meeting records"                                                     icon={Calendar}    color="green" />
        <KpiCard title="TRF Raised"      value={fmtUsdShort(data.trfRaisedInr)}                    subtitle={data.trfGoalInr ? `${trfPct}% of ${fmtUsdShort(data.trfGoalInr)}` : "No goal set"} icon={Heart}    color="gold" />
        <KpiCard title="Awards Score"    value={fmtInt(data.districtCitationScore)}               subtitle="District awards"                                                        icon={Award}       color="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-stretch">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Membership</h3>
          <p className="text-xs text-slate-500 mb-3">RY {data.club.yearLabel} snapshot</p>
          <p className="text-3xl font-extrabold text-slate-900 tabular-nums">{data.totalMembers} <span className="text-xs text-slate-400 font-normal">total members</span></p>
          <div className="mt-3 space-y-2">
            {[
              { label: "Male", value: data.maleMembers, color: "#17458F" },
              { label: "Female", value: data.femaleMembers, color: "#F7A81B" },
              { label: "Honorary", value: data.honoraryMembers, color: "#0067C8" },
            ].map((s) => (
              <div key={s.label}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-xs text-slate-500">{s.label}</span>
                  <span className="text-xs font-semibold" style={{ color: s.color }}>{s.value}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${data.totalMembers > 0 ? (s.value / data.totalMembers) * 100 : 0}%`, backgroundColor: s.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">TRF Breakdown</h3>
          <p className="text-xs text-slate-500 mb-3">By fund type · RY {data.club.yearLabel}</p>
          {[
            { label: "Annual Fund", val: data.trfAnnualFund, color: ROTARY_BLUE },
            { label: "Polio Fund", val: data.trfPolioFund, color: "#F7A81B" },
            { label: "Endowment", val: data.trfEndowment, color: "#0067C8" },
            { label: "Major Donors", val: data.trfMajorDonors, color: "#2A3F5C", suffix: " donors" },
            { label: "Contributors", val: data.phfContributors, color: "#16a34a", suffix: " members" },
          ].map((r) => (
            <div key={r.label} className="mb-2.5">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-500">{r.label}</span>
                <span className="text-xs font-semibold" style={{ color: r.color }}>
                  {r.suffix ? `${r.val}${r.suffix}` : fmtUsd(r.val)}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${data.trfRaisedInr > 0 ? Math.min(100, (Number(r.val) / Math.max(data.trfRaisedInr, 1)) * 100) : 0}%`,
                  backgroundColor: r.color
                }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Service Projects & Avenues</h3>
          <p className="text-xs text-slate-500 mb-3">By module this RY</p>
          {data.avenues.length === 0 ? (
            <p className="text-xs text-slate-400">No project data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.avenues.map((a) => (
                <div key={a.avenue}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-medium text-slate-700 truncate" title={a.avenue}>{a.avenue}</span>
                    <span className="text-xs font-semibold text-slate-700">{a.completed}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${data.serviceProjects > 0 ? (a.completed / data.serviceProjects) * 100 : 0}%`, background: ROTARY_BLUE }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-xs">
            <span className="text-slate-500">Total projects</span>
            <span className="text-sm font-extrabold text-slate-800">{fmtInt(data.serviceProjects)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">District Awards</h3>
          <p className="text-xs text-slate-500 mb-3">Points by category</p>
          {data.citationChecklist.length === 0 ? (
            <p className="text-xs text-slate-400">No citation entries yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.citationChecklist.map((c) => (
                <div key={c.criterion}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-600 truncate" title={c.criterion}>{c.criterion}</span>
                    <span className="text-xs font-bold text-rose-600">{fmtInt(c.earned)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-xs">
            <span className="text-slate-500">Total score</span>
            <span className="text-sm font-extrabold text-rose-600">{fmtInt(data.districtCitationScore)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Membership: Monthly Growth</h3>
          <p className="text-xs text-slate-500 mb-3">New joiners by month · RY {data.club.yearLabel}</p>
          {data.memberGrowth.length === 0 ? (
            <p className="text-xs text-slate-400">No data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.memberGrowth}>
                <defs>
                  <linearGradient id="grMale" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#17458F" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#17458F" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grFemale" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F7A81B" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#F7A81B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf4fb" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8796aa" }} />
                <YAxis tick={{ fontSize: 11, fill: "#8796aa" }} width={28} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="male" name="Male" stroke="#17458F" fill="url(#grMale)" strokeWidth={2} />
                <Area type="monotone" dataKey="female" name="Female" stroke="#F7A81B" fill="url(#grFemale)" strokeWidth={2} />
                <Area type="monotone" dataKey="honorary" name="Honorary" stroke="#0067C8" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Upcoming Events</h3>
          <p className="text-xs text-slate-500 mb-3">Next 8</p>
          {data.upcomingEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <AlertCircle size={28} className="opacity-40 mb-2" />
              <p className="text-xs">No upcoming events</p>
            </div>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {data.upcomingEvents.map((ev, i) => (
                <li key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-slate-50">
                  <span className="text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 bg-slate-200 text-slate-600 flex-shrink-0">{ev.type}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{ev.title}</p>
                    <p className="text-slate-500">{fmtDate(ev.date)}{ev.location ? ` · ${ev.location}` : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
