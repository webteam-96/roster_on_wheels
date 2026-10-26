import { describe, expect, it } from "vitest";
import { mayOpen } from "./RoleGate";

const clubAdmin = { isSuperAdmin: false, roles: ["Member", "Admin"], scopedRoles: [{ roleName: "Admin", scope: "club", clubId: 341 }] };
const districtAdmin = { isSuperAdmin: false, roles: ["Member", "Admin"], scopedRoles: [{ roleName: "Admin", scope: "district", districtId: 5 }] };
const ag = { isSuperAdmin: false, roles: ["Member", "AG"], scopedRoles: [{ roleName: "AG", scope: "district", districtId: 5 }] };
const superAdmin = { isSuperAdmin: true, roles: ["SuperAdmin"], scopedRoles: [] };

describe("role gate", () => {
  it("keeps Super Admin settings and the goal overview to Super Admins", () => {
    for (const u of [clubAdmin, districtAdmin, ag]) {
      expect(mayOpen("/settings/audit-log", u)).toBe(false);
      expect(mayOpen("/goal-overviews", u)).toBe(false);
    }
    expect(mayOpen("/settings/audit-log", superAdmin)).toBe(true);
    expect(mayOpen("/goal-overviews", superAdmin)).toBe(true);
  });

  it("leaves the club admins' dues plan page open", () => {
    expect(mayOpen("/settings/membership-dues/create", clubAdmin)).toBe(true);
    expect(mayOpen("/settings/membership-duesX", clubAdmin)).toBe(false);
  });

  it("opens a district's pages to its own District Admin only", () => {
    expect(mayOpen("/districts/5/mass-emails", districtAdmin)).toBe(true);
    expect(mayOpen("/districts/6/mass-emails", districtAdmin)).toBe(false);
    expect(mayOpen("/districts/5/dashboard", clubAdmin)).toBe(false);
    expect(mayOpen("/districts/5/dashboard", ag)).toBe(false);
    expect(mayOpen("/districts/5", superAdmin)).toBe(true);
  });

  it("does not touch other pages", () => {
    expect(mayOpen("/clubs/341/mass-emails", clubAdmin)).toBe(true);
    expect(mayOpen("/ag-dashboard/reports", ag)).toBe(true);
    expect(mayOpen("/districtsX", clubAdmin)).toBe(true);
  });
});
