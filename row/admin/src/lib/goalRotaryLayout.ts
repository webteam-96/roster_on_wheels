// New Goal Setting layout - Rotary.org sections + names (user 2026-10-23, sheet
// "Goal_Fields_Data_Source_ROW_vs_RotaryOrg updated.xlsx"). PREVIEW for Super Admin only;
// the existing Goal Setting pages do not use this file. Values still come from the existing
// goal_fields / goal_entries through the existing APIs - only the layout and names are new.
//
//   Category name  = "<Rotary.org section> (<our category>)"; designations (RMC, RRFC...) unchanged.
//   Each goal row  = Rotary.org section + Rotary.org name where the field is the same, our 4 columns
//                    (As on July 1st / Target / Achieved / % Achieved) kept.
//   How data comes = Sync (Rotary.org daily) / Import (RISAO Excel monthly) / Edit (District or
//                    Club Admin) / Auto (ROW works it out) / Rotary.org only (view).

import type { GoalCategoryFormDto, GoalFieldWithValueDto } from "@/types/goalSetting";
import { getGoalRotaryRagBands, getGoalRotaryOrgValues, type GoalRotaryOrgValues, type GoalSourceDates } from "@/services/api";

export type DataSource = "Sync" | "Import" | "Edit" | "Auto" | "RotaryOnly";
export type Applies = "District" | "Club" | "Both";

export const SOURCE_LABEL: Record<DataSource, string> = {
  Sync: "Daily sync (Rotary.org)",
  Import: "Import Excel monthly (RISAO)",
  Edit: "Edit by District / Club Admin",
  Auto: "Auto-calculated (ROW)",
  RotaryOnly: "Rotary.org only (view)",
};

export const SECTIONS = {
  reach: "Expand Our Reach",
  impact: "Increase our Impact",
  engage: "Enhance Participant Engagement",
  adapt: "Increase Our Ability to Adapt",
  summary: "District summary",
} as const;

export interface GoalRow {
  section: string;
  name: string;              // the name shown from now on
  oldName?: string;          // today's ROW name, when it changes
  source: DataSource;
  applies: Applies;
  note?: string;
  // our 4 columns (FieldKeys of the existing goal_fields)
  base?: string; baseCaption?: string;
  target?: string; targetCaption?: string;
  achieved?: string;
  pct?: string;
  // a goal that is not a number pair (RAG bands, summaries, Yes/No, suggestions): shown as a list
  values?: string[];
  // Rotary.org-only goal shown under another ROW heading than its category (sheet "District
  // Level" column ROW section, user 2026-10-30): "E-Governance", "Service Projects", "-" = Other.
  group?: string;
  // The user's note in the sheet (column after "Rotary.org field"), shown as a tag on the district card.
  tag?: string;
  // Card name on screen = the sheet "New" Rotary.org field (user 2026-10-30); default `name`.
  card?: string;
  // Where the card's message says the figure comes from, when not `source` (Total Giving = the four
  // RISAO funds added up -> "Updated from RISAO", user 2026-10-30). The box symbols still use `source`.
  noteSource?: DataSource;
}

export interface CategoryLayout {
  categoryId: number;        // goal_categories.pk_category_id
  ourName: string;
  title: string;             // "<Rotary.org section> (<our category>)"
  rows: GoalRow[];
}

const rotaryOnly = (section: string, name: string, group?: string): GoalRow =>
  ({ section, name, source: "RotaryOnly", applies: "Both", note: "Added from Rotary.org - value comes with the daily sync", group });

// ROW headings for Rotary.org-only goals that are not one of our 4 categories (the sheet).
const EGOV = "E-Governance", SERVICE = "Service Projects", OTHER = "Other Rotary.org goals";

const pi = (key: string, section: string, applies: Applies, card: string, tag: string | undefined = "Dist manual"): GoalRow =>
  ({ section, name: "", source: "Edit", applies, target: key, tag, card });

