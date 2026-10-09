import { dbDateTime } from "../common/binding";
import { InvalidOperationException } from "../common/exceptions";

/** Port of ProjectDateValidator.cs: project dates may not be in the future or before 1985. */
export const PROJECT_DATE_MIN_YEAR = 1985;
export const PROJECT_DATE_FUTURE_MESSAGE = "Project date cannot be in the future.";
export const PROJECT_DATE_OUT_OF_RANGE_MESSAGE = `Project date is not valid — please check the year (it must be ${PROJECT_DATE_MIN_YEAR} or later).`;

/** DateTime.TryParse for the shapes the web and app send: the "YYYY-MM-DD HH:mm:ss" form, or null when unparseable. */
export function tryParseDate(text: string | null | undefined): string | null {
  return dbDateTime(text);
}

/** Validate(DateTime?): compares the calendar date with today (UTC, ROW's server clock). */
export function validateProjectDate(date: string | null): string | null {
  if (!date) return null;
  const day = date.slice(0, 10);
  if (day > new Date().toISOString().slice(0, 10)) return PROJECT_DATE_FUTURE_MESSAGE;
  if (Number(day.slice(0, 4)) < PROJECT_DATE_MIN_YEAR) return PROJECT_DATE_OUT_OF_RANGE_MESSAGE;
  return null;
}

/** ValidateText: blank or unparseable text passes (the caller decides what to do with it). */
export function validateProjectDateText(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  return validateProjectDate(tryParseDate(text));
}

export function throwIfInvalidProjectDate(date: string | null) {
  const error = validateProjectDate(date);
  if (error) throw new InvalidOperationException(error);
}
