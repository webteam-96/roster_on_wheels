/**
 * Renders the approved Interakt WhatsApp template bodies for the on-screen phone preview.
 *
 * Mirrors the server (WhatsAppScheduledSendBackgroundService + WhatsAppTemplateText): the whole
 * rendered body may hold 600 characters, blank values go out as "-", and only the free-text
 * Details field is shortened (word boundary + "…", dropped to "-" below 40 chars) to fit.
 */

const MAX_BODY_CHARS = 600;
const MIN_FREE_TEXT_CHARS = 40;
const PLACEHOLDER = /\{\{\s*\d+\s*\}\}/g;

export const WA_MEMBER_NAME_PLACEHOLDER = "{Member Name}";
// Room the server reserves for the member's name when fitting Details (ClubEventNameReserveChars),
// so the Details shown here are exactly what members receive.
const WA_NAME_RESERVE_CHARS = 40;

// rizones45678_club_upcoming_event_image_updated / rizones45678_club_upcoming_event_no_image_updated
const CLUB_UPCOMING_EVENT_TEMPLATE = `Dear Rtn. {{1}},

You are invited to attend the upcoming event organised by RC {{2}}:

Event Title: {{3}}

Event Date: {{4}}

Details: {{5}}

Venue: {{6}}

Registration Link (if applicable): {{7}}

This is an automated message from Rizones45678.org. For further details, please contact your Club Admin.`;

// rizones45678_district_upcoming_event_image_updated / rizones45678_district_upcoming_event_no_image_updated
const DISTRICT_UPCOMING_EVENT_TEMPLATE = `Dear Rtn. {{1}},

You are invited to attend the upcoming event organized by RI District {{2}}:

Event Title: {{3}}

Event Date: {{4}}

Details: {{5}}

Venue: {{6}}

Registration Link (if applicable): {{7}}

This is an automated message from Rizones45678.org. For further details, please contact your District Admin.`;

const collapse = (v?: string | null) => (v ?? "").replace(/\s+/g, " ").trim();
const orDash = (v?: string | null) => collapse(v) || "-";

function staticChars(template: string) {
  return template.replace(PLACEHOLDER, "").length;
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max / 2) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[ ,;:\-.]+$/, "");
  return cut ? `${cut}…` : "";
}

function fitFreeText(text: string, template: string, others: string[]) {
  if (!text) return "";
  const used = staticChars(template) + others.reduce((n, v) => n + Math.max(1, collapse(v).length), 0);
  const budget = MAX_BODY_CHARS - used;
  if (budget >= text.length) return text;
  if (budget < MIN_FREE_TEXT_CHARS) return "";
  return truncate(text, budget);
}

function fill(template: string, values: string[]) {
  return template.replace(PLACEHOLDER, (m) => {
    const i = Number(m.replace(/\D/g, "")) - 1;
    return values[i] ?? m;
  });
}

/** "2026-09-25T18:30" → "25 Sep 2026 06:30 PM" (server format "dd MMM yyyy hh:mm tt"). */
export function formatWhatsAppEventDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = d.getHours() % 12 || 12;
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

// rizones45678_club_announcement_image_updated / rizones45678_club_announcement_no_image_updated
const CLUB_ANNOUNCEMENT_TEMPLATE = `Dear Rtn. {{1}},

Your Club {{2}} has shared an announcement for your information.

Title: {{3}}

Details: {{4}}

This is an automated notification from Rizones45678.org. For any queries regarding this announcement, please contact your Club Admin.`;

// rizones45678_district_announcement_image_updated / rizones45678_district_announcement_no_image_updated
const DISTRICT_ANNOUNCEMENT_TEMPLATE = `Dear Rtn. {{1}},

Your District {{2}} has shared an announcement for your information.

Title: {{3}}

Details: {{4}}

This is an automated notification from Rizones45678.org. For any queries regarding this announcement, please contact your District Admin.`;

const bareDistrictNumber = (districtName: string) => districtName.replace(/^\s*District\s+/i, "");

function renderAnnouncement(template: string, sourceName: string, title: string, description: string) {
  const name = WA_MEMBER_NAME_PLACEHOLDER;
  const source = orDash(sourceName);
  const t = orDash(title);
  const details = orDash(fitFreeText(collapse(description), template, ["x".repeat(WA_NAME_RESERVE_CHARS), source, t]));
  return fill(template, [name, source, t, details]);
}

