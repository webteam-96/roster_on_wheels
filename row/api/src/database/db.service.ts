import { Injectable, OnModuleDestroy } from "@nestjs/common";
import mysql, { type Pool, type PoolConnection, type FieldPacket, type ResultSetHeader, type TypeCastField, type TypeCastNext } from "mysql2/promise";
import { AppConfig } from "../config/app-config";
import { compileSql, type SqlParams } from "./sql-params";
import { InvalidOperationException } from "../common/exceptions";
import { Brand } from "../brand/brand";

/** A database row as Dapper's `dynamic` would expose it: column name -> value. */
export type Row = Record<string, any>;

const ZERO_DATETIME = "0001-01-01T00:00:00";

/** "2026-09-30 14:00:00.120000" -> "2026-09-30T14:00:00.12" (System.Text.Json's DateTime form) */
export function toDotnetDateTime(mysqlValue: string): string {
  if (!mysqlValue || mysqlValue.startsWith("0000-00-00")) return ZERO_DATETIME;
  const [date, time = "00:00:00"] = mysqlValue.split(" ");
  const [hms, frac] = time.split(".");
  const fraction = frac ? frac.replace(/0+$/, "") : "";
  return `${date}T${hms}${fraction ? "." + fraction : ""}`;
}

/**
 * Values come back in the shapes the .NET API puts in its JSON (MySqlConnector
 * with Dapper and System.Text.Json):
 *   TINYINT(1) -> boolean (TreatTinyAsBoolean)       DATETIME/TIMESTAMP -> "2026-09-30T14:00:00"
 *                                                    (+ "Z" when timestamps are stored in UTC, the ROW default)
 *   DATE       -> "2026-09-30T00:00:00"              TIME -> "14:00:00"
 *   DECIMAL    -> number                             BIT  -> number
 *   JSON       -> the raw string                     zero dates -> "0001-01-01T00:00:00" (ConvertZeroDateTime)
 */
function makeTypeCast(utcTimestamps: boolean) {
  return (field: TypeCastField, next: TypeCastNext): unknown => typeCast(field, next, utcTimestamps);
}

function typeCast(field: TypeCastField, next: TypeCastNext, utcTimestamps: boolean): unknown {
  switch (field.type) {
    case "TINY":
      if (field.length === 1) {
        const v = field.string();
        return v === null ? null : v !== "0";
      }
      return next();
    case "DATETIME":
    case "TIMESTAMP": {
      const v = field.string();
      if (v === null) return null;
      const s = toDotnetDateTime(v);
      // Stored in UTC (session time_zone +00:00): say so, so clients convert to the viewer's zone.
      return utcTimestamps && s !== ZERO_DATETIME ? s + "Z" : s;
    }
    case "DATE": {
      const v = field.string();
      return v === null ? null : toDotnetDateTime(v);
    }
    case "TIME":
      return field.string();
    case "BIT": {
      const buf = field.buffer();
      if (buf === null) return null;
      let n = 0;
      for (const b of buf) n = n * 256 + b;
      return n;
    }
    case "JSON":
      return field.string("utf8");
    default:
      return next();
  }
}

function isResultSetHeader(x: unknown): x is ResultSetHeader {
  return !!x && typeof x === "object" && !Array.isArray(x) && "affectedRows" in (x as object);
}

/**
 * The methods a ported service uses, named after Dapper's. One instance works
 * on one connection (DbSession) or on the pool (Db).
 */
export abstract class DbCommands {
  protected abstract run(sql: string, values: unknown[]): Promise<[unknown, FieldPacket[] | undefined]>;
  protected abstract procedureParams(name: string): Promise<string[]>;

  /** connection.QueryAsync(sql, param) */
  async query<T = Row>(sql: string, params?: SqlParams): Promise<T[]> {
    const sets = await this.queryMultiple<T>(sql, params);
    return sets.length ? sets[sets.length - 1] : [];
  }

