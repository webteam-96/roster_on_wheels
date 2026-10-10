import { evaluateSimpleExpression, roundAway, rotaryIndex, spreadTarget } from "./goal-core";
import { bindSplit } from "./goal-setting.controller";
import { mobileOverview } from "./mobile-goal-setting.controller";
import type { GoalOverviewMatrixDto, GoalOverviewRowDto } from "./goal-setting.dtos";

describe("goal-setting helpers", () => {
  it("rounds half away from zero like decimal Math.Round(MidpointRounding.AwayFromZero)", () => {
    expect([roundAway(2.5), roundAway(-2.5), roundAway(2.675, 2), roundAway(0.49)]).toEqual([3, -3, 2.68, 0]);
  });

  it("spreads a target evenly with the remainder in the last slot", () => {
    expect(spreadTarget(10, 3)).toEqual([3, 3, 4]);
    expect(spreadTarget(5, 0)).toEqual([]);
  });

  it("evaluates simple field expressions, guarding division by zero", () => {
    const v = new Map([["a", 7], ["b", 2], ["z", 0]]);
    expect(evaluateSimpleExpression("a/b", v)).toBe(4);
    expect(evaluateSimpleExpression("a/z", v)).toBe(0);
    expect(evaluateSimpleExpression("a*b", v)).toBe(14);
  });

  it("indexes months in Rotary-year order from July", () => {
    expect([rotaryIndex(7, 7), rotaryIndex(6, 7), rotaryIndex(1, 7)]).toEqual([0, 11, 6]);
  });

  it("binds a split request with numeric month keys", () => {
    expect(bindSplit({ YearId: "5", fields: [{ fieldId: 3, values: { "7": "10", "8": null } }] })).toEqual({
      yearId: 5, period: "month", fields: [{ fieldId: 3, values: { 7: 10, 8: null } }],
    });
  });

  it("drops suggestion rows, and Youth Service percentages, from the mobile overview", () => {
    const row = (groupName: string, dataType: string) => ({ groupName, dataType }) as GoalOverviewRowDto;
    const m = (categoryName: string) => ({ categoryName, rows: [row("Suggestions", "Text"), row("Clubs", "Percentage"), row("Clubs", "Number")] }) as GoalOverviewMatrixDto;
    expect(mobileOverview(m("Youth Service")).rows.map((r) => r.dataType)).toEqual(["Number"]);
    expect(mobileOverview(m("Membership")).rows.map((r) => r.dataType)).toEqual(["Percentage", "Number"]);
  });
});
