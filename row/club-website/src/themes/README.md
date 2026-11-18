# Theme 8 family — the scroll-animated themes (React)

Six new themes for the club website, ported from the approved design samples in
`E:\club-website\Theme8-Samples\` into this React app. **Every club's live API data** drives them —
the samples were built from one club (Thane Hills); these must work for all ~1300 clubs.

| theme key | sample (design + motion reference) | class/token prefix | local preview port |
|---|---|---|---|
| `cinematic` | `Theme8-Samples/A-cinematic/index.html` | `cin-` | http://localhost:8100/ |
| `split-story` | `Theme8-Samples/C-split-story/index.html` | `spl-` | http://localhost:8101/ |
| `liquid-motion` | `Theme8-Samples/E-liquid-webgl/index.html` | `liq-` | http://localhost:8102/ |
| `horizontal-journey` | `Theme8-Samples/F-horizontal-journey/index.html` | `hj-` | http://localhost:8103/ |
| `photo-collage` | `Theme8-Samples/G-collage-parallax/index.html` | `col-` | http://localhost:8104/ |
| `sunrise` | `Theme8-Samples/H-sunrise-modes/index.html` | `sun-` | http://localhost:8105/ |

All six are **UNRELEASED** (`UNRELEASED_THEMES` in `src/theme/ThemeResolver.js`): no club can get one
from the dashboard. They show only through the local port map, `?theme=<key>` on localhost, or the
live preview key. Local test clubs: the default is Thane Hills (club 1, `.env.local`
DevHostOverride); add `?host=rctcv.rotaryindia.org` to the first URL for Thane City View (10 banners,
ads incl. PDFs, **3 upcoming events**), `?host=rcmaduraicentral.rotaryindia.org` for long unbreakable
`&nbsp;` text. The dev servers for 8100–8105 are already running (`node dev-themes.mjs 8100 … 8105`);
they hot-reload — never start another server.

## 1. How a theme plugs in (already wired — do not edit the wiring)

```
src/themes/registry.js      finds each theme's files BY NAME (import.meta.glob) - nobody edits a list
src/themes/_shared/data.js  THE import surface for data + shared pieces (hooks, menus, year select, share, lightbox…)
src/themes/_shared/motion.js GSAP/ScrollTrigger/SplitText/Lenis, SPA-safe: useSmoothScroll, useScene, afterFonts,
                            refreshSoon, useRefreshOnImages, scrollToY, lockScroll, getLenis
