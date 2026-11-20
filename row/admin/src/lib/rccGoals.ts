// New "RCC & District Goals" page, RCC tab (user 2026-11-16). Same design as the New Goal Setting;
// only these differences, applied to each loaded category form:
//   1. The questions that moved to District Goals are not shown (Rotaractors, RCC and 9 Public Image
//      questions - boss's sheet RCC_Goal_Fields_Simple_2026-11-16_1600.xlsx).
//   2. A target that is a Rotary.org goal shows the Rotary.org figure and is locked. It is never sent on
//      Save, so the figure typed in the old Goal Setting stays as it is. No Rotary.org goal = empty box,
//      red border, "Not set on Rotary.org" in red.
//   3. "Target for the Current year" reads "Goal for the Current year".
// The old Goal Setting screens do not use this file.

import type { GoalCategoryFormDto, GoalFieldWithValueDto } from "@/types/goalSetting";
import { getRotaryOrgValuesShared, SOURCE_SYMBOL } from "@/lib/goalRotaryLayout";
import type { GoalRotaryOrgValues } from "@/services/api";

/** The 4 Rotary.org sections - also the default categories of a District Goals question. */
export const RCC_SECTIONS = [
  "Enhance Participant Engagement",
  "Increase our Impact",
  "Expand Our Reach",
  "Increase Our Ability to Adapt",
];

// Moved to District Goals - not shown in the RCC tab.
const HIDDEN = new Set<string>([
  "rotaract_existing_members", "rotaract_new_members_target", "rotaract_total_members", "rotaract_members_achieved", "rotaract_members_pct",
  "rcc_existing_clubs", "rcc_new_clubs_target", "rcc_total_clubs", "rcc_clubs_achieved", "rcc_clubs_pct",
  // Inter District PI Programme, District PI Seminar and PI Session in Training Events are district-only, so they
  // stay in the RCC tab (user 2026-11-16) - District Goals questions are answered club by club.
  "district_polio_awareness_programme", "bulletin_newsletter", "mega_pi_activities",
  "adoption_garden_park_road", "display_items", "public_rally",
  ...Array.from({ length: 10 }, (_, i) => `pi_suggestion_${i + 1}`),
]);

// Our target box -> the Rotary.org goal that fills it (district and club forms).
const ROTARY_TARGET: Record<string, string> = {
  new_members: "Club membership",
  rotaract_new_clubs_target: "Rotaract clubs",
  interact_new_clubs_target: "Interact clubs",
  annual_fund_target: "Annual Fund contributions",
  club_annual_fund_ytd_target: "Annual Fund contributions",
  polio_plus_target: "PolioPlus Fund contributions",
  club_polioplus_ytd_target: "PolioPlus Fund contributions",
};

const GOAL_LABEL = "Goal for the Current year";

// Rotaract / Interact %: Rotary.org's goal is the TOTAL clubs, so % = Achieved / Goal (user 2026-11-16),
// not the old "new clubs" formula. Only in the RCC tab.
const PCT_ACHIEVED_OVER_GOAL: Record<string, { achieved: string; goal: string }> = {
  rotaract_clubs_pct: { achieved: "rotaract_clubs_achieved", goal: "rotaract_new_clubs_target" },
  interact_clubs_pct: { achieved: "interact_clubs_achieved", goal: "interact_new_clubs_target" },
};

/** A box whose Rotary.org goal is missing (the panel shows it red). */
export const isRccMissing = (f: GoalFieldWithValueDto) => !!(f as GoalFieldWithValueDto & { rccMissing?: boolean }).rccMissing;

function relabel(label: string): string {
  return label
    .replace("Target for the Current year", GOAL_LABEL)
    .replace("Proposed New Rotaract Clubs", GOAL_LABEL)
    .replace("Proposed New Interact Clubs", GOAL_LABEL);
}

export async function rccTransformForm(form: GoalCategoryFormDto): Promise<GoalCategoryFormDto> {
  let org: GoalRotaryOrgValues | null = null;
  if (form.districtId || form.clubId) {
    try { org = await getRotaryOrgValuesShared(form.yearId, form.clubId ? null : form.districtId, form.clubId); } catch { /* none */ }
  }
  const target = (item: string) => org?.values.find((v) => v.itemName === item && v.kind === "Target")?.value ?? null;

  const fields = form.fields.filter((f) => !HIDDEN.has(f.fieldKey)).map((f) => {
    const item = ROTARY_TARGET[f.fieldKey];
    if (item) {
      const v = target(item);
      const label = relabel(f.fieldLabel).replace(SOURCE_SYMBOL.Edit, SOURCE_SYMBOL.Sync);
      // Computed = read-only and never sent on Save (the typed figure in goal_entries is kept).
      return { ...f, fieldLabel: label, fieldRole: "Computed" as const, numericValue: v, minValue: null, rccMissing: v == null };
    }
    const out = { ...f, fieldLabel: relabel(f.fieldLabel) };
    // Rotary.org-only goals (Major gifts, Strategic plan ...): their target box comes from Rotary.org too.
    if (/^rotary_.+_target$/.test(f.fieldKey) && f.numericValue == null && f.boolValue == null) return { ...out, rccMissing: true };
    return out;
  });
  const num = (key: string) => fields.find((f) => f.fieldKey === key)?.numericValue ?? null;
  const withPct = fields.map((f) => {
    const rule = PCT_ACHIEVED_OVER_GOAL[f.fieldKey];
    if (!rule) return f;
    const goal = num(rule.goal), ach = num(rule.achieved);
    const pct = goal && goal > 0 && ach != null ? Math.round((Number(ach) / Number(goal)) * 10000) / 100 : 0;
    return { ...f, numericValue: pct, rccFixedPct: true };
  });
  return { ...form, fields: withPct };
}
