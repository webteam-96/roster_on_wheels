# Club Website

Public, read-only multi-tenant Next.js app that serves every Rotary club website from a single deploy. Plesk points all club subdomains (and any third-party domains) at this one folder; the app reads the incoming Host header, resolves it to a club via the API, and renders the right theme + data.

## Phases

1. **Phase 1 (current)** — Scaffold + tenant resolution.
2. Phase 2 — Public read-only API endpoints (in RotaryApi).
3. Phase 3 — Theme 1 (Classic Blue) with all 8 menu pages.
4. Phase 4 — Themes 2-5 (Modern Minimal / Bold Color / Editorial / Compact Card).
5. Phase 5 — Status overlays + popups.
6. Phase 6 — Admin: menu config (lives in rotary-frontend).
7. Phase 7 — Admin: theme picker (lives in rotary-frontend).
8. Phase 8 — Expiry reminder background service (in RotaryApi).
9. Phase 9 — Performance + ISR + DB indexes.
10. Phase 10 — QA pass.

## Local dev

```bash
cd club-website
npm install
npm run dev          # serves on http://localhost:3001
```

To simulate a club subdomain locally, add hosts entries like:
```
127.0.0.1   rcthanehills.localhost
127.0.0.1   rcmumbai.localhost
```
then visit `http://rcthanehills.localhost:3001`.

## Deploy

Standalone Next.js build, copied into `publish-deploy/`, deployed via iisnode behind the existing IIS/Plesk setup. Same pattern as `rotary-frontend/publish-deploy/`.

## Architecture key bits

- **`src/middleware.ts`** — runs at the Edge, forwards the Host header as `x-tenant-host`. Cannot call the API itself (Edge runtime limitations).
- **`src/lib/tenant.ts`** — Node-side tenant resolver. Calls `GET /api/public/club-website/by-host/{host}`. In-memory LRU cache, 5-min TTL.
- **`src/lib/api.ts`** — Node-side fetch helper for the public read-only endpoints. Uses Next.js `revalidate` for ISR.
- **`src/themes/[1-5]/`** — Theme components (Phase 3+). All themes consume the same data shape.

## Themes contract

Each theme exports:
- `Layout` — full-page layout component (header / nav / footer).
- `Home`, `About`, `Directors`, `Directory`, `Calendar`, `Projects`, `Meetings`, `PastPresidents` — one component per default menu.

The active theme is decided by `tenant.themeKey` (e.g. `"classic-blue"`, `"modern-minimal"`, etc.) and applied via `data-theme` attribute on `<html>`. CSS variables in `globals.css` flip per theme.
