import { describe, expect, it } from "vitest";
import { currentMonth, deliveryLabel, isGivingUrl, isLanguageCode, isTemplateKey, rate } from "./comms";

describe("comms rules", () => {
  it("accepts the Foundation giving links the server accepts", () => {
    expect(isGivingUrl("https://my.rotary.org/en/donate")).toBe(true);
    for (const bad of ["http://example.org/give", "javascript:alert(1)", "https://example.org/a b", "/give",
      "https://user:secret@example.org/give", `https://example.org/${"a".repeat(490)}`, "https://localhost/give"]) {
      expect(isGivingUrl(bad)).toBe(false);
    }
  });

  it("accepts the template keys and language codes the server accepts", () => {
    expect(isTemplateKey("newsletter-oct_2026")).toBe(true);
    expect(isTemplateKey("Bad Key")).toBe(false);
    expect(isTemplateKey("-lead")).toBe(false);
    expect(isLanguageCode("es")).toBe(true);
    expect(isLanguageCode("pt-BR")).toBe(true);
    expect(isLanguageCode("Spanish")).toBe(false);
  });

  it("rounds rates and never divides by zero", () => {
    expect(rate(1, 3)).toBe("33%");
    expect(rate(0, 0)).toBe("0%");
  });

  it("labels a recipient by the furthest thing that happened", () => {
    expect(deliveryLabel("Skipped", null, 0, 0)).toBe("Skipped");
    expect(deliveryLabel("Sent", "Delivered", 2, 1)).toBe("Clicked");
    expect(deliveryLabel("Sent", "Delivered", 1, 0)).toBe("Opened");
    expect(deliveryLabel("Sent", "Bounced", 0, 0)).toBe("Bounced");
    expect(deliveryLabel("Sent", "Complaint", 1, 0)).toBe("Spam complaint");
    expect(deliveryLabel("Sent", null, 0, 0)).toBe("Sent");
  });

  it("counts the allowance month in UTC", () => {
    expect(currentMonth(new Date(Date.UTC(2026, 0, 31, 23, 30)))).toBe("2026-01");
  });
});
