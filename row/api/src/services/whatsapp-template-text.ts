/**
 * Port of WhatsAppTemplateText.cs: text-fitting rules for WhatsApp template body parameters
 * (a rendered body may hold 600 characters; a parameter may not carry newlines, tabs or runs of spaces).
 * Lengths are UTF-16 code units, as in .NET, so emoji over-count (the safe side).
 */
export const MAX_BODY_CHARS = 600;
export const MIN_FREE_TEXT_CHARS = 40;

// shortcut: the common named entities only (WebUtility.HtmlDecode knows all of HTML 4); add more if stored text needs them.
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", rarr: "→", larr: "←", laquo: "«", raquo: "»",
};

/** WebUtility.HtmlDecode for numeric and the common named entities. */
export function htmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? NAMED[e] ?? m;
  });
}

/** Stored free text (newlines, stray HTML, entities, whitespace runs, literal "\n") as one clean line. */
export function normaliseText(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "";
  return htmlDecode(raw.replace(/<[^>]+>/g, " ")).replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\s+/g, " ").trim();
}

export const collapseWhitespace = (raw: string | null | undefined) => (!raw || !raw.trim() ? "" : raw.replace(/\s+/g, " ").trim());

/** Cut on a word boundary and append "…"; `max` bounds the result including the ellipsis; never splits a surrogate pair. */
export function truncateText(s: string | null | undefined, max: number): string {
  if (!s || max <= 0) return "";
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > Math.trunc(max / 2)) cut = cut.slice(0, lastSpace);
  else if (cut.length > 0 && /[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  cut = cut.replace(/[ ,;:\-.]+$/, "");
  return cut.length === 0 ? "" : cut + "…";
}

/** Characters the template's own static text contributes (placeholders removed, CRLF folded). */
export const staticChars = (templateBody: string | null | undefined) => (!templateBody ? 0 : templateBody.replace(/\r\n/g, "\n").replace(/\{\{\s*\d+\s*\}\}/g, "").length);

/** 600 − static text − every other parameter as sent (blank goes as "-", 1 character). */
export function remainingBudget(staticBodyChars: number, ...otherValues: (string | null | undefined)[]): number {
  let used = staticBodyChars;
  for (const v of otherValues) used += collapseWhitespace(v).length || 1;
  return MAX_BODY_CHARS - used;
}

export const fitFreeText = (text: string | null | undefined, staticBodyChars: number, ...otherValues: (string | null | undefined)[]) =>
  fitNormalisedText(normaliseText(text), staticBodyChars, ...otherValues);

/** "" when the budget left is under the 40-character floor. */
export function fitNormalisedText(text: string | null | undefined, staticBodyChars: number, ...otherValues: (string | null | undefined)[]): string {
  if (!text) return "";
  const budget = remainingBudget(staticBodyChars, ...otherValues);
  if (budget >= text.length) return text;
  if (budget < MIN_FREE_TEXT_CHARS) return "";
  return truncateText(text, budget);
}
