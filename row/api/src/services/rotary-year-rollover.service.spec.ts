import { rotaryYearOf } from "./rotary-year-rollover.service";

describe("rotaryYearOf", () => {
  it("rolls over on 1 July", () => {
    expect(rotaryYearOf("2026-06-30T23:59:59")).toEqual({ label: "2025-26", startDate: "2025-07-01", endDate: "2026-06-30" });
    expect(rotaryYearOf("2026-07-01T00:00:00")).toEqual({ label: "2026-27", startDate: "2026-07-01", endDate: "2027-06-30" });
    expect(rotaryYearOf("2099-12-31")).toEqual({ label: "2099-00", startDate: "2099-07-01", endDate: "2100-06-30" });
  });
});
