"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Target, Save, Trash2, Lock, Loader2, Pencil, Plus, CheckCircle2,
} from "@/components/icons";
import {
  getFoundationGoalsList, saveFoundationGoal, deleteFoundationGoal,
} from "@/services/api";
import LoadingButton from "@/components/v2/LoadingButton";
import type {
  FoundationGoalListResponse, FoundationGoalDto, FoundationGoalYearRow,
} from "@/types/clubAdminDashboard";

import { currencySymbol } from "@/lib/appFormat";
type FormState = {
  apf: string;
  polio: string;
  endowment: string;
  other: string;
  remarks: string;
};

const EMPTY_FORM: FormState = { apf: "", polio: "", endowment: "", other: "", remarks: "" };

function formatUsd(value: number, currency: string = "USD"): string {
  if (!isFinite(value) || value <= 0) return currency === "USD" ? "$0" : `${currency} 0`;
  const symbol = currencySymbol(currency);
  return `${symbol}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(/[,\s]/g, ""));
  return isFinite(n) && n >= 0 ? n : 0;
}

function fromGoal(g: FoundationGoalDto | null | undefined): FormState {
  if (!g) return EMPTY_FORM;
  return {
    apf:       g.apfGoal > 0 ? String(g.apfGoal) : "",
    polio:     g.polioPlusGoal > 0 ? String(g.polioPlusGoal) : "",
    endowment: g.endowmentFundGoal > 0 ? String(g.endowmentFundGoal) : "",
    other:     g.otherGoal > 0 ? String(g.otherGoal) : "",
    remarks:   g.remarks ?? "",
  };
}

export default function FoundationGoalsCard() {
  const [data, setData] = useState<FoundationGoalListResponse | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getFoundationGoalsList(null)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const yr = d.currentSelection?.yearId ?? d.years.find((y) => y.isCurrent)?.yearId ?? d.years[0]?.yearId ?? null;
        setSelectedYearId(yr);
        setForm(fromGoal(d.currentSelection));
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load foundation goals."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Year switch → re-fetch the selected year's goal so the form populates.
  useEffect(() => {
    if (selectedYearId == null || data == null) return;
    let cancelled = false;
    setError(null);
    getFoundationGoalsList(selectedYearId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setForm(fromGoal(d.currentSelection));
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load goal."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId]);

  const selection = data?.currentSelection ?? null;
  const isEditable = !!selection?.isEditable;
  const yearLabel  = selection?.yearLabel || "–";

  const totalGoal = useMemo(() => {
    return toNumber(form.apf) + toNumber(form.polio) + toNumber(form.endowment) + toNumber(form.other);
  }, [form]);

  function onChange<K extends keyof FormState>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
    setSuccess(null);
  }

  async function handleSave() {
    if (!data || selectedYearId == null) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      await saveFoundationGoal({
        yearId: selectedYearId,
        apfGoal: toNumber(form.apf),
        polioPlusGoal: toNumber(form.polio),
        endowmentFundGoal: toNumber(form.endowment),
        otherGoal: toNumber(form.other),
        currency: selection?.currency ?? "USD",
        remarks: form.remarks || null,
      });
      // Refresh selection so updatedDate/UpdatedBy refresh
      const fresh = await getFoundationGoalsList(selectedYearId);
      setData(fresh);
      setForm(fromGoal(fresh.currentSelection));
      setSuccess("Goal saved successfully.");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to save goal.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (selectedYearId == null) return;
    if (!confirm(`Delete the Foundation goal for ${yearLabel}?`)) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      await deleteFoundationGoal(selectedYearId);
      const fresh = await getFoundationGoalsList(selectedYearId);
      setData(fresh);
      setForm(fromGoal(fresh.currentSelection));
      setSuccess("Goal deleted.");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to delete goal.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading Foundation Goals…
      </div>
    );
  }
  if (!data) return null;

  const currency = selection?.currency ?? "USD";
  const symbol   = currencySymbol(currency);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-blue-50">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Target size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Set Foundation Collection Goals</h3>
              <p className="text-xs text-slate-500">One goal per Rotary year · {data.clubName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedYearId ?? ""}
              onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {data.years.length === 0 && <option value="">No years</option>}
              {data.years.map((y) => (
                <option key={y.yearId} value={y.yearId}>
                  {y.yearLabel}
                  {y.isCurrent ? " · current" : ""}
                  {!y.isEditable ? " · past" : ""}
                </option>
              ))}
            </select>
            {!isEditable && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                <Lock size={11} /> Read only · Past year
              </span>
            )}
            {isEditable && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Pencil size={11} /> Editable
              </span>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <GoalField
            label="APF Goal"
            sublabel="Annual Programs Fund"
            symbol={symbol}
            value={form.apf}
            disabled={!isEditable || saving}
            onChange={(v) => onChange("apf", v)}
            color="blue"
          />
          <GoalField
            label="Polio Plus"
            sublabel="Polio eradication"
            symbol={symbol}
            value={form.polio}
            disabled={!isEditable || saving}
            onChange={(v) => onChange("polio", v)}
            color="purple"
          />
          <GoalField
            label="Endowment Fund"
            sublabel="Long-term giving"
            symbol={symbol}
            value={form.endowment}
            disabled={!isEditable || saving}
            onChange={(v) => onChange("endowment", v)}
            color="amber"
          />
          <GoalField
            label="Other Contributions"
            sublabel="CSR / Disaster / etc."
            symbol={symbol}
            value={form.other}
            disabled={!isEditable || saving}
            onChange={(v) => onChange("other", v)}
            color="emerald"
          />
        </div>

        <div className="px-5 pb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Remarks (optional)</label>
          <textarea
            rows={2}
            value={form.remarks}
            disabled={!isEditable || saving}
            onChange={(e) => onChange("remarks", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:cursor-not-allowed"
            placeholder={isEditable ? "Add context for this goal…" : "No remarks recorded."}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50">
          <div className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">Total goal: </span>
            <span className="font-semibold text-blue-700">{formatUsd(totalGoal, currency)}</span>
            {selection?.updatedDate && (
              <span className="ml-3">
                Last updated {selection.updatedDate}{selection.updatedBy ? ` by ${selection.updatedBy}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-rose-700">{error}</span>}
            {success && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 size={13} /> {success}
              </span>
            )}
            {isEditable && selection?.goalId != null && (
              <LoadingButton
                onAction={handleDelete}
                forcePending={saving}
                spinnerSize={13}
                className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {!saving && <Trash2 size={13} />} Delete
              </LoadingButton>
            )}
            {isEditable && (
              <LoadingButton
                onAction={handleSave}
                forcePending={saving}
                loadingLabel="Saving…"
                spinnerSize={13}
                className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {selection?.goalId == null ? <Plus size={13} /> : <Save size={13} />}
                {selection?.goalId == null ? "Activate Goal" : "Save Goal"}
              </LoadingButton>
            )}
          </div>
        </div>
      </div>

      {/* Past goals — read-only */}
      {data.pastGoals.length > 0 && (
        <PastGoalsList past={data.pastGoals} years={data.years} onSelect={setSelectedYearId} />
      )}
    </div>
  );
}

