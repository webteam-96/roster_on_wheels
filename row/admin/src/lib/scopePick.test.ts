import { describe, expect, it } from "vitest";
import type { RoleScopeDto } from "@/types/scope";
import { adminClubId, adminDistrictId, reconcileSelected } from "./scopePick";

const clubs = [{ id: 10 }, { id: 20 }];
const roles = [
  { roleName: "Member", scope: "club", clubId: 10 },
  { roleName: "Club Admin", scope: "club", clubId: 20 },
  { roleName: "District Admin", scope: "district", districtId: 5 },
] as unknown as RoleScopeDto[];

describe("scopePick", () => {
  it("picks the administered club, not the first membership club", () => {
    expect(adminClubId(roles, clubs)).toBe(20);
    expect(reconcileSelected(null, clubs, adminClubId(roles, clubs))).toBe(20);
  });
  it("keeps a stored choice that is still accessible", () => {
    expect(reconcileSelected(10, clubs, 20)).toBe(10);
  });
  it("drops a stale choice for the administered club, then the first", () => {
    expect(reconcileSelected(99, clubs, 20)).toBe(20);
    expect(reconcileSelected(99, clubs, null)).toBe(10);
    expect(reconcileSelected(99, clubs, 77)).toBe(10);
    expect(reconcileSelected(10, [], 20)).toBeNull();
  });
  it("picks the administered district only when accessible", () => {
    expect(adminDistrictId(roles, [{ id: 3 }, { id: 5 }])).toBe(5);
    expect(adminDistrictId(roles, [{ id: 3 }])).toBeNull();
  });
});
