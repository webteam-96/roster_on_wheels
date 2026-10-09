# ROW Master Development Plan

**Roster On Wheels (ROW): the international edition of RIZones45678**

| | |
|---|---|
| Version | 1.0 |
| Date | 30 September 2026 |
| Status | Ready for development |
| Prepared for | The ROW engineering team (BW1, BW2, F1, F2) and the lead developer |
| Repository | `KaizenInfotech/RotaryIndia_Admin_API_Claude`, branch `main` |
| Supersedes | Nothing. It implements the *ROW Build Guide* (29 September 2026) with the changes argued in `docs/superpowers/specs/2026-09-30-row-build-position-design.md` and designed in `docs/superpowers/specs/2026-09-30-row-build-detailed-design.md` |

# Part A. Context

## 0. How to use this document

This is the single working document for building ROW. It is written so that an engineer who was not
in any of the planning conversations can open it, find their tasks, and start.

- **Part A** (sections 1 to 4) is the context every engineer must read once: what is being built, the rules, the environments and the conventions.
- **Part B** (sections 5 to 17) is the work, split into workstreams. Every task has an identifier, an owner, its dependencies, the files it touches, numbered steps, code or SQL where the shape matters, a verification step and the check that protects RIZones.
- **Part C** (sections 18 to 21) is the schedule, the gates, the risks and the open decisions.
- **Part D** (appendices A to L) is reference material: full configuration, all new SQL, catalogues and the generated inventories of every call site that must change.

**Task identifiers** look like `WS6-04`. **Track** says which gate needs the task: `A1` (English pilot, target 15 November 2026), `A2` (first translated pilot, target 7 December 2026) or `B` (launch, forecast late January 2027 at the earliest). **Estimates** are working days for an engineer who knows the code.

**If this document and the code disagree, the code is the truth.** File and line references were correct on 30 September 2026 at the head of `main`; lines move. Search for the quoted symbol if a line number is stale. If this document and the *ROW Build Guide* disagree, this document wins; section 3.3 lists every difference.

## 1. What is being built

### 1.1 The product

ROW is a second deployment of the RIZones45678 platform for Rotary zones in North America, Latin
America, Europe, Africa and South-East Asia. It has its own brand, domain, database, payment and
messaging providers, languages and settings. It is **not** a new product and **not** a fork: the same
repository and the same release produce both.

### 1.2 The platform today

| Component | Technology | Size | Location |
|---|---|---|---|
| API | ASP.NET Core on .NET 10, Dapper, MySqlConnector, no ORM | 145 controllers, about 250 services | `RotaryApi/` |
| Admin web app and public site | Next.js 14.2 App Router, TypeScript, Tailwind, shadcn/ui | 768 components, 494 routes | `rotary-frontend/` |
| Club and district public websites | Next.js 14.2, multi-tenant by host name | 44 components, 5 themes | `club-website/` |
| Workers | .NET console applications run by Windows Task Scheduler | 3 projects | `RotaryOrgSyncWorker/`, `GreetingsWorker/`, `AwardsAutoCalcWorker/` |
| Database | MySQL 8.0.46, about 180 application tables plus one projects table per Rotary year | 2.7 GB | one server |
| Mobile app | Flutter | separate repository | not in this repository |
| Rotary Assistant | Semantic views, typed tools, Claude or Gemini | `RotaryApi/Services/Assistant/` | inside the API |

Hosting: one dedicated Windows server in India running IIS, MySQL, the workers, LibreOffice and
Plesk. The server clock and MySQL are in India Standard Time.

### 1.3 Fixed constraints

1. **No new hosting spend.** ROW runs on the same server, isolated as section 5 describes.
2. **Eight languages at launch:** English, French, German, Italian, Japanese, Korean, Portuguese, Spanish.
3. **RIZones must not regress.** It serves about 174,000 active memberships in 6,469 clubs.
4. **ROW must not launch with visible quality defects:** untranslated screens, broken payments, wrong times.

### 1.4 Three gates

| Gate | Target | Meaning |
|---|---|---|
| **A1: English pilot** | 15 November 2026 | One or two named English-speaking districts use ROW in production: their own brand, time zone, currency and live card payments |
| **A2: first translated pilot** | 7 December 2026 | A pilot district works in its own language (one of the seven besides English) on the screens its Club Admins and members use |
| **B: launch** | Forecast late January 2027 at the earliest, decided by the gate | All eight languages complete on every reachable screen, first launch wave of zones, RIZones proven stable on the shared code |

The pilot is split in two because the task-level estimates show the translated pilot cannot be ready by 15 November (section 18.2). The checklists for the gates are in section 19.

### 1.5 Size of the work

| Workstream | Engineer-weeks |
|---|---|
| S. Server and environments | 2 |
| WS0 Safety net and release | 1.5 |
| WS1 Brand configuration | 2 |
| WS2 Translation | 16.5 |
| WS3 Locale | 3 |
| WS4 Time | 3.5 |
| WS5 Master data and seeds | 1.5 |
| WS6 Payments | 5.5 |
| WS6 Messaging | 3 |
| WS7 Privacy | 3.5 |
| WS8 Rotary.org sync | 3.5 |
| WS9 Visual brand | 0.5 |
| WS11 Regression, release, pilot support | 2 |
| **Total, web and API** | **48** |
| WS10 Mobile app | not measured (one day to measure it, WS10-00); see section 16 |

Split by gate: A1 needs 19.7 engineer-weeks, A2 a further 9.4, B a further 18.9. The four engineers
have about 22 engineer-weeks before 15 November, and the unmeasured mobile app work must come out of
the difference, so A1 requires the whole team on ROW for six weeks. Section 18 gives the arithmetic
and what moves each date.

### 1.6 What ROW offers at each gate

ROW starts with an empty database and the modules below. Everything else in the platform exists in the code but is switched off for ROW by flag or module switch until the gate named, so that no half-translated or India-specific screen reaches a ROW user.

| Area | A1 (15 Nov) | A2 (7 Dec) | B (launch) | Notes |
|---|---|---|---|---|
| Sign-in: web and app, emailed code | Yes | Yes | Yes | WhatsApp and SMS codes from A2 |
| Club admin dashboard, members, board, directory | English | Pilot language | Eight languages | |
| Announcements, events, newsletters, documents | English | Pilot language | Eight languages | |
| Projects (seven avenues), monthly report, attendance | English | Pilot language | Eight languages | |
| Membership dues and event payments by card | Stripe, district or club account | Same | Stripe and PayPal | |
| District dues (club pays district) | No | No | Yes | Needs the Razorpay refactor replaced by the gateway interface (WS6-05) |
| District admin dashboard and district modules | English, pilot District Admins only | Same | Eight languages | Extraction is B-track (WS2-10) |
| Birthday and anniversary greetings | Off | On, per district zone | On | WS4-05 |
| Emails: sign-in, dues, events | English, ROW brand | Pilot language | Eight languages | |
| PDF and Excel documents | English, ROW brand | Pilot language labels for the dues receipt | Eight languages, CJK fonts | |
| Club public websites | No | No | Yes | WS2-27, WS2-28; Plesk provisioning for the ROW parent domain |
| Public marketing pages `(site)` | Redirect to sign-in | Same | ROW content from the product owners, eight languages | Flag `site.public` |
| Rotary Assistant | Off | Off | Decision at B | Golden questions and eval are RIZones-specific; needs a ROW set and a language instruction before it is offered |
| Wallet credits, website purchase | Off | Off | Decision at B | Platform products priced in `Brand:Pricing` (X14) |
| District citation, zonal awards | Off | Off | Decision at B | Zones 4 to 8 programmes (Q9) |
| PPH camps | Off | Off | Decision at B | Health data of non-members (Appendix G) |
| Privacy: export, erasure, consent, retention | Policy pages only | Same | Yes | WS7 |
| Rotary.org sync for ROW's zones | Pilot districts | Same | First launch wave | WS8 |
| Mobile app | Test tracks, English | Pilot language | Store release, eight languages | WS10 |
| Never on ROW | | | | Cashfree KYC, Razorpay Route onboarding, DLT SMS, the Shrigoda partner API, the club profile report API, the rotaryindia.org SSO bridge, the Rotary.org "Add to org" and Foundation pull extension (Zones 4 to 8 scope) |

### 1.7 Not in this plan

- User help content, tutorials and training material in eight languages (the `admin/tutorial` page is SuperAdmin-only and stays English).
- Marketing content for the ROW public site; the engineering to render it is in WS2-12.
- Moving ROW to its own hosting; the design keeps that possible (`InstanceTimeZone`, separate database, brand file) but no task does it.
- A visual recolour (section 15).
- Changes to the Flutter app beyond what section 16 lists; its estimate is produced by WS10-00.
- Right-to-left languages: none of the eight is right-to-left, so no layout mirroring is planned.

## 2. Team and ownership

| Engineer | Focus | Owns |
|---|---|---|
| **BW1** | Backend and web | Server and environments (S), safety net (WS0), brand configuration (WS1), master data (WS5), privacy (WS7) |
| **BW2** | Backend and web | Payments and messaging (WS6), club subdomains, email templates (WS2 part) |
| **F1** | Flutter and backend | Locale (WS3), time (WS4), phone and OTP, Rotary.org sync (WS8), the app screens for each |
| **F2** | Flutter and web | Translation (WS2), visual brand (WS9), ROW app build and store listings (WS10) |
| **Lead developer** | Review and gates | Second reviewer on cross-cutting changes, Friday gate report, release approval |

The owner writes the code for their tasks and is first reviewer on any change that touches their
area. All four take part in string extraction for the directories they know (section 7), in
regression and in the pilot.

## 3. Rules for every change

### 3.1 The twelve ground rules (from the build guide)

1. **No brand checks in code.** Never write a condition on the brand or instance name. Every difference between RIZones and ROW is a configuration value, an injected provider or a feature flag.
2. **India is the default.** When a ROW setting is absent, the code behaves exactly as RIZones does today. RIZones deployed with no configuration change must pass its smoke suite.
3. **Nothing new is hard-coded.** No IST, `+91`, INR, GST rate, `rizones45678.org` or Windows path in new code. Remove existing ones in any file you touch.
4. **Every user-facing string is a translation key**, in web and app, for every file in the translation scope (section 7.1).
5. **Times:** see rule 5a below, which replaces the guide's "stored in UTC".
6. **No secrets in the repository.** Keys come from environment variables or the vault. A secret scan runs on every push and blocks the merge.
7. **No developer machine connects to a production database.**
8. **Master data changes go into seed files**, never straight into a database.
9. **Migrations are backward compatible**, so the previous build still runs on the new schema.
10. **Pull requests stay small:** one task or part of one, under 400 changed lines excluding generated message files. Assisted-coding output is reviewed like any other code: the reviewer reads the diff, runs it and shares ownership.
11. **No merge without a second engineer's approval and green smoke suites for both RIZones and ROW.**
12. **Every payment, message and sync call logs the instance, the district and a correlation id.**

### 3.2 Additional rules introduced by this plan

- **5a. Time storage.** While ROW shares the server, both instances store *instance time* (India Standard Time today). Correctness for other zones is achieved at three boundaries: output, input and scheduling (section 9). New code reads the clock through `TimeProvider`, never `DateTime.Now`.
- **13. Flags default to today's behaviour.** Every flag has a compiled-in default (Appendix C) equal to what RIZones does now. A flag missing from configuration takes that default.
- **14. Refactors ship alone.** A change that moves existing behaviour behind an interface contains no new behaviour, and lands with a characterisation test that proves the output is identical.
- **15. Everything ships to RIZones first.** Each task merges to `main`, is released to RIZones in the normal weekly release behind India defaults, and runs there before ROW depends on it.
- **16. Ids.** New code never compares a numeric id literal for roles, designations, modules or taxonomy rows. Use the constants or codes introduced in section 10.
- **17. Errors carry codes.** New API error responses return `code` as well as `message` (section 7.4).
- **18. No new hex colours or locale literals** in files within the translation scope; the lint rules of sections 7.3 and 8.3 enforce this.

### 3.3 Where this plan differs from the build guide

| Topic | Build guide | This plan | Reason |
|---|---|---|---|
| 15 November | ROW live | English pilot (A1); translated pilot 7 December (A2); launch follows Gate B | Scope is about three times pre-freeze capacity |
| Time storage | UTC in the database | Instance time, three boundaries | On a shared Windows server .NET returns IST; UTC storage would mix two clocks in one row |
| Translation scope | Every hard-coded string | Every route a ROW user can reach; SuperAdmin stays English | 2,335 strings are SuperAdmin only |
| Translation coverage | Web and app | Also server messages, emails, WhatsApp, documents, database labels, club websites | Otherwise a translated screen is followed by an English receipt |
| Translation review | Three markets | All eight languages | Eight languages is a fixed promise |
| Seed files | Business keys, never ids | Business keys plus preserved ids for six tables | Code compares role, designation and taxonomy ids as literals |
| Smoke suite | Written 29 October to 3 November | Written in week one | It is the safety net for everything else |
| Release order | ROW staging, ROW production, then RIZones | RIZones weekly throughout | RIZones proves the code before ROW depends on it |
| Master data sharing | Seed files | Same | Agreed |
| Legacy v1 pages | Not mentioned | Not deleted; excluded from translation only if unreachable | 9 club modules have no v2; district dashboards link to v1 |
| Payment defects | Not mentioned | Fixed first (section 12.1) | Cashfree webhooks are not signature-checked today |

### 3.4 Branching, pull requests and releases

1. **Branch from `main`**, named `<task-id>-<short-slug>`, for example `WS1-03-brand-endpoint`.
2. **One task per pull request** where the task fits in 400 lines; otherwise split and suffix `a`, `b`, `c`.
3. **Pull request description** contains: the task id, what changed, how it was verified, the RIZones check performed, and screenshots for any visible change in both English and the pseudo-locale.
4. **Required checks** (WS0-06): build, unit and characterisation tests, secret scan, lint, smoke against staging.
5. **Review:** the area owner plus one other engineer. Cross-cutting changes (configuration, time, payments, anything in `Program.cs`) also need the lead developer.
6. **Merge:** squash, with the task id as the commit prefix: `WS1-03: public brand endpoint`.
7. **Release:** every Thursday, `main` is tagged `vYYYY.MM.DD.N`, deployed to RIZones staging, smoke tested, then to RIZones production with `tools/deploy.ps1` (WS0-04). ROW staging takes the same tag the same day. ROW production takes it after Gate A1.
8. **Hotfix:** branch from the last release tag, fix, tag, deploy to both instances, merge back.

### 3.5 Definition of done for a task

A task is done when all of these are true:

- The code is merged to `main` behind India defaults.
- Its "Verify" step has been performed and recorded in the pull request.
- Its "RIZones check" passed.
- New behaviour has an automated test, or the pull request says why it cannot.
- No new secret, hard-coded locale, currency, domain, id literal or English string in a scoped file.
- The smoke suites are green for both instances on staging.
- Any new configuration key is documented in Appendix A and has a default.
- Any new table or column is in Appendix B and in `DatabaseInitializer` (or the SQL file named in the task).

## 4. Conventions

### 4.1 Configuration

- The instance is described by one section, `Brand`, bound to `BrandOptions` (section 6A and Appendix A). RIZones has no `Brand` section.
- Secrets never go in `appsettings*.json`. They are environment variables on the IIS application pool or the worker's service account, named with double underscores: `ConnectionStrings__DefaultConnection`, `Brand__Providers__Stripe__WebhookSecret`.
- New code takes `IOptions<BrandOptions>`. Static helpers that cannot take dependencies use `Brand.Current`.
- Feature flags live in `Brand:Features` as `"area.flag": true|false`. Read them with `Brand.Feature("area.flag")` on the server and `useFeature("area.flag")` on the client. Every flag is declared in Appendix C with its default.

### 4.2 Naming

| Thing | Convention | Example |
|---|---|---|
| Translation key | `<namespace>.<screen>.<element>` in camelCase | `dues.members.markPaidConfirm` |
| Error code | `UPPER_SNAKE`, noun first | `CLUB_INACTIVE`, `FILE_TOO_LARGE` |
| WhatsApp template key | `<domain>.<event>[.<variant>]` | `dues.reminder.withBank` |
| Email template key | `<domain>.<event>` | `auth.passwordReset` |
| Feature flag | `<area>.<capability>` | `member.bloodGroup`, `privacy.enabled` |
| Seed file | `<table>.json` | `category_master.json` |
| Merchant order id | `<FLOW>-<instance>-<id>-<ticks>` | `DUES-ROW-1042-638...` |
| Branch | `<task-id>-<slug>` | `WS6-04-cashfree-gateway` |

### 4.3 Logging

Every log line from a payment, message or sync call includes `Instance`, `DistrictId` (or `0`), and
`CorrelationId`. The correlation id is the request's `TraceIdentifier` for API calls and the run id
for workers. Use structured logging placeholders, never string concatenation.

### 4.4 Database changes

- Additive only during this build: new tables, new nullable columns, new indexes. No column is dropped or repurposed.
- Each change exists in two places: `DatabaseInitializer` (so dev and ROW get it at startup) and a file under `SQL/` with the "apply manually on production" header used elsewhere in the repository, for RIZones.
- Character set `utf8mb4`, collation `utf8mb4_unicode_ci`, stated explicitly on every `CREATE TABLE`.
- Every new table that refers to a member uses `fk_member_master_profile_id` and is added to the personal-data registry (section 13.1).

### 4.5 Tests

| Kind | Where | Runs |
|---|---|---|
| Unit | `RotaryApi.Tests` (new) | On every pull request |
| Characterisation | `RotaryApi.Tests/Characterisation` | On every pull request; compare captured provider requests before and after a refactor |
| Smoke | `RotaryApi.SmokeTests` (new) | Against staging on every pull request; against production after every deploy |
| Browser journeys and crawl | `rotary-frontend/e2e` (new, Playwright) | Journeys on every pull request; language crawl nightly |
| Assistant eval | existing `api/assistant/eval/run` | Before each release |

### 4.6 Developer setup

Prerequisites: .NET 10 SDK, Node.js 22, Git, a MySQL client, Visual Studio or VS Code, Flutter for F1 and F2. Windows is the deployment platform; development works on Windows or macOS.

| Component | Folder | Run | Port | Configuration |
|---|---|---|---|---|
| API | `RotaryApi` | `dotnet run` | 5000 (`Properties/launchSettings.json`) | `appsettings.Development.json` pointing at **staging** (S-03); secrets as environment variables or `dotnet user-secrets` |
| Admin web app | `rotary-frontend` | `npm ci && npm run dev` | 3000 | `.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:5000` |
| Club sites | `club-website` | `npm ci && npm run dev` | 3001 | `.env.local`; a host-name mapping in `hosts` for one test club site |
| Workers | `RotaryOrgSyncWorker`, `GreetingsWorker`, `AwardsAutoCalcWorker` | `dotnet run -- --help` | | `appsettings.json` pointing at staging; `--dry-run` where offered |
| ROW locally | any of the above | set `BRAND_FILE=brand.ROW.json` and the ROW staging connection string | | The same build becomes ROW |
| Tests | `RotaryApi.Tests`, `RotaryApi.SmokeTests`, `rotary-frontend/e2e` | `dotnet test`, `tools/smoke.ps1 -Instance RIZones -Environment staging`, `npx playwright test` | | |
| Translation tools | `tools/` | `npm run i18n:scope`, `i18n:pseudo`, `i18n:check`, `i18n:export`, `i18n:import` | | |

Day one for a new engineer: clone; copy the staging configuration from the vault; run the API and the web app against RIZones staging; sign in with the staging password (S-02); run the smoke suite against staging; then do the same with `BRAND_FILE=brand.ROW.json` against ROW staging. Never point anything at a production database (rule 7).

# Part B. The work

## 5. Workstream S: server, environments and secrets

**Owner: BW1.** These tasks protect RIZones today or have outside lead times. They start on day one.

### S-01 Rotate every committed secret and remove secrets from the repository

- **Track:** A1 · **Depends on:** none · **Estimate:** 2 days
- **Files:** `RotaryApi/appsettings.json`, `RotaryApi/appsettings.Production.json`, `RotaryOrgSyncWorker/appsettings.json`, `GreetingsWorker/appsettings.json`, `AwardsAutoCalcWorker/appsettings.json`, `club-website/.env.production`, `rotary-frontend/.env.production`, `_schemacheck/Program.cs`, `create-yearly-tables.js`, `bcrypt-migrate-passwords.js`, `migrate-old-to-new.js`, `add-project-*.js`, `set-district-website-docroots.py`
- **Do:**
  1. Inventory the keys. At minimum: MySQL root and application passwords, `JwtSettings:Secret`, `Cashfree:ClientSecret`, `CashfreePayment:ClientSecret`, `CashfreeGateway:ProjectSecret`, `Razorpay:KeySecret` and `WebhookSecret`, `Brevo:ApiKey`, `Interakt:ApiKey`, `SmsSettings:Password`, `Zoom:ClientSecret`, `Google:ClientSecret` and `RefreshToken`, `Gemini:ApiKey`, `Assistant:Claude:ApiKey`, `ShrigodaPartnerApi` password and AES key, `ClubProfileReportApi:ApiKey`, `PleskSettings:ApiKey`, `RotaryOrgApi:Password`, `PURGE_CACHE_SECRET`, the Firebase service-account file.
  2. For each key: generate a new value at the provider, set it as an environment variable on the RIZones application pool (IIS Manager, Application Pools, Advanced Settings is not enough; use `appcmd set config -section:system.applicationHost/applicationPools /+"[name='<pool>'].environmentVariables.[name='Key__Name',value='...']"`), recycle the pool, confirm the feature works, then revoke the old value.
  3. Rotating `JwtSettings:Secret` signs every user out and invalidates every signed link token (dues pay links, wallet links, project-sync and foundation tokens derive their key from it or from `Razorpay:PayLinkKey`). Do it in a low-traffic window and announce it.
  4. Replace each value in the JSON files with the placeholder `"SET-IN-ENVIRONMENT"` and keep the key so the shape is documented.
  5. The three workers build their configuration from `appsettings.json` only (`RotaryOrgSyncWorker/Program.cs:80`, `GreetingsWorker/Program.cs:47`, `AwardsAutoCalcWorker/Program.cs:39`); none calls `AddEnvironmentVariables()`. Add `.AddEnvironmentVariables()` after the JSON file in each, then set the same variable names for the worker's service account (S-07) as machine-level or task-level environment variables.
  6. Delete the hard-coded credentials from the root helper scripts; make them read `ROTARY_DB_*` environment variables.
  7. Purge history with `git filter-repo --replace-text secrets.txt`, force-push, and have every engineer re-clone. Agree the time with the team, because every open branch must be rebased.
  8. Add the secret scan (S-01 continues in WS0-06).
- **Verify:** `gitleaks detect --source . --log-opts="--all"` reports nothing; RIZones login, a dues payment in test mode, one email and one WhatsApp message all work after rotation.
- **RIZones check:** this task changes RIZones. Run the smoke suite (once WS0-03 exists) after each key.

### S-02 Staging database with scrambled personal data

- **Track:** A1 · **Depends on:** none · **Estimate:** 1.5 days
- **Do:**
  1. Create schema `rotaryindia_staging` on the RIZones MySQL instance (later also `row_staging` on the ROW instance).
  2. Write `tools/refresh-staging.ps1`: `mysqldump --single-transaction --routines --triggers rotaryindia_production_claude | mysql rotaryindia_staging`, then run `SQL/staging_scramble.sql`.
  3. `staging_scramble.sql` first drops every table that is a manual backup or scratch copy of personal data (production has about twenty: every `bak_*` table, `tmp_spouse_fill`, `_tmp_missing_members`, `temp`, `dedup_norid_log`, `dc_cp_cs_dedup_backup_20260710`), then rewrites, for every row: `member_master_profile.EmailId = CONCAT('user', pk_member_master_profile_id, '@example.invalid')`, `SecondaryEmailId = NULL`, `PrimaryMobileNumber = CONCAT('90000', LPAD(pk_member_master_profile_id % 100000, 5, '0'))`, `SecondaryMobileNumber = NULL`, `LastDeviceToken = NULL`; the same for `member_family_details` (`PhoneNumber`, `EmailId`), `member_address_details` (phones, business email), the copies in `district_committee_*` (`mobile`, `email`), `event_payment_members`, `cashfree_kyc`; truncates `member_fcm_tokens`, `member_device_sessions`, `mobile_login_otp`, `email_log`, `whatsapp_log`, every `*_push_log`, `assistant_turns`; and sets every `member_credentials.PasswordHash` to the hash of one known staging password.
  4. Schedule it nightly at 01:00 server time.
  5. Staging API configuration sets `BackgroundJobs:Enabled=false` and points Brevo, Interakt and SMS at sandbox or null senders so staging can never message a real member.
- **Verify:** `SELECT COUNT(*) FROM rotaryindia_staging.member_master_profile WHERE EmailId NOT LIKE '%@example.invalid'` returns 0.

### S-03 Point every developer configuration at staging

- **Track:** A1 · **Depends on:** S-02 · **Estimate:** 0.5 day
- **Files:** `RotaryApi/appsettings.Development.json`, worker `appsettings.json` files
- **Do:** change `ConnectionStrings:DefaultConnection` to the staging schema with a staging-only MySQL user that has no rights on production schemas; remove `Mysql_admin_User` access from developer IP addresses at the firewall.
- **Verify:** from a developer machine, a connection to the production schema is refused.

### S-04 Offsite backups and one full restore

- **Track:** A1 · **Depends on:** none · **Estimate:** 1 day
- **Do:**
  1. Enable binary logging on the RIZones instance if it is not already (`log_bin`, `binlog_expire_logs_seconds=604800`).
  2. Nightly full dump compressed and copied offsite (object storage bucket or a second provider), retained 30 days; hourly copy of closed binlog files.
  3. Replace `Deletee_5_days_back_DB.ps1` with a retention rule in the same script as the backup.
  4. Restore the latest dump plus binlogs to a separate machine and record how long it took.
- **Verify:** a written restore report with the row counts of five large tables matching production at the restore point.

### S-05 Second MySQL instance for ROW

- **Track:** A1 · **Depends on:** S-04 · **Estimate:** 1 day
- **Do:**
  1. Read the server's installed memory. The RIZones instance has `innodb_buffer_pool_size = 16 GB`. Give ROW 4 GB to start; if the server has less than 32 GB, reduce the RIZones pool to keep 8 GB free for IIS, workers and the operating system, and record the change.
  2. Install a second MySQL 8.0 service: `mysqld --install MySQL_ROW --defaults-file="D:\MySQL_ROW\my.ini"` with its own `port=3307`, `datadir=D:\MySQL_ROW\data`, `log_bin`, `character-set-server=utf8mb4`, `collation-server=utf8mb4_unicode_ci`, `default-time-zone=SYSTEM`, `max_connections=500`.
  3. Create databases `row_production` and `row_staging` with `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`.
  4. Create users: `row_app` (all privileges on `row_production.*` only), `row_staging_app` (on `row_staging.*` only), `row_ai_ro` (SELECT on the `ai_v_*` views only, from `SQL/assistant_readonly_user.sql`). No ROW user has any right on a RIZones schema and the reverse.
  5. Add the instance to backups (S-04) and monitoring (S-10).
- **Verify:** stopping the `MySQL_ROW` service has no effect on RIZones; `row_app` cannot `USE rotaryindia_production_claude`.

### S-06 IIS sites and application pools for ROW

- **Track:** A1 · **Depends on:** S-05 · **Estimate:** 0.5 day
- **Do:**
  1. Three sites: ROW API, ROW admin web, ROW club sites; plus three for ROW staging. Each has its own application pool with its own identity (`IIS AppPool\ROW-Api` and so on).
  2. Limits on every ROW pool: private memory limit 2 GB for the API and 1.5 GB for each Node site, CPU limit 50 percent with action `Throttle`, so a runaway ROW process cannot starve RIZones.
  3. The API pool sets `ASPNETCORE_ENVIRONMENT=Production`, `BRAND_FILE=brand.ROW.json` and the secret environment variables.
  4. ROW has its own `PleskSettings` section (own parent domain, own API key) for club-site provisioning at B; `PleskService` is already configuration-driven, and `IisAppPoolRecycler.cs:55` must take the pool name from configuration instead of the literal.
  5. Bind the sites to the ROW host names; the certificate is the Cloudflare origin certificate (S-09).
- **Verify:** recycling or stopping any ROW pool leaves RIZones response times unchanged (check `api_request_stats` for the period).

### S-07 Worker service account, folders and schedules

- **Track:** A1 · **Depends on:** S-05 · **Estimate:** 0.5 day
- **Do:**
  1. Create a low-privilege local account `svc-row-workers` with read and execute on `D:\ROW\workers\*` and write on `D:\ROW\logs\*` only. RIZones workers move from `SYSTEM` to a matching `svc-riz-workers` account.
  2. Deploy worker builds to `D:\ROW\workers\<Worker>\<version>\` (WS0-04).
  3. Schedules are generated from `tools/schedule.json` (WS8-08), never imported by hand.
- **Verify:** `svc-row-workers` cannot read `D:\inetpub\vhosts\rizones45678.org`.

### S-08 File storage for ROW

- **Track:** A1 · **Depends on:** S-06 · **Estimate:** 0.5 day
- **Do:** set `Media:WebRoot` for ROW to `D:\ROW\media`; only the ROW API pool identity can write there; `Media:RedirectBaseUrl` is empty for ROW. Confirm every upload path in the API resolves under `Media:WebRoot` (search for `wwwroot` and `inetpub` literals and fix any that do not).
- **Verify:** an upload on ROW staging lands under `D:\ROW\media` and nothing is written under the RIZones tree.

### S-09 Cloudflare in front of every ROW host name

- **Track:** A1 · **Depends on:** the ROW domain being registered · **Estimate:** 0.5 day
- **Do:**
  1. Move the ROW domain's DNS to Cloudflare (Pro plan).
  2. Proxied records for the admin host, the API host and a wildcard for club subdomains.
  3. SSL mode Full (strict). Create a Cloudflare origin certificate for the apex and wildcard; install it in IIS and Plesk.
  4. Cache rule: cache static assets (`/_next/static/*`, images, fonts); bypass cache for `/API/*` and for any request with an `Authorization` header.
  5. Restrict the origin to Cloudflare's address ranges at the Windows firewall for the ROW sites.
- **Verify:** `curl -I https://<row-admin-host>/_next/static/...` shows `cf-cache-status: HIT` on the second request; an API call shows `BYPASS` or `DYNAMIC`.

### S-10 Monitoring and alerts for both products

- **Track:** A1 · **Depends on:** S-06, WS0-01 · **Estimate:** 1.5 days
- **Do:**
  1. A scheduled script every five minutes checks: `/api/health` for both instances, free disk on every volume (alert below 15 percent), total CPU (alert above 85 percent for 15 minutes), private memory per application pool, both MySQL services responding, replication or binlog copy age, and the last successful run of each scheduled job from `rotary_org_sync_log` and `scheduled_job_runs`.
  2. Alerts go to a team channel and by email to the four engineers and the lead developer.
  3. A weekly digest feeds the Friday gate report.
- **Verify:** stopping the ROW staging API produces an alert within ten minutes.

### S-11 Move RIZones nightly jobs to make room

- **Track:** A1 · **Depends on:** WS8-08 · **Estimate:** 0.5 day
- **Do:** with the schedule file of WS8-08, place the RIZones heavy jobs in the latest India-time slot that still finishes before the Indian working day, and ROW heavy jobs outside that slot. Disable the superseded tasks listed in WS8-09.
- **Verify:** the overlap check in WS8-08 passes.

---

## 6. Workstream WS0: safety net and release mechanics

**Owner: BW1. Nothing in WS1 to WS9 merges before WS0-01, WS0-02 and WS0-03 are live on RIZones.**

### WS0-01 Health and version endpoint

- **Track:** A1 · **Depends on:** none · **Estimate:** 0.5 day
- **Files:** new `RotaryApi/Controllers/HealthController.cs`; `RotaryApi/RotaryApi.csproj`; `rotary-frontend/next.config.mjs`
- **Do:**
  1. Add to the project file, inside the first `PropertyGroup`: `<InformationalVersion Condition="'$(InformationalVersion)' == ''">0.0.0-dev</InformationalVersion>`.
  2. Add the controller below. It is anonymous and returns no secret.
  3. The frontend exposes the same value: `env: { NEXT_PUBLIC_BUILD_VERSION: process.env.BUILD_VERSION ?? "dev" }` and shows it in the footer of the settings page.

```csharp
[ApiController]
public class HealthController : ControllerBase
{
    private static readonly DateTime StartedAtUtc = DateTime.UtcNow;
    private readonly IConfiguration _config;
    public HealthController(IConfiguration config) => _config = config;

    [AllowAnonymous]
    [HttpGet("api/health")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var version = typeof(HealthController).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
        var dbOk = false;
        try
        {
            await using var conn = new MySqlConnection(_config.GetConnectionString("DefaultConnection"));
            await conn.OpenAsync(ct);
            dbOk = await conn.ExecuteScalarAsync<int>("SELECT 1") == 1;
        }
        catch { /* reported as dbOk = false */ }
        var body = new { status = dbOk ? "ok" : "degraded", version, instance = Brand.Current.InstanceCode, dbOk, startedAtUtc = StartedAtUtc };
        return dbOk ? Ok(body) : StatusCode(503, body);
    }
}
```

- **Verify:** `curl https://<host>/API/api/health` returns 200 with the version that was published.
- **RIZones check:** additive endpoint. Until WS1-01 exists, replace `Brand.Current.InstanceCode` with the literal `"RIZ"`.

### WS0-02 Request statistics for an error baseline

- **Track:** A1 · **Depends on:** none · **Estimate:** 1 day
- **Files:** new `RotaryApi/Services/RequestStatsMiddleware.cs`; `Program.cs`; `SQL/api_request_stats.sql`; `DatabaseInitializer.cs`
- **Do:**
  1. Create the table (Appendix B.1).
  2. The middleware records, in a `ConcurrentDictionary` keyed by `(hourUtc, routeTemplate, statusClass)`, a count and a small latency histogram. Use the endpoint's route pattern (`context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText`), never the raw path, so ids do not explode the key space.
  3. A timer flushes once a minute with `INSERT ... ON DUPLICATE KEY UPDATE Count = Count + VALUES(Count)`.
  4. Wrap the whole thing in try/catch; it must never affect a request. Register it after authentication.
  5. Add `GET api/health/stats?hours=24` (SuperAdmin) returning 5xx rate and p95 per route.
- **Verify:** after an hour on staging the table has rows and the stats endpoint shows them.
- **RIZones check:** deploy immediately and leave it running for a full week before the first ROW task merges. That week is the baseline.

### WS0-03 API smoke suite

- **Track:** A1 · **Depends on:** WS0-01, S-02 · **Estimate:** 2.5 days
- **Files:** new project `RotaryApi.SmokeTests/` (xUnit); `tools/smoke.ps1`
- **Do:**
  1. The suite reads `SMOKE_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`, `SMOKE_CLUB_ID`, `SMOKE_DISTRICT_ID`, `SMOKE_EXPECT_VERSION` from the environment.
  2. Create one dedicated smoke account per instance: a Club Admin of a quiet real club who is also District Admin of its district. Its password lives in the vault.
  3. Implement the thirty checks of Appendix E. Each asserts status, content type, and the presence of two or three named fields, never exact data values.
  4. No check writes data except the payment check, which creates an order in gateway test mode and is skipped when no sandbox key is configured.
  5. `tools/smoke.ps1 -Instance RIZones|ROW -Environment staging|production` sets the variables from the vault and runs `dotnet test`.
- **Verify:** the suite is green against RIZones staging and RIZones production; forcing one endpoint to return 500 on staging turns exactly one check red, named clearly.

### WS0-04 Versioned deploy with automatic rollback

- **Track:** A1 · **Depends on:** WS0-03 · **Estimate:** 1.5 days
- **Files:** new `tools/deploy.ps1`, `tools/instances.json`
- **Do:**
  1. `instances.json` describes each instance and environment: site names, pool names, physical root, worker root, health URL.
  2. `deploy.ps1 -Instance <name> -Environment <env> -Version <v>`:
     1. `dotnet publish RotaryApi -c Release -p:InformationalVersion=<v>+<sha> -o <root>\releases\<v>\api`
     2. `npm ci && BUILD_VERSION=<v> npm run build` in `rotary-frontend` and `club-website`, copy the standalone output to `releases\<v>\web` and `releases\<v>\clubsite`, run `patch-server-iisnode.js`.
     3. Publish the three workers to `releases\<v>\workers\<Worker>`.
     4. Run database migrations and the seeder in dry-run; stop if RIZones would change master data (WS5-04).
     5. Stop the pools, switch each site's physical path to the new folder (`Set-ItemProperty IIS:\Sites\<site> -Name physicalPath`), start the pools.
     6. Wait for `/api/health` to report the new version, then run the smoke suite.
     7. On failure: switch the paths back to the previous version, start the pools, run smoke again, exit non-zero.
     8. Keep the last three version folders; delete older ones.
  3. Stop committing `rotary-frontend/deploy-ready/`; add it to `.gitignore` after the first successful scripted release.
- **Verify:** a deliberately broken build is rolled back automatically on staging and the script reports the failed check.
- **RIZones check:** the first production use is a release with no functional change.

### WS0-05 Browser journeys

- **Track:** A1 · **Depends on:** WS0-03 · **Estimate:** 1 day
- **Files:** new `rotary-frontend/e2e/` (Playwright), `rotary-frontend/playwright.config.ts`
- **Do:** five journeys, each ending in an assertion on visible content: (1) log in and land on the club dashboard; (2) open Membership and see a member count; (3) search a member by name; (4) open the club monthly report list and one report; (5) open the dues page and one campaign. Run headless against staging with the smoke account.
- **Verify:** green against RIZones staging; one broken selector fails one journey.

### WS0-06 Pipeline

- **Track:** A1 · **Depends on:** WS0-03, WS0-05 · **Estimate:** 0.75 day
- **Files:** new `.github/workflows/ci.yml`, `.gitleaks.toml`
- **Do:** on every pull request: restore and build the API and the three workers; `dotnet test` for unit and characterisation tests; `npm ci`, `npm run lint` and `npx tsc --noEmit` for both Next.js apps; `gitleaks` on the diff; the translation checks of WS2-26 once they exist. A second job, on a self-hosted runner that can reach staging, deploys the branch build to staging and runs the smoke suite and the journeys. Branch protection on `main` requires both jobs and two approvals.
- **Verify:** a pull request containing a fake key is blocked; a pull request that breaks a smoke check is blocked.

### WS0-07 Release record

- **Track:** A1 · **Depends on:** WS0-04 · **Estimate:** 0.25 day
- **Do:** `tools/deploy.ps1` appends to `releases/CHANGELOG.md` the version, date, instance, the task ids merged since the previous tag (from commit prefixes) and the smoke result. This file is the evidence for "every merged package has run in RIZones production for at least 7 days".

---

## 6A. Workstream WS1: instance and brand configuration

**Owner: BW1.**

### WS1-01 `BrandOptions`, binding and the static accessor

