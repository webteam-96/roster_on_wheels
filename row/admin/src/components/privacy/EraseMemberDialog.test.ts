import { describe, expect, it } from "vitest";
import { confirmMatches } from "./EraseMemberDialog";

describe("confirmMatches (typed erasure confirmation)", () => {
  it("accepts the name with any case and extra spaces", () => {
    expect(confirmMatches("Asha Perera", "  asha   PERERA ")).toBe(true);
  });
  it("refuses a partial or empty name", () => {
    expect(confirmMatches("Asha Perera", "Asha")).toBe(false);
    expect(confirmMatches("Asha Perera", "   ")).toBe(false);
  });
});
