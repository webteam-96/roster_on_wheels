import { describe, expect, it } from "vitest";
import { asUtc, eventDateTime, inYear, launchpadProgress, planningScopes } from "./planning";
import type { PlanningRole } from "@/types/planning";

const role = (over: Partial<PlanningRole>): PlanningRole => ({
  roleId: 1, districtId: 2, districtNumber: "2451", clubId: 0, clubName: null, role: "DGE", status: "active",
  source: "signup", memberId: 9, memberName: "A", yearId: 50, yearLabel: "2027-28", yearStart: "2027-07-01T00:00:00",
  yearEnd: "2028-06-30T00:00:00", invitedAt: null, acceptedAt: null, ...over,
});

describe("inYear", () => {
  it("includes the first and last day, by calendar day", () => {
    expect(inYear("2027-07-01T00:00:00", "2027-07-01", "2028-06-30")).toBe(true);
    expect(inYear("2028-06-30T23:30:00", "2027-07-01T00:00:00", "2028-06-30T00:00:00")).toBe(true);
    expect(inYear("2027-06-30T18:00:00", "2027-07-01", "2028-06-30")).toBe(false);
    expect(inYear(null, "2027-07-01", "2028-06-30")).toBe(false);
  });
});

describe("launchpadProgress", () => {
  it("leaves the stub out", () => {
    expect(launchpadProgress([
      { key: "a", label: "", done: true, detail: "", stub: false },
      { key: "b", label: "", done: false, detail: "", stub: false },
      { key: "ri", label: "", done: false, detail: "", stub: true },
    ])).toEqual({ done: 1, total: 2 });
  });
});

describe("planningScopes", () => {
  it("groups active roles by district and by club, skipping pending invitations", () => {
    const scopes = planningScopes([
      role({ role: "DGE" }),
      role({ roleId: 2, role: "DS" }),
      role({ roleId: 3, role: "PE", clubId: 133, clubName: "Six of October" }),
      role({ roleId: 4, role: "SE", clubId: 140, clubName: "Other", status: "invited" }),
    ]);
    expect(scopes.map((s) => [s.kind, s.label, s.roles.length])).toEqual([
      ["district", "District 2451", 2],
      ["club", "Six of October", 1],
    ]);
  });
});

describe("asUtc", () => {
  it("marks a zone-less time as UTC and keeps an explicit zone", () => {
    expect(asUtc("2027-06-30T14:00:00")).toBe("2027-06-30T14:00:00Z");
    expect(asUtc("2027-06-30T14:00:00+10:00")).toBe("2027-06-30T14:00:00+10:00");
    expect(asUtc(null)).toBeNull();
  });
});

describe("eventDateTime", () => {
  it("adds the default evening time", () => {
    expect(eventDateTime("2027-09-15")).toBe("2027-09-15T18:00:00");
  });
});
