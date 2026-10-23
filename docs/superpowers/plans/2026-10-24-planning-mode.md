# N7 Planning mode, elect access and cut-over (build spec 3.1, build list #1 and #5 part, 3.16 year switcher)

Lane g. Status: built (see "Done" at the end). No RI calls and no payments: RI steps go to a stub queue, booth
payment (Razorpay link) and the trial's paid conversion wait for payments.

## Goal

Done when (adapted from spec 3.1): a district in planning, its DGE invites a PE and an SE; all three edit next year's
officers, committees and calendar while the current year stays untouched; the launchpad shows progress; cut-over
flips the tenant live on the lane database; next-year officers appear in the outbound queue.
e2e `kb/tools/planning_mode_e2e.py` proves each step and the access rules (a PE edits only their own club's next
year; nobody but the DGE or a SuperAdmin runs cut-over).

## What exists (reused)

- Wave 1 task 5: `tenant_subscriptions` (state planning|live, edition, trial-less), Settings > Tenants and Editions,
  club_basic / rotaract provisioning on save (`TenantsController.SetTenant`), `PlanningWriteGuardMiddleware`
  (409 on route-`{yearId}` writes to the current year while planning; its shortcut: body/record years not covered).
- RIZones per-year data: `rotary_year_master` (global IsCurrent, `RotaryYearRolloverBackgroundService`),
  officers `board_of_directors` (fk_year_id, SyncSource 'Auto' = RI feed), `district_governors` (DG per year),
  `district_ag` (AGs per year), committees `district_committee_group` / `_group_member` / `_member` (per year),
  calendars = `upcoming_events` (club: fk_club_id; district: fk_club_id 0 + fk_district_id; the year is the one
  EventDate falls in). "District events" (`rotary_projects_YYYY_YY`) are past-event records: their date cannot be in
  the future, so they are not the planning calendar. Year switchers: `DistrictAdminYearSelector` (all years), club
  `DashboardYearSelector` (keeps a picked year for the session).
- Access: `ScopeWriteGuardMiddleware` (who manages a club / district, from member_roles), `ClubAdminAccessHelper.
  EnsureActiveClubAdminRoleAsync`, `IAuditLogService` + `AuditMiddleware`, `IEmailService` (Brevo, 30 s timeout),
  `FeatureGate` Kind.Flagged, admin `components/FeatureGate.tsx`, `Brand.TimeZone` (no district zone helper exists,
  so the brand zone is used), `RotaryYearHelper.EnsureRotaryYearAsync` (year row + year tables).

## Design

Feature flag `planning_mode` (Kind.Flagged). Off = exactly the old behaviour (Wave 1 guard only, /api/planning 404).

Year model per district tenant: the planning year P is stored on the tenant at planning start
(`planning_year_id`). Read-only year: while planning, the year before P (Wave 1 fallback: the global current year);
after cut-over, `archived_year_id` (the outgoing year). The global Rotary year is untouched.

Planning routes (`PlanningAccess`): officers (`board-of-directors` POST / PUT / DELETE / reorder), club and district
calendars (`upcoming-events`), district committees (`committee/groups`, group members, `committee/members`), AGs
(`ag`), and for the guard only the district's past-event records (`district-events`). The year comes from the route,
the query, the JSON body (`yearId`, `eventDate`, `projectDate`) or the stored record; the record must belong to the
club / district in the URL (404 otherwise).
- `PlanningWriteGuardMiddleware`: also refuses (409) writes on these routes to the read-only year, and route-year
  writes to the archived year after cut-over.
- `ScopeWriteGuardMiddleware`: when the member manages nothing here, an active elect role allows a write on a
  planning route only when every year it touches is P (plus three photo-upload routes). Elect roles: DGE, DS, DT
  (district scope), PE, SE (their own club only). AG club access via `district_ag` no longer counts rows of a year
  that has not started (a next-year AG must not edit the current year).
- Dues collection off while planning: online orders and offline recordings of read-only-year dues refused (400).

Elect roles (`planning_roles`): provisioned at planning start (DGE from the request or `district_governors` of P;
PE / SE from RI-fed next-year officers), DS / DT appointed by the DGE, PE / SE invited by the DGE by email with a
single-use accept link (token hash stored, 14 days). One live role per (district, club, year, role) by unique key.
Elect-only members may sign in to the admin (lands on /planning) and use Forgot password.

Cut-over (DGE or SuperAdmin; scheduled 1 July 00:00 in the brand zone, job every 15 min): state live, archived
year = the year before P, active elect roles become member_roles (DGE / DS / DT district Admin, PE / SE club Admin),
pending invites revoked, collections on (state live), RI stub rows in `ri_outbound_queue` (officer pushes for P's
officers with the six RI titles, primary vendor per authorised club, one reconciliation). Nothing drains the queue.

