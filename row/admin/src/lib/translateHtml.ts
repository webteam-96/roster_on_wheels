import { decodeEntities } from "@/i18n/decodeEntities";

/** Machine-translates a list of strings in one call; returns them in the same order. */
export type Translator = (q: string[]) => Promise<string[]>;

// MyMemory (the translate route's default provider) takes about 500 bytes a request.
const MAX_PIECE = 450;

/** Splits text into pieces of at most `max` characters: at a sentence end where it can, else at a space. */
export function chunkText(text: string, max = MAX_PIECE): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? ")) + 1;
    if (cut <= 0) cut = head.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Plain text (a title, a description): translated piece by piece and joined again. */
export async function translateText(text: string, translate: Translator): Promise<string> {
  const pieces = chunkText(text);
  if (pieces.length === 0) return text;
  const out = await translate(pieces);
  return pieces.map((p, i) => out[i] || p).join(" ");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A page body: only the text between tags is translated, so headings, links, lists and images stay as they are.
 * Every text run is split into provider-sized pieces, all pieces go in one call, and each run gets its spaces back.
 * A piece the provider cannot translate comes back as the original.
 * shortcut: a sentence split by inline tags ("we meet <b>every</b> week") is translated in pieces and may read less
 * well; send whole blocks with their tags once the configured provider keeps HTML (DeepL, Google with format=html).
 */
export async function translateHtml(html: string, translate: Translator): Promise<string> {
  const parts = html.split(/(<[^>]*>)/);
  const runs: { index: number; lead: string; trail: string; pieces: string[] }[] = [];
  parts.forEach((part, index) => {
    if (part.startsWith("<") || !/\p{L}/u.test(part)) return;
    runs.push({ index, lead: /^\s*/.exec(part)![0], trail: /\s*$/.exec(part)![0], pieces: chunkText(decodeEntities(part)) });
  });
  const all = runs.flatMap((r) => r.pieces);
  if (all.length === 0) return html;
  const out = await translate(all);
  let k = 0;
  for (const r of runs) {
    const text = r.pieces.map((p) => out[k++] || p).join(" ");
    parts[r.index] = r.lead + escapeHtml(text) + r.trail;
  }
  return parts.join("");
}
