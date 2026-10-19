"use client";

import { useEffect, useState } from "react";
import { getGoalOversightCategories, getGoalOverview } from "@/services/api";
import type { GoalCategoryDto, GoalOverviewMatrixDto } from "@/types/goalSetting";
import type { RotaryYear } from "@/types/rotaryYear";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import RotaryLoader from "@/components/RotaryLoader";
import { LayoutGrid } from "@/components/icons";

// SuperAdmin read-only overview: pick a year + zone + category, then see every district in
// that zone side-by-side, one row per metric, each cell showing Target and/or Achieved.
export default function GoalOverviewMatrix({
  zones, years,
}: {
  zones: { id: number; zoneName: string }[];
  years: RotaryYear[];
}) {
  const currentYear = years.find((y) => y.isCurrent) || years[0];
  const [yearId, setYearId] = useState<string>(currentYear ? String(currentYear.id) : "");
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [categories, setCategories] = useState<GoalCategoryDto[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const [matrix, setMatrix] = useState<GoalOverviewMatrixDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setCategories(await getGoalOversightCategories()); } catch { /* ignore: grid just won't offer categories */ }
    })();
  }, []);

  useEffect(() => {
    if (!zoneId || !categoryId || !yearId) { setMatrix(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const r = await getGoalOverview(zoneId, categoryId, Number(yearId));
        if (!cancelled) setMatrix(r);
      } catch (err: any) {
        if (!cancelled) { setMatrix(null); setError(err?.response?.data?.message || "Failed to load the overview."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [zoneId, categoryId, yearId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-blue-600" />
            District Goal Overview
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick a year, a zone and a category to compare every district in the zone side-by-side.
            Each cell shows that district&apos;s <span className="font-medium">Total</span>,{" "}
            <span className="font-medium">Target</span> and <span className="font-medium">Achieved</span> value for the metric. Read-only.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Year */}
          <div className="max-w-xs">
            <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Rotary Year</label>
            <Select value={yearId} onValueChange={setYearId}>
              <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Zone radios */}
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Zone <span className="font-normal text-muted-foreground">,  pick one</span></label>
            {zones.length === 0 ? (
              <p className="text-xs text-muted-foreground">No zones available.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {zones.map((z) => {
                  const checked = zoneId === z.id;
                  return (
                    <label key={z.id} className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${checked ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <input type="radio" name="overview-zone" checked={checked} onChange={() => setZoneId(z.id)} />
                      {z.zoneName}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category radios */}
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Category <span className="font-normal text-muted-foreground">,  pick one</span></label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading categories…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const checked = categoryId === c.id;
                  return (
                    <label key={c.id} className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer ${checked ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <input type="radio" name="overview-category" checked={checked} onChange={() => setCategoryId(c.id)} />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Matrix */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
      ) : !zoneId || !categoryId ? (
        <p className="text-sm text-muted-foreground">Select a zone and a category above to see the matrix.</p>
      ) : matrix && (
        matrix.districts.length === 0 ? (
          <p className="text-sm text-amber-600">No active districts in <span className="font-medium">{matrix.zoneName}</span>.</p>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {matrix.zoneName} · {matrix.categoryName} · {matrix.yearLabel}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {matrix.districts.length} district(s) · {matrix.rows.length} metric(s)
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="sticky left-0 z-10 bg-muted/60 text-left px-3 py-2 font-semibold min-w-[220px] border-b border-r">Particulars</th>
                      {matrix.districts.map((d) => (
                        <th key={d.districtId} className="text-center px-3 py-2 font-semibold whitespace-nowrap border-b border-r min-w-[140px]">
                          District {d.districtNumber}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr key={`${row.groupName}::${row.metricKey}`} className="odd:bg-white even:bg-slate-50/50">
                        <th className="sticky left-0 z-10 bg-inherit text-left px-3 py-2 font-medium align-top border-b border-r">
                          <div>{row.label}</div>
                          {row.groupName && row.groupName !== row.label && (
                            <div className="text-[11px] font-normal text-muted-foreground">{row.groupName}</div>
                          )}
                        </th>
                        {row.cells.map((cell) => (
                          <td key={cell.districtId} className="px-3 py-2 align-top border-b border-r text-center">
                            <div className="flex flex-col gap-0.5 items-center">
                              {row.hasReference && (
                                <span className="text-xs">
                                  <span className="text-muted-foreground">Total: </span>
                                  <span className="font-semibold text-blue-700">{cell.total ?? "–"}</span>
                                </span>
                              )}
                              {row.hasTarget && (
                                <span className="text-xs">
                                  <span className="text-muted-foreground">Target: </span>
                                  <span className="font-semibold text-slate-800">{cell.target ?? "–"}</span>
                                </span>
                              )}
                              {row.hasAchieved && (
                                <span className="text-xs">
                                  <span className="text-muted-foreground">Achieved: </span>
                                  <span className="font-semibold text-emerald-700">{cell.achieved ?? "–"}</span>
                                </span>
                              )}
                              {!row.hasReference && !row.hasTarget && !row.hasAchieved && <span className="text-muted-foreground">, </span>}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
