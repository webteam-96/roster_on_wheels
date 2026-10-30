# ROW test go-live on IIS (test.rosteronwheels.com)

Decided 2026-10-30 (docs/claude/FACTS.md): ONE host, `https://test.rosteronwheels.com`, serves the admin web app;
the API is reached through the same host under `/api` (plus its media folders), proxied by IIS to a local-only API
site. Club websites need their own host names (one IIS site serves every club host). Database: `row_production`.

Ready-to-copy folders (made on the developer machine, not in git): `E:\websites\row\_local\deploy\`
- `web\admin\` = the frontend for test.rosteronwheels.com (Next.js standalone; its `web.config` is this folder's
  `admin-site.web.config`); `web\club-websites\` = the club sites (Next.js standalone + its `web.config`).
  Each is its own IIS site.
- `api\` = the API (dotnet publish, Release); `api\sql\` holds the MySQL Workbench scripts (`sql\README.txt`).
  ASP.NET Core serves no file from it.
The browser-side code in `web\admin\` and `web\club-websites\` is built for `https://test.rosteronwheels.com`; a different
host means rebuilding them.

> **CURRENT LAYOUT (2026-10-30, Plesk):** site root `D:\Inetpub\vhosts\rosteronwheels.com\test.rosteronwheels.com\`
> holds the admin frontend files (contents of `web\admin`, with its `web.config`); the API is the `api` folder in that
> root, marked as an application in Plesk (Websites & Domains > Virtual Directories > api > Mark as application, .NET:
> No Managed Code). `/api/...` goes straight to it; `/uploads`, `/Documents`, `/tempdocument` are rewritten to it by the
> root web.config. No ARR, no API subdomain. The API's environment variables go in `api\web.config` on the server.
> Sections below that mention 127.0.0.1:5080 or an api.test subdomain describe the earlier plan.

## 1. Server prerequisites (once)

- IIS with: ASP.NET Core Hosting Bundle for .NET 10, Node.js 22 (`C:\Program Files\nodejs\node.exe`),
  HttpPlatformHandler v1.2, URL Rewrite 2.1, Application Request Routing 3, WebSocket Protocol (chat hub).
- ARR: IIS Manager > server > Application Request Routing Cache > Server Proxy Settings > tick **Enable proxy**.
  Leave "preserve host header" OFF (the proxy targets the API's own Plesk subdomain by name).
- The server is managed by **Plesk** (2026-10-30): each site is a Plesk domain or subdomain whose files go
  directly into its `httpdocs` (delete Plesk's default page files there). SSL: Plesk > SSL/TLS Certificates >
  Let's Encrypt, per domain.
- DNS: `test.rosteronwheels.com` and `api.test.rosteronwheels.com` -> the server (and the club hosts, see 4).

## 2. API: Plesk subdomain `api.test.rosteronwheels.com`

- Upload the contents of `row-deploy\api` into the subdomain's `httpdocs`. Plesk > ASP.NET settings / app pool:
  **No Managed Code**; the app pool identity needs write access to `logs\` and `wwwroot\`.
- The admin site proxies `/api`, `/uploads`, `/Documents`, `/tempdocument` to this subdomain, so visitors only
  see test.rosteronwheels.com; the API's own self-links (calendar feeds, email media) use api.test.
- Environment: the `<environmentVariables>` block of the `aspNetCore` element in its web.config ON THE SERVER ONLY
  (never in git), or IIS Manager > site > Configuration Editor > system.webServer/aspNetCore:

| Name | Value |
|---|---|
| `ConnectionStrings__DefaultConnection` | `Server=<db host>;Port=3306;Database=row_production;User Id=<user>;Password=<password>;` |
| `JwtSettings__Secret` | a long random string (64+ chars); changing it signs everyone out |
| `VisitCounter__Secret` | another long random string (visitor counter; keep it stable) |
| `Database__SkipInit` | `true` (the schema was already brought up to date on 2026-10-30; set `false` for one start after a code update that adds tables) |
| `PathBase` | *(empty)* — the API is not under `/API` in this layout |
| `Brand__Domains__AdminOrigin` / `Brand__Domains__ApiBase` | `https://test.rosteronwheels.com` |
| `FrontendUrl`, `BackendUrl`, `PublicFrontend__BaseUrl`, `Api__BaseUrl` | `https://test.rosteronwheels.com` |
| `BackgroundJobs__Enabled` | `false` for the test (see 5) |
| `Meetings__ReminderJob`, `DailyStatsReport__Enabled` | `false` for the test |
| `ClubSite__PurgeSecret` | same random value as the club site's `PURGE_CACHE_SECRET` |

Email (Brevo), push (Firebase) and payment keys: leave empty for the test unless you want real messages sent.

## 3. Site "row-web" (test.rosteronwheels.com)

- Upload the contents of `row-deploy\web\admin` into the domain's `httpdocs` (its `web.config` proxies `/api`,
  `/uploads`, `/Documents`, `/tempdocument` to `https://api.test.rosteronwheels.com` and runs `node server.js` for
  everything else). App pool: **No Managed Code**. SSL via Plesk; turn on "redirect HTTP to HTTPS".
- Nothing secret is needed here.

## 4. Site "row-club-websites"

- Folder: copy `row-deploy\web\club-websites`. App pool: **No Managed Code**.
- Club addresses: `<clubname>.test.rosteronwheels.com`. Binding: `https`, host `*.test.rosteronwheels.com`
  (IIS 10 wildcard binding), port 443, a wildcard certificate for `*.test.rosteronwheels.com`; DNS: a wildcard
  record `*.test.rosteronwheels.com` -> the server. A club appears when its `club_websites` row has
  `Subdomain` = `<clubname>` (or the full host).
- On the API site also set `Brand__Domains__ClubSiteParent` = `test.rosteronwheels.com`.
- Environment: `PURGE_CACHE_SECRET` = the API's `ClubSite__PurgeSecret`.
- Its browser code calls the API at `https://test.rosteronwheels.com/api/...` (public club endpoints are CORS-open).

## 5. Before opening it to anyone

- This test runs on the PRODUCTION database with real member data. With background jobs on, real members would get
  reminder, leadership and report emails from a test site. Keep `BackgroundJobs__Enabled=false` and no email key
  until you decide otherwise.
- The public repo's history contains a demo SuperAdmin with the password `Admin@123`: check that no production
  account uses it (change it if one does).
- Backup taken before the schema update: `E:\websites\row\_local\backups\row_production-2026-10-30-before-golive.sql`
  on the developer machine. Restore = `mysql row_production < that file` (it recreates the tables it contains).

## 6. Smoke test after copying

1. `https://test.rosteronwheels.com/api/public/brand` returns JSON (API reached through the proxy).
2. `https://test.rosteronwheels.com/login` shows the admin login; sign in with a real account.
3. Upload a small image anywhere (e.g. a banner) and open it: `/uploads/...` must load.
4. `logs\` in each site folder holds the stdout logs if a site does not start.
