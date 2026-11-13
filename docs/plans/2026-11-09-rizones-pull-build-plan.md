# Build plan: RIZones pull of 2026-11-06

Source list: `docs/plans/2026-11-06-rizones-pull-build-list.md`. Branch: `feat/rizones-pull-2026-11-06`.
Order set by the owner on 2026-11-09: the 9 web items, then the 6 mobile items, then the 4 optional items.
RIZones is copy-source only. Port the design and code, never its data, branding or India-only parts.

## How each item is done

1. Read the RIZones commit for the item (`git show <sha> -- <path>` in `reference/RotaryIndia_Admin_API_Claude`).
2. Find the same place in ROW (graphify query, then grep). ROW removed modules, so skip call sites that do not exist.
3. Port it. Schema changes go in `DatabaseInitializer` as idempotent `ADD COLUMN IF NOT EXISTS`-style steps, plus a
   dated script in `row/database/maintenance/` for production (run only with the owner's go-ahead).
4. Check: `dotnet build`, admin `tsc` + `vitest` + `check-design`, app `flutter analyze`, then a short e2e or
   manual check on `row_prod_copy`.
5. Log it in `row/ROW-CHANGES.md` and tick it below.

## Phase 1: web (9 items)

Done in this order: small fixes first, so nothing blocks saving while the big items are built.

| Step | Item | Size | Notes |
|---|---|---|---|
| 1.1 | W4 Public Image fields optional | S | API validation + admin add/edit pages |
| 1.2 | W5 Goal % above 100 | S | Remove the caps in `GoalSettingService.cs` and `GoalSettingPanel.tsx`; bars stay capped at full width |
| 1.3 | W6 Project years include the current year | S | `ProjectService.cs` year list |
| 1.4 | W2 Member T-shirt size | S | New nullable column, member DTOs, forms, report column. Never in public endpoints |
| 1.5 | W8 Club Analytics "Attendance Meeting Count" | S | Excel column |
| 1.6 | W3 One Business + one home address | M | Shared rule (`memberAddress.ts` + API), "Residence" = "Residential" |
| 1.7 | W1 Inactive zone / district / club cascade | L | Port `HierarchyScopeSql`; apply to lists, reports, counts, search, public sites, push and email audiences. Master listings still show inactive rows, marked Inactive. Nothing is written to child rows |
| 1.8 | W9 Rotary.org import "Comparison to 1 July" layout | S-M | Port the header mapping; test needs a real file from the owner |
| 1.9 | W7 Goal group messages | L | District, team and broadcast groups + Excel report without private chats |

## Phase 2: mobile (6 items)

| Step | Item | Depends on |
|---|---|---|
| 2.1 | M1 Public Image fields optional | W4 |
| 2.2 | M2 "Residence" = "Residential" | W3 |
| 2.3 | M3 T-shirt size on own profile (set and clear) + `GET /api/mobile/member-profile-options` | W2 |
| 2.4 | M4 Login blocked when the club, district or zone is inactive | W1 |
| 2.5 | M6 Goal % above 100 | W5 |
| 2.6 | M5 Goal group messages | W7 |

## Phase 3: optional items (owner chose all four)

Each needs owner decisions before code starts. They are asked when the phase starts, not now.

| Step | Item | Size | Decisions needed |
|---|---|---|---|
| 3.1 | Year-wise Admin Rights | XL | Data migration on production (backup first); default for existing admins (all years or current year only) |
| 3.2 | New Goal Setting (Rotary.org) | L | Still a SuperAdmin preview in RIZones; port as preview behind a FeatureGate flag that is OFF |
| 3.3 | DG Sync from Rotary.org | L | Rotary.org terms allow automated login? Encryption key location (server `web.config` only) |
| 3.4 | AI Assistant | XL | LLM provider and key, vector DB hosting (RIZones: Qdrant), monthly cost cap, which member data it may read |

## Progress

- [x] 1.1 W4
- [x] 1.2 W5
- [x] 1.3 W6
- [x] 1.4 W2
- [x] 1.5 W8
- [x] 1.6 W3
- [x] 1.7 W1
- [x] 1.8 W9 (code ported; needs a real Rotary.org file to test)
- [-] 1.9 W7 skipped (owner 2026-11-09): groups need the goal oversight roles ROW removed; district goal messages already cover DG, Admins and SuperAdmin. M5 skipped too.
- [x] 2.1 M1, 2.2 M2, 2.3 M3, 2.4 M4 (API guard; app already shows the refusal), 2.5 M6 (no app change: the app shows the API value)
- [-] M5 skipped with W7
- [x] 3.1 Year-wise Admin Rights: existing admins get ALL years, rule ships OFF (owner 2026-11-09). API, migration, web and app done
- [x] 3.2 New Goal Setting: a simple ROW page (figures, reports, DG Sync) instead of the upstream pages; module off by default, SuperAdmin switches it (owner 2026-11-09)
- [x] 3.3 DG Sync: worker + API; its panel is on the 3.2 page, same module switch (owner 2026-11-09)
- [x] 3.4 AI Assistant: built without keys, behind an OFF flag (owner 2026-11-09)