function GoalField({
  label, sublabel, symbol, value, disabled, onChange, color,
}: {
  label: string;
  sublabel: string;
  symbol: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  color: "blue" | "purple" | "amber" | "emerald";
}) {
  const ring = {
    blue:    "focus:ring-blue-500",
    purple:  "focus:ring-purple-500",
    amber:   "focus:ring-amber-500",
    emerald: "focus:ring-emerald-500",
  }[color];
  const dot = {
    blue:    "bg-blue-500",
    purple:  "bg-purple-500",
    amber:   "bg-amber-500",
    emerald: "bg-emerald-500",
  }[color];

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <label className="text-xs font-semibold text-slate-700">{label}</label>
      </div>
      <p className="text-[10px] text-slate-400 mb-1">{sublabel}</p>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{symbol}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            // Allow digits + single decimal point
            const v = e.target.value.replace(/[^\d.]/g, "");
            const parts = v.split(".");
            const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : v;
            onChange(cleaned);
          }}
          className={`w-full pl-7 pr-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 ${ring} disabled:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-500`}
          placeholder="0"
        />
      </div>
    </div>
  );
}

function PastGoalsList({
  past, years, onSelect,
}: {
  past: FoundationGoalDto[];
  years: FoundationGoalYearRow[];
  onSelect: (yearId: number) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">Past Year Goals (Read Only)</h3>
        <p className="text-xs text-slate-500">Historical foundation collection targets</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {past.map((g) => {
          const sym = currencySymbol(g.currency);
          const total = g.apfGoal + g.polioPlusGoal + g.endowmentFundGoal + g.otherGoal;
          const yearRow = years.find((y) => y.yearId === g.yearId);
          return (
            <button
              key={g.yearId}
              onClick={() => onSelect(g.yearId)}
              className="text-left rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50/30 transition"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-800">RY {g.yearLabel}</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  <Lock size={9} /> Read only
                </span>
              </div>
              <p className="text-base font-bold text-blue-700">{sym}{total.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
              <p className="text-[10px] text-slate-500 mb-2">Total goal · {yearRow?.isCurrent ? "current" : "past year"}</p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                <dt className="text-slate-500">APF</dt>
                <dd className="text-right tabular-nums text-slate-700">{sym}{g.apfGoal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
                <dt className="text-slate-500">Polio Plus</dt>
                <dd className="text-right tabular-nums text-slate-700">{sym}{g.polioPlusGoal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
                <dt className="text-slate-500">Endowment</dt>
                <dd className="text-right tabular-nums text-slate-700">{sym}{g.endowmentFundGoal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
                <dt className="text-slate-500">Other</dt>
                <dd className="text-right tabular-nums text-slate-700">{sym}{g.otherGoal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
              </dl>
            </button>
          );
        })}
      </div>
    </div>
  );
}
