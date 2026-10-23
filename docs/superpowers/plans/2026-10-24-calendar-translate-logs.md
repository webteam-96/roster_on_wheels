# Calendar scope, translate route guard, masked email logs (2026-10-24, lane a)

Tasks S1 and S3 of the security round. Rules: CLAUDE.md backend and security checklists.

## S1: calendars only for people who may read the club or district

Gap: `GET /api/mobile/club-calendar/{clubId}` and `GET /api/mobile/district-calendar/{districtId}`
(MobileCalendarController) checked only the kill switch. Any signed-in user could read any club's or district's
birthdays, anniversaries (with spouse names), phones and emails by changing the id.

Fix: both call `ScopeWriteGuardMiddleware.ReadAllowedAsync` before anything else. This is the same rule as the reads
of `api/clubs/{id}` and `api/districts/{id}`. It was a private method; now it is `internal static` and takes the
connection string, like `AllowedAsync`. Allowed: active members of the club (or of a club in the district), the
club's Admin and AGs (district_ag), district Admins of the club's district, and SuperAdmin. Everyone else gets 403.
The app is not affected: it opens only the calendars of clubs listed by `club-calendar/my-clubs` (the caller's own
memberships).

Other calendar endpoints checked, no change needed:
- `club-calendar/my-clubs` and `district-calendar/my-districts`: these return only the caller's own clubs and
  districts.
- `api/clubs/{id}/calendar-feed` (GET/POST): ScopeWriteGuardMiddleware already checks it (reads by members, writes
  by managers). The feed holds meeting times and links only.
- `api/mobile/calendar-feed`: the caller's own feed.
- `api/public/calendar/{token}.ics`: the token is the credential, and the endpoint is rate limited.
- `api/public/club/{id}/calendar`: public by design. It returns names and photos for one day. The public site's
  calendar page has a date picker and shows the same data.
- District website calendar (`DistrictWebsitePublicDataController`): events only.

e2e: `kb/tools/calendar_scope_e2e.py`, 13 checks:
- Signed out: 401.
- Member: own club 200, other club 403, own district 200, other district 403.
- Club admin: own club 200, other club 403.
- SuperAdmin: other club 200, other district 200.
- With a temporary district-admin role row: the district's club 200 and the district 200.
- With a temporary AG row: the assigned club 200.
- After the role row is removed: 403.

The temporary rows are deleted in a `finally` block.

## S3a: the admin's translate route is no longer an open proxy

Callers of `row/admin/src/app/api/i18n/translate` (POST):
- `i18n/LiveTranslate.tsx` and `i18n/translateCatalog.ts` run on every admin page. That includes the sign-in pages
  and the public `(site)` pages, where nobody is signed in (see the ClientProviders comment).
- `components/WebsiteLanguagesEditor.tsx` (website translations) and `services/api.ts machineTranslate` (comms
  templates) are used by signed-in admins only.
- `club-website` and `district-website` do not call the route. Their languages come from the API's website
  translations.

How it works now:
- `i18n/postTranslate.ts`: all four callers use it. It sends `Authorization: Bearer <auth_token>` when a token is
  stored.
- Route, signed in: the token is checked against the API with a new endpoint, `GET /api/auth/session`
  ([Authorize], 204). The admin server therefore needs no JWT secret. A valid token is remembered for 5 minutes.
  Limits: 120 requests per IP per minute and up to 2000 strings per request (as before).
