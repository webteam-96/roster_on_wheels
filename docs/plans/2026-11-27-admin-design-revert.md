# Admin: revert the design to 24 Nov, keep every feature (owner, 27 Nov 2026)

Owner, 27 Nov: the admin redesign is not wanted ("revert back to the design as it was when you started changing the design").
The **mobile app redesign stays** (owner likes it). The API is not touched. Started on 27 Nov with agents, stopped by the owner
before anything was changed for good (the tree was restored); this plan is for doing it at home.

## Target

The admin must **look** as at commit **`dcfbb8fa`** (24 Nov 2026 12:45, "fix: OMS ROW-56 to ROW-69 and ROW-93 re-check"),
the last commit before the redesign. Every **feature and fix** made since must stay.

Design work to undo (all in `row/admin`):

| When | What | Where it is recorded |
|---|---|---|
| 25 Nov | "Admin look and motion": colours, fonts, radius, cards, motion, white made off-white | `row/ROW-CHANGES.md` 2026-11-25 "admin look and motion", `row/website/design.md` 8.7 |
| 25 Nov | "Fixed layout and shared components": `ShellFrame` / `TopBar` / `AppFrame`, one `PageHeader` per page, button and card rules, codemods (`_local/qa/admin-tools/cls.cjs`, `comp.cjs`, `fld.cjs`, `tpl.cjs`, `hdr.cjs`, `hoist.cjs`) | ROW-CHANGES 2026-11-25 "fixed layout", design.md 8.9 |
| 27 Nov | Shared-part swaps on every page (about 570 buttons, 180 tables, selects), new parts (`ui/text-buttons`, `ui/data-table`, upload / tile / calendar / radio parts), 23 long pages split into pieces (wave 3), the 6 v2 project forms merged into `app/clubs/[id]/_project-form/` | ROW-CHANGES 2026-11-27, `docs/plans/2026-11-26-admin-components-finish.md` |

## Features and fixes to keep (re-apply on the old markup)

Read ROW-CHANGES 2026-11-24 to 2026-11-27 in full. The admin ones:
- 24-25 Nov: OMS ROW-56 to ROW-69 / ROW-93 re-check follow-ups (growth cards follow the search, etc.), currencies and local
  amounts (`components/payments/LocalAmountNote.tsx`, Settings > Currency), payment simulator lock, admin member form fixes
  from the 25 Nov app member test (postal codes with letters, no India default, locked blank fields do not block a save).
- 27 Nov RIZones port: Edit Years dialogs (club members, district members, district membership directory, club dashboard
  directory), Settings > QR Attendance page (new page), OCV/GOV year-free categories (`clubs/[id]/ocv-gov/v2/[categoryCode]/view.tsx`).
- 27 Nov new goal flow: all new files (`components/goal-flow/*`, `components/RccClubsList.tsx`, `RccGoalsTable.tsx`,
  `app/**/district-set-goals`, `app/**/rcc*`, `app/**/disha-goals`, `services/goalFlowApi.ts`, `dishaApi.ts`,
  `lib/dsgGoalChanges.ts`, `lib/rccGoals.ts`, `lib/goalRotaryLayout.ts`), menu entries and page titles in both `nav.ts`,
  `DistrictAwardsModule` per-unit points, `RotaryOrgSync` year picker + cancel. These new pages may keep the new parts.
- 27 Nov bugs: ROW-94 (club Foundation designations assign / remove), ROW-95 (API only), ROW-96 (Engagement empty state outside
  the table), ROW-97 (Contacts selects), ROW2-1 (Youth Programs memoised scope), ROW2-2 (District Dues error card + wording),
  sub-group edit sends `yearId`, district payment link (API only).
