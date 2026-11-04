// Multilingual websites (build spec 3.11): the pure parts, without Next.js imports, so the middleware can use them
// and node can test them.  Test: node --test src/lib/siteLanguagePath.test.ts

import type { Menu } from "./publicApi";

export interface SiteText {
  type: "site" | "about" | "page" | "submenu";
  id: number;
  title: string | null;
  body: string | null; // sanitized HTML (PublicHtml.Clean)
  seoTitle: string | null;
  seoDescription: string | null;
}

/** GET /api/public/website-languages/club/{id}: the site's languages and the texts in the language it shows. */
export interface SiteLanguage {
  defaultLanguage: string;
  languages: string[];
  language: string;
  items: SiteText[];
}

const PREFIX = /^\/([a-z]{2,3}(?:-[a-z0-9]{2,8})?)(\/.*)?$/i;
export const LANG_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

/** "/fr/about" gives { lang: "fr", path: "/about" }; a path without a language prefix comes back unchanged. */
export function splitLanguagePrefix(pathname: string): { lang: string | null; path: string } {
  const m = PREFIX.exec(pathname);
  // "api" is the only route of the site shaped like a language tag
  if (!m || m[1].toLowerCase() === "api") return { lang: null, path: pathname };
  return { lang: m[1], path: m[2] || "/" };
}

/** A page in a language: /fr/about, and the home page is /fr. */
export function langHref(code: string, path: string): string {
  return `/${code}${path === "/" ? "" : path}`;
}

/** hreflang targets for one page: one per language plus x-default (the unprefixed URL); none for a one-language site. */
export function languageAlternates(lang: SiteLanguage | null, path: string): Record<string, string> | undefined {
  if (!lang || lang.languages.length < 2) return undefined;
  return Object.fromEntries([...lang.languages.map((c) => [c, langHref(c, path)]), ["x-default", path]]);
}

export function siteText(lang: SiteLanguage | null, type: SiteText["type"], id = 0): SiteText | undefined {
  return lang?.items.find((t) => t.type === type && t.id === id);
}

/** Menus in the visitor's language. sourceName keeps the original name, which routes and page slugs are built from. */
export function translateMenus(menus: Menu[] | null, lang: SiteLanguage | null): Menu[] | null {
  if (!menus || !lang?.items.length) return menus;
  return menus.map((m) => {
    const t = siteText(lang, "page", m.id);
    return {
      ...m,
      sourceName: m.menuName,
      menuName: t?.title || m.menuName,
      contentHtml: t?.body || m.contentHtml,
      subMenus: m.subMenus.map((s) => ({ ...s, sourceName: s.subMenuName, subMenuName: siteText(lang, "submenu", s.id)?.title || s.subMenuName })),
    };
  });
}
