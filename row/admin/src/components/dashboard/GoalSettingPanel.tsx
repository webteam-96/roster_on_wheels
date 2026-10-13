"use client";

// Generic Goal Setting form — one reusable panel driven entirely by goal_fields
// metadata (DataType/FieldRole), used for both the Club Admin's own goals and
// the District Admin's own goals (and, read-only, a District Admin drilling
// into one club). Callers supply fetchForm/saveForm bound to the right
// club/district endpoint + id — this component has no opinion on entity type.

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Save, Lock, LockOpen, Info, Plus, Trash2, ExternalLink, Globe, Link2 } from "lucide-react";
import LoadingButton from "@/components/v2/LoadingButton";
import { getGoalCategories, getClubWebsiteStatus, getClubSocialLinks } from "@/services/api";
import type { ClubSocialLink } from "@/types/socialLink";
import type {
  GoalCategoryDto, GoalCategoryFormDto, GoalFieldWithValueDto, GoalEntrySaveDto, SaveGoalEntriesRequest, GoalLockStatusDto,
} from "@/types/goalSetting";
import SuccessAlert from "@/components/SuccessAlert";

import { appLocale } from "@/lib/appFormat";
type FieldBuffer = { text: string; bool: boolean };

// Achieved-this-year fields now render as their OWN read-only row (e.g. "Achieved New Clubs"),
// so nothing is folded into a target label. Kept as an (empty) map for the grouping helper below.
const ACHIEVED_OF: Record<string, string> = {};

// Same list as SystemFilledFieldKeys in GoalSettingService.cs - the API ignores these on save.
// Reference fields the SYSTEM fills automatically — Membership from live DB counts (injected in
// GoalSettingService), Foundation from the SuperAdmin cumulative Excel import. These stay read-only.
// Every OTHER Reference field has NO data source (e.g. all Youth "Existing" counts), so the
// district/club admin must type it — those are editable. Computed fields are always read-only.
const SYSTEM_FILLED_REFERENCE = new Set<string>([
  // Membership — injected live in GoalSettingService (LoadFieldsWithValuesAsync auto-fill).
  "total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved",
  "existing_women_members", "new_women_members_achieved",
  "rag_red", "rag_amber", "rag_green", "rag_super_green",
  // Foundation (district) — the 10 "Achieved" values are populated by the SuperAdmin district Excel
  // import (read-only for district admins; they only set the Targets). Total Contributions is Computed.
  "aks_achieved", "endowment_achieved", "bequest_achieved", "directed_gift_achieved",
  "polio_plus_achieved", "annual_fund_achieved", "phf_achieved", "phsm_achieved",
  "major_donors_achieved", "csr_achieved",
  // Total Giving: Achieved = the four funds, % worked out from it - locked since 2026-10-06.
  "total_giving_achieved", "total_giving_pct",
  // Foundation (club) — the 5 contribution figures come from the MCR import (read-only). The club
  // admin edits only Goal Amount (Target) and Goal % Achieved, so those two are NOT listed here.
  "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd",
  "club_other_funds_ytd", "club_endowment_ytd", "club_total_ytd",
  // Youth Service -> Rotaract / Interact "Clubs Achieved" come from the Rotary.org file import (2026-10-08).
  // They are Target-role fields, so the check in isFieldEditable runs before the role test.
  "rotaract_clubs_achieved", "interact_clubs_achieved",
]);

// District form only: "Existing Rotaract / Interact Clubs as on July 1st" come from the Rotary.org
// files (2026-10-08); the club form still types its own. Rotaractors (July 1st + Achieved) come from
// the same Rotaract file (2026-10-09).
const DISTRICT_SYSTEM_FILLED = new Set<string>(["rotaract_existing_clubs", "interact_existing_clubs",
  "rotaract_existing_members", "rotaract_members_achieved"]);

// A field is user-editable when it's a Target, or a Reference that the system does NOT auto-fill.
function isFieldEditable(f: GoalFieldWithValueDto, isDistrict = false): boolean {
  if (SYSTEM_FILLED_REFERENCE.has(f.fieldKey)) return false;
  if (isDistrict && DISTRICT_SYSTEM_FILLED.has(f.fieldKey)) return false;
  if (f.fieldRole === "Target") return true;
  if (f.fieldRole === "Reference") return !SYSTEM_FILLED_REFERENCE.has(f.fieldKey);
  return false; // Computed — always derived, never typed
}

