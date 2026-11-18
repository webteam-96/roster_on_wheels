# ROW club website

The public website of each club: one React (Vite) single-page app serves every club host. The page asks the ROW API
which club owns the host (`/api/public/club-website/by-host`) and then loads that club's public data in the browser.
Replaced the earlier Next.js club site on 2026-11-17 (the old version is in git history).

```bash
npm ci
npm run dev          # http://localhost:3000; set .env.local (see .env.example), ?host=<subdomain> picks a club locally
npm run build        # -> dist/ (static files + web.config for IIS)
npm run dev:themes   # every theme on its own port, for side-by-side review
```

## Configuration

`.env.production` (build) and `.env.local` (local, git-ignored). Every `VITE_` value is compiled into the public
bundle, so nothing secret goes there. Keys are documented in `src/config.js`:

| Key | Meaning |
|---|---|
| `VITE_ApiBaseUrl` / `VITE_MediaBaseUrl` | ROW API (`.../api`) and the host that serves `/uploads`, `/Documents` |
| `VITE_AdminLoginUrl` | the "Admin login" button on every theme |
| `VITE_RenewUrl` | renewal page on the Expired page when the API returns no per-club pay link |
| `VITE_SupportEmail` / `VITE_SupportPhone` | support contact on the Expired / Not-configured pages; blank = hidden |
| `VITE_VisitorCountUrl` | footer counter: the API's `/api/public/club-website/visits` (blank = per-browser count) |
| `VITE_ClubThemeMap` / `VITE_ForcedTheme` | production theme pins; blank = each club's own pick |
| `VITE_Dev*`, `VITE_DefaultWebsiteId`, `VITE_ThemePreviewKey` | local / preview only, blank in production |

## Themes

The club admin picks the theme in the admin panel (Website > Change Theme, `theme_master`). The API sends the theme
name slugged (`Classic Blue` -> `classic-blue`), which `src/theme/ThemeResolver.js` maps to a theme key.

| In the admin | Key | Notes |
|---|---|---|
| Classic Blue, Warm Modern, Civic Bold, Verdigris Ledger, Gold | same, slugged | shells in `src/layouts`, homes in `src/pages` |
| Cinematic, Split Story, Liquid Motion, Horizontal Journey, Photo Collage, Sunrise | same, slugged | `src/themes/<key>` |
| Handloom | `handloom` | released 2026-11-18; needs its `theme_master` row (`database/maintenance/2026-11-18-club-theme-handloom.sql`) |
| (not offered) | `madras-legacy` | built for one RIZones club; `MADRAS_CLUBS` is empty, reachable only by preview / pin |

Locally, `?theme=<key>` previews any theme on any page.

## ROW rules built in

- No contact details: `src/lib/http.js` drops every phone / email field from every API response.
- Untrusted text: the same file sanitises every string that contains markup (DOMPurify) and blanks `javascript:` /
  `vbscript:` / non-image `data:` values, because the themes render admin-typed text as HTML.
- No RIZones content: the club-specific pages of the source (Madras, Guindy, Selaiyur, sister clubs, youth partners)
  were removed, and every RIZones URL, email and phone number was replaced by the settings above.

## Deploy

See `row/deploy/iis/README.md`, section 4: copy the contents of `dist/` into the club-websites IIS site.

Known gap: link previews (WhatsApp, Facebook) show no club title or image, because crawlers run no JavaScript.
