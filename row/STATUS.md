# ROW Build — Status and Handover

Last updated: 2026-10-13 (session 4) · Branch: `main` · Last commit: `2ca5608` (ROW .NET edition, knowledge base); session-3 web, privacy and .NET work is uncommitted

This is the single place to pick the work back up. It covers what ROW is, how the
repo is laid out, how to run and test the backend, what is finished, what is left
(with endpoint counts), the decisions still open, and the working rules.

Related documents:

| File | What it holds |
|---|---|
| `document/ROW-Master-Development-Plan.md` | The overall plan (work streams WS1–WS6) |
| `document/2026-09-30-row-build-*.md` | Design decisions for the build |
| `row/api/PORTING.md` | How a RIZones C# controller is converted to NestJS (conventions, helpers) |
| `row/api/ROW-CHANGES.md` | Where ROW differs from RIZones, and RIZones quirks kept on purpose that ROW should revisit |

---

## 1. What ROW is

- ROW (Roster On Wheels) is the Rotary admin platform for **countries outside India and its
  neighbours** (North America, Europe, and so on).
- It reuses the **architecture, structure and features** of RIZones (the India product) but
  **nothing that belongs to RIZones**: no data, names, domains, phone numbers, emails, logos,
  credentials or India-only integrations (Cashfree, Razorpay, Interakt, DLT SMS, GST, ₹/IST).
- The two products have no runtime connection.
- Backend rule agreed with the team: **port RIZones behaviour as-is, quirks included**, then
  change it as ROW work starts. Anything that looks wrong goes in `row/api/ROW-CHANGES.md`
  instead of being "fixed" silently.
- Brand-specific values (product name, domains, support contacts, currency, providers) come from
  configuration (`src/brand/brand.ts`, `Brand.Current`), never literals.
- Deployment target (company decision): **IIS on Windows Server**. Both Next.js apps and the
  NestJS API run as Node 22 processes behind IIS using **HttpPlatformHandler** (or URL Rewrite + ARR).
  Do **not** use iisnode.

## 2. Repository layout

| Path | What | State |
|---|---|---|
| `row/api` | NestJS backend, port of the RIZones .NET API, MySQL, same schema | **~86% of .NET routes**; Payments pending (decision 4); privacy module done |
| `row/admin` | Next.js + Tailwind + TypeScript admin portal (from the RIZones admin UI) | RIZones content and India formats removed (tasks A, B); task C waits for Payments |
| `row/club-website` | Next.js public club website | Converted (no RIZones literals, locale and currency from settings) |
| `row/mobile` | Flutter app (converted from the RIZones app) | Converted to the ROW API; WS10 items pending |
| `row-dotnet/` | **Second ROW edition on the original stack** (ASP.NET Core API, the same Next.js admin and club website, .NET workers). See `row-dotnet/README.md` | Rebranded; brand, privacy and member-data flags as in NestJS; India-specific providers / time still RIZones |
| `kb/` | Knowledge base: generated RIZones-vs-ROW diffs, document index, testing record, tools | Rebuild with `bash kb/rebuild.sh` |
| `document/` | Plans and design documents | — |
| `reference/` | RIZones sources for reading only — **gitignored, never commit** | — |

The RIZones C# API being ported lives at `reference/RotaryIndia_Admin_API_Claude/RotaryApi`
(`Controllers/`, `Services/`, `DTOs/`).

## 3. Running the backend locally

Requirements: Node 22+, Docker (for MySQL 8).

```bash
cd row/api
npm install
# MySQL in Docker (any local MySQL 8 works)
docker run -d --name row-schema-mysql -e MYSQL_ROOT_PASSWORD=<local-password> -p 3317:3306 mysql:8
# create the database, then:
npm run db:schema          # database/schema.sql + schema-drift.sql
npm run db:seed            # master data (database/seed-master.sql)
npm run build
npm run bootstrap:superadmin   # first SuperAdmin login
```

Start (environment variables, `__` stands for `:`):

```bash
APP_ENVIRONMENT=Development PORT=5056 \
ConnectionStrings__DefaultConnection="Server=127.0.0.1;Port=3317;Database=<db>;User=root;Password=<local-password>" \
JwtSettings__Secret=<at-least-32-characters> \
BackendUrl=http://localhost:5056 \
node dist/main.js
```

Checks to run before every commit:

