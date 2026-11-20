import { describe, expect, it } from "vitest";
import { draftTotals, parseAmount, rotaryYearRange } from "./clubAccounts";

describe("parseAmount", () => {
  it("reads plain and grouped amounts", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("7")).toBe(7);
  });
  it("refuses bad input", () => {
    for (const t of ["", "-5", "1.234", "abc", "1e5"]) expect(parseAmount(t)).toBeNull();
  });
});

describe("draftTotals", () => {
  it("balances in cents, not floating point", () => {
    const r = draftTotals([
      { accountId: 1, debit: "0.10", credit: "" },
      { accountId: 1, debit: "0.20", credit: "" },
      { accountId: 2, debit: "", credit: "0.30" },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.debit).toBe(0.3);
  });
  it("flags unbalanced, two-sided and account-less lines", () => {
    expect(draftTotals([{ accountId: 1, debit: "10", credit: "" }, { accountId: 2, debit: "", credit: "9.99" }]).problem).toMatch(/equal/);
    expect(draftTotals([{ accountId: 1, debit: "10", credit: "10" }, { accountId: 2, debit: "", credit: "" }]).problem).toMatch(/not both/);
    expect(draftTotals([{ accountId: null, debit: "10", credit: "" }, { accountId: 2, debit: "", credit: "10" }]).problem).toMatch(/account/);
    expect(draftTotals([{ accountId: 1, debit: "10", credit: "" }]).problem).toMatch(/two lines/);
  });
});

describe("rotaryYearRange", () => {
  it("runs July to June", () => {
    expect(rotaryYearRange("2026-11-19")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(rotaryYearRange("2027-03-01")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect(rotaryYearRange("2026-07-01")).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });
});
