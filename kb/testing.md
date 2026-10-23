# Testing record

Hand-maintained. Add a dated row whenever a check is run; keep the newest first.

## How to run each check

Stack finalized 2026-10-15: Next.js + .NET. The NestJS backend was deleted; the .NET edition is now `row/`.
The dated results below are kept as history and still mention the NestJS edition where it existed at the time.

| Codebase | Command (from the folder) | Notes |
|---|---|---|
| row/api | `dotnet build` | ASP.NET Core API; also `for w in ../workers/*/; do (cd $w && dotnet build); done` |
| row (identity) | `node tools/check-rizones.mjs` | RIZones identity lint, must be 0; `--india` lists India behaviour still to convert |
| row/api | `bash kb/rebuild.sh --no-graphs` (repo root) | extracts the .NET route table statically and regenerates the diffs (no server boot) |
| row/admin | `npx vitest run` | unit tests |
| row/admin | `npx tsc --noEmit -p tsconfig.json` | builds ignore TS errors (`next.config` `ignoreBuildErrors`) |
| row/club-website | `npm install` then `npm run build` | no tests; dependencies not installed on this machine |
| row/mobile | `flutter analyze`, `flutter test` | Flutter SDK is not installed on this machine (2026-10-12) |
| API vs RIZones | `python -I kb/tools/get_sweep.py <row api base> <rizones base> <jwt secret>` | every parameterless GET on both, status compared; fresh test databases (Docker `row-dotnet-mysql`, port 3318), same `JwtSettings__Secret` |

## Results

### 2026-10-23 evening (security + read review, time zones, planning mode, escalation, rebranding; on 0a1e4b8)

- Builds: API + 3 workers 0 errors; admin `tsc` 0, `vitest` 22 files / 120 tests, `check-design.mjs` 0; app
  `flutter analyze` 0 errors (448 pre-existing infos/warnings), `flutter test` all passed.
- e2e on `row_prod_copy` (API :5000, Brevo/SMTP to closed or fake local ports): 30 scripts, 1,250 checks, 0 failures
  (new: calendar_scope 13, mass_email_scope 60, read_review_a_l 85, read_review_m_z 103, time_zones 24,
  planning_mode 100, escalation_celebration 79, rebranding 19, security_guards 12; the 9 older scripts now on args).
- Admin crawl as SuperAdmin (`kb/tools/admin_crawl.py`, dev server :3300): 319 pages; 6 flagged were dev-server
  compile noise and were clean on re-probe.
- App on the emulator (afc_tablet, `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5000`): sign-in, home,
  calendar list, club calendar, notifications: ROW branding, no exceptions in the log.

### 2026-10-23 (skipped modules removed, 10 new spec modules, uncommitted on top of 31115e2)

- `dotnet build`: API and the 3 workers, 0 errors. Admin `tsc --noEmit` 0 errors, `vitest run` 18 files / 103 tests
  pass, `check-design.mjs` all counts 0. `club-website` and `district-website` `tsc --noEmit` 0 errors. App:
  `flutter analyze` / `flutter test` passed in the removal steps (94 + 11 tests); the app was not changed after that.
- e2e against `row_prod_copy` (API on :5000, Brevo and SMTP pointed at closed or fake local ports): membership_fields
  40, engagement 44, grants 76, volunteers_speakers 87, contacts_prospects_growth 89, target_dashboard 52,
  meetings_links_compliance 43, communication_upgrades 65, websites_multilingual 40, chat 84, scope_read_guard 7,
  feature_gate 10 (incl. removed routes answer 404): all PASS.
- Trace sweep of the removed modules (84 patterns, all code layers): 0 hits except allowed ones (removed-route list
  in feature_gate_e2e.py) and false positives (chat moderation, website trial lock, other "category" meanings).
- Not run: the 8 older e2e scripts that still need the dropped `row_local` (P6); browser checks of the new pages.

### 2026-10-13, session 4 (India-specific behaviour removed from the .NET edition and the shared admin)

