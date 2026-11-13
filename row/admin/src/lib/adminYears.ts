/**
 * Year-wise Admin Rights — the client's view of them.
 *
 * ⚠️ This is for SHOWING and HIDING only. The server decides. Every write is
 * checked by AdminYearGuard, and a hidden button is not a permission. The point
 * of these helpers is that someone should not be offered an action that will be
 * refused a moment later.
 *
 * Rule of the module: hiding an EDIT must never hide the VIEW with it. A year an
 * admin cannot edit is still a year they can read, and a list with no way into a
 * record is worse than useless.
 */

import type { RoleScopeDto } from "@/types/scope";

export interface YearRights {
  /** Every Rotary year — a SuperAdmin, or an Executive Secretary. */
  allYears: boolean;
  yearIds: number[];
  /** Where the rights come from, e.g. "Club President". For "view only" copy. */
  sources: string[];
  /**
   * True when the server told us nothing about years. An older API does not send
   * them, and we must not turn that silence into a lockout.
   */
  unknown: boolean;
  /**
   * The year rule is switched OFF for this scope (Settings -> Year-wise Admin
   * Rights), so there is no year context here at all.
   *
   * Deliberately NOT the same thing as `allYears`. allYears says which years may
   * be edited, and a SuperAdmin or a Club Executive Secretary holds every year
   * while the rule is still ON — they are exactly who the year-picker rule in
   * isCurrentYearSelected() was written for, so that rule cannot be keyed on
   * allYears. This flag can: it says the rule itself does not apply.
   *
   * Read ONLY by isCurrentYearSelected(). It is never a permission on its own —
   * it is false for a plain member whose club has the rule off, and even if it
   * were true, canEditYearless() would still refuse them.
   */
  ruleOff: boolean;
}

const NO_RIGHTS: YearRights = {
  allYears: false, yearIds: [], sources: [], unknown: false, ruleOff: false,
};

/** Collects the year rights a member holds in one club. */
export function clubYearRights(scopedRoles: RoleScopeDto[] | undefined, clubId: number): YearRights {
  return collect(scopedRoles, (r) => r.clubId === clubId);
}

/** Collects the year rights a member holds in one district. */
export function districtYearRights(scopedRoles: RoleScopeDto[] | undefined, districtId: number): YearRights {
  return collect(scopedRoles, (r) => r.districtId === districtId && !r.clubId);
}

function collect(
  scopedRoles: RoleScopeDto[] | undefined,
  match: (r: RoleScopeDto) => boolean,
): YearRights {
  if (!scopedRoles?.length) return NO_RIGHTS;

  const rows = scopedRoles.filter((r) => r.roleName === "Admin" && match(r));
  // No Admin row in this scope. Carries no rights, but still reports the rule's
  // state for a SuperAdmin, whose only row is the global one — otherwise the
  // switch would reach every admin's year picker except theirs.
  if (rows.length === 0) return { ...NO_RIGHTS, ruleOff: globalRuleOff(scopedRoles) };

  // A server that sends no year information at all. Say so rather than reporting
  // "no years", which callers would read as a lockout.
  const informed = rows.filter((r) => r.allYears !== undefined || r.yearIds !== undefined);
  if (informed.length === 0) return { ...NO_RIGHTS, unknown: true };

  const allYears = informed.some((r) => r.allYears === true);
  const yearIds = [...new Set(informed.flatMap((r) => r.yearIds ?? []))];
  const sources = [...new Set(informed.flatMap((r) => r.yearSources ?? []))];
  // EVERY row must say so, explicitly. `every` on a non-empty list, and `=== false`
  // rather than falsy, so a server that omits the field (or one row of a pair that
  // still has the rule on) leaves the year picker working exactly as it does today.
  const ruleOff = informed.every((r) => r.yearRuleEnabled === false);
  return { allYears, yearIds, sources, unknown: false, ruleOff };
}

/** The rule's state for a SuperAdmin, who holds no Admin row to read it from. */
function globalRuleOff(scopedRoles: RoleScopeDto[] | undefined): boolean {
  return scopedRoles?.some(
    (r) => r.roleName === "SuperAdmin" && r.yearRuleEnabled === false,
  ) ?? false;
}

/**
 * May this member change data belonging to `yearId`?
 *
 * `isSuperAdmin` short-circuits, and so does `unknown` — an API that has not been
 * upgraded yet must keep working exactly as before.
 */
export function canEditYear(
  rights: YearRights,
  yearId: number | null | undefined,
  isSuperAdmin = false,
): boolean {
  if (isSuperAdmin || rights.allYears || rights.unknown) return true;
  if (!yearId) return false;
  return rights.yearIds.includes(yearId);
}