```bash
npx tsc --noEmit -p tsconfig.json   # type check
npm run -s lint:rizones             # must report 0 findings (no RIZones names/domains/literals)
```

**Secrets go only in environment variables, never in files.** These are the main keys:

| Key | Used for |
|---|---|
| `ConnectionStrings__DefaultConnection` | MySQL |
| `JwtSettings__Secret` | sign-in tokens (also the fallback pay-link key) |
| `Brevo__ApiKey`, `Brevo__SenderEmail`, `Brevo__MassEmailSenderEmail` | email |
| `Brand__Providers__MetaWhatsApp__*` | WhatsApp |
| Twilio settings | SMS |
| `PleskSettings__*` | club website hosting: BaseUrl, Username/Password or ApiKey, ParentDomain, SharedDocroot, WildcardCertName, ServerIp, AcceptSelfSignedCert |
| `Media__RedirectBaseUrl`, `FrontendUrl`, `Api__BaseUrl`, `ClubSite__UseHttps` | URLs |
| `Payments__PayLinkKey` | club-website pay links |
| `Cmr__SubmissionEmailOverride` | send all monthly-report emails to one test address |
| `DailyStatsReport__Enabled`, `__Hour`, `__Recipients__0..` | daily statistics email |
| `DistrictPerformanceReport__Enabled`, `__Mode` (Test/Live), `__TestRecipients__0..`, `__TestDistricts__0..`, `__LiveCc__0..`, `__PreviewDate`, `__ExcludedClubNames__0..` | District Performance / RI Director report emails (hour and live days: `Brand__Scope__DistrictReportSendHour`, `__DistrictReportDaysOfMonth__0..`) |
| `Zoom__AccountId`, `__ClientId`, `__ClientSecret` (`__HostUserId`, `__Timezone`) | website-training Zoom meetings (none = bookings without a link) |
| `Training__SlotMinutes` (30), `__MaxPerDay` (3), `__MinNoticeDays` (1), `__HorizonDays` (30), `__TeamEmails__0..`, `__BookerCc` | website-training booking rules and notification lists |
| `MobileApp__DefaultUpdateUrl` | URL stored on a new app version when none is given |
| `GoalSetting__SplitPilot__Enabled`, `__ClubIds__0..`, `__DistrictIds__0..` | target-split pilot (default: everyone) |
| `RotaryOrgApi__BaseUrl`, `__Username`, `__Password` | Rotary.org Data Integration API |
| `BackgroundJobs__Enabled` | **set to `true` on servers**: the background loops (scheduled emails, push, reminders, rollover, credit expiry...). `config/appsettings.json` keeps it `false` for local runs |
| `Firebase__ServiceAccountAbsolutePath` (or `__ServiceAccountPath`) | push notifications (Firebase service-account JSON; none = push off) |
| `ZonalAwards__AutoCalcEnabled` | 24 h zonal awards recalculation (off by default) |
| `CitationAutoPoints__DailyLoopEnabled` | 24 h citation loop (off by default) |
| `ProjectCount__ZoneNames__0..`, `ProjectCount__ExemptDistrictNumbers__0..` | project-count geography rule |

**Security notes:**
- Never connect to the RIZones production database.
- The credentials committed inside `reference/` must not be used and should be rotated by the
  RIZones owners.
- The RIZones Firebase config was excluded on purpose (gitignored).

## 4. Backend conventions (short version — details in `row/api/PORTING.md`)

**Database access** (`src/database/db.service.ts`):
- `Db` / `DbSession` provide `query`, `queryFirstOrDefault`, `executeScalar`, `execute`,
  `queryMultiple`, `session`, `transaction`.
- SQL uses `@Param` placeholders; `IN @Ids` expands arrays.
- Rows come back shaped like .NET output: DATETIME becomes `"…Z"` (UTC), DATE becomes
  `"YYYY-MM-DDT00:00:00"`, TINYINT(1) becomes a boolean.

**Helpers:**
- `defineDto` (`src/common/dto.ts`) produces camelCase JSON like ASP.NET.
- Results (`src/common/results.ts`): `ok`, `notFound`, `badRequest`, `forbid`, `statusCode`,
  `conflict`, `file`, `content`, `ValidationProblemResult`.