export const GOAL_LAYOUT: CategoryLayout[] = [
  {
    categoryId: 1, ourName: "Membership", title: "Expand Our Reach (Membership)",
    rows: [
      { section: SECTIONS.summary, name: "Number of clubs", oldName: "New Clubs", source: "Sync", applies: "District", card: "Clubs",
        base: "total_clubs", target: "new_clubs", achieved: "new_clubs_achieved", pct: "clubs_percentage_achievement" },
      { section: SECTIONS.reach, name: "Club membership", oldName: "Total Members", source: "Sync", applies: "Both", card: "Members",
        base: "total_members", target: "new_members", achieved: "new_members_achieved", pct: "percentage_increase" },
      { section: SECTIONS.reach, name: "Women Members", oldName: "Women Membership", source: "Sync", applies: "Both",
        note: "Rotary.org reference to be confirmed", tag: "SYNC",
        base: "existing_women_members", target: "new_women_members", achieved: "new_women_members_achieved", pct: "women_percentage_achievement" },
      { section: SECTIONS.reach, name: "RAG Analysis", source: "Sync", applies: "District",
        note: "Rotary.org reference to be confirmed", tag: "SYNC", values: ["rag5_red", "rag5_yellow", "rag5_orange", "rag5_blue", "rag5_purple"] },
      { section: SECTIONS.reach, name: "Summary", source: "Auto", applies: "Both",
        values: ["total_new_clubs", "total_membership_net_growth", "new_club_members_computed"] },
      rotaryOnly(SECTIONS.reach, "New member sponsorship"),
      rotaryOnly(SECTIONS.adapt, "Strategic plan", EGOV),
      rotaryOnly(SECTIONS.adapt, "Club bylaws review", EGOV),
      // Rotary.org goals with no ROW category (sheet ROW section "-", user 2026-10-30) - view only.
      rotaryOnly(SECTIONS.engage, "Leadership development participation", OTHER),
      rotaryOnly(SECTIONS.engage, "District conference attendance", OTHER),
      rotaryOnly(SECTIONS.engage, "District training participation", OTHER),
      rotaryOnly(SECTIONS.engage, "Rotary Action Group participation", OTHER),
      rotaryOnly(SECTIONS.engage, "Rotary Fellowship participation", OTHER),
    ],
  },
  {
    categoryId: 210, ourName: "Foundation", title: "Increase our Impact (Foundation)",
    rows: [
      { section: SECTIONS.impact, name: "Annual Fund contributions", oldName: "Annual Fund", source: "Sync", noteSource: "Import", applies: "District",
        base: "annual_fund_highest", baseCaption: "Highest", target: "annual_fund_target", achieved: "annual_fund_achieved", pct: "annual_fund_pct" },
      { section: SECTIONS.impact, name: "PolioPlus Fund contributions", oldName: "Polio Plus Fund", source: "Sync", noteSource: "Import", applies: "District",
        base: "polio_plus_highest", baseCaption: "Highest", target: "polio_plus_target", achieved: "polio_plus_achieved", pct: "polio_plus_pct" },
      { section: SECTIONS.impact, name: "Endowment Fund", source: "Import", applies: "District",
        base: "endowment_highest", baseCaption: "Highest", target: "endowment_target", achieved: "endowment_achieved", pct: "endowment_pct" },
      { section: SECTIONS.impact, name: "CSR", source: "Import", applies: "District", tag: "From RISAO",
        base: "csr_highest", baseCaption: "Highest", target: "csr_target", achieved: "csr_achieved", pct: "csr_pct" },
      { section: SECTIONS.impact, name: "Total Giving", source: "Auto", noteSource: "Import", applies: "District", note: "Annual Fund + PolioPlus + Endowment + CSR",
        tag: "Includes APF, Endowment, Polio, CSR - RISAO",
        base: "total_contributions_highest", baseCaption: "Highest", target: "total_contributions_target", achieved: "total_giving_achieved", pct: "total_giving_pct" },
      { section: SECTIONS.impact, name: "AF Per Capita", source: "Import", applies: "Club",
        target: "club_af_per_capita_target", achieved: "club_af_per_capita", pct: "club_af_per_capita_pct" },
      { section: SECTIONS.impact, name: "Annual Fund contributions", oldName: "Annual Fund YTD", source: "Sync", noteSource: "Import", applies: "Club",
        target: "club_annual_fund_ytd_target", achieved: "club_annual_fund_ytd", pct: "club_annual_fund_ytd_pct" },
      { section: SECTIONS.impact, name: "PolioPlus Fund contributions", oldName: "PolioPlus Fund YTD", source: "Sync", noteSource: "Import", applies: "Club",
        target: "club_polioplus_ytd_target", achieved: "club_polioplus_ytd", pct: "club_polioplus_ytd_pct" },
      { section: SECTIONS.impact, name: "Other Funds", oldName: "Other Funds YTD", source: "Import", applies: "Club",
        target: "club_other_funds_ytd_target", achieved: "club_other_funds_ytd", pct: "club_other_funds_ytd_pct" },
      { section: SECTIONS.impact, name: "Endowment Fund", oldName: "Endowment Fund YTD", source: "Import", applies: "Club",
        target: "club_endowment_ytd_target", achieved: "club_endowment_ytd", pct: "club_endowment_ytd_pct" },
      { section: SECTIONS.impact, name: "Total Giving", oldName: "Total", source: "Auto", noteSource: "Import", applies: "Club",
        target: "club_total_target", achieved: "club_total_ytd", pct: "club_total_pct" },
      rotaryOnly(SECTIONS.impact, "Major gifts"),
      rotaryOnly(SECTIONS.impact, "Bequest Society members"),
      rotaryOnly(SECTIONS.impact, "Benefactors"),
    ],
  },
  {
    categoryId: 211, ourName: "Youth Service", title: "Expand Our Reach (Youth Service)",
    rows: [
      { section: SECTIONS.reach, name: "Rotaract clubs", oldName: "Rotaract", source: "Sync", applies: "Both", tag: "SYNC",
        base: "rotaract_existing_clubs", target: "rotaract_new_clubs_target", targetCaption: "Proposed new",
        achieved: "rotaract_clubs_achieved", pct: "rotaract_clubs_pct", values: ["rotaract_total_clubs"] },
      { section: SECTIONS.reach, name: "Rotaractors", source: "Edit", applies: "Both", tag: "SYNC", note: "Rotary.org has no count - typed (user 2026-10-23)",
        base: "rotaract_existing_members", target: "rotaract_new_members_target", targetCaption: "Proposed new",
        achieved: "rotaract_members_achieved", pct: "rotaract_members_pct", values: ["rotaract_total_members"] },
      { section: SECTIONS.reach, name: "Interact clubs", oldName: "Interact", source: "Sync", applies: "Both", tag: "SYNC",
        base: "interact_existing_clubs", target: "interact_new_clubs_target", targetCaption: "Proposed new",
        achieved: "interact_clubs_achieved", pct: "interact_clubs_pct", values: ["interact_total_clubs"] },
      { section: SECTIONS.engage, name: "RCC (Rotary Community Corps)", oldName: "RCC", source: "Edit", applies: "Both", tag: "SYNC",
        note: "Rotary.org has no count - typed (user 2026-10-23)",
        base: "rcc_existing_clubs", target: "rcc_new_clubs_target", targetCaption: "Proposed new",
        achieved: "rcc_clubs_achieved", pct: "rcc_clubs_pct", values: ["rcc_total_clubs"] },
      rotaryOnly(SECTIONS.reach, "RYLA participation"),
      rotaryOnly(SECTIONS.impact, "Inbound Youth Exchange students"),
      rotaryOnly(SECTIONS.impact, "Outbound Youth Exchange students"),
    ],
  },
  {
    categoryId: 4, ourName: "Public Image", title: "Increase Our Ability to Adapt (Public Image)",
    rows: [
      pi("district_pi_seminar", SECTIONS.engage, "District", "District Public Image Seminar"),
      pi("specific_pi_session_training", SECTIONS.adapt, "District", "Public Image Session in Training Events"),
      pi("district_website", SECTIONS.adapt, "District", "District Website"),
      pi("district_social_media", SECTIONS.adapt, "District", "District Social Media"),
      pi("club_website_percent", SECTIONS.adapt, "District", "Club Website %"),
      pi("club_social_media_percent", SECTIONS.adapt, "District", "Club Social Media %"),
      pi("club_website", SECTIONS.adapt, "Club", "Club Website"),
      pi("club_social_media", SECTIONS.adapt, "Club", "Club Social Media"),
      pi("bulletin_newsletter", SECTIONS.adapt, "Both", "Bulletin / Monthly Newsletter"),
      pi("press_media_coverage", SECTIONS.reach, "Both", "Media stories about club projects"),
      pi("district_polio_awareness_programme", SECTIONS.adapt, "Both", "District Polio Awareness Programme"),
      pi("inter_district_pi_programme", SECTIONS.adapt, "District", "Inter District Public Image Programme"),
      pi("mega_pi_activities", SECTIONS.adapt, "Both", "Mega Public Image Activities"),
      pi("adoption_garden_park_road", SECTIONS.adapt, "Both", "Adoption - Garden / Park / Road"),
      pi("display_items", SECTIONS.adapt, "Both", "Display (Bus / Rail / Airport / Highways)"),
      pi("public_rally", SECTIONS.adapt, "Both", "Public Rally / Marathon / Human Chain / Car Rally", undefined),
      { section: SECTIONS.adapt, name: "Other Public Image activity (suggestions)", source: "Edit", applies: "Both",
        values: Array.from({ length: 10 }, (_, i) => `pi_suggestion_${i + 1}`) },
      // Press Meet shows our typed figure and the Rotary.org "Media stories" goal on one card (user 2026-10-30).
      rotaryOnly(SECTIONS.reach, "Media stories about club projects"),
      rotaryOnly(SECTIONS.impact, "Service projects", SERVICE),
      rotaryOnly(SECTIONS.engage, "Service participation", SERVICE),
      rotaryOnly(SECTIONS.engage, "Social activities"),
      rotaryOnly(SECTIONS.adapt, "Online presence", EGOV),
      rotaryOnly(SECTIONS.adapt, "Update website and social media"),
      rotaryOnly(SECTIONS.engage, "Use of official Rotary promotional materials"),
    ],
  },
];

