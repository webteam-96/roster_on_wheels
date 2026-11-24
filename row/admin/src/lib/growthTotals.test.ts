import { describe, expect, it } from "vitest";
import type { DistrictGrowthClub } from "@/services/api";
import { growthTotals } from "./growthTotals";

const club = (over: Partial<DistrictGrowthClub>): DistrictGrowthClub => ({
  clubId: 1, clubName: "A", target: null, joined: 0, terminated: 0, netGrowth: 0, progressPercent: null,
  openProspects: 0, prospectsByStage: [], ...over,
});

const stages = [{ stage: "inquiry", count: 9 }, { stage: "invited", count: 9 }];

describe("growthTotals", () => {
  it("adds up only the clubs given", () => {
    expect(growthTotals([
      club({ target: 2, joined: 3, terminated: 1, netGrowth: 2, prospectsByStage: [{ stage: "inquiry", count: 1 }, { stage: "invited", count: 0 }] }),
      club({ target: 5, joined: 1, netGrowth: 1, prospectsByStage: [{ stage: "inquiry", count: 2 }, { stage: "invited", count: 4 }] }),
      club({ joined: 4, netGrowth: 4 }),
    ], stages)).toEqual({
      targetTotal: 7, clubsWithTarget: 2, clubsReached: 1, joined: 8, terminated: 1,
      prospectsByStage: [{ stage: "inquiry", count: 3 }, { stage: "invited", count: 4 }],
    });
  });

  it("a target of 0 is set but never reached, as on the server", () => {
    expect(growthTotals([club({ target: 0, netGrowth: 3 })], stages)).toMatchObject({ clubsWithTarget: 1, clubsReached: 0 });
  });

  it("no matching club shows every stage at 0", () => {
    expect(growthTotals([], stages)).toMatchObject({ joined: 0, prospectsByStage: [{ stage: "inquiry", count: 0 }, { stage: "invited", count: 0 }] });
  });
});
