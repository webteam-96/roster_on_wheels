# Testing record

Hand-maintained. Add a dated row whenever a check is run; keep the newest first.

## How to run each check

| Codebase | Command (from the folder) | Notes |
|---|---|---|
| row/api | `npx tsc --noEmit -p tsconfig.json` | type check |
| row/api | `npm run -s lint:rizones` | must be 0 findings |
| row/api | `npx jest` | unit specs; `db.integration.spec.ts` is skipped without a database |
| row/api | `bash kb/rebuild.sh --no-graphs` (repo root) | boots the API, dumps the route table, regenerates the diffs |
| row/admin | `npx vitest run` | unit tests |
| row/admin | `npx tsc --noEmit -p tsconfig.json` | builds ignore TS errors (`next.config` `ignoreBuildErrors`) |
| row/club-website | `npm install` then `npm run build` | no tests; dependencies not installed on this machine |
| row/mobile | `flutter analyze`, `flutter test` | Flutter SDK is not installed on this machine (2026-10-12) |
| both APIs | `python -I kb/tools/get_sweep.py <nest base> <dotnet base> <jwt secret>` | every parameterless GET on both, status compared; start both on fresh test databases (Docker `row-dotnet-mysql`, port 3318) with the same `JwtSettings__Secret` |

## Results

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
