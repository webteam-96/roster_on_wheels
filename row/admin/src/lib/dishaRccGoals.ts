// Disha Goals (user 2026-11-18): the Goal Setting / RCC boxes shown in Disha.
//   - Which cards: the 26 RCC goals + Clubs, Members, Women Members, RAG Analysis, Summary - in the Goal Setting order.
//   - A Disha question that IS one of those cards (New Clubs, Member Addition, Women Members) takes that card's place.
//   - The goal of a card is a Disha goal (own figure, set by the RI Director / SA / DG; never from Rotary.org / RISAO);
//     the % is worked out on it with Goal Setting's formula. Achieved = Goal Setting's, as everywhere.
//   - Goals lock per district + section. Same lists as RotaryApi/Services/DishaRccGoals.cs.

import { buildSections, SECTION_TABS, isBaselineField, type SectionKey, type SectionCard } from "@/lib/goalRotaryLayout";
import { isRccRotaryCard } from "@/lib/rccGoals";
import type { GoalCategoryFormDto, GoalFieldWithValueDto } from "@/types/goalSetting";

export type DishaSection = SectionKey | "other";
const r = (name: string) => `rotary_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_target`;

/** The goal box of each card -> its section. */
export const DISHA_GOAL_KEYS: Record<string, DishaSection> = {
  new_clubs: "reach", new_members: "reach", new_women_members: "reach", rotaract_new_clubs_target: "reach", interact_new_clubs_target: "reach",
  [r("New member sponsorship")]: "reach", [r("RYLA participation")]: "reach", [r("Media stories about club projects")]: "reach",
  annual_fund_target: "impact", polio_plus_target: "impact",
  [r("Major gifts")]: "impact", [r("Bequest Society members")]: "impact", [r("Benefactors")]: "impact",
  [r("Inbound Youth Exchange students")]: "impact", [r("Outbound Youth Exchange students")]: "impact", [r("Service projects")]: "impact",
  [r("Strategic plan")]: "adapt", [r("Club bylaws review")]: "adapt", [r("Online presence")]: "adapt", [r("Update website and social media")]: "adapt",
  [r("Leadership development participation")]: "engage", [r("District conference attendance")]: "engage",
  [r("District training participation")]: "engage", [r("Rotary Action Group participation")]: "engage",
  [r("Rotary Fellowship participation")]: "engage", [r("Service participation")]: "engage",
  [r("Social activities")]: "engage", [r("Use of official Rotary promotional materials")]: "engage",
};
// Membership: % = (Achieved - as on 1 July) / (Goal - as on 1 July), as Goal Setting.
const GROWTH_BASE: Record<string, string> = { new_clubs: "total_clubs", new_members: "total_members", new_women_members: "existing_women_members" };

export const normName = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Goal Setting cards shown in Disha besides the 26 RCC goals (user 2026-11-18).
const EXTRA_CARDS = new Set(["Clubs", "Members", "Women Members", "RAG Analysis", "Summary"]);
// A Disha question that is a Goal Setting card -> that card (shown once, as the Disha question, in its place).
// ("Member Addition(Lady)" = the old name of "Women Members" until the rename runs on server start.)
const SAME_CARD: Record<string, string> = { newclubs: "Clubs", memberaddition: "Members", womenmembers: "Women Members", memberadditionlady: "Women Members" };
export const cardOfQuestion = (title: string) => SAME_CARD[normName(title)] ?? null;
/** A Goal Setting card Disha shows: the 26 RCC goals + Clubs, Members, Women Members, RAG Analysis, Summary. */
export const isDishaCard = (c: SectionCard) => isRccRotaryCard(c) || EXTRA_CARDS.has(c.name);

export const SECTION_NAMES: Record<SectionKey, string> = {
  reach: "Expand Our Reach", impact: "Increase our Impact", adapt: "Increase Our Ability to Adapt", engage: "Enhance Participant Engagement",
};
export const sectionOfCategory = (category: string): DishaSection =>
  (Object.entries(SECTION_NAMES).find(([, t]) => normName(t) === normName(category))?.[0] as SectionKey | undefined) ?? "other";

