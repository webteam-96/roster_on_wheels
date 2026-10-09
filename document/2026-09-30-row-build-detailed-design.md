# ROW build: detailed engineering design

| | |
|---|---|
| Date | 30 September 2026 |
| Status | Draft for review |
| Companion to | `2026-09-30-row-build-position-design.md` (the position) and the *ROW Build Guide* of 29 September |
| Audience | The four engineers building ROW, the lead developer, and anyone reviewing scope |
| Basis | Every number below was measured on 30 September 2026 against `main` and the production database. File and line references are to that revision |

## How to read this document

The position paper says *what* to change in the build guide. This document says *how* each change is
built: the interface or schema, the files it touches, the order of steps, how RIZones stays safe
while it lands, and the test that proves it is done.

It is organised as eleven workstreams (WS0 to WS10). Each has the same shape:

1. **What the code looks like today**, with evidence.
2. **Design**: interfaces, tables, configuration.
3. **Steps**, in merge order.
4. **RIZones safety**: what guarantees today's behaviour is unchanged.
5. **Done when**: a test someone can run.
6. **Effort** in engineer-weeks for someone who knows the code.

Section 13 adds the efforts up against the calendar. Section 14 lists defects found in production
code during this investigation that should be fixed regardless of ROW.

## Fixed constraints and working assumptions

- ROW runs on the existing Windows server in India, in its own MySQL instance and IIS pools. No new hosting spend.
- Eight languages at launch: English, French, German, Italian, Japanese, Korean, Portuguese, Spanish.
- RIZones must not regress. ROW must not launch with visible quality defects.
- Every ROW difference is configuration, an injected provider, or a feature flag. When a setting is absent the code behaves as RIZones does today ("India is the default").
- The Flutter app is in a separate repository and was not measured. Every estimate below excludes it.

---

## WS0. Safety net and release mechanics (do this first)

### Today

- No automated test of any kind exists for the API or the web app. No pipeline. No health endpoint.
- No version number anywhere. The frontend's `.next/BUILD_ID` is the only build identifier.
- The API is published locally and hand-copied to `D:\inetpub\vhosts\rizones45678.org\httpdocs`. The frontend's built output is committed to `rotary-frontend/deploy-ready/` and that commit is the release. Rollback means re-copying an older folder.
- Developer machines connect to the production database.

Everything else in this document changes code RIZones runs. None of it can be called safe until a
change can be checked automatically and reversed quickly.

### Design

**A. Health and version endpoint.** `GET /api/health` (anonymous): returns `{ status, version, commit, instance, dbOk, startedAtUtc }`. `version` and `commit` are stamped at publish time through MSBuild properties (`-p:InformationalVersion=2026.10.1+<sha>`), read from `AssemblyInformationalVersionAttribute`. The frontend exposes the same through `NEXT_PUBLIC_BUILD_VERSION`.

**B. Smoke suite.** A new test project `RotaryApi.SmokeTests` (xUnit, `HttpClient`), run against a *running* instance given by environment variables (`SMOKE_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`). It is black-box and read-mostly, so it can run against production after every deploy. Thirty checks to start:

| Group | Checks |
|---|---|
| Platform | health is OK and reports the expected version; Swagger loads |
| Auth | login succeeds for a dedicated smoke account; `my-context` returns a club and a district; a bad password is rejected |
| Read paths | club dashboard, district dashboard, member list, board of directors, projects list, CMR list, dues list, goal setting, announcements each return 200 with a non-empty, well-formed body |
| Kill switch | a known inactive club returns the inactive message |
| Public | public club-website data, public directory, project stats return 200 |
| Payments | create a dues order in the gateway's test mode and read it back (skipped where no sandbox key is configured) |
| Messaging | template registry resolves every key for the instance's languages (no send) |
| Sync | `rotary_org_sync_log` has a completed member sweep in the last 36 hours |
| Assistant | the golden-question eval endpoint returns at least the previous pass count |
| Documents | one PDF and one Excel export return a file with a non-zero size and the right content type |

A second, smaller Playwright suite (`rotary-frontend/e2e`) covers five journeys in a browser: login, club dashboard, member search, open a CMR, open the dues page.

**C. Error-rate baseline.** A lightweight request-outcome counter, because there is no APM. Middleware increments an in-memory counter keyed by `(hour, statusClass, routeTemplate)` and flushes once a minute to a new table `api_request_stats (HourUtc, RouteTemplate, StatusClass, Count, P95Ms)`. One week of RIZones data before the first ROW merge is the baseline. The Friday gate report compares the current week's 5xx rate and p95 per route against it. This is what makes "no regression traced to ROW work" checkable.

**D. Release and rollback.** A script `tools/deploy.ps1 -Instance RIZones|ROW -Version <v>` that: publishes to a versioned folder (`releases/<v>/api`, `/web`, `/workers`), stops the pool, switches the IIS physical path, starts the pool, runs the smoke suite, and switches back automatically if it fails. The last three versions are kept. `deploy-ready/` stops being committed once this exists.

**E. Staging database.** A nightly restore of production into a `rotaryindia_staging` schema with personal fields scrambled (emails to `user<id>@example.invalid`, mobiles to a fixed pattern). Developer configurations point there. This is week-one work in the build guide already; it is listed here because the smoke suite needs it.

### Steps

1. Health endpoint and version stamping (half a day).
2. `api_request_stats` middleware and table (one day). Deploy to RIZones immediately so the baseline starts accumulating.
3. Smoke suite against staging, then against production (three days).
4. `deploy.ps1` with automatic rollback (two days). First use: a no-op RIZones release.
5. Playwright journeys (two days).

### RIZones safety

Additive only: one new endpoint, one new table, one middleware that never throws (wrapped in try/catch, like `AuditMiddleware`).

### Done when

A deliberate bad build (an endpoint forced to return 500) is deployed to staging with `deploy.ps1` and is rolled back automatically, with the smoke report naming the failed check.

### Effort

1.5 engineer-weeks. Owner: BW1. **Nothing in WS1 to WS10 merges before steps 1 to 3 are live.**

---

## WS1. Instance and brand configuration

### Today

- 255 files inject `IConfiguration` and read string keys. There is no `IOptions<T>` anywhere.
- URL keys are scattered: `FrontendUrl` (51 references in 24 files), `BackendUrl` (11), `PublicFrontend:BaseUrl` (5), `Api:BaseUrl` (6), with `"https://rizones45678.org"` as an inline fallback 12 times and `"localhost:3000"` 23 times.
- CORS accepts `rizones45678.org` and `rizones4567.org` by literal (`Program.cs:92-97`).
- The parent domain for club sites has two competing fallbacks: `"rotaryindia.org"` in six places and `"rizones45678.org"` in four.
- Brand text "Rotary Zones 4, 5, 6, 7 & 8" is in about 45 backend files and 88 frontend files (219 occurrences).
- Constants that are really instance facts: `CogClubId = 31598`, pilot club `2765` and district `2`, test district `"3142"`, `SendHourIst = 7`, India `pk_country_id = 1`.

### Design

**One typed object, one JSON file per instance, India defaults compiled in.**

```csharp
public sealed class BrandOptions
{
    public string InstanceCode { get; init; } = "RIZ";          // RIZ | ROW
    public string ProductName { get; init; } = "Rotary Zones 4, 5, 6, 7 & 8";
    public string ShortName { get; init; } = "RIZones";
    public DomainOptions Domains { get; init; } = new();        // AdminOrigin, ApiBase, ClubSiteParent, AllowedOrigins[]
    public ContactOptions Support { get; init; } = new();       // email, phones[], hours, address, legal name
    public LookOptions Look { get; init; } = new();             // logoUrl, faviconUrl, emailHeaderHtml, emailFooterHtml
    public LocaleOptions Locale { get; init; } = new();         // DefaultLanguage "en", Languages ["en"], DefaultCurrency "INR",
                                                                // DefaultTimeZone "Asia/Kolkata", NumberLocale "en-IN", DefaultCountryId 1
    public ProviderOptions Providers { get; init; } = new();    // Payments ["cashfree","razorpay"], WhatsApp "interakt", Sms "dlt", OtpPolicy
    public ScopeOptions Scope { get; init; } = new();           // Zones[], Countries[], ExemptDistricts[], CogClubId, pilot ids
    public Dictionary<string, bool> Features { get; init; } = new();   // "member.bloodGroup": true ...
    public LegalOptions Legal { get; init; } = new();
}
```