| Check | Result |
|---|---|
| .NET API, AwardsAutoCalc / Greetings / RotaryOrgSync workers | build, 0 errors |
| row/admin and row-dotnet/admin | tsc 0 errors, vitest 27 pass; the two copies identical |
| Identity lint (`check-rizones.mjs`, `lint:rizones`) | 0 on both editions |
| Fresh databases (schema + drift + seed, MySQL 8.0.46), `get_sweep.py` | 382 GET routes: NestJS 235 × 2xx / 146 × 4xx / 1 × 5xx, .NET the same; status class differs on 0 routes |
| Member saved with country 0 (`POST api/members`) | 201 on both; stored with no country on both (the .NET edition used to write India) |
| `privacy_e2e.py` | not rerun: its fixture users are not on a fresh database (last result 26 / 26, session 3) |

### 2026-10-12, session 3 (uncommitted work on top of 2ca5608)

| Check | Result |
|---|---|
| row/api type check, RIZones lint | 0 errors, 0 findings |
| row/api jest | 19 suites, 114 pass, 7 skipped (new: privacy registry and consent filter specs) |
| row/admin | tsc 0 errors (the six inherited ones fixed), vitest 27 pass, `next build` 201 pages, identity lint 0 |
| row/club-website | tsc 0, `next build` 11 pages, identity lint 0 |
| Fresh database (MySQL 8.0.46 in Docker, schema + drift + seed), NestJS | 379 GET routes: 237 × 2xx, 141 × 4xx, 1 × 5xx (Rotary.org ping, no credentials) |
| Fresh database, .NET edition | 379 GET routes: 235 × 2xx, 143 × 4xx, 1 × 5xx (same) |
| `kb/tools/privacy_e2e.py` | 26 / 26 on NestJS and on .NET |
| .NET member-data guard | blood group / family hidden with the flags off, present with them on (typed DTO, Dapper row, club report lists) |
| Tombstone hash | the sweep worker's formula matches the hashes both APIs wrote |
| .NET API and workers | build; identity lint 0 |
| Upstream sync to cb3e678 (admin + .NET) | NestJS and .NET GET sweeps identical route by route (238 / 140 / 1); admin tsc 0, vitest 27, build 201; .NET API + workers build; identity lint 0 |
| .NET currency / scope / OTP round | GET sweep identical before and after (235 / 143 / 1); OTP fallback WhatsApp → SMS → email verified with unconfigured Meta and Twilio; `debugOtp` no longer returned |

### 2026-10-12 (main @ eca1661)

| Check | Result |
|---|---|
| api type check | 0 errors |
| api RIZones lint | 0 findings |
| api jest | 18 suites pass, 1 skipped; 108 tests pass, 7 skipped |
| api boot (no DB) | starts, 1,311 routes mapped; background jobs log DB connection errors as expected |
| api routes vs .NET | 1,299 of 1,523 .NET routes served (85%); the 224 missing are Payments + deliberately not ported (see `api-routes-diff.md`) |
| admin vitest | 1 file, 27 tests pass |
| admin type check | 6 errors, all in files identical to RIZones (`settings/area-of-focus`, `categories`, `sub-categories` pages: comma operator in JSX) |
| mobile | not run here (no Flutter); last recorded run in STATUS §6: `flutter test` 70 pass, `flutter analyze` no errors |
| club-website | not run (no dependencies installed) |

### 2026-10-10 (from STATUS §5a, side-by-side .NET vs ROW sweep, local MySQL)

| Sweep | Result |
|---|---|
| Schema after .NET migrations | identical |
| GET, 757 routes | 716 identical, 41 expected differences (brand, time zone, currency, ROW-only) |
| Writes, 481 routes × 3 body shapes | 464 / 478 / 478 identical |
| Background jobs, 3 min on seeded data | identical rows written |
| Upstream re-sync (cb3e678) | 720 / 760 GET, 467 / 481 / 481 of 484 writes identical |

Not yet tested anywhere: real sends (Brevo, Meta WhatsApp, FCM, Rotary.org, Plesk), Payments, load,
the report / goal-setting SQL against a real database with production-like data.
