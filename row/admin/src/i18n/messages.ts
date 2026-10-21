import { DEFAULT_LOCALE, PSEUDO_LOCALE } from "@/i18n/config";

export type Messages = { [key: string]: string | Messages };

async function loadOne(locale: string, namespace: string): Promise<Messages> {
  try {
    const mod = await import(`../../messages/${locale}/${namespace}.json`);
    return (mod.default ?? mod) as Messages;
  } catch {
    // A namespace not yet translated (or not yet extracted) is simply empty.
    return {};
  }
}

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const existing = out[key];
    out[key] =
      typeof value === "object" && typeof existing === "object" ? deepMerge(existing, value) : value;
  }
  return out;
}

/** One row of the string catalogue (API `GET api/i18n/{locale}`); key is a dotted path inside the namespace. */
export type Override = { namespace: string; key: string; text: string; reviewed?: boolean };

/**
 * Overrides from the string catalogue (ROW Wave 1, build spec item 3) laid over loaded messages. Only namespaces
 * already loaded are touched; keys without an override keep their bundled (English-backed) text.
 */
export function applyOverrides(messages: Messages, overrides: readonly Override[]): Messages {
  const over: Messages = {};
  for (const { namespace, key, text } of overrides) {
    if (!(namespace in messages)) continue;
    const path = [namespace, ...key.split(".")];
    let node = over;
    for (const part of path.slice(0, -1)) {
      if (typeof node[part] !== "object") node[part] = {};
      node = node[part] as Messages;
    }
    node[path[path.length - 1]] = text;
  }
  return deepMerge(messages, over);
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

/** The catalogue overrides for a locale; none if the API is slow or down (bundled messages still show). */
export async function fetchOverrides(locale: string): Promise<Override[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/i18n/${encodeURIComponent(locale)}`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as Override[]) : [];
  } catch {
    return [];
  }
}

/** ICU-escape text inserted verbatim into a message (apostrophes and braces). */
function icuEscape(text: string): string {
  return text.replace(/'/g, "''").replace(/[{}]/g, (c) => `'${c}'`);
}

/**
 * The product name inside sentences is written {brandName} in every message
 * (master plan section 7.2). It is the same for every message in an instance,
 * so it is filled in once here rather than passed at every call site.
 */
export function fillBrandName(messages: Messages, brandName: string): Messages {
  const escaped = icuEscape(brandName);
  const out: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    out[key] = typeof value === "string" ? value.split("{brandName}").join(escaped) : fillBrandName(value, brandName);
  }
  return out;
}

/**
 * Messages for the given namespaces, each nested under its namespace name.
 * English is loaded first and the locale's messages merged over it, so a key
 * missing in a translation shows the English text instead of the key.
 */
export async function loadRawMessages(locale: string, namespaces: readonly string[]): Promise<Messages> {
  const [entries, englishOverrides, localeOverrides] = await Promise.all([
    Promise.all(
      namespaces.map(async (ns) => {
        const english = await loadOne(DEFAULT_LOCALE, ns);
        const localized = locale === DEFAULT_LOCALE ? {} : await loadOne(locale, ns);
        return [ns, english, localized] as const;
      }),
    ),
    fetchOverrides(DEFAULT_LOCALE),
    locale === DEFAULT_LOCALE || isPseudo(locale) ? Promise.resolve([]) : fetchOverrides(locale),
  ]);
  // English (bundled + its overrides) under the locale (bundled + its overrides): a gap shows English, never a key.
  const english = applyOverrides(Object.fromEntries(entries.map(([ns, en]) => [ns, en])), englishOverrides);
  const localized = applyOverrides(Object.fromEntries(entries.map(([ns, , loc]) => [ns, loc])), localeOverrides);
  return deepMerge(english, localized);
}

export async function loadMessages(locale: string, namespaces: readonly string[], brandName: string): Promise<Messages> {
  return fillBrandName(await loadRawMessages(locale, namespaces), brandName);
}

export function isPseudo(locale: string): boolean {
  return locale === PSEUDO_LOCALE;
}
