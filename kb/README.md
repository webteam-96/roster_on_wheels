# ROW knowledge base

Start here instead of re-reading source code. It has two parts:

1. **Code graphs (graphify)** in `graphify-out/` (not committed; rebuild with `bash kb/rebuild.sh`).
2. **Generated comparisons and indexes** in this folder (committed, small).

## Code graphs

Six codebases, built locally with tree-sitter (`--code-only`, no LLM, no API cost):

| Tag | Path | Graph |
|---|---|---|
| row-api | `row/api` (NestJS) | `graphify-out/parts/row-api/graphify-out/graph.json` |
| row-admin | `row/admin` (Next.js admin portal) | `graphify-out/parts/row-admin/...` |
| row-club-website | `row/club-website` (Next.js public club site) | `graphify-out/parts/row-club-website/...` |
| row-mobile | `row/mobile` (Flutter) | `graphify-out/parts/row-mobile/...` |
| ref-api | `reference/RotaryIndia_Admin_API_Claude` (RIZones .NET API **plus** `rotary-frontend`, `club-website`, workers) | `graphify-out/parts/ref-api/...` |
| ref-mobile | `reference/rotary_zones_45678_flutter` (RIZones Flutter) | `graphify-out/parts/ref-mobile/...` |

`graphify-out/graph.json` is all six merged; every node has `repo` set to the tag above.
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

## Where things stand (2026-10-12, main @ eca1661)

Authoritative progress and decisions: `row/STATUS.md`, `row/api/ROW-CHANGES.md`, `row/api/PORTING.md`.

| Codebase | State | Evidence |
|---|---|---|
| row/api | 85% of .NET routes; everything missing is Payments (ClubDues, MembershipDues, EventPaymentLinks, Wallet, WebsiteBilling, public/mobile dues, ClubWebsites pricing) or deliberately not ported (Cashfree, Razorpay, Interakt, partner feeds) | `api-routes-diff.md` |
| row/mobile | 35 of 400 files changed from RIZones (API base URL, brand, icons, home screen); currency/phone/payments (WS10) pending | `mobile-diff.md` |
| row/admin | 57 of 882 files changed; mostly still the RIZones UI (STATUS §6 tasks A–C not started) | `admin-diff.md` |
| row/club-website | **0 of 65 files changed**: an unmodified copy of the RIZones club website (still has `rotaryindia.org`, `rizones45678.org` literals) | `club-website-diff.md` |

Findings not in STATUS yet:

- `reference/RotaryIndia_Admin_API_Claude` on this machine is at `64a7cd86` (2026-10-07), older than the
  `cb3e678` (2026-10-09) STATUS says ROW was synced to. The 10 ROW-only goal-setting routes
  (`district-messages/*`, `membership-import`, mobile `messages/has-unread`) come from that newer upstream.
  Diffs against the local reference under-count upstream changes made after 10-07.
- row/admin calls `/api/privacy/*` (consent, export, erase, requests) and `/api/members/me/language`.
  Neither RIZones nor the ROW API has them: ROW-only UI with no backend yet.
- row/admin still reads `rizonesCount` (API renamed it `localCount`) and `utils/goalSplitPilot.ts` has RIZones ids.
- row/mobile: 130 of the 200 `ApiConstants` entries are never referenced as `ApiConstants.x` (dead
  RIZones carry-over; some screens build paths inline instead). Several are paths no API has
  (`/api/clubs/$id/banners`, `rni-camp`, ...). `role_management_screen.dart` calls `/api/admin/roles`, which
  neither API serves (RIZones bug, kept).
- row/admin type check: 6 errors, all inherited unchanged from RIZones; builds ignore TS errors.