/**
 * Data with no Rotary year of its own — club website, weblinks, sub-groups, TRF.
 * Mirrors AdminYearGuard.ClubYearlessAsync: editing it needs CURRENT-year rights.
 */
export function canEditYearless(
  rights: YearRights,
  currentYearId: number | null | undefined,
  isSuperAdmin = false,
): boolean {
  return canEditYear(rights, currentYearId, isSuperAdmin);
}

/**
 * Is the year on screen the CURRENT Rotary year?
 *
 * For data with no Rotary year of its own — announcements, documents, web links,
 * mass email, greetings, upcoming events — there is ONE live list, and the year
 * picker does not filter it. Editing follows canEditYearless (current-year
 * rights), which does not change when the picker moves. That left Add and Edit
 * showing while a past year was on screen, which reads as the year rule having
 * failed.
 *
 * So those screens hide their buttons while another year is selected. This is
 * about CONTEXT, not permission: whatever the picker says, the record being
 * added belongs to today — so the picker has to be on today.
 *
 * ⚠️ Returns TRUE while the current year is still loading, and TRUE when
 * nothing is selected (the picker's default IS the current year). Hiding on
 * "not known yet" would blink the buttons away on every page load.
 *
 * ⚠️ Also TRUE when the year rule is switched off for the scope (rights.ruleOff).
 * With no rule there is no year context to protect, so the picker should not be
 * hiding anything. Every one of the 11 screens that calls this passes `rights`;
 * a call that leaves it out keeps the picker rule unconditionally.
 */
export function isCurrentYearSelected(
  selectedYearId: number | null | undefined,
  currentYearId: number | null | undefined,
  rights?: YearRights,
): boolean {
  // The switch is OFF for this scope, so there is no year rule for the picker to
  // stand for and nothing here to keep in context — the picker stops gating. Pass
  // `rights` at every call site; omitting it keeps the old behaviour.
  if (rights?.ruleOff) return true;
  if (!currentYearId) return true;
  if (!selectedYearId) return true;
  return selectedYearId === currentYearId;
}

/** The years held, for "You can edit 2025-26" style copy. Empty when unrestricted. */
export function heldYearLabels(
  rights: YearRights,
  years: { id: number; label: string }[],
): string[] {
  if (rights.allYears || rights.unknown) return [];
  return years.filter((y) => rights.yearIds.includes(y.id)).map((y) => y.label);
}

/**
 * Which Rotary year does a date fall in?
 *
 * Mirrors AdminYearGuard.ClubYearForDateAsync: some records (newsletters) carry
 * no year of their own, and the DATE decides where they are filed. Returns
 * undefined when the date is missing or falls outside every known year — callers
 * treat that as "cannot determine", which hides the edit rather than offering
 * one the server will refuse.
 */
export function yearIdForDate(
  date: string | null | undefined,
  years: { id: number; startDate: string; endDate: string }[],
): number | undefined {
  const d = dateKey(date);
  if (d === undefined) return undefined;
  return years.find((y) => {
    const from = dateKey(y.startDate);
    const to = dateKey(y.endDate);
    return from !== undefined && to !== undefined && d >= from && d <= to;
  })?.id;
}

/**
 * A date as a plain YYYYMMDD number, ignoring time and timezone.
 *
 * ⚠️ This has to be date-only, and it has to read the calendar parts from the
 * STRING rather than going through Date. StartDate/EndDate are DATE columns, so
 * a year "ends" at 2026-06-30 00:00 — a newsletter published at 10am that day
 * compares as AFTER the year it is actually in. The server truncates to a date
 * before comparing (AdminYearGuard.ClubYearForDateAsync); the client must match,
 * or the buttons disagree with the server on the last day of every Rotary year.
 *
 * Parsing the string also avoids a timezone shifting the day by one.
 */
function dateKey(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) return Number(m[1] + m[2] + m[3]);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
}

/**
 * Which Rotary year is this LABEL?
 *
 * Club Dues stores its year as a label ("2026-27") rather than an id, so the
 * client has to resolve it the same way AdminYearGuard.DistrictYearByLabelAsync
 * does. An unknown label returns undefined, which callers treat as not editable.
 */
export function yearIdForLabel(
  label: string | null | undefined,
  years: { id: number; yearLabel: string }[],
): number | undefined {
  if (!label?.trim()) return undefined;
  const wanted = label.trim();
  return years.find((y) => y.yearLabel === wanted)?.id;
}