- 27 Nov live-test fixes: RCC links + ported `rcc/clubs/goals` page, District Set Goals banner text, goal table min-width,
  district page titles + `nav.test.ts`, Targets empty district, club scope prefers an administered club (`lib/scopePick.ts`,
  `AuthContext.tsx`), top bar shows the club in the URL, one `<main>` (`RootShell.tsx`), documents validate before upload (8
  add/edit pages), Clear goal on district goal pages (`services/districtGoalsApi.ts`), project / event edit year fallback
  (`lib/useYearIdParam.ts`), dialog focus return (`components/ui/dialog.tsx`), accessible names on icon buttons.
- Logic that is not design and stays as it is: `src/contexts`, `src/lib`, `src/services`, `src/hooks`, all tests.

## Method

Snapshots to compare against:
- `git show dcfbb8fa:row/admin/src/<path>`: the target look.
- `_local/backups/admin-src-2026-11-25-pre-layout/`: 25 Nov after "look" but before "fixed layout".
- `_local/backups/admin-src-2026-11-26/src/`: 27 Nov morning (before today's swaps).
- git `main` (`67e0d653`): today's final state.

Size: 837 admin files changed since `dcfbb8fa` (668 changed, 166 added, 3 deleted). Per file:
1. Diff `dcfbb8fa` against now. Drop DESIGN changes (class names, colours, spacing, shared-part swaps, header / layout rewrites,
   motion, wave-3 split pieces). Keep FEATURE / FIX changes (API calls and payloads, fields, state, validation, routes, links,
   menu entries, permissions, gating, shown data, aria-labels).
2. File changed only by design: `git checkout dcfbb8fa -- <path>`.
3. Mixed file: start from the `dcfbb8fa` version and re-apply the feature hunks in the old markup.
4. File new since `dcfbb8fa`: keep if it is a feature (new page, service, lib, test); delete if it is a wave-3 piece of a page
   you restored (after folding any feature change back into the page).
5. Order: first the look layer (`app/globals.css`, `tailwind.config.ts`, `components/ui|row|form`, `components/dashboard` frame
   files, the three `*LayoutClient.tsx`, `RootShell.tsx`, `nav.ts` files keeping the new entries), then pages by area.
   Keep the new shared parts as files (new feature pages import them) but style them with the old tokens.
6. `src/lib/designParts.test.ts`: back to its `dcfbb8fa` content (or drop the count checks).

Agent briefs used on 27 Nov (lanes R0 look layer, R1 club pages a-e, R2 club pages f-z + `_project-form`, R3 settings / admin /
members / public, R4 districts / AG / goal panels, R5 club dashboard + other components): `_local/qa/briefs/revert-brief.md`.

## Done when

- The main pages look like `dcfbb8fa`: compare screenshots of the same pages (club dashboard overview, a club list page, a
  club form, district overview, settings home, District Dues, member edit) from a build of `dcfbb8fa` and from the new build.
- Every feature above still works: `npx tsc --noEmit -p .` 0, `npx vitest run` all pass, `dotnet test row/api.Tests`, the
  382-page crawl (`_local/qa/tools/crawl_final.py all 1440` and `375`, run from `_local/qa/admin-tools`) clean, and the form
  checks (`_local/qa/tools/forms/`, `_local/qa/tools/wiz_*.py` for the three payment wizards; sign-in token helper
  `_local/qa/tools/tok_source.py`).
- `row/website/design.md` 8.7 to 8.9 marked as withdrawn for the admin; ROW-CHANGES and HANDOFF updated.

## Risks

- Go-live is 30 Nov: this touches about 840 files. Do it on a branch, test as above, deploy only after the crawl and the form
  checks pass. Keep today's commit as the rollback.
- Some 25 Nov look changes were the owner's own requests (e.g. "buttons too round", "white too bright", "different header on
  every page"); confirm with the owner whether any of those should survive.

Estimate: 4 to 6 hours with agents, plus 1 to 2 hours of testing.

## Other open items (27 Nov evening, from live testing)

Deploy first: the test server runs the build from before the live-test fixes. Rebuild the API and admin from `main` and upload
them (as in the 25 / 27 Nov deploy steps: the server keeps its own `web.config` / `appsettings`; set `AttendanceQr__Secret`).
Then clear district 5656's test goals left on production by the live form test: membership goal (7 / 7 / 7%) and Foundation
goal (7 / 7 / 7) for 2026-27, with the new "Clear goal" button (or `isdeleted = 1` on `district_membership_goal` pk 5 and
`district_foundation_goal` pk 1).

### Mobile app (`row/mobile`), from the app test on the emulator (Club Tester)
1. **Pay District Dues detail shows raw `<p></p>`** under "Test Club Dues · District 5656": `purposeDescription` is printed as
   plain text (`lib/presentation/screens/club_dues_pay/club_dues_pay_screen.dart:264-267`). Render or strip the HTML; hide the
   line when it is empty.
2. Sub Groups: "Club President | 0 members" although Board of Directors lists the Club Tester as Club President; "1 members".
3. My Club Website / Website Data: unexplained "Yes" badge next to "Club Website"; "Expiry 2027-11-04" is a raw ISO date.
4. Date styles differ: Mass Email "Nov 23, 2026" vs avenue lists "18 Nov 2026". Screens with their own `DateFormat` (calendar
   widgets, club info, district events, event payment links, club finder detail, club report) should use the shared formatter.
5. Weblinks cards show "0" and "#0" with no label.
6. District calendar title is just "5656" (better "District 5656").
7. Screens that still ignore the `OpenFilex.open` result (no message when no app can open the file):
   `ag_reports_screen.dart:218`, `live_documents_screen.dart:185`, `district_reports_screen.dart:969`,
   `club_report_screen.dart:217`, `core/services/monthly_report_pdf.dart:94`, `monthly_report_word.dart:107`.
8. Not checked yet: Goal Setting Youth / Foundation tabs, Rotary Network sub-pages, drawer items below Surveys (Donations,
   Member map, Business directory...), the Thane City View club tiles, times for a viewer outside India.

### Admin web
1. Wider than a phone (375 px): About us and Contact us (16 px), District Set Goals (88 px).
2. Dialogs with empty required fields only disable Save without saying why (social links, banners, ads, menu, committee
   member / group / sub-group, AG, quick-links sub-group, district group page).
3. A document file can still be orphaned if the upload succeeds but the create / update call then fails (server cleanup).

### Decisions for the owner
1. **ROW2-3 (= ROW2-1), Youth Programs 403:** by design only the appointed district youth chair (and club youth officers)
   see youth records; proven on live (appointed as chair: 200; removed: 403). District 5656 has no chair. Should a DG /
   District Admin see them without being appointed? (`row/api/Controllers/YouthController.cs`.)
   **ROW2-4 (= ROW2-2), District Dues 500:** fixed and confirmed on live (200).
2. Club admins see the add-member form but only Super Admin may add (403): hide the form or allow club admins?
3. Upcoming events list defaults to "Published", so a newly saved future event is not listed: switch the filter after save?
4. Engagement: a one-off catch-up of older milestones (ROW-96)?
5. Web Edit Years dialog always pre-ticks the current year (the app ticks only grantable years).
6. Terminated members page lets an admin terminate themselves.
7. Deleting an active payment link answers 500 (should be 400; the page already disables it).
8. 12 service-project forms were not save-tested on live: a new project sends a push to the club's members within a minute
   (`row/api/Services/Push/ProjectPushBackgroundService.cs:59`).
9. Not tested on live: Super Admin (no login), AG (`web+ag@kaizeninfotech.com` does not sign in with the test password),
   Super Admin role config (needs `SuperAdminApproval:OtpEmail` and email), committee email form (sends real email).
10. Image files missing on the test server (`/Documents/...`, `/uploads/banner`, `/uploads/advertisement`): copy the upload
    folders from the old server.
