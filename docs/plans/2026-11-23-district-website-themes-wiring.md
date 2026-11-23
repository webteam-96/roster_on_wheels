# District website: wire the 7 designed themes to ROW (plan, 2026-11-23)

Source: `C:\Users\USER\Desktop\ROW District website` (from the user and the designer). Seven React 18 + Vite themes
(Ether, Prism, Orbit, Tide, Transit, Cascade, Kinetic) built against the RIZones API. `default/` and `default-app/`
are the RIZones production district site (`district-website-react`) and its build: not part of this work.

## Status (2026-11-23)

Items 1-7 done and checked locally (see ROW-CHANGES 2026-11-23). Left: production SQL, IIS hosting, self-hosted fonts.

## Task card

- **Goal:** the seven themes run as ROW's district website on ROW data, with each district choosing its theme.
- **Done when:** `npm run build` passes for all seven themes; every page of every theme renders district 5656 from
  `row_prod_copy` through the local API, with no request to a RIZones or rotaryindia host and no sample data shown;
  phone (375) and desktop (1440) screenshots of each theme's home page; `dotnet test row/api.Tests` green.
- **Out of scope:** theme design changes, selling themes per plan (needs Stripe), the section editor, `default-app`.
- **Risk:** medium. New public API reads only; one additive column for the theme choice.

## Ground truth (checked 2026-11-23)

- The themes' data layer (`source/src/shared/live.ts`, 805 lines) calls RIZones admin and mobile routes through a
  local proxy that adds an API token (`scripts/live.mjs`). It reads member rosters, presidents' phones, birthdays and
  anniversaries. ROW's rule (ROW-CHANGES 2026-10-21): the district site reads only anonymous `api/public/district/...`
  routes with public fields. So the proxy and those calls are replaced, not ported.
- `data/` is a saved copy of RIZones District 3141 data and `shared/content.js` is District 3141 sample text
  (Mumbai, rotaryindia links). ROW has no RIZones content: neither ships. Missing data shows the empty state.
- ROW public routes that already cover the themes: `by-host`, `site` (number, logo, current year, contacts, social),
  `banners`, `advertisements`, `about`, `dignitaries`, `events?year&month`, `newsletters?variant`, `committee`,
  `clubs`, `clubs/{id}/board`, `projects?avenue&page`, `clubs/{c}/projects/{p}`, `snapshot`, `menus`.
  Year list: `api/public/project-stats/years`.
- Old `row/district-website` (Next.js, gitignored) is no longer on disk. The new site takes that folder and stays
  gitignored like the old one until the user says otherwise.

## Work items

| # | Item | Verify by |
|---|---|---|
| 1 | Copy `source/` + `shared/` into `row/district-website` (no `data/`, no `node_modules`, no token proxy); dev server proxies `/api` and `/uploads` `/Documents` to the local API | `npm run dev` serves all 7 themes |
| 2 | New `live.ts` on ROW public routes: district from host (`by-host`) or `?district=`, years, every page's sections. Sections that ROW keeps private (birthdays, anniversaries, member rosters, phones) are removed | each page shows 5656 data; network tab has only same-origin requests |
| 3 | Neutral sample: `content.js` keeps page copy only, with no District 3141 / India / RIZones text; data slots start empty | grep finds none; empty district shows empty states |
| 4 | API gaps: `clubId` filter on district projects (club page), one district event detail route | api.Tests + curl |
| 5 | Money and dates from the brand (ROW is outside India): no ₹ lakh / crore | home snapshot shows the brand currency |
| 6 | Theme choice: `district_websites.theme_key` (reversible migration), returned by `by-host`; admin picker under My District Website; root page sends the visitor to the chosen theme | change theme in admin, site follows |
| 7 | Build all 7, screenshots 375 / 1440, rebuild kb | build logs + screenshots |

## Decisions (defaults, say if wrong)

- All seven themes are wired; none dropped.
- Club pages show the club, its meetings, board and projects. No member list (public site, ROW rule).
- Calendar shows district and club events only.
