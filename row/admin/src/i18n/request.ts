import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getServerBrand } from "@/lib/brand";
import { LOCALE_COOKIE, PSEUDO_LOCALE, DEFAULT_LOCALE, parseAcceptLanguage, resolveLocale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";

/**
 * Locale and messages for server components that call getTranslations()
 * (the public (site) pages and the policy pages). Client components get theirs
 * from IntlProvider. Server pages load `common` and `site`.
 */
export default getRequestConfig(async () => {
  const brand = await getServerBrand();
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const resolved = resolveLocale(
    cookieLocale,
    null,
    parseAcceptLanguage(headers().get("accept-language")),
    brand.locale.defaultLanguage,
    brand.locale.languages,
    process.env.NODE_ENV !== "production",
  );
  return {
    locale: resolved === PSEUDO_LOCALE ? DEFAULT_LOCALE : resolved,
    messages: await loadMessages(resolved, ["common", "errors", "site"], brand.productName),
    timeZone: brand.locale.defaultTimeZone,
  };
});