Every default equals today's RIZones value, so an instance with no `Brand` section is RIZones.

**Introduction without touching 255 files.** Two mechanisms, used together:

1. `services.Configure<BrandOptions>(config.GetSection("Brand"))` plus a static accessor `Brand.Current` set once at startup, for static helpers that cannot take DI (`CashfreeGatewayProxy`, `OtpWhatsAppHelper`, `WebsiteDefaultPricing`).
2. A configuration *overlay*: at startup, legacy keys are populated from `BrandOptions` when they are absent (`FrontendUrl` from `Domains.AdminOrigin`, `BackendUrl` from `Domains.ApiBase`, `Brevo:SenderName` from `ProductName`). Existing code keeps reading the keys it reads today. New code reads `IOptions<BrandOptions>`.

**Public endpoint.** `GET /api/public/brand` returns the non-secret subset (name, logos, colours, languages, default locale, support contacts, feature flags, legal links). It is cached for an hour and is the first call both web and app make.

**Frontend.** A `BrandProvider` inside `ClientProviders.tsx` (the only provider file; today it holds just `AuthProvider`). It exposes `useBrand()` and `useFeature("member.bloodGroup")`. The 219 "Rotary Zones" literals are not replaced one by one: they become the translation variable `{brandName}` during string extraction (WS2), which the translation provider fills from `useBrand()`.

**Feature flags.** `Features` is a flat map. The rule from the build guide stands: code asks `Brand.Current.Features["member.bloodGroup"]`, never the brand name. Missing key means `true` (India default). The existing per-district and per-club module switches (`module_master`, `district_modules`, `club_modules`) stay as they are; brand flags are for instance-wide differences only.

### Steps

1. `BrandOptions`, binding, static accessor, overlay, `/api/public/brand` (3 days).
2. CORS policy reads `Domains.AllowedOrigins`; the literal check remains as the default list (half a day).
3. Replace the 12 + 23 inline URL fallbacks with one helper `BrandUrls.Frontend()` (1 day, mechanical).
4. Club-site parent domain: one resolver `BrandUrls.ClubSiteParent()` that reads `system_settings.ClubWebsiteParentDomain`, then `Domains.ClubSiteParent`. Remove the ten disagreeing fallbacks. `WebsiteDomainHelper.cs:51` takes its suffix list from configuration (1 day).
5. Instance constants (`CogClubId`, pilot ids, test district, India country id) move to `Scope` with today's values as defaults (1 day).
6. Frontend `BrandProvider`, `lib/merchantInfo.ts` and the header help line read from it (2 days).

### RIZones safety

No `Brand` section is deployed to RIZones. A unit test asserts that `new BrandOptions()` serialises to a checked-in snapshot of today's values, so a changed default fails the build.

### Done when

`grep -r "rizones45678" RotaryApi --include=*.cs` returns only `BrandOptions` defaults and comments; ROW staging with a `Brand` section shows no RIZones name, logo, domain or phone number in the header, login page, one email and one PDF.

### Effort

2 engineer-weeks. Owner: BW1.

---

## WS2. Translation

This is the largest workstream. It has seven parts because text lives in seven different places.

### Today

| Where the text lives | Size | Notes |
|---|---|---|
| Admin web app JSX | 12,170 strings in 768 files | 671 of 768 components are client components |
| Of that, SuperAdmin (`settings/`, `admin/`) | 2,335 | Kaizen staff only |
| Hard shapes | 469 template literals with interpolation, 148 plural ternaries, 111 module-level constant arrays, 2,293 `label:` properties, 67 `confirm()` and 30 `alert()` calls, 1,456 placeholders | These are what make extraction slow |
| Server messages | about 1,650 `message = "..."`, 653 distinct, 172 interpolated; 443 exception literals | No localisation infrastructure exists |
| Frontend use of server messages | `response?.data?.message` 871 times in 334 files, 503 with an English fallback | No shared error helper |
| Emails | about 60 builder methods in 30 files; header and footer are `const` strings used 50 and 53 times | Dues and greeting texts are stored in the database and are admin-authored |
| WhatsApp | about 40 template names as literals; bodies exist only at Interakt | |
| Documents | 7 server builders with roughly 270 label literals; browser exports with about 300 more | No font files in the repository |
| Database labels | about 700 rows across 8 master tables | |
| Public club sites | 155 strings in 44 files, inline in five themes | `defaultSlugFor` routes by English menu-name prefix |

### 2.1 Scope: the reachable-route list

A generated file `rotary-frontend/i18n-scope.json` lists every route a non-SuperAdmin user can reach.
It is built by a script (`tools/i18n-scope.mjs`) from the actual navigation sources, so it cannot
drift from the product:

- the four `nav.ts` files (club admin 12 items, district admin 11, AG 5, club moderator 1);
- the `moduleKey` switch in `clubs/[id]/dashboard/page.tsx:195-279` and `districts/[id]/dashboard/page.tsx:89-110`;
- `RoleBasedHome.tsx` card links and `DashboardSwitcher` landing routes;
- every `href`/`router.push` inside files already in scope (transitive closure, depth-limited);
- the public flows: `login`, `forgot-password`, `reset-password`, `sso`, `pay/*`, `report/*`, `dues-approval`, `club-dues-approval`, `public/*`, the three policy pages, and the `(site)` group.

Findings that shape it:

- Club-admin dashboards link to **v2** pages; district-admin dashboards link mostly to **v1** pages even where a v2 exists. So scope is not "v2 only".
- Nine club modules and eleven district modules have no v2 at all.
- `settings/**` and `admin/**` are excluded by rule, not by omission, and stay in English.

An ESLint rule (`no-literal-jsx-text`, from `eslint-plugin-i18next`) is enabled **only for files in the scope list**. That reconciles the build guide's "no text literals" rule with the decision to leave SuperAdmin in English.

Expected scope after generation: roughly 6,000 to 7,500 strings. The script prints the exact figure; that number, not this estimate, drives the plan.

### 2.2 Web mechanics

- **Library:** `next-intl`, in its **no-routing** mode: locale comes from a cookie (`NEXT_LOCALE`) set by the language picker, falling back to the member's `PrimaryLanguage`, then the browser language, then the instance default. No `[locale]` route segment. This matters because the app has 494 route files and no `middleware.ts`; locale-prefixed routing would move every one of them.
- **Provider placement:** `NextIntlClientProvider` inside `ClientProviders.tsx`, outside `AuthProvider`, so the login page is translated. `<html lang>` in `app/layout.tsx:31` reads the cookie.
- **Server-rendered text:** only the 18 `(site)` pages and three policy pages render text on the server. They use `getTranslations()`; everything else uses `useTranslations()`.
- **Message files:** one JSON per namespace per language under `rotary-frontend/messages/<lang>/<namespace>.json`. Namespaces follow route groups (`clubDashboard`, `districtDashboard`, `members`, `dues`, `cmr`, `projects`, `goals`, `public`, `common`). The provider loads `common` plus the namespace for the current route group, so a user downloads about a tenth of the total.
- **Keys:** `<namespace>.<screen>.<element>`, for example `dues.members.markPaidConfirm`. English is the source.
- **Fonts:** `app/layout.tsx` and `(site)/layout.tsx` load Inter and Fraunces with the `latin` subset only. Add Noto Sans JP and Noto Sans KR through `next/font` with `display: swap`, applied by `:lang(ja)` and `:lang(ko)` selectors.

**Handling the hard shapes.** These get written rules, because 1,100 strings fall into them:

| Shape | Count | Rule |
|---|---|---|
| Template literal with values | 469 | ICU message with named arguments: `t("deleteConfirm", { name })` |
| Plural by ternary | 148 | ICU plural: `{count, plural, one {# club} other {# clubs}}`. Japanese and Korean use `other` only |
| Module-level constant arrays | 111 | Convert to a function taking `t`, or store keys and translate at render. Arrays whose values are *stored* (`GENDERS`, `RELATIONS`, `MEETING_DAYS` in `lib/constants.ts`) keep the stored value and gain a label key |
| `label:` in nav and column definitions | 2,293 | `labelKey:` resolved at render |
| `confirm()` / `alert()` / `prompt()` | 102 | Replace with the existing `AlertModal` / `DeleteDialog` components, which take translated text |
| Month and weekday arrays | about 15 files | Delete; use `Intl.DateTimeFormat(locale, { month: "short" })` |
| Brand name inside text | 219 | `{brandName}` argument supplied by the provider |

