"use client";
import { DataTable } from "@/components/ui/data-table";

import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Users, Calendar, Briefcase, Heart } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend,
} from "recharts";
import { getAgDashboardClubDetail } from "@/services/api";
import type { AgClubDetailResponse } from "@/types/agDashboard";
import { fmtInt, fmtInr, fmtInrShort, fmtDate, ROTARY_BLUE, ROTARY_GOLD } from "@/components/dashboard/formatters";
import KpiCard from "@/components/dashboard/KpiCard";
import { useAgYearId } from "@/hooks/useAgYearId";
import { formatMoney } from "@/lib/currency";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function AgClubDetailPage() {
  const params = useParams();
  const clubIdRaw = params?.clubId;
  const clubId = typeof clubIdRaw === "string" ? parseInt(clubIdRaw, 10) : NaN;
  const yearId = useAgYearId();

  const [data, setData] = useState<AgClubDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Number.isNaN(clubId)) { setLoading(false); setError("Invalid club id."); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgDashboardClubDetail(clubId, yearId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load club detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId, yearId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <ListPageSkeleton />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { summary, monthly, trf, recentProjects } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={summary.clubName} description={<>District {summary.districtNumber || "–"} · President: {summary.presidentName || "–"} {summary.projectRank ? ` · District rank #${summary.projectRank}` : ""}</>} back="/ag-dashboard/clubs" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Members"   value={fmtInt(summary.members)}       icon={Users}     color="blue"  />
        <KpiCard title="Club Service" value={fmtInt(summary.clubService)} icon={Calendar}  color="green" />
        <KpiCard title="Projects"  value={fmtInt(summary.totalProjects)} icon={Briefcase} color="purple"/>
        <KpiCard title="TRF Total" value={fmtInr(summary.trfTotalInr)}   icon={Heart}     color="gold"  />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="row-h3 mb-3">Monthly Activity</h3>
          {monthly.length === 0 ? (
            <p className="text-xs text-slate-400">No monthly data for this year yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthly} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d3dde8" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={32} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="meetings" name="Meetings" stroke={ROTARY_BLUE} strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="projects" name="Projects" stroke={ROTARY_GOLD} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="row-h3 mb-3">TRF Breakdown</h3>
          {trf.totalInr === 0 ? (
            <p className="text-xs text-slate-400">No TRF contributions recorded.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={[
                  { name: "Annual",    value: trf.annualInr },
                  { name: "PolioPlus", value: trf.polioInr },
                  { name: "Endowment", value: trf.endowment },
                  { name: "Others",    value: trf.others },
                ]}
                margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#d3dde8" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tickFormatter={(v) => fmtInrShort(v)} tick={{ fontSize: 10, fill: "#64748b" }} width={60} />
                <Tooltip formatter={(v) => fmtInr(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" fill={ROTARY_BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="row-h3">Recent Projects</h3>
          <p className="text-xs text-slate-500 mt-0.5">Top 10 most recent</p>
        </div>
        {recentProjects.length === 0 ? (
          <p className="px-5 py-6 text-xs text-slate-400">No projects yet.</p>
        ) : (
          <DataTable
            caption="Recent projects"
            card={false}
            rows={recentProjects}
            rowKey={(_, i) => i}
            columns={[
              { key: "date", header: "Date", className: "whitespace-nowrap", cell: (p) => fmtDate(p.date) },
              { key: "title", header: "Title", className: "font-medium", cell: (p) => p.title },
              { key: "cost", header: "Cost", align: "right", className: "tabular-nums", cell: (p) => (p.cost > 0 ? formatMoney(p.cost, p.currency) : "–") },
              { key: "beneficiaries", header: "Beneficiaries", align: "right", className: "tabular-nums", cell: (p) => (p.beneficiaries > 0 ? fmtInt(p.beneficiaries) : "–") },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
