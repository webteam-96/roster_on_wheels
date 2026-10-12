# ROW — .NET edition (Next.js + ASP.NET Core)

A copy of the RIZones platform on its original stack (ASP.NET Core 10 API, Next.js admin portal,
Next.js club website, .NET worker programs), rebranded to ROW (Roster On Wheels). It exists so ROW
can ship on .NET if the client keeps that stack. The NestJS edition in `../row` is separate and
untouched; both serve the same routes and JSON, so the ROW mobile app (`../row/mobile`) works with
either API.

Made 2026-10-12 from the local RIZones reference at `64a7cd86` (2026-10-07).

| Folder | What | Source in the reference |
|---|---|---|
| `api/` | ASP.NET Core API (`RotaryApi.csproj`, net10.0) | `RotaryApi/` |
| `admin/` | Next.js admin portal | `rotary-frontend/` |
| `club-website/` | Next.js public club website (one app, every club subdomain) | `club-website/` |
| `workers/` | AwardsAutoCalcWorker, GreetingsWorker, RotaryOrgSyncWorker | same names |
| `tools/` | rebrand tooling (below) | — |

## What the rebrand changed

- **No secrets, data or people.** Every key, password, connection string, staff contact and India DLT
  id in `appsettings*.json` is blank (`tools/scrub_settings.py`). `.env*` files, uploaded documents,
  the club data dump, RIZones' SQL data scripts, policy PDFs, people's photos / biodata / video,
  event photos and the RIZones public-site data (leaders, governors, committee, events, club-website
  list, project statistics) are removed or emptied.
- **Brand from configuration.** `api/Services/Brand.cs` (also linked into the workers) reads the
  `Brand` section: product name, portal / club-site domains, support contacts, no-reply / mass-email
  senders, internal CC, report recipients, bootstrap SuperAdmin, WhatsApp template prefix, logo.
  The web apps read the same values from `NEXT_PUBLIC_*` variables (`admin/src/lib/brand.ts`).
- **Names.** "RIZones", "Rotary Zones 4, 5, 6, 7 & 8", "Rotary India" are "ROW" / "Roster On Wheels"
  in messages, emails, file names and comments. The RIZones logo lockups are replaced by ROW lockups
  (same file names / sizes in `admin/public/images`; drawn by `tools/make_logos.py`).
- **Code that pointed at RIZones.** CORS allows only `Brand` domains (+ localhost); club-site parent
  domain, portal / API origins, email senders, CCs and report recipients come from `Brand`; the
  start-up SuperAdmin is `Brand:SuperAdminEmail` (was a named person); the JSON field `rizonesCount`
  is `localCount` (as in the NestJS edition); WhatsApp template names are `row_*`; the app-store
  links come from configuration.
- **Removed.** RIZones partner feeds (`ShrigodaPartner`, `RotaryThirdParty`, `ClubProfileReport`) and
  their CORS policy / settings; a dead start-up method that reset 13 real members' passwords; a
  RIZones-specific Cashfree vendor fix-up.
- **Changed defaults.** Demo members are seeded on an empty database only with
  `Database:SeedDemoData=true`. The public marketing pages (home, about, committee, leaders, events,
  contact, download) redirect to `/login` until ROW has its own content
  (`NEXT_PUBLIC_PUBLIC_SITE=true` serves them). The external RIZones marketplace link is cleared.
- **IIS.** `admin/web.config` and `club-website/web.config` use HttpPlatformHandler (were iisnode);
  `api/web.config` is the ASP.NET Core Module (in-process), unchanged.

## Not changed yet (RIZones behaviour, India-specific)

The rebrand removes identity, not behaviour. `node tools/check-rizones.mjs --india` lists what is
still India-specific (1,334 lines on 2026-10-12: currency / locale 693, Cashfree / Razorpay / Interakt
531, India time 57, +91 phone 53). In short:

- Payments run on **Cashfree / Razorpay** (India only). ROW needs Stripe / PayPal (see
  `../row/PENDING-WORK.md` §2).
- WhatsApp goes through **Interakt**; ROW uses the Meta Cloud API.
- Money is shown in **₹ / en-IN**, times assume **India time** (server clock / `DateTime.Now`), phone
  input assumes **+91**.
- Zone scope (Zones 4–8, exempt districts) is hard-coded in some reports.

`../row/api/ROW-CHANGES.md` describes how the NestJS edition changed each of these; the same changes
apply here.

Inherited RIZones issues, unchanged: Swagger (`/swagger/v1/swagger.json`) fails to generate because
`GoalSettingController.ConvertFoundationClubFile` uses `[FromForm]` with `IFormFile`; the admin type
check has the same 6 errors as RIZones (builds ignore type errors).

## Database

RIZones' start-up initializer cannot build a database from empty: it migrates an existing one and
assumes tables created outside the code. ROW therefore starts from its own schema files in `database/`
(design only, no RIZones data; copied from the NestJS edition, which shares the schema):

