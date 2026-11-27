"use client";

// COPY of GoalTargetSplitPanel for the new Goal Setting (user 2026-10-30): the same Quarterly /
// Month-wise popup and the same rules (the split must total the yearly target, no negatives, whole
// numbers, nothing stored until Save), in the new design, with a Download button for what is open.
// The original panel is not changed. Read-only callers (Super Admin / RI Director / Zone / District
// Assistant) see the same popup without inputs or Save. Districts outside the split pilot see it read
// only too (the API refuses their save anyway).

import { Table } from "@/components/ui/table";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, CalendarDays, Download, Loader2, Save, Check, AlertCircle, X } from "@/components/icons";
import type { GoalMonthlyForm, SaveGoalTargetSplitRequest } from "@/services/api";
import { isGoalSplitPilot } from "@/utils/goalSplitPilot";
import { categoryShortName } from "@/lib/goalRotaryLayout";
import SuccessAlert from "@/components/SuccessAlert";

// Month-wise / Quarterly are READ ONLY for everyone for now (user 2026-10-30, "we decide it later").
// Set to true to give the District / Club Admin the inputs and Save back (the API rules are unchanged).
const SPLIT_EDITING = false;

const MONTH_ORDER = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const MONTH_LABEL: Record<number, string> = {
  7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
  1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
};
const QUARTER_LABEL: Record<number, string> = {
  1: "Q1 · Jul-Sep", 2: "Q2 · Oct-Dec", 3: "Q3 · Jan-Mar", 4: "Q4 · Apr-Jun",
};

type Period = "quarter" | "month";

// Achieved below the period's Target = red, equal = yellow, above = green (same rule as the old
// month-wise popup and the Excel, whole numbers).
function statusClass(target: number | null | undefined, achieved: number | null): string {
  if (achieved === null || target === null || target === undefined) return "text-go-text-primary";
  const t = Math.round(target), a = Math.round(achieved);
  if (a < t) return "bg-go-danger-50 text-go-danger-600 font-bold";
  if (a === t) return "bg-go-warning-50 text-go-warning-600 font-bold";
  return "bg-go-success-50 text-go-success-600 font-bold";
}

