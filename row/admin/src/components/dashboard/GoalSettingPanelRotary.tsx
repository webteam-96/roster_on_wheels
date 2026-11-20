"use client";

// COPY of GoalSettingPanel for the new Goal Setting with Rotary.org names (user 2026-10-23) - shown
// to Super Admin only until go-live; the original panel is not changed.
//
// Tabs = All Goals + the 4 Rotary.org sections (user 2026-10-30, option 2): Enhance Participant
// Engagement, Increase our Impact, Expand Our Reach, Increase Our Ability to Adapt. Each question sits in
// its Rotary.org section, whatever our category; inside a tab the questions come category by category
// (Membership, Youth Service, Foundation, Public Image), because Save, Lock, Messages and Month-wise
// still work per category on the existing APIs. Every tab, All Goals too, is editable while the
// category is open; Save Goals saves each category that was changed. See src/lib/goalRotaryLayout.ts.
//
// Generic Goal Setting form: driven entirely by goal_fields metadata (DataType/FieldRole), used for
// the Club Admin's own goals, the District Admin's own goals and, read-only, oversight roles.

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Save, Lock, LockOpen, Info, Plus, Trash2, ExternalLink, Globe, Link2 } from "@/components/icons";
import LoadingButton from "@/components/v2/LoadingButton";
import { getGoalCategories, getClubWebsiteStatus, getClubSocialLinks, getGoalSourceDates, type GoalSourceDates } from "@/services/api";
import type { ClubSocialLink } from "@/types/socialLink";
import type {
  GoalCategoryDto, GoalCategoryFormDto, GoalFieldWithValueDto, GoalEntrySaveDto, SaveGoalEntriesRequest, GoalLockStatusDto,
} from "@/types/goalSetting";
import SuccessAlert from "@/components/SuccessAlert";
import RagClubsDialog from "@/components/dashboard/RagClubsDialog";
import {
  withRotaryFields, SOURCE_LEGEND, RAG_BANDS, plainLabel, withRag, isBaselineField, isFutureYearLabel,
  buildSections, SECTION_TABS, categoryShortName, homeSectionOf, CATEGORY_TAGS, cardSourceNote, dayLabel, sectionHeading, sectionLockForms, isClubFoundationForm, isSuggestionCard, isRotaryOnlyCard, type SectionKey, type SectionCard, type SectionView,
} from "@/lib/goalRotaryLayout";
import { appLocale } from "@/lib/appFormat";

type FieldBuffer = { text: string; bool: boolean };
export type GoalTab = "all" | SectionKey;

