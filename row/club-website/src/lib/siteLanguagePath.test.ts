// Run: node --test src/lib/siteLanguagePath.test.ts  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { langHref, languageAlternates, splitLanguagePrefix, translateMenus, type SiteLanguage } from "./siteLanguagePath.ts";

test("a language prefix is split off the path", () => {
  assert.deepEqual(splitLanguagePrefix("/fr/about"), { lang: "fr", path: "/about" });
  assert.deepEqual(splitLanguagePrefix("/pt-BR"), { lang: "pt-BR", path: "/" });
  assert.deepEqual(splitLanguagePrefix("/zh-Hant/m/our-team"), { lang: "zh-Hant", path: "/m/our-team" });
});

test("routes are not languages", () => {
  for (const p of ["/", "/about", "/m/x", "/api/purge-cache", "/club-finder/12", "/projects"]) {
    assert.deepEqual(splitLanguagePrefix(p), { lang: null, path: p });
  }
});

test("links and hreflang", () => {
  assert.equal(langHref("fr", "/"), "/fr");
  assert.equal(langHref("fr", "/about"), "/fr/about");
  const lang: SiteLanguage = { defaultLanguage: "en", languages: ["en", "fr"], language: "fr", items: [] };
  assert.deepEqual(languageAlternates(lang, "/about"), { en: "/en/about", fr: "/fr/about", "x-default": "/about" });
  assert.equal(languageAlternates({ ...lang, languages: ["en"] }, "/about"), undefined);
});

test("menus take the translation and keep the source name for routing", () => {
  const menus = [{
    id: 7, menuName: "About", linkType: "page", linkValue: "", contentHtml: null, isDefault: true, sortOrder: 1,
    subMenus: [{ id: 9, subMenuName: "Our team", linkType: "page", linkValue: "", sortOrder: 1 }],
  }];
  const lang: SiteLanguage = {
    defaultLanguage: "en", languages: ["en", "fr"], language: "fr",
    items: [{ type: "page", id: 7, title: "A propos", body: null, seoTitle: null, seoDescription: null },
            { type: "submenu", id: 9, title: "Notre equipe", body: null, seoTitle: null, seoDescription: null }],
  };
  const [m] = translateMenus(menus, lang)!;
  assert.equal(m.menuName, "A propos");
  assert.equal(m.sourceName, "About");
  assert.equal(m.subMenus[0].subMenuName, "Notre equipe");
  assert.equal(m.subMenus[0].sourceName, "Our team");
  assert.equal(translateMenus(menus, null), menus);
});
