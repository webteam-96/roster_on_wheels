"use client";

import { useEffect, useState } from "react";
import { Award, CalendarCheck, DollarSign, Heart, TrendingUp, Users, Wallet } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import KpiCard from "@/components/dashboard/KpiCard";
import { getGoalCategories, getClubGoalForm } from "@/services/api";
import type { GoalCategoryFormDto } from "@/types/goalSetting";

// Club Foundation page (user 2026-10-08): ONLY the Achieved figures, read straight from the club's
// Goal Setting TRF form, so this page and Club Goal Setting can never show different numbers.
// Same KPI cards the (now hidden) Contribution Records section used. "As on" = last imported month.

function fmtUsd(n: number | null | undefined): string {
  return "$" + (n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function ClubFoundationAchievedCard({ clubId, yearId }: { clubId: number; yearId: number | null }) {
  const [form, setForm] = useState<GoalCategoryFormDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const cats = await getGoalCategories();
        // Shown as "Foundation" since 2026-10-09 (stored as "TRF") - accept either.
        const trf = cats.find((c) => ["TRF", "FOUNDATION"].includes(c.name.trim().toUpperCase()));
        if (!trf) throw new Error("Foundation category not found.");
        const f = await getClubGoalForm(trf.id, yearId, clubId);
        if (alive) setForm(f);
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.message || e?.message || "Failed to load Foundation figures.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clubId, yearId]);

  if (loading) return <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  // Achieved values by field key (the club's Goal Setting TRF "Achieved" rows).
  const val = (key: string) => form?.fields.find((f) => f.fieldKey === key)?.numericValue ?? null;
  const asOn = form?.achievedAsOn ? `As on ${form.achievedAsOn}` : "No data imported yet";

  return (
    <div className="space-y-3">
      {/* Header — the "As on" date must be clearly visible (user 2026-10-08). */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Foundation Achieved</h2>
          {form && <p className="text-xs text-slate-500 mt-0.5">RY {form.yearLabel} · {form.entityName}</p>}
        </div>
        <span className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-sm font-semibold">
          <CalendarCheck size={15} /> {asOn}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Total"         value={fmtUsd(val("club_total_ytd"))}       subtitle="All funds"       icon={DollarSign} color="gold" />
        <KpiCard title="Annual Fund"   value={fmtUsd(val("club_annual_fund_ytd"))} subtitle="Annual Fund YTD" icon={TrendingUp} color="blue" />
        <KpiCard title="PolioPlus"     value={fmtUsd(val("club_polioplus_ytd"))}   subtitle="PolioPlus YTD"   icon={Heart}      color="purple" />
        <KpiCard title="Endowment"     value={fmtUsd(val("club_endowment_ytd"))}   subtitle="Endowment YTD"   icon={Award}      color="gold" />
        <KpiCard title="Other Funds"   value={fmtUsd(val("club_other_funds_ytd"))} subtitle="Other Funds YTD" icon={Wallet}     color="green" />
        <KpiCard title="AF Per Capita" value={fmtUsd(val("club_af_per_capita"))}   subtitle="Per member"      icon={Users}      color="teal" />
      </div>
      <p className="text-xs italic text-slate-500">Data provided by Rotary International South Asia office</p>
    </div>
  );
}
