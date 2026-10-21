# ROW: session handoff (read this first)

Last session: **2026-10-21**. A new session starts here, then continues with **"Next task"** below without
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

## Next task

Wave 1 and its wrap-up are done (STATUS §6d, PENDING-WORK §1/§7, design plan Task 10 gates green 2026-10-21).
**Wave 2 (money) is blocked on a Stripe test account from the user.** Unblocked meanwhile: the district website
scope (needs the user's list), and committing this work (only when the user asks).

## Still pending after Wave 1

- Wave 2 money (needs a Stripe test account), Wave 3 data in/out (needs RI access and real export files),
  Waves 4 to 6: see the build spec plan.
- Open decision C8 (Kaizen Events) blocks the Wave 4 event items.
- District website scope: waiting for the user's list of what stays and what goes.

## Known gaps and flags

- **`row/mobile` is not in git** (ignored by the repo, no nested repo). Its work is on the local disk only. Ask the
  user whether to version it before relying on history.
- The scope write guard is path-based: endpoints that take the club or district id in the body or query are not
  covered (list in `ROW-CHANGES.md`).
- Behind a proxy, set `ForwardedHeaders__KnownNetworks__0=<proxy CIDR>` or every client shares one rate-limit bucket.
- A fresh database gets a SuperAdmin login only when `Bootstrap__SuperAdminPassword` (12+ characters) is set.
- The repo is public and its history holds old demo logins: rotate any password that was ever committed.
- Database columns named after WhatsApp are kept (no destructive migration); only sending, granting and buying
  were removed.
- `row/mobile/.../welcome_screen.dart` (around line 228) holds a stray personal note in a code comment about
  hosting for a client; not acted on.
- Store ids: iOS `com.kaizen.row`, Android `com.SampleApp.row` (Android id still a placeholder).
- 19 analyzer warnings in the app (unused locals such as `grad`) and some admin lint warnings are pre-existing.

## Run locally (dev only)

- MySQL 8.4 on port 3317, database `row_local`. Data dir (2026-10-21):
  `C:\Users\USER\AppData\Local\Temp\claude\E--websites-row\90aa448c-26b5-4793-8f68-287ce64e72b4\scratchpad\rowdb\data`;
  start: `mysqld --datadir=<that dir> --port=3317 --bind-address=127.0.0.1 --mysqlx=OFF --console`.
- API: from `row/api`, set `ASPNETCORE_ENVIRONMENT=Development`, `ConnectionStrings__DefaultConnection` to the
  local database, a random `JwtSettings__Secret`, `Database__SkipInit=true`, then
  `dotnet run --urls http://0.0.0.0:5000`.
- Admin: `row/admin`, `NODE_OPTIONS=--max-old-space-size=6144 npx next dev -p 3300`. Never run `next build` while
  the dev server runs.
- Club website: `row/club-website`, `npx next dev -p 3001`, open `monrovia.localhost:3001`.
- App: Flutter at `C:\src\flutter`, Android SDK at `C:\Users\USER\android`, emulator `afc_tablet`:
  `flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:5000`.
- Local test logins (demo data only) are in the `kb/tools/*_e2e.py` scripts; the newer ones read `ROW_E2E_SA_EMAIL`, `ROW_E2E_SA_PASSWORD`, `ROW_E2E_ADMIN_PASSWORD` from the environment. The demo club admin is now
  `samuel.tubman@monrovia.demo` (joseph.weah was erased by an earlier test run).

## Checks to run after changes

- API: `dotnet build`; e2e: `python kb/tools/<name>_e2e.py` for `no_whatsapp`, `scope_write_guard`,
  `meeting_mode`, `mobile_password_login`, `audit_immutable`, `tenant_lifecycle`, `i18n_catalogue`, `feature_gate` (run them a minute apart: the auth rate limit is
  10 logins per minute per IP).
- Admin: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/check-design.mjs`.
- App: `flutter analyze` (errors print as `  error -`), `flutter test`.
- Then `bash kb/rebuild.sh`.
