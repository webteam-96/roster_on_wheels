# N6 Websites: multilingual content, Rotaract template, RI themes (2026-10-23, lane e)

Spec: build spec v4.1 section 3.11 and build list #8. Cookie consent is already done.
Done when (web layers): a district site renders in two languages.

## What exists

- Club site content: About (`club_website_about.content`) and menus (`club_website_menu`, custom pages carry
  `content_html`; sub-menus in `club_website_submenu`). District rows live in the same tables
  (`fk_club_id = 0`, `fk_district_id = D`). No "stories" table exists: the About page is the club's or district's
  story (the admin calls it "Your club story"), so pages = custom menu pages, stories = About.
- Public sites read `api/public/club/{id}/...` and `api/public/district/{id}/...`; every page is server-rendered,
  no locale anywhere (`<html lang="en">`).
- Machine translation: admin route `row/admin/src/app/api/i18n/translate` (provider set by env, MyMemory default).
- Language list: the admin's `WORLD_LANGUAGE_CODES` (what the platform supports through machine translation);
  `Brand:Locale:DefaultLanguage` is the default for a site that has not chosen one.
- Themes: club site code themes keyed by `theme_master.theme_name` slug; 4 legacy themes use non-Rotary colours
  (violet, teal, red, green) and Inter. Classic Blue (the fallback) and Banner use Royal Blue and Gold.

## Build

Tables (DatabaseInitializer + schema.sql):
- `website_languages` (scope club|district, owner_id, default_language, languages CSV).
- `website_translations` (scope, owner_id, item_type site|about|page|submenu, item_id, language, title, body,
  seo_title, seo_description), unique per item and language.

Endpoints (flag `website_languages`, Kind.Flagged):
- `GET/PUT api/{clubs|districts}/{id}/website-languages`: default + languages.
- `GET api/{clubs|districts}/{id}/website-languages/{lang}`: every translatable item with its source text and the
  translation in that language.
- `PUT/DELETE api/{clubs|districts}/{id}/website-languages/{lang}/{type}/{itemId}`: one translation.
- `GET api/public/website-languages/{club|district}/{id}?lang=xx`: the site's languages and the texts for the
  resolved language (requested if enabled, else the default). Rate limited per IP. 404 when the site is off.
  Scope and IDOR: ScopeWriteGuardMiddleware (path is under api/clubs|districts/{id}); items are checked to belong to
  the owner. Audit: AuditMiddleware logs every write.

Admin: one editor component, three pages behind the flag: `/clubs/[id]/website-data/languages`,
`/districts/[id]/website-data/languages`, `/district-admin-dashboard/my-district-website/languages`; cards on the
club and district website hubs. "Machine translate this page" fills the fields from the source through the
translate route (HTML text nodes only, tags kept); the admin edits and saves.

Public sites (club and district): middleware reads a `/fr/...` prefix (rewrites to the page, remembers the choice
in a `site-lang` cookie); the shell overlays translated menu names, page bodies and About; `<html lang>`, per-page
SEO title and description, hreflang alternates and a language dropdown (only with two or more languages).

Themes: `rotaract` club theme (Banner theme in Rotaract cranberry with Rotaract wording), default for Rotaract
clubs with no theme; legacy themes recoloured to Rotary's palette with Arial and Georgia. No RI logos.

e2e: `kb/tools/websites_multilingual_e2e.py`.

## For the app (later)

The app reads `GET api/public/website-languages/{scope}/{id}?lang=` for a localised site view and the admin
endpoints above for editing; no app changes now.

## Shortcuts

- Built-in interface labels of the public sites (footer headings, empty states) stay in the platform language;
  tenant content, menus, About and SEO are per language.
- Unprefixed URLs follow the language cookie, so a CDN in front of the sites must vary on Cookie.

## Done (2026-10-23)

Files (api, admin and kb are in git; club-website and district-website are plain folders):
- API added: `Controllers/WebsiteLanguagesController.cs` (editor + public controller), `Services/WebsiteLanguageService.cs`,
  `Services/IWebsiteLanguageService.cs`, `DTOs/WebsiteLanguageDtos.cs`.
- API changed: `Program.cs` (DI, `public-read` rate limit policy), `Services/FeatureGate.cs` (`website_languages`,
  Kind.Flagged), `Services/DatabaseInitializer.cs` (2 tables), `Controllers/ClubWebsitePublicDataController.cs` and
  `Controllers/DistrictWebsitePublicDataController.cs` (serviceable checks made `internal static` for reuse),
  `Controllers/ClubWebsitePublicController.cs` (Rotaract clubs without a theme get `rotaract`); `database/schema.sql`.
