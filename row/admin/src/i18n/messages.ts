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
  const entries = await Promise.all(
    namespaces.map(async (ns) => {
      const english = await loadOne(DEFAULT_LOCALE, ns);
      const localized = locale === DEFAULT_LOCALE ? {} : await loadOne(locale, ns);
      return [ns, deepMerge(english, localized)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function loadMessages(locale: string, namespaces: readonly string[], brandName: string): Promise<Messages> {
  return fillBrandName(await loadRawMessages(locale, namespaces), brandName);
}

export function isPseudo(locale: string): boolean {
  return locale === PSEUDO_LOCALE;
}
