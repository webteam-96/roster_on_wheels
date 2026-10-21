"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { IntlErrorCode, NextIntlClientProvider, type IntlError } from "next-intl";
import { useBrand } from "@/contexts/BrandContext";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  PSEUDO_LOCALE,
  namespacesFor,
  resolveLocale,
  isMachineTranslated,
} from "@/i18n/config";
import { applyOverrides, fetchOverrides, fillBrandName, loadMessages, loadRawMessages, type Messages } from "@/i18n/messages";
import { WORLD_LANGUAGE_CODES } from "@/i18n/worldLanguages";
import { translateCatalog } from "@/i18n/translateCatalog";
import englishCommon from "../../messages/en/common.json";
import englishErrors from "../../messages/en/errors.json";

const PSEUDO_ALLOWED = process.env.NODE_ENV !== "production";

const WORLD_SET = new Set<string>(WORLD_LANGUAGE_CODES);

// Bundled so the server render and the first client paint already have English
// text; route namespaces and other languages load afterwards.
const ENGLISH_BASE: Messages = { common: englishCommon, errors: englishErrors };

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeLocaleCookie(locale: string): void {
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; SameSite=Lax`;
}

interface LocaleControl {
  locale: string;
  /** Languages the user may pick: the instance's list, plus the pseudo-locale outside production. */
  available: string[];
  setLocale: (locale: string) => void;
}

const LocaleContext = createContext<LocaleControl>({
  locale: DEFAULT_LOCALE,
  available: [DEFAULT_LOCALE],
  setLocale: () => {},
});

export function useLocaleControl(): LocaleControl {
  return useContext(LocaleContext);
}

function onError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    if (process.env.NODE_ENV === "development") console.warn(`[i18n] ${error.message}`);
    return;
  }
  console.error(error);
}

function getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
  const path = namespace ? `${namespace}.${key}` : key;
  // Production never shows a raw key. English is merged under every locale, so
  // this fires only while a route's namespace is still loading (a moment of
  // blank is better than a key) or for a key missing in English too, which
  // `npm run i18n:check` and the development marker catch first.
  return process.env.NODE_ENV === "development" ? `⟦missing:${path}⟧` : "";
}

/**
 * Holds the current locale, loads `common`, `errors` and the namespaces of the
 * current route group, and provides them to useTranslations(). The locale comes
 * from the NEXT_LOCALE cookie, then the browser, then the instance default, and
 * is always one of the instance's languages (ROW: English only).
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
  const pathname = usePathname() ?? "/";
  const { languages, defaultLanguage, defaultTimeZone } = brand.locale;

  const [locale, setLocaleState] = useState<string>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages>(() => fillBrandName(ENGLISH_BASE, brand.productName));

  // Resolve once the brand (and its language list) is known, and again if it changes.
  // A locale the user explicitly picked (cookie) wins even if it is not a brand language —
  // any world language is allowed and filled in by machine translation.
  useEffect(() => {
    const cookie = readCookie(LOCALE_COOKIE);
    if (cookie && (WORLD_SET.has(cookie) || (PSEUDO_ALLOWED && cookie === PSEUDO_LOCALE))) {
      setLocaleState(cookie);
    } else {
      setLocaleState(
        resolveLocale(cookie, null, navigator.languages ?? [], defaultLanguage, languages, PSEUDO_ALLOWED),
      );
    }
  }, [defaultLanguage, languages]);

  const namespaces = useMemo(() => namespacesFor(pathname), [pathname]);
  const namespaceKey = namespaces.join(",");

  useEffect(() => {
    let cancelled = false;
    const set = (m: Messages) => {
      if (!cancelled) setMessages(m);
    };
    if (!isMachineTranslated(locale)) {
      const source = locale === PSEUDO_LOCALE ? PSEUDO_LOCALE : locale;
      loadMessages(source, namespaces, brand.productName).then(set);
    } else {
      // Machine-translated locale: show English at once, then swap in the translation.
      loadRawMessages(DEFAULT_LOCALE, namespaces).then((english) => {
        set(fillBrandName(english, brand.productName));
        // Catalogue overrides for this locale (human-edited) win over the machine translation.
        Promise.all([translateCatalog(english, locale), fetchOverrides(locale)]).then(([translated, overrides]) =>
          set(fillBrandName(applyOverrides(translated, overrides), brand.productName)),
        );
      });
    }
    return () => {
      cancelled = true;
    };
    // namespaceKey stands in for namespaces (a new array on every path change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, namespaceKey, brand.productName]);

  useEffect(() => {
    document.documentElement.lang = locale === PSEUDO_LOCALE ? "en" : locale;
  }, [locale]);

  const setLocale = useCallback((next: string) => {
    writeLocaleCookie(next);
    setLocaleState(next);
  }, []);

  const control = useMemo<LocaleControl>(
    () => ({
      locale,
      // Any world language is selectable (not limited to the brand's region); languages
      // without static message files are machine-translated. Pseudo stays dev-only.
      available: PSEUDO_ALLOWED ? [...WORLD_LANGUAGE_CODES, PSEUDO_LOCALE] : [...WORLD_LANGUAGE_CODES],
      setLocale,
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={control}>
      <NextIntlClientProvider
        // Formatting locale for the pseudo-locale is English.
        locale={locale === PSEUDO_LOCALE ? DEFAULT_LOCALE : locale}
        messages={messages}
        timeZone={defaultTimeZone}
        onError={onError}
        getMessageFallback={getMessageFallback}
      >
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
