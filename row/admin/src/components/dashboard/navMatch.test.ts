import { describe, expect, it } from "vitest";
import { navMatch } from "./navMatch";

describe("navMatch", () => {
  const links = ["/settings", "/settings/currency", "/admin", "/admin/modules", "/clubs"];
  it("takes the longest link the path starts with", () => {
    expect(navMatch(links, "/settings/currency")).toBe("/settings/currency");
    expect(navMatch(links, "/settings/audit-log")).toBe("/settings");
    expect(navMatch(links, "/clubs/1/announcements")).toBe("/clubs");
  });
  it("does not match half a segment, or an unknown page", () => {
    expect(navMatch(links, "/clubsx")).toBeUndefined();
    expect(navMatch(links, "/members/1")).toBeUndefined();
  });
});
