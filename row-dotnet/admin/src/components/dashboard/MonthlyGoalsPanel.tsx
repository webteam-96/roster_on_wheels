"use client";

// Month-wise "collected" goals — a SEPARATE, additive panel (the annual Goal Setting form is
// untouched). You pick a month and enter what was collected that month (re-saving the same month
// overwrites it); the report grid below shows every month + the running Total against the annual
// Target. Reused for district and club via fetchForm/saveForm; read-only for the SuperAdmin overview.

import { useState, useEffect } from "react";
import { isAnnualOnlyCategory } from "@/lib/goalCategories";
import { Loader2, Save, Download } from "lucide-react";
import LoadingButton from "@/components/v2/LoadingButton";
import { getGoalCategories, downloadDistrictMonthlyExcel, downloadClubMonthlyExcel, type GoalMonthlyForm, type SaveGoalMonthlyRequest } from "@/services/api";
import type { GoalCategoryDto } from "@/types/goalSetting";
import { fileTimestamp } from "@/lib/dateUtils";
import { saveAs } from "file-saver";
import { monthlyFieldLabel } from "@/lib/goalCategories";

import SuccessAlert from "@/components/SuccessAlert";
import { appLocale } from "@/lib/appFormat";
const fmt = (v: number | null | undefined, currency: boolean) => {
  if (v == null) return "—";
  // Whole numbers only, everywhere in Goal Setting (user 2026-09-29).
  const s = Number(v).toLocaleString(appLocale(), { maximumFractionDigits: 0 });
  return currency ? `$${s}` : s;
};


