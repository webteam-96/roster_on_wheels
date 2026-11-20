"use client";

// Goal Setting results shown inside Awards - VIEW ONLY (user 2026-11-10, "step 1").
// Award scoring is NOT touched: these are the new Goal Setting's own figures (target / achieved / %
// as the server computes them), shown next to the award points so the two never disagree.
//   - DistrictGoalAchievementCard: one district's goals, for the Zonal Awards screen.
//   - useClubGoalPercents: each club's key goal %, for the District Awards "Club Points" table.
// Rounding follows Goal Setting everywhere: Membership whole numbers, Foundation 2 decimals.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Target } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDistrictGoalForm, getDistrictClubsGoalMatrix } from "@/services/api";
import type { GoalCategoryFormDto, GoalFieldWithValueDto } from "@/types/goalSetting";
import { GOAL_LAYOUT, type GoalRow } from "@/lib/goalRotaryLayout";
import { appLocale } from "@/lib/appFormat";

const FOUNDATION_CATEGORY_ID = 210;

// HIDDEN for now (user 2026-11-10: finish CMR first). Set true to show the goal section in Zonal
// Awards and the goal % columns in District Awards -> Club Points. Code is kept, nothing is fetched while false.
export const SHOW_GOALS_IN_AWARDS = false;

// Same RAG scale as the new Goal Overview: 0-10 red, 11-25 yellow, 26-50 orange, 51-100 blue, 101+ purple.
export function goalRagClass(p: number | null): string {
  if (p == null) return "bg-slate-50 text-slate-400 ring-slate-200";
  if (p <= 10) return "bg-red-50 text-red-700 ring-red-200";
  if (p <= 25) return "bg-yellow-50 text-yellow-800 ring-yellow-200";
  if (p <= 50) return "bg-orange-50 text-orange-700 ring-orange-200";
  if (p <= 100) return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-purple-50 text-purple-700 ring-purple-200";
}

