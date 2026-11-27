"use client";

// "Club Goals at a glance" (user 2026-11-12) - the OCV tab's quick scorecard above the read-only Club Goals
// tabs. View only. Membership / Foundation = the club's own Goal Setting figures (same API + same % as the
// Club Goals page); the rest = the club's Rotary.org goals that Goal Setting shows. Loaded fresh each time,
// so a change in Club Goals (or a Rotary.org sync) shows here too. 0 / blank = "–".

import { Table } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { getClubGoalForm, getGoalRotaryOrgValues } from "@/services/api";
import type { GoalCategoryFormDto } from "@/types/goalSetting";
import { appLocale } from "@/lib/appFormat";

const MEMBERSHIP = 1, FOUNDATION = 210;

interface Row { goal: string; target: number | null; achieved: number | null; pct: number | null; money?: boolean }

// Same colour scale as Goal Setting's progress bars: 0-10 red, 11-25 yellow, 26-50 orange, 51-100 blue, 101+ purple.
const ragColor = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;
const nz = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v === 0 ? null : v);
const fmt = (v: number | null, money?: boolean) => {
  const n = nz(v);
  return n == null ? "–" : `${money ? "$" : ""}${n.toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`;
};

// Rotary.org goals shown as rows (count goals) and as the Yes / No checklist line.
const ROTARY_ROWS: [string, string][] = [
  ["Rotaract clubs", "Rotaract clubs"],
  ["Interact clubs", "Interact clubs"],
  ["Service projects", "Service projects"],
  ["Media stories", "Media stories about club projects"],
  ["New member sponsorship", "New member sponsorship"],
];
const CHECKLIST: [string, string][] = [
  ["Strategic plan", "Strategic plan"],
  ["Online presence", "Online presence"],
  ["Bylaws reviewed", "Review and consider updating your club bylaws"],
  ["Rotary promotional materials", "Use of official Rotary promotional materials"],
];

export default function ClubGoalScorecard({ clubId, yearId }: { clubId: number; yearId: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checks, setChecks] = useState<{ label: string; yes: boolean | null }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    Promise.allSettled([
      getClubGoalForm(MEMBERSHIP, yearId, clubId),
      getClubGoalForm(FOUNDATION, yearId, clubId),
      getGoalRotaryOrgValues(yearId, null, clubId),
    ]).then(([m, f, r]) => {
      if (cancelled) return;
      const out: Row[] = [];
      const val = (form: GoalCategoryFormDto | null, k: string) => {
        const x = form?.fields.find((fl) => fl.fieldKey === k)?.numericValue;
        return x == null ? null : Number(x);
      };
      const mem = m.status === "fulfilled" ? m.value : null;
      if (mem) {
        out.push({ goal: "Members", target: val(mem, "new_members"), achieved: val(mem, "new_members_achieved"), pct: val(mem, "percentage_increase") });
        out.push({ goal: "Women members", target: val(mem, "new_women_members"), achieved: val(mem, "new_women_members_achieved"), pct: val(mem, "women_percentage_achievement") });
      }
      const fnd = f.status === "fulfilled" ? f.value : null;
      if (fnd) {
        for (const [goal, k] of [["Annual Fund", "club_annual_fund_ytd"], ["PolioPlus Fund", "club_polioplus_ytd"],
          ["Endowment Fund", "club_endowment_ytd"], ["Other funds", "club_other_funds_ytd"], ["Total giving", "club_total"]] as const) {
          const achKey = k === "club_total" ? "club_total_ytd" : k;
          if (!fnd.fields.some((fl) => fl.fieldKey === achKey)) continue;
          out.push({ goal, target: val(fnd, `${k}_target`), achieved: val(fnd, achKey), pct: val(fnd, `${k}_pct`), money: true });
        }
      }
      const ro = r.status === "fulfilled" ? r.value : null;
      const rv = (item: string, kind: "Target" | "Achieved") => {
        const x = ro?.values.find((v) => v.itemName === item && v.kind === kind)?.value;
        return x == null ? null : Number(x);
      };
      for (const [goal, item] of ROTARY_ROWS) {
        const t = rv(item, "Target"), a = rv(item, "Achieved");
        if (nz(t) == null && nz(a) == null) continue;   // goal not used by this club
        out.push({ goal, target: t, achieved: a, pct: nz(t) != null && a != null ? Math.round((a / t!) * 100) : null });
      }
      setChecks(CHECKLIST.filter(([, item]) => rv(item, "Target") != null || rv(item, "Achieved") != null)
        .map(([label, item]) => { const a = rv(item, "Achieved"); return { label, yes: a == null ? null : a > 0 }; }));
      setRows(out);
    });
    return () => { cancelled = true; };
  }, [clubId, yearId]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="row-h2">Club Goals at a glance</h2>
      </div>
      {rows == null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No goals set for this year.</p>
      ) : (
        // Two side-by-side tables (user 2026-11-13): every goal + the Yes / No checklist as rows, half left, half
        // right; % Achieved as a coloured figure only (no progress bar).
        (() => {
          const all: (Row & { yes?: boolean | null; check?: boolean })[] = [
            ...rows,
            ...checks.map((ck) => ({ goal: ck.label, target: null, achieved: null, pct: null, yes: ck.yes, check: true })),
          ];
          const half = Math.ceil(all.length / 2);
          const table = (list: typeof all) => (
            <Table bare className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="pr-3">Goal</th>
                  <th className="px-3 text-right">Target</th>
                  <th className="px-3 text-right">Achieved</th>
                  <th className="pl-3 text-right">% Achieved</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const p = nz(r.pct);
                  return (
                    <tr key={r.goal} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-800">{r.goal}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-700">{r.check ? "–" : fmt(r.target, r.money)}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-900">
                        {r.check
                          ? <span className={r.yes ? "text-emerald-700" : "text-slate-400"}>{r.yes == null ? "–" : r.yes ? "✓ Yes" : "No"}</span>
                          : fmt(r.achieved, r.money)}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums text-xs font-semibold">
                        {p == null ? <span className="text-slate-400">–</span>
                          : <span style={{ color: ragColor(p) }}>{p.toLocaleString(appLocale(), { maximumFractionDigits: 2 })}%</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          );
          return (
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 lg:grid-cols-2">
              <div className="overflow-x-auto">{table(all.slice(0, half))}</div>
              {all.length > half && <div className="overflow-x-auto">{table(all.slice(half))}</div>}
            </div>
          );
        })()
      )}
    </Card>
  );
}
