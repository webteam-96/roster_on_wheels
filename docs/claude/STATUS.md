# Status

Main project status lives in `row/HANDOFF.md`, `row/STATUS.md` and `row/PENDING-WORK.md`. This file records the
current session's ask and proof only.

## Asked
- 2026-10-29: /flow setup (marker, project memory, CI, ECC rules).
- 2026-10-29: check OMS pages 6, 7, 9, 15, 16, 17 against the code and recorded decisions.

- 2026-10-29: status report from all 17 OMS pages (read in full), cross-checked with code. Given in chat.

- 2026-10-29: plan ~10 district website templates (GSAP motion, 35+ audience abroad, professional). Gate opened by
  the user; preview first, merge later; editor after templates are final.

- 2026-10-29: update OMS pages with the work done.
- 2026-10-29: plan the new ROW design for every admin page and app screen, then design.

- 2026-10-29: plan + build ~10 new club website templates (owner previews them before wiring in). First: show the 8
  existing themes in Chrome.

## Done (with proof)
- 2026-10-29 templates step 1 (shared base) + template 1 Heritage, preview-only (?preview-theme=heritage):
  native scroll (Lenis removed from motion engine), fonts Source Serif 4 / Libre Franklin / Public Sans / IBM Plex
  Sans, preview sample data (lib/sample.ts, lib/sampleRule.ts, public-domain Wikimedia photos in
  lib/samplePhotos.ts), PreviewNotice, themes/common (SiteNav, PageEnter, AvenueFilter, data, pure),
  themes/heritage (all pages + ProjectDetail), PREVIEW_ONLY guard in themes/index.ts, meetingLine expands "Fri".
  Proof: tsc 0 errors; node --test src/lib/*.test.ts 13/13 pass; curl live home has 0 sample strings, preview has
  them; sample project id 990001 returns "Project not found" live; Chrome screenshots desktop + 390px.
- 2026-10-29: 8 existing club themes shown in Chrome at monrovia.localhost:3001 via ?preview-theme=<key> (screenshots
  in session). Found: rotaract = banner layout recoloured; row looks like classic-blue at the top.
- 2026-10-29: local demo row added: row_prod_copy.club_websites pk_id 6 (club 143 Monrovia, subdomain monrovia,
  30-day trial). Local copy only. The table was empty (e2e cleanup), so HANDOFF's monrovia URL did not work.
- WORKFLOW marker at top of CLAUDE.md (head output shown in session).
- ECC rule packs csharp, dart, react, typescript, web copied to `.claude/rules/ecc/` (ls output shown).
- `docs/claude/FACTS.md` created.
- OMS pages read in full; check results given in chat (stale items listed per page, with code evidence).
- Baseline: admin vitest 23 files / 131 tests passed; tsc 0 errors on club-website, district-website, website.

- `.github/workflows/ci.yml` written. Every step run in a clean clone of HEAD f376213: dotnet build x4 0 errors;
  admin npm ci, tsc 0, vitest 131/131; website npm ci, next typegen, tsc 0, lint 0; mobile pub get, analyze 0 errors,
  test 57/57.

- District templates (2026-10-29): plan approved; registry `src/themes` (index, chrome, homeData, fonts, NavLinks,
  Legal), gallery `/themes` (THEME_GALLERY=1), themes ledger + quiet. Proof: tsc exit 0; routes 200; screenshots
  desktop/phone/reduced in scratchpad shots/ and shots2/; figures show 152 / 8 / 32,895 / 3,200 / $146,200.
  Backup: row/district-website.bak-2026-10-29.
- District templates plan written: `docs/plans/2026-10-29-district-website-templates.md` (research + 10 concepts).

- 11 new e2e suites pass 29 Oct on row_prod_copy (ag_credit_balance, anonymise_retention, booth_onboarding,
  bulletin_speakers, district_targets, event_time_zone, message_language, ri_fields, showcase_projects,
  trial_renewal, meeting_mode); showcase extension tests 3/3. trial_renewal failed once on first run, then passed twice.
  server_strings was missing in row_prod_copy; added by starting the API with Database__SkipInit=false.
- OMS pages 1, 2, 3, 4, 6, 7, 8, 9 (relocked), 10, 17 updated 29 Oct; each save checked by reading the page text back.
- Design plan approved to start 29 Oct (answers in FACTS.md). Phase 0 done: docs/plans/row-design-inventory.md
  (473 admin pages: 399 linked, 74 no literal link; 78 v2 pairs, 55 both linked; 212 app screen files).
  Phase 1 started: application-screen spec added as row/website/design.md section 8.

- RIZones v1/v2 duplicates: answered from reference/.../.planning/v1-deletion-list.md (club v1 pages replaced by v2
  in June 2026, pending deletion; named v1 exceptions still used). Written into docs/plans/row-design-inventory.md.
- Sample 1 of 6 built (admin District dashboard): new components/row/AppKit.tsx (PageHeader, Panel, KpiTile,
  MetricBar); DashboardShell + Sidebar restyled; overview page uses the kit. Checked: admin tsc 0, vitest 131/131,
  design check 0, browser screenshot at 1568px with local data (district 5).

- Samples 2 to 6 built (29 Oct). Admin: club Membership page on the kit (table + phone cards, skeleton, error);
  ui Card/Input/Textarea/Select/Label/Tabs restyled (affects every page using them); MemberForm overrides removed;
  DayMonthPicker trigger matches fields. Checked: admin tsc 0, vitest 131/131, design check 0, browser screenshots of
  /club-admin-dashboard/membership and /members/new with local data.
- App: Home header light with full-colour logo (user asked why the white logo was used), tone tiles 2 columns,
  left-aligned display section headings; splash full-colour logo on cream; terms logo on a light plate; members
  list and profile text sizes 9-11px raised to 13px, display titles, pill FABs, flat profile hero.
  Checked: flutter analyze 0 errors on the changed files, flutter test 57/57.
- Local test sign-in for member 84 (row_prod_copy only): password + hash in the session scratchpad, not in git.

- Rollout started 29 Oct (user approved the samples). Global pass done:
  admin: ui Button (no shadows), Table (cream-2 header, padding), Dialog/AlertDialog/Popover 20px,
  Dropdown 12px, Switch; KpiCard (56 files) and SectionHeader (16 files) now render the ROW kit; the 3 v2 frames
  (ClubAdminShell, DistrictAdminShell, GoalOversightShell) restyled like DashboardShell; h1-h3 use the display face
  (globals.css); rounded-2xl = 20px (tailwind.config.ts). Checked: tsc 0, vitest 131/131, design check 0, browser
  screenshot of untouched /clubs/143/announcements/v2 showing the new look.
  app: CustomAppBar (204 uses) now cream with ink display title and hairline; 33 screens had white action text/icons
  or tab labels in the bar, switched to azure/ink (gold button fills to azure). Checked: flutter analyze 0 errors,
  flutter test 57/57. NOT VERIFIED on screen (app sign-in bug, below).

- App sign-in bug fixed 29 Oct. Root cause (API request log): the notification badge polled
  /api/mobile/notifications with no token on the sign-in screen, got 401, and api_client fired onUnauthorized ->
  _clearSession() (async storage wipe) which could finish after the new login saved its session -> blank name, back
  to Sign In. Fix: lib/core/network/api_client.dart only ends the session when the 401 rejected the token the app
  holds now (ApiClient.rejectsCurrentSession). Test: test/core/network/unauthorized_session_test.dart (4 cases, failed
  before, pass after); full app suite 61/61; 3 of 3 clean sign-ins on the emulator reached Home with the name.
- Admin codemod (131 files): off-brand focus rings -> ink focus outline (636), input radius 12px (635), table
  headers without uppercase on cream-2 (61). Login card radius 20px. Checked: tsc 0, design check 0.

- Design rollout, 29 Oct (codemods + manual fixes, scripts kept in the session scratchpad):
  admin: buttons to pills/azure (244 + 27 green actions + 4 gold), panels 20px (136), page spinners to skeletons
  (343), table headers (all), gold active tabs to light pills (10), off-palette fills (171); sign-in pages
  (login, forgot, reset, invite, sso) aligned. app: text >= 13px (858), button pills (91), radii (26), elevation 0,
  skeletons (23), gradients (7), caps labels removed (104 literals, 50 toUpperCase, 79 letterSpacing), 17 app bars
  light, welcome + terms screens rebuilt light, CustomButton pill, Home card/label fixes.
  New check: kb/tools/design_coverage.py -> admin 473/473 and app 212/212 free of the old patterns.
  Checked: admin tsc 0, vitest 131/131, design check 0, lint errors 29 (unchanged); app analyze 0 errors / 21
  warnings (unchanged), flutter test 61/61; screenshots of login flow, home, club dashboard, profile (app) and
  district dashboard, membership, member form, announcements, club-service, attendance, club dashboard, forgot,
  reset, invite (admin).

- Screen check (29 Oct, in progress): kb/tools/design_crawl.py (admin, per role, 1440 + 390 px, screenshots,
  overflow, errors) and integration_test/design_tour_test.dart (app, ~100 routes). Admin done so far: Club Admin
  101 routes (0 flagged), District Admin 53 (2 phone overflows, fixed), AG 1; Super Admin running. Fixes from the
  review: 44 in-table spinners -> skeleton rows, form action bar solid (no blur), all backdrop-blur removed (27),
  Club Report tiles one colour, 2 action rows wrap on phones. App tour: failing twice on harness issues, rerunning.

- Screen check finished 29 Oct. Web (production build, local data): Club Admin 101 pages, District Admin 53, AG 11,
  Super Admin 322 (less 15 public pages, shot signed out), each at 1440 and 390 px -> 0 page errors, 0 error
  screens, 0 pages wider than the screen. App tour: 101 routes -> 0 overflows, 0 errors (club edit crash fixed:
  district and meeting-day dropdown values missing from their lists). Fixed on the way: 16 phone overflows (action
  rows wrap, scrollable tab bars), blur removed, in-table spinners, Club Report colours, India example texts.
  Screenshots: E:/websites/row-design-screenshots/2026-10-29 (web 947 + app 101, README; OUTSIDE the repo, holds
  real member data). Old com.SampleApp.row app removed from the emulator (it showed the old white logo).

- OMS updated 29 Oct evening (pages 1, 2, 3, 5, 15, 16, 17): design work, revised timeline (about 65-105 working
  days left, mostly gated), and that the mobile layout pass is in progress.
- Mobile layout pass, step 1 (user: "too much flaws ... random placements of btns and text"): rules written as
  row/website/design.md 8.6. Applied: left-aligned app bar titles (theme + CustomAppBar + 10 screens), pill FAB
  theme, empty/error states higher and without a duplicate CTA when the screen has a FAB (94 uses), chip rows
  pinned left (4), list bottom room for the FAB (63 lists in 33 files), tab bars on the light theme (16, plus 2
  blue bands), members list rows with a "more" menu, Admin pill moved into the app bar (club + district
  dashboards), module groups one colour (3 dashboards). Checked: analyze 0 errors / 21 warnings, flutter test
  61/61, app tour 101 screens 0 layout errors; before/after screenshots compared.

## NOT DONE or NOT VERIFIED
- 2026-10-29: District templates Ledger + Quiet DECLINED by the user ("ai slop"). Direction to be reset before any more templates. Code stays under row/district-website/src/themes (preview only, default design unchanged).
- Templates 2-10 not built. Heritage awaits owner review (owner sees it before 2 and 3 are built).
- Heritage NOT VERIFIED: jury/axe run, keyboard pass, reduced-motion visual check, Lighthouse, Firefox/Safari.
- `lenis` package still in club-website package.json (no longer imported); remove when old themes are deleted.
- 2026-10-29: owner rejected all 8 themes; 10-template plan written (docs/plans/club-website-templates.md). Not
  approved, nothing built. Old themes NOT deleted yet (plan step 6, after the new ones are live).
- District templates: 2 of 10 built (ledger, quiet); 8 wait for the user's verdict on these two. jury scores and
  axe/contrast checks NOT run yet. `next build` NOT run (dev server running). Lint not run (no ESLint config).
- Preview content is local-only: row_prod_copy rows tagged created_by=990213 + district_websites row d9213, photos in
  git-ignored api/wwwroot. Seed/remove script: scratchpad seed_d9213.py (`--remove`). Several demo projects/events and
  all project numbers are made up; texts paraphrase rotaryd9213.org; photos are that district's (copyright theirs):
  replace before any public demo.
- CI not run on GitHub yet (needs a push; user decides). Linux runner differences NOT VERIFIED. `next build` not in CI.
- Admin lint (29 errors) and flutter warnings (21) are non-blocking in CI (`shortcut:` comments).
- club-website and district-website are git-ignored, so CI cannot check them.
- Build-spec items S1-S14 from f376213: automated e2e pass (29 Oct); manual testing by a person NOT VERIFIED.

- OMS pages 5, 11-16 not changed (page 15/16 still say 470 admin pages; now 473).
- App samples (home, members, profile) NOT VERIFIED on screen: adb text input drops characters, sign-in on the
  emulator failed; the old app com.SampleApp.row is also installed there and shows the OLD design.
- Admin samples not checked at phone width.
- Found, not fixed: member form defaults Country to India; app translates the product name ('Lista sobre ruedas'). ClubAdminShell / DistrictAdminShell (v2 copies of the frame) not restyled yet.
- Which version to keep for the 55 v2 pairs where both are linked: user decides at the live review.
- Production also lacks server_strings and the other 28 Oct tables: catch-up tool coverage NOT VERIFIED.

- Mobile layout pass, step 2 (forms + detail screens, 29 Oct): one outlined field style with the label on the
  border (theme + CustomTextField, 224 uses; club/district dropdowns and time fields converted); primary action
  pinned in a bottom bar (new widgets/row/form_action_bar.dart) on 9 module forms plus Edit Profile and
  Add/Edit Member (Save removed from their top bars); sign-in screens left as approved; detail rows stacked
  label-over-value (shared DetailRow/DetailLinkRow + 5 private rows), section titles sentence case; FAB room on
  4 sliver screens; 11 hard-coded caps labels to sentence case. Checked: analyze 0 errors / 21 warnings, flutter
  test 61/61, app tour 101 screens 0 layout errors, screenshots reviewed.
- 30 Oct, screen-by-screen pass (all 101 app screens + all crawled web pages reviewed on contact sheets):
  app: designed "Page not found" / "Not available" dead ends with back + Go to home (router), greetings duplicate
  Save and left-strip headings removed, district greetings copy, documents empty copy, helpline empty sections
  hidden, comms empty state, website tiles taller, caps removed in drawer/stat/KPI/report widgets, report groups
  sentence case. Web: year pill no wrap, 61 tables scroll at 640px on phone, 94 toolbar fields + 43 buttons 40px,
  search full width on phone, 14 azure tab bands -> light pill tracks, 781 form step badges one colour, icon
  buttons never squash (ui/button), green action buttons -> azure, district report rows stack on phone, floating
  SuperAdmin "Back to Search" hidden on forms/public pages and icon-only on phone, button rows wrap (24),
  orphan /admin/about-us + /admin/contact-us no double header, rotary years dates readable, audit log buttons wrap.
  Checked: app analyze 0 errors/21 warnings, flutter test 61/61; admin tsc 0, vitest 131/131, lint 29 (baseline),
  build ok. Final runs: app tour 101 screens 0 problems; web crawl Club Admin 130, District Admin 94, AG 11,
  Super Admin 321 routes x 2 widths, 0 layout problems after fixing the one flag (role-config 3px overflow,
  re-checked 0px). 98 Super Admin pages log API 404s in the console (SA has no club/district of its own there).
  Screenshots refreshed in E:\websites\row\_local\design-screenshots\2026-10-29\ (outside the repo).
ow-design-screenshots6-10-29\ (outside the repo).
- NOT DONE / NOT VERIFIED: bottom-sheet forms inside app module screens (tour does not open them); SuperAdmin
  viewing club/district-admin dashboards without a selected club/district shows bare "Failed to load" alerts or
  endless skeletons (edge path, not fixed); old v1 duplicate club pages still present (owner decision); Add
  Member country still defaults to India (owner decision); /admin/about-us and /admin/contact-us are unlinked
  copies (owner decision to delete).
- Design: detail pages that need another id (one announcement, one project...) were not opened by the crawls; they use
  the same templates. Visual review by eye covered the contact sheets of app (all), District Admin phone, part of
  Club Admin phone; the rest is covered by the automated checks only. Old /v1 duplicate pages not retired (user OK).
  Found, not fixed (not design): web and app member forms default Country to India.
- Sign-in fix: the 3 emulator runs did not hit the pre-login 401 again (API log shows only the earlier one), so the
  race path itself is proven by the unit test, not by a live repro.

## Open questions
- Plan docs/plans/club-website-templates.md awaits owner approval + 5 questions (brand colours, inner pages,
  smooth scroll, dummy photos, the 10 concepts).
- Plan scope: designs only, or also the parked theme system (docs/superpowers/plans/2026-10-26-website-themes.md)?
- Add an ESLint config to club-website and district-website, or leave lint out of CI for them?

## 2026-10-29: club themes port from RIZones (docs/plans/2026-10-29-club-themes-rizones-port.md)
Asked: same designs/templates as the RIZones club site, 11 themes (no madras-legacy, handloom), ROW branding,
full rewrite to Next.js routes, delete earlier club + district themes.
Done (with proof):
- Old themes archived to E:\websites\row\_local\archive\theme-archive-2026-10-29\ then deleted. District site src restored from
  district-website.bak-2026-10-29 (diff -rq identical; tsc exit 0).
- Foundation: src/site (routes, menus, media, config, ClubContext, YearSelect, ThemeScripts, SitePage, clubApi +
  http + apiCache server-safe), src/themes (assets, registry, shared/{loaders,homeData,rotaryPage,money,
  useRotaryAnim,components/Squares,WorldMapBg}), all content routes go through SitePage, /projects/[id] and
  /project share one projectMetadata (og share card kept). Codemod: kb/tools/port_club_theme.py.
- classic-blue Layout + Home: tsc exit 0; curl / renders data-theme="classic-blue", hero slides, footer; Chrome
  500px and headless 1440px screenshots; no console errors after removing ROW's old motion engine (it split the
  same headings and broke hydration).
- All 11 themes ported (classic-blue, warm-modern, civic-bold, verdigris-ledger, gold + its own 14 pages,
  cinematic, split-story, liquid-motion, horizontal-journey, photo-collage, sunrise) plus 14 shared inner pages
  and a ROW-only Meetings page. Data is loaded on the server (themes/shared/loaders.ts) through the source's own
  API client (site/clubApi.js); views compute from it (no client fetch on first render).
  Proof: tsc exit 0; node --test 12/12; curl of 17 routes x 11 themes via ?preview-theme= all 200 with the right
  data-theme and no server render error; Chrome console clean (no hydration/runtime errors) on 2 pages per theme.
- ogl@1.0.11 added (approved) for liquid-motion. Orphaned ROW components/libs deleted (archived copy kept).
- `next build` (copy on E:): compiled and type-checked, 22 routes; only the standalone step fails in that copy
  (EPERM symlinking its node_modules junction, a test-setup artifact). 2026-10-30: theme components moved to a
  client registry (site/ThemeViews.jsx) so each theme is its own chunk: First Load JS per route 499 kB -> 97.4 kB.
  After the move: 88 route requests (11 themes x 8 routes) 200 with no render error; Chrome console clean on
  gold, cinematic, classic-blue.
- theme_master is EMPTY in row_prod_copy (copied from production): every club falls back to classic-blue today and
  the admin theme picker has nothing to list. Adding the 11 themes is a data change awaiting the user.
NOT VERIFIED: every theme x page visually against the
RIZones original; interactive parts (year switch, project filters, all-years mode, calendar day pick, gallery
paging, lightbox, share buttons) beyond page load; club with real projects/events data (monrovia has little).
Known gaps / open questions:
- Visitor counter renders nothing (source used visits.php; ROW has no endpoint).
- ROW's event time-zone display (lib/eventTime, build spec) is no longer used by any theme page.
- Rotaract clubs lost their dedicated theme (fall back to classic-blue).
- Footers link https://rosteronwheels.com/ hardcoded (from the source).
- /join, /m, /profile still use ROW's own markup inside the new shells (not restyled).
- useProjectShare asks /api/public/projects/{id}/share, which ROW lacks (404, falls back to local links).

## 2026-10-30: club themes follow-ups (user picked: theme list, join/profile/m, time zones, visitor counter, visual check)
Done (with proof):
- theme_master: database/maintenance/2026-10-30-club-themes.sql (+ -down.sql) applied to row_prod_copy ONLY (twice,
  idempotent): 11 rows. Chain verified: fk_theme_id=7 -> API themeKey "split-story" -> site data-theme="split-story";
  Monrovia restored to NULL. Production not touched (user: when going live).
- Bundle: client theme registry, First Load JS 97.4 kB per route (was 499 kB).
- Time zones: API v2/about returns timeZone (club IANA zone); formatTime(d, zone) adds the zone label ("7:00 PM EDT")
  on home events, event detail, events pages (all themes), gold event. lib/eventTime zoneLabelAt + tests (5/5 pass).
  Visitor's own time ("(x your time)") NOT added.
- Visitor counter: GET /api/public/club-website/visits?club= (ClubWebsiteVisitsController, table club_website_visits,
  daily-salted hash, no IP stored, rate limit "feed", CORS open via controller route). Verified on a test API
  (5102, local copy): same visitor counted once, second browser +1, unknown club 404, no club 400, CORS header *;
  test rows deleted. Footer counter ported (themes/shared/visitorCount*.jsx), classic-blue footer shows it again.
  Table created in row_prod_copy; schema.sql + DatabaseInitializer.Visits.cs + down script added.
- join, profile/[slug], m/[slug] rebuilt with the shared-page parts (Breadcrumb, bg-canvas, container-x, shadow-card).
- Side-by-side check (source app run locally on :8190 against ROW's local API only, never RIZones servers):
  all 11 home pages at 1440 px match the source after 4 fixes found by the check: (1) images failing before
  hydration skipped their onError fallback (ThemeScripts replays it); (2) ROW's Tailwind generated the themes'
  classes into <head> and broke their cascade (content now src/app + src/components only); (3) data-civic-mode +
  color-scheme meta on <html> as the source sets them; (4) old ROW base rules (html/body/h1-h6 fonts) removed from
  globals.css (cinematic headings were Georgia). Inner pages sampled (gold About, cinematic Projects + Calendar,
  classic-blue Directory) match; 390 px classic-blue matches as far as headless Chrome shows (min ~500 px).
  Remaining differences are timing only (loaders, count-up numbers, photo-collage ad popup after 1.5 s).
  Final: tsc 0; node --test 14/14; 55 route requests (11 themes x 5) 200 with no render error.
NOT VERIFIED / open:
- The API on :5000 (started outside this session) still runs the old build: timeZone and /visits are live only on
  my test API :5102 until it is restarted. I was not allowed to stop it.
- join/profile/m restyle: tsc only; local data has no RI president/DG, no html menus, join feature off (all 404).
- Admin theme picker swatch map (THEME_PREVIEW) still names the deleted themes (falls back fine).

## 2026-10-30: club website theme switcher (user: "run and let me see all the theme give a option of theme switcher")
- Added row/club-website/src/components/ThemeSwitcher.tsx, rendered by src/app/layout.tsx only when the server env
  THEME_SWITCHER=1 (off on a public site by default). It reloads the page with ?preview-theme=<key>; the existing
  middleware keeps the choice in a session cookie; the club's own theme setting is never changed.
- Proof: tsc exit 0; all 11 themes return 200 with the right data-theme and the switcher present (curl loop);
  cinematic choice stuck on /about in Chrome; console clean on that page.
- Running locally: `THEME_SWITCHER=1 npx next dev -p 3001` in row/club-website, open http://monrovia.localhost:3001/.
- NOT VERIFIED: switcher look on every theme by eye (Chrome screenshots timed out after the first two pages).

## 2026-10-30: OMS pages updated (user: "yes update the oms pages")
- Page 1: "Status on 30 Oct" section added (design done + screen-by-screen review, 11 club themes, checks, not
  done list, remaining 45-85 days mostly gated, 1 Nov decisions); "Updated: 30 Oct"; stale "0 admin pages, 0 app
  screens" phrase removed from the 29 Oct section. Page 17: "Timeline update, 30 Oct" added. Page 15: "Design
  update, 30 Oct" added. Page 16: "Plan status, 30 Oct" added. Proof: each page re-read after Save shows the new
  text and "updated 30/10/2026", editor closed.
- Not updated: pages 2-14 (Work Done, Pending, Blocked, Timeline etc.) still dated 27-29 Oct.

## 2026-10-30: district website code removed (user: "remove all the code related to the district website which was done")
- User chose "site folders only": deleted row/district-website and row/district-website.bak-2026-10-29 (both
  git-ignored, never committed). Archive first: E:\websites\row\_local\archive\row-district-website-archive-2026-10-30.tar.gz (168
  files, node_modules/.next excluded). Kept: API DistrictWebsitePublicDataController and admin district Website Data
  screens, for the owner's district themes code later. Events and QR code also comes from the owner later.

## 2026-10-30: prepare test go-live (IIS, test.rosteronwheels.com, production DB)
Done (with proof):
- Backup: E:\websites\row\_local\backups\row_production-2026-10-30-before-golive.sql (19.4 MB, "Dump completed").
- Correction given to the user: the startup routine is NOT purely "nothing dropped" in code; the measured change
  for row_production was additive only (schema diff before: 61 tables/25 columns only local, 0 only in prod).
- Startup routine run once against row_production (background jobs, reminders, daily stats, translation off; no
  bootstrap password). After: all 25 columns present; tables 194 -> 249; remaining local-only tables are
  bak_member_dup_merge (local test leftover), 3 created on first use (district_cmr_email_settings,
  member_dup_ignored, member_dup_remark) and the 2027-28 year tables (rollover).
- Theme list applied to row_production: 0 -> 11 rows.
- Builds in E:\websites\row\_local\deploy\ (not git): api (dotnet publish Release, no Development settings; prod
  appsettings has no secrets), admin (standalone, 135 MB, 0 localhost URLs, 112 chunks with the test host),
  club-website (standalone, 49 MB). IIS files: row/deploy/iis/admin-site.web.config (one host: /api, /uploads,
  /Documents, /tempdocument proxied to 127.0.0.1:5080), club-website web.config + INTERNAL_API_URL,
  row/deploy/iis/README.md (server steps, environment table, smoke test). HANDOFF updated.
NOT done / open:
- Nothing deployed: copying to the IIS server, DNS, SSL, server env secrets = user/server team.
- Club website host names not chosen; no club_websites row in production yet.
- Admin@123 check on production admin accounts: denied to Claude (credential exploration); user to check.
- Git push from 2026-10-29/30 still blocked (OAuth token lacks `workflow` scope); new deploy files uncommitted.

## 2026-10-30 (late): test go-live follow-ups (IN PROGRESS)
- Admin uploaded to test.rosteronwheels.com httpdocs root by the user: login page loads (http only; needs Let's
  Encrypt in Plesk). Server = Plesk on IIS; add-ons already installed. The user's uploaded web.config may be the
  OLD one (proxy to 127.0.0.1:5080): replace with row-deploy\web\admin\web.config (proxy -> api.test subdomain).
- NEW user layout (FACTS 2026-10-30): everything on test.rosteronwheels.com: "/" = ROW public website
  (row/website), Login -> admin login/panels, backend in an `api` folder. Conflict to solve: two Next.js apps on
  one host. Plan: website (row/website) answers the marketing paths (/, /pricing, /faq, /club-management,
  /district-management, /how-to-get-started, /mobile-app, /about-us, /contact-us, legal pages) via IIS rewrite
  (proxy to the website app on its own Plesk subdomain or port); everything else (login, dashboards, /api...) =
  admin. Admin's own RIZones-era (site) pages at the same paths would be shadowed. API "folder": the API as an
  IIS application at /api needs PathBase handling (routes already start with /api) -> verify before choosing.
- Accounts (approved by the user): new password for SuperAdmin member 1 + one TEST account per ROW
  role type in row_production. Not done yet: list roles (roles table) first, then create.
- Login credentials: none known for production; give the user the new ones once created.
- 2026-10-30 14:57: NEW production password set for SuperAdmin member 1; stored hash verified; password in E:\websites\row\_local\backups\test-logins.txt (outside git); rollback SQL beside it. Test accounts per role: NOT created yet (existing club not named).
- 2026-10-30 15:10: Server folder (user screenshot): D:\Inetpub\vhosts\rosteronwheels.com\test.rosteronwheels.com = site root with admin frontend files at root + api folder (backend). Plan now: api folder = IIS application at /api (Program.cs restores /api prefix; PathBase cleared in appsettings.Production.json); root web.config rewrites media to api/. Not yet verified on the server.
- 2026-10-30 15:40: Plesk: created virtual directory 'api' -> /test.rosteronwheels.com/api with Create application (done in browser at user's request). API now runs: /api/... returns the API's own JSON 500 (every route), i.e. a startup-config/DB problem inside the API; api\web.config on the server most likely lacks the environment variables. NOT VERIFIED which.
- 2026-10-30 15:45: E:\websites\row\_local\deploy\api\web.config now holds the full server settings (prod DB conn from row/.env, new JWT + visit secrets). Outside git. Tested locally with those settings: /api/public/brand 200.
- 2026-10-30 15:50: Live /api returned 404 after web.config: implicit UseRouting matched before the /api PathBase fix. Added explicit app.UseRouting() before UseCors in Program.cs; republished row-deploy\api (server web.config kept). Local 200; IIS path NOT VERIFIED until uploaded.
- 2026-10-30 15:55: LIVE: https://test.rosteronwheels.com/api/public/brand 200; POST /api/auth/login with empty body 400 (route reached). Login by user not yet confirmed.
- 2026-10-30 16:10: Tester login fails with 'Network problem': live cert on test.rosteronwheels.com is CN=rosteronwheels.com (Let's Encrypt), name mismatch (SEC_E_WRONG_PRINCIPAL). Browsers that did not click through the warning block the https /api calls. Fix: Let's Encrypt cert for test.rosteronwheels.com in Plesk. Live sweep of 10 settings pages: all API calls 200; /api/districts?pageSize=9999 takes ~3.9s.
- 2026-10-30 16:40 LIVE TEST (SuperAdmin, read-only), test.rosteronwheels.com:
  - OK: login, global search, all 41 /settings pages, /admin/login-logs, /clubs, /goal-overviews, district dashboard
    (district 2031) 26 sections, club dashboard 22 sections: no API errors.
  - BUG: /district-admin-dashboard/payment-accounts and /club-admin-dashboard/payment-accounts show "Something went
    wrong": admin calls /api/payments/accounts and /api/payments/coverage (admin/src/services/api.ts:6676-6685) but no
    API controller serves them (404). Payments wait for Stripe; page should be hidden or the API built. Not fixed.
  - SLOW: /api/districts?pageSize=9999&isActive=1 ~3.9 s (settings/district-governor, settings/tenants, others).
  - Expected (not bugs): /zones, /members, /report have no index page (404); flagged-off modules redirect to /admin;
    wallet "not available" (modules.wallet=false); /ag-reports "Access Denied" for SuperAdmin; /planning -> /admin.
  - District 2031 shows 0 members (data, not verified why).
  - TLS: cert is for rosteronwheels.com, not test.rosteronwheels.com -> other browsers get "Network problem" on login.

## 2026-10-30: Rotary.org data (outside India)
- Asked: compare ROW's Rotary.org code with RIZones, fix gaps, fetch clubs/districts/members outside India (Monrovia first).
- Done (proof in chat): code compared file by file; every RIZones Rotary.org file has a ROW copy; differences are deliberate
  ROW changes; ClubProfileReport not ported on purpose (ROW-CHANGES.md:193). No code gap fixed (none found).
  `--ping` with the RIZones login: auth OK, /clubs 4215 clubs, 65 outside India.
  `--world-clubs --dry-run` on row_production: 222 countries, 31749 clubs on Rotary.org, 31726 already in DB, 23 would be
  inserted, 0 new districts, 0 errors, no writes, no email.
- Production (read-only check): 31729 active clubs, 64 synced (2056 members), 30312 clubs with no enabled module
  (world import adds clubs without modules). Monrovia (Liberia, D9101) synced, 65 members, 30 modules;
  Monrovia (USA, D5300) non-sync, 0 members, 0 modules.
- Done 2026-10-30 (user OK): default modules backfill on row_production via POST /api/clubs/modules/bulk-assign-defaults-to-empty
  (SuperAdmin session on test.rosteronwheels.com): 200, clubsTouched 30312, rowsInserted 848736. DB check: 0 of 31729
  clubs without an enabled module; Monrovia USA (28409) now 28 modules.
- Done 2026-10-30 16:42 (user OK): `--world-clubs` on row_production: 23 clubs inserted, 0 districts, 0 errors (222
  countries). Default modules for them by the same INSERT as the backfill endpoint (browser session had expired):
  644 rows; 0 of 31752 active clubs without a module.
- 2026-10-30: top tab bar on /district-admin-dashboard/egovernance had an inline #17458f background (grey labels on
  blue); removed. Local, NOT deployed.
- 2026-10-30 UI fixes (local, NOT deployed to live): 507 table header cells in 71 admin files had white text over the
  light `TableHead` background, now use the standard dark text; SuperAdmin "Back to Search" button now has a spacer
  so it no longer covers pagination. tsc 0 errors. NOT VERIFIED in browser yet.
- 2026-10-30: tab bars showed a vertical scrollbar (TabsList overflow-x-auto implies overflow-y auto); added overflow-y-hidden in components/ui/tabs.tsx (31 files use it). Local, NOT deployed.
- Open: pagination looks different on different pages: 52 pages use components/Pagination, about 30 roll their own.
- 2026-10-30 evening, LOCAL UI testing (user: "TESTING TO BE DONE IN LOCAL AND BE SURE OF THE ISSUE"):
  - New crawl checks kb/tools/ui_checks.js (unreadable text, scrollbars in small elements, controls under fixed
    elements, pagination style), wired into kb/tools/design_crawl.py. Proven on a fixture copying the user's 4 issues:
    all 4 caught (scratchpad ui_fixture_test.py). Old crawl only checked page overflow: that is why they were missed.
  - Run 1 (all 4 roles x 2 widths, 1112 page views): 0 inner scrollbars, 0 overflow/errors; Back to Search still
    covered controls (board of directors, club report, theme page); helper text slate-400 3.0:1; sidebar
    "Switch dashboard" 1.61:1; custom pagination on several pages; theme page previews missing for 10 themes.
  - Fixed (local, tsc 0, lint 29 errors = baseline): slate-400 -> #66768C (4.63:1); Back to Search moved into the
    AppHeader (no longer floating) and shown for every SuperAdmin in the dashboard header; switcher trigger restyled
    for the light sidebar; 24 files moved to components/Pagination (scratchpad swap_pagers.py); theme previews added
    for the 10 club themes (v1 + v2 pages).
  - Run 3 (all fixes, 1112 page views): inner scrollbars 0, controls covered 0, overflow/errors 0; pagination shared
    on 57 routes, still custom on /ag-dashboard/projects and /club-admin-dashboard/dashboard/directory; 8 low-contrast
    texts left (orange 'Female 30' and '$0' on white 1.95, 'Active' badge on /admin 2.87, upload hint 2.67, about-us
    footer 1.99, audit/email log badges 2.24/2.54). NOT fixed yet.
- 2026-10-30 18:20 Deploy build: admin rebuilt (NEXT_PUBLIC_API_URL=https://test.rosteronwheels.com, URL in 112 chunks,
  0 localhost) and copied into _local/deploy/web/admin (web.config kept); local smoke /login 200, CSS 200. API and
  club site unchanged since their last publish (no newer sources). NOT uploaded to the server.
- Folders tidied (user request): row-deploy, row-backups, row-design-screenshots, theme + district archives moved to
  E:\websites
ow\_local\ (git-ignored, check-ignore proven); row-build deleted. _mysql-row (old Aug local MySQL with
  rotaryindia_local + row_production) left in place: user to decide.
- 2026-10-30 19:00 Last 8 faint texts fixed (user: "fix all 8 and rebuild the deploy folder"): white-on-green/amber
  badges -> 700 shades (audit log, email log, zone/district cards, member search; goal matrix Super Green -> 800 to
  keep its order); text-muted-foreground/70 -> text-muted-foreground (10); public footer text -> white/70 on blue;
  club overview orange/green value text -> darker shades; all Recharts legend labels -> ink (globals.css); chart
  ticks #8796aa -> #66768C; members directory pager -> components/Pagination. Proof: local rebuild, contrast probe
  on the 7 flagged pages returns nothing; directory shows "Showing 1-20 out of 65 records". tsc 0, lint 29 (baseline).
  /ag-dashboard/projects "custom pagination" was a checker false positive (its heading text), pager already shared.

- 2026-10-30 18:43 Deploy folder rebuilt with all UI fixes: _local/deploy/web/admin (build in _local/build/admin, git-ignored). URL https://test.rosteronwheels.com in 112 chunks, 0 localhost; smoke /login 200, CSS 200, legend + green-700 rules present. NOT uploaded to the server.
