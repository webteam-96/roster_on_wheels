# H1 part A: read-access review, controllers A* to L* (2026-10-24, lane c)

Scope: every GET route in `row/api/Controllers/A*.cs` to `L*.cs` that is not under `/api/clubs/{id}/**`,
`/api/districts/{id}/**` or `/api/district-modules/{id}/**` (those are already limited by the read guard in
`ScopeWriteGuardMiddleware`). 441 GET routes in these files; 165 sit under the guarded prefixes; the other 276 are
listed below, including the `/api/mobile/*` routes and the routes of the new modules (chat, comms, contacts,
engagement, foundation designations). 36 were fixed, 194 were already right, 46 are public by design.

## Rule used

- A club, district or member record named in the query string or in a route outside the guarded prefixes gets the
  same readers it would have under the prefix: `ScopeWriteGuardMiddleware.ReadAllowedAsync` (members of the club, or
  of any club in the district, plus the people who manage it) for report-style reads, and
  `ScopeWriteGuardMiddleware.AllowedAsync` (SuperAdmin, club Admin, AG of the club, district Admin) where the data
  is for managers only (payments, Rotary.org terminated members, payment links). SuperAdmin always passes.
- `ReadAllowedAsync` was a private instance method; it is now `internal static` (same body, connection string passed
  in) so controllers and services reuse it. No new helper for scope.
- Public (`/api/public/*`) and network-directory routes (Club Finder, Find a Rotarian) stay open to their audience,
  but return only what the page shows and what the member did not hide.

## Fixed

| Route(s) | Was | Now |
|---|---|---|
| `GET /api/admin/members-with-roles` | any Admin: every member's email and mobile, all clubs | SuperAdmin only |
| `GET /api/citation-matrix?districtId&clubId` | any signed-in user, any district | readers of the district, or of the named club |
| `GET /api/club-admin-dashboard/rotary-org-terminated-members?clubId` | any Admin, any club (names, mobiles, emails) | managers of the named club |
| `GET /api/club-analytics/excel?clubId\|districtId` | any Admin, any club or district (officer contacts) | readers of the named club / district |
| `GET /api/club-dues/**` (15 routes) | any Admin: every district's campaigns, members, payments, bank splits | SuperAdmin, or the admin of the campaign's district where a fallback existed; officer routes need a campaign of the officer's own district |
| `GET /api/mobile/club-finder/members/{memberId}`, `GET /api/mobile/find-rotarian/{memberId}` | contacts hidden only by the phone/email flags; second mobile, dates, home address always sent | `MemberPrivacyHelper.HidePrivateDetails`: phone, email, dates and home address hidden when the member turned personal details off, family photo when family details are off (as the app already does); second mobile follows the phone flag |
| `GET /api/mobile/club-finder/events/{eventId}`, `.../projects/{projectId}` | organiser / creator email and mobile, no privacy flag | dropped (the app shows neither) |
| `GET /api/club-award-status?clubId`, `GET /api/club-myrotary?clubId` | Admin/AG/SuperAdmin role, any club | readers of the club; checked in `DistrictAdminDashboardService`, so the `/api/mobile/district-admin-dashboard/*` twins are covered too |
| `GET /api/district-directory/{districtNumber}` | any signed-in user, any district: `m.*` for every member incl. push token and IMEI | readers of the district; device and sign-in columns dropped; second mobile and email follow the phone/email flags |
| `GET /api/district-governors/search-members` | any signed-in user: name/mobile/email search over all members | SuperAdmin only (the DG settings page) |
| `GET /api/event-payment-links/**` (9 routes) | any Admin: every link's registrations, payers, payments, bank splits | managers of the link's club or district; the unfiltered list is SuperAdmin only |

