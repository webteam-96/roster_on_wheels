import { describe, expect, it } from "vitest";
import { budgetTotals, dayInput, orNull } from "./grants";

describe("grants helpers", () => {
  it("adds budget lines in cents and leaves partners out", () => {
    const t = budgetTotals([
      { kind: "income", amount: 0.1 },
      { kind: "income", amount: 0.2 },
      { kind: "expense", amount: 1000.55 },
      { kind: "partner", amount: 500 },
      { kind: "expense", amount: null },
    ]);
    expect(t).toEqual({ income: 0.3, expense: 1000.55, gap: 1000.25 });
  });

  it("turns API dates into input values and blanks into null", () => {
    expect(dayInput("2027-03-31T00:00:00")).toBe("2027-03-31");
    expect(dayInput(null)).toBe("");
    expect(orNull("  ")).toBeNull();
    expect(orNull(" x ")).toBe("x");
  });
});
