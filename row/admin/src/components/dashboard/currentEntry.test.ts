import { describe, expect, it } from "vitest";
import type { DashboardEntry } from "@/services/api";
import { currentEntryOf } from "./currentEntry";

const entry = (kind: string, clubId: number | null, districtId: number | null, zoneId: number | null) =>
  ({ kind, route: "/", label: kind, clubId, districtId, zoneId }) as DashboardEntry;

// What the API returns for an admin of districts 5656 (zone 1) and 5657 (zone 2) and of two clubs in 5656.
const D5656 = entry("district-admin", null, 1, 1);
const D5657 = entry("district-admin", null, 483, 2);
const CLUB_A = entry("club-admin", 10, 1, 1);
const CLUB_B = entry("club-admin", 11, 1, 1);
const all = [D5656, D5657, CLUB_A, CLUB_B];

describe("currentEntryOf", () => {
  it("follows the district, not the zone left selected", () => {
    expect(currentEntryOf(all, "district-admin", { clubId: 10, districtId: 483, zoneId: 1 })).toBe(D5657);
    expect(currentEntryOf(all, "district-admin", { clubId: 10, districtId: 1, zoneId: 2 })).toBe(D5656);
  });
  it("follows the club, not its district", () => {
    expect(currentEntryOf(all, "club-admin", { clubId: 11, districtId: 1, zoneId: 1 })).toBe(CLUB_B);
  });
  it("falls back to the first entry of the kind", () => {
    expect(currentEntryOf(all, "district-admin", { clubId: null, districtId: null, zoneId: null })).toBe(D5656);
    expect(currentEntryOf(all, "ag", { clubId: null, districtId: null, zoneId: null })).toBeUndefined();
  });
});
