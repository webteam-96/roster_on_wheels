# N8 Meetings: pasted links, calendar feed, reminders, compliance (lane d, 2026-10-23)

Spec: row-build-spec-v4.1 section 3.17 (pasted links only; Zoom and Google OAuth are blocked), build list #23,
B.1 #31, B.3 (meeting compliance). Web layers only; the app gets API endpoints (listed below).

## Goal

- Online and hybrid meetings carry a pasted https join link (Teams or other).
- The link reaches the app's API data, an iCal feed (per club and per member, tokenised, read-only) and every
  reminder for that meeting (email and in-app). It never reaches public pages.
- A district sets a meetings-per-month rule (club override optional); held meetings are counted from meeting
  and attendance records; the district club list shows each club's compliance; API endpoints for it.

## What exists (verified 2026-10-23)

- Meetings ARE stored as records: `club_attendance` (one row per meeting: name, date/time, description) with
  attendance in `club_attendance_members` and friends. There is no separate scheduled-meeting entity; the
  egovernance dashboards already count `club_attendance` rows as meetings. This module uses those records.
- Meeting mode and the pasted link already exist (ROW Wave 1, 2026-10-19): `club_attendance.MeetingMode`
  (in_person | online | hybrid) and `MeetingLink` (https only, `AttendanceService.NormalizeMeeting`), the admin
  form `components/attendance/MeetingModeFields.tsx` + `lib/meeting.ts`, the app form `lib/core/utils/meeting.dart`.
  The app reads `/api/clubs/{clubId}/attendance` (list and detail), which already returns `meetingMode` and
  `meetingLink`; club members may read it (ScopeWriteGuardMiddleware read rule).
- Public pages: the club website "Meetings" page lists Club Service projects (`/api/public/club/{id}/meetings`),
  not `club_attendance`; no public endpoint selects `MeetingLink`. So links are already hidden from public pages.
- No reminders exist for meetings (upcoming_event reminders are for events, push only). The in-app feed
  (`MobileNotificationFeedService`) is a live aggregation over source tables, so a meeting leg is the in-app reminder.
- Production copy has 0 `club_attendance` rows.

## Tables (additive, DatabaseInitializer + database/schema.sql)

- `meeting_rules`: district default (fk_district_id) or club override (fk_club_id), MeetingsPerMonth 0..31.
- `meeting_calendar_feeds`: one tokenised feed per club or per member (64-hex token).
- `meeting_reminder_log`: (meeting, member) reminder claims, so each member gets one email per meeting.
  Feeds (member rows) and reminder log are in PersonalDataRegistry.

## Endpoints

- `GET /api/public/calendar/{token}.ics` anonymous, token is the credential, rate limit "feed".
- `GET|POST /api/clubs/{clubId}/calendar-feed` read the club feed URL (club members) / create or replace it (managers).
- `GET|POST /api/mobile/calendar-feed` the caller's own feed URL (app).
- `GET /api/clubs/{clubId}/meeting-compliance?month=YYYY-MM` the club's status (club members, managers).
- `GET /api/districts/{districtId}/meeting-compliance?month=YYYY-MM` every club (district managers only).
- `PUT /api/districts/{districtId}/meeting-compliance/rule` district default; `PUT .../clubs/{clubId}` override or clear.
- `GET /api/mobile/notifications` gains type `meeting` (reminder, linkUrl = join link).
- Email reminder: `MeetingReminderBackgroundService`, 24 h before the meeting, to active members with an email.

All behind the flagged feature `meetings` (FeatureGate, Settings > Features); the existing link field is Wave 1
and stays open.

## Admin pages

- `/district-admin-dashboard/meeting-compliance`: month, district default, per-club override, held, status.
- `/district-admin-dashboard/clubs`: new "Meetings" column (last complete month) + link to the page above.
- Club attendance list (`/clubs/[id]/attendance/v2`, also embedded in the club e-governance tab): calendar feed card.

## e2e

`kb/tools/meetings_links_compliance_e2e.py`: flag on/off gate, link validation, feed reminder with link, club and
member iCal with link, public meetings endpoint without link, compliance counting + rule + override + access checks,
cleanup. The email job is not driven by the e2e (it would email real members of the chosen club); verified once by
hand with the Brevo URL pointed at a closed local port.

## For the app (later)

Join link from the attendance API; reminders from the notification feed (type `meeting`); "Add to calendar" via
`/api/mobile/calendar-feed`; club status via `/api/clubs/{id}/meeting-compliance`.

## Shortcuts

