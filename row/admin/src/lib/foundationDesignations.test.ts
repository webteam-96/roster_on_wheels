import { describe, expect, it } from "vitest";
import { DESIGNATION_OPTIONS, designationLabel } from "./foundationDesignations";

describe("foundation designations", () => {
  it("labels each type the way the API does", () => {
    expect(designationLabel("PHF", 0)).toBe("Paul Harris Fellow");
    expect(designationLabel("PHF", 3)).toBe("Paul Harris Fellow +3");
    expect(designationLabel("MAJOR_DONOR", 2)).toBe("Major Donor Level 2");
    expect(designationLabel("BEQUEST_SOCIETY", null)).toBe("Bequest Society");
  });

  it("offers PHF to +8, Major Donor 1 to 4 and Bequest Society, each once", () => {
    expect(DESIGNATION_OPTIONS).toHaveLength(14);
    expect(DESIGNATION_OPTIONS[8].label).toBe("Paul Harris Fellow +8");
    expect(DESIGNATION_OPTIONS[12].label).toBe("Major Donor Level 4");
    expect(DESIGNATION_OPTIONS.at(-1)).toMatchObject({ type: "BEQUEST_SOCIETY", level: null });
    expect(new Set(DESIGNATION_OPTIONS.map((o) => o.value)).size).toBe(14);
  });
});