- Admin added: `components/WebsiteLanguagesEditor.tsx`, `lib/translateHtml.ts` + test, pages
  `clubs/[id]/website-data/languages`, `districts/[id]/website-data/languages`,
  `district-admin-dashboard/my-district-website/languages`.
- Admin changed: `services/api.ts`, `components/icons.ts` (Languages), hub cards on `my-club-website`,
  `my-district-website`, `districts/[id]/website-data` (the two router.push hubs filter with `useIsPathOff`), theme
  preview maps on `clubs/[id]/website-data/theme` and `theme/v2` (RI palettes, banner, rotaract).
- District site: added `lib/siteLanguage.ts`, `lib/siteLanguagePath.ts` + test, `components/LanguageSwitch.tsx`;
  changed `middleware.ts`, `app/layout.tsx`, `app/about/page.tsx`, `app/m/[slug]/page.tsx`, `lib/pageShell.ts`,
  `lib/publicApi.ts`, `lib/nav.ts`, `components/SiteLayout.tsx`.
- Club site: the same four files added; changed `middleware.ts` (identical to the district one), `app/layout.tsx`,
  `app/about/page.tsx`, `app/m/[slug]/page.tsx`, `app/globals.css`, `lib/pageShell.ts`, `lib/publicApi.ts`,
  `lib/nav.ts`, `themes/index.ts`, `themes/banner/Home.tsx` (Rotaract wording prop), `themes/banner/banner.css`
  (rules also apply to `rotaract`), the five legacy `tokens.css`; added `themes/rotaract/rotaract.css` and `Home.tsx`.
- e2e: `kb/tools/websites_multilingual_e2e.py`.

Tables: `website_languages`, `website_translations` (tenant content; `updated_by` is an author id like `modified_by`
on `club_website_about`, so nothing for PersonalDataRegistry). Down: `DROP TABLE website_translations, website_languages`.

Endpoints:
- `GET|PUT api/{clubs|districts}/{id}/website-languages`
- `GET api/{clubs|districts}/{id}/website-languages/{lang}`
- `PUT|DELETE api/{clubs|districts}/{id}/website-languages/{lang}/{site|about|page|submenu}/{itemId}`
- `GET api/public/website-languages/{club|district}/{id}?lang=` (anonymous, `public-read` rate limit)

Themes: legacy themes use Rotary's palette only (Royal Blue, Gold, Azure, Sky Blue, Cardinal, Orange; Rotaract
Cranberry) and Arial / Georgia, the stand-ins Rotary's brand guide names for Frutiger / Sentinel; no pure white
grounds, gradients with non-Rotary stops made solid. No logos bundled. A SuperAdmin still creates the theme rows
(`theme_master` is empty on this copy): a row named "Rotaract" selects the template; `?preview-theme=rotaract` shows it.

Verification (real output):
- `dotnet build`: Build succeeded, 0 errors; no warnings in the new files (the one warning in a touched file,
  ClubWebsitePublicDataController.cs line 1119, was there before).
- `python -I kb/tools/websites_multilingual_e2e.py http://127.0.0.1:5105 3317 row_lane_e`: 40 PASS, ALL PASS
  (run twice), test rows removed, platform_features left as found.
- admin `tsc --noEmit -p tsconfig.json`: 0 errors. `vitest run src/lib/translateHtml.test.ts
  src/components/FeatureGate.test.ts src/components/icons.test.ts`: 11 passed. `check-design.mjs`: all 0.
- club-website and district-website `tsc --noEmit`: 0 errors. `node --test src/lib/siteLanguagePath.test.ts`:
  4 passed in each site.

Shortcuts (each has a `shortcut:` comment): public site template labels stay in the platform language; unprefixed
URLs follow the cookie (CDN must vary on Cookie); `public-read` limit is per IP, so a site server shares one bucket;
machine translation sends text runs between tags, so a sentence split by inline tags may read less well; club themes
keep their own About heading (the About title field shows for districts only).

Open issues:
- The sites were not rendered in a browser (next dev/build not allowed in lanes); the render path is covered by tsc,
  the node tests and the API e2e only.
- `/api/i18n/translate` in the admin has no auth of its own (pre-existing): anyone can use it as a translation proxy
  and spend the provider quota.
- The mobile app has no translate route; it needs an API-side translate endpoint to offer "machine translate".
- On a prefixed URL (`/fr/about`) client components that compare `usePathname()` to nav hrefs see the prefix, so the
  active-menu highlight may not show there.
