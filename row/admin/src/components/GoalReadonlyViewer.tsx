"use client";

// Goal Setting Overview — the SAME tabbed Membership / Foundation / Youth Service / Public Image forms a
// District or Club admin sees, but READ ONLY. Pick a year → zone → district → (optionally) a club,
// and the read-only GoalSettingPanel below shows that entity's goals exactly as its own admin would.
//
// Two modes:
//   • unscoped (default) — SuperAdmin settings Overview: every zone/district/club, unscoped endpoints.
//   • scoped=true        — RI Director / Zone Co-ordinator / District Assistant after login: the same
//                          layout, but the Zone dropdown is limited to the member's assigned zones and
//                          the district list + form come from the SCOPED endpoints (server enforces
//                          scope). Club drill-down + the month-wise panel are omitted in scoped mode
//                          (no scoped club/monthly endpoint); district-level read-only goals only.
//
// Both modes show the comment parts below: zone messages (for the selected zone) + the pairwise
// district thread (for the selected district). Reply permission is enforced server-side — RI Director
// and SuperAdmin are read-only, so their composer is hidden automatically.

import { useCallback, useEffect, useState } from "react";
import {
  getGoalOversightCategories, getZoneDistrictsGoalList, getDistrictClubsGoalList,
  getDistrictGoalForm, getClubGoalForm, getDistrictMonthlyGoals, getClubMonthlyGoals,
  getScopedDistrictsGoalList, getScopedDistrictGoalForm,
  getScopedDistrictClubsGoalList, getScopedClubGoalForm, getDistrictMonthlyGoalsScoped,
  downloadZoneGoalReport, downloadDistrictGoalReport, downloadClubGoalReport,
  type GoalMonthlyForm,
} from "@/services/api";
import type { GoalDistrictSummaryDto, GoalClubSummaryDto, GoalCategoryFormDto } from "@/types/goalSetting";
import type { RotaryYear } from "@/types/rotaryYear";
import GoalSettingPanel from "@/components/dashboard/GoalSettingPanel";
import ClubGoalComingSoon from "@/components/ClubGoalComingSoon";
import { CLUB_GOAL_SETTING_COMING_SOON } from "@/lib/clubGoalSetting";
import MonthlyGoalsPanel from "@/components/dashboard/MonthlyGoalsPanel";
import GoalTargetSplitPanel from "@/components/dashboard/GoalTargetSplitPanel";
import GoalZoneMessages from "@/components/dashboard/GoalZoneMessages";
import { Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import { fileTimestamp } from "@/lib/dateUtils";

export default function GoalReadonlyViewer({
  zones, years, scoped = false, actingAs = null,
}: {
  zones: { id: number; zoneName: string }[];
  years: RotaryYear[];
  scoped?: boolean;
  actingAs?: string | null;
}) {
  const currentYear = years.find((y) => y.isCurrent) || years[0];
  const [yearId, setYearId] = useState<number>(currentYear ? currentYear.id : 0);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [districts, setDistricts] = useState<GoalDistrictSummaryDto[]>([]);       // unscoped: districts of the zone
  const [scopedDistricts, setScopedDistricts] = useState<GoalDistrictSummaryDto[]>([]); // scoped: all my districts
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [clubs, setClubs] = useState<GoalClubSummaryDto[]>([]);
  const [clubId, setClubId] = useState<number | null>(null); // null → district-level view (always null in scoped mode)
  const [catId, setCatId] = useState<number | null>(null);   // any category id, for the list endpoints + comments
  const [viewCatId, setViewCatId] = useState<number | null>(null); // the category tab selected in the top panel → drives the month-wise panel

  useEffect(() => { getGoalOversightCategories().then((cs) => setCatId(cs[0]?.id ?? null)).catch(() => {}); }, []);

  // Reset the lower selections when a higher one changes — NOT when the year changes.
  useEffect(() => { setDistrictId(null); setClubId(null); }, [zoneId]);
  useEffect(() => { setClubId(null); }, [districtId]);

  // Scoped: fetch ALL the member's districts once (server enforces scope); filter by zone client-side.
  useEffect(() => {
    if (!scoped || !catId) { setScopedDistricts([]); return; }
    let cancelled = false;
    getScopedDistrictsGoalList(catId, yearId)
      .then((d) => { if (!cancelled) setScopedDistricts(d); })
      .catch(() => { if (!cancelled) setScopedDistricts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, catId]);

  // Unscoped: districts for the chosen zone. Year is intentionally NOT a trigger.
  useEffect(() => {
    if (scoped) return;
    if (!zoneId || !catId) { setDistricts([]); return; }
    let cancelled = false;
    getZoneDistrictsGoalList(catId, yearId, zoneId)
      .then((d) => { if (!cancelled) setDistricts(d); })
      .catch(() => { if (!cancelled) setDistricts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, catId, scoped]);

  // Clubs for the chosen district — both modes (scoped uses the role-scoped club list).
  useEffect(() => {
    if (!districtId || !catId) { setClubs([]); return; }
    let cancelled = false;
    const p = scoped
      ? getScopedDistrictClubsGoalList(catId, yearId, districtId)
      : getDistrictClubsGoalList(catId, yearId, districtId);
    p.then((c) => { if (!cancelled) setClubs(c); })
     .catch(() => { if (!cancelled) setClubs([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId, catId, scoped]);

  // The districts shown in the dropdown: scoped → my districts of the selected zone; else the zone list.
  const visibleDistricts = scoped ? scopedDistricts.filter((d) => d.zoneId === zoneId) : districts;

  const fetchForm = useCallback(
    (categoryId: number): Promise<GoalCategoryFormDto> =>
      scoped
        ? (clubId
            ? getScopedClubGoalForm(categoryId, yearId, clubId)
            : getScopedDistrictGoalForm(categoryId, districtId ?? 0, yearId))
        : clubId
          ? getClubGoalForm(categoryId, yearId, clubId)
          : getDistrictGoalForm(categoryId, yearId, districtId),
    [scoped, clubId, districtId, yearId],
  );
  const fetchMonthly = useCallback(
    (categoryId: number): Promise<GoalMonthlyForm> =>
      clubId ? getClubMonthlyGoals(categoryId, yearId, clubId) : getDistrictMonthlyGoals(categoryId, yearId, districtId),
    [clubId, districtId, yearId],
  );

  // Quarterly / month-wise TARGET split, READ ONLY for every oversight role (user 2026-09-25) —
  // RI Director, Zone Co-ordinator, District Assistant and the SuperAdmin overview all land here.
  // Only Club/District Admin may edit a split, so this panel never gets a save handler.
  // An annual-only category (Youth Service / Public Image) returns nothing and the panel hides itself.
  const [splitForm, setSplitForm] = useState<GoalMonthlyForm | null>(null);
  useEffect(() => {
    if (viewCatId == null || !districtId) { setSplitForm(null); return; }
    let cancelled = false;
    const load = scoped && !clubId
      ? getDistrictMonthlyGoalsScoped(viewCatId, districtId, yearId)
      : fetchMonthly(viewCatId);
    load.then((m) => { if (!cancelled) setSplitForm(m); })
        .catch(() => { if (!cancelled) setSplitForm(null); });
    return () => { cancelled = true; };
  }, [viewCatId, districtId, clubId, scoped, yearId, fetchMonthly]);

  // Drill-down report downloads (Zone / District / Club) — all 4 categories, YTD + Month-wise (+ Messages
  // for zone/district). Scope is enforced server-side; a role out of scope gets the server's message here.
  const [dl, setDl] = useState<null | "zone" | "district" | "club">(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  async function downloadReport(level: "zone" | "district" | "club") {
    setDl(level); setDlErr(null);
    try {
      let blob: Blob; let name: string;
      if (level === "zone" && zoneId) {
        blob = await downloadZoneGoalReport(zoneId, yearId);
        name = `goal-zone-${zones.find((z) => z.id === zoneId)?.zoneName ?? zoneId}`;
      } else if (level === "district" && districtId) {
        blob = await downloadDistrictGoalReport(districtId, yearId);
        name = `goal-district-${visibleDistricts.find((d) => d.districtId === districtId)?.districtNumber ?? districtId}`;
      } else if (level === "club" && clubId) {
        blob = await downloadClubGoalReport(clubId, yearId);
        name = `goal-club-${clubs.find((c) => c.clubId === clubId)?.clubName ?? clubId}`;
      } else { setDl(null); return; }
      saveAs(blob, `${name.replace(/\s+/g, "-")}-${fileTimestamp()}.xlsx`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setDlErr(msg || "Could not download the report.");
    } finally { setDl(null); }
  }

  const selCls = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400";
  const btnCls = "inline-flex items-center gap-1.5 h-9 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">Goal Setting — read-only view</div>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Pick a district or club to see its Membership / Foundation / Youth Service / Public Image goals. Changing the year keeps your selection and just refreshes the figures below.</p>
        {/* Plain selects in reading order: Zone → District → Club → Year. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Zone
            <select className={selCls} value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.zoneName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            District
            <select className={selCls} value={districtId ?? ""} disabled={!zoneId} onChange={(e) => setDistrictId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{zoneId ? (visibleDistricts.length ? "Select district" : "No districts") : "Pick a zone first"}</option>
              {visibleDistricts.map((d) => <option key={d.districtId} value={d.districtId}>{d.districtNumber}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Club
            <select className={selCls} value={clubId ?? ""} disabled={!districtId || CLUB_GOAL_SETTING_COMING_SOON}
                    title={CLUB_GOAL_SETTING_COMING_SOON ? "Club Goal Setting is coming soon" : undefined}
                    onChange={(e) => setClubId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Whole district (not a club)</option>
              {!CLUB_GOAL_SETTING_COMING_SOON && clubs.map((c) => <option key={c.clubId} value={c.clubId}>{c.clubName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Year
            <select className={selCls} value={yearId || ""} onChange={(e) => setYearId(Number(e.target.value))}>
              {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</option>)}
            </select>
          </label>
        </div>

        {/* Drill-down report downloads — enabled for whichever level is selected. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 mr-1">Download report:</span>
          <button type="button" className={btnCls} disabled={!zoneId || dl !== null} onClick={() => downloadReport("zone")}>
            {dl === "zone" ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />} Zone
          </button>
          <button type="button" className={btnCls} disabled={!districtId || dl !== null} onClick={() => downloadReport("district")}>
            {dl === "district" ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />} District
          </button>
          {CLUB_GOAL_SETTING_COMING_SOON ? (
            <ClubGoalComingSoon compact />
          ) : (
            <button type="button" className={btnCls} disabled={!clubId || dl !== null} onClick={() => downloadReport("club")}>
              {dl === "club" ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />} Club
            </button>
          )}
          <span className="text-[11px] text-slate-400">Excel: YTD + Month-wise sheets</span>
        </div>
        {dlErr && <p className="mt-1.5 text-xs text-red-600">{dlErr}</p>}
      </div>

      {districtId ? (
        <>
          <GoalSettingPanel
            key={`ro-${districtId}-${clubId ?? "d"}`}
            fetchForm={fetchForm}
            readOnly
            title={clubId ? "Club Goals (read only)" : "District Goals (read only)"}
            reloadKey={`${districtId}-${clubId ?? "d"}-${yearId}`}
            onCategoryChange={setViewCatId}
            belowCategories={
              <GoalTargetSplitPanel
                form={splitForm}
                onSave={async () => { throw new Error("read only"); }}
                readOnly
                reloadKey={`${districtId}-${clubId ?? "d"}-${yearId}-${viewCatId}`}
              />
            }
          />
          {!scoped && (
            <MonthlyGoalsPanel
              key={`rom-${districtId}-${clubId ?? "d"}`}
              fetchForm={fetchMonthly}
              readOnly
              activeCategoryId={viewCatId}
              title={clubId ? "Month-wise Collection — Club (read only)" : "Month-wise Collection — District (read only)"}
              reloadKey={`${districtId}-${clubId ?? "d"}-${yearId}`}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400 px-1">Select a zone and district above to view its goals (read only).</p>
      )}

      {/* Comment / messaging part (both modes) — a SINGLE list of everyone in the zone you can
          message (RMC / Zone Co-ordinator + the District Assistants / ARCs), filtered by the CATEGORY
          selected on the top panel. RI Director + SuperAdmin are read-only (server-enforced).
          The old per-district GoalThreadPanel was a redundant second "Messages" box (its one person is
          already in this list), so it has been removed. */}
      {zoneId && (
        <GoalZoneMessages categoryId={viewCatId ?? catId} zoneId={zoneId} yearId={yearId} actingAs={actingAs} districtId={districtId} allowObserverPost={!scoped} />
      )}
    </div>
  );
}
