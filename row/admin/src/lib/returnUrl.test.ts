import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./returnUrl";

describe("safeReturnPath", () => {
  it("keeps a local path with its query", () => {
    expect(safeReturnPath("/report/dues/5")).toBe("/report/dues/5");
    expect(safeReturnPath("/report/5?a=1#b")).toBe("/report/5?a=1#b");
  });

  it.each([
    null, undefined, "", "report/5",
    "https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "\\\\evil.example", "javascript:alert(1)",
    "/\t/evil.example", "/\n/evil.example", "/login", "/login?returnUrl=/report/5",
  ])("refuses %s", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });
});