Trial: `trial_ends` on the tenant; SuperAdmin starts a 60-day trial and converts it (clears the date, no data
touched). Expiry only shows; no lock-out.

## Tables

`tenant_subscriptions` + planning_year_id, cutover_at, cutover_done_at, archived_year_id, trial_ends ·
`planning_roles` · `ri_outbound_queue`. DatabaseInitializer.Planning.cs; schema.sql (new tables) and
schema-drift.sql (tenant columns). Both new tables registered in PersonalDataRegistry.

## Endpoints (`/api/planning`, flag-gated)

GET state?districtId=|clubId= · GET me · GET districts/{d} (overview + launchpad) · POST districts/{d}/start (SA) ·
POST districts/{d}/appointments (DGE / SA) · POST districts/{d}/invites (DGE / SA) · DELETE districts/{d}/roles/{id}
(DGE / SA) · POST districts/{d}/cutover (DGE / SA) · POST invites/accept (anonymous token, rate-limited).
Tenants: POST tenants/{d}/trial, POST tenants/{d}/convert-trial (SA, flag-gated); trial and planning fields in
GET tenants/{d}. District goals: the DGE may save P's membership goal through the existing endpoint.

## Admin

/planning (next-year workspace: banner, launchpad, team and invites, cut-over, next-year officers, committees,
calendar and goal editors on the existing endpoints), /planning/accept/[token] (public), planning banner in the
district and club dashboards (switch the year to P), Settings > Tenants planning and trial card.

## Tasks

1. Schema + flag + PlanningAccess + guards → dotnet build.
2. PlanningService + controller + cut-over job + trial + dues + login/landing → dotnet build.
3. e2e planning_mode_e2e.py → all PASS; scope_read_guard still PASS (tenant_lifecycle_e2e is hard-wired to
   row_local and passwords, so its Wave 1 checks are repeated in planning_mode_e2e).
4. Admin pages → tsc, vitest, check-design.
5. Review the diff against the rules; Done section.

## Done (2026-10-23, lane g)

Built as designed above, behind `planning_mode` (off by default).

API: `Services/PlanningAccess.cs` (planning routes, year resolution, elect access, read-only year, dues check),
`Services/PlanningService.cs`, `Controllers/PlanningController.cs`, `Services/PlanningCutoverBackgroundService.cs`
(registered with the background jobs; `Planning:CutoverJob=true` runs it alone on a dev copy),
`DTOs/PlanningDtos.cs`, `Services/DatabaseInitializer.Planning.cs`; changed: `PlanningWriteGuardMiddleware`,
`ScopeWriteGuardMiddleware` (elect fallback; future-year AG rows), `TenantsController` (trial, convert-trial,
planning fields), `AuthService` (elect sign-in and password reset), `DashboardResolverController` (/planning
landing), `DistrictAdminDashboard*` (DGE sets next year's goals; read-only year refused), dues services (collection
off), `FeatureGate`, `PersonalDataRegistry`, `Program.cs`, schema.sql, schema-drift.sql.

Admin: `app/planning/page.tsx`, `app/planning/accept/[token]/page.tsx`, `components/planning/*` (DistrictPlanning,
NextYearDistrict, ClubPlanning, MemberPicker, PlanningBanner, PlanningParts, TenantPlanningCard), `lib/planning.ts` +
test, `types/planning.ts`, banner in both dashboard layouts, card on Settings > Tenants, api.ts functions.

Verified: dotnet build 0 errors (no warnings in the new or changed lines); `planning_mode_e2e.py` 100 PASS / ALL PASS
(cleans up every row it writes); `scope_read_guard_e2e.py`, `feature_gate_e2e.py`, `grants_e2e.py` ALL PASS; the
scheduled cut-over ran from the job on the lane database (tenant live, outgoing year archived, DGE made district
admin, queue rows, audit "scheduled"), test rows removed; admin tsc 0, vitest 19 files / 108 tests, check-design all 0.

Shortcuts (each has a `shortcut:` comment): planning routes cover officers, calendars, committees, AGs and district
goals only; PETS / SETS found by event title; an event counts for "calendar published" once dated in the year; the
planning lists read the first 100 committees / events; trial expiry only shows (no lock-out); other body-year
routes are not guarded.

Not built (out of scope or waiting): booth payment (Razorpay link), the trial's paid conversion payment, RI
registration / outbound sending / reconciliation (stub queue only), the app screens (API ready: GET /api/planning/me,
GET /api/planning/state, POST /api/planning/invites/accept, plus the existing routes with elect access), roster
snapshot import (spec 3.2), compare view.
