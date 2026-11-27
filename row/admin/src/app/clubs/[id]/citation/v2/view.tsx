"use client";

/**
 * District Citation v2 — club-side single-page module.
 *
 * Visual language follows the Club Admin Dashboard family (gradient summary
 * band, KpiCard tiles, slate cards, segmented tab strip). All data still
 * flows through the v1 API surface (getClubCitation / saveClubManualEntries
 * / refreshClubAutoPoints) so no backend changes are required.
 *
 * Query params honoured (frontend-only behaviour, mirrors v1):
 *   ?returnTo=<encoded path>  → custom Back target (e-gov dashboard).
 *   ?readOnly=true            → district-admin viewing; Save and inputs disabled.
 *   ?districtId=<id>          → override the district resolved from the club.
 *
 * Save is further gated on (isSuperAdmin || isAdmin), matching v1.
 */

import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ToggleButton } from "@/components/ui/text-buttons";
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Award, Calculator, RefreshCw, Save, Trophy, CheckCircle2, FileText } from "@/components/icons";
import {
  getClub,
  getClubCitation,
  saveClubManualEntries,
  getDistrictAwardsConfig,
  refreshClubAutoPoints,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import LoadingButton from "@/components/v2/LoadingButton";
import { fmtInt, ROTARY_BLUE } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import DistrictEgovernanceTabBar from "@/components/dashboard/DistrictEgovernanceTabBar";
import DistrictEgovernanceKpis from "@/components/dashboard/DistrictEgovernanceKpis";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { clubYearRights, canEditYearless } from "@/lib/adminYears";
import { useCurrentRotaryYear } from "@/hooks/useCurrentRotaryYear";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
// ── Types ───────────────────────────────────────────────────────────────────
// Citation responses are loosely typed in the v1 API, so we mirror that shape
// with permissive `any`-shaped helpers rather than introducing a new type file.

interface ManualAnswer {
  value: string;
  points: number;
  bonus: number;
}

// Default e-gov landing for the Back chevron when no ?returnTo is given.
const DEFAULT_BACK = "/club-admin-dashboard/e-governance";

// Defensive normalization for sub_criteria.answer_type — old/migrated data may
// store the value with different casing/whitespace/synonyms (e.g. "Yes/No",
// "Number", "Choose One"). Map everything to the three canonical UI types so
// rendering AND the points calculation always pick a branch.
// Indian-style thousand grouping, no decimals (points are integers everywhere).
function fmtPts(n: number) {
  return Math.round(Number(n) || 0).toLocaleString(appLocale());
}

// A typed number answer below zero (blank / "-" alone are not negative figures).
function isNegativeAnswer(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  return v !== "" && v !== "-" && Number(v) < 0;
}

function normalizeAnswerType(sc: { answerType?: unknown; options?: unknown }): "number" | "yesno" | "choose_one" | "text" {
  const raw = String(sc.answerType ?? "").toLowerCase().trim().replace(/[\s_-]/g, "");
  if (raw === "text") return "text";   // District Goals text answer, no points (user 2026-11-16)
  if (raw === "yesno" || raw === "yn" || raw === "boolean" || raw === "bool" || raw === "yes" || raw === "no") return "yesno";
  if (raw === "chooseone" || raw === "choose" || raw === "select" || raw === "option" || raw === "options" || raw === "radio" || (Array.isArray(sc.options) && sc.options.length > 0)) return "choose_one";
  return "number"; // Fallback for "number", blank, or unknown
}

// Named export — embeddable view (see ocv-gov/v2 for the rationale). The route's
// prop-less default export is below.
export function ClubCitationV2View({ clubId: propClubId, embedded = false, readOnly: readOnlyProp, districtId: districtIdProp, yearId: yearIdProp }: { clubId?: number; embedded?: boolean; readOnly?: boolean; districtId?: number; yearId?: number | null } = {}) {
  useSyncClubIdFromUrl(!embedded);
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);

  const returnToParam = searchParams.get("returnTo");
  // Props win when rendered inline (District Awards ▸ Club Points ▸ View); fall
  // back to URL params for the standalone route.
  const readOnly = readOnlyProp ?? (searchParams.get("readOnly") === "true");
  const districtIdParam = districtIdProp ?? Number(searchParams.get("districtId") || "0");

  // Edit-vs-read-only is determined by the URL ?readOnly=true flag AND the District Awards
  // activation flag: if a SuperAdmin has DISABLED awards for this district+year, point entry is
  // read-only here too (and the API rejects saves regardless).
  const [awardsDisabled, setAwardsDisabled] = useState(false);
  // Citation entry can only ever write the CURRENT Rotary year — the service
  // resolves IsCurrent = 1 itself and there is no way to target a past one. So
  // the year rule here is the current-year one, not "the year on screen".
  const { user, isSuperAdmin } = useAuth();
  const currentYearId = useCurrentRotaryYear();
  const citationYearRights = useMemo(
    () => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const hasCurrentYearRights = canEditYearless(citationYearRights, currentYearId, isSuperAdmin);
  const canManage = !readOnly && !awardsDisabled && hasCurrentYearRights;

  const [clubName, setClubName] = useState("");
  const [districtId, setDistrictId] = useState(districtIdParam);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The first negative answer: after the error is closed, the page scrolls to it and focuses it.
  const [focusAfterError, setFocusAfterError] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"auto" | "manual">("auto");

  const [citationData, setCitationData] = useState<any>(null);
  const [manualAnswers, setManualAnswers] = useState<Record<number, ManualAnswer>>({});

  // Back URL: honour ?returnTo first; fall back to the e-gov dashboard. v1's
  // legacy `/clubs/[id]/dashboard` fallback is intentionally retired here.
  const backUrl = returnToParam
    ? decodeURIComponent(returnToParam)
    : readOnly && districtId
      ? `/districts/${districtId}/citation?tab=club_points`
      : DEFAULT_BACK;

  // Pick up the global topbar year (?yearId=) so this page's citation total
  // matches what the dashboard Overview's Citation Score card shows.
  const urlYearStr = searchParams.get("yearId");
  const urlYearId = yearIdProp ?? (urlYearStr ? parseInt(urlYearStr, 10) || null : null);

  // District Awards activation for this club's district + year. Disabled ⇒ read-only entry.
  useEffect(() => {
    let cancelled = false;
    if (!districtId || !urlYearId) { setAwardsDisabled(false); return; }
    getDistrictAwardsConfig(districtId, urlYearId)
      .then((c) => { if (!cancelled) setAwardsDisabled(!c.isEnabled); })
      .catch(() => { if (!cancelled) setAwardsDisabled(false); });
    return () => { cancelled = true; };
  }, [districtId, urlYearId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const club = await getClub(clubId);
      const dId = districtId || club.fkDistrictId || 0;
      if (!dId) {
        setErrorMessage("District ID not found.");
        setLoading(false);
        return;
      }
      if (!districtId) setDistrictId(dId);

      const data = await getClubCitation(clubId, dId, urlYearId);
      setClubName(club.clubName);
      setCitationData(data);

      // Seed manualAnswers from server-side saved values.
      const answers: Record<number, ManualAnswer> = {};
      if (data?.manualQuestions) {
        for (const mc of data.manualQuestions) {
          for (const sc of (mc.subCriteria || [])) {
            answers[sc.id] = {
              value: sc.answerValue || "",
              points: Number(sc.pointsEarned) || 0,
              bonus: Number(sc.bonusEarned) || 0,
            };
          }
        }
      }
      setManualAnswers(answers);
    } catch (err: any) {
      const detail = err?.response?.data?.message || err?.message || "Unknown error";
      setErrorMessage(`Failed to load awards data: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [clubId, districtId, urlYearId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefreshAuto = async () => {
    setRefreshing(true);
    try {
      await refreshClubAutoPoints(clubId, districtId);
      await fetchData();
      setSuccessMessage("Auto points refreshed.");
    } catch {
      setErrorMessage("Failed to refresh.");
    } finally {
      setRefreshing(false);
    }
  };

  // Mirror v1's per-answer points/bonus computation so the live total in the
  // header band updates without a round-trip.
  const updateManualAnswer = (subCriteriaId: number, value: string, sc: any) => {
    const answerType = normalizeAnswerType(sc);
    let points = 0;
    let bonus = 0;

    if (answerType === "number") {
      const numVal = Number(value) || 0;
      points = numVal * Number(sc.points);
      if (sc.isBonus) {
        if (Number(sc.minBonus) === 0 && Number(sc.maxBonus) === 0) {
          bonus = Number(sc.bonusPoints);
        } else {
          if (numVal >= Number(sc.minBonus) && Number(sc.minBonus) > 0) bonus = Number(sc.bonusPoints);
          if (Number(sc.maxBonus) > 0 && numVal > Number(sc.maxBonus)) points = Number(sc.maxBonus) * Number(sc.points);
        }
      }
      if (numVal === 0) { points = 0; bonus = 0; }
    } else if (answerType === "yesno") {
      points = value === "yes" ? Number(sc.points) : 0;
    } else if (answerType === "choose_one") {
      const selectedOpt = (sc.options || []).find((o: any) => String(o.id) === value);
      points = selectedOpt ? Number(selectedOpt.optionPoints) : 0;
    }

    setManualAnswers((prev) => ({ ...prev, [subCriteriaId]: { value, points, bonus } }));
  };

  const handleSaveManual = async () => {
    // Number answers cannot be negative (user 2026-10-08) - name every question that has one.
    const negative: string[] = [];
    let firstId: number | null = null;
    for (const mc of citationData?.manualQuestions || []) {
      for (const sc of (mc.subCriteria || [])) {
        if (normalizeAnswerType(sc) !== "number") continue;
        if (isNegativeAnswer(manualAnswers[sc.id]?.value)) {
          negative.push(sc.title || `Question ${sc.id}`);
          if (firstId == null) firstId = sc.id;
        }
      }
    }
    if (negative.length > 0) {
      setFocusAfterError(firstId);
      setErrorMessage(`Points cannot be negative. Please enter 0 or more for: ${negative.join(", ")}. `
        + `The ${negative.length === 1 ? "box is" : "boxes are"} marked in red.`);
      return;
    }
    setSavingManual(true);
    try {
      const entries = Object.entries(manualAnswers).map(([id, ans]) => ({
        districtId,
        subCriteriaId: Number(id),
        answerValue: ans.value,
        pointsEarned: ans.points,
        bonusEarned: ans.bonus,
      }));
      await saveClubManualEntries(clubId, entries);
      setSuccessMessage("Manual entries saved.");
      await fetchData();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to save.");
    } finally {
      setSavingManual(false);
    }
  };

  const totalAuto = Number(citationData?.totalAuto || 0);
  const totalManual = useMemo(
    () => Object.values(manualAnswers).reduce((sum, a) => sum + a.points + a.bonus, 0),
    [manualAnswers],
  );
  const grandTotal = totalAuto + totalManual;

  const yearLabel: string = citationData?.yearLabel || "Current Year";

  // Static E-Governance KPI cards + tab bar — rendered in BOTH the loading and
  // loaded states (so it never pops in / shifts the page). Only shown for the
  // district read-only view opened from District Awards ▸ Club Points ▸ View.
  const districtTopBar = !embedded && readOnly && districtId ? (
    <div className="space-y-4">
      <DistrictEgovernanceKpis districtId={districtId} yearId={urlYearId} />
      <DistrictEgovernanceTabBar />
    </div>
  ) : null;

  // ── Loading / shell ────────────────────────────────────────────────────
  if (loading) {
    const loadingBody = (
      <div className="space-y-5">
        {districtTopBar}
        <SkeletonRows />
      </div>
    );
    if (embedded) return loadingBody;
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="District Awards"
          pageSubtitle="Auto + manual award points"
          activeNavHref="/club-admin-dashboard/e-governance"
        >
          {loadingBody}
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const body = (
      <div className="space-y-5">
        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => {
            setErrorMessage(null);
            // Take the user straight to the first negative box (long district question lists).
            if (focusAfterError != null) {
              const id = focusAfterError;
              setFocusAfterError(null);
              setTimeout(() => {
                const el = document.getElementById(`award-answer-${id}`) as HTMLInputElement | null;
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
                el?.focus({ preventScroll: true });
                el?.select();
              }, 50);
            }
          }}
        />

        {/* District Awards disabled for this year → read-only notice (entry is also API-blocked). */}
        {awardsDisabled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            District Awards is not activated{yearLabel ? ` for RY ${yearLabel}` : ""}.
          </div>
        )}

        {/* Static E-Governance KPI cards + tab bar (also rendered during loading so
            it never shifts). */}
        {districtTopBar}

        {/* ── Header ──────────────────────────────────────────────────── */}
        {!embedded && (
        <PageHeader title={clubName ? `${clubName} · District Awards` : "District Awards"} description={<>RY {yearLabel}{readOnly ? " · District view (read-only)" : ""}</>} back={backUrl} />
        )}

        {/* ── Summary gradient band ───────────────────────────────────── */}
        <div
          className="rounded-xl p-5 text-white"
          style={{ background: ROTARY_BLUE }}
        >
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="h-5 w-5" />
            <p className="text-sm font-extrabold">RY {yearLabel} · District Awards Score</p>
          </div>
          <p className="text-3xl font-extrabold tracking-tight tabular-nums">
            {fmtPts(grandTotal)}
          </p>
          <p className="text-xs opacity-80 mt-1">
            Auto {fmtPts(totalAuto)} + Manual {fmtPts(totalManual)}
          </p>
        </div>

        {/* ── KPI tiles ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="Auto Points"
            value={fmtPts(totalAuto)}
            subtitle="System-calculated"
            icon={Calculator}
            color="blue"
          />
          <KpiCard
            title="Manual Points"
            value={fmtPts(totalManual)}
            subtitle="Self-declared"
            icon={Award}
            color="green"
          />
          <KpiCard
            title="Grand Total"
            value={fmtPts(grandTotal)}
            subtitle="Auto + Manual"
            icon={Trophy}
            color="gold"
          />
        </div>

        {/* ── Description (optional, HTML from API) ───────────────────── */}
        {citationData?.descriptionHtml && (
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <FileText size={14} className="text-slate-500" />
              <h3 className="row-h3">About these awards</h3>
            </div>
            <div
              className="px-5 py-4 text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: citationData.descriptionHtml }}
            />
          </Card>
        )}

        {/* ── Tab strip ───────────────────────────────────────────────── */}
        <Card className="p-1.5 inline-flex w-full sm:w-auto">
          <ToggleButton pressed={activeTab === "auto"} onClick={() => setActiveTab("auto")} className="flex-1 sm:flex-initial">
            Auto Points
          </ToggleButton>
          <ToggleButton pressed={activeTab === "manual"} onClick={() => setActiveTab("manual")} className="flex-1 sm:flex-initial">
            Manual Points
          </ToggleButton>
        </Card>

        {/* ── Auto Points tab ─────────────────────────────────────────── */}
        {activeTab === "auto" && (
          <AutoPointsPanel
            citationData={citationData}
            totalAuto={totalAuto}
            refreshing={refreshing}
            onRefresh={handleRefreshAuto}
            canRefresh={!readOnly}
          />
        )}

        {/* ── Manual Points tab ───────────────────────────────────────── */}
        {activeTab === "manual" && (
          <ManualPointsPanel
            citationData={citationData}
            manualAnswers={manualAnswers}
            canManage={canManage}
            saving={savingManual}
            onChange={updateManualAnswer}
            onSave={handleSaveManual}
          />
        )}
      </div>
  );

  if (embedded) return body;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="District Awards"
        pageSubtitle="Auto + manual award points"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        {body}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-panels
// ────────────────────────────────────────────────────────────────────────────

function AutoPointsPanel({
  citationData, totalAuto, refreshing, onRefresh, canRefresh,
}: {
  citationData: any;
  totalAuto: number;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  canRefresh: boolean;
}) {
  const entries: any[] = citationData?.autoEntries || [];
  const sumPoints = entries.reduce((s, e) => s + Number(e.pointsEarned || 0), 0);
  const sumBonus = entries.reduce((s, e) => s + Number(e.bonusEarned || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="row-h3">Auto-calculated Points</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Derived from system data (projects, meetings, members, etc.)
            </p>
          </div>
          {canRefresh && (
            <LoadingButton
              onAction={onRefresh}
              forcePending={refreshing}
              loadingLabel="Refreshing…"
              spinnerSize={13}
              className="row-btn row-btn-secondary"
            >
              {!refreshing && <RefreshCw size={13} />}
              Refresh Auto Points
            </LoadingButton>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <Calculator size={32} className="mb-3 opacity-60" />
            <p className="text-xs">
              No auto points calculated yet.{canRefresh ? " Click “Refresh Auto Points” to compute." : ""}
            </p>
          </div>
        ) : (
            <Table className="min-w-[640px] md:min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left w-10">#</TableHead>
                  <TableHead className="text-left">Category</TableHead>
                  <TableHead className="text-left">Activity</TableHead>
                  <TableHead className="text-left">Sub Item</TableHead>
                  <TableHead className="text-right">Base Points</TableHead>
                  <TableHead className="text-center">Count</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => {
                  const pts = Number(e.pointsEarned || 0);
                  const bns = Number(e.bonusEarned || 0);
                  // Sub-item lineage: backend ships e.subItemDisplay built from
                  // the area of focus (CASE in the
                  // /api/clubs/{id}/citation SQL). Fall back to the raw
                  // sub_item_name then the type when nothing else is set.
                  const subItemText = e.subItemDisplay || e.subItemName || e.subItemType || "–";
                  // Per-unit base points: prefer the sub-item's base if this
                  // row is for a sub-item, else the question's base.
                  const basePts = Number(
                    e.subItemId
                      ? (e.subBasePoints ?? e.basePoints ?? 0)
                      : (e.basePoints ?? 0)
                  );
                  return (
                    <TableRow key={e.id ?? i}>
                      <TableCell className="py-2 text-slate-500">{i + 1}</TableCell>
                      <TableCell className="py-2 font-medium text-slate-800">{e.categoryName || "–"}</TableCell>
                      <TableCell className="py-2 text-slate-700">{e.activityName || "–"}</TableCell>
                      <TableCell className="py-2 text-slate-600 whitespace-normal break-words">{subItemText}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-slate-700">{fmtPts(basePts)}</TableCell>
                      <TableCell className="py-2 text-center text-slate-700 tabular-nums">{e.answerValue || "–"}</TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-amber-700">{bns > 0 ? fmtPts(bns) : "–"}</TableCell>
                      <TableCell className="py-2 text-right font-semibold tabular-nums text-blue-700">{fmtPts(pts + bns)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="py-2.5 font-bold" colSpan={6}>Total Auto Points</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{fmtPts(sumBonus)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums font-bold text-blue-700">
                    {fmtPts(totalAuto)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
        )}
      </Card>
    </div>
  );
}

function ManualPointsPanel({
  citationData, manualAnswers, canManage, saving, onChange, onSave,
}: {
  citationData: any;
  manualAnswers: Record<number, ManualAnswer>;
  canManage: boolean;
  saving: boolean;
  onChange: (subCriteriaId: number, value: string, sc: any) => void;
  onSave: () => Promise<void>;
}) {
  const categories: any[] = citationData?.manualQuestions || [];

  if (categories.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center py-14 text-slate-400">
          <Calculator size={32} className="mb-3 opacity-60" />
          <p className="text-xs">No manual questions configured for this year.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {categories.map((mc) => (
        <Card key={mc.criteriaId} className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-blue-50 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Award size={14} />
            </div>
            <h3 className="row-h3">{mc.categoryName}</h3>
          </div>
          <div className="p-4 space-y-3">
            {(mc.subCriteria || []).map((sc: any) => {
              const answer = manualAnswers[sc.id] || { value: "", points: 0, bonus: 0 };
              return (
                <ManualRow
                  key={sc.id}
                  sc={sc}
                  answer={answer}
                  canManage={canManage}
                  onChange={onChange}
                />
              );
            })}
          </div>
        </Card>
      ))}

      {canManage && (
        <div className="flex justify-end">
          <LoadingButton
            onAction={onSave}
            forcePending={saving}
            loadingLabel="Saving…"
            spinnerSize={13}
            className="row-btn row-btn-secondary row-btn-sm"
          >
            {!saving && <Save size={13} />}
            Save Manual Points
          </LoadingButton>
        </div>
      )}
    </div>
  );
}

function ManualRow({
  sc, answer, canManage, onChange,
}: {
  sc: any;
  answer: ManualAnswer;
  canManage: boolean;
  onChange: (subCriteriaId: number, value: string, sc: any) => void;
}) {
  const earned = answer.points + answer.bonus;
  const earnedChipClass = earned > 0
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-50 text-slate-500 border-slate-200";
  const normalizedType = normalizeAnswerType(sc);
  const negative = normalizedType === "number" && isNegativeAnswer(answer.value);

  return (
    <div className={`rounded-xl border p-3 transition ${negative ? "border-red-400 bg-red-50/40" : "border-slate-200 hover:border-blue-200"}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{sc.title}</p>
          {sc.remark && <p className="text-xs text-slate-500 mt-0.5">{sc.remark}</p>}
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border tabular-nums ${earnedChipClass}`}>
          {earned > 0 && <CheckCircle2 size={11} />}
          {fmtPts(earned)}
        </span>
      </div>

      {normalizedType === "number" && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Plain text box with a numeric keypad: no up/down arrows and no scroll-wheel changes -
              the club types the figure (user 2026-10-08). Non-digits are still stripped below. */}
          <input
            id={`award-answer-${sc.id}`}
            type="text"
            inputMode="numeric"
            aria-invalid={negative}
            value={answer.value}
            onChange={(e) => onChange(sc.id, e.target.value.replace(/[^0-9-]/g, ""), sc)}
            disabled={!canManage}
            placeholder="0"
            className={`w-32 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
              negative ? "border-red-500 text-red-700 focus:ring-red-400" : "border-slate-200 focus:ring-blue-500"}`}
          />
          <span className="text-xs text-slate-500">
            × {fmtInt(Number(sc.points))}{sc.isBonus ? ` · bonus ${fmtInt(Number(sc.bonusPoints))}` : ""}
          </span>
          {negative && <span className="w-full text-xs font-medium text-red-600">Points cannot be negative - enter 0 or more.</span>}
        </div>
      )}

      {normalizedType === "yesno" && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="inline-flex gap-2">
            <ToggleButton pressed={answer.value === "yes"} disabled={!canManage} onClick={() => onChange(sc.id, "yes", sc)}>
              Yes
            </ToggleButton>
            <ToggleButton pressed={answer.value === "no"} disabled={!canManage} onClick={() => onChange(sc.id, "no", sc)}>
              No
            </ToggleButton>
          </div>
          <span className="text-xs text-slate-500">{fmtInt(Number(sc.points))} if Yes</span>
        </div>
      )}

      {normalizedType === "text" && (
        <Textarea
          id={`award-answer-${sc.id}`}
          rows={2}
          maxLength={500}
          value={answer.value}
          onChange={(e) => onChange(sc.id, e.target.value, sc)}
          disabled={!canManage}
          placeholder="Type your answer..."
          className="disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed resize-y"
        />
      )}

      {normalizedType === "choose_one" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(sc.options || []).map((opt: any) => {
            const checked = answer.value === String(opt.id);
            return (
              <label
                key={opt.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-sm ${
                  checked
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 text-slate-700"
                } ${!canManage ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name={`sc-${sc.id}`}
                  value={String(opt.id)}
                  checked={checked}
                  onChange={() => onChange(sc.id, String(opt.id), sc)}
                  disabled={!canManage}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="flex-1">{opt.optionText}</span>
                <span className="text-xs font-semibold tabular-nums text-slate-500">
                  {fmtInt(Number(opt.optionPoints))}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
