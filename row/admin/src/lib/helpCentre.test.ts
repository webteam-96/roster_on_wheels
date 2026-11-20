import { describe, expect, it } from "vitest";
import { helpArticleUrl, helpContextPath } from "./helpCentre";

describe("helpCentre links", () => {
  it("builds the website article URL", () => {
    expect(helpArticleUrl("send-a-mass-email", "")).toBe("/help/send-a-mass-email");
    expect(helpArticleUrl("a b", "https://row.example")).toBe("https://row.example/help/a%20b");
  });
  it("normalises the admin path", () => {
    expect(helpContextPath("/Club-Admin-Dashboard/Grants/?yearId=3")).toBe("/club-admin-dashboard/grants");
    expect(helpContextPath("/")).toBe("/");
  });
});