// Same list as SystemFilledFieldKeys in GoalSettingService.cs - the API ignores these on save.
// Reference fields the SYSTEM fills automatically: Membership from live DB counts (injected in
// GoalSettingService), Foundation from the SuperAdmin cumulative Excel import. These stay read-only.
// Every OTHER Reference field has NO data source (e.g. all Youth "Existing" counts), so the
// district/club admin must type it: those are editable. Computed fields are always read-only.
const SYSTEM_FILLED_REFERENCE = new Set<string>([
  // Membership: injected live in GoalSettingService (LoadFieldsWithValuesAsync auto-fill).
  "total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved",
  "existing_women_members", "new_women_members_achieved",
  "rag_red", "rag_amber", "rag_green", "rag_super_green",
  // Foundation (district): the 10 "Achieved" values are populated by the SuperAdmin district Excel
  // import (read-only for district admins; they only set the Targets). Total Contributions is Computed.
  "aks_achieved", "endowment_achieved", "bequest_achieved", "directed_gift_achieved",
  "polio_plus_achieved", "annual_fund_achieved", "phf_achieved", "phsm_achieved",
  "major_donors_achieved", "csr_achieved",
  // Total Giving: Achieved = the four funds, % worked out from it - locked since 2026-10-06.
  "total_giving_achieved", "total_giving_pct",
  // Foundation (club): the 5 contribution figures come from the MCR import (read-only). The club
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
export function isFieldEditable(f: GoalFieldWithValueDto, isDistrict = false): boolean {
  if (SYSTEM_FILLED_REFERENCE.has(f.fieldKey)) return false;
  if (isDistrict && DISTRICT_SYSTEM_FILLED.has(f.fieldKey)) return false;
  if (f.fieldRole === "Target") return true;
  if (f.fieldRole === "Reference") return !SYSTEM_FILLED_REFERENCE.has(f.fieldKey);
  return false; // Computed: always derived, never typed
}

// "Percentage Achievement" fields are Computed on the SERVER, so until now they only refreshed after
// Save: typing a Target left the old % on screen (user request 2026-09-16: calculate on key press).
// The same formulas run here on every keystroke. They mirror GoalSettingService.LoadFieldsWithValuesAsync
// exactly, so the live figure and the figure that comes back from Save always agree.
//   "ratio"    → Achieved ÷ Target × 100                                    (TRF: no July-1st baseline)
//   "growth"   → (Achieved − Baseline) ÷ (Target − Baseline) × 100          (Membership: Achieved includes the baseline)
//   "newAdded" → (Achieved − Baseline) ÷ Target × 100                       (Youth: Target is already just the NEW ones)
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
  // Youth Service (district): both the "Proposed New …" and the typed "Clubs Achieved" drive these.
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
    // RCC tab: a % worked out from a locked Rotary.org goal (lib/rccGoals.ts) is kept as given.
    if (!pctField || (pctField as GoalFieldWithValueDto & { rccFixedPct?: boolean }).rccFixedPct) continue;
    const tgt = num(r.target);
    const ach = num(r.achieved);
    let pct: number;
    if (r.mode === "ratio") {
      pct = tgt > 0 ? (ach / tgt) * 100 : 0;
    } else if (r.mode === "ratioWhole") {
      pct = tgt > 0 ? Math.max(0, (ach / tgt) * 100) : 0;
    } else if (r.mode === "growth") {
      const base = num(r.baseline);
      const planned = tgt - base;
      // Target 0 = "no target set" → 0%. Target = baseline (a real target, no planned growth) → 100% once met.
      pct = planned > 0 ? ((ach - base) / planned) * 100 : (tgt > 0 && ach >= tgt ? 100 : 0);
      pct = Math.max(0, pct);   // no 100% cap (user 2026-10-16): 24 of 12 = 200%
    } else {
      const base = num(r.baseline);
      pct = tgt > 0 ? Math.max(0, ((ach - base) / tgt) * 100) : 0;
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

// transform: the new RCC tab's changes (lib/rccGoals.ts); the other screens pass none.
type FormTransform = (form: GoalCategoryFormDto) => Promise<GoalCategoryFormDto>;
const loadOne = async (fetchForm: (categoryId: number) => Promise<GoalCategoryFormDto>, id: number, transform?: FormTransform) => {
  const f = await withRag(withRotaryFields(await fetchForm(id)));
  return transform ? transform(f) : f;
};
// RCC tab: a Rotary.org goal box that Rotary.org has not filled (lib/rccGoals.ts).
const rccMissing = (f: GoalFieldWithValueDto) => !!(f as GoalFieldWithValueDto & { rccMissing?: boolean }).rccMissing;

// Boxes that are never shown: the removed Public Image point, and a future year's "as on July 1st".
const skipField = (form: GoalCategoryFormDto, f: GoalFieldWithValueDto) =>
  f.fieldKey === "involving_rotaract_interact_rcc" || (isFutureYearLabel(form.yearLabel) && isBaselineField(form.categoryId, f.fieldKey));


// Every progress bar uses the RAG scale of its percentage: 0-10 red, 11-25 yellow, 26-50 orange, 51-100 blue, 101+ purple.
const ragFill = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;

/** On: labels lose their serial number and source symbol, and the symbol legend is hidden (Goal Overview
 *  popups - their viewers don't type values). Off everywhere else, so District / Club Admin keep both. */
export const PlainLabelsContext = createContext(false);

export default function GoalSettingPanelRotary({
  fetchForm,
  saveForm,
  lockToggle,
  title = "Goal Setting",
  readOnly = false,
  subtitle,
  initialTab = "all",
  onFormsLoaded,
  onTabChange,
  reloadKey,
  toolbar,
  categoryExtras,
  highlightEmpty = false,
  headerActions,
  transformForm,
}: {
  fetchForm: (categoryId: number) => Promise<GoalCategoryFormDto>;
  saveForm?: (categoryId: number, body: SaveGoalEntriesRequest) => Promise<GoalCategoryFormDto>;
  lockToggle?: (categoryId: number, yearId: number, locked: boolean) => Promise<GoalLockStatusDto>;
  title?: string;
  readOnly?: boolean;
  subtitle?: string;
  initialTab?: GoalTab;
  // Every category's form, once loaded and after each Save / Lock (the page's Report and Messages use them).
  onFormsLoaded?: (forms: GoalCategoryFormDto[]) => void;
  // The tab shown, with the categories that have questions in it (Messages opens on the first one).
  onTabChange?: (tab: GoalTab, categoryIds: number[]) => void;
  // Changing this re-fetches every category (e.g. the selected rotary year changed).
  reloadKey?: string | number | null;
  // Shown under the tabs on every tab - the page's Messages / Report buttons.
  toolbar?: ReactNode;
  // Shown under a category's questions in its own section (e.g. Membership's Quarterly / Month-wise).
  categoryExtras?: (form: GoalCategoryFormDto) => ReactNode;
  // An editable box that is blank or 0 gets a red border (visual only - Save is never blocked).
  highlightEmpty?: boolean;
  // Buttons at the top right of the panel header (e.g. a club's Report).
  headerActions?: ReactNode;
  // New RCC tab only (user 2026-11-16): changes each loaded form (hidden questions, Rotary.org goals locked).
  transformForm?: FormTransform;
}) {
  const [categories, setCategories] = useState<GoalCategoryDto[] | null>(null);
  const [tab, setTab] = useState<GoalTab>(initialTab);
  const plainLabels = useContext(PlainLabelsContext);
  const [forms, setForms] = useState<GoalCategoryFormDto[] | null>(null);
  const [buffers, setBuffers] = useState<Record<number, FieldBuffer>>({});
  const [saved, setSaved] = useState<Record<number, FieldBuffer>>({});   // what is stored, to see what changed
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingForms, setLoadingForms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ragOpen, setRagOpen] = useState<GoalCategoryFormDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoalCategories()
      .then((cats) => { if (!cancelled) setCategories(cats); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load categories."); })
      .finally(() => { if (!cancelled) setLoadingCategories(false); });
    return () => { cancelled = true; };
  }, []);

  // Every category's form, in category order; one that fails is left out.
  useEffect(() => {
    if (!categories) return;
    let cancelled = false;
    setLoadingForms(true); setError(null); setSuccess(null);
    Promise.allSettled(categories.map((c) => loadOne(fetchForm, c.id, transformForm)))
      .then((res) => {
        if (cancelled) return;
        const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        const b = fromFields(ok.flatMap((f) => f.fields));
        setForms(ok); setBuffers(b); setSaved(b);
        onFormsLoaded?.(ok);
        if (ok.length === 0) setError("Failed to load goals.");
      })
      .finally(() => { if (!cancelled) setLoadingForms(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, reloadKey]);

  const sections = useMemo(() => (forms ? buildSections(forms, skipField) : []), [forms]);

  // "Updated from Rotary.org / RISAO on …", "Entered by … · last saved …" on each card (user 2026-10-30).
  const [dates, setDates] = useState<GoalSourceDates | null>(null);
  const first0 = forms?.[0];
  useEffect(() => {
    if (!first0 || (!first0.districtId && !first0.clubId)) { setDates(null); return; }
    let cancelled = false;
    getGoalSourceDates(first0.yearId, first0.clubId ? null : first0.districtId, first0.clubId)
      .then((d) => { if (!cancelled) setDates(d); }).catch(() => { if (!cancelled) setDates(null); });
    return () => { cancelled = true; };
  }, [first0?.yearId, first0?.districtId, first0?.clubId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceNote = (c: SectionCard): string | null => cardSourceNote(c, dates);
  useEffect(() => {
    const ids = tab === "all" ? (forms ?? []).map((f) => f.categoryId)
      : (sections.find((s) => s.key === tab)?.owners ?? []).map((f) => f.categoryId);
    onTabChange?.(tab, ids);
  }, [tab, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Percentage Achievement, recalculated on every keystroke (see PCT_RULES) instead of only after Save.
  const livePct = useMemo(() => Object.assign({}, ...(forms ?? []).map((f) => livePercentages(f.fields, buffers))) as Record<number, string>,
    [forms, buffers]);

  const canSave = (form: GoalCategoryFormDto) => !readOnly && !!saveForm && form.isEditable;
  const isDistrictForm = (form: GoalCategoryFormDto) => !form.clubId;

  function setText(fieldId: number, text: string) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), text } }));
    setSuccess(null);
  }
  function setBool(fieldId: number, bool: boolean) {
    setBuffers((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? { text: "", bool: false }), bool } }));
    setSuccess(null);
  }
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
  // district already has (minValue from the server - the same rule the API applies).
  function targetFloor(f: GoalFieldWithValueDto): number {
    const m = f.minValue;
    return m != null && Number(m) > 0 ? Number(m) : 0;
  }
  function targetWarn(f: GoalFieldWithValueDto): string | undefined {
    const floor = targetFloor(f);
    if (floor <= 0) return undefined;
    const t = (buffers[f.fieldId]?.text ?? "").trim();
    if (t === "") return undefined;
    const tgt = Number(t);
    if (Number.isNaN(tgt) || tgt >= floor) return undefined;
    return `Cannot be less than ${floor.toLocaleString(appLocale())}: you already have that much`;
  }

  const savable = (form: GoalCategoryFormDto) => form.fields.filter((f) => f.fieldRole !== "Computed" && f.fieldId > 0);
  const changed = (f: GoalFieldWithValueDto) => {
    const a = buffers[f.fieldId] ?? { text: "", bool: false }, b = saved[f.fieldId] ?? { text: "", bool: false };
    return f.dataType === "Boolean" ? a.bool !== b.bool : a.text !== b.text;
  };
  const dirtyForms = (forms ?? []).filter((form) => canSave(form) && savable(form).some(changed));

  async function handleSave() {
    if (!saveForm || dirtyForms.length === 0) return;
    const tooLow = dirtyForms.flatMap((form) => form.fields)
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
      setError(tooLow.map((x) => `${x.f.groupName}: target ${x.tgt.toLocaleString(appLocale())} cannot be less than the ${x.floor.toLocaleString(appLocale())} you already have.`).join(" "));
      return;
    }
    setSaving(true); setError(null); setSuccess(null);
    let next = forms ?? [];
    const names: string[] = [];
    try {
      for (const form of dirtyForms) {
        const entries: GoalEntrySaveDto[] = savable(form).map((f) => {
          const buf = buffers[f.fieldId] ?? { text: "", bool: false };
          if (f.dataType === "Boolean") return { fieldId: f.fieldId, numericValue: null, textValue: null, boolValue: buf.bool };
          if (f.dataType === "Text") return { fieldId: f.fieldId, numericValue: null, textValue: buf.text.trim() === "" ? null : buf.text, boolValue: null };
          const n = buf.text.trim() === "" ? null : Number(buf.text);
          return { fieldId: f.fieldId, numericValue: n != null && isFinite(n) ? n : null, textValue: null, boolValue: null };
        });
        const raw = await withRag(withRotaryFields(await saveForm(form.categoryId, { yearId: form.yearId, entries })));
        const fresh = transformForm ? await transformForm(raw) : raw;
        next = next.map((x) => (x.categoryId === fresh.categoryId ? fresh : x));
        names.push(categoryShortName(form.categoryId, form.categoryName));
        const b = fromFields(fresh.fields);
        setBuffers((prev) => ({ ...prev, ...b }));
        setSaved((prev) => ({ ...prev, ...b }));
      }
      setSuccess(`Goals saved successfully (${names.join(", ")}).`);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError((names.length ? `Saved ${names.join(", ")}. ` : "") + (err?.response?.data?.message || "Failed to save goals."));
    } finally {
      setForms(next);
      onFormsLoaded?.(next);
      setSaving(false);
    }
  }

  async function handleLockToggle(form: GoalCategoryFormDto) {
    if (!lockToggle) return;
    setLocking(form.categoryId); setError(null); setSuccess(null);
    try {
      await lockToggle(form.categoryId, form.yearId, !form.isLocked);
      const fresh = await loadOne(fetchForm, form.categoryId, transformForm);
      const next = (forms ?? []).map((x) => (x.categoryId === fresh.categoryId ? fresh : x));
      setForms(next);
      onFormsLoaded?.(next);
      const b = fromFields(fresh.fields);
      setBuffers((prev) => ({ ...prev, ...b }));
      setSaved((prev) => ({ ...prev, ...b }));
      setSuccess(`${categoryShortName(form.categoryId, form.categoryName)} ${fresh.isLocked ? "locked" : "unlocked"}.`);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Failed to update lock.");
    } finally {
      setLocking(null);
    }
  }

  if (loadingCategories) {
    return (
      <div className="bg-go-surface rounded-go-lg border border-go-border p-6 flex items-center justify-center text-go-text-secondary">
        <Loader2 className="animate-spin mr-2" size={16} /> Loading Goal Setting…
      </div>
    );
  }
  if (!categories || categories.length === 0) return null;

  const first = forms?.[0] ?? null;
  const shown = tab === "all" ? sections : sections.filter((s) => s.key === tab);
  const anySavable = (forms ?? []).some(canSave);
  const tabCls = (on: boolean) => `min-h-14 px-3.5 py-2.5 text-go-body font-bold text-left leading-snug rounded-go-lg border transition ${
    on ? "bg-go-navy-900 border-go-navy-900 text-white border-b-[3px] border-b-go-gold-500" : "bg-go-surface border-go-border-strong text-go-navy-700 hover:bg-go-sunken"}`;

  // One card = one Rotary.org field (sheet "New", user 2026-10-30) with its boxes. Club Foundation
  // (MCR) keeps its own table.
  const renderCard = (c: SectionCard) => {
    const form = c.form;
    const editable = canSave(form) && !saving;
    const rotary = isRotaryOnlyCard(c);
    const suggestions = isSuggestionCard(c);
    return (
      <div key={c.name} className={`bg-go-surface rounded-go-lg border border-go-border px-4 sm:px-5 py-4 min-w-0 ${rotary ? "flex-[1_1_380px]" : "basis-full"}`}>
        <h4 className="text-go-title font-semibold text-go-navy-700 pb-2.5 mb-3.5 border-b border-go-border flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-full truncate" title={c.name}>{c.name}</span>
          {c.name === "Summary" && <SummaryInfo fields={c.fields} />}
          {sourceNote(c) && <span className="text-go-meta font-semibold text-go-text-secondary">{sourceNote(c)}</span>}
          {c.fields.some((f) => f.fieldKey.startsWith("rotary_")) && <RotaryOrgNote at={form.rotaryOrgUpdatedAt} />}
        </h4>
        {c.name === "RAG Analysis" && (() => {
          // Total = the 5 bands added up (= the district's clubs on Rotary.org); click for the club list.
          const total = c.fields.filter((f) => f.fieldKey.startsWith("rag5_")).reduce((t, f) => t + Number(f.numericValue ?? 0), 0);
          return (
            <button type="button" onClick={() => setRagOpen(form)} className="w-full text-left mb-1" title="Click to see the clubs and their member count">
              <div className="flex items-center justify-between mb-2 text-go-body">
                <span className="font-bold text-go-navy-900">Total clubs: {total.toLocaleString(appLocale())}</span>
                <span className="font-bold text-go-navy-700 underline">View clubs</span>
              </div>
              <RagBar fields={c.fields} />
            </button>
          );
        })()}
        {isClubFoundationForm(form) && !rotary ? (
          <ClubFoundationTable fields={c.fields} buffers={buffers} onText={setText} editable={editable} />
        ) : suggestions ? (
          <SuggestionsList key={`sugg-${form.yearId}`} fields={c.fields} buffers={buffers} onText={setText}
            onManyText={setManyTexts} editable={editable} markEmpty={highlightEmpty} />
        ) : (
          <div className={TILE_GRID}>
            {c.fields.map((f) => (
              <Fragment key={f.fieldId}>
                <GoalFieldInput
                  field={f}
                  buffer={f.fieldId in livePct ? { text: livePct[f.fieldId], bool: false } : buffers[f.fieldId]}
                  disabled={!editable || !isFieldEditable(f, isDistrictForm(form))}
                  onText={(v) => setText(f.fieldId, v)}
                  onBool={(v) => setBool(f.fieldId, v)}
                  warn={rccMissing(f) ? "Not set on Rotary.org" : targetWarn(f)}
                  markEmpty={highlightEmpty && isFieldEditable(f, isDistrictForm(form))}
                />
                {form.clubId && buffers[f.fieldId]?.bool && (f.fieldKey === "club_website" || f.fieldKey === "club_social_media") && (
                  <ClubPublicImageLinks clubId={form.clubId} kind={f.fieldKey === "club_website" ? "website" : "social"} />
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    );
  };

  // One section: a row with each category's tag, lock state and Lock button, then every box of the
  // section, then the categories' own extras (Membership / Foundation Quarterly / Month-wise).
  // Each category's Locked / Unlocked (+ Lock button where allowed). A tab shows its own category; All
  // Goals shows all four once, above the first section (user 2026-10-30).
  const lockRow = (forms: GoalCategoryFormDto[]) => forms.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2.5">
            {forms.map((form) => {
              const tag = CATEGORY_TAGS[form.categoryId];
              return (
                <span key={form.categoryId} className="inline-flex flex-wrap items-center gap-2 rounded-go-lg border border-go-border bg-go-surface px-3 py-1.5">
                  <span className="text-go-body font-bold text-go-navy-900">{categoryShortName(form.categoryId, form.categoryName)}</span>
                  {tag && <span className="rounded-full bg-go-sunken px-2 py-0.5 text-go-meta font-bold text-go-text-secondary">{tag.zone} / {tag.district}</span>}
                  {form.isLocked && (
                    <span className="inline-flex items-center gap-1 text-go-meta font-medium text-go-text-secondary" title={`${form.lockedByName ?? ""} ${form.lockedDate ?? ""}`.trim()}>
                      <Lock size={11} /> Locked
                    </span>
                  )}
                  {!form.isLocked && !form.isEditable && (
                    <span className="inline-flex items-center gap-1 text-go-meta font-medium text-go-text-secondary"><Lock size={11} /> {readOnly ? "Read only" : "Past year · read only"}</span>
                  )}
                  {!form.isLocked && form.isEditable && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-go-border-strong px-2 py-0.5 text-go-meta font-medium text-go-text-secondary"><LockOpen size={11} /> Unlocked</span>
                  )}
                  {lockToggle && form.canLock && (
                    <LoadingButton
                      onAction={() => handleLockToggle(form)}
                      forcePending={locking === form.categoryId}
                      spinnerSize={12}
                      className="inline-flex items-center gap-1.5 text-go-meta font-semibold h-8 px-3 rounded-go-sm border border-go-border-strong bg-go-surface text-go-navy-700 hover:bg-go-sunken"
                    >
                      {locking !== form.categoryId && (form.isLocked ? <LockOpen size={12} /> : <Lock size={12} />)}
                      {form.isLocked ? "Unlock" : "Lock"}
                    </LoadingButton>
                  )}
                </span>
              );
            })}
          </div>
  );

  // The tab's own category extras (Membership / Foundation Quarterly + Month-wise), shown at the TOP next
  // to the lock status or the section heading - at the bottom they were not seen (user 2026-10-30).
  const extrasOf = (s: SectionView) => !categoryExtras ? null : sectionLockForms(s)
    .filter((form) => homeSectionOf(form.categoryId) === s.key)
    .map((form) => { const x = categoryExtras(form); return x ? <div key={form.categoryId} className="ml-auto">{x}</div> : null; });

  const renderSection = (s: SectionView) => {
    return (
      <>
        {tab !== "all" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {lockRow(sectionLockForms(s))}
            {extrasOf(s)}
          </div>
        )}
        <div className="flex flex-wrap gap-4">{s.cards.map(renderCard)}</div>
      </>
    );
  };

  return (
    <div className="bg-go-surface rounded-go-lg border border-go-border shadow-go-card overflow-clip">
      <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
      {ragOpen?.districtId && (
        <RagClubsDialog open={!!ragOpen} onClose={() => setRagOpen(null)} yearId={ragOpen.yearId}
          districtId={ragOpen.districtId} title={`${ragOpen.entityName} · RY ${ragOpen.yearLabel}`} />
      )}
      <div className="px-6 py-5 border-b border-go-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-go-heading font-bold text-go-navy-900">{title}</h3>
          <p className="text-go-body text-go-text-secondary">{subtitle || (first ? `${first.entityName} · RY ${first.yearLabel}` : "")}</p>
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </div>

      {!plainLabels && <div className="px-6 pt-4 flex flex-wrap gap-2 text-go-body text-go-text-primary">
        {SOURCE_LEGEND.map((l) => (
          <span key={l.symbol} className="inline-flex items-center gap-1.5 rounded-full bg-go-sunken px-3 py-1.5"><span>{l.symbol}</span>{l.text}</span>
        ))}
      </div>}
      <div className="px-6 py-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))] border-b border-go-border">
        <button type="button" onClick={() => setTab("all")} className={tabCls(tab === "all")}>All Goals</button>
        {SECTION_TABS.map((s, i) => (
          <button key={s.key} type="button" onClick={() => setTab(s.key)} className={tabCls(tab === s.key)}>
            {sections[i] ? sectionHeading(sections[i]) : `${i + 1}. ${s.title}`}
          </button>
        ))}
      </div>

      {toolbar && <div className="px-6 py-3.5 border-b border-go-border bg-go-sunken">{toolbar}</div>}

      {loadingForms && (
        <div className="p-8 flex items-center justify-center text-go-text-secondary">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading…
        </div>
      )}

      {!loadingForms && forms && (
        <div className="p-4 sm:p-6 space-y-8 bg-go-sunken">
          {tab === "all" && lockRow(sections.flatMap(sectionLockForms))}
          {shown.map((s) => (
            <section key={s.key} className="space-y-5">
              {tab === "all" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="text-go-heading font-bold text-go-navy-900 border-l-[3px] border-go-gold-500 pl-3">{sectionHeading(s)}</h3>
                  {extrasOf(s)}
                </div>
              )}
              {s.cards.length === 0
                ? <p className="text-go-body text-go-text-muted">No goals in this section.</p>
                : renderSection(s)}
            </section>
          ))}
        </div>
      )}

      <div className={`sticky bottom-0 z-20 px-6 py-3.5 border-t border-go-border shadow-go-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-go-surface${loadingForms || !anySavable ? (error ? "" : " hidden") : ""}`}>
        <div className="text-go-body text-go-text-secondary">
          {dirtyForms.length > 0 ? `Not saved yet: ${dirtyForms.map((f) => categoryShortName(f.categoryId, f.categoryName)).join(", ")}` : ""}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-go-meta text-go-danger-600">{error}</span>}
          {anySavable && (
            <LoadingButton
              onAction={handleSave}
              forcePending={saving}
              disabled={dirtyForms.length === 0}
              loadingLabel="Saving…"
              spinnerSize={13}
              className="inline-flex items-center gap-2 text-go-body font-bold h-9 px-7 rounded-go-sm bg-go-navy-700 text-white hover:bg-go-navy-900 disabled:opacity-50"
            >
              {!saving && <Save size={13} />} Save Goals
            </LoadingButton>
          )}
        </div>
      </div>
    </div>
  );
}

// New design (user 2026-10-29): each group is a card; its boxes sit side by side in a grid. The
// "(Rotary.org)" goals have only two boxes, so their cards share a row.
const TILE_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]";
// "Updated from Rotary.org on 28 Oct 2026, 07:20 pm" under a Rotary.org goal (user 2026-10-29).
function RotaryOrgNote({ at }: { at?: string | null }) {
  if (!at) return null;
  const when = dayLabel(at);
  if (!when) return null;
  return <span className="text-go-meta font-semibold text-go-text-secondary">Updated from Rotary.org on {when}</span>;
}

// The 5 RAG bands as one coloured bar above their boxes.
function RagBar({ fields }: { fields: GoalFieldWithValueDto[] }) {
  const parts = RAG_BANDS.map((b) => ({ ...b, n: Number(fields.find((f) => f.fieldKey === b.key)?.numericValue ?? 0) }));
  if (parts.every((p) => p.n === 0)) return null;
  return (
    <div className="flex h-3.5 rounded-full overflow-hidden mb-3.5" role="img"
      aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
      {parts.map((p) => <div key={p.key} style={{ flex: `${p.n} 1 0`, background: p.color }} />)}
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
  const plainLabels = useContext(PlainLabelsContext);
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
      {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-go-text-muted text-go-body">{prefix}</span>}
      <input
        type="text" inputMode="decimal" value={value} disabled={disabled}
        onChange={(e) => {
          if (!onChange) return;
          const raw = e.target.value.replace(/[^\d.]/g, "");
          const parts = raw.split(".");
          onChange(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw);
        }}
        className={`w-full ${prefix ? "pl-6" : "pl-2.5"} ${suffix ? "pr-7" : "pr-2.5"} py-1.5 text-go-body border border-go-border rounded-go-md focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 disabled:bg-go-sunken disabled:text-go-text-secondary`}
        placeholder={disabled ? "–" : "0"}
      />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-go-text-muted text-go-body">{suffix}</span>}
    </div>
  );

  const goalVal = buffers[goalAmount.fieldId]?.text ?? "";
  const pctVal = buffers[pct.fieldId]?.text ?? "";

  return (
    <div className="overflow-x-auto">
      <h4 className="text-go-meta font-semibold uppercase tracking-wide text-go-text-secondary mb-2">Annual Fund &amp; Contributions</h4>
      <table className="w-full min-w-[560px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-go-meta uppercase tracking-wide text-go-text-muted">
            <th className="text-left font-medium px-2 w-1/3">Annual Fund Goal Amount <span className="normal-case text-go-text-muted">(Target)</span></th>
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
                  <div className="text-go-meta font-medium text-go-text-secondary mb-1">{plainLabels ? plainLabel(m.fieldLabel) : m.fieldLabel}</div>
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

// Summary "how is this calculated?": an (i) icon that toggles a plain-language breakdown of the
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
        className="text-go-navy-700 hover:text-go-navy-700"
      >
        <Info size={15} />
      </button>
      {open && (
        <div className="absolute left-5 top-0 z-20 w-72 rounded-go-md border border-go-border bg-go-surface p-3 text-go-meta text-go-text-secondary shadow-lg">
          <div className="font-semibold text-go-text-primary mb-1.5">How the Summary is calculated</div>
          <div className="space-y-1.5">
            {has("total_new_clubs") && (
            <div><span className="font-medium">Total New Clubs</span> = Clubs Achieved − Clubs as on July 1st<br />
              <span className="text-go-text-muted">= {clubsAchieved} − {clubsBaseline} = {newClubs}</span></div>
            )}
            {has("total_membership_net_growth") && (
            <div><span className="font-medium">Total Membership Net Growth</span> = Members Achieved − Members as on July 1st<br />
              <span className="text-go-text-muted">= {membersAchieved} − {membersBaseline} = {netGrowth}</span></div>
            )}
            {has("new_club_members_computed") && (
            <div><span className="font-medium">Total New women members</span> = Women Achieved − Women as on July 1st<br />
              <span className="text-go-text-muted">= {womenAchieved} − {womenBaseline} = {newWomen}</span></div>
            )}
          </div>
          <div className="mt-2 text-go-meta text-go-text-muted">Actual added from July 1st to date (Achieved − July 1st count).</div>
        </div>
      )}
    </span>
  );
}

// Public Image "Suggestions": a dynamic Add/Delete list backed by the 10 pi_suggestion_* slots.
// Shows one textarea per used slot (min 1 when editable), an Add button up to 10, and a Delete
// per row that clears it and compacts the rest up. Read-only view lists the filled ones only.
function SuggestionsList({
  fields, buffers, onText, onManyText, editable, markEmpty = false,
}: {
  fields: GoalFieldWithValueDto[];
  buffers: Record<number, FieldBuffer>;
  onText: (fieldId: number, v: string) => void;
  onManyText: (updates: Record<number, string>) => void;
  editable: boolean;
  markEmpty?: boolean;
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
    if (filled.length === 0) return <div className={`my-2 py-2 px-2.5 text-go-body text-go-text-muted rounded-go-sm ${markEmpty ? "border-2 border-go-danger-600" : ""}`}>–</div>;
    return (
      <ol className="list-decimal pl-5 py-2 space-y-1.5">
        {filled.map(({ s, v }) => <li key={s.fieldId} className="text-go-body text-go-text-primary leading-snug">{v}</li>)}
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
          <span className="text-go-meta text-go-text-muted pt-2 w-5 shrink-0">{i + 1}.</span>
          <textarea
            rows={2}
            value={valueAt(i)}
            onChange={(e) => onText(slots[i].fieldId, e.target.value)}
            placeholder="Enter a Public Image activity suggestion..."
            className={`flex-1 px-2.5 py-1.5 text-go-body rounded-go-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 resize-y ${
              markEmpty && valueAt(i).trim() === "" ? "border-2 border-go-danger-600" : "border border-go-border-strong"}`}
          />
          <button
            type="button"
            onClick={() => handleDelete(i)}
            title="Remove this suggestion"
            className="mt-1 p-1.5 text-go-text-muted hover:text-go-danger-600 hover:bg-go-danger-50 rounded-go-sm"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {shownCount < slots.length && (() => {
        // A new box can be added only once the last one is filled: no blank gaps between suggestions.
        const lastEmpty = valueAt(shownCount - 1).trim() === "";
        return (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => setVisible((v) => Math.min(slots.length, v + 1))}
              disabled={lastEmpty}
              className="inline-flex items-center gap-1 text-go-meta font-semibold text-go-navy-700 hover:text-go-navy-700 disabled:text-go-text-muted disabled:cursor-not-allowed"
            >
              <Plus size={14} /> Add suggestion
            </button>
            {lastEmpty && <span className="text-go-meta text-go-text-muted">Fill suggestion {shownCount} before adding another.</span>}
          </div>
        );
      })()}
      <div className="text-go-meta text-go-text-muted">Up to {slots.length} suggestions.</div>
    </div>
  );
}

// Public Image "Other Points": when Club Website / Club Social Media is set to YES, list the club's
// actual saved website URL / social-media links (clickable, read-only) from the club-website tables –
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
    <div className="mt-1 mb-3 ml-1 pl-3 border-l-2 border-go-border">
      {loading ? (
        <span className="inline-flex items-center gap-1.5 text-go-meta text-go-text-muted"><Loader2 size={12} className="animate-spin" /> Loading…</span>
      ) : kind === "website" ? (
        websiteUrl ? (
          <a href={norm(websiteUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-go-meta font-medium text-go-navy-700 hover:underline break-all">
            <Globe size={13} /> {websiteUrl} <ExternalLink size={11} />
          </a>
        ) : <span className="text-go-meta text-go-text-muted">No club website saved yet.</span>
      ) : (
        links.length > 0 ? (
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <a key={l.id} href={norm(l.linkUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-go-meta font-medium text-go-navy-700 hover:underline break-all">
                <Link2 size={13} /> <span className="font-semibold text-go-text-secondary">{l.platform}:</span> {l.linkUrl} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        ) : <span className="text-go-meta text-go-text-muted">No social media links saved yet.</span>
      )}
    </div>
  );
}

// One box of the new design (user 2026-10-29): label on top, value or input below. The RAG bands
// get their colour as a top edge.
function FieldRow({ label, accent, children }: { label: string; alignTop?: boolean; accent?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0 rounded-go-lg border border-go-border bg-go-sunken p-3.5"
      style={accent ? { borderTop: `5px solid ${accent}` } : undefined}>
      <span className="text-go-label font-semibold text-go-text-secondary leading-snug">{useContext(PlainLabelsContext) ? plainLabel(label) : label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GoalFieldInput({
  field, buffer, disabled, onText, onBool, warn, asOn, markEmpty = false,
}: {
  field: GoalFieldWithValueDto;
  buffer: FieldBuffer | undefined;
  disabled: boolean;
  onText: (v: string) => void;
  onBool: (v: boolean) => void;
  achieved?: number | null;
  warn?: string;
  asOn?: string;   // "31 Aug 2026": appended to an "Achieved" field's label when month-wise data exists
  markEmpty?: boolean;
}) {
  const buf = buffer ?? { text: "", bool: false };
  // Red border on a District Admin input field left blank or 0 (user 2026-10-16) - locked or not;
  // read-only fields (July 1st, imported Achieved, %) are never marked. YES/NO always has one side
  // chosen, so it is never marked.
  const isEmpty = markEmpty && (buf.text.trim() === "" || Number(buf.text) === 0);
  // Show the month-wise "as on" date in brackets on the Achieved row(s): "Achieved (as on 31 Aug 2026)".
  const isAchievedRow = field.fieldLabel.replace(/^[^A-Za-z]+/, "").trim().toLowerCase() === "achieved" || field.fieldKey.endsWith("_achieved");
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
            className={`inline-flex items-center gap-1.5 h-9 px-5 text-go-body font-semibold rounded-go-sm border ${buf.bool ? "bg-go-navy-900 border-go-navy-900 text-white" : "bg-go-surface border-go-border-strong text-go-text-secondary"} ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
          >{buf.bool && <Check size={14} />}YES</button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onBool(false)}
            className={`inline-flex items-center gap-1.5 h-9 px-5 text-go-body font-semibold rounded-go-sm border ${!buf.bool ? "bg-go-navy-900 border-go-navy-900 text-white" : "bg-go-surface border-go-border-strong text-go-text-secondary"} ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
          >{!buf.bool && <Check size={14} />}NO</button>
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
          className={`w-full px-3 py-2 text-go-body rounded-go-md bg-go-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1 disabled:bg-go-sunken disabled:text-go-text-secondary resize-y ${
            markEmpty && buf.text.trim() === "" ? "border-2 border-go-danger-600" : "border border-go-border-strong"}`}
        />
      </FieldRow>
    );
  }

  // Integer / Decimal / Percentage / Currency: a right-aligned box; grey when read-only.
  const isCurrency = field.dataType === "Currency";
  const isPercentage = field.dataType === "Percentage";
  const rag = RAG_BANDS.find((b) => b.key === field.fieldKey);
  // Read-only boxes show the figure itself (with commas); a box you type in stays a plain input.
  if (disabled && !warn && !isEmpty) {
    const n = buf.text.trim() === "" ? null : Number(buf.text);
    const shown = n == null || !Number.isFinite(n) ? buf.text
      : n.toLocaleString(appLocale(), { maximumFractionDigits: 2 });
    return (
      <FieldRow label={label} accent={rag?.color}>
        <div className="text-go-kpi font-bold text-go-navy-900 min-h-8 break-words">
          {shown !== "" && <>{isCurrency && "$"}{shown}{isPercentage && "%"}</>}
        </div>
        {isPercentage && <PctBar value={n} />}
      </FieldRow>
    );
  }
  return (
    <FieldRow label={label} accent={rag?.color}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {isCurrency && <span className="text-go-text-secondary text-go-title">$</span>}
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
            className={`w-full min-w-0 h-11 text-right px-3 text-go-heading font-bold text-go-navy-900 rounded-go-md bg-go-surface focus:outline-none ${
              warn || isEmpty
                ? `border-2 border-go-danger-600 focus:ring-2 focus:ring-go-danger-600${disabled ? " bg-go-sunken text-go-text-secondary" : ""}`
                : disabled
                ? "bg-go-sunken border border-go-border text-go-text-secondary"
                : "border border-go-border-strong focus-visible:ring-2 focus-visible:ring-go-navy-700 focus-visible:ring-offset-1"
            }`}
            placeholder={disabled ? "" : "0"}
          />
          {isPercentage && <span className="text-go-text-secondary text-go-title">%</span>}
        </div>
        {warn && <span className="text-go-meta text-go-danger-600 leading-tight">{warn}</span>}
      </div>
    </FieldRow>
  );
}

// Progress bar under a "Percentage Achieved" box (no 100% cap on the figure; the bar stops at full).
function PctBar({ value }: { value: number | null }) {
  const v = value != null && Number.isFinite(value) ? Math.max(0, value) : 0;
  return (
    <div className="h-2 rounded-full bg-go-border overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(v, 100)}%`, background: ragFill(v) }} />
    </div>
  );
}
