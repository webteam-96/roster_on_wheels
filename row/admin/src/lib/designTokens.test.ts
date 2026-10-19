import { describe, expect, it } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import config from "../../tailwind.config";

// Fellowship tokens (row/website/design.md) must reach every existing Tailwind class.
const theme = resolveConfig(config).theme as unknown as {
  colors: Record<string, Record<string, string> | string>;
  boxShadow: Record<string, string>;
  backgroundImage: Record<string, string>;
};
const c = (name: string, shade: string) => (theme.colors[name] as Record<string, string>)[shade];

describe("Fellowship design tokens", () => {
  it("remaps the blue family to Fellowship blues", () => {
    for (const name of ["blue", "indigo", "sky", "cyan", "teal", "violet", "purple", "fuchsia", "pink"]) {
      expect(c(name, "700")).toBe("#17458F");
      expect(c(name, "500")).toBe("#0067C8");
    }
  });

  it("remaps the neutral family to ink-tinted neutrals", () => {
    for (const name of ["slate", "gray", "zinc", "neutral", "stone"]) {
      expect(c(name, "800")).toBe("#1B2C42");
      expect(c(name, "50")).toBe("#F7F9FC");
    }
  });

  it("maps yellow and orange to marigold and keeps status colours", () => {
    expect(c("yellow", "500")).toBe("#F7A81B");
    expect(c("orange", "500")).toBe("#F7A81B");
    expect(c("green", "600")).toBe("#16a34a");
    expect(c("red", "600")).toBe("#dc2626");
    expect(c("amber", "500")).toBe("#f59e0b");
  });

  it("exposes the named design.md tokens", () => {
    expect(theme.colors.azure).toBe("#17458F");
    expect(theme.colors.marigold).toBe("#F7A81B");
    expect(theme.colors.ink).toBe("#1B2C42");
    expect(theme.colors.white).toBe("#FCFDFE"); // no pure white surfaces (FRONTEND-RULES #3)
  });

  it("turns drop shadows and decorative gradients off", () => {
    for (const k of ["sm", "DEFAULT", "md", "lg", "xl", "2xl", "card", "soft", "lift", "glow-gold"]) {
      expect(theme.boxShadow[k]).toBe("none");
    }
    for (const k of ["glow-warm", "royal-sheen", "mesh-light", "hero-radial", "event-card"]) {
      expect(theme.backgroundImage[k]).toBe("none");
    }
  });
});