/** The Goal Setting cards Disha shows for one district, per section, in the Goal Setting order. */
export function dishaCards(forms: GoalCategoryFormDto[], future: boolean): Record<SectionKey, SectionCard[]> {
  const skip = (form: GoalCategoryFormDto, f: GoalFieldWithValueDto) =>
    f.dataType === "Text" || f.fieldKey === "involving_rotaract_interact_rcc" || (future && isBaselineField(form.categoryId, f.fieldKey));
  const out = {} as Record<SectionKey, SectionCard[]>;
  for (const s of buildSections(forms, skip)) out[s.key] = s.cards.filter((c) => isRccRotaryCard(c) || EXTRA_CARDS.has(c.name));
  SECTION_TABS.forEach((s) => { out[s.key] ??= []; });
  return out;
}

/** The goal box of a card (a number), or null (RAG Analysis, Summary, Yes / No goals). */
export const goalFieldOf = (c: SectionCard) => c.fields.find((f) => DISHA_GOAL_KEYS[f.fieldKey] && f.dataType !== "Boolean") ?? null;

/** The goal already in Goal Setting for a card (shown until a Disha goal is set - user 2026-11-18). */
export const existingGoalOf = (c: SectionCard | undefined | null): number | null => {
  const v = c ? goalFieldOf(c)?.numericValue : null;
  return v == null ? null : Number(v);
};

/** The card with its goal in the goal box (the Disha goal, else the goal already in Goal Setting) and the % on it. */
export function withDishaGoal(c: SectionCard, goal: number | null | undefined): SectionCard {
  const gf = goalFieldOf(c);
  if (!gf) return c;
  const g = goal != null ? Number(goal) : existingGoalOf(c);
  const ach = c.fields.find((f) => /achieved$/.test(f.fieldKey))?.numericValue;
  const baseKey = GROWTH_BASE[gf.fieldKey];
  const base = baseKey ? c.fields.find((f) => f.fieldKey === baseKey)?.numericValue : null;
  const dp = gf.dataType === "Currency" ? 2 : 0;
  let pct: number | null = null;
  if (g != null && ach != null) {
    const den = baseKey ? g - Number(base ?? 0) : g;
    const num = baseKey ? Number(ach) - Number(base ?? 0) : Number(ach);
    if (den > 0) pct = Math.round((num / den) * 100 * 10 ** dp) / 10 ** dp;
  }
  const fields = c.fields.map((f) => f === gf ? { ...f, fieldLabel: "Goal", numericValue: g }
    : f.dataType === "Percentage" ? { ...f, numericValue: pct } : f);
  // Rotary.org-only goals have no % box: add one (Achieved / Disha goal).
  if (!fields.some((f) => f.dataType === "Percentage"))
    fields.push({ ...gf, fieldId: gf.fieldId - 100000, fieldKey: `${gf.fieldKey}_disha_pct`, fieldLabel: "Achieved (%)", dataType: "Percentage", numericValue: pct });
  return { ...c, fields };
}

/** One section in Disha order: Goal Setting cards in order (a matching Disha question in the card's place), then the
 *  other Disha questions of the section. */
export function orderSection<L extends { title: string }>(lines: L[], cards: SectionCard[]):
  ({ kind: "line"; line: L; card?: SectionCard } | { kind: "card"; card: SectionCard })[] {
  const used = new Set<L>();
  const out: ({ kind: "line"; line: L; card?: SectionCard } | { kind: "card"; card: SectionCard })[] = [];
  for (const c of cards) {
    const same = lines.filter((l) => cardOfQuestion(l.title) === c.name || normName(l.title) === normName(c.name));
    if (same.length > 0) same.forEach((l) => { used.add(l); out.push({ kind: "line", line: l, card: c }); });   // keeps the card's message
    else out.push({ kind: "card", card: c });
  }
  lines.filter((l) => !used.has(l)).forEach((l) => out.push({ kind: "line", line: l }));
  return out;
}