export function fmtGoalPct(p: number | null, categoryId: number): string {
  if (p == null || Number.isNaN(p)) return "–";
  const dp = categoryId === FOUNDATION_CATEGORY_ID ? 2 : 0;
  return `${p.toLocaleString(appLocale(), { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
}

function fmtFigure(f: GoalFieldWithValueDto | undefined): string {
  if (!f || f.numericValue == null) return "–";
  const s = Number(f.numericValue).toLocaleString(appLocale(), { maximumFractionDigits: 2 });
  return f.dataType === "Currency" ? `$${s}` : s;
}

const rowTitle = (r: GoalRow) => r.card || r.name;

// ── District: Zonal Awards ────────────────────────────────────────────────
export function DistrictGoalAchievementCard({ districtId, yearId }: { districtId: number; yearId: number | null }) {
  const [open, setOpen] = useState(true);
  const [forms, setForms] = useState<GoalCategoryFormDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Categories that have at least one district goal with a target / achieved / % trio.
  const cats = useMemo(() => GOAL_LAYOUT
    .map((c) => ({ c, rows: c.rows.filter((r) => r.applies !== "Club" && r.target && r.achieved && r.pct) }))
    .filter((x) => x.rows.length > 0), []);

  useEffect(() => {
    if (!SHOW_GOALS_IN_AWARDS || !districtId || !yearId) return;
    let cancelled = false;
    setForms(null); setFailed(false);
    Promise.allSettled(cats.map(({ c }) => getDistrictGoalForm(c.categoryId, yearId, districtId)))
      .then((res) => {
        if (cancelled) return;
        const ok = res.filter((r): r is PromiseFulfilledResult<GoalCategoryFormDto> => r.status === "fulfilled").map((r) => r.value);
        if (ok.length === 0) setFailed(true);
        setForms(ok);
      });
    return () => { cancelled = true; };
  }, [districtId, yearId, cats]);

  if (!SHOW_GOALS_IN_AWARDS || failed) return null;   // hidden for now / no goal access / no goal data for this year: the awards screen is unchanged

  return (
    <Card className="border-indigo-200 overflow-hidden">
      <CardHeader className="pb-2 cursor-pointer bg-indigo-700 text-white hover:bg-indigo-800 transition-colors" onClick={() => setOpen(!open)}>
        <CardTitle className="text-lg flex items-center gap-2">
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          <Target className="h-5 w-5" /> Goal Achievement <span className="text-xs font-normal text-indigo-100">(from Goal Setting - view only, not part of the award points)</span>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="p-4">
          {forms == null ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading goals…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {cats.map(({ c, rows }) => {
                const form = forms.find((f) => f.categoryId === c.categoryId);
                if (!form) return null;
                const byKey = (k?: string) => form.fields.find((f) => f.fieldKey === k);
                const shown = rows.filter((r) => byKey(r.pct));
                if (shown.length === 0) return null;
                return (
                  <div key={c.categoryId} className="rounded-lg border border-slate-200">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 text-sm">{c.ourName}</span>
                      {form.achievedAsOn && <span className="text-[11px] text-slate-500">Achieved as on {form.achievedAsOn}</span>}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500">
                          <th className="text-left font-medium px-3 py-1.5">Goal</th>
                          <th className="text-right font-medium px-3 py-1.5">Target</th>
                          <th className="text-right font-medium px-3 py-1.5">Achieved</th>
                          <th className="text-right font-medium px-3 py-1.5">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const pf = byKey(r.pct);
                          const p = pf?.numericValue != null ? Number(pf.numericValue) : null;
                          return (
                            <tr key={r.pct} className="border-t border-slate-100">
                              <td className="px-3 py-1.5 text-slate-700">{rowTitle(r)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{fmtFigure(byKey(r.target))}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{fmtFigure(byKey(r.achieved))}</td>
                              <td className="px-3 py-1.5 text-right">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ring-1 ${goalRagClass(p)}`}>{fmtGoalPct(p, c.categoryId)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Clubs: District Awards "Club Points" ──────────────────────────────────
// The few headline club goals shown as columns (only those the club matrix actually carries).
const CLUB_GOAL_KEYS: { categoryId: number; key: string; label: string }[] = [
  { categoryId: 1, key: "percentage_increase", label: "Members" },
  { categoryId: 1, key: "women_percentage_achievement", label: "Women" },
  { categoryId: 210, key: "club_annual_fund_ytd_pct", label: "Annual Fund" },
  { categoryId: 210, key: "club_polioplus_ytd_pct", label: "PolioPlus" },
  { categoryId: 210, key: "club_total_pct", label: "Total Giving" },
];

export interface ClubGoalColumn { categoryId: number; key: string; label: string }

export function useClubGoalPercents(districtId: number, yearId: number | null) {
  const [columns, setColumns] = useState<ClubGoalColumn[]>([]);
  const [byClub, setByClub] = useState<Record<number, Record<string, number | null>>>({});

  useEffect(() => {
    if (!SHOW_GOALS_IN_AWARDS || !districtId || !yearId) { setColumns([]); setByClub({}); return; }
    let cancelled = false;
    const catIds = Array.from(new Set(CLUB_GOAL_KEYS.map((k) => k.categoryId)));
    Promise.allSettled(catIds.map((c) => getDistrictClubsGoalMatrix(c, yearId, districtId))).then((res) => {
      if (cancelled) return;
      const cols: ClubGoalColumn[] = [];
      const map: Record<number, Record<string, number | null>> = {};
      res.forEach((r) => {
        if (r.status !== "fulfilled" || !r.value) return;
        const m = r.value;
        const have = new Set(m.columns.map((c) => c.fieldKey));
        CLUB_GOAL_KEYS.filter((k) => k.categoryId === m.categoryId && have.has(k.key)).forEach((k) => {
          cols.push(k);
          m.clubs.forEach((club) => {
            const raw = club.values?.[k.key];
            const n = raw == null || raw === "" ? null : Number(String(raw).replace(/[%,]/g, ""));
            (map[club.clubId] ??= {})[k.key] = n != null && !Number.isNaN(n) ? n : null;
          });
        });
      });
      setColumns(CLUB_GOAL_KEYS.filter((k) => cols.some((c) => c.key === k.key)));
      setByClub(map);
    });
    return () => { cancelled = true; };
  }, [districtId, yearId]);

  return { columns, byClub };
}
