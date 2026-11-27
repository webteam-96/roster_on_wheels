"use client";

// RCC Goals - a district's clubs as a table (user 2026-11-20): heading + search on one line, then Club name | View goals.
// Shared by the oversight page (goal-overviews-rotary/clubs) and the District Admin page (district-admin-dashboard/rcc/clubs).

import { Table } from "@/components/ui/table";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2, Search } from "@/components/icons";
import { getGoalCategories } from "@/services/api";
import type { GoalClubSummaryDto } from "@/services/goalFlowApi";

export type Club = { id: number; name: string };

export default function RccClubsList({ title, listFor, reloadKey, goalsHref, actions }: {
  title: string;
  /** One category's club list (oversight or District Admin API) - merged over every category. */
  listFor: (categoryId: number) => Promise<GoalClubSummaryDto[]>;
  reloadKey: string;
  goalsHref: (c: Club) => string;
  actions?: (clubs: Club[]) => ReactNode;   // e.g. Download all clubs, next to the search
}) {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setClubs(null); setError(null);
    (async () => {
      try {
        // Every category the role can see (a Zone Co-ordinator holds one), clubs merged by id.
        const cats = await getGoalCategories();
        const lists = await Promise.allSettled(cats.map((c) => listFor(c.id)));
        const map = new Map<number, string>();
        lists.forEach((r) => { if (r.status === "fulfilled") r.value.forEach((c) => map.set(c.clubId, c.clubName)); });
        if (map.size === 0 && lists.every((r) => r.status === "rejected")) throw new Error();
        if (!cancelled) setClubs(Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      } catch { if (!cancelled) setError("Failed to load clubs."); }
    })();
    return () => { cancelled = true; };
    // listFor changes identity every render; reloadKey carries its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (clubs ?? []).filter((c) => !t || c.name.toLowerCase().includes(t));
  }, [clubs, q]);
  const th = "border-b-[3px] border-b-go-gold-500 border-r border-r-go-navy-700 last:border-r-0 bg-go-navy-900 px-3 py-3 text-go-label font-bold uppercase tracking-wide text-white";
  const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5";

  return (
    <div className="space-y-4">
      {/* Plain heading left, search (+ actions) on the right. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-go-kpi font-bold text-go-navy-900">{title}</h2>
          {clubs && <div className="text-go-body text-go-text-secondary">{q.trim() ? `${shown.length} of ${clubs.length}` : clubs.length} clubs</div>}
        </div>
        <div className="flex w-full sm:w-auto flex-wrap items-center gap-2.5">
          <label className="relative w-full sm:w-80">
            <Search size={15} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-go-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search club…" aria-label="Search club"
              className="w-full h-10 rounded-go-sm border border-go-border-strong bg-go-surface pl-9 pr-3 text-go-body focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1" />
          </label>
          {clubs && actions?.(clubs)}
        </div>
      </div>

      {error && <div className="rounded-go-md border border-go-danger-600 bg-go-danger-50 p-4 text-go-body text-go-danger-600">{error}</div>}
      {!clubs && !error && <div className="p-6 flex items-center gap-2 text-go-body text-go-text-muted"><Loader2 size={14} className="animate-spin" /> Loading clubs…</div>}
      {clubs && (
        <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-hidden">
          <Table bare className="w-full border-separate border-spacing-0 text-go-body">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`${th} text-left`}>Club name</th>
                <th className={`${th} w-44 text-right`}>Goals</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={2} className={`${td} text-center text-go-text-muted`}>{clubs.length === 0 ? "No clubs to show." : "No clubs match your search."}</td></tr>}
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-semibold text-go-navy-900`}>{c.name}</td>
                  <td className={`${td} text-right`}>
                    <Link href={goalsHref(c)} className="inline-flex items-center h-9 px-4 rounded-go-sm bg-go-navy-900 text-white text-go-label font-bold hover:bg-go-navy-700">
                      View goals
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
