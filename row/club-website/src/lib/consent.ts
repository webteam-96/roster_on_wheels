// Cookie consent for the public site (ROW build spec 3.11 / 3.14). The site sets only essential
// cookies itself; third-party embeds (the Google Map) load only after "Allow all".

export const CONSENT_COOKIE = "row_cookie_consent";
export type Consent = "essential" | "all";
export const CONSENT_EVENT = "row-consent-change";
export const OPEN_SETTINGS_EVENT = "row-open-cookie-settings";

const MAX_AGE = 180 * 24 * 60 * 60;

export function readConsent(cookieHeader: string): Consent | null {
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === CONSENT_COOKIE && (v === "essential" || v === "all")) return v;
  }
  return null;
}

export function consentCookie(value: Consent, secure: boolean): string {
  return `${CONSENT_COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}