- Request binding (`src/common/binding.ts`): `paramInt` (gives the .NET 400 validation problem on
  bad ids), `queryInt`, `queryBool`, `queryString`, `bodyField`, `bodyIntList`, `dbDateTime`, `dbDate`.

**Auth:**
- Decorators: `@Authorize()`, `@AllowAnonymous()`, `@User()`.
- Claims: `user.findFirst("roles" | "memberId")`.

**Routing gotchas:**
- .NET absolute routes (those starting with `/`) must go in an unprefixed `@Controller()`.
- Literal routes must be declared before `:param` routes.

**Registration:**
- Each area gets a module in `src/modules/<area>/`, registered in `src/modules/index.ts`.
- Cross-area services live in `src/services/` and are registered in `SharedModule`.

**Libraries** (all pinned exact):

| Library | Use |
|---|---|
| `mysql2` | database |
| `sharp` | images |
| `exceljs` | Excel, replacing ClosedXML |
| `docx` | Word, replacing OpenXML |
| `pdfmake` | PDF, replacing QuestPDF |
| `bcryptjs` | passwords |

## 5. Progress — backend

**123 of 146 controllers ported, about 1,310 of 1,529 endpoints (≈86%).** What is left is Payments (decision pending) and two RIZones partner feeds that are not to be ported. Everything ported compiles and
passes the RIZones lint. Session-1 work was exercised against a local database; session-2 work (Reports, Goal Setting)
(and the admin tools / OCV, public-site and Rotary.org groups) were checked by type check, unit specs and an app boot (DI + route mapping) only — **no local DB was
available, so the report SQL still needs a run against MySQL.**

### 5.1 Ported (controller — endpoints)

| Area | Controllers |
|---|---|
| Foundation | Auth 6, MobileAuth 4, Countries 1, RotaryYears 3, Zones 6, Districts 9, Clubs 18, SystemSettings 3, DashboardResolver 2 |
| Members / roles | Members 8, Admin 13, BoardOfDirectors 14, PastPresidents 6, Modules 24, PotentialMembers 5, Attendance 7 |
| Content | Announcements 6, UpcomingEvents 6, Newsletters 7, Documents 6, Weblinks 6, Greetings 2, SubGroups 7, Categories 6, SubCategories 6, AreaOfFocus 7, Funding 5 |
| Club website data | ClubBanner 10, ClubAdvertisement 10, ClubAbout 6, ClubContactDetail 6, ClubSocialLink 6, ClubTheme 2, Themes 5, WebsiteDataModules 5, ClubMenu 16 |
| Dashboards | ClubAdminDashboard 16, DistrictAdminDashboard 21, ZonalDashboard 13, AgDashboard 10, AgReports 22 |
| District | DistrictModules **228** (content, projects, website data, people, committee, citation) |
| Programmes | Projects 14, ProjectApproval 10, BeneficiaryApproval 5, PphCamps 14, ZonalAwards (14), CreditManagement 8, ClubMassEmails 8 |
| Reporting | ClubMonthlyReport 12 (Word + PDF + email to district), TrfContributions 11, DistrictCmrEmailSettings 2 |
| Admin tools | ClubLeadership 10 (+ scheduled email worker), ClubWebsites 24 of 34 (Plesk provisioning, trials, reminders) |
| Reports (session 2) | Reports 48, ClubReport 9, MobileClubAdminReport 8, DistrictReport 9, MobileDistrictAdminReport 9, DailyStatsReport 2 (+ 06:00 scheduled email), DistrictPerformanceReport 8 (+ DG / RI Director scheduled email) |
| RI Director (session 2) | RiDirector 53, RiAdminCleanup 2, InternationalPresident 5, DistrictGovernor 9, TrainingAppointment 9 (Zoom) |
| Mobile (session 2) | MobileDistrictAdminDashboard 17, MobileClubAdminDashboard 15, MobileAgDashboard 10 (web routes shared via base classes), MobileClubAdminPastPresidents 7, MobileVersion 7, MobileDistrictAwards 5, MobileCalendar 4, MobileWeblinks 3, MobileMemberSettings 3, MobileFcm 2, MobileNotifications 1 (bell feed), MobileLoginCheck 1, MobileDistrictCmrEmailSettings 2 (already served) |
| Admin tools (session 2) | LoginAnnouncement 12 (web + mobile), MemberDuplicate 11, DirectoryDataCollection 11, EmailLog 10, WhatsAppLog 10 of 11, OcvGov 14, PublicOcvLiveDocuments 2, LiveDocumentsExport 1, SuperAdmin 5, DistrictAwardsConfig 5, PushLogs 4, GlobalMemberSearch 4, GlobalSearch 2, FindRotarian 2, WebSso 2, WhatsAppInfo 2, ProjectClassification 2, ClubMemberHonorary 2, DistrictDirectory 1, ClubAnalytics 1, CitationMatrix 1, MassEmailMedia 1 |
| Public site (session 2) | ClubWebsitePublicData 16, ClubWebsitePublicDataV2 8, ClubGalleryPublic 2, ClubWebsitePublic 1 of 2 (`by-host`), PublicProjectShare 2 (1200×630 card via sharp), PublicProject 1, PublicProjectStats 10, PublicWebsiteDirectory 2, ClubWebsiteTheme 2, DistrictWebsitePublicData 3, DistrictWebsites 14, ClubFinder 10, PublicDirectory 9 |
| Rotary.org (session 2) | RotaryOrgManualSync 27, RotaryOrgSync 3 (ping / bootstrap / status), RotaryOrgProjectSync 3, RotaryOrgProjectSyncLog 3, ClubRotaryOrgCredentials 2; plus the club-admin live terminated list and the district Rotary Network live fetch / cache refresh job (were stubs) |
| Goal setting (session 2) | GoalSetting 83, MobileGoalSetting 57, ClubFoundationGoals 3 (service split over `src/modules/goal-setting/goal-*.ts`) |

