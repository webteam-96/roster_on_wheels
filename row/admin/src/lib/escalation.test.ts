import { describe, expect, it } from "vitest";
import { MAX_DELAY_DAYS, MAX_SHORTFALL, parseWhole } from "./escalation";

describe("parseWhole", () => {
  it("reads whole numbers inside the range", () => {
    expect(parseWhole(" 7 ", 1, MAX_DELAY_DAYS)).toBe(7);
    expect(parseWhole("60", 1, MAX_DELAY_DAYS)).toBe(60);
    expect(parseWhole("1", 1, MAX_SHORTFALL)).toBe(1);
  });

  it("refuses what the API refuses", () => {
    for (const bad of ["", "0", "61", "2.5", "-1", "seven", "1e1"]) expect(parseWhole(bad, 1, MAX_DELAY_DAYS)).toBeNull();
    expect(parseWhole("32", 1, MAX_SHORTFALL)).toBeNull();
  });
});
