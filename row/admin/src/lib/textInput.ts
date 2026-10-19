// What the free-text fields (titles, descriptions, event names, member and club names) accept.
//
// ROW is used in eight languages (English, French, German, Italian, Japanese, Korean, Portuguese,
// Spanish — master plan section 1.3), so these fields take letters of ANY language: accents (é, ñ,
// ß, ç), Japanese and Korean script, digits, punctuation and symbols such as € or ₹.
// Emoji are the one thing refused: they do not print in the PDF and Word reports.
//
// This replaces the old ENGLISH_ONLY_REGEX (A–Z only), which was copied into each form and silently
// dropped every keystroke outside English.

// Emoji and the invisible characters that build them: pictographs, skin-tone modifiers, flag
// letters, the emoji variation selectors and the keycap mark.
const EMOJI = "\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\uFE0E\\uFE0F\\u20E3";

// Letters (any language), accent marks, numbers, punctuation, symbols and whitespace.
const TEXT_CHAR = "\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\s";

/** True when the whole value is allowed text: any language, no emoji. Use as `TEXT_INPUT_REGEX.test(value)`. */
export const TEXT_INPUT_REGEX = new RegExp(`^(?:(?![${EMOJI}])[${TEXT_CHAR}])*$`, "u");

const DISALLOWED = new RegExp(`[${EMOJI}]|[^${TEXT_CHAR}]`, "gu");

// Look-alikes from Word, PDFs and web pages that are kept as their plain equivalent.
const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",   // single quotes
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',   // double quotes
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-",   // dashes
  "―": "-", "−": "-",
  "…": "...",                                                             // ellipsis
  "•": "-", "●": "-", "▪": "-", "⁃": "-",                  // bullets
  " ": " ", " ": " ", " ": " ", " ": " ",                  // odd spaces
  "​": "", "‌": "", "‍": "", "﻿": "",                      // zero-width
  "©": "(c)", "®": "(r)", "™": "(tm)",                          // ©, ®, ™ count as emoji; keep them readable
};
const REPLACEABLE = new RegExp(`[${Object.keys(REPLACEMENTS).join("")}]`, "g");

/**
 * Clean pasted or typed text so the paste always lands: look-alike quotes, dashes and spaces become
 * plain ones, emoji and control characters are dropped. Letters of every language are kept as typed
 * (José stays José). Line breaks are preserved.
 */
export function sanitizeText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFC")            // join a letter and its accent typed separately (e + ́ → é)
    .replace(REPLACEABLE, (ch) => REPLACEMENTS[ch] ?? "")
    .replace(DISALLOWED, "");
}

/**
 * What a member's Full Name field strips as it is typed: everything except letters (any language),
 * accent marks, spaces and the dot ("Dr. Rajesh P. Shah", "José García", "山田 太郎").
 * Digits and emoji are removed. The apostrophe and hyphen ("D'Souza", "Smith-Jones") are not allowed yet.
 */
export const MEMBER_NAME_FILTER = new RegExp(`[${EMOJI}]|[^\\p{L}\\p{M}\\s.]`, "gu");

/** What a Club Name field strips as it is typed: everything except letters (any language), accent marks and spaces. */
export const CLUB_NAME_FILTER = new RegExp(`[${EMOJI}]|[^\\p{L}\\p{M}\\s]`, "gu");