export default function GoalTargetSplitPanelRotary({
  form, onSave, readOnly = false, reloadKey, onDownload, noLabel = false,
}: {
  form: GoalMonthlyForm | null;
  onSave?: (body: SaveGoalTargetSplitRequest) => Promise<GoalMonthlyForm>;
  readOnly?: boolean;
  reloadKey?: string;
  // Download = the Goal Setting report (Till Date · Quarter · Month wise), same as the page's Report.
  onDownload?: () => void;
  // Just the two buttons (no "<category> target split:" label) - for a header that names the category.
  noLabel?: boolean;
}) {
  const [open, setOpen] = useState<Period | null>(null);
  const [draft, setDraft] = useState<Record<number, Record<number, number | null>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const rows = useMemo(
    () => (form?.fields ?? []).filter((f) => f.monthlyTracked !== false && f.annualTarget != null),
    [form],
  );
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
    if (v != null && v < 0) return;
    const whole = v == null ? null : Math.trunc(v);
    setDraft((d) => ({ ...d, [fieldId]: { ...(d[fieldId] ?? {}), [slot]: whole } }));
  }

  async function save() {
    if (!open || !onSave) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        yearId: form!.yearId,
        period: open,
        fields: rows.map((f) => ({ fieldId: f.fieldId, values: draft[f.fieldId] ?? {} })),
      });
      setSavedMsg(open === "quarter" ? "Quarterly targets saved successfully." : "Month-wise targets saved successfully.");
      setOpen(null);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not save the split.");
    } finally {
      setSaving(false);
    }
  }

  if (!form || rows.length === 0) return null;
  const catName = categoryShortName(form.categoryId, form.categoryName);
  const canEdit = SPLIT_EDITING && !readOnly && !!onSave && form.isEditable && isGoalSplitPilot(form.clubId, form.districtId);


  const btn = "row-btn row-btn-secondary row-btn-sm";
  return (
    <>
      <SuccessAlert open={!!savedMsg} title="Saved" description={savedMsg ?? ""} onOk={() => setSavedMsg(null)} />
      <div className="flex flex-wrap items-center gap-2">
        {!noLabel && <span className="text-go-label font-bold text-go-text-secondary">{catName} target split:</span>}
        <Button variant="outline" size="sm" type="button" onClick={() => setOpen("quarter")}><CalendarRange size={14} /> Quarterly</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => setOpen("month")}><CalendarDays size={14} /> Month-wise</Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 sm:p-4 overflow-y-auto">
          <div className="bg-go-sunken rounded-go-lg shadow-xl w-full max-w-[1200px] my-2 sm:my-6 overflow-clip">
            <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 bg-go-navy-900 text-white">
              {open === "quarter" ? <CalendarRange size={20} className="text-go-gold-500" /> : <CalendarDays size={20} className="text-go-gold-500" />}
              <div className="min-w-0">
                <h3 className="row-h3 text-go-heading">{open === "quarter" ? "Quarterly" : "Month-wise"}: {catName}
                  <span className="ml-3 text-go-meta font-semibold text-go-navy-50">
                    Auto-calculated by ROW
                  </span>
                </h3>
                <p className="text-go-meta text-go-navy-50">
                  {form.entityName} · RY {form.yearLabel}: the yearly target split{canEdit ? "; change any box, the row must still total the year" : " (read only)"}
                </p>
              </div>
              <span className="flex-1" />
              {onDownload && <Button type="button" onClick={onDownload}
                variant="outline" size="sm">
                <Download size={14} /> Download
              </Button>}
              <IconButton type="button" onClick={() => setOpen(null)}  aria-label="Close">
                <X size={18} />
              </IconButton>
            </div>

            {anySuggested && canEdit && (
              <div className="px-4 sm:px-6 py-2.5 text-go-meta text-go-warning-600 bg-go-warning-50 border-b border-go-border-strong">
                These are a suggested even split of the yearly target: change them however you like
                (0, 1, 10, 1 is fine) as long as each section still totals its yearly target. Nothing is
                stored until you press Save.
              </div>
            )}

            <div className="p-3 sm:p-6 space-y-4">
              {rows.map((f) => {
                const annual = f.annualTarget ?? 0;
                const base = baseOf(f);
                const st = stateOf(f.fieldId, base);
                return (
                  <div key={f.fieldId} className="bg-go-surface rounded-go-lg border border-go-border overflow-hidden">
                    <div className="px-4 sm:px-5 py-3 border-b-[3px] border-go-gold-500 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <h4 className="row-h3 text-go-title text-go-navy-700">{f.groupName || f.fieldLabel}</h4>
                      <span className="text-go-meta text-go-text-secondary">{f.fieldLabel}</span>
                      <span className="sm:ml-auto text-go-meta text-go-text-secondary">
                        Target for the Current year
                        <span className="ml-2 text-go-title font-bold text-go-navy-900 tabular-nums">{annual}</span>
                      </span>
                      {f.baseline != null && (
                        <span className="text-go-meta text-go-text-secondary">
                          To add this year
                          <span className="ml-2 text-go-title font-bold text-go-navy-900 tabular-nums">{base}</span>
                        </span>
                      )}
                      {st.ok ? (
                        <span className="inline-flex items-center gap-1 rounded bg-go-success-50 px-2.5 py-0.5 text-go-meta font-bold text-go-success-600">
                          <Check size={13} /> {st.entered} of {base}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-go-danger-50 px-2.5 py-0.5 text-go-meta font-bold text-go-danger-600">
                          <AlertCircle size={13} /> {st.entered} of {base}
                          <span className="font-medium">({st.negative ? "a target cannot be negative" : st.diff > 0 ? `${st.diff} too much` : `${-st.diff} short`})</span>
                        </span>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <Table bare className="w-full text-go-body border-collapse min-w-max">
                        <thead>
                          <tr>
                            <th className="text-left px-4 sm:px-5 w-28 sm:w-56 sticky left-0 bg-go-sunken border-r border-go-border">&nbsp;</th>
                            {slots.map((s) => (
                              <th key={s} className="text-right px-2 sm:px-3 whitespace-nowrap">{label(s)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {f.baseline != null && (
                            <tr className="border-t border-go-border">
                              <td className="px-4 sm:px-5 py-2.5 text-go-text-secondary sticky left-0 bg-go-surface border-r border-go-border whitespace-nowrap">As on July 1st</td>
                              <td className="px-2 sm:px-3 py-2.5 text-right tabular-nums font-bold text-go-navy-900" colSpan={slots.length}>{f.baseline}</td>
                            </tr>
                          )}
                          <tr className="border-t border-go-border">
                            <td className="px-4 sm:px-5 py-2 font-bold text-go-navy-900 sticky left-0 bg-go-surface border-r border-go-border">Target</td>
                            {slots.map((s) => (
                              <td key={s} className="px-2 py-1.5 text-right">
                                {canEdit ? (
                                  <input
                                    type="number" min={0} step={1} inputMode="numeric"
                                    value={draft[f.fieldId]?.[s] ?? ""}
                                    onChange={(e) => setCell(f.fieldId, s, e.target.value)}
                                    className={`w-16 sm:w-20 h-9 text-right tabular-nums rounded-go-md border px-2 text-go-body font-bold text-go-navy-900 ${st.ok ? "border-go-border-strong" : "border-go-danger-600 bg-go-danger-50"}`}
                                  />
                                ) : (
                                  <span className="tabular-nums font-bold text-go-navy-900">{draft[f.fieldId]?.[s] ?? "–"}</span>
                                )}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-t border-go-border">
                            <td className="px-4 sm:px-5 py-2.5 text-go-text-secondary sticky left-0 bg-go-surface border-r border-go-border">Achieved</td>
                            {slots.map((s) => {
                              const a = achievedAt(f.fieldId, s);
                              return <td key={s} className={`px-2 sm:px-3 py-2.5 text-right tabular-nums ${statusClass(draft[f.fieldId]?.[s] ?? null, a)}`}>{a ?? "–"}</td>;
                            })}
                          </tr>
                          <tr className="border-t border-go-border">
                            <td className="px-4 sm:px-5 py-2.5 text-go-text-secondary sticky left-0 bg-go-surface border-r border-go-border whitespace-nowrap">Percentage Achieved</td>
                            {slots.map((s) => {
                              const a = achievedAt(f.fieldId, s);
                              const t = draft[f.fieldId]?.[s] ?? null;
                              const pct = a != null && t != null && t !== 0 ? Math.round((a / t) * 10000) / 100 : null;
                              return (
                                <td key={s} className="px-2 sm:px-3 py-2.5 text-right tabular-nums font-bold"
                                  style={{ color: pct == null ? "var(--go-text-muted)" : pct > 100 ? "var(--go-success-600)" : pct === 100 ? "var(--go-warning-600)" : "var(--go-danger-600)" }}>
                                  {pct != null ? `${pct}%` : "–"}
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </Table>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sticky bottom-0 z-10 px-4 sm:px-6 py-3.5 bg-go-surface border-t border-go-border shadow-go-card flex flex-wrap items-center gap-2 sm:gap-3">
              {canEdit && (
                <>
                  <Button
                    type="button" onClick={save} disabled={saving || !allMatch}
                    title={allMatch ? undefined : "Every section must total its yearly target before this can be saved"}
>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </Button>
                  <Button type="button" onClick={reset} disabled={saving}
                    variant="outline" size="sm">
                    Reset
                  </Button>
                  {!allMatch && (
                    <span className="w-full sm:w-auto order-last sm:order-none text-go-meta text-go-danger-600">
                      {badRows.map((f) => {
                        const b = baseOf(f); const st = stateOf(f.fieldId, b);
                        const why = st.negative ? "a target cannot be negative" : st.diff > 0 ? `${st.diff} too much` : `${-st.diff} short`;
                        return `${f.groupName || f.fieldLabel}: ${st.entered} of ${b} (${why})`;
                      }).join(" · ")}
                    </span>
                  )}
                  {error && <span className="text-go-meta text-go-danger-600">{error}</span>}
                </>
              )}
              <Button type="button" onClick={() => setOpen(null)}
                variant="outline" size="sm" className="ml-auto">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
