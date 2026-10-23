# Escalation ladder, target celebration, Foundation link, DPA page (2026-10-24, lane h)

Spec: build spec v4.1, B.1 #32 (escalation alerts), B.3 (escalation ladder), B.1 #35 and B.4 (target celebration),
Appendix B note (Foundation giving link as a per-tenant variable), 3.14 (DPA template linked from sign-up).

## What exists (checked 2026-10-24)

- N10 `TargetDashboardService`: target against actual per club for the current Rotary year; per metric a status
  (green, amber, red, none) against the share of the year passed; the club's status is the worst of its metrics.
  Targets: N3 growth (`club_growth_targets`), goal setting `new_members` and the four fund targets, District Dues
  roster. Flag `target_dashboard`.
- N8 `MeetingsService.GetComplianceAsync(district, club, month)`: required meetings per month (district default or
  club override, `meeting_rules`) against meetings held; status `missed` once the month is over. Flag `meetings`.
- N9 `engagement_events`: one row per milestone or PHF, UNIQUE `dedupe_key` (the sent-log), spotlight card status on
  the same row, queue and approval in `EngagementController`, PNG by `ProjectShareCardBuilder`. Flag `engagement`.
- AG module: `district_ag` (one AG per club and Rotary year). DG: `district_governors` + `DistrictGovernorSql`
  (member or non-member with own email). Club President: `board_of_directors` + `designation_master`.
- In-app feed: `MobileNotificationFeedService`, a live UNION of legs; per-recipient rows (grant notifications) are the
  pattern for messages to one member.
- Email: `IEmailService.SendScopedEmailAsync` (email_log with club and district).
- N5 `CommsTemplates`: per-language templates, `{{placeholder}}` fill, Governor note in `comm_settings`; the
  GreetingsWorker compiles the same file. Greeting templates: keys `birthday`, `anniversary`.
- Legal pages: `/privacy-policy`, `/terms-and-conditions`, `/cookies` (public, `PolicyPageLayout`); footers
  `PublicFooter` (policy pages) and `FooterBottomBar` (site pages). Tenant onboarding: Settings > Tenants (SuperAdmin).
  Members never sign up (Rotary.org sync), so the tenant onboarding screen is the sign-up moment for a DPA.

## Design

### Escalation (flag `escalation`)

- `escalation_rules` (one row per district): `target_status` (`red`, or `amber` = amber or red; NULL = rule off),
  `meeting_shortfall` (fire when a finished month has at least this many meetings fewer than required; NULL = off),
  `ag_delay_days`, `dg_delay_days` (1 to 60). No row, or both rules NULL = the district gets no alerts.
- `escalation_alerts`: the log, one row per level sent: district, club, rule (`target` | `meetings`), period
  (`YYYY-MM`), level (1 club president, 2 Assistant Governor, 3 District Governor), recipient member (NULL when nobody
  holds the role or the DG is not a member), reason text, email status, created date. UNIQUE (club, rule, period,
  level) is the idempotency key: the row is claimed with INSERT IGNORE before anything is sent.
- Daily pass per district with rules:
  - meetings rule (needs flag `meetings` on): the previous calendar month; clubs `missed` with shortfall at or above
    the threshold open a case at level 1, period = that month.
  - target rule (needs flag `target_dashboard` on): clubs whose status is red (or amber/red) open a case at level 1,
    period = the current month (a club still behind next month gets a new case).
  - open cases advance: when the last level was sent at least the level's delay ago and the club still fails the rule
    (meetings: that month is still missed; target: the club's status today), the next level is sent. A club that
    caught up stops climbing. Level 3 is the last.
- Delivery: email (English; respects N5 suppressions and email opt-out when N5 is on) and an in-app feed item for
  the recipient (feed type `escalation`, from the alert row). Every alert is logged even when nobody could receive it.
- Endpoints: `GET|PUT /api/districts/{id}/escalation/settings`, `GET /api/districts/{id}/escalation/alerts`
  (district managers), `POST /api/escalation/run?districtId=` (SuperAdmin; the daily job runs the same pass).
- Admin: `/district-admin-dashboard/escalation`: rules form and the alert log.

### Target celebration (flag `celebration`)

- A club reaches a target when a metric with a target above 0 (growth, new members, District Dues, Foundation
  giving) has actual >= target. Once per target: an `engagement_events` row of type `TARGET` with dedupe key
  `TARGET:{club}:{year}:{metric}:{target}` (a raised target is a new target). Two additive changes to
  `engagement_events`: `target_key` column, `fk_member_master_profile_id` NULL-able (TARGET rows belong to a club).
- On the insert: the club's members see an in-app item (feed type `celebration`, gated by the flag), the District
  Governor gets an email note, and the row's spotlight card waits for approval in the N9 queue (Engagement page,
  flag `engagement`).
