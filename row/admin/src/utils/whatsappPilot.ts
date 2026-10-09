/**
 * Who sees the "WhatsApp" notify checkbox on Upcoming Events / Announcements / Newsletters
 * (v2 Add + Edit). Mirrors RotaryApi/Services/WhatsAppPilot.cs — keep the two in step.
 *
 * Started as a pilot (2026-09-17: Thane City View + District 5656) while the new templates were
 * tested live. Opened up on 2026-09-30:
 *   • CLUBS — every club, in all three modules.
 *   • DISTRICTS — Upcoming Events only. District Announcements and the district GML stay on the
 *     pilot list: the GML has no approved template of its own yet, and the district no-image
 *     announcement template still carries the clickable header that is being removed.
 */

export type WhatsAppModule = "event" | "announcement" | "newsletter";

/** District 5656 (pk_district_id 2) — still the only district for announcements / GML. */
const WHATSAPP_PILOT_DISTRICT_IDS: number[] = [2];

/** Every club may send, in every module. */
export const isWhatsAppPilotClub = (_clubId: number, _module: WhatsAppModule = "event") => true;

/** Upcoming Events: every district. Announcements / GML: the pilot list only. */
export const isWhatsAppPilotDistrict = (districtId: number, module: WhatsAppModule = "event") =>
  module === "event" ? true : WHATSAPP_PILOT_DISTRICT_IDS.includes(districtId);
