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
  Screenshots refreshed in E:\websites\row-design-screenshots\2026-10-29\ (outside the repo).
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
- Old themes archived to E:\websites\row-theme-archive-2026-10-29\ then deleted. District site src restored from
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
