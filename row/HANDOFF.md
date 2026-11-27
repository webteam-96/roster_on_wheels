# ROW: session handoff (read this first)

Last session: **2026-11-17** (audit fixes, UTC storage, legal pages, translation review; see the 2026-11-17 note
below and `ROW-CHANGES.md`). A new session starts here, then continues with **"Next task"** below without
re-reading whole codebases (use `kb/README.md` and the graphify commands in the root `CLAUDE.md`).

**NEXT (owner, 27 Nov evening): revert the ADMIN design to 24 Nov (`dcfbb8fa`) and keep every feature, following
`docs/plans/2026-11-27-admin-design-revert.md`. The mobile app design stays. Everything up to here is committed and on `main` (`d8220f89`).**

**2026-11-27 (committed, d8220f89): RIZones 21-27 Nov port, new goal flow (Disha off), admin components plan DONE (all "Done when" lines, see ROW-CHANGES), OMS ROW-94 to
ROW-97 and ROW2-1 / ROW2-2 fixed.** Details: `ROW-CHANGES.md` 2026-11-27. Proof: `_local/qa/wave2-2026-11-27/`, `_local/qa/wave3-2026-11-27/`
(39 pages pixel-identical, requests identical before/after the splits), `_local/qa/oms-2026-11-27/`. api.Tests 664 passed, admin vitest
225 passed, tsc 0, all 5 workers build (GreetingsWorker / RotaryOrgSyncWorker / AwardsAutoCalcWorker now link `CountryCurrency.cs`).
- **Open, owner:** deploy API + admin together (package `_local/deploy-2026-11-27/`, README inside); production scripts
  `2026-11-27-attendance-qr.sql`, `2026-11-27-goal-flow.sql` and the pending 23 / 25 Nov ones; production probably runs
  `Database:SkipInit=true`, so new schema now also comes from always-run startup steps (dues columns, RI officer tables). Decide:
  Engagement catch-up of older milestones (ROW-96); upcoming events list defaults to "Published", so a new future event is not
  listed after save; web Edit Years dialog always pre-ticks the current year (app only ticks grantable years).
- **Local test logins:** 2193 / 2194 / 2195 lost their roles on the copy on 25 Nov. Use club admin 2192 (club 1), district admin /
  DG 2058 (district 1), AG 2210, Super Admin 1. Local admin is a production build: `bash _local/qa/admin-tools/rebuild3300.sh`.
- **Agent briefs** for the waves: `_local/qa/briefs/` (the session scratchpad gets cleaned).

Earlier: **26 Nov "continue"** = `docs/plans/2026-11-26-admin-components-finish.md` (now done through wave 3; wave 4 = review, package,
docs). App: wheel removed from all tiles and cards (owner likes the bento grid and the motion: keep them); debug build on
`kaizen_phone` points at `https://test.rosteronwheels.com`.

**2026-11-25, admin fixed layout and shared components, app icon on a light field (not committed):** `ROW-CHANGES.md` (search "fixed layout"),
`website/design.md` 8.9, guard `admin/src/lib/designParts.test.ts`. `_local/deploy-2026-11-25/` is OLDER than this: rebuild the admin before uploading.
Screenshots `_local/qa/admin-layout-2026-11-25/`. Still hand-written: 189 tables, most small text buttons, pages over 1,000 lines.

**2026-11-25, admin look, currencies, simulator lock (not committed):** `ROW-CHANGES.md` 2026-11-25 (two notes) and
`website/design.md` 8.7. Upload package with all sessions' work up to 14:17: `_local/deploy-2026-11-25/` (README.txt inside; api 653 and
admin 209 tests, packaged files started and 14 pages opened). Open, owner decides: website USD prices, Zoom account or a
manual meeting link for training, "Use country currency" on live. Remove the simulator settings before 30 Nov.

**2026-11-25, app member test fixes (not committed, not deployed):** 24 findings fixed in app and API, `ROW-CHANGES.md`
2026-11-25. Deploy the API with the app. Production scripts not run: `2026-11-25-member-modules.sql` (owner OKs the list),
`2026-11-25-app-labels.sql`. The PC restarted at 12:57 and zeroed the git index and 5 files; all restored.

**2026-11-25, app motion and bento grid (not committed):** `ROW-CHANGES.md` 2026-11-25, rules in `website/design.md` 8.8.
Use the kit in `mobile/lib/presentation/widgets/row/`. Open: check on a real Android phone and on iOS.

