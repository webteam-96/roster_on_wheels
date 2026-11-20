import { describe, expect, it } from "vitest";
import { dayInput, nextStatuses } from "./youth";

describe("nextStatuses", () => {
  it("lets the chair decide step by step", () => {
    expect(nextStatuses("applied", true)).toEqual(["approved", "declined", "withdrawn"]);
    expect(nextStatuses("approved", true)).toEqual(["attended", "declined", "withdrawn"]);
    expect(nextStatuses("attended", true)).toEqual(["completed"]);
    expect(nextStatuses("completed", true)).toEqual([]);
  });

  it("lets the club only withdraw", () => {
    expect(nextStatuses("applied", false)).toEqual(["withdrawn"]);
    expect(nextStatuses("attended", false)).toEqual([]);
  });
});

describe("dayInput", () => {
  it("keeps the date part", () => {
    expect(dayInput("2026-11-19T00:00:00")).toBe("2026-11-19");
    expect(dayInput(null)).toBe("");
  });
});