| File | What |
|---|---|
| `schema.sql` | all tables, stored procedures and triggers (189 / 249 / 14) |
| `schema-drift.sql` | columns the code uses that RIZones only ever had in production |
| `seed-master.sql` | optional ROW lookup lists: countries, Rotary years, roles, modules, goal fields, document types |

```bash
mysql -u root -p -e "CREATE DATABASE row CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root -p row < database/schema.sql
mysql -u root -p row < database/schema-drift.sql
mysql -u root -p row < database/seed-master.sql     # lookup lists
```

Then start the API once with `Database:SkipInit=false`: the initializer applies its migrations on top
(none needed on 2026-10-12) and creates the current Rotary year's project tables
(`rotary_projects_YYYY_YY`, `rotary_project_photos_YYYY_YY`; later years are created on the first save
or at start-up once that year is current). The first SuperAdmin is the member whose email is
`Brand:SuperAdminEmail`.

Tested 2026-10-12 on MySQL 8.0.46 with an empty database built from these files: initializer clean,
sign-in works, 379 parameterless GET routes give 233 × 2xx, 145 × 4xx (missing required parameters /
not found) and one 500 (`admin/rotary-org-sync/ping`, needs Rotary.org credentials).

## Run locally

```bash
# API (needs MySQL 8 with the database above)
cd api
ConnectionStrings__DefaultConnection="Server=127.0.0.1;Port=3306;Database=row;User=root;Password=<pw>" \
JwtSettings__Secret=<at-least-32-characters> \
dotnet run

# Admin portal
cd admin && npm ci && NEXT_PUBLIC_API_URL=http://localhost:5000 npm run dev
# Club website
cd club-website && npm ci && npm run dev
```

## Configuration (set per server; never commit values)

API and workers — the `Brand` section (environment: `Brand__PortalDomain`, ...):

| Key | Example |
|---|---|
| `Brand:PortalDomain` | `portal.example.org` |
| `Brand:ClubSiteParentDomain` | `clubs.example.org` |
| `Brand:ClubSiteSuffixes`, `Brand:AllowedOriginDomains` | extra domains (list) |
| `Brand:SupportEmail`, `Brand:SupportPhone` | footer / help lines |
| `Brand:NoReplyEmail`, `Brand:CommunicationEmail` | email senders (verified at Brevo) |
| `Brand:InternalCc`, `Brand:ReportRecipients` | internal mail |
| `Brand:SuperAdminEmail` | member made SuperAdmin at start-up |
| `Brand:WhatsAppTemplatePrefix` | `row` |
| `Brand:LogoUrl` | email header logo (default: the portal's ROW lockup) |
| `Database:SeedDemoData` | `false` |

Plus the existing RIZones keys, now blank: `ConnectionStrings`, `JwtSettings:Secret`, `Brevo:*`,
`PleskSettings:*`, `RotaryOrgApi:*`, `Zoom:*`, `Gemini:*`, `Google:*`, payment providers.

Web (build time): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PORTAL_ORIGIN`, `NEXT_PUBLIC_API_ORIGIN`,
`NEXT_PUBLIC_CLUB_SITE_PARENT_DOMAIN`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_PHONE`,
`NEXT_PUBLIC_SUPPORT_HOURS`, `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_IOS_APP_URL`,
`NEXT_PUBLIC_ANDROID_APP_URL`, `NEXT_PUBLIC_PUBLIC_SITE`, `NEXT_PUBLIC_DEFAULT_SETTLEMENT_VENDOR_ID`,
`NEXT_PUBLIC_PLUG_VENDOR_ID`.

## Checks

```bash
node tools/check-rizones.mjs            # RIZones identity: must be 0
node tools/check-rizones.mjs --india    # India-specific behaviour still to convert (report only)
(cd api && dotnet build); for w in workers/*/; do (cd $w && dotnet build); done
(cd admin && npx tsc --noEmit && npx next build); (cd club-website && npx next build)
```

Results on 2026-10-12: identity lint 0; API and the three workers build; admin and club website
production builds pass (195 and 11 pages); API boots without a database, maps its routes, and in
Production allows CORS only from `Brand` domains (RIZones origins refused).

## Refreshing from a newer RIZones copy

The rebrand is scripted, so a newer upstream can be brought over the same way:
copy the folders (excluding `bin`, `obj`, `node_modules`, `.next`, `.env*`, uploads), then run
`python tools/scrub_settings.py .`, `python tools/rebrand.py .`, the `tools/empty_exports.py` calls
for the public-site data files, and `node tools/check-rizones.mjs`. Hand edits made in this round that
the scripts do not repeat: `Brand.cs` and its `Init` calls, the CORS rules in `Program.cs`, the
`DatabaseInitializer` changes (SuperAdmin bootstrap, demo-seed flag, removed reset method and vendor
fix-up), removed partner controllers, `FooterBottomBar.tsx`, pay-page help lines, `next.config.mjs`
redirects, the two `web.config` files, and the empty-events guard in `EventsBanner.tsx`.