- **Track:** A1 · **Depends on:** WS0-03 · **Estimate:** 1 day
- **Files:** new `RotaryApi/Configuration/BrandOptions.cs`, `RotaryApi/Configuration/Brand.cs`; `Program.cs`; new `RotaryApi.Tests/BrandDefaultsTests.cs`
- **Do:**
  1. Create the options classes exactly as in Appendix A.1. Every property has a default equal to today's RIZones value.
  2. In `Program.cs`, immediately after the builder is created: `builder.Services.Configure<BrandOptions>(builder.Configuration.GetSection("Brand"));` and, after `builder.Build()`, `Brand.Initialise(app.Services.GetRequiredService<IOptions<BrandOptions>>().Value);`.
  3. `Brand` is a static class with `Current` (throws if not initialised) and `Feature(string key)`, which returns the configured value when the key is present in `Brand:Features` and otherwise the default from `FeatureDefaults` (a static dictionary holding every flag of Appendix C with the value that reproduces today's RIZones behaviour). An unknown key throws in Development and returns `false` in Production, so a misspelt flag is caught early.
  4. Add the snapshot test: serialise `new BrandOptions()` to JSON and compare with the checked-in file `RotaryApi.Tests/Snapshots/brand-defaults.json`. A changed default now fails the build and must be a deliberate edit to the snapshot.
- **Verify:** the API starts with no `Brand` section; `Brand.Current.ProductName` is "Rotary Zones 4, 5, 6, 7 & 8".
- **RIZones check:** no configuration change on RIZones. Snapshot test green.

### WS1-02 Overlay for legacy configuration keys

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 0.5 day
- **Files:** new `RotaryApi/Configuration/BrandConfigurationOverlay.cs`; `Program.cs`
- **Why:** 255 files read string keys such as `FrontendUrl`. They must keep working without being edited.
- **Do:** add an in-memory configuration source, inserted **before** the JSON files so explicit values win, that supplies these keys from `Brand` when the section is present:

| Legacy key | Supplied from |
|---|---|
| `FrontendUrl`, `PublicFrontend:BaseUrl` | `Brand:Domains:AdminOrigin` |
| `BackendUrl`, `Api:BaseUrl`, `WebhookBaseUrl` | `Brand:Domains:ApiBase` |
| `Brevo:SenderName` | `Brand:ProductName` |
| `Brevo:SenderEmail` | `Brand:Support:NoReplyEmail` |
| `Razorpay:GstPercent` | first matching `Brand:Providers:TaxRules` entry for the default country, else unchanged |

- **Verify:** with a `Brand` section and no `FrontendUrl`, `config["FrontendUrl"]` returns the admin origin; with both, the explicit key wins.
- **RIZones check:** no `Brand` section means the overlay contributes nothing.

### WS1-03 Public brand endpoint

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 0.5 day
- **Files:** new `RotaryApi/Controllers/PublicBrandController.cs`, `RotaryApi/DTOs/PublicBrandDto.cs`
- **Do:** `GET api/public/brand` (anonymous, `[ResponseCache(Duration = 3600)]`) returns: `instanceCode`, `productName`, `shortName`, `logoUrl`, `logoDarkUrl`, `faviconUrl`, `support { email, phones[], hours, address, legalName }`, `locale { defaultLanguage, languages[], defaultCurrency, currencies[], defaultTimeZone, numberLocale, defaultCountryId }`, `features { ... }`, `legal { privacyUrl, termsUrl, refundsUrl, cookiesUrl, policyVersion }`, `domains { adminOrigin, clubSiteParent }`. Nothing from `Providers` except the list of enabled payment gateway codes.
- **Verify:** the endpoint returns today's RIZones values with no `Brand` section.

### WS1-04 CORS from configuration

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 0.5 day
- **Files:** `RotaryApi/Program.cs` (the default policy at lines 65 to 127)
- **Do:** replace the literal host checks with a loop over `Brand.Current.Domains.AllowedOriginSuffixes`, whose default is `["rizones45678.org", "rizones4567.org"]`. Keep `localhost` and `127.0.0.1`. The `ThirdPartyCors` policy reads `Domains.ThirdPartyOriginSuffixes`, default `["rotaryindia.org"]`.
- **Verify:** a request from an origin on the ROW admin host succeeds on ROW staging and is refused on RIZones staging.
- **RIZones check:** unit test asserting the default suffix list allows and refuses the same origins as before.

### WS1-05 One helper for frontend and API URLs

- **Track:** A1 · **Depends on:** WS1-02 · **Estimate:** 0.5 day
- **Files:** new `RotaryApi/Configuration/BrandUrls.cs`; every file listed in Appendix I, section G5
- **Do:** `BrandUrls.Frontend()`, `BrandUrls.Api()`, `BrandUrls.ClubSiteParent()`. Replace each `?? "https://rizones45678.org"` and `?? "http://localhost:3000"` with the helper. The helper returns the configured value; in Development with nothing configured it returns the localhost value, as today.
- **Verify:** `grep -rn '"https://rizones45678.org"' RotaryApi --include=*.cs` returns only `BrandOptions.cs`.
- **RIZones check:** the generated link in one dues reminder email and one password-reset email is identical before and after (compare on staging).

### WS1-06 Club-site parent domain: one resolver

- **Track:** A1 · **Depends on:** WS1-05 · **Estimate:** 0.5 day
- **Files:** `ClubWebsitesController.cs` (lines 253, 1736), `WebsiteBillingService.cs:42`, `DistrictPerformanceReportService.cs:124`, `ClubFinderController.cs:250`, `ClubAdminDashboardService.cs` (lines 975, 1384), `PublicWebsiteDirectoryController.cs:28`, `ClubWebsiteReminderBackgroundService.cs:139`, `IisAppPoolRecycler.cs:55`, `WebsiteDomainHelper.cs:51`
- **Why:** six places fall back to `rotaryindia.org` and four to `rizones45678.org`.
- **Do:** `BrandUrls.ClubSiteParent()` reads `system_settings.ClubWebsiteParentDomain`, then `Brand:Domains:ClubSiteParent` (default `rotaryindia.org`, which is what production uses). Replace all ten fallbacks. `WebsiteDomainHelper` takes its suffix list from `Domains.ClubSiteSuffixes`.
- **Verify:** the club website URL shown on the club dashboard is unchanged for ten sampled RIZones clubs.

### WS1-07 Instance constants into `Scope`

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 1 day
- **Files:** `CogDesignationHelper.cs:22`, `ClubsController.cs:113`, `RotaryOrgManualSyncController.cs:1510` (COG club 31598); `WhatsAppPilot.cs:19-22`, `GoalTargetSplitPilot.cs:19-22` (club 2765, district 2); `DistrictPerformanceReportService.cs` lines 140, 141, 1593 (`SendHourIst = 7`, test district "3142", 1st/16th rule); `OtpWhatsAppHelper.cs:35-37` (India country id 1, dial code "91"); `RotaryOrgFoundationSyncController.cs:69` (`PulledZoneNames`)
- **Do:** move each to `Brand.Current.Scope` with today's value as the default. Code reads the option.
- **Verify:** snapshot test of defaults still green; behaviour on staging unchanged.

### WS1-08 Frontend `BrandProvider`

- **Track:** A1 · **Depends on:** WS1-03 · **Estimate:** 1 day
- **Files:** new `rotary-frontend/src/contexts/BrandContext.tsx`; `src/components/ClientProviders.tsx`; `src/services/api.ts`
- **Do:**
  1. `getPublicBrand()` in `api.ts` using `publicApi`.
  2. `BrandProvider` fetches once, caches in `sessionStorage` for the session, and renders children immediately with built-in RIZones defaults so nothing flashes or blocks.
  3. Export `useBrand()` and `useFeature(key)`. The brand endpoint returns every flag of Appendix C already resolved, so the client never guesses a default; the built-in fallback object used before the first response holds the RIZones defaults.
  4. Wrap in `ClientProviders.tsx` outside `AuthProvider`.
- **Verify:** on ROW staging the header shows the ROW name; on RIZones staging nothing changes.

### WS1-09 Replace brand literals that are not translatable text

- **Track:** A1 · **Depends on:** WS1-08 · **Estimate:** 1.5 days
- **Files:** `src/lib/merchantInfo.ts:20-33`; `src/components/AppHeader.tsx` (lines 119, 126); `src/app/login/page.tsx:142`; `src/components/RotaryLoader.tsx:23`; `RouteLoadingIndicator.tsx:75`; `components/site/Logo.tsx:28`; `components/site/SiteHeader.tsx:24`; `components/site/FooterBottomBar.tsx` (lines 27, 65, 71); `components/pages/contact/ContactChannels.tsx` (lines 7, 12); `utils/csvExport.ts` (lines 218, 422); `settings/club-websites/page.tsx:137`; `settings/district-websites/page.tsx:69`; `club-admin-dashboard/my-club-website/page.tsx:195`; `settings/global-search/page.tsx:54`; the mass-email compose pages; `next.config.mjs` `images.remotePatterns`. The full list of files that reference a logo is Appendix I, section G17.
- **Do:** logos, favicon, support contacts, legal name, address, help-line numbers, parent domains and sender addresses come from `useBrand()`. The product name inside sentences is handled by translation (WS2): it becomes the `{brandName}` argument.
- **Verify:** on ROW staging, search the rendered HTML of the login page, header, footer, contact page and one Excel export for "rizones", "Zones 4" and the RIZones phone numbers: none found.

### WS1-10 Member field flags

- **Track:** A1 · **Depends on:** WS1-08 · **Estimate:** 1.5 days
- **Files:** API: the 22 files that reference `BloodGroup` (`MembersController`, `MemberService`, member DTOs, `ClubReportController`, `DistrictReportController`, `ReportsController`, `AgReportsController`, `FindRotarianController`, `ClubFinderController`, `LiveDocumentsExportController`, `MemberDuplicateController`, `DirectoryDataCollectionFields`, the assistant views). Frontend: the 23 files (`MemberForm`, `MemberTable`, `MemberCard`, `MemberDetailDialog`, `MemberFilters`, `members/new-v2`, `members/edit-v2`, directory pages, report pages, `MergeDialog`, `types/member.ts`).
- **Do:** flags `member.bloodGroup` and `member.familyDetails`. Server: a helper `MemberFieldPolicy.Apply(dto)` nulls disabled fields on the way out and ignores them on the way in; reports omit the column; the Blood Group report returns 404 with code `FEATURE_DISABLED`. Client: `useFeature` hides the field, column, filter and report card. Assistant: `ai_v_members` and `ai_v_member_profiles` are unchanged; the member tools drop the column when the flag is off.
- **Verify:** with the flag off on ROW staging, blood group is absent from the member form, list, export and the assistant's answers; with no flag on RIZones everything is as before.

### WS1-12 Product name in server-generated text

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 1 day
- **Files:** the API files that contain "Rotary Zones 4, 5, 6, 7 & 8", "RI Zones" or "RIZones45678" inside strings that reach a user: about 45 files, chiefly `EmailService.cs`, `MembershipDuesService.cs`, `EventPaymentLinkService.cs`, `ClubDuesService.cs`, `MobileAuthService.cs`, `RoleService.cs`, `ProjectShareCardBuilder.cs`, `ClubReportWordBuilder.cs`, `OcvReportExcelBuilder.cs`, `DuesReceiptPdfBuilder.cs`, `WhatsAppCommsTemplates.cs`, `Assistant/AssistantOrchestrator.cs` (the system prompt), and the files of Appendix I, section G6
- **Do:** replace the literal with `Brand.Current.ProductName` (or `ShortName`) by interpolation. Do not touch the DLT-registered SMS text in `SmsService.cs` (it is sent only on RIZones and must stay byte-identical), comments, or log messages. This is the interim measure that makes the English pilot clean; the same strings move into templates in WS2-19 to WS2-23.
- **Verify:** on ROW staging the OTP email, the dues receipt email and PDF, a project share card and the assistant's self-description name ROW. On RIZones staging the same five outputs are byte-identical to before.

### WS1-11 Author the ROW brand configuration

- **Track:** A1 · **Depends on:** WS1-01 to WS1-10 and product-owner input · **Estimate:** 0.5 day
- **Do:** fill the ROW `Brand` section from Appendix A.3 with real values: names, domains, logo files (placed under the ROW media root), support contacts, languages, currencies, default time zone, providers, scope (zones and countries of the pilot), features, legal links and policy version. Secrets go in environment variables. Commit the non-secret file as `RotaryApi/brand.ROW.json` and load it with `AddJsonFile` when the environment variable `BRAND_FILE` names it.
- **Verify:** the done-when of the workstream: ROW staging shows no RIZones name, logo, domain or phone number in the header, login page, one email and one PDF.

---

## 7. Workstream WS2: translation

**Owner: F2 leads. Every engineer extracts the directories they know.** This is the largest workstream: 16.5 engineer-weeks. Text lives in seven places and each needs its own mechanism.

| Where the text lives | Size today | Mechanism | Tasks |
|---|---|---|---|
| Admin web app (JSX) | 12,170 strings in 768 files; about 6,000 to 7,500 in scope | `next-intl` message files | WS2-01 to WS2-12 |
| Server messages | about 1,650 literals, 653 distinct | Error codes, translated on the client | WS2-13 to WS2-16 |
| Emails | about 60 builder methods in 22 files | Scriban templates per language | WS2-17 to WS2-21 |
| Documents | 7 server builders, about 270 labels; browser exports | Resource files and shipped fonts | WS2-22 to WS2-24 |
| Database labels | about 700 rows in 8 master tables | `master_translation` table | WS2-25 |
| Public club sites | 155 strings in 44 files | `next-intl` in `club-website`, menu slug | WS2-27, WS2-28 |
| WhatsApp and SMS | about 25 real template names | Template registry per language | Section 11 |

### 7.1 Scope: what is translated

**Translated:** every route a user who is not a SuperAdmin can reach, plus every public page.
**Not translated, stays English:** `settings/**` and `admin/**` (Kaizen staff only, 2,335 strings).
**Not translated, because it is data:** text that admins write and the system stores (dues email subject and body, greeting messages, announcements, mass emails, club website content).

The scope is a generated file, never a hand-kept list (WS2-01). The rules it is generated from:

1. Every entry in `src/app/club-admin-dashboard/nav.ts`, `src/app/district-admin-dashboard/nav.ts`, the AG dashboard navigation and the club moderator navigation.
2. Every module route produced by the `moduleKey` switch in `src/app/clubs/[id]/dashboard/page.tsx` (lines 195 to 279) and `src/app/districts/[id]/dashboard/page.tsx` (lines 89 to 110).
3. Every card link in `RoleBasedHome.tsx` and landing route in `DashboardSwitcher`.
4. Every `href` and `router.push` target inside a file already in scope, followed to depth 4.
5. The public flows: `login`, `forgot-password`, `reset-password`, `sso`, `pay/**`, `report/**`, `dues-approval`, `club-dues-approval`, `public/**`, `privacy-policy`, `terms-and-conditions`, `refunds-and-cancellations`, and the `(site)` group.
6. Every component imported, directly or transitively, by a file in scope.

Facts that shape the result (measured; see Appendix I, sections G14 and G15):

- Club dashboards link to **v2** pages. District dashboards link mostly to **v1** pages even where a v2 exists. Scope is therefore not "v2 only".
- Nine club modules have no v2 page: `dashboard`, `greetings`, `mass-emails`, `members`, `projects`, `rotary-network`, `sub-groups`, `weblinks`, `website-data`.
- Eleven district modules have no v2 page: `club-monthly-report`, `dashboard`, `district-report`, `event-payment-links`, `greetings`, `mass-emails`, `members`, `sub-groups`, `weblinks`, `website-data`, `zonal-awards`.
- **No legacy page is deleted in this build.** A v1 page that the scope script proves unreachable is simply left untranslated.

Route directories and their size, for planning (pages / component files):

| Directory | Pages | Files | In scope |
|---|---|---|---|
| `clubs/[id]/**` | 170 | 177 | Reachable subset |
| `districts/[id]/**` | 86 | 87 | Reachable subset |
| `settings/**` | 63 | 71 | No |
| `district-admin-dashboard/**` | 43 | 51 | Yes |
| `club-admin-dashboard/**` | 30 | 49 | Yes |
| `ri-director/**` | 26 | 27 | Yes |
| `(site)/**` | 18 | 19 | Yes |
| `admin/**` | 11 | 11 | No |
| `ag-dashboard/**`, `ag-reports` | 11 | 13 | Yes |
| `pay/**`, `report/**`, approvals, `public/**` | 15 | 15 | Yes |
| `zones/**`, `zonal-dashboard`, `goal-overviews`, `members`, `club-moderator` | 14 | 16 | Yes |
| Auth and policy pages | 7 | 8 | Yes |
| `components/**` | | 214 | Those imported by scoped pages |

### 7.2 Rules for writing translatable code

Every engineer follows these when extracting. They exist because 1,100 strings are in shapes a simple find-and-replace gets wrong.

| Shape in the code today | Count | Rule |
|---|---|---|
| Plain JSX text and attributes (`placeholder`, `title`, `aria-label`, `alt`) | most | `t("key")` |
| Template literal with values: `` `Delete ${name}?` `` | 469 | ICU message with named arguments: `t("deleteConfirm", { name })`. Never concatenate translated fragments |
| Plural by ternary: `n === 1 ? "club" : "clubs"` | 148 | ICU plural: `{count, plural, one {# club} other {# clubs}}`. The translator supplies each language's forms |
| Module-level constant arrays of labels | 111 | Store keys, translate at render: `{ value: "male", labelKey: "common.gender.male" }`. Arrays whose **values are stored in the database** (`GENDERS`, `RELATIONS`, `MEETING_DAYS` in `lib/constants.ts`) keep the stored value unchanged and gain a `labelKey` |
| `label:` in navigation and table column definitions | 2,293 | `labelKey:` resolved where rendered |
| `confirm()`, `alert()`, `prompt()` | 102 calls | Replace with the existing `AlertModal` and `DeleteDialog` components. Files are listed in Appendix I, section G16 |
| Month and weekday name arrays | about 15 files | Delete; use `useFormat().monthName()` (section 8) |
| Product name inside a sentence | 219 | `{brandName}` argument, supplied automatically by the provider |
| English fallback after a server message: `e.response?.data?.message \|\| "Failed to save"` | 503 | `getErrorMessage(e, t)` (section 7.4) |
| Status strings compared in code (`status === "Pending"`) | | Never translate the compared value. Translate only at display: `t(\`status.${status}\`)` |
| Text inside exported files (Excel headers, Word labels) | about 300 | Same `t()`; pass the translator into the export helper |

Further rules:

- **English is the source language.** The English message file is generated from the existing literals, so English output is identical, character for character.
- **Keys** follow `<namespace>.<screen>.<element>`. A key is never reused for a different meaning, even if the English words are the same ("Order" the noun and "Order" the verb are two keys).
- **No HTML in messages.** For emphasis or links use rich text: `t.rich("terms", { link: (chunks) => <a href=...>{chunks}</a> })`.
- **Numbers, money and dates never appear formatted inside a message.** Pass the raw value and let ICU or `useFormat()` format it.
- **Do not split a sentence** across two keys to wrap a component. Use `t.rich`.
- **Direction:** none of the eight languages is right-to-left; no mirroring is needed.
- **Length:** German runs 30 to 40 percent longer than English. No fixed-width buttons; tables get `min-width` with wrapping, never truncation of labels.

### 7.3 Lint rules

Enabled **only for files in `i18n-scope.json`**, by an ESLint override generated from that file:

| Rule | Source | Catches |
|---|---|---|
| `i18next/no-literal-string` (mode `jsx-text-only` plus the attributes `placeholder`, `title`, `alt`, `aria-label`) | `eslint-plugin-i18next` | Untranslated text |
| `no-restricted-syntax` on `'en-IN'`, `'en-US'`, `₹`, `"INR"` string literals | built in | Hard-coded locale and currency (section 8) |
| `no-restricted-syntax` on hex colour literals in `className` and `style` | built in | New brand colour literals (section 15) |
| `no-restricted-globals` on `confirm`, `alert`, `prompt` | built in | Browser dialogs |

A file enters the override list when its directory has been extracted; from then on it cannot regress.

### 7.4 Error codes

The server stops being the source of user-facing prose. Responses keep `message` (English, unchanged) and gain `code` and, where needed, `args`:

```json
{ "code": "CLUB_INACTIVE", "message": "This club, its district, or its zone is inactive. Reactivate it first to access this data." }
{ "code": "FILE_TOO_LARGE", "args": { "maxMb": 5 }, "message": "File size must be less than 5MB" }
```

The client translates the code; if it has no translation it shows `message`. RIZones and the current mobile app read `message` and are unaffected. The catalogue is Appendix D.

---

### Framework (5 days)

### WS2-01 Scope script

- **Track:** A2 · **Owner:** F2 · **Depends on:** none · **Estimate:** 1.5 days
- **Files:** new `tools/i18n-scope.mjs`; output `rotary-frontend/i18n-scope.json`; `rotary-frontend/package.json` script `i18n:scope`
- **Do:**
  1. Parse the app with the TypeScript compiler API (`ts.createProgram` over `src/**/*.tsx`).
  2. Seed the route set from the rules of section 7.1 (nav files, the two `moduleKey` switches, `RoleBasedHome`, `DashboardSwitcher`, the public list).
  3. For each file in scope, collect string and template-literal arguments to `href=`, `router.push(`, `router.replace(`, `redirect(` and `<Link href=`; normalise dynamic segments (`${clubId}` becomes `[id]`); map each to a `page.tsx`; repeat to depth 4.
  4. Exclude any path under `app/settings` or `app/admin`.
  5. Add every module each scoped page imports, transitively, that lives under `src/components`, `src/lib`, `src/utils`, `src/contexts`.
  6. Write `{ generatedAt, routes: [...], files: [...], excluded: [...], apiPaths: [...] }`. `apiPaths` is the set of `api.ts` functions called from scoped files, resolved to their URL templates; it drives WS2-16.
  7. Print totals: routes, files and a count of string literals in JSX text positions.
- **Verify:** the output lists `clubs/[id]/announcements/v2/page.tsx` and `districts/[id]/greetings/page.tsx`, and does not list any `settings/` file. The printed string total replaces the 6,000 to 7,500 estimate in this plan.
- **RIZones check:** read-only tool.

### WS2-02 Install and wire `next-intl` without locale routing

- **Track:** A2 · **Owner:** F2 · **Depends on:** WS1-08 · **Estimate:** 1.5 days
- **Files:** `rotary-frontend/package.json`; new `src/i18n/request.ts`, `src/i18n/config.ts`, `src/i18n/IntlProvider.tsx`; `next.config.mjs`; `src/app/layout.tsx` (line 31, `<html lang>`); `src/components/ClientProviders.tsx`; new `messages/en/common.json`
- **Why no-routing mode:** the app has 494 routes and no `middleware.ts`. Locale-prefixed URLs would move every route.
- **Do:**
  1. `npm i next-intl`. Wrap the config: `export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig)`.
  2. `config.ts` exports `SUPPORTED = ["en","fr","de","it","ja","ko","pt","es"]`, `PSEUDO = "en-XA"`, and `resolveLocale(cookie, memberLanguage, acceptLanguage, brandDefault, brandLanguages)`: first match wins, and the result must be in the brand's language list (RIZones has `["en"]`, so RIZones is always English).
  3. `request.ts` (`getRequestConfig`) reads the `NEXT_LOCALE` cookie and `Accept-Language` header, resolves the locale and loads `messages/<locale>/common.json` for server-rendered pages.
  4. `IntlProvider.tsx` is a client component: it holds the locale in state, loads the namespace files for the current route group with dynamic `import()`, merges them, and renders `NextIntlClientProvider` with `timeZone` from the district context and `defaultTranslationValues={{ brandName }}` from `useBrand()`. Namespace-to-route mapping is one table in `config.ts` (Appendix J).
  5. Place it in `ClientProviders.tsx` inside `BrandProvider` and outside `AuthProvider`, so the login page is translated.
  6. `app/layout.tsx` sets `<html lang={locale}>`.
  7. Missing key behaviour: in development, render `⟦missing:key⟧` and log; in production, fall back to the English message.
- **Verify:** with the cookie set to `fr` and a French `common.json` containing one key, that key renders in French on the login page; with no cookie on RIZones the page is unchanged.
- **RIZones check:** journeys green; bundle size of the login page grows by less than 25 kB gzipped.

### WS2-03 Language picker and persistence

- **Track:** A2 · **Owner:** F2 · **Depends on:** WS2-02 · **Estimate:** 1 day
- **Files:** new `src/components/LanguagePicker.tsx`; `AppHeader.tsx`; `login/page.tsx`; API: `MembersController` (new `PUT api/members/me/language`), `AuthService` (token claims)
- **Do:**
  1. The picker lists `useBrand().locale.languages` by their own names ("Deutsch", "日本語"). It is hidden when the list has one entry, so RIZones shows nothing.
  2. On change: set the `NEXT_LOCALE` cookie (one year, `SameSite=Lax`), call the API to store `member_master_profile.PrimaryLanguage` as the ISO code when signed in, and reload messages without a full page reload.
  3. On login: if no cookie exists and the member has a stored language the instance supports, set the cookie from it.
  4. `PrimaryLanguage` today holds free text from Rotary.org ("English", "Japanese"). Add `LanguageCodes.FromRotaryName(string)` that maps those names to ISO codes; the sync keeps writing what Rotary.org sends, and reads go through the mapper.
- **Verify:** choose Japanese, sign out, sign in on another browser: the interface opens in Japanese.

### WS2-04 Pseudo-locale and scoped lint

- **Track:** A2 · **Owner:** F2 · **Depends on:** WS2-01, WS2-02 · **Estimate:** 1 day
- **Files:** new `tools/i18n-pseudo.mjs`; `.eslintrc.json`; `package.json`
- **Do:**
  1. `i18n-pseudo.mjs` generates `messages/en-XA/*.json` from English: wrap each string in `⟦ ⟧`, replace vowels with accented forms, pad by 40 percent, and leave ICU arguments and tags untouched.
  2. The pseudo-locale is selectable only when `NODE_ENV !== "production"` or the user is a SuperAdmin.
  3. Add the ESLint override of section 7.3 with `files` read from `i18n-scope.json` filtered to directories marked extracted in `i18n-progress.json` (a small checked-in file listing extracted directories).
- **Verify:** on an extracted page in the pseudo-locale every visible string is bracketed; any text without brackets is a missed string.

---

### Web extraction (30 days)

### WS2-05 Extraction codemod

- **Track:** A2 · **Owner:** F2 · **Depends on:** WS2-04 · **Estimate:** 2 days
- **Files:** new `tools/i18n-extract.mjs`
- **Do:** a `ts-morph` script run as `node tools/i18n-extract.mjs <directory> --namespace <ns>` that, for each file:
  1. adds `const t = useTranslations("<ns>")` (or `getTranslations` in a server component) when it rewrites anything;
  2. rewrites JSX text and the listed attributes to `t("<screen>.<slug>")`, where the slug is the first five words in camelCase;
  3. rewrites template literals in JSX to ICU messages with named arguments, using the identifier names as argument names;
  4. **flags but does not rewrite**: plural ternaries, module-level arrays, `label:` properties, `confirm`/`alert`, month arrays. These get a `// i18n-todo(<shape>)` comment for the engineer;
  5. appends new keys to `messages/en/<ns>.json`, keeping the file sorted;
  6. never touches a string that is compared (`===`), used as an object key, passed to `api.*`, or inside `className`.
- **Verify:** run on `src/app/login`; the diff contains only text replacements; the page renders identically in English.

### Extraction procedure (applies to WS2-06 to WS2-12)

For each directory:

1. **Announce a lock** in the team channel: "extracting `<directory>`, no other changes until `<date>`". Locks last at most two working days.
2. Run the codemod. Review **every** hunk by hand.
3. Resolve every `i18n-todo` by the rules of section 7.2. Replace server-message fallbacks with `getErrorMessage`. Replace locale and currency literals with `useFormat()` (WS3-03 runs in the same pass).
4. Open every page of the directory in the pseudo-locale at 1280 and 390 pixels wide. Fix unbracketed text and overflow.
5. Run the journeys. Add the directory to `i18n-progress.json` so the lint rule now protects it.
6. Pull request: one directory, screenshots in English and pseudo-locale. Reviewer opens the pages too.
7. After merge, run `npm run i18n:export` (WS2-29) so translators receive the new keys.

### WS2-06 Extraction 1: common, authentication, shells

- **Track:** A2 · **Owner:** F2 · **Estimate:** 3 days
- **Scope:** `app/login`, `forgot-password`, `reset-password`, `sso`; `components/ui` (23 files); root `components/*.tsx` reachable by scoped pages (`AppHeader`, `DashboardSwitcher`, `RoleBasedHome`, `AlertModal`, `DeleteDialog`, `Pagination`, tables, pickers); `components/v2` shells (7); `lib/constants.ts` label arrays
- **Namespace:** `common`, `auth`

### WS2-07 Extraction 2: club-admin dashboard

- **Track:** A2 · **Owner:** F2 and BW1 · **Estimate:** 4 days
- **Scope:** `app/club-admin-dashboard/**` (49 files), `components/dashboard/**` (39 files), `components/assistant`
- **Namespace:** `clubDashboard`

### WS2-08 Extraction 3: club modules

- **Track:** A2 for the modules the pilot districts enable (3 days); B for the rest (4 days) · **Owner:** all four, by module · **Estimate:** 7 days
- **Scope:** reachable pages under `app/clubs/[id]/**` (177 files). Order: members, board-of-directors, announcements, upcoming-events, newsletters, documents, attendance, the seven project avenues (club-service, community-service, international-service, vocational-service, new-generation-service, public-image-initiative, projects), club-monthly-report, club-report, membership-dues, event-payment-links, trf, citation, past-presidents, pph-camps, ocv-gov, rotary-network, sub-groups, greetings, mass-emails, weblinks, website-data (24 files)
- **Namespaces:** `members`, `content`, `projects`, `cmr`, `dues`, `foundation`, `awards`, `website`
- **Note:** the seven project avenues share form structure. Extract `club-service` first, move its common labels to `projects.form.*`, then apply to the other six.

### WS2-09 Extraction 4: payment and public flows

- **Track:** A2 · **Owner:** BW2 · **Estimate:** 2 days
- **Scope:** `app/pay/**` (8), `app/report/**` (3), `dues-approval`, `club-dues-approval`, `app/public/**`, `components/PayPageShell.tsx`, `components/wallet`, `components/club-dues`
- **Namespace:** `pay`
- **Note:** these pages are opened by members who may never have signed in. Locale comes from the `lang` query parameter the link carries (the sender knows the recipient's language), then the browser language.

### WS2-10 Extraction 5: district-admin dashboard and district modules

- **Track:** B · **Owner:** BW1 and F1 · **Estimate:** 6 days
- **Scope:** `app/district-admin-dashboard/**` (51 files), reachable pages under `app/districts/[id]/**` (87 files)
- **Namespace:** `districtDashboard`, plus the module namespaces above

### WS2-11 Extraction 6: AG, club moderator, RI Director, zones, goal oversight

- **Track:** B · **Owner:** F1 · **Estimate:** 3 days
- **Scope:** `ag-dashboard` (12), `ag-reports`, `club-moderator` (4), `ri-director` (27), `zones` (5), `zonal-dashboard`, `goal-overviews` (2), `members` (4)
- **Namespaces:** `ag`, `riDirector`, `goals`

### WS2-12 Extraction 7: public site and policy pages

- **Track:** B · **Owner:** F2 · **Estimate:** 3 days
- **Scope:** `app/(site)/**` (19), `privacy-policy`, `terms-and-conditions`, `refunds-and-cancellations`, `components/site` (15), `components/pages` (34), `components/public` (4), `components/motion`
- **Namespace:** `site`
- **Note:** these are server components; use `getTranslations()`. The three policy pages are legal text: ROW's versions come from counsel, per language, as MDX files under `content/legal/<lang>/`, selected by `useBrand().legal`.

---

### Server messages (10 days)

### WS2-13 `ApiErrors`, `ApiException` and the middleware mapping

- **Track:** A2 · **Owner:** BW1 · **Depends on:** WS0-03 · **Estimate:** 2 days
- **Files:** new `RotaryApi/Errors/ApiError.cs`, `ApiErrors.cs`, `ApiException.cs`; `Program.cs` (exception handler at lines 699 to 720)
- **Do:**

```csharp
public sealed record ApiError(string Code, string Message, object? Args = null);

public static class ApiErrors
{
    public static ApiError ClubInactive()     => new("CLUB_INACTIVE",     "This club, its district, or its zone is inactive. Reactivate it first to access this data.");
    public static ApiError DistrictInactive() => new("DISTRICT_INACTIVE", "This district or its zone is inactive. Reactivate it first to access this data.");
    public static ApiError AccessDenied()     => new("ACCESS_DENIED",     "Access denied.");
    public static ApiError NoFileUploaded()   => new("NO_FILE_UPLOADED",  "No file uploaded");
    public static ApiError FileTooLarge(int maxMb) => new("FILE_TOO_LARGE", $"File size must be less than {maxMb}MB", new { maxMb });
    public static ApiError Required(string field)  => new("FIELD_REQUIRED", $"{field} is required.", new { field });
    public static ApiError NotFound(string entity) => new("NOT_FOUND", $"{entity} not found.", new { entity });
    // one method per row of Appendix D
}

public sealed class ApiException : Exception
{
    public ApiError Error { get; }
    public int Status { get; }
    public ApiException(ApiError error, int status = 400) : base(error.Message) { Error = error; Status = status; }
}
```

  The JSON shape is `{ code, message, args }` with camelCase names; `args` is omitted when null. The exception handler maps `ApiException` to that shape with its status. Every other exception keeps today's behaviour exactly.
- **Rule:** the `Message` text of each method is copied verbatim from the literal it replaces, including its punctuation, so RIZones responses are byte-identical apart from the added `code`.
- **Verify:** unit test per method asserting the message equals the original literal.

### WS2-14 Replace the most reused messages

- **Track:** A2 for the ten most reused messages (1.5 days); B for the rest (1.5 days) · **Owner:** BW1 · **Depends on:** WS2-13 · **Estimate:** 3 days
- **Files:** every controller containing the messages of Appendix I, section G1 (the top forty account for about 700 occurrences)
- **Do:** mechanical replacement, one message per pull request: `new { message = "Access denied." }` becomes `ApiErrors.AccessDenied()`. The three inactive messages are produced centrally by `KillSwitchHelper`; change them there first (308 occurrences collapse into a handful of edits where the helper is used, and literal copies elsewhere are replaced by calls to it).
- **Verify:** the smoke suite's kill-switch check now asserts `code == "CLUB_INACTIVE"`.
- **RIZones check:** response bodies differ only by the new `code` property. Confirm the mobile app ignores unknown properties (it does if it reads `message` by name; F1 confirms in the app's response models).

### WS2-15 Client error helper and request language

- **Track:** A2 · **Owner:** F2 (client), BW1 (server) · **Depends on:** WS2-13, WS2-02 · **Estimate:** 2 days
- **Files:** new `rotary-frontend/src/lib/errors.ts`; `src/services/api.ts` (request interceptor at lines 90 to 100); `messages/en/errors.json`; API `Program.cs`; `AuthService` (JWT creation)
- **Do:**

```ts
export function getErrorMessage(e: unknown, t: Translator, fallbackKey = "errors.generic"): string {
  const data = (e as any)?.response?.data;
  if (data?.code && t.has(`errors.${data.code}`)) return t(`errors.${data.code}`, data.args ?? {});
  if (typeof data?.message === "string" && data.message) return data.message;
  return t(fallbackKey);
}
```

  1. The axios request interceptor adds `Accept-Language: <locale>` from the cookie.
  2. The API calls `app.UseRequestLocalization` with the brand's language list and default; providers in order: `Accept-Language` header, then the `lang` claim.
  3. New tokens carry a `lang` claim from the member's stored language code.
  4. A helper `IRequestLanguage.Current` returns the two-letter code for services that render text (emails, documents).
  5. Background jobs have no request: they use the recipient member's stored language, then the district's default language (`district_master.DefaultLanguage`, added in Appendix B.4), then the brand default.
- **Verify:** with the cookie `fr`, a request to an inactive club shows the French sentence; with a code that has no translation it shows the server's English message.

### WS2-16 Codes for the remaining reachable endpoints

- **Track:** B · **Owner:** BW1, BW2 · **Depends on:** WS2-01 (`apiPaths`), WS2-14 · **Estimate:** 3 days
- **Do:** for each controller behind a path in `apiPaths`, replace every remaining `message = "..."` returned on an error path with an `ApiErrors` method, adding methods to the catalogue. Success messages that the client displays ("Order saved.", "Deleted.") get codes too (`ORDER_SAVED`), because 871 call sites show them. Interpolated messages become `args`.
- **Verify:** a script `tools/i18n-server-audit.mjs` lists error literals left in reachable controllers; the count is zero or each remaining one is listed with a reason.

---

### Emails (15 days)

### WS2-17 Header, footer and support constants from the brand

- **Track:** A1 · **Owner:** BW2 · **Depends on:** WS1-01 · **Estimate:** 1 day
- **Files:** `RotaryApi/Services/EmailService.cs` (`EMAIL_HEADER`, `EMAIL_FOOTER`, help-line numbers at lines 488, 604, 666); the 22 files that reference them (Appendix I, section G19); the mass-email sender constant; fixed CC addresses
- **Do:** change `public const string EMAIL_HEADER` to `public static string EMAIL_HEADER { get; private set; }` initialised at startup from `Brand.Current.Look.EmailHeaderHtml`, whose default is the current constant text. Same for the footer. All references compile unchanged. Help-line numbers, CC addresses and the sender read `Brand.Current.Support`.
- **Verify:** the HTML of a password-reset email on RIZones staging is byte-identical before and after; on ROW staging it carries the ROW logo and contacts.

### WS2-18 Template engine

- **Track:** A2 · **Owner:** BW2 · **Depends on:** WS2-17 · **Estimate:** 2 days
- **Files:** `RotaryApi.csproj` (`Scriban` package, templates as embedded resources); new `RotaryApi/Services/Email/IEmailTemplates.cs`, `EmailTemplates.cs`; new folder `RotaryApi/Templates/Email/`
- **Do:**

```csharp
public interface IEmailTemplates
{
    RenderedEmail Render(string key, string language, object model);   // falls back to "en"
    IReadOnlyList<string> MissingFor(string language);                   // keys with no file in that language
}
public sealed record RenderedEmail(string Subject, string HtmlBody);
```

  File layout: `Templates/Email/<key>.<lang>.html`. The first line is `subject: ...`; the rest is the body. Shared layout `_layout.<lang>.html` wraps the body with the brand header and footer. Templates receive `model`, `brand` (name, support contacts, URLs) and `fmt` (money and date functions bound to the recipient's language and the district's currency and zone). HTML-encode every model value by default; mark raw HTML explicitly.
- **Verify:** unit tests: render every English template with a fixture model and compare with a stored snapshot; rendering with an unknown language returns the English result.

### WS2-19 Templates wave 1: sign-in and account

- **Track:** A2 · **Owner:** BW2 · **Depends on:** WS2-18 · **Estimate:** 2 days
- **Keys:** `auth.otp`, `auth.passwordReset`, `auth.passwordChanged`, `auth.welcomeCredentials`, `auth.roleAssigned` (from `EmailService`, `MobileAuthService`, `RoleService`)
- **Do:** for each builder method: copy its HTML into `<key>.en.html`, replace interpolations with model fields, call `IEmailTemplates.Render`, delete the builder. The snapshot test of WS2-18 proves the English output is unchanged.

### WS2-20 Templates wave 2: money

- **Track:** A2 for dues receipt and reminder (1.5 days); B for the rest (2.5 days) · **Owner:** BW2 · **Depends on:** WS2-19, WS3-05 · **Estimate:** 4 days
- **Keys:** `dues.receipt`, `dues.reminder`, `dues.approvalRequest`, `dues.approved`, `clubDues.reminder`, `clubDues.receipt`, `event.paymentLink`, `event.receipt`, `event.reminder`, `wallet.topupReceipt`, `website.invoice`, `kyc.*` (from `MembershipDuesService` 5, `EventPaymentLinkService` 4, `ClubDuesService`, `CashfreeKycService` 2, `RazorpayRouteAccountsController`, `CreditManagementService`, `CreditExpiryBackgroundService`)
- **Rule:** amounts go through `fmt.money`. Where the campaign supplies its own subject and body (`membership_dues.EmailSubject`, `EmailBody` and the reminder pair; `club_dues.*`; `event_payment_links.*`), that text is inserted as written and only the surrounding frame is a template.

### WS2-21 Templates wave 3: everything else

- **Track:** B · **Owner:** BW2, BW1 · **Depends on:** WS2-19 · **Estimate:** 6 days
- **Keys and sources:** `cmr.submitted`, `cmr.reminder` (`ClubMonthlyReportService`, `CmrSubmissionMailer`); `content.announcement`, `content.event`, `content.newsletter` (`EmailScheduledSendBackgroundService`); `project.approvalRequest`, `project.approved`, `project.rejected` (`ProjectApprovalService` 2); `website.activated`, `website.reminder`, `website.training` (`ClubWebsitesController`, `ClubWebsiteReminderBackgroundService`, training appointments); `directory.*` (`DirectoryDataCollectionController`, `PublicDirectoryController` 2); `awards.*` (`DistrictAwardsConfigController`); `district.*` (`DistrictModulesController`); `report.dailyStats`, `report.districtPerformance` (2), `report.dataQuality` (staff reports: English only, template for branding only); `sync.*` (`ClubSyncService`); `leadership.*` (`ClubLeadershipEmailBackgroundService`); `greeting.birthday`, `greeting.anniversary` frame in `GreetingsWorker` (the message itself is the club's or district's stored text)
- **Verify:** `grep -rn "EMAIL_HEADER" RotaryApi --include=*.cs` returns only `EmailService.cs` and the layout loader; `IEmailTemplates.MissingFor(lang)` is empty for every launch language.

---

### Documents and fonts (7.5 days)

### WS2-22 Ship fonts, register them, stop hiding missing glyphs

- **Track:** B (A2 if the first translated pilot language is Japanese or Korean) · **Owner:** F2 · **Depends on:** none · **Estimate:** 2.5 days
- **Files:** new `RotaryApi/Fonts/` (Noto Sans Regular, Bold, Italic; Noto Sans JP Regular, Bold; Noto Sans KR Regular, Bold; all under the SIL Open Font License, licence file included); `RotaryApi.csproj` (copy to output); new `RotaryApi/Services/Documents/DocFonts.cs`; `Program.cs`; the line that sets `QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false`
- **Do:**
  1. At startup register every file with `QuestPDF.Drawing.FontManager.RegisterFont(stream)`.
  2. `DocFonts.For(lang)` returns the family list: `ja` gives `["Noto Sans JP", "Noto Sans"]`, `ko` gives `["Noto Sans KR", "Noto Sans"]`, otherwise the builder's current family first and then `"Noto Sans"` as fallback. For English on RIZones the first family is what the builder names today, so RIZones output is unchanged.
  3. Builders apply it with `.FontFamily(DocFonts.For(lang))` on the page default text style.
  4. Set `CheckIfAllTextGlyphsAreAvailable = true` when `Brand.Feature("documents.strictGlyphs")` is on. Default off (today's behaviour) on RIZones until its documents have run a week with the fallback in place, then on everywhere.
  5. Word builders set `RunFonts { Ascii, HighAnsi, EastAsia }` from the same helper.
  6. Test: render `DuesReceiptPdfBuilder` and `ClubMonthlyReportPdfBuilder` with a fixture containing `日本語 한국어 äöüß éèç ñ ãõ ₹ € ¥`, extract the text with a PDF reader library in the test project, assert every character survives.
- **Verify:** the test passes on a clean machine with no extra fonts installed (run it in the pipeline).

### WS2-23 Document labels from resources

- **Track:** B · **Owner:** F2 · **Depends on:** WS2-22, WS2-15 · **Estimate:** 3.5 days
- **Files:** `ClubMonthlyReportPdfBuilder.cs`, `ClubMonthlyReportWordBuilder.cs`, `ClubReportWordBuilder.cs`, `DuesReceiptPdfBuilder.cs`, `OcvReportExcelBuilder.cs`, `OcvReportWordBuilder.cs`, `ProjectShareCardBuilder.cs`; the ClosedXML exports in report controllers and `GoalSettingService`; new `RotaryApi/Resources/Documents.<lang>.json`; new `IDocLabels`
- **Do:** each builder takes `(lang, IDocLabels L, IMoneyFormatter money, IDateFormatter dates)`. Replace each label literal with `L["cmr.section.membership"]`. Amounts and dates go through the formatters (section 8). Callers pass the request language, or the recipient's language for documents attached to emails.
- **Verify:** English output is pixel-identical on RIZones (compare the extracted text before and after); the Japanese receipt shows Japanese labels and `￥12,000`.

### WS2-24 Browser exports

- **Track:** B · **Owner:** F2 · **Depends on:** WS2-23 · **Estimate:** 1.5 days
- **Files:** `rotary-frontend/src/utils/reportDownload.ts` (`downloadPDF` and the rupee sign at line 346), `utils/csvExport.ts`, callers of `downloadPDF`
- **Do:** retire the jsPDF path: the CMR download button calls the server PDF endpoint (`ClubMonthlyReportPdfBuilder` already produces it). Browser-side Excel and Word exports stay and take header text through `t()` and values through `useFormat()`.
- **Verify:** no import of `jspdf` remains in scoped files; the downloaded CMR PDF is the server's.

---

### Database labels, club sites and build checks (12 days)

### WS2-25 `master_translation` and `IMasterLabels`

- **Track:** B · **Owner:** BW1 · **Depends on:** WS5-01 · **Estimate:** 4 days
- **Files:** `SQL/master_translation.sql`, `DatabaseInitializer.cs`; new `RotaryApi/Services/MasterLabels.cs`; the DTO mappers named below; new seed file `RotaryApi/Seeds/master_translation.json`
- **Do:**
  1. Create the table (Appendix B.3).
  2. `IMasterLabels.Label(entity, key, field, fallback)` loads the whole table for one language on first use and caches it for ten minutes. English, or a missing row, returns `fallback` (the base column).
  3. Apply it where each entity is mapped to a DTO:

| Entity | Table and column | Stable key | Mapper |
|---|---|---|---|
| `module` | `module_master.ModuleName`, `module_categories` name | `ModuleKey` | `ModuleService`, dashboard services |
| `goal_field` | `goal_fields.FieldLabel`, `GroupName` | `FieldKey` | `GoalSettingService` |
| `goal_category` | `goal_categories.Name` | category key | `GoalSettingService` |
| `area_of_focus` | `area_of_focus_master.name` | `code` (WS5-01) | project services, lookups |
| `category` | `category_master.name` | `code` | same |
| `sub_category` | `sub_category_master.name` | `code` | same |
| `designation` | `designation_master.designation_name` | the Rotary.org role name | `BoardDirectorService`, `RoleService` |
| `trf_fund` | `trf_fund_master.FundName` | fund code | `FoundationGoalsService` |
| `funding` | `funding_master` name | code | project lookups |
| `ocv_document_type` | `ocv_document_type` name | code | `OcvGovService` |
| `award_question` | `zonal_awards_question`, `_option`, `district_citation_auto_question`, `_sub` | question code | awards services |
| `website_menu_default` | default menu names | `slug` (WS2-27) | `ClubMenuService` |

  4. Translations are delivered as the seed file and loaded by the seeder (section 10), so both instances carry the same rows.
  5. The assistant's views stay English (base columns). That is intended: the model translates when it answers.
- **Verify:** with `Accept-Language: ja` the dashboard's module list returns Japanese names; with `en` the response is byte-identical to before.
- **RIZones check:** the table is empty until translations are seeded; an empty table returns base text.

### WS2-26 Build checks for message files

- **Track:** A2 for key parity and ICU checks (1 day); B for email and template checks (1 day) · **Owner:** F2 · **Depends on:** WS2-04 · **Estimate:** 2 days
- **Files:** new `tools/i18n-check.mjs`; pipeline
- **Do:** fail the build when, for any language the brand files list: a key exists in English and not in the language (allowed only with `--allow-missing <lang>` before that language's review date); a key exists in the language and not in English; an ICU message has different argument names or plural structure from English; a message contains raw HTML; an email template exists in English and not in the language; a `whatsapp_templates` seed row lacks the language. Also fail when a scoped file uses a key no message file defines.
- **Verify:** deleting one French key fails the pipeline with the key's name.

### WS2-27 Club-website menu slug

- **Track:** B · **Owner:** BW2 · **Depends on:** none · **Estimate:** 3.5 days
- **Files:** `SQL/club_website_menu_slug.sql`, `DatabaseInitializer.cs`; `ClubMenuService.cs`; the public data controllers; `club-website/src/lib/nav.ts` (lines 33 to 48, `defaultSlugFor`)
- **Why:** the public site decides a default menu's route from the **English prefix of its name** ("home", "about", "directory", "director", "calendar", "project", "meeting", "past"). A translated menu name would lose its route.
- **Do:**
  1. `ALTER TABLE club_website_menu ADD COLUMN slug VARCHAR(60) NULL`.
  2. Backfill for rows with `is_default = 1` using exactly the rules of `defaultSlugFor`, in the same order, in SQL.
  3. New default menus are created with their slug.
  4. The public API returns `slug`. `nav.ts` uses `menu.slug` when present and falls back to `defaultSlugFor(menuName)` when it is null, so an un-migrated row behaves as today.
  5. Default menu names are translated through `IMasterLabels` with entity `website_menu_default` and key `slug`. Menus a club renamed keep the club's text.
- **Verify:** for one hundred sampled club sites, every menu link resolves to the same path before and after.

### WS2-28 Club-website application

- **Track:** B · **Owner:** F2 · **Depends on:** WS2-02, WS2-27 · **Estimate:** 2.5 days
- **Files:** `club-website/` (44 components, five themes); `club-website/messages/<lang>/site.json`
- **Do:** install `next-intl` in no-routing mode; the locale is the club's site language (new column `club_master.WebsiteLanguage`, default null meaning the district's default language), with a visitor override cookie. Extract the 155 strings. Dates and numbers go through a copy of `format.ts`. Add the Noto JP and KR fonts to the layout. The five themes keep their styling.
- **Verify:** a club site set to Spanish renders its fixed labels in Spanish; its own content is as the club wrote it.

---

### Pipeline (3 days)

### WS2-29 Translation exchange

- **Track:** A2 for web message files (1 day); B for the other sources (0.5 day) · **Owner:** F2 · **Depends on:** WS2-26 · **Estimate:** 1.5 days
- **Files:** new `tools/i18n-export.mjs`, `tools/i18n-import.mjs`; `docs/i18n/glossary.csv`
- **Do:**
  1. Export: for each language, write an XLIFF 1.2 file of keys that are new or whose English changed since the last import (tracked by a hash per key in `messages/.state.json`), with the English source, the screen's route as a note, and the maximum length where the UI has one.
  2. Pre-fill with machine translation marked `state="needs-review-translation"`.
  3. Import: read the reviewed XLIFF, validate ICU syntax and arguments, write the language files, update the state.
  4. The glossary lists Rotary terms with Rotary International's own published translation in each language (Rotarian, District Governor, Assistant Governor, The Rotary Foundation, Paul Harris Fellow, Rotaract, Interact, club, district, zone). Attach it to every job; the import rejects a target that translates a glossary term differently.
  5. Sources covered: web message files, `RotaryApi/Resources/Documents.*.json`, email templates (as one unit per paragraph), `master_translation` seed, WhatsApp template bodies.
- **Review:** every language is reviewed by a native speaker who knows Rotary (section 21, decision X8 and question Q8). A language whose review is incomplete is not listed in the ROW brand's `Languages` and therefore cannot be selected.

### WS2-30 Language crawl

- **Track:** B · **Owner:** F2 · **Depends on:** WS0-05, WS2-26 · **Estimate:** 1.5 days
- **Files:** `rotary-frontend/e2e/crawl.spec.ts`
- **Do:** for each route in `i18n-scope.json`, each language and two widths (1280, 390): open the page as the smoke account with fixture ids; fail on (a) the missing-key marker, (b) any element whose `scrollWidth` exceeds its `clientWidth` by more than two pixels among buttons, table headers, labels and cards, (c) text rendered in the fallback font for `ja` and `ko` (compare `document.fonts.check`), (d) a console error. Save a screenshot per page for the reviewer. Runs nightly; results go to the gate report.
- **Verify:** Gate B requires this green for all eight languages.

---

## 8. Workstream WS3: numbers, money and dates on screen

**Owner: F1.** 3 engineer-weeks, mostly done in the same passes as WS2 extraction because the same files are open.

### 8.1 Today

- Three parallel helper files: `src/lib/currency.ts`, `src/lib/dateUtils.ts`, `src/components/dashboard/formatters.ts`. Most code bypasses all three.
- `'en-IN'` appears 311 times in 146 files; `₹` 285 times in 69 files; hand-written `padStart` date formatting 163 times. The files with the most are in Appendix I, section G13.
- "Today" is `new Date().toISOString().slice(0, 10)` in 78 places. That is the UTC date: before 05:30 India time it is yesterday. **This is a live RIZones defect.**
- The current Rotary year is computed from the browser clock in 96 places across 25 files.
- API: `"INR"` literal 54 times in 20 files (Appendix I, section G12); `₹` 41 times in 20 files; conversion to paise by `* 100m` on four lines (`ClubDuesService.cs:1758`, `WalletService.cs:66` and `:70`, `WebsiteBillingService.cs:61`). `CurrencyHelper.Normalize` accepts only INR, NPR, LKR and USD and turns anything else into INR.
- `district_master.DefaultCurrency` exists (`VARCHAR(5)`), as do `Currency` on projects and `club_foundation_collection_goals.currency`.

### 8.2 Design

One formatting module, `src/lib/format.ts`. Nothing else in the app may call `toLocaleString`, `toLocaleDateString` or `Intl.*` directly.

```ts
export interface Formatters {
  number(n: number, opts?: Intl.NumberFormatOptions): string;
  percent(fraction: number, digits?: number): string;
  money(amount: number, currency?: string): string;        // Intl.NumberFormat(locale, { style: "currency", currency })
  moneyShort(amount: number, currency?: string): string;   // compact; lakh and crore only when numberLocale is en-IN
  date(d: string | Date, style?: "short" | "medium" | "long"): string;
  dateTime(d: string | Date): string;
  time(d: string | Date): string;
  monthName(month1to12: number, style?: "short" | "long"): string;
  weekdayName(day0to6: number, style?: "short" | "long"): string;
  relative(d: string | Date): string;                      // "3 days ago"
}
export function useFormat(): Formatters;                    // locale from next-intl; currency and zone from DistrictContext, then brand
export function createFormat(locale: string, currency: string, timeZone: string): Formatters;   // for non-React code
export function todayIn(timeZone: string): string;          // "YYYY-MM-DD" in that zone
export function rotaryYearOf(date: string | Date): string;  // "2026-27": July to June
export function parseDateOnly(s: string): Date;             // "YYYY-MM-DD" to a local-midnight Date, never shifted by zone
```

Rules inside the module:

- The **number locale** is `brand.locale.numberLocale` when the interface language is English (so RIZones keeps `en-IN` grouping: 1,00,000) and the interface language otherwise.
- `money` uses the currency's own exponent: yen and won have no decimals, and `Intl` handles that.
- A date-only string (`YYYY-MM-DD`, ten characters) is formatted as a calendar date with no zone conversion. A timestamp with an offset is converted to the viewer's district zone.
- `moneyShort` uses lakh and crore suffixes only when the number locale is `en-IN`; otherwise `Intl` compact notation (K, M).

### WS3-01 `format.ts`, with the old helpers delegating to it

- **Track:** A1 · **Depends on:** WS1-08 for the brand's number locale (until WS2-02 exists the interface language is the brand default, read through one small `useLocale()` wrapper that WS2-02 later points at `next-intl`) · **Estimate:** 3 days
- **Files:** new `src/lib/format.ts`, `src/lib/format.test.ts`; `src/lib/currency.ts`, `src/lib/dateUtils.ts`, `src/components/dashboard/formatters.ts` (bodies replaced by calls to `createFormat("en-IN", "INR", "Asia/Kolkata")` until their callers migrate); `package.json` (add `vitest`)
- **Do:** implement the module. **Before** changing the old helpers, write the snapshot test: forty representative inputs (0, 999, 1000, 100000, 12345678.5, negative amounts, null, each date style, month boundaries, 31 December, 29 February, short money at lakh and crore thresholds) through each existing helper function, outputs stored. Then switch the helpers to delegate and assert the outputs are identical.
- **Verify:** the snapshot test passes with zero differences.
- **RIZones check:** the snapshot test is the check.

### WS3-02 District context: today, zone, currency, Rotary year

- **Track:** A1 · **Depends on:** WS4-01 · **Estimate:** 2 days
- **Files:** `RotaryApi/Services/MobileAuthService.cs` (`GetMyContextAsync`), its DTO; `rotary-frontend/src/contexts/AuthContext.tsx`; new `src/contexts/DistrictContext.tsx`
- **Do:**
  1. `GET api/auth/my-context` (in `MobileAuthController.cs:82`) gains, per club and district entry it already returns: `timeZone` (from WS4-01's resolver), `currency` (`district_master.DefaultCurrency`, else brand default), `today` (`YYYY-MM-DD` in that zone), `currentRotaryYear` (label of the current year). Additive fields.
  2. `DistrictContext` exposes the values for the club or district the user is currently viewing (from the route's `[id]`, else the user's first scope). `useFormat()` reads it.
  3. `useToday()` returns the context's `today`, refreshed when the tab regains focus.
- **Verify:** at 02:00 India time on RIZones staging, a new-announcement form defaults its date to the India date, not the previous day.
- **RIZones check:** the mobile app ignores unknown fields (F1 confirms).

### WS3-03 Codemod and lint, applied with extraction

- **Track:** A1 for dues, payment and dashboard money (2.5 days); A2 with the extraction directories (1 day); B for the rest (1.5 days) · **Depends on:** WS3-01 · **Estimate:** 5 days
- **Files:** new `tools/format-codemod.mjs`; every scoped file; `.eslintrc.json`
- **Do:** the codemod rewrites three patterns and flags the rest:

| Pattern | Becomes |
|---|---|
| `x.toLocaleString('en-IN')`, `x.toLocaleString("en-IN", {...})` | `fmt.number(x)` or `fmt.number(x, {...})` |
| `` `₹${expr}` ``, `"₹" + expr`, `Rs. ${expr}` | `fmt.money(expr)` |
| `new Date(d).toLocaleDateString('en-IN', {...})` | `fmt.date(d, style)` with the style inferred from the options |
| `String(n).padStart(2, "0")` date assembly | flagged for the engineer |
| `"INR"` passed to a formatter | removed (the context supplies it) |

  Each extraction pull request (WS2-06 to WS2-12) includes this pass for its directory. The lint rule of section 7.3 then forbids the literals there.
- **Verify:** `grep -rn "en-IN\|₹" src --include=*.tsx` inside extracted directories returns nothing outside `lib/format.ts`.

### WS3-04 "Today" and Rotary-year call sites

- **Track:** A1 · **Depends on:** WS3-02 · **Estimate:** 2 days
- **Do:** replace the 78 `toISOString().slice(0, 10)` uses with `useToday()` (or `todayIn(zone)` outside React) and the 96 browser-clock Rotary-year computations with `currentRotaryYear` from the context or `rotaryYearOf(date)`. This one is **not** limited to scoped files: it fixes a RIZones defect, so apply it everywhere including `settings/`.
- **Verify:** `grep -rn "toISOString().slice(0, 10)\|toISOString().split" src` returns only places that are truly formatting a UTC timestamp for an API parameter, each with a comment.

### WS3-05 Server-side money

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 3 days
- **Files:** new `RotaryApi/Common/Money.cs`, `RotaryApi/Services/MoneyFormatter.cs`; `CurrencyHelper.cs`; the four paise lines; order-creation sites that pass `"INR"`
- **Do:**

```csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    private static readonly Dictionary<string, int> Exponent = new(StringComparer.OrdinalIgnoreCase)
    {
        ["JPY"] = 0, ["KRW"] = 0, ["CLP"] = 0, ["VND"] = 0, ["UGX"] = 0, ["XAF"] = 0, ["XOF"] = 0,
        ["BHD"] = 3, ["KWD"] = 3, ["JOD"] = 3, ["OMR"] = 3, ["TND"] = 3
    };   // anything not listed is 2
    public int MinorUnitExponent => Exponent.TryGetValue(Currency, out var e) ? e : 2;
    public long ToMinorUnits() => (long)Math.Round(Amount * (decimal)Math.Pow(10, MinorUnitExponent), MidpointRounding.AwayFromZero);
    public static Money FromMinorUnits(long minor, string currency) { var m = new Money(0, currency); return new Money(minor / (decimal)Math.Pow(10, m.MinorUnitExponent), currency); }
}

public interface IMoneyFormatter { string Format(Money money, string language); }   // CultureInfo-based; "en" plus INR uses en-IN
```

  1. Replace the four paise lines with `new Money(x, currency).ToMinorUnits()`.
  2. `CurrencyHelper.Normalize(code)`: if the brand lists currencies, accept any of them (upper-cased, validated against ISO 4217 via `RegionInfo`/a static list); otherwise today's behaviour.
  3. Where an order is created with `"INR"`, take the currency from the campaign row if it has one, else `district_master.DefaultCurrency`, else `Brand.Current.Locale.DefaultCurrency`. Dues campaigns gain a `Currency` column (Appendix B.4), null meaning the district default.
  4. The 41 server-side `₹` literals are removed as their email or document is templated (WS2-20, WS2-23); until then they are untouched.
- **Verify:** unit tests: `new Money(12000, "JPY").ToMinorUnits() == 12000`; `new Money(12.5m, "USD").ToMinorUnits() == 1250`; `new Money(1500.50m, "INR").ToMinorUnits() == 150050`.
- **RIZones check:** characterisation tests of WS6-04 and WS6-05 show identical gateway requests.

---

## 9. Workstream WS4: time

**Owner: F1.** 3.5 engineer-weeks.

### 9.1 Today

- The server clock is India Standard Time. MySQL's `time_zone` is `SYSTEM`.
- C# reads the clock through `DateTime.Now` 488 times, `DateTime.Today` 51, `DateTime.UtcNow` 99. SQL uses `NOW()` 1,187 times, `CURDATE()` 87 (Appendix I, section G20), `CURRENT_TIMESTAMP` 248, `UTC_TIMESTAMP()` 71.
- MySqlConnector returns `DateTimeKind.Unspecified`, so the API sends `"2026-09-30T14:00:00"` with no offset and the browser reads it as its own local time.
- Three background services each carry a private `ResolveIst()` (`DailyStatsReportBackgroundService.cs:66`, `DistrictPerformanceReportBackgroundService.cs:78`, `AssistantDataQualityBackgroundService.cs:66`); `ClubCacheRefreshService.cs:14` and `TrainingAppointmentService.cs:45` resolve the zone themselves.
- The greetings worker runs once a day at 08:00 server time and decides "today" with `CURDATE()` (six uses in `GreetingsJob.cs`).
- Eighteen frontend files use `datetime-local` inputs.

### 9.2 The decision

On this server `.NET` takes its zone from Windows, which RIZones needs to be India time; there is no per-process override. A ROW database set to UTC would receive UTC from `NOW()` and India time from `DateTime.Now` in the same row. Therefore:

> **Both instances store instance time (India time while the server is shared). ROW is correct for other zones because three boundaries convert: output, input and scheduling.**

When ROW moves to its own host, `Brand:Locale:InstanceTimeZone` becomes `UTC` and nothing else changes.

| Boundary | Problem | Mechanism | Task |
|---|---|---|---|
| Output | Timestamps have no offset | JSON converter writes the instance offset | WS4-06 |
| Input | "Publish at 09:00" typed in New York is read as 09:00 India time | Form helper sends the district's offset; binder converts to instance time | WS4-07 |
| Scheduling | Jobs fire at an India hour; "today" is the server's date | Per-district schedule; `@Today` parameter | WS4-03 to WS4-05, WS4-08 |

### WS4-01 District time zone and resolver

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 1.5 days
- **Files:** `SQL/district_timezone.sql`, `DatabaseInitializer.cs`; new `RotaryApi/Services/Time/IZoneResolver.cs`, `ZoneResolver.cs`; new `tools/fill-district-timezones.sql`
- **Do:**
  1. `ALTER TABLE district_master ADD COLUMN TimeZoneId VARCHAR(64) NULL` (IANA name such as `America/New_York`).
  2. `IZoneResolver.ForClubAsync(clubId)` returns `club_master.Timezone` if it is a valid IANA or Windows id, else the district's `TimeZoneId`, else `Brand.Current.Locale.DefaultTimeZone`. `ForDistrictAsync(districtId)` likewise. Results are cached for ten minutes. Use `TimeZoneInfo.FindSystemTimeZoneById`, which accepts IANA names on Windows in .NET 8 and later.
  3. Fill script: set each district's zone from its country's single zone; for countries with several zones (United States, Canada, Brazil, Mexico, Australia, Russia, Indonesia, Democratic Republic of the Congo, Kazakhstan, Mongolia) leave null and list them for a person to set from the district's headquarters city. RIZones districts stay null and resolve to the brand default, `Asia/Kolkata`.
  4. The district settings screen gains a time-zone selector (ROW only, behind `time.districtZone`).
- **Verify:** unit test: a district with `America/Sao_Paulo` resolves to it; a district with null resolves to `Asia/Kolkata` on a default brand.

### WS4-02 Clock for new code

- **Track:** A1 · **Depends on:** none · **Estimate:** 0.5 day
- **Files:** `Program.cs`; new `RotaryApi/Services/Time/InstanceClock.cs`
- **Do:** `builder.Services.AddSingleton(TimeProvider.System)`. `InstanceClock` wraps it: `Now` (instance zone, kind Unspecified, equal to `DateTime.Now` while the zones match), `UtcNow`, `TodayIn(TimeZoneInfo)`, `ToInstance(DateTimeOffset)`, `FromInstance(DateTime) : DateTimeOffset`. New code and every method touched in this workstream use it. The other 488 reads are left alone.
- **Verify:** unit tests with `FakeTimeProvider`.

### WS4-03 `ILocalSchedule`

- **Track:** A1 · **Depends on:** WS4-01, WS4-02 · **Estimate:** 2 days
- **Files:** new `RotaryApi/Services/Time/ILocalSchedule.cs`, `LocalSchedule.cs`; `SQL/scheduled_job_runs.sql` (Appendix B.5); shared by the workers through a linked file
- **Do:**

```csharp
public interface ILocalSchedule
{
    // Districts whose local time has passed `localTime` today (their date) and that have not run `jobKey` for that date.
    Task<IReadOnlyList<DistrictDue>> DueNowAsync(string jobKey, TimeOnly localTime, CancellationToken ct);
    Task MarkRanAsync(string jobKey, int districtId, DateOnly localDate, CancellationToken ct);
}
public sealed record DistrictDue(int DistrictId, string TimeZoneId, DateOnly LocalDate);
```

  `DueNowAsync` loads alive districts with their zone, computes each one's local date and time from `TimeProvider`, and returns those past `localTime` with no row in `scheduled_job_runs` for `(jobKey, districtId, localDate)`. `MarkRanAsync` inserts with `INSERT IGNORE`, so two processes cannot both run a district. Jobs that are instance-wide (one run for everyone) use `districtId = 0` and the instance zone.
- **Verify:** unit test with a fake clock: with all districts in `Asia/Kolkata` and `localTime = 07:00`, nothing is due at 06:59 and every district is due at 07:00, once. With one district in `America/New_York`, it comes due nine and a half or ten and a half hours later and on its own date.

### WS4-04 Move the API's timed services onto it

- **Track:** A1 · **Depends on:** WS4-03 · **Estimate:** 1.5 days
- **Files:** `DailyStatsReportBackgroundService.cs`, `DistrictPerformanceReportBackgroundService.cs` (and `SendHourIst`, the 1st and 16th rule in `DistrictPerformanceReportService.cs`), `AssistantDataQualityBackgroundService.cs`, `ClubCacheRefreshService.cs`, `Push/ReminderPushBackgroundService.cs`, `Push/PushLogCleanupBackgroundService.cs`, `ClubWebsiteReminderBackgroundService.cs`
- **Do:** each service's loop becomes: wake every 15 minutes; ask `DueNowAsync(jobKey, hour)`; process the due districts (or the single instance-wide run); `MarkRanAsync`. Delete the private `ResolveIst()` copies. District-facing jobs (district performance report, reminders) run per district at the district's hour. Staff-facing jobs (daily stats, data quality) stay instance-wide.
- **Verify:** on RIZones staging the district performance report is produced at the same hour as before for every district; on ROW staging a New York district receives it at 07:00 Eastern.
- **RIZones check:** the unit test of WS4-03 pins "all districts due in the same tick".

### WS4-05 Greetings worker per district

- **Track:** A2 (greetings stay switched off for pilot districts until then) · **Depends on:** WS4-03 · **Estimate:** 1.5 days
- **Files:** `GreetingsWorker/Services/GreetingsJob.cs`, `GreetingsWorker/Program.cs`, `GreetingsWorker/TaskScheduler-Greetings-Morning.xml`
- **Do:** the scheduled task changes from "daily 08:00" to "every 15 minutes". Each run asks `DueNowAsync("greetings", 08:00)` and processes only members of the due districts, matching birthdays and anniversaries against that district's **local date** passed as `@Today` (replacing the six `CURDATE()` uses). `greeting_send_log.SendDate` stores the local date.
- **Verify:** a member in a New York district with a birthday on 5 March is greeted once, on 5 March Eastern.
- **RIZones check:** greetings on RIZones go out at 08:00 India time within one 15-minute tick; the send count for a day equals the previous implementation's on a staging replay.

### WS4-06 Output boundary: timestamps carry an offset

- **Track:** A1 · **Depends on:** WS4-02 · **Estimate:** 4 days
- **Files:** new `RotaryApi/Json/InstanceDateTimeConverter.cs`, `DateOnlyValueAttribute.cs`; `Program.cs` (`AddJsonOptions`, line 35); DTOs (234 `DateTime` properties)
- **Do:**
  1. `InstanceDateTimeConverter : JsonConverter<DateTime>`. Write: when the flag `time.emitOffset` is off, write exactly what the default converter writes (RIZones unchanged). When on: kind `Unspecified` or `Local` is treated as instance time and written with the instance zone's offset for that moment; kind `Utc` is written with `Z`. Read: values with an offset are converted to instance time; values without are taken as instance time.
  2. `[DateOnlyValue]` on a property makes it serialise as `YYYY-MM-DD` with no time and no offset, whatever the flag. 
  3. **Audit all 234 `DateTime` properties** and mark the calendar dates: birth dates, anniversaries, project dates, event dates stored without time, meeting dates, dues due dates, Rotary-year start and end, charter dates, payment dates shown as dates. The audit is a checked-in table `docs/time/datetime-audit.csv` (DTO, property, kind: instant or date) reviewed by the lead developer.
  4. Dapper `dynamic` results returned directly by controllers bypass DTOs: the converter still applies to `DateTime` values inside them, but date-only columns cannot carry the attribute. For those, cast in SQL (`DATE_FORMAT(col, '%Y-%m-%d') AS col`) where the column is a calendar date. The audit lists them.
- **Verify:** on ROW staging a viewer in London sees an event created at 14:00 India time as 09:30; a birthday of 5 March shows 5 March in every zone.
- **RIZones check:** with the flag off, a recorded set of fifty API responses is byte-identical before and after.

### WS4-07 Input boundary

- **Track:** A1 · **Depends on:** WS4-06, WS3-02 · **Estimate:** 3 days
- **Files:** new `rotary-frontend/src/lib/zonedInput.ts`; the 18 files using `datetime-local`; new `RotaryApi/Json` read path (above) and a model binder for query and form values
- **Do:**
  1. `toApiDateTime(localValue: string, timeZone: string): string`: when `useFeature("time.emitOffset")` is on, returns the local wall-clock value with that zone's offset for that date (computed with `Intl.DateTimeFormat` parts, so daylight saving is right); when off, returns the value unchanged.
  2. `fromApiDateTime(iso: string, timeZone: string): string`: the reverse, for populating the input when editing.
  3. Apply both in every form with a `datetime-local` input: announcements, events, newsletters, documents publish and expiry, scheduled WhatsApp and email sends, login announcement, reminders, training appointments.
  4. Server: the converter's read path turns an offset-bearing value into instance time before the service sees it, so the services and SQL are unchanged.
  5. Date-only inputs (`type="date"` and the custom date pickers) send `YYYY-MM-DD` and are never converted.
- **Verify:** on ROW staging, schedule an announcement for 09:00 in a New York district: the stored value is 18:30 or 19:30 India time depending on daylight saving, and it publishes at 09:00 Eastern.

### WS4-08 "Today" in person-facing SQL

- **Track:** A1 for reminders, upcoming events and publish windows (1.5 days); B for the rest (2 days) · **Depends on:** WS4-01 · **Estimate:** 3.5 days
- **Files:** the files of Appendix I, section G20
- **Do:** for each `CURDATE()` whose meaning is a person's day ("upcoming from today", "due in N days", "published and not expired", "birthday this week"), pass `@Today` computed by `InstanceClock.TodayIn(zone)` for the club or district in the query's scope. Where the query spans districts (SuperAdmin lists, staff reports), keep the instance date. MySQL named-zone conversion is not used: the zone tables are not loaded on Windows installs. Record each decision in `docs/time/curdate-audit.csv` (file, line, meaning, action).
- Priority order: `ClubAdminDashboardService` (7), `DistrictAdminDashboardService` (7), `MobileNotificationFeedService` (3), `ClubWebsiteReminderBackgroundService` (3), `Push/EventPushBackgroundService`, `LoginAnnouncementAudience`, `OcvLiveVisibility`, the public website controllers, `FoundationGoalsService` (6), `WebsiteBillingService` (4), then the remainder.
- **Verify:** for a district in `Asia/Kolkata`, `@Today` equals `CURDATE()`, asserted by a test.

### 9.3 Accepted limitation: Rotary-year rollover

`RotaryYearRolloverBackgroundService` flips the current year on 1 July by server date, polling every six hours. For ROW users in the Americas the flip arrives up to about fifteen hours before their own 1 July. Projects are assigned to a year table by **project date**, so data is filed correctly; only the default selection in year pickers is early, for a few hours, once a year. Document this for support. No change.

---

## 10. Workstream WS5: master data and seed files

**Owner: BW1.** 1.5 engineer-weeks.

### 10.1 Today

- Seeding is C# in `DatabaseInitializer.cs`. Roles are inserted with explicit ids: 1 Member, 2 Admin, 3 SuperAdmin, 4 ZonalCoordinator, 5 ClubModerator, 6 AG, 7 RIDirector.
- Designations depend on insert order: 1 President, 2 Immediate Past President, 3 Vice President, 4 Secretary.
- Countries depend on India being first (`IndiaCountryId = 1`).
- **Area of focus, category and sub-category have no seed in code.** They exist only as production rows (69, 129 and 311 rows).
- Code compares ids: `fk_role_id` literals in 134 places (Appendix I, section G8); designation ids in 14 (section G9); the zonal awards calculators use area-of-focus ids 59, 2, 41, 50, 51, 31, 39, 54, 55, 56, category ids 13, 129, 130, 131 and sub-category ids 44, 285, 286.

A ROW database seeded by name alone would get different ids and those comparisons would silently fail. So ids are **preserved** for the tables code refers to by id.

### 10.2 Master tables and their policy

| Table | Rows | Id policy | Business key |
|---|---|---|---|
| `roles` | 7 | preserve | role name |
| `designation_master` | 46 | preserve for the seeded set; the sync adds more | designation name as Rotary.org sends it |
| `country_master` | 196 | preserve | ISO code |
| `area_of_focus_master` | 69 | preserve | `code` (new) |
| `category_master` | 129 | preserve | `code` (new) within area of focus |
| `sub_category_master` | 311 | preserve | `code` (new) within category |
| `module_master` | 46 | assign | `ModuleKey` |
| `module_categories` | 12 | assign | name key |
| `website_data_module_master` | 8 | assign | key |
| `goal_categories` | 6 | assign | key |
| `goal_fields` | 161 | assign | `FieldKey` |
| `trf_fund_master` | 5 | assign | fund code |
| `funding_master` | 6 | assign | code |
| `theme_master` | 25 | assign | theme key |
| `ocv_document_type` | 81 | assign | code |
| `zonal_awards_question`, `zonal_awards_question_option` | 52, 193 | assign | question code |
| `district_citation_activity_master`, `district_citation_auto_question`, `_sub` | 15, 1,266, 3,079 | assign | code; **confirm with product owners whether ROW uses the citation programme at all** before seeding |
| `system_settings` | 11 | not seeded | per instance |
| `rotary_year_master` | 114 | generated | label; ROW creates valid labels only (production has junk rows such as `225-26`) |
| `zone_master`, `district_master`, `club_master` | | not seeded | created by the Rotary.org sync for the instance's scope (WS8-10) |
| `master_translation` | | assign | `(entity, entity_key, field, lang)` |
| `whatsapp_templates` | | assign | `(template_key, language, provider)` |

### WS5-01 Stable codes for the taxonomy

- **Track:** A1 · **Depends on:** none · **Estimate:** 1 day
- **Files:** `SQL/taxonomy_codes.sql`, `DatabaseInitializer.cs`
- **Do:** add `code VARCHAR(80) NULL` to `area_of_focus_master`, `category_master`, `sub_category_master`. Fill from a slug of the current name (lower case, non-alphanumerics to hyphens). Where two rows under the same parent produce the same slug, append `-2`, `-3` by ascending id. Add a unique index on `(parent id, code)` after the fill; the parents are `fk_module_id` for areas of focus, `fk_area_of_focus_id` for categories and `fk_category_id` for sub-categories (Appendix B.6). New rows created in the master screens get a code from the same function.
- **Verify:** no null and no duplicate codes; the SQL file is idempotent.
- **RIZones check:** additive column; nothing reads it yet.

### WS5-02 Export production masters to seed files

- **Track:** A1 · **Depends on:** WS5-01 · **Estimate:** 2 days
- **Files:** new `tools/export-seeds/` (small console project), output `RotaryApi/Seeds/<table>.json`
- **Do:** for each table of section 10.2 with a policy, export alive rows to:

```json
{
  "table": "category_master",
  "idColumn": "pk_category_id",
  "idPolicy": "preserve",
  "key": ["areaOfFocusCode", "code"],
  "references": { "areaOfFocusCode": { "table": "area_of_focus_master", "column": "fk_area_of_focus_id", "by": "code" } },
  "rows": [ { "id": 13, "areaOfFocusCode": "basic-education-and-literacy", "code": "adult-literacy", "name": "Adult literacy", "sortOrder": 3 } ]
}
```

  Foreign keys between seed tables are written by key, never by id. Audit columns (`created_by`, dates) are not exported. Then compare with what `DatabaseInitializer` seeds in code and write the differences to `docs/seeds/production-vs-code.md`: rows production has that code does not (expected for the taxonomy), and rows whose names differ. Remove the C# seeding for a table only after its file is in place and WS5-05 has passed.
- **Verify:** the files are reviewed by the lead developer; junk rows (test entries, duplicates) are removed from the files, not from production.

### WS5-03 `MasterDataSeeder`

- **Track:** A1 · **Depends on:** WS5-02 · **Estimate:** 2.5 days
- **Files:** new `RotaryApi/Services/Seeding/MasterDataSeeder.cs`, `SeedFile.cs`; `SQL/seed_history.sql` (Appendix B.6); `RotaryApi.csproj` (seed files as embedded resources); new CLI switch `RotaryApi --seed [--dry-run]`
- **Do:**
  1. Load files in dependency order (from `references`).
  2. For each row: find the existing row by business key. `preserve`: if found with the same id, update changed columns; if found with a different id, **stop with an error**; if not found and the id is free, insert with the explicit id; if the id is taken by another key, stop with an error. `assign`: upsert by key and let the database assign ids.
  3. Never delete. Rows present in the database and absent from the file are listed in the report.
  4. Record `(file, sha256, applied_at, inserted, updated, unchanged, reported)` in `seed_history`; skip a file whose hash is unchanged.
  5. `--dry-run` prints the planned inserts and updates and writes nothing. Exit code 2 when changes are pending.
  6. Everything runs in one transaction per file.
- **Verify:** unit tests against a throwaway schema: fresh insert, no-op second run, conflict detection for both error cases.

### WS5-04 Deploy hook with a RIZones guard

- **Track:** A1 · **Depends on:** WS5-03, WS0-04 · **Estimate:** 0.5 day
- **Files:** `tools/deploy.ps1`
- **Do:** after schema migration, run the seeder in dry-run. For RIZones: if it reports any insert or update, stop the deploy and print the differences, unless the release was started with `-AllowSeedChanges` (a deliberate master-data change). For ROW: apply.
- **Verify:** a seed file edited to rename a category stops a RIZones deploy with a clear message.

### WS5-05 Prove an empty database matches production

- **Track:** A1 · **Depends on:** WS5-03 · **Estimate:** 1 day
- **Do:** create an empty schema on the ROW instance; run `DatabaseInitializer` then the seeder; compare every preserved table with production by `(id, key, name)`; run the zonal awards calculator against a district copied from staging into that schema and compare its output with staging's.
- **Verify:** zero differences, recorded in `docs/seeds/verification-<date>.md`.

### WS5-06 Master screens read-only on ROW; constants for roles

- **Track:** B · **Depends on:** WS1-08 · **Estimate:** 0.5 day
- **Files:** the master-data screens under `settings/`; new `RotaryApi/Common/RoleIds.cs`, `DesignationIds.cs`
- **Do:** flag `masters.editable` (default true). When false the screens hide their add, edit and delete controls and the API returns `FEATURE_DISABLED` for writes. Add `RoleIds.Member = 1` through `RoleIds.RiDirector = 7` and `DesignationIds.President = 1`, `ImmediatePastPresident = 2`, `VicePresident = 3`, `Secretary = 4`. New code uses them; existing literals are replaced when a file is touched for another reason. No bulk rewrite.

---

## 11. Workstream WS6M: WhatsApp, SMS and one-time passwords

**Owner: BW2.** 3 engineer-weeks. Task ids use the prefix `WS6M`.

### 11.1 Today

- `IInteraktService` has three methods; all take a national number plus `countryCode = "+91"` as a default parameter. `InteraktService.cs` trims to the last ten digits when the code is 91 (line 68) and stamps every send with `callbackData = "membership_dues_reminder"` (line 106), whatever the message is.
- Twelve call sites in ten files (Appendix I, section G3). The greetings worker has its own copy, `GreetingsWorker/Services/InteraktWhatsAppSender.cs`.
- About twenty-five template names are string literals spread over services, `WhatsAppScheduledSendBackgroundService.cs:34-87` and `WhatsAppCommsTemplates.cs:28-38` (the real ones are listed in Appendix F). Template bodies exist only in the Interakt dashboard.
- SMS: `ISmsService.SendOtpSmsAsync(mobile, otp)` with six callers (Appendix I, section G4). The text is a DLT-registered Indian template and must not change for RIZones. **Defect:** `SmsService.cs` logs the full request URL, which contains the provider API key and the one-time password (`_logger.LogInformation("SMS URL: {Url}", url)`). Fix in WS6M-06.
- OTP routing is a business rule in code: India receives SMS only; outside India receives email (and WhatsApp through `OtpWhatsAppHelper`), decided by `IndiaCountryId = 1`.
- Mobile numbers are stored as the national part; the country is `fk_primary_country_id`, whose `country_master.PhoneCode` holds the dial code. `PhoneNumberNormalizer` strips a leading code on the write path.
- A pilot gate is a code constant (`WhatsAppPilot.cs:19-22`: club 2765, district 2).

### 11.2 Design

```csharp
public interface IWhatsAppSender
{
    Task<WhatsAppSendOutcome> SendAsync(WhatsAppMessage message, CancellationToken ct = default);
}

public sealed record WhatsAppMessage(
    string TemplateKey,                     // logical key, e.g. "dues.reminder.withBank"
    string ToE164,                          // "+14155550123"
    string Language,                        // "en", "ja" ...
    IReadOnlyList<string> Body,
    IReadOnlyList<string>? Header = null,   // image URL for media-header templates
    IReadOnlyList<string>? Buttons = null,  // dynamic button values (OTP copy-code, link suffix)
    int? ClubId = null, int? DistrictId = null,
    string? Purpose = null);                // goes to callbackData and whatsapp_log.whatsapp_type

public interface IPhoneNumbers
{
    string? ToE164(string? nationalOrInternational, int? countryId);   // null when it cannot be made valid
    (string CountryCode, string National) Split(string e164);          // for providers that want the parts
    bool IsMobile(string e164);
}

public interface ISmsSender
{
    Task<bool> SendAsync(string toE164, string templateKey, string language, IReadOnlyDictionary<string, string> args, CancellationToken ct = default);
}
```

- **Registry.** Table `whatsapp_templates` (Appendix B.8) maps `(template_key, language, provider)` to the provider's template name and its shape. Senders look up `(key, language)`, fall back to English, and refuse to send when neither exists or the row is not approved. Seeded from `RotaryApi/Seeds/whatsapp_templates.json`.
- **Adapters.** `InteraktWhatsAppSender` (RIZones) builds exactly today's request. `MetaCloudWhatsAppSender` (ROW) calls the WhatsApp Cloud API. Selected by `Brand:Providers:WhatsApp`.
- **OTP policy.** `Brand:Providers:OtpPolicy` is a map from ISO country code to an ordered channel list, with `*` as the default. RIZones default: `{ "IN": ["sms"], "*": ["email", "whatsapp"] }`. ROW: `{ "*": ["email", "whatsapp", "sms"] }`. The first channel that the member has an address for and that the instance has configured is used; on provider failure the next is tried.

### WS6M-01 Start the outside lead times (day one)

- **Track:** A1 · **Depends on:** the ROW legal entity and domain · **Estimate:** 1 day of engineering, then waiting
- **Do:**
  1. **Meta business verification** for the entity that owns ROW; create the WhatsApp Business Account and register the ROW sender number with a display name. Typical wait: one to three weeks.
  2. **Submit the four launch templates** in English and the pilot districts' languages immediately, the other languages as each is reviewed: `otp` (authentication category, copy-code button), `dues.reminder`, `content.announcement`, `content.event`. Bodies are in Appendix F. Four templates in eight languages is thirty-two submissions.
  3. **Twilio account**, a Messaging Service, and sender registration per destination: United States application-to-person registration (brand and campaign; one to three weeks; without it US carriers block the messages), alphanumeric sender registration where a country requires it.
  4. **Email sending domain** for ROW at Brevo: SPF, DKIM and DMARC records on the ROW domain; a dedicated sender address.
  5. Track each item in the Friday gate report until done.

### WS6M-02 Phone numbers in E.164

- **Track:** A2 · **Depends on:** WS1-01 · **Estimate:** 2 days
- **Files:** `RotaryApi.csproj` (`libphonenumber-csharp`); new `RotaryApi/Services/PhoneNumbers.cs`; callers: `InteraktService.cs` (lines 61 to 70), `RazorpayRouteService.cs:213`, `InteraktWebhookController.cs:101`, `PphCampService.cs:502`, `MembersController.cs` (lines 42, 216), `DistrictDirectoryController.cs:181`, `DirectoryDataCollectionFields.cs:198`, `GreetingsWorker/Services/InteraktWhatsAppSender.cs` (lines 33 to 47), `ClubMemberSweepWorker.cs` (lines 81, 86, 724)
- **Do:** `ToE164(number, countryId)`: if the input starts with `+`, parse it as international; otherwise parse with the region of `countryId` (from `country_master` ISO code), falling back to `Brand.Current.Locale.DefaultCountryId`. Return null when libphonenumber says it is not a possible number. Keep `PhoneNumberNormalizer` for the storage path (the number column keeps holding the national part); callers that **send** use `IPhoneNumbers`.
- **Verify:** unit tests with Indian, US, UK, Brazilian, Japanese, German and Nigerian numbers in national and international form, including a national number with a trunk zero.
- **RIZones check:** for every distinct mobile in staging, `Split(ToE164(n, 1)).National` equals what `InteraktService` computes today. Run as a one-off comparison script and record the number of differences (expected: only rows that are malformed today).

### WS6M-03 `IWhatsAppSender` with the Interakt adapter

- **Track:** A2 · **Depends on:** WS6M-02 · **Estimate:** 2.5 days
- **Files:** new `RotaryApi/Services/Messaging/IWhatsAppSender.cs`, `InteraktWhatsAppSender.cs`; the twelve call sites of Appendix I, section G3; `Program.cs`; new `RotaryApi.Tests/Characterisation/WhatsAppPayloadTests.cs`
- **Do:**
  1. **First** write the characterisation test: a fake `HttpMessageHandler` captures the JSON that `InteraktService` sends for each of the twelve call sites with fixture data. Store the captures.
  2. Implement `InteraktWhatsAppSender` to produce the same JSON from a `WhatsAppMessage` (country code and national number from `IPhoneNumbers.Split`; `callbackData` stays `"membership_dues_reminder"` for the two dues senders and becomes `Purpose` elsewhere only when `Brand.Feature("whatsapp.purposeCallback")` is on, default off).
  3. Change each call site to build a `WhatsAppMessage` and call the new interface. `IInteraktService` remains as a thin wrapper until the last caller is moved, then is deleted.
- **Verify:** the captured payloads are identical before and after for all twelve sites.

### WS6M-04 Template registry

- **Track:** A2 · **Depends on:** WS6M-03, WS5-03 · **Estimate:** 2.5 days
- **Files:** `SQL/whatsapp_templates.sql`; `RotaryApi/Seeds/whatsapp_templates.json`; new `WhatsAppTemplateRegistry.cs`; `WhatsAppScheduledSendBackgroundService.cs` (lines 34 to 87), `WhatsAppCommsTemplates.cs` (lines 28 to 38), `OtpWhatsAppHelper.cs` (`DefaultTemplateName`), every literal of Appendix F
- **Do:** seed one row per existing Interakt template under its logical key with language `en` and provider `interakt`, carrying its parameter counts and the body-length budget now hard-coded in `WhatsAppCommsTemplates`. Replace each literal with the key. The registry resolves `(key, language, provider)` to the provider name. Configuration keys that override template names today (`Interakt:OtpTemplateName`, `ClubWebsiteReminderTemplate`) keep working: they win over the registry when set.
- **Verify:** the smoke suite's messaging check asserts that every key used in code resolves for every language the brand lists (no send).
- **RIZones check:** the payload tests of WS6M-03 still pass: the resolved names equal the old literals.

### WS6M-05 WhatsApp Cloud API adapter and status webhook

- **Track:** A2 · **Depends on:** WS6M-04, WS6M-01 · **Estimate:** 3 days
- **Files:** new `MetaCloudWhatsAppSender.cs`, `Controllers/MetaWhatsAppWebhookController.cs`; `whatsapp_log` writer
- **Do:**
  1. Send: `POST https://graph.facebook.com/<version>/<phone-number-id>/messages` with a bearer token, body `{ messaging_product: "whatsapp", to: <digits of E.164>, type: "template", template: { name, language: { code }, components: [ header?, body, button? ] } }`. Map the response's `messages[0].id` to `WhatsAppSendOutcome.MessageId`. The API version, phone-number id and token come from `Brand:Providers:MetaWhatsApp` (token in the environment).
  2. Language codes: Meta uses codes such as `en`, `fr`, `de`, `it`, `ja`, `ko`, `pt_BR`, `es`. The registry row holds the exact code the template was approved under.
  3. Webhook: `GET api/public/whatsapp/meta/webhook` answers the verification challenge (`hub.verify_token`); `POST` verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) and writes `sent`, `delivered`, `read` and `failed` statuses to `whatsapp_log` by message id, the same columns the Interakt webhook writes.
  4. Handle the documented failures: template not approved or paused (mark the registry row not approved and alert), recipient not on WhatsApp (record, do not retry), rate limit (retry with backoff).
- **Verify:** OTP and the three other launch templates reach test handsets in the United States, the United Kingdom, Brazil and Japan in the right language; delivery status appears in the WhatsApp log screen.
- **RIZones check:** RIZones has no `MetaWhatsApp` section; the adapter is never constructed.

### WS6M-06 SMS interface, Twilio adapter, and the logging defect

- **Track:** A2 · **Depends on:** WS6M-02 · **Estimate:** 1.5 days
- **Files:** new `Messaging/ISmsSender.cs`, `DltSmsSender.cs` (today's `SmsService` body), `TwilioSmsSender.cs`; the six callers of Appendix I, section G4; `SmsService.cs`
- **Do:**
  1. `DltSmsSender` keeps the registered text and ids byte for byte. **Remove the line that logs the request URL**; log the masked number and the provider's status only. Never log a one-time password.
  2. `TwilioSmsSender`: `POST /2010-04-01/Accounts/<sid>/Messages.json` with the Messaging Service id; text from a translated template `sms.otp` ("{code} is your {brandName} verification code."). Credentials from the environment.
  3. Callers use `ISmsSender` with the E.164 number.
- **Verify:** an OTP SMS reaches a US and a UK test number from ROW staging; RIZones OTP SMS is unchanged; the log contains no code and no key.

### WS6M-07 OTP policy

- **Track:** A1 for the dispatcher with the email channel and today's senders; the Cloud API and Twilio channels plug in at A2 · **Depends on:** WS1-01 · **Estimate:** 1 day
- **Files:** `OtpWhatsAppHelper.cs` (lines 35 to 37), `MobileAuthService.cs:286`, `PublicDirectoryController.cs:304`, `EventPaymentLinkService.cs:1329`, `MembershipDuesService.cs:2695`, `ClubWebsitesController.cs:1434`, `SuperAdminController.cs:261`; new `Messaging/OtpDispatcher.cs`
- **Do:** one class, `OtpDispatcher.SendAsync(member or contact, code, purpose)`, reads the policy for the recipient's country and tries channels in order. The six call sites call it instead of choosing a channel themselves. The default policy reproduces today's rule exactly.
- **A1 note:** the English pilot signs in with a code sent by **email**. ROW has no Interakt or DLT configuration, so the dispatcher must skip channels the instance has not configured instead of failing. WhatsApp and SMS codes arrive with WS6M-05 and WS6M-06.
- **Verify:** unit tests for the default policy: an Indian member gets SMS only; a member in Nepal gets email and WhatsApp. On ROW staging a member with only an email receives the code by email.

### WS6M-08 Greetings worker uses the shared sender

- **Track:** A2 · **Depends on:** WS6M-03, WS4-05 · **Estimate:** 1 day
- **Files:** `GreetingsWorker/Services/InteraktWhatsAppSender.cs`, `GreetingsWorker.csproj`
- **Do:** move `IWhatsAppSender`, the two adapters, the registry and `IPhoneNumbers` into a shared project `Rotary.Messaging` referenced by the API and the worker; delete the worker's copy. The worker reads `Brand` the same way the API does (WS8-01 adds the shared configuration loader for workers).
- **Verify:** a staging greeting run produces the same payloads as before (captured).

### WS6M-09 Pilot gate and consent hook

- **Track:** B · **Depends on:** WS1-07, WS7-05 · **Estimate:** 0.5 day
- **Files:** `WhatsAppPilot.cs`, `IWhatsAppSender` decorators
- **Do:** `WhatsAppPilot` reads its club and district ids from `Brand.Current.Scope`. A decorator around `IWhatsAppSender` drops non-transactional messages (every template key not starting with `otp`, `dues.receipt` or `event.receipt`) to members without consent when `privacy.enabled` is on, and records the skip in `whatsapp_log` with the reason.

---

## 12. Workstream WS6: payments

**Owner: BW2.** 5.5 engineer-weeks.

### 12.1 Fix first: two defects in production today

These ship to RIZones alone, before any refactor.

### WS6-01 Verify Cashfree webhook signatures

- **Track:** A1 · **Depends on:** none for the log-only release; WS0-03 before enforcing · **Estimate:** 1 day
- **Evidence:** `PublicMembershipDuesController.cs:143` and `PublicEventPaymentController.cs:104` read the body and call `HandleWebhookAsync(payload)` with no check. `CashfreeGatewayProxy.VerifyResponseSignature` has no callers. Anyone who knows the URL and an order id can mark a payment as paid.
- **Files:** the two controllers; new `RotaryApi/Services/Payments/CashfreeWebhookSignature.cs`; any PHP relay in front of these endpoints
- **Do:**
  1. Cashfree signs each webhook: header `x-webhook-timestamp` and header `x-webhook-signature`, where the signature is Base64 of HMAC-SHA256 over `timestamp + rawBody` keyed with the client secret of the account that created the order.
  2. In each controller: enable buffering, read the **raw** body as bytes (do not re-serialise), compute the signature with the secret from the same configuration section the flow uses to create orders, compare in constant time (`CryptographicOperations.FixedTimeEquals`). Reject with 401 on mismatch or missing headers; log the order id and remote address.
  3. Reject timestamps older than ten minutes.
  4. If a PHP relay forwards webhooks, it must pass the body bytes and both headers unchanged. Check it; fix it in the same release.
  5. Roll out in two steps: first release logs mismatches without rejecting (flag `payments.cashfreeWebhookEnforce` off) for 48 hours to confirm genuine webhooks verify; second release enforces.
- **Verify:** a replayed genuine webhook passes; the same body with one byte changed is rejected; a request with no signature is rejected.
- **RIZones check:** during the log-only period every webhook that led to a confirmed payment verified.

### WS6-02 Event-payment webhook matches the wrong identifier

- **Track:** A1 · **Depends on:** WS6-01 · **Estimate:** 1 day
- **Evidence:** on order creation `EventPaymentLinkService.cs:1529` stores Cashfree's numeric `cf_order_id` in `event_payment_members.CfOrderId`. The webhook handler at `:1632` runs `WHERE CfOrderId = @OrderId` with the payload's `order_id`, which is **our** merchant order id. They never match, so the webhook confirms nothing and payment is confirmed only when the payer returns to the page. A payer who closes the browser stays unpaid until reconciliation. *This was found by reading code; confirm it first with step 1.*
- **Do:**
  1. Confirm: `SELECT COUNT(*) FROM event_payment_members WHERE IsPaid = 1 AND PaidSource = 'Webhook'`. If the defect is real, this is zero or near zero while `IsWebhookReceived` rows are also absent.
  2. Add column `MerchantOrderId VARCHAR(64) NULL` with an index; store our order id at creation alongside `CfOrderId`.
  3. The webhook matches `WHERE MerchantOrderId = @OrderId`, falling back to the old condition for rows created before the change.
  4. Backfill is not possible for old rows (the merchant id was not stored); the existing reconciliation covers them.
- **Verify:** on staging with the gateway sandbox, pay and close the browser before the return page loads: the row becomes paid from the webhook.

### 12.2 Today (the rest)

| Flow | Service | Gateway | Order creation | Verify | Webhook |
|---|---|---|---|---|---|
| Membership dues (member pays club) | `MembershipDuesService` | Cashfree, with splits to vendors | `:2861` | `:2925` | `PublicMembershipDuesController.cs:143` |
| Event payment links | `EventPaymentLinkService` | Cashfree, with splits | `:1506` | `:1555` | `PublicEventPaymentController.cs:104` |
| District dues (club pays district) | `ClubDuesService` | Razorpay with Route transfers | `:1795` | in service | `PublicClubDuesController.cs:81` |
| Wallet top-up (credits, paid to Kaizen) | `WalletService` | Razorpay | `:143` | in service | `WalletController.cs:96`, which also dispatches other Razorpay events by table lookup |
| Website billing (paid to Kaizen) | `WebsiteBillingService` | Razorpay | `:354` | in service | `WebsiteBillingController.cs:104` |

Also: settlements are fetched from Cashfree (`MembershipDuesService.cs:3793`, `EventPaymentLinkService.cs:2001`) and Razorpay (`RazorpaySettlementService.cs:33`); vendor onboarding through `CashfreeKycService` (lines 391, 546) and `RazorpayRouteService.cs:68`; a reconciliation job (`MembershipDuesReconciliationBackgroundService`). Currency is `"INR"` at every order. GST is `Razorpay:GstPercent` (18), computed in `WalletService`, `WebsiteBillingService` and `ClubWebsitesController` (Appendix I, section G21). There are no gateway refunds: `RevertMemberFeePaymentAsync` edits the database only.

Browser side: Cashfree's script is used in `pay/dues/[duesId]/page.tsx` and `pay/[linkId]/page.tsx`; Razorpay Checkout in `pay/club-dues/[duesId]`, `pay/club-website/[token]`, `pay/w/[token]`, `components/wallet/WalletTopup.tsx`, `club-admin-dashboard/club-dues` and `club-admin-dashboard/website-purchase`.

### 12.3 Design

```csharp
public interface IPaymentGateway
{
    string Code { get; }                                    // "cashfree" | "razorpay" | "stripe" | "paypal"
    GatewayCapabilities Capabilities { get; }
    Task<CheckoutSession> CreateCheckoutAsync(CheckoutRequest request, CancellationToken ct);
    Task<PaymentStatus> GetStatusAsync(GatewayAccount account, string merchantOrderId, string? gatewayOrderId, CancellationToken ct);
    WebhookEvent ParseAndVerifyWebhook(GatewayAccount account, ReadOnlyMemory<byte> rawBody, IHeaderDictionary headers);   // throws InvalidWebhookSignatureException
    Task<RefundResult> RefundAsync(GatewayAccount account, string gatewayPaymentId, Money amount, string reason, CancellationToken ct);
}

[Flags] public enum GatewayCapabilities { None = 0, Splits = 1, Refunds = 2, Settlements = 4, HostedRedirect = 8, InPageWidget = 16 }

public sealed record CheckoutRequest(
    string MerchantOrderId,                 // <FLOW>-<instance>-<row id>-<ticks>; FLOW is DUES, EVT, CDUES, WAL or WEB
    Money Amount, Money? Tax,
    PayerInfo Payer,                        // name, email, E.164 phone, language
    string Description,
    string ReturnUrl, string CancelUrl,
    GatewayAccount Account,
    IReadOnlyList<Split>? Splits,           // only when Capabilities has Splits
    IReadOnlyDictionary<string, string> Metadata);

public sealed record CheckoutSession(
    string GatewayOrderId,
    CheckoutKind Kind,                      // Redirect | CashfreeSession | RazorpayOrder
    string? RedirectUrl,                    // Stripe and PayPal
    string? ClientToken,                    // Cashfree payment_session_id; Razorpay order id
    string? PublicKey);

public sealed record PaymentStatus(PaymentState State, string? GatewayPaymentId, Money? Paid, DateTimeOffset? PaidAt, string Raw);
public enum PaymentState { Pending, Paid, Failed, Expired, Refunded, PartiallyRefunded }
public sealed record WebhookEvent(string MerchantOrderId, PaymentState State, string? GatewayPaymentId, Money? Amount, string EventId, string Raw);

public interface IPaymentGatewayResolver
{
    // Which gateway and whose account for this flow and owner. Throws ApiException(PAYMENTS_NOT_CONFIGURED) when none.
    Task<(IPaymentGateway Gateway, GatewayAccount Account)> ForAsync(PaymentFlow flow, int? clubId, int? districtId, string currency, CancellationToken ct);
}
```

**Who is paid, on each instance.**

| Flow | RIZones (unchanged) | ROW |
|---|---|---|
| Membership dues, event links | Cashfree platform account with splits | The club's own account if connected, else the district's; no split |
| District dues | Razorpay with Route | The district's own account; no split |
| Wallet top-up, website billing | Razorpay platform account | The platform's Stripe account |

**Rules.**

- The five flow services keep their tables and business logic. Only their gateway calls go through the interface.
- One webhook entry per gateway; existing URLs stay as aliases.
- An `EventId` from the gateway is recorded in `payment_webhook_events` (Appendix B.10) and processed once; webhooks are retried by every gateway and must be idempotent.
- ROW takes no split, so the platform's fee is invoiced from `platform_fee_ledger`.
- A refund is an action by the Club or District Admin who owns the account, recorded against the payment; it never deletes the payment row.

### WS6-03 Interface, models and resolver

- **Track:** A1 · **Depends on:** WS3-05 · **Estimate:** 2 days
- **Files:** new `RotaryApi/Services/Payments/` (`IPaymentGateway.cs`, `Models.cs`, `PaymentGatewayResolver.cs`, `MerchantOrderIds.cs`)
- **Do:** the types above. `MerchantOrderIds.Create(flow, rowId)` and `Parse(id)` return flow, instance and row id. **Existing RIZones order id formats are kept as they are**: `Parse` recognises both the old formats (each flow's current prefix) and the new one, so in-flight and historical orders still route. The resolver on a default brand returns the configured Indian gateway with the platform account built from today's configuration sections.
- **Verify:** unit tests for `Parse` on samples of every existing order id format taken from staging.

### WS6-04 Cashfree behind the interface (no behaviour change)

- **Track:** A1 · **Depends on:** WS6-03, WS6-01, WS6-02 · **Estimate:** 3.5 days
- **Files:** new `Payments/CashfreeGateway.cs`; `MembershipDuesService.cs` (create `:2861`, verify `:2925`, settlements `:3793`), `EventPaymentLinkService.cs` (`:1506`, `:1555`, `:2001`), `MembershipDuesReconciliationBackgroundService.cs`; new `RotaryApi.Tests/Characterisation/CashfreeRequestTests.cs`
- **Do:**
  1. **First** the characterisation tests: with a capturing `HttpMessageHandler`, record the exact request (method, URL, headers except authorisation values, body) each service sends for create, status and settlements with fixture rows, including a dues order with two vendor splits.
  2. Move the HTTP code into `CashfreeGateway`. Splits map to Cashfree's `order_splits`. Settlement fetch stays a Cashfree-specific method on the class (`ICashfreeSettlements`), outside the common interface.
  3. The services call the resolver and the interface.
- **Verify:** captured requests are identical, ignoring timestamps and idempotency keys.
- **RIZones check:** one live low-value dues payment and one event payment on RIZones production after release, confirmed by webhook.

### WS6-05 Razorpay behind the interface (no behaviour change)

- **Track:** B · **Depends on:** WS6-03 · **Estimate:** 2 days
- **Files:** new `Payments/RazorpayGateway.cs`; `ClubDuesService.cs:1795`, `WalletService.cs:143`, `WebsiteBillingService.cs:354`; `RazorpayGatewayProxy.cs` (signature helpers stay and are called by the gateway)
- **Do:** as WS6-04: characterisation first, then extraction. Route transfers map to `Splits`. `RazorpayRouteService` and `RazorpaySettlementService` stay as they are (India only).
- **Verify:** identical captured requests for district dues with a Route transfer, wallet top-up and website order.

### WS6-06 One webhook entry per gateway

- **Track:** A1 · **Depends on:** WS6-04 (Razorpay joins when WS6-05 lands) · **Estimate:** 3 days
- **Files:** new `Controllers/PaymentWebhookController.cs`, `Payments/PaymentWebhookRouter.cs`; `SQL/payment_webhook_events.sql`; the five existing webhook actions
- **Do:**
  1. `POST api/public/payments/webhook/{gateway}/{accountRef?}`: read raw bytes; resolve the account (`accountRef` is the public reference of a `payment_gateway_accounts` row, absent for the platform account); `ParseAndVerifyWebhook`; on a bad signature return 401.
  2. Insert the event id into `payment_webhook_events` with `INSERT IGNORE`; if it already existed, return 200 without processing.
  3. Route by `MerchantOrderIds.Parse(...).Flow` to the owning service's existing handler, passing the verified `WebhookEvent`. The Razorpay dispatch-by-table-lookup in `WalletController.cs:275` is replaced by this routing.
  4. The five old URLs remain, so nothing registered at a gateway dashboard has to change for RIZones. The two Cashfree URLs call the router at once. The three Razorpay URLs keep their current handlers until WS6-05 has moved Razorpay behind the interface, and are then switched to the router in that task.
  5. Always return 200 after a verified event is recorded, even if the handler fails; failures are retried by a small background sweep over unprocessed rows, and alerted.
- **Verify:** the smoke suite's payment check passes on both old and new URLs; a duplicate delivery of one event changes nothing the second time.

### WS6-07 Connected accounts

- **Track:** A1 · **Depends on:** WS6-03 · **Estimate:** 3 days
- **Files:** `SQL/payment_gateway_accounts.sql` (Appendix B.9); new `Payments/GatewayAccountService.cs`, `Controllers/PaymentAccountsController.cs`; frontend: new `src/app/district-admin-dashboard/payments/page.tsx`, `src/app/club-admin-dashboard/payments/page.tsx`, nav entries behind `payments.connect`
- **Do:**
  1. Credentials and webhook secrets are encrypted with ASP.NET Data Protection (the mechanism `ClubRotaryOrgCredentialService` uses), purpose string `payments.accounts.v1`. **The Data Protection key ring for ROW must be persisted to a folder that is backed up** (`D:\ROW\keys`), otherwise a rebuilt server cannot decrypt anything.
  2. Connect screen: choose a gateway available in the district's country (WS6-12); paste the keys (Stripe: restricted secret key and webhook signing secret; PayPal: client id, secret and webhook id); the API verifies with a harmless call (Stripe `GET /v1/account`; PayPal token request) and stores `verified_at`. The screen shows the webhook URL to register, including the account's `accountRef`.
  3. Secrets are write-only: the API never returns them; the screen shows the last four characters.
  4. Every change is audited with the acting member.
- **Verify:** a test-mode Stripe key connects and shows as verified; a wrong key is refused with a translated error.
- **RIZones check:** flag `payments.connect` off; the table is empty; the resolver never reads it.

### WS6-08 Tax rules and currency at order creation

- **Track:** B · **Depends on:** WS6-03, WS3-05 · **Estimate:** 2 days
- **Files:** new `Payments/TaxRules.cs`; `WalletService.cs` (lines 53, 68), `WebsiteBillingService.cs` (lines 52 to 109, 178), `WebsiteDefaultPricing.cs`, `ClubWebsitesController.cs` (the lines of Appendix I, section G21), `PublicClubWebsiteController.cs:79`
- **Do:** `ITaxRules.For(countryIso)` returns `{ ratePercent, label, inclusive }` from `Brand:Providers:TaxRules`; the default list is one rule: `IN`, 18, "GST", exclusive. With an empty list the result is "no tax" and the tax line is omitted from screens, receipts and invoices. Replace each read of `Razorpay:GstPercent` with it. Order currency follows WS3-05. Prices for platform products on ROW (website plans, credits) come from `Brand:Pricing` in the instance's default currency.
- **Verify:** RIZones invoices show the same GST figures; a ROW wallet top-up shows no tax line.

### WS6-09 Stripe adapter

- **Track:** A1 · **Depends on:** WS6-06, WS6-07 · **Estimate:** 4 days
- **Files:** `RotaryApi.csproj` (`Stripe.net`); new `Payments/StripeGateway.cs`; pay pages: `pay/dues/[duesId]/page.tsx`, `pay/[linkId]/page.tsx`, `pay/club-dues/[duesId]/page.tsx`, `pay/w/[token]/page.tsx`, `pay/club-website/[token]/page.tsx`, `components/wallet/WalletTopup.tsx`; new `src/lib/checkout.ts`
- **Do:**
  1. `CreateCheckoutAsync`: Stripe Checkout Session, `mode=payment`, one line item with `price_data` (currency, `unit_amount` from `Money.ToMinorUnits()`, product name from `Description`), `client_reference_id` and `metadata.merchantOrderId` set to our order id, `customer_email`, `locale` from the payer's language, `success_url` and `cancel_url`. Use the account's key per request (`RequestOptions.ApiKey`), never a process-wide key. Send an idempotency key derived from the merchant order id.
  2. `GetStatusAsync`: retrieve the session and its payment intent.
  3. `ParseAndVerifyWebhook`: `EventUtility.ConstructEvent(rawBody, signatureHeader, account.WebhookSecret)`; handle `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
  4. `RefundAsync`: Refunds API against the payment intent; partial amounts allowed.
  5. Frontend: `startCheckout(session)` in `lib/checkout.ts` switches on `session.kind`: `Redirect` sets `window.location`; `CashfreeSession` and `RazorpayOrder` run today's code, moved here unchanged. The pay pages call it. The gateway scripts are loaded only for the kind in use.
  6. Return page: never trust the redirect. It shows "confirming" and polls the existing verify endpoint, which calls `GetStatusAsync`.
  7. Refund action: `POST api/payments/{flow}/{id}/refund` for the account's owner role, writing `payment_refunds` (Appendix B.11) and marking the payment row.
- **Verify:** test-mode and then live-mode payments in USD, EUR and JPY on a district's own account: checkout, webhook confirmation, receipt email, refund. A forged webhook returns 401.

### WS6-10 PayPal adapter

- **Track:** B · **Depends on:** WS6-09 · **Estimate:** 3.5 days
- **Files:** new `Payments/PayPalGateway.cs`
- **Do:**
  1. Token: `POST /v1/oauth2/token` with the account's client id and secret; cache until expiry per account.
  2. `CreateCheckoutAsync`: `POST /v2/checkout/orders` with `intent=CAPTURE`, `purchase_units[0].custom_id` and `invoice_id` set to our order id, amount as a decimal string with the currency's exponent, `application_context` return and cancel URLs and locale. Return the `approve` link as `RedirectUrl`.
  3. On return: `POST /v2/checkout/orders/{id}/capture` (in the verify endpoint), idempotent through the `PayPal-Request-Id` header.
  4. Webhook: verify through `POST /v1/notifications/verify-webhook-signature` with the account's webhook id and the transmission headers; handle `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`.
  5. Refund: `POST /v2/payments/captures/{id}/refund`.
  6. Currencies PayPal does not support for the account's country are rejected at campaign creation with a translated message.
- **Verify:** sandbox then live payment and refund in USD on a district's own account.

### WS6-11 Platform fee ledger

- **Track:** B · **Depends on:** WS6-06 · **Estimate:** 2 days
- **Files:** `SQL/platform_fee_ledger.sql` (Appendix B.12); `Payments/PlatformFeeLedger.cs`; new SuperAdmin report page `settings/platform-fees`
- **Do:** when a payment on a district or club account is confirmed, write one ledger row: instance, district, flow, order id, gateway, gross amount, currency, the fee percent in force (`Brand:Pricing:PlatformFeePercent`, overridable per district), the computed fee. Refunds write a negative row. The report totals by district and month in each currency and exports to Excel for invoicing. Flag `payments.platformFeeLedger`, off for RIZones (it takes its fee by split).
- **Verify:** ten staged payments and one refund produce the expected totals.

### WS6-12 Gateway coverage by country

- **Track:** A1 · **Depends on:** WS6-07 · **Estimate:** 0.5 day
- **Files:** `RotaryApi/Seeds/payment_gateway_coverage.json`; the Connect screen; dues and event-link creation
- **Do:** a small seed table of `(country ISO, gateway, can_receive)` built from each gateway's published country list at the time of writing, reviewed by BW2. The Connect screen offers only gateways available in the district's country. Creating a dues campaign or event link in a district with no connected account returns `PAYMENTS_NOT_CONFIGURED` with a translated explanation and a link to the Connect screen. A district in a country with no supported gateway is told so and can still record offline payments.
- **Note:** Stripe does not onboard businesses in most African countries and several in South-East Asia and Latin America. Pilot districts are chosen with this table open (section 21, question Q2).

---

## 13. Workstream WS7: privacy

**Owner: BW1.** 3.5 engineer-weeks. Everything here is behind `privacy.enabled`, off for RIZones.

### 13.1 Where personal data lives

Taken from the production schema on 30 September 2026. The full registry with the action per column is Appendix G; this is the shape of the problem.

| Group | Tables | Key |
|---|---|---|
| The member | `member_master_profile`, `member_credentials`, `member_address_details`, `member_family_details`, `password_reset_tokens` | `fk_member_master_profile_id` |
| Memberships and roles | `club_members`, `member_roles`, `sub_group_members`, `board_of_directors`, `past_presidents`, `district_ag`, `district_club_moderator`, `goal_role_assignments`, `goal_oversight_access` | member id |
| **Copies** of name, email, mobile, photo | `district_committee_member`, `district_committee_group_member`, `district_committee_sub_group_member`, `district_governors`, `board_of_directors` (non-member fields), `event_payment_members`, `club_mass_email_recipients`, `club_leadership_email_log`, `district_report_reminder_log` | member id, and sometimes none |
| Devices and sessions | `member_fcm_tokens`, `member_device_sessions`, `mobile_login_otp`, `web_sso_token`, `event_payment_otp` | member id or contact |
| Message logs | `email_log` (**no member key**: `recipient_email`, `cc_emails`, full body), `whatsapp_log` (`recipient_mobile`, `recipient_name`), seven push-log tables, `greeting_send_log` | address or member id |
| Audit | `audit_log`, `login_audit_logs`, `superadmin_audit`, `district_directory_submission_log` | member id, name, IP address |
| Rotary.org cache | `rotary_org_club_members_cache`, `rotary_org_terminated_cache`, `rotary_org_member_recognition`, `sync_exception_log` | Rotary id |
| Payments | dues and event payment rows, `cashfree_kyc` (India only), `potential_members` | member id or contact |
| Health | `member_master_profile.BloodGroup`, `member_family_details.BloodGroup`, `pph_camp_attendance` (blood-sugar values), `pph_camp_attendies` | |
| Assistant | `assistant_conversations`, `assistant_turns` | `fk_member_id` |

**Production also holds about twenty ad-hoc backup tables with full personal data** (`bak_*`, `tmp_spouse_fill`, `_tmp_missing_members`, `temp`, `dedup_norid_log`, `dc_cp_cs_dedup_backup_20260710`). They are not part of the application. ROW starts from an empty database and must never acquire such tables: rule for ROW operations is that any manual backup table is created in a separate schema with a deletion date in its name and removed by the retention job (WS7-07).

**Erasure does not survive the nightly sync today.** `ClubMemberSweepWorker.AddMemberAsync` (line 1755) matches on Rotary id regardless of `isdeleted` (lines 1822 to 1826), sets `isdeleted = 0`, refills email, mobile and date of birth from Rotary.org (lines 2041 to 2063) and un-deletes addresses, family, membership and roles. A hard-deleted profile is inserted again. There is no suppression list. WS7-04 fixes this.

### WS7-01 Personal-data registry

- **Track:** B · **Depends on:** none · **Estimate:** 3 days
- **Files:** new `RotaryApi/Privacy/PersonalDataMap.cs`, `PersonalDataAudit.cs`
- **Do:**

```csharp
public sealed record PersonalTable(
    string Table,
    MemberMatch Match,                 // ByColumn("fk_member_master_profile_id") | ByEmail("recipient_email") | ByMobile("recipient_mobile") | ByRotaryId("RotaryId")
    IReadOnlyList<PersonalColumn> Columns,
    RowAction OnErase,                 // DeleteRow | AnonymiseColumns | Keep
    bool IncludeInExport = true);

public sealed record PersonalColumn(string Name, ColumnAction OnErase, string? ReplaceWith = null);   // Null | Replace | Keep
```

  1. One entry per table of Appendix G. Export and erasure are both driven from this list.
  2. `PersonalDataAudit` runs at startup when `privacy.enabled` is on: it lists columns in `information_schema` whose names match `email|mobile|phone|birth|anniv|blood|address|photo|ip|device|fcm|password|spouse|gender|recipient|member_?name` on tables not in the registry and not on an explicit ignore list, logs them as warnings, and exposes them at `GET api/privacy/registry/unlisted` (SuperAdmin). A pipeline test fails when the list is not empty, so a new table with personal data cannot ship without a registry entry.
- **Verify:** the unlisted endpoint returns an empty list on ROW staging.

### WS7-02 Export a member's data

- **Track:** B · **Depends on:** WS7-01 · **Estimate:** 3.5 days
- **Files:** new `Privacy/MemberExportService.cs`, `Controllers/PrivacyController.cs`; `SQL/privacy_requests.sql` (Appendix B.13); frontend: a "Privacy requests" page for District Admins and a "Download my data" button on the member's own profile
- **Do:**
  1. `POST api/privacy/members/{id}/export` (the member themselves, their District Admin, or SuperAdmin) creates a `privacy_requests` row and queues the job.
  2. The job walks the registry, writes one JSON and one CSV per table into a ZIP with a `README.txt` in the member's language describing each file, stores it under `D:\ROW\media\privacy\<guid>.zip` outside any web-served folder, and emails the requester a link.
  3. `GET api/privacy/exports/{guid}` streams the file to the requester only, for seven days; the retention job deletes it after that.
  4. Every request and download is written to `audit_log`.
- **Verify:** the export for a test member contains a file for every registry table in which the member has rows.

### WS7-03 Erase a member

- **Track:** B · **Depends on:** WS7-01 · **Estimate:** 4 days
- **Files:** new `Privacy/MemberErasureService.cs`; `SQL/member_erasure_tombstone.sql` (Appendix B.14); the Privacy requests page
- **Do:** `POST api/privacy/members/{id}/erase` with a reason (District Admin with a second approval, or SuperAdmin). In one transaction:
  1. Compute `rotary_id_hash = SHA-256(instance salt + RotaryId)`. The salt is a secret in the environment (`Brand__Privacy__TombstoneSalt`).
  2. Apply each registry action. Profile: `MemberName` becomes "Erased member"; emails, mobiles, birth and anniversary dates, blood group, gender, photos, device tokens and `RotaryId` are nulled; `isdeleted = 1`. Credentials, addresses, family rows, device sessions, tokens and OTP rows are deleted. Copies in committee, governor and board tables are overwritten or the row removed where the row exists only to name the person. Message logs have recipient, name and body replaced by a fixed marker. Audit rows keep the member id and lose the name and IP address.
  3. Rows that record an event rather than a person stay, pointing at the anonymised member: payments, attendance, project authorship, report submissions.
  4. Delete the member's files: profile and family photos under the media root.
  5. Purge `rotary_org_club_members_cache` and `rotary_org_terminated_cache` rows for that Rotary id, and the member's `assistant_conversations` and `assistant_turns`.
  6. Insert the tombstone `(rotary_id_hash, erased_at_utc, erased_by, reason, fk_club_id)`.
  7. Audit row. Close the `privacy_requests` row.
- **Verify:** after erasure, a search of every registry table for the member's former email, mobile and name returns nothing (an automated check in the erasure test walks the registry).

### WS7-04 Make erasure survive the sync

- **Track:** B · **Depends on:** WS7-03, WS8-01 · **Estimate:** 2 days
- **Files:** `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs` (`AddMemberAsync` at `:1755`, before the profile fetch at `:1781`; the update path at `:1535`), `MemberSyncWorker.cs:119`, the cache refresh, `BodSyncWorker.cs`
- **Do:** a shared `TombstoneCheck` loads all hashes once per run into a `HashSet<string>` (the table is small). `AddMemberAsync`, the update path, `--member-sync`, the cache refresh and the board sync each compute the hash of the incoming Rotary id and skip when it is present, counting skips in the run log. Skipping before the profile fetch also saves the API call.
- The member remains on the club's roster at Rotary.org, so the club's count in ROW is lower by the number of erased members. The club page shows "N members (1 not shown at their request)" from a count of tombstones per club. Reports that compare with Rotary.org counts add the tombstone count.
- **Verify:** erase a staging member; run the sweep for that club; the member is not recreated and no personal field is repopulated.
- **RIZones check:** the tombstone table is empty on RIZones; the check is one empty set lookup.

### WS7-05 Consent

- **Track:** B · **Depends on:** WS1-08 · **Estimate:** 3 days
- **Files:** `SQL/member_consents.sql` (Appendix B.15); new `Privacy/ConsentService.cs`; `GET/POST api/privacy/consent`; frontend: a blocking dialog mounted in `ClientProviders.tsx`; the mobile app (section 16)
- **Do:**
  1. Members are created by the sync and never sign up, so consent is taken at **first sign-in after the policy version changes**: a blocking screen shows the policy summary in the member's language with links to the full texts, and records `(member, policy_version, accepted_at_utc, language, ip)`. The version is `Brand:Legal:PolicyVersion`.
  2. `consent.requiredFor` in the brand lists message categories that need consent: by default `["greeting", "announcement", "event", "newsletter", "marketing"]`. Transactional messages (one-time passwords, receipts, dues reminders the member's own club sends about the member's own dues) do not.
  3. The senders check it: the WhatsApp decorator of WS6M-09, the email scheduled-send service and the push services skip members without consent and log the skip.
  4. A member can withdraw in their profile; withdrawal is a new row with `withdrawn_at_utc`.
  5. A member who has never signed in has no consent and receives transactional messages only.
- **Verify:** a new ROW member sees the screen once; declining signs them out; a member without consent does not receive an announcement by WhatsApp and does receive an OTP.

### WS7-06 Legal pages, cookie notice, contact

- **Track:** A1 · **Depends on:** WS1-09, WS2-12 · **Estimate:** 1 day
- **Do:** the three policy pages and a cookies page render counsel's text per language from `content/legal/<lang>/` selected by the brand; the footer links come from `Brand:Legal`. A cookie notice appears on ROW for visitors where the brand's `Legal.CookieNotice` is on; the app sets only necessary cookies (session, language), so the notice is informational with no consent wall, unless counsel says otherwise. The privacy contact address is `Brand:Support:PrivacyEmail`.
- **Verify:** the ROW policy pages show ROW's entity and contact in each available language.

### WS7-07 Retention

- **Track:** B · **Depends on:** WS4-03 · **Estimate:** 1 day
- **Files:** new `Privacy/RetentionBackgroundService.cs`; `Brand:Privacy:Retention`
- **Do:** a daily instance-wide job deletes rows older than the configured age: `email_log` bodies (keep the row, null the body) after 180 days; `whatsapp_log` after 365; push logs after 90 (extending `PushLogCleanupBackgroundService`); `login_audit_logs` after 365; `mobile_login_otp`, `event_payment_otp`, `password_reset_tokens`, `web_sso_token` after 7; export ZIP files after 7; `assistant_turns` after 365. Defaults for RIZones are "keep" (no deletion) so behaviour there does not change.
- **Verify:** on ROW staging with shortened ages, the job removes exactly the expected rows.

---

## 14. Workstream WS8: Rotary.org sync at ROW scale

**Owner: F1.** 3.5 engineer-weeks. This workstream also improves RIZones: it removes a job that runs through the whole Indian working day once a week.

### 14.1 Today, measured

| Job | Schedule | Duration for 4,187 synced clubs |
|---|---|---|
| Member sweep (`--member-sweep`) | nightly | 78 to 103 minutes |
| Board of directors sync (`--bod-sync`) | weekly | **18.4 to 19.0 hours**, ending about 22:30 India time |
| Club reconcile, delta, repair, country sync | nightly | under 3 minutes each |

- The sweep processes clubs **one at a time**. Per club: three list calls (active, honorary, terminated) plus **one profile call for every listed member**, changed or not (`UpdateMemberAsync` called for each at `ClubMemberSweepWorker.cs:1298`, fetching the profile at `:1535`; new members at `:1781`).
- The log cannot tell a full sweep from the daily-delta mode (same `SyncType`) and has no per-club or per-call counts. **Measure before sizing** (WS8-02).
- A bounded-parallel pattern already exists in the same class for two other modes (`SemaphoreSlim` at lines 421 and 564, `--concurrency N`, default 6). The main sweep does not use it.
- ROW's regions hold about 22,000 clubs in the reference data (North America 8,122; Europe's seven largest countries 5,268; East and South-East Asia 4,293; Latin America's five largest 3,467; Africa's six largest 928). At today's cost per club the nightly run would take about eight hours and the board sync about four days.
- Scope is decided only by `club_master.IsSyncedFromRotaryOrg = 1`. Exempt districts `5656`, `1280` and `IFRM India` are literals at 25 places in 13 files; the country list (India, Sri Lanka, Nepal) at 16 places in 10 files (Appendix I, sections G22 and G23).
- All three workers read `appsettings.json` only, as `SYSTEM`, from the RIZones web folder.

### WS8-01 Scope and configuration for workers

- **Track:** A1 · **Depends on:** WS1-01 · **Estimate:** 2 days
- **Files:** new shared project `Rotary.Configuration` (linked `BrandOptions`, `Brand`, the overlay); the three workers' `Program.cs`; every file of Appendix I, sections G22 and G23; `RotaryOrgFoundationSyncController.cs:69`
- **Do:**
  1. Workers build configuration as: `appsettings.json`, then the file named by `BRAND_FILE` if set, then environment variables; then `Brand.Initialise(...)`.
  2. `Brand:Scope` supplies `Zones`, `Countries` (ISO codes), `ExemptDistricts`, `PulledZoneNames`. Defaults are today's literals. Replace the literals with `Brand.Current.Scope` reads.
  3. Each instance has its own `RotaryOrgApi` credentials in its environment.
  4. Every worker log line and every `rotary_org_sync_log` row carries the instance code.
- **Verify:** on a default brand the scope values equal the old literals (snapshot test); a ROW worker pointed at ROW staging opens no connection to the RIZones instance (check the MySQL general log during a run).

### WS8-02 Per-club measurement

- **Track:** A1 · **Depends on:** none · **Estimate:** 1 day
- **Files:** `SQL/rotary_org_sync_club_log.sql` (Appendix B.16); `ClubMemberSweepWorker.cs`, `BodSyncWorker.cs`, `RotaryOrgApiClient.cs`
- **Do:** record per club and run: start, duration, API calls (counted in the client), profiles fetched, inserted, updated, removed, error. Add a `Mode` value to `rotary_org_sync_log` that distinguishes full sweep, daily delta and member sync.
- **Verify:** deploy to RIZones and collect one week. The week's data sets the real numbers for WS8-03 to WS8-07 and for Gate B's capacity line.
- **RIZones check:** one insert per club per run; no behaviour change.

### WS8-03 Fetch a profile only when something changed

- **Track:** B · **Depends on:** WS8-02 · **Estimate:** 4 days
- **Files:** `SQL/member_rotary_last_updated.sql` (adds `member_master_profile.RotaryLastUpdatedUtc DATETIME NULL`); `ClubMemberSweepWorker.cs` (`:1298`, `:1535`, `:1781`)
- **Do:** behind `sync.conditionalProfiles` (default off):
  1. List calls per club, and the diff for adds and removals, are unchanged.
  2. Fetch the full profile only when the member is new, or the listed last-updated stamp is later than the stored `RotaryLastUpdatedUtc`, or the member's id appears in `/individuals/updates` for the window since the club's last successful sweep (the endpoint `--member-sync` already uses), or the stored stamp is null.
  3. Store the stamp after a successful update.
  4. If the list payload turns out not to carry a usable stamp for some member types (confirm against real responses in step 1 of WS8-04), those members are covered by the updates window and by the rolling verification.
- **Verify:** WS8-04.

### WS8-04 Prove it equals the full sweep, then switch

- **Track:** B · **Depends on:** WS8-03 · **Estimate:** 1 day
- **Do:**
  1. A compare mode `--member-sweep --compare-conditional --club-id-file <sample>`: for a tenth of clubs, compute what the conditional path would fetch and update, run the full path, and report every member the full path changed that the conditional path would have skipped.
  2. Run nightly on RIZones for a week. Any reported difference is a defect in the conditions; fix and restart the week.
  3. After a clean week, turn the flag on for all RIZones clubs.
- **Verify:** seven consecutive nights with zero differences, recorded in the gate report.

### WS8-05 Rolling full verification

- **Track:** B · **Depends on:** WS8-04 · **Estimate:** 1.5 days
- **Do:** each night, clubs where `pk_club_id % 7 == (int)today.DayOfWeek` get the full path regardless of stamps. Every club is fully verified weekly without one long run. Differences found are logged as `conditional_miss` so the conditions can be tightened.

### WS8-06 Bounded parallelism in the sweep

- **Track:** B · **Depends on:** WS8-03 · **Estimate:** 1.5 days
- **Files:** `ClubMemberSweepWorker.cs` (the main loop), reusing the `SemaphoreSlim` pattern at `:421`
- **Do:** process clubs with `--concurrency N` (default 4 for the sweep), one database connection per club task, behind the rate-limit handling that exists in `RotaryOrgApiClient.cs:214-225`. Back off globally when the API answers 429. A member who belongs to two clubs processed at the same time is protected by taking a named lock on the Rotary id (`GET_LOCK`) around the profile upsert.
- **Verify:** same results as the sequential run on a sample (row comparison); wall-clock time recorded.

### WS8-07 Board sync: current years nightly, history once

- **Track:** B · **Depends on:** WS8-02 · **Estimate:** 3 days
- **Files:** `BodSyncWorker.cs`, the task definitions
- **Do:** the nineteen hours come from walking each club's officers from its charter year to the current year plus two. Change the nightly run to cover the current and the next Rotary year only. The full history runs once when a club is first synced (a flag column `club_master.BodHistorySyncedAt`), and on demand with `--bod-sync --full --club-id`. Add the parallelism of WS8-06.
- **Verify:** RIZones nightly board sync completes in under 30 minutes; a sample of clubs compared against a full run shows identical current-year officers.

### WS8-08 One schedule file for both instances

- **Track:** A1 · **Depends on:** WS0-04 · **Estimate:** 2 days
- **Files:** new `tools/schedule.json`, `tools/apply-schedule.ps1`; replaces the fifteen XML files of Appendix I, section G11
- **Do:**
  1. `schedule.json` lists every scheduled job for both instances: `{ instance, name, exe, args, trigger (daily HH:mm | every N minutes | weekly day HH:mm), weight: "heavy"|"light", expectedMinutes, timeLimit, account }`. Times are server time (India time).
  2. `apply-schedule.ps1 -Instance <name>` creates or updates Task Scheduler tasks named `<Instance>-<name>`, pointing at the current release folder through a stable junction (`D:\ROW\workers\current`), running as the instance's service account, with "do not start a new instance if already running" and the time limit set.
  3. A check fails the deploy when two `heavy` jobs on the server overlap, using `expectedMinutes` plus a 30-minute margin, across both instances.
  4. Placement: RIZones heavy jobs end before 08:00 India time. ROW's heavy jobs are split by region so each runs in that region's night: Asia-Pacific, Europe and Africa, Americas. The region of a club is derived from its district's time zone.
  5. The deploy script calls `apply-schedule.ps1`.
- **Verify:** the generated tasks match the file; adding an overlapping heavy job fails the check.

### WS8-09 Remove superseded and stale tasks

- **Track:** A1 · **Depends on:** WS8-08 · **Estimate:** 0.5 day
- **Evidence:** in the repository's task definitions, `ClubsRepairSync-Nightly` and `ClubReconcile-Nightly` both start at 02:00 although the latter's description says it replaces the former; `MemberSweep-Nightly` and `MemberSync-Nightly` both start at 02:30; two weekly tasks still point at the old `rizones4567.org` folder. The sync log shows the sweep actually starting at 04:00, so the server's registered tasks differ from the repository.
- **Do:** list the tasks actually registered on the server (`Get-ScheduledTask`), compare with the repository's XML files, decide each with the lead developer, and express the result in `schedule.json`. Delete the XML files once the schedule file is live.

### WS8-10 First load for a ROW district

- **Track:** A1 · **Depends on:** WS8-01, WS5-05 · **Estimate:** 1 day
- **Do:** write the runbook and run it on ROW staging for the pilot districts: (1) `--world-ensure` and `--world-sync` limited by `Brand:Scope` to create zones, districts and clubs; (2) set each district's time zone, currency and default language; (3) `--bootstrap` for the clubs; (4) `--member-sweep --club-id-file` for the pilot clubs; (5) `--bod-sync --full` for the same; (6) verify counts against Rotary.org's own figures for five clubs; (7) assign the first District Admin. Record durations and API call counts from the per-club log.
- **Verify:** a pilot district's clubs, members and officers are present on ROW staging and the RIZones database received no write during the run.

---

## 15. Workstream WS9: visual brand

**Owner: F2.** 0.5 engineer-week.

**Decision: no recolour for launch.** Both products are Rotary products; Rotary International prescribes the same royal blue and gold for both. ROW is distinguished by its name, logo lockup, domain, contacts and legal pages, all delivered by WS1. The code has 1,290 hex colour literals in 140 files and 2,334 `*-blue-*` classes in 292 files; recolouring is a separate, later piece of work (about one engineer-week plus visual review) if the product owners ask for it.

### WS9-01 Metadata, favicon, manifest, social images

- **Track:** A1 · **Depends on:** WS1-08 · **Estimate:** 1 day
- **Files:** `src/app/layout.tsx` (lines 15 to 18), `src/app/(site)/layout.tsx` (lines 26 to 28), `public/` icons, any `manifest.json`, Open Graph images, `club-website` layout metadata
- **Do:** replace the static `metadata` export with `generateMetadata()` that fetches the brand (server-side, cached for an hour) for title template, description, icons and Open Graph image. Brand image files live under the instance's media root and are referenced by URL from the brand, never bundled.
- **Verify:** the browser tab, a shared link preview and the mobile home-screen icon on ROW staging show ROW.

### WS9-02 No new colour literals

- **Track:** B · **Depends on:** WS2-04 · **Estimate:** 0.5 day
- **Do:** enable the hex-literal lint rule of section 7.3 for scoped files that are already free of them, and add a `// eslint-disable-next-line` count budget per file for the rest so the number can only go down.

### WS9-03 Brand asset pack

- **Track:** A1 · **Depends on:** the product owners · **Estimate:** 1 day
- **Do:** collect and place: logo (light and dark backgrounds, SVG and PNG at 1x and 2x), favicon set, email header image (600 pixels wide), PDF header logo, Open Graph image (1200 by 630), app icons and splash (section 16), WhatsApp business profile image. Check each against Rotary International's brand guidelines for the use of the Rotary wheel in a lockup. Record the file names in the ROW brand file.

---

## 16. Workstream WS10: mobile app

**Owner: F2 (build, stores, translation) and F1 (locale, time, payments).** The Flutter app is in a separate repository and was **not measured** for this plan. Its effort is outside the 48 engineer-weeks. **Task WS10-00 is to measure it in week one**; until then the pilot's app scope is a risk (section 20, R3).

### WS10-00 Measure the app

- **Track:** A1 · **Estimate:** 1 day
- **Do:** in the app repository count: hard-coded strings in widgets; uses of `en_IN`, `₹`, `INR`; `DateTime.now()` used for a "today"; `+91` and ten-digit assumptions; the base URL and any `rizones` literal; the brand name; the payment SDKs in use; existing flavours. Produce the same kind of table as section 1.5 and add it to this document as section 16.1. Confirm the app reads API error bodies by the `message` property and ignores unknown properties (needed by WS2-14 and WS3-02).

### WS10-01 Two flavours from one codebase

- **Track:** A1
- **Do:** Android product flavours and iOS schemes `rizones` and `row`: separate application id and bundle id, name, icons, splash, Firebase project (`google-services.json` and `GoogleService-Info.plist` per flavour), API base URL through `--dart-define`. No `if (flavor == ...)` in feature code: differences come from the brand endpoint, as on the web.

### WS10-02 Brand and feature flags from the API

- **Track:** A1
- **Do:** call `GET api/public/brand` at start (cached on device); a `BrandScope` inherited widget provides name, logos, support contacts, languages, currencies and flags. Replace literals.

### WS10-03 Translation

- **Track:** A1 in English; A2 for the first translated language; B for all eight
- **Do:** `flutter_localizations` with ARB files generated from the same source as the web where the wording is shared (export from `messages/en/common.json` for common terms); ICU plurals; the language follows the device, overridable in settings and stored through `PUT api/members/me/language`. Noto fonts for Japanese and Korean are system fonts on both platforms; verify rendering. Send `Accept-Language` on every request. Show server errors through a `code` lookup with `message` as fallback.

### WS10-04 Locale and time

- **Track:** A1
- **Do:** `intl` `NumberFormat.currency(locale, name: currency)` and `DateFormat` with the device locale; currency and district zone from `my-context`. Parse timestamps with offsets; show calendar dates without conversion. "Today" from `my-context.today`.

### WS10-05 Phone numbers and sign-in

- **Track:** A1
- **Do:** a country picker with every country of `country_master`; validation through a libphonenumber port; stop prepending `+91`. One-time password entry states which channel the code was sent through (the API returns it).

### WS10-06 Payments

- **Track:** A1
- **Do:** when the checkout session kind is `Redirect`, open the URL in an in-app browser tab (Custom Tabs, `SFSafariViewController`) and return through a deep link to the verify screen, which polls the verify endpoint. The Cashfree and Razorpay SDKs are included only in the `rizones` flavour. Apple and Google both permit external payment for real-world membership dues; record this reasoning in the store review notes.

### WS10-07 Push notifications

- **Track:** A1
- **Do:** a separate Firebase project for ROW; its service-account key in the ROW API's environment; `member_fcm_tokens` is per instance already because the databases are separate. APNs key for the ROW bundle id.

### WS10-08 Privacy in the app

- **Track:** B
- **Do:** the consent screen of WS7-05; "Download my data" and "Delete my account" entry points (the second is required by both stores and creates an erasure request for the District Admin's approval); blood group and family fields hidden by flag.

### WS10-09 Store listings

- **Track:** A1 for test tracks; B for public release · **Lead time: start in week one**
- **Do:** Apple Developer and Google Play accounts for the ROW entity; listings, screenshots and descriptions in the launch languages; privacy nutrition labels and the data-safety form from the registry of Appendix G; age rating; TestFlight and Play internal testing for the pilot; allow one to two weeks for first review.

---

## 17. Workstream WS11: regression, pilot and launch

**Owner: lead developer, with all four engineers.** 2 engineer-weeks.

### WS11-01 Pilot test plan

- **Track:** A1 · **Estimate:** 2 days
- **Do:** a written script of the pilot journeys, run by a person in each pilot language on ROW staging and again on production before the districts are invited: sign in by each OTP channel; change language; view directory and a member; add an announcement scheduled in the district's zone; create a dues campaign in the district's currency; pay it by card; receive the receipt by email and WhatsApp; refund it; add a project with photos; submit a club monthly report and download the PDF. From A2: receive a birthday greeting on the right local date and a WhatsApp reminder in the pilot language. From B: open the club website. Each step records pass or fail with a screenshot.

### WS11-02 Full regression on both instances

- **Track:** A1 (1.5 days) and again before B (1.5 days) · **Estimate:** 3 days (1.5 before each gate)
- **Do:** smoke suites, journeys and the assistant eval on both instances; a manual pass over every module on RIZones staging by the engineer who did not change it; comparison of the week's RIZones error rate and p95 per route with the baseline of WS0-02.

### WS11-03 Load and capacity check

- **Track:** B · **Estimate:** 1.5 days
- **Do:** with the first-wave zones loaded on ROW staging, run the nightly jobs for both instances on the production server's schedule while replaying an hour of RIZones read traffic against staging (from `api_request_stats` proportions). Record CPU, memory per pool, MySQL buffer-pool hit rate for both instances and disk latency. Gate B's capacity line is judged on this.

### WS11-04 Runbooks

- **Track:** A1 · **Estimate:** 1.5 days
- **Do:** one page each in `docs/runbooks/`: deploy and roll back; restore a database; rotate a secret; onboard a district (the runbook of WS8-10); connect a district's payments; submit and track a WhatsApp template; handle a privacy request; a payment dispute; the ROW server is down; the sync failed; add a language.

### WS11-05 Pilot support

- **Track:** A1 · **Estimate:** 2 days spread over the pilot
- **Do:** a shared channel with the pilot districts' admins; a daily check of errors, failed payments, failed messages and sync results for the first two weeks; defects triaged the same day into `blocking`, `before launch`, `later`.

# Part C. Schedule, gates, risks and decisions

## 18. Schedule

### 18.1 Dependencies

```
WS0 safety net ─────────────► every other workstream merges only after WS0-01, WS0-02, WS0-03 are live
S-02 staging database ──────► WS0-03 smoke suite, and every "verify on staging" step
WS1-01 BrandOptions ────────► WS1-*, WS2-17, WS3-05, WS4-01, WS6-03, WS6M-*, WS8-01
WS1-03 brand endpoint ──────► WS1-08 BrandProvider ──► WS2-02, WS3-01, WS9-01
WS4-01 district zone ───────► WS3-02 district context ──► WS3-04, WS4-07
WS4-02 clock ───────────────► WS4-03 schedule ──► WS4-04, WS4-05, WS7-07
WS4-06 output offsets ──────► WS4-07 input boundary
WS3-05 Money ───────────────► WS6-03 ──► WS6-04 ──► WS6-06 ──► WS6-09 Stripe ──► WS6-10 PayPal
WS6-07 connected accounts ──► WS6-09, WS6-12
WS5-01 taxonomy codes ──────► WS5-02 ──► WS5-03 seeder ──► WS5-04, WS5-05, WS2-25, WS6M-04
WS2-01, WS2-02 ─────────────► WS2-04 ──► WS2-05 codemod ──► WS2-06 … WS2-12 (extraction, in order)
WS2-13 error types ─────────► WS2-14, WS2-15 ──► WS2-16
WS2-17 ──► WS2-18 template engine ──► WS2-19 ──► WS2-20, WS2-21
WS6M-02 E.164 ──────────────► WS6M-03 ──► WS6M-04 ──► WS6M-05; WS6M-06
WS7-01 registry ────────────► WS7-02, WS7-03 ──► WS7-04 (also needs WS8-01)
WS8-02 measurement ─────────► WS8-03 ──► WS8-04 ──► WS8-05, WS8-06; WS8-07
WS0-04 deploy script ───────► WS5-04, WS8-08 ──► WS8-09, S-11
```

Outside lead times that start on day one, because no amount of engineering shortens them: Meta business verification and template approval (WS6M-01), United States SMS registration (WS6M-01), the ROW domain and Cloudflare (S-09), app store accounts and first review (WS10-09), translation reviewers for eight languages (WS2-29), counsel's policy texts (WS7-06), the pilot districts' own Stripe accounts (WS6-07).

### 18.2 Capacity against the three gates

| Gate | Work (task estimates) | Calendar | Gross capacity (4 engineers) | Notes |
|---|---|---|---|---|
| A1 English pilot | 98.5 days = 19.7 engineer-weeks | 5 October to 13 November, 6 weeks | 120 days, less about 8 for Diwali (8 November) = 112 days = 22.4 engineer-weeks | The difference, 13.5 days, is all there is for the mobile app (unmeasured), production incidents and anything RIZones needs |
| A2 first translated pilot | 47 days = 9.4 engineer-weeks | 16 November to 4 December, 3 weeks | 60 days, less pilot support and a quarter for RIZones = about 43 days | Fits only because F2 starts the translation framework (7 days of it) during October |
| B launch | 94.5 days = 18.9 engineer-weeks | 7 December to 29 January, 8 weeks | 160 days, less about 12 for year-end holidays, less a quarter for RIZones = about 111 days | About 16 days remain for the app's translation and store release. If the app needs more, B moves |

Three conclusions:

1. **A1 on 15 November requires all four engineers on ROW for six weeks with no RIZones feature work.** Urgent RIZones fixes are the only exception.
2. **The translated pilot cannot be ready by 15 November.** Its 47 days are additional to A1's 98.5. 7 December is the earliest realistic date and depends on the reviewer receiving the strings by 27 November.
3. **Late January is the earliest possible launch, not the expected one.** Every engineer-week of work beyond this plan (app, RIZones features above a quarter of the team's time, defects from the pilot) moves Gate B by about a working day and a quarter. The gate decides the date; the calendar does not.

How assisted coding changes this: it shortens the mechanical, test-checked work (string extraction, the formatting codemod, URL and brand literal replacement, characterisation tests) by perhaps a third, which is worth about six engineer-weeks across WS2 and WS3, almost all of it after A1. It does not shorten provider adapters, the time boundaries or the sync redesign, where the effort is in understanding and verifying behaviour.

### 18.3 RIZones feature work during the build

- **5 October to 13 November:** none. Production fixes only, decided by the lead developer.
- **16 November to Gate B:** at most a quarter of the team's time, planned weekly.
- Anything larger is a decision for the product owners with its effect on Gate B stated in days (section 21, question Q4).

### 18.4 Weeks 1 to 6: to the English pilot

Task ids only; details are in Part B. "Stg" means ROW staging. Freeze for A1 scope is **Friday 6 November**.

| Week | BW1 | BW2 | F1 | F2 |
|---|---|---|---|---|
| **1** · 5 to 9 Oct | WS0-01, WS0-02 (both live on RIZones by Friday), WS1-01, WS1-03, S-01 | WS6M-01 (lead times), WS6-01 (log-only release), WS6-02, WS6-03 | S-02, S-03, WS3-05 | WS10-00 (measure the app), WS10-09 (store accounts), WS3-01 |
| **2** · 12 to 16 Oct | WS0-03, WS0-04, WS1-02, WS1-04 | WS6-01 (enforce), WS6-04, WS6-06 (start) | WS8-02 (live on RIZones), WS4-02, WS4-01, WS3-02 | WS0-05, WS1-08, WS1-09, WS1-10 |
| **3** · 19 to 23 Oct | WS0-06, WS0-07, S-05, S-06, S-08 (Stg phase 1 up), WS1-05, WS1-06, WS1-07 | WS6-06, WS6-07, WS6-12 | WS4-06, WS4-03 (start) | WS3-04, WS3-03 (money on dues, pay and dashboard pages) |
| **4** · 26 to 30 Oct | WS5-01, WS5-02, WS5-03 (start) | WS6-09 (Stripe), WS6M-07 | WS4-03, WS4-04, WS4-08 (pilot part), WS8-01 (start) | WS4-07, WS9-01, WS7-06 |
| **5** · 2 to 6 Nov | WS5-03, WS5-04, WS5-05 (Stg phase 2: empty database, seeded), S-07, S-09, S-11, WS1-11 | WS2-17, S-04, S-10, WS1-12, Stripe live-mode tests and refund | WS8-01, WS8-08, WS8-09, WS8-10 (load pilot districts on Stg) | WS9-03, WS10-01 to WS10-07 (app flavour, brand, locale, sign-in, payment redirect, push) |
| **6** · 9 to 13 Nov | ROW production: repeat S-05 to S-09 for production, first deploy, seed, sync the pilot districts | Production payment check with each pilot district's own Stripe account | WS11-02 (regression), time checks on production | App to TestFlight and Play internal testing; WS11-02 |

The lead developer: reviews throughout; WS11-01 (pilot test plan) in week 4; WS11-04 (runbooks) in weeks 5 and 6; the Friday gate report every week; the go or no-go for A1 on **Friday 13 November**. Pilot districts are invited on Monday 16 November; WS11-05 (pilot support) starts that day.

**ROW staging comes up in two phases.** Phase 1 (week 3): the ROW brand configuration over a copy of the scrambled RIZones staging database, so brand, locale, time and payments can be verified early on realistic data. Phase 2 (week 5): an empty database created by `DatabaseInitializer`, seeded from files and loaded by the sync for the pilot districts, which is what production will be.

**What slips first if a week is lost**, in this order: WS8-08 and WS8-09 (create the ROW tasks by hand for the pilot), WS9-01 (static ROW metadata), WS6-12 (the pilot districts are known), WS1-10 for family details (keep blood group). Nothing from WS0, WS4, WS5 or WS6-01 to WS6-09 may slip: those are the difference between a pilot and an incident.

### 18.5 Weeks 7 to 9: to the first translated pilot

| Week | BW1 | BW2 | F1 | F2 |
|---|---|---|---|---|
| **7** · 16 to 20 Nov | WS2-13, WS2-14 (top ten), WS2-07 (with F2) | WS6M-02, WS6M-03 | WS4-05, WS2-15 (server part), WS2-08 (pilot modules) | WS2-01 to WS2-05 if not already done in October, WS2-06, WS2-07 |
| **8** · 23 to 27 Nov | WS2-08 (pilot modules), WS2-26 (parity checks) | WS6M-04, WS6M-05, WS2-09 | WS3-03 (extracted directories), app strings for the pilot language | WS2-15 (client part), WS2-29; **strings to the reviewer by Friday 27 November** |
| **9** · 30 Nov to 4 Dec | Fixes from the pseudo-locale and the reviewer | WS6M-06, WS6M-08, WS2-18, WS2-19, WS2-20 (dues receipt and reminder) | App build in the pilot language | Import the reviewed strings, reduced crawl (English and the pilot language), fixes |

Go or no-go for A2 on **Friday 4 December**; the translated district starts on Monday 7 December.

### 18.6 Weeks 10 to 17: to launch

| Engineer | Work, in order |
|---|---|
| **BW1** | WS7-01, WS7-03, WS7-04, WS7-02, WS7-05, WS7-07; WS2-16; WS2-25; WS2-10 (with F1); WS5-06 |
| **BW2** | WS6-05, WS6-08, WS6-10 (PayPal), WS6-11; WS2-20 (rest), WS2-21; WS2-27; WS6M-09 |
| **F1** | WS8-03, WS8-04 (one clean week on RIZones), WS8-05, WS8-06, WS8-07; WS4-08 (rest); WS2-10 (with BW1), WS2-11; WS11-03 |
| **F2** | WS2-08 (remaining modules), WS2-12, WS2-14 (rest), WS2-22, WS2-23, WS2-24, WS2-28, WS2-30; WS3-03 (rest); WS9-02; the app in all eight languages; WS10-08; WS10-09 public listings |

Fixed points in this period:

| Date | Event |
|---|---|
| Friday 18 December | WS8-03 on for a tenth of RIZones clubs; WS7-03 and WS7-04 on ROW staging |
| 24 December to 1 January | Reduced capacity. No releases to RIZones production between 24 December and 1 January |
| Friday 8 January | **String freeze**: every scoped directory extracted, every email and document label templated. After this date a new user-facing string needs the lead developer's approval |
| Friday 22 January | All eight languages reviewed and imported; crawl green; WS11-03 capacity run complete |
| Friday 29 January | Go or no-go for Gate B |

### 18.7 What ships to RIZones, week by week

Everything merges to `main` and reaches RIZones in the Thursday release behind India defaults.

| Release | Reaches RIZones |
|---|---|
| 8 Oct | Health endpoint, request statistics (baseline starts), Cashfree webhook verification in log-only mode |
| 15 Oct | Smoke suite running after every deploy; scripted deploy; webhook verification enforced; event-payment webhook fix; per-club sync log; `BrandOptions` with no `Brand` section |
| 22 Oct | Pipeline required on `main`; URL and domain helpers; CORS from configuration; Cashfree behind the gateway interface; `format.ts` with the old helpers delegating; brand provider |
| 29 Oct | Webhook router; "today" fix in the browser (WS3-04); offset converter (flag off); `ILocalSchedule` for timed services; taxonomy codes |
| 5 Nov | Seeder (no-op on RIZones); OTP dispatcher (same policy); worker configuration loader; schedule file; product name from the brand |
| 19 Nov onwards | Translation framework (English only on RIZones); error codes; WhatsApp sender interface (same payloads); email templates in English; then weekly as B-track tasks complete |

ROW-only behaviour (Stripe, PayPal, Cloud API, Twilio, offsets, privacy endpoints, other languages) is in the same builds behind flags RIZones does not set.

## 19. Gates

A gate is passed when every line is true and the lead developer records it in the gate report. A line that is not true is either fixed or the gate moves; lines are not waived.

### 19.1 Gate A1: English pilot

**RIZones is safe**
- [ ] Smoke suite and journeys green on RIZones production after each of the last three releases.
- [ ] RIZones 5xx rate and p95 per route for the last 7 days are within 10 percent of the baseline from WS0-02.
- [ ] Every A1 task that changes shared code has run in RIZones production for at least 7 days.
- [ ] No committed secret remains (`gitleaks` clean on full history); all rotated.
- [ ] A restore from offsite backup has been performed and timed (S-04).
- [ ] Cashfree webhook verification is enforcing on RIZones.

**ROW is isolated**
- [ ] ROW runs in its own MySQL instance, application pools, service account and media folder; no ROW credential can read a RIZones schema (tested).
- [ ] ROW pools have memory and CPU limits; stopping any ROW component does not affect RIZones (tested).
- [ ] Monitoring alerts fire for both instances (tested by stopping ROW staging).
- [ ] ROW backups run and one restore has been tested.

**ROW works for the pilot districts**
- [ ] No RIZones name, logo, domain, phone number or rupee sign on any page of the pilot test plan, in any email it triggers, or in the receipt PDF.
- [ ] Every timestamp on the pilot journeys shows in the viewer's zone; a scheduled announcement publishes at the district's local time; calendar dates do not shift.
- [ ] Money shows in the district's currency with the right decimals on screen, in email and in the PDF.
- [ ] Sign-in by emailed code works for a member in each pilot country.
- [ ] A live card payment on each pilot district's **own** Stripe account completes, is confirmed by webhook with the browser closed, produces a receipt, and is refunded. A forged webhook is rejected.
- [ ] The pilot districts' clubs, members and officers are loaded from Rotary.org and match Rotary.org's counts for five sampled clubs; no write reached the RIZones database during the load.
- [ ] Master data on ROW matches the seed files; ids of roles, designations and taxonomy equal RIZones'.
- [ ] Blood group is absent everywhere on ROW.
- [ ] The ROW privacy policy, terms and refund policy are counsel's texts and name the ROW entity.
- [ ] The app's ROW flavour is installable from TestFlight and Play internal testing and completes sign-in, directory and a dues payment.
- [ ] The pilot test plan (WS11-01) has been run on ROW production with every step passing.

**Operations**
- [ ] Runbooks exist for deploy and rollback, restore, onboarding a district, connecting payments and "ROW is down".
- [ ] A rollback of ROW production has been rehearsed.
- [ ] The pilot districts have a named contact and a support channel.

### 19.2 Gate A2: first translated pilot

- [ ] All of A1 still true.
- [ ] Every page on the pilot test plan is fully bracketed in the pseudo-locale (no untranslated text).
- [ ] The pilot language is reviewed by a native speaker who knows Rotary; the glossary was applied.
- [ ] The reduced crawl (English and the pilot language, 1280 and 390 pixels) is green: no missing keys, no overflow.
- [ ] The ten most common server errors appear in the pilot language.
- [ ] Sign-in, password and dues emails are in the member's language with correct money and dates.
- [ ] One-time password and dues reminder reach a handset in the pilot country by WhatsApp in the pilot language (or, if Meta approval has not arrived, the gate records that WhatsApp is not yet offered and email is used).
- [ ] Birthday greetings go out on the member's local date.
- [ ] RIZones is still English-only and unchanged: journeys green, English message files produce identical text.

### 19.3 Gate B: launch

**Languages**
- [ ] Crawl green for all eight languages on every route in `i18n-scope.json` at both widths.
- [ ] Every language reviewed by a native speaker; none is listed in the brand unless reviewed.
- [ ] Every email template, document label, master-data label and launch WhatsApp template exists in all eight languages (`i18n-check` green with no `--allow-missing`).
- [ ] PDF glyph test green; a Japanese and a Korean receipt and club monthly report render correctly.
- [ ] Public club sites render in the club's language with working menus.

**Payments and messages**
- [ ] Stripe and PayPal: live payment, webhook and refund on a district-owned account; Stripe in USD, EUR and JPY.
- [ ] Platform fee ledger totals match a hand calculation for a sample month.
- [ ] Districts in countries without a supported gateway are told so and can record offline payments.
- [ ] One-time password and the four launch templates are delivered in the United States, United Kingdom, Brazil and Japan in the recipient's language.

**Privacy**
- [ ] Export contains every registry table; erasure leaves no personal value in any registry table; the next sync does not recreate the member.
- [ ] Consent is recorded at first sign-in; members without consent receive transactional messages only.
- [ ] The registry audit reports no unlisted personal column.
- [ ] Counsel has confirmed the lawful basis for synced members who have not signed in (question Q6) or the product owners have accepted the risk in writing.

**Scale**
- [ ] With the first launch wave's clubs loaded, the nightly sync for both instances completes inside its window with no overlap of heavy jobs (WS11-03).
- [ ] RIZones' member sweep completes in under 25 minutes and its board sync in under 30, with a clean week of comparison against the full sweep.
- [ ] Server CPU, memory and disk latency during the capacity run stay within the limits set in WS11-03.

**RIZones**
- [ ] Error rate and p95 within 10 percent of baseline for the last 14 days.
- [ ] No open defect on RIZones traced to ROW work.
- [ ] The assistant eval passes at its previous count on both instances.

**Pilot**
- [ ] Both pilots have run for at least four weeks (A1) and three weeks (A2) with no open `blocking` defect.
- [ ] The app's ROW flavour is approved in both stores.

### 19.4 The Friday gate report

One page, written by the lead developer every Friday, sent to the product owners:

```
ROW gate report, week ending <date>

Next gate: <A1 | A2 | B>      Target: <date>      Forecast: <date>      Change since last week: <+/- days, why>

Done this week (task ids):
Planned and not done (task ids, reason):
Planned next week (task ids, owner):

Gate checklist: <n> of <m> lines true. Newly true: ...  At risk: ...

RIZones health: releases <n>, smoke <green/red>, 5xx rate <x%> (baseline <y%>), p95 worst route <ms> (baseline <ms>), incidents <n>
ROW staging/production health: ...

Outside lead times: Meta verification <state>, templates <approved/submitted per language>, US SMS registration <state>,
  store accounts <state>, reviewers <languages confirmed>, counsel <state>, pilot Stripe accounts <state>

Capacity: ROW days spent <n>, RIZones days spent <n>, app days spent <n>
Decisions needed from product owners:
Risks changed:
```

## 20. Risks

| # | Risk | Likelihood | Effect | What we do about it |
|---|---|---|---|---|
| R1 | A1 has almost no slack: 98.5 days of work in about 112 available | High | The pilot starts late or thin | No RIZones feature work for six weeks; the slip order of section 18.4; the gate, not the date, decides |
| R2 | Diwali (8 November) falls in the freeze and regression week | High | Regression is rushed | Freeze on 6 November; regression rota agreed in week 1; go or no-go moves to 20 November if the rota cannot be staffed |
| R3 | The mobile app's work is unmeasured | High | It consumes the slack of every gate | WS10-00 in week 1; the result is added to this plan and to the gate forecasts |
| R4 | A change for ROW breaks RIZones | Medium | 174,000 memberships affected | WS0 first; India defaults; characterisation tests; every task has a RIZones check; weekly releases to RIZones first; automatic rollback |
| R5 | Meta verification or template approval is late | Medium | No WhatsApp on ROW at A2 | Start day one; email is the fallback for codes; A2 checklist allows launch of the pilot without WhatsApp |
| R6 | A pilot district cannot open a Stripe account in its country | Medium | No live payments for that district | Choose pilot districts with the coverage table open (Q2); PayPal at B |
| R7 | The shared server cannot carry both products | Medium | Slow nights, overlapping jobs | Pool limits; schedule file with overlap check; WS8 redesign; WS11-03 capacity run before B; first launch wave sized to the measurement |
| R8 | One server is a single point of failure for both products | Present today | Both products down together | Offsite backups and tested restore (S-04); monitoring (S-10); the move to separate hosting remains open after launch |
| R9 | Translation quality in languages nobody on the team reads | High | Embarrassing text in front of Rotarians | Native reviewers with Rotary knowledge for all eight; glossary from Rotary International's own translations; a language is not listed until reviewed |
| R10 | Strings missed by extraction | High | English fragments on translated screens | Pseudo-locale on every directory; lint on scoped files; nightly crawl |
| R11 | Time boundaries incomplete | Medium | Wrong hours, shifted dates | The DateTime and CURDATE audits are checked-in tables reviewed by the lead developer; tests pin India behaviour; pilot districts are in non-India zones, so defects show early |
| R12 | Erasure undone by the sync | Certain today | A privacy breach after an honoured request | WS7-04 tombstone before B; until then no erasure request is marked complete on ROW |
| R13 | Secrets purge rewrites history | Certain | Every open branch must be rebased | Do it in week 1 before branches multiply; announce the hour |
| R14 | Rotating the JWT secret signs everyone out and invalidates signed links | Certain | Support calls; unpaid dues links stop working | Low-traffic window; announce; re-send active dues links after rotation |
| R15 | The master-data seeder changes RIZones data | Low | Wrong labels or ids in production | Dry-run guard in the deploy (WS5-04); never deletes; id conflicts stop the run |
| R16 | Conditional profile fetch misses a change | Medium | Stale member data | A week of comparison before switching; rolling weekly full verification |
| R17 | Rotary International's API terms or rate limits constrain ROW's sync | Unknown | Sync scope or schedule must change | Question Q6; separate credentials per instance; per-club call counts from WS8-02 |
| R18 | Taiwan (1,036 clubs) needs Traditional Chinese, which is not among the eight | Unknown | A large region launches in English | Question Q3; the framework supports adding a language without code |
| R19 | Two districts in one ROW zone need different gateways, taxes or languages | Likely | Configuration per district, not per instance | Accounts, currency, zone and default language are already per district in this design |
| R20 | The second pilot's strings reach the reviewer late | Medium | A2 moves | Framework in October; extraction of pilot surfaces in week 7; hard date 27 November |

### 20.1 Defects found in production code (fix regardless of ROW)

| # | Defect | Where | Task |
|---|---|---|---|
| D1 | Cashfree webhooks accepted without signature verification | `PublicMembershipDuesController.cs:143`, `PublicEventPaymentController.cs:104` | WS6-01 |
| D2 | Event-payment webhook matches the wrong identifier (from code reading; confirm with the query in the task) | `EventPaymentLinkService.cs:1529`, `:1632` | WS6-02 |
| D3 | "Today" is the UTC date in the browser: wrong before 05:30 India time | 78 places | WS3-04 |
| D4 | Secrets in source control, including the production database password | `appsettings*.json`, worker settings, helper scripts | S-01 |
| D5 | SMS service logs the provider API key and the one-time password | `SmsService.cs` | WS6M-06 |
| D6 | Scheduled tasks overlap or are superseded; two point at an old folder | Task Scheduler definitions | WS8-09 |
| D7 | Missing glyphs in PDFs are silently printed as boxes | `CheckIfAllTextGlyphsAreAvailable = false` | WS2-22 |
| D8 | Module switches are enforced in menus only; a disabled module's endpoints still answer | API | Add a `[RequiresModule("key")]` filter when a controller is next touched; not scheduled in this plan |
| D9 | Developer machines connect to the production database | `appsettings.Development.json` | S-03 |
| D10 | About twenty ad-hoc backup tables with full personal data sit in the production schema | `bak_*`, `tmp_*`, `temp`, `dedup_norid_log` | Review and drop or move to a restricted schema; owner: lead developer |
| D11 | Club-site parent domain has two competing fallbacks | ten places | WS1-06 |

## 21. Decisions and open questions

### 21.1 Decisions this plan assumes

Confirm or overturn each before week 2. Overturning one changes the tasks named.

| # | Decision | Affects |
|---|---|---|
| X1 | The pilot is two waves: English on 15 November, first translated district on 7 December | Section 18, gates A1 and A2 |
| X2 | ROW stores instance time on the shared server and converts at three boundaries, instead of UTC storage | WS4 |
| X3 | SuperAdmin screens stay in English | WS2 scope |
| X4 | No recolour; identity is name, logo, domain, contacts | WS9 |
| X5 | Master data is shared through seed files in the release; ids preserved for six tables | WS5 |
| X6 | Server responses gain codes; existing messages stay | WS2-13 to WS2-16 |
| X7 | Text that admins author and store is not translated | WS2-20, WS2-21 |
| X8 | Every language is reviewed by a native speaker before it is offered | WS2-29, Gate B |
| X9 | ROW payments go to the district's or club's own account with no split; the platform invoices from a ledger | WS6-07, WS6-11 |
| X10 | On ROW, blood group and family details are off | WS1-10 |
| X11 | No legacy v1 page is deleted | WS2 scope |
| X12 | No RIZones feature work until 13 November; a quarter of the team's time afterwards | Section 18.3 |
| X13 | The English pilot signs in by emailed code; WhatsApp and SMS follow at A2 | WS6M |
| X14 | Platform products (website plans, message credits) are not sold on ROW during the pilot | WS6-08 |

### 21.2 Questions that need an answer from outside engineering

| # | Question | Needed by | Blocks |
|---|---|---|---|
| Q1 | Which zones are in the first launch wave? | 30 November | WS11-03, Gate B scale lines |
| Q2 | Which districts are the pilots: one or two English-speaking for A1, one non-English for A2? Their countries must have Stripe coverage | **9 October** | WS1-11, WS6-07, WS8-10, WS2-29 |
| Q3 | Is Traditional Chinese required? Taiwan has 1,036 clubs, more than Italy | 30 November | A ninth language in WS2-29 |
| Q4 | How much RIZones feature work is allowed after 15 November? | 13 November | Section 18.3, Gate B forecast |
| Q5 | The ROW legal entity, domain, support contacts and brand assets | **9 October** | S-09, WS1-11, WS6M-01, WS9-03, WS10-09 |
| Q6 | Counsel: lawful basis for holding synced members who never sign in; whether Rotary International's API terms constrain where member data is stored; cookie notice wording; policy texts in eight languages | Policy texts in English by 30 October; the rest by 8 January | WS7-05, WS7-06, Gate B |
| Q7 | Installed memory and disk of the production server | **Week 1** | S-05 |
| Q8 | Who reviews each of the seven non-English languages: vendor or named Rotarians? | Pilot language by 13 November; all by 11 December | WS2-29, Gate A2, Gate B |
| Q9 | Does ROW use the district citation and zonal awards programmes, which are specific to Zones 4 to 8? | 30 October | WS5-02 seed scope, WS2-25 |
| Q10 | The platform fee percent for ROW and whether it varies by district | 11 December | WS6-11 |
| Q11 | Retention periods for logs on ROW | 8 January | WS7-07 |
| Q12 | Which modules are enabled for pilot districts | 23 October | WS2-08 order, pilot test plan |

# Part D. Appendices

## Appendix A. Configuration

### A.1 `BrandOptions`

File `RotaryApi/Configuration/BrandOptions.cs`. Every default reproduces RIZones today. Where a default is shown as a comment, copy the literal from the named file so the value is exact.

```csharp
namespace RotaryApi.Configuration;

public sealed class BrandOptions
{
    public string InstanceCode { get; init; } = "RIZ";
    public string ProductName { get; init; } = "Rotary Zones 4, 5, 6, 7 & 8";
    public string ShortName { get; init; } = "RIZones";
    public DomainOptions Domains { get; init; } = new();
    public SupportOptions Support { get; init; } = new();
    public LookOptions Look { get; init; } = new();
    public LocaleOptions Locale { get; init; } = new();
    public ProviderOptions Providers { get; init; } = new();
    public ScopeOptions Scope { get; init; } = new();
    public PricingOptions Pricing { get; init; } = new();
    public LegalOptions Legal { get; init; } = new();
    public PrivacyOptions Privacy { get; init; } = new();
    public Dictionary<string, bool> Features { get; init; } = new();
}

public sealed class DomainOptions
{
    public string AdminOrigin { get; init; } = "https://rizones45678.org";
    public string ApiBase { get; init; } = "https://rizones45678.org/API";
    public string ClubSiteParent { get; init; } = "rotaryindia.org";
    public string[] ClubSiteSuffixes { get; init; } = { "rotaryindia.org", "rizones45678.org" };
    public string[] AllowedOriginSuffixes { get; init; } = { "rizones45678.org", "rizones4567.org" };
    public string[] ThirdPartyOriginSuffixes { get; init; } = { "rotaryindia.org" };
}

public sealed class SupportOptions
{
    // values from lib/merchantInfo.ts:20-33; AppHeader.tsx:119 and EmailService.cs:488, 604, 666 repeat them
    public string LegalName { get; init; } = "Rotary Zones 4-8 Multi-District Initiative";
    public string Address { get; init; } = "Rotary Zones 4-8 Secretariat, Mumbai, Maharashtra, India 400001";
    public string Email { get; init; } = "support@rizones45678.org";
    public string[] Phones { get; init; } = { "+91 8424064369", "+91 8928755144" };
    public string Hours { get; init; } = "Monday to Friday, 10:00 AM to 6:30 PM IST";
    public string NoReplyEmail { get; init; } = "";     // default: Brevo:SenderEmail
    public string[] InternalCc { get; init; } = { };    // default: the fixed kaizeninfotech.com addresses in EmailService
    public string PrivacyEmail { get; init; } = "";
}

public sealed class LookOptions
{
    public string LogoUrl { get; init; } = "/images/rotary-zone-log-white.png";   // AppHeader.tsx:126
    public string LogoDarkUrl { get; init; } = "";
    public string FaviconUrl { get; init; } = "/favicon.ico";
    public string OpenGraphImageUrl { get; init; } = "";
    public string EmailHeaderHtml { get; init; } = "";                    // default: the current EmailService.EMAIL_HEADER text
    public string EmailFooterHtml { get; init; } = "";                    // default: the current EmailService.EMAIL_FOOTER text
    public string PdfLogoPath { get; init; } = "";
}

public sealed class LocaleOptions
{
    public string DefaultLanguage { get; init; } = "en";
    public string[] Languages { get; init; } = { "en" };
    public string NumberLocale { get; init; } = "en-IN";
    public string DefaultCurrency { get; init; } = "INR";
    public string[] Currencies { get; init; } = { "INR", "NPR", "LKR", "USD" };
    public string DefaultTimeZone { get; init; } = "Asia/Kolkata";
    public string InstanceTimeZone { get; init; } = "Asia/Kolkata";      // the zone stored timestamps are in
    public int DefaultCountryId { get; init; } = 1;                      // India
}

public sealed class ProviderOptions
{
    public string[] Payments { get; init; } = { "cashfree", "razorpay" };
    public string WhatsApp { get; init; } = "interakt";                  // interakt | meta
    public string Sms { get; init; } = "dlt";                            // dlt | twilio
    public Dictionary<string, string[]> OtpPolicy { get; init; } = new()
    {
        ["IN"] = new[] { "sms" },
        ["*"]  = new[] { "email", "whatsapp" }
    };
    public TaxRule[] TaxRules { get; init; } = { new() { Country = "IN", RatePercent = 18m, Label = "GST", Inclusive = false } };
    public MetaWhatsAppOptions MetaWhatsApp { get; init; } = new();      // PhoneNumberId, ApiVersion; token in environment
    public TwilioOptions Twilio { get; init; } = new();                  // MessagingServiceSid; account sid and token in environment
}

public sealed class TaxRule { public string Country { get; init; } = ""; public decimal RatePercent { get; init; } public string Label { get; init; } = ""; public bool Inclusive { get; init; } }

public sealed class ScopeOptions
{
    public string[] Zones { get; init; } = { };                          // default: the zone names in RotaryOrgFoundationSyncController.cs:69
    public string[] PulledZoneNames { get; init; } = { };                // default: same
    public string[] Countries { get; init; } = { "IN", "LK", "NP" };
    public string[] ExemptDistricts { get; init; } = { "5656", "1280", "IFRM India" };
    public int CogClubId { get; init; } = 31598;
    public int WhatsAppPilotClubId { get; init; } = 2765;
    public int WhatsAppPilotDistrictId { get; init; } = 2;
    public string TestDistrictNumber { get; init; } = "3142";
    public int DistrictReportSendHour { get; init; } = 7;
    public int[] DistrictReportDaysOfMonth { get; init; } = { 1, 16 };
}

public sealed class PricingOptions
{
    public decimal PlatformFeePercent { get; init; } = 0m;               // ROW: invoiced from the ledger
    public Dictionary<string, decimal> Products { get; init; } = new();  // ROW prices for platform products, in DefaultCurrency
}

public sealed class LegalOptions
{
    public string PrivacyUrl { get; init; } = "/privacy-policy";
    public string TermsUrl { get; init; } = "/terms-and-conditions";
    public string RefundsUrl { get; init; } = "/refunds-and-cancellations";
    public string CookiesUrl { get; init; } = "";
    public string PolicyVersion { get; init; } = "";
    public bool CookieNotice { get; init; } = false;
}

public sealed class PrivacyOptions
{
    public string[] ConsentRequiredFor { get; init; } = { };             // ROW: greeting, announcement, event, newsletter, marketing
    public Dictionary<string, int> RetentionDays { get; init; } = new(); // empty = keep (today's behaviour)
}
```

### A.2 RIZones configuration

RIZones has **no `Brand` section**. `RotaryApi.Tests/Snapshots/brand-defaults.json` is the serialised form of `new BrandOptions()` and is the record of what RIZones runs with. Changing a default changes that file in the same pull request, reviewed by the lead developer.

### A.3 ROW brand file (shape; values to be supplied)

File `RotaryApi/brand.ROW.json`, loaded when the environment variable `BRAND_FILE=brand.ROW.json` is set. Values in angle brackets come from question Q5 and the pilot choice (Q2).

```json
{
  "Brand": {
    "InstanceCode": "ROW",
    "ProductName": "Roster On Wheels",
    "ShortName": "ROW",
    "Domains": {
      "AdminOrigin": "https://<row-domain>",
      "ApiBase": "https://<row-domain>/API",
      "ClubSiteParent": "<row-club-sites-domain>",
      "ClubSiteSuffixes": ["<row-club-sites-domain>"],
      "AllowedOriginSuffixes": ["<row-domain>", "<row-club-sites-domain>"],
      "ThirdPartyOriginSuffixes": []
    },
    "Support": {
      "LegalName": "<entity>", "Address": "<address>", "Email": "support@<row-domain>",
      "Phones": ["<E.164 number>"], "Hours": "<hours with time zone>",
      "NoReplyEmail": "no-reply@<row-domain>", "InternalCc": [], "PrivacyEmail": "privacy@<row-domain>"
    },
    "Look": {
      "LogoUrl": "/brand/row-logo.svg", "LogoDarkUrl": "/brand/row-logo-dark.svg", "FaviconUrl": "/brand/favicon.ico",
      "OpenGraphImageUrl": "/brand/og.png",
      "EmailHeaderHtml": "<table role=\"presentation\" ...>ROW header</table>",
      "EmailFooterHtml": "<table role=\"presentation\" ...>ROW footer with entity, address and privacy link</table>",
      "PdfLogoPath": "brand/row-logo.png"
    },
    "Locale": {
      "DefaultLanguage": "en",
      "Languages": ["en"],
      "NumberLocale": "en-US",
      "DefaultCurrency": "USD",
      "Currencies": ["USD", "CAD", "EUR", "GBP", "BRL", "MXN", "JPY", "KRW", "AUD", "PHP", "ZAR", "NGN", "KES"],
      "DefaultTimeZone": "UTC",
      "InstanceTimeZone": "Asia/Kolkata",
      "DefaultCountryId": 0
    },
    "Providers": {
      "Payments": ["stripe", "paypal"],
      "WhatsApp": "meta",
      "Sms": "twilio",
      "OtpPolicy": { "*": ["email", "whatsapp", "sms"] },
      "TaxRules": [],
      "MetaWhatsApp": { "PhoneNumberId": "<id>", "ApiVersion": "<current Graph API version>" },
      "Twilio": { "MessagingServiceSid": "<sid>" }
    },
    "Scope": {
      "Zones": ["<zone names of the pilot and launch wave>"],
      "PulledZoneNames": ["<same>"],
      "Countries": ["<ISO codes of the pilot districts>"],
      "ExemptDistricts": [],
      "CogClubId": 0, "WhatsAppPilotClubId": 0, "WhatsAppPilotDistrictId": 0,
      "TestDistrictNumber": "", "DistrictReportSendHour": 7, "DistrictReportDaysOfMonth": [1, 16]
    },
    "Pricing": { "PlatformFeePercent": 0, "Products": {} },
    "Legal": {
      "PrivacyUrl": "/privacy-policy", "TermsUrl": "/terms-and-conditions", "RefundsUrl": "/refunds-and-cancellations",
      "CookiesUrl": "/cookies", "PolicyVersion": "2026-11", "CookieNotice": true
    },
    "Privacy": {
      "ConsentRequiredFor": ["greeting", "announcement", "event", "newsletter", "marketing"],
      "RetentionDays": { "email_log_body": 180, "whatsapp_log": 365, "push_log": 90, "login_audit": 365, "otp": 7, "export_files": 7, "assistant_turns": 365 }
    },
    "Features": {
      "member.bloodGroup": false, "member.familyDetails": false,
      "time.emitOffset": true, "time.districtZone": true,
      "payments.connect": true, "payments.platformFeeLedger": true, "payments.cashfreeWebhookEnforce": true,
      "privacy.enabled": true, "masters.editable": false,
      "documents.strictGlyphs": true, "sync.conditionalProfiles": false, "whatsapp.purposeCallback": true,
      "modules.citation": false, "modules.zonalAwards": false, "modules.websitePurchase": false, "modules.wallet": false,
      "modules.assistant": false, "modules.pphCamps": false, "site.public": false
    }
  }
}
```

`Languages` starts as `["en"]` and gains each language on the day its review is complete. `InstanceTimeZone` stays `Asia/Kolkata` while ROW shares the server. `DefaultCountryId: 0` means "no default country": forms require the member or district to choose.

### A.4 Secrets (environment variables, never in files)

Set per application pool and per worker account. One set for RIZones, a separate set for ROW; no value is shared between the two.

| Variable | Used by |
|---|---|
| `ConnectionStrings__DefaultConnection` | API, all workers |
| `ConnectionStrings__AssistantReadOnly` | API (assistant tools) |
| `JwtSettings__Secret` | API |
| `Brevo__ApiKey` | API, greetings worker |
| `Assistant__Claude__ApiKey`, `Assistant__Gemini__ApiKey` | API |
| `RotaryOrgApi__Username`, `RotaryOrgApi__Password` | API, sync worker |
| `Firebase__ServiceAccountJson` (or a file path outside the repository) | API |
| `PleskSettings__ApiKey` | API |
| `Google__ClientSecret`, `Google__RefreshToken`, `Zoom__ClientSecret` | API |
| RIZones only: `Cashfree__ClientSecret`, `CashfreePayment__ClientSecret`, `CashfreeGateway__ProjectSecret`, `Razorpay__KeySecret`, `Razorpay__WebhookSecret`, `Razorpay__PayLinkKey`, `Interakt__ApiKey`, `SmsSettings__Password`, `ShrigodaPartnerApi__*`, `ClubProfileReportApi__ApiKey` | API, workers |
| ROW only: `Brand__Providers__MetaWhatsApp__AccessToken`, `Brand__Providers__MetaWhatsApp__AppSecret`, `Brand__Providers__MetaWhatsApp__VerifyToken`, `Brand__Providers__Twilio__AccountSid`, `Brand__Providers__Twilio__AuthToken`, `Brand__Privacy__TombstoneSalt`, `Payments__Platform__Stripe__SecretKey`, `Payments__Platform__Stripe__WebhookSecret` | API, workers |
| `PURGE_CACHE_SECRET`, `BUILD_VERSION` | Next.js apps |
| `SMOKE_USER`, `SMOKE_PASSWORD` | Pipeline and deploy script only |

District and club gateway credentials are not environment variables: they are rows in `payment_gateway_accounts`, encrypted with the instance's Data Protection key ring (WS6-07).

## Appendix B. SQL for new tables and columns

All statements are additive and idempotent in `DatabaseInitializer` form (`CREATE TABLE IF NOT EXISTS`; columns added after an `information_schema` check). Each also exists as a file under `SQL/` for manual application on RIZones.

### B.1 `api_request_stats` (WS0-02)

```sql
CREATE TABLE IF NOT EXISTS api_request_stats (
  HourUtc        DATETIME     NOT NULL,
  RouteTemplate  VARCHAR(200) NOT NULL,
  StatusClass    TINYINT      NOT NULL,            -- 2, 3, 4, 5
  Count          INT          NOT NULL DEFAULT 0,
  SumMs          BIGINT       NOT NULL DEFAULT 0,
  B50  INT NOT NULL DEFAULT 0, B100 INT NOT NULL DEFAULT 0, B250 INT NOT NULL DEFAULT 0, B500 INT NOT NULL DEFAULT 0,
  B1000 INT NOT NULL DEFAULT 0, B2500 INT NOT NULL DEFAULT 0, B5000 INT NOT NULL DEFAULT 0, BOver INT NOT NULL DEFAULT 0,
  PRIMARY KEY (HourUtc, RouteTemplate, StatusClass)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The `B*` columns are a latency histogram (requests at or under each bound in milliseconds); p95 is read from it.

### B.2 Event payments: merchant order id (WS6-02)

```sql
ALTER TABLE event_payment_members ADD COLUMN MerchantOrderId VARCHAR(64) NULL;
CREATE INDEX ix_epm_merchant_order ON event_payment_members (MerchantOrderId);
```

### B.3 `master_translation` (WS2-25)

```sql
CREATE TABLE IF NOT EXISTS master_translation (
  entity      VARCHAR(40)  NOT NULL,
  entity_key  VARCHAR(120) NOT NULL,
  field       VARCHAR(30)  NOT NULL,
  lang        VARCHAR(10)  NOT NULL,
  text        TEXT         NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (entity, entity_key, field, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.4 District and campaign columns (WS4-01, WS2-15, WS3-05)

```sql
ALTER TABLE district_master  ADD COLUMN TimeZoneId      VARCHAR(64) NULL;   -- IANA name
ALTER TABLE district_master  ADD COLUMN DefaultLanguage VARCHAR(10) NULL;   -- ISO 639-1
ALTER TABLE membership_dues  ADD COLUMN Currency        VARCHAR(3)  NULL;   -- null = district default
ALTER TABLE club_dues        ADD COLUMN Currency        VARCHAR(3)  NULL;
ALTER TABLE event_payment_links ADD COLUMN Currency     VARCHAR(3)  NULL;
```

`district_master.DefaultCurrency` and `club_master.Timezone` already exist.

### B.5 `scheduled_job_runs` (WS4-03)

```sql
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_key         VARCHAR(60) NOT NULL,
  fk_district_id  INT         NOT NULL,            -- 0 = instance-wide
  local_date      DATE        NOT NULL,
  ran_at_utc      DATETIME    NOT NULL,
  PRIMARY KEY (job_key, fk_district_id, local_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.6 Taxonomy codes and `seed_history` (WS5-01, WS5-03)

```sql
ALTER TABLE area_of_focus_master ADD COLUMN code VARCHAR(80) NULL;
ALTER TABLE category_master      ADD COLUMN code VARCHAR(80) NULL;
ALTER TABLE sub_category_master  ADD COLUMN code VARCHAR(80) NULL;
-- after the fill:
CREATE UNIQUE INDEX ux_aof_code ON area_of_focus_master (fk_module_id, code);
CREATE UNIQUE INDEX ux_cat_code ON category_master (fk_area_of_focus_id, code);
CREATE UNIQUE INDEX ux_sub_code ON sub_category_master (fk_category_id, code);

CREATE TABLE IF NOT EXISTS seed_history (
  file_name   VARCHAR(120) NOT NULL,
  sha256      CHAR(64)     NOT NULL,
  applied_at  DATETIME     NOT NULL,
  inserted    INT NOT NULL, updated INT NOT NULL, unchanged INT NOT NULL, reported INT NOT NULL,
  PRIMARY KEY (file_name, sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.7 Club websites (WS2-27, WS2-28)

```sql
ALTER TABLE club_website_menu ADD COLUMN slug VARCHAR(60) NULL;
ALTER TABLE club_master       ADD COLUMN WebsiteLanguage VARCHAR(10) NULL;

-- backfill, same order as defaultSlugFor in club-website/src/lib/nav.ts
UPDATE club_website_menu SET slug = CASE
  WHEN LOWER(menu_name) LIKE 'home%'      THEN '/'
  WHEN LOWER(menu_name) LIKE 'about%'     THEN '/about'
  WHEN LOWER(menu_name) LIKE 'directory%' THEN '/directory'
  WHEN LOWER(menu_name) LIKE 'director%'  THEN '/directors'
  WHEN LOWER(menu_name) LIKE 'calendar%'  THEN '/calendar'
  WHEN LOWER(menu_name) LIKE 'project%'   THEN '/projects'
  WHEN LOWER(menu_name) LIKE 'meeting%'   THEN '/meetings'
  WHEN LOWER(menu_name) LIKE 'past%'      THEN '/past-presidents'
END
WHERE is_default = 1 AND slug IS NULL;
```

### B.8 `whatsapp_templates` (WS6M-04)

```sql
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  template_key            VARCHAR(80)  NOT NULL,
  language                VARCHAR(10)  NOT NULL,
  provider                VARCHAR(20)  NOT NULL,          -- interakt | meta
  provider_template_name  VARCHAR(120) NOT NULL,
  provider_language_code  VARCHAR(10)  NOT NULL,          -- e.g. en, pt_BR
  category                VARCHAR(20)  NOT NULL,          -- authentication | utility | marketing
  body_param_count        TINYINT      NOT NULL,
  header_type             VARCHAR(10)  NOT NULL DEFAULT 'none',   -- none | image | document | text
  button_param_count      TINYINT      NOT NULL DEFAULT 0,
  max_body_chars          INT          NULL,
  is_approved             TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (template_key, language, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.9 `payment_gateway_accounts` and coverage (WS6-07, WS6-12)

```sql
CREATE TABLE IF NOT EXISTS payment_gateway_accounts (
  pk_account_id             INT AUTO_INCREMENT PRIMARY KEY,
  account_ref               CHAR(22)     NOT NULL UNIQUE,        -- random, URL-safe; appears in the webhook URL
  owner_type                VARCHAR(10)  NOT NULL,               -- platform | district | club
  owner_id                  INT          NOT NULL DEFAULT 0,
  gateway                   VARCHAR(20)  NOT NULL,               -- stripe | paypal | cashfree | razorpay
  display_name              VARCHAR(120) NOT NULL,
  credentials_encrypted     TEXT         NOT NULL,
  webhook_secret_encrypted  TEXT         NULL,
  default_currency          VARCHAR(3)   NULL,
  is_active                 TINYINT(1)   NOT NULL DEFAULT 1,
  verified_at               DATETIME     NULL,
  created_by                INT          NULL, created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_by               INT          NULL, modified_date DATETIME NULL,
  isdeleted                 TINYINT(1)   NOT NULL DEFAULT 0,
  KEY ix_pga_owner (owner_type, owner_id, gateway, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_gateway_coverage (
  country_iso  CHAR(2)     NOT NULL,
  gateway      VARCHAR(20) NOT NULL,
  can_receive  TINYINT(1)  NOT NULL,
  PRIMARY KEY (country_iso, gateway)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.10 `payment_webhook_events` (WS6-06)

```sql
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  gateway            VARCHAR(20)  NOT NULL,
  event_id           VARCHAR(120) NOT NULL,
  merchant_order_id  VARCHAR(64)  NULL,
  received_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at       DATETIME     NULL,
  attempts           INT          NOT NULL DEFAULT 0,
  last_error         VARCHAR(500) NULL,
  raw                MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (gateway, event_id),
  KEY ix_pwe_unprocessed (processed_at, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.11 `payment_refunds` (WS6-09)

```sql
CREATE TABLE IF NOT EXISTS payment_refunds (
  pk_refund_id        INT AUTO_INCREMENT PRIMARY KEY,
  flow                VARCHAR(10)   NOT NULL,             -- DUES | EVT | CDUES | WAL | WEB
  source_row_id       BIGINT        NOT NULL,             -- the payment row in the flow's own table
  merchant_order_id   VARCHAR(64)   NOT NULL,
  gateway             VARCHAR(20)   NOT NULL,
  gateway_payment_id  VARCHAR(120)  NOT NULL,
  gateway_refund_id   VARCHAR(120)  NULL,
  amount              DECIMAL(14,2) NOT NULL,
  currency            VARCHAR(3)    NOT NULL,
  reason              VARCHAR(300)  NOT NULL,
  status              VARCHAR(20)   NOT NULL,             -- requested | succeeded | failed
  requested_by        INT           NOT NULL,
  requested_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME      NULL,
  KEY ix_refund_order (merchant_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.12 `platform_fee_ledger` (WS6-11)

```sql
CREATE TABLE IF NOT EXISTS platform_fee_ledger (
  pk_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  instance           VARCHAR(10)   NOT NULL,
  fk_district_id     INT           NOT NULL,
  fk_club_id         INT           NULL,
  flow               VARCHAR(10)   NOT NULL,
  merchant_order_id  VARCHAR(64)   NOT NULL,
  gateway            VARCHAR(20)   NOT NULL,
  gross_amount       DECIMAL(14,2) NOT NULL,             -- negative for a refund
  currency           VARCHAR(3)    NOT NULL,
  fee_percent        DECIMAL(6,3)  NOT NULL,
  fee_amount         DECIMAL(14,2) NOT NULL,
  occurred_at        DATETIME      NOT NULL,
  UNIQUE KEY ux_pfl (merchant_order_id, gross_amount, occurred_at),
  KEY ix_pfl_district (fk_district_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.13 `privacy_requests` (WS7-02, WS7-03)

```sql
CREATE TABLE IF NOT EXISTS privacy_requests (
  pk_request_id   INT AUTO_INCREMENT PRIMARY KEY,
  request_type    VARCHAR(10)  NOT NULL,                  -- export | erase
  fk_member_id    INT          NOT NULL,
  requested_by    INT          NOT NULL,
  approved_by     INT          NULL,
  reason          VARCHAR(500) NULL,
  status          VARCHAR(20)  NOT NULL,                  -- requested | approved | running | done | failed | rejected
  export_guid     CHAR(36)     NULL,
  requested_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME     NULL,
  error           VARCHAR(500) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.14 `member_erasure_tombstone` (WS7-03)

```sql
CREATE TABLE IF NOT EXISTS member_erasure_tombstone (
  rotary_id_hash  CHAR(64)     NOT NULL PRIMARY KEY,
  fk_club_id      INT          NULL,                      -- for the "not shown at their request" count only
  erased_at_utc   DATETIME     NOT NULL,
  erased_by       INT          NOT NULL,
  reason          VARCHAR(500) NULL,
  KEY ix_tomb_club (fk_club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.15 `member_consents` (WS7-05)

```sql
CREATE TABLE IF NOT EXISTS member_consents (
  pk_consent_id     INT AUTO_INCREMENT PRIMARY KEY,
  fk_member_id      INT         NOT NULL,
  policy_version    VARCHAR(20) NOT NULL,
  accepted_at_utc   DATETIME    NOT NULL,
  withdrawn_at_utc  DATETIME    NULL,
  language          VARCHAR(10) NOT NULL,
  ip_address        VARCHAR(45) NULL,
  channel           VARCHAR(10) NOT NULL,                 -- web | app
  KEY ix_consent_member (fk_member_id, policy_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### B.16 Sync measurement and stamps (WS8-02, WS8-03, WS8-07)

```sql
CREATE TABLE IF NOT EXISTS rotary_org_sync_club_log (
  pk_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id            BIGINT      NOT NULL,                 -- rotary_org_sync_log key
  mode              VARCHAR(30) NOT NULL,                 -- member-sweep-full | member-sweep-conditional | member-daily-delta | bod-sync ...
  fk_club_id        INT         NOT NULL,
  started_utc       DATETIME    NOT NULL,
  ms                INT         NOT NULL,
  api_calls         INT         NOT NULL,
  profiles_fetched  INT         NOT NULL,
  inserted INT NOT NULL, updated INT NOT NULL, removed INT NOT NULL, skipped_tombstone INT NOT NULL DEFAULT 0,
  error             VARCHAR(500) NULL,
  KEY ix_roscl_run (run_id), KEY ix_roscl_club (fk_club_id, started_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE rotary_org_sync_log   ADD COLUMN Mode VARCHAR(30) NULL;
ALTER TABLE rotary_org_sync_log   ADD COLUMN Instance VARCHAR(10) NULL;
ALTER TABLE member_master_profile ADD COLUMN RotaryLastUpdatedUtc DATETIME NULL;
ALTER TABLE club_master           ADD COLUMN BodHistorySyncedAt   DATETIME NULL;
```

## Appendix C. Feature flags

Declared in `RotaryApi/Configuration/FeatureDefaults.cs`. The default is RIZones' behaviour today.

| Flag | Default (RIZones) | ROW | Effect when on | Task |
|---|---|---|---|---|
| `member.bloodGroup` | on | off | Blood group is collected, shown, filtered and reported | WS1-10 |
| `member.familyDetails` | on | off | Family members are collected and shown | WS1-10 |
| `time.emitOffset` | off | on | API timestamps carry an offset; form inputs send the district's offset | WS4-06, WS4-07 |
| `time.districtZone` | off | on | District settings show a time-zone selector | WS4-01 |
| `payments.cashfreeWebhookEnforce` | off, then on after 48 hours | on | Unsigned Cashfree webhooks are rejected | WS6-01 |
| `payments.connect` | off | on | Districts and clubs connect their own gateway account | WS6-07 |
| `payments.platformFeeLedger` | off | on | Confirmed payments write a fee ledger row | WS6-11 |
| `privacy.enabled` | off | on | Export, erasure, consent, retention and the registry audit are active | WS7 |
| `masters.editable` | on | off | Master-data screens allow changes | WS5-06 |
| `documents.strictGlyphs` | off, then on after a week | on | A missing glyph is an error instead of a box | WS2-22 |
| `sync.conditionalProfiles` | off, then on after a clean week | on after RIZones | Profiles are fetched only when changed | WS8-03 |
| `whatsapp.purposeCallback` | off | on | The message purpose is sent as callback data | WS6M-03 |
| `modules.citation`, `modules.zonalAwards` | on | off until Q9 is answered | The Zones 4 to 8 award programmes are offered | WS5-02 |
| `modules.wallet`, `modules.websitePurchase` | on | off during the pilot | Platform products are sold | WS6-08 |
| `modules.assistant` | on | off until B | The Rotary Assistant appears in navigation and answers | section 1.6 |
| `modules.pphCamps` | on | off | PPH camp module | section 1.6 |
| `site.public` | on | off until content exists | The public marketing pages render; off redirects the root to sign-in | WS2-12 |

Flags are for instance-wide differences only. Per-district and per-club module switches (`module_master`, `district_modules`, `club_modules`) are unchanged and remain the way a district turns a module on or off.

## Appendix D. Error codes

Starting catalogue, from the most reused messages (Appendix I, section G1). `ApiErrors` has one method per row. Names are stable once released.

| Code | Arguments | English message (unchanged) | Occurrences |
|---|---|---|---|
| `CLUB_INACTIVE` | | This club, its district, or its zone is inactive. Reactivate it first to access this data. | 113 |
| `ACCESS_DENIED` | | Access denied. | 83 |
| `DISTRICT_INACTIVE` | | This district or its zone is inactive. Reactivate it first to access this data. | 82 + 11 |
| `NO_FILE_UPLOADED` | | No file uploaded | 30 + 8 |
| `FIELD_REQUIRED` | `field` | {field} is required. | yearId 20, clubId 15, districtId 11, OrderedIds 10 |
| `FIELDS_REQUIRED` | `fields` | {fields} are required. | 11 |
| `NOT_FOUND` | `entity` | {entity} not found. | Record 14, Club 19, Member 16, District 9, Project 8, Approval request 7, Payment 6, Menu 6, Order 5 |
| `FILE_TOO_LARGE` | `maxMb` | File size must be less than {maxMb}MB | 14 + 8 |
| `INVALID_FILE_TYPE` | `allowed` | Invalid file type. Allowed: {allowed} | 12 |
| `NO_DATA` | | No data. | 13 |
| `NO_CLUB_ADMIN_ASSIGNMENT` | | No club admin assignment found. | 9 |
| `NO_DISTRICT_ADMIN_ASSIGNMENT` | | No district admin assignment found. | 5 |
| `NO_ZONE_ASSIGNED` | | No zone assigned. | 8 |
| `SUPERADMIN_ONLY` | | SuperAdmin only. | 8 + 5 |
| `NOT_SIGNED_IN` | | Not signed in. | 8 |
| `PHOTO_REQUIRED` | `min` | At least {min} photo is required to save this project. | 6 |
| `NO_ROTARY_YEAR` | | No rotary year available. | 5 |
| `INVALID_LINK` | | Invalid link | 5 |
| `NOT_AVAILABLE` | | Not available. | 5 |
| `PROVIDER_NOT_CONFIGURED` | `provider` | {provider} not configured. | Plesk 7 |
| `ORDER_SAVED` | | Order saved. | 14 (success) |
| `DELETED` | | Deleted. | 8 (success) |
| `ACKNOWLEDGED` | | Acknowledged. | 6 (success) |
| `FEATURE_DISABLED` | `feature` | This feature is not available. | new |
| `PAYMENTS_NOT_CONFIGURED` | | Online payments are not set up for this district yet. | new |
| `CURRENCY_NOT_SUPPORTED` | `currency`, `gateway` | {gateway} cannot accept {currency} for this account. | new |
| `CONSENT_REQUIRED` | | Please accept the privacy policy to continue. | new |
| `VALIDATION_FAILED` | `errors` | One or more fields are invalid. | model-state errors |

Where a message differs only by a trailing full stop ("No file uploaded" and "No file uploaded."), both map to one code and each call site keeps its own original English text through an overload, so RIZones responses do not change.

## Appendix E. Smoke checks

`RotaryApi.SmokeTests`. Each check asserts status, content type and two or three named fields. `{club}` and `{district}` are the smoke account's scope; `{year}` is the current year id from check 7.

| # | Group | Request | Asserts |
|---|---|---|---|
| 1 | Platform | `GET api/health` | 200; `status = ok`; `version` equals `SMOKE_EXPECT_VERSION`; `dbOk` |
| 2 | Platform | `GET api/public/brand` | 200; `instanceCode` equals the expected instance; `locale.languages` not empty |
| 3 | Platform | `GET swagger/v1/swagger.json` | 200; JSON with `paths` |
| 4 | Auth | `POST api/Auth/login` with the smoke account | 200; a token |
| 5 | Auth | `POST api/Auth/login` with a wrong password | 401 or 400; no token |
| 6 | Auth | `GET api/auth/my-context` | 200; at least one club and one district; `today` present once WS3-02 ships |
| 7 | Read | `GET api/club-admin-dashboard/available-years` | 200; non-empty list |
| 8 | Read | `GET api/club-admin-dashboard/overview` | 200; member count field present |
| 9 | Read | `GET api/club-admin-dashboard/membership` | 200 |
| 10 | Read | `GET api/district-admin-dashboard/overview` | 200; club count field present |
| 11 | Read | `GET api/Clubs/{club}` | 200; club name |
| 12 | Read | `GET api/Clubs/{club}/members` | 200; non-empty list |
| 13 | Read | `GET api/clubs/{club}/board-of-directors` | 200 |
| 14 | Read | `GET api/clubs/{club}/announcements` | 200 |
| 15 | Read | `GET api/clubs/{club}/monthly-reports/years` | 200 |
| 16 | Read | `GET api/membership-dues` | 200 |
| 17 | Read | `GET api/goal-setting/categories` | 200; non-empty |
| 18 | Read | `GET api/Districts/{district}/clubs` | 200; non-empty |
| 19 | Read | `GET api/districts/{district}/modules` | 200; non-empty |
| 20 | Kill switch | `GET api/Clubs/{inactiveClub}` for a known inactive club | the inactive response; `code = CLUB_INACTIVE` once WS2-14 ships |
| 21 | Scope | `GET api/Clubs/{otherClub}/members` for a club outside the account's scope | 403 or the access-denied response |
| 22 | Public | `GET api/public/club/{club}/v2/about` | 200 |
| 23 | Public | `GET api/public/website-directory/districts` | 200; non-empty |
| 24 | Public | `GET api/public/project-stats/overview` | 200 |
| 25 | Documents | `GET api/clubs/{club}/monthly-reports/word/{year}/{month}` for a fixture month | 200; Word content type; size above 5 kB |
| 26 | Documents | `GET api/goal-setting/goals-excel/clubs` | 200; spreadsheet content type; size above 2 kB |
| 27 | Payments | Create a dues order in the gateway's test mode and read its status | session returned; status pending. Skipped without sandbox keys |
| 28 | Messaging | `GET api/health/messaging` (added in WS6M-04) | every template key used in code resolves for every brand language; no send |
| 29 | Sync | `GET api/health/sync` (added in WS8-02) | a completed member sweep within 36 hours |
| 30 | Assistant | `GET api/assistant/tools` | 200; the expected tool count |

Before release, separately: `POST api/assistant/eval/run` must return at least the previous pass count (39 of 39 on 30 September 2026). It is not in the per-deploy suite because it costs about one US dollar per run.

## Appendix F. Message templates

### F.1 WhatsApp: logical keys and today's Interakt names

| Logical key | Interakt template today | Used for |
|---|---|---|
| `otp` | `rizones45678_otp` | One-time password with copy-code button |
| `dues.reminder.withBank` | `updated_rizones_club_membership_dues_collection` | Membership dues reminder |
| `districtDues.reminder.withBank` | `updated_rizones_district_dues_collection` | District dues reminder |
| `districtDues.reminder.noBank` | `updated_rizones_district_dues_collection_no_bank_details` | District dues reminder without bank details |
| `content.announcement.club` | `rotary_club_announcement_26` | Club announcement |
| `content.announcement.district` | `rotary_district_announcement_26_up` | District announcement |
| `content.announcement.admin` | `rotary_admin_announcement_26_1` | Platform announcement |
| `content.event.club` | `rotary_club_upcoming_event_26` | Club event |
| `content.event.district` | `rotary_district_upcoming_event_26` | District event |
| `content.event.admin` | `rotary_admin_upcoming_event_25` | Platform event |
| `content.newsletter.club` | `rotary_club_newsletter_25` | Club newsletter |
| `content.newsletter.district` | `rotary_district_newsletter_25` | District newsletter |
| `content.project.club` | `ri_project_template` | Club project share |
| `content.project.district` | `ri_district_projects_25_8l` | District project share |
| `comms.announcement.club.image`, `.noImage` | `rizones45678_club_announcement_image_updated`, `_no_image_updated` | Announcement variants in `WhatsAppCommsTemplates` |
| `comms.event.club.image`, `.noImage` | `rizones45678_club_upcoming_event_image_updated`, `_no_image_updated` | Event variants |
| `comms.announcement.district.image`, `.noImage` | `rizones45678_district_announcement_image_updated`, `_no_image_updated` | District announcement variants |
| `comms.event.district.image`, `.noImage` | `rizones45678_district_upcoming_event_image_updated`, `_no_image_updated` | District event variants |
| `comms.newsletter.link`, `comms.newsletter.pdf` | `rizones45678_newsletter_link_updated_2i`, `rizones45678_newsletter_pdf_updated` | Newsletter variants |
| `cmr.report` | `club_monthly_report` | Club monthly report notice |
| `directory.formIncomplete` | `district_directory_form_incomplete_final` | Directory data reminder |
| `website.reminder` | the value of `ClubWebsiteReminderTemplate` in configuration | Website renewal reminder |
| `greeting.birthday`, `greeting.anniversary` | the names configured in `GreetingsWorker/appsettings.json` | Greetings |

Confirm each row's parameter counts against the Interakt dashboard when seeding (WS6M-04); the dashboard is the only place the bodies exist today. Export every body into `docs/messaging/interakt-templates.md` at the same time so they are under version control.

### F.2 ROW launch templates (submit to Meta in each language)

| Key | Category | Body | Button |
|---|---|---|---|
| `otp` | Authentication | Meta's fixed authentication format: "{{1}} is your verification code." | Copy code |
| `dues.reminder` | Utility | "Hello {{1}}, your {{2}} dues of {{3}} for {{4}} are due on {{5}}. Pay securely here:" | URL with a dynamic suffix (the pay link token) |
| `content.announcement` | Utility | "{{1}}: a new announcement from {{2}}. {{3}}" | URL to the announcement |
| `content.event` | Utility | "{{1}} invites you to {{2}} on {{3}} at {{4}}. {{5}}" | URL to the event |

Parameters: `dues.reminder` is member name, club name, formatted amount, period, formatted date. Amounts and dates are formatted in the recipient's language before sending; templates never contain a currency symbol. Marketing-category templates are not used at launch.

### F.3 SMS

| Key | Instance | Text |
|---|---|---|
| `sms.otp` (DLT) | RIZones | The registered text in `SmsService.cs`, unchanged, with its template id and entity id |
| `sms.otp` | ROW | "{code} is your {brandName} verification code. It expires in {minutes} minutes." translated per language |

### F.4 Email template keys

| Key | Wave | Source today |
|---|---|---|
| `auth.otp`, `auth.passwordReset`, `auth.passwordChanged`, `auth.welcomeCredentials`, `auth.roleAssigned` | 1 (WS2-19) | `EmailService`, `MobileAuthService`, `RoleService` |
| `dues.receipt`, `dues.reminder`, `dues.approvalRequest`, `dues.approved` | 2 (WS2-20) | `MembershipDuesService` |
| `clubDues.reminder`, `clubDues.receipt` | 2 | `ClubDuesService` |
| `event.paymentLink`, `event.receipt`, `event.reminder` | 2 | `EventPaymentLinkService` |
| `wallet.topupReceipt`, `wallet.creditExpiry`, `website.invoice` | 2 | `CreditManagementService`, `CreditExpiryBackgroundService`, `WebsiteBillingService` |
| `kyc.submitted`, `kyc.status`, `route.accountStatus` | 2 (RIZones only, English) | `CashfreeKycService`, `RazorpayRouteAccountsController` |
| `cmr.submitted`, `cmr.reminder` | 3 (WS2-21) | `ClubMonthlyReportService`, `CmrSubmissionMailer` |
| `content.announcement`, `content.event`, `content.newsletter` | 3 | `EmailScheduledSendBackgroundService` |
| `project.approvalRequest`, `project.approved`, `project.rejected` | 3 | `ProjectApprovalService` |
| `website.activated`, `website.reminder`, `website.training` | 3 | `ClubWebsitesController`, `ClubWebsiteReminderBackgroundService` |
| `directory.invite`, `directory.reminder`, `directory.otp` | 3 | `DirectoryDataCollectionController`, `PublicDirectoryController` |
| `awards.notice`, `district.notice`, `leadership.notice`, `superadmin.notice` | 3 | `DistrictAwardsConfigController`, `DistrictModulesController`, `ClubLeadershipEmailBackgroundService`, `SuperAdminController` |
| `greeting.birthday`, `greeting.anniversary` (frame only) | 3 | `GreetingsWorker` |
| `report.dailyStats`, `report.districtPerformance`, `report.dataQuality`, `sync.report` | 3 (staff reports, English only) | `DailyStatsReportService`, `DistrictPerformanceReportService`, `AssistantDataQualityService`, `ClubSyncService` |
| `privacy.exportReady`, `privacy.erasureDone` | with WS7 | new |

## Appendix G. Personal-data registry

One `PersonalTable` entry per row. "Match" is how rows are tied to a member. Tables created by this plan that refer to a member are included at the end.

| Table | Match | Personal columns | On erasure |
|---|---|---|---|
| `member_master_profile` | id | `MemberName`, `ProfilePhotoPath`, `FamilyPhotoPath`, `PrimaryMobileNumber`, `SecondaryMobileNumber`, `EmailId`, `SecondaryEmailId`, `BirthDate`, `AnniversaryDate`, `BloodGroup`, `Gender`, `RotaryId`, `PrimaryLanguage`, `LastDeviceToken`, visibility flags | Anonymise: name to "Erased member", the rest null; `isdeleted = 1` |
| `member_credentials` | member id | `PasswordHash` | Delete row |
| `member_address_details` | member id | `Address`, `PhoneNumber`, `BusinessEmailId` and the remaining address fields | Delete rows |
| `member_family_details` | member id | names, `BloodGroup`, `PhoneNumber`, `EmailId`, `BirthDate`, `AnniversaryDate`, `PhotoPath` | Delete rows |
| `password_reset_tokens`, `web_sso_token`, `mobile_login_otp` | member id | tokens, `sent_email`, `sent_whatsapp` | Delete rows |
| `member_fcm_tokens`, `member_device_sessions` | member id | `FcmToken`, `device_token` | Delete rows |
| `club_members`, `member_roles`, `sub_group_members` | member id | membership and role facts | Keep rows, soft-deleted, pointing at the anonymised member |
| `board_of_directors` | member id | `non_member_mobile`, `non_member_email` | Keep the role row; null the contact columns |
| `past_presidents` | member id | `non_member_photo` | Keep; null the photo |
| `district_committee_member`, `district_committee_group_member`, `district_committee_sub_group_member` | `fk_member_id` | `mobile`, `email`, `profile_photo`, name copy | Anonymise the copied columns |
| `district_governors` | `fk_member_id` | `member_name`, `profile_photo`, `email`, `mobile_number` | Anonymise. A governor's name and year are public record: keep the name only if counsel confirms (Q6) |
| `district_ag`, `district_club_moderator`, `goal_role_assignments`, `goal_oversight_access` | `fk_member_id` | assignment facts | Delete rows |
| `club_attendance_members` | `fk_member_id` | attendance | Keep (counts), pointing at the anonymised member |
| `club_monthly_reports` | `fk_ag_member_id` | reviewer reference | Keep |
| `club_mass_email_recipients`, `club_leadership_email_log` | `fk_member_id` | `MemberName`, `Email` | Anonymise |
| `district_report_reminder_log` | `fk_member_id` | `member_name` | Anonymise |
| `district_directory_submission_log`, `directory_data_member_status` | `fk_member_id` | `IpAddress`, `FilledByAdminMobile` | Anonymise |
| `event_payment_members` | member reference or contact | `MemberName`, `Mobile`, `Email`, `PartnerMobile`, `PartnerEmail`, `PartnerGender` | Keep the payment; anonymise the contact columns |
| `event_payment_otp` | `Email` or `Mobile` | both | Delete rows |
| Membership dues member and payment rows, `club_dues_members`, `club_dues_member_account_payments` | member id | payer reference | Keep (financial record), pointing at the anonymised member |
| `potential_members` | referrer id; own contact | `email`, `mobile_number` | Null the referrer; a potential member's own erasure deletes the row |
| `email_log` | **`recipient_email`** (no member key) | `recipient_email`, `cc_emails`, body | Replace recipient and body with a marker |
| `whatsapp_log` | **`recipient_mobile`** | `recipient_mobile`, `recipient_name`, payload | Replace with a marker |
| `announcement_push_log`, `announcement_reminder_push_log`, `event_push_log`, `event_reminder_push_log`, `document_push_log`, `newsletter_push_log`, `project_push_log` | member id | `FcmToken` | Delete rows |
| `greeting_send_log`, `login_announcement_reads`, `goal_message_seen`, `goal_message_thread_seen` | `fk_member_id` | activity facts | Delete rows |
| `audit_log` | member id | `member_name`, `ip_address` | Keep the row; null name and IP |
| `login_audit_logs` | `fk_member_id` | `member_name`, `email_or_mobile`, `ip_address` | Delete rows |
| `superadmin_audit` | target and acting member | `IpAddress` | Keep; null IP |
| `rotary_org_club_members_cache` | Rotary id | `FirstName`, `MiddleName`, `LastName`, `BirthYear`, `DateOfBirth`, `Email`, `Mobile`, `Gender`, `AddressLine`, `PrimaryLanguage` | Delete rows |
| `rotary_org_terminated_cache` | Rotary id | names | Delete rows |
| `rotary_org_member_recognition` | member id | recognition facts | Delete rows |
| `sync_exception_log` | `rotary_id` or member id | identifiers | Delete rows |
| `website_training_appointments` | `fk_booker_member_id` | booker reference | Keep; null the reference |
| `ri_director_credential_email` | `fk_member_id` | credential notice | Delete rows |
| `pph_camp_attendies`, `pph_camp_attendance` | not members (camp attendees) | `MobileNo`, `Address`, blood-sugar values | Outside member erasure; **health data of non-members**: confirm with counsel whether the PPH camp module is offered on ROW at all |
| `cashfree_kyc` | contact | `email`, `phone` | RIZones only; not present in ROW use |
| `club_website_contact_detail`, `rotary_org_clubs_cache`, `district_directory_config`, `club_master`, `district_master` | none | club and district contact details, greeting sender addresses | Not personal to a member; outside erasure |
| `assistant_conversations`, `assistant_turns` | `fk_member_id` | questions and answers | Delete rows |
| `member_consents` (new) | `fk_member_id` | consent record, IP | Keep the record of consent and withdrawal; null the IP |
| `privacy_requests` (new) | `fk_member_id` | the request | Keep |
| `payment_refunds` (new) | `requested_by` | reference | Keep |
| Files | | Profile and family photos, uploaded documents naming the member | Delete the photo files |

## Appendix H. Checklists

### H.1 Pull request author

- [ ] Title starts with the task id.
- [ ] One task, under 400 changed lines excluding generated message files.
- [ ] "How verified" is filled in with what was actually run.
- [ ] "RIZones check" is filled in.
- [ ] No brand or instance check in code; every difference is configuration, a provider or a flag.
- [ ] No new `IST`, `+91`, `INR`, `₹`, GST rate, domain, role or designation id literal, or English user-facing string in a scoped file.
- [ ] No `DateTime.Now` in new code (`InstanceClock` or `TimeProvider`).
- [ ] New configuration keys have defaults and are in Appendix A; new flags are in Appendix C; new tables and columns are in Appendix B and `DatabaseInitializer`; new tables with member data are in Appendix G.
- [ ] New error responses carry a code listed in Appendix D.
- [ ] Payment, message and sync calls log instance, district and correlation id.
- [ ] Screenshots in English and the pseudo-locale for visible changes.
- [ ] Assisted-coding output was read line by line.

### H.2 Reviewer

- [ ] I ran it, or I ran its tests and opened the affected pages.
- [ ] With no `Brand` section the behaviour is exactly as before.
- [ ] Refactors contain no behaviour change and have a characterisation test.
- [ ] Migrations are additive and the previous build still runs on the new schema.
- [ ] No secret, personal data or production connection string in the diff, tests or fixtures.
- [ ] Both smoke suites are green.

### H.3 Onboarding a district on ROW

1. Confirm the district is in `Brand:Scope` (zone and country).
2. Run the sync steps of WS8-10 for its clubs.
3. Set the district's time zone, default currency and default language.
4. Enable its modules.
5. Assign the first District Admin and send credentials.
6. The District Admin connects a payment account (or records that none is available in the country).
7. Verify counts against Rotary.org for five clubs.
8. Add the district to the monitoring digest.

## Appendix I. Generated inventories

Every list below was produced from the repository at the head of `main` on 30 September 2026 by search, not written by hand. Line numbers move; search for the symbol if one is stale. Regenerate a list before starting the task that uses it.

### G1. Most reused API messages (candidates for error codes)

| Count | Message |
|---|---|
| 113 | This club, its district, or its zone is inactive. Reactivate it first to access this data. |
| 83 | Access denied. |
| 82 | This district or its zone is inactive. Reactivate it first to access this data. |
| 30 | No file uploaded |
| 20 | yearId is required. |
| 15 | clubId is required. |
| 14 | Record not found. |
| 14 | Order saved. |
| 14 | File size must be less than 5MB |
| 13 | No data. |
| 12 | Invalid file type. Allowed: jpg, jpeg, png, gif, webp |
| 12 | Club not found |
| 11 | districtId is required. |
| 11 | districtId and yearId are required. |
| 11 | This district or its zone is inactive. |
| 10 | OrderedIds is required. |
| 10 | Member not found |
| 9 | No club admin assignment found. |
| 9 | District not found |
| 8 | SuperAdmin only. |
| 8 | Project not found. |
| 8 | Not signed in. |
| 8 | No zone assigned. |
| 8 | No file uploaded. |
| 8 | Logo file size must be less than 5MB. |
| 8 | Deleted. |
| 7 | Plesk not configured. |
| 7 | Club not found. |
| 7 | Approval request not found. |
| 6 | Payment not found. |
| 6 | Menu not found. |
| 6 | Member not found. |
| 6 | At least 1 photo is required to save this project. |
| 6 | Acknowledged. |
| 5 | SuperAdmin access required. |
| 5 | Order not found. |
| 5 | Not available. |
| 5 | No rotary year available. |
| 5 | No district admin assignment found. |
| 5 | Invalid link |

### G2. WhatsApp template names

See Appendix F.1, where each literal is mapped to its logical key.

### G3. Interakt (WhatsApp) call sites

- `RotaryApi/Controllers/ClubWebsitesController.cs:1820`
- `RotaryApi/Controllers/DirectoryDataCollectionController.cs:399`
- `RotaryApi/Controllers/DistrictModulesController.cs:3251`
- `RotaryApi/Controllers/PublicDirectoryController.cs:1151`
- `RotaryApi/Services/ClubDuesService.cs:1692`
- `RotaryApi/Services/ClubWebsiteReminderBackgroundService.cs:215`
- `RotaryApi/Services/EventPaymentLinkService.cs:1074`
- `RotaryApi/Services/EventPaymentLinkService.cs:1133`
- `RotaryApi/Services/MembershipDuesService.cs:2322`
- `RotaryApi/Services/MembershipDuesService.cs:2397`
- `RotaryApi/Services/OtpWhatsAppHelper.cs:140`
- `RotaryApi/Services/WhatsAppScheduledSendBackgroundService.cs:829`

### G4. SMS call sites

- `RotaryApi/Controllers/ClubWebsitesController.cs:1434`
- `RotaryApi/Controllers/PublicDirectoryController.cs:304`
- `RotaryApi/Controllers/SuperAdminController.cs:261`
- `RotaryApi/Services/EventPaymentLinkService.cs:1329`
- `RotaryApi/Services/MembershipDuesService.cs:2695`
- `RotaryApi/Services/MobileAuthService.cs:286`

### G5. Inline frontend URL fallbacks in the API

- `RotaryApi/Controllers/ClubReportController.cs:28`
- `RotaryApi/Controllers/ClubWebsitePublicController.cs:189`
- `RotaryApi/Controllers/ClubWebsitesController.cs:1137`
- `RotaryApi/Controllers/ClubWebsitesController.cs:1627`
- `RotaryApi/Controllers/ClubWebsitesController.cs:1732`
- `RotaryApi/Controllers/DirectoryDataCollectionController.cs:324`
- `RotaryApi/Controllers/DirectoryDataCollectionController.cs:606`
- `RotaryApi/Controllers/DistrictReportController.cs:25`
- `RotaryApi/Controllers/MobileMembershipDuesController.cs:38`
- `RotaryApi/Controllers/MobileMembershipDuesController.cs:165`
- `RotaryApi/Controllers/PublicDirectoryController.cs:65`
- `RotaryApi/Controllers/PublicProjectShareController.cs:318`
- `RotaryApi/Controllers/WalletLinksController.cs:43`
- `RotaryApi/Controllers/WebSsoController.cs:68`
- `RotaryApi/Services/AuthService.cs:343`
- `RotaryApi/Services/ClubDuesService.cs:1014`
- `RotaryApi/Services/ClubDuesService.cs:1372`
- `RotaryApi/Services/ClubDuesService.cs:1514`
- `RotaryApi/Services/ClubDuesService.cs:1666`
- `RotaryApi/Services/ClubDuesService.cs:1934`
- `RotaryApi/Services/ClubWebsiteReminderBackgroundService.cs:184`
- `RotaryApi/Services/EmailScheduledSendBackgroundService.cs:235`
- `RotaryApi/Services/EventPaymentLinkService.cs:259`
- `RotaryApi/Services/EventPaymentLinkService.cs:361`
- `RotaryApi/Services/EventPaymentLinkService.cs:1055`
- `RotaryApi/Services/EventPaymentLinkService.cs:1072`
- `RotaryApi/Services/EventPaymentLinkService.cs:1086`
- `RotaryApi/Services/EventPaymentLinkService.cs:1124`
- `RotaryApi/Services/EventPaymentLinkService.cs:1473`
- `RotaryApi/Services/MembershipDuesService.cs:292`
- `RotaryApi/Services/MembershipDuesService.cs:2108`
- `RotaryApi/Services/MembershipDuesService.cs:2175`
- `RotaryApi/Services/MembershipDuesService.cs:2317`
- `RotaryApi/Services/MembershipDuesService.cs:2361`
- `RotaryApi/Services/MembershipDuesService.cs:2812`
- `RotaryApi/Services/WhatsAppScheduledSendBackgroundService.cs:425`

### G6. Files that hard-code a product domain (API, count per file)

- `RotaryApi/Program.cs` (11)
- `RotaryApi/Services/WhatsAppCommsTemplates.cs` (10)
- `RotaryApi/Services/EmailService.cs` (6)
- `RotaryApi/Controllers/ClubWebsitesController.cs` (6)
- `RotaryApi/Controllers/PublicProjectShareController.cs` (5)
- `RotaryApi/Services/WebsiteDomainHelper.cs` (4)
- `RotaryApi/Controllers/PublicDirectoryController.cs` (4)
- `RotaryApi/Controllers/DirectoryDataCollectionController.cs` (4)
- `RotaryApi/Services/MemberScopesHelper.cs` (3)
- `RotaryApi/Services/DistrictPerformanceReportService.cs` (3)
- `RotaryApi/Services/ClubAdminDashboardService.cs` (3)
- `RotaryApi/Controllers/ClubWebsitePublicController.cs` (3)
- `RotaryApi/Services/WebsiteBillingService.cs` (2)
- `RotaryApi/Services/MembershipDuesService.cs` (2)
- `RotaryApi/Services/MemberService.cs` (2)
- `RotaryApi/Services/IisAppPoolRecycler.cs` (2)
- `RotaryApi/Services/DatabaseInitializer.cs` (2)
- `RotaryApi/Services/DailyStatsReportService.cs` (2)
- `RotaryApi/Services/ClubWebsiteReminderBackgroundService.cs` (2)
- `RotaryApi/Services/ClubWebsiteActivationService.cs` (2)
- `RotaryApi/Controllers/ClubReportController.cs` (2)
- `RotaryApi/Services/ProjectShareCardBuilder.cs` (1)
- `RotaryApi/Services/ProjectCountRules.cs` (1)
- `RotaryApi/Services/PastPresidentService.cs` (1)
- `RotaryApi/Services/OtpWhatsAppHelper.cs` (1)
- `RotaryApi/Services/OcvReportExcelBuilder.cs` (1)
- `RotaryApi/Services/EmailScheduledSendBackgroundService.cs` (1)
- `RotaryApi/Services/ClubReportWordBuilder.cs` (1)
- `RotaryApi/Services/ClubMenuService.cs` (1)
- `RotaryApi/Services/ClubDuesService.cs` (1)
- `RotaryApi/Services/CashfreeGatewayProxy.cs` (1)
- `RotaryApi/Services/Assistant/AssistantOrchestrator.cs` (1)
- `RotaryApi/DTOs/WebsiteBillingDtos.cs` (1)
- `RotaryApi/Controllers/WebSsoController.cs` (1)
- `RotaryApi/Controllers/WalletLinksController.cs` (1)
- `RotaryApi/Controllers/RotaryThirdPartyController.cs` (1)
- `RotaryApi/Controllers/PublicWebsiteDirectoryController.cs` (1)
- `RotaryApi/Controllers/OcvGovController.cs` (1)
- `RotaryApi/Controllers/MassEmailMediaController.cs` (1)
- `RotaryApi/Controllers/DistrictReportController.cs` (1)
- `RotaryApi/Controllers/DistrictModulesController.cs` (1)
- `RotaryApi/Controllers/ClubFinderController.cs` (1)

### G7. Files with their own IST logic

- `RotaryApi/DTOs/ClubDtos.cs`
- `RotaryApi/Models/Club.cs`
- `RotaryApi/Services/Assistant/AssistantDataQualityBackgroundService.cs`
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs`
- `RotaryApi/Services/DailyStatsReportBackgroundService.cs`
- `RotaryApi/Services/DatabaseInitializer.cs`
- `RotaryApi/Services/DistrictPerformanceReportBackgroundService.cs`
- `RotaryApi/Services/RotaryOrg/ClubCacheRefreshService.cs`
- `RotaryApi/Services/RotaryOrg/ClubSyncService.cs`
- `RotaryApi/Services/TrainingAppointmentService.cs`
- `RotaryApi/Services/ZoomMeetingService.cs`
- `RotaryOrgSyncWorker/Services/ClubSyncWorker.cs`
- `RotaryOrgSyncWorker/Services/CountrySyncWorker.cs`
- `RotaryOrgSyncWorker/Services/WorldEnsureWorker.cs`
- `RotaryOrgSyncWorker/Services/WorldSyncWorker.cs`

### G8. Role id literals (fk_role_id = N), count per file

- `RotaryApi/Services/GoalSettingService.cs` (17)
- `RotaryApi/Controllers/DistrictModulesController.cs` (15)
- `RotaryApi/Services/DatabaseInitializer.StoredProcedures.cs` (11)
- `RotaryApi/Services/DatabaseInitializer.cs` (8)
- `RotaryApi/Services/ClubAdminDashboardService.cs` (8)
- `RotaryApi/Services/ClubAdminAccessHelper.cs` (8)
- `RotaryApi/Services/RoleService.cs` (7)
- `RotaryApi/Services/DistrictService.cs` (7)
- `RotaryApi/Services/DistrictAdminDashboardService.cs` (7)
- `RotaryApi/Controllers/ClubDuesController.cs` (6)
- `RotaryApi/Controllers/DashboardResolverController.cs` (4)
- `RotaryOrgSyncWorker/Services/BodSyncWorker.cs` (3)
- `RotaryApi/Services/FoundationGoalsService.cs` (3)
- `RotaryApi/Services/TrainingAppointmentService.cs` (2)
- `RotaryApi/Services/MemberService.cs` (2)
- `RotaryApi/Services/MemberScopesHelper.cs` (2)
- `RotaryApi/Services/DistrictPerformanceReportService.cs` (2)
- `RotaryApi/Services/ClubService.cs` (2)
- `RotaryApi/Controllers/WalletController.cs` (2)
- `RotaryApi/Controllers/RotaryOrgFoundationController.cs` (2)
- `RotaryApi/Controllers/CreditManagementController.cs` (2)
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs` (1)
- `RotaryApi/Services/ZoneService.cs` (1)
- `RotaryApi/Services/ProjectApprovalService.cs` (1)
- `RotaryApi/Services/CreditManagementService.cs` (1)
- `RotaryApi/Services/CreditExpiryBackgroundService.cs` (1)
- `RotaryApi/Controllers/WhatsAppLogController.cs` (1)
- `RotaryApi/Controllers/WebsiteBillingController.cs` (1)
- `RotaryApi/Controllers/TrainingAppointmentController.cs` (1)
- `RotaryApi/Controllers/RouteMaintenanceController.cs` (1)
- `RotaryApi/Controllers/RotaryOrgManualSyncController.cs` (1)
- `RotaryApi/Controllers/RiAdminCleanupController.cs` (1)
- `RotaryApi/Controllers/ReportsController.cs` (1)
- `RotaryApi/Controllers/MobileLoginCheckController.cs` (1)
- `RotaryApi/Controllers/GlobalSearchController.cs` (1)
- `RotaryApi/Controllers/EmailLogController.cs` (1)
- `RotaryApi/Controllers/DistrictAwardsConfigController.cs` (1)
- `RotaryApi/Controllers/ClubLeadershipController.cs` (1)
- `RotaryApi/Controllers/ClubAdminDashboardController.cs` (1)

### G9. Designation id literals

- `RotaryApi/Controllers/AgReportsController.cs:190`
- `RotaryApi/Controllers/ClubReportController.cs:930`
- `RotaryApi/Controllers/DistrictReportController.cs:854`
- `RotaryApi/Controllers/DistrictReportController.cs:857`
- `RotaryApi/Controllers/DistrictReportController.cs:860`
- `RotaryApi/Controllers/DistrictReportController.cs:863`
- `RotaryApi/Controllers/DistrictReportController.cs:866`
- `RotaryApi/Controllers/DistrictReportController.cs:869`
- `RotaryApi/Controllers/DistrictReportController.cs:1226`
- `RotaryApi/Services/ClubService.cs:1085`
- `RotaryApi/Services/DirectoryDataCollectionFields.cs:160`
- `RotaryApi/Services/MemberService.cs:517`
- `RotaryApi/Services/MemberService.cs:664`
- `RotaryApi/Services/RoleService.cs:315`

### G10. Hosted services registered in Program.cs

- `DailyStatsReportBackgroundService`
- `DistrictPerformanceReportBackgroundService`
- `WebsiteProvisioningBackgroundService`
- `CreditExpiryBackgroundService`
- `ZonalAwardsAutoCalculationBackgroundService`
- `WhatsAppScheduledSendBackgroundService`
- `EmailScheduledSendBackgroundService`
- `ClubLeadershipEmailBackgroundService`
- `ClubWebsiteReminderBackgroundService`
- `RotaryYearRolloverBackgroundService`
- `RazorpaySettlementSyncBackgroundService`
- `MembershipDuesReconciliationBackgroundService`
- `RotaryOrg.ClubCacheRefreshBackgroundService`
- `Assistant.AssistantDataQualityBackgroundService`
- `Push.AnnouncementPushBackgroundService`
- `Push.EventPushBackgroundService`
- `Push.DocumentPushBackgroundService`
- `Push.NewsletterPushBackgroundService`
- `Push.ProjectPushBackgroundService`
- `Push.ReminderPushBackgroundService`
- `Push.PushLogCleanupBackgroundService`

### G11. Scheduled tasks (Task Scheduler XML files)

- `AwardsAutoCalcWorker/TaskScheduler-DistrictCitation-Nightly.xml`
- `AwardsAutoCalcWorker/TaskScheduler-ZonalAwards-Nightly.xml`
- `GreetingsWorker/TaskScheduler-Greetings-Morning.xml`
- `RotaryOrgSyncWorker/TaskScheduler-BodSync-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-BodSync.xml`
- `RotaryOrgSyncWorker/TaskScheduler-ClubReconcile-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-ClubsBootstrap-Weekly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-ClubsDelta-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-ClubsRepairSync-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-CountrySync-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-MemberDailyDelta-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-MemberSweep-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-MemberSweep.xml`
- `RotaryOrgSyncWorker/TaskScheduler-MemberSync-Nightly.xml`
- `RotaryOrgSyncWorker/TaskScheduler-TerminateAudit-Weekly.xml`

### G12. Hard-coded INR literal, count per file (API)

- `RotaryApi/Controllers/ClubWebsitePublicDataV2Controller.cs` (7)
- `RotaryApi/DTOs/ClubAdminDashboardDtos.cs` (6)
- `RotaryApi/Controllers/PublicProjectStatsController.cs` (6)
- `RotaryApi/Services/WebsiteBillingService.cs` (4)
- `RotaryApi/Services/CurrencyRateService.cs` (4)
- `RotaryApi/Services/CurrencyHelper.cs` (4)
- `RotaryApi/Controllers/ClubWebsitePublicDataController.cs` (4)
- `RotaryApi/Services/ClubDuesService.cs` (3)
- `RotaryApi/Services/WalletService.cs` (2)
- `RotaryApi/Services/DistrictPerformanceReportService.cs` (2)
- `RotaryApi/DTOs/ProjectDtos.cs` (2)
- `RotaryApi/DTOs/AgDashboardDtos.cs` (2)
- `RotaryApi/Services/RotaryOrg/FoundationIngestService.cs` (1)
- `RotaryApi/Services/MembershipDuesService.cs` (1)
- `RotaryApi/Services/EventPaymentLinkService.cs` (1)
- `RotaryApi/Services/CashfreeGatewayProxy.cs` (1)
- `RotaryApi/Services/AgDashboardService.cs` (1)
- `RotaryApi/DTOs/WebsiteBillingDtos.cs` (1)
- `RotaryApi/DTOs/WalletDtos.cs` (1)
- `RotaryApi/DTOs/GoalsIngestDtos.cs` (1)

### G13. Frontend files with the most hard-coded en-IN, rupee or INR

- `app/settings/club-dues/create/page.tsx` (25)
- `components/public/PublicLanding.tsx` (23)
- `app/settings/club-dues/[duesId]/clubs/page.tsx` (15)
- `app/report/club-dues/[duesId]/page.tsx` (14)
- `app/district-admin-dashboard/club-dues/page.tsx` (13)
- `app/settings/event-payment-links/create/page.tsx` (11)
- `lib/addToOrg.ts` (10)
- `app/clubs/[id]/projects/add/page.tsx` (10)
- `lib/currency.ts` (9)
- `components/dashboard/formatters.ts` (9)
- `app/clubs/[id]/membership-dues/v2/[duesId]/members/page.tsx` (9)
- `app/settings/wallet/PricingRemindersTab.tsx` (8)
- `app/settings/membership-dues/create/page.tsx` (8)
- `app/settings/club-websites/page.tsx` (8)
- `app/clubs/[id]/membership-dues/[duesId]/members/page.tsx` (8)
- `components/pages/projects/shared.tsx` (7)
- `components/pages/projects/ProjectsHub.tsx` (7)
- `app/settings/global-member-search/page.tsx` (7)
- `app/settings/daily-stats-report/page.tsx` (7)
- `app/pay/club-dues/[duesId]/page.tsx` (7)
- `app/clubs/[id]/vocational-service/v2/add/page.tsx` (7)
- `app/club-admin-dashboard/club-dues/page.tsx` (7)
- `components/wallet/WalletTopup.tsx` (6)
- `app/settings/membership-dues/[duesId]/members/page.tsx` (6)
- `app/settings/club-leadership/page.tsx` (6)
- `app/districts/[id]/projects/v2/add/page.tsx` (6)
- `app/districts/[id]/projects/v2/[projectId]/edit/page.tsx` (6)
- `app/districts/[id]/projects/add/page.tsx` (6)
- `app/districts/[id]/projects/[projectId]/edit/page.tsx` (6)
- `app/clubs/[id]/vocational-service/add/page.tsx` (6)
- `app/clubs/[id]/vocational-service/[projectId]/page.tsx` (6)
- `app/clubs/[id]/vocational-service/[projectId]/edit/page.tsx` (6)
- `app/clubs/[id]/public-image-initiative/v2/page.tsx` (6)
- `app/clubs/[id]/projects/[projectId]/edit/page.tsx` (6)
- `app/clubs/[id]/new-generation-service/v2/page.tsx` (6)
- `app/clubs/[id]/new-generation-service/add/page.tsx` (6)
- `app/clubs/[id]/new-generation-service/[projectId]/page.tsx` (6)
- `app/clubs/[id]/new-generation-service/[projectId]/edit/page.tsx` (6)
- `app/clubs/[id]/international-service/add/page.tsx` (6)
- `app/clubs/[id]/international-service/[projectId]/page.tsx` (6)

### G14. Club modules without a v2 page

- `clubs/[id]/dashboard`
- `clubs/[id]/greetings`
- `clubs/[id]/mass-emails`
- `clubs/[id]/members`
- `clubs/[id]/projects`
- `clubs/[id]/rotary-network`
- `clubs/[id]/sub-groups`
- `clubs/[id]/weblinks`
- `clubs/[id]/website-data`

### G15. District modules without a v2 page

- `districts/[id]/club-monthly-report`
- `districts/[id]/dashboard`
- `districts/[id]/district-report`
- `districts/[id]/event-payment-links`
- `districts/[id]/greetings`
- `districts/[id]/mass-emails`
- `districts/[id]/members`
- `districts/[id]/sub-groups`
- `districts/[id]/weblinks`
- `districts/[id]/website-data`
- `districts/[id]/zonal-awards`

### G16. Frontend files calling confirm(), alert() or prompt() (count per file, top 40)

- `app/settings/club-websites/page.tsx` (7)
- `app/settings/rotary-org/duplicates/page.tsx` (5)
- `app/settings/goal-setting-roles/page.tsx` (5)
- `app/settings/district-websites/page.tsx` (5)
- `app/clubs/[id]/membership-dues/v2/[duesId]/members/page.tsx` (4)
- `app/club-admin-dashboard/dashboard/directory/page.tsx` (4)
- `app/settings/membership-dues/[duesId]/members/page.tsx` (3)
- `app/settings/directory-data-collection/page.tsx` (3)
- `app/clubs/[id]/club-report/v2/view.tsx` (3)
- `app/clubs/[id]/club-monthly-report/v2/[yearId]/[month]/page.tsx` (3)
- `app/clubs/[id]/club-monthly-report/[yearId]/[month]/page.tsx` (3)
- `app/settings/rotary-org/duplicates/MergeDialog.tsx` (2)
- `app/settings/login-announcement/page.tsx` (2)
- `app/settings/district-performance-report/page.tsx` (2)
- `app/settings/club-dues/page.tsx` (2)
- `app/districts/[id]/projects/v2/[projectId]/edit/page.tsx` (2)
- `app/districts/[id]/projects/[projectId]/edit/page.tsx` (2)
- `app/districts/[id]/district-events/v2/[eventId]/edit/page.tsx` (2)
- `app/districts/[id]/district-events/[eventId]/edit/page.tsx` (2)
- `app/clubs/[id]/vocational-service/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/vocational-service/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/public-image-initiative/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/public-image-initiative/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/projects/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/new-generation-service/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/new-generation-service/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/international-service/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/international-service/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/community-service/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/club-service/v2/[projectId]/edit/page.tsx` (2)
- `app/clubs/[id]/club-service/[projectId]/edit/page.tsx` (2)
- `components/training/TrainingBookingDialog.tsx` (1)
- `components/dashboard/FoundationGoalsCard.tsx` (1)
- `components/RichTextEditor.tsx` (1)
- `app/settings/project-categorization/page.tsx` (1)
- `app/settings/membership-dues/page.tsx` (1)
- `app/settings/membership-dues/create/page.tsx` (1)
- `app/settings/event-payment-links/page.tsx` (1)
- `app/settings/district-governor/page.tsx` (1)
- `app/settings/daily-stats-report/page.tsx` (1)

### G17. Frontend files that reference a logo or brand image directly

- `app/admin/tutorial/page.tsx`
- `app/clubs/[id]/website-data/logos/page.tsx`
- `app/forgot-password/page.tsx`
- `app/layout.tsx`
- `app/login/page.tsx`
- `app/pay/dues/[duesId]/page.tsx`
- `app/pay/[linkId]/page.tsx`
- `app/public/project/[projectId]/page.tsx`
- `app/report/club-dues/[duesId]/page.tsx`
- `app/report/dues/[duesId]/page.tsx`
- `app/report/[linkId]/page.tsx`
- `app/ri-director/v2/page.tsx`
- `app/zonal-dashboard/page.tsx`
- `components/AppHeader.tsx`
- `components/dashboard/DashboardShell.tsx`
- `components/PayPageShell.tsx`
- `components/public/PublicFooter.tsx`
- `components/public/PublicHeader.tsx`
- `components/public/PublicLanding.tsx`
- `components/RotaryLoader.tsx`
- `components/RouteLoadingIndicator.tsx`
- `components/site/FooterBottomBar.tsx`
- `components/site/Logo.tsx`
- `components/v2/ClubAdminShell.tsx`
- `components/v2/DistrictAdminShell.tsx`
- `components/v2/GoalOversightShell.tsx`
- `components/WhatsAppPhonePreview.tsx`
- `services/api.ts`

### G19. Files that build an email with the shared header (references to `EMAIL_HEADER`)

- `RotaryApi/Services/EmailService.cs` (15)
- `RotaryApi/Services/MembershipDuesService.cs` (5)
- `RotaryApi/Services/EventPaymentLinkService.cs` (4)
- `RotaryApi/Services/RoleService.cs` (4)
- `RotaryApi/Controllers/PublicDirectoryController.cs` (2)
- `RotaryApi/Services/CashfreeKycService.cs` (2)
- `RotaryApi/Services/DistrictPerformanceReportService.cs` (2)
- `RotaryApi/Services/ProjectApprovalService.cs` (2)
- `RotaryApi/Controllers/ClubWebsitesController.cs` (1)
- `RotaryApi/Controllers/DirectoryDataCollectionController.cs` (1)
- `RotaryApi/Controllers/DistrictAwardsConfigController.cs` (1)
- `RotaryApi/Controllers/DistrictModulesController.cs` (1)
- `RotaryApi/Controllers/RazorpayRouteAccountsController.cs` (1)
- `RotaryApi/Controllers/SuperAdminController.cs` (1)
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs` (1)
- `RotaryApi/Services/ClubMonthlyReportService.cs` (1)
- `RotaryApi/Services/CmrSubmissionMailer.cs` (1)
- `RotaryApi/Services/CreditExpiryBackgroundService.cs` (1)
- `RotaryApi/Services/CreditManagementService.cs` (1)
- `RotaryApi/Services/DailyStatsReportService.cs` (1)
- `RotaryApi/Services/MobileAuthService.cs` (1)
- `RotaryApi/Services/RotaryOrg/ClubSyncService.cs` (1)

### G20. `CURDATE()` per file

- `RotaryApi/Controllers/ClubWebsitesController.cs` (8)
- `RotaryApi/Services/DistrictAdminDashboardService.cs` (7)
- `RotaryApi/Services/ClubAdminDashboardService.cs` (7)
- `RotaryApi/Services/FoundationGoalsService.cs` (6)
- `GreetingsWorker/Services/GreetingsJob.cs` (6)
- `RotaryApi/Services/WebsiteBillingService.cs` (4)
- `RotaryApi/Services/MobileNotificationFeedService.cs` (3)
- `RotaryApi/Services/MemberScopesHelper.cs` (3)
- `RotaryApi/Services/DistrictPerformanceReportService.cs` (3)
- `RotaryApi/Services/ClubWebsiteReminderBackgroundService.cs` (3)
- `RotaryApi/Controllers/ClubFinderController.cs` (3)
- `RotaryApi/Services/PastPresidentService.cs` (2)
- `RotaryApi/Services/GoalSettingService.cs` (2)
- `RotaryApi/Services/BoardDirectorService.cs` (2)
- `RotaryApi/Services/Assistant/Tools/GoalReportTools.cs` (2)
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs` (2)
- `RotaryApi/Services/AgDashboardService.cs` (2)
- `RotaryApi/Controllers/PublicProjectShareController.cs` (2)
- `RotaryApi/Controllers/GlobalSearchController.cs` (2)
- `RotaryApi/Controllers/ClubWebsitePublicController.cs` (2)
- `RotaryApi/Services/TrainingAppointmentService.cs` (1)
- `RotaryApi/Services/RiDirectorService.Modules.cs` (1)
- `RotaryApi/Services/Push/EventPushBackgroundService.cs` (1)
- `RotaryApi/Services/OcvLiveVisibility.cs` (1)
- `RotaryApi/Services/LoginAnnouncementAudience.cs` (1)
- `RotaryApi/Services/DatabaseInitializer.cs` (1)
- `RotaryApi/Services/DailyStatsReportService.cs` (1)
- `RotaryApi/Services/ClubService.cs` (1)
- `RotaryApi/Controllers/RotaryOrgManualSyncController.cs` (1)
- `RotaryApi/Controllers/ReportsController.cs` (1)
- `RotaryApi/Controllers/PublicWebsiteDirectoryController.cs` (1)
- `RotaryApi/Controllers/PublicProjectController.cs` (1)
- `RotaryApi/Controllers/MobileClubAdminPastPresidentsController.cs` (1)
- `RotaryApi/Controllers/MemberDuplicateController.cs` (1)
- `RotaryApi/Controllers/ClubWebsitePublicDataController.cs` (1)
- `RotaryApi/Controllers/ClubGalleryPublicController.cs` (1)

### G21. Reads of the GST percentage (count per file)

- `RotaryApi/Controllers/ClubWebsitesController.cs` (31)
- `RotaryApi/Services/WebsiteBillingService.cs` (7)
- `RotaryApi/Services/WebsiteDefaultPricing.cs` (4)
- `RotaryApi/Services/WalletService.cs` (2)
- `RotaryApi/Controllers/PublicClubWebsiteController.cs` (1)
- `RotaryApi/DTOs/WebsiteBillingDtos.cs` (1)
- `RotaryApi/Services/DatabaseInitializer.cs` (1)

### G22. Exempt-district literals (`5656`, `1280`, `IFRM`)

- `RotaryApi/Controllers/ClubProfileReportController.cs:63`
- `RotaryApi/Controllers/ClubWebsitePublicDataController.cs:124`
- `RotaryApi/Controllers/RotaryOrgManualSyncController.cs:219`
- `RotaryApi/Services/DailyStatsReportService.cs:13`
- `RotaryApi/Services/DailyStatsReportService.cs:74`
- `RotaryApi/Services/DailyStatsReportService.cs:287`
- `RotaryApi/Services/DailyStatsReportService.cs:778`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:76`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:77`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:81`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:82`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:384`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:385`
- `RotaryApi/Services/DistrictPerformanceReportService.cs:429`
- `RotaryApi/Services/NonSyncLoginGuardHelper.cs:16`
- `RotaryApi/Services/NonSyncLoginGuardHelper.cs:27`
- `RotaryApi/Services/OcvGovService.cs:527`
- `RotaryApi/Services/ProjectCountRules.cs:160`
- `RotaryOrgSyncWorker/Program.cs:162`
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs:774`
- `RotaryOrgSyncWorker/Services/ClubNonSyncCascadeWorker.cs:27`
- `RotaryOrgSyncWorker/Services/ClubNonSyncCascadeWorker.cs:39`
- `RotaryOrgSyncWorker/Services/ClubTerminator.cs:17`
- `RotaryOrgSyncWorker/Services/ClubTerminator.cs:44`
- `RotaryOrgSyncWorker/Services/CountrySyncWorker.cs:275`

### G23. Country-list literals (Sri Lanka, Nepal)

- `RotaryApi/Controllers/RotaryOrgManualSyncController.cs:284`
- `RotaryApi/Services/DatabaseInitializer.cs:416`
- `RotaryApi/Services/DatabaseInitializer.cs:6544`
- `RotaryApi/Services/DatabaseInitializer.cs:6556`
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs:1416`
- `RotaryOrgSyncWorker/Services/ClubNonSyncCascadeWorker.cs:36`
- `RotaryOrgSyncWorker/Services/DistrictDiagnoser.cs:15`
- `RotaryOrgSyncWorker/Services/DistrictListExporter.cs:15`
- `RotaryOrgSyncWorker/Services/RotaryOrgDtos.cs:244`
- `RotaryOrgSyncWorker/Services/WorldDistrictExporter.cs:42`
- `RotaryOrgSyncWorker/Services/WorldDistrictExporter.cs:52`
- `RotaryOrgSyncWorker/Services/WorldEnsureWorker.cs:26`
- `RotaryOrgSyncWorker/Services/WorldEnsureWorker.cs:53`
- `RotaryOrgSyncWorker/Services/WorldEnsureWorker.cs:63`
- `RotaryOrgSyncWorker/Services/WorldSyncWorker.cs:48`
- `RotaryOrgSyncWorker/Services/WorldSyncWorker.cs:58`

### G24. `+91` and dial-code 91 literals

- `RotaryApi/Controllers/DistrictDirectoryController.cs:181`
- `RotaryApi/Controllers/MembersController.cs:42`
- `RotaryApi/Controllers/MembersController.cs:216`
- `RotaryApi/Services/DatabaseInitializer.cs:6514`
- `RotaryApi/Services/DatabaseInitializer.cs:6599`
- `RotaryApi/Services/DirectoryDataCollectionFields.cs:198`
- `RotaryApi/Services/EmailService.cs:488`
- `RotaryApi/Services/EmailService.cs:604`
- `RotaryApi/Services/EmailService.cs:666`
- `RotaryApi/Services/IInteraktService.cs:22`
- `RotaryApi/Services/IInteraktService.cs:29`
- `RotaryApi/Services/InteraktService.cs:26`
- `RotaryApi/Services/InteraktService.cs:32`
- `RotaryApi/Services/InteraktService.cs:61`
- `RotaryApi/Services/InteraktService.cs:68`
- `RotaryApi/Services/InteraktService.cs:106`
- `RotaryApi/Services/OtpWhatsAppHelper.cs:37`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:9`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:13`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:17`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:18`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:24`
- `RotaryApi/Services/PhoneNumberNormalizer.cs:39`
- `RotaryApi/Services/RazorpayRouteService.cs:213`
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs:81`
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs:86`
- `RotaryOrgSyncWorker/Services/ClubMemberSweepWorker.cs:724`
- `RotaryOrgSyncWorker/Services/RotaryOrgDtos.cs:243`
- `GreetingsWorker/Services/InteraktWhatsAppSender.cs:33`
- `GreetingsWorker/Services/InteraktWhatsAppSender.cs:34`
- `GreetingsWorker/Services/InteraktWhatsAppSender.cs:47`

### G25. Private time-zone resolution (`ResolveIst`, `FindSystemTimeZoneById`)

- `RotaryApi/Services/Assistant/AssistantDataQualityBackgroundService.cs:58`
- `RotaryApi/Services/Assistant/AssistantDataQualityBackgroundService.cs:66`
- `RotaryApi/Services/Assistant/AssistantDataQualityBackgroundService.cs:70`
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs:455`
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs:486`
- `RotaryApi/Services/Assistant/AssistantDataQualityService.cs:490`
- `RotaryApi/Services/DailyStatsReportBackgroundService.cs:58`
- `RotaryApi/Services/DailyStatsReportBackgroundService.cs:66`
- `RotaryApi/Services/DailyStatsReportBackgroundService.cs:70`
- `RotaryApi/Services/DistrictPerformanceReportBackgroundService.cs:40`
- `RotaryApi/Services/DistrictPerformanceReportBackgroundService.cs:70`
- `RotaryApi/Services/DistrictPerformanceReportBackgroundService.cs:78`
- `RotaryApi/Services/DistrictPerformanceReportBackgroundService.cs:82`
- `RotaryApi/Services/RotaryOrg/ClubCacheRefreshService.cs:14`
- `RotaryApi/Services/RotaryOrg/ClubCacheRefreshService.cs:17`
- `RotaryApi/Services/TrainingAppointmentService.cs:45`
- `RotaryApi/Services/TrainingAppointmentService.cs:46`
- `RotaryApi/Services/TrainingAppointmentService.cs:49`

### G26. Payment gateway HTTP call sites (base URL resolution and settlement calls)

- `RotaryApi/Services/CashfreeKycService.cs:391`
- `RotaryApi/Services/CashfreeKycService.cs:546`
- `RotaryApi/Services/ClubDuesService.cs:1795`
- `RotaryApi/Services/EventPaymentLinkService.cs:2001`
- `RotaryApi/Services/MembershipDuesService.cs:3793`
- `RotaryApi/Services/RazorpayRouteService.cs:68`
- `RotaryApi/Services/RazorpaySettlementService.cs:33`
- `RotaryApi/Services/RazorpaySettlementService.cs:44`
- `RotaryApi/Services/WalletService.cs:143`
- `RotaryApi/Services/WebsiteBillingService.cs:354`

### G27. Conversion to minor units by multiplying by 100

- `RotaryApi/Services/ClubDuesService.cs:1758`
- `RotaryApi/Services/DistrictAdminDashboardService.cs:1438`
- `RotaryApi/Services/WalletService.cs:66`
- `RotaryApi/Services/WalletService.cs:70`
- `RotaryApi/Services/WebsiteBillingService.cs:61`

## Appendix J. Translation namespaces

Message files are `rotary-frontend/messages/<lang>/<namespace>.json`. The provider loads `common`, `errors` and the namespaces mapped to the current route.

| Namespace | Loaded for routes | Contents |
|---|---|---|
| `common` | every route | Buttons, table and pagination text, confirm dialogs, status labels, months through `Intl`, shared form labels, header, language picker |
| `errors` | every route | One entry per error code of Appendix D, plus `generic` |
| `auth` | `login`, `forgot-password`, `reset-password`, `sso` | Sign-in and password flows, consent screen |
| `clubDashboard` | `club-admin-dashboard/**` | Club admin shell, navigation, dashboard cards |
| `districtDashboard` | `district-admin-dashboard/**` | District admin shell, navigation, dashboard cards |
| `members` | `**/members/**`, directory, board of directors, past presidents, sub-groups | Member list, form, detail, roles |
| `content` | announcements, upcoming events, newsletters, documents, weblinks, greetings, mass emails | Content modules |
| `projects` | the seven project avenues, `projects`, public project pages | Shared project form, lists, approval |
| `cmr` | club monthly report, club report, district report, attendance | Reports |
| `dues` | membership dues, club dues, event payment links, wallet | Campaigns, member payment lists, approvals |
| `pay` | `pay/**`, `report/**`, approvals | Public payment and report pages |
| `foundation` | TRF, foundation goal, recognition | Foundation |
| `goals` | goal setting, goal overviews, membership goal | Goals |
| `awards` | citation, zonal awards | Awards (only if Q9 says ROW uses them) |
| `website` | website data, my club website, website purchase | Club website administration |
| `ag` | `ag-dashboard/**`, `ag-reports` | Assistant Governor |
| `riDirector` | `ri-director/**`, `zones/**`, `zonal-dashboard` | RI Director and zonal views |
| `site` | `(site)/**`, policy pages | Public marketing site |
| `payments` | payments connect pages | Connect account, refunds |
| `privacy` | privacy requests, consent | Privacy |

## Appendix K. Glossary

| Term | Meaning |
|---|---|
| **Instance** | One deployment of the platform with its own database, configuration and domains. There are two: RIZones and ROW |
| **Brand** | The configuration section that describes an instance |
| **India is the default** | With no `Brand` section, the code behaves exactly as RIZones does today |
| **Instance time** | The time zone stored timestamps are in. India time for both instances while they share a server |
| **District zone** | The IANA time zone of a district; decides what "today" and "09:00" mean for its users |
| **Scope (translation)** | The generated list of routes and files a non-SuperAdmin user can reach; only these are translated and linted |
| **Pseudo-locale** | A generated fake language that brackets and lengthens every string, used to find untranslated text and overflow |
| **Characterisation test** | A test that records what existing code sends or returns before a refactor, and asserts the refactored code does the same |
| **Smoke suite** | Thirty black-box checks run against a live instance after every deploy |
| **Seed file** | A JSON file in the repository holding the rows of one master table; the only way master data changes |
| **Preserve / assign** | Seed id policies: keep the production id, or let the database assign one and match by business key |
| **Merchant order id** | Our own identifier for a payment order, prefixed by flow; every gateway echoes it back |
| **Connected account** | A district's or club's own payment gateway account, whose keys are stored encrypted |
| **Tombstone** | A salted hash of an erased member's Rotary id, kept so the sync does not recreate them |
| **Gate** | A checklist that must be entirely true before a pilot or launch proceeds |
| **A1, A2, B** | The English pilot, the first translated pilot, and launch |
| **v1 / v2 page** | Two generations of the same module's screens; club dashboards link to v2, district dashboards mostly to v1 |
| **Kill switch** | The rule that an inactive zone, district or club makes everything beneath it inaccessible |
| **Rotary year** | 1 July to 30 June; projects are stored in one table per Rotary year |
| **CMR** | Club monthly report |
| **AG** | Assistant Governor |
| **BOD** | Board of directors of a club |
| **TRF** | The Rotary Foundation |
| **DLT** | India's registry of SMS senders and templates; RIZones' OTP text is registered there |

## Appendix L. Task index

Every task in Part B. Owner is who is scheduled to do it in section 18; the workstream owner reviews. Days are working days.

| Task | Title | Owner | Gate | Days | Depends on |
|---|---|---|---|---|---|
| `S-01` | Rotate every committed secret and remove secrets from the repository | BW1 | A1 | 2 | none |
| `S-02` | Staging database with scrambled personal data | F1 | A1 | 1.5 | none |
| `S-03` | Point every developer configuration at staging | F1 | A1 | 0.5 | S-02 |
| `S-04` | Offsite backups and one full restore | BW2 | A1 | 1 | none |
| `S-05` | Second MySQL instance for ROW | BW1 | A1 | 1 | S-04 |
| `S-06` | IIS sites and application pools for ROW | BW1 | A1 | 0.5 | S-05 |
| `S-07` | Worker service account, folders and schedules | BW1 | A1 | 0.5 | S-05 |
| `S-08` | File storage for ROW | BW1 | A1 | 0.5 | S-06 |
| `S-09` | Cloudflare in front of every ROW host name | BW1 | A1 | 0.5 | the ROW domain being registered |
| `S-10` | Monitoring and alerts for both products | BW2 | A1 | 1.5 | S-06, WS0-01 |
| `S-11` | Move RIZones nightly jobs to make room | BW1 | A1 | 0.5 | WS8-08 |
| `WS0-01` | Health and version endpoint | BW1 | A1 | 0.5 | none |
| `WS0-02` | Request statistics for an error baseline | BW1 | A1 | 1 | none |
| `WS0-03` | API smoke suite | BW1 | A1 | 2.5 | WS0-01, S-02 |
| `WS0-04` | Versioned deploy with automatic rollback | BW1 | A1 | 1.5 | WS0-03 |
| `WS0-05` | Browser journeys | F2 | A1 | 1 | WS0-03 |
| `WS0-06` | Pipeline | BW1 | A1 | 0.75 | WS0-03, WS0-05 |
| `WS0-07` | Release record | BW1 | A1 | 0.25 | WS0-04 |
| `WS1-01` | `BrandOptions`, binding and the static accessor | BW1 | A1 | 1 | WS0-03 |
| `WS1-02` | Overlay for legacy configuration keys | BW1 | A1 | 0.5 | WS1-01 |
| `WS1-03` | Public brand endpoint | BW1 | A1 | 0.5 | WS1-01 |
| `WS1-04` | CORS from configuration | BW1 | A1 | 0.5 | WS1-01 |
| `WS1-05` | One helper for frontend and API URLs | BW1 | A1 | 0.5 | WS1-02 |
| `WS1-06` | Club-site parent domain: one resolver | BW1 | A1 | 0.5 | WS1-05 |
| `WS1-07` | Instance constants into `Scope` | BW1 | A1 | 1 | WS1-01 |
| `WS1-08` | Frontend `BrandProvider` | F2 | A1 | 1 | WS1-03 |
| `WS1-09` | Replace brand literals that are not translatable text | F2 | A1 | 1.5 | WS1-08 |
| `WS1-10` | Member field flags | F2 | A1 | 1.5 | WS1-08 |
| `WS1-12` | Product name in server-generated text | BW2 | A1 | 1 | WS1-01 |
| `WS1-11` | Author the ROW brand configuration | BW1 | A1 | 0.5 | WS1-01 to WS1-10 and product-owner input |
| `WS2-01` | Scope script | F2 | A2 | 1.5 | none |
| `WS2-02` | Install and wire `next-intl` without locale routing | F2 | A2 | 1.5 | WS1-08 |
| `WS2-03` | Language picker and persistence | F2 | A2 | 1 | WS2-02 |
| `WS2-04` | Pseudo-locale and scoped lint | F2 | A2 | 1 | WS2-01, WS2-02 |
| `WS2-05` | Extraction codemod | F2 | A2 | 2 | WS2-04 |
| `WS2-06` | Extraction 1: common, authentication, shells | F2 | A2 | 3 | none |
| `WS2-07` | Extraction 2: club-admin dashboard | F2 and BW1 | A2 | 4 | none |
| `WS2-08` | Extraction 3: club modules | all four, by module | A2, B | 7 | none |
| `WS2-09` | Extraction 4: payment and public flows | BW2 | A2 | 2 | none |
| `WS2-10` | Extraction 5: district-admin dashboard and district modules | BW1 and F1 | B | 6 | none |
| `WS2-11` | Extraction 6: AG, club moderator, RI Director, zones, goal oversight | F1 | B | 3 | none |
| `WS2-12` | Extraction 7: public site and policy pages | F2 | B | 3 | none |
| `WS2-13` | `ApiErrors`, `ApiException` and the middleware mapping | BW1 | A2 | 2 | WS0-03 |
| `WS2-14` | Replace the most reused messages | BW1 | A2, B | 3 | WS2-13 |
| `WS2-15` | Client error helper and request language | F2 (client), BW1 (server) | A2 | 2 | WS2-13, WS2-02 |
| `WS2-16` | Codes for the remaining reachable endpoints | BW1, BW2 | B | 3 | WS2-01, WS2-14 |
| `WS2-17` | Header, footer and support constants from the brand | BW2 | A1 | 1 | WS1-01 |
| `WS2-18` | Template engine | BW2 | A2 | 2 | WS2-17 |
| `WS2-19` | Templates wave 1: sign-in and account | BW2 | A2 | 2 | WS2-18 |
| `WS2-20` | Templates wave 2: money | BW2 | A2, B | 4 | WS2-19, WS3-05 |
| `WS2-21` | Templates wave 3: everything else | BW2, BW1 | B | 6 | WS2-19 |
| `WS2-22` | Ship fonts, register them, stop hiding missing glyphs | F2 | B, A2 | 2.5 | none |
| `WS2-23` | Document labels from resources | F2 | B | 3.5 | WS2-22, WS2-15 |
| `WS2-24` | Browser exports | F2 | B | 1.5 | WS2-23 |
| `WS2-25` | `master_translation` and `IMasterLabels` | BW1 | B | 4 | WS5-01 |
| `WS2-26` | Build checks for message files | F2 | A2, B | 2 | WS2-04 |
| `WS2-27` | Club-website menu slug | BW2 | B | 3.5 | none |
| `WS2-28` | Club-website application | F2 | B | 2.5 | WS2-02, WS2-27 |
| `WS2-29` | Translation exchange | F2 | A2, B | 1.5 | WS2-26 |
| `WS2-30` | Language crawl | F2 | B | 1.5 | WS0-05, WS2-26 |
| `WS3-01` | `format.ts`, with the old helpers delegating to it | F2 | A1 | 3 | WS1-08 for the brand's number locale` wrapper that WS2-02 later points at `next-intl`) |
| `WS3-02` | District context: today, zone, currency, Rotary year | F1 | A1 | 2 | WS4-01 |
| `WS3-03` | Codemod and lint, applied with extraction | F2 | A1, A2, B | 5 | WS3-01 |
| `WS3-04` | "Today" and Rotary-year call sites | F2 | A1 | 2 | WS3-02 |
| `WS3-05` | Server-side money | F1 | A1 | 3 | WS1-01 |
| `WS4-01` | District time zone and resolver | F1 | A1 | 1.5 | WS1-01 |
| `WS4-02` | Clock for new code | F1 | A1 | 0.5 | none |
| `WS4-03` | `ILocalSchedule` | F1 | A1 | 2 | WS4-01, WS4-02 |
| `WS4-04` | Move the API's timed services onto it | F1 | A1 | 1.5 | WS4-03 |
| `WS4-05` | Greetings worker per district | F1 | A2 | 1.5 | WS4-03 |
| `WS4-06` | Output boundary: timestamps carry an offset | F1 | A1 | 4 | WS4-02 |
| `WS4-07` | Input boundary | F2 | A1 | 3 | WS4-06, WS3-02 |
| `WS4-08` | "Today" in person-facing SQL | F1 | A1, B | 3.5 | WS4-01 |
| `WS5-01` | Stable codes for the taxonomy | BW1 | A1 | 1 | none |
| `WS5-02` | Export production masters to seed files | BW1 | A1 | 2 | WS5-01 |
| `WS5-03` | `MasterDataSeeder` | BW1 | A1 | 2.5 | WS5-02 |
| `WS5-04` | Deploy hook with a RIZones guard | BW1 | A1 | 0.5 | WS5-03, WS0-04 |
| `WS5-05` | Prove an empty database matches production | BW1 | A1 | 1 | WS5-03 |
| `WS5-06` | Master screens read-only on ROW; constants for roles | BW1 | B | 0.5 | WS1-08 |
| `WS6M-01` | Start the outside lead times (day one) | BW2 | A1 | 1 | the ROW legal entity and domain |
| `WS6M-02` | Phone numbers in E.164 | BW2 | A2 | 2 | WS1-01 |
| `WS6M-03` | `IWhatsAppSender` with the Interakt adapter | BW2 | A2 | 2.5 | WS6M-02 |
| `WS6M-04` | Template registry | BW2 | A2 | 2.5 | WS6M-03, WS5-03 |
| `WS6M-05` | WhatsApp Cloud API adapter and status webhook | BW2 | A2 | 3 | WS6M-04, WS6M-01 |
| `WS6M-06` | SMS interface, Twilio adapter, and the logging defect | BW2 | A2 | 1.5 | WS6M-02 |
| `WS6M-07` | OTP policy | BW2 | A1, A2 | 1 | WS1-01 |
| `WS6M-08` | Greetings worker uses the shared sender | BW2 | A2 | 1 | WS6M-03, WS4-05 |
| `WS6M-09` | Pilot gate and consent hook | BW2 | B | 0.5 | WS1-07, WS7-05 |
| `WS6-01` | Verify Cashfree webhook signatures | BW2 | A1 | 1 | none for the log-only release; WS0-03 before enforcing |
| `WS6-02` | Event-payment webhook matches the wrong identifier | BW2 | A1 | 1 | WS6-01 |
| `WS6-03` | Interface, models and resolver | BW2 | A1 | 2 | WS3-05 |
| `WS6-04` | Cashfree behind the interface (no behaviour change) | BW2 | A1 | 3.5 | WS6-03, WS6-01, WS6-02 |
| `WS6-05` | Razorpay behind the interface (no behaviour change) | BW2 | B | 2 | WS6-03 |
| `WS6-06` | One webhook entry per gateway | BW2 | A1 | 3 | WS6-04 |
| `WS6-07` | Connected accounts | BW2 | A1 | 3 | WS6-03 |
| `WS6-08` | Tax rules and currency at order creation | BW2 | B | 2 | WS6-03, WS3-05 |
| `WS6-09` | Stripe adapter | BW2 | A1 | 4 | WS6-06, WS6-07 |
| `WS6-10` | PayPal adapter | BW2 | B | 3.5 | WS6-09 |
| `WS6-11` | Platform fee ledger | BW2 | B | 2 | WS6-06 |
| `WS6-12` | Gateway coverage by country | BW2 | A1 | 0.5 | WS6-07 |
| `WS7-01` | Personal-data registry | BW1 | B | 3 | none |
| `WS7-02` | Export a member's data | BW1 | B | 3.5 | WS7-01 |
| `WS7-03` | Erase a member | BW1 | B | 4 | WS7-01 |
| `WS7-04` | Make erasure survive the sync | BW1 | B | 2 | WS7-03, WS8-01 |
| `WS7-05` | Consent | BW1 | B | 3 | WS1-08 |
| `WS7-06` | Legal pages, cookie notice, contact | F2 | A1 | 1 | WS1-09, WS2-12 |
| `WS7-07` | Retention | BW1 | B | 1 | WS4-03 |
| `WS8-01` | Scope and configuration for workers | F1 | A1 | 2 | WS1-01 |
| `WS8-02` | Per-club measurement | F1 | A1 | 1 | none |
| `WS8-03` | Fetch a profile only when something changed | F1 | B | 4 | WS8-02 |
| `WS8-04` | Prove it equals the full sweep, then switch | F1 | B | 1 | WS8-03 |
| `WS8-05` | Rolling full verification | F1 | B | 1.5 | WS8-04 |
| `WS8-06` | Bounded parallelism in the sweep | F1 | B | 1.5 | WS8-03 |
| `WS8-07` | Board sync: current years nightly, history once | F1 | B | 3 | WS8-02 |
| `WS8-08` | One schedule file for both instances | F1 | A1 | 2 | WS0-04 |
| `WS8-09` | Remove superseded and stale tasks | F1 | A1 | 0.5 | WS8-08 |
| `WS8-10` | First load for a ROW district | F1 | A1 | 1 | WS8-01, WS5-05 |
| `WS9-01` | Metadata, favicon, manifest, social images | F2 | A1 | 1 | WS1-08 |
| `WS9-02` | No new colour literals | F2 | B | 0.5 | WS2-04 |
| `WS9-03` | Brand asset pack | F2 | A1 | 1 | the product owners |
| `WS10-00` | Measure the app | F2, F1 | A1 | 1 | none |
| `WS10-01` | Two flavours from one codebase | F2, F1 | A1 | see 16 | none |
| `WS10-02` | Brand and feature flags from the API | F2, F1 | A1 | see 16 | none |
| `WS10-03` | Translation | F2, F1 | A1, A2, B | see 16 | none |
| `WS10-04` | Locale and time | F2, F1 | A1 | see 16 | none |
| `WS10-05` | Phone numbers and sign-in | F2, F1 | A1 | see 16 | none |
| `WS10-06` | Payments | F2, F1 | A1 | see 16 | none |
| `WS10-07` | Push notifications | F2, F1 | A1 | see 16 | none |
| `WS10-08` | Privacy in the app | F2, F1 | B | see 16 | none |
| `WS10-09` | Store listings | F2, F1 | A1, B | see 16 | none |
| `WS11-01` | Pilot test plan | Lead, all | A1 | 2 | none |
| `WS11-02` | Full regression on both instances | Lead, all | A1, B | 3 | none |
| `WS11-03` | Load and capacity check | Lead, all | B | 1.5 | none |
| `WS11-04` | Runbooks | Lead, all | A1 | 1.5 | none |
| `WS11-05` | Pilot support | Lead, all | A1 | 2 | none |

Totals by workstream (days): S 10, WS0 7.5, WS1 10, WS2 82.5, WS3 15, WS4 17.5, WS5 7.5, WS6M 15, WS6 27.5, WS7 17.5, WS8 17.5, WS9 2.5, WS11 10. **Total 240 days = 48 engineer-weeks**, excluding the mobile app (WS10).
