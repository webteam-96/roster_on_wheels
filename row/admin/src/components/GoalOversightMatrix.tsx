"use client";

// Goal-oversight dashboard (RI Director / Zone Co-ordinator / District Assistant, and the observer):
// pick a Zone → every district of that zone shows as a ROW, with each category (Membership / TRF /
// Youth Service / Public Image) laid out horizontally in front of the district as Target · Achieved · %.
// A Total row sums the columns. RI Director & ZC get a District filter; a DA does NOT (a DA just sees
// all their assigned districts). Clicking a district row opens that district's messages below.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Download, MessagesSquare, Calendar, Building2 } from "@/components/icons";
import { saveAs } from "file-saver";
import { getDistrictSummaryMatrix, downloadGoalDistrictReport, downloadGoalOversightDistrictReport, getGoalMessagesHasUnread, markGoalMessagesSeen, getDistrictMonthlyGoals, downloadGoalMessagesReport } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import GoalZoneMessages from "@/components/dashboard/GoalZoneMessages";
import DistrictMonthWiseReport from "@/components/DistrictMonthWiseReport";
import ClubGoalSettingPanel from "@/components/ClubGoalSettingPanel";
import GoalMessagesFeed from "@/components/GoalMessagesFeed";
import DistrictMessagesInbox from "@/components/goal-messages/DistrictMessagesInbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GoalDistrictSummaryMatrixDto, GoalSummaryCategoryDto } from "@/types/goalSetting";
import { isAnnualOnlyCategory } from "@/lib/goalCategories";

// Membership RAG bands render as ONE solid-coloured column each (club count inside).
const RAG_CELL: Record<string, string> = {
  Red: "bg-red-500 text-white",
  Amber: "bg-amber-500 text-white",
  Green: "bg-emerald-500 text-white",
  SuperGreen: "bg-emerald-600 text-white",
};
// Single-value metrics (RAG bands, Summary figures) are 1 column; every other metric is the
// 4-column baseline / target / achieved / % block.
const isSingle = (mt: { ragBand?: string | null; singleValue?: boolean }) => !!mt.ragBand || !!mt.singleValue;
// 1 column for a single-value metric; otherwise 4, or 3 when the metric has no July-1 baseline (TRF).
const metricCols = (mt: { ragBand?: string | null; singleValue?: boolean; hasBaseline?: boolean }) =>
  isSingle(mt) ? 1 : (mt.hasBaseline === false ? 3 : 4);
const catColSpan = (c: GoalSummaryCategoryDto) => c.metrics.reduce((n, mt) => n + metricCols(mt), 0);
// Tier-2 header segments: consecutive single-value columns of the same group collapse into one
// heading ("RAG Analysis" / "Summary").
function groupSegments(c: GoalSummaryCategoryDto) {
  const segs: { label: string; span: number }[] = [];
  for (const mt of c.metrics) {
    const last = segs[segs.length - 1];
    if (isSingle(mt) && last && last.label === mt.groupName) { last.span += 1; continue; }
    segs.push({ label: mt.groupName, span: metricCols(mt) });
  }
  return segs;
}

