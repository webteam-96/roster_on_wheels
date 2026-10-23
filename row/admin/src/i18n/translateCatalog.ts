import type { Messages } from "@/i18n/messages";
import { postTranslate } from "@/i18n/postTranslate";

/**
 * Machine-translate a message catalog (English source) into any target locale,
 * for locales that have no static message files. Placeholders like {name} are
 * protected across translation; messages with ICU plural/select are left in
 * English (machine translation would break their structure). Results are cached
 * in localStorage per locale, so a language is translated once per string, ever.
 *
 * Fails safe: any error returns the English catalog unchanged.
 */

const CACHE_PREFIX = "i18n:mt:v1:";
const MASK_OPEN = "";
const MASK_CLOSE = "";
const COMPLEX_ICU = /\{[^{}]+,\s*(plural|select|selectordinal)\b/;
const HAS_LETTER = /\p{L}/u;

type Leaf = { ref: Messages; key: string; value: string };

function collectLeaves(node: Messages, out: Leaf[]): void {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === "string") out.push({ ref: node, key, value });
    else collectLeaves(value, out);
  }
}

/** True when a string should be translated (has letters, not a complex ICU message). */
function translatable(s: string): boolean {
  return HAS_LETTER.test(s) && !COMPLEX_ICU.test(s);
}

function mask(s: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const masked = s.replace(/\{[^{}]+\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `${MASK_OPEN}${i}${MASK_CLOSE}`;
  });
  return { masked, tokens };
}

function unmask(s: string, tokens: string[]): string {
  return s.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"), (_, i) => tokens[Number(i)] ?? "");
}

function loadCache(locale: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_PREFIX + locale) || "{}");
  } catch {
    return {};
  }
}

function saveCache(locale: string, cache: Record<string, string>): void {
  try {
    localStorage.setItem(CACHE_PREFIX + locale, JSON.stringify(cache));
  } catch {
    /* quota / private mode: translations just won't persist */
  }
}

/** Deep-clone the catalog so we don't mutate the shared English object. */
function clone(node: Messages): Messages {
  const out: Messages = {};
  for (const key of Object.keys(node)) {
    const value = node[key];
    out[key] = typeof value === "string" ? value : clone(value);
  }
  return out;
}

export async function translateCatalog(english: Messages, targetLocale: string): Promise<Messages> {
  try {
    const result = clone(english);
    const leaves: Leaf[] = [];
    collectLeaves(result, leaves);

    const cache = loadCache(targetLocale);
    // Unique source strings that still need translating.
    const needed = Array.from(
      new Set(leaves.map((l) => l.value).filter((v) => translatable(v) && cache[v] === undefined)),
    );

    if (needed.length > 0) {
      const masks = needed.map(mask);
      const res = await postTranslate({ target: targetLocale, source: "en", q: masks.map((m) => m.masked) });
      if (res.ok) {
        const { translations } = (await res.json()) as { translations: string[] };
        needed.forEach((original, i) => {
          const t = translations?.[i];
          cache[original] = typeof t === "string" && t ? unmask(t, masks[i].tokens) : original;
        });
        saveCache(targetLocale, cache);
      }
    }

    for (const leaf of leaves) {
      if (translatable(leaf.value) && cache[leaf.value]) leaf.ref[leaf.key] = cache[leaf.value];
    }
    return result;
  } catch {
    return english; // never break the UI
  }
}
