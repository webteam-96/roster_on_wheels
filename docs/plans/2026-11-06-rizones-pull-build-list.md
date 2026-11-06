# What to build in ROW from the RIZones pull of 2026-11-06

**Pulled:** RIZones API and web repo moved from `cb3e678c` to `aca901bd` (24 commits). The RIZones Flutter repo has no new commits on GitHub (still `1c3cb0d`).

**Rule:** the RIZones repos are pull-only. All of this work is committed to the ROW repo only.

**Where the app list comes from:** the API changes and the two RIZones app audits dated 2026-11-06. Their audit says the Flutter repo has 141 uncommitted files, so their newest app code may add more once it is pushed.

**How this was checked:** commit messages, RIZones notes and term searches against ROW. This was not a line-by-line diff, so confirm each item against the code before building it.

## To build: web app

| # | Item | ROW now | RIZones source |
|---|---|---|---|
| 1 | Inactive zone, district or club hides everything below it in lists, reports and counts. SuperAdmin can still see them, marked Inactive | Missing, no `HierarchyScopeSql` | `2f604269` |
| 2 | Member T-shirt size: optional, never public, on member forms and reports. Sizes XS to XXXL | Only on event registrations | `1fd9970f` |
| 3 | One Business and one home address per member. "Residence" and "Residential" count as one home address | Missing, no `memberAddress.ts` | `90eb039c` |
| 4 | Public Image: cost, funding, man hours and Rotarians involved become optional | Still required on the add and edit pages | `MD_files/flutter_parity_gap_backlog_2026-11-06_assistant_donate_goal_rotary_wave.md` |
| 5 | Goal % can go above 100 | Still capped, e.g. `row/api/Services/GoalSettingService.cs:262` and `row/admin/src/components/dashboard/GoalSettingPanel.tsx:116` | `2f604269` |
| 6 | Project years always include the current year, so a club can add its first project of the year | Missing, `row/api/Services/ProjectService.cs:1066` | `0e84e724` |
| 7 | Goal group messages: district, team and broadcast groups, plus an Excel report without private chats | District goal messages only | `2f604269` |
| 8 | Club Analytics Excel: "Attendance Meeting Count" | Missing | `0e84e724` |
| 9 | Rotary.org membership import: new "Comparison to 1 July" file layout | Has an import, needs testing with a new file | `45f87be5` |

## To build: mobile app

| # | Item | ROW now | Depends on |
|---|---|---|---|
| 1 | Public Image: the same fields become optional | Still required, `row/mobile/lib/presentation/screens/clubs/modules/projects/projects_screen.dart:3382`, `:3418` | None |
| 2 | Home address: treat "Residence" and "Residential" as one | Knows only "Residential", so "Residence" rows may not show, `row/mobile/lib/data/models/member_model.dart:3` | Web 3 |
| 3 | T-shirt size on own profile, including clearing it. Only the member edits it in the app | Missing | Web 2, plus `GET /api/mobile/member-profile-options` |
| 4 | Login blocked when the club, district or zone is inactive | Missing | Web 1 |
| 5 | Goal group messages | Missing | Web 7 |
| 6 | Goal % above 100 | Not checked in the app | Web 5 |

## Suggested order

1. Web and mobile items 1 to 4, because some of them block saving or hide data today.
2. Web items 5, 6, 8 and 9, and mobile item 6.
3. Goal group messages, on web and mobile.

## Only if you choose them

| Item | Web | Mobile | Concern |
|---|---|---|---|
| Year-wise Admin Rights | Guards across controllers, grant-years dialog, per-scope switch, editable "View only" wording | Hide or block buttons outside held years | Largest item: a data migration and about 100 screens. ROW has none of it |
| New Goal Setting (Rotary.org) | New district and club pages with Rotary.org figures | Not in the RIZones app | Still a SuperAdmin-only preview in RIZones, so it may change |
| DG Sync from Rotary.org | Sync button and weekly auto-sync | Web only in RIZones | Stores a third-party login, encrypted. Check Rotary.org's terms first |
| AI Assistant | Separate chat site, index worker, vector database | Refuses mobile logins by design | Ongoing API and server costs, reads member data |

## Not needed in ROW

- Razorpay Donate page: payment gateways are off in ROW. If donations are wanted, rebuild on Stripe later.
- Cashfree PAN check: India only.
- WhatsApp logs and credit types: ROW has no WhatsApp.
- Goal roles and year rights for RI Director, Zone Coordinator and District Assistant: red on the module sheet.
- District wallet charges: wait for Stripe, because Wallet is yellow on the module sheet.
- The 11 `style(goal-overview)` commits: only useful with New Goal Setting.
- RRFC and E/MGA role designations: India-specific unless wanted.

## Already checked, nothing to do

- The open award import route (`api/zonal-awards/import`) does not exist in ROW.
- ROW adds `rcc_involved` before the trigger that uses it (`row/api/Services/DatabaseInitializer.cs:1785`, `:1975`), so it does not have that startup bug.
