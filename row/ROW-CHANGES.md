# ROW changes to consider later

The NestJS backend is a faithful port of the RIZones API. These are places
where ROW will probably want different behaviour. They are **not** made yet
unless marked "done"; decide them when the area is worked on.

## Security and privacy

- **Club / district writes are role-checked** (done 2026-10-19). `ScopeWriteGuardMiddleware` refuses (403) any
  write under `api/clubs/{id}` or `api/districts/{id}` unless the caller manages that club/district (SuperAdmin,
  RIDirector, the club's Admin / ClubModerator / AG, a district Admin with all-clubs access, the district's Admin,
  the zone's ZonalCoordinator), and limits RI Director, master-data and mass-email-media writes to their roles.
  Roles come from `member_roles` on every write. E2E: `kb/tools/scope_write_guard_e2e.py`. Not covered: endpoints
  that take the club/district id in the body or query string (they rely on their own checks); review those next.
- **No default SuperAdmin password** (done 2026-10-21). The initializer used to give the bootstrap SuperAdmin
  (`Brand:SuperAdminEmail`) the password `Admin@123` whenever it had no active login. It now reads
  `Bootstrap__SuperAdminPassword` from the environment (12+ characters, marked temporary); unset, it logs a
  warning and creates no login.
- **Web sign-in is rate-limited and proxy-aware** (done 2026-10-21). `api/auth/login`, `forgot-password` and
  `reset-password` had no limit; they now use the `auth` policy (10 a minute per client IP). `UseForwardedHeaders`
  runs first, so the limiter and audit log see the real client: list the proxy networks in
  `ForwardedHeaders__KnownNetworks__0=<CIDR>` (loopback is trusted by default).
- **Module switches** (done 2026-10-21, from the user's module sheet, PENDING-WORK §11a). `Services/FeatureGate.cs`
  lists 11 skipped modules (code kept, API answers 404, admin hides them) and 6 flagged ones (off until a SuperAdmin
  turns them on in Settings > Features; table `platform_features`, no row = off). The admin hides every link to an
  off module and shows "Not available" on its pages (`components/FeatureGate.tsx`); tab-based pages (district and
  club e-governance) drop the tab. So skipped modules leave no stuck data: with moderation skipped no project waits
  for approval, district goal locks read as unlocked, and the direct-beneficiary limit reads as unset. Category
  masters stay readable (project forms use them); only editing is closed. E2E: `kb/tools/feature_gate_e2e.py`.
  Not done: the mobile app still shows these modules (their calls get 404).
- **Swagger only in Development** (or `Swagger:Enabled=true`), and unhandled errors return a generic message
  outside Development (done 2026-10-19).
- **Mobile sign-in is email + password for every member** (done 2026-10-19). RIZones members signed in to the
  app with a mobile-number OTP and only admins had passwords. New `POST api/mobile/auth/login` (same session,
  guards and device record as verify-otp, via the shared `IssueSessionAsync`; generic "Invalid email or password.";
  lockout 5 / 15 min as the web) and `POST api/mobile/auth/forgot-password` (any member; same reset link as the
  web, which now creates the member's first password). Both are rate-limited per IP (`auth` policy, 10 a minute).
  E2E: `kb/tools/mobile_password_login_e2e.py`. The OTP endpoints remain but the app no longer uses them.
- **Members API needs sign-in** (done 2026-10-21). In RIZones `api/members` had no `[Authorize]`: anyone could
  list members, read and overwrite push tokens and upload files. Anonymous calls now get 401.
- Blood group and family details: done behind flags `member.bloodGroup` /
  `member.familyDetails` in the members service (both on by default via
  configuration; ROW defaults them off). Revisit with counsel.
- Mobile "force re-login" never fires (tokens carry no `iat`), as in RIZones.
- **PPH camps store health data** (blood pressure, blood sugar, BMI) of
  non-members, keyed by mobile number, readable by any signed-in user of the
  club or district. Under HIPAA / GDPR / PIPEDA this needs consent records,
  access limits and retention rules, or the feature turned off for ROW.
- Blood group and spouse details are also hidden from the AG reports and the
  district committee group list when the member flags are off.

## Providers

- Email: Brevo (works for ROW; needs ROW sender domain and key).
- Mobile OTP: done - channels follow `Brand.providers.otpPolicy`
  (email + WhatsApp via Meta Cloud API, Twilio SMS fallback) instead of
  RIZones' India SMS / email-elsewhere rule.
- Push notifications (Firebase Cloud Messaging) are not wired: RIZones' Firebase
  project was excluded. Where RIZones sends a push (e.g. project approved), ROW
  skips it until a ROW Firebase project is configured.
- Payments (Cashfree, Razorpay) and WhatsApp (Interakt) still to be ported;
  ROW needs Stripe/PayPal and Meta instead (master plan WS6).

## Data and time

- Stored time is UTC with "Z" on output (RIZones: IST, no offset). Date-only
  values kept in DATETIME columns need DATE_FORMAT on read (done for member
  birthdays/anniversaries and joined date).
- Country defaults: RIZones assumed India (id 1); ROW leaves them empty.
- Zones 4-8 programmes (zonal awards, citation) ported but off by flag; seed
  content removed.

## Ported with gaps

- Schema drift: some columns the API uses exist only in the RIZones production
  database (never created in code). They are added by
  `database/schema-drift.sql` (run by `npm run db:schema`); add more there as
  they turn up. The area of focus / category / sub-category content is also
  production-only and has to be entered by ROW.
- Event T-shirt sizes / food preferences (`api/event-masters`) come with the
  event payment links port.
- Rotary.org live endpoints (club/district dashboards: award status, My Rotary
  refresh) return the RIZones failure shapes (502 / "Failed" job) until the
  Rotary.org client and sync module are ported.
- Currency conversion (`CurrencyRateService`) falls back to a rate of 1 when
  open.er-api.com is unreachable, so mixed-currency totals are summed unconverted.
- Zonal awards auto-scoring keys questions by their sort order and projects by
  RIZones taxonomy ids (area of focus 59, category 129...). ROW's own question
  set and taxonomy need that mapping redone before the zonal awards are used.
- The citation (district awards) and zonal awards modules are ported but are
  Zones 4-8 programmes; recalculation only runs with `modules.citation` on.
- PPH attendee history matches on the last 10 digits of a mobile number (an
  Indian number); international numbers need E.164 matching.

## Behaviour quirks kept from RIZones

- AG / district dashboard amounts named `...Inr` are USD totals (the RIZones
  INR rate constant is 1). Rename to `...Usd` / neutral names when the web is
  wired.
- AG dashboard joins `district_citation_category.pk_category_id`, which does not
  exist; RIZones swallows the error, so per-category citation points are 0.
- District mass emails are stored with `fk_club_id = 0`, so sending them checks
  and deducts email credits on club 0 (always "Insufficient email credits");
  editing a district "All members" email rebuilds recipients from club 0.
  Should use the district credit pool (`deductDistrictWithHistory`).
- The District Admin assignment email's role table never shows the district
  (it reads `fk_district_id` that the query does not select).
- Mass email sender is `Brevo:MassEmailSenderEmail` (RIZones hard-coded its
  own domain); it must be a Brevo-verified sender.
- The district committee sub-group "add as non-member" insert omitted its
  sort order in RIZones (the insert failed); ROW passes the next sort order.
- Password reset token lives 480 minutes; the email says 30.
- **TRF fund settings always 403**: `api/clubs/:clubId/trf/settings/funds` (create/update/delete) checks a `roleName` claim that no token carries, so no one can manage funds through the API (ported as-is from RIZones). Fix: use the `roles` claim (SuperAdmin).
- **CMR submission email suppression**: RIZones skips the submission email whenever the DB host is not localhost. ROW suppresses only when `APP_ENVIRONMENT=Development`, because an IIS production server may use a separate MySQL host.
- **CMR documents**: Word uses `docx`, PDF uses `pdfmake` (Times standard font instead of Georgia). Project cost is shown in the brand currency (RIZones printed ₹). Photos that are not JPEG/PNG (e.g. WebP) are converted with sharp for the PDF and skipped in Word, as in RIZones.
- **Club admin assignment email verification**: before sending, RIZones probes the recipient's mail server over SMTP port 25 (EmailVerifier). Outbound port 25 is commonly blocked on cloud/IIS hosts, so the probe usually ends "inconclusive" (sent anyway, warning logged). Consider dropping the probe and relying on Brevo bounce webhooks.
- **Club website hosting = Plesk (Windows/IIS)**: ported as-is (`PleskSettings:*`). If the ROW IIS servers are not managed by Plesk, provisioning needs an IIS-native provider (appcmd / Microsoft.Web.Administration) behind the same PleskService surface; until configured, activation logs "PleskSkippedNotConfigured" and just marks the site Active.
- **Club website pricing / gateway endpoints** (`pricing/*`, `default-pricing*`, `pricing/route-account`, `pricing/send-reminders`) are NOT ported yet: RIZones built them on Razorpay Route accounts and Indian GST. They come with the ROW payments work (Stripe/PayPal, tax %). Pay-link tokens are ported (`Payments:PayLinkKey`, else the JWT secret).
- **Project count rule 5** (only Zones 4–8, minus three exempt districts in RIZones) is configuration: `ProjectCount:ZoneNames` / `ProjectCount:ExemptDistrictNumbers` (empty = all active zones count).
- Club-website emails: RIZones signed them "Rotary Zones 4–8 Admin Team", listed its staff phones, named Razorpay and priced in ₹ incl. GST; ROW uses the brand name, `Brand.support` contacts, brand currency and "incl. applicable taxes". The activation email CC (a vendor mailbox in RIZones) is `Brand.support.internalCc`.

## Reports (ported 2026-10-09)

- **Daily statistics report** (`api/daily-stats-report/*`, 06:00 email): RIZones scoped every count to its Zones 4–8 and three exempt districts and mailed two staff addresses. ROW uses `Brand:Scope:Zones` / `Brand:Scope:ExemptDistricts` (empty = all zones / none), recipients only from `DailyStatsReport:Recipients` (first = To, rest = CC; none = nothing sent), runs only with `DailyStatsReport:Enabled=true`, at `DailyStatsReport:Hour` in the brand time zone (RIZones: IST).
- **Blood group / family columns** in the SuperAdmin reports hub, club report and district report follow `member.bloodGroup` / `member.familyDetails` (as the AG reports): off = blood group null, blood-group call list and family list empty, `members-full-details` one row per member.
- **Rotaract clubs** are excluded from district reports (RIZones `ClubScopeSql`, added upstream 2026-10-09; `src/services/club-scope.helper.ts`).
- **Club officers from RI** (`district-report/club-officers-ri`) calls Rotary.org live; without `RotaryOrgApi:Username/Password` every club comes back with empty officer columns.
- **Not ported**: `ClubProfileReport` (API-key integration feed for a RIZones partner; PORTING.md §4). `DistrictPerformanceReport` waits for the Goal Setting port (it reads `GoalSettingService`); its RIZones version hard-codes live/test recipients, test districts and a one-off preview date, all of which become configuration.
- Report "Generated"/file-name timestamps use the brand time zone; project links use `FrontendUrl` (else the brand admin origin).

## Goal Setting (ported 2026-10-10)

- **Split pilot**: RIZones hard-coded the target-split pilot to its own club and district ids. ROW reads `GoalSetting:SplitPilot:Enabled` (default true = everyone), `GoalSetting:SplitPilot:ClubIds` / `DistrictIds`. `admin/src/utils/goalSplitPilot.ts` still carries the RIZones ids — fix in the web phase.
- **Excel imports** (Foundation MCR, membership "Comparison to 1 July" / gender / Rotaract / Interact files) are read with exceljs instead of ClosedXML. Rotary.org exports that exceljs cannot open fail with "Failed to read the Excel file: …" — needs a run against real export files.
- **Membership import cut-over** `2026-07-01` is kept as in RIZones.
- Import success messages named RIZones; ROW uses the brand product name.
- **Errors**: every action answers `InvalidOperationException` with 400 `{ message }`; a few RIZones mobile actions only caught `UnauthorizedAccessException`, so the same failure was a 500 there.
- File-name timestamps use the brand time zone (RIZones: server local time); message "now" values are UTC.
- Not ported: dead C# `BuildMultiCategoryExcel` and `BuildRevokeNotifyInfoAsync` (no callers).

## District Performance Report (ported 2026-10-10)

- RIZones hard-coded everything about this report; ROW reads it from settings:
  - schedule on/off `DistrictPerformanceReport:Enabled` (default **off**; RIZones: on), `:Mode` Test/Live (default Test; RIZones: Live), hour `Brand:Scope:DistrictReportSendHour` (7) in the brand time zone (RIZones: IST), live days `Brand:Scope:DistrictReportDaysOfMonth` (1, 16);
  - test recipients `:TestRecipients` (first = To, rest = CC), live CC `:LiveCc`, sample districts `:TestDistricts` (else `Brand:Scope:TestDistrictNumber`), one-off rehearsal `:PreviewDate` (yyyy-MM-dd). RIZones had staff addresses, two sample districts and a 2026-10-06 rehearsal date in code. With no test recipients, "Send test email" answers 400.
  - zones / exempt districts from `Brand:Scope:Zones` / `ExemptDistricts` (empty = all zones / none); excluded clubs = the COG club (`Brand:Scope:CogClubId`), Rotaract clubs, and name patterns in `:ExcludedClubNames` (RIZones excluded clubs named like its own partner programme).
- Money is printed `<currency> 1,234` for every currency (RIZones printed `₹` for INR); numbers use the brand culture instead of en-IN lakh grouping. Districts with no currency fall back to the brand default (RIZones: INR).
- The email footnote names the brand portal (RIZones named its zones), as does the Goal Setting intro line.
- Scheduled-send suppression follows the CMR rule (remote DB **and** `APP_ENVIRONMENT=Development`).
- Run-log `RunDate` and "already ran today" use the brand-time-zone date (RIZones: MySQL `CURDATE()` on an IST server).
- "Goals - Clubs": only the "Club Goal Setting is coming soon" sheet is ported (RIZones' live setting); the per-category split of the clubs workbook comes back with club goals.
- Excel: ClosedXML `CopyTo` / `AdjustToContents` are approximated with exceljs (`copyWorksheet`, width by text length).

## RI Director group (ported 2026-10-10)

- `api/ri-director/*` keeps RIZones' access rule: any signed-in user (no role check). Flag for review.
- Upcoming-event and newsletter images, documents and announcement images use the shared readable-name upload helper (same naming as RIZones). Credit proof files use the shared GUID helper (hyphenated GUID; RIZones used the 32-hex form).
- Credit validity ("today BETWEEN FromDate AND ToDate") uses the brand-time-zone date (RIZones: server date).
- Report "Generated" stamps and file names use the brand time zone.
- **Website training**: times are wall clock in the brand time zone (RIZones: IST), and emails print the zone name instead of "(IST)". The booker confirmation CC is `Training:BookerCc` (RIZones hard-coded a vendor mailbox). Zoom meetings use `Zoom:Timezone`, default the brand zone. The unused C# `Training:Slots` setting is not ported.
- District Governor / International President photo file names use the brand-time-zone clock.

## Mobile group (ported 2026-10-10)

- The mobile dashboard twins share their routes with the web controllers through base classes; only the not-found message and the Rotary.org-only routes differ, as in RIZones.
- **Calendar**: family birthdays/anniversaries and the spouse name follow `member.familyDetails` (off in ROW → empty lists / null), like the other family data. Month defaults use the brand time zone.
- **App versions**: a new version with no URL got RIZones' own App Store link; ROW uses `MobileApp:DefaultUpdateUrl` (else null).
- **Notification feed**: the 30/90-day windows are counted in UTC (RIZones: server IST clock).

## Admin tools and OCV group (ported 2026-10-10)

- **Blood group / family data** follow the brand flags, as elsewhere: Find Rotarian, Global Member Search, the duplicate-member popup (`pair`) and the Live Documents member export return `bloodGroup` null while `member.bloodGroup` is off; the duplicate popup returns empty family lists while `member.familyDetails` is off. The merge **snapshot** still stores everything, so a revert restores the record exactly.
- **WhatsApp log**: `POST backfill` is not ported (it imported RIZones' old provider log files from a server path). The Excel column "Interakt Msg Id" is "Provider Msg Id".
- **SuperAdmin approval OTP** goes by ROW's SMS provider to `SuperAdminApproval:OtpMobile` (E.164) and by email to `:OtpEmail`, the same config keys as RIZones (whose SMS went through its Indian gateway). Welcome / revoked emails are branded.
- **Directory data collection**: contact-person passwords use the same PBKDF2-SHA256 format (`salt:hash`, 100k iterations), so stored RIZones hashes still verify. The public form link is built from `PublicFrontend:BaseUrl`, else `FrontendUrl`, else the brand admin origin (RIZones fell back to its own domain). The reminder WhatsApp uses the template `district_directory_form_incomplete_final` (8 body values) in the brand's default language; it must be approved in ROW's Meta account before reminders go out by WhatsApp.
- **Project classification** keeps the Gemini suggestion (`Gemini:ApiKey`, `Gemini:Model`; 501 when no key), as in RIZones.
- **OCV report**:
  - The Excel subtitle names the brand portal (RIZones named its zones). The Word "Amount" prints `<currency> 1,234.50` in the brand currency (RIZones printed ₹).
  - "Generated" stamps and file names use the brand time zone.
  - PDFs and Office files are not drawn inline in the Word report. They get the labelled entry and download link that RIZones used when rendering failed. See STATUS §8.
- **Public Live Documents** (`api/public/ocv-live-documents`) is on the open-CORS path list, matching RIZones' `[EnableCors("PublicOpen")]`.
- Quirks kept on purpose:
  - OCV document delete does not check that the document belongs to the club in the URL.
  - The upload limit is 20 MB while the message says 10MB.
  - OCV settings check the `roleName` claim.
  - In Live Documents export, `community_service` returns projects from every module, and the hyphenated keys (`vocational-service`, …) match no `module_master.ModuleKey`, so those exports come back empty.
  - Member-duplicate and WebSso support tables are created on first use (`CREATE TABLE IF NOT EXISTS`), as in RIZones.

## Public site group (ported 2026-10-10)

- **Currency**:
  - A project with no stored currency reads as the brand default (RIZones: INR).
  - Club impact and public project-stats totals are converted per stored currency into the district / brand default. RIZones used fixed INR/USD/NPR/LKR buckets; ROW makes one bucket per brand currency.
  - `valueInr` and `totalCost` keep their field names for the client, but hold the brand default currency.
- **Dates**: the public feeds' `yyyy-MM-ddTHH:mm:ss` values keep ROW's UTC "Z" marker. "Today" for the club calendar is the brand time zone (RIZones: server IST).
- **Share links and directory form**:
  - The share-link fallback page, the directory form link and the website-directory parent domain use config / brand values (`PublicFrontend:BaseUrl`, `FrontendUrl`, `Brand:Domains`). RIZones fell back to its own domains.
  - The share card is drawn as SVG + sharp (RIZones: QuestPDF). It has the same layout and colours, and the fonts come from the server's font stack.
- **Directory form**:
  - OTP channels follow `Brand.providers.otpPolicy` (email / WhatsApp, SMS as fallback). RIZones sent SMS in India and email elsewhere. `otpChannel` in the masked step is the first policy channel the member can receive.
  - The admin-contact token key is `AdminProxyToken:SigningKey`, else the JWT secret. RIZones also had a constant dev fallback, which ROW drops.
  - An address with no country takes the member's own country. RIZones used country id 1 (India).
  - A new spouse row always includes `Name` (as ""), so a form without a spouse-name field no longer fails the NOT NULL insert (RIZones bug).
  - The admin-login lockout is per API process, in memory, as in RIZones.
- **Public CORS (any origin)** now also covers `api/public/ocv-live-documents` and `api/public/projects/{id}/share*`, matching RIZones' `[EnableCors("PublicOpen")]`.
- **Not ported (Payments)**: PublicClubWebsite (website purchase by pay link) and ClubWebsitePublic `renew-link`.
- Quirks kept on purpose:
  - The public project page's officers match designations named exactly "President" / "Secretary".
  - District default menus never seed the newsletter sub-menus, because no default menu links to "newsletter".
  - ClubWebsiteTheme is open to any signed-in user.

## Rotary.org group (ported 2026-10-10)

- **Credentials**: Rotary.org access comes from `RotaryOrgApi:*`, as in RIZones. ROW needs its own account (STATUS §8). Without it, calls answer with Rotary.org's error, and the daily /clubs cache refresh does not start (RIZones always ran it).
- **Scope**:
  - The cache refresh runs at 08:00 in the brand time zone (RIZones: India time).
  - Exempt districts come from `Brand:Scope:ExemptDistricts`, and the placeholder zone from `RotaryOrgSync:PlaceholderZoneName` (default "Zone 0"). RIZones hard-coded both.
  - The summary's country breakdown lists `Brand:Scope:Countries` plus "Other Zones" (RIZones: India / Nepal / Sri Lanka).
  - The COG club is `Brand:Scope:CogClubId`.
- **Data from Rotary.org**:
  - States are stored as Rotary.org sends them. RIZones expanded Indian state codes; that India-only map is not ported.
  - New clubs take the brand time zone (RIZones: Asia/Kolkata).
  - A cached club with no country is stored with none (RIZones assumed India).
  - A new member address takes the member's own country (RIZones: country id 1).
  - Youth age uses the brand-time-zone date.
- **Club Rotary.org credentials** are encrypted with AES-256-GCM (`Credentials:EncryptionKey`, else the JWT secret). ASP.NET DataProtection's format cannot be read outside .NET, so credentials saved under RIZones read as "not set", which is the same answer RIZones gave for undecryptable values.
- **Project-sync token** uses the pay-link key (`Payments:PayLinkKey`, else the JWT secret; RIZones: `Razorpay:PayLinkKey`). There is no constant fallback key.
- **Member match**: the `rizonesCount` field is renamed `localCount` (ROW carries no RIZones names). The web port must use the new name.
- **Upstream drift picked up**: the district live terminated fetch now skips Rotaract clubs, as current RIZones does.
- **Not ported**:
  - `api/RotaryThirdParty/get_member_details_For_Sagar_Sangama`, an anonymous partner feed of members' contacts for three RIZones districts.
  - The member-sweep worker program. The launch endpoints still start whatever `RotaryOrgSync:WorkerExePath` points at; with nothing configured they answer 500 "Worker executable is not configured", as in RIZones.

## Testing against the .NET API (2026-10-10)

Both APIs ran side by side on the same scratch database (fixture data, the .NET start-up migrations applied to both), and every route was called on both and the answers compared. The fixes below make ROW answer as ASP.NET does; they are not behaviour changes.

- **Model binding, as ASP.NET does it**:
  - A missing non-nullable string / list query parameter answers 400 "The X field is required." (16 handlers, `requireQuery`).
  - `[FromBody]` actions (the 368 listed in `src/auth/body-params.ts`, generated from the .NET controllers) answer 415 to a body that is not JSON, and 400 "A non-empty request body is required." plus "The {parameter} field is required." to an empty one; nullable bodies accept an empty request.
  - A `[FromBody] List<T>` given a non-array answers 400 "The JSON value could not be converted to …" (`requireArrayBody`).
  - Actions with an `IFormFile` parameter only accept `multipart/form-data` (415 otherwise, before authorisation, as the route constraint does). Uploads the .NET action read from `Request.Form` are marked `@ReadsRequestForm()` and accept any type.
  - A required `IFormFile` that is missing answers 400 "The file field is required." (`requireFile`, 42 upload handlers).
  - Malformed JSON is not matched: ASP.NET quotes the parser's byte position, which Node's parser does not give.
- **Errors**: a MySQL error is reported as `"type": "MySqlException"`; a PPH date that does not parse as `FormatException`.
- **Client IP**: IPv4-mapped addresses lose their `::ffff:` prefix (audit log, login, public directory, Rotary.org sync), as ASP.NET reports them.
- **DTO values from the database**: Dapper's conversions are followed: a DATETIME read into a string property is formatted with the general date pattern ("G"), a boolean read into a string is "True"/"False", and a NULL column leaves the property's initializer (`= ""`) in place.
- **Request defaults**: a TRF contribution without a date is saved with DateTime.MinValue (0001-01-01), as the non-nullable C# property binds; RIZones then fails on the foreign key, not on a NULL date.
- **Mobile dashboards**: the two mobile dashboard controllers declared no constructor and got no services injected (every call failed); fixed.
- **PPH readings**: Name and Mobile number are required, with the [Required] message, as in the DTO.
- **District admin dashboard**: per-club citation rows carry `totalPoints` and skip Rotaract clubs, as current RIZones does.
- **Seed and schema**: the module marketplace URL seeded RIZones' site (now empty), and `club_master.Timezone` defaulted to Asia/Kolkata (now UTC).
- **Quirk kept**: the v1 upcoming-events `years` endpoint queries `upcoming_events.fk_year_id`, which does not exist, so it fails in both (the V2 controller is the working one).
- **Expected differences** that remain: anything carrying the brand (names, logos, links, time zone, currency), the ROW-only endpoints, the daily statistics and District Performance Report test sends (ROW has no built-in recipients, so they stop at "no recipients configured" where RIZones tried to send), and Payments (not ported).

## Background services (2026-10-10)

- **`BackgroundJobs:Enabled`** (default true) now stops the hosted loops, as in RIZones: credit expiry, citation auto-points, zonal awards, scheduled emails, club leadership emails, website reminders, the Rotary-year rollover loop, the Rotary.org cache refresh and the push workers.
- **Rotary-year rollover**: every 6 hours the calendar's Rotary year is added if missing and flagged current. Its first pass runs on every start-up (it stands in for the .NET start-up migration that did the same). "Today" is the brand time zone (RIZones: the server's IST clock).
- **Credit expiry**, **zonal awards auto-calculation** (still behind `ZonalAwards:AutoCalcEnabled`): ported as-is.
- **Club website reminders and auto-expiry**: ported, but without the one-click renewal link until Payments is ported (there is no `/pay` page yet). The email then asks the club to contact the admin team; the WhatsApp reminder, whose template carries the link, is not sent. The template name comes from `WhatsApp:ClubWebsiteReminderTemplate` (RIZones: `Interakt:ClubWebsiteReminderTemplate`).
- **Push notifications**: the Firebase Admin SDK is replaced by the FCM HTTP v1 API (the same per-token sends), signed with the service account. The account file is `Firebase:ServiceAccountAbsolutePath`, else `Firebase:ServiceAccountPath` (default `App_Data/firebase-admin.json`). Without it, due items wait, as in RIZones. The push-log clean-up runs at 04:00 brand time.
- **Scheduled emails**: ported as-is. The email shell shows the brand's logo (`look.logoDarkUrl`, else `look.logoUrl`) and product name (RIZones: its own logo and domain).
- **Not ported**: the scheduled **WhatsApp** sender (see STATUS, open decision 12), the website provisioning service and the two payment reconcilers (Payments).

## Upstream sync (2026-10-10, reference cb3e678)

- **Photo uploads**: every uploaded JPEG / PNG / WEBP is re-saved at most 2560 px, JPEG quality 88 (transparent logos keep their format and are re-saved only when shrunk), as RIZones' global upload filter does. ROW uses sharp instead of SkiaSharp, so the bytes differ slightly (same size and dimensions in testing). BMP uploads are kept as sent (sharp cannot read BMP; RIZones re-encoded them).
- Rotaract clubs hidden, `eff_parent` project grouping, the negative-points check on the club citation form, `route-maintenance` and the mobile foundation goals endpoints: ported as-is (see STATUS 6a).

## Session 3 (2026-10-12)

- **Privacy (ROW-only, `privacy.enabled`):** new `api/privacy/*` and `PUT api/members/me/language` (see STATUS 6b). Not in RIZones.
  - Erasure anonymises instead of deleting where the schema forbids hard deletes (`trg_prevent_hard_delete_*` on member, address, family, club rows): personal columns blanked, row soft-deleted. Rows that record events (payments, attendance, projects) stay, pointing at "Erased member".
  - Export links are signed (HMAC with `Privacy:LinkKey`, else the JWT secret) and expire after 7 days, because the admin opens them with a plain link. Files are kept under `Privacy:ExportRoot` (default `App_Data/privacy-exports`), outside the web root.
  - Tombstone hash = SHA-256(`Brand:Privacy:TombstoneSalt`, else the JWT secret, + Rotary id). The worker must get the same salt from the same environment variables.
  - Announcements, events, newsletters and other broadcast content by email and push go only to members who accepted the current policy (once `Brand:Legal:PolicyVersion` is set). One-time codes and receipts are not affected.
  - The policy pages carry RIZones' Indian texts (DPDPA); ROW needs counsel's texts (Q6). The `/cookies` page lists the storage keys the admin really uses.
- **Rotary-year rollover** also creates the current year's `rotary_projects_*` / `rotary_project_photos_*` tables (RIZones created them on the first save or by a one-off script, so a new database could not list projects).
- **`sync_exception_log.inserted`** (written by the sweep worker, read by the sync-exceptions screen) added to `schema-drift.sql`; RIZones never created it in code.
- **Rotary.org summary key** `rotaryIndia` is `local` (no client read it; same name as in the .NET edition).

## 2026-10-19 — WhatsApp and SMS removed (ROW is in-app + email only)
- API: WhatsApp/SMS services, controllers, log/info endpoints, Twilio/Meta config and the mobile OTP endpoints (incl. the TestAccount OTP path) are gone. WhatsApp credit grants (offline + RI Director), WhatsApp wallet top-ups and pay links, and WhatsApp directory reminders are refused (400). Email recipient estimate moved to `GET /api/recipient-info/{club|district}/{id}`.
- Workers: GreetingsWorker sends email and push only.
- Admin: every WhatsApp toggle, reminder button, log page, credit card, report and badge removed; `/settings/email-whatsapp-credits` renamed `/settings/email-credits`; `WhatsAppRecipientBadge` replaced by email-only `RecipientBadge`.
- Mobile: WhatsApp compose toggles, reminder actions, wallet type, contact buttons (wa.me), social-link type and icon asset removed.
- Kept on purpose: DB columns named after WhatsApp (no destructive migration).
- Test: `python kb/tools/no_whatsapp_e2e.py`.

## 2026-10-21: Tenant lifecycle and editions (Wave 1 Task 5, build spec items 1 and 5)

- Tables `edition_catalogue` (district, club, club_basic, rotaract, zone), `edition_modules` (edition_code,
  module_key), `tenant_subscriptions` (one row per district with `fk_club_id = 0`, plus one per club). In
  `DatabaseInitializer` and `database/schema-drift.sql`; additive only.
- `TenantsController` (SuperAdmin): `GET/PUT api/editions[/{code}]`, `GET api/tenants`, `GET/PUT api/tenants/{districtId}`,
  `POST api/tenants/{districtId}/apply-edition`; `GET api/tenants/{districtId}/state` for any signed-in user.
  Writes also need role 3 in `member_roles` (ScopeWriteGuard RoleOnly list). Every change is audited.
- Saving a district subscription provisions every club (`club_basic`, `rotaract` for `ClubType = 'Rotaract Club'`);
  a club that already has a row keeps its edition.
- Applying editions only flips `district_modules` / `club_modules.IsEnabled`; rows are never deleted.
- `PlanningWriteGuardMiddleware`: while a district is `planning`, writes on routes with `{yearId}` plus `{clubId}` or
  `{districtId}` return 409 for the current year; other years pass. Not covered: endpoints that take the year in the
  body or query.
- Admin: Settings > Tenants (subscription form, apply edition, club editions) and Settings > Editions (module checklist).
- Not built yet: changing a single club's edition (e.g. upgrade to `club`), invoices and billing (Wave 2).
- e2e: `kb/tools/tenant_lifecycle_e2e.py` (20 checks; restores demo module switches and state afterwards).
- Browser check (2026-10-21): Tenants save failed when a date was empty (`""` cannot bind to `DateTime?`); the
  page now sends `null`. Editions and Tenants pages render and save.

## 2026-10-21: String catalogue (Wave 1 Task 6, build spec item 3)

- Table `i18n_strings` (namespace, msg_key, locale, text, reviewed, updated_by, updated_at; unique per
  locale + namespace + key). In `DatabaseInitializer` and `database/schema-drift.sql`.
- `I18nController`: `GET api/i18n/{locale}` (public; ETag + `Cache-Control: no-cache`, so clients revalidate and get
  304). A `max-age` is not used because the global `UseResponseCaching()` would then serve stale text after an edit.
  `PUT` / `DELETE api/i18n/{locale}/{namespace}/{key}` are SuperAdmin only (also role 3 in ScopeWriteGuard), audited.
  Empty text is refused: removing the override is how a string goes back to English.
- Admin: `src/i18n/messages.ts` `applyOverrides` + `fetchOverrides` (3 s timeout, bundled messages if the API is
  down). Order: bundled English + `en` overrides, under bundled locale + locale overrides. Machine-translated locales
  apply their overrides after LiveTranslate. Settings > Translations editor (language, area, missing / not reviewed
  filter, search, save, reviewed, "Use English").
- Not done: the app (ARB) side, listed for the app i18n step. Most admin screens are not extracted to the catalogue
  yet (about 100 keys in 4 namespaces), so the editor covers only extracted strings.
- Tests: `src/i18n/messages.test.ts` (3, RED then GREEN); `kb/tools/i18n_catalogue_e2e.py` (11).

## 2026-10-19: Fellowship design port (admin + mobile)

Plan: `docs/superpowers/plans/2026-10-19-fellowship-design-port.md`. The admin portal and the app now follow the
marketing website's design (`row/website/design.md`) under the FRONTEND-RULES gate:
- Typefaces: Bricolage Grotesque (display) and Figtree (body) replace Inter (admin) and Google Fonts calls (app,
  now bundled TTFs with their OFL licence).
- Colours: Fellowship tokens (cream, ink, azure, marigold for accents only); no pure white surfaces, gradients or
  default drop shadows; separation by 1px line borders. Semantic red / green / amber kept.
- Icons: Lucide replaced by Phosphor through one module (`row/admin/src/components/icons.ts`); the app keeps
  Material Icons.
- App: palette, gold and font pickers removed (old preferences cleared at start-up); `AppColors` is one fixed
  Fellowship palette; `PillButton` and `ToneCard` widgets added.
- All dashboard sidebars look the same (light, ROW logo); "Foundation" renamed "Projects / Events".
- Gate: `node row/admin/scripts/check-design.mjs` (all counts 0 is required).
