import { describe, expect, it } from "vitest";
import { filterClubs, formatMetric } from "./targets";
import type { TargetClubRow, TargetMetric } from "@/services/api";

const metric = (actual: number, target: number | null = null): TargetMetric => ({ actual, target, percent: null, status: "none" });
const row = (clubId: number, clubName: string, agMemberId: number | null, status: TargetClubRow["status"]): TargetClubRow =>
  ({ clubId, clubName, agMemberId, agName: null, status, metrics: {} as TargetClubRow["metrics"] });

describe("target dashboard filter", () => {
  const rows = [row(1, "Rotary Club of Alpha", 7, "red"), row(2, "Beta Sunrise", null, "green"), row(3, "Alpha East", 8, "green")];
  const ids = (r: TargetClubRow[]) => r.map((x) => x.clubId);

  it("filters by Assistant Governor group, including clubs without one", () => {
    expect(ids(filterClubs(rows, { group: "7", status: "all", search: "" }))).toEqual([1]);
    expect(ids(filterClubs(rows, { group: "none", status: "all", search: "" }))).toEqual([2]);
  });

  it("combines status and a case-insensitive name search", () => {
    expect(ids(filterClubs(rows, { group: "all", status: "green", search: "ALPHA" }))).toEqual([3]);
    expect(ids(filterClubs(rows, { group: "all", status: "all", search: "  " }))).toEqual([1, 2, 3]);
  });
});

describe("target dashboard figures", () => {
  it("shows actual of target, the figure alone without a target", () => {
    expect(formatMetric("dues", metric(2, 3))).toBe("2 of 3");
    expect(formatMetric("projects", metric(4))).toBe("4");
  });

  it("signs positive net growth and hides attendance without meetings", () => {
    expect(formatMetric("growth", metric(2, 5))).toBe("+2 of 5");
    expect(formatMetric("growth", metric(-1, 5))).toBe("-1 of 5");
    expect(formatMetric("attendance", metric(0), 0)).toBe("-");
    expect(formatMetric("attendance", metric(62.5), 4)).toBe("62.5%");
  });
});
