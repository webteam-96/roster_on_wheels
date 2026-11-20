import { describe, expect, it } from "vitest";
import { EMPTY_EXTRAS_FORM, qrFileName, toForm, toSettings } from "./websiteExtras";

describe("website extras form", () => {
  it("sends blank fields as off and trims the rest", () => {
    expect(toSettings({ ...EMPTY_EXTRAS_FORM, xUsername: "  @rotary ", gaMeasurementId: "   " })).toEqual({
      facebookPageUrl: null, instagramUsername: null, xUsername: "@rotary", gaMeasurementId: null,
    });
  });

  it("round-trips saved settings", () => {
    const saved = { facebookPageUrl: "https://www.facebook.com/rotary", instagramUsername: null, xUsername: "rotary", gaMeasurementId: "G-ABC1234" };
    expect(toSettings(toForm(saved))).toEqual(saved);
  });

  it("names QR downloads after the page", () => {
    expect(qrFileName("/", "png")).toBe("qr-home.png");
    expect(qrFileName("/events", "svg")).toBe("qr-events.svg");
    expect(qrFileName("/event?id=12", "png")).toBe("qr-event-id-12.png");
  });
});
