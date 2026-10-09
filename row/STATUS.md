# ROW Build — Status and Handover

Last updated: 2026-10-09 · Branch: `main` · Last code commit: `1adecd4`

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
| `row/api` | NestJS backend, port of the RIZones .NET API, MySQL, same schema | **In progress** (~45%) |
| `row/admin` | Next.js + Tailwind + TypeScript admin portal (from the RIZones admin UI) | Foundation done, cleanup pending |
| `row/club-website` | Next.js public club website | Foundation done |
| `row/mobile` | Flutter app (imported from the RIZones app repo) | **Parked** |
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

**53 of 146 controllers ported, about 690 of 1,523 endpoints (≈45%).** Everything ported compiles,
passes the RIZones lint, and was exercised against a local database.

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

### 5.2 Pending (controller — endpoints), in suggested order

**1. Reports** (start here next):
- Reports 48
- ClubReport 9
- DistrictReport 9
- DistrictPerformanceReport 8
- MobileClubAdminReport 8
- MobileDistrictAdminReport 9
- ClubProfileReport 2
- DailyStatsReport 2

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
- The 10 deferred ClubWebsites pricing endpoints (`pricing/*`, `default-pricing*`, `pricing/route-account`, `pricing/send-reminders`)
- Not to port as-is (India-only; replace with Stripe equivalents or drop): CashfreeKyc 9, RazorpayRouteAccounts 7, RouteMaintenance 3

**3. Goal setting:**
- GoalSetting 79
- MobileGoalSetting 53
- ClubFoundationGoals 3

**4. RI Director:**
- RiDirector 53
- RiAdminCleanup 2
- InternationalPresident 5
- DistrictGovernor 9
- TrainingAppointment 9

**5. Rotary.org sync.** Needs ROW's own Rotary.org access.
- RotaryOrgManualSync 27
- RotaryOrgSync 3
- RotaryOrgProjectSync 3
- RotaryOrgProjectSyncLog 3
- ClubRotaryOrgCredentials 2
- RotaryThirdParty 1

**6. Mobile:**
- MobileDistrictAdminDashboard 17
- MobileClubAdminDashboard 15
- MobileAgDashboard 10
- MobileClubAdminPastPresidents 7
- MobileVersion 7
- MobileDistrictAwards 5
- MobileCalendar 4
- MobileWeblinks 3
- MobileMemberSettings 3
- MobileFcm 2 (needs a ROW Firebase project)
- MobileDistrictCmrEmailSettings 2 (routes already served by DistrictCmrEmailSettings — verify and mark done)
- MobileNotifications 1
- MobileLoginCheck 1

**7. Public site / websites:**
- ClubWebsitePublicData 16
- ClubWebsitePublicDataV2 8
- DistrictWebsites 14
- PublicProjectStats 10
- ClubFinder 10
- PublicDirectory 9
- PublicClubWebsite 4
- DistrictWebsitePublicData 3
- PublicWebsiteDirectory 2
- PublicProjectShare 2
- ClubWebsiteTheme 2
- ClubWebsitePublic 2
- ClubGalleryPublic 2
- PublicProject 1
- PublicOcvLiveDocuments 2
- LiveDocumentsExport 1

**8. Admin and other:**
- LoginAnnouncement 12
- MemberDuplicate 11
- DirectoryDataCollection 11
- EmailLog 10
- WhatsAppLog 11
- OcvGov 14
- SuperAdmin 5
- DistrictAwardsConfig 5
- PushLogs 4
- GlobalMemberSearch 4
- GlobalSearch 2
- FindRotarian 2
- WebSso 2
- WhatsAppInfo 2
- ProjectClassification 2
- ClubMemberHonorary 2
- DistrictDirectory 1
- ClubAnalytics 1
- CitationMatrix 1
- MassEmailMedia 1
- India-only, do not port: InteraktWebhook 1, ShrigodaPartner 1

To find the C# source of any of these: `reference/RotaryIndia_Admin_API_Claude/RotaryApi/Controllers/<Name>Controller.cs`.

### 5.3 Background services

| Status | Services |
|---|---|
| Ported | Citation auto-points (24 h, behind a flag), club leadership scheduled emails (30 s), CMR submission mailer |
| Pending | Club website reminder / auto-expire service, daily stats report email, scheduled communication emails, Rotary.org sync jobs |

Check `Program.cs` and `Services/*BackgroundService.cs` in the reference for the full list.

## 6. Progress — web and mobile

**Admin portal (`row/admin`).** The foundation is committed. Three tasks remain:
- **A.** Strip RIZones public-site content; add a `/cookies` page.
- **B.** Replace ₹ / INR / `en-IN` / IST literals with the `useFormat` helper; fix the "today" date bug.
- **C.** Wire the pay pages to `checkout.ts` (Stripe/PayPal); hide the Cashfree/Razorpay screens.

**Club website (`row/club-website`).** The foundation is committed. It needs the public endpoints from 5.2 item 7.

**Mobile (`row/mobile`).** Imported, parked until the backend is further along. It needs a ROW Firebase project for push.

## 7. Deployment (to do)

1. Write `web.config` files for `row/api`, `row/admin` and `row/club-website`: HttpPlatformHandler running `node`, `%HTTP_PLATFORM_PORT%`, Node 22, stdout logs.
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
10. Several RIZones quirks were kept on purpose, for example district mass emails using club-0 credits, and the password-reset email saying 30 minutes while the token lasts 480. They are listed in ROW-CHANGES.

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
