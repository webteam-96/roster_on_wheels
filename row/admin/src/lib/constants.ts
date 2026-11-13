
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export const GENDERS = ["Male", "Female", "Other"];
// A member's primary language: the eight launch languages (i18n/config SUPPORTED_LOCALES), then "Other".
export const LANGUAGES = ["English", "French", "German", "Italian", "Japanese", "Korean", "Portuguese", "Spanish", "Other"];
// Family relations — alphabetical, no "Other"/"Others" fallback. Spouse is
// kept (gender-neutral) — Husband/Wife intentionally NOT included; the old
// project used only Spouse and we're keeping that convention. If the user
// doesn't pick anything, the family row is saved with Relation = "" (NULL
// on DB side). Adding new relations? keep sorted ASC.
export const RELATIONS = [
  "Brother",
  "Daughter",
  "Daughter-in-law",
  "Father",
  "Granddaughter",
  "Grandson",
  "Mother",
  "Sister",
  "Sister-in-law",
  "Son",
  "Son-in-law",
  "Spouse",
];
export const INDIAN_STATES = [
  "Maharashtra",
  "Gujarat",
  "Karnataka",
  "Tamil Nadu",
  "Rajasthan",
  "Delhi",
  "Uttar Pradesh",
  "West Bengal",
  "Kerala",
  "Madhya Pradesh",
  "Telangana",
  "Andhra Pradesh",
  "Punjab",
  "Haryana",
  "Bihar",
  "Other",
];
export const MEETING_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

/** IANA zones for a district's time zone (N12): the browser's full list, else TIMEZONES. */
export function timeZoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return TIMEZONES;
  }
}