Shared services already ported (in `src/services/`):

| Group | Services |
|---|---|
| Email and messaging | email (Brevo, templates), email verifier, messaging (Meta WhatsApp / Twilio SMS) |
| Club and board automation | DC auto groups, BOD sub-group sync, club admin access, kill switch |
| Citation and counts | citation auto-points + recalculation trigger, project count rules |
| Credits and currency | credits, currency rates |
| Club websites | Plesk client, club website activation, menu seeder, website reachability / DNS check, pay-link token, IIS app-pool recycler, cache purger |
| Files and documents | media storage, image tools, Excel helpers |
| Lookups and validation | year-table resolver, project date validator, phone normaliser |
| Reports support (session 2) | directory data-collection fields, club scope (Rotaract) helper, Rotary.org API client (auth + club officers only) |

### 5.2 Pending (controller — endpoints), in suggested order

**1. Reports** — done except:
- ClubProfileReport 2 — not ported (RIZones partner integration, PORTING.md §4).

**2. Payments.** These are rebuilt, not ported. RIZones uses Cashfree/Razorpay (India-only); ROW uses Stripe/PayPal.
- ClubDues 39
- MembershipDues 28
- EventPaymentLinks 32
- EventMasters 8
- PublicEventPayment 9
- MobileClubAdminMembershipDues 13
- PublicMembershipDues 12
- PublicClubDues 7
- MobileClubDues 5
- MobileMembershipDues 4
- PublicDuesApproval 2
- PublicClubDuesApproval 2
- WebsiteBilling 7
- Wallet 4
- WalletLinks 8
- PublicWallet 7
- PublicClubWebsite 4 and ClubWebsitePublic `renew-link` (pay-link purchase / renewal, see item 7)
- The 10 deferred ClubWebsites pricing endpoints (`pricing/*`, `default-pricing*`, `pricing/route-account`, `pricing/send-reminders`)
- Not to port as-is (India-only; replace with Stripe equivalents or drop): CashfreeKyc 9, RazorpayRouteAccounts 7

**3. Goal setting** — done (session 2).

**4. RI Director** — done (session 2).

**5. Rotary.org sync** — done (session 2). Needs ROW's own Rotary.org access (`RotaryOrgApi:BaseUrl / Username / Password`); without it the endpoints answer with the Rotary.org error and the daily cache refresh stays off. Not ported:
- RotaryThirdParty 1 — an anonymous partner feed exposing members' phones and emails for three RIZones districts (partner integration, like ClubProfileReport).
- The member-sweep worker itself (`RotaryOrgSyncWorker.exe`, a separate RIZones program). The sweep / reconcile buttons still launch whatever `RotaryOrgSync:WorkerExePath` points at.

**6. Mobile** — done (session 2). Push sending itself (FCM / Firebase) is not part of these endpoints; the app only registers tokens here.

