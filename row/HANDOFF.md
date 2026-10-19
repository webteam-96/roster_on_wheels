# ROW: session handoff (read this first)

Last session: **2026-10-19**. A new session starts here, then continues with **"Next task"** below without
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

## Next task

**Wave 1 Task 5: tenant lifecycle and editions** (spec items 1 and 5). Full brief in the Wave 1 plan, Task 5:
tables `edition_catalogue`, `edition_modules`, `tenant_subscriptions`; Super Admin APIs to edit editions and
apply one to a district and its clubs (on/off module switches); planning state that refuses current-year writes;
admin Tenants and Editions pages; an e2e script in `kb/tools/`.

Then **Wave 1 Task 6: string catalogue** (`i18n_strings` table, `GET api/i18n/{locale}`, admin Translations
editor, merge of overrides over bundled messages).

## Still pending after Wave 1

- Finish the Wave 1 wrap-up: update `row/STATUS.md` and `row/PENDING-WORK.md` (§6 WhatsApp is now done), design
  plan Task 10 close-out.
- Wave 2 money (needs a Stripe test account), Wave 3 data in/out (needs RI access and real export files),
  Waves 4 to 6: see the build spec plan.
- Open decision C8 (Kaizen Events) blocks the Wave 4 event items.
- District website scope: waiting for the user's list of what stays and what goes.

## Known gaps and flags

- **`row/mobile` is not in git** (ignored by the repo, no nested repo). Its work is on the local disk only. Ask the
  user whether to version it before relying on history.
- The scope write guard is path-based: endpoints that take the club or district id in the body or query are not
  covered (list in `ROW-CHANGES.md`).
- The auth rate limiter needs ForwardedHeaders configured once ROW runs behind a proxy.
- Database columns named after WhatsApp are kept (no destructive migration); only sending, granting and buying
  were removed.
- `row/mobile/.../welcome_screen.dart` (around line 228) holds a stray personal note in a code comment about
  hosting for a client; not acted on.
- Store ids: iOS `com.kaizen.row`, Android `com.SampleApp.row` (Android id still a placeholder).
- 19 analyzer warnings in the app (unused locals such as `grad`) and some admin lint warnings are pre-existing.

## Run locally (dev only)

- MySQL 8.4 on port 3317, database `row_local` (data dir in the session scratchpad; recreate if missing).
- API: from `row/api`, set `ASPNETCORE_ENVIRONMENT=Development`, `ConnectionStrings__DefaultConnection` to the
  local database, a random `JwtSettings__Secret`, `Database__SkipInit=true`, then
  `dotnet run --urls http://0.0.0.0:5000`.
- Admin: `row/admin`, `NODE_OPTIONS=--max-old-space-size=6144 npx next dev -p 3300`. Never run `next build` while
  the dev server runs.
- Club website: `row/club-website`, `npx next dev -p 3001`, open `monrovia.localhost:3001`.
- App: Flutter at `C:\src\flutter`, Android SDK at `C:\Users\USER\android`, emulator `afc_tablet`:
  `flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:5000`.
- Local test logins (demo data only) are in the `kb/tools/*_e2e.py` scripts. The demo club admin is now
  `samuel.tubman@monrovia.demo` (joseph.weah was erased by an earlier test run).

## Checks to run after changes

- API: `dotnet build`; e2e: `python kb/tools/<name>_e2e.py` for `no_whatsapp`, `scope_write_guard`,
  `meeting_mode`, `mobile_password_login`, `audit_immutable` (run them a minute apart: the auth rate limit is
  10 logins per minute per IP).
- Admin: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `node scripts/check-design.mjs`.
- App: `flutter analyze` (errors print as `  error -`), `flutter test`.
- Then `bash kb/rebuild.sh`.
