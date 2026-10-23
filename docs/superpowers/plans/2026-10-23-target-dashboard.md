# N10 Live target dashboard (2026-10-23, lane c)

Spec: build spec v4.1 build list B.1 #30 (lines 394-401) and B.3 (lines 431-437), the dashboard part only.
Plans: `2026-10-22-row-spec-remaining-build.md` section 3 row 11, `2026-10-22-web-completion.md` Phase 2 row 10.
Not built: the #29 proposal / counter / lock flow (sheet: Goal Lock / Unlock red). No goal lock or goal setting
roles code is used.

## Goal

A district dashboard of target against actual per club and in total for one Rotary year, with a filter by
Assistant Governor group, status colours and drill-in to a club. Actuals are counted live from ROW data; targets
are read from what already exists. District managers see every club, an AG sees the clubs assigned to them for
that year, a club admin sees their own club. Fast for 100+ clubs: a fixed number of set-based queries per call.

## What exists (found 2026-10-23)

- Goal setting (`goal_fields` / `goal_entries`, `GoalSettingService`): club and district entries per Rotary year.
  Club fields with a target: `new_members`, the four club Foundation fund targets (`club_total_target` is their
  sum). District fields: `new_members`, `total_contributions_target`. Club goal setting is parked in the admin
  ("Coming soon", `lib/clubGoalSetting.ts`), so club entries are empty until it returns; the district form is live.
- Wave 13A3 district goals: `district_project_target` (project count per avenue); `district_membership_goal` and
  `district_foundation_goal` duplicate goal setting and have no linked admin page.
- N3 growth: `club_growth_targets` (net growth target per club and year), joins and terminations from
  `club_members` (`GrowthService`).
- Actual data: `club_members`, District Dues (`club_dues`, `club_dues_members` roster with IsPaid), attendance
  register (`club_attendance`, `club_attendance_members`), service projects (`rotary_projects_YYYY_YY`, five
  avenues as on the AG dashboard), Foundation giving (`trf_contributions`, USD).
- AG groups: `district_ag` (AG member, club, Rotary year). Scope checks: `ScopeWriteGuardMiddleware.AllowedAsync`.

## Decisions

