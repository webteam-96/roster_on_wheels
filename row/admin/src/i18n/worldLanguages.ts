/**
 * A broad set of world languages for the language pickers (UI locale switcher and
 * the member "Primary Language" field). Names are rendered with Intl.DisplayNames,
 * so adding a BCP-47 base code here is all that is needed — no name tables to keep.
 *
 * This is deliberately NOT tied to the brand's location: the user can pick any of
 * these. UI strings for a language without a static message catalog are filled in
 * by machine translation (see i18n/translateCatalog.ts).
 */
export const WORLD_LANGUAGE_CODES: readonly string[] = [
  // Western / Northern / Southern Europe
  "en", "es", "fr", "de", "it", "pt", "nl", "sv", "no", "da", "fi", "is", "ga", "cy", "gd", "br",
  "eu", "ca", "gl", "lb", "mt", "fo",
  // Central / Eastern Europe, Balkans, Baltics
  "ru", "uk", "pl", "cs", "sk", "sl", "hr", "sr", "bs", "bg", "mk", "be", "ro", "hu", "el", "sq",
  "lt", "lv", "et",
  // Caucasus / Central Asia / Turkic
  "tr", "az", "kk", "ky", "uz", "tk", "tt", "mn", "hy", "ka",
  // Middle East / Semitic / Iranian
  "ar", "he", "fa", "ps", "ku", "ur",
  // South Asia
  "hi", "bn", "pa", "gu", "or", "ta", "te", "kn", "ml", "mr", "ne", "si", "as", "sd",
  // East / Southeast Asia
  "zh", "zh-Hant", "ja", "ko", "vi", "th", "lo", "km", "my", "id", "ms", "tl", "ceb", "jv", "su",
  // Africa
  "am", "ti", "so", "ha", "yo", "ig", "sw", "zu", "xh", "af", "st", "sn", "rw", "lg", "mg", "ny", "wo",
  // Americas / Pacific / constructed
  "ht", "qu", "ay", "gn", "la", "eo", "haw", "sm", "to", "fj", "mi",
];

/** English display name for a code (for the member-field list), e.g. "fr" -> "French". */
export function englishLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Sorted, de-duplicated English names of every world language, for the member "Primary Language" field. */
export const WORLD_LANGUAGE_NAMES: readonly string[] = Array.from(
  new Set(WORLD_LANGUAGE_CODES.map(englishLanguageName)),
).sort((a, b) => a.localeCompare(b));