// "Percentage Achievement" fields are Computed on the SERVER, so until now they only refreshed after
// Save — typing a Target left the old % on screen (user request 2026-09-16: calculate on key press).
// The same formulas run here on every keystroke. They mirror GoalSettingService.LoadFieldsWithValuesAsync
// exactly, so the live figure and the figure that comes back from Save always agree.
//   "ratio"    → Achieved ÷ Target × 100                                    (TRF — no July-1st baseline)
//   "growth"   → (Achieved − Baseline) ÷ (Target − Baseline) × 100          (Membership — Achieved includes the baseline)
//   "newAdded" → (Achieved − Baseline) ÷ Target × 100                       (Youth — Target is already just the NEW ones)
// "growth"/"newAdded" are floored at 0 and capped at 100, like the server.
type PctRule = { pct: string; target: string; achieved: string; baseline: string; mode: "ratio" | "growth" | "newAdded" | "ratioWhole" };
const PCT_RULES: PctRule[] = [
  // Membership (district + club)
  { pct: "clubs_percentage_achievement", target: "new_clubs",         achieved: "new_clubs_achieved",         baseline: "total_clubs",            mode: "growth" },
  { pct: "percentage_increase",          target: "new_members",       achieved: "new_members_achieved",       baseline: "total_members",          mode: "growth" },
  { pct: "women_percentage_achievement", target: "new_women_members", achieved: "new_women_members_achieved", baseline: "existing_women_members", mode: "growth" },
  // TRF (district). Total Giving % is locked since 2026-10-06; the server caps it at 0-100 and keeps
  // 2 decimals like every TRF % (2026-10-07) ("ratioWhole" = capped), and Achieved is the four funds added up.
  { pct: "annual_fund_pct", target: "annual_fund_target", achieved: "annual_fund_achieved", baseline: "", mode: "ratio" },
  { pct: "polio_plus_pct",  target: "polio_plus_target",  achieved: "polio_plus_achieved",  baseline: "", mode: "ratio" },
  { pct: "endowment_pct",   target: "endowment_target",   achieved: "endowment_achieved",   baseline: "", mode: "ratio" },
  { pct: "csr_pct",         target: "csr_target",         achieved: "csr_achieved",         baseline: "", mode: "ratio" },
  { pct: "total_giving_pct", target: "total_contributions_target", achieved: "total_giving_achieved", baseline: "", mode: "ratioWhole" },
  // Youth Service (district) — both the "Proposed New …" and the typed "Clubs Achieved" drive these.
  { pct: "rotaract_clubs_pct",   target: "rotaract_new_clubs_target",   achieved: "rotaract_clubs_achieved",   baseline: "rotaract_existing_clubs",   mode: "newAdded" },
  { pct: "rotaract_members_pct", target: "rotaract_new_members_target", achieved: "rotaract_members_achieved", baseline: "rotaract_existing_members", mode: "newAdded" },
  { pct: "interact_clubs_pct",   target: "interact_new_clubs_target",   achieved: "interact_clubs_achieved",   baseline: "interact_existing_clubs",   mode: "newAdded" },
  { pct: "rcc_clubs_pct",        target: "rcc_new_clubs_target",        achieved: "rcc_clubs_achieved",        baseline: "rcc_existing_clubs",        mode: "newAdded" },
];

// Live % per Computed field id, from whatever is typed in the boxes right now.
function livePercentages(fields: GoalFieldWithValueDto[], buffers: Record<number, FieldBuffer>): Record<number, string> {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f] as const));
  // What the user currently sees in a field: the typed buffer when it has one, else the saved value.
  const num = (key: string): number => {
    const f = byKey.get(key);
    if (!f) return 0;
    const typed = (buffers[f.fieldId]?.text ?? "").trim();
    if (typed !== "") { const n = Number(typed); return Number.isFinite(n) ? n : 0; }
    return f.numericValue != null ? Number(f.numericValue) : 0;
  };
  const out: Record<number, string> = {};
  for (const r of PCT_RULES) {
    const pctField = byKey.get(r.pct);
    if (!pctField) continue;
    const tgt = num(r.target);
    const ach = num(r.achieved);
    let pct: number;
    if (r.mode === "ratio") {
      pct = tgt > 0 ? (ach / tgt) * 100 : 0;
    } else if (r.mode === "ratioWhole") {
      pct = tgt > 0 ? Math.max(0, Math.min(100, (ach / tgt) * 100)) : 0;
    } else if (r.mode === "growth") {
      const base = num(r.baseline);
      const planned = tgt - base;
      // Target 0 = "no target set" → 0%. Target = baseline (a real target, no planned growth) → 100% once met.
      pct = planned > 0 ? ((ach - base) / planned) * 100 : (tgt > 0 && ach >= tgt ? 100 : 0);
      pct = Math.max(0, Math.min(100, pct));
    } else {
      const base = num(r.baseline);
      pct = tgt > 0 ? Math.max(0, Math.min(100, ((ach - base) / tgt) * 100)) : 0;
    }
    out[pctField.fieldId] = String(Math.round(pct * 100) / 100);
  }
  return out;
}

