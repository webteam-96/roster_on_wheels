"use client";

// Ranking list for the new goal flow (user 2026-11-17): RI Director -> districts, DG -> clubs.
// Top 3 as podium cards, then every row with a goal progress bar. Clicking a row opens it.

import { MenuItemButton, TileButton } from "@/components/ui/text-buttons";
import { useMemo, useState } from "react";
import { Search, Trophy, ChevronRight } from "@/components/icons";
import { fmtGoalPct } from "@/components/awards/GoalAchievement";

export interface RankItem {
  key: number; rank: number; name: string; sub?: string;
  points?: number;            // District Awards points (club list only)
  goals: number; reached: number; score: number | null;
  detail?: string;            // shown instead of "x/y reached · %" (District Set Goals: "150 of 250 achieved · 60%")
}

const MEDAL = ["bg-[#F7A81B] text-[#0B2A5E]", "bg-slate-300 text-slate-800", "bg-[#CD7F32] text-white"];
const barColor = (s: number | null) => s == null ? "bg-slate-200" : s >= 100 ? "bg-emerald-500" : s >= 50 ? "bg-blue-500" : s >= 25 ? "bg-amber-500" : "bg-red-500";
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-IN");

export default function RankingList({ items, rankBy, onOpen, emptyText, pointsOnly }: {
  items: RankItem[]; rankBy: "points" | "score"; onOpen?: (key: number) => void; emptyText: string;
  pointsOnly?: boolean;   // District Set Goals (user 2026-11-19): no progress bar / achieved line - name and points only
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => items.filter((i) => `${i.name} ${i.sub ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const top = items.slice(0, 3).filter((i) => rankBy === "points" ? (i.points ?? 0) > 0 : i.score != null);
  const headline = (i: RankItem) => rankBy === "points" ? `${fmtInt(i.points ?? 0)} points` : fmtGoalPct(i.score, 0);

  if (items.length === 0)
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{emptyText}</div>;

  return (
    <div className="space-y-4">
      {top.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {top.map((i, n) => (
            <TileButton key={i.key} onClick={() => onOpen?.(i.key)}
              className="p-4">
              <div className="flex items-center justify-between">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold ${MEDAL[n]}`}>{i.rank}</span>
                <Trophy size={18} className="text-[#F7A81B]" />
              </div>
              <div className="mt-3 font-bold text-slate-900 truncate" title={i.name}>{i.name}</div>
              {i.sub && <div className="text-xs text-slate-500 truncate">{i.sub}</div>}
              {rankBy === "points" && <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rank {i.rank} · Total points</div>}
              <div className={`${rankBy === "points" ? "" : "mt-2 "}text-2xl font-extrabold text-[#0B2A5E] tabular-nums`}>{rankBy === "points" ? fmtInt(i.points ?? 0) : headline(i)}</div>
              {pointsOnly ? <div className="text-xs text-slate-500">Goals set: <b className="text-slate-700">{i.goals}</b> · Achieved: <b className="text-slate-700">{i.reached}</b></div>
                : <div className="text-xs text-slate-500">{i.detail ?? `${i.reached} of ${i.goals} goals reached`}</div>}
            </TileButton>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Search size={15} className="text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
          <span className="text-xs text-slate-500">{shown.length} of {items.length}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span className="w-7 shrink-0 text-center">Rank</span>
          <span className="flex-1">{pointsOnly ? "Name · goals set · achieved" : "Name · goals reached"}</span>
          <span className="shrink-0">{rankBy === "points" ? "Total points" : "Achieved"}</span>
          {onOpen && <span className="w-4 shrink-0" />}
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.map((i) => (
            <li key={i.key}>
              <MenuItemButton type="button" onClick={() => onOpen?.(i.key)} className="gap-3 rounded-none px-4 py-3">
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.rank <= 3 ? MEDAL[i.rank - 1] : "bg-slate-100 text-slate-600"}`}>{i.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold text-slate-800">{i.name}{i.sub && <span className="ml-2 text-xs font-normal text-slate-500">{i.sub}</span>}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-[#0B2A5E]">{headline(i)}</span>
                  </div>
                  {pointsOnly && (
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-500 tabular-nums">
                      <span>Goals set: <b className="text-slate-800">{i.goals}</b></span>
                      <span>Achieved: <b className="text-slate-800">{i.reached}</b></span>
                    </div>
                  )}
                  {!pointsOnly && <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(i.score)}`} style={{ width: `${Math.min(i.score ?? 0, 100)}%` }} />
                    </div>
                    <span className="w-40 shrink-0 text-right text-[11px] text-slate-500 tabular-nums">
                      {i.detail ?? (i.goals === 0 ? "No goals set" : `${i.reached}/${i.goals} reached · ${fmtGoalPct(i.score, 0)}`)}
                    </span>
                  </div>}
                </div>
                {onOpen && <ChevronRight size={16} className="shrink-0 text-slate-400" />}
              </MenuItemButton>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
