import { describe, expect, it } from "vitest";
import { isBlocked, offPatterns } from "./FeatureGate";
import type { PlatformFeature } from "@/services/api";

const f = (key: string, kind: "skipped" | "flagged", enabled: boolean, adminPaths: string[]): PlatformFeature =>
  ({ key, label: key, kind, enabled, adminPaths });

describe("feature gate", () => {
  const features = [
    f("pph_camps", "skipped", false, ["/pph-camps(/|$)"]),
    f("ocv", "flagged", false, ["/ocv-gov(/|$)"]),
    f("sub_groups", "flagged", true, ["^/(clubs|districts)/[^/]+/sub-groups(/|$)"]),
  ];
  const off = offPatterns(features);

  it("blocks skipped modules and flagged modules that are off", () => {
    expect(isBlocked("/clubs/3/pph-camps/v2", off)).toBe(true);
    expect(isBlocked("/clubs/3/ocv-gov", off)).toBe(true);
  });

  it("lets switched-on modules and look-alike paths through", () => {
    expect(isBlocked("/clubs/3/sub-groups", off)).toBe(false);
    expect(isBlocked("/clubs/3/pph-camps-report-old", off)).toBe(false);
    expect(isBlocked("/clubs/3/members", off)).toBe(false);
  });
});