function fromFields(fields: GoalFieldWithValueDto[]): Record<number, FieldBuffer> {
  const out: Record<number, FieldBuffer> = {};
  for (const f of fields) {
    const text = f.dataType === "Text"
      ? (f.textValue ?? "")
      : (f.numericValue != null ? String(f.numericValue) : "");
    out[f.fieldId] = { text, bool: !!f.boolValue };
  }
  return out;
}

export default function GoalSettingPanel({
  fetchForm,
  saveForm,
  lockToggle,
  title = "Goal Setting",
  readOnly = false,
  subtitle,
  initialCategoryId,
  onFormLoaded,
  onCategoryChange,
  reloadKey,
  belowCategories,
}: {
  fetchForm: (categoryId: number) => Promise<GoalCategoryFormDto>;
  saveForm?: (categoryId: number, body: SaveGoalEntriesRequest) => Promise<GoalCategoryFormDto>;
  lockToggle?: (categoryId: number, yearId: number, locked: boolean) => Promise<GoalLockStatusDto>;
  title?: string;
  readOnly?: boolean;
  subtitle?: string;
  initialCategoryId?: number | null;
  onFormLoaded?: (form: GoalCategoryFormDto) => void;
  // Fires whenever the active category tab changes — lets a parent sync another panel
  // (e.g. the month-wise panel) to the same category so there's one selector, not two.
  onCategoryChange?: (categoryId: number) => void;
  // Changing this re-fetches the current category — used to reload when the
  // selected rotary year changes (fetchForm closes over the new year).
  reloadKey?: string | number | null;
  // Rendered directly UNDER the category tabs (user 2026-09-25) — the Quarterly / Month-wise
  // target-split buttons live here so they sit with the category they belong to.
  belowCategories?: ReactNode;
}) {
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(initialCategoryId ?? null);
  const [form, setForm] = useState<GoalCategoryFormDto | null>(null);
  const [buffers, setBuffers] = useState<Record<number, FieldBuffer>>({});
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoalCategories()
      .then((cats) => {
        if (cancelled) return;
        setCategories(cats);
        if (cats.length > 0) {
          const initial = initialCategoryId != null && cats.some((c) => c.id === initialCategoryId)
            ? initialCategoryId
            : cats[0].id;
          setActiveCategoryId(initial);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load categories."); })
      .finally(() => { if (!cancelled) setLoadingCategories(false); });
    return () => { cancelled = true; };
  }, []);

  // Report the active category up so a parent can sync a sibling panel (month-wise) to it.
  useEffect(() => { if (activeCategoryId != null) onCategoryChange?.(activeCategoryId); }, [activeCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeCategoryId == null) return;
    let cancelled = false;
    setLoadingForm(true); setError(null); setSuccess(null);
    fetchForm(activeCategoryId)
      .then((f) => {
        if (cancelled) return;
        setForm(f);
        setBuffers(fromFields(f.fields));
        onFormLoaded?.(f);
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load goals."); })
      .finally(() => { if (!cancelled) setLoadingForm(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId, reloadKey]);

  // Achieved value keyed by the TARGET field it belongs to (for the "Target · Achieved" label).
  const achievedByTarget = useMemo(() => {
    const m: Record<string, number | null> = {};
    if (form) for (const f of form.fields) {
      const targetKey = ACHIEVED_OF[f.fieldKey];
      if (targetKey) m[targetKey] = f.numericValue;
    }
    return m;
  }, [form]);

  const groups = useMemo(() => {
    if (!form) return [] as [string, GoalFieldWithValueDto[]][];
    const map = new Map<string, GoalFieldWithValueDto[]>();
    for (const f of form.fields) {
      if (ACHIEVED_OF[f.fieldKey]) continue; // shown as a label on its target, not its own box
      if (f.fieldKey === "involving_rotaract_interact_rcc") continue; // removed per Public Image "Other Points"
      const arr = map.get(f.groupName) || [];
      arr.push(f);
      map.set(f.groupName, arr);
    }
    return Array.from(map.entries());
  }, [form]);

  // Percentage Achievement, recalculated on every keystroke (see PCT_RULES) instead of only after Save.
  const livePct = useMemo(() => (form ? livePercentages(form.fields, buffers) : {}), [form, buffers]);

  function setText(fieldId: number, text: string) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), text } }));
    setSuccess(null);
  }
  function setBool(fieldId: number, bool: boolean) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), bool } }));
    setSuccess(null);
  }
  // Set several text buffers at once (used by the Suggestions list to compact rows on delete).
  function setManyTexts(updates: Record<number, string>) {
    setBuffers((prev) => {
      const next = { ...prev };
      for (const [id, text] of Object.entries(updates)) {
        const fid = Number(id);
        next[fid] = { ...(next[fid] ?? { text: "", bool: false }), text };
      }
      return next;
    });
    setSuccess(null);
  }

  // "Target for the Current year" is a YEAR-END TOTAL, so it can never go below what the club or
  // district already has. The floor arrives on the field as `minValue` - computed by the server from
  // the "as on July 1st" figure and from "Achieved", whichever is higher - so this screen blocks
  // exactly what the API refuses and the two can never drift apart. No minValue (Youth Service
  // "Proposed New ...", Public Image activity counts) → 0 stays perfectly legal (user 2026-09-29).
  function targetFloor(f: GoalFieldWithValueDto): number {
    const m = f.minValue;
    return m != null && Number(m) > 0 ? Number(m) : 0;
  }
  // Live per-field warning shown under a Target input while typing.
  function targetWarn(f: GoalFieldWithValueDto): string | undefined {
    const floor = targetFloor(f);
    if (floor <= 0) return undefined;
    const t = (buffers[f.fieldId]?.text ?? "").trim();
    if (t === "") return undefined;              // blank = not decided yet
    const tgt = Number(t);
    if (Number.isNaN(tgt) || tgt >= floor) return undefined;
    return `Cannot be less than ${floor.toLocaleString(appLocale())} — you already have that much`;
  }

  async function handleSave() {
    if (!form || activeCategoryId == null || !saveForm) return;
    // No target may be saved below the figure that already exists - 0 included. A blank box is still
    // allowed: that means "not decided yet", while 0 is an explicit promise to shrink.
    const tooLow = form.fields
      .map((f) => {
        const floor = targetFloor(f);
        if (floor <= 0) return null;
        const t = (buffers[f.fieldId]?.text ?? "").trim();
        if (t === "") return null;
        const tgt = Number(t);
        return !Number.isNaN(tgt) && tgt < floor ? { f, tgt, floor } : null;
      })
      .filter((x): x is { f: GoalFieldWithValueDto; tgt: number; floor: number } => x !== null);
    if (tooLow.length > 0) {
      setError(
        tooLow
          .map((x) => `${x.f.groupName}: target ${x.tgt.toLocaleString(appLocale())} cannot be less than the ${x.floor.toLocaleString(appLocale())} you already have.`)
          .join(" "),
      );
      return;
    }
    setSaving(true); setError(null); setSuccess(null);
    try {
      const entries: GoalEntrySaveDto[] = form.fields
        .filter((f) => f.fieldRole !== "Computed")
        .map((f) => {
          const buf = buffers[f.fieldId] ?? { text: "", bool: false };
          if (f.dataType === "Boolean") {
            return { fieldId: f.fieldId, numericValue: null, textValue: null, boolValue: buf.bool };
          }
          if (f.dataType === "Text") {
            return { fieldId: f.fieldId, numericValue: null, textValue: buf.text.trim() === "" ? null : buf.text, boolValue: null };
          }
          const n = buf.text.trim() === "" ? null : Number(buf.text);
          return { fieldId: f.fieldId, numericValue: n != null && isFinite(n) ? n : null, textValue: null, boolValue: null };
        });
      const fresh = await saveForm(activeCategoryId, { yearId: form.yearId, entries });
      setForm(fresh);
      setBuffers(fromFields(fresh.fields));
      setSuccess("Goals saved successfully.");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to save goals.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLockToggle() {
    if (!form || activeCategoryId == null || !lockToggle) return;
    setLocking(true); setError(null); setSuccess(null);
    try {
      await lockToggle(activeCategoryId, form.yearId, !form.isLocked);
      const fresh = await fetchForm(activeCategoryId);
      setForm(fresh);
      setBuffers(fromFields(fresh.fields));
      setSuccess(fresh.isLocked ? "Category locked." : "Category unlocked.");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to update lock.");
    } finally {
      setLocking(false);
    }
  }

  if (loadingCategories) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading Goal Setting…
      </div>
    );
  }
  if (!categories || categories.length === 0) return null;

  const isEditable = !readOnly && !!form?.isEditable && !!saveForm;
  // Club Foundation (MCR) uses a bespoke table: the 5 contribution metrics each on their own row,
  // with the shared Goal Amount (Target) + Goal % Achieved repeated on every row.
  const isClubFoundation = !!form && form.fields.some((f) => f.fieldKey === "club_af_goal_amount");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* A save is confirmed by an alert the user has to dismiss, not a small green line beside the
          button that is easy to miss (user 2026-09-29). The quarterly / month-wise popups do the
          same, and they close themselves as well. */}
      <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
      <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gradient-to-r from-blue-50 to-white">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500">
            {subtitle || (form ? `${form.entityName} · RY ${form.yearLabel}` : "")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {form?.isLocked && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 w-fit">
              <Lock size={11} /> Locked{form.lockedByName ? ` by ${form.lockedByName}` : ""}{form.lockedDate ? ` · ${form.lockedDate}` : ""}
            </span>
          )}
          {form && !form.isLocked && !form.isEditable && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 w-fit">
              <Lock size={11} /> {readOnly ? "Read only" : "Past year · read only"}
            </span>
          )}
          {form && lockToggle && form.canLock && (
            <LoadingButton
              onAction={handleLockToggle}
              forcePending={locking}
              spinnerSize={12}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${
                form.isLocked
                  ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  : "border-amber-200 text-amber-700 hover:bg-amber-50"
              }`}
            >
              {!locking && (form.isLocked ? <LockOpen size={12} /> : <Lock size={12} />)}
              {form.isLocked ? "Unlock" : "Lock"}
            </LoadingButton>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="px-5 pt-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategoryId(c.id)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition ${
              activeCategoryId === c.id
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Anything the page wants directly UNDER the category tabs — today the Quarterly /
          Month-wise target-split buttons (user 2026-09-25). */}
      {belowCategories && (
        <div className="px-5 py-3 border-b border-slate-100">{belowCategories}</div>
      )}

      {loadingForm && (
        <div className="p-8 flex items-center justify-center text-slate-500">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading…
        </div>
      )}

      {!loadingForm && form && (
        <div className="p-4 sm:p-5 space-y-4 bg-slate-50">
          {isClubFoundation ? (
            <ClubFoundationTable
              fields={form.fields}
              buffers={buffers}
              onText={setText}
              editable={isEditable && !saving}
            />
          ) : (
            groups.map(([groupName, fields]) => (
              <div key={groupName} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 sm:px-5 py-4">
                <h4 className="text-base font-bold text-blue-700 pb-2 mb-1 border-b-2 border-amber-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {groupName}
                  {groupName === "Summary" && <SummaryInfo fields={fields} />}
                  {groupName === "RAG Analysis" && (
                    <span className="text-xs font-normal text-slate-500">
                      (Healthy Clubs by active members per club — RED: 10–25 · AMBER: 26–40 · GREEN: 41+)
                    </span>
                  )}
                </h4>
                <div>
                  {groupName === "Suggestions" ? (
                    <SuggestionsList
                      key={`sugg-${form.yearId}`}
                      fields={fields}
                      buffers={buffers}
                      onText={setText}
                      onManyText={setManyTexts}
                      editable={isEditable && !saving}
                    />
                  ) : (
                    fields.map((f) => (
                      <Fragment key={f.fieldId}>
                        <GoalFieldInput
                          field={f}
                          buffer={f.fieldId in livePct ? { text: livePct[f.fieldId], bool: false } : buffers[f.fieldId]}
                          disabled={!isEditable || saving || !isFieldEditable(f, !!form && !form.clubId)}
                          onText={(v) => setText(f.fieldId, v)}
                          onBool={(v) => setBool(f.fieldId, v)}
                          achieved={f.fieldKey in achievedByTarget ? achievedByTarget[f.fieldKey] : undefined}
                          warn={targetWarn(f)}
                          asOn={form?.achievedAsOn ?? undefined}
                        />
                        {form?.clubId && buffers[f.fieldId]?.bool && (f.fieldKey === "club_website" || f.fieldKey === "club_social_media") && (
                          <ClubPublicImageLinks clubId={form.clubId} kind={f.fieldKey === "club_website" ? "website" : "social"} />
                        )}
                      </Fragment>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Hidden while a tab loads, so Save Goals doesn't flash up under the tabs before the fields render. */}
      <div className={`px-5 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50${loadingForm ? " hidden" : ""}`}>
        <div className="text-xs text-slate-500">
          {form?.fields.length ? `${form.fields.length} fields` : ""}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-rose-700">{error}</span>}
          {isEditable && (
            <LoadingButton
              onAction={handleSave}
              forcePending={saving}
              loadingLabel="Saving…"
              spinnerSize={13}
              className="inline-flex items-center gap-1 text-xs font-semibold px-5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {!saving && <Save size={13} />} Save Goals
            </LoadingButton>
          )}
        </div>
      </div>
    </div>
  );
}

// Club Foundation (MCR) table: each of the 5 contribution metrics on its own row, with the SHARED
// Annual Fund Goal Amount (Target) and Goal % Achieved shown on every row. The Goal Amount / %
// inputs across the rows all bind to the SAME field id, so they hold one value and edit together.
function ClubFoundationTable({
  fields, buffers, onText, editable,
}: {
  fields: GoalFieldWithValueDto[];
  buffers: Record<number, FieldBuffer>;
  onText: (fieldId: number, v: string) => void;
  editable: boolean;
}) {
  const byKey = (k: string) => fields.find((f) => f.fieldKey === k);
  const goalAmount = byKey("club_af_goal_amount");
  const pct = byKey("club_goal_pct_achieved");
  const metrics = ["club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd", "club_total_ytd"]
    .map(byKey).filter(Boolean) as GoalFieldWithValueDto[];
  if (!goalAmount || !pct) return null;

  const goalEditable = editable && isFieldEditable(goalAmount);
  const pctEditable = editable && isFieldEditable(pct);

  const numCell = (value: string, disabled: boolean, prefix: string | null, suffix: string | null, onChange?: (v: string) => void) => (
    <div className="relative">
      {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{prefix}</span>}
      <input
        type="text" inputMode="decimal" value={value} disabled={disabled}
        onChange={(e) => {
          if (!onChange) return;
          const raw = e.target.value.replace(/[^\d.]/g, "");
          const parts = raw.split(".");
          onChange(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw);
        }}
        className={`w-full ${prefix ? "pl-6" : "pl-2.5"} ${suffix ? "pr-7" : "pr-2.5"} py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500`}
        placeholder={disabled ? "—" : "0"}
      />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{suffix}</span>}
    </div>
  );

  const goalVal = buffers[goalAmount.fieldId]?.text ?? "";
  const pctVal = buffers[pct.fieldId]?.text ?? "";

  return (
    <div className="overflow-x-auto">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Annual Fund &amp; Contributions</h4>
      <table className="w-full min-w-[560px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400">
            <th className="text-left font-medium px-2 w-1/3">Annual Fund Goal Amount <span className="normal-case text-slate-300">(Target)</span></th>
            <th className="text-left font-medium px-2 w-1/3">Contribution</th>
            <th className="text-left font-medium px-2 w-1/3">Goal % Achieved</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const mPrefix = m.dataType === "Currency" ? (m.unit || "$") : null;
            const mSuffix = m.dataType === "Percentage" ? "%" : null;
            return (
              <tr key={m.fieldId} className="align-top">
                <td className="px-2">{numCell(goalVal, !goalEditable, "$", null, (v) => onText(goalAmount.fieldId, v))}</td>
                <td className="px-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">{m.fieldLabel}</div>
                  {numCell(buffers[m.fieldId]?.text ?? "", true, mPrefix, mSuffix)}
                </td>
                <td className="px-2">{numCell(pctVal, !pctEditable, null, "%", (v) => onText(pct.fieldId, v))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Summary "how is this calculated?" — an (i) icon that toggles a plain-language breakdown of the
// Summary formulas, using the current field values so the numbers are concrete.
function SummaryInfo({ fields }: { fields: GoalFieldWithValueDto[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Close when clicking anywhere outside the icon/popover (or pressing Escape).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const val = (k: string) => {
    const f = fields.find((x) => x.fieldKey === k);
    return f?.numericValue != null ? Number(f.numericValue) : 0;
  };
  const clubsBaseline = val("total_clubs");
  const clubsAchieved = val("new_clubs_achieved");
  const membersBaseline = val("total_members");
  const membersAchieved = val("new_members_achieved");
  const womenBaseline = val("existing_women_members");
  const womenAchieved = val("new_women_members_achieved");
  const newClubs = Math.max(0, clubsAchieved - clubsBaseline);
  const netGrowth = Math.max(0, membersAchieved - membersBaseline);
  const newWomen = Math.max(0, womenAchieved - womenBaseline);
  // Only explain the rows this page shows (the club page has no Total New Clubs).
  const has = (k: string) => fields.some((x) => x.fieldKey === k);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="How is this calculated?"
        className="text-blue-500 hover:text-blue-700"
      >
        <Info size={15} />
      </button>
      {open && (
        <div className="absolute left-5 top-0 z-20 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg">
          <div className="font-semibold text-slate-700 mb-1.5">How the Summary is calculated</div>
          <div className="space-y-1.5">
            {has("total_new_clubs") && (
            <div><span className="font-medium">Total New Clubs</span> = Clubs Achieved − Clubs as on July 1st<br />
              <span className="text-slate-400">= {clubsAchieved} − {clubsBaseline} = {newClubs}</span></div>
            )}
            {has("total_membership_net_growth") && (
            <div><span className="font-medium">Total Membership Net Growth</span> = Members Achieved − Members as on July 1st<br />
              <span className="text-slate-400">= {membersAchieved} − {membersBaseline} = {netGrowth}</span></div>
            )}
            {has("new_club_members_computed") && (
            <div><span className="font-medium">Total New women members</span> = Women Achieved − Women as on July 1st<br />
              <span className="text-slate-400">= {womenAchieved} − {womenBaseline} = {newWomen}</span></div>
            )}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">Actual added from July 1st to date (Achieved − July 1st count).</div>
        </div>
      )}
    </span>
  );
}

// Public Image "Suggestions" — a dynamic Add/Delete list backed by the 10 pi_suggestion_* slots.
// Shows one textarea per used slot (min 1 when editable), an Add button up to 10, and a Delete
// per row that clears it and compacts the rest up. Read-only view lists the filled ones only.
function SuggestionsList({
  fields, buffers, onText, onManyText, editable,
}: {
  fields: GoalFieldWithValueDto[];
  buffers: Record<number, FieldBuffer>;
  onText: (fieldId: number, v: string) => void;
  onManyText: (updates: Record<number, string>) => void;
  editable: boolean;
}) {
  // fields arrive in SortOrder (slot 1..10). Value per slot from the buffer.
  const slots = fields;
  const valueAt = (i: number) => buffers[slots[i].fieldId]?.text ?? "";
  // Show every box up to the LAST filled one (not just "how many are filled"), so a suggestion saved
  // after a blank box is never hidden on reload.
  const filledCount = slots.reduce((n, s, i) => ((buffers[s.fieldId]?.text ?? "").trim() !== "" ? i + 1 : n), 0);

  const [visible, setVisible] = useState(Math.max(1, filledCount));
  useEffect(() => {
    // Never show fewer rows than are actually filled; never exceed the slot count.
    setVisible((v) => Math.min(slots.length, Math.max(v, filledCount, 1)));
  }, [filledCount, slots.length]);

  // Read-only: just list the non-empty suggestions.
  if (!editable) {
    const filled = slots.map((s, i) => ({ s, v: valueAt(i) })).filter((x) => x.v.trim() !== "");
    if (filled.length === 0) return <div className="py-3 text-sm text-slate-400">—</div>;
    return (
      <ol className="list-decimal pl-5 py-2 space-y-1.5">
        {filled.map(({ s, v }) => <li key={s.fieldId} className="text-sm text-slate-700 leading-snug">{v}</li>)}
      </ol>
    );
  }

  const shownCount = Math.min(slots.length, Math.max(visible, filledCount, 1));

  function handleDelete(idx: number) {
    // Shift every value after idx up one slot; clear the last.
    const updates: Record<number, string> = {};
    for (let i = idx; i < slots.length; i++) {
      updates[slots[i].fieldId] = i + 1 < slots.length ? (buffers[slots[i + 1].fieldId]?.text ?? "") : "";
    }
    onManyText(updates);
    setVisible((v) => Math.max(1, v - 1));
  }

  return (
    <div className="py-2 space-y-2">
      {Array.from({ length: shownCount }).map((_, i) => (
        <div key={slots[i].fieldId} className="flex items-start gap-2">
          <span className="text-xs text-slate-400 pt-2 w-5 shrink-0">{i + 1}.</span>
          <textarea
            rows={2}
            value={valueAt(i)}
            onChange={(e) => onText(slots[i].fieldId, e.target.value)}
            placeholder="Enter a Public Image activity suggestion..."
            className="flex-1 px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          <button
            type="button"
            onClick={() => handleDelete(i)}
            title="Remove this suggestion"
            className="mt-1 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {shownCount < slots.length && (() => {
        // A new box can be added only once the last one is filled — no blank gaps between suggestions.
        const lastEmpty = valueAt(shownCount - 1).trim() === "";
        return (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => setVisible((v) => Math.min(slots.length, v + 1))}
              disabled={lastEmpty}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              <Plus size={14} /> Add suggestion
            </button>
            {lastEmpty && <span className="text-[11px] text-slate-400">Fill suggestion {shownCount} before adding another.</span>}
          </div>
        );
      })()}
      <div className="text-[11px] text-slate-400">Up to {slots.length} suggestions.</div>
    </div>
  );
}

// Public Image "Other Points": when Club Website / Club Social Media is set to YES, list the club's
// actual saved website URL / social-media links (clickable, read-only) from the club-website tables —
// one source of truth. Listing only for now (no add/edit here).
function ClubPublicImageLinks({ clubId, kind }: { clubId: number; kind: "website" | "social" }) {
  const [loading, setLoading] = useState(true);
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [links, setLinks] = useState<ClubSocialLink[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = kind === "website"
      ? getClubWebsiteStatus(clubId).then((s) => { if (alive) setWebsiteUrl(s.visitUrl ?? null); })
      : getClubSocialLinks(clubId).then((rows) => { if (alive) setLinks((rows || []).filter((r) => r.isActive && (r.linkUrl || "").trim() !== "")); });
    p.catch(() => { /* leave empty */ }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clubId, kind]);

  const norm = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

  return (
    <div className="mt-1 mb-3 ml-1 pl-3 border-l-2 border-blue-100">
      {loading ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading…</span>
      ) : kind === "website" ? (
        websiteUrl ? (
          <a href={norm(websiteUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline break-all">
            <Globe size={13} /> {websiteUrl} <ExternalLink size={11} />
          </a>
        ) : <span className="text-xs text-slate-400">No club website saved yet.</span>
      ) : (
        links.length > 0 ? (
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a key={l.id} href={norm(l.linkUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline break-all">
                <Link2 size={13} /> <span className="font-semibold text-slate-600">{l.platform}:</span> {l.linkUrl} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">No social media links saved yet.</span>
      )}
    </div>
  );
}

// A full-width row: field label on the left, control on the right — matching the reference design.
function FieldRow({ label, alignTop, children }: { label: string; alignTop?: boolean; children: ReactNode }) {
  return (
    <div className={`flex ${alignTop ? "items-start" : "items-center"} justify-between gap-4 py-3 border-b border-slate-100 last:border-b-0`}>
      <span className="text-sm text-slate-700 leading-snug">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GoalFieldInput({
  field, buffer, disabled, onText, onBool, warn, asOn,
}: {
  field: GoalFieldWithValueDto;
  buffer: FieldBuffer | undefined;
  disabled: boolean;
  onText: (v: string) => void;
  onBool: (v: boolean) => void;
  achieved?: number | null;
  warn?: string;
  asOn?: string;   // "31 Aug 2026" — appended to an "Achieved" field's label when month-wise data exists
}) {
  const buf = buffer ?? { text: "", bool: false };
  // Show the month-wise "as on" date in brackets on the Achieved row(s): "Achieved (as on 31 Aug 2026)".
  const isAchievedRow = field.fieldLabel.trim().toLowerCase() === "achieved" || field.fieldKey.endsWith("_achieved");
  const label = asOn && isAchievedRow ? `${field.fieldLabel} (as on ${asOn})` : field.fieldLabel;

  // Boolean → YES / NO toggle on the right (selected = blue, other = grey).
  if (field.dataType === "Boolean") {
    return (
      <FieldRow label={label}>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onBool(true)}
            className={`px-4 py-1 text-xs font-bold rounded ${buf.bool ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >YES</button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onBool(false)}
            className={`px-4 py-1 text-xs font-bold rounded ${!buf.bool ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >NO</button>
        </div>
      </FieldRow>
    );
  }

  // Text → textarea on the right.
  if (field.dataType === "Text") {
    return (
      <FieldRow label={label} alignTop>
        <textarea
          rows={2}
          value={buf.text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          placeholder={disabled ? "" : "Enter text..."}
          className="w-64 sm:w-72 max-w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 resize-y"
        />
      </FieldRow>
    );
  }

  // Integer / Decimal / Percentage / Currency — a right-aligned box; grey when read-only.
  const isCurrency = field.dataType === "Currency";
  const isPercentage = field.dataType === "Percentage";
  return (
    <FieldRow label={label} alignTop={!!warn}>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {isCurrency && <span className="text-slate-400 text-sm">$</span>}
          <input
            type="text"
            inputMode="decimal"
            value={buf.text}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, "");
              const parts = raw.split(".");
              const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
              onText(cleaned);
            }}
            className={`w-36 sm:w-44 text-right px-2.5 py-1.5 text-sm rounded-md focus:outline-none ${
              warn
                ? "border-2 border-rose-400 focus:ring-2 focus:ring-rose-400"
                : disabled
                ? "bg-slate-100 border border-slate-200 text-slate-600"
                : "border border-slate-300 focus:ring-2 focus:ring-blue-500"
            }`}
            placeholder={disabled ? "" : "0"}
          />
          {isCurrency && <span className="text-slate-400 text-sm">$</span>}
          {isPercentage && <span className="text-slate-400 text-sm">%</span>}
        </div>
        {warn && <span className="text-[11px] text-rose-600 text-right max-w-[11rem] leading-tight">{warn}</span>}
      </div>
    </FieldRow>
  );
}