/** Message body exactly as the club Announcement WhatsApp template will render it. */
export function renderClubAnnouncementWhatsApp(input: { clubName: string; title: string; description: string }) {
  return renderAnnouncement(CLUB_ANNOUNCEMENT_TEMPLATE, input.clubName, input.title, input.description);
}

/** Message body exactly as the district Announcement WhatsApp template will render it ({{2}} = bare number). */
export function renderDistrictAnnouncementWhatsApp(input: { districtName: string; title: string; description: string }) {
  return renderAnnouncement(DISTRICT_ANNOUNCEMENT_TEMPLATE, bareDistrictNumber(input.districtName), input.title, input.description);
}

export interface ClubUpcomingEventPreviewInput {
  clubName: string;
  title: string;
  eventDate: string;
  description: string;
  venue: string;
  registrationLink: string;
}

function renderUpcomingEvent(template: string, sourceName: string, input: Omit<ClubUpcomingEventPreviewInput, "clubName">) {
  const name = WA_MEMBER_NAME_PLACEHOLDER;
  const club = orDash(sourceName);
  const title = orDash(input.title);
  const date = orDash(formatWhatsAppEventDate(input.eventDate));
  const venue = orDash(input.venue);
  const link = orDash(input.registrationLink);
  const details = orDash(fitFreeText(collapse(input.description), template,
    ["x".repeat(WA_NAME_RESERVE_CHARS), club, title, date, venue, link]));
  return fill(template, [name, club, title, date, details, venue, link]);
}

/** Message body exactly as the club Upcoming Event WhatsApp template will render it. */
export function renderClubUpcomingEventWhatsApp(input: ClubUpcomingEventPreviewInput) {
  return renderUpcomingEvent(CLUB_UPCOMING_EVENT_TEMPLATE, input.clubName, input);
}

/** Message body exactly as the district Upcoming Event WhatsApp template will render it.
 *  districtName may be "District 3141" or "3141" — {{2}} is the bare number. */
export function renderDistrictUpcomingEventWhatsApp(input: Omit<ClubUpcomingEventPreviewInput, "clubName"> & { districtName: string }) {
  const number = bareDistrictNumber(input.districtName);
  return renderUpcomingEvent(DISTRICT_UPCOMING_EVENT_TEMPLATE, number, input);
}

// ── Club newsletter (approved 2026-09-24) ───────────────────────────────────────────────────────
// Two templates, picked by what the newsletter carries. Neither has a free-text field, so nothing
// is ever shortened — only the 50-character title and the link vary.

// rizones45678_newsletter_link_updated_2i
const CLUB_NEWSLETTER_LINK_TEMPLATE = `Dear Rtn. {{1}},

This is to inform you that a new newsletter from RC {{2}} is available on Rizones45678.org.

Newsletter Title: {{3}}

View Newsletter: {{4}}

This is an automated notification from Rizones45678.org. For any queries regarding this newsletter, please contact your Club Leader.`;

// rizones45678_newsletter_pdf_updated — the PDF itself rides in the template's document header.
const CLUB_NEWSLETTER_PDF_TEMPLATE = `Dear Rtn. {{1}},

This is to inform you that a new newsletter from RC {{2}} is available on Rizones45678.org.

Newsletter Title: {{3}}

Please check the attachment for the newsletter.

This is an automated notification from Rizones45678.org. For any queries regarding this newsletter, please contact your Club Leader.`;

/** Message body exactly as the club Newsletter WhatsApp template will render it. */
export function renderClubNewsletterWhatsApp(input: {
  clubName: string;
  title: string;
  attachmentType: "link" | "file";
  linkUrl?: string;
}) {
  const name = WA_MEMBER_NAME_PLACEHOLDER;
  const club = orDash(input.clubName);
  const title = orDash(input.title);
  if (input.attachmentType === "file") {
    return fill(CLUB_NEWSLETTER_PDF_TEMPLATE, [name, club, title]);
  }
  return fill(CLUB_NEWSLETTER_LINK_TEMPLATE, [name, club, title, orDash(input.linkUrl ?? "")]);
}
