import { createContext } from "react";
import type { GoalCategoryFormDto, GoalFieldWithValueDto } from "@/types/goalSetting";
import { withRotaryFields, withRag, isBaselineField, isFutureYearLabel, type SectionKey } from "@/lib/goalRotaryLayout";

export type FieldBuffer = { text: string; bool: boolean };
export type GoalTab = "all" | SectionKey;

// Same list as SystemFilledFieldKeys in GoalSettingService.cs - the API ignores these on save.
// Reference fields the SYSTEM fills automatically: Membership from live DB counts (injected in
// GoalSettingService), Foundation from the SuperAdmin cumulative Excel import. These stay read-only.
// Every OTHER Reference field has NO data source (e.g. all Youth "Existing" counts), so the
// district/club admin must type it: those are editable. Computed fields are always read-only.
export const SYSTEM_FILLED_REFERENCE = new Set<string>([
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
export const DISTRICT_SYSTEM_FILLED = new Set<string>(["rotaract_existing_clubs", "interact_existing_clubs",
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
export type PctRule = { pct: string; target: string; achieved: string; baseline: string; mode: "ratio" | "growth" | "newAdded" | "ratioWhole" };
export const PCT_RULES: PctRule[] = [
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
export function livePercentages(fields: GoalFieldWithValueDto[], buffers: Record<number, FieldBuffer>): Record<number, string> {
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

export function fromFields(fields: GoalFieldWithValueDto[]): Record<number, FieldBuffer> {
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
export type FormTransform = (form: GoalCategoryFormDto) => Promise<GoalCategoryFormDto>;
export const loadOne = async (fetchForm: (categoryId: number) => Promise<GoalCategoryFormDto>, id: number, transform?: FormTransform) => {
  const f = await withRag(withRotaryFields(await fetchForm(id)));
  return transform ? transform(f) : f;
};
// RCC tab: a Rotary.org goal box that Rotary.org has not filled (lib/rccGoals.ts).
export const rccMissing = (f: GoalFieldWithValueDto) => !!(f as GoalFieldWithValueDto & { rccMissing?: boolean }).rccMissing;

// Boxes that are never shown: the removed Public Image point, and a future year's "as on July 1st".
export const skipField = (form: GoalCategoryFormDto, f: GoalFieldWithValueDto) =>
  f.fieldKey === "involving_rotaract_interact_rcc" || (isFutureYearLabel(form.yearLabel) && isBaselineField(form.categoryId, f.fieldKey));


// Every progress bar uses the RAG scale of its percentage: 0-10 red, 11-25 yellow, 26-50 orange, 51-100 blue, 101+ purple.
export const ragFill = (p: number) => `var(--go-rag-${p <= 10 ? "red" : p <= 25 ? "yellow" : p <= 50 ? "orange" : p <= 100 ? "blue" : "purple"})`;

/** On: labels lose their serial number and source symbol, and the symbol legend is hidden (Goal Overview
 *  popups - their viewers don't type values). Off everywhere else, so District / Club Admin keep both. */
export const PlainLabelsContext = createContext(false);
