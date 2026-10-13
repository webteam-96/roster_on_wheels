"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { useBrand } from "@/contexts/BrandContext";
import { createFormat, numberLocaleFor, todayIn, type Formatters } from "@/lib/format";

/**
 * Formatters for the current interface language, with the instance's currency
 * and time zone. (When the district context of WS3-02 exists, its currency and
 * zone take precedence over the brand defaults here.)
 */
export function useFormat(): Formatters {
  const locale = useLocale();
  const brand = useBrand();
  const { numberLocale, defaultCurrency, defaultTimeZone } = brand.locale;
  return useMemo(
    () => createFormat(numberLocaleFor(locale, numberLocale), defaultCurrency, defaultTimeZone),
    [locale, numberLocale, defaultCurrency, defaultTimeZone],
  );
}

/** Today's date ("YYYY-MM-DD") in the instance's zone, not the browser's UTC date. */
export function useToday(): string {
  const { defaultTimeZone } = useBrand().locale;
  return todayIn(defaultTimeZone);
}
