import { langHref, languageName, sitePath, type SiteLanguage } from "@/lib/siteLanguage";

/** Visitor language dropdown (build spec 3.11) in a slim bar above every theme's header. Plain links, so the page
 *  reloads in the chosen language and works without JavaScript. Not shown on a one-language site. */
export function LanguageSwitch({ lang }: { lang: SiteLanguage | null }) {
  if (!lang || lang.languages.length < 2) return null;
  const path = sitePath();
  return (
    <div className="border-b border-black/10 bg-brand-muted text-brand-ink">
      <div className="mx-auto flex max-w-7xl justify-end px-4 py-1 sm:px-6">
        <details className="relative">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden py-1 text-sm font-semibold"
            aria-label={`Language: ${languageName(lang.language)}. Choose another language`}>
            {languageName(lang.language)}
          </summary>
          <ul className="absolute right-0 z-50 mt-1 min-w-[10rem] border border-black/10 bg-brand-bg py-1">
            {lang.languages.map((code) => (
              <li key={code}>
                <a href={langHref(code, path)} hrefLang={code} lang={code}
                  aria-current={code === lang.language ? "true" : undefined}
                  className={`block px-3 py-1.5 text-sm hover:bg-brand-muted ${code === lang.language ? "font-semibold" : ""}`}>
                  {languageName(code)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
