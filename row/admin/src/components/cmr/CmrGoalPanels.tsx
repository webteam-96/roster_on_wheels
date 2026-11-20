"use client";

// NEW CMR (Super Admin preview, user 2026-11-10). Membership and Foundation are VIEW ONLY:
//   - Foundation = the club's Goal Setting month-wise figures (Club Goals -> Month-wise). A month not synced
//     from Rotary.org yet falls back to the month's CMR TRF entries summed by fund type.
//   - Membership = ONE table: the CMR's own month counts (start / added / terminated / now - auto-filled from
//     the member records, still saved into the report for the CMR reports) side by side with the Goal
//     Setting month-wise figures and targets. Same source on both sides, so they never disagree.
// The old CMR (v2) does not use this file.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Info } from "@/components/icons";
import { getClubMonthlyGoals, getGoalRotaryOrgValues, getGoalSourceDates, type GoalMonthlyForm } from "@/services/api";
import type { TrfContribution } from "@/types/trfContribution";
import { GOAL_LAYOUT, plainLabel, dayLabel, importScopeOf } from "@/lib/goalRotaryLayout";
import { appLocale } from "@/lib/appFormat";

export const MEMBERSHIP = 1, FOUNDATION = 210;

// Rotary year runs July (7) .. June (6). Year till date = July up to and including the opened month.
const ROTARY_MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
export function tillDate(monthly: Record<number, number | null> | undefined, month: number): number | null {
  const upto = ROTARY_MONTHS.indexOf(month);
  if (!monthly || upto < 0) return null;
  let sum = 0, any = false;
  for (const m of ROTARY_MONTHS.slice(0, upto + 1)) {
    const v = monthly[m];
    if (v != null) { sum += Number(v); any = true; }
  }
  return any ? sum : null;
}

/** One Goal Setting month-wise form (Membership / Foundation) for the club; tick = reload (after a sync).
 *  Foundation: a fund with no year target in Club Goals shows the club's Rotary.org target for that goal
 *  (same goal name, e.g. "Annual Fund contributions") - user 2026-11-12. View only; nothing is saved. */
export function useClubMonthlyGoals(categoryId: number, clubId: number, yearId: number, tick = 0) {
  const [form, setForm] = useState<GoalMonthlyForm | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setForm(undefined);
    const targets = categoryId === FOUNDATION
      ? getGoalRotaryOrgValues(yearId, null, clubId)
          .then((r) => new Map(r.values.filter((v) => v.kind === "Target" && v.value != null).map((v) => [v.itemName.trim().toLowerCase(), Number(v.value)])))
          .catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>());
    Promise.all([getClubMonthlyGoals(categoryId, yearId, clubId), targets])
      .then(([f, t]) => {
        if (cancelled) return;
        if (!f) { setForm(null); return; }
        setForm(t.size === 0 ? f : {
          ...f,
          fields: f.fields.map((x) => x.annualTarget != null ? x
            : { ...x, annualTarget: t.get(goalName(categoryId, x.fieldKey, x.fieldLabel).trim().toLowerCase()) ?? null }),
        });
      })
      .catch(() => { if (!cancelled) setForm(null); });
    return () => { cancelled = true; };
  }, [categoryId, clubId, yearId, tick]);
  return form;
}

// AF per capita is dollars PER MEMBER, not money received: never added into a total, and its "year till date"
// is the latest month's figure, not a sum (user 2026-11-12).
const NOT_MONEY = new Set(["club_af_per_capita"]);
function latestUpTo(monthly: Record<number, number | null> | undefined, month: number): number | null {
  const upto = ROTARY_MONTHS.indexOf(month);
  if (!monthly || upto < 0) return null;
  for (const m of ROTARY_MONTHS.slice(0, upto + 1).reverse()) if (monthly[m] != null) return Number(monthly[m]);
  return null;
}

// The new Goal Setting name of a collected field (falls back to its stored label).
function goalName(categoryId: number, fieldKey: string, fallback: string): string {
  const row = GOAL_LAYOUT.find((c) => c.categoryId === categoryId)?.rows.find((r) => r.achieved === fieldKey);
  return row ? (row.card || row.name) : plainLabel(fallback);
}

