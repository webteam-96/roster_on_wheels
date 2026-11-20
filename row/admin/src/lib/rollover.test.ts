import { describe, expect, it } from "vitest";
import type { RolloverPreview } from "@/services/api";
import { buildApplyBody, countChanges, defaultSelection, summaryText } from "./rollover";

const preview: RolloverPreview = {
  scope: "club", scopeId: 1,
  fromYear: { id: 47, label: "2026-27" }, toYear: { id: 50, label: "2027-28" },
  committees: [
    { sourceId: 10, name: "Fundraising", targetId: null, action: "add", subGroups: [], members: [
      { key: "m:1", rowId: 1, memberId: 5, name: "A", action: "add" },
      { key: "m:2", rowId: 2, memberId: 6, name: "B", action: "left" },
    ] },
    { sourceId: 11, name: "Youth", targetId: 99, action: "exists", subGroups: [], members: [
      { key: "m:3", rowId: 3, memberId: 7, name: "C", action: "exists" },
    ] },
  ],
  officers: [
    { sourceId: 20, memberId: 5, name: "A", designationId: 6, designation: "Treasurer", action: "add" },
    { sourceId: 21, memberId: 6, name: "B", designationId: 7, designation: "Sergeant", action: "exists" },
  ],
  ipp: { sourceId: 30, memberId: 8, name: "P", designationId: 2, designation: "Immediate Past President", action: "add" },
  incoming: [], pendingProgression: { connected: false, steps: [] }, runs: [],
};

describe("rollover selection", () => {
  it("ticks committees with something to add and members still in the club, not officers", () => {
    const s = defaultSelection(preview);
    expect(s.committees).toEqual({ 10: true, 11: false });
    expect(s.members).toEqual({ "m:1": true });
    expect(s.officers).toEqual({});
    expect(s.includeIpp).toBe(true);
  });

  it("never sends rows already in the new year or members who left", () => {
    const s = defaultSelection(preview);
    const body = buildApplyBody(preview, { ...s, members: { ...s.members, "m:2": true }, officers: { 20: true, 21: true }, committees: { 10: true, 11: true } });
    expect(body.committees).toEqual([{ sourceId: 10, memberKeys: ["m:1"] }, { sourceId: 11, memberKeys: [] }]);
    expect(body.officerIds).toEqual([20]);
    expect(countChanges(preview, body)).toBe(4); // Fundraising + A + Treasurer + IPP
  });

  it("drops the IPP when it already exists", () => {
    const p = { ...preview, ipp: { ...preview.ipp!, action: "exists" as const } };
    expect(buildApplyBody(p, { ...defaultSelection(p), includeIpp: true }).includeIpp).toBe(false);
  });

  it("reads a run summary", () => {
    expect(summaryText('{"committee":1,"member":2}')).toBe("committees: 1, members: 2");
    expect(summaryText("not json")).toBe("");
  });
});
