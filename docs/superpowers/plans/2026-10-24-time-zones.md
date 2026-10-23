# N12 Time zones per district (2026-10-24, lane f)

Build guide package 4 (`row-build-decisions.txt` line 138): "Store an IANA time zone and a currency code on every
district. Replace ResolveIst and every IST constant: schedulers work out each district's run time from its own
zone, and all timestamps are stored in UTC. Format dates, numbers and money by locale in web and app."
Done when (guide): a scheduled job for a New York district fires at the right local time.

## What exists (found 2026-10-24)

- No IST constant or ResolveIst is left. `Brand.TimeZone` / `Brand.Now` give one platform zone
  (`Brand:Locale:DefaultTimeZone`, default UTC). Brand flag `time.districtZone` (on for ROW) is defined but unused.
- Stored time is UTC with "Z" on output (`UtcDateTimeConverter`, flag `time.emitOffset`) when the server runs in UTC.
- `district_master.DefaultCurrency` exists (district edit pages, Settings > Currency). No district time zone.
- `club_master.Timezone` exists but is NULL or 'UTC' on almost every row: not used for scheduling.
- Jobs on the server clock or the brand zone: GreetingsWorker (daily task at 08:00 server time, `DateTime.Now`,
  `CURDATE()` in its send log), District Performance Report (one send hour in the brand zone for all districts),
  InvitePromptService (`DateTime.Today` / `CURDATE()`), EngagementService (milestones by `CURDATE()`, run from 08:00
  brand zone), meeting reminders (`NOW()`) and the iCal feed (floating times), VolunteerReminderBackgroundService
  (slot wall-clock times against `NOW()`, duties by `CURDATE()`), TargetDashboardService (`DateTime.Today`).
- Admin has `lib/format.ts` (`createFormat`, locale + currency + zone). App: `DateFormatter` with fixed English
  patterns; `club_form_screen` hints 'Asia/Kolkata'.

## Decisions

- `district_master.Timezone VARCHAR(64) NULL`: IANA id, NULL = brand default. Additive (DatabaseInitializer +
  schema.sql). Not personal data (no registry entry).
- One helper `ZoneTime` (api/Services/ZoneTime.cs, linked into GreetingsWorker): `Find(id)` (NULL/unknown or flag
  `time.districtZone` off -> brand zone), `IsValidId`, `Local(zone, utcNow)`, `OfDistrictAsync`, `OfClubAsync`
  (a club through its district), `ZonesAsync` (distinct zones in use, for jobs that run per zone),
  `StoredUtc` (same rule as UtcDateTimeConverter: server in UTC and `time.emitOffset`).
- District APIs: list, detail, create and update carry `timezone`; update validates an IANA id (400 otherwise),
  SuperAdmin only, audit row as before. Admin district new/edit pages: time zone select (browser IANA list).
- Jobs:
  - GreetingsWorker: run hourly; each club/district source works out its local date and hour; sends from 08:00 local
    (`Greetings:SendHour`), once per local day (a 'Run' marker row in greeting_send_log), send log keyed on the local
    date. `--now <utc>` mocks the clock for tests; `--date` keeps its meaning (no hour gate).
  - District Performance Report: hourly tick; each district is due on its local 1st/16th from the send hour in its
    zone; run log keyed on the district's local date.
  - InvitePromptService: "today" for create, list and the send job is the club's district local date.
  - EngagementService: milestones per zone group with that zone's local date; the background run is per zone from
    08:00 local.
  - Meeting reminders: stored UTC -> window on UTC now, email shows the time in the club's district zone; else the
    stored value is the club's wall clock -> window per zone. iCal: "Z" times when stored UTC, else TZID = district zone.
  - Volunteer reminders: slot times and duty dates are the club's wall clock: window per zone group.
  - TargetDashboardService: elapsed share of the Rotary year by the district's local date.
  - Platform jobs keep the brand zone: daily statistics, cache refresh, training appointments.
- App: neutral time zone hint; `DateFormatter` formats in the device locale and shows UTC values in device time.

## e2e

