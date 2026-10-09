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
} from "@/i18n/config";
import { fillBrandName, loadMessages, type Messages } from "@/i18n/messages";
import englishCommon from "../../messages/en/common.json";
import englishErrors from "../../messages/en/errors.json";

const PSEUDO_ALLOWED = process.env.NODE_ENV !== "production";

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
 * is always one of the instance's languages (RIZones: English only).
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
  const pathname = usePathname() ?? "/";
  const { languages, defaultLanguage, defaultTimeZone } = brand.locale;

  const [locale, setLocaleState] = useState<string>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages>(() => fillBrandName(ENGLISH_BASE, brand.productName));

  // Resolve once the brand (and its language list) is known, and again if it changes.
  useEffect(() => {
    setLocaleState(
      resolveLocale(readCookie(LOCALE_COOKIE), null, navigator.languages ?? [], defaultLanguage, languages, PSEUDO_ALLOWED),
    );
  }, [defaultLanguage, languages]);

  const namespaces = useMemo(() => namespacesFor(pathname), [pathname]);
  const namespaceKey = namespaces.join(",");

  useEffect(() => {
    let cancelled = false;
    const source = locale === PSEUDO_LOCALE ? PSEUDO_LOCALE : locale;
    loadMessages(source, namespaces, brand.productName).then((m) => {
      if (!cancelled) setMessages(m);
    });
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
      available: PSEUDO_ALLOWED && languages.length > 0 ? [...languages, PSEUDO_LOCALE] : languages,
      setLocale,
    }),
    [locale, languages, setLocale],
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
