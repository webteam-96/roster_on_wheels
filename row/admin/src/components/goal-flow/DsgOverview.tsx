"use client";

// District Set Goals - Overview tab for the DG (user 2026-11-19): the Disha Overview design with the District Set Goals
// questions only. Section tabs (All Goals + the 4 Rotary.org sections, then any extra category), the TOTAL of all clubs
// per question, "Club Wise Goals", then one card per club (Goal / Achieved / % / Points, Auto Fetch / Manual Entry),
// Lock / Unlock per club and section (DG / Super Admin). Points = exactly District Awards' (API ClubPointsAsync).

import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Fragment, useMemo, useState } from "react";
import { CalendarDays, Eye, Loader2, Lock, LockOpen, Trophy } from "@/components/icons";
import { SECTION_TABS, sectionHeading, type SectionKey } from "@/lib/goalRotaryLayout";
import { sectionOfCategory, type DishaSection } from "@/lib/dishaRccGoals";
import { fmtPoints, livePct } from "@/components/goal-flow/common";
import type { GoalFlowLine, getDistrictSetGoals } from "@/services/goalFlowApi";

type Data = Awaited<ReturnType<typeof getDistrictSetGoals>>;
type Cell = { goal: number | null; achieved: string | null; pct: number | null; points: number; rcc?: number | null };
const key = (l: GoalFlowLine) => `${l.lineType}:${l.lineId}`;
const SHORT: Record<DishaSection, string> = { reach: "Membership", impact: "Foundation", adapt: "Public Image", engage: "Youth Service", other: "Other" };
const fmtNum = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

