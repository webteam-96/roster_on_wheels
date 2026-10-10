import { formatDate } from "./dotnet-format";
/**
 * Turning database rows into the JSON the .NET API returns.
 *
 * Two cases, as in the C# code:
 *  - Dapper `dynamic` rows (QueryAsync / QueryAsync<dynamic>): System.Text.Json
 *    writes them as dictionaries, so keys stay exactly as the column names.
 *    Return the rows unchanged.
 *  - Typed DTOs (QueryAsync<MemberDto>): Dapper fills the C# properties by
 *    column name (case-insensitive), properties with no column keep their C#
 *    default, and the JSON uses camelCase property names. Describe the DTO
 *    with defineDto() and map rows through it.
 */

/** Port of System.Text.Json's JsonNamingPolicy.CamelCase. */
export function camelCase(name: string): string {
  if (!name || !isUpper(name[0])) return name;
  const chars = [...name];
  for (let i = 0; i < chars.length; i++) {
    if (i === 1 && !isUpper(chars[i])) break;
    const hasNext = i + 1 < chars.length;
    // Stop when the next character is already lower case.
    if (i > 0 && hasNext && !isUpper(chars[i + 1])) {
      // If the next character is a space, lower-case the current one before stopping.
      if (chars[i + 1] === " ") chars[i] = chars[i].toLowerCase();
      break;
    }
    chars[i] = chars[i].toLowerCase();
  }
  return chars.join("");
}

function isUpper(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/**
 * C# property types. A trailing "?" is a nullable value type (int?, DateTime?);
 * "string" and "object" are reference types and default to null anyway.
 */
export type FieldType =
  | "int" | "int?" | "long" | "long?" | "decimal" | "decimal?" | "double" | "double?"
  | "bool" | "bool?" | "string" | "datetime" | "datetime?" | "timespan" | "timespan?"
  | "guid" | "object";

export const DEFAULT_DATETIME = "0001-01-01T00:00:00";

const DEFAULTS: Partial<Record<FieldType, unknown>> = {
  int: 0, long: 0, decimal: 0, double: 0, bool: false, datetime: DEFAULT_DATETIME,
  timespan: "00:00:00", guid: "00000000-0000-0000-0000-000000000000",
};

/** A DATE / DATETIME value as the DB layer hands it over ("yyyy-MM-ddTHH:mm:ss[.fff][Z]"). */
const DB_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

/**
 * fromDb: the value came from a query row. Dapper fills a C# string property from a DATETIME with
 * DateTime.ToString() (the culture's "G" pattern) and from a BIT/TINYINT(1) with "True" / "False".
 */
function convert(value: unknown, type: FieldType, fromDb = false): unknown {
  if (value === null || value === undefined) return type.endsWith("?") ? null : DEFAULTS[type] ?? null;
  const base = type.replace("?", "") as FieldType;
  switch (base) {
    case "int":
    case "long":
      return typeof value === "boolean" ? (value ? 1 : 0) : Math.trunc(Number(value));
    case "decimal":
    case "double":
      return typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
    case "bool":
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
      return Number(value) !== 0;
    case "string":
      if (fromDb && typeof value === "boolean") return value ? "True" : "False";
      if (fromDb && typeof value === "string" && DB_DATETIME.test(value)) return formatDate(value.replace(/Z$/, ""), "G");
      return typeof value === "string" ? value : String(value);
    default:
      return value;
  }
}

export type DtoSpec = Record<string, FieldType | { type: FieldType; default: () => unknown }>;
export type DtoObject = Record<string, unknown>;

export interface Dto<S extends DtoSpec> {
  readonly spec: S;
  /** One row -> the DTO's JSON form (camelCase keys, in declaration order). */
  map(row: Record<string, unknown> | null | undefined): DtoObject | null;
  /** Many rows. */
  mapAll(rows: readonly Record<string, unknown>[]): DtoObject[];
  /** A DTO built in code (new XDto { ... }), from PascalCase or camelCase keys; unspecified properties get their default. */
  create(values: Record<string, unknown>): DtoObject;
}

/**
 * Describe a C# DTO by its properties, in declaration order:
 *
 *   const MemberListItemDto = defineDto({
 *     Id: "int", MemberName: "string", BirthDate: "datetime?", IsActive: "bool",
 *     Roles: { type: "object", default: () => [] },   // public List<string> Roles { get; set; } = new();
 *   });
 */
export function defineDto<S extends DtoSpec>(spec: S): Dto<S> {
  const fields = Object.entries(spec).map(([prop, t]) => ({
    prop,
    json: camelCase(prop),
    lower: prop.toLowerCase(),
    type: typeof t === "string" ? t : t.type,
    initial: typeof t === "string" ? undefined : t.default,
  }));

  const build = (find: (lowerProp: string) => { found: boolean; value: unknown }, fromDb: boolean) => {
    const out: DtoObject = {};
    for (const f of fields) {
      const hit = find(f.lower);
      // Dapper leaves a member untouched when the column is NULL, so a property initializer (= "") survives.
      const useDefault = !hit.found || (fromDb && (hit.value === null || hit.value === undefined));
      out[f.json] = !useDefault ? convert(hit.value, f.type, fromDb) : f.initial ? f.initial() : convert(undefined, f.type);
    }
    return out;
  };

  const fromRow = (row: Record<string, unknown>, fromDb: boolean) => {
    const byLower = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) if (!byLower.has(k.toLowerCase())) byLower.set(k.toLowerCase(), v);
    return build((l) => ({ found: byLower.has(l), value: byLower.get(l) }), fromDb);
  };

  return {
    spec,
    map: (row) => (row ? fromRow(row, true) : null),
    mapAll: (rows) => rows.map((r) => fromRow(r, true)),
    create: (values) => fromRow(values, false),
  };
}
