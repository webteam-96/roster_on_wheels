import type { WebsiteExtrasSettings } from "@/services/api";

export type WebsiteExtrasForm = Record<keyof WebsiteExtrasSettings, string>;

export const EMPTY_EXTRAS_FORM: WebsiteExtrasForm = { facebookPageUrl: "", instagramUsername: "", xUsername: "", gaMeasurementId: "" };

/** Saved settings as form text. */
export function toForm(s: WebsiteExtrasSettings): WebsiteExtrasForm {
  return {
    facebookPageUrl: s.facebookPageUrl ?? "",
    instagramUsername: s.instagramUsername ?? "",
    xUsername: s.xUsername ?? "",
    gaMeasurementId: s.gaMeasurementId ?? "",
  };
}

/** Form text as the API body: trimmed, blank means off (null). The server validates and normalizes the rest. */
export function toSettings(f: WebsiteExtrasForm): WebsiteExtrasSettings {
  const v = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    facebookPageUrl: v(f.facebookPageUrl),
    instagramUsername: v(f.instagramUsername),
    xUsername: v(f.xUsername),
    gaMeasurementId: v(f.gaMeasurementId),
  };
}

/** Download name of a page's QR code: qr-home.png, qr-events.svg, qr-event-id-12.png. */
export function qrFileName(path: string, format: "png" | "svg"): string {
  const slug = path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `qr-${slug || "home"}.${format}`;
}
