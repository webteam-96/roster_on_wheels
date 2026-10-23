# N9 Engagement: milestones, PHF highlights, spotlight cards (2026-10-23, lane a)

Spec: build spec v4.1, build list B.1 #26, #27, #28, B.2 (recognition), B.5 (depends on designations and join dates,
3.12, built in this lane as N1). Not in this module: escalation ladder (#32) and target celebration (#35), which need
targets and meeting compliance from other lanes.

## Goal

1. Milestone job: once a day, members whose 1, 3, 5 or 10 year join anniversary has come round get a congratulations
   email and an in-app feed item, once per member and milestone (a sent-log row with a unique key, written before
   the email goes, so a restart never sends twice). The milestone list is set per district; a district can add a
   Governor message (a district template signed by the current District Governor) used instead of the default text.
   Email and in-app only; the email honours the existing privacy consent filter. Language: tenant default, with one
   marked hook for the member language preference (another lane).
2. PHF highlights: a new Paul Harris Fellow designation (or a multiple, PHF+1 to +8) from N1 creates a highlight: an
   in-app feed item for the member's club, and a list endpoint per club and district that the bulletin and the
   greetings can pull.
3. Spotlight cards: one branded 1200x630 image per milestone or PHF highlight, rendered by ProjectShareCardBuilder
   (QuestPDF, no new dependency), queued for admin approval (pending, approved, rejected), downloadable from the
   admin once approved. No posting to social platforms.

## What exists (checked 2026-10-23)

- Join dates: `club_members.JoinedDate` (every active row has one; no member has two active clubs in the data).
- Designations: `member_foundation_designations` (N1). Nothing reacts to a new one yet.
- In-app feed: `MobileNotificationFeedService` is a live UNION over source tables (no stored feed rows). A new leg
  reading a new table is the way to add items. The app renders an unknown type as a generic "Update" row.
- Email: `IEmailService.SendScopedEmailAsync` (logs to email_log with the club and district). Consent:
  `PrivacyConsent.BroadcastFilter`. No milestone, highlight or spotlight code exists, here or in RIZones.
- Image: `ProjectShareCardBuilder` renders the project share card with QuestPDF.
- Governor: `district_governors` per district and Rotary year, read with `DistrictGovernorSql`.

## Tables

- `engagement_events`: one row per milestone or PHF highlight. `dedupe_key` UNIQUE (`MILESTONE:{member}:{years}`,
  `PHF:{designation id}`) is the sent-log; member, club, district, designation, level (years or PHF level),
  occurred_on, spotlight card status, decided by and when. Registered in PersonalDataRegistry (export, erase deletes).
- `engagement_district_settings`: per district: milestone years (default 1,3,5,10; empty = off), Governor message.

## Endpoints (flag `engagement`)

- `GET /api/{clubs|districts}/{id}/engagement/highlights?days=90`: recent milestones and PHF highlights (members of
  the club or district read; the bulletin, greetings and the app use it).
- `GET /api/{clubs|districts}/{id}/engagement/cards?status=pending|approved|rejected`: spotlight queue (managers).
- `GET /api/engagement/spotlight-cards/{id}/image?download=true|false`: PNG; download only once approved (managers).
- `POST /api/engagement/spotlight-cards/{id}/approve`, `.../reject` (managers of the event's club or district).
- `GET|PUT /api/districts/{id}/engagement/settings` (district managers).
- `POST /api/engagement/run?districtId=` (SuperAdmin): run the daily pass now.
- Feed: `GET /api/mobile/notifications` gains type `highlight` while the flag is on.

## Admin pages

- `/club-admin-dashboard/engagement`, `/district-admin-dashboard/engagement`: spotlight card queue with preview,
  approve, reject, download; the district page also has the milestone and Governor message settings.

## e2e

`kb/tools/engagement_e2e.py <api_base> <mysql_port> <database>`: flag off 404; settings validation and refusals; run
the pass for a district whose member has an anniversary in the window: one event, one email attempt, a second run
sends nothing; PHF add creates a highlight and feed item, removal hides it; card preview, download refused while
pending, approve, download; IDOR refusals; clean-up.

## Left for the app

- Feed items of type `highlight` in `GET /api/mobile/notifications` (deep link type `engagement_highlight`, no route
  yet: the app opens without a target).
- Highlights list for a club or district: `GET /api/clubs/{id}/engagement/highlights`.

## Shortcuts

- Built-in texts are English (ROW's default language); the member language hook is a comment in EngagementService.
- A failed milestone email is not retried (the sent-log row is written first; email_log shows the failure).
- Missed days are caught up for 7 days; a PHF awarded more than 90 days before it was entered is history, not news.
- Spotlight cards are rendered on each request (no cache).

## Done (2026-10-23)

### Files

Added:
- `row/api/Services/EngagementService.cs`: texts (label, congratulation line), milestone years rule, PHF capture,
  the daily pass (milestones + PHF), the milestone email (default or Governor variant), and
  `EngagementBackgroundService` (hourly tick, runs once a day from 08:00 brand time).
- `row/api/Controllers/EngagementController.cs`: highlights, card queue, card image, approve / reject, district
  settings, SuperAdmin run.
- `row/admin/src/components/engagement/EngagementPanel.tsx` (card queue with preview dialog, approve, reject,
  download; district milestone settings), `row/admin/src/app/club-admin-dashboard/engagement/page.tsx`,
  `row/admin/src/app/district-admin-dashboard/engagement/page.tsx`.
- `row/admin/src/lib/engagement.ts` + `engagement.test.ts` (milestone years rule, status labels).
- `kb/tools/engagement_e2e.py`.

Changed:
- `row/api/Services/FeatureGate.cs`: flag `engagement` (API `^/api/(clubs|districts)/\d+/engagement`, `^/api/engagement`;
  admin `/engagement`).
- `row/api/Services/DatabaseInitializer.cs`, `row/database/schema.sql`: 2 tables (CREATE TABLE IF NOT EXISTS).
- `row/api/Services/MobileNotificationFeedService.cs`: feed type `highlight` (a UNION leg over engagement_events,
  only while the flag is on); `ProfilePhotoCase` made internal for reuse.
- `row/api/Services/ProjectShareCardBuilder.cs`: `PanelLabel` (default "SERVICE PROJECT", so the project card is
  unchanged).
- `row/api/Controllers/FoundationDesignationsController.cs`: a new PHF is captured as a highlight at once.
- `row/api/Privacy/PersonalDataRegistry.cs` (engagement_events: export, erase deletes), `Services/AuditMiddleware.cs`
  (entity names Engagement, Spotlight Card), `Services/ScopeWriteGuardMiddleware.cs` (run is SuperAdmin only),
  `Program.cs` (service + hosted job behind BackgroundJobs:Enabled), feed docs in `MobileNotificationsController.cs`
  and `DTOs/MobileNotificationDtos.cs`.
- Admin: `services/api.ts`, both dashboard `nav.ts` (Engagement entry, hidden by the flag).

### Tables

- `engagement_events` (UNIQUE `dedupe_key`; indexes on club, district, member).
- `engagement_district_settings` (one row per district; no row = 1, 3, 5, 10 and no Governor message).

### Endpoints (flag `engagement`)

- `GET /api/clubs/{id}/engagement/highlights?days=90`, `GET /api/districts/{id}/engagement/highlights?days=90`
- `GET /api/clubs/{id}/engagement/cards?status=`, `GET /api/districts/{id}/engagement/cards?status=`
- `GET /api/engagement/spotlight-cards/{id}/image?download=`, `POST .../{id}/approve`, `POST .../{id}/reject`
- `GET|PUT /api/districts/{id}/engagement/settings`
- `POST /api/engagement/run?districtId=` (SuperAdmin)
- `GET /api/mobile/notifications` returns type `highlight` items while the flag is on.

### Verification

- `dotnet build`: 0 errors; no warnings in the new or changed files (189 existing warnings elsewhere).
- `python -I kb/tools/engagement_e2e.py http://127.0.0.1:5101 3317 row_lane_a`: 44 PASS, 0 FAIL (clean-up check
  included). Regression on the same API: `membership_fields_e2e.py` 40 PASS, `scope_read_guard_e2e.py` 7 PASS.
- Two sample cards rendered and inspected (1200x630, navy and gold, brand name in the footer), then deleted.
- Admin: `tsc --noEmit` 0 errors; `vitest run src/lib/engagement.test.ts src/lib/foundationDesignations.test.ts
  src/components/FeatureGate.test.ts` 7 passed; `node scripts/check-design.mjs` all zero.
- The lane API was stopped after the runs; row_lane_a holds no engagement rows, congratulation email_log rows,
  settings or switched-on flags from the tests (audit_log keeps its rows, it is append-only).

### Shortcuts (each also a `shortcut:` comment in the code)

- Built-in texts are English (ROW's default language); the member language hook is a comment in
  `EngagementService.SendMilestoneEmailAsync`.
- A failed milestone email is not retried; the sent-log row is written first (at most once), email_log shows the failure.
- Missed days are caught up for 7 days only.
- The card queue returns the newest 500 rows, no paging.
- Cards are rendered on each request (no disk cache).

### Open issues

- The hosted job only runs where `BackgroundJobs:Enabled` is true (off in local Development), so the e2e drives the
  same pass through `POST /api/engagement/run`; the hourly timer itself was not run here.
- Opt-outs: ROW has no per-member greeting or milestone opt-out. The email honours the privacy consent filter
  (`PrivacyConsent.BroadcastFilter`); the in-app item and the card do not need consent. Add a member toggle if wanted.
- When the flag is first switched on, members whose anniversary fell in the previous 6 days get a slightly late message.
- No member in row_lane_a has a profile photo, so the photo variant of the card was not seen (the code is the
  project card's, which handles photos).
- The app has no route for deep link type `engagement_highlight` yet; it renders the item as a generic update.
- Not built here: escalation ladder (#32) and target celebration (#35); `engagement_events` can take a TARGET type later.
