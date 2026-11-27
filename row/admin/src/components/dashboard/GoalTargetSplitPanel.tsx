"use client";

// Quarterly / Month-wise TARGETS (user 2026-09-25).
//
// Two buttons sit under the category tabs — Quarterly and Month-wise — and each opens a POPUP laid
// out exactly like the year-wise Goal Setting screen: one section per metric group (New Clubs, Total
// Members, Women Membership …), each showing
//
//     Total … as on July 1st      (read-only, same figure as the yearly screen)
//     Target                      (EDITABLE — one box per quarter, or per month)
//     Achieved                    (read-only, what happened in that period)
//     Percentage Achieved         (read-only, achieved ÷ that period's target)
//
// The YEARLY target is never touched here. It is shown as the figure the split must add up to, and
// the save is refused unless it does — no less, no more. Any distribution is allowed: 3/3/3/3,
// 0/1/10/1, even 12/0/0/0. The popup opens on an even split purely so nobody faces empty boxes.
//
// Only Membership and TRF reach this at all; Youth Service and Public Image are annual only, so the
// form comes back empty and the buttons never render. Only Club/District Admin may edit — a
// read-only caller passes readOnly and gets the same popup without inputs or a Save button.

import { Table } from "@/components/ui/table";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, CalendarDays, Loader2, Save, Check, AlertCircle, X } from "@/components/icons";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import { isGoalSplitPilot } from "@/utils/goalSplitPilot";
import SuccessAlert from "@/components/SuccessAlert";

const MONTH_ORDER = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const MONTH_LABEL: Record<number, string> = {
  7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
  1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
};
const QUARTER_LABEL: Record<number, string> = {
  1: "Q1 · Jul-Sep", 2: "Q2 · Oct-Dec", 3: "Q3 · Jan-Mar", 4: "Q4 · Apr-Jun",
};

type Period = "quarter" | "month";

