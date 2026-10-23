# N4 Volunteers and speakers (build spec 3.13, build list #20, launch acceptance "A volunteer sign-up sheet takes a non-member sign-up and the hours roll into the project total")

Lane b, second module. Status: built (see "Done" at the end).

## Goal

Done when (spec): a club opens a volunteer sign-up sheet for an event or a service project with slots (task, time,
capacity); members sign up from the app and non-members through a public link (name, email, consent); everyone gets
a reminder before the slot (email; members also in the app's bell); the club records hours per person afterwards and
they roll into the project's man-hours. Speakers (name, topic, bio, photo, contact) are scheduled to a meeting date,
shown on the club website and available to the bulletin through an API; meeting duties (member, duty, meeting date)
get reminders. Web layers only (API, admin console, club website); the app gets endpoints.

## What exists

- Nothing for sign-up sheets, speakers or meeting duties in ROW or RIZones (grep: no tables, no code).
- Project totals: year-wise `rotary_projects_<yyyy_yy>` rows carry `man_hours` (INT, reports call it "Volunteer
  hours") and the head counts `rotarians_involved` / `rotaractors_involved`. Recorded hours roll into `man_hours`.
- Events: `upcoming_events` (club rows). Meetings: no scheduled-meeting record yet (3.17 adds one); speakers and duties
  carry a meeting date. Bulletin: `newsletters` (an uploaded file or link), so "available to the bulletin" = an API.
- Reused: ScopeWriteGuardMiddleware.AllowedAsync (club managers), AuditMiddleware (every admin write, plus entity
  names), EmailService.SendScopedEmailAsync, MobileNotificationFeedService (new legs), FeatureGate (Kind.Flagged
  "volunteers"), IYearTableResolver, ImageQualityValidator (real-image check), Data Protection (form token), the
  ASP.NET rate limiter, admin FeatureGate.tsx + skeletons + getClubMembersForAttendance, club-website Meetings pages.

## Tables (DatabaseInitializer.Volunteers.cs + schema.sql)

volunteer_sheets (club, title, optional event, optional year+project, hours_applied, public token, open/closed) ·
volunteer_slots (task, starts_at, ends_at, capacity, filled: raised only by a conditional UPDATE, so capacity holds
under concurrency) · volunteer_signups (member id OR name+email+consent_at, fk_contact_id hook, hours,
reminder_sent_at) · club_speakers (meeting date, name, topic, bio, photo, email, phone, show_on_website,
fk_contact_id hook) · meeting_duties (meeting date, duty, member, note, reminder_sent_at).

## Endpoints (all behind the "volunteers" switch)

Club managers: volunteer-sheets GET/POST, {id} GET/PUT/DELETE, targets?yearId, {id}/hours PUT, {id}/signups/{signupId}
DELETE; speakers GET (from, to: the bulletin's feed)/POST, {id} PUT/DELETE, {id}/photo POST; meeting-duties GET/POST,
{id} DELETE. App (signed-in member of the sheet's club): GET api/mobile/volunteers, POST/DELETE
api/mobile/volunteers/slots/{slotId}/signup, GET api/mobile/meeting-duties. Public: GET api/public/volunteers/{token},
POST api/public/volunteers/{token}/signup (rate limited per IP, honeypot, time-limited form token, consent, capacity),
GET api/public/club/{clubId}/speakers (upcoming, website-visible, no contact details).

## Hours roll-up

hours_applied on the sheet = what this sheet already added to the project. Each hours save (or sign-up removal, link
change, sheet delete) recomputes the sheet total, adds the difference to the project's man_hours in the same
transaction (sheet row locked), and stores the new hours_applied. Idempotent, reversible.

## Reminders

VolunteerReminderBackgroundService (every minute, only while the switch is on): sign-ups whose slot starts within 24 h
(also on sheets closed to new sign-ups), duties whose meeting is within 2 days. Claim the row (reminder_sent_at) then email; members also see it in the app's
bell (feed types "volunteer" and "meeting_duty", read from reminder_sent_at). Runs where BackgroundJobs:Enabled, or
VolunteerReminders:Enabled for a dev run of this job alone.

## Pages

/club-admin-dashboard/volunteers (sheets, new sheet), /club-admin-dashboard/volunteers/[sheetId] (sheet, slots,
sign-ups, hours, public link), /club-admin-dashboard/speakers (speakers, meeting duties), /public/volunteer/[token]
(public sign-up). Club website: an "Upcoming speakers" block on the Meetings page (classic-blue and banner themes).

## e2e

kb/tools/volunteers_speakers_e2e.py: flag off = 404; role gating (plain member, other club); sheet with slots linked to
a project; member sign-up, duplicate, cancel; public sign-up with consent, honeypot, bad token, too fast, capacity
full, duplicate email; rate limit 429; hours roll into man_hours and back on removal and delete; reminders (job run
with VolunteerReminders:Enabled) and the feed legs; speakers CRUD, photo check, public speakers without contact;
duties with member check; cleanup.

## Left for the app

Endpoints above; feed types "volunteer" (deep link volunteer_sheet, entity = sheet id) and "meeting_duty".

## Done (2026-10-23, lane b)

### Files
Added: row/api/Controllers/VolunteersController.cs, row/api/Controllers/SpeakersController.cs,
row/api/Services/VolunteerService.cs, row/api/Services/SpeakerService.cs,
row/api/Services/VolunteerReminderBackgroundService.cs, row/api/Services/DatabaseInitializer.Volunteers.cs,
row/api/DTOs/VolunteerDtos.cs, row/admin/src/types/volunteers.ts, row/admin/src/lib/volunteers.ts (+ volunteers.test.ts),
row/admin/src/app/club-admin-dashboard/volunteers/page.tsx and [sheetId]/page.tsx ("new" creates one),
row/admin/src/app/club-admin-dashboard/speakers/page.tsx, row/admin/src/app/public/volunteer/[token]/page.tsx,
kb/tools/volunteers_speakers_e2e.py.
Changed: row/api/Services/FeatureGate.cs (flagged "volunteers"), Program.cs (DI, reminder job, rate-limit policy
"public-form"), DatabaseInitializer.cs (one call after EnsureGrantTablesAsync), AuditMiddleware.cs (4 entity names),
Privacy/PersonalDataRegistry.cs (4 entries), MobileNotificationFeedService.cs (feed types "volunteer" and
"meeting_duty", only while the switch is on), row/database/schema.sql (5 tables, mysqldump format), admin
services/api.ts (block at the end), admin club-admin-dashboard/nav.ts (2 entries + titles).
Club website (plain folder, not in git: copy by hand): row/club-website/src/lib/publicApi.ts (getUpcomingSpeakers),
src/app/meetings/page.tsx, src/themes/classic-blue/Meetings.tsx, src/themes/banner/Meetings.tsx ("Upcoming speakers"
block on the Meetings page; the other four themes share classic-blue's Meetings).

### Tables
volunteer_sheets, volunteer_slots, volunteer_signups, club_speakers, meeting_duties. All CREATE TABLE IF NOT EXISTS;
slots and sign-ups cascade with their sheet. Hooks for the contacts lane: volunteer_signups.fk_contact_id and
club_speakers.fk_contact_id (null today). Speaker photos: wwwroot/Documents/Speakers/Group{clubId}/ (public, gitignored).

### Endpoints (all behind the "volunteers" switch)
Club managers (reads included): GET/POST api/clubs/{c}/volunteer-sheets, GET .../targets?yearId,
GET/PUT/DELETE .../volunteer-sheets/{id}, PUT .../{id}/hours {entries:[{signupId, hours}]},
DELETE .../{id}/signups/{signupId}; GET api/clubs/{c}/speakers?from&to (the bulletin's feed), POST .../speakers,
PUT/DELETE .../speakers/{id}, POST .../speakers/{id}/photo (multipart "file"); GET/POST api/clubs/{c}/meeting-duties
(?from&to), DELETE .../meeting-duties/{id}.
App (signed-in member): GET api/mobile/volunteers, POST/DELETE api/mobile/volunteers/slots/{slotId}/signup,
GET api/mobile/meeting-duties, GET api/mobile/notifications (new types volunteer, meeting_duty).
Public: GET api/public/volunteers/{token}, POST api/public/volunteers/{token}/signup (rate limited 10 per IP per 10 min,
honeypot "website", time-limited form token at least 3 s old, consent, capacity), GET api/public/club/{c}/speakers?limit.

### Pages
/club-admin-dashboard/volunteers (sheets), /club-admin-dashboard/volunteers/new and /[sheetId] (sheet, slots, event,
project, public link, sign-ups, hours, delete), /club-admin-dashboard/speakers (speakers with photo, website switch;
meeting duties with member picker), /public/volunteer/[token] (public sign-up with consent, terms and privacy links).
Nav entries are hidden by components/FeatureGate.tsx while the switch is off. Club website: Upcoming speakers block.

### Verification
- dotnet build --no-incremental: 0 errors, 189 warnings (baseline unchanged, none in the files above).
- python -I kb/tools/volunteers_speakers_e2e.py http://127.0.0.1:5102 3317 row_lane_b (API started with
  VolunteerReminders__Enabled=true): 87 PASS, ALL PASS, exit 0, 3 runs on the final code. Covers the switch, role
  gating, cross-club IDOR, validation, member and public sign-ups, honeypot, forged and too-fast form tokens, consent,
  duplicates, capacity with 6 concurrent sign-ups for 1 place (exactly 1 wins), the 429 rate limit, hours rolling into
  man_hours and back out (clear, remove, unlink, relink, delete), closed sheets, reminders (email_log rows Failed: no
  mail key here) and both bell types, speakers (photo real-image check, website list without contacts, bulletin range),
  duties (member check, app list). Leaves no rows or files behind (audit_log keeps its rows: append-only).
- Regression on the same API: kb/tools/grants_e2e.py 76 PASS (2 runs), kb/tools/scope_read_guard_e2e.py ALL PASS,
  GET /api/privacy/registry/unlisted lists none of the 5 new tables, the bell answers 200 with the switch off.
- admin: tsc --noEmit 0 errors; vitest src/lib/volunteers.test.ts 3 passed (grants 2 passed); check-design all 0.
- club-website: tsc --noEmit 0 errors.

### Shortcuts (each has a "shortcut:" comment)
Club sheets only (no district sheets); no admin-added walk-in sign-ups; only hours roll in (head counts stay as typed);
500 sheets / 500 projects / 500 speakers per list; no confirmation email before a public place is taken; non-members
cancel by telling the club (no cancel link); slot times are wall-clock values against the server clock; failed reminder
emails are not retried; speakers and duties carry a meeting date, not a meeting record (link to 3.17's); a speaker photo
can be replaced, not removed.

### Open issues
1. Recorded hours are added on top of the man-hours the club typed on the project (man_hours is required on the project
   form). A club that already counted its volunteers there counts them twice: confirm this is the intended "roll into".
2. Reminders run where BackgroundJobs:Enabled (production default) or VolunteerReminders:Enabled (one job alone, for a
   dev copy). They are transactional and not deducted from email credits: confirm.
3. Times: on a UTC server with time.emitOffset the API marks stored wall-clock times as UTC, so the admin would show
   slot times shifted (events have the same issue platform-wide). Reminders compare against the server clock.
4. The public sign-up page is on the admin console domain (/public/volunteer/{token}); clubs share the link (the club
   website does not list sheets).
5. Pages were type-checked and design-checked, not opened in a browser (next dev is not allowed in lanes).
6. Merge hot spots: end of admin/services/api.ts, FeatureGate.All, Program.cs (registrations + rate limiter),
   DatabaseInitializer.cs (call after EnsureGrantTablesAsync), MobileNotificationFeedService (AllTypes + legs),
   AuditMiddleware EntityMap, PersonalDataRegistry tail, club-admin-dashboard/nav.ts, schema.sql.

### For the app
Members: GET api/mobile/volunteers (open sheets of their clubs with coming slots, signedUp per slot; their own slots
on closed sheets), POST/DELETE api/mobile/volunteers/slots/{slotId}/signup, GET api/mobile/meeting-duties,
GET api/public/club/{clubId}/speakers (coming speakers, no contacts). Bell: type "volunteer" (deepLink.type
"volunteer_sheet", entityId = sheet id) and "meeting_duty" (deepLink.type "meeting_duty", entityId = duty id); the app
renders unknown types as a generic card.