const num = (v: number | null | undefined, dp = 0) =>
  v == null ? "–" : Number(v).toLocaleString(appLocale(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
// Money in the new CMR: a zero amount shows as "–" (user 2026-11-12), like an empty one.
export const usd = (v: number | null | undefined) => (v == null || Number(v) === 0 ? "–" : `$${num(v, 2)}`);

/** Foundation this month (Goal Setting when synced, else the CMR TRF entries) - also used by the summary tiles. */
export function foundationThisMonth(form: GoalMonthlyForm | null | undefined, month: number, trf: TrfContribution[]) {
  const fields = (form?.fields ?? []).filter((f) => f.monthlyTracked !== false);
  const synced = fields.some((f) => f.monthly?.[month] != null);
  const total = synced
    ? fields.filter((f) => !NOT_MONEY.has(f.fieldKey)).reduce((s, f) => s + (Number(f.monthly?.[month]) || 0), 0)
    : trf.reduce((s, t) => s + (Number(t.amountUSD) || 0), 0);
  return { synced, total, fields };
}

// ── Pure figures: the wizard, the preview and the PDF all use these, so they never differ ─────────
export interface FoundationRow { name: string; month: number | null; monthTarget: number | null; ytd: number | null; yearTarget: number | null; notMoney?: boolean; source?: "sync" | "import" }

// Annual Fund + PolioPlus contributions come from the club's Rotary.org sync; every other fund from the
// RISAO import - shown first and as their own group (user 2026-11-13).
const SYNCED_FUNDS = new Set(["club_annual_fund_ytd", "club_polioplus_ytd"]);
export interface FoundationTable { synced: boolean; rows: FoundationRow[]; total: FoundationRow }

export function foundationTable(form: GoalMonthlyForm | null | undefined, month: number, trf: TrfContribution[]): FoundationTable {
  const { synced, fields } = foundationThisMonth(form, month, trf);
  let rows: FoundationRow[];
  if (synced) {
    rows = fields.map((f) => {
      const notMoney = NOT_MONEY.has(f.fieldKey);
      return {
        name: goalName(FOUNDATION, f.fieldKey, f.fieldLabel),
        month: f.monthly?.[month] ?? null, monthTarget: f.monthlyTargets?.[month] ?? null,
        ytd: notMoney ? latestUpTo(f.monthly, month) : tillDate(f.monthly, month),
        yearTarget: f.annualTarget ?? null, notMoney,
        source: SYNCED_FUNDS.has(f.fieldKey) ? "sync" as const : "import" as const,
      };
    });
    rows.sort((a, b) => (a.source === b.source ? 0 : a.source === "sync" ? -1 : 1));   // Rotary.org funds first
  } else {
    // Not synced: this month's CMR TRF entries summed by fund type (no targets / year figures).
    const m = new Map<string, number>();
    trf.forEach((t) => {
      const name = t.fundType === "Others" ? (t.otherFundName || "Others") : t.fundType;
      m.set(name, (m.get(name) ?? 0) + (Number(t.amountUSD) || 0));
    });
    rows = Array.from(m.entries()).map(([name, v]) => ({ name, month: v, monthTarget: null, ytd: null, yearTarget: null }));
  }
  const sum = (pick: (r: FoundationRow) => number | null) => {
    const vals = rows.filter((r) => !r.notMoney).map(pick).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + Number(v), 0) : null;
  };
  return { synced, rows, total: { name: "Total", month: sum((r) => r.month), monthTarget: sum((r) => r.monthTarget), ytd: sum((r) => r.ytd), yearTarget: sum((r) => r.yearTarget) } };
}

export interface CmrMemberCounts { start: number; added: number; terminated: number }
export interface MembershipRow { label: string; sub?: string; month: string; monthTarget: string; ytd: string; yearTarget: string; strong?: boolean; tone?: "plus" | "minus"; group?: "women" }

export function membershipTable(form: GoalMonthlyForm | null | undefined, month: number, counts: CmrMemberCounts, monthLabel: string): MembershipRow[] {
  const fields = form?.fields ?? [];
  const members = fields.find((f) => f.fieldKey === "new_members_achieved");
  const women = fields.find((f) => f.fieldKey === "new_women_members_achieved");
  const now = counts.start + counts.added - counts.terminated;
  const july1 = members?.baseline ?? null;
  const addedYtd = members ? tillDate(members.monthly, month) ?? 0 : null;
  // Left since 1 July = (1 July + joined) - members now; from the same member records, never typed.
  const leftYtd = july1 != null && addedYtd != null ? Math.max(0, july1 + addedYtd - now) : null;
  const netYtd = july1 != null ? now - july1 : null;
  const womenYtd = women ? tillDate(women.monthly, month) ?? 0 : null;
  const womenNow = women?.baseline != null && womenYtd != null ? women.baseline + womenYtd : null;
  const signed = (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${num(v)}`);
  const blank = (v: number | null | undefined) => (v == null ? "" : num(v));

  const rows: MembershipRow[] = [
    { label: "Members at start", sub: `1 ${monthLabel}  ·  1 July`, month: num(counts.start), monthTarget: "", ytd: num(july1), yearTarget: "" },
    { label: "Members added", month: num(counts.added), monthTarget: blank(members?.monthlyTargets?.[month]), ytd: num(addedYtd), yearTarget: blank(members?.splitBase), tone: "plus" },
    { label: "Members terminated", month: num(counts.terminated), monthTarget: "", ytd: num(leftYtd), yearTarget: "", tone: "minus" },
    { label: "Members now", sub: "Year till date = net growth since 1 July", month: num(now), monthTarget: "", ytd: signed(netYtd), yearTarget: blank(members?.annualTarget), strong: true },
  ];
  if (women) rows.push(
    { label: "Women members added", month: num(women.monthly?.[month]), monthTarget: blank(women.monthlyTargets?.[month]), ytd: num(womenYtd), yearTarget: blank(women.splitBase), tone: "plus", group: "women" },
    { label: "Women members now", sub: `${num(women.baseline)} on 1 July`, month: "–", monthTarget: "", ytd: num(womenNow), yearTarget: blank(women.annualTarget), strong: true, group: "women" },
  );
  return rows;
}

const Pill = ({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) => (
  <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${tone === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100" : "bg-amber-50 text-amber-900 ring-1 ring-amber-100"}`}>
    {tone === "ok" ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <Info size={14} className="mt-px shrink-0" />}
    <span>{children}</span>
  </div>
);

const TH = "px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

// ── Foundation (was "TRF") ────────────────────────────────────────────────
export interface FoundationSourceDates { sync: string | null; imp: string | null; member?: string | null }

/** "Updated from Rotary.org / RISAO on …" dates for the club - the same as the Club Goals cards (user 2026-11-13). */
export function useFoundationSourceDates(clubId: number, yearId: number, tick = 0): FoundationSourceDates {
  const [dates, setDates] = useState<FoundationSourceDates>({ sync: null, imp: null, member: null });
  useEffect(() => {
    let cancelled = false;
    getGoalSourceDates(yearId, null, clubId)
      .then((d) => { if (!cancelled) setDates({
        sync: dayLabel(d.dgSync ?? d.rotaryOrgSync), imp: dayLabel(d.imports?.[importScopeOf(FOUNDATION, true)]),
        // Membership: the club's last good member sync - the same date as the Club Goals Membership card.
        member: dayLabel(d.dgSync ?? d.memberSync ?? d.rotaryOrgSync),
      }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clubId, yearId, tick]);
  return dates;
}

/** The Foundation table - ONE component for the CMR screen and the Design B report / PDF, so both always look
 *  the same (user 2026-11-13): Rotary.org funds first, then the RISAO import, each with its "Updated from" note. */
export function CmrFoundationTable({ t, dates }: { t: FoundationTable; dates: FoundationSourceDates }) {
  if (t.rows.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">No Foundation figures for this month</p>
      <p className="mt-1 text-xs text-slate-500">Sync from Rotary.org to bring in this month&apos;s contributions.</p>
    </div>
  );
  const cols = t.synced ? 5 : 2;
  // Heading in navy, the "Updated from …" note in its own colour: green = Rotary.org, blue = RISAO (user 2026-11-13).
  const groupRow = (label: string, note: string, noteCls: string) => (
    <tr className="bg-slate-50/80">
      <td colSpan={cols} className="px-4 py-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[#1e3a5f]">{label}</span>
        <span className={`ml-3 text-xs font-semibold ${noteCls}`}>{note}</span>
      </td>
    </tr>
  );
  const syncRows = t.rows.filter((r) => r.source === "sync");
  const importRows = t.rows.filter((r) => r.source !== "sync");
  const line = (r: FoundationRow) => (
    <tr key={r.name} className="hover:bg-slate-50/60">
      <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{usd(r.month)}</td>
      {t.synced && <>
        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{usd(r.monthTarget)}</td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-800">{usd(r.ytd)}</td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{usd(r.yearTarget)}</td>
      </>}
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={`${TH} text-left`}>{t.synced ? "Fund" : "Fund type"}</th>
            <th className={`${TH} text-right`}>This month</th>
            {t.synced && <><th className={`${TH} text-right`}>Month target</th><th className={`${TH} text-right`}>Year till date</th><th className={`${TH} text-right`}>Year target</th></>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {t.synced ? <>
            {syncRows.length > 0 && groupRow("From Rotary.org", dates.sync ? `Updated from Rotary.org on ${dates.sync}` : "Updated from Rotary.org", "text-emerald-700")}
            {syncRows.map(line)}
            {importRows.length > 0 && groupRow("From import (RISAO)", dates.imp ? `Updated from RISAO on ${dates.imp}` : "Updated from RISAO", "text-blue-700")}
            {importRows.map(line)}
          </> : t.rows.map(line)}
        </tbody>
        <tfoot className="bg-[#1e3a5f]/[0.04] font-semibold">
          <tr>
            <td className="px-4 py-3 text-slate-900">Total</td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-900">{usd(t.total.month)}</td>
            {t.synced && <>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">{usd(t.total.monthTarget)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-900">{usd(t.total.ytd)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">{usd(t.total.yearTarget)}</td>
            </>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function CmrFoundationPanel({ form, month, trf, clubId, yearId, tick = 0 }: {
  form: GoalMonthlyForm | null | undefined; month: number; trf: TrfContribution[]; clubId: number; yearId: number; tick?: number;
}) {
  const t = useMemo(() => foundationTable(form, month, trf), [form, month, trf]);
  const dates = useFoundationSourceDates(clubId, yearId, tick);
  if (form === undefined) return <p className="py-10 text-center text-sm text-slate-400">Loading Foundation…</p>;
  return (
    <div className="space-y-4">
      {/* The green "From Club Goals …" line is removed (user 2026-11-13); each group says where it comes from. */}
      {!t.synced && <Pill tone="warn">This month is not synced from Rotary.org yet. Showing this month&apos;s CMR Foundation entries, totalled by fund type. Once synced, the Rotary.org figures replace them automatically.</Pill>}
      <CmrFoundationTable t={t} dates={dates} />
    </div>
  );
}

// ── Membership: CMR month counts + Goal Setting in one view-only table ──────
export function CmrMembershipPanel({ form, month, counts, monthLabel, clubId, yearId, tick = 0 }: {
  form: GoalMonthlyForm | null | undefined; month: number; counts: CmrMemberCounts; monthLabel: string;
  clubId: number; yearId: number; tick?: number;
}) {
  const rows = membershipTable(form, month, counts, monthLabel);
  const dates = useFoundationSourceDates(clubId, yearId, tick);
  const Line = ({ r }: { r: MembershipRow }) => (
    <tr className={r.strong ? "bg-[#1e3a5f]/[0.04]" : "hover:bg-slate-50/60"}>
      <td className="px-4 py-3">
        <div className={`flex items-center gap-2 ${r.strong ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
          {r.tone && <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${r.tone === "plus" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{r.tone === "plus" ? "+" : "−"}</span>}
          {r.label}
        </div>
        {r.sub && <div className="mt-0.5 text-[11px] text-slate-500">{r.sub}</div>}
      </td>
      <td className={`px-4 py-3 text-right tabular-nums ${r.strong ? "text-lg font-bold text-[#1e3a5f]" : "font-semibold text-slate-900"}`}>{r.month}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.monthTarget}</td>
      <td className={`px-4 py-3 text-right tabular-nums ${r.strong ? "font-bold text-slate-900" : "text-slate-800"}`}>{r.ytd}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.yearTarget}</td>
    </tr>
  );
  const main = rows.filter((r) => !r.group), women = rows.filter((r) => r.group === "women");
  return (
    <div className="space-y-4">
      {/* The green "View only - every figure comes from …" line is replaced by the Rotary.org note (user 2026-11-13). */}
      {form === undefined && <p className="text-xs text-slate-400">Loading Club Goals…</p>}
      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className={`${TH} text-left`}>Membership</th>
              <th className={`${TH} text-right`}>This month</th>
              <th className={`${TH} text-right`}>Month target</th>
              <th className={`${TH} text-right`}>Year till date</th>
              <th className={`${TH} text-right`}>Year target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/80">
              <td colSpan={5} className="px-4 py-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#1e3a5f]">From Rotary.org</span>
                <span className="ml-3 text-xs font-semibold text-emerald-700">{dates.member ? `Updated from Rotary.org on ${dates.member}` : "Updated from Rotary.org"}</span>
              </td>
            </tr>
            {main.map((r) => <Line key={r.label} r={r} />)}
            {women.length > 0 && (
              <tr><td colSpan={5} className="bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Women members</td></tr>
            )}
            {women.map((r) => <Line key={r.label} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
