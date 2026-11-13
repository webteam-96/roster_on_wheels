/**
 * Year-wise Admin Rights — the "View only" wording, as the SuperAdmin wrote it.
 *
 * The four sentences used to be hardcoded in `ViewOnlyBadge` here and in
 * `view_only_notice.dart` on mobile. Changing a word meant a web deploy plus an
 * app-store release, and the two had already drifted apart. SuperAdmin now edits
 * them on Settings → Year-wise Admin Rights; the server sends them with every
 * /api/auth/my-context, and both clients render the same text.
 *
 * ⚠️ WORDING ONLY. Nothing here decides a permission — `adminYears.ts` decides
 * what is editable and the server decides what is saved. This module only
 * explains a refusal to a reader.
 *
 * ── Templates, not finished sentences ───────────────────────────────────────
 * The server does not know which screen is asking, so it sends templates and we
 * substitute. The mobile twin implements the SAME rules, including the cleanup
 * pass — change one, change both:
 *
 *   {year}        the Rotary year on screen        → "this Rotary year"
 *   {currentYear} the current Rotary year's label  → "the current year"
 *   {years}       the years this member may edit   → "" (then cleaned up)
 *   {actions}     what is being withheld           → defaultActions
 */

export interface YearRuleMessages {
  /** Data with NO Rotary year of its own. Only a CURRENT-year admin may change it. */
  currentYearOnly: string;
  /** A year this member cannot edit, and they hold others. */
  wrongYearWithYears: string;
  /** A year this member cannot edit, and they hold none. */
  wrongYearNoYears: string;
  /** What `{actions}` falls back to when a screen names no action of its own. */
  defaultActions: string;
}

/**
 * The factory wording — WHAT THIS BADGE ALREADY SAID before the feature existed,
 * so nothing changed on screen the day it shipped.
 *
 * ⚠️ Also in SQL/year_rule_messages.sql, DatabaseInitializer, YearRuleMessagesHelper
 * and the mobile twin. Change one, change all of them.
 */
export const DEFAULT_YEAR_RULE_MESSAGES: YearRuleMessages = {
  currentYearOnly:
    "View only: Only an admin for the current year ({currentYear}) can {actions}.",
  wrongYearWithYears:
    "View only: you are not an admin for {year}, so you cannot add, edit or delete these records. You can make changes in {years}.",
  wrongYearNoYears:
    "View only: you are not an admin for {year}, so you cannot add, edit or delete these records.",
  defaultActions: "add, edit or delete it",
};

const STORAGE_KEY = "year_rule_messages";

/**
 * Keep what my-context just sent.
 *
 * Stored rather than held in React state because the badge renders on 73 screens
 * and must not wait for a context refresh to say the right thing — and because a
 * hard reload would otherwise show the factory wording for a moment.
 *
 * Ignores a payload that is not an object, and keeps the existing copy when a
 * field is missing, so a partial response can never blank the wording.
 */
export function cacheYearRuleMessages(raw: unknown): void {
  if (typeof window === "undefined" || !raw || typeof raw !== "object") return;
  const incoming = raw as Record<string, unknown>;
  const merged: YearRuleMessages = {
    ...DEFAULT_YEAR_RULE_MESSAGES,
    ...readStored(),
    ...pickStrings(incoming),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Private mode / quota. The badge falls back to the defaults, which are the
    // same words it showed before any of this existed.
  }
}

/**
 * The wording to render. Always complete: every missing or blank field falls back
 * to its default, so the badge can never render empty.
 */
export function getYearRuleMessages(): YearRuleMessages {
  return { ...DEFAULT_YEAR_RULE_MESSAGES, ...readStored() };
}

function readStored(): Partial<YearRuleMessages> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? pickStrings(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Only non-blank strings survive, so a null or "" from anywhere means "use the default". */
function pickStrings(src: Record<string, unknown>): Partial<YearRuleMessages> {
  const out: Partial<YearRuleMessages> = {};
  const keys: (keyof YearRuleMessages)[] = [
    "currentYearOnly", "wrongYearWithYears", "wrongYearNoYears", "defaultActions",
  ];
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export interface YearRuleTokens {
  /** The Rotary year on screen, e.g. "2024-25". */
  year?: string;
  /** The current Rotary year, e.g. "2026-27". */
  currentYear?: string;
  /** The years this member may edit here. */
  years?: string[];
  /** What is being withheld, written to follow "can". */
  actions?: string;
}

/**
 * Fill a template's tokens and tidy up what a missing one leaves behind.
 *
 * The cleanup is the whole reason this is a function and not a chain of
 * `.replace()` calls at the call site. A SuperAdmin writes
 * "...current year ({currentYear}) can {actions}." and a screen that does not
 * know the current year would otherwise render "current year () can" — so empty
 * brackets, doubled spaces and a space before punctuation are all swept up.
 *
 * ⚠️ An unknown {token} is left exactly as written. It shows up in the settings
 * page's preview, which is where a typo should be caught — blanking it would eat
 * a word silently and nobody would know why the sentence reads oddly.
 */
export function renderYearRuleMessage(
  template: string,
  tokens: YearRuleTokens,
  /** The live wording, so a caller holding it already need not re-read storage. */
  messages: YearRuleMessages = getYearRuleMessages(),
): string {
  const years = (tokens.years ?? []).map((y) => y.trim()).filter(Boolean);

  const filled = template
    .replace(/\{year\}/g, tokens.year?.trim() || "this Rotary year")
    .replace(/\{currentYear\}/g, tokens.currentYear?.trim() || "the current year")
    .replace(/\{years\}/g, years.join(", "))
    .replace(/\{actions\}/g, tokens.actions?.trim() || messages.defaultActions);

  return tidy(filled);
}

/**
 * Sweep up the gaps an empty token leaves. Shared with the mobile twin — keep the
 * two in step, or the same wording reads differently on a phone.
 */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")          // "current year ()" → "current year"
    .replace(/\s+([.,;:!?])/g, "$1")  // " ." → "."
    .replace(/\s{2,}/g, " ")          // doubled spaces from a dropped token
    .trim();
}
