import { ActionResultError, EmptyResult, ValidationProblemResult } from "./results";

/**
 * Model binding as ASP.NET does it for route and query values.
 */

/** A route value with an :int constraint. Not an int -> the route does not match -> empty 404. */
export function routeInt(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) throw new ActionResultError(new EmptyResult(404));
  const n = Number(value);
  if (n > 2147483647 || n < -2147483648) throw new ActionResultError(new EmptyResult(404));
  return n;
}

/** [FromQuery] int x = fallback: absent -> fallback; present but invalid -> 400 like model validation. */
export function queryInt(value: string | string[] | undefined, fallback: number): number;
export function queryInt(value: string | string[] | undefined, fallback?: null): number | null;
export function queryInt(value: string | string[] | undefined, fallback: number | null = null): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined || v === "") return fallback;
  if (!/^\s*-?\d+\s*$/.test(v)) throw new ActionResultError(new EmptyResult(400));
  return parseInt(v, 10);
}

/** [FromQuery] decimal? x */
export function queryNumber(value: string | string[] | undefined, fallback: number | null = null): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ActionResultError(new EmptyResult(400));
  return n;
}

/** [FromQuery] bool x = fallback: "true"/"false" (case-insensitive); anything else -> 400. */
export function queryBool(value: string | string[] | undefined, fallback: boolean | null = null): boolean | null {
  const v = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ActionResultError(new EmptyResult(400));
}

/** [FromQuery] string x = fallback */
export function queryString(value: string | string[] | undefined, fallback: string | null = null): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined ? fallback : v;
}

/**
 * [FromQuery] DateTime? x: parsed as DateTime.Parse would for the usual forms
 * ("2026-09-30", "2026-09-30T14:00"), returned as a MySQL-ready
 * "YYYY-MM-DD HH:MM:SS" string, or null. Invalid -> 400.
 */
export function queryDate(value: string | string[] | undefined): string | null {
  const v = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) throw new ActionResultError(new EmptyResult(400));
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * An action parameter bound from the route without a constraint ("{id}" with
 * int id): a value that is not an int fails model validation, which
 * [ApiController] answers with a 400 ProblemDetails naming the field.
 */
export function paramInt(value: string | undefined, name = "id"): number {
  if (value !== undefined && /^\s*-?\d+\s*$/.test(value)) {
    const n = Number(value);
    if (n <= 2147483647 && n >= -2147483648) return n;
  }
  throw new ActionResultError(
    new ValidationProblemResult({ [name]: [`The value '${value ?? ""}' is not valid.`] }),
  );
}