**2026-11-27, district website hosting (same way as club sites):** every district is `d<district number>.test.rosteronwheels.com`
(e.g. `d5656`), served by the club-site `*.test` wildcard: the club `web.config` sends hosts matching `^d\d+\.` to its
`district/` folder (the 7-theme build). No DNS or Plesk step per district. Production: `district_websites.Subdomain` for
5656 changed `rid5656` -> `d5656` (live by-host answers). Admin Settings > District Websites now uses the club parent
domain and fills `d<number>` when a district is picked; the district website-status link uses the same parent.
Upload (owner): `_local/deploy/club-website/web.config` + `district/` into the `*.test` site. Not yet tested on IIS
(no IIS on this PC): after upload check `http://d5656.test.rosteronwheels.com/`, `/prism/about`, and a club site.

**2026-11-24, OMS ROW-56 to ROW-69, ROW-93 re-check (not deployed):** every ticket re-run in a browser on `row_prod_copy`; follow-up
fixes in `ROW-CHANGES.md` (search "2026-11-24"). Deploy API and admin together (growth cards need both); app needs a build. Open,
owner decides: Credit Management without the Wallet
parts while `modules.wallet` is off, other Save buttons that show only a logo while saving. Subscription prices still unset.

**2026-11-23, district website:** the 7 designed themes now run on ROW data in `row/district-website` (gitignored).
Run: API on :5000 (local DB data dir `_local/rowdb/data`, port 3317), then `cd row/district-website/source && npx vite`,
open `http://localhost:5173/<theme>/?district=1` (5656). Build: `npx vite build --mode <theme> && node scripts/pages.mjs <theme>`.
Checked: 91 pages (7 themes x 13) with no errors and no RIZones text, all 7 builds, admin theme save -> site follows,
api.Tests 625 passed. Open: theme SQL on production (prod DB login from this PC now lacks rights on row_production), IIS hosting. Fonts self-hosted. See ROW-CHANGES 2026-11-23.

**2026-11-23, live QA pass (owner asked; all modules on):** findings, recordings and the run order for fixes are in
`_local/qa/live-2026-11-23/FINDINGS.md`. Tools: `kb/tools/live_qa.py` (recorded page crawl per login, 1440/768/375),
`kb/tools/live_flows.py` (recorded add -> list -> delete on club forms), `kb/tools/schema_catchup.py` (guarded
schema catch-up from the local copy). Production needs `_local/deploy/sql/2026-11-23-full-schema-catchup.sql`
(dues 500s, WordPress documents 500) and the rebuilt api + admin. Super Admin was crawled inside the owner's Chrome
(the extension blocks reading the session token, so it cannot be moved into Playwright).

**2026-11-23, club website hosting fixed (http):** ConnectReseller DNS A `*.test.rosteronwheels.com` -> 163.128.34.90;
Plesk wildcard subdomain `*.test.rosteronwheels.com` serving the club-site build. `http://rctcv.test.rosteronwheels.com`
loads (200, deep links too). Open: wildcard SSL for `*.test` (Let's Encrypt via DNS TXT at ConnectReseller, manual renew
every 90 days, or a bought cert). District site: rebuilt with `VITE_ROW_API=https://test.rosteronwheels.com` (live.ts falls back to it when the
page has no `row-api` meta) + `web.config` (clean URLs -> .html); in `_local/deploy/district-website/`. Host: one named
Plesk subdomain per district (5656 = `rid5656.test.rosteronwheels.com`, its live `district_websites.Subdomain`); named
beats the `*.test` wildcard, same cert + CORS. Not yet uploaded.

**2026-11-23, deploy folder:** `_local/deploy/` rebuilt for `api/` (no appsettings / web.config / wwwroot), `admin/`
(/admin) and new `district-website/` (7 themes + `index.html` + `shared/`); `sql/` holds the 3 pending production scripts
(run in order: competitor-gap catch-up, utf8mb4, district theme). root, club-website, workers unchanged since 20 Nov.
The production scripts are NOT run: this PC's DB login has no rights on `row_production`.