- iCal times are floating (no zone) and 1 hour long: the meeting record has no zone or end time until the
  time-zone module (web plan #12).
- Reminder lead time is a fixed 24 h, emails are English only, at most 500 per 5-minute tick.
- Feed tokens are stored as issued so an admin can copy the URL again; reset replaces it.
- No "public meeting" flag: meeting records are never on public pages, so links are never public.

## Done (2026-10-23)

### Files

Added:
- `row/api/Services/MeetingsService.cs`: feeds (token issue/reset, iCal text with RFC 5545 escaping and 75-octet
  folding), compliance (one query per district), reminder email text, and `MeetingReminderBackgroundService`.
- `row/api/Controllers/MeetingsController.cs`, `row/api/DTOs/MeetingDtos.cs`
- `row/admin/src/app/district-admin-dashboard/meeting-compliance/page.tsx`
- `row/admin/src/components/attendance/CalendarFeedCard.tsx`
- `row/admin/src/lib/meetingCompliance.ts` + `meetingCompliance.test.ts`
- `kb/tools/meetings_links_compliance_e2e.py`

Changed:
- `row/api/Services/DatabaseInitializer.cs` (3 tables + `idx_club_attendance_datetime`), `row/database/schema.sql`
- `row/api/Services/FeatureGate.cs` (flagged `meetings`), `row/api/Program.cs` (DI, rate limit `feed`, reminder job)
- `row/api/Services/MobileNotificationFeedService.cs` (`meeting` leg + text), `row/api/DTOs/MobileNotificationDtos.cs`
- `row/api/Privacy/PersonalDataRegistry.cs` (`meeting_calendar_feeds` member rows, `meeting_reminder_log`)
- `row/admin/src/services/api.ts`, `row/admin/src/components/FeatureGate.tsx` (`useFeatureLoadedOn`: no call to an
  off module while the switches load), `row/admin/src/app/district-admin-dashboard/clubs/page.tsx` ("Meetings"
  column + "Meeting rule" link), `.../district-admin-dashboard/nav.ts` (title), `.../clubs/[id]/attendance/v2/view.tsx`

### Tables

`meeting_rules`, `meeting_calendar_feeds`, `meeting_reminder_log`; index `idx_club_attendance_datetime`.
Down: `DROP TABLE meeting_rules, meeting_calendar_feeds, meeting_reminder_log; DROP INDEX idx_club_attendance_datetime ON club_attendance;`

### Endpoints

- `GET /api/public/calendar/{token}.ics` (anonymous, token = credential, 60/min per IP)
- `GET|POST /api/clubs/{clubId}/calendar-feed`, `GET|POST /api/mobile/calendar-feed`
- `GET /api/clubs/{clubId}/meeting-compliance?month=YYYY-MM`, `GET /api/districts/{districtId}/meeting-compliance?month=YYYY-MM`
- `PUT /api/districts/{districtId}/meeting-compliance/rule` `{ clubId?, meetingsPerMonth }`
- `GET /api/mobile/notifications` type `meeting`; email reminders by `MeetingReminderBackgroundService`
  (`Meetings:ReminderJob` overrides `BackgroundJobs:Enabled` for this job only).

### Verification

- `dotnet build`: 0 errors; 0 warnings in the touched files (189 existing warnings elsewhere).
- `kb/tools/meetings_links_compliance_e2e.py`: 43/43 PASS, run twice on `row_lane_d`; no rows left behind
  (audit_log rows stay, append-only). `scope_read_guard_e2e.py`: ALL PASS.
- Email job, once by hand: API with `Meetings__ReminderJob=true` and `Brevo__ApiUrl` on a closed local port; all
  members but one pre-claimed; one `email_log` row (Failed, connection refused locally) whose body holds the join
  link and the HTML-escaped description; no second row on the next tick; all rows removed afterwards.
- Admin: `tsc --noEmit` 0 errors (4815 files); vitest `meetingCompliance.test.ts`, `meeting.test.ts`,
  `FeatureGate.test.ts` pass; `check-design.mjs` all counters 0.

### Shortcuts (each has a `shortcut:` comment)

- iCal: floating local times, 1 hour long (no zone or end time on meeting records until web plan #12).
- Reminders: fixed 24 h lead, English only, at most 500 emails per 5-minute tick; a rescheduled meeting is not reminded again.
- No public-meeting flag: meeting records never reach public pages (e2e proves the club site endpoint has no link).

### Open issues

- Existing, not touched: `GET /api/mobile/club-calendar/{clubId}` and `/district-calendar/{districtId}`
  (MobileCalendarController) check only the kill switch, so any signed-in user can read any club's birthdays,
  anniversaries, phones and emails. Belongs to the Phase 1 read-access review.
- Existing: `EmailService` logs recipient addresses when a send fails (PII in logs).
- Feed URLs use `Api:BaseUrl`, else the request host: set `Api:BaseUrl` in production (dev config says localhost:5000).
- The "Meetings" column is on the district admin club list only, not on the SuperAdmin district drill lists.
- `privacy_e2e.py` not run: it needs seeded test accounts that `row_lane_d` does not have.
- Lane tooling: starting the API with an inline `JwtSettings__Secret="$(...)"` gave the API a different secret
  (every JWT 401 "signature key was not found"); exporting the variables in a script fixed it.