// ── Tabs = the 4 Rotary.org sections (user 2026-10-30, option 2) ──
// Each question goes to its Rotary.org section; one tab holds the questions of every category in that
// section. Save / Lock / Messages / Month-wise stay per category (the existing APIs), so inside a tab
// the questions are shown category by category, each with its own lock.

export type SectionKey = "engage" | "impact" | "reach" | "adapt";
// Tab order = Membership, Foundation, Public Image, Youth Service (user 2026-10-30).
export const SECTION_TABS: { key: SectionKey; title: string }[] = [
  { key: "reach", title: SECTIONS.reach },
  { key: "impact", title: SECTIONS.impact },
  { key: "adapt", title: SECTIONS.adapt },
  { key: "engage", title: SECTIONS.engage },
];
const SECTION_KEY_OF: Record<string, SectionKey> = {
  [SECTIONS.engage]: "engage", [SECTIONS.impact]: "impact", [SECTIONS.reach]: "reach",
  [SECTIONS.adapt]: "adapt", [SECTIONS.summary]: "reach",
};
// A question not in the layout (e.g. the club Foundation Goal Amount) goes with its category.
const CATEGORY_SECTION: Record<number, SectionKey> = { 1: "reach", 210: "impact", 211: "reach", 4: "adapt" };

/** The tab a category's own controls sit in (Membership's month-wise → Expand Our Reach). */
export const homeSectionOf = (categoryId: number): SectionKey => CATEGORY_SECTION[categoryId] ?? "reach";