  /** connection.QueryFirstOrDefaultAsync: first row or null. */
  async queryFirstOrDefault<T = Row>(sql: string, params?: SqlParams): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  /** connection.QueryFirstAsync: first row; throws as Dapper does when there is none. */
  async queryFirst<T = Row>(sql: string, params?: SqlParams): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (!rows.length) throw new InvalidOperationException("Sequence contains no elements");
    return rows[0];
  }

  /** connection.QuerySingleOrDefaultAsync: null for none, throws for more than one. */
  async querySingleOrDefault<T = Row>(sql: string, params?: SqlParams): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    if (rows.length > 1) throw new InvalidOperationException("Sequence contains more than one element");
    return rows.length ? rows[0] : null;
  }

  /** connection.QuerySingleAsync */
  async querySingle<T = Row>(sql: string, params?: SqlParams): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length === 0) throw new InvalidOperationException("Sequence contains no elements");
    if (rows.length > 1) throw new InvalidOperationException("Sequence contains more than one element");
    return rows[0];
  }

  /** connection.ExecuteScalarAsync: first column of the first row of the first result set, or null. */
  async executeScalar<T = unknown>(sql: string, params?: SqlParams): Promise<T | null> {
    const sets = await this.queryMultiple<Row>(sql, params);
    const first = sets.find((s) => s.length > 0);
    if (!first) return null;
    const value = Object.values(first[0])[0];
    return (value === undefined ? null : value) as T | null;
  }

  /**
   * connection.ExecuteAsync: rows affected, summed over every statement.
   * "Affected" means rows matched, as MySqlConnector reports by default
   * (UseAffectedRows=false), so an UPDATE that changes nothing still counts.
   */
  async execute(sql: string, params?: SqlParams): Promise<number> {
    const { sql: text, values } = compileSql(sql, params);
    const [result] = await this.run(text, values);
    const headers = Array.isArray(result) ? result.filter(isResultSetHeader) : isResultSetHeader(result) ? [result] : [];
    return headers.reduce((sum, h) => sum + (h.affectedRows ?? 0), 0);
  }

  /** connection.QueryMultipleAsync: every result set, in order. */
  async queryMultiple<T = Row>(sql: string, params?: SqlParams): Promise<T[][]> {
    const { sql: text, values } = compileSql(sql, params);
    const [result] = await this.run(text, values);
    if (!Array.isArray(result)) return []; // a single non-SELECT statement
    // One statement: `result` is its rows (objects). Several: one entry per
    // statement, each either an array of rows or a result header.
    const multi = result.length > 0 && (Array.isArray(result[0]) || isResultSetHeader(result[0]));
    const statements = multi ? result : [result];
    return statements.filter((s): s is T[] => Array.isArray(s)) as T[][];
  }

  /**
   * Dapper with commandType: StoredProcedure. Arguments are matched to the
   * procedure's parameters by name, case-insensitively; a parameter with no
   * matching argument is passed NULL. Returns every result set.
   */
  async callProcedureMultiple<T = Row>(name: string, params?: Record<string, unknown>): Promise<T[][]> {
    const order = await this.procedureParams(name);
    const lookup = new Map(Object.entries(params ?? {}).map(([k, v]) => [k.replace(/^@/, "").toLowerCase(), v]));
    const args = order.map((p) => {
      const v = lookup.get(p.toLowerCase());
      return v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
    });
    const [result] = await this.run(`CALL \`${name}\`(${order.map(() => "?").join(",")})`, args);
    if (!Array.isArray(result)) return [];
    return result.filter((s): s is T[] => Array.isArray(s)) as T[][];
  }

  /** QueryAsync(..., commandType: StoredProcedure): the first result set. */
  async callProcedure<T = Row>(name: string, params?: Record<string, unknown>): Promise<T[]> {
    const sets = await this.callProcedureMultiple<T>(name, params);
    return sets[0] ?? [];
  }

  /** ExecuteAsync(..., commandType: StoredProcedure): rows affected by the procedure's last statement. */
  async executeProcedure(name: string, params?: Record<string, unknown>): Promise<number> {
    const order = await this.procedureParams(name);
    const lookup = new Map(Object.entries(params ?? {}).map(([k, v]) => [k.replace(/^@/, "").toLowerCase(), v]));
    const args = order.map((p) => {
      const v = lookup.get(p.toLowerCase());
      return v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
    });
    const [result] = await this.run(`CALL \`${name}\`(${order.map(() => "?").join(",")})`, args);
    const headers = Array.isArray(result) ? result.filter(isResultSetHeader) : isResultSetHeader(result) ? [result] : [];
    return headers.length ? headers[headers.length - 1].affectedRows : 0;
  }
}

/** Commands on one connection: what `using var connection = new MySqlConnection(...)` gives the C# code. */
export class DbSession extends DbCommands {
  constructor(
    readonly connection: PoolConnection,
    private readonly procs: (name: string) => Promise<string[]>,
  ) {
    super();
  }

  protected async run(sql: string, values: unknown[]) {
    return (await this.connection.query({ sql, values })) as [unknown, FieldPacket[] | undefined];
  }

  protected procedureParams(name: string) {
    return this.procs(name);
  }