**Extraction procedure.** Directory by directory, in the order of WS2.7. For each directory: (1) the owner announces a two-day lock in the team channel, (2) a codemod proposes keys, (3) the engineer reviews every diff by hand, (4) the English message file is the only thing that changes behaviour, (5) the page is opened in the pseudo-locale (every string wrapped in brackets and lengthened by 40 percent) and any unbracketed text is a miss. The pseudo-locale is what finds the strings the codemod cannot see.

### 2.3 Server messages

The aim is not to translate 1,650 literals. It is to stop the server being the source of user-facing prose.

- **Error codes.** Responses keep `message` (English, unchanged, so RIZones and the mobile app are unaffected) and gain `code`, for example `CLUB_INACTIVE`, `ACCESS_DENIED`, `NO_FILE_UPLOADED`. The four most reused messages cover 308 occurrences; a helper `ApiErrors.ClubInactive()` replaces them mechanically.
- **Where the code comes from.** A static class `ApiErrors` with one method per code; controllers return `BadRequest(ApiErrors.X(args))`. The global exception middleware (`Program.cs:699-720`) maps a new `ApiException(code, args)` to `{ code, args, message }`; plain `InvalidOperationException` keeps today's behaviour.
- **Frontend.** One helper `getErrorMessage(e, t)` in `src/lib/errors.ts`: if the response has a `code` with a translation, use it with `args`; otherwise fall back to `message`, then to a generic translated sentence. The 871 call sites migrate to it as their directory is extracted; the 503 English fallbacks disappear at the same time.
- **Request language.** The axios instance (`services/api.ts:90-100`) sends `Accept-Language` from the cookie. The API reads it through `UseRequestLocalization`, and adds a `lang` claim to new JWTs seeded from `member_master_profile.PrimaryLanguage`. Background jobs use the recipient member's language, falling back to the district's default.
- **Scope rule.** Only controllers reachable from the route list get codes before launch. The script in 2.1 also emits the API paths those routes call.

### 2.4 Emails, WhatsApp and SMS

**Emails.**

- `EmailService.EMAIL_HEADER` and `EMAIL_FOOTER` change from `const` to `static string` properties initialised at startup from `BrandOptions.Look`. All 103 references compile unchanged. This is the smallest possible diff for branding.
- Email bodies move to templates in order of reach: authentication and OTP, dues receipts and reminders, CMR, announcements and events, website, then the rest. Template engine: Scriban. Files at `RotaryApi/Templates/Email/<key>.<lang>.html` with a `.subject` line. `IEmailTemplates.Render(key, lang, model)` falls back to English.
- Text that admins author and store in the database (`membership_dues.EmailSubject/EmailBody`, `club_dues.*`, greeting texts on club and district rows, mass emails) is **data, not product text**. It is not translated. The dues and greeting forms gain a note that the text is sent as written.
- Fixed CC addresses at kaizeninfotech.com, the helpline numbers in `EmailService:488, 604, 666`, and the mass-email sender constant become `BrandOptions.Support` values.

**WhatsApp.** See WS6.2 for the sender interface. For translation: Meta approves each template per language, so four launch templates in eight languages are thirty-two submissions. Template approval is the long pole; submit English and the pilot districts' languages in week one and the rest as they are reviewed.

**SMS.** One OTP message. The DLT text at `SmsService.cs:24` stays for RIZones; ROW's Twilio message is a translated template.

### 2.5 Documents and fonts

**Today.** QuestPDF builders name Georgia, Arial, Segoe UI, Nirmala UI and Lato. No font file ships with the code, so output depends on what the Windows host has installed. `QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false` is set process-wide, so a missing glyph prints as an empty box without any error. Browser PDF exports use jsPDF with Helvetica, which cannot render Japanese, Korean, or the rupee sign it prints today (`reportDownload.ts:346`).

**Design.**

