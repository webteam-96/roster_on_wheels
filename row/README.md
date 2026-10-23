# ROW (Next.js + ASP.NET Core)

ROW (Roster On Wheels) on an ASP.NET Core 10 API and .NET worker programs — the RIZones backend rebranded to
ROW — with a Next.js admin portal and public club website, and a Flutter mobile app (`mobile/`). **Stack
finalized 2026-10-15: Next.js frontend + .NET backend.** (An earlier NestJS port of the API existed and was
deleted when the stack was decided; the .NET edition, formerly `row-dotnet/`, was promoted to this `row/` folder.)

| Folder | What | Source |
|---|---|---|
| `api/` | ASP.NET Core API (`RotaryApi.csproj`, net10.0) | RIZones `RotaryApi/` at `cb3e678c` (2026-10-09), rebranded |
| `admin/` | Next.js admin portal | the converted RIZones admin (`rotary-frontend`) |
| `club-website/` | Next.js public club website (one app, every club subdomain) | the converted RIZones club website |
| `workers/` | AwardsAutoCalcWorker, GreetingsWorker, RotaryOrgSyncWorker | RIZones workers at `cb3e678c`, rebranded |
| `mobile/` | Flutter app (`flutter analyze` / `test` need the SDK, not installed here) | the converted RIZones Flutter app |
| `database/` | ROW schema (design only), drift columns, optional lookup lists | — |
| `tools/` | rebrand tooling (below) | — |

The `admin/` and `club-website/` keep this folder's `web.config` files for IIS hosting.

## What makes it ROW

**Identity (rebrand, 2026-10-12).**
- No secrets, data or people: every key, password, staff contact and India DLT id in `appsettings*.json`
  is blank (`tools/scrub_settings.py`); RIZones' data dumps, uploads, policy PDFs, people's photos and
  public-site data are gone; a Google OAuth token cache file is ignored (`.gitignore`).
- Names, logos and texts say ROW / Roster On Wheels; CORS allows only the brand's domains; email senders,
  CCs, report recipients and the start-up SuperAdmin come from configuration.
- Removed: RIZones partner feeds (`ShrigodaPartner`, `RotaryThirdParty`, `ClubProfileReport`), a dead
  method that reset 13 real members' passwords, a RIZones-specific Cashfree fix-up. Demo members are
  seeded only with `Database:SeedDemoData=true`.

**ROW behaviour already in.**
- **Brand** (`api/Services/Brand.cs`, linked into the workers): `GET api/public/brand` and `GET api/health`.
- **Feature flags** (master plan Appendix C) with ROW's values; citation recalculation obeys
  `modules.citation`; the admin hides off modules and the public site (`site.public`).
- **Member data** (`api/Privacy/MemberDataGuard.cs`): with `member.bloodGroup` / `member.familyDetails`
  off (ROW default) every JSON response carries blood group as null and family / spouse fields empty —
  typed DTOs, anonymous objects, Dapper rows and row dictionaries alike; the club and district
  blood-group call lists, the club family list, the AG family report are empty and the full-details
  report has one row per member.
- **Privacy** (`api/Privacy/`): consent, export (signed 7-day ZIP link), erasure with two-admin approval,
  tombstone, registry audit, retention, `PUT api/members/me/language`; broadcast email and push skip
  members without consent. The Rotary.org sweep worker skips erased members (`TombstoneCheck`).
  `../kb/tools/privacy_e2e.py`: 26 of 26 checks pass.
- **Schema gaps** fixed: current Rotary year's project tables at start-up, `sync_exception_log.inserted`.
- **Currency**: the brand's currencies (`Brand:Locale:Currencies`, default `Brand:Locale:DefaultCurrency`) instead
  of INR / NPR / LKR / USD; exchange rates against the brand's default (rate 1 when the feed is down); public
  project statistics and club impact totals in one bucket per brand currency; district performance money as
  `<currency> 1,234` in the brand's number locale; DTO defaults use the brand's currency and time zone.
- **Scope**: COG club `Brand:Scope:CogClubId` (0 = none), exempt districts `Brand:Scope:ExemptDistricts`,
  report zones `Brand:Scope:Zones` (empty = all), excluded club-name patterns
  `DistrictPerformanceReport:ExcludedClubNames` — in the API and the workers. Rotaract clubs are left out of
  district reports and counts (`ClubScopeSql`, as upstream).