  /** connection.BeginTransaction() ... Commit(), rolled back if `work` throws. */
  async transaction<T>(work: (tx: DbSession) => Promise<T>): Promise<T> {
    await this.connection.beginTransaction();
    try {
      const result = await work(this);
      await this.connection.commit();
      return result;
    } catch (e) {
      await this.connection.rollback().catch(() => {});
      throw e;
    }
  }
}

/**
 * The database for the instance (ConnectionStrings:DefaultConnection). Methods
 * on Db itself take a pooled connection per call; use session() where the C#
 * code runs several commands on one connection (LAST_INSERT_ID, temp tables,
 * user variables, transactions).
 */
@Injectable()
export class Db extends DbCommands implements OnModuleDestroy {
  readonly pool: Pool;
  private readonly procCache = new Map<string, Promise<string[]>>();

  /**
   * ROW stores time in UTC: every session runs with time_zone +00:00, so NOW()
   * and CURDATE() are UTC, and DATETIME values are sent with "Z". (RIZones stored
   * India time because its .NET process shared the server clock; a Node process
   * does not.) Database:SessionTimeZone overrides the zone.
   */
  readonly utcTimestamps: boolean;

  constructor(config: AppConfig) {
    super();
    const sessionZone = config.get("Database:SessionTimeZone") ?? "+00:00";
    this.utcTimestamps = sessionZone === "+00:00" && config.getBool("Database:EmitUtcOffset", Brand.feature("time.emitOffset", false));
    this.pool = mysql.createPool({
      ...parseConnectionString(config.connectionString() ?? ""),
      waitForConnections: true,
      connectionLimit: config.getInt("Database:PoolSize", 50),
      multipleStatements: true,
      namedPlaceholders: false,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: true,
      typeCast: makeTypeCast(this.utcTimestamps),
      charset: "utf8mb4_unicode_ci",
      // MySqlConnector's default (UseAffectedRows=false): UPDATE reports rows matched.
      flags: ["+FOUND_ROWS"],
    });
    // pool.on("connection") hands out the callback-style connection.
    (this.pool as unknown as { pool: { on: (e: string, cb: (c: { query: (sql: string) => void }) => void) => void } }).pool.on(
      "connection",
      (conn) => conn.query(`SET time_zone = '${sessionZone.replace(/'/g, "")}'`),
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  protected async run(sql: string, values: unknown[]) {
    return (await this.pool.query({ sql, values })) as [unknown, FieldPacket[] | undefined];
  }

  protected procedureParams(name: string): Promise<string[]> {
    let p = this.procCache.get(name.toLowerCase());
    if (!p) {
      p = this.pool
        .query(
          `SELECT PARAMETER_NAME AS name FROM information_schema.PARAMETERS
           WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = ? AND PARAMETER_MODE IS NOT NULL
           ORDER BY ORDINAL_POSITION`,
          [name],
        )
        .then(([rows]) => (rows as { name: string }[]).map((r) => r.name));
      p.catch(() => this.procCache.delete(name.toLowerCase()));
      this.procCache.set(name.toLowerCase(), p);
    }
    return p;
  }

  /** Run `work` on one connection, released afterwards. */
  async session<T>(work: (s: DbSession) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      return await work(new DbSession(conn, (n) => this.procedureParams(n)));
    } finally {
      conn.release();
    }
  }

  /** A transaction on its own connection. */
  transaction<T>(work: (tx: DbSession) => Promise<T>): Promise<T> {
    return this.session((s) => s.transaction(work));
  }
}

/**
 * "Server=h;Port=3306;Database=d;User Id=u;Password=p;..." (the .NET form, so the
 * same connection string works for both) -> mysql2 options. A mysql:// URL is
 * accepted too.
 */
export function parseConnectionString(cs: string): mysql.PoolOptions {
  if (/^mysql:\/\//i.test(cs)) {
    const u = new URL(cs);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  const parts = new Map<string, string>();
  for (const piece of cs.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ""), piece.slice(eq + 1).trim());
  }
  const pick = (...keys: string[]) => keys.map((k) => parts.get(k)).find((v) => v !== undefined);
  const ssl = pick("sslmode")?.toLowerCase();
  return {
    host: pick("server", "host", "datasource", "address") ?? "localhost",
    port: Number(pick("port") ?? 3306),
    user: pick("userid", "user", "uid", "username"),
    password: pick("password", "pwd"),
    database: pick("database", "initialcatalog"),
    connectTimeout: Number(pick("connectiontimeout", "connecttimeout") ?? 15) * 1000,
    ...(ssl && ssl !== "none" && ssl !== "disabled" ? { ssl: { rejectUnauthorized: ssl === "verifyca" || ssl === "verifyfull" } } : {}),
  };
}