const rotaryKey = (name: string) => "rotary_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** The layout row a box belongs to (undefined = not in the layout, e.g. the club Foundation Goal Amount). */
function rowOfField(categoryId: number, fieldKey: string): GoalRow | undefined {
  const cat = GOAL_LAYOUT.find((c) => c.categoryId === categoryId);
  return cat?.rows.find((r) => r.source === "RotaryOnly"
    ? fieldKey === `${rotaryKey(r.name)}_target` || fieldKey === `${rotaryKey(r.name)}_achieved`
    : [r.base, r.target, r.achieved, r.pct, ...(r.values ?? [])].includes(fieldKey));
}

// Boxes filled by the daily member sync / the club-list sync - they pick which date a card shows.
const MEMBER_SYNC_KEYS = ["total_members", "existing_women_members"];
const CLUB_SYNC_KEYS = ["total_clubs", "rotaract_existing_clubs", "interact_existing_clubs"];
// District boxes the Youth import (Rotaract / Interact files) fills.
const YOUTH_IMPORT_KEYS = ["rotaract_existing_clubs", "rotaract_existing_members", "interact_existing_clubs"];

/** The message beside a card title (user 2026-10-30): where its figures come from and when.
 *  `forTotal` = a zone / all-districts total, which has no single "Edited by" date. */
export function cardSourceNote(c: SectionCard, dates: GoalSourceDates | null, forTotal = false): string | null {
  const form = c.form;
  const day = dayLabel;
  // When this card's own typed boxes (its Target) were last saved - the latest of them.
  const savedAt = c.fields.filter((f) => f.fieldId > 0 && f.fieldRole === "Target")
    .map((f) => dates?.savedByField?.[f.fieldId]).filter((x): x is string => !!x).sort().pop() ?? null;
  const who = form.clubId ? "Club Admin" : "District Admin";
  switch (cardSourceOf(form.categoryId, c.fields.map((f) => f.fieldKey))) {
    case "Sync": {
      // RAG = Rotary.org's own band counts (the RCC fetch), so its date is that fetch's. Members / women =
      // the last GOOD member sync of this club (district = its oldest club); club counts = the club-list
      // sync (user 2026-11-03).
      const keys = c.fields.map((f) => f.fieldKey);
      const pick = (v: string | null | undefined) => (v === undefined ? dates?.rotaryOrgSync : v);
      // A DISTRICT's clubs / members / women / Rotaract / Interact come from the Rotary.org Excel import
      // (2026-27 on), so its card shows that import's month-end date; same sentence (user 2026-11-04).
      const isYouth = YOUTH_IMPORT_KEYS.some((k) => keys.includes(k));
      const imported = !form.clubId && (isYouth || MEMBER_SYNC_KEYS.some((k) => keys.includes(k)) || CLUB_SYNC_KEYS.some((k) => keys.includes(k)))
        ? dates?.imports?.[isYouth ? "Youth" : "Membership"] : undefined;
      // A finished DG "Sync from Rotary.org" for this district dates every Sync card (user 2026-11-06).
      const d = day(dates?.dgSync ? dates.dgSync
        : c.name === "RAG Analysis" && form.rotaryOrgUpdatedAt ? form.rotaryOrgUpdatedAt
        : imported ? imported
        : MEMBER_SYNC_KEYS.some((k) => keys.includes(k)) ? pick(dates?.memberSync)
        : CLUB_SYNC_KEYS.some((k) => keys.includes(k)) ? pick(dates?.clubSync)
        : dates?.rotaryOrgSync);
      return d ? `Updated from Rotary.org on ${d}` : "Updated from Rotary.org";
    }
    case "Import": {
      const d = day(dates?.imports?.[importScopeOf(form.categoryId, !!form.clubId)]);
      return d ? `Updated from RISAO on ${d}` : "Updated from RISAO";
    }
    case "Edit": {
      if (forTotal) return `Entered by ${who}`;
      const d = day(savedAt);
      return d ? `Edited by ${who} on ${d}` : `Entered by ${who}`;
    }
    case "Auto": return "Auto-calculated by ROW";
    default: return null;
  }
}

/** The RISAO / Rotary.org file a category's imported figures come from (goal_foundation_import_months.Scope). */
export const importScopeOf = (categoryId: number, isClub: boolean) =>
  categoryId === 210 ? (isClub ? "Club" : "District") : categoryId === 211 ? "Youth" : "Membership";