src/themes/_shared/kit.jsx  PersonPhoto (photo -> initials fallback), SafeImg, paragraphs(), image fallbacks
src/themes/<key>/Site.jsx   the shell (header, menus, footer)          - default export, children = the page
src/themes/<key>/Home.jsx   the home page                              - default export
src/themes/<key>/pages/<Page>.jsx  its own inner pages                 - default export each
```
Page file names (exact): `About Projects ProjectDetail Directory Directors PastPresidents Newsletters
Gallery Events EventDetail Calendar Dignitary` (`SisterClubs`, `YouthPartners` are optional — without
them the shared page renders inside the theme's shell). A missing file = the shared page is used, so a
half-built theme never breaks the site. Routes and their query contract are fixed by `App.jsx`/
`routes.js` and MUST match the matching Gold page (`src/pages/gold/<Name>Gold.jsx`) exactly:

| file | route | query contract |
|---|---|---|
| About | `/about` | — |
| Projects | `/projects` | `?pr=CE` = the club-service feed (`useProjectsData(true)`); `?pr=CP|VS|NGS|IS|PII` pre-selects that avenue tab |
| ProjectDetail | `/project` | `?pid=<id>` (0/unknown -> designed not-found); `?pr=CE` -> "back" goes to `/projects?pr=CE` |
| Directory | `/directory` | — |
| Directors | `/directors` | — |
| PastPresidents | `/past-presidents` | — |
| Newsletters | `/newsletters` | — |
| Gallery | `/gallery` | `?page=<n>` (GALLERY_PAGE_SIZE per page) |
| Events | `/events` | — |
| EventDetail | `/event` | `?id=<id>` |
| Calendar | `/calendar` | — |
| Dignitary | `/dignitary` | `?Type=1` RI President, `?Type=2` District Governor (default 1) |

Internal links are plain `<a href="/about">` (App intercepts them and routes in-app, carrying `?yearId=`
when a year was picked) — use `withYear(href, club.selectedYearId)` for year-scoped links exactly as
Gold does. External links open in a new tab with `rel="noopener noreferrer"`.

## 2. File ownership (parallel agents — no two write the same file)

- **Theme lead** owns: `Site.jsx`, `Home.jsx`, `theme.css` (tokens, shell, the theme's shared
  components, restyle of fallback shared pages), `home.css`, `kit.jsx` (the theme's own reusable
  components: page hero + breadcrumb, section heading, buttons, cards, empty/not-found states…),
  `motion.js` (the theme's signature motions as helpers built on `_shared/motion.js`), `DESIGN.md`.
- **Page agents** own only `pages/<Page>.jsx` and `pages/<Page>.css` for their page(s).
- **Nobody** edits `src/themes/_shared/*`, `registry.js`, `App.jsx`, `routes.js`, `ThemeResolver.js`,
  `ThemeProvider.jsx`, `themeAssets.js`, `src/pages/**`, `src/shared/**`, `src/layouts/**`, another
  theme's folder, `public/**`, `.env*`, `package.json`. Need something shared? Report it as a
  `sharedRequest`; the lead/reviewer adds it inside the theme folder.
- No git commits, no `npm install`, no new dependencies (gsap 3.15 incl. SplitText/Flip/Observer,
  lenis, ogl and react-router are installed).

## 3. CSS rules

- CSS is imported by the module that uses it (`import './theme.css'` in Site.jsx, `import './About.css'`
  in pages/About.jsx). It arrives with the theme's lazy chunk — so it must never leak onto other themes:
  - **every class name starts with the theme prefix** (`cin-`, `spl-`, `liq-`, `hj-`, `col-`, `sun-`);
  - tokens are custom properties declared on `html[data-theme="<key>"]` and named with the prefix
    (`--cin-gold`);
  - **any element/global selector** (`html`, `body`, `:root`, `a`, `img`, `h1`, `::selection`,
    `*`…) must be scoped under `html[data-theme="<key>"]`.
- The base sheet `/Themes/classic-blue/css/rotary-design.css` (Tailwind preflight + classic utilities)
  is loaded under every Theme 8 theme so fallback shared pages keep working. Preflight resets apply
  (headings unstyled, `img{display:block;max-width:100%}`, buttons unstyled…) — style your own.
- Classes/attributes owned by `rotary-anim.js` must NOT appear in theme markup: `.reveal*`,
  `[data-count]`, `[data-split]`, `[data-nav*]`, `.route-enter`, `data-spotlight`, `data-tilt`,
  `data-magnetic`, `[data-slider]`. Theme motion is GSAP only.
- Page CSS classes are additionally namespaced by page (`.cin-about-*`, `.sun-dir-*`).

## 4. Data

- Import data and shared pieces ONLY from `src/themes/_shared/data.js` (hooks: `useHomeData`,
  `useAboutData`, `useProjectsData`, `useProjectData`, `useDirectoryData`, `useDirectorsData`,
  `usePastPresidentsData`, `useNewslettersData`, `useGalleryData`, `useEventsData`, `useEventData`,
  `useCalendarData`, `useDignitaryData`; plus `useClub`, `useMenus`, `YearSelect`, `VisitorCount`,
  `useProjectShare`, `PhotoLightbox`, `formatMoney`, `media`, `withYear`, `usePageTitle`…). Read
  `src/pages/gold/goldData.js` and `src/shared/homeData.js` for exact return shapes, and the matching
  Gold page for how each hook is used. **Never re-implement a data rule.**
- Generic for every club: loading states (hooks return `null`/`loading:true` first), empty arrays,
  one item vs hundreds, missing photos (`PersonPhoto`), long names, admin HTML (`about.html` is
  already `wrappableHtml` - render with `dangerouslySetInnerHTML` like Gold), non-INR currencies
  (`formatMoney(value, currency)`), clubs without banners/ads/events/newsletters (hide or design the
  empty state — never a broken box), the year selector changing the data (`club.selectedYearId`).
- A sample section whose content has no generic data source is either fed by a rule that works for
  any club and hides itself when the rule finds nothing, or dropped. Never hard-code Thane Hills.
- Personal contact data: show only what the shared page for that data shows, the same way.
- `usePageTitle(...)` on every page (Gold shows how).

## 5. Motion (from `_shared/motion.js`)

- Shell: `useSmoothScroll()` once. `useThemeShell('<key>', menus.length > 0)` and
  `useLoader(!club.loading)` from `_shared/data.js` too (they load the base script fallback pages need
  and lift the boot loader).
- Pages/sections: `const ref = useRef(); useScene(ref, (c) => { …gsap… }, [dataLoaded, …])` —
  runs only when motion is allowed (`c.wide`, `c.fine` for breakpoints/pointer), scoped to `ref`,
  reverted on unmount/deps change. `afterFonts(ctx, fn)` for SplitText. `refreshSoon()` /
  `useRefreshOnImages(ref, deps)` after late content/images.
- **No hidden start states in CSS.** With reduced motion nothing runs and everything is visible.
- `<main>` must not carry a transform (no `.route-enter`): ScrollTrigger pins use `position:fixed`,
  which a transformed ancestor re-anchors. Page transitions must `clearProps` what they animate.
- Pinned/horizontal sections only on wide + motion; phones get a vertical layout. Only pin what fits
  the viewport. Keyboard focus inside a pinned/horizontal track must scroll it into view (the samples
  show how).
- GSAP writes `translate/rotate/scale: none` inline — CSS hovers on tweened elements use a child or
  the individual properties; entrance tweens `clearProps`.
- Tweening `filter` from `none` starts at `brightness(0)` — always `fromTo` with explicit values.
- `opacity:0` still takes pointer events — invisible stacked slides/cards also get
  `visibility:hidden`/`pointer-events:none`.
- WebGL (liquid-motion): `import { Renderer, … } from 'ogl'`, desktop + motion only, plain `<img>`
  fallback, dispose the renderer on unmount, pause when off-screen, CORS-safe textures (API images may
  refuse cross-origin reads — fall back to the plain image, never a black canvas).

## 6. Quality floor (every page, both 1440×900 and 390×700)

One `<h1>`; landmarks; skip link; visible focus; tap targets ≥ 24px (aim 44); WCAG AA contrast;
filters/tabs as buttons with `aria-pressed`/tab semantics; dialogs with Esc + focus return; live
counts `aria-live="polite"`; no horizontal page overflow (`min-width:0`, `overflow-wrap:anywhere`
where API text meets a grid track, `clamp()` sizes for big display words — "Wednesday",
"Karkhanis", "Newsletters" must fit at 390px); lazy images with width/height; `<title>` via
`usePageTitle`. Copy: plain, sentence case, no invented facts/numbers/quotes.

## 7. Checking your work (build agents: NO browser)

One browser runs at a time on this machine; a verification stage checks every page in Chrome.
Build agents check without a browser:
1. **Vite compiles it:** `curl -s -o NUL -w "%{http_code}" http://localhost:<port>/src/themes/<key>/pages/<Page>.jsx`
   must print `200` (a syntax error or an unresolved import prints `500`; `curl -s` the same URL to
   read the error). Do the same for every file you wrote (`.jsx` and `.css`).
2. **It bundles:** `node_modules/.bin/esbuild <your file> --bundle --platform=browser --format=esm
   --jsx=automatic --loader:.js=jsx --loader:.png=file --loader:.svg=file --outdir=<your scratch dir>
   --log-level=warning --define:import.meta.env={}` must print no errors.
3. **Data shapes:** read the hook's source; check field names you use exist.
4. Re-read your JSX for hook-order bugs (no hooks after early returns), keys on lists, ids unique.
