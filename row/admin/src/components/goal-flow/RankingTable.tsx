"use client";

// District Ranking as a table (user 2026-11-20, Disha Goals for the RI Director / SA): same design as the RCC / Disha
// Overview tables. Zone column only when every zone is listed. Clicking a row opens the district.
// Also the Club Ranking tab of District Set Goals (user 2026-11-20): entityLabel="Club", pointsOnly (reached = achieved
// count, no Achieved % column), top 3 ranks in gold, and a search row for the 60-120 clubs of a district.

import { Table } from "@/components/ui/table";
import { LinkButton } from "@/components/ui/text-buttons";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "@/components/icons";
import { fmtGoalPct } from "@/components/awards/GoalAchievement";
import type { RankItem } from "@/components/goal-flow/RankingList";

const ragFill = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;

export default function RankingTable({ items, rankBy, onOpen, emptyText, showZone, entityLabel = "District", pointsOnly, searchable }: {
  items: RankItem[]; rankBy: "points" | "score"; onOpen?: (key: number) => void; emptyText: string; showZone: boolean;
  entityLabel?: string; pointsOnly?: boolean; searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((i) => `${i.name} ${i.sub ?? ""}`.toLowerCase().includes(t)) : items;
  }, [items, q]);

  if (items.length === 0)
    return <div className="rounded-go-lg border border-dashed border-go-border-strong bg-go-surface p-10 text-center text-go-body text-go-text-muted">{emptyText}</div>;

  const th = "border-b border-r border-go-border-strong last:border-r-0 bg-go-sunken px-3 py-3 text-go-label font-bold uppercase tracking-wide text-go-text-secondary";
  const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5";
  const num = `${td} text-right tabular-nums whitespace-nowrap font-semibold text-go-navy-900`;
  const cols = 4 + (showZone ? 1 : 0) + (rankBy === "points" ? 1 : 0) + (pointsOnly ? 0 : 1) + (onOpen ? 1 : 0);
  const noun = entityLabel.toLowerCase();
  const table = (
    <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-hidden">
      <Table bare className="w-full border-separate border-spacing-0 text-go-body">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={`${th} w-20 text-left`}>Rank</th>
            <th className={`${th} text-left`}>{entityLabel}</th>
            {showZone && <th className={`${th} text-left`}>Zone</th>}
            <th className={`${th} text-right`}>Goals set</th>
            <th className={`${th} text-right`}>{pointsOnly ? "Achieved" : "Goals reached"}</th>
            {rankBy === "points" && <th className={`${th} text-right`}>Points</th>}
            {!pointsOnly && <th className={`${th} text-right`}>Achieved %</th>}
            {onOpen && <th className={`${th} w-10`} />}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={cols} className={`${td} text-center text-go-text-muted`}>No {noun}s match your search.</td></tr>}
          {shown.map((i) => (
            <tr key={i.key} onClick={() => onOpen?.(i.key)} className={onOpen ? "cursor-pointer hover:bg-go-navy-50" : ""}>
              <td className={`${td} font-bold tabular-nums text-go-navy-900`}>
                {pointsOnly && i.rank <= 3
                  ? <span className="inline-flex h-7 min-w-[1.75rem]items-center justify-center rounded-full bg-go-gold-500 px-2 text-go-navy-900" aria-label={`Rank ${i.rank}, top three`}>{i.rank}</span>
                  : i.rank}
              </td>
              <td className={`${td} font-semibold text-go-navy-900`}>
                {onOpen ? <LinkButton type="button" onClick={(e) => { e.stopPropagation(); onOpen(i.key); }}>{i.name}</LinkButton> : i.name}
              </td>
              {showZone && <td className={`${td} text-go-text-secondary`}>{i.sub ?? "—"}</td>}
              <td className={`${num} bg-go-navy-50`}>{i.goals.toLocaleString("en-IN")}</td>
              <td className={`${num} bg-go-sunken`}>{i.reached.toLocaleString("en-IN")}</td>
              {rankBy === "points" && <td className={`${num} ${pointsOnly ? "bg-go-navy-50 font-bold" : "bg-go-sunken"}`}>{Math.round(i.points ?? 0).toLocaleString("en-IN")}</td>}
              {!pointsOnly && (
                <td className={`${num} bg-go-navy-50`}>
                  {i.score == null ? "—" : (
                    <span className="inline-flex items-center gap-1.5 font-bold">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ragFill(i.score) }} />{fmtGoalPct(i.score, 0)}
                    </span>
                  )}
                </td>
              )}
              {onOpen && <td className={`${td} text-go-text-muted`}><ChevronRight size={16} aria-hidden /></td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
  if (!searchable) return table;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-go-body text-go-text-secondary">
          {shown.length === items.length ? `${items.length} ${noun}s` : `${shown.length} of ${items.length} ${noun}s`}
        </div>
        <label className="relative w-full sm:w-80">
          <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-go-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}…`} aria-label={`Search ${noun}`}
            className="w-full h-10 rounded-go-sm border border-go-border-strong bg-go-surface pl-9 pr-3 text-go-body focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1" />
        </label>
      </div>
      {table}
    </div>
  );
}