- No new table: targets are read, never entered here (target entry is #29).
- Metrics: members (actual only), net growth (N3 target), new members (goal setting target), District Dues paid
  (target = members on the dues roster), attendance % and meetings (actual only), service projects (actual; the
  district total uses `district_project_target`), Foundation giving USD (goal setting club fund targets).
- Totals: sums over the clubs the viewer sees. For the whole district, new members, Foundation and projects use
  the district's own goal when one is set, otherwise the sum of club targets.
- Status per metric with a target: green when progress is at least the share of the Rotary year passed (or the
  target is reached), amber at 75% of that share or more, red below; grey without a target. Club = worst metric.
- Feature `target_dashboard` (Kind.Flagged, off by default).

## Endpoints (JWT, app-ready)

- `GET api/districts/{districtId}/targets?yearId=`: district managers every club; AG their clubs for the year;
  club admin their club(s); anyone else 403.
- `GET api/clubs/{clubId}/targets?yearId=`: the club's admins, its AG, the district's managers; else 403.

## Pages (admin, behind the flag)

- `/district-admin-dashboard/targets`, `/ag-dashboard/targets` (table, AG group and status filters, search,
  drill-in panel per club), `/club-admin-dashboard/targets` (own club). Nav entry "Targets" on each dashboard.
- No public site change (the spec puts nothing on a website).

## e2e

`kb/tools/target_dashboard_e2e.py`: flag off/on, figures for a test club against SQL, status rule, AG / club
admin / member / outsider scoping, district goal in totals, timing on the largest district with synthetic rows.
Cleans up its rows.

## Left for the app

App screens for the same two endpoints (district table for DG and AG, club card for presidents).

## Done (2026-10-23)

### Files

API added: `Controllers/TargetDashboardController.cs`, `DTOs/TargetDashboardDtos.cs`, `Services/TargetDashboardService.cs`.
API changed: `Services/FeatureGate.cs` (`target_dashboard`, Kind.Flagged), `Program.cs` (DI), `Services/GrowthService.cs`
(`YearRow` and `YearAsync` internal, reused for the year lookup).
Admin added: `components/targets/TargetDashboard.tsx` (totals, AG group / status / name filters, status-coloured
table, drill-in card), `components/targets/ClubTargets.tsx` (status chip, metric tiles, club card, club loader),
`lib/targets.ts`, `lib/targets.test.ts`, pages `app/district-admin-dashboard/targets/page.tsx`,
`app/ag-dashboard/targets/page.tsx`, `app/club-admin-dashboard/targets/page.tsx`.
Admin changed: `services/api.ts` (types, `getDistrictTargets`, `getClubTargets`), the district admin, AG and club admin
`nav.ts` (Targets entry and page title; hidden while the feature is off).
e2e: `kb/tools/target_dashboard_e2e.py`. No public site change, no mobile change.

### Tables

None new, no schema change, nothing to register for privacy. Read: `club_members`, `club_growth_targets`,
`goal_entries` + `goal_fields`, `club_dues` + `club_dues_members`, `club_attendance` + `club_attendance_members`,
`trf_contributions`, `rotary_projects_YYYY_YY` + `module_master`, `district_ag`, `member_master_profile`,
`district_project_target`, `member_roles` (access).

### Endpoints (JWT, app-ready, read only)

- `GET api/districts/{districtId}/targets?yearId=`: district managers (SuperAdmin, district Admin) every active club
  and the district's own goals in the totals; an AG the clubs assigned to them for that year; a club admin their
  club(s); everyone else 403 (members of the district) or 403 from the scope guard (others).
- `GET api/clubs/{clubId}/targets?yearId=`: the club's admins, its AG, the district's managers; else 403.
- Unknown club or year: 404. Feature off: 404.

### Verification

- `dotnet build`: 0 errors, 189 warnings (the same count as before; none in the new or changed files).
- `python -I kb/tools/target_dashboard_e2e.py http://127.0.0.1:5103 3317 row_lane_c`: 52 PASS, ALL PASS, 3 runs.
  Covers the switch, every figure of a test club against SQL, the status rule, percentages, AG name and group,
  district goals in the totals (not for an AG), last year, 404s, district admin / AG / club admin / member / outsider
  scoping, 401. Timing: district with 224 clubs, 112,000 attendance rows, 2,240 giving rows, 1,120 projects and
  targets for every club: median 78 to 110 ms per call over 4 runs. Test rows removed, feature left off.
- EXPLAIN under that load: club_master and projects use range scans on their keys, attendance members use
  `fk_attendance_id`, goal entries `idx_goal_entry_club` / `idx_goal_entry_district`, AG and growth targets their
  unique keys; attendance and giving read every row of the district's clubs (all rows matched in the test).
- Regression: `scope_read_guard_e2e.py` ALL PASS; `contacts_prospects_growth_e2e.py` 89 PASS, ALL PASS.
- Admin: `tsc --noEmit` 0 errors; `vitest run` 11 files, 79 tests pass (4 new in `lib/targets.test.ts`);
  `check-design.mjs` all counts 0. The pages were not opened in a browser (next dev / build not allowed).
- API process stopped.

### Shortcuts (in code as `shortcut:`)

- Attendance divides by today's member count, not the count on each meeting date (as the club dashboard does).
- Dues means the District Dues roster (`club_dues`), not a club's own member dues (`membership_dues`).
- "On track" compares with a straight-line share of the Rotary year by the server's date; no month-wise target split
  and no district time zone.

### Open issues

- Club goal setting is parked ("Coming soon"), so club new-member and Foundation targets stay empty until it
  returns. Today a club gets a status from its N3 growth target and its District Dues roster; the district totals
  read the live district Goal Setting (new members, total contributions).
- `district_project_target` has no linked admin page (only `/districts/[id]/foundation-goal/v2/edit`, behind the
  `foundation_goals` flag), so the district project target is usually empty.
- Attendance, meetings and service projects have no club target until target setting (#29) is built.
- New members counts everyone who joined in the year (the N3 rule); goal setting's own "Achieved" counts only those
  still active, so the two can differ by members who joined and left in the same year.
- The attendance share leaves honorary members out; the club dashboard's average includes them.
- The AG page reads the selected district (`useSelectedDistrict`); an AG whose clubs are in a district they are not
  a member of gets 403 from the scope guard.
- Access reuses `ScopeWriteGuardMiddleware.AllowedAsync`, which still lists RIDirector, ZonalCoordinator and
  ClubModerator; this module follows when the main tree removes them there.
- `club_attendance` has only a `fk_club_id` index; a `(fk_club_id, fk_year_id)` index would help once many years of
  attendance accumulate.

### For the app (not built)

District table for DG and AG with totals, AG group and status filters (`GET api/districts/{id}/targets`), and the
club card for presidents (`GET api/clubs/{id}/targets`). Metric keys: members, growth, newMembers, dues, attendance,
meetings, projects, foundation; each has actual, target, percent, status (green, amber, red, none).
