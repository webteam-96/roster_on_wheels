import { describe, expect, it } from "vitest";
import { cellText, definitionProblem, emptyDefinition, keepValid, opsFor } from "./customReports";

const fmt = { number: (n: number) => `n${n}`, date: (d: string) => `d${d}` };

describe("custom report helpers", () => {
  it("offers only the operators a field type supports", () => {
    expect(opsFor("text")).toContain("contains");
    expect(opsFor("number")).not.toContain("contains");
    expect(opsFor("bool")).toEqual(["eq"]);
  });

  it("drops columns, filters and sums that the new source does not have", () => {
    const d = { ...emptyDefinition("members"), columns: ["name", "cost"], sumFields: ["cost", "name"], groupBy: "club", sortBy: "count",
      filters: [{ field: "cost", op: "gt" as const, value: "1" }] };
    const out = keepValid(d, [{ key: "name", label: "Name", type: "text" }, { key: "club", label: "Club", type: "text" }]);
    expect(out.columns).toEqual(["name"]);
    expect(out.filters).toEqual([]);
    expect(out.sumFields).toEqual([]);
    expect(out.groupBy).toBe("club");
    expect(out.sortBy).toBe("count");
  });

  it("says what is missing before running", () => {
    expect(definitionProblem(emptyDefinition("members"))).toMatch(/column/);
    expect(definitionProblem({ ...emptyDefinition("members"), columns: ["name"], filters: [{ field: "name", op: "eq", value: " " }] })).toMatch(/value/);
    expect(definitionProblem({ ...emptyDefinition("members"), columns: ["name"], filters: [{ field: "email", op: "empty", value: null }] })).toBeNull();
  });

  it("formats cells by type", () => {
    expect(cellText(1, "bool", fmt)).toBe("Yes");
    expect(cellText(0, "bool", fmt)).toBe("No");
    expect(cellText(12.5, "number", fmt)).toBe("n12.5");
    expect(cellText("2026-07-01", "date", fmt)).toBe("d2026-07-01");
    expect(cellText(null, "text", fmt)).toBe("");
  });
});