export default function GoalOversightMatrix({
  zones, yearId, actingAs = null, canFilterDistrict = true, showMessages = false, title = "Goal Overview",
}: {
  zones: { id: number; zoneName: string }[];
  yearId: number;                // driven by the top-right header Year picker
  actingAs?: string | null;
  canFilterDistrict?: boolean;   // false for a District Assistant (no filter — just their districts)
  showMessages?: boolean;        // RI Director only → the read-only Messages popup + red new-message dot
  title?: string;                // card heading — "Goal Overview" (Super Admin) or "Goal Setting" (RI Director)
}) {
  const [zoneId, setZoneId] = useState<number | null>(zones.length === 1 ? zones[0].id : null);
  const [matrix, setMatrix] = useState<GoalDistrictSummaryMatrixDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [districtFilter, setDistrictFilter] = useState<number | null>(null); // one district, or all
  const [msgDistrictId, setMsgDistrictId] = useState<number | null>(null);   // row clicked → show messages
  const [dl, setDl] = useState<number | "scope" | null>(null);               // download-in-progress marker
  const [msgOpen, setMsgOpen] = useState(false);                             // RI messages popup
  const [hasUnread, setHasUnread] = useState(false);                        // red dot
  const [monthDistrict, setMonthDistrict] = useState<{ id: number; number: string } | null>(null); // row-click → month-wise popup
  const [clubDistrict, setClubDistrict] = useState<{ id: number; number: string } | null>(null);   // "Club Goal Setting" → clubs popup
  const [rptCat, setRptCat] = useState(0);       // Messages report filter: category (0 = all)
  const [rptDistrict, setRptDistrict] = useState(0); // Messages report filter: district (0 = all)
  const [rptBusy, setRptBusy] = useState(false);
  // All four categories side by side made the grid far too wide, so ONE category shows at a time
  // (Membership by default). The download + messages report still cover every category.
  const [catFilter, setCatFilter] = useState<number | null>(null);

  async function downloadMessagesReport() {
    if (!zoneId || !yearId || rptBusy) return;
    setRptBusy(true);
    try {
      const blob = await downloadGoalMessagesReport(zoneId, yearId, rptCat, rptDistrict);
      saveAs(blob, `Goal_Messages_${zoneName || "zone"}_${fileTimestamp()}.xlsx`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || "Could not download the messages report.");
    } finally { setRptBusy(false); }
  }

  // Poll the red "new message" dot when a zone is picked (RI only). Re-checks after closing the popup.
  useEffect(() => {
    if (!showMessages || !zoneId || !yearId) { setHasUnread(false); return; }
    let cancelled = false;
    // Re-check every minute and when the tab gets focus again (2026-10-09): a District Admin / DG
    // message sent while this page was open used to show its dot only after a reload.
    const check = () => getGoalMessagesHasUnread(zoneId, yearId).then((u) => { if (!cancelled) setHasUnread(u); }).catch(() => {});
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [showMessages, zoneId, yearId, msgOpen]);

  function openMessages() {
    setMsgOpen(true);
    if (zoneId && yearId) markGoalMessagesSeen(zoneId, yearId).then(() => setHasUnread(false)).catch(() => {});
  }

  // Download the YTD + Month-wise report. dId set → just that district; else current zone/district scope.
  async function downloadReport(dId: number | null) {
    if (!zoneId && !dId) return;
    setDl(dId ?? "scope");
    try {
      const blob = await downloadGoalDistrictReport(zoneId, dId, yearId);
      const label = dId ? `D${matrix?.districts.find((x) => x.districtId === dId)?.districtNumber ?? dId}` : (zoneId ? "zone" : "all");
      saveAs(blob, `goal-district-report-${label}-${fileTimestamp()}.xlsx`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || "Could not download the report.");
    } finally { setDl(null); }
  }

  // Row-wise (per-district) download: the EXACT district-admin "District Goal Setting" report
  // (goals-excel/districts → District_Goal_Setting_*.xlsx). Only the row icon uses this.
  async function downloadDistrictSetting(dId: number) {
    setDl(dId);
    try {
      const blob = await downloadGoalOversightDistrictReport(dId, yearId);
      const num = matrix?.districts.find((x) => x.districtId === dId)?.districtNumber ?? dId;
      saveAs(blob, `District_Goal_Setting_D${num}_${fileTimestamp()}.xlsx`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || "Could not download the report.");
    } finally { setDl(null); }
  }

  // Auto-select the only zone (ZC / single-zone DA).
  useEffect(() => { if (zones.length === 1) setZoneId(zones[0].id); }, [zones]);
  useEffect(() => { setDistrictFilter(null); setMsgDistrictId(null); }, [zoneId]);

  const load = useCallback(() => {
    if (!zoneId || !yearId) { setMatrix(null); return; }
    setLoading(true); setError(null);
    getDistrictSummaryMatrix(zoneId, yearId)
      .then(setMatrix)
      .catch((e) => setError(e?.response?.data?.message || "Failed to load districts."))
      .finally(() => setLoading(false));
  }, [zoneId, yearId]);
  useEffect(() => { load(); }, [load]);

  const visibleDistricts = useMemo(() => {
    const all = matrix?.districts || [];
    return districtFilter ? all.filter((d) => d.districtId === districtFilter) : all;
  }, [matrix, districtFilter]);

  const cats = matrix?.categories || [];
  // The one category on screen (catFilter null = all of them, where the popup still makes sense).
  // Youth Service and Public Image are not collected month-wise, so their district rows must not
  // open the Month-wise popup (user 2026-09-29) - "View clubs" still works, it stops propagation.
  const selectedCatName = catFilter == null ? null : (cats.find((c) => c.categoryId === catFilter)?.name ?? null);
  const monthWiseOff = isAnnualOnlyCategory(selectedCatName);
  const msgCategoryId = cats[0]?.categoryId ?? null; // messaging is per (category, zone); use the first overseen

  // Default the grid to Membership (fall back to the first overseen category), and keep the choice
  // valid when the zone/year changes to a scope that doesn't include it.
  useEffect(() => {
    if (cats.length === 0) { setCatFilter(null); return; }
    setCatFilter((prev) => {
      if (prev != null && cats.some((c) => c.categoryId === prev)) return prev;
      return (cats.find((c) => c.name.toLowerCase() === "membership") ?? cats[0]).categoryId;
    });
  }, [cats]);

  const shownCats = useMemo(
    () => (catFilter == null ? cats : cats.filter((c) => c.categoryId === catFilter)),
    [cats, catFilter],
  );
  const showRagLegend = shownCats.some((c) => c.metrics.some((mt) => mt.ragBand));
  const zoneName = zones.find((z) => z.id === zoneId)?.zoneName ?? "";

  const selCls = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">{title}: districts (read-only)</div>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Pick a zone to see every district&apos;s Membership / Foundation / Youth Service / Public Image progress. Click a district row to see its messages.</p>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Zone
            <select className={selCls} value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.zoneName}</option>)}
            </select>
          </label>
          {canFilterDistrict && (
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              District
              <select className={selCls} value={districtFilter ?? ""} disabled={!matrix || matrix.districts.length === 0}
                onChange={(e) => setDistrictFilter(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All districts</option>
                {(matrix?.districts || []).map((d) => <option key={d.districtId} value={d.districtId}>{d.districtNumber}</option>)}
              </select>
            </label>
          )}
          {(zoneId || (matrix && matrix.districts.length > 0)) && (
            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={() => districtFilter ? downloadDistrictSetting(districtFilter) : downloadReport(null)}
                disabled={dl !== null}
                className="inline-flex items-center gap-1.5 h-9 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                title="Download report for the current selection"
              >
                {(dl === "scope" || (districtFilter != null && dl === districtFilter)) ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {districtFilter ? "Download this district" : zoneId ? "Download report (zone)" : "Download report (all)"}
              </button>
            </div>
          )}
          {showMessages && zoneId && (
            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={openMessages}
                className="relative inline-flex items-center gap-1.5 h-9 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100"
                title="Read messages from your Zone Co-ordinators & District Assistants"
              >
                <MessagesSquare size={14} /> Messages
                {hasUnread && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" title="New message" />}
              </button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Report = YTD + Month-wise, districts &amp; categories horizontal. No zone → all your districts; a zone → that zone; a district → just that district.</p>
        {cats.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cats.map((c) => (
              <button
                key={c.categoryId}
                type="button"
                onClick={() => setCatFilter(c.categoryId)}
                className={`inline-flex items-center h-9 rounded-md border px-3 text-xs font-medium ${
                  catFilter === c.categoryId
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                {c.name}
              </button>
            ))}
            <span className="text-[11px] text-slate-400">The grid below shows the selected category only.</span>
          </div>
        )}
        {showRagLegend && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">RAG: clubs by active members:</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Red 10–25</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Amber 26–40</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Green 41+</span>
          </p>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-slate-400 px-1"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!loading && !error && !zoneId && <p className="text-sm text-slate-400 px-1">Select a zone to view its districts.</p>}
      {!loading && !error && zoneId && matrix && matrix.districts.length === 0 && (
        <p className="text-sm text-slate-400 px-1">No districts to show for this zone / year.</p>
      )}

      {!loading && !error && matrix && matrix.districts.length > 0 && cats.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse w-full">
              <thead>
                {/* Tier 1 — category (spans all its metric×4 columns). */}
                <tr className="border-b border-marigold" style={{ backgroundColor: "#17458f" }}>
                  <th rowSpan={3} className="sticky left-0 z-20 bg-azure text-left px-4 py-2 text-white text-xs font-semibold uppercase tracking-wide border-r border-white/20">District</th>
                  <th rowSpan={3} className="bg-azure text-center px-3 py-2 text-white text-[11px] font-semibold uppercase tracking-wide border-r border-white/20 whitespace-normal break-words min-w-[92px] max-w-[110px]">Club Goal Setting</th>
                  {shownCats.map((c) => (
                    <th key={c.categoryId} colSpan={Math.max(1, catColSpan(c))} className="px-3 py-2 text-white text-xs font-semibold uppercase tracking-wide text-center border-l border-white/20">
                      {c.name}
                    </th>
                  ))}
                </tr>
                {/* Tier 2 — metric group (New Clubs / Total Members / Women …). */}
                <tr style={{ backgroundColor: "#17458f" }}>
                  {shownCats.map((c) => (
                    <Fragment key={c.categoryId}>
                      {groupSegments(c).map((seg, si) => (
                        <th key={si} colSpan={seg.span} className="px-2 py-1.5 text-white text-[11px] font-semibold text-center border-l border-white/20 whitespace-normal break-words">{seg.label}</th>
                      ))}
                    </Fragment>
                  ))}
                </tr>
                {/* Tier 3 — the four fields (exact form labels). */}
                <tr style={{ backgroundColor: "#17458f" }}>
                  {shownCats.map((c) => (
                    <Fragment key={c.categoryId}>
                      {c.metrics.map((mt, mi) => isSingle(mt) ? (
                        <th key={mi} className="px-2 py-1.5 text-white text-[11px] font-semibold text-center border-l border-white/10 align-bottom whitespace-normal break-words min-w-[80px]">{mt.baselineLabel}</th>
                      ) : (
                        <Fragment key={mi}>
                          {mt.hasBaseline !== false && (
                            <th className="px-2 py-1.5 text-white text-[11px] font-medium text-right border-l border-white/10 align-bottom whitespace-normal break-words min-w-[80px] max-w-[130px]">{mt.baselineLabel}</th>
                          )}
                          <th className={`px-2 py-1.5 text-white text-[11px] font-medium text-right align-bottom whitespace-normal break-words min-w-[76px] max-w-[110px] ${mt.hasBaseline === false ? "border-l border-white/10" : ""}`}>{"Target"}</th>
                          <th className="px-2 py-1.5 text-white text-[11px] font-medium text-right align-bottom whitespace-normal break-words min-w-[60px]">Achieved</th>
                          <th className="px-2 py-1.5 text-white text-[11px] font-medium text-right align-bottom whitespace-normal break-words min-w-[80px] max-w-[100px]">Percentage Achieved</th>
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDistricts.map((d) => (
                  <tr key={d.districtId}
                    onClick={monthWiseOff ? undefined : () => setMonthDistrict({ id: d.districtId, number: d.districtNumber })}
                    className={`group border-b border-slate-100 hover:bg-blue-50/60 ${monthWiseOff ? "" : "cursor-pointer"}`}
                    title={monthWiseOff ? `${selectedCatName} is not collected month-wise` : "Click to see this district's month-wise collection"}>
                    {/* SOLID background, never bg-inherit: the row carries no background of its own, so an
                        inheriting sticky cell is transparent and the value cells scroll UNDER the frozen
                        District column when the grid is dragged sideways (2026-09-16 fix). */}
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-4 py-2 font-medium text-blue-700 whitespace-nowrap border-r border-slate-100">
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); downloadDistrictSetting(d.districtId); }}
                          disabled={dl !== null}
                          title={`Download report for D ${d.districtNumber}`}
                          className="text-slate-400 hover:text-blue-600 disabled:opacity-40"
                        >
                          {dl === d.districtId ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        </button>
                        {d.districtNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap border-r border-slate-100">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setClubDistrict({ id: d.districtId, number: d.districtNumber }); }}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                        title={`View all clubs' goal setting for D ${d.districtNumber}`}
                      >
                        <Building2 size={12} /> View clubs
                      </button>
                    </td>
                    {shownCats.map((c) => {
                      const cells = d.cells[c.categoryId] || [];
                      return (
                        <Fragment key={c.categoryId}>
                          {c.metrics.map((mt, mi) => {
                            const cell = cells[mi];
                            if (isSingle(mt)) return (
                              <td key={mi} className={`px-3 py-2 text-center font-semibold border-l border-slate-100 whitespace-pre-line ${mt.ragBand ? (RAG_CELL[mt.ragBand] ?? "") : "text-slate-800"}`}>{cell?.value ?? "–"}</td>
                            );
                            return (
                              <Fragment key={mi}>
                                {mt.hasBaseline !== false && (
                                  <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap border-l border-slate-100">{cell?.asOnJul1 ?? "–"}</td>
                                )}
                                <td className={`px-3 py-2 text-right text-slate-700 whitespace-nowrap ${mt.hasBaseline === false ? "border-l border-slate-100" : ""}`}>{cell?.target ?? "–"}</td>
                                <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">{cell?.achieved ?? "–"}</td>
                                <td className="px-3 py-2 text-right font-medium text-slate-800 whitespace-nowrap">{cell?.pct ?? "–"}</td>
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
                {/* Total row — only meaningful when not filtered to one district. */}
                {!districtFilter && (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-slate-800 border-r border-slate-200">TOTAL</td>
                    <td className="bg-slate-50 border-r border-slate-200" />
                    {shownCats.map((c) => (
                      <Fragment key={c.categoryId}>
                        {c.metrics.map((mt, mi) => {
                          const t = c.totals[mi];
                          if (isSingle(mt)) return (
                            <td key={mi} className={`px-3 py-2 text-center font-semibold border-l border-slate-100 ${mt.ragBand ? (RAG_CELL[mt.ragBand] ?? "") : "text-slate-800"}`}>
                              {/* Suggestions (text) and percentage columns carry no total - the API
                                  sends none, and adding them up would be meaningless. */}
                              {mt.notSummable ? "" : (t?.value ?? "–")}
                            </td>
                          );
                          return (
                            <Fragment key={mi}>
                              {mt.hasBaseline !== false && (
                                <td className="px-3 py-2 text-right text-slate-700 border-l border-slate-100">{t?.asOnJul1 ?? "–"}</td>
                              )}
                              <td className={`px-3 py-2 text-right text-slate-800 ${mt.hasBaseline === false ? "border-l border-slate-100" : ""}`}>{t?.target ?? "–"}</td>
                              <td className="px-3 py-2 text-right text-slate-800">{t?.achieved ?? "–"}</td>
                              <td className="px-3 py-2 text-right text-slate-800">{t?.pct ?? "–"}</td>
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Click a district → its messages (per zone + category, filtered to that district). Not for RI —
          RI reads everything via the Messages popup instead. */}
      {!showMessages && msgDistrictId && zoneId && msgCategoryId && (
        <GoalZoneMessages categoryId={msgCategoryId} zoneId={zoneId} yearId={yearId} districtId={msgDistrictId} actingAs={actingAs} allowObserverPost={false} />
      )}

      {/* Row click → that district's month-wise collection (read-only), category tabs inside the panel. */}
      <Dialog open={!!monthDistrict} onOpenChange={(o) => { if (!o) setMonthDistrict(null); }}>
        <DialogContent className="max-w-[96vw] sm:max-w-[96vw] w-[96vw] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle className="flex items-center gap-2">
                <Calendar size={18} className="text-blue-600" /> Month-wise Collection: District {monthDistrict?.number}
              </DialogTitle>
              {monthDistrict && (
                <button
                  type="button"
                  onClick={() => downloadDistrictSetting(monthDistrict.id)}
                  disabled={dl !== null}
                  className="inline-flex items-center gap-1.5 h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 shrink-0"
                  title="Download this district's District Goal Setting report (YTD + Month-wise)"
                >
                  {dl === monthDistrict.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download report
                </button>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {monthDistrict && yearId > 0 && (
              <DistrictMonthWiseReport districtId={monthDistrict.id} yearId={yearId} categoryId={catFilter} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* "Club Goal Setting" column → all clubs' goal setting for that district (read-only). */}
      <Dialog open={!!clubDistrict} onOpenChange={(o) => { if (!o) setClubDistrict(null); }}>
        <DialogContent className="max-w-6xl w-[97vw] h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Building2 size={18} className="text-blue-600" /> Club Goal Setting: District {clubDistrict?.number}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {clubDistrict && (
              <ClubGoalSettingPanel districtId={clubDistrict.id} yearId={yearId > 0 ? yearId : null} categoryId={catFilter} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* RI Messages popup — 4 category tabs; each shows the zone's ZC (first) then its DAs (read-only). */}
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MessagesSquare size={18} className="text-blue-600" /> Messages{zoneName ? `: ${zoneName}` : ""}
            </DialogTitle>
          </DialogHeader>
          {/* Report filter bar: pick category (all/one) + district (all/one) → download an Excel of all
              matching messages (category · district · role · from · message · date & time). */}
          <div className="shrink-0 flex flex-wrap items-end gap-2 border-b border-slate-100 pb-3 pr-8">
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              Category
              <select value={rptCat} onChange={(e) => setRptCat(Number(e.target.value))} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value={0}>All categories</option>
                {cats.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              District
              <select value={rptDistrict} onChange={(e) => setRptDistrict(Number(e.target.value))} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value={0}>All districts</option>
                {(matrix?.districts || []).map((d) => <option key={d.districtId} value={d.districtId}>{d.districtNumber}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={downloadMessagesReport}
              disabled={rptBusy}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
              title="Download the goal messages report for the selected filters"
            >
              {rptBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download report
            </button>
          </div>
          {/* Two sources (user 2026-10-09): District Admins / Governors writing up the chain, and the
              Zone Co-ordinators / District Assistants. Both honour the Category + District filter above. */}
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto">
            {zoneId && yearId ? (
              <Tabs defaultValue="zcda" className="flex flex-col">
                <TabsList className="self-start">
                  <TabsTrigger value="zcda">Zone Co-ordinators &amp; Assistants</TabsTrigger>
                  <TabsTrigger value="districts">From Districts</TabsTrigger>
                </TabsList>
                <TabsContent value="zcda" className="mt-3">
                  <GoalMessagesFeed zoneId={zoneId} yearId={yearId} categoryId={rptCat} districtId={rptDistrict} />
                </TabsContent>
                <TabsContent value="districts" className="mt-3">
                  <DistrictMessagesInbox zoneId={zoneId} yearId={yearId} categoryId={rptCat} districtId={rptDistrict} />
                </TabsContent>
              </Tabs>
            ) : (
              <p className="text-sm text-slate-400 py-6 text-center">Select a zone to see its messages.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
