// Text pasted from a web page, Word or a PDF is full of characters the plain-English fields do not
// accept: curly quotes, en/em dashes, ellipsis, bullets, non-breaking spaces, accented letters.
//
// The fields used to TEST the whole value and silently ignore the change when anything fell outside
// the allowed set, so a paste from Google simply vanished with no message. Instead we clean the text:
// the familiar look-alikes are converted to their plain equivalents and anything still unsupported is
// dropped, so the paste always lands.

// What the fields accept once cleaned. Everything else is removed.
const ALLOWED = "a-zA-Z0-9\\s.,!?;:'\"()\\[\\]{}*_$|\\-&@#%+=/";
const DISALLOWED = new RegExp(`[^${ALLOWED}]`, "g");

// Look-alikes worth keeping as readable text rather than deleting.
const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",   // single quotes
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',   // double quotes
  "«": '"', "»": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-",   // dashes
  "―": "-", "−": "-",
  "…": "...",                                                              // ellipsis
  "•": "-", "·": "-", "●": "-", "▪": "-", "⁃": "-",   // bullets
  " ": " ", " ": " ", " ": " ", " ": " ",                  // odd spaces
  "​": "", "‌": "", "‍": "", "﻿": "",                      // zero-width
  "₹": "Rs.", "€": "EUR", "£": "GBP", "¥": "JPY",
  "©": "(c)", "®": "(r)", "™": "(tm)", "°": " deg",
  "½": "1/2", "¼": "1/4", "¾": "3/4", "×": "x",
};
const REPLACEABLE = new RegExp(`[${Object.keys(REPLACEMENTS).join("")}]`, "g");

/**
 * Clean pasted or typed text down to what the plain-English fields store.
 * Accented letters keep their base letter (José → Jose); anything else unsupported is dropped.
 * Line breaks are preserved.
 */
export function sanitizeEnglishText(input: string): string {
  if (!input) return "";
  return input
    .replace(REPLACEABLE, (ch) => REPLACEMENTS[ch] ?? "")
    .normalize("NFD")            // split accented letters into letter + accent mark
    .replace(/[̀-ͯ]/g, "")  // drop the accent marks, keep the letter
    .replace(DISALLOWED, "");
}

/**
 * What a member's Full Name field strips as it is typed — everything EXCEPT letters, spaces
 * and the dot.
 *
 * The dot is here because a name legitimately carries one (user, 2026-09-28): "Dr. Rajesh P.
 * Shah". It used to be deleted under the cursor with no message, while the API has never had
 * such a rule and the database is full of names with dots — the ~12,000 rows carrying a Dr./Mr.
 * title, and everything Rotary.org syncs in. So opening one of those records and touching the
 * name silently rewrote it.
 *
 * Digits and non-English characters are still removed; the apostrophe and hyphen ("D'Souza",
 * "Smith-Jones") are NOT allowed yet — only the dot was asked for.
 */
export const MEMBER_NAME_FILTER = /[^a-zA-Z\s.]/g;
