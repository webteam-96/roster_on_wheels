/**
 * Runs against a real MySQL loaded with database/schema.sql and seed-master.sql.
 * Skipped unless ROW_TEST_DB is set, e.g.
 *   ROW_TEST_DB="Server=127.0.0.1;Port=3317;Database=row_verify;User=root;Password=..." npx jest db.integration
 */
import { AppConfig } from "../config/app-config";
import { Db } from "./db.service";

const cs = process.env.ROW_TEST_DB;
const maybe = cs ? describe : describe.skip;

maybe("Db against MySQL", () => {
  let db: Db;

  beforeAll(() => {
    // Parity checks run with .NET's offset-less timestamps; the UTC "Z" form is tested separately below.
    db = new Db(new AppConfig(process.cwd(), { ConnectionStrings__DefaultConnection: cs!, Database__EmitUtcOffset: "false" }));
  });
  afterAll(() => db.onModuleDestroy());

  it("returns values in the shapes the .NET API serialises", async () => {
    const row = await db.queryFirst(`
      SELECT CAST(1 AS UNSIGNED) AS n, TRUE AS t,
             CAST('2026-09-30 14:05:00' AS DATETIME) AS dt,
             CAST('2026-09-30 14:05:00.120' AS DATETIME(3)) AS dtf,
             CAST('2026-07-01' AS DATE) AS d,
             CAST('14:05:00' AS TIME) AS tm,
             CAST(12.50 AS DECIMAL(10,2)) AS money,
             JSON_OBJECT('a', 1) AS j,
             NULL AS nothing`);
    expect(row).toEqual({
      n: 1,
      t: 1, // TRUE in a SELECT is BIGINT 1, not TINYINT(1), exactly as MySqlConnector reports it
      dt: "2026-09-30T14:05:00",
      dtf: "2026-09-30T14:05:00.12",
      d: "2026-07-01T00:00:00",
      tm: "14:05:00",
      money: 12.5,
      j: '{"a": 1}',
      nothing: null,
    });
  });

  it("maps TINYINT(1) columns to booleans", async () => {
    const roles = await db.query("SELECT * FROM roles ORDER BY pk_role_id");
    expect(roles.length).toBe(7);
    const flags = Object.entries(roles[0]).filter(([, v]) => typeof v === "boolean");
    expect(flags.length).toBeGreaterThan(0);
  });

  it("expands lists and binds parameters case-insensitively", async () => {
    const rows = await db.query<{ CountryName: string }>(
      "SELECT CountryName FROM country_master WHERE CountryCode IN @Codes AND isdeleted = @deleted ORDER BY CountryName",
      { codes: ["IN", "JP", "US"], Deleted: false },
    );
    expect(rows.map((r) => r.CountryName)).toEqual(["India", "Japan", "United States"]);
  });

  it("keeps LAST_INSERT_ID on one connection and reports rows matched", async () => {
    await db.session(async (s) => {
      await s.transaction(async (tx) => {
        const id = await tx.executeScalar<number>(
          "INSERT INTO event_tshirt_sizes (SizeName) VALUES (@Name); SELECT LAST_INSERT_ID();",
          { Name: "TEST-XXL" },
        );
        expect(id).toBeGreaterThan(0);
        // Same value again: MySQL changes nothing, but the row was matched -> 1, as MySqlConnector reports.
        const n = await tx.execute("UPDATE event_tshirt_sizes SET SizeName = @Name WHERE pk_id = @Id", { Name: "TEST-XXL", Id: id });
        expect(n).toBe(1);
        throw new Error("rollback");
      }).catch((e) => expect(e.message).toBe("rollback"));
    });
    expect(await db.executeScalar("SELECT COUNT(*) FROM event_tshirt_sizes WHERE SizeName = 'TEST-XXL'")).toBe(0);
  });

  it("calls stored procedures with arguments matched by name", async () => {
    const rows = await db.callProcedure("sp_member_get_all_count", { p_Search: null, p_gender: null });
    expect(Object.values(rows[0])[0]).toBe(0);
  });

  it("returns every result set from several statements", async () => {
    const sets = await db.queryMultiple("SELECT 1 AS a; SET @x := 5; SELECT @x AS b, @Y AS c", { Y: "y" });
    expect(sets).toEqual([[{ a: 1 }], [{ b: 5, c: "y" }]]);
  });

  it("runs every session in UTC and marks timestamps with Z by default", async () => {
    const utc = new Db(new AppConfig(process.cwd(), { ConnectionStrings__DefaultConnection: cs! }));
    try {
      expect(await utc.executeScalar("SELECT @@session.time_zone")).toBe("+00:00");
      const row = await utc.queryFirst("SELECT CAST('2026-09-30 14:05:00' AS DATETIME) AS dt, CAST('2026-07-01' AS DATE) AS d");
      expect(row).toEqual({ dt: "2026-09-30T14:05:00Z", d: "2026-07-01T00:00:00" });
    } finally {
      await utc.onModuleDestroy();
    }
  });
});
