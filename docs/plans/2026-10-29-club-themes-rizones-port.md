# Club website themes: port of the RIZones club site (2026-10-29)

Source (copy-source only, never run against its servers): `E:\websites\Club-Website-reactjs\Club-Website-reactjs`
(Vite + React 18 + react-router 6, client-rendered). Target: `row/club-website` (Next.js 14 app router).

## Decisions (user, 2026-10-29; also in docs/claude/FACTS.md)
- Port 11 themes: classic-blue, warm-modern, civic-bold, verdigris-ledger, gold (released family) and cinematic,
  split-story, liquid-motion, horizontal-journey, photo-collage, sunrise (Theme 8 family).
- Dropped: madras-legacy, handloom, and every club-specific page (Guindy Trust, Boys Town, Rotary Nagar, Manav Seva,
  Selaiyur, DGN page, Innerwheel/Rotaract, Technical Training Centre, ProofDesign, under-maintenance).
- ROW branding only. No RIZones names, logos, domains or photos; copy designs, not data.
- All previous themes deleted (club: 8 old + heritage; district: ledger, quiet). Archive outside the repo:
  `E:\websites\row-theme-archive-2026-10-29\`. District site restored to `district-website.bak-2026-10-29`.
- Method: full rewrite to Next.js routes with server rendering. No react-router, no client-side SPA mount.
- All 11 straight through; no per-theme review gate.

## Data
ROW's API already serves every endpoint the source calls (`api/public/club/{id}/v2/{years,about,banners,
advertisements,bod,gallery,impact,projects}`, `projects/{pid}`, `meetings`, `menus`, `calendar`, `upcoming-events`,
`newsletters`, `past-events`, `international-president`, `district-governor`, `directory`, `past-presidents`,
`club-website/by-host`). Missing: `public/projects/{id}/share` (source falls back to local share links).
Server components fetch through `lib/publicApi.ts` (add v2 fetchers there); interactive parts are client components
that get data as props.

## Target structure
```
src/themes/registry.ts          key -> { Layout, Home, pages: Partial<Record<PageKey, Component>> }
src/themes/shared/              ported src/pages/*.jsx (shared inner pages) + src/shared/* helpers
src/themes/<key>/Layout.tsx     ported layouts/Site*.jsx or themes/<key>/Site.jsx
src/themes/<key>/Home.tsx       ported Home*.jsx / themes/<key>/Home.jsx
src/themes/<key>/pages/*.tsx    own inner pages (gold, Theme 8 family)
public/Themes/<key>/            released-theme CSS + images (minus madras-legacy, handloom)
```
PageKey: About Projects ProjectDetail Directory Directors PastPresidents Newsletters Gallery Events EventDetail
Calendar Dignitary SisterClubs YouthPartners. A theme without its own page uses the shared page inside its Layout.

Routes (Next app dir): `/ /about /projects /project /projects/[pid] /calendar /directors /directory
/past-presidents /newsletters /gallery /events /event /dignitary /sister-clubs /youth-partners`, plus ROW's own
`/join /profile/[slug] /m/[slug] /meetings`, language prefix and trial lock-out (lib/tenant.ts, middleware).
`?preview-theme=<key>` keeps working for the owner's review.

## Order
1. Foundation: registry, routes, data fetchers, shared helpers (menus/toRoute, year select, breadcrumb, money,
   lightbox, share row), shared inner pages. Delete old theme folders.
2. classic-blue (base), warm-modern, civic-bold, verdigris-ledger, gold (+ gold pages).
3. Theme 8: cinematic, split-story, liquid-motion, horizontal-journey, photo-collage, sunrise.
4. Rebrand pass (grep for RIZones/Rotary India/club names/domains), tsc, tests, Chrome check of every theme x page
   on desktop and 390px.

Progress is tracked in `docs/claude/STATUS.md`.

## Progress (2026-10-29)
Steps 1-3 done: all 11 themes, shared pages, gold pages, Theme 8 pages, ROW Meetings page. Step 4 partly: rebrand
grep done (admin login, currency default, India-only pages dropped); verification and open items in
docs/claude/STATUS.md. How the port works:
- Routes: app/<route>/page.tsx -> site/SitePage.tsx (tenant, gate, loader, theme shell, theme or shared view).
- Data: themes/shared/loaders.ts calls site/clubApi.js on the server; views get `data` and compute in render.
  Hooks that fetched in the browser (homeData.useHomeData, gold/pages/goldData.js) now take that data.
- Router: site/router.js shims react-router (useLocation, useSearchParams, useNavigate, Navigate).
- Motion: site/ThemeScripts.jsx loads public/Themes/<key>/js once React has hydrated <main>.
- Choosing a theme for a club still needs the database's theme list updated to the 11 keys (not done).