export default function GoalTargetSplitPanel({
  form, onSave, readOnly = false, reloadKey,
}: {
  form: GoalMonthlyForm | null;
  onSave: (body: SaveGoalTargetSplitRequest) => Promise<GoalMonthlyForm>;
  readOnly?: boolean;
  reloadKey?: string;
}) {
  const [open, setOpen] = useState<Period | null>(null);
  const [draft, setDraft] = useState<Record<number, Record<number, number | null>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A save is confirmed by an alert the user must dismiss, not a small green line that is
  // easy to miss (user 2026-09-29). The popup closes at the same moment.
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Only metrics tracked across the year AND carrying a yearly target to split.
  const rows = useMemo(
    () => (form?.fields ?? []).filter((f) => f.monthlyTracked !== false && f.annualTarget != null),
    [form],
  );
  // What each section must total. For Membership the yearly target is the YEAR-END figure and the
  // club/district already holds `baseline`, so the thing being split is the GROWTH — 104 clubs today,
  // 108 wanted, so 4 to add. TRF starts from zero, so its target IS the growth.
  const baseOf = (f: (typeof rows)[number]) =>
    f.splitBase ?? ((f.annualTarget ?? 0) - (f.baseline ?? 0));
  const slots = open === "month" ? MONTH_ORDER : [1, 2, 3, 4];
  const label = (s: number) => (open === "month" ? MONTH_LABEL[s] : QUARTER_LABEL[s]);

  const reset = useCallback(() => {
    if (!open) return;
    const next: Record<number, Record<number, number | null>> = {};
    for (const f of rows) {
      const src = open === "month" ? (f.monthlyTargets ?? {}) : (f.quarterlyTargets ?? {});
      next[f.fieldId] = Object.fromEntries(slots.map((s) => [s, src[s] ?? null]));
    }
    setDraft(next);
    setError(null);
  }, [rows, open, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reset(); }, [reset]);

  const achievedAt = (fieldId: number, slot: number) => {
    const f = rows.find((x) => x.fieldId === fieldId);
    if (!f) return null;
    if (open === "month") return f.monthly?.[slot] ?? null;
    return f.quarterlyAchieved?.[slot] ?? null;
  };

  const sumOf = (fieldId: number) => slots.reduce((t, s) => t + (draft[fieldId]?.[s] ?? 0), 0);
  // Re-evaluated on EVERY keystroke, so the row turns red the moment it stops matching.
  // A target of 0 is fine - a club may plan nothing this quarter and everything next. A NEGATIVE
  // one is not: it would mean planning to LOSE members, and since only the SUM was checked,
  // -40/40/40/4 balanced exactly like 11/11/11/11 and saved happily (user 2026-09-29). It then
  // poisoned the percentage, which divides by this target.
  const hasNegative = (fieldId: number) => slots.some((s) => (draft[fieldId]?.[s] ?? 0) < 0);
  const stateOf = (fieldId: number, base: number) => {
    const entered = sumOf(fieldId);
    const diff = Math.round((entered - base) * 100) / 100;
    const negative = hasNegative(fieldId);
    return { entered, diff, negative, ok: diff === 0 && !negative };
  };
  const allMatch = rows.every((f) => stateOf(f.fieldId, baseOf(f)).ok);
  const badRows = rows.filter((f) => !stateOf(f.fieldId, baseOf(f)).ok);
  const anySuggested = rows.some((f) => f.targetsAreSuggested);

  function setCell(fieldId: number, slot: number, raw: string) {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v != null && Number.isNaN(v)) return;
    if (v != null && v < 0) return;   // a minus never lands in the box (zero is allowed)
    // Whole numbers only, money included (user 2026-09-29): a typed decimal is cut, not stored,
    // so what the box shows is exactly what the split will total.
    const whole = v == null ? null : Math.trunc(v);
    setDraft((d) => ({ ...d, [fieldId]: { ...(d[fieldId] ?? {}), [slot]: whole } }));
  }

  async function save() {
    if (!open) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        yearId: form!.yearId,
        period: open,
        fields: rows.map((f) => ({ fieldId: f.fieldId, values: draft[f.fieldId] ?? {} })),
      });
      setSavedMsg(open === "quarter"
        ? "Quarterly targets saved successfully."
        : "Month-wise targets saved successfully.");
      setOpen(null);   // close the popup on success
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not save the split.");
    } finally {
      setSaving(false);
    }
  }

  if (!form || rows.length === 0) return null;
  // Pilot (user 2026-09-25): only District 5656 and Thane City View while this is being tested. The
  // API refuses a save from anyone else too, so hiding the buttons is not the only guard.
  if (!isGoalSplitPilot(form.clubId, form.districtId)) return null;
  const canEdit = !readOnly && form.isEditable;

  return (
    <>
      <SuccessAlert
        open={!!savedMsg}
        title="Saved"
        description={savedMsg ?? ""}
        onOk={() => setSavedMsg(null)}
      />
      {/* The two buttons, sitting under the category tabs. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Target split:</span>
        <Button
          onClick={() => setOpen("quarter")}
          variant="outline" size="sm"
        >
          <CalendarRange size={13} /> Quarterly
        </Button>
        <Button
          onClick={() => setOpen("month")}
          variant="outline" size="sm"
        >
          <CalendarDays size={13} /> Month-wise
        </Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 sm:p-4 overflow-y-auto">
          <div className="bg-slate-50 rounded-2xl shadow-xl w-full max-w-[1200px] my-2 sm:my-6">
            {/* ── header ── */}
            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 bg-card rounded-t-2xl border-b border-slate-200">
              {open === "quarter" ? <CalendarRange size={18} className="text-blue-600" /> : <CalendarDays size={18} className="text-blue-600" />}
              <div>
                <h3 className="row-h3">
                  {open === "quarter" ? "Quarterly" : "Month-wise"}: {form.categoryName}
                </h3>
                <p className="text-xs text-slate-500">
                  {form.entityName} · RY {form.yearLabel}: the yearly target split{canEdit ? "; change any box, the row must still total the year" : " (read only)"}
                </p>
              </div>
              <IconButton onClick={() => setOpen(null)} className="ml-auto" aria-label="Close">
                <X size={18} />
              </IconButton>
            </div>

            {anySuggested && canEdit && (
              <div className="px-3 sm:px-6 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
                These are a suggested even split of the yearly target: change them however you like
                (0, 1, 10, 1 is fine) as long as each section still totals its yearly target. Nothing is
                stored until you press Save.
              </div>
            )}

            {/* ── one section per metric, laid out like the year-wise screen ── */}
            <div className="p-2.5 sm:p-6 space-y-4 sm:space-y-5">
              {rows.map((f) => {
                const annual = f.annualTarget ?? 0;
                const base = baseOf(f);
                const st = stateOf(f.fieldId, base);
                return (
                  <Card key={f.fieldId} className="overflow-hidden">
                    <div className="px-3 sm:px-5 py-2.5 sm:py-3 border-b-2 border-amber-300 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <h4 className="row-h3">{f.groupName || f.fieldLabel}</h4>
                      <span className="text-xs text-slate-500">{f.fieldLabel}</span>
                      <span className="sm:ml-auto text-xs text-slate-500">
                        Target for the Current year
                        <span className="ml-2 text-sm font-bold text-slate-900 tabular-nums">{annual}</span>
                      </span>
                      {f.baseline != null && (
                        <span className="text-xs text-slate-500">
                          To add this year
                          <span className="ml-2 text-sm font-bold text-slate-900 tabular-nums">{base}</span>
                        </span>
                      )}
                      {st.ok ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <Check size={13} /> {st.entered} of {base}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                          <AlertCircle size={13} /> {st.entered} of {base}
                          <span className="font-medium">({st.negative ? "a target cannot be negative" : st.diff > 0 ? `${st.diff} too much` : `${-st.diff} short`})</span>
                        </span>
                      )}
                    </div>

                    <div className="overflow-x-auto -mx-px">
                      <Table bare className="w-full text-sm border-collapse min-w-max">
                        <thead>
                          <tr>
                            <th className="text-left px-3 sm:px-5 w-28 sm:w-64 sticky left-0 border-r border-slate-200">&nbsp;</th>
                            {slots.map((s) => (
                              <th key={s} className="text-right px-2 sm:px-3 whitespace-nowrap">{label(s)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {/* Baseline — the same "as on July 1st" figure the yearly screen shows. */}
                          {f.baseline != null && (
                            <tr className="border-t border-slate-100">
                              <td className="px-3 sm:px-5 py-2.5 text-slate-600 sticky left-0 bg-card border-r border-slate-100 whitespace-nowrap">As on July 1st</td>
                              <td className="px-2 sm:px-3 py-2.5 text-right tabular-nums text-slate-500" colSpan={slots.length}>
                                {f.baseline}
                              </td>
                            </tr>
                          )}

                          {/* Target — the only editable row. */}
                          <tr className="border-t border-slate-100">
                            <td className="px-3 sm:px-5 py-2 text-slate-700 font-medium sticky left-0 bg-card border-r border-slate-100">Target</td>
                            {slots.map((s) => (
                              <td key={s} className="px-2 py-1.5 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  inputMode="numeric"
                                  disabled={!canEdit}
                                  value={draft[f.fieldId]?.[s] ?? ""}
                                  onChange={(e) => setCell(f.fieldId, s, e.target.value)}
                                  className={`w-16 sm:w-20 text-right tabular-nums rounded-md border px-1.5 sm:px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500 ${st.ok ? "border-slate-200" : "border-red-300 bg-red-50/40"}`}
                                />
                              </td>
                            ))}
                          </tr>

                          <tr className="border-t border-slate-100">
                            <td className="px-3 sm:px-5 py-2.5 text-slate-600 sticky left-0 bg-card border-r border-slate-100">Achieved</td>
                            {slots.map((s) => {
                              const a = achievedAt(f.fieldId, s);
                              return <td key={s} className="px-2 sm:px-3 py-2.5 text-right tabular-nums text-slate-700">{a ?? "–"}</td>;
                            })}
                          </tr>

                          <tr className="border-t border-slate-100">
                            <td className="px-3 sm:px-5 py-2.5 text-slate-600 sticky left-0 bg-card border-r border-slate-100 whitespace-nowrap">Percentage Achieved</td>
                            {slots.map((s) => {
                              const a = achievedAt(f.fieldId, s);
                              const t = draft[f.fieldId]?.[s] ?? null;
                              // No cap (upstream 2026-10-16, replaces the 2026-09-25 cap): 24 of 12 = 200%.
                              const pct = a != null && t != null && t !== 0
                                ? Math.round((a / t) * 10000) / 100
                                : null;
                              return (
                                <td key={s} className="px-2 sm:px-3 py-2.5 text-right tabular-nums text-slate-700">
                                  {pct != null ? `${pct}%` : "–"}
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </Table>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* ── footer ── */}
            <div className="px-3 sm:px-6 py-3 sm:py-4 bg-card rounded-b-2xl border-t border-slate-200 flex flex-wrap items-center gap-2 sm:gap-3">
              {canEdit && (
                <>
                  <Button
                    onClick={save}
                    disabled={saving || !allMatch}
                    title={allMatch ? undefined : "Every section must total its yearly target before this can be saved"}
                    size="sm"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </Button>
                  <Button
                    onClick={reset}
                    disabled={saving}
                    variant="outline" size="sm"
                  >
                    Reset
                  </Button>
                  {!allMatch && (
                    <span className="w-full sm:w-auto order-last sm:order-none text-xs text-red-600">
                      {badRows.map((f) => {
                        const b = baseOf(f); const st = stateOf(f.fieldId, b);
                        const why = st.negative ? "a target cannot be negative" : st.diff > 0 ? `${st.diff} too much` : `${-st.diff} short`;
                        return `${f.groupName || f.fieldLabel}: ${st.entered} of ${b} (${why})`;
                      }).join(" · ")}
                    </span>
                  )}
                  {error && <span className="text-xs text-red-600">{error}</span>}
                </>
              )}
              <Button
                onClick={() => setOpen(null)}
                variant="outline" size="sm" className="ml-auto"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
