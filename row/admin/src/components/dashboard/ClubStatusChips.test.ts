import { describe, expect, it } from "vitest";
import { websiteCta } from "./ClubStatusChips";

describe("websiteCta", () => {
  it("visits a live site, renews an ended one, offers one when there is none", () => {
    expect(websiteCta({ status: "active", configured: true, visitUrl: "https://x" })).toMatchObject({ label: "Visit Website", external: true });
    expect(websiteCta({ status: "expired", configured: true }).label).toBe("Renew Website");
    expect(websiteCta({ status: "not_configured", configured: false }).label).toBe("Get Website");
    expect(websiteCta({ status: "killed", configured: true }).href).toBeNull();
  });
});