export default function MonthlyGoalsPanel({
  fetchForm, saveForm, title = "Month-wise Collection", readOnly = false, reloadKey, activeCategoryId,
}: {
  fetchForm: (categoryId: number) => Promise<GoalMonthlyForm>;
  saveForm?: (categoryId: number, body: SaveGoalMonthlyRequest) => Promise<GoalMonthlyForm>;
  title?: string;
  readOnly?: boolean;
  reloadKey?: string | number | null;
  // When set, the panel is CONTROLLED: it follows this category (driven by a sibling panel)
  // and hides its own category tabs — so there's one category selector, not two.
  activeCategoryId?: number | null;
}) {
  const controlled = activeCategoryId !== undefined;
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [form, setForm] = useState<GoalMonthlyForm | null>(null);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [month, setMonth] = useState<number | null>(null);
  const [buf, setBuf] = useState<Record<number, string>>({});

  useEffect(() => {
    getGoalCategories()
      // Youth Service / Public Image are annual only (user 2026-09-25) - they never appear on a
      // month-wise surface, so the tabs here are Membership and TRF only.
      .then((cs) => {
        const ms = cs.filter((c) => !isAnnualOnlyCategory(c.name));
        setCategories(ms);
        if (ms.length) setActiveCat(controlled ? (activeCategoryId ?? ms[0].id) : ms[0].id);
      })
      .catch(() => setError("Failed to load categories."))
      .finally(() => setLoadingCats(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled mode: follow the parent's category (the top panel's tab selection).
  useEffect(() => { if (controlled && activeCategoryId != null) setActiveCat(activeCategoryId); }, [controlled, activeCategoryId]);

  useEffect(() => {
    if (activeCat == null) return;
    // Annual-only category (Youth Service / Public Image): there is no month-wise
    // form to fetch - the API answers null for it anyway.
    if (annualOnlyActive) return;
    let cancelled = false;
    setLoading(true); setError(null); setSuccess(null);
    fetchForm(activeCat)
      .then((f) => {
        if (cancelled) return;
        setForm(f);
        const avail = f.months.filter((m) => m.isAvailable);
        const dm = avail.length ? avail[avail.length - 1].month : null; // default to latest available month
        setMonth(dm);
        seedBuf(f, dm);
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCat, reloadKey]);

  function seedBuf(f: GoalMonthlyForm, m: number | null) {
    const b: Record<number, string> = {};
    if (m != null) for (const fl of f.fields) { const v = fl.monthly[m]; b[fl.fieldId] = v != null ? String(v) : ""; }
    setBuf(b);
  }
  function onMonthChange(m: number) { setMonth(m); if (form) seedBuf(form, m); setSuccess(null); }

  async function handleSave() {
    if (!form || activeCat == null || month == null || !saveForm) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const entries = form.fields.map((fl) => {
        const t = (buf[fl.fieldId] ?? "").trim();
        return { fieldId: fl.fieldId, numericValue: t === "" ? null : Number(t) };
      });
      const fresh = await saveForm(activeCat, { yearId: form.yearId, month, entries });
      setForm(fresh); seedBuf(fresh, month);
      setSuccess(`Saved for ${fresh.months.find((x) => x.month === month)?.label ?? "month"}.`);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to save.");
    } finally { setSaving(false); }
  }

  const [downloading, setDownloading] = useState(false);
  // Server-built .xlsx with two sheets — "Till Date" (simple summary) + "Month wise".
  async function downloadExcel() {
    if (!form || activeCat == null) return;
    setDownloading(true); setError(null);
    try {
      const blob = form.entityType === "Club"
        ? await downloadClubMonthlyExcel(activeCat, form.yearId, form.clubId)
        : await downloadDistrictMonthlyExcel(activeCat, form.yearId, form.districtId);
      saveAs(blob, `goals-monthwise-${(form.entityName || "").replace(/\s+/g, "-")}-${form.categoryName}-${form.yearLabel}-${fileTimestamp()}.xlsx`);
    } catch {
      setError("Could not download the Excel report.");
    } finally { setDownloading(false); }
  }

  if (loadingCats) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>;
  }
  if (!categories || categories.length === 0) return null;
  // Driven from outside (the read-only oversight viewer) and the parent is showing an annual-only
  // category → there is no month-wise panel for it at all.
  if (activeCat != null && !categories.some((c) => c.id === activeCat)) return null;

  const annualOnlyActive = controlled && activeCategoryId != null && !loadingCats
    && !!categories && !categories.some((c) => c.id === activeCategoryId);
  const canEdit = !readOnly && !!form?.isEditable && !!saveForm;
  const hasFields = !!form && form.fields.length > 0;
  const availableMonths = form?.months.filter((m) => m.isAvailable) ?? [];
  // Membership shows an "As on July 1st" baseline column before the months (clubs/members/women);
  // other categories have no baseline, so the column is hidden for them.
  const showBaseline = !!form && form.fields.some((f) => f.baseline != null);

  // A parent tab strip can select Youth Service or Public Image, and a controlled panel
  // follows it. Those two are NOT collected month-wise (user 2026-09-25), so the whole
  // section disappears rather than rendering an empty month-wise shell (user 2026-09-29).
  // `categories` holds the month-wise ones only, so "not in the list" is the test.
  if (annualOnlyActive) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Saving is confirmed by an alert, like the goal panel and the target-split popups
          (user 2026-09-29) — the old green line beside the button was too easy to miss. */}
      <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
      <div className="px-3 sm:px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{form ? `${form.entityName} · RY ${form.yearLabel}` : ""}</p>
      </div>

      {/* Category tabs — hidden when CONTROLLED (the top panel's tabs drive the category). */}
      {!controlled && (
        <div className="px-3 sm:px-5 pt-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
          {categories.map((c) => (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition ${activeCat === c.id ? "bg-blue-600 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="p-8 flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>}

      {!loading && form && !hasFields && (
        <div className="p-8 text-center text-sm text-slate-400">No month-wise metrics for this tab yet.</div>
      )}

      {!loading && form && hasFields && (
        <div className="p-2.5 sm:p-5 space-y-4 sm:space-y-5 bg-slate-50">
          {/* Entry — one month at a time */}
          {canEdit && (
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex flex-wrap items-end gap-3 mb-3">
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Collect for month
                  <select value={month ?? ""} onChange={(e) => onMonthChange(Number(e.target.value))}
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {availableMonths.map((m) => <option key={m.month} value={m.month}>{m.label} {m.calendarYear}</option>)}
                  </select>
                </label>
                <span className="text-[11px] text-slate-400 pb-2">Saving a month overwrites its previous value.</span>
              </div>
              <div className="divide-y divide-slate-100">
                {form.fields.filter((fl) => fl.monthlyTracked !== false).map((fl) => {
                  const currency = fl.dataType === "Currency";
                  return (
                    <div key={fl.fieldId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 py-2.5">
                      <span className="text-sm text-slate-700">
                        {monthlyFieldLabel(fl)}
                        {fl.annualTarget != null && <span className="text-xs text-slate-400 ml-2">(annual target {fmt(fl.annualTarget, currency)})</span>}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                        {currency && <span className="text-slate-400 text-sm">$</span>}
                        <input type="text" inputMode="decimal" value={buf[fl.fieldId] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^\d.]/g, "");
                            const parts = raw.split(".");
                            setBuf((p) => ({ ...p, [fl.fieldId]: parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw }));
                            setSuccess(null);
                          }}
                          className="w-28 sm:w-36 text-right px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 mt-3">
                {error && <span className="text-xs text-rose-700">{error}</span>}
                <LoadingButton onAction={handleSave} forcePending={saving} loadingLabel="Saving…" spinnerSize={13}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {!saving && <Save size={13} />} Save {form.months.find((x) => x.month === month)?.label ?? ""}
                </LoadingButton>
              </div>
            </div>
          )}
          {!canEdit && error && <p className="text-xs text-rose-700">{error}</p>}

          {/* Month-wise report grid */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 sm:px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">Report</span>
              <button type="button" onClick={downloadExcel} disabled={downloading}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download Excel (Till date + Month wise)
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm border-collapse min-w-max">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="sticky left-0 z-10 bg-slate-50 text-left px-2 sm:px-3 py-2 font-medium min-w-[120px] sm:min-w-[180px] border-b border-r">Particulars</th>
                    {showBaseline && (
                      <th className="text-right px-3 py-2 font-semibold border-b border-r bg-amber-50 whitespace-nowrap">As on Jul 1</th>
                    )}
                    {form.months.map((m) => (
                      <th key={m.month} className={`text-right px-3 py-2 font-medium border-b whitespace-nowrap ${m.isAvailable ? "" : "text-slate-300"}`}>{m.label}</th>
                    ))}
                    <th className="text-right px-3 py-2 font-semibold border-b border-l bg-slate-100 whitespace-nowrap">Gained</th>
                  </tr>
                </thead>
                <tbody>
                  {form.fields.map((fl) => {
                    const currency = fl.dataType === "Currency";
                    const label = monthlyFieldLabel(fl);
                    // Annual-only field: value in the baseline column, months and Gained left empty.
                    if (fl.monthlyTracked === false) {
                      return (
                        <tr key={fl.fieldId} className="border-b border-slate-100 hover:bg-slate-50/60">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-r">{label}</td>
                          {showBaseline && (
                            <td className="text-right px-3 py-2 font-semibold border-r bg-amber-50/60 whitespace-pre-line text-slate-700">{fl.displayText ?? (fl.annualTarget != null ? fmt(fl.annualTarget, currency) : "—")}</td>
                          )}
                          {form.months.map((m) => <td key={m.month} className="px-3 py-2" />)}
                          <td className="text-right px-3 py-2 border-l bg-slate-50" />
                        </tr>
                      );
                    }
                    // Stored values are per-month DELTAS; the grid shows the CUMULATIVE running total
                    // (baseline + additions to date). Future/not-started months stay blank.
                    let run = fl.baseline ?? 0;
                    const cum = form.months.map((m) => {
                      if (!m.isAvailable) return { month: m.month, value: null as number | null };
                      run += fl.monthly[m.month] ?? 0;
                      return { month: m.month, value: run };
                    });
                    return (
                      <tr key={fl.fieldId} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-r">{label}</td>
                        {showBaseline && (
                          <td className="text-right px-3 py-2 font-semibold border-r bg-amber-50/60 whitespace-nowrap text-slate-700">{fl.baseline != null ? fmt(fl.baseline, currency) : "—"}</td>
                        )}
                        {cum.map((cm) => (
                          <td key={cm.month} className="text-right px-3 py-2 whitespace-nowrap text-slate-600">{cm.value != null ? fmt(cm.value, currency) : ""}</td>
                        ))}
                        <td className="text-right px-3 py-2 font-semibold border-l bg-slate-50 whitespace-nowrap">{fmt(fl.total, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
