"use client";

// Read-only "Club Goal Setting" matrix for ONE district, used inside the goal-oversight popup.
// Mirrors the district-admin "View Club Goals" page (category tabs + Goals/Month-wise toggle + club
// filter), but scoped to a caller-supplied districtId via the goal-oversight-scoped endpoints
// (getScopedDistrictClubs*Matrix) so RI Director / ZC / DA / SuperAdmin can view any district they oversee.

import { useEffect, useState, useCallback, useMemo } from "react";
import { isAnnualOnlyCategory } from "@/lib/goalCategories";
import { Building2, AlertCircle, Search, Table2, CalendarDays, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import RotaryLoader from "@/components/RotaryLoader";
import { getGoalCategories, getScopedDistrictClubsGoalMatrix, getScopedDistrictClubsMonthlyMatrix, downloadScopedAllClubsGoalReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import type { GoalCategoryDto, GoalClubMatrixDto, GoalMatrixColumnDto, GoalClubMonthlyMatrixDto } from "@/types/goalSetting";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { CLUB_GOAL_SETTING_COMING_SOON } from "@/lib/clubGoalSetting";

// `cell` fills the whole RAG cell with the band colour (oversight views only — the district/club
// admin's own Goal Setting form keeps its plain rows).
const RAG_STYLE: Record<string, { dot: string; label: string; text: string; cell: string }> = {
  Red: { dot: "bg-red-500", label: "Red", text: "text-red-700", cell: "bg-red-500 text-white" },
  Amber: { dot: "bg-amber-500", label: "Amber", text: "text-amber-700", cell: "bg-amber-500 text-white" },
  Green: { dot: "bg-emerald-500", label: "Green", text: "text-emerald-700", cell: "bg-emerald-500 text-white" },
  SuperGreen: { dot: "bg-emerald-600", label: "Super Green", text: "text-emerald-800", cell: "bg-emerald-600 text-white" },
  None: { dot: "bg-slate-300", label: "—", text: "text-slate-400", cell: "bg-slate-100 text-slate-400" },
};

// `categoryId` = the category the screen behind the popup is showing. When it is given the popup
// stays on that one category and the tab strip is replaced by a plain label (user 2026-09-21);
// without it (older callers) the tabs behave as before.
// A wide table needs its scrollbar within reach of the FIRST row: reading a right-hand column used
// to mean scrolling to the bottom of the table, dragging right, then scrolling back up (user
// 2026-09-21). The table now scrolls inside its own box, so the bottom scrollbar stays on screen and
// the header rows can stay frozen. One scrollbar only - the user did not want a second one on top.
function ScrollBox({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-auto">{children}</div>;
}

// A metric label alone is ambiguous — "Achieved" exists 3x in Membership and 11x in TRF. Show the
// group in front whenever the same label appears more than once in the list (user 2026-09-21).
function metricLabel(f: { groupName?: string; fieldLabel: string; unit: string | null }, all: { fieldLabel: string }[]) {
  const repeated = all.filter((x) => x.fieldLabel === f.fieldLabel).length > 1;
  const name = repeated && f.groupName ? `${f.groupName} — ${f.fieldLabel}` : f.fieldLabel;
  return `${name}${f.unit ? ` (${f.unit})` : ""}`;
}

export default function ClubGoalSettingPanel(
  { districtId, yearId, categoryId = null }: { districtId: number; yearId: number | null; categoryId?: number | null },
) {
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(categoryId);
  const [matrix, setMatrix] = useState<GoalClubMatrixDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clubQuery, setClubQuery] = useState("");
  const [view, setView] = useState<"goals" | "monthly">("goals");
  // Youth Service / Public Image are annual only (user 2026-09-25): no Month-wise toggle, and if
  // the reader was already on Month-wise when they switch to one of them, drop back to Goals.
  const annualOnly = isAnnualOnlyCategory((categories ?? []).find((c) => c.id === activeCategoryId)?.name);
  useEffect(() => { if (annualOnly) setView("goals"); }, [annualOnly]);
  const [monthly, setMonthly] = useState<GoalClubMonthlyMatrixDto | null>(null);
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState(false);

  async function downloadReport() {
    if (districtId <= 0 || dlBusy) return;
    setDlBusy(true);
    try {
      const blob = await downloadScopedAllClubsGoalReport(districtId, yearId);
      saveAs(blob, `Club_Goal_Setting_D${districtId}_${fileTimestamp()}.xlsx`);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not download the report.");
    } finally { setDlBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    getGoalCategories()
      .then((cats) => {
        if (cancelled) return;
        setCategories(cats);
        if (cats.length > 0) setActiveCategoryId((prev) => prev ?? categoryId ?? cats[0].id);
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load categories."); });
    return () => { cancelled = true; };
  }, [categoryId]);

  const fetchMatrix = useCallback(() => {
    if (activeCategoryId == null || districtId <= 0) return;
    setLoading(true); setError(null);
    getScopedDistrictClubsGoalMatrix(activeCategoryId, districtId, yearId)
      .then((m) => setMatrix(m))
      .catch((e) => setError(e?.response?.data?.message || "Failed to load club goals."))
      .finally(() => setLoading(false));
  }, [activeCategoryId, districtId, yearId]);
  useEffect(() => { if (view === "goals") fetchMatrix(); }, [fetchMatrix, view]);

  const fetchMonthly = useCallback(() => {
    if (activeCategoryId == null || districtId <= 0 || view !== "monthly") return;
    setLoading(true); setError(null);
    getScopedDistrictClubsMonthlyMatrix(activeCategoryId, districtId, yearId)
      .then((m) => {
        setMonthly(m);
        setMetricKey((prev) => (prev && m.fields.some((f) => f.fieldKey === prev)) ? prev : (m.fields[0]?.fieldKey ?? null));
      })
      .catch((e) => setError(e?.response?.data?.message || "Failed to load month-wise data."))
      .finally(() => setLoading(false));
  }, [activeCategoryId, districtId, yearId, view]);
  useEffect(() => { fetchMonthly(); }, [fetchMonthly]);

  const isMembership = (matrix?.categoryName || "").toLowerCase().includes("membership");

  const monthlyClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    const all = monthly?.clubs || [];
    return q ? all.filter((c) => (c.clubName || "").toLowerCase().includes(q)) : all;
  }, [monthly, clubQuery]);
  const selectedMetric = monthly?.fields.find((f) => f.fieldKey === metricKey) || null;

  const columns = useMemo(
    () => (matrix?.columns || []).filter((c) => c.groupName !== "RAG Analysis"),
    [matrix],
  );
  const visibleClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    const all = matrix?.clubs || [];
    return q ? all.filter((c) => (c.clubName || "").toLowerCase().includes(q)) : all;
  }, [matrix, clubQuery]);

  const groups = useMemo(() => {
    const out: { name: string; cols: GoalMatrixColumnDto[] }[] = [];
    for (const col of columns) {
      const last = out[out.length - 1];
      if (last && last.name === col.groupName) last.cols.push(col);
      else out.push({ name: col.groupName, cols: [col] });
    }
    return out;
  }, [columns]);

  // Parked (user 2026-10-01): every club-goal view shows the same placeholder.
  if (CLUB_GOAL_SETTING_COMING_SOON) return <ClubGoalComingSoon />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        {categoryId != null ? (
          <div className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1e3a5f] text-white">
            {categories?.find((c) => c.id === categoryId)?.name ?? matrix?.categoryName ?? "Goals"}
          </div>
        ) : categories && categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategoryId(c.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeCategoryId === c.id ? "bg-[#1e3a5f] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView("goals")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === "goals" ? "bg-[#1e3a5f] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Table2 size={13} /> Goals
            </button>
            {/* Youth Service / Public Image are annual only - no Month-wise at all (user 2026-09-25). */}
            {!annualOnly && (
            <button
              onClick={() => setView("monthly")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === "monthly" ? "bg-[#1e3a5f] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <CalendarDays size={13} /> Month-wise
            </button>
            )}
          </div>
          <button
            type="button"
            onClick={downloadReport}
            disabled={dlBusy}
            className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
            title="Download the Club Goal Setting report (all clubs of this district)"
          >
            {dlBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download report
          </button>
        </div>
      </div>

      {view === "monthly" && !loading && !error && monthly && monthly.fields.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Metric:</span>
          <select
            value={metricKey ?? ""}
            onChange={(e) => setMetricKey(e.target.value || null)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {monthly.fields.map((f) => (
              <option key={f.fieldKey} value={f.fieldKey}>{metricLabel(f, monthly?.fields || [])}</option>
            ))}
          </select>
        </div>
      )}

      {!loading && !error && (() => {
        const total = view === "goals" ? (matrix?.clubs.length ?? 0) : (monthly?.clubs.length ?? 0);
        const shown = view === "goals" ? visibleClubs.length : monthlyClubs.length;
        if (total === 0) return null;
        return (
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={clubQuery}
                onChange={(e) => setClubQuery(e.target.value)}
                placeholder="Filter clubs by name…"
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-xs text-slate-500">{shown} of {total} club{total === 1 ? "" : "s"}</span>
            {clubQuery && <button onClick={() => setClubQuery("")} className="text-xs text-blue-600 hover:underline">Clear</button>}
          </div>
        );
      })()}

      {loading && <div className="flex items-center justify-center py-16"><RotaryLoader size="lg" /></div>}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-200">
          <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
          <p className="text-slate-500">{error}</p>
        </div>
      )}

      {!loading && !error && (view === "goals" ? matrix?.clubs.length === 0 : monthly?.clubs.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-200">
          <Building2 className="h-10 w-10 text-slate-400 mb-3" />
          <p className="text-slate-500">No clubs found in this district.</p>
        </div>
      )}

      {view === "goals" && !loading && !error && matrix && matrix.clubs.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {isMembership && (
            <div className="shrink-0 px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">RAG (active members):</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Red 10–25</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Amber 26–40</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Green 41–50</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Super Green 51+</span>
            </div>
          )}
          <ScrollBox>
            <table className="text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#F7A81B]" style={{ backgroundColor: "#1e3a5f" }}>
                  <th rowSpan={2} className="sticky left-0 top-0 z-40 bg-[#1e3a5f] text-left px-4 py-2 text-white text-xs font-semibold uppercase tracking-wide border-r border-white/20">Club</th>
                  {isMembership && (
                    <th rowSpan={2} className="sticky top-0 z-30 bg-[#1e3a5f] px-3 py-2 text-white text-xs font-semibold uppercase tracking-wide border-r border-white/20 text-left">RAG</th>
                  )}
                  {groups.map((g, gi) => (
                    <th key={gi} colSpan={g.cols.length} className="sticky top-0 z-30 bg-[#1e3a5f] px-3 py-2 text-white text-[11px] font-semibold uppercase tracking-wide text-center border-l border-white/20">
                      {g.name}
                    </th>
                  ))}
                </tr>
                <tr style={{ backgroundColor: "#274b73" }}>
                  {columns.map((col) => (
                    <th key={col.fieldKey} className="sticky top-[37px] z-30 bg-[#274b73] px-3 py-1.5 text-white text-[11px] font-medium text-right whitespace-nowrap border-l border-white/10">
                      {col.fieldLabel}{col.unit ? ` (${col.unit})` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleClubs.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + (isMembership ? 2 : 1)} className="px-4 py-6 text-center text-sm text-slate-400">
                      No clubs match &ldquo;{clubQuery}&rdquo;.
                    </td>
                  </tr>
                )}
                {visibleClubs.map((row) => {
                  const rag = RAG_STYLE[row.rag] || RAG_STYLE.None;
                  return (
                    <tr key={row.clubId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800 whitespace-nowrap border-r border-slate-100">
                        {row.clubName}
                      </td>
                      {isMembership && (
                        <td className={`px-3 py-2 whitespace-nowrap border-r border-slate-100 text-center text-xs font-semibold ${rag.cell}`}
                          title={`${row.memberCount} active member(s)`}>
                          {rag.label}
                        </td>
                      )}
                      {columns.map((col) => (
                        <td key={col.fieldKey} className="px-3 py-2 text-right text-slate-700 whitespace-nowrap border-l border-slate-50">
                          {row.values[col.fieldKey] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollBox>
        </div>
      )}

      {view === "monthly" && !loading && !error && monthly && monthly.clubs.length > 0 && selectedMetric && (
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="shrink-0 px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">{selectedMetric.groupName ? `${selectedMetric.groupName} — ${selectedMetric.fieldLabel}` : selectedMetric.fieldLabel}</span> collected per month{monthly.yearLabel ? ` · RY ${monthly.yearLabel}` : ""} — future months of the current year show &ldquo;—&rdquo;.
          </div>
          <ScrollBox>
            <table className="text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#F7A81B]" style={{ backgroundColor: "#1e3a5f" }}>
                  <th className="sticky left-0 top-0 z-40 bg-[#1e3a5f] text-left px-4 py-2 text-white text-xs font-semibold uppercase tracking-wide border-r border-white/20">Club</th>
                  {monthly.months.map((m) => (
                    <th key={m.month} className={`sticky top-0 z-30 bg-[#1e3a5f] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-right border-l border-white/10 whitespace-nowrap ${m.isAvailable ? "text-white" : "text-white/40"}`}>
                      {m.label}
                    </th>
                  ))}
                  <th className="sticky top-0 z-30 bg-[#1e3a5f] px-3 py-2 text-white text-[11px] font-semibold uppercase tracking-wide text-right border-l border-white/20">Total</th>
                </tr>
              </thead>
              <tbody>
                {monthlyClubs.length === 0 && (
                  <tr>
                    <td colSpan={monthly.months.length + 2} className="px-4 py-6 text-center text-sm text-slate-400">
                      No clubs match &ldquo;{clubQuery}&rdquo;.
                    </td>
                  </tr>
                )}
                {monthlyClubs.map((row) => {
                  const byMonth = row.values[selectedMetric.fieldKey] || {};
                  return (
                    <tr key={row.clubId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800 whitespace-nowrap border-r border-slate-100">
                        {row.clubName}
                      </td>
                      {monthly.months.map((m) => (
                        <td key={m.month} className="px-3 py-2 text-right text-slate-700 whitespace-nowrap border-l border-slate-50">
                          {byMonth[m.month] ?? "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold text-slate-800 whitespace-nowrap border-l border-slate-100">
                        {row.totals[selectedMetric.fieldKey] ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollBox>
        </div>
      )}

      {view === "monthly" && !loading && !error && monthly && monthly.fields.length === 0 && monthly.clubs.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-400">
          This category has no month-wise metrics.
        </div>
      )}
    </div>
  );
}
