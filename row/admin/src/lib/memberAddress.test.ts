import { describe, expect, it } from "vitest";
import { isHomeAddressType, onePerAddressType, sameAddressType } from "./memberAddress";

describe("memberAddress", () => {
  it("treats Residence and Residential as one home slot", () => {
    expect(isHomeAddressType("Residence")).toBe(true);
    expect(isHomeAddressType("Business")).toBe(false);
    expect(sameAddressType("Residence", "Residential")).toBe(true);
    expect(sameAddressType("Business", "Residential")).toBe(false);
  });
  it("keeps the first row of each slot", () => {
    const out = onePerAddressType([
      { addressType: "Residence", id: 1 },
      { addressType: "Business", id: 2 },
      { addressType: "Residential", id: 3 },
      { addressType: "Business", id: 4 },
    ]);
    expect(out.map((a) => a.id)).toEqual([1, 2]);
  });
});
