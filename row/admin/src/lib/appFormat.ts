/**
 * Locale, currency and time zone for code that cannot call useFormat(): plain
 * helpers, export builders, callbacks and module-level functions. Reads the
 * brand the client is showing (getActiveBrand) and the interface language
 * (<html lang>, set by IntlProvider) at call time.
 *
 * React components should prefer useFormat() from @/hooks/useFormat.
 */

import { getActiveBrand } from "@/lib/brand";
import { createFormat, numberLocaleFor, todayIn, type Formatters } from "@/lib/format";

/** The interface language ("en", "fr", ...). */
export function interfaceLanguage(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) return document.documentElement.lang;
  return getActiveBrand().locale.defaultLanguage || "en";
}

/** Locale for numbers and dates: the brand's number locale for English, else the interface language. */
export function appLocale(): string {
  return numberLocaleFor(interfaceLanguage(), getActiveBrand().locale.numberLocale);
}

/** The instance's default currency (ISO 4217). */
export function defaultCurrency(): string {
  return getActiveBrand().locale.defaultCurrency;
}

/** The instance's default time zone (IANA). */
export function appTimeZone(): string {
  return getActiveBrand().locale.defaultTimeZone;
}

/** Formatters for the current locale, default currency and zone. */
export function appFormat(): Formatters {
  return createFormat(appLocale(), defaultCurrency(), appTimeZone());
}

/** The symbol of a currency in the current locale ("$", "€", "￥"); the default currency when none is given. */
export function currencySymbol(code?: string | null): string {
  return appFormat().currencySymbol(code || undefined);
}

/** Today's date ("YYYY-MM-DD") in the instance's zone. */
export function todayLocal(): string {
  return todayIn(appTimeZone());
}