**2026-10-29, club website themes:** the club site's themes are now a port of the RIZones club site's 11 themes
(`E:\websites\Club-Website-reactjs\Club-Website-reactjs`, copy-source only). Plan, how it works and progress:
`docs/plans/2026-10-29-club-themes-rizones-port.md`; proof and open items: `docs/claude/STATUS.md`. Earlier club
and district themes were deleted (archive: `E:\websites\row\_local\archive\theme-archive-2026-10-29\`).

**2026-10-30, test go-live:** IIS, one host `test.rosteronwheels.com` (admin + API under `/api`), production DB.
Guide and IIS config: `row/deploy/iis/README.md`; ready-to-copy builds in `E:\websites\row\_local\deploy\` (not in git);
production backup before the schema update: `E:\websites\row\_local\backups\`.

**2026-11-04, simulated payments:** all five money flows run through one gateway seam with a simulator, so Stripe plugs in
without touching the modules. Read `ROW-CHANGES.md` (2026-11-04). Local test: API with `Payments__Provider=simulated`, then
`python -I kb/tools/payments_simulated_e2e.py <api> 3317 <db>`. Team: district themes are with the owner and a designer;
Events and QR with another developer. Work on the production DB is allowed; do not disturb anything else.

**2026-11-04, localization service:** see `ROW-CHANGES.md`. The hold on translation work is lifted. Provider key still to come. Test:
`python -I kb/tools/localization_e2e.py <api> 3317 <db>` with the settings in its header.

**2026-11-16, subscriptions:** District and Club subscriptions are built behind `Subscriptions:Enforce` (off). Read
`ROW-CHANGES.md` (2026-11-16). Tests: `kb/tools/subscriptions_e2e.py` and `kb/tools/subscriptions_officers_e2e.py`.
Still open: subscription prices and the club website price in USD (owner), the Brevo key on the server, the wildcard
DNS for club sites, turning `Subscriptions:Enforce` on (owner decides
when: it locks every club and district that has no subscription).

**2026-11-17, audit, UTC, translations:** security, backend and frontend audit fixes; all times stored in UTC
(`api/Services/RowDb.cs` sets the session to +00:00, viewer zone from `X-Time-Zone`; migration tool
`database/maintenance/utc_migration.py`, rehearsed, not yet run on production); district time zones written to
production; legal pages in `row/website`; all 7 translations reviewed; split sentences and the project I Agree notices
now translate (app `tool/gen_ui_strings.py`, glossary `database/translations/join_split.py`, web
`components/AgreeText.tsx`). Checks: API 92, admin 147, Flutter 62 tests pass.

## Ground rules (from the user)

- `row/` is the project. `reference/` (RIZones) is copy-source only: never run it or connect to its servers.
- ROW has **no WhatsApp and no SMS**. Communication is in-app (push, feed) and email only.
- Commit and push only when the user asks. Scan every added file for secrets before committing.
- Work solo (no multi-agent), the user's token budget is limited.
- Hosting: IIS for the 2026-10-30 test go-live (row/deploy/iis); keep app config in environment variables.
- Payments: Stripe (Wave 2). Database: MySQL. Separate backend per project.
- Copy RIZones design and code only, never its data, branding or India-only integrations.

## Done on 2026-10-19

| Area | What was done | Where it is recorded |
|---|---|---|
| Admin design | Fellowship design port finished; sidebars made identical on every dashboard (light, ROW logo); "Foundation" renamed "Projects / Events" | `.superpowers/sdd/2026-10-19-fellowship-design-port/progress.md` |
| Mobile conversion | RIZones app converted to ROW (email + password sign-in for all members, ROW branding, money/locale from brand, privacy screens, design tokens) | `docs/superpowers/plans/2026-10-19-mobile-row-conversion.md` + ledger |
| District website | `row/district-website` created as a copy of `club-website` (port 3002); scope still to be defined by the user | memory `district-website.md` |
| Build spec | `document/ROW Build Specification.docx` read; 16 modules planned in waves 0 to 6 | `docs/superpowers/plans/2026-10-19-row-build-spec-plan.md` |
| Wave 1 Task 1 | Immutable audit log (DB triggers) | wave 1 ledger |
| Wave 1 Task 2 | Meeting mode (in person / online / hybrid) on attendance; attendance writes scoped to the club in the URL | wave 1 ledger |
| Wave 1 Task 3 | Cookie consent banner + map consent on club and district websites | wave 1 ledger |
| Wave 1 Task 4 | WhatsApp and SMS removed from API, workers, admin and app; WhatsApp credit grants / purchases refused; mobile OTP endpoints removed | `row/ROW-CHANGES.md` |
| Security fixes | Scope write guard middleware (club/district writes need the right role), auth rate limit, Swagger off outside Development, generic 500s, `111111` OTP bypass removed, mobile JWT 90 days | `row/ROW-CHANGES.md`, wave 1 ledger |

Wave 1 ledger: `.superpowers/sdd/2026-10-19-wave1-foundations/progress.md` (git-ignored, local only).
Plan: `docs/superpowers/plans/2026-10-19-wave1-foundations.md`.

## Done on 2026-10-21

- Wave 1 Task 5, tenant lifecycle and editions (Settings > Tenants, Settings > Editions), e2e
  `kb/tools/tenant_lifecycle_e2e.py`, browser-checked.
- Wave 1 Task 6, string catalogue (Settings > Translations, overrides merged into the admin's messages), e2e
  `kb/tools/i18n_catalogue_e2e.py`, browser-checked.

Details: `row/ROW-CHANGES.md` (2026-10-21) and the wave 1 ledger. Wave 1 Tasks 1 to 6 are all done.

Later on 2026-10-21 (not committed yet when written): go-live security fixes (members API needs sign-in, web
sign-in rate-limited, forwarded headers, no default SuperAdmin password) and module switches from the user's module
sheet (PENDING-WORK §11a; Settings > Features; e2e `kb/tools/feature_gate_e2e.py`).

## Done on 2026-10-23

- Skipped modules (TRACKER section 2) removed completely from API, workers, admin, app, public sites and schema, plus
  project Category / Sub-category (user: Area of Focus only) and the all-zones Performance Report (user: remove).
  Existing databases: `database/maintenance/2026-10-23-drop-removed-modules.sql`, run only with the user's go-ahead
  after deploy + backup.
- 10 new spec modules built (N1-N6, N8-N11; TRACKER section 5), web + API, each behind a FeatureGate flag that is
  OFF. Plans: `docs/superpowers/plans/2026-10-23-*.md`. Details: `ROW-CHANGES.md` (2026-10-23).
- Checks passed: dotnet build (API + 3 workers) 0 errors; admin tsc 0, vitest 103/103, check-design clean; both
  sites tsc 0; e2e on `row_prod_copy`: the 10 new suites, `scope_read_guard`, `feature_gate` (now takes the DB name
  as 3rd argument) all PASS.

## Resume here (stopped 2026-11-18 evening, owner: "we work tomorrow")

**State:** everything below from 18 Nov is LIVE on the test server except the link-preview work and the Madras
removal, and NOTHING from the 18 Nov second round onward is committed (about 100 tracked files + new files).
First job tomorrow: commit + push to `feat/rizones-pull-2026-11-06` once the owner says so (scan for secrets first).

**Done 18 Nov evening (not committed):**
- Live checks after the owner's upload: API healthy, old years 200, translations live, admin/website/legal pages
  200, Brevo sends, `FrontendUrl` now `/admin` (reset link checked), `BackgroundJobs__Enabled=true` on the server:
  first run sent 30 queued test notifications (Thane City View test project to 25 members, ROW Test Club to 5);
  57 event + 16 announcement reminders are queued but ineligible (parent email never sent). Push jobs running.
- Production SQL run: `database/maintenance/2026-11-18-app-new-labels.sql` (14 rows exact, translation version 3).
- Notifications parity vs RIZones: every email/push in RIZones exists in ROW except removed modules.
- Cleanup: `_local` now holds only `server-backup/` (server api web.config of 13 Nov; older than the server, see its
  README), `test-logins/`, `test-accounts.txt`, the district time-zone note, `missing-media-2026-11-18.csv`.
  Build caches deleted. Madras Legacy theme removed from the repo (no-photo image moved to `public/images/noimg.png`;
  an old "Madras" pick shows classic-blue; 12 themes x 3 pages checked).
- Link previews (club sites): `GET api/public/club-website/preview?host=&path=` (Open Graph page, cache varies by
  host+path, only live club hosts, path must be site-relative) + a bot-only redirect rule in
  `club-website/public/web.config` whose `__API_BASE__` is filled at build by `vite.config.js`. Tested locally.
  Needs API + club-site upload and working club hosting.
- Missing media: 4,043 club-site images checked live; 4,021 missing, but 4,006 belong to club 1 (test club), club 0,
  district 0 (do not exist) and district 1 (5656). Only 15 belong to real clubs (Lake Shore 31764, club 31765).
  List: `_local/missing-media-2026-11-18.csv`.

**20 Nov, deploy folder rebuilt:** `_local/deploy/` = `api/` (no appsettings / web.config / local test media), `admin/` (/admin, with `admin-app.web.config`), `root/` (website, with `root-site.web.config`), `club-website/` (static), `workers/`. Built from the working tree (includes uncommitted 19-20 Nov work). Admin + website smoke-tested locally (200); API not run (needs the DB).

**19 Nov, OMS bugs (not committed, not deployed):** ROW-56/57/58/59 fixed (see `ROW-CHANGES.md` 2026-11-19);
ROW-48/49/50/51/54/55 were already done (QA); ROW-3 is a task with no defect. Checks: admin tsc + 147 tests,
API build + 116 tests, flutter analyze 0 errors. Not clicked through in a browser yet. Deploy needs admin + API +
app rebuild; AI suggestions need `Gemini:ApiKey` and emails need the Brevo key in the server's `api\web.config`.

**Club website hosting (still broken):** wildcard DNS `*.rosteronwheels.com` -> 163.128.34.90 works, but no IIS
site answers it; requests fall to the RIZones `rotaryindia.org` default site (500 URL Rewrite error, `*.rotaryindia.org`
certificate). ROW still has RIZones' per-club Plesk provisioning (`PleskService`, `ClubWebsiteActivationService`),
inactive because `PleskSettings` is not set on the server. Recommended instead: one catch-all `*.rosteronwheels.com`
site in Plesk/IIS on the shared club-site folder + one wildcard certificate (no Plesk credentials in the API).

**Background workers:** not running on the server (greeting_send_log missing, Rotary.org sync last 30 Oct, RCC goals
empty). Offer: package the 4 workers + settings templates (secrets blank) + a Task Scheduler script.

**RIZones pull 9-17 Nov (`9658c18b`..`be034332`, 169 files, 33 new): not ported.** New CMR designs A-D + Word V2,
OCV Excel/Word V2, Club/District Goals + Goal Overview + scorecard, RCC & District Goals report, dues drafts and
currency flags, wallet deduct/tally, download progress, Excel real numbers. Zonal Awards part does not apply.
RIZones Flutter app: nothing new since 24 Sep.

**Orphan/test media rows (club 0/1, district 0/1): KEEP** (owner, 2026-11-19: the tester is testing the system with
them). Do not delete; ask again only after testing ends.

**Next (in order, owner decides):** commit; admin sign-in token to httpOnly cookie (asked to start, not begun);
club hosting catch-all + certificate; workers package; port the 9-17 Nov
RIZones items; app device testing (Android here over adb; iOS only via the developer's Mac). App store release is
after the demo.

## Earlier: resume point (stopped 2026-11-17 19:25, owner: "resume tomorrow")

**Done on 17 Nov evening (NOT committed; owner commits only when asked):**
- UTC migration ran on `row_production` (restored from `_local/backups/row_production-2026-11-17-pre-utc-final.sql`
  after a half Workbench import, then migrated once; marker `row_utc_migration` 13:07 UTC). Glossary SQL re-run
  (32,466). API started by owner; health 200. Owner should restart the API once more so the glossary cache reloads.
- QA bugs (OMS, Aditya): #2 dashboard back 404 fixed (`withBase` in HeaderAdminDashboardLink + DashboardSwitcher);
  #4 app BOD non-member current year in 5656 (`board_of_directors_screen.dart`, ROW-51 rule); #1 no email = Brevo
  key not set (not code); #3 ROW Test Club missing = 5656 district admins have AllClubsAccess=0 (owner to decide).
- **Club website replaced** by the owner's Vite app (see ROW-CHANGES "Club website replaced"): RIZones pages /
  URLs / phone removed, Madras club ids emptied, DOMPurify sanitising in `src/lib/http.js`, ROW `.env.production`,
  `public/web.config`, README. Checked: build OK; 13 themes x 13 pages (1440) + 4 pages (375) against prod public API
  read-only: 212/221 ok, the rest = old-year 500 (fixed below), local-origin CORS artefact, HJ /gallery redirect
  (by design). Gate pages /expired and /not-configured OK. Sanitiser tested with attack strings.
- API fix: `IYearTableResolver.ResolveExistingByYearIdAsync` (old Rotary years without year tables returned 500 on
  public meetings / v2/projects / v2/impact); used in the 5 public read controllers. `dotnet test` 92 pass.
- Deploy folder rebuilt: `_local/deploy-2026-11-17/` = `api/` (with the year fix), `admin/`, `root/`,
  `club-website/` (static, upload contents to the club-websites IIS site). No web.config / appsettings / .env in api.

**Next:**
1. Server config (owner): `FrontendUrl` in the server's `api\web.config` must be `https://test.rosteronwheels.com/admin`
   (pay, reset-password, invite links now 404 at the root). Leave `ClubSite__PurgeSecret` unset.
2. Owner uploads `_local/deploy-2026-11-17/api` (year fix) and, when wildcard DNS exists, `club-website/`.
3. Club website open items: link previews (crawler meta endpoint + IIS rule) not built. 18 Nov: support contact
   set, Handloom released and its SQL applied on production 18 Nov (theme_master pk 17); many old event/banner images 404 on the server (files never uploaded, data only).
4. Done 18 Nov: kb rebuilt, committed c66dd0d0, merged origin/main, pushed feat/rizones-pull-2026-11-06. Prod Firebase APNs key uploaded (dev + prod).
5. OMS: update the 4 QA bugs once the owner decides on #3; ROW Sprint 1 move needs a PM account.

**18 Nov afternoon (NOT committed): audit fixes, plan `docs/plans/2026-11-18-audit-fixes.md`.**
- Security: club-website DOMPurify 3.4.18 + axios/follow-redirects patched (attack strings re-tested); admin build-tool
  packages patched (prod deps: 1 build-only high left; vitest critical is dev-only). API uploads now check the image
  signature, not only the extension (`ImageQualityValidator`, 6 tests; `dotnet test` 98 pass).
- OMS: ROW-54 crop dialog Cancel/Save moved top right (shared `ImageCropDialog`, all upload screens); ROW-55 extra
  delete cell removed from the Service Projects list.
- Frontend rules: gate pages + contact email use Figtree / Bricolage (no Inter), glow orb removed; Terms + Privacy in
  all 13 club footers (`shared/FooterLegal.jsx`, `VITE_TermsUrl` / `VITE_PrivacyUrl`, checked in a browser); five new
  themes' loaders are skeletons (`shared/Skeleton.jsx`). Admin "Sparkles" is already a lightbulb (icons.ts:192).
- App: Language screen text; hint + validator messages translated (sign-in screen English); release builds https only
  (debug overlay keeps http to dev hosts); version 1.0.0+132202 (owner to confirm). Back-to-sign-in was fixed 16 Nov
  (router created once), needs a device check. `flutter test` 62 pass, analyze 0 errors.
- Backend: `row/deploy/backup/backup-row-db.ps1` nightly mysqldump (owner installs on the server); the 34 interpolated
  SQL strings reviewed, none take user input. Deploy folder rebuilt (club-website + api, no config, no Firebase key).
- Open: skeletons on the 7 older themes' pages (src/pages, ~12 list pages); demo passwords on production; admin
  shadows / bg-white restyle; token in localStorage; react-router v7 (moderate advisory).

**18 Nov, second round (NOT committed):**
- Packages: admin vitest 5.1.0 (+@types/node 22), quill pinned 2.0.2 (XSS advisory is 2.0.3 only) and now a direct
  dependency; club-website react-router-dom 7.18.5, vite 8.3.8, plugin-react 6. Production deps: admin 1 high, club 0;
  the only remaining advisory is picomatch (every version flagged, build tools only).
- API: global `UploadContentFilter` (all upload endpoints): script/executable types refused, image/PDF/Office content
  must match the extension. 108 tests pass. A HEIC renamed .jpg is now refused (by design).
- Club website: skeletons on the 6 shared older pages and 10 Gold pages; 13 themes x 9 pages = 117/117 in a browser
  (no page errors, skeletons clear, legal links). Admin: `AgreeText` used <p> inside a dialog <p> (hydration error),
  now block spans; 51 stray ", " empty-cell placeholders (old dash sweep) back to "–" in 29 files.
- Checked locally (API + admin on row_prod_copy, member 1's hash reset in the COPY only, login in
  `_local/test-logins/local-superadmin-2026-11-18.txt`): ROW-54 crop dialog buttons top right; ROW-55 one delete
  per row, 9 cells = 9 headers.
- App on the emulator: Back to sign-in fixed (16 Nov); Settings / Helpline now push so Back returns home (they replaced
  the home screen); sign-in screen fully translated (subtitle `Sign in to {app}`). Version 1.0.0 (132202) shows.
  New glossary `ui-labels-32.json` + `database/maintenance/2026-11-18-app-new-labels.sql`: applied to the local copy
  only; the owner runs it on production (Claude's prod write was refused), then recycles the API.
- Audit false alarms: admin `bg-white` is #FCFDFE and every shadow token is `none` (tailwind.config); demo
  `Admin@123` is refused by production since 6 Nov. Not done: admin token to httpOnly cookie (auth change, after launch).
- Upload folder `_local/deploy-2026-11-17/`: admin (standalone, /admin), api, club-website rebuilt; no config/keys.

## Next task (2026-11-17)

1. **UTC window on production**, when the owner says the site is stopped: check no other DB sessions, run
   `python -I database/maintenance/utc_migration.py --apply` on `row_production` (refuses a second run; backup
   `_local/backups/row_production-2026-11-17-pre-utc.sql`), owner uploads `_local/deploy-2026-11-17/` (rebuild it
   first: it predates the translation and I Agree fixes), re-run `database/maintenance/2026-11-12-ui-label-glossary.sql`
   with a UTC session, recycle the API pool, smoke test.
2. Waiting on others: Stripe meeting, subscription prices and the club website USD price, Brevo key, wildcard DNS,
   district website approval; Events + QR is another developer's from Thu 19 Nov.
3. Owner decisions: port the ~20 new RIZones admin pages from the 11-17 pull or not; drop removed-module tables on
   production; when to turn `Subscriptions:Enforce` on; change the demo passwords (repo is public).
4. Releases: app store builds (iOS needs a Mac), admin deploy. Testing: manual module tests (OMS page 9), real sends
   once Brevo is in, load test.

Current status for the owner: `TRACKER.md` (top) and the OMS pages (1 Overview and Status, 4 Work Done, 5 Remaining
Work and Plan, 6 Blocked Items).

### Earlier next task (2026-10-23, done)

Read `row/STATUS-REPORT.md` first (done, to do in order, on hold, blocked, decisions). Order agreed with the owner:
Phase 1b security (HIGH: records fetched by id inside a club's URL are not tied to that club, sub group members,
event payment link writes, credit wallet lookup, raw exception text), then Phase 3 mobile app screens for members,
clubs and districts, then 3b app language switch, then 4 final assurance. Events + QR merge and all club/district
website work (themes per subscription) are ON HOLD until the owner says go. Brand source: `row/website`.
Plan with sizes and timeline: `C:/Users/USER/.claude/plans/encapsulated-finding-lemur.md` (local) and
`docs/superpowers/plans/2026-10-23-round2-and-app.md`.

Parallel lanes (when the owner allows parallel agents): `C:/Users/USER/row-lanes/_base/lanes.sh setup <ids>` makes a
git worktree + DB copy per lane; `integrate.sh <id>` then `resolve.py <id>` merges a lane (per-lane merge base);
`postmerge-check.sh` finds duplicated names; `lanes.sh teardown <ids>` removes junctions first, then worktrees and DBs.

## Still pending after Wave 1

- Wave 2 money (needs a Stripe test account), Wave 3 data in/out (needs RI access and real export files),
  Waves 4 to 6: see the build spec plan.
- Open decision C8 (Kaizen Events) blocks the Wave 4 event items.
- District website: rebuilt 2026-10-21 from the user's example (a live RIZones district site); see ROW-CHANGES.

## Known gaps and flags

- Security (found 2026-10-23, fixed per `STATUS-REPORT.md`): calendars, mass email, translate route, email logs.
  Still to do: rotate the Data Protection key (untracked, but `row/api/App_Data/dp-keys/key-*.xml` is in git
  history); chat hub tokens travel in the query string: strip it from proxy logs.
- Phase 1b finished 2026-10-26 (uncommitted): generic errors in the remaining 112 catch blocks, see
  `ROW-CHANGES.md`.
- Phase 3 app screens done 2026-10-26 (uncommitted), see `ROW-CHANGES.md` and TRACKER section 5; check
  `kb/tools/app_contract_e2e.py`. Next: Phase 3b (app language switch), then Phase 4.

- **`row/mobile` is in git since 2026-10-21** (user decision). Its RIZones-era notes (`WORK_LOG.txt`, `ANALYSIS.md`,
  `.specs/` and others, see `row/mobile/.gitignore`) stay local: they hold RIZones servers and old dev logins.
- Write endpoints with the club or district id outside the URL were reviewed 2026-10-21; READ (GET) access is not
  reviewed yet (see `ROW-CHANGES.md`).
- Behind a proxy, set `ForwardedHeaders__KnownNetworks__0=<proxy CIDR>` or every client shares one rate-limit bucket.
- A fresh database gets a SuperAdmin login only when `Bootstrap__SuperAdminPassword` (12+ characters) is set.
- The repo is public and its history holds old demo logins: rotate any password that was ever committed.
- WhatsApp-named columns left the code and schema 2026-10-23; existing databases keep them until the cleanup
  script runs (user go-ahead).
- Store ids: `com.kaizen.roww` for both iOS and Android (decided 2026-10-28; Firebase project `roww-54213`).
- Push (2026-10-28): Android works end to end. On the emulator (Google APIs image) the app got an FCM token, the API
  stored it, and an announcement push arrived. The config files sit outside git: `mobile/android/app/google-services.json`,
  `mobile/ios/Runner/GoogleService-Info.plist`, and the server key at `api/App_Data/firebase-admin.json` (or
  `Firebase__ServiceAccountAbsolutePath`; the GreetingsWorker uses the same setting). Push jobs run only with
  `BackgroundJobs:Enabled`. Still to do:
  - iOS: the APNs .p8 key uploaded in Firebase Cloud Messaging; on a Mac, the plist added to the Runner target plus
    the Push Notifications and Background Modes (Remote notifications) capabilities.
  Fixed and checked on the emulator on 2026-10-28:
  - Status-bar icon: `res/drawable-*/ic_notification.png`, a white ROW handshake. Set in the manifest and in
    `push_service.dart`, accent `notification_accent` (#17458F).
  - Push time: FirebaseAdmin's `event_time` defaulted to year 1, so Android showed "2032y". The API and the worker
    now set `EventTimestamp = DateTime.UtcNow`.
- 19 analyzer warnings in the app (unused locals such as `grad`) and some admin lint warnings are pre-existing.

## Run locally (dev only)

- MySQL 8.4 on port 3317, root with no password. Use database `row_prod_copy`: a copy of prod `row_production`
  taken 2026-10-22 (connection details in `row/.env`, gitignored). The old demo database `row_local` was
  dropped 2026-10-22; e2e scripts that used its demo logins need accounts from the copy.
  Re-copying prod: `mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces`,
  rewrite ``DEFINER=`Mysql_admin_User`@...`` to ``DEFINER=`root`@`localhost` ``, restore into a database created
  with `utf8mb4_unicode_ci`, then start the API once with `Database__SkipInit=false` to add tables the code has
  but prod lacks. Prod password hashes come with the copy; to log in locally, reset a hash in the copy only.
  Data dir (2026-10-21):
  `E:/websites/row/_local/rowdb/data` (the 2026-10-21 Temp copy is gone; checked 2026-11-23);
  start: `mysqld --datadir=<that dir> --port=3317 --bind-address=127.0.0.1 --mysqlx=OFF --console`.
- API: from `row/api`, set `ASPNETCORE_ENVIRONMENT=Development`, `ConnectionStrings__DefaultConnection` to the
  local database, a random `JwtSettings__Secret`, `Database__SkipInit=true`, then
  `dotnet run --urls http://0.0.0.0:5000`.
- Admin: `row/admin`, `NODE_OPTIONS=--max-old-space-size=6144 npx next dev -p 3300`. Never run `next build` while
  the dev server runs.
- Club website: `row/club-website`, `npx next dev -p 3001`, open `monrovia.localhost:3001`.
- District website: `row/district-website`, `npx next dev -p 3002`, open `d9101.localhost:3002` (demo row in
  `district_websites`).
- App: Flutter at `C:\src\flutter`, Android SDK at `C:\Users\USER\android`, emulator `afc_tablet`:
  `flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:5000`.
- Local test logins (demo data only) are in the `kb/tools/*_e2e.py` scripts; the newer ones read `ROW_E2E_SA_EMAIL`, `ROW_E2E_SA_PASSWORD`, `ROW_E2E_ADMIN_PASSWORD` from the environment. The demo club admin is now
  `samuel.tubman@monrovia.demo` (joseph.weah was erased by an earlier test run).

## Checks to run after changes

- API: `dotnet build`; e2e: `python kb/tools/<name>_e2e.py` for `no_whatsapp`, `scope_write_guard`,
  `meeting_mode`, `mobile_password_login`, `audit_immutable`, `tenant_lifecycle`, `i18n_catalogue`, `feature_gate`, `district_site`, `member_scope` (run them a minute apart: the auth rate limit is
  10 logins per minute per IP). New (args `<api> 3317 <db>`, `ROW_E2E_JWT_SECRET`): `membership_fields`,
  `engagement`, `grants`, `volunteers_speakers` (API with `VolunteerReminders__Enabled=true`),
  `contacts_prospects_growth` (`ROW_E2E_EMAIL_SAFE=1`), `target_dashboard`, `meetings_links_compliance`,
  `communication_upgrades` (see its header: fake Brevo + DNS ports), `websites_multilingual`, `chat`,
  `calendar_scope`, `mass_email_scope`, `read_review_a_l`, `read_review_m_z`, `time_zones`, `planning_mode`,
  `escalation_celebration`, `rebranding`, `security_guards`, `payments_simulated`, `subscriptions`,
  `subscriptions_officers` (the last two: see the script headers for the API settings). All scripts take the same three arguments.
- Admin: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/check-design.mjs`.
- App: `flutter analyze` (errors print as `  error -`), `flutter test`.
- Then `bash kb/rebuild.sh`.