- Endpoint: `POST /api/celebration/run?districtId=` (SuperAdmin; the daily job runs the same pass).

### Foundation giving link (no new flag)

- `comm_settings.foundation_giving_url` on the district row (https, at most 500 characters; empty = no link), edited
  on the district's Email Settings page (N5, flag `communication`).
- `{{foundation_link}}` in the `birthday` and `anniversary` templates (GreetingsWorker; a club uses its district's
  link). `{foundation_link}` in the N9 Governor milestone message; the default milestone text adds a link line when
  the district has one.

### DPA page

- `/data-processing-agreement`: public (no sign-in), marked "Draft, legal review required", standard contractual
  clauses wording as a template with blanks for the parties, hosting location and sub-processors; claims limited to
  what ROW does. Linked from Settings > Tenants (onboarding), `PublicFooter` and `FooterBottomBar` next to Terms and
  Privacy.

## Tasks

1. Schema (DatabaseInitializer partial + schema.sql) and FeatureGate entries. Verify: build.
2. EscalationService + controller + daily job + feed leg + PersonalDataRegistry + audit entity names. Verify: e2e.
3. CelebrationService + feed leg + Engagement queue showing TARGET cards. Verify: e2e.
4. Foundation link: CommsService setting, CommsTemplates helper, GreetingsJob, EngagementService. Verify: e2e
   (settings, milestone email, GreetingsWorker dry run).
5. Admin: escalation page, Foundation link field, placeholders, DPA page and links. Verify: tsc, vitest,
   check-design.
6. e2e `kb/tools/escalation_celebration_e2e.py`; regression `scope_read_guard_e2e.py`.

## Done (2026-10-24)

### Files

Added:
- `row/api/Services/EscalationService.cs`: rules (validate, read, save), the daily pass (open cases climb a level when
  the delay has passed and the club still fails; new failures open at level 1), recipients (club president, AG, DG),
  the alert email, and `TargetAlertsBackgroundService` (hourly tick; escalation and celebration once a day from 08:00
  brand time, each retried next hour on failure).
- `row/api/Services/CelebrationService.cs`: the daily celebration pass (TARGET rows in engagement_events, one note per
  district and pass to the DG), texts for the app, the queue and the card.
- `row/api/Controllers/EscalationController.cs`: settings, alert log, SuperAdmin runs for both passes.
- `row/api/Services/DatabaseInitializer.Escalation.cs`: the schema below.
- `row/admin/src/components/escalation/EscalationPanel.tsx`, `row/admin/src/app/district-admin-dashboard/escalation/page.tsx`,
  `row/admin/src/lib/escalation.ts` + `escalation.test.ts`.
- `row/admin/src/app/data-processing-agreement/page.tsx`: the DPA template (public).
- `kb/tools/escalation_celebration_e2e.py`.

Changed:
- API: `FeatureGate.cs` (flags `escalation`, `celebration`), `TargetDashboardService.cs` (`GetDistrictForJobAsync`),
  `MobileNotificationFeedService.cs` (feed types `escalation`, `celebration`), `EngagementController.cs` (TARGET cards
  in the queue, highlights and card image), `EngagementService.cs` (`{foundation_link}` in the Governor milestone
  message, a link line in the standard text), `CommsService.cs` + `CommsDtos.cs` + `CommsController.cs` (district
  setting `foundationGivingUrl`, validated, audited), `CommsTemplates.cs` (`FoundationLinkAsync`, shared with the
  worker), `PersonalDataRegistry.cs`, `AuditMiddleware.cs` (entity names), `ScopeWriteGuardMiddleware.cs` (runs are
  SuperAdmin only), `Program.cs`, `DatabaseInitializer.cs` (calls the partial), feed docs in
  `MobileNotificationsController.cs` and `MobileNotificationDtos.cs`.
