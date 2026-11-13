# Rotary AI Assistant — web chat UI

Static Next.js 14 (App Router, `output: "export"`) chat front-end for the Rotary AI Assistant,
served by IIS at **https://assistant.<your-domain>**. No Node server runs in production.

Pages: `/login/` (same `POST /api/auth/login` as the admin portal) and `/` (chat).
The JWT is kept in `sessionStorage` (`assistant_token`); any 401 clears it and returns to `/login/`.

## Develop

```bash
cp .env.example .env.local        # set NEXT_PUBLIC_API_URL, e.g. http://localhost:5000 for a local API
npm install
npm run dev                       # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` is the API base **without** a trailing slash (production:
`https://<your-api-host>/api`). It is baked into the bundle at build time.
The IIS security headers in `public/web.config` are not applied by `next dev`.

## Build

```bash
NEXT_PUBLIC_API_URL=https://<your-api-host>/api npm run build    # → out/
```

`npm run build` = `next build` + `scripts/csp-hashes.mjs`. Next's static export puts small inline
bootstrap scripts in every page; the script hashes them (sha256) into the CSP in `out/web.config`
so `script-src` needs no `'unsafe-inline'`. **Always deploy the `out/` from `npm run build`** —
a bare `next build` leaves a placeholder in the CSP and the pages will not start.

## Deploy (IIS)

1. Create/point the IIS site for `assistant.<your-domain>` (HTTPS binding) at an empty folder.
   The **URL Rewrite** module must be installed (it already is for the admin portal).
2. Copy the **contents** of `out/` into that folder (replace everything — old `_next/` chunks can go).
3. `web.config` (included in `out/`) handles `/login` → `/login/`, the 404 page, caching, and the
   security headers (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy).

The API's production CORS policy already allows `your domain`, so no API change is needed
for the new origin. If the API's host ever moves off `your domain`, update `connect-src` in
`public/web.config`.
