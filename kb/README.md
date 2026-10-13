# ROW knowledge base

Start here instead of re-reading source code. It has two parts:

1. **Code graphs (graphify)** in `graphify-out/` (not committed; rebuild with `bash kb/rebuild.sh`).
2. **Generated comparisons and indexes** in this folder (committed, small).

## Code graphs

Eight codebases, built locally with tree-sitter (`--code-only`, no LLM, no API cost):

| Tag | Path | Graph |
|---|---|---|
| row-api | `row/api` (NestJS) | `graphify-out/parts/row-api/graphify-out/graph.json` |
| row-admin | `row/admin` (Next.js admin portal) | `graphify-out/parts/row-admin/...` |
| row-club-website | `row/club-website` (Next.js public club site) | `graphify-out/parts/row-club-website/...` |
| row-mobile | `row/mobile` (Flutter) | `graphify-out/parts/row-mobile/...` |
| dotnet-api | `row-dotnet/api` (.NET edition API) | `graphify-out/parts/dotnet-api/...` |
| dotnet-workers | `row-dotnet/workers` (.NET edition workers, shared by both editions) | `graphify-out/parts/dotnet-workers/...` |
| ref-api | `reference/RotaryIndia_Admin_API_Claude` (RIZones .NET API **plus** `rotary-frontend`, `club-website`, workers) | `graphify-out/parts/ref-api/...` |
| ref-mobile | `reference/rotary_zones_45678_flutter` (RIZones Flutter) | `graphify-out/parts/ref-mobile/...` |

`graphify-out/graph.json` is all eight merged; every node has `repo` set to the tag above.
Query one codebase to avoid mixing ROW and RIZones results:

```bash
G=~/.local/bin/graphify.exe   # graphify is installed with uv; ~/.local/bin is not on PATH
$G query "how is the mobile OTP sent" --graph graphify-out/parts/row-api/graphify-out/graph.json --budget 1500
$G explain "GoalCore" --graph graphify-out/parts/row-api/graphify-out/graph.json
$G path "MobileAuthController" "MessagingService" --graph graphify-out/parts/row-api/graphify-out/graph.json
```

Each part also has a `GRAPH_REPORT.md` (god nodes, communities) next to its `graph.json`.
Communities are unnamed ("Community N") because naming needs an LLM; use `query` / `explain` instead.
After changing code: `bash kb/rebuild.sh` (about 2 minutes; graphify extraction is cached per file).

## Generated files (do not edit by hand; rerun `bash kb/rebuild.sh --no-graphs`)

| File | What it shows |
|---|---|
| `api-routes-diff.md` | every RIZones .NET route vs the routes the ROW API maps at start-up |
| `mobile-diff.md` | RIZones Flutter vs `row/mobile`: changed files, API paths the app calls that ROW does not serve |
| `admin-diff.md` | RIZones `rotary-frontend` vs `row/admin`: same |
| `club-website-diff.md` | RIZones `club-website` vs `row/club-website`: same |
| `docs-index.md` | every document in `document/`, `row/`, `reference/` with its headings |
| `row-api-routes.log` | the ROW API route table (1,311 routes) |

Hand-maintained: `testing.md` (how to run every check, dated results) and the findings below.

## Where things stand (2026-10-13, session 4)

Authoritative progress and decisions: `row/STATUS.md`, `row/api/ROW-CHANGES.md`, `row/PENDING-WORK.md`;
the .NET edition: `row-dotnet/README.md`.

| Codebase | State |
|---|---|
| row/api (NestJS) | 85% of .NET routes (missing = Payments, decision 4, plus excluded partner feeds); privacy module, schema gaps fixed |
| row/admin | RIZones content and India formats removed (tasks A, B); pay pages wait for Payments; policy texts need counsel |
| row/club-website | converted |
| row/mobile | on the ROW API and brand; formats, phone input, privacy screens pending (no Flutter SDK here) |
| row-dotnet (.NET edition) | RIZones API + workers rebranded, same admin / club website as row/; brand, flags, privacy, member-data guard, currency, time zone, phone and SMS behaviour as NestJS; only Payments still India (Cashfree / Razorpay) |
| WhatsApp | ROW has none (2026-10-13); removal from both editions, admin and mobile on hold (`row/PENDING-WORK.md` §7) |

Notes:
- `reference/RotaryIndia_Admin_API_Claude` is at `cb3e678c` (2026-10-09, pulled 2026-10-12), the commit
  both editions are synced to; `reference/rotary_zones_45678_flutter` is at `1c3cb0d` (2026-09-24), unchanged.
- `kb/tools/get_sweep.py` calls every parameterless GET on both APIs and compares the status codes;
  `kb/tools/privacy_e2e.py` tests the privacy API of either edition; `kb/tools/locale_codemod.py` is the
  admin locale codemod (rerun it on a refreshed RIZones frontend).
- Test databases live in the local Docker container `row-dotnet-mysql` (port 3318): `row_dotnet` and
  `row_nest_test`, throwaway fixtures only.