- Ship fonts in the repository: `RotaryApi/Fonts/` with Noto Sans (Latin, covers all six European languages), Noto Sans JP and Noto Sans KR, registered at startup through `FontManager.RegisterFont`. A helper `DocFonts.For(lang)` returns the family with fallbacks. The three QuestPDF builders take the language as a parameter.
- Word builders set `RunFonts { Ascii, HighAnsi, EastAsia }` so East Asian runs use the Noto family.
- ClosedXML exports need no font work (the reader's Excel supplies fonts) but their header strings go through the same resource files.
- Builder labels (about 270) move to `RotaryApi/Resources/Documents.<lang>.json`, read through `IStringLocalizer`.
- **Browser PDF exports.** Embedding a CJK font in jsPDF means shipping 5 to 15 MB to the browser. Instead, the CMR PDF is already built server-side by `ClubMonthlyReportPdfBuilder`; `reportDownload.ts`'s `downloadPDF` is retired in favour of the server endpoint. The browser-side Word and Excel exports keep working and take their headers from message files.
- A test renders each PDF builder once per language with a fixture containing the characters "日本語 한국어 äöüß éèç ñ ã" and asserts, by extracting text from the PDF, that they survive.

### 2.6 Database labels

About 700 user-visible labels are rows: `module_master.ModuleName` (45), `goal_fields.FieldLabel` and `GroupName` (116), `goal_categories.Name` (4), `area_of_focus_master.name` (63), `category_master.name` (126), `sub_category_master.name` (295), `designation_master.designation_name` (40), `trf_fund_master.FundName` (5), default club-website menu names (14), zonal award and citation question text, OCV document type names.

**Schema.** One table, not a column per language:

```sql
CREATE TABLE master_translation (
  entity      VARCHAR(40)  NOT NULL,   -- 'module', 'goal_field', 'category' ...
  entity_key  VARCHAR(120) NOT NULL,   -- stable business key, never the numeric id
  field       VARCHAR(30)  NOT NULL,   -- 'name', 'label', 'description'
  lang        VARCHAR(10)  NOT NULL,   -- 'fr', 'ja' ...
  text        TEXT         NOT NULL,
  PRIMARY KEY (entity, entity_key, field, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Read path.** A scoped service `IMasterLabels` loads the table once per language into memory (700 rows by seven languages is small) and exposes `Label(entity, key, field, fallback)`. The DTO mappers for modules, goal fields, taxonomies and designations call it. English is the base column; a missing translation returns the base text. No query changes, no joins.

**Stable keys.** `module_master` has `ModuleKey` and `goal_fields` has `FieldKey`. The taxonomy tables have only `name`, which can be edited, so they gain a `code` column populated once from a slug of the current name (WS5). Designations are created by the Rotary.org sync from officer role names, so their key is the role name as Rotary.org sends it.

**Club-website menus.** `club-website/src/lib/nav.ts:33-48` decides a menu's route by its English name prefix. It must switch to a `slug` column on `club_website_menu` before any menu name is translated, or translated sites lose their navigation.

### 2.7 Workflow, order and quality

**Order of extraction** (each step is shippable and visible to pilot users):

1. `common` namespace, login and password flows, language picker.
2. Mobile app screens (separate repository).
3. Club-admin dashboard and the v2 pages it links to.
4. Payment and public flows (`pay/*`, `report/*`, approvals).
5. District-admin dashboard and the v1 pages it links to.
6. AG, club moderator, RI Director and goal oversight.
7. Public `(site)` pages, policy pages, club-website app.
8. Emails, documents, database labels, in the template order of 2.4.

**Translation pipeline.** English JSON is the source. A script exports new and changed keys to XLIFF, machine-translates them, and the reviewer (vendor or volunteer) edits the XLIFF, which is imported back. A terminology list built from Rotary International's published translations is attached to every job. A check in the pipeline fails the build when a language is missing a key that English has, or has a key English lacks, or when an ICU message has different arguments from its English source.

**Crawl.** A Playwright job visits every route in the scope list in every language at 1280 and 390 pixels wide and fails on: a missing-key marker, horizontal overflow of any text element, or a font fallback box. German is the length stress test; Japanese and Korean are the rendering test.

**A language the list omits.** The reference data shows 1,036 clubs in Taiwan, more than in Italy (1,001). Traditional Chinese is not among the eight. This is a product decision to confirm, not an engineering one.

### Steps (summary)

1. Scope script and lint rule; framework installed; provider and language picker; pseudo-locale (1 week).
2. Error codes for the top reused messages, `getErrorMessage`, `Accept-Language` (1 week).
3. Header and footer properties; fonts shipped and registered; PDF glyph test (1 week).
4. `master_translation`, `IMasterLabels`, taxonomy `code` columns, club-site menu slug (1.5 weeks).
5. Extraction in the order above (the bulk; see effort).
6. Email templates, document labels (3 weeks).
7. Pipeline checks and crawl (1 week).

### RIZones safety

- The English message files are generated from the existing literals, so English output is character-for-character identical. The pseudo-locale and the Playwright journeys verify each directory before it merges.
- Responses keep `message`; `code` is additive.
- Header and footer default to today's HTML.
- The club-website menu slug is populated from the current English names in the same migration that adds it.

### Done when

The crawl is green for all eight languages on every route in the scope list; the PDF glyph test passes; a member whose language is Japanese receives a Japanese OTP email, a Japanese receipt PDF and Japanese module names on the dashboard.

### Effort

| Part | Engineer-weeks |
|---|---|
| Framework, scope, lint, pseudo-locale | 1 |
| Web extraction, about 6,500 strings with the hard shapes | 6 |
| Server codes and error helper | 2 |
| Email templates | 3 |
| Documents and fonts | 1.5 |
| Database labels and menu slug | 1.5 |
| Club-website app | 0.5 |
| Pipeline checks and crawl | 1 |
| **Total** | **16.5** |

Owner: F2 leads; every engineer extracts the directories they own.

---

## WS3. Locale: numbers, money and dates on screen

### Today

- Two helper files exist (`lib/currency.ts`, `lib/dateUtils.ts`) and a third parallel set (`components/dashboard/formatters.ts`). Most code bypasses all three: `'en-IN'` appears 311 times in 146 files, `₹` 285 times in 69 files, hand-rolled `padStart` date formatting 163 times.
- `formatMoney` hard-codes `en-IN` for INR and `en-US` otherwise and concatenates the symbol.
- "Today" is computed as `new Date().toISOString().slice(0,10)` in 78 places. That is the UTC date, so before 05:30 IST it is yesterday. This is a live RIZones bug.
- The current Rotary year is derived from the browser clock in 96 places across 25 files.
- Backend: `"INR"` is a literal 54 times in 20 files; `₹` 41 times in 20 files; paise conversion by `* 100` in five places. `CurrencyHelper.Normalize` accepts only INR, NPR, LKR and USD and turns everything else into INR.

### Design

**One formatting module.** `src/lib/format.ts` replaces the three existing files:

```ts
export function useFormat() {            // reads locale from next-intl, currency and time zone from district/brand context
  return {
    number(n: number, opts?: Intl.NumberFormatOptions): string,
    money(amount: number, currency?: string): string,        // Intl.NumberFormat(locale, { style: "currency", currency })
    moneyShort(amount: number, currency?: string): string,   // compact notation; lakh/crore only when locale is en-IN
    date(d: string | Date, style?: "short" | "medium" | "long"): string,
    dateTime(d: string | Date): string,
    monthName(month: number, style?: "short" | "long"): string,
  };
}
export function todayIn(timeZone: string): string;           // YYYY-MM-DD in a named zone
export function rotaryYearOf(date: string | Date): string;   // "2026-27"
```

`Intl.NumberFormat` with `currency` handles symbol, position, grouping and decimal places for every
currency, including yen and won, which have no decimals. With locale `en-IN` and currency `INR` its
output matches today's.

**Migration.** A codemod rewrites the three mechanical patterns (`x.toLocaleString('en-IN')`,
`` `₹${...}` ``, `toLocaleDateString('en-IN', ...)`) to `useFormat()` calls. An ESLint rule bans
locale string literals and currency symbols outside `lib/format.ts` for files in the i18n scope, so
the work cannot silently regress. The old helper files re-export from the new one during the
transition.

**"Today" and the Rotary year.** The `my-context` response (already fetched on every mount) gains
`today`, `timeZone` and `currentRotaryYear`, computed on the server for the selected district. The
78 UTC-date sites and the 96 browser Rotary-year sites use those values through
`todayIn(timeZone)` and the context. This fixes the early-morning bug for RIZones as a side effect.

**Backend money.**

- A small value type `Money(decimal Amount, string Currency)` with `ToMinorUnits()` that uses a per-currency exponent table (INR 2, USD 2, EUR 2, JPY 0, KRW 0, BRL 2). The five `* 100` sites use it.
- `CurrencyHelper.Normalize` validates against ISO 4217 for instances whose brand lists more currencies; its INR fallback remains for RIZones.
- Server-side formatting for emails and documents goes through `IMoneyFormatter.Format(money, culture)`; the 41 `₹` literals are replaced as each builder is templated in WS2.

### Steps

1. `format.ts`, context fields, old helpers delegating to it (3 days).
2. Codemod and lint rule, directory by directory alongside WS2 extraction (the same files are open anyway).
3. Backend `Money`, minor-unit table, formatter (3 days).

### RIZones safety

A snapshot test formats 40 representative values (amounts, dates, short money in lakh and crore) through the old helpers and the new module with locale `en-IN`, currency `INR`, zone `Asia/Kolkata`, and asserts identical strings.

### Done when

The lint rule passes on every file in scope; a district with currency `JPY` and locale `ja` shows `￥12,000` with no decimals on the dues page, in the receipt email and in the receipt PDF.

### Effort

3 engineer-weeks, mostly absorbed into the WS2 extraction passes. Owner: F1.

---

## WS4. Time

### Today

- The server clock is India Standard Time and MySQL's `time_zone` is `SYSTEM`. No clock abstraction exists.
- C# reads the clock 488 times through `DateTime.Now`, 51 through `DateTime.Today`, 99 through `DateTime.UtcNow`. SQL uses `NOW()` 1,187 times, `CURDATE()` 87, `CURRENT_TIMESTAMP` 248, `UTC_TIMESTAMP()` 71.
- MySqlConnector returns `DateTimeKind.Unspecified`, so the API sends `"2026-09-30T14:00:00"` with **no offset**. The browser parses that as its own local time.
- Five background services fire at a fixed IST hour, each with its own copy of `ResolveIst()`. The greetings worker runs once a day at 08:00 server time and matches birthdays against the server's date.
- Publish and expiry windows, reminders and "upcoming" are compared against server `NOW()` and `CURDATE()`.

### The decision, and why the build guide's rule cannot be met yet

The guide says "UTC in the database". On this server that is not achievable without rewriting the
clock reads: .NET on Windows takes its local zone from the operating system, which RIZones needs to
be IST, and there is no per-process override. A ROW database set to UTC would receive UTC from
`NOW()` and IST from `DateTime.Now` into the same rows.

So for as long as ROW shares the server:

> **ROW stores instance time exactly as RIZones does (IST today). Correctness for users in other
> zones is achieved at three boundaries: output, input and scheduling.**

This is less elegant than UTC storage and entirely correct, provided the three boundaries are complete. When ROW moves to its own host, the instance zone becomes UTC by configuration and nothing else changes.

### Design

**A. Instance zone.** `BrandOptions.Locale.InstanceTimeZone` (default `Asia/Kolkata`) names the zone that stored timestamps are in. It equals the server zone while the server is shared.

**B. District zone.** New column `district_master.TimeZoneId VARCHAR(64) NULL` (IANA name). `club_master.Timezone` already exists; a club uses its own value, else its district's, else the instance default. A one-off script fills districts from their country, with manual entries for the multi-zone countries (United States, Canada, Brazil, Australia, Russia, Mexico, Indonesia).

**C. Output boundary.** A global `JsonConverter<DateTime>`: values of kind `Unspecified` are treated as instance time and written with that zone's offset, `"2026-09-30T14:00:00+05:30"`. Browsers then convert to the viewer's zone without any frontend change. It is enabled by the flag `time.emitOffset`, **off for RIZones**, because RIZones clients currently rely on the no-offset form being read as local. Date-only columns (birth dates, project dates, Rotary year boundaries) are excluded by an attribute and stay as `YYYY-MM-DD` strings, so a birthday never shifts by a day.

**D. Input boundary.** Forms send `datetime-local` values with no zone ("publish at 09:00"). For an admin in New York that is read by the server as 09:00 IST. The frontend's form helper converts such values to an ISO string with the *district's* offset before sending (the district zone comes from the context of WS3), and a model binder converts any offset-bearing value to instance time before it reaches the service. With the flag off the helper sends what it sends today.

**E. Scheduling boundary.** A shared component replaces the five copies of `ResolveIst()`:

```csharp
public interface ILocalSchedule
{
    // Districts for which "now" has just passed `localTime` in their own zone and have not run `jobKey` today (their date).
    Task<IReadOnlyList<DistrictDue>> DueNowAsync(string jobKey, TimeOnly localTime, CancellationToken ct);
    Task MarkRanAsync(string jobKey, int districtId, DateOnly localDate, CancellationToken ct);
}
```

backed by a table `scheduled_job_runs (job_key, fk_district_id, local_date, ran_at_utc)`. Jobs that are "daily at HH:00 for the people concerned" (greetings, daily stats, district performance reports, data-quality audit) wake every 15 minutes, ask what is due, and process only those districts. For RIZones every district is in one zone, so they all come due together at the same hour as today. The greetings worker's Task Scheduler entry changes from "daily 08:00" to "every 15 minutes" with the same executable.

**F. "Today" in SQL.** Queries that compare against `CURDATE()` for a person-facing meaning (birthdays today, reminders N days before, upcoming events) take a `@Today` parameter computed in C# for the district, instead of relying on the server date. MySQL's named-zone conversion (`CONVERT_TZ` with zone names) is not used because it needs time-zone tables that are not loaded on Windows installs by default. About 25 queries are affected (the fifteen business examples found plus their siblings).

**G. Clock interface for new code.** `TimeProvider` (built into .NET) is registered and used by all new code and by every method touched in E and F. The remaining clock reads are left alone; most are log stamps and file names.

**H. Rotary year.** The year flips on 1 July by server date, within a six-hour polling window. For ROW users in the Americas the flip arrives about half a day early. Project-to-year assignment is by project date, not by the flag, so data lands in the right year table regardless; only the "current year" default in selectors is affected for a few hours once a year. Accepted, and documented for support.

### Steps

1. `TimeZoneId` column, fill script, resolver `ZoneFor(clubId | districtId)` (2 days).
2. `ILocalSchedule`, table, migrate the five services and the greetings worker (1 week).
3. JSON converter and date-only attribute audit across 234 `DateTime` DTO properties (4 days).
4. Input helper and model binder (3 days).
5. `@Today` parameterisation of the person-facing queries (4 days).

### RIZones safety

- `time.emitOffset` is off; the input helper is inert without it.
- With all districts in `Asia/Kolkata`, `ILocalSchedule` returns every district in the same tick as today's fixed hour. A test pins this.
- `@Today` for a district in `Asia/Kolkata` equals `CURDATE()` on this server.

### Done when

On ROW staging with a district in `America/New_York`: an announcement scheduled in the form for 09:00 is published at 09:00 Eastern; a member with a birthday today in New York is greeted on that date and not the day before; an API timestamp displays in the viewer's own zone; RIZones smoke and journeys are green with no configuration change.

### Effort

3.5 engineer-weeks. Owner: F1.

---

## WS5. Master data and seeds

### Today

- Seeding is code in `DatabaseInitializer.cs`. Roles are inserted with explicit ids (1 Member, 2 Admin, 3 SuperAdmin, 4 ZonalCoordinator, 5 ClubModerator, 6 AG, 7 RIDirector). Designations use auto ids but depend on insert order (1 President, 2 IPP, 3 VP, 4 Secretary). Countries rely on India being inserted first (`IndiaCountryId = 1`).
- **Area of focus, category and sub-category have no seed in code at all.** They exist only as production rows.
- Code depends on numeric ids: `fk_role_id` literals in 134 places; designation ids `(1,4)` and `(1,2)` in 14 places; the zonal awards calculators use area-of-focus ids 59, 2, 41, 50, 51, 31, 39, 54, 55, 56, category ids 13, 129, 130, 131 and sub-category ids 44, 285, 286.

A fresh ROW database seeded by business key alone would get different ids and these checks would silently fail.

### Design

**Seed files in the repository**, `RotaryApi/Seeds/<table>.json`, exported once from production:

```json
{ "table": "category_master", "idPolicy": "preserve", "key": ["code"],
  "rows": [ { "id": 13, "code": "basic-education", "areaOfFocusCode": "education", "name": "Basic education", "sortOrder": 3 } ] }
```

- `idPolicy: "preserve"` for the tables code references by id: `roles`, `designation_master` (the eight seeded rows), `country_master`, `area_of_focus_master`, `category_master`, `sub_category_master`. The seeder inserts with the explicit id and fails loudly if that id is taken by a different key.
- `idPolicy: "assign"` for the rest (`module_master`, `module_categories`, `goal_categories`, `goal_fields`, `trf_fund_master`, OCV document types, zonal awards questions), matched by business key.
- Foreign keys between seed tables are expressed by key (`areaOfFocusCode`), resolved at load.

**Taxonomy codes.** `area_of_focus_master`, `category_master` and `sub_category_master` gain a `code VARCHAR(80)` column, unique within parent, filled from a slug of the current name. This gives them a stable key for seeds and for `master_translation`.

**Seeder.** `MasterDataSeeder.ApplyAsync()` runs in the deploy job, after schema migration. It upserts, never deletes (a row absent from the file is reported, not removed), and records a checksum per file in `seed_history` so an unchanged file is skipped.

**Read-only in ROW.** The master-data screens are hidden by the feature flag `masters.editable` (true by default). This replaces the Interchange API of the earlier proposal: both instances load the same files from the same release, so they cannot diverge.

**Reducing the id dependence over time.** New code must not add id literals. `RoleIds.Admin` style constants replace the 134 literals as files are touched; the awards calculators switch from ids to codes once the `code` columns exist. Neither is required for launch because ids are preserved.

### Steps

1. Add `code` columns and fill them (1 day).
2. Export production masters to seed files with a script; review the diff of what production holds versus what the code seeds (2 days).
3. `MasterDataSeeder`, `seed_history`, deploy hook (3 days).
4. Apply to an empty database and compare with production row for row (1 day).

### RIZones safety

On RIZones the first run must be a no-op: the files were exported from it. The seeder has a dry-run mode that prints intended changes; the deploy script runs it in dry-run first and stops if RIZones would change.

### Done when

An empty database initialised and seeded from the repository has identical ids, keys and names to production for every preserved table, and the zonal awards calculator produces the same result on a copied district as it does on production.

### Effort

1.5 engineer-weeks. Owner: BW1.

---

## WS6. Providers

### 6.1 Payments

**Today.**

- There is no gateway class for Cashfree order calls. `MembershipDuesService` and `EventPaymentLinkService` each build the HTTP requests themselves (create at `:2861` and `:1506`, verify at `:2925` and `:1555`, settlements at `:3793` and `:2039`).
- Razorpay is used by district dues (with Route transfers), wallet top-ups and website billing. One webhook URL is registered (`WalletController.cs:96`) and dispatches to the other flows by table lookup (`:275`).
- `"INR"` is hard-coded at order creation in every flow. GST is 18 percent from `Razorpay:GstPercent`, computed in three places.
- There are no gateway refunds; `RevertMemberFeePaymentAsync` only edits the database.
- **Cashfree webhooks are not signature-checked** and the event-payment webhook looks up the wrong id (section 14).

**Design.**

```csharp
public interface IPaymentGateway
{
    string Code { get; }                                   // "cashfree" | "razorpay" | "stripe" | "paypal"
    GatewayCapabilities Capabilities { get; }              // Splits, Refunds, Settlements, HostedCheckout
    Task<CheckoutSession> CreateCheckoutAsync(CheckoutRequest request, CancellationToken ct);
    Task<PaymentStatus> GetStatusAsync(GatewayAccount account, string gatewayOrderId, CancellationToken ct);
    WebhookEvent ParseAndVerifyWebhook(GatewayAccount account, string rawBody, IHeaderDictionary headers);   // throws if the signature is invalid
    Task<RefundResult> RefundAsync(GatewayAccount account, string gatewayPaymentId, Money amount, CancellationToken ct);
}

public sealed record CheckoutRequest(
    string MerchantOrderId,            // ours, prefixed by flow: DUES-, EVT-, CDUES-, WAL-, WEB-
    Money Amount, Money? Tax,
    PayerInfo Payer, string ReturnUrl,
    GatewayAccount Account,            // whose credentials: platform or a district/club
    IReadOnlyList<Split>? Splits);     // null when Capabilities.Splits is false
```

- **Flows stay where they are.** `MembershipDuesService`, `EventPaymentLinkService`, `ClubDuesService`, `WalletService` and `WebsiteBillingService` keep their business logic and tables. Only their gateway calls (about 17 sites) go through `IPaymentGateway`, resolved by `IPaymentGatewayResolver.For(flow, districtId)`, which reads `BrandOptions.Providers.Payments` and the district's connected account.
- **One webhook entry point per gateway**: `POST /api/public/payments/webhook/{gateway}/{accountRef?}`. It verifies the signature, then routes by the `MerchantOrderId` prefix to the owning flow's existing handler. The existing URLs remain as aliases.
- **Accounts.** New table `payment_gateway_accounts (pk, owner_type ENUM('platform','district','club'), owner_id, gateway, display_name, credentials_encrypted, webhook_secret_encrypted, currency, is_active, verified_at)`. Secrets are encrypted with ASP.NET Data Protection, the same mechanism `ClubRotaryOrgCredentialService` uses. The "Connect payments" admin screen writes here and verifies with a harmless API call (Stripe: retrieve account; PayPal: obtain a token).
- **Tax.** `BrandOptions.Providers.TaxRules`: a list of `{ country, ratePercent, label, inclusive }`. RIZones default is one rule, India 18 percent "GST". ROW ships with an empty list (no tax) until a district supplies one. The three GST computations call `ITaxRules.For(districtCountry)`.
- **Currency.** Order currency comes from the dues campaign or the district, through `Money`. Minor units from the exponent table of WS3.
- **Platform fee.** ROW takes no split, so Kaizen invoices from its own record: table `platform_fee_ledger (pk, instance, district_id, flow, merchant_order_id, gateway, gross_amount, currency, gateway_fee, fee_percent, fee_amount, paid_at)`, written when a payment is confirmed.
- **Stripe adapter.** Checkout Sessions in `payment` mode, `metadata.merchantOrderId`, webhook `checkout.session.completed` verified with the account's signing secret. Refunds through the Refunds API.
- **PayPal adapter.** Orders v2 (create, approve redirect, capture), webhook `PAYMENT.CAPTURE.COMPLETED` verified through the verify-signature API.
- **Coverage check.** Stripe does not onboard accounts in most African countries and several in South-East Asia and Latin America; PayPal's coverage for receiving is wider but uneven. The Connect-payments screen shows which gateway is available for the district's country from a small table, and a district with neither is told so before a dues campaign is created.

**Steps.**

1. Fix the two production defects of section 14 inside the existing code (2 days). This ships to RIZones first, alone.
2. Extract `CashfreeGateway` and `RazorpayGateway` behind the interface with no behaviour change; flows call the interface (1.5 weeks).
3. Webhook entry point and router; old URLs aliased (3 days).
4. `payment_gateway_accounts`, Connect-payments screen, tax rules, `Money` at order creation (1 week).
5. Stripe adapter, then PayPal adapter (1.5 weeks).
6. Platform fee ledger and its report (2 days).

**RIZones safety.** Step 2 is a refactor with a characterisation test: for each flow, the HTTP request sent to the gateway sandbox before and after the change is captured and compared byte for byte (ignoring timestamps and idempotency keys). RIZones has no `payment_gateway_accounts` rows, so the resolver returns the platform account and the configured Indian gateways.

**Done when.** A live-mode payment, webhook confirmation and refund complete on a district's own Stripe account in USD, EUR and JPY; the same for PayPal in USD; a forged webhook is rejected with 400 on every gateway; RIZones dues, event, district-dues, wallet and website payments pass their characterisation tests.

**Effort.** 5.5 engineer-weeks. Owner: BW2.

### 6.2 WhatsApp and SMS

**Today.** `InteraktService` is called from 12 sites in 10 files. It assumes `+91` (`:61, :68-70, :106`) and stamps every send with `callbackData = "membership_dues_reminder"`. About 40 template names are literals spread across services, `WhatsAppScheduledSendBackgroundService.cs:34-87` and `WhatsAppCommsTemplates.cs:28-38`. Template bodies exist only at Interakt. A pilot gate is a code constant (`WhatsAppPilot.cs`, club 2765, district 2). SMS has one method and six callers.

**Design.**

```csharp
public interface IWhatsAppSender
{
    Task<WhatsAppSendOutcome> SendAsync(WhatsAppMessage message, CancellationToken ct);
}
public sealed record WhatsAppMessage(
    string TemplateKey,                 // logical: "dues.reminder.withBank", "announcement.club", "otp"
    string ToE164, string Language,
    IReadOnlyList<string> Body, IReadOnlyList<string>? Header = null, IReadOnlyList<string>? Buttons = null,
    int? ClubId = null, int? DistrictId = null, string? Purpose = null);
```

- **Template registry.** Table `whatsapp_templates (template_key, language, provider, provider_template_name, body_param_count, header_type, button_param_count, max_body_chars, is_approved)`, seeded from a file. Senders look up by `(template_key, language)` and fall back to English. The 40 literals become keys; the body-length budgets now in `WhatsAppCommsTemplates.cs` become `max_body_chars`.
- **Adapters.** `InteraktWhatsAppSender` wraps today's HTTP call unchanged. `MetaCloudWhatsAppSender` calls the Graph API `/{phone-number-id}/messages` with the same logical message. The delivery-status webhook gets a sibling endpoint for Meta's format writing to the same `whatsapp_log`.
- **Phone numbers.** The interface takes E.164. Callers obtain it from `IPhoneNumbers.ToE164(number, countryId)` (libphonenumber), which replaces the `+91` and last-ten-digits logic in `InteraktService`, `RazorpayRouteService:213`, `InteraktWebhookController:101` and `PphCampService:502`.
- **OTP policy.** `BrandOptions.Providers.OtpPolicy`: an ordered list of channels per country group, for example RIZones `{ "IN": ["sms"], "*": ["email","whatsapp"] }` (today's rule) and ROW `{ "*": ["email","whatsapp","sms"] }`. `OtpWhatsAppHelper` reads it instead of `IndiaCountryId = 1`.
- **SMS.** `ISmsSender.SendAsync(toE164, templateKey, language, args)`; `DltSmsSender` keeps the existing text and ids; `TwilioSmsSender` for ROW.
- **Pilot gate.** `WhatsAppPilot` reads club and district ids from `BrandOptions.Scope`.

**Lead times to start in week one.** Meta business verification; template submissions (four launch templates in each language as it is reviewed); United States carrier registration for application-to-person SMS, which takes one to three weeks and without which US numbers cannot receive Twilio messages.

**Done when.** OTP and the four launch templates reach test numbers in the United States, the United Kingdom, Brazil and Japan through the Cloud API in the recipient's language; RIZones sends still go through Interakt and DLT with identical payloads (captured and compared as for payments).

**Effort.** 3 engineer-weeks. Owner: BW2.

### 6.3 Email branding and domains

Covered by WS1 (domains, CORS, parent-domain resolver) and WS2.4 (header, footer, sender, templates).
One addition: Plesk. `PleskService` is already fully configuration-driven with one parent domain and
one server per deployment, which is exactly what a second instance needs; ROW gets its own
`PleskSettings`. The wildcard certificate for the ROW parent domain is a Cloudflare origin
certificate installed in Plesk, because Plesk cannot complete a DNS challenge for a zone Cloudflare
hosts without an integration.

---

## WS7. Privacy: export, erasure, consent

### Today

Personal data sits in roughly fifty tables. The important structural facts:

- The profile, addresses, family, credentials, club memberships and roles hang off `fk_member_master_profile_id`.
- District committee tables store a **copy** of name, email, mobile and photo.
- `email_log` holds recipient address and full HTML body with **no member key**. Seven push-log tables hold device tokens.
- The Rotary.org cache tables hold names keyed by Rotary member id.
- `audit_log`, `login_audit_logs` and `member_change_log` hold names, IP addresses and old and new field values.
- `assistant_turns` holds the member's questions.

**Erasure does not survive the nightly sync.** `ClubMemberSweepWorker.AddMemberAsync` (`:1755`) matches on Rotary id regardless of `isdeleted` (`:1822-1826`), then sets `isdeleted = 0`, refills email, mobile and date of birth from Rotary.org (`:2041-2063`), and un-deletes addresses, family, club membership and roles. If the row was hard-deleted it inserts a fresh profile. There is no suppression list.

### Design

**A. Personal-data registry.** A single code file `PersonalDataMap.cs` listing each table, its member key (or the matching rule when there is none, such as `email_log.recipient_email`), its personal columns, and the erasure action for each column (`null`, `anonymise`, `delete row`, `keep`). Export and erasure are both driven from this list, so adding a table with personal data means adding one entry. A startup check compares the registry against `information_schema` for columns named like `%email%`, `%mobile%`, `%phone%`, `%name%`, `%birth%` that are not listed, and logs them.

**B. Export.** `POST /api/privacy/members/{id}/export` (District Admin or SuperAdmin): walks the registry, produces a ZIP with one JSON and one CSV per table, stores it for seven days, and writes an audit row. Runs as a background job because it touches fifty tables.

**C. Erasure.** `POST /api/privacy/members/{id}/erase` with a reason:

1. In one transaction, apply each registry action. Profile: name becomes "Erased member", email, mobiles, birth and anniversary dates, blood group, photos, social links and device tokens are nulled; `RotaryId` is kept only as a salted hash in the tombstone (below) and nulled on the profile. Family and address rows are deleted. Copies in district committee tables are overwritten. Logs with bodies (`email_log`, `whatsapp_log`, push logs) have recipient and body replaced. Aggregate records (payments, attendance counts, project authorship) keep their rows with the anonymised member.
2. Write a tombstone: `member_erasure_tombstone (rotary_id_hash CHAR(64) PRIMARY KEY, erased_at_utc, erased_by, reason)`.
3. Purge the Rotary.org cache rows for that Rotary id and the member's assistant turns.
4. Audit row.

**D. Making it survive the sync.** Three small changes in the worker:

- `AddMemberAsync` computes the hash of the incoming Rotary id and returns early if a tombstone exists (before the profile fetch at `:1781`, which also saves an API call).
- The UPDATE path (`:1535`) and `--member-sync` (`MemberSyncWorker.cs:119`) skip tombstoned ids.
- The cache refresh skips them.

The member remains on the club's roster at Rotary.org, so the club's *count* in ROW would be one lower than Rotary.org's. The club page shows "N members (1 not shown at their request)" from a count of tombstones per club, which is the only non-personal fact retained.

**E. Consent.** Members are created by the sync and never sign up, so consent cannot be taken at signup. Instead: at first login after the policy version changes, a blocking screen records acceptance in `member_consents (member_id, policy_version, accepted_at_utc, language, ip)`. Marketing-type messages (greetings, announcements by WhatsApp) check for it; transactional ones (OTP, receipts) do not. A member who has never logged in has no consent and receives transactional messages only. The legal basis for holding synced members who never log in is a question for counsel (section 15); the design does not depend on the answer, because the `consent.requiredFor` list is configuration.

**F. Feature flags for sensitive fields.** `member.bloodGroup` and `member.familyDetails` default to `false` when `InstanceCode` is not `RIZ`. Blood group is health data; it is referenced in 22 API files and 23 frontend files, and those reads go through `Brand.Feature`.

### RIZones safety

Privacy endpoints are behind `privacy.enabled`, off for RIZones. The tombstone check in the worker is a lookup in an empty table.

### Done when

On ROW staging: a member is erased; the next member sweep runs; the member is not recreated and no personal field is repopulated; the export produced before erasure contains rows from every registry table that had data; the audit log shows both actions.

### Effort

3.5 engineer-weeks. Owner: BW1.

---

## WS8. Rotary.org sync at ROW scale

### Today, measured

| Job | Schedule | Measured duration for 4,187 synced clubs |
|---|---|---|
| Member sweep | nightly, starts 04:00 IST | 78 to 103 minutes |
| Board of directors sync | weekly | **18.4 to 19.0 hours per run**, finishing about 22:30 IST |
| Club reconcile, delta, repair, country sync | nightly | under 3 minutes each |

Why the sweep costs what it does: clubs are processed **sequentially**, and for each club it processes the worker makes three list calls plus **one profile call for every member of that club**, whether or not anything changed (`UpdateMemberAsync` is called for every listed member at `:1298` and always fetches the profile at `:1535`; new members fetch at `:1781`).

Two things are not known from the log and must be measured before the redesign is sized (step 2 below): the full sweep and the daily-delta mode both write the same `SyncType`, and there is no per-club or per-call count. The 78 to 103 minute runs report 2,700 to 3,700 updated members, which suggests they are the delta mode working through the clubs that changed recently, not all 4,187. A true full sweep would make about 180,000 profile calls for 174,000 members, which is why it is not run nightly.

ROW's regions hold about 22,000 clubs in the reference data (North America 8,122, Europe's seven largest countries 5,268, East and South-East Asia 4,293, Latin America's five largest 3,467, Africa's six largest 928). If the proportion of changed clubs is similar, the nightly run scales to about eight hours and the board sync to about four days, on a server with no quiet night, because ROW's users are awake in every zone.

Other facts: scope is decided only by `club_master.IsSyncedFromRotaryOrg = 1`; there is no zone filter in the sweep. Exempt districts `5656`, `1280` and `IFRM India` are literals in five files. Country lists (India, Sri Lanka, Nepal) are literals in four. `rotary_org_sync_log` has no per-club timing.

### Design

**A. Scope from configuration.** `BrandOptions.Scope` supplies `Zones`, `Countries`, `ExemptDistricts` and `PulledZoneNames`. The five literal sites read it. Each instance has its own `RotaryOrgApi` credentials section.

**B. Stop fetching unchanged profiles.** The list endpoints return members with a last-updated stamp, and `/individuals/updates` reports changed individuals for a window (the existing `--member-sync` mode uses it). The sweep becomes:

1. List calls per club (unchanged): active, honorary, terminated.
2. Diff the lists against the database for adds and removals (unchanged).
3. Fetch a full profile **only** for members that are new, or whose id appears in the `/individuals/updates` window since the club's last successful sweep, or whose stored `RotaryLastUpdated` is older than the listed value.

A new column `member_master_profile.RotaryLastUpdatedUtc` records what was last seen. On a normal night this removes more than ninety percent of profile calls.

**C. Rolling full verification.** A full sweep that re-fetches every profile runs for one seventh of the clubs each night (`club_id % 7 == dayOfWeek`), so every club is fully verified weekly without a single long run.

**D. Bounded parallelism.** Clubs run with a configurable degree of parallelism (start at 4), behind the rate-limit handling that already exists in `RotaryOrgApiClient.cs:214-225`. The per-member database writes are already per-club, so clubs do not contend.

**E. Board sync.** The nineteen hours come from walking every club's officers from charter year to current plus two. Change: the nightly run covers the current and next Rotary year only; the full history runs once when a club is first synced, and on demand. Expected nightly duration drops to minutes.

**F. Windows by region.** Each instance's heavy jobs are scheduled per zone group in that group's night, and the ROW and RIZones windows are declared in one file (`tools/schedule.json`) that the deploy script turns into Task Scheduler entries. The file makes overlaps visible; a check fails the deploy if two heavy jobs overlap.

**G. Measurement.** `rotary_org_sync_club_log (run_id, club_id, started_utc, ms, api_calls, profiles_fetched, inserted, updated, removed, error)` so that capacity is known per club rather than estimated.

**H. Capacity plan for the shared server.** MySQL's buffer pool is already configured at 16 GB, the database is 2.7 GB on disk, and peak connections reached 925 of 5,000. A second MySQL instance needs its own buffer pool. Actions: read the server's installed memory; give the ROW instance 4 GB to start; cap ROW application pools' private memory; record CPU, memory and disk latency for a week before the pilot and during it. Gate B's capacity line is judged on these numbers, for the zones in the first launch wave only.

### Steps

1. Scope from configuration (2 days).
2. Per-club log table and timing (1 day). Deploy to RIZones and collect a week of data.
3. `RotaryLastUpdatedUtc` and conditional profile fetch, behind flag `sync.conditionalProfiles` (1 week). Turn on for RIZones for a tenth of clubs, compare results with the full sweep for a week, then all.
4. Rolling verification, parallelism (3 days).
5. Board sync windowing (3 days).
6. Schedule file and overlap check (2 days).

### RIZones safety

Conditional fetching is compared against the existing full sweep on the same clubs before it replaces it: for the sample, both run, and any difference in the resulting rows is reported. The flag stays off until a week of identical results.

### Done when

RIZones' nightly sweep completes in under 25 minutes and its board sync in under 30, with row-for-row agreement against a full run; a ROW pilot district syncs without any write to the RIZones database; per-club timings are in the log.

### Effort

3.5 engineer-weeks. Owner: F1. This workstream also pays for itself on RIZones: it removes a job that currently runs through the entire Indian working day once a week.

---

## WS9. Visual brand

### Today

Admin screens use shadcn tokens as CSS variables (6,625 uses), which can be swapped at runtime. But brand colour is mostly literal: `#1E3A5F` appears 627 times, other hex literals bring the total to 1,290 in 140 files, and `*-blue-*` Tailwind classes appear 2,334 times in 292 files. The public site has its own hard-coded palette. Club websites already theme by CSS variables per `data-theme`.

### Design

**Do not recolour for launch.** Both products are Rotary products and Rotary's brand colours (royal blue and gold) are mandated by Rotary International for both. What distinguishes ROW is its name, logo lockup, domain, contact details and legal pages, all delivered by WS1. A recolour would be a codemod across 292 files for a difference Rotary's brand rules do not ask for.

What is in scope:

- Logo and favicon from `useBrand()` in the seven components that reference image files directly (`AppHeader.tsx:126`, `login/page.tsx:142`, `RotaryLoader.tsx:23`, `RouteLoadingIndicator.tsx:75`, `site/Logo.tsx:28`, `site/SiteHeader.tsx:24`, `FooterBottomBar.tsx`).
- Page metadata (`app/layout.tsx:15-18`, `(site)/layout.tsx:26-28`) generated from the brand.
- The brand line in every Excel export (`utils/csvExport.ts:218, 422`).
- A lint rule forbidding new hex literals in scope files, so a future recolour stays possible.

If the product owners do want a distinct ROW colour, it is a separate, later piece of work: map `#1E3A5F` and its four siblings to two new tokens by codemod, about one engineer-week plus visual review.

### Effort

0.5 engineer-weeks. Owner: F2.

---

## WS10. Order of work and release train

### Dependencies

```
WS0 safety net ──► everything
WS1 brand config ──► WS2 (brand name variable), WS6 (providers), WS8 (scope), WS9
WS5 seeds ──► WS2.6 (translation keys need taxonomy codes)
WS3 locale ──┐
WS4 time  ───┴─► share the district context; extraction passes of WS2 touch the same files
WS6.1 step 1 (payment defects) ──► ships first, alone, to RIZones
WS7 privacy ──► needs WS8 step 1 (worker reads configuration) for the tombstone check
```

### What reaches RIZones, and when

Every item below ships to RIZones in a normal weekly release, behind India defaults, before ROW uses it.

| Week of | Ships to RIZones |
|---|---|
| 5 Oct | Health endpoint, request stats, smoke suite running against production; payment webhook defects fixed |
| 12 Oct | `BrandOptions` with no `Brand` section; URL and domain helpers; per-club sync log; taxonomy codes |
| 19 Oct | Gateway interface (refactor only); WhatsApp sender interface (refactor only); `format.ts` with old helpers delegating; first extraction directories |
| 26 Oct | `ILocalSchedule` for background jobs; seed files and seeder (no-op); error codes; header and footer as properties |
| 2 Nov | Conditional profile fetch on a tenth of clubs; more extraction directories |
| 9 Nov | Board sync windowing; remaining pilot-surface extraction |

ROW-only pieces (Stripe, PayPal, Cloud API, Twilio, privacy endpoints, offset emission, additional languages) merge to the same branch behind flags that RIZones does not set.

---

## 13. Effort against the calendar

| Workstream | Engineer-weeks |
|---|---|
| WS0 Safety net and release | 1.5 |
| WS1 Brand configuration | 2 |
| WS2 Translation | 16.5 |
| WS3 Locale | 3 |
| WS4 Time | 3.5 |
| WS5 Seeds | 1.5 |
| WS6 Payments | 5.5 |
| WS6 Messaging | 3 |
| WS7 Privacy | 3.5 |
| WS8 Sync at scale | 3.5 |
| WS9 Visual brand | 0.5 |
| Server setup, regression, pilot support (from the build guide) | 4 |
| **Total, web and API only** | **48** |
| Flutter app (flavour, translation, locale, store listings) | not measured |

Capacity:

- To the 28 October freeze: four engineers, about 18 working days each, **14.4 engineer-weeks**.
- To a late-January Gate B: about 14 working weeks after holidays, **56 engineer-weeks**, before RIZones feature work and the Flutter app are subtracted.

Three conclusions follow.

1. The 15 November date cannot carry the full scope: the work is more than three times the capacity before the freeze.
2. Late January is achievable only if RIZones feature work is limited to roughly a quarter of the team's time during the period, and the Flutter app's effort fits in the remaining margin. Both need an explicit decision.
3. For a 15 November **pilot** (Gate A), the necessary subset is: WS0, WS1, WS5, the first three extraction steps of WS2 in English plus one pilot language, WS3 and WS4 for the pilot surfaces, WS6.1 with Stripe only, WS6.2 with OTP and two templates, WS8 steps 1 and 2. That is about 20 engineer-weeks: tight against 14.4 but within reach with assisted coding on the mechanical parts and no RIZones feature work for four weeks.

Assisted coding helps most where the work is mechanical and checkable by a test: string extraction, the formatting codemod, URL fallback replacement, characterisation tests. It helps least on the provider adapters, the time boundaries and the sync redesign, where the effort is in understanding and verifying behaviour. A realistic reduction is a third of WS2 and WS3, not of the total.

---

## 14. Defects found in production code

These are independent of ROW. They were found by reading code; the second has not been confirmed against production data.

| # | Defect | Evidence | Consequence | Fix |
|---|---|---|---|---|
| 1 | Cashfree webhooks are accepted without verifying a signature | `PublicMembershipDuesController.cs:143` and `PublicEventPaymentController.cs:104` call the handlers directly; `CashfreeGatewayProxy.VerifyResponseSignature` has zero callers; the PHP relays forward without checking | Anyone who knows the URL and an order id can mark a payment as paid | Verify `x-webhook-signature` (HMAC-SHA256 of timestamp plus raw body with the client secret) in both endpoints; reject on failure. WS6.1 step 1 |
| 2 | The event-payment webhook looks up the wrong identifier | `EventPaymentLinkService.cs:1529` overwrites `CfOrderId` with Cashfree's numeric id; the webhook matches `WHERE CfOrderId = @OrderId` using the merchant order id (`:1632`) | Payments are confirmed only by the return-page verification; a payer who closes the browser early stays unpaid | Store both ids; match on the merchant order id |
| 3 | "Today" is the UTC date in the browser | `new Date().toISOString().slice(0,10)` in 78 places | Before 05:30 IST, default dates are yesterday | WS3 |
| 4 | Two scheduled tasks overlap | `ClubsRepairSync-Nightly` and `ClubReconcile-Nightly` both run at 02:00 although the latter's description says it replaces the former; two weekly tasks still point at the old `rizones4567.org` path | Duplicate work; stale executables may run | Disable the superseded tasks |
| 5 | Secrets in source control | `appsettings.json`, `appsettings.Production.json` (production root database password), worker settings, helper scripts | Anyone with repository access has production credentials | Week-one rotation in the build guide; also purge history |
| 6 | Silent missing glyphs in PDFs | `CheckIfAllTextGlyphsAreAvailable = false` set process-wide | Unsupported characters print as boxes with no error; the rupee sign in the browser PDF is affected today | WS2.5 |
| 7 | No API-side enforcement of module switches | Modules are filtered in menus only | A disabled module's endpoints still answer | Add a filter attribute keyed by module key when a route is next touched |

---

## 15. Decisions and open questions

**Decisions the design assumes; confirm or overturn.**

1. ROW stores instance time on the shared server and converts at three boundaries (WS4), instead of UTC storage.
2. SuperAdmin screens stay in English.
3. No recolour for ROW; identity is name, logo, domain and contacts (WS9).
4. Master data is shared by seed files in the release, not by a runtime sync (WS5).
5. Server responses gain codes; existing messages remain (WS2.3).
6. Admin-authored texts stored in the database are not translated (WS2.4).

**Questions that need an answer from outside engineering.**

1. Which zones are in the first launch wave? WS8's capacity work is judged against them.
2. Pilot districts, their languages and their countries, chosen with payment-gateway coverage in mind.
3. Is Traditional Chinese needed? Taiwan has more clubs in the reference data than Italy.
4. How much of the team's time may RIZones feature work take between now and late January?
5. The size of the Flutter app's translation and locale work.
6. Counsel's view on the lawful basis for holding synced members who never log in, and on whether Rotary International's API terms constrain where member data is stored.
7. The installed memory of the production server, to size the second MySQL instance.
