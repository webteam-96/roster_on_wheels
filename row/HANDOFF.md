# ROW: session handoff (read this first)

Last session: **2026-10-23**. A new session starts here, then continues with **"Next task"** below without
re-reading whole codebases (use `kb/README.md` and the graphify commands in the root `CLAUDE.md`).

## Ground rules (from the user)

- `row/` is the project. `reference/` (RIZones) is copy-source only: never run it or connect to its servers.
- ROW has **no WhatsApp and no SMS**. Communication is in-app (push, feed) and email only.
- Commit and push only when the user asks. Scan every added file for secrets before committing.
- Work solo (no multi-agent), the user's token budget is limited.
- Hosting is undecided (IIS or AWS): keep code hosting-neutral, add no deploy files.
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

## Next task

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

- Security, open (found 2026-10-23, not fixed): `row/api/App_Data/dp-keys/key-*.xml` (Data Protection key ring) is
  tracked in the public repo: untrack and rotate. `GET /api/mobile/club-calendar/{id}` and `district-calendar/{id}`
  let any signed-in user read any club's birthdays, phones and emails. Mass email detail/update/delete/send by id do
  not check the club. Admin `/api/i18n/translate` has no auth (open translation proxy). `EmailService` logs the
  recipient address on a failed send. Chat hub tokens travel in the query string: strip it from proxy logs.

- **`row/mobile` is in git since 2026-10-21** (user decision). Its RIZones-era notes (`WORK_LOG.txt`, `ANALYSIS.md`,
  `.specs/` and others, see `row/mobile/.gitignore`) stay local: they hold RIZones servers and old dev logins.
- Write endpoints with the club or district id outside the URL were reviewed 2026-10-21; READ (GET) access is not
  reviewed yet (see `ROW-CHANGES.md`).
- Behind a proxy, set `ForwardedHeaders__KnownNetworks__0=<proxy CIDR>` or every client shares one rate-limit bucket.
- A fresh database gets a SuperAdmin login only when `Bootstrap__SuperAdminPassword` (12+ characters) is set.
- The repo is public and its history holds old demo logins: rotate any password that was ever committed.
- WhatsApp-named columns left the code and schema 2026-10-23; existing databases keep them until the cleanup
  script runs (user go-ahead).
- Store ids: iOS `com.kaizen.row`, Android `com.SampleApp.row` (Android id still a placeholder).
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
  `C:\Users\USER\AppData\Local\Temp\claude\E--websites-row\90aa448c-26b5-4793-8f68-287ce64e72b4\scratchpad\rowdb\data`;
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
  `escalation_celebration`, `rebranding`, `security_guards`. All 30 scripts take the same three arguments.
- Admin: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/check-design.mjs`.
- App: `flutter analyze` (errors print as `  error -`), `flutter test`.
- Then `bash kb/rebuild.sh`.