- **One-time codes and messaging**: ROW sends no SMS or other phone messages (decided 2026-10-19). One-time codes
  and notifications go by email and in-app push (`Services/OtpChannelPolicy.cs`). Codes are not written to the log;
  `MobileOtp:ReturnDebugOtp` is off.
- **Time**: on a UTC server, timestamps go out with "Z" (`time.emitOffset`, `Services/UtcDateTimeConverter.cs`);
  midnight values stay date-only. Each district has an IANA time zone (`district_master.Timezone`, empty = the
  brand's; `Services/ZoneTime.cs`): greetings, the district performance report, engagement milestones, invite
  prompts, volunteer and meeting reminders and the target dashboard use the district's local day and hour. Platform
  schedules (daily statistics, club cache refresh), training slots and Zoom meetings use the brand's time zone
  (`Brand.TimeZone`); new clubs get it too.
- **Money**: amounts in emails, approvals and the Word / PDF reports through `Brand.Money` (brand currency and
  number locale); projects and districts without a currency use the brand's (`Brand.SqlCurrency`).
- **Members**: a country id of 0 is stored as no country (the original RIZones code defaulted to India).

**Still the original behaviour** (`node tools/check-rizones.mjs --india` lists the lines):
- Payments on **Cashfree / Razorpay** (decision 4), with their ₹ / GST texts and India settings.
- The terms page names rupees until counsel's policy texts arrive (Q6).

Inherited RIZones issues, unchanged: Swagger fails to generate (`GoalSettingController.ConvertFoundationClubFile`
uses `[FromForm]` with `IFormFile`); some queries mix collations when the MySQL connection collation is
not `utf8mb4_unicode_ci` (set the server's `collation-server` to it).

## Database

RIZones' start-up initializer cannot build a database from empty, so ROW starts from `database/`:

| File | What |
|---|---|
| `schema.sql` | all tables, stored procedures and triggers (189 / 249 / 14) |
| `schema-drift.sql` | columns and indexes the code uses that RIZones only had in production (safe to re-run) |
| `seed-master.sql` | optional ROW lookup lists: countries, Rotary years, roles, modules, goal fields, document types |

```bash
mysql -u root -p -e "CREATE DATABASE row CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root -p row < database/schema.sql
mysql -u root -p row < database/schema-drift.sql
mysql -u root -p row < database/seed-master.sql     # lookup lists
```

Start the API once with `Database:SkipInit=false`: the initializer applies its migrations (none needed)
and creates the current Rotary year's project tables. The first SuperAdmin is the member whose email is
`Brand:SuperAdminEmail`.

## Run locally

```bash
cd api
ConnectionStrings__DefaultConnection="Server=127.0.0.1;Port=3306;Database=row;User=root;Password=<pw>" \
JwtSettings__Secret=<at-least-32-characters> dotnet run
cd admin && npm ci && NEXT_PUBLIC_API_URL=http://localhost:5000 npm run dev
cd club-website && npm ci && npm run dev
```

## Configuration (set per server as environment variables; never commit values)

Config keys (`Brand__Domains__AdminOrigin`, ...):

| Key | Example / meaning |
|---|---|
| `Brand:Domains:AdminOrigin`, `:ApiBase` | `https://portal.example.org`, `https://portal.example.org/API` |
| `Brand:Domains:ClubSiteParent`, `:ClubSiteSuffixes`, `:AllowedOriginSuffixes` | club-site parent domain, aliases, extra CORS domains |
| `Brand:Support:Email`, `:Phones:0`, `:Hours`, `:LegalName`, `:Address`, `:PrivacyEmail`, `:NoReplyEmail`, `:InternalCc:0` | contacts |
| `Brand:Look:LogoUrl`, `:LogoDarkUrl`, `:FaviconUrl` | logos (email header defaults to the portal's ROW lockup) |
| `Brand:Locale:DefaultCurrency`, `:Currencies:0`, `:Languages:0`, `:NumberLocale`, `:DefaultTimeZone` | `USD`, `USD`, `en`, `en-US`, `UTC` |
| `Brand:Scope:CogClubId`, `:ExemptDistricts:0`, `:Zones:0` | COG roster club, districts outside reports, report zones |
| `DistrictPerformanceReport:ExcludedClubNames:0` | club-name patterns left out of the performance report |
| `Brand:Legal:PolicyVersion` | e.g. `2026-11`; consent is asked once this is set |
| `Brand:Features:<flag>` | override a flag, e.g. `Brand__Features__member.bloodGroup=true` |
| `Brand:Privacy:TombstoneSalt` | erasure tombstone salt (API **and** sync worker) |
| `Brand:CommunicationEmail`, `:ReportRecipients:0`, `:SuperAdminEmail` | extras |
| `Privacy:ExportRoot`, `Privacy:LinkKey` | export folder (outside the web root), link-signing key (else the JWT secret) |
| `Database:SeedDemoData` | `false` |

Plus RIZones' keys, blank in the files: `ConnectionStrings`, `JwtSettings:Secret`, `Brevo:*`,
`PleskSettings:*`, `RotaryOrgApi:*`, `Zoom:*`, `Gemini:*`, `Google:*`, payment providers. The workers read
environment variables too.

Web: `admin/` (`NEXT_PUBLIC_API_URL`, brand from the API) and `club-website/`
(`NEXT_PUBLIC_ADMIN_LOGIN_URL` / `NEXT_PUBLIC_PORTAL_ORIGIN`, `NEXT_PUBLIC_SUPPORT_*`,
`NEXT_PUBLIC_NUMBER_LOCALE`, `NEXT_PUBLIC_DEFAULT_CURRENCY`, `NEXT_PUBLIC_CLUB_SITE_PARENT_DOMAIN`).

## Checks

```bash
node tools/check-rizones.mjs            # RIZones identity: must be 0
node tools/check-rizones.mjs --india    # India-specific behaviour still to convert (report only)
(cd api && dotnet build); for w in workers/*/; do (cd $w && dotnet build); done
(cd admin && npx tsc --noEmit); (cd club-website && npx tsc --noEmit)
python -I ../kb/tools/privacy_e2e.py <api> <mysql cmd JSON> <member token>
```

2026-10-12, after the sync to `cb3e678c`: identity lint 0; API and workers build; admin and club website
0 type errors; on an empty database the 379 parameterless GET routes give 238 × 2xx, 140 × 4xx, 1 × 5xx
(Rotary.org ping without credentials) — the same status on every route as the RIZones API; privacy 26 / 26;
member-data guard checked with the flags off and on.

## Refreshing from a newer RIZones copy

Do not copy folders over this one: that would undo the ROW changes. Three-way merge instead — for each file the
new upstream commits changed, `git merge-file <this file> <upstream old> <upstream new>` (normalise line endings
first), resolve the few conflicts in ROW's favour, then `python tools/rebrand.py .` (it leaves this README alone),
`python tools/scrub_settings.py .` if settings changed, `node tools/check-rizones.mjs`, build, and the GET sweep.
Upstream data-fix SQL scripts are RIZones data and are not applied; schema changes go into `database/` (both
editions). Record the new upstream commit in the table above.

Hand edits the scripts do not repeat: `Brand.cs` and its `Init` calls, `Program.cs` (CORS, JSON guard, privacy
and messaging registration), `Privacy/`, `PublicBrandController.cs`, `RowMessaging.cs`, `OtpChannelPolicy.cs`,
`UtcDateTimeConverter.cs`, currency and scope code, `Brand.Money` / `Brand.TimeZone` / `Brand.SqlCurrency` and
their callers, `MetaWhatsAppService` / `TwilioOtpSmsService` / `RowPhone.ResolveE164Async` (Interakt, the DLT SMS
gateway and the Interakt webhook removed), `OtpWhatsAppHelper`, `MemberService.CountryOrNull`, the greetings
worker's `MetaWhatsAppSender`, `DatabaseInitializer` (SuperAdmin bootstrap, demo-seed flag,
year tables, removed reset method and vendor fix-up), removed partner controllers, the report-list flags in the
club / district / AG / reports controllers, `CitationRecalcTrigger`, the consent filter in `PushDispatcher` and
`EmailScheduledSendBackgroundService`, `TombstoneCheck` in the sweep worker and the workers' environment variables.
