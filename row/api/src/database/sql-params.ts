/**
 * Converts SQL written for Dapper + MySqlConnector ("... WHERE id = @Id AND x IN @Ids")
 * into mysql2's positional form ("... WHERE id = ? AND x IN (?,?,?)") so ported
 * queries are copied verbatim from the C# code.
 *
 * Matches MySqlConnector/Dapper behaviour:
 *  - parameter names are case-insensitive;
 *  - "@Name" is a parameter only when the parameters object has that name; any
 *    other "@name" is a MySQL user variable and is left alone (the RIZones
 *    connection string sets AllowUserVariables=true and the SQL uses them);
 *  - "@@system_var" is never a parameter;
 *  - text inside quotes, backticks and comments is never touched;
 *  - an array value expands to "(?,?,...)" as Dapper's list expansion does, and
 *    an empty array to a sub-select that matches nothing;
 *  - booleans are sent as 1/0, undefined as NULL.
 */

export type SqlParams = Record<string, unknown> | Map<string, unknown> | null | undefined;

export interface CompiledSql {
  sql: string;
  values: unknown[];
}

const IDENT = /[A-Za-z0-9_$]/;

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function lookup(params: SqlParams): (name: string) => { found: boolean; value: unknown } {
  if (!params) return () => ({ found: false, value: undefined });
  const map = new Map<string, unknown>();
  const entries = params instanceof Map ? [...params.entries()] : Object.entries(params);
  for (const [k, v] of entries) map.set(k.replace(/^[@:?]/, "").toLowerCase(), v);
  return (name) => {
    const key = name.toLowerCase();
    return map.has(key) ? { found: true, value: map.get(key) } : { found: false, value: undefined };
  };
}

export function compileSql(sql: string, params?: SqlParams): CompiledSql {
  const find = lookup(params);
  const values: unknown[] = [];
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // quoted text: '...', "...", `...` with doubled-quote and backslash escapes
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "\\" && c !== "`") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // comments: -- to end of line (MySQL needs a following space), # to end of line, /* ... */
    if ((c === "-" && next === "-" && /\s/.test(sql[i + 2] ?? " ")) || c === "#") {
      const end = sql.indexOf("\n", i);
      const j = end === -1 ? n : end;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    if (c === "@") {
      if (next === "@") {
        // system variable: copy "@@name"
        let j = i + 2;
        while (j < n && (IDENT.test(sql[j]) || sql[j] === ".")) j++;
        out += sql.slice(i, j);
        i = j;
        continue;
      }
      let j = i + 1;
      while (j < n && IDENT.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      const hit = name ? find(name) : { found: false, value: undefined };
      if (!hit.found) {
        out += sql.slice(i, j); // user variable
        i = j;
        continue;
      }
      if (isList(hit.value) && !(hit.value instanceof Buffer)) {
        if (hit.value.length === 0) {
          out += "(SELECT NULL FROM DUAL WHERE 1 = 0)";
        } else {
          out += "(" + hit.value.map(() => "?").join(",") + ")";
          for (const v of hit.value) values.push(normalise(v));
        }
      } else {
        out += "?";
        values.push(normalise(hit.value));
      }
      i = j;
      continue;
    }

    out += c;
    i++;
  }

  return { sql: out, values };
}