- Worker: `GreetingsJob.cs` fills `{{foundation_link}}` in birthday and anniversary templates.
- `row/database/schema.sql`: 2 tables, 2 columns, 1 column made NULL-able.
- Admin: `services/api.ts`, district `nav.ts` (Escalation Alerts), `CommsSettings.tsx` (Foundation giving link field),
  `lib/comms.ts` (+ test: placeholder hint, link rule), `EngagementPanel.tsx` (TARGET cards, `{foundation_link}` hint),
  DPA links in `PublicFooter.tsx`, `FooterBottomBar.tsx`, Settings > Tenants; `AppHeader.tsx` hides its header there.

### Tables

- `escalation_rules` (one row per district; no row or both rules NULL = no alerts).
- `escalation_alerts` (UNIQUE club, rule, period, level; indexes on district and recipient).
- `engagement_events`: `target_key` added, `fk_member_master_profile_id` NULL-able (TARGET rows).
- `comm_settings`: `foundation_giving_url` added.

### Endpoints

- `GET|PUT /api/districts/{id}/escalation/settings`, `GET /api/districts/{id}/escalation/alerts?clubId=&rule=`
  (district managers; flag `escalation`).
- `POST /api/escalation/run?districtId=`, `POST /api/celebration/run?districtId=` (SuperAdmin; flags).
- `GET /api/mobile/notifications` returns types `escalation` (to the recipient) and `celebration` (to the club's
  members) while the flags are on. `GET|PUT /api/districts/{id}/comms/settings` carries `foundationGivingUrl`.

### Verification

- `dotnet build` (API): 0 errors, 128 warnings, the same count as before the change, none in the new or changed files.
  `dotnet build` (GreetingsWorker): 0 errors, 0 warnings.
- `python -I kb/tools/escalation_celebration_e2e.py http://127.0.0.1:5108 3317 row_lane_h` with
  `ROW_E2E_GREETINGS_DLL` set: 81 PASS, 0 FAIL (ladder timing, threshold, idempotency, nobody in the role, catch-up
  stops the ladder, access rules, log, celebration once per target and again for a raised target, card queue, the
  Foundation variable in the settings, the milestone email and the GreetingsWorker dry run; clean-up check).
- Regression on the same API: `scope_read_guard_e2e.py` 7 PASS, `engagement_e2e.py` 44 PASS,
  `target_dashboard_e2e.py` 52 PASS, `meetings_links_compliance_e2e.py` 43 PASS, `communication_upgrades_e2e.py` 70 PASS
  (API restarted with the fake Brevo and DNS ports it needs, greeting worker run included).
- Admin: `tsc --noEmit` 0 errors; `vitest run` escalation, comms, engagement, meetingCompliance, FeatureGate, i18n
  config: 17 passed; `node scripts/check-design.mjs` all zero.
- The lane API was stopped; row_lane_h holds no rows or switched-on flags from the tests (audit_log keeps its rows).

### Shortcuts (each also a `shortcut:` comment in the code)

- A failed alert email or DG note is not retried; the row is the claim and email_log shows the failure.
- Alert emails are English; move them to an N5 template key when districts want them in their language.
- The alert log returns the newest 500 rows, no paging.
- The celebration pass reads every active district's dashboard once a day; limit it to districts with club targets if
  it gets slow.

### Open issues

- First switch-on of `celebration`: every target already reached this Rotary year is celebrated at once (no history
  of when it was reached). The DG gets one note per district and pass, but the club feeds and the card queue fill up.
- A district that turns on the meeting rule while its clubs do not record meetings in ROW alerts every club; the DG
  gets one email per club at level 3 (one per alert, by design of the log).
- Alerts and the DG note go to real office holders' addresses; the target rule needs `target_dashboard` on, the
  meeting rule `meetings` on (the settings page says so).
- DPA: legal review required; hosting provider and region, backups, breach timing and liability are blanks. The live
  page translator (LiveTranslate) sends on-screen text, which can include personal data, to the configured machine
  translation service (default MyMemory); it is listed as a sub-processor, and counsel should decide whether it stays
  on for signed-in pages.
- "Sign-up" is read as tenant onboarding (Settings > Tenants): members never sign up, so the members' consent dialog
  was left as it is.

### Left for the app

- Feed types `escalation` (deep link type `escalation_alert`, entity = alert id) and `celebration` (deep link type
  `target_celebration`, entity = engagement event id). The app shows them as generic "Update" rows today.
