import { compileSql } from "./sql-params";

describe("compileSql (Dapper syntax to mysql2)", () => {
  it("replaces known parameters, case-insensitively", () => {
    expect(compileSql("SELECT * FROM t WHERE a = @Id AND b = @name", { id: 5, Name: "x" })).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b = ?",
      values: [5, "x"],
    });
  });

  it("repeats a value each time the parameter appears", () => {
    expect(compileSql("WHERE (@Search = '' OR n LIKE CONCAT('%', @Search, '%'))", { Search: "ab" }).values).toEqual(["ab", "ab"]);
  });

  it("leaves user and system variables alone", () => {
    const r = compileSql("SET @rownum := 0; SELECT @rownum := @rownum + 1, @@session.time_zone, @Id", { Id: 1 });
    expect(r.sql).toBe("SET @rownum := 0; SELECT @rownum := @rownum + 1, @@session.time_zone, ?");
    expect(r.values).toEqual([1]);
  });

  it("never touches quoted text or comments", () => {
    const sql = "SELECT '@Id', \"@Id\", `@Id`, 'it''s @Id' -- @Id\n /* @Id */ # @Id\n , @Id";
    const r = compileSql(sql, { Id: 7 });
    expect(r.sql).toBe("SELECT '@Id', \"@Id\", `@Id`, 'it''s @Id' -- @Id\n /* @Id */ # @Id\n , ?");
    expect(r.values).toEqual([7]);
  });

  it("expands arrays like Dapper", () => {
    expect(compileSql("WHERE id IN @Ids", { Ids: [1, 2, 3] })).toEqual({ sql: "WHERE id IN (?,?,?)", values: [1, 2, 3] });
    expect(compileSql("WHERE id IN @Ids", { Ids: [] }).sql).toBe("WHERE id IN (SELECT NULL FROM DUAL WHERE 1 = 0)");
  });

  it("sends booleans as 1/0 and undefined as NULL", () => {
    expect(compileSql("VALUES (@A, @B, @C)", { A: true, B: false, C: undefined }).values).toEqual([1, 0, null]);
  });

  it("accepts a Map and names written with a leading @", () => {
    expect(compileSql("WHERE a = @X", new Map([["@x", 9]])).values).toEqual([9]);
  });

  it("does not treat an email address in a string as a parameter", () => {
    expect(compileSql("WHERE e = 'a@Id.com' AND id = @Id", { Id: 1 }).sql).toBe("WHERE e = 'a@Id.com' AND id = ?");
  });
});
