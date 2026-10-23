import { describe, expect, it } from "vitest";
import { holdPage, isBlocked, offPatterns } from "./FeatureGate";
import type { PlatformFeature } from "@/services/api";

const f = (key: string, kind: "skipped" | "flagged", enabled: boolean, adminPaths: string[]): PlatformFeature =>
  ({ key, label: key, kind, enabled, adminPaths });

describe("feature gate", () => {
  const features = [
    f("retired_module", "skipped", false, ["/retired-module(/|$)"]),
    f("ocv", "flagged", false, ["/ocv-gov(/|$)"]),
    f("sub_groups", "flagged", true, ["^/(clubs|districts)/[^/]+/sub-groups(/|$)"]),
  ];
  const off = offPatterns(features);

  it("blocks skipped modules and flagged modules that are off", () => {
    expect(isBlocked("/clubs/3/retired-module/v2", off)).toBe(true);
    expect(isBlocked("/clubs/3/ocv-gov", off)).toBe(true);
  });

  it("lets switched-on modules and look-alike paths through", () => {
    expect(isBlocked("/clubs/3/sub-groups", off)).toBe(false);
    expect(isBlocked("/clubs/3/retired-module-report-old", off)).toBe(false);
    expect(isBlocked("/clubs/3/members", off)).toBe(false);
  });

  it("holds signed-in pages until the switches load, but not the sign-in page", () => {
    expect(holdPage(true, false, false, "/login", null)).toBe(true);
    expect(holdPage(false, false, false, "/login", "/login")).toBe(false);
    expect(holdPage(false, true, false, "/login", "/login")).toBe(false);
    expect(holdPage(false, true, false, "/clubs/3/club-monthly-report", "/login")).toBe(true);
    expect(holdPage(false, true, false, "/clubs/3/club-monthly-report", null)).toBe(true);
    expect(holdPage(false, true, true, "/clubs/3/club-monthly-report", null)).toBe(false);
  });
});
