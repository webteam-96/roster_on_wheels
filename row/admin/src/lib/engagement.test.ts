import { describe, expect, it } from "vitest";
import { parseMilestoneYears } from "./engagement";

describe("parseMilestoneYears", () => {
  it("reads commas or spaces, sorted without repeats", () => {
    expect(parseMilestoneYears("10, 5,1 3 5")).toEqual([1, 3, 5, 10]);
  });

  it("treats an empty text as no milestones", () => {
    expect(parseMilestoneYears("  ")).toEqual([]);
  });

  it("refuses what the API refuses", () => {
    for (const bad of ["0", "101", "2.5", "five", "-1", "1 2 3 4 5 6 7 8 9 10 11"]) expect(parseMilestoneYears(bad)).toBeNull();
  });
});
