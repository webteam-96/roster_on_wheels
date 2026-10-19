"use client";

/**
 * District Foundation Goal v2 — Edit form.
 *
 * Wave 13D step 2 — District Admin sets per-RY foundation collection goals
 * (Annual / PolioPlus / Endowment / Other in USD) plus per-avenue project
 * count targets. Mirrors the membership-goal v2 page layout and conventions.
 *
 * Path:    /districts/[id]/foundation-goal/v2/edit
 * Returns: ?returnTo overrides the default back target (defaults to the DA
 *          Foundation dashboard).
 * Year:    ?yearId=N forces a specific RY. Otherwise we default to the
 *          current RY from getRotaryYears() (or whatever the foundation
 *          dashboard reports as the active year).
 *
 * Backend (Wave 13A1 + 13A3):
 *   GET  /api/district-admin-dashboard/foundation-goal?districtId=&yearId=
 *   POST /api/district-admin-dashboard/foundation-goal      (upsert)
 *   GET  /api/district-admin-dashboard/project-targets?districtId=&yearId=
 *   POST /api/district-admin-dashboard/project-targets      (bulk upsert)
 *
 *   "Raised so far" values are read from the foundation dashboard endpoint
 *   (annualFundInr / polioFundInr / endowmentInr / othersInr). These are in
 *   INR while targets are stored in USD on the DTO — the UI labels both
 *   currencies so the gap is obvious to the user. The DTOs themselves do
 *   not carry the raised numbers.
 *
 *   "Current" per-avenue counts come from foundation.districtProjectTargets
 *   (DistrictAdminProjectTargetRow.completed). The 5 avenue module IDs are
 *   resolved from getModules() by ModuleKey.
 *
 *   A 403 from either POST means the signed-in member is not an active
 *   District Admin at this district — we surface the API message directly.
 *
 * URL sync: useSyncDistrictIdFromUrl pushes the URL's [id] into AuthContext
 * so the sidebar district indicator and any other consumers stay aligned.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Calendar, Target, IndianRupee, Heart, Sparkles, ClipboardList, Info,
} from "@/components/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDistrictFoundationGoal,
  saveDistrictFoundationGoal,
  getDistrictProjectTargets,
  saveDistrictProjectTargets,
  getDistrictAdminFoundation,
  getRotaryYears,
  getModules,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";
import type {
  DistrictProjectTargetDto,
} from "@/types/districtAdminDashboard";
import type { Module } from "@/types/module";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncDistrictIdFromUrl } from "@/hooks/useSyncDistrictIdFromUrl";
import { fmtInr, fmtInt } from "@/components/dashboard/formatters";

const DEFAULT_BACK = "/district-admin-dashboard/foundation";

// Module keys for the five service-project avenues that this form configures.
// Matches AVENUE_KEYS in DistrictAdminDashboardService.cs (which mirrors the
// seeded module_master.ModuleKey values).
const AVENUE_KEYS: { key: string; label: string }[] = [
  { key: "community_service",       label: "Community Service" },
  { key: "vocational_service",      label: "Vocational Service" },
  { key: "international_service",   label: "International Service" },
  { key: "public_image_initiative", label: "Public Image" },
  { key: "new_generation_service",  label: "New Generation Service" },
];

function FieldLabel({
  children, hint, dot, required = false,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 mb-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

type FundFormKey = "annual" | "polio" | "endowment" | "other";
type FundForm = Record<FundFormKey, string>;

const EMPTY_FUND_FORM: FundForm = {
  annual: "",
  polio: "",
  endowment: "",
  other: "",
};

const FUND_ROWS: {
  key: FundFormKey;
  label: string;
  hint: string;
  icon: React.ElementType;
  dot: string;
}[] = [
  { key: "annual",    label: "Annual Fund",         hint: "Unrestricted giving",          icon: Target,    dot: "bg-blue-500" },
  { key: "polio",     label: "PolioPlus",           hint: "Polio eradication",            icon: Heart,     dot: "bg-purple-500" },
  { key: "endowment", label: "Endowment",           hint: "Long-term programme funding",  icon: Sparkles,  dot: "bg-amber-500" },
  { key: "other",     label: "Other Designated",    hint: "Restricted / other",           icon: IndianRupee, dot: "bg-emerald-500" },
];

function toUsd(v: string): number {
  const n = parseFloat(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "$0";
  return "$" + Math.round(n).toLocaleString("en-US");
}

export default function DistrictFoundationGoalV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const yearIdParam = Number(searchParams.get("yearId") || "0");

  const { navigateAfterSave } = useV2ReturnTo(DEFAULT_BACK);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [districtNumber, setDistrictNumber] = useState<string>("");
  const [yearLabel, setYearLabel] = useState<string>("");

  // Raised-so-far values (INR, from foundation dashboard).
  const [raisedAnnualInr, setRaisedAnnualInr] = useState<number | null>(null);
  const [raisedPolioInr,  setRaisedPolioInr]  = useState<number | null>(null);
  const [raisedEndowmentInr, setRaisedEndowmentInr] = useState<number | null>(null);
  const [raisedOthersInr, setRaisedOthersInr] = useState<number | null>(null);

  // Per-avenue "completed" counts (from foundation.districtProjectTargets).
  const [avenueCompleted, setAvenueCompleted] = useState<Record<string, number>>({});

  // The 5 avenue modules (with fkModuleId) — looked up via getModules().
  const [avenueModules, setAvenueModules] = useState<{ key: string; label: string; moduleId: number }[]>([]);

  // Year selection
  const [selectedYearId, setSelectedYearId] = useState<number>(0);

  // Tab 1: Foundation goals form (USD)
  const [fundForm, setFundForm] = useState<FundForm>(EMPTY_FUND_FORM);

  // Tab 2: Project targets form — keyed by avenue moduleKey
  const [targetForm, setTargetForm] = useState<Record<string, string>>({});

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const [activeTab, setActiveTab] = useState<"goals" | "targets">("goals");

  // ── Initial bootstrap: years + dashboard context + module list ───────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [years, foundation, modules] = await Promise.all([
          getRotaryYears(),
          // Best-effort fetch for header context + raised values + avenue counts.
          getDistrictAdminFoundation(undefined, districtId).catch(() => null),
          // Best-effort: module list to resolve avenue fkModuleId values.
          getModules().catch(() => [] as Module[]),
        ]);
        if (cancelled) return;

        setAllYears(years);
        if (foundation) {
          setDistrictNumber(foundation.district.districtNumber);
          setYearLabel(foundation.district.yearLabel);
          setRaisedAnnualInr(foundation.annualFundInr ?? 0);
          setRaisedPolioInr(foundation.polioFundInr ?? 0);
          setRaisedEndowmentInr(foundation.endowmentInr ?? 0);
          setRaisedOthersInr(foundation.othersInr ?? 0);

          // Build avenueKey → completed map from dashboard data.
          const completedMap: Record<string, number> = {};
          for (const r of foundation.districtProjectTargets ?? []) {
            completedMap[r.typeKey] = r.completed ?? 0;
          }
          setAvenueCompleted(completedMap);
        }

        // Resolve fkModuleId for each of the 5 avenue keys using module_master.
        const byKey = new Map<string, Module>();
        for (const m of modules) {
          if (m.moduleKey) byKey.set(m.moduleKey, m);
        }
        const resolved = AVENUE_KEYS.map((a) => {
          const m = byKey.get(a.key);
          return {
            key: a.key,
            label: m?.moduleName || a.label,
            moduleId: m?.id ?? 0,
          };
        });
        setAvenueModules(resolved);

        // Resolve initial year: explicit ?yearId > foundation.yearLabel
        // match > rotary-year-master current flag.
        let initialYearId = 0;
        if (yearIdParam > 0 && years.some((y) => y.id === yearIdParam)) {
          initialYearId = yearIdParam;
        } else if (foundation?.district.yearLabel) {
          const match = years.find((y) => y.yearLabel === foundation.district.yearLabel);
          if (match) initialYearId = match.id;
        }
        if (!initialYearId) {
          const current = years.find((y) => y.isCurrent);
          if (current) initialYearId = current.id;
        }
        if (initialYearId) setSelectedYearId(initialYearId);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } }; message?: string };
        if (!cancelled) {
          setBootError(e?.response?.data?.message || e?.message || "Failed to load foundation goal page.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (Number.isFinite(districtId) && districtId > 0) {
      init();
    } else {
      setBootError("Invalid district id in URL.");
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [districtId, yearIdParam]);

  // ── Year change → load existing foundation goal + project targets ────
  useEffect(() => {
    let cancelled = false;
    if (!selectedYearId || !districtId) return;

    async function load() {
      try {
        const [goal, targets] = await Promise.all([
          getDistrictFoundationGoal(districtId, selectedYearId),
          getDistrictProjectTargets(districtId, selectedYearId).catch(() => [] as DistrictProjectTargetDto[]),
        ]);
        if (cancelled) return;

        if (goal) {
          setFundForm({
            annual:    goal.targetAnnualFundUsd > 0    ? String(goal.targetAnnualFundUsd)    : "",
            polio:     goal.targetPolioFundUsd > 0     ? String(goal.targetPolioFundUsd)     : "",
            endowment: goal.targetEndowmentFundUsd > 0 ? String(goal.targetEndowmentFundUsd) : "",
            other:     goal.targetOtherFundUsd > 0     ? String(goal.targetOtherFundUsd)     : "",
          });
        } else {
          setFundForm(EMPTY_FUND_FORM);
        }

        // Map existing project-target rows back into the avenue form,
        // keyed by fkModuleId so we don't depend on moduleKey being returned.
        const byModuleId = new Map<number, number>();
        for (const t of targets) {
          byModuleId.set(t.fkModuleId, t.targetCount ?? 0);
        }
        const next: Record<string, string> = {};
        for (const a of avenueModules) {
          const tc = byModuleId.get(a.moduleId);
          next[a.key] = tc != null && tc > 0 ? String(tc) : "";
        }
        setTargetForm(next);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string }; status?: number } };
        if (!cancelled) {
          setErrorMessage(
            e?.response?.data?.message
              ?? (e?.response?.status === 403
                ? "You do not have permission to view this goal."
                : "Failed to load existing goal data."),
          );
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [districtId, selectedYearId, avenueModules]);

  // ── Derived totals ───────────────────────────────────────────────────
  const totalTargetUsd = useMemo(
    () => toUsd(fundForm.annual) + toUsd(fundForm.polio) + toUsd(fundForm.endowment) + toUsd(fundForm.other),
    [fundForm],
  );

  // ── Save handlers ────────────────────────────────────────────────────
  const handleSaveGoals = async () => {
    if (!selectedYearId) {
      setErrorMessage("Please select a rotary year.");
      return;
    }
    const a = toUsd(fundForm.annual);
    const p = toUsd(fundForm.polio);
    const e = toUsd(fundForm.endowment);
    const o = toUsd(fundForm.other);
    if (a + p + e + o <= 0) {
      setErrorMessage("Please set at least one non-zero fund target.");
      return;
    }

    setSaving(true);
    try {
      await saveDistrictFoundationGoal({
        fkDistrictId: districtId,
        fkYearId: selectedYearId,
        targetAnnualFundUsd: a,
        targetPolioFundUsd: p,
        targetEndowmentFundUsd: e,
        targetOtherFundUsd: o,
      });
      setSuccessMessage("Foundation collection goals saved successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      handleSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTargets = async () => {
    if (!selectedYearId) {
      setErrorMessage("Please select a rotary year.");
      return;
    }
    // Validate every avenue has a resolvable moduleId — if not, the modules
    // endpoint didn't return that avenue and we can't save.
    const missing = avenueModules.filter((a) => !a.moduleId);
    if (missing.length === AVENUE_KEYS.length) {
      setErrorMessage(
        "Unable to load avenue module IDs. Please refresh the page or contact support.",
      );
      return;
    }

    const items = avenueModules
      .filter((a) => a.moduleId > 0)
      .map((a) => ({
        fkModuleId: a.moduleId,
        targetCount: Math.max(0, parseInt(targetForm[a.key] || "0", 10) || 0),
      }));

    if (items.length === 0) {
      setErrorMessage("No avenue targets to save.");
      return;
    }

    setSaving(true);
    try {
      await saveDistrictProjectTargets({
        districtId,
        yearId: selectedYearId,
        targets: items,
      });
      setSuccessMessage("Project targets saved successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      handleSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  function handleSaveError(err: unknown) {
    const anyErr = err as {
      response?: { data?: { message?: string } | string; status?: number };
      message?: string;
    };
    const apiMsg =
      (typeof anyErr.response?.data === "object" && anyErr.response?.data?.message) ||
      (typeof anyErr.response?.data === "string" ? anyErr.response.data : undefined) ||
      anyErr.message ||
      "Failed to save.";
    const prefix = anyErr.response?.status === 403 ? "Permission denied: " : "";
    setErrorMessage(prefix + apiMsg);
  }

  // ── Render guards ────────────────────────────────────────────────────
  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Set Foundation Goals"
          activeNavHref="/district-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  if (bootError) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Set Foundation Goals"
          activeNavHref="/district-admin-dashboard/foundation"
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {bootError}
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  const subtitleParts: string[] = [];
  if (districtNumber) subtitleParts.push(`District ${districtNumber}`);
  if (yearLabel) subtitleParts.push(`RY ${yearLabel}`);
  const subtitle = subtitleParts.join(" · ");

  // The shell save button calls the active tab's handler.
  const onSave = activeTab === "goals" ? handleSaveGoals : handleSaveTargets;
  const saveLabel = activeTab === "goals" ? "Save Goals" : "Save Targets";

  const raisedByKey: Record<FundFormKey, number | null> = {
    annual:    raisedAnnualInr,
    polio:     raisedPolioInr,
    endowment: raisedEndowmentInr,
    other:     raisedOthersInr,
  };

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Set Foundation Goals"
        pageSubtitle="Define this RY's district foundation collection + project targets"
        activeNavHref="/district-admin-dashboard/foundation"
      >
        <V2FormShell
          title="Set Foundation Goals"
          subtitle={subtitle || undefined}
          defaultBack={DEFAULT_BACK}
          saving={saving}
          saveLabel={saveLabel}
          onSave={onSave}
        >
          {/* 1. Rotary year ── */}
          <SectionCard number={1} icon={Calendar} title="Rotary Year" dot="bg-amber-500">
            <FieldLabel dot="bg-amber-500" required>Rotary Year</FieldLabel>
            <select
              value={selectedYearId || ""}
              onChange={(e) => setSelectedYearId(Number(e.target.value))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select rotary year…</option>
              {allYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Goals are stored one row per (district, year). Switching the year
              loads the saved values for that RY (if any).
            </p>
          </SectionCard>

          {/* 2. Tabbed targets ── */}
          <SectionCard number={2} icon={Target} title="Targets" dot="bg-blue-600">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "goals" | "targets")}>
              <TabsList className="bg-slate-50 border border-slate-200 rounded-lg p-1 h-auto mb-4">
                <TabsTrigger
                  value="goals"
                  className="text-xs font-semibold data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-md px-3 py-1.5"
                >
                  <IndianRupee size={12} className="mr-1.5" />
                  Foundation Collection Goals
                </TabsTrigger>
                <TabsTrigger
                  value="targets"
                  className="text-xs font-semibold data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-md px-3 py-1.5"
                >
                  <ClipboardList size={12} className="mr-1.5" />
                  Project Targets per Avenue
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Foundation collection goals ─────────────── */}
              <TabsContent value="goals" className="space-y-3 mt-0">
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Targets are stored in <span className="font-semibold">USD</span>.
                    &quot;Raised so far&quot; is reported in <span className="font-semibold">INR</span>
                    {" "}from this year&apos;s TRF contributions. The Save button
                    saves the goals shown on this tab.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {FUND_ROWS.map((row) => {
                    const Icon = row.icon;
                    const raised = raisedByKey[row.key];
                    return (
                      <div
                        key={row.key}
                        className="border border-slate-100 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-[1fr_minmax(160px,200px)_minmax(140px,180px)] sm:items-end gap-3"
                      >
                        <div>
                          <FieldLabel dot={row.dot}>
                            <span className="inline-flex items-center gap-1.5">
                              <Icon size={12} className="text-slate-400" />
                              {row.label}
                            </span>
                          </FieldLabel>
                          <p className="text-[11px] text-slate-500">{row.hint}</p>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                            Target (USD)
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              inputMode="numeric"
                              value={fundForm[row.key]}
                              onChange={(e) =>
                                setFundForm((p) => ({ ...p, [row.key]: e.target.value }))
                              }
                              placeholder="0"
                              className="w-full rounded-md border border-slate-200 bg-white pl-6 pr-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                            Raised so far (INR)
                          </label>
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 tabular-nums">
                            {raised == null ? "–" : fmtInr(raised)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-500">
                    Total target across all funds
                  </span>
                  <span className="text-base font-bold text-blue-700 tabular-nums">
                    {fmtUsd(totalTargetUsd)}
                  </span>
                </div>
              </TabsContent>

              {/* ── Tab 2: Project targets per avenue ──────────────── */}
              <TabsContent value="targets" className="space-y-3 mt-0">
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Set how many service projects each avenue should complete
                    this Rotary year. Current counts come from across all clubs
                    in the district. The Save button bulk-upserts every row
                    shown below.
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                          Avenue
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap w-40">
                          Target
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap w-28">
                          Current
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap w-20">
                          %
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {avenueModules.map((a) => {
                        const completed = avenueCompleted[a.key] ?? 0;
                        const targetStr = targetForm[a.key] ?? "";
                        const target = Math.max(0, parseInt(targetStr || "0", 10) || 0);
                        const pct = target > 0 ? Math.min(999, Math.round((completed / target) * 100)) : null;
                        const unresolved = !a.moduleId;
                        return (
                          <tr key={a.key} className="hover:bg-blue-50/40">
                            <td className="px-3 py-2 font-medium text-slate-800">
                              <div className="flex flex-col">
                                <span>{a.label}</span>
                                {unresolved && (
                                  <span className="text-[10px] text-rose-600 font-normal">
                                    Module not found: cannot save this row
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                disabled={unresolved}
                                value={targetStr}
                                onChange={(e) =>
                                  setTargetForm((p) => ({ ...p, [a.key]: e.target.value }))
                                }
                                placeholder="0"
                                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                              />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {fmtInt(completed)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {pct == null ? (
                                <span className="text-slate-300">, </span>
                              ) : (
                                <span className={`font-semibold ${pct >= 100 ? "text-emerald-700" : pct >= 60 ? "text-blue-700" : pct >= 30 ? "text-amber-700" : "text-rose-700"}`}>
                                  {pct}%
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </SectionCard>
        </V2FormShell>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || ""}
          onOk={() => {
            setShowSuccessDialog(false);
            navigateAfterSave();
          }}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