**7. Public site / websites** — done (session 2), except two Payments-bound endpoints (see item 2):
- PublicClubWebsite 4 (the pay-link website purchase: quote / subdomain check / Razorpay order / verify).
- ClubWebsitePublic `renew-link` 1 (mints the website-renewal and wallet top-up pay links).

**8. Admin and other** — done (session 2), except:
- WhatsAppLog `backfill` — not ported (imported the RIZones Interakt log from a server file; ROW logs its own sends).
- India-only, do not port: InteraktWebhook 1, ShrigodaPartner 1.

To find the C# source of any of these: `reference/RotaryIndia_Admin_API_Claude/RotaryApi/Controllers/<Name>Controller.cs`.

### 5.3 Background services

| Status | Services |
|---|---|
| Ported | Citation auto-points (24 h, behind a flag), club leadership scheduled emails (30 s), CMR submission mailer, daily stats report (behind `DailyStatsReport:Enabled`), district performance + RI Director report (behind `DistrictPerformanceReport:Enabled`) |
| Ported (session 2) | Rotary.org /clubs cache refresh (daily 08:00 brand time; only with Rotary.org credentials), district terminated-cache refresh job (on demand) |
| Ported (session 3) | Rotary-year rollover (6 h, first pass at start-up), credit expiry (24 h), zonal awards auto-calculation (24 h, behind `ZonalAwards:AutoCalcEnabled`), club website reminders + auto-expiry (6 h, renewal link off until Payments), push notifications (announcements, events, documents, newsletters, projects, reminders; FCM HTTP v1, needs a Firebase service account) + push-log clean-up, scheduled emails (10 s). All behind `BackgroundJobs:Enabled` (default true), as in RIZones. |
| Pending | WhatsApp removal (ROW has no WhatsApp, on hold), the Rotary.org member-sweep worker (separate program) |
| Not ported (Payments) | Website provisioning (paid orders), Razorpay settlement sync, membership dues reconciliation |

Check `Program.cs` and `Services/*BackgroundService.cs` in the reference for the full list.

## 5a. Backend testing against the .NET API (2026-10-10)

Both APIs ran side by side (local MySQL, synthetic fixture data, the .NET start-up migrations applied, then the same snapshot restored into both databases before every sweep). Every route was called on both and the answers compared; the differences found were fixed in ROW (listed in ROW-CHANGES, "Testing against the .NET API").

| Sweep | Result |
|---|---|
| Schema (tables, columns, procedures) after the .NET migrations | identical |
| Sign-in | identical tokens |
| GET, 757 routes | 716 identical; the other 41 are expected: brand / time zone / currency, ROW-only endpoints, environment (ports, collation), and report files whose content was compared cell by cell and only the currency symbol differs |
| POST/PUT/PATCH/DELETE, 481 routes, three ways (JSON `{}`, no body, empty JSON body) | 464 / 478 / 478 identical; the rest are the database name inside MySQL error text, ids shifted by earlier calls in the same sweep (identical on a fresh database), and the daily-stats / District Performance test sends (ROW has no built-in recipients) |
| Upload endpoints (multipart and JSON) | identical apart from Payments (not ported) and brand text |
| Background jobs (scheduled emails + reminders, credit deduction and expiry warning, website auto-expire and reminders, year rollover), 3 minutes on seeded data | identical rows written in both databases |
| Unit tests | 101 pass |

Not covered: real sends (Brevo, Meta WhatsApp, FCM, Rotary.org, Plesk need ROW credentials), Payments, and load. The scratch harness is not in the repo.

## 6. Progress — web and mobile

