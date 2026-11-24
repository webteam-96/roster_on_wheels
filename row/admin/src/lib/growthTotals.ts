import type { DistrictGrowthClub, StageCount } from "@/services/api";

/** The membership growth figures of a set of clubs, by the same rules as the API's district totals (GrowthService).
 *  `stages` is the district's own list, so every stage shows even when no club matches. */
export function growthTotals(clubs: DistrictGrowthClub[], stages: StageCount[]) {
  const sum = (of: (c: DistrictGrowthClub) => number) => clubs.reduce((n, c) => n + of(c), 0);
  return {
    targetTotal: sum((c) => c.target ?? 0),
    clubsWithTarget: clubs.filter((c) => c.target !== null).length,
    clubsReached: clubs.filter((c) => c.target !== null && c.target > 0 && c.netGrowth >= c.target).length,
    joined: sum((c) => c.joined),
    terminated: sum((c) => c.terminated),
    prospectsByStage: stages.map(({ stage }) => ({
      stage, count: sum((c) => c.prospectsByStage?.find((s) => s.stage === stage)?.count ?? 0),
    })),
  };
}
