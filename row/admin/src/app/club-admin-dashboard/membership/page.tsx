"use client";

import { useMemo, useState } from "react";
import { Users, UserPlus, Mars, Venus, Search } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import KpiCard from "@/components/dashboard/KpiCard";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";

export default function ClubAdminMembershipPage() {
  const { membership, status } = useClubAdminCache();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!membership) return [];
    const q = search.trim().toLowerCase();
    if (!q) return membership.members;
    return membership.members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [membership, search]);

  if (status === "loading" && !membership) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading members…" />
      </div>
    );
  }
  if (status === "error" && !membership) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load membership.</div>;
  }
  if (!membership) return null;
  const data = membership;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Membership"
        subtitle={`${data.club.clubName} · RY ${data.club.yearLabel}`}
        icon={Users}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Members" value={fmtInt(data.totalMembers)}        subtitle="Active in club"     icon={Users}      color="blue" />
        <KpiCard title="Male"          value={fmtInt(data.maleMembers)}         subtitle="Gender split"        icon={Mars}       color="teal" />
        <KpiCard title="Female"        value={fmtInt(data.femaleMembers)}       subtitle="Gender split"        icon={Venus}      color="red" />
        <KpiCard title="New this RY"   value={fmtInt(data.newMembersThisYear)}  subtitle="Joined this year"    icon={UserPlus}   color="green" />
      </div>

      {data.monthlyTrend.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-800 mb-1">Monthly Growth</h3>
          <p className="text-xs text-slate-400 mb-3">New joiners by month · RY {data.club.yearLabel}</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.monthlyTrend}>
              <defs>
                <linearGradient id="grMaleMb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#17458F" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#17458F" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grFemaleMb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F7A81B" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#F7A81B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#edf4fb" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8796aa" }} />
              <YAxis tick={{ fontSize: 11, fill: "#8796aa" }} width={28} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="male" name="Male" stroke="#17458F" fill="url(#grMaleMb)" strokeWidth={2} />
              <Area type="monotone" dataKey="female" name="Female" stroke="#F7A81B" fill="url(#grFemaleMb)" strokeWidth={2} />
              <Area type="monotone" dataKey="honorary" name="Honorary" stroke="#0067C8" fill="transparent" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.recentJoiners.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Recent Joiners</h3>
            <p className="text-xs text-slate-500 mt-0.5">Joined this RY</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Member</th>
                  <th className="px-4 py-2.5 text-left">Email</th>
                  <th className="px-4 py-2.5 text-left">Mobile</th>
                  <th className="px-4 py-2.5 text-left">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentJoiners.map((m) => (
                  <tr key={m.memberId} className="hover:bg-blue-50/40">
                    <td className="px-4 py-2 font-medium text-slate-800">{m.name}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{m.email ?? "–"}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{m.mobile ?? "–"}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{fmtDate(m.joinedDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Member Directory</h3>
            <p className="text-xs text-slate-500 mt-0.5">{filtered.length} of {data.members.length} members</p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-left">Name</th>
                <th className="px-4 py-2.5 text-left">Rotary ID</th>
                <th className="px-4 py-2.5 text-left">Email</th>
                <th className="px-4 py-2.5 text-left">Mobile</th>
                <th className="px-4 py-2.5 text-left">Gender</th>
                <th className="px-4 py-2.5 text-left">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((m) => (
                <tr key={m.memberId} className="hover:bg-blue-50/40">
                  <td className="px-4 py-2 font-medium text-slate-800">{m.name}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{m.rotaryId ?? "–"}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{m.email ?? "–"}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{m.mobile ?? "–"}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{m.gender ?? "–"}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{fmtDate(m.joinedDate)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No members match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