export default function DsgOverview({ data, locks, canLock, lockBusy, onLock, onOpenClub, onMonthClub, onPick, single }: {
  onPick?: (club: { id: number; name: string } | null) => void;   // the Club filter changed (page header's Month wise follows it)
  onMonthClub?: (club: { id: number; name: string }) => void;   // Month wise of a club (user 2026-11-19)
  single?: boolean;   // Club Admin's own club (user 2026-11-19): no TOTAL / search - just the club's card
  data: Data;
  locks: Record<number, string[]> | null;
  canLock: boolean;
  lockBusy: string | null;
  onLock: (k: string, clubIds: number[] | null, sections: string[] | null, locked: boolean) => void;
  onOpenClub?: (club: { id: number; name: string }) => void;
}) {
  const [clubId, setClubId] = useState<number | null>(null);   // the Club filter; null = all clubs (total)

  const lines = data.lines;
  const groups = useMemo(() => {
    const out = SECTION_TABS.map((s, i) => ({
      key: s.key as string, lock: s.key as DishaSection, heading: sectionHeading({ key: s.key as SectionKey, no: i + 1, title: s.title, labels: [], owners: [], cards: [] }),
      lines: lines.filter((l) => sectionOfCategory(l.categoryName) === s.key),
    }));
    const extra = Array.from(new Set(lines.filter((l) => sectionOfCategory(l.categoryName) === "other").map((l) => l.categoryName)));
    extra.forEach((c, i) => out.push({ key: `x:${c}`, lock: "other", heading: `${SECTION_TABS.length + i + 1}. ${c}`, lines: lines.filter((l) => l.categoryName === c) }));
    return out.filter((g) => g.lines.length > 0);
  }, [lines]);
  const lockSections = Array.from(new Set(groups.map((g) => g.lock)));

  // One club's figures for a line (the same rules as the club's own page).
  const optText = (l: GoalFlowLine, v: string | null) => (v != null && l.answerType === "choose_one" ? l.options.find((o) => String(o.id) === v)?.optionText ?? v : v);
  const cellOf = (l: GoalFlowLine, clubId: number): Cell => {
    const goal = l.clubGoals?.[clubId] ?? null;
    const raw = data.clubAnswers[key(l)]?.[clubId] ?? null;
    const achieved = l.answerType === "yesno" ? (raw === "yes" ? "Yes" : raw === "no" ? "No" : null) : optText(l, raw);
    // RCC lines (user 2026-11-23): RCC goal from Rotary.org next to the District Set Goal; no % and no points.
    if (l.isRcc) { const r = l.clubRccGoals?.[clubId]; return { goal: goal == null ? null : Number(goal), achieved, pct: null, points: Number(data.clubPoints?.[key(l)]?.[clubId] ?? 0), rcc: r == null ? null : Number(r) }; }
    return { goal: goal == null ? null : Number(goal), achieved, pct: livePct(l.answerType, goal, raw), points: Number(data.clubPoints?.[key(l)]?.[clubId] ?? 0) };
  };
  const totalOf = (l: GoalFlowLine): Cell => {
    const cells = data.clubs.map((c) => cellOf(l, c.id));
    const points = cells.reduce((t, c) => t + c.points, 0);
    if (l.answerType === "yesno") return { goal: null, achieved: `${cells.filter((c) => c.achieved === "Yes").length} of ${cells.length}`, pct: null, points };
    if (l.answerType !== "number") return { goal: null, achieved: null, pct: null, points };
    const withGoal = cells.filter((c) => c.goal != null);
    const goal = withGoal.length ? withGoal.reduce((t, c) => t + Number(c.goal), 0) : null;
    const ach = cells.some((c) => c.achieved != null && c.achieved !== "") ? cells.reduce((t, c) => t + (Number(c.achieved) || 0), 0) : null;
    if (l.isRcc) {
      const withRcc = cells.filter((c) => c.rcc != null);
      return { goal, achieved: ach == null ? null : String(ach), pct: null, points, rcc: withRcc.length ? withRcc.reduce((t, c) => t + Number(c.rcc), 0) : null };
    }
    return { goal, achieved: ach == null ? null : String(ach), pct: goal && goal > 0 && ach != null ? Math.round((ach / goal) * 100) : null, points };
  };

  const clubTotal = (id: number) => lines.reduce((t, l) => t + cellOf(l, id).points, 0);
  // Table design (user 2026-11-20), as RCC / Disha: no section tabs; All clubs = the total, a club = its own figures.
  const one = single ? data.clubs[0] ?? null : data.clubs.find((c) => c.id === clubId) ?? null;

  if (lines.length === 0)
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No questions yet for this year.</div>;

  const th = "border-b border-r border-go-border-strong last:border-r-0 bg-go-sunken px-3 py-3 text-go-label font-bold uppercase tracking-wide text-go-text-secondary";
  const td = "border-b border-r border-go-border last:border-r-0 px-3 py-2.5 align-top";
  const numTd = `${td} text-right tabular-nums whitespace-nowrap font-semibold text-go-navy-900`;
  const btn = "inline-flex items-center gap-1.5 h-9 px-3 rounded-go-sm border border-go-border-strong bg-go-surface text-go-label font-semibold text-go-navy-700 hover:bg-go-navy-50 disabled:opacity-40";
  const cl = one ? locks?.[one.id] ?? [] : [];
  const totalPoints = one ? clubTotal(one.id) : data.clubs.reduce((t, c) => t + clubTotal(c.id), 0);

  return (
    <div className="space-y-4">
      {!single && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5 text-go-label font-semibold text-go-text-secondary">
            Club
            <NativeSelect value={clubId ?? ""} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; setClubId(id); onPick?.(data.clubs.find((c) => c.id === id) ?? null); }}
              className="w-auto min-w-[16rem] font-semibold">
              <option value="">All clubs ({data.clubs.length})</option>
              {data.clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </label>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-go-gold-500 px-3 py-1 text-go-label font-bold text-go-navy-900">
            <Trophy size={13} /> {fmtPoints(totalPoints)} points{one ? "" : " · all clubs"}
          </span>
        </div>
      )}

      <section className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-hidden">
        {/* One club: its locks and actions above the table. */}
        {one && (
          <div className="flex flex-wrap items-center gap-2 border-b border-go-border px-4 py-3">
            {locks && lockSections.map((sct) => {
              const on = cl.includes(sct), k = `${one.id}-${sct}`;
              return canLock ? (
                <Button variant="outline" size="sm" key={sct} type="button" disabled={!!lockBusy} onClick={() => onLock(k, [one.id], [sct], !on)}>
                  {lockBusy === k ? <Loader2 size={13} className="animate-spin" /> : on ? <LockOpen size={13} /> : <Lock size={13} />}
                  {on ? "Unlock" : "Lock"} {SHORT[sct]}
                </Button>
              ) : (
                <span key={sct} className="inline-flex items-center gap-1 text-go-label text-go-text-secondary">
                  {on ? <Lock size={12} /> : <LockOpen size={12} />}{SHORT[sct]} {on ? "locked" : "unlocked"}
                </span>
              );
            })}
            {single && <span className="inline-flex items-center gap-1 rounded-full bg-go-gold-500 px-2.5 py-0.5 text-go-label font-bold text-go-navy-900"><Trophy size={12} /> {fmtPoints(totalPoints)} points</span>}
            <span className="flex-1" />
            {onMonthClub && <Button variant="outline" size="sm" type="button" onClick={() => onMonthClub(one)}><CalendarDays size={14} /> Month wise</Button>}
            {onOpenClub && <Button variant="outline" size="sm" type="button" onClick={() => onOpenClub(one)}><Eye size={14} /> View details</Button>}
          </div>
        )}
        <div className="overflow-x-auto">
        <Table bare className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-go-body">
          <colgroup><col className="w-[14%]" /><col /><col className="w-[11%]" /><col className="w-[12%]" /><col className="w-[11%]" /><col className="w-[8%]" /></colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${th} text-left`}>Category</th>
              <th className={`${th} text-left`}>Question</th>
              <th className={`${th} text-right`}>RCC Goals</th>
              <th className={`${th} text-right`}>District Set Goal</th>
              <th className={`${th} text-right`}>Achieved</th>
              <th className={`${th} text-right`}>Points</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr><td colSpan={6} className="border-b border-go-border-strong bg-go-navy-900 px-3 py-2.5 text-go-title font-bold text-white">{g.heading}</td></tr>
                {g.lines.map((l) => {
                  const c = one ? cellOf(l, one.id) : totalOf(l);
                  const num = l.answerType === "number", auto = l.source !== "manual";
                  const sct = sectionOfCategory(l.categoryName);
                  return (
                    <tr key={key(l)}>
                      <td className={`${td} font-semibold text-go-navy-700`}>{sct === "other" ? l.categoryName : SHORT[sct]}</td>
                      <td className={`${td} text-go-text-primary`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold leading-snug">{l.title}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-go-meta font-bold ${auto ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{l.isRcc ? "Auto Fetch · Rotary.org" : auto ? "Auto Fetch" : "Manual Entry"}</span>
                        </div>
                      </td>
                      <td className={`${numTd} bg-go-sunken`}>{l.isRcc ? fmtNum(c.rcc ?? null) : "—"}</td>
                      <td className={`${numTd} bg-go-navy-50`}>{num ? fmtNum(c.goal) : "—"}</td>
                      <td className={`${numTd} bg-go-sunken`}>{num ? fmtNum(c.achieved) : l.answerType === "yesno" && !one ? `${c.achieved} Yes` : c.achieved || "—"}</td>
                      <td className={`${numTd} bg-go-sunken`}>{fmtPoints(c.points)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </Table>
        </div>
      </section>
    </div>
  );
}
