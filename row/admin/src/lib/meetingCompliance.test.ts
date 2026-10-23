import { describe, expect, it } from "vitest";
import { lastCompleteMonth, parseMeetingCount } from "./meetingCompliance";

describe("meeting compliance helpers", () => {
  it("defaults to the last complete month, across a year boundary too", () => {
    expect(lastCompleteMonth(new Date(2026, 9, 31))).toBe("2026-09");
    expect(lastCompleteMonth(new Date(2026, 0, 15))).toBe("2025-12");
  });

  it("reads a meetings-per-month input like the API's 0 to 31 rule", () => {
    expect(parseMeetingCount("")).toBeNull();
    expect(parseMeetingCount(" 3 ")).toBe(3);
    expect(parseMeetingCount("0")).toBe(0);
    expect(parseMeetingCount("32")).toBeUndefined();
    expect(parseMeetingCount("1.5")).toBeUndefined();
    expect(parseMeetingCount("two")).toBeUndefined();
  });
});
