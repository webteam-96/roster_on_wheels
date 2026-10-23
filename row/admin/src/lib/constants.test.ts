import { describe, expect, it, vi } from "vitest";
import { TIMEZONES, timeZoneOptions } from "./constants";

describe("district time zone options (N12)", () => {
  it("lists the runtime's IANA zones", () => {
    expect(timeZoneOptions()).toContain("America/New_York");
    expect(timeZoneOptions().length).toBeGreaterThan(TIMEZONES.length);
  });

  it("falls back to the short list where Intl has no zone list", () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => {
      throw new RangeError("unsupported");
    });
    expect(timeZoneOptions()).toEqual(TIMEZONES);
    spy.mockRestore();
  });
});
