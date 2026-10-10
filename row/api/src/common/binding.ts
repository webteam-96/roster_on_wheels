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

/**
 * Query values ASP.NET treats as implicitly [Required] (non-nullable string / collection parameters, nullable
 * context on): missing or empty → 400 ValidationProblem naming every missing field, before the action runs.
 */
export function requireQuery(fields: Record<string, string | string[] | undefined | null>): void {
  const errors: Record<string, string[]> = {};
  for (const [name, v] of Object.entries(fields)) {
    const value = Array.isArray(v) ? v.filter((x) => x !== "") : v;
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) errors[name] = [`The ${name} field is required.`];
  }
  if (Object.keys(errors).length) throw new ActionResultError(new ValidationProblemResult(errors));
}

/**
 * A [FromBody] List<T> parameter: anything but a JSON array is a 400 ValidationProblem worded as
 * System.Text.Json words it (netType = the .NET type name, e.g. "System.Collections.Generic.List`1[...]").
 */
export function requireArrayBody(body: unknown, netType: string, param: string): unknown[] {
  if (Array.isArray(body)) return body;
  const required = { [param]: [`The ${param} field is required.`] };
  if (body === undefined || body === null)
    throw new ActionResultError(new ValidationProblemResult({ "": ["A non-empty request body is required."], ...required }));
  // The reader stops after the first token: one byte for "{", the token's own length for a scalar.
  const pos = typeof body === "object" ? 1 : JSON.stringify(body).length;
  throw new ActionResultError(new ValidationProblemResult({ $: [`The JSON value could not be converted to ${netType}. Path: $ | LineNumber: 0 | BytePositionInLine: ${pos}.`], ...required }));
}

/**
 * A date/time from a request body, ready for a DATETIME/DATE column: values
 * with an offset or "Z" are converted to UTC (ROW stores UTC); values without
 * one are taken as written. Empty or unparseable -> null.
 */
export function dbDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", sec = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${sec}`;
}

/** A calendar date from a request body ("YYYY-MM-DD"), never shifted by a zone. */
export function dbDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return m ? m[1] : null;
}

/** A TimeSpan from a request body ("HH:mm" / "HH:mm:ss") -> "HH:mm:ss", else null. */
export function dbTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}` : null;
}

/** A JSON body property by name, any casing (System.Text.Json is case-insensitive). */
export function bodyField(body: unknown, name: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  const lower = name.toLowerCase();
  return Object.entries(body as Record<string, unknown>).find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** A List<int> body property; missing or not an array gives []. */
export function bodyIntList(body: unknown, name: string): number[] {
  const v = bodyField(body, name);
  return Array.isArray(v) ? v.map(Number).filter(Number.isFinite).map(Math.trunc) : [];
}

/** A non-nullable IFormFile parameter: [ApiController] model validation answers before the action runs. */
export function requireFile(file: unknown, name = "file"): void {
  if (!file) throw new ActionResultError(new ValidationProblemResult({ [name]: [`The ${name} field is required.`] }));
}