**Admin portal (`row/admin`).** Tasks A and B are done (session 3, 2026-10-12); C waits for Payments:
- **A (done).** RIZones public-site data emptied (leaders, governors, committee, events, club-website list, project statistics), people's photos / PDFs / video removed, logo lockups replaced by ROW lockups, a neutral brand-driven footer, pay-page help lines from the brand, the vendor's Cashfree settlement ids from `NEXT_PUBLIC_*_VENDOR_ID`, a factual `/cookies` page (public, linked from the footer). Identity lint (`row-dotnet/tools/check-rizones.mjs`): 0.
- **B (done).** `kb/tools/locale_codemod.py`: 325 `en-IN` locale arguments → `appLocale()`, 240 ₹ → `currencySymbol()`, "today" → `todayLocal()`; INR defaults → `defaultCurrency()`; IST labels → the brand time zone. Left on purpose: ₹ / INR inside Cashfree / Razorpay checkout code, wallet and website-purchase pricing (Payments, flags off on ROW), the public landing page (site off) and the policy texts (counsel).
- **C.** Wire the pay pages to `checkout.ts` (Stripe/PayPal); hide the Cashfree/Razorpay screens.
- Also: `rizonesCount` → `localCount`; the goal-split pilot reads `NEXT_PUBLIC_GOAL_SPLIT_PILOT_*` (none = everyone, as the API); the six type errors inherited from RIZones fixed. `tsc` 0 errors, 27 tests, production build 201 pages.
- **The privacy policy, terms and refund pages are RIZones' Indian legal texts with the names changed** (DPDPA, IT Act). ROW needs counsel's texts (master plan Q6).

**Club website (`row/club-website`).** Converted (session 3): admin-login link and support fallback from settings (`NEXT_PUBLIC_ADMIN_LOGIN_URL` / `NEXT_PUBLIC_PORTAL_ORIGIN`, `NEXT_PUBLIC_SUPPORT_*`), image hosts from settings, dates in `NEXT_PUBLIC_NUMBER_LOCALE`, project costs in each project's own currency. `tsc` 0, build 11 pages.