/** "30 Oct 2026" from an API date, or null. */
export function dayLabel(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${String(d.getDate()).padStart(2, "0")} ${m} ${d.getFullYear()}`;
}

/** How a card's own figures come (Sync / Import / Edit / Auto), from its first non-Rotary.org box. */
export function cardSourceOf(categoryId: number, fieldKeys: string[]): DataSource | undefined {
  for (const k of fieldKeys) {
    if (k.startsWith("rotary_")) continue;
    const r = rowOfField(categoryId, k);
    if (r) return r.noteSource ?? r.source;
  }
  return undefined;
}

/** The Rotary.org section a box belongs to. */
export function sectionOfField(categoryId: number, fieldKey: string): SectionKey {
  if (fieldKey.startsWith("rag5_")) return "reach";
  const r = rowOfField(categoryId, fieldKey);
  return (r && SECTION_KEY_OF[r.section]) ?? CATEGORY_SECTION[categoryId] ?? "reach";
}

/** Our category's short name ("Foundation" for TRF), shown on each category block inside a tab. */
export function categoryShortName(categoryId: number, name: string): string {
  return GOAL_LAYOUT.find((c) => c.categoryId === categoryId)?.ourName ?? name;
}

/** One card on screen: a Rotary.org field (sheet "New", user 2026-10-30) with its boxes. */
export interface SectionCard { form: GoalCategoryFormDto; name: string; fields: GoalFieldWithValueDto[] }
/** One tab: its cards in the sheet order, the names for the tab heading (our categories, then
 *  "E-Governance" / "Service Projects" / "Other Rotary.org goals") and the category forms whose Lock
 *  sits on the tab (Save / Lock stay per category). */
export interface SectionView {
  key: SectionKey; no: number; title: string;
  labels: string[]; owners: GoalCategoryFormDto[]; cards: SectionCard[];
}

// Card order inside a tab = sheet "New" (district), club-only cards next to their district twins;
// Summary and the Public Image suggestions (not in the sheet) come last.
const CARD_ORDER = [
  "Clubs", "Members", "Women Members", "RAG Analysis",
  "Annual Fund contributions", "PolioPlus Fund contributions", "AF Per Capita", "Other Funds", "Endowment Fund", "CSR", "Total Giving",
  "Rotaract clubs", "Rotaractors", "Interact clubs", "RCC (Rotary Community Corps)",
  "District Public Image Seminar", "Public Image Session in Training Events", "District Website", "District Social Media",
  "Club Website %", "Club Social Media %", "Club Website", "Club Social Media", "Bulletin / Monthly Newsletter",
  "Media stories about club projects", "District Polio Awareness Programme", "Inter District Public Image Programme",
  "Mega Public Image Activities", "Adoption - Garden / Park / Road", "Display (Bus / Rail / Airport / Highways)",
  "Public Rally / Marathon / Human Chain / Car Rally",
  "Major gifts", "Bequest Society members", "Benefactors", "Service projects", "Service participation", "Social activities",
  "New member sponsorship", "Leadership development participation", "District conference attendance",
  "District training participation", "Rotary Action Group participation", "Rotary Fellowship participation",
  "RYLA participation", "Inbound Youth Exchange students", "Outbound Youth Exchange students",
  "Strategic plan", "Club bylaws review", "Online presence", "Update website and social media",
  "Use of official Rotary promotional materials",
  "Summary", "Other Public Image activity (suggestions)",
];

export const isClubFoundationForm = (form: GoalCategoryFormDto) => form.fields.some((f) => f.fieldKey === "club_af_goal_amount");
export const isSuggestionCard = (c: { fields: GoalFieldWithValueDto[] }) => c.fields.every((f) => f.fieldKey.startsWith("pi_suggestion_"));
export const isRotaryOnlyCard = (c: { fields: GoalFieldWithValueDto[] }) => c.fields.every((f) => f.fieldKey.startsWith("rotary_"));

function cardNameOf(form: GoalCategoryFormDto, f: GoalFieldWithValueDto): string {
  // The club Foundation (MCR) boxes stay in their one table, under Annual Fund contributions.
  if (isClubFoundationForm(form) && !f.fieldKey.startsWith("rotary_")) return "Annual Fund contributions";
  const r = rowOfField(form.categoryId, f.fieldKey);
  return r ? (r.card ?? r.name) || f.groupName : f.groupName;
}

/** Splits the forms into the 4 section tabs. A box is skipped when `skip` says so (future-year
 *  July-1st boxes, removed fields). Every box is numbered "<tab no>.<n>" in the order it is shown, so a
 *  box has the same number on every screen (Suggestions are a list, not numbered). */
export function buildSections(forms: GoalCategoryFormDto[], skip: (form: GoalCategoryFormDto, f: GoalFieldWithValueDto) => boolean): SectionView[] {
  return SECTION_TABS.map((s, i) => {
    const cards = new Map<string, SectionCard>();
    const own: string[] = [], other: string[] = [];
    const owners: GoalCategoryFormDto[] = [];
    for (const form of forms) {
      const catName = categoryShortName(form.categoryId, form.categoryName);
      for (const f of form.fields) {
        if (skip(form, f) || sectionOfField(form.categoryId, f.fieldKey) !== s.key) continue;
        const group = rowOfField(form.categoryId, f.fieldKey)?.group;
        if (group) { if (!other.includes(group)) other.push(group); }
        else {
          if (!own.includes(catName)) own.push(catName);
          if (!owners.includes(form)) owners.push(form);
        }
        const name = cardNameOf(form, f);
        const c = cards.get(name);
        if (c) c.fields.push(f); else cards.set(name, { form, name, fields: [f] });
      }
    }
    const rank = (n: string) => { const x = CARD_ORDER.indexOf(n); return x < 0 ? CARD_ORDER.length - 2 : x; };
    let n = 0;
    const sorted = Array.from(cards.values())
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map((c) => (isSuggestionCard(c) ? c : { ...c, fields: c.fields.map((f) => ({ ...f, fieldLabel: `${i + 1}.${++n} ${f.fieldLabel}` })) }));
    return { key: s.key, no: i + 1, title: s.title, labels: [...own, ...other], owners, cards: sorted };
  });
}

/** Tab / section heading with its categories named once (user 2026-10-30):
 *  "3. Expand Our Reach (Membership, Youth Service, Public Image)". */
export function sectionHeading(s: SectionView): string {
  return `${s.no}. ${s.title} (${SECTION_CATEGORY[s.key]})`;
}
// One category per section in the tab name (user 2026-10-30).
const SECTION_CATEGORY: Record<SectionKey, string> = {
  engage: "Youth Service", impact: "Foundation", reach: "Membership", adapt: "Public Image",
};
/** The category whose Locked / Unlocked (and Lock button) a tab shows - only the tab's own one
 *  (user 2026-10-30); the other categories' questions in the tab still follow their own lock. */
export const SECTION_CATEGORY_ID: Record<SectionKey, number> = { engage: 211, impact: 210, reach: 1, adapt: 4 };
export const sectionLockForms = (s: SectionView) => s.owners.filter((f) => f.categoryId === SECTION_CATEGORY_ID[s.key]);

// ── Helpers for the copied Goal Setting panel (same design as the existing screen) ──

// Symbol in front of every field label, so testers see how its value comes (user 2026-10-23).
export const SOURCE_SYMBOL: Record<"Sync" | "Import" | "Edit" | "Auto", string> = {
  // ROW: plain text symbols, not emoji (FRONTEND-RULES #9).
  Sync: "↻", Import: "⇩", Edit: "✎", Auto: "∑",
};
/** A label without its serial number ("1.1 ") and source symbol - for viewers who don't type values
 *  (Super Admin / RI / zone on Goal Overview, user 2026-11-03). District / Club Admin keep both. */
export const plainLabel = (l: string) => {
  let t = l.replace(/^\s*\d+\.\d+\s+/, "");
  for (const sym of Object.values(SOURCE_SYMBOL)) if (t.startsWith(sym)) { t = t.slice(sym.length).trimStart(); break; }
  return t;
};
export const SOURCE_LEGEND: { symbol: string; text: string }[] = [
  { symbol: SOURCE_SYMBOL.Sync, text: "Daily sync from Rotary.org" },
  { symbol: SOURCE_SYMBOL.Import, text: "Import Excel monthly (RISAO)" },
  { symbol: SOURCE_SYMBOL.Edit, text: "Typed by District / Club Admin" },
  { symbol: SOURCE_SYMBOL.Auto, text: "Auto-calculated by ROW" },
];

/** How one field's value comes: Sync / Import rows give their "as on July 1st" + Achieved values;
 *  the Target is always typed by the admin; % Achieved and summaries are worked out. A field not in
 *  the layout: Computed = Auto, anything else = Edit. */
function sourceOfField(categoryId: number, f: GoalFieldWithValueDto): keyof typeof SOURCE_SYMBOL {
  const cat = GOAL_LAYOUT.find((c) => c.categoryId === categoryId);
  for (const r of cat?.rows ?? []) {
    const own = r.source === "RotaryOnly" ? "Sync" : r.source;
    if (r.pct === f.fieldKey) return "Auto";
    if (r.target === f.fieldKey) return r.source === "Auto" ? "Auto" : "Edit";
    if (r.base === f.fieldKey || r.achieved === f.fieldKey || r.values?.includes(f.fieldKey)) return own;
  }
  return f.fieldRole === "Computed" ? "Auto" : "Edit";
}

/** The form with the new Rotary.org goals of its category added at the end - one box each with
 *  "Target for the Current year" + "Achieved". They are read-only (Computed) with negative ids, so
 *  they are never sent on Save; their values come from the Rotary.org (RCC) figures.
 *  Every label also gets its source symbol (🔄 / 📥 / ✏️ / 🧮); the serial number is added by
 *  buildSections, per section tab. */
export function withRotaryFields(form: GoalCategoryFormDto): GoalCategoryFormDto {
  return addRotaryFields(labelSources(ragFiveBands(form)));
}

// RAG Analysis = Rotary.org's 5 club-size bands (user 2026-10-26/29) in place of RED / AMBER / GREEN.
// Names: until the user sends the Clubs in District report's own legend wording.
export const RAG_BANDS = [
  { key: "rag5_red", label: "Red 0-10", color: "#D9302C", api: "red" },
  { key: "rag5_yellow", label: "Yellow 11-25", color: "#F2C230", api: "yellow" },
  { key: "rag5_orange", label: "Orange 26-50", color: "#F08A24", api: "orange" },
  { key: "rag5_blue", label: "Blue 51-100", color: "#2F6FD6", api: "blue" },
  { key: "rag5_purple", label: "Purple 101+", color: "#7C3AED", api: "purple" },
] as const;

/** The old RED / AMBER / GREEN boxes swapped for the 5 bands, in the same place. Read-only (Computed,
 *  negative ids), so never sent on Save; the old rag_* entries are left as they are. Values come from
 *  applyRagBands once the counts are loaded. */
function ragFiveBands(form: GoalCategoryFormDto): GoalCategoryFormDto {
  const at = form.fields.findIndex((f) => f.fieldKey.startsWith("rag_"));
  if (at < 0) return form;
  const old = form.fields[at];
  const bands = RAG_BANDS.map((b, i) => ({
    ...old, fieldId: -(form.categoryId * 1000 + 900 + i), fieldKey: b.key, fieldLabel: b.label,
    dataType: "Integer" as const, unit: "nos", fieldRole: "Computed" as const,
    numericValue: null, textValue: null, boolValue: null, minValue: null,
  }));
  const rest = form.fields.filter((f) => !f.fieldKey.startsWith("rag_"));
  return { ...form, fields: [...rest.slice(0, at), ...(bands as GoalFieldWithValueDto[]), ...rest.slice(at)] };
}

// RCC item name of a Rotary.org-only box, when it differs from the box name.
const RCC_ITEM: Record<string, string> = { "Club bylaws review": "Review and consider updating your club bylaws" };
// Asked as Yes / No per club in RCC (a district shows how many clubs said Yes / set the goal).
const RCC_YES_NO = new Set(["Strategic plan", "Online presence", "Club bylaws review", "Use of official Rotary promotional materials"]);
// Past years: Rotary.org history fills OUR boxes only where they are empty (user 2026-10-29).
const HISTORY_FILL: Record<string, string> = {
  total_members: "Members 1 July", new_members_achieved: "Members now / 30 June", new_women_members_achieved: "Female",
};

/** Loads what the new screens add to a form: the 5 RAG bands (district; this year = our live count,
 *  a past year = Rotary.org history) and the Rotary.org figures from the RCC fetch (Rotary.org-only
 *  goals; a past year also fills our own empty membership boxes). A failed call leaves the boxes empty. */
// The 4 categories of one district / club load together, so their Rotary.org figures and RAG counts
// are fetched once and shared for a minute.
const shared = new Map<string, { at: number; p: Promise<unknown> }>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p as Promise<T>;
  const p = load();
  shared.set(key, { at: Date.now(), p });
  p.catch(() => shared.delete(key));
  return p;
}

/** The Rotary.org figures of one district / club and year, shared with withRag (same 1-minute cache).
 *  Used by the new RCC tab (user 2026-11-16). */
export function getRotaryOrgValuesShared(yearId: number, districtId: number | null, clubId: number | null): Promise<GoalRotaryOrgValues> {
  return once(`org-${yearId}-${clubId ? `c${clubId}` : `d${districtId}`}`,
    () => getGoalRotaryOrgValues(yearId, clubId ? null : districtId, clubId));
}

export async function withRag(f: GoalCategoryFormDto): Promise<GoalCategoryFormDto> {
  if (!f.districtId && !f.clubId) return f;
  let org: GoalRotaryOrgValues | null = null;
  try {
    org = await once(`org-${f.yearId}-${f.clubId ? `c${f.clubId}` : `d${f.districtId}`}`,
      () => getGoalRotaryOrgValues(f.yearId, f.clubId ? null : f.districtId, f.clubId));
  } catch { /* none */ }
  const val = (item: string, kind: string) => org?.values.find((v) => v.itemName === item && v.kind === kind)?.value ?? null;

  let out = f;
  const hasRag = !f.clubId && f.fields.some((x) => x.fieldKey === RAG_BANDS[0].key);
  // Rotary.org's own band counts (user 2026-10-30: match Rotary.org, 107 clubs for D3142), every year;
  // our live member count only when Rotary.org has none for this district / year.
  const orgBands: Record<string, number> = {};
  if (hasRag && org) RAG_BANDS.forEach((b) => { const v = val(b.label, "Value"); if (v != null) orgBands[b.api] = v; });
  if (Object.keys(orgBands).length > 0) {
    out = applyRagBands(out, orgBands);
  } else if (hasRag && f.districtId && (!org || org.isCurrentYear)) {
    const districtId = f.districtId;
    try { out = applyRagBands(out, (await once(`rag-${districtId}`, () => getGoalRotaryRagBands(districtId))) as unknown as Record<string, number>); } catch { /* none */ }
  }
  if (!org || org.values.length === 0) return out;

  const cat = GOAL_LAYOUT.find((c) => c.categoryId === f.categoryId);
  const names = new Map<string, string>();   // field key -> RCC item
  cat?.rows.filter((r) => r.source === "RotaryOnly").forEach((r) => {
    const key = rotaryKey(r.name);
    names.set(`${key}_target`, r.name); names.set(`${key}_achieved`, r.name);
  });
  return {
    ...out,
    rotaryOrgUpdatedAt: org.updatedAt,
    fields: out.fields.map((x) => {
      const name = names.get(x.fieldKey);
      if (name) {
        const v = val(RCC_ITEM[name] ?? name, x.fieldKey.endsWith("_target") ? "Target" : "Achieved");
        if (v == null) return x;
        // A club's Yes / No goal shows YES / NO; a district shows the number of clubs.
        return f.clubId && RCC_YES_NO.has(name)
          ? { ...x, dataType: "Boolean" as const, boolValue: v === 1, numericValue: null }
          : { ...x, numericValue: v };
      }
      const hist = !org!.isCurrentYear ? HISTORY_FILL[x.fieldKey] : undefined;
      if (hist && x.numericValue == null) {
        const v = val(hist, "Value");
        return v == null ? x : { ...x, numericValue: v };
      }
      return x;
    }),
  };
}

/** An "as on July 1st" box (or TRF "Highest") - the starting figure of a goal. */
export function isBaselineField(categoryId: number, fieldKey: string): boolean {
  return !!GOAL_LAYOUT.find((c) => c.categoryId === categoryId)?.rows.some((r) => r.base === fieldKey && !r.baseCaption);
}

/** A future Rotary year ("2027-28" while today is in 2026-27) has no "as on July 1st" figure yet,
 *  so those boxes / columns are not shown (user 2026-10-29). Year label "YYYY-YY". */
export function isFutureYearLabel(yearLabel: string | null | undefined, today = new Date()): boolean {
  const start = Number((yearLabel ?? "").slice(0, 4));
  if (!start) return false;
  const currentStart = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;   // Rotary year starts 1 July
  return start > currentStart;
}

/** Designation tags per category, as shown everywhere today (user 2026-10-19/22): zone level / district level. */
export const CATEGORY_TAGS: Record<number, { zone: string; district: string }> = {
  1: { zone: "RMC", district: "ARMC" },
  211: { zone: "YSC", district: "AYSC" },
  210: { zone: "RRFC · E/MGA · EPNC", district: "ARRFC · AE/MGA · AEPNC" },
  4: { zone: "RPIC", district: "ARPIC" },
};

/** Puts the district's band counts on the 5 RAG boxes. */
export function applyRagBands(form: GoalCategoryFormDto, rag: Record<string, number> | null): GoalCategoryFormDto {
  if (!rag) return form;
  return {
    ...form,
    fields: form.fields.map((f) => {
      const b = RAG_BANDS.find((x) => x.key === f.fieldKey);
      return b ? { ...f, numericValue: rag[b.api] ?? 0 } : f;
    }),
  };
}

function addRotaryFields(form: GoalCategoryFormDto): GoalCategoryFormDto {
  const labelled = form;
  const cat = GOAL_LAYOUT.find((c) => c.categoryId === form.categoryId);
  if (!cat) return labelled;
  const extra = cat.rows.filter((r) => r.source === "RotaryOnly").flatMap((r, i) => {
    const key = rotaryKey(r.name);
    const base = { groupName: `${r.name} (Rotary.org)`, dataType: "Integer" as const, unit: null, fieldRole: "Computed" as const,
                   numericValue: null, textValue: null, boolValue: null, minValue: null };
    return [
      { ...base, fieldId: -(form.categoryId * 1000 + i * 2 + 1), fieldKey: `${key}_target`, fieldLabel: `${SOURCE_SYMBOL.Sync} Target for the Current year` },
      { ...base, fieldId: -(form.categoryId * 1000 + i * 2 + 2), fieldKey: `${key}_achieved`, fieldLabel: `${SOURCE_SYMBOL.Sync} Achieved` },
    ];
  });
  return { ...labelled, fields: [...labelled.fields, ...(extra as GoalFieldWithValueDto[])] };
}

function labelSources(form: GoalCategoryFormDto): GoalCategoryFormDto {
  return {
    ...form,
    fields: form.fields.map((f) => ({ ...f, fieldLabel: `${SOURCE_SYMBOL[sourceOfField(form.categoryId, f)]} ${f.fieldLabel}` })),
  };
}

// Goal flow (RIZones 2026-11-17..20): "Target" reads "Goal" on the RCC / Disha screens; "Updated from X on" -> "as on".
export const goalWording = (l: string) => l.replace(/\bTargets\b/g, "Goals").replace(/\btargets\b/g, "goals")
  .replace(/\bTarget\b/g, "Goal").replace(/\btarget\b/g, "goal");
export const overviewLabel = (l: string) => goalWording(plainLabel(l));
export const asOnWording = (note: string | null | undefined): string | null =>
  note ? note.replace(/^Updated from (Rotary\.org|RISAO) on /, "Updated from $1 as on ") : note ?? null;