Side effects to know:
- `ClubDuesController.IsSuperAdminOrAdmin` became `IsSuperAdmin`; the same helper gated the controller's writes, so
  campaign create/edit/delete, rates, sync, receipts, vendors and Google Sheets are now SuperAdmin only too. District
  admins keep everything their dashboard page uses (content, clubs, offline payment, approve/reject, reminders, test
  email) through the existing `IsDistrictAdmin*` fallbacks. The only UI for the rest is Settings (SuperAdmin).
- `CanPayForClubAsync` (officer gate) now also needs the campaign to be the club's district; that covers the officer
  pay/verify/offline writes as well. `MobileClubDuesController.CanPayForClubAsync` (lane B) has the same gap.

## Verification

- `bash _base/heavy.sh dotnet build` (row/api): 0 errors; no new warnings in the changed files
  (ClubFinderController line 658 CS8604 is pre-existing, untouched code).
- API on 127.0.0.1:5103, database `row_lane_c`, mail pointed at 127.0.0.1:9.
- `python -I kb/tools/read_review_a_l_e2e.py http://127.0.0.1:5103 3317 row_lane_c`: ALL PASS (cross-scope call 403
  and legitimate call 200 for each fixed route, plus the privacy checks). Test rows removed, flags restored, change-log
  rows of the test removed.
- `python -I kb/tools/scope_read_guard_e2e.py http://127.0.0.1:5103 3317 row_lane_c`: ALL PASS (7/7).

## Open issues (not changed here)

1. In-prefix child ids are not bound to the club in the path. The read guard checks `/api/clubs/{clubId}` only; the
   handlers then load `{id}` without `fk_club_id = @ClubId`, so a member of club A reads club B's record through
   `/api/clubs/A/...{B's id}`. Verified: announcements/{id}, attendance/{id}, board-of-directors/{id}, documents/{id},
   website-data/banners/{id}. Likely the same: website-data about/advertisements/contact_details/social_media_links/
   menu_list/{id}, district upcoming-events/announcements/newsletters/documents/sub-groups/{id}. Bound already:
   mass-emails/{id} (BelongsToAsync), grants (scope in the WHERE), comms campaigns (owner in the WHERE). Needs its own
   task across both lanes.
2. `EventPaymentLinksController` writes still pass for any Admin (create, update, delete, offline payments, receipts,
   Google Sheets on any link). Same fix shape as the reads (`ManagesAsync` / `CanReadLinkAsync`).
3. `MobileClubDuesController.CanPayForClubAsync` (lane B file) lacks the campaign-district match added here.
4. `IsPersonalDetailsVisible` is not applied by `/api/district-directory` (PDF directory) nor by the public club
   calendar (birthdays by any date). Product decision: what the printed directory and the public calendar should
   show for members who hid personal details.
5. Find a Rotarian search accepts `mobile=` and matches hidden numbers (lets a caller confirm a number belongs to a
   member). Birth year is sent although the app shows day and month only.
6. `rotary-org-terminated-members` returns `detail = ex.Message` on a Rotary.org failure (502); generic message would
   be safer in production.

## New modules (build spec v4.1) in these files

Outside the guarded prefixes they are in the table below; inside them each reads with its own check on top of the
read guard, and child ids are bound to the scope:
- Chat (`/api/chat/*`): ChatService answers only for conversations the caller is in; moderation reports need
  CanModerateAsync. Comms (`.../comms/*`): managers only (DenyAsync), campaign id bound to the owner.
  Contacts (`.../contacts`, `.../contact-groups`): managers only, owner-scoped lists.
- Grants (`.../grants/**`): managers only (ScopeWriteGuardMiddleware.AllowedAsync), application and cycle ids bound
  to the club or district in the WHERE. Growth (`.../growth`, `.../invite-prompts`): club or district readers;
  invite link for the club's own members only.
- Engagement: cards and the spotlight image for managers of the event's club or district; highlights for readers.
  Foundation designations (`/api/members/{id}/foundation-designations`): the member, a manager of a club they are in
  or of its district, SuperAdmin.

## Routes reviewed