- Route, visitor (no token, a token the API rejects, or the API is unreachable):
  - 30 requests per IP per minute and up to 300 strings per request (LiveTranslate's chunk size).
  - Text that is already cached is free.
  - New text is paid from a daily budget of 200,000 characters shared by all visitors. When the budget is used up,
    new text comes back in English. So the worst-case provider spend from anonymous callers is fixed.
  - Visitor pages keep working without a sign-in.
- A request without a known session counts against the visitor limit before the API is asked. Made-up tokens
  therefore cannot make the admin call the API without limit.
- Client IP: the last `X-Forwarded-For` entry. This is the address added by the nearest proxy, or by Next.js from
  the socket when there is no proxy.
- 429 with `Retry-After: 60`. LiveTranslate and translateCatalog skip a failed request without caching it.

Test: `src/app/api/i18n/translate/route.test.ts` (vitest, 6 tests). It covers:
- The session is checked once and then cached.
- A rejected token gets visitor limits.
- The visitor per-IP limit, including a spoofed first `X-Forwarded-For` hop.
- Made-up tokens stop at the visitor limit.
- The signed-in per-IP limit.
- The daily budget: cached text is still served, and signed-in callers are not charged.

Not done: the route does not check that a visitor's text appears on the admin's own pages. Public page text is
dynamic (API content, legal pages), so the bounded daily budget is the control instead.

## S3b: no email addresses in log lines

`api/Services/LogMask.cs`: `LogMask.Email("jane@example.org")` returns `j***@example.org`. Lists ("a@x, b@y" or
"a@x;b@y") are masked address by address. `LogMask.Emails(list)` does the same for a list. The three workers link
the file the same way they link `Brand.cs`. Only log text changes. `email_log` rows and report log rows keep the
full address.

Masked log lines:
- API, `EmailService`: 8 lines (sent, failed, mass-email failure, email_log insert failure).
- API, other email senders:
  - SuperAdminController (3)
  - RazorpayRouteAccountsController
  - CashfreeKycService
  - CitationAutoPoints
  - ClubLeadershipEmail
  - ClubMonthlyReport
  - ClubWebsiteReminder
  - CmrSubmissionMailer (to and the recipient list)
  - CreditExpiry
  - DailyStatsReport (3, to and cc)
  - DistrictPerformanceReport (2)
  - EmailScheduledSend
  - MembershipDues (3)
  - TrainingAppointment
  - RotaryOrg/ClubSyncService
- API, Google Sheets sharing (also an address in a log): ClubDues, EventPaymentLink, MembershipDues and
  GoogleSheetsService.
- Workers:
  - AwardsAutoCalc BrevoEmailSender (3)
  - Greetings BrevoEmailSender (2)
  - Greetings Program summary
  - GreetingsJob dry-run and diagnose console lines
  - RotaryOrgSync EmailReportSender (5)

Checked at run time: a forgot-password request against the lane API, with Brevo pointed at 127.0.0.1:9, logged
`Failed to send email to e***@outlook.com`. The full address does not appear anywhere in the API log. The reset
token and email_log rows were deleted afterwards.

## Verification

- API build: 0 errors, and the warning set is the same as before the change (126).
- The three workers build.
- `calendar_scope_e2e.py`: ALL PASS. `scope_read_guard_e2e.py`: ALL PASS.
- `GET /api/auth/session`: 204 with a valid token, 401 without one, 401 with a bad one.
- Admin checks:
  - `tsc --noEmit`: 0.
  - vitest: 19 files, 109 tests pass.
  - `check-design`: 0.

## Open

- `api/mobile/club-finder/{clubId}/members` and `members/{memberId}` (ClubFinderController) return the emails,
  phones and birthdays of any club's members to any signed-in user. This is the same class of gap, but "club
  finder" may be meant for browsing across clubs. It needs a product decision, so it was not changed here.
- When the visitor budget runs out, LiveTranslate stores the English echo in that visitor's localStorage. The text
  stays English for that visitor until the cache key version changes. A provider error has the same effect today.
- The per-IP limits depend on the reverse proxy appending the client address to `X-Forwarded-For`. The API's own
  rate limits make the same assumption. Confirm this on the chosen host (IIS HttpPlatformHandler or a load
  balancer).
- The limits and the session cache are kept in memory in one process. Move them to a shared store if the admin
  runs on more than one instance.
- The GreetingsJob `--diagnose` console output still prints the member's mobile number in full. This task covered
  email addresses only.
- `kb/row-api-routes.log` does not list `GET api/auth/session` yet, because kb/rebuild.sh was not run in the lane.
