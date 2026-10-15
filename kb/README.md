# ROW knowledge base

Start here instead of re-reading source code. It has two parts:

1. **Code graphs (graphify)** in `graphify-out/` (not committed; rebuild with `bash kb/rebuild.sh`).
2. **Generated comparisons and indexes** in this folder (committed, small).

**Stack (finalized 2026-10-15): Next.js frontend + ASP.NET Core (.NET) backend.** The project is a single
edition under `row/`. The earlier NestJS port and the separate `row-dotnet/` folder are gone — the .NET edition
was promoted to the main `row/` folder.

## Code graphs

Codebases, built locally with tree-sitter (`--code-only`, no LLM, no API cost):

| Tag | Path | Graph |
|---|---|---|
| api | `row/api` (ASP.NET Core API) | `graphify-out/parts/api/graphify-out/graph.json` |
| workers | `row/workers` (.NET worker programs) | `graphify-out/parts/workers/...` |
| admin | `row/admin` (Next.js admin portal) | `graphify-out/parts/admin/...` |
| club-website | `row/club-website` (Next.js public club site) | `graphify-out/parts/club-website/...` |
| mobile | `row/mobile` (Flutter) | `graphify-out/parts/mobile/...` |
| ref-api | `reference/RotaryIndia_Admin_API_Claude` (RIZones .NET API **plus** `rotary-frontend`, `club-website`, workers) | `graphify-out/parts/ref-api/...` |
| ref-mobile | `reference/rotary_zones_45678_flutter` (RIZones Flutter) | `graphify-out/parts/ref-mobile/...` |

`graphify-out/graph.json` is all of them merged; every node has `repo` set to the tag above.
Query one codebase to avoid mixing ROW and RIZones results:

```bash
G=~/.local/bin/graphify.exe   # graphify is installed with uv; ~/.local/bin is not on PATH
$G query "how is the mobile OTP sent" --graph graphify-out/parts/api/graphify-out/graph.json --budget 1500
$G explain "Brand" --graph graphify-out/parts/api/graphify-out/graph.json
$G path "MobileAuthController" "RowMessaging" --graph graphify-out/parts/api/graphify-out/graph.json
```

> After the 2026-10-15 restructure, run `bash kb/rebuild.sh` once to regenerate the graphs under the new tags.

Each part also has a `GRAPH_REPORT.md` (god nodes, communities) next to its `graph.json`.
Communities are unnamed ("Community N") because naming needs an LLM; use `query` / `explain` instead.
After changing code: `bash kb/rebuild.sh` (about 2 minutes; graphify extraction is cached per file).

## Generated files (do not edit by hand; rerun `bash kb/rebuild.sh --no-graphs`)

| File | What it shows |
|---|---|
| `mobile-diff.md` | RIZones Flutter vs `row/mobile`: changed files, API paths the app calls that ROW does not serve |
| `admin-diff.md` | RIZones `rotary-frontend` vs `row/admin`: same |
| `club-website-diff.md` | RIZones `club-website` vs `row/club-website`: same |
| `docs-index.md` | every document in `document/`, `row/`, `reference/` with its headings |
| `row-api-routes.log` | the ROW .NET API route table, extracted statically from `row/api/Controllers` |

The route table is parsed from the C# controllers by `kb/tools/dotnet_route_log.py` (no server boot), and the
app diffs use it to flag client calls the API does not serve.

Hand-maintained: `testing.md` (how to run every check, dated results) and the findings below.

## Where things stand (2026-10-15, session 5)

Authoritative progress and decisions: `row/STATUS.md`, `row/ROW-CHANGES.md`, `row/PENDING-WORK.md`; project README `row/README.md`.

| Codebase | State |
|---|---|
| row/api (.NET) | RIZones ASP.NET Core API rebranded to ROW; brand, feature flags, privacy module, member-data guard, currency, time zone, phone and SMS behaviour in; only Payments still India (Cashfree / Razorpay). Schema gaps fixed. |
| row/workers | AwardsAutoCalc, Greetings, RotaryOrgSync — rebranded, same ROW behaviour as the API |
| row/admin | RIZones content and India formats removed; pay pages wait for Payments; policy texts need counsel |
| row/club-website | converted |
| row/mobile | on the ROW API and brand; formats, phone input, privacy screens pending (no Flutter SDK here) |
| WhatsApp | ROW has none (2026-10-13); removal from API, admin and mobile on hold (`row/PENDING-WORK.md` §7) |

Notes:
- 2026-10-15: finalized stack = Next.js + .NET. The NestJS backend (`row/api` TypeScript) was deleted and the
  .NET edition (`row-dotnet/`) was renamed to `row/`, so there is now one edition.
- `reference/RotaryIndia_Admin_API_Claude` is at `cb3e678c` (2026-10-09, pulled 2026-10-12), the commit the
  .NET API is synced to; `reference/rotary_zones_45678_flutter` is at `1c3cb0d` (2026-09-24), unchanged.
- `kb/tools/get_sweep.py` calls every parameterless GET on both APIs and compares the status codes;
  `kb/tools/privacy_e2e.py` tests the privacy API; `kb/tools/locale_codemod.py` is the admin locale codemod
  (rerun it on a refreshed RIZones frontend).
- Test database lives in the local Docker container `row-dotnet-mysql` (port 3318): `row_dotnet`, throwaway fixtures only.