| Route | Before | Verdict | Why |
|---|---|---|---|
| `GET /api/admin/members-with-roles` (AdminController) | any Admin (every club and district admin) | fixed | every member's email and mobile across all clubs; now SuperAdmin only (no caller outside Settings) |
| `GET /api/admin/audit-log` (AdminController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/ag-dashboard/available-years` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/clubs` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/clubs/{clubId:int}` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/membership` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/trf` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/excellence` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/youth` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/projects/{projectId:int}` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/projects` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag-dashboard/district` (AgDashboardController) | AG or SuperAdmin role; service keeps to the caller's own district_ag clubs (a clubId/districtId outside them is refused) | ok | scoped by the AG assignment table |
| `GET /api/ag/reports/my-clubs` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/my-years` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/clubs` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-members` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-leadership` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/board-of-directors` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-websites` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-announcements` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-upcoming-events` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-attendance` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-documents` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/rotary-projects` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/trf-contributions` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/newsletters` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/club-monthly-reports` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/members-full-details` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/members-contact-summary` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/members-addresses` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/mobile-app-users` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/potential-members` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/ag/reports/family-details` (AgReportsController) | AG role; every query runs over the caller's district_ag clubs only (StartAsync, my-clubs, my-years) | ok | a clubId outside the AG's clubs returns nothing |
| `GET /api/area-of-focus` (AreaOfFocusController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/area-of-focus/{id}` (AreaOfFocusController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/auth/login-logs` (AuthController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/designations` (BoardOfDirectorsController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/cashfree-kyc` (CashfreeKycController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/cashfree-kyc/{kycId}/detail` (CashfreeKycController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/chat/conversations` (ChatController) | the caller's own conversations | ok | no id |
| `GET /api/chat/conversations/{id:int}/members` (ChatController) | ChatService.ConvAsync: caller must be in the conversation | ok | a conversation the caller is not in answers 404 |
| `GET /api/chat/conversations/{id:int}/messages` (ChatController) | ChatService.ConvAsync: caller must be in the conversation | ok | a conversation the caller is not in answers 404 |
| `GET /api/{clubs\|districts}/{ownerId}/chat-moderation/reports` (ChatController) | guard prefix at run time (/api/clubs\|districts/{id}) + CanModerateAsync | ok | moderators of that club or district only |
| `GET /api/citation-matrix` (CitationMatrixController) | any signed-in user, any districtId | fixed | per-club citation detail: readers of the district (members of its clubs, its admins, SuperAdmin) or of the named club, the rule /district-report and /club-report already follow |
| `GET /api/club-admin-dashboard/available-years` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/overview` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/foundation` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/membership` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/avenue` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/egovernance` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/communication` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/website` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/payments` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/dashboard-directory` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/dashboard-bod` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/dashboard-rotary-network` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/service-projects-overview` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/service-projects-avenue` (ClubAdminDashboardController) | Admin role; ResolveClubIdAsync: club admin of the clubId, district admin with all-clubs access, SuperAdmin | ok | a clubId the caller does not administer answers 403 |
| `GET /api/club-admin-dashboard/rotary-org-terminated-members` (ClubAdminDashboardController) | any Admin, any clubId | fixed | Rotary.org terminated members with their mobile and email: only someone who manages the named club (ScopeWriteGuardMiddleware.AllowedAsync) |
| `GET /api/club-analytics/excel` (ClubAnalyticsController) | any Admin, any clubId or districtId | fixed | President and Secretary mobile/email per club: readers of the named club or district; all clubs stays SuperAdmin |
| `GET /api/club-dues` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/{id}` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/{id}/clubs` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin, or the admin of the campaign's district (the existing fallback) |
| `GET /api/club-dues/{id}/clubs/{clubId}/members` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin, or the admin of the campaign's district (the existing fallback) |
| `GET /api/club-dues/payments/{paymentId}/offline-details` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin, or the admin of the campaign's district (the existing fallback) |
| `GET /api/club-dues/{id}/clubs/{clubId}/vendors` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/{id}/all-club-vendors` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/{id}/clubs/{clubId}/offline-accounts` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin, or the admin of the campaign's district (the existing fallback) |
| `GET /api/club-dues/officer/{duesId}/offline-accounts` (ClubDuesController) | current President/Secretary/Treasurer of clubId, any campaign | fixed | the campaign must belong to the club's district (else any officer opened another district's campaign, bank details and pay link) |
| `GET /api/club-dues/{id}/export` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/{id}/clubs/{clubId}/pay-link` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin only: the Settings page is the only caller (district admins use /content and /clubs) |
| `GET /api/club-dues/officer/my-clubs` (ClubDuesController) | the caller's own officer clubs | ok | no id |
| `GET /api/club-dues/officer/{duesId}` (ClubDuesController) | current President/Secretary/Treasurer of clubId, any campaign | fixed | the campaign must belong to the club's district (else any officer opened another district's campaign, bank details and pay link) |
| `GET /api/club-dues/officer/{duesId}/pay-link` (ClubDuesController) | current President/Secretary/Treasurer of clubId, any campaign | fixed | the campaign must belong to the club's district (else any officer opened another district's campaign, bank details and pay link) |
| `GET /api/club-dues/my-district` (ClubDuesController) | any Admin for any districtId | fixed | SuperAdmin or that district's admin; others get their own district-admin campaigns only |
| `GET /api/club-dues/{id}/content` (ClubDuesController) | any Admin (every club admin) | fixed | SuperAdmin, or the admin of the campaign's district (the existing fallback) |
| `GET /api/mobile/club-finder` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/near-me` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/{clubId}` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/{clubId}/members` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/members/{memberId}` (ClubFinderController) | any signed-in member; phone/email flags only | fixed | network directory by design; now also hides phone, email, dates and home address when the member turned personal details off, the family photo when family details are off; the second mobile follows the phone flag |
| `GET /api/mobile/club-finder/{clubId}/events` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/events/{eventId}` (ClubFinderController) | any signed-in member; organiser email and mobile unfiltered | fixed | organiser email/mobile dropped (no privacy flag applied; the app shows neither) |
| `GET /api/mobile/club-finder/{clubId}/project-years` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/{clubId}/projects` (ClubFinderController) | any signed-in member | ok | Club Finder: every club is findable by registered members by design (same data as the public club site); the member list applies the phone/email flags |
| `GET /api/mobile/club-finder/projects/{projectId}` (ClubFinderController) | any signed-in member; creator email and mobile unfiltered | fixed | creator email/mobile dropped (no privacy flag applied; the app shows neither) |
| `GET /api/club-foundation-goals/list` (ClubFoundationGoalsController) | Admin role; ResolveClubIdAsync (club admin, DA all-clubs, SuperAdmin) | ok | flagged module |
| `GET /api/public/club/{clubId:int}/gallery` (ClubGalleryPublicController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/past-events` (ClubGalleryPublicController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/admin/club-leadership` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-leadership/club-members` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-leadership/debug/member-roles` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-leadership/all-schedules` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-leadership/schedule-log` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-leadership/email-status` (ClubLeadershipController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/public/club-website/by-host` (ClubWebsitePublicController) | anonymous | public by design | host to tenant lookup / signed renewal links; no personal data |
| `GET /api/public/club-website/renew-link` (ClubWebsitePublicController) | anonymous | public by design | host to tenant lookup / signed renewal links; no personal data |
| `GET /api/public/club/{clubId:int}/years` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/about` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/banners` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/advertisements` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/bod` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/directory` (ClubWebsitePublicDataController) | anonymous | public by design | club site member directory: phone/email only where the member allows all clubs |
| `GET /api/public/club/{clubId:int}/past-presidents` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/calendar` (ClubWebsitePublicDataController) | anonymous | public by design | names and photos of the day's birthdays; the site lets visitors pick the date (open issue: IsPersonalDetailsVisible) |
| `GET /api/public/club/{clubId:int}/projects/{projectId:int}` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/clubs/{clubId:int}/projects/{projectId:int}` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/projects` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/snapshot` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/projects` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/meetings` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/menus` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/international-president` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/district-governor` (ClubWebsitePublicDataController) | anonymous | public by design | DG mobile/email: the public District Governors page lists them |
| `GET /api/public/club/{clubId:int}/upcoming-events` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/newsletters` (ClubWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/banners` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/advertisements` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/impact` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/years` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/about` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/bod` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/gallery` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/club/{clubId:int}/v2/projects` (ClubWebsitePublicDataV2Controller) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/admin/club-websites` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/{id}/logs` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/available-clubs` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/club-history` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/settings` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/domain-plesk-status` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/plesk/diagnostic-subdomain` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/plesk/diagnostic` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/plesk/list-subdomains` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/plesk/test-connection` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/pricing/route-account` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/default-pricing` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/pricing/years` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/club-websites/pricing` (ClubWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/clubs` (ClubsController) | signed-in user | ok | org directory (names, cities, meeting times, counts); no member data |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/settings` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/templates` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/domains` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/usage` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/campaigns/{massEmailId:int}` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/suppressions` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/{scope:regex(^(clubs\|districts)$)}/{id:int}/comms/opt-outs` (CommsController) | guard prefix at run time (/api/clubs\|districts/{id}/comms) + DenyAsync (managers) | ok | campaign id bound to the owner in the query |
| `GET /api/mobile/comms/preferences` (CommsController) | the caller's own preferences | ok | no id |
| `GET /api/public/comms/unsubscribe/{token}` (CommsController) | anonymous, signed token | public by design | the unsubscribe link in the email |
| `GET /api/{scope:regex(^clubs$\|^districts$)}/{ownerId:int}/contacts` (ContactsController) | guard prefix at run time + DenyReadAsync (managers) | ok | list scoped to the owner |
| `GET /api/{scope:regex(^clubs$\|^districts$)}/{ownerId:int}/contact-groups` (ContactsController) | guard prefix at run time + DenyReadAsync (managers) | ok | list scoped to the owner |
| `GET /api/countries` (CountriesController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/credit-management` (CreditManagementController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/credit-management/club/{clubId}/balance` (CreditManagementController) | club admin of the club or admin of its district, SuperAdmin | ok | CanView*BalanceAsync |
| `GET /api/credit-management/district/{districtId}/balance` (CreditManagementController) | club admin of the club or admin of its district, SuperAdmin | ok | CanView*BalanceAsync |
| `GET /api/credit-management/notifications` (CreditManagementController) | Admin; club from a token claim that does not exist, so always empty | ok | returns nothing |
| `GET /api/credit-management/usage-history` (CreditManagementController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/daily-stats-report/preview` (DailyStatsReportController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/dashboard/resolve-landing` (DashboardResolverController) | the caller's own roles | ok | no id |
| `GET /api/mobile/dashboard/resolve-landing` (DashboardResolverController) | the caller's own roles | ok | no id |
| `GET /api/district-admin-dashboard/overview` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/membership` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/foundation` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/communication` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/egovernance` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/members` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/rotary-network` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/rotary-network/live-terminated` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/rotary-network/refresh-terminated-cache/status` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/egovernance/per-club` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/membership-goal` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/foundation-goal` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/district-admin-dashboard/project-targets` (DistrictAdminDashboardController) | Admin role; ResolveDistrictIdAsync: admin of the districtId, SuperAdmin; clubId filtered inside that district | ok | another district answers 403 |
| `GET /api/club-award-status` (DistrictAdminDashboardController) | Admin, AG or SuperAdmin role, any clubId | fixed | readers of the club (its members, its admins, its district's admins); checked in the service, so the /api/mobile/district-admin-dashboard twins are covered too |
| `GET /api/club-myrotary` (DistrictAdminDashboardController) | Admin, AG or SuperAdmin role, any clubId | fixed | readers of the club (its members, its admins, its district's admins); checked in the service, so the /api/mobile/district-admin-dashboard twins are covered too |
| `GET /api/district-directory/{districtNumber}` (DistrictDirectoryController) | any signed-in user, any district: every member's full profile incl. push token and IMEI | fixed | readers of the district (members of its clubs, its admins, SuperAdmin); device and sign-in columns dropped; second mobile/email follow the phone/email flags |
| `GET /api/district-governors` (DistrictGovernorController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-governors/{id}` (DistrictGovernorController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-governors/filter-districts` (DistrictGovernorController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-governors/filter-years` (DistrictGovernorController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-governors/search-members` (DistrictGovernorController) | any signed-in user | fixed | name/mobile/email search over every member: SuperAdmin only, like the rest of this page |
| `GET /api/mass-emails/sender-info` (DistrictModulesController) | anonymous | public by design | one constant sender address |
| `GET /api/district-admin/districts/{districtId}/all-clubs` (DistrictModulesController) | SuperAdmin or district admin with all-clubs access of that district | ok | checked inline |
| `GET /api/district-modules/citation/activities` (DistrictModulesController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/district-modules/citation/meeting-types` (DistrictModulesController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/district-modules/citation/area-of-focus` (DistrictModulesController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/district-performance-report/settings` (DistrictPerformanceReportController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-performance-report/districts` (DistrictPerformanceReportController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-performance-report/view` (DistrictPerformanceReportController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/district-performance-report/excel` (DistrictPerformanceReportController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/public/district/{districtId:int}/menus` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/citation/performance` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/citation/years` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/by-host` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/site` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/about` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/dignitaries` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/events` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/newsletters` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/committee` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/clubs` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/public/district/{districtId:int}/clubs/{clubId:int}/board` (DistrictWebsitePublicDataController) | anonymous | public by design | public site data: names, photos, designations and content the page shows; no contacts |
| `GET /api/admin/district-websites` (DistrictWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/district-websites/{id}/logs` (DistrictWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/district-websites/available-districts` (DistrictWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/district-websites/plesk/test-connection` (DistrictWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/district-websites/plesk/list-subdomains` (DistrictWebsitesController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/districts` (DistrictsController) | signed-in user | ok | org directory (names, cities, meeting times, counts); no member data |
| `GET /api/email-log` (EmailLogController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/email-log/export` (EmailLogController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/email-log/{id:long}` (EmailLogController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/email-log/summary` (EmailLogController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/email-log/club/{clubId:int}` (EmailLogController) | SuperAdmin, club admin, district admin with all-clubs access | ok | CanAccessClubAsync |
| `GET /api/email-log/club/{clubId:int}/summary` (EmailLogController) | SuperAdmin, club admin, district admin with all-clubs access | ok | CanAccessClubAsync |
| `GET /api/email-log/club/{clubId:int}/export` (EmailLogController) | SuperAdmin, club admin, district admin with all-clubs access | ok | CanAccessClubAsync |
| `GET /api/email-log/district/{districtId:int}` (EmailLogController) | SuperAdmin or that district's admin | ok | CanAccessDistrictAsync |
| `GET /api/email-log/district/{districtId:int}/summary` (EmailLogController) | SuperAdmin or that district's admin | ok | CanAccessDistrictAsync |
| `GET /api/email-log/district/{districtId:int}/export` (EmailLogController) | SuperAdmin or that district's admin | ok | CanAccessDistrictAsync |
| `GET /api/engagement/spotlight-cards/{id:int}/image` (EngagementController) | managers of the event's club or district | ok | ManagesEventAsync; flagged module |
| `GET /api/event-masters/tshirt-sizes` (EventMastersController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/event-masters/food-preferences` (EventMastersController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/event-payment-links` (EventPaymentLinksController) | any Admin, any clubId/districtId (none = every link) | fixed | managers of the named club or district; no filter = SuperAdmin |
| `GET /api/event-payment-links/{linkId}` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/subgroup-years` (EventPaymentLinksController) | any Admin | ok | rotary year labels only |
| `GET /api/event-payment-links/{linkId}/registrations` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/{linkId}/vendor-splits` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/{linkId}/designations` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/{linkId}/members` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/member-payment/{memberPaymentId}` (EventPaymentLinksController) | any Admin | fixed | payment detail (name, mobile, email, bank) only for managers of the payment link's club or district |
| `GET /api/event-payment-links/{linkId}/settlement-report` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/event-payment-links/{linkId}/members/export` (EventPaymentLinksController) | any Admin | fixed | registrations, payers and bank splits: managers of the link's club or district (SuperAdmin, club admin/AG, district admin) |
| `GET /api/features` (FeaturesController) | signed-in user | ok | feature switch list, no record |
| `GET /api/mobile/find-rotarian` (FindRotarianController) | any signed-in member | ok | Find a Rotarian search by design; phone/email flags applied per row |
| `GET /api/mobile/find-rotarian/{memberId}` (FindRotarianController) | any signed-in member; phone/email flags only | fixed | network directory by design; now hides phone, email, dates and home address when personal details are off, the family photo when family details are off; the second mobile follows the phone flag |
| `GET /api/members/{memberId:int}/foundation-designations` (FoundationDesignationsController) | the member, a manager of a club they are in or of its district, SuperAdmin | ok | CanManageAsync |
| `GET /api/funding` (FundingController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/funding/{id}` (FundingController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/admin/global-member-search` (GlobalMemberSearchController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/global-member-search/{memberId:int}/card` (GlobalMemberSearchController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/global-search` (GlobalSearchController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/global-search/no-zone-districts` (GlobalSearchController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/goal-setting/categories` (GoalSettingController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/goal-setting/clubs/{categoryId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/monthly/clubs/{categoryId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/goals-excel/districts` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/goals-excel/clubs` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/goals-excel/clubs-all` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/monthly/districts/{categoryId:int}/excel` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/monthly/clubs/{categoryId:int}/excel` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/monthly/districts/{categoryId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/monthly/districts/{categoryId:int}/oversight` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}/clubs` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}/clubs-matrix` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}/clubs-monthly-matrix` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/goals-excel/clubs-all/oversight` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}/clubs-matrix/oversight` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/districts/{categoryId:int}/clubs-monthly-matrix/oversight` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/overview` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/district-summary-matrix` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/scoped/districts/{categoryId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/district-report` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/district-report/{districtId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/comments/{categoryId:int}/{districtId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/messages/has-unread` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/district-messages/{categoryId:int}/{districtId:int}` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/district-messages/inbox` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/messages/report` (GoalSettingController) | Resolve*IdAsync (club admin / admin of the district, SuperAdmin); oversight and reports SuperAdmin; messages by thread tier | ok | every id-taking route resolves the caller's scope in GoalSettingService |
| `GET /api/goal-setting/foundation-import/sample` (GoalSettingController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/goal-setting/foundation-import/club/sample` (GoalSettingController) | signed-in user | ok | reference / master data, no club or member record |
| `GET /api/i18n/{locale}` (I18nController) | anonymous | public by design | UI string catalogue |
| `GET /api/admin/international-president/all` (InternationalPresidentController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/admin/international-president` (InternationalPresidentController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/login-announcements` (LoginAnnouncementController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/login-announcements/{id}` (LoginAnnouncementController) | SuperAdmin only | ok | SuperAdmin page; nothing else needed |
| `GET /api/login-announcements/active` (LoginAnnouncementController) | the caller's own announcements | ok | no id |
| `GET /api/mobile/login-announcement/active` (LoginAnnouncementController) | the caller's own announcements | ok | no id |