**Mobile (`row/mobile`).** Converted to the ROW API (2026-10-10); see `row/mobile/README.md`.
- API base URL from `--dart-define=API_BASE_URL` (was RIZones' server). Every endpoint the app calls that exists in the .NET API exists in ROW (checked by script); the Payments screens (membership / club dues, event payment links, wallet, website purchase) call endpoints that are not ported and show an error until Payments is (open decision 4).
- Brand from `GET api/public/brand` at start-up, cached on the device (master plan WS10-02): product name on the splash, login, OTP, welcome, home, app lock, reports and exports; support phones / email / hours on the helpline and support dialogs; terms link; club-site domain. No RIZones name, domain, phone or email is left in the app.
- Home screen: the four RIZones site pages (websites, leaders, district governors, regional leaders) open the same paths on the brand's web origin and are hidden when the brand has none; the India-only "Rotary News Trust" link, the RIZones partner card (BeyondSure) and RIZones' social-media icons are removed.
- Native: launcher label and iOS permission texts say "ROW"; the RIZones network-security exception is removed; the launcher icon is a placeholder (the Rotary wheel) until the ROW icon exists.
- A build without Firebase config files starts with push off (it used to crash at start).
- Checks: `flutter analyze` (no errors; warnings unchanged from the import), `flutter test` (70 pass). No device build here (no Android SDK / full Xcode on this machine).
- **Pending (master plan WS10):** currency and number formats (₹ / lakh / crore defaults, `en_IN` grouping) and dates "today" (WS10-04); phone input still assumes India (+91, 10 digits) (WS10-05); payment flows (WS10-06); a ROW Firebase project (WS10-07, decision 6); privacy screens (WS10-08); translation (WS10-03); the final ROW icon and store listings (WS10-09).

## 6a. Upstream drift — synced 2026-10-10 against reference `cb3e678` (2026-10-09 18:56 IST)

The session-1 modules were ported from a RIZones copy of about 2026-10-06 (the 10-05 / 10-06 fixes are in, the 10-07 ones were not). Newer upstream commits cannot be fetched from this machine (the private repo is not visible to the GitHub account here), so `cb3e678` is the newest source.

How the sync was checked: every .NET route against ROW's routes; every user message and SQL column in the .NET code against ROW; every upstream comment dated 2026-10-07 or later; and the side-by-side sweeps re-run with new test data (a Rotaract club, ongoing projects whose parent is in an earlier year).

Brought up to date:
- Rotaract clubs hidden from district / club screens, lists and counts (`ClubScopeSql`): clubs list, district clubs and totals, zone totals, district admin dashboard (10 queries), district modules (CMR months and month detail, reminders, AG / moderator pickers, all-clubs, citation club points and report).
- Project list: an ongoing entry whose parent is in an earlier year table is now listed (`eff_parent`), on the project list and the club dashboard's avenue screen.
- Club citation manual save: negative points are refused.
- Every uploaded photo is re-saved at most 2560 px, JPEG 88 (`PhotoUploadOptimizeFilter`); ROW used to shrink only photos over 5 MB.
- New upstream endpoints: `api/app/route-maintenance` (3, the mobile app's per-screen maintenance switch; it had been filed under Payments by mistake) and `api/mobile/club-foundation-goals` (3).

Result: 720 of 760 GET routes and 467 / 481 / 481 of 484 write routes identical, with the same expected differences as section 5a.

To repeat when a newer reference is available: re-clone, then diff the new commits' changed files against `row/api/src` (record the commit here).

### 6a-2. Admin portal and .NET edition synced to `cb3e678` (2026-10-12)

The reference repo was pulled again (no commits after `cb3e678`). The NestJS API already had these two
upstream commits (goal-setting district messages, membership / youth import, month-wise target grid,
Rotaract out of district counts, mobile goal-setting parity); the admin portal did not. Three-way merged:
- **Admin portal** (`row/admin`, copied to `row-dotnet/admin`): 22 changed files and 4 new components
  (`goal-messages/*`, `ClubFoundationAchievedCard`). One conflict (`MemberCard.tsx`, kept ROW's blood-group
  flag). Their 4 new API calls all exist in the NestJS API. Identity lint 0, locale codemod found nothing new,
  tsc 0, vitest 27, build 201 pages.
- **.NET API and sync worker**: 29 changed files and `ClubScopeSql.cs`. One conflict
  (`DistrictPerformanceReportService.cs`: ROW's configurable exclusions kept, upstream's Rotaract exclusion
  added).
- **Schema** (both editions): upstream's `idx_dcgm_member` index (global member search) in `schema.sql` and
  `schema-drift.sql`. Upstream's three data-fix scripts are RIZones data and were not applied.
- **Result**: the 379 parameterless GET routes give the same status on both APIs, route by route
  (238 × 2xx, 140 × 4xx, 1 × 5xx — the Rotary.org ping without credentials).

## 6b. Session 3 (2026-10-12): privacy, schema gaps, .NET edition

- **Privacy (master plan WS7), `src/modules/privacy/`:** consent at first sign-in after a policy change (`GET/POST api/privacy/consent`, withdraw), member data export as a ZIP behind a signed 7-day link, erasure (SuperAdmin directly; a District Admin's request needs a second District Admin) driven by the personal-data registry (`personal-data-registry.ts`, Appendix G, checked against the live schema), tombstone so the Rotary.org sweep never re-adds an erased member, registry audit (`GET api/privacy/registry/unlisted`, 0 unlisted on the ROW schema), daily retention job, and `PUT api/members/me/language`. Broadcast email and push skip members without consent (`services/privacy-consent.ts`). Behind `privacy.enabled`; consent only once `Brand:Legal:PolicyVersion` is set. `kb/tools/privacy_e2e.py`: 26 checks pass on both editions.
- **Schema gaps found on an empty database:** the current Rotary year's project tables are created by the rollover job at start-up; `sync_exception_log.inserted` is in `schema-drift.sql`.
- **The Rotary.org member-sweep worker** is shared: the NestJS API launches `RotaryOrgSync:WorkerExePath`, which can point at the rebranded worker in `row-dotnet/workers/RotaryOrgSyncWorker` (it writes to the same schema and now honours the erasure tombstone). No TypeScript port.
- **Fresh-database test** (MySQL 8.0.46, schema + drift + seed): 379 parameterless GET routes give 237 × 2xx, 141 × 4xx, 1 × 5xx (Rotary.org ping without credentials) on NestJS; the .NET edition answers the same apart from the routes newer upstream added.
- Unit tests: 121 (114 pass, 7 skipped).

## 6c. Session 4 (2026-10-13): no India-specific behaviour, no WhatsApp

- **ROW is not for India.** The .NET edition and the shared admin no longer assume India outside Payments:
  currency fallbacks and amounts in the brand's currency, schedules and new clubs in the brand's time zone,
  phone numbers per member country, SMS through Twilio (DLT gateway and Interakt removed), no default country
  (details: `row/PENDING-WORK.md` §14, `row-dotnet/README.md`).
- **ROW has no WhatsApp.** Removing it from both editions, the admin and mobile is on hold until the go-ahead
  (`row/PENDING-WORK.md` §7). Open decision 12 (Meta templates) no longer applies.
- **Tests:** both APIs on fresh databases answer all 382 parameterless GET routes with the same status class
  (`kb/tools/get_sweep.py`); builds, type checks, admin tests and identity lints clean (`kb/testing.md`).

## 7. Deployment (to do)

Hosting is undecided (IIS / Windows Server or AWS, 2026-10-12). Until it is decided no new deployment files are written. If IIS:

1. Write `web.config` files for `row/api`, `row/admin` and `row/club-website`: HttpPlatformHandler running `node`, `%HTTP_PLATFORM_PORT%`, Node 22, stdout logs (the .NET edition's admin and club-website `web.config` files are a model).
2. Write an IIS deployment guide: install HttpPlatformHandler and URL Rewrite, set up app pools (No Managed Code), set environment variables per site, add SSL bindings.
3. For club websites, decide between Plesk and IIS-native provisioning (see 8).

## 8. Open decisions (owner: product / company)

Details for each are in `row/api/ROW-CHANGES.md`.

1. **The Members API is open without sign-in**, as in RIZones. Decide whether to lock it down.
2. **PPH health data** (blood group, medical info) needs a HIPAA/GDPR/PIPEDA review. AG and committee screens also show blood group and spouse data.
3. **Hosting for club websites.** The port assumes Plesk on the Windows servers. If the IIS servers do not run Plesk, an IIS-native provider is needed.
4. **Payments.** Choose Stripe and/or PayPal, tax handling (RIZones had Indian GST), and payout/route accounts.
5. **TRF fund settings always return 403.** RIZones checks a claim that never exists. Fix to use the `roles` claim?
6. **Push notifications.** Create a ROW Firebase project.
7. **Rotary.org integration.** ROW needs its own access; the live endpoints are pending, and the currency fallback rate is currently 1.
8. **Zones 4–8 programmes** (citation, zonal awards) are RIZones-specific. Keep them behind `modules.citation`, or drop them for ROW?
9. **Email verification probe.** SMTP port 25 is usually blocked on servers. Keep the probe, or rely on Brevo bounces?
10. **OCV Word report — PDFs and Office files are not drawn inline.** RIZones rasterised PDF pages (PDFium) and Office files (LibreOffice). ROW shows a labelled entry and a download link instead (RIZones' own fallback). Rendering them inline needs new dependencies (`pdfjs-dist` + a canvas package, and LibreOffice on the server).
11. Several RIZones quirks were kept on purpose, for example district mass emails using club-0 credits, and the password-reset email saying 30 minutes while the token lasts 480. They are listed in ROW-CHANGES.
12. **Closed 2026-10-13: ROW has no WhatsApp** (removal on hold, `PENDING-WORK.md` §7). Earlier note: **Scheduled WhatsApp sender.** RIZones sends announcements, events, newsletters, projects and reminders by WhatsApp through Interakt, with its own approved templates (fixed names and bodies, a pilot-club gate, and Interakt's 300-per-minute batching). ROW sends WhatsApp through the Meta Cloud API, and no templates exist in ROW's Meta account yet. Decide the templates (reuse RIZones' names and parameters, or design new ones); the sender is ported once they are approved. Until then, items flagged "send WhatsApp" stay pending.

## 9. Working rules agreed with the team

- Commit and push **only when asked**, as one commit (no per-module commits).
- Work solo (no multi-agent runs). The token budget is limited.
- No RIZones content in ROW. `npm run lint:rizones` must stay at 0 findings.
- Port as-is, then record ROW changes in `ROW-CHANGES.md`.
- Don't commit test uploads (`row/api/wwwroot/` is gitignored) or anything in `reference/`.

## 10. How to resume

1. Pull `main`. Run `npm install` and `npm run build` in `row/api`, start MySQL, and run the API (section 3).
2. Pick the next controller from 5.2. Open its C# file in `reference/…/Controllers/`, and read the services it injects.
3. Port it following `row/api/PORTING.md`. Put it in a module under `src/modules/`, register it in `src/modules/index.ts`, and add shared services to `SharedModule`.
4. Run `npx tsc --noEmit -p tsconfig.json` and `npm run -s lint:rizones`. Exercise the endpoints with curl against the local DB.
5. Add any RIZones quirk or ROW redesign idea to `ROW-CHANGES.md`. Update the counts in this file.