`kb/tools/time_zones_e2e.py <api_base> <mysql_port> <database>`: two districts in Pacific/Kiritimati (UTC+14) and
Pacific/Pago_Pago (UTC-11), always on different dates: district update saves/returns/clears the zone, refuses a
bad id and a non-SuperAdmin; GreetingsWorker dry run at a mocked clock (local date, hour gate, celebrant counts);
invite prompt "today" per club zone; engagement milestone by local date; iCal TZID/Z; volunteer reminder claims by
the real job for the same wall-clock slot in both zones; target dashboard elapsed share by local date.
Restores every row it touched.

## Done (2026-10-24)

Built as planned. Files:
- API: `Services/ZoneTime.cs` (new helper; `UtcDateTimeConverter` now reads its `StoredUtc`), `district_master.Timezone`
  (`DatabaseInitializer`, `database/schema.sql`), district DTOs / `DistrictService` / `DistrictsController` (create and
  edit validate an IANA id, 400 otherwise; SuperAdmin only; audit row as before), `GreetingsWorker` (links ZoneTime;
  `Greetings:SendHour` 8, `--now`, hourly task XML), `DistrictPerformanceReportService` + its background service (hourly
  ticks, send hour per district zone, run log on the district's local date, report "today" in the district zone),
  `InvitePromptService`, `EngagementService` (+ background pass hourly per zone from 08:00 local),
  `MeetingsService` (iCal TZID / Z, reminder window and email time), `VolunteerReminderBackgroundService`,
  `TargetDashboardService`.
- Admin: `components/DistrictTimeZoneField.tsx` on the district new and edit pages (browser IANA list, fallback
  `TIMEZONES`; "Instance default" = NULL), `types/district.ts`, District Performance Report settings text.
- App: `DateFormatter` formats in the device locale and shows UTC in device time (`DateFormatter.init()` in main);
  club form time zone hint 'e.g. Europe/London'.
- README "Time" paragraph updated.

Decisions taken while building:
- No FeatureGate entry: this is platform behaviour, behind the existing brand flag `time.districtZone` (on for ROW).
  A district without a zone behaves as before (brand zone).
- District performance report: one scheduled attempt per district per local day (any run-log row counts), so hourly
  ticks never retry a failed send; a restart no longer retries failures either (it did before).
- GreetingsWorker: a 'Run' row (member 0) per source and local date stops later hourly runs; the admin summary email
  goes only when a run sent or failed something.

Verification (lane f, row_lane_f, API on 5106 with VolunteerReminders__Enabled=true):
- `dotnet build` API 0 errors (128 warnings, none on changed lines); GreetingsWorker 0 errors, 0 warnings.
- `kb/tools/time_zones_e2e.py`: 24 PASS, ALL PASS. `kb/tools/scope_read_guard_e2e.py`: ALL PASS.
- Admin: `tsc --noEmit` exit 0; vitest `src/lib/constants.test.ts` + `src/lib/format.test.ts` 29 passed;
  `check-design.mjs` all 0.
- App: `flutter analyze` 0 errors (448 infos/warnings, none new); `flutter test test/core/date_formatter_test.dart
  test/money_format_test.dart` all passed.

Left open:
- Meeting and volunteer slot times are typed as wall-clock (datetime-local, no offset) in admin and app; a UTC server
  stores meeting times as if UTC. The meeting forms should send UTC instants (shortcut comment in MeetingsService).
- The in-app meeting reminder leg (MobileNotificationFeedService) still compares with NOW(): right on a UTC server only.
- iCal TZID has no VTIMEZONE block (only used when stored times are not UTC).
- District performance report per-district hour is not driven by the e2e (send days are the 1st and 16th and the API
  has no clock mock); it uses the same ZoneTime local hour rule the GreetingsWorker e2e proves.
- GreetingsWorker `--diagnose` still uses the server's date.
- The first e2e run (before it restored every field) left in row_lane_f: a soft-deleted test district 483
  ('E2E-TZ-…', hard deletes are blocked by a trigger) and district_master.modified_date of districts 4 and 5 moved.
