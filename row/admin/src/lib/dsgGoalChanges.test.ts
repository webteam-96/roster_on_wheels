import { describe, expect, it } from "vitest";
import { changedDsgGoals } from "./dsgGoalChanges";

describe("changedDsgGoals", () => {
  const lines: Parameters<typeof changedDsgGoals>[0] = [
    { lineType: "auto", lineId: 1, answerType: "number", clubGoals: { 10: 5, 11: null } },
    { lineType: "rcc", lineId: 2, answerType: "number", clubGoals: { 10: 3 } },
    { lineType: "manual", lineId: 3, answerType: "yesno", clubGoals: {} },
  ];

  it("sends only the goals that changed", () => {
    const typed = { "auto:1": { 10: "5", 11: "7" }, "rcc:2": { 10: "3.0" }, "manual:3": { 10: "1" } };
    expect(changedDsgGoals(lines, [10, 11], typed)).toEqual([{ lineType: "auto", lineId: 1, clubId: 11, goalValue: 7 }]);
  });

  it("sends a cleared goal as null and ignores a blank that was already blank", () => {
    const typed = { "auto:1": { 10: "", 11: "" }, "rcc:2": { 10: "3" } };
    expect(changedDsgGoals(lines, [10, 11], typed)).toEqual([{ lineType: "auto", lineId: 1, clubId: 10, goalValue: null }]);
  });

  it("treats an untyped club as blank and skips non-number lines", () => {
    expect(changedDsgGoals(lines, [10, 12], {})).toEqual([
      { lineType: "auto", lineId: 1, clubId: 10, goalValue: null },
      { lineType: "rcc", lineId: 2, clubId: 10, goalValue: null },
    ]);
  });
});
