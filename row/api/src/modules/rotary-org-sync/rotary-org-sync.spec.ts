import { Brand, defaultBrand } from "../../brand/brand";
import type { AppConfig } from "../../config/app-config";
import { decryptProjectSyncToken, generateProjectSyncToken, protectCredential, unprotectCredential } from "../../services/rotary-org/project-sync-token";
import { buildMeetingAddress, ClubCacheRefreshService, normalizeMeetingDay, parseMeetingTime } from "../../services/rotary-org/rotary-org-sync.services";
import { isYouthAge, parseRotaryDob } from "./rotary-org-manual-sync.controller";

const config = { get: (k: string) => (k === "JwtSettings:Secret" ? "s".repeat(40) : null) } as unknown as AppConfig;
beforeAll(() => Brand.initialise(defaultBrand()));

describe("rotary.org sync helpers", () => {
  it("normalises meeting days and HHMM times", () => {
    expect(normalizeMeetingDay("thurs")).toBe("Thursday");
    expect(normalizeMeetingDay("  ")).toBeNull();
    expect(normalizeMeetingDay("Every 2nd Tue")).toBe("Every 2nd Tue");
    expect(parseMeetingTime("1930")).toBe("19:30:00");
    expect(parseMeetingTime("730")).toBe("07:30:00");
    expect(parseMeetingTime("7:30 PM")).toBe("19:30:00");
    expect(parseMeetingTime("2575")).toBeNull();
    expect(buildMeetingAddress({ meetingName: "Hall", addressLine1: " 1 Main St ", addressLine2: null, addressLine3: "" } as never)).toBe("Hall, 1 Main St");
  });
  it("reads Rotary.org dates of birth and youth age", () => {
    expect(parseRotaryDob("08/01/1990")).toBe("1990-08-01");
    expect(parseRotaryDob("1990-08-01T00:00:00")).toBe("1990-08-01");
    expect(isYouthAge("2000-06-15", null, "2026-06-14")).toBe(1);
    expect(isYouthAge("1980-01-01", null, "2026-06-14")).toBe(0);
    expect(isYouthAge(null, true, "2026-06-14")).toBe(1);
  });
  it("round-trips the project sync token and rejects tampering", () => {
    const t = generateProjectSyncToken(config, 12, 34, 56);
    expect(decryptProjectSyncToken(config, t).payload).toMatchObject({ projectId: 12, clubId: 34, memberId: 56 });
    expect(decryptProjectSyncToken(config, t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA")).payload).toBeNull();
    expect(decryptProjectSyncToken(config, generateProjectSyncToken(config, 1, 2, null, -1)).error).toBe("This sync token has expired.");
  });
  it("encrypts club credentials and reads unknown ciphertext as absent", () => {
    const c = protectCredential(config, "user@example.org");
    expect(c.startsWith("v1:")).toBe(true);
    expect(unprotectCredential(config, c)).toBe("user@example.org");
    expect(unprotectCredential(config, "CfDJ8legacy-dataprotection")).toBeNull();
  });
  it("schedules the cache refresh at the next 08:00 brand time", () => {
    const next = ClubCacheRefreshService.nextScheduledRunUtc(new Date("2026-01-01T12:00:00Z"));
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(next)).toBeGreaterThan(Date.parse("2026-01-01T12:00:00Z"));
    expect(Date.parse(next) - Date.parse("2026-01-01T12:00:00Z")).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});
