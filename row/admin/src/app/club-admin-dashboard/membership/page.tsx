"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useMemo, useState } from "react";
import { Search } from "@/components/icons";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { fmtInt, fmtDate } from "@/components/dashboard/formatters";
import {
  ErrorState, KpiTile, ListPageSkeleton, PageHeader, Panel, SearchField, rowTable as t,
} from "@/components/row/AppKit";

export default function ClubAdminMembershipPage() {
  const { membership, status } = useClubAdminCache();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!membership) return [];
    const q = search.trim().toLowerCase();
    if (!q) return membership.members;
    return membership.members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [membership, search]);

  if (status === "loading" && !membership) return <ListPageSkeleton />;
  if (status === "error" && !membership) return <ErrorState message="Failed to load membership." />;
  if (!membership) return null;
  const data = membership;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membership"
        description={`${data.club.clubName} · RY ${data.club.yearLabel}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile tone="sky" label="Total Members" value={fmtInt(data.totalMembers)} note="Active in club" />
        <KpiTile tone="lilac" label="Male" value={fmtInt(data.maleMembers)} note="Gender split" />
        <KpiTile tone="cream2" label="Female" value={fmtInt(data.femaleMembers)} note="Gender split" />
        <KpiTile tone="coral" label="New this RY" value={fmtInt(data.newMembersThisYear)} note="Joined this year" />
      </div>

      {data.monthlyTrend.length > 0 && (
        <Panel title="Monthly Growth" subtitle={`New joiners by month · RY ${data.club.yearLabel}`}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.monthlyTrend}>
              <CartesianGrid vertical={false} stroke="rgba(27,44,66,.12)" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#64748B" }} />
              <YAxis tick={{ fontSize: 12, fill: "#64748B" }} width={28} />
              <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid rgba(27,44,66,.12)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="male" name="Male" stroke="#17458F" fill="#17458F" fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="female" name="Female" stroke="#F7A81B" fill="#F7A81B" fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="honorary" name="Honorary" stroke="#0067C8" fill="transparent" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {data.recentJoiners.length > 0 && (
        <Panel title="Recent Joiners" subtitle="Joined this RY">
          <div className={`-mx-6 ${t.wrap}`}>
            <Table className={t.table}>
              <TableHeader className={t.head}>
                <TableRow>
                  <TableHead className={t.th}>Member</TableHead>
                  <TableHead className={t.th}>Email</TableHead>
                  <TableHead className={t.th}>Mobile</TableHead>
                  <TableHead className={t.th}>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={t.body}>
                {data.recentJoiners.map((m) => (
                  <TableRow key={m.memberId} className={t.tr}>
                    <TableCell className={`${t.td} font-semibold`}>{m.name}</TableCell>
                    <TableCell className={t.tdMuted}>{m.email ?? "–"}</TableCell>
                    <TableCell className={t.tdMuted}>{m.mobile ?? "–"}</TableCell>
                    <TableCell className={t.tdMuted}>{fmtDate(m.joinedDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}

      <Panel
        title="Member Directory"
        subtitle={`${filtered.length} of ${data.members.length} members`}
        headerRight={
          <SearchField value={search} onChange={setSearch} label="Search members" placeholder="Search members…" icon={<Search size={16} />} />
        }
      >
        {/* Desktop and tablet: table. Phone: one card per member (design.md 8.3 ListPage). */}
        <div className={`-mx-6 hidden max-h-[600px] overflow-y-auto md:block ${t.wrap}`}>
          <Table bare className={t.table}>
            <TableHeader className={`${t.head} sticky top-0`}>
              <TableRow>
                <TableHead className={t.th}>Name</TableHead>
                <TableHead className={t.th}>Rotary ID</TableHead>
                <TableHead className={t.th}>Email</TableHead>
                <TableHead className={t.th}>Mobile</TableHead>
                <TableHead className={t.th}>Gender</TableHead>
                <TableHead className={t.th}>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={t.body}>
              {filtered.map((m) => (
                <TableRow key={m.memberId} className={t.tr}>
                  <TableCell className={`${t.td} font-semibold`}>{m.name}</TableCell>
                  <TableCell className={t.tdMuted}>{m.rotaryId ?? "–"}</TableCell>
                  <TableCell className={t.tdMuted}>{m.email ?? "–"}</TableCell>
                  <TableCell className={t.tdMuted}>{m.mobile ?? "–"}</TableCell>
                  <TableCell className={t.tdMuted}>{m.gender ?? "–"}</TableCell>
                  <TableCell className={t.tdMuted}>{fmtDate(m.joinedDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="divide-y divide-[color:var(--row-line)] md:hidden">
          {filtered.map((m) => (
            <li key={m.memberId} className="py-3">
              <p className="text-[16px] font-semibold text-[#1B2C42]">{m.name}</p>
              <p className="mt-0.5 text-[14px] text-muted-foreground">{m.email ?? "–"}</p>
              <p className="text-[14px] text-muted-foreground">{m.mobile ?? "–"} · Joined {fmtDate(m.joinedDate)}</p>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-[15px] text-muted-foreground">No members match your search.</p>
        )}
      </Panel>
    </div>
  );
}
