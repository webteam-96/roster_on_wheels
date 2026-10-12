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

## Results

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
