# Read review of GET routes, controllers M to Z (H1 part B)

Date: 2026-10-24. Lane d. Notes for the orchestrator; nothing here is user-facing.

## Scope

Every GET route in `row/api/Controllers/M*.cs` to `Z*.cs` (317 routes), except `MobileCalendarController` (lane a)
and the mass email controllers (lane b; `MassEmailMediaController` has no GET). The modules built in the last rounds
are included: Meetings (N8), Speakers and Volunteers, Target dashboard (N10), Tenants and editions, Website languages,
the public join and invite pages (N3) and Potential members.

Routes under `/api/clubs/{id}/**` and `/api/districts/{id}/**` are covered by the read rule in
`ScopeWriteGuardMiddleware` (members and managers of that club or district). They are listed in the table as "ok"
without a new check; nested record ids inside them are flagged below.

## Root cause found in four controllers

`MembershipDuesController`, `MobileClubAdminMembershipDuesController`, `MobileClubAdminPastPresidentsController` and
`MobileClubAdminReportController` "pinned" a club admin to their own club with a `clubId` JWT claim. ROW never issues
that claim (web and app tokens carry memberId, name, email, roles, and on the app loginType, memberType, familyMemberId,
imei). So any Admin could read any club's dues, reports, past presidents and member search, and club admins were
refused their own past-president records. The dead claim lookups are replaced by database checks.

## Change

- `ScopeWriteGuardMiddleware.ReadAllowedAsync` is now `internal static (connectionString, memberId, isClub, scopeId,
  members = true)`: the middleware's own read rule, reusable by controllers that read a club or district named
  outside the URL. `members: false` keeps the managers only: the club's admins, its AGs, district admins with
  all-clubs access, and whoever manages the club's district; SuperAdmin always. The middleware itself behaves as
  before.
- 41 routes in 13 controllers now check the record they read (table below, verdict "fixed"). Rules used:
  - App twins of a web route under `/api/clubs/{id}` or `/api/districts/{id}` get the web route's rule (members and
    managers), on top of their existing role check: club report, district report (AGs stay limited to their own
    clubs), district awards, weblinks.
  - Admin data outside those prefixes gets managers only: dues campaigns (web and app), past presidents (app, the
    same check now also guards its create, update and delete), club award status and MyRotary figures, recipient
    counts and email credits, the CMR CC list (district admins), the Rotary.org project sync token.
  - A member profile (`GET /api/members/{id}`): the member, SuperAdmin, or anyone who may read one of the member's
    clubs (its members, its managers, its district's managers).
  - A device token: the member or SuperAdmin.
  - App club dues: the campaign must belong to the officer's club's district.
- Every denial answers 403 with a short message. Detail routes keep their 404 for a missing record; the dues routes
  that look the campaign up first (`/members`, `/export`, `/settlement-report`, payment details) answer 403 for a
  campaign that does not exist.

## Route table

Before = what the route checked before this review. Verdict: ok (already scoped or no record id), fixed, public by
design. "(flagged)" = see open issues.

| # | Route (GET) | Controller | Before | Verdict | Why |
|---|---|---|---|---|---|
| 1 | `/api/clubs/{clubId:int}/calendar-feed` | MeetingsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 2 | `/api/mobile/calendar-feed` | MeetingsController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 3 | `/api/public/calendar/{token}.ics` | MeetingsController | anonymous, signed token | public by design | 64-hex feed token; feature flag "meetings" |
| 4 | `/api/districts/{districtId:int}/meeting-compliance` | MeetingsController | middleware read rule | ok | own check: district managers only (AllowedAsync) |
| 5 | `/api/clubs/{clubId:int}/meeting-compliance` | MeetingsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 6 | `/api/admin/member-duplicates/count` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 7 | `/api/admin/member-duplicates/list` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 8 | `/api/admin/member-duplicates/pair` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 9 | `/api/admin/member-duplicates/merge-history` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 10 | `/api/admin/member-duplicates/districts` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 11 | `/api/admin/member-duplicates/clubs` | MemberDuplicateController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 12 | `/api/members` | MembersController | signed-in; contact fields masked by the member privacy flags | ok (flagged) | no record id; directory search used by SuperAdmin add-member and the club admin "add existing member" dialog; see open issue on search by phone / email |
| 13 | `/api/members/{id}` | MembersController | signed-in only (any member's birth date, addresses, family) | fixed | self, SuperAdmin, or anyone who may read one of the member's clubs (its members, managers, district managers) |
| 14 | `/api/members/{id}/device-token` | MembersController | signed-in only (any member's push token) | fixed | self or SuperAdmin |
| 15 | `/api/membership-dues` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 16 | `/api/membership-dues/{id}` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 17 | `/api/membership-dues/{id}/members` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 18 | `/api/membership-dues/payments/{paymentId}/offline-details` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 19 | `/api/clubs/{clubId}/membership-dues/pending-offline-approvals` | MembershipDuesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 20 | `/api/membership-dues/{id}/settlement-report` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 21 | `/api/membership-dues/{id}/export` | MembershipDuesController | role claim only (Admin / SuperAdmin), no scope check; list "scoped" by the never-issued clubId claim | fixed | managers of the campaign's club or its district, or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 22 | `/api/mobile/ag-dashboard/available-years` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 23 | `/api/mobile/ag-dashboard/clubs` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 24 | `/api/mobile/ag-dashboard/clubs/{clubId:int}` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 25 | `/api/mobile/ag-dashboard/membership` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 26 | `/api/mobile/ag-dashboard/trf` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 27 | `/api/mobile/ag-dashboard/excellence` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 28 | `/api/mobile/ag-dashboard/youth` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 29 | `/api/mobile/ag-dashboard/projects/{projectId:int}` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 30 | `/api/mobile/ag-dashboard/projects` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 31 | `/api/mobile/ag-dashboard/district` | MobileAgDashboardController | AG / SuperAdmin role; service limits to the caller's district_ag clubs | ok | AgDashboardService resolves clubs from district_ag for the caller and refuses other clubs / projects |
| 32 | `/api/auth/my-context` | MobileAuthController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 33 | `/api/mobile/club-admin-dashboard/available-years` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 34 | `/api/mobile/club-admin-dashboard/overview` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 35 | `/api/mobile/club-admin-dashboard/foundation` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 36 | `/api/mobile/club-admin-dashboard/membership` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 37 | `/api/mobile/club-admin-dashboard/avenue` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 38 | `/api/mobile/club-admin-dashboard/egovernance` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 39 | `/api/mobile/club-admin-dashboard/communication` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 40 | `/api/mobile/club-admin-dashboard/website` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 41 | `/api/mobile/club-admin-dashboard/payments` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 42 | `/api/mobile/club-admin-dashboard/dashboard-directory` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 43 | `/api/mobile/club-admin-dashboard/dashboard-bod` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 44 | `/api/mobile/club-admin-dashboard/dashboard-rotary-network` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 45 | `/api/mobile/club-admin-dashboard/service-projects-overview` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 46 | `/api/mobile/club-admin-dashboard/service-projects-avenue` | MobileClubAdminDashboardController | Admin / SuperAdmin role; service ResolveClubIdAsync | ok | club admin of that club, district admin with all-clubs access, or SuperAdmin |
| 47 | `/api/mobile/club-admin/membership-dues` | MobileClubAdminMembershipDuesController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | managers of the campaign's club or its district (ReadAllowedAsync members:false), or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 48 | `/api/mobile/club-admin/membership-dues/{id}` | MobileClubAdminMembershipDuesController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | managers of the campaign's club or its district (ReadAllowedAsync members:false), or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 49 | `/api/mobile/club-admin/membership-dues/{id}/members` | MobileClubAdminMembershipDuesController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | managers of the campaign's club or its district (ReadAllowedAsync members:false), or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 50 | `/api/mobile/club-admin/membership-dues/payments/{paymentId}/offline-details` | MobileClubAdminMembershipDuesController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | managers of the campaign's club or its district (ReadAllowedAsync members:false), or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 51 | `/api/mobile/club-admin/membership-dues/pending-offline-approvals` | MobileClubAdminMembershipDuesController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | managers of the campaign's club or its district (ReadAllowedAsync members:false), or the district's admins for a district campaign; list without a club or district: SuperAdmin only |
| 52 | `/api/mobile/club-admin/past-presidents` | MobileClubAdminPastPresidentsController | role claim only; club "pinned" by a clubId token claim that is never issued (and club admins were refused their own rows) | fixed | managers of the club (AllowedAsync); {id} through the row's club |
| 53 | `/api/mobile/club-admin/past-presidents/{id}` | MobileClubAdminPastPresidentsController | role claim only; club "pinned" by a clubId token claim that is never issued (and club admins were refused their own rows) | fixed | managers of the club (AllowedAsync); {id} through the row's club |
| 54 | `/api/mobile/club-admin/past-presidents/search-members` | MobileClubAdminPastPresidentsController | role claim only; club "pinned" by a clubId token claim that is never issued (and club admins were refused their own rows) | fixed | managers of the club (AllowedAsync); {id} through the row's club |
| 55 | `/api/mobile/club-admin/past-presidents/years` | MobileClubAdminPastPresidentsController | signed-in | ok | global lookup, no club / district / member record |
| 56 | `/api/mobile/club-admin/club-report` | MobileClubAdminReportController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | SuperAdmin / Admin role and the web club-report rule: members and managers of the club (ReadAllowedAsync) |
| 57 | `/api/mobile/club-admin/club-report/avenue-of-service-raw-data` | MobileClubAdminReportController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | SuperAdmin / Admin role and the web club-report rule: members and managers of the club (ReadAllowedAsync) |
| 58 | `/api/mobile/club-admin/club-report/annual-club-service-raw-data` | MobileClubAdminReportController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | SuperAdmin / Admin role and the web club-report rule: members and managers of the club (ReadAllowedAsync) |
| 59 | `/api/mobile/club-admin/club-report/annual-report` | MobileClubAdminReportController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | SuperAdmin / Admin role and the web club-report rule: members and managers of the club (ReadAllowedAsync) |
| 60 | `/api/mobile/club-admin/club-report/available-years` | MobileClubAdminReportController | role claim only; club "pinned" by a clubId token claim that is never issued | fixed | SuperAdmin / Admin role and the web club-report rule: members and managers of the club (ReadAllowedAsync) |
| 61 | `/api/mobile/club-dues/my-clubs` | MobileClubDuesController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 62 | `/api/mobile/club-dues/{duesId}` | MobileClubDuesController | current-year president / secretary / treasurer of clubId; dues id not tied to the club | fixed | and the campaign must belong to the club's district (else 404) |
| 63 | `/api/mobile/club-foundation-goals/list` | MobileClubFoundationGoalsController | Admin / SuperAdmin role; service resolves the club | ok | FoundationGoalsService refuses clubs the caller does not administer |
| 64 | `/api/mobile/district-admin-dashboard/overview` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 65 | `/api/mobile/district-admin-dashboard/membership` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 66 | `/api/mobile/district-admin-dashboard/foundation` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 67 | `/api/mobile/district-admin-dashboard/communication` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 68 | `/api/mobile/district-admin-dashboard/egovernance` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 69 | `/api/mobile/district-admin-dashboard/members` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 70 | `/api/mobile/district-admin-dashboard/egovernance/per-club` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 71 | `/api/mobile/district-admin-dashboard/membership-goal` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 72 | `/api/mobile/district-admin-dashboard/foundation-goal` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 73 | `/api/mobile/district-admin-dashboard/project-targets` | MobileDistrictAdminDashboardController | Admin / SuperAdmin role; service ResolveDistrictIdAsync | ok | district admin of that district or SuperAdmin |
| 74 | `/api/mobile/club-award-status` | MobileDistrictAdminDashboardController | role claim only (Admin / SuperAdmin / AG) | fixed | managers of the club and its district's admins (ReadAllowedAsync members:false) |
| 75 | `/api/mobile/club-myrotary` | MobileDistrictAdminDashboardController | role claim only (Admin / SuperAdmin / AG) | fixed | managers of the club and its district's admins (ReadAllowedAsync members:false) |
| 76 | `/api/mobile/district-admin/district-report` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 77 | `/api/mobile/district-admin/district-report/ocv-gov` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 78 | `/api/mobile/district-admin/district-report/club-officers-ri` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 79 | `/api/mobile/district-admin/district-report/available-years` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 80 | `/api/mobile/district-admin/district-report/avenue-of-service-all-clubs` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 81 | `/api/mobile/district-admin/district-report/avenue-of-service-club-count` | MobileDistrictAdminReportController | role claim only (Admin / SuperAdmin / AG); districtId unchecked for admins | fixed | admins: the web district-report rule, members and managers of the district (ReadAllowedAsync); AGs: own clubs only (unchanged) |
| 82 | `/api/mobile/districts/{districtId}/awards/categories` | MobileDistrictAwardsController | signed-in + kill switch only | fixed | the web district-modules rule: members and managers of the district |
| 83 | `/api/mobile/districts/{districtId}/awards/description` | MobileDistrictAwardsController | signed-in + kill switch only | fixed | the web district-modules rule: members and managers of the district |
| 84 | `/api/mobile/districts/{districtId}/awards/auto-questions` | MobileDistrictAwardsController | signed-in + kill switch only | fixed | the web district-modules rule: members and managers of the district |
| 85 | `/api/mobile/districts/{districtId}/awards/manual-questions` | MobileDistrictAwardsController | signed-in + kill switch only | fixed | the web district-modules rule: members and managers of the district |
| 86 | `/api/mobile/districts/{districtId}/awards/club-points` | MobileDistrictAwardsController | signed-in + kill switch only | fixed | the web district-modules rule: members and managers of the district |
| 87 | `/api/mobile/districts/{districtId:int}/cmr-email-settings` | MobileDistrictCmrEmailSettingsController | role claim only (Admin / SuperAdmin) | fixed | the district's admins (AllowedAsync district); the CC list holds email addresses |
| 88 | `/api/mobile/goal-setting/categories` | MobileGoalSettingController | signed-in | ok | global lookup, no club / district / member record |
| 89 | `/api/mobile/goal-setting/monthly/categories` | MobileGoalSettingController | signed-in | ok | global lookup, no club / district / member record |
| 90 | `/api/mobile/goal-setting/clubs/{categoryId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 91 | `/api/mobile/goal-setting/districts/{categoryId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 92 | `/api/mobile/goal-setting/monthly/clubs/{categoryId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 93 | `/api/mobile/goal-setting/monthly/districts/{categoryId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 94 | `/api/mobile/goal-setting/goals-excel/districts` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 95 | `/api/mobile/goal-setting/goals-excel/clubs` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 96 | `/api/mobile/goal-setting/goals-excel/clubs-all` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 97 | `/api/mobile/goal-setting/monthly/districts/{categoryId:int}/excel` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 98 | `/api/mobile/goal-setting/monthly/clubs/{categoryId:int}/excel` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 99 | `/api/mobile/goal-setting/districts/{categoryId:int}/clubs` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 100 | `/api/mobile/goal-setting/overview` | MobileGoalSettingController | SuperAdmin role | ok | SuperAdmin matrix |
| 101 | `/api/mobile/goal-setting/comments/{categoryId:int}/{districtId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 102 | `/api/mobile/goal-setting/district-messages/{categoryId:int}/{districtId:int}` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 103 | `/api/mobile/goal-setting/district-messages/inbox` | MobileGoalSettingController | Admin role; GoalSettingService ResolveClubIdAsync / ResolveDistrictIdAsync / thread tiers | ok | service refuses clubs and districts outside the caller's admin scope |
| 104 | `/api/mobile/goal-setting/foundation-import/sample` | MobileGoalSettingController | SuperAdmin role | ok | empty sample workbook |
| 105 | `/api/mobile/goal-setting/foundation-import/club/sample` | MobileGoalSettingController | SuperAdmin role | ok | empty sample workbook |
| 106 | `/api/admin/mobile-login-check` | MobileLoginCheckController | SuperAdmin only (DB role check) | ok | admin tool |
| 107 | `/api/mobile/member-settings` | MobileMemberSettingsController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 108 | `/api/mobile/my-membership-dues` | MobileMembershipDuesController | signed-in; rows filtered by the caller's memberId | ok | own fee allocation / own receipts only (ReceiptForbiddenException) |
| 109 | `/api/mobile/my-membership-dues/{duesId}` | MobileMembershipDuesController | signed-in; rows filtered by the caller's memberId | ok | own fee allocation / own receipts only (ReceiptForbiddenException) |
| 110 | `/api/mobile/my-membership-dues/payments/{paymentId:int}/receipt` | MobileMembershipDuesController | signed-in; rows filtered by the caller's memberId | ok | own fee allocation / own receipts only (ReceiptForbiddenException) |
| 111 | `/api/mobile/my-membership-dues/payments/{paymentId:int}/receipt/data` | MobileMembershipDuesController | signed-in; rows filtered by the caller's memberId | ok | own fee allocation / own receipts only (ReceiptForbiddenException) |
| 112 | `/api/mobile/notifications` | MobileNotificationsController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 113 | `/api/mobile/version-check` | MobileVersionController | anonymous | public by design | app version check, no data |
| 114 | `/api/admin/mobile-versions` | MobileVersionController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 115 | `/api/mobile/districts/{districtId}/weblinks` | MobileWeblinksController | signed-in + kill switch only | fixed | the web weblinks rule: members and managers of the district |
| 116 | `/api/mobile/clubs/{clubId}/weblinks` | MobileWeblinksController | signed-in + kill switch only | fixed | the web weblinks rule: members and managers of the club |
| 117 | `/api/module-categories` | ModulesController | signed-in | ok | global lookup, no club / district / member record |
| 118 | `/api/modules` | ModulesController | signed-in | ok | global lookup, no club / district / member record |
| 119 | `/api/modules/{id}` | ModulesController | signed-in | ok | global lookup, no club / district / member record |
| 120 | `/api/modules/{id}/usage` | ModulesController | signed-in | ok | global lookup, no club / district / member record |
| 121 | `/api/modules/coming-soon` | ModulesController | signed-in | ok | global lookup, no club / district / member record |
| 122 | `/api/districts/{districtId}/modules` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 123 | `/api/districts/{districtId}/modules/available` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 124 | `/api/clubs/{clubId}/modules` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 125 | `/api/clubs/{clubId}/modules/available` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 126 | `/api/districts/{districtId}/dashboard` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 127 | `/api/clubs/{clubId}/dashboard` | ModulesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 128 | `/api/clubs/{clubId}/newsletters` | NewslettersController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 129 | `/api/clubs/{clubId}/newsletters/{id}` | NewslettersController | middleware read rule (members and managers of the club) | ok (flagged) | nested record id is not tied to the club in the URL; see open issues |
| 130 | `/api/clubs/{clubId}/newsletters/years` | NewslettersController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 131 | `/api/clubs/{clubId}/ocv-gov/categories` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 132 | `/api/clubs/{clubId}/ocv-gov/document-types/{categoryId}` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 133 | `/api/clubs/{clubId}/ocv-gov/documents/{categoryId}` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 134 | `/api/clubs/{clubId}/ocv-gov/documents/{documentId}/download` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 135 | `/api/clubs/{clubId}/ocv-gov/report` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 136 | `/api/clubs/{clubId}/ocv-gov/report/word` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 137 | `/api/clubs/{clubId}/ocv-gov/report/excel` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 138 | `/api/clubs/{clubId}/ocv-gov/report/live-tables` | OcvGovController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 139 | `/api/clubs/{clubId}/past-presidents` | PastPresidentsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 140 | `/api/clubs/{clubId}/past-presidents/{id}` | PastPresidentsController | middleware read rule (members and managers of the club) | ok (flagged) | nested record id is not tied to the club in the URL; see open issues |
| 141 | `/api/clubs/{clubId}/past-presidents/search-members` | PastPresidentsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 142 | `/api/clubs/{clubId}/potential-members` | PotentialMembersController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 143 | `/api/clubs/{clubId}/potential-members/{id}` | PotentialMembersController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 144 | `/api/project-classification/search` | ProjectClassificationController | signed-in | ok | global lookup, no club / district / member record |
| 145 | `/api/clubs/{clubId}/projects` | ProjectsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 146 | `/api/clubs/{clubId}/projects/{yearId}/{id}` | ProjectsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 147 | `/api/clubs/{clubId}/projects/years` | ProjectsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 148 | `/api/clubs/{clubId}/projects/ongoing` | ProjectsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 149 | `/api/public/clubs/{clubId}/projects` | ProjectsController | anonymous | public by design | club website project list, no member data |
| 150 | `/api/public/brand` | PublicBrandController | anonymous | public by design | brand texts |
| 151 | `/api/health` | PublicBrandController | anonymous | public by design | status only |
| 152 | `/api/public/club-dues-approval/{token}` | PublicClubDuesApprovalController | anonymous, signed token | public by design | signed approval token |
| 153 | `/api/public/club-dues/{id}` | PublicClubDuesController | anonymous, signed token | public by design | signed pay link bound to dues + club (payments on hold) |
| 154 | `/api/public/club-dues/{id}/offline-accounts` | PublicClubDuesController | anonymous, signed token | public by design | signed pay link bound to dues + club (payments on hold) |
| 155 | `/api/public/club-dues/{id}/report` | PublicClubDuesController | anonymous | public by design (flagged) | district report page: club-level totals and payment references, no member data; sequential id (payments on hold, no rows) |
| 156 | `/api/public/club-website/{token}` | PublicClubWebsiteController | anonymous, signed token | public by design | signed purchase token |
| 157 | `/api/public/club-website/{token}/check-subdomain` | PublicClubWebsiteController | anonymous, signed token | public by design | signed purchase token |
| 158 | `/api/public/dues-approval/{token}` | PublicDuesApprovalController | anonymous, signed token | public by design | signed approval token |
| 159 | `/api/public/event-payment/{linkId}/report` | PublicEventPaymentController | anonymous | public by design (flagged) | the public report page shows payers' mobile and email; sequential link id (payments on hold, no rows) |
| 160 | `/api/public/event-payment/{linkId}` | PublicEventPaymentController | anonymous | public by design | pay page data (payments on hold) |
| 161 | `/api/public/event-payment/{linkId}/districts/{districtId}/clubs` | PublicEventPaymentController | anonymous | public by design | pay page data (payments on hold) |
| 162 | `/api/public/event-payment/{linkId}/search-members` | PublicEventPaymentController | anonymous | public by design (flagged) | pay page member picker; masked contacts but not limited to the link's districts (payments on hold, no rows) |
| 163 | `/api/public/event-payment/{linkId}/verify-payment` | PublicEventPaymentController | anonymous | public by design | pay page data (payments on hold) |
| 164 | `/api/public/join/club/{clubId:int}` | PublicJoinController | anonymous | public by design | club name, district clubs list; feature flag "contacts_growth" |
| 165 | `/api/public/join/district/{districtId:int}` | PublicJoinController | anonymous | public by design | club name, district clubs list; feature flag "contacts_growth" |
| 166 | `/api/public/invite/{token}` | PublicJoinController | anonymous, signed token | public by design | invite token; feature flag "contacts_growth" |
| 167 | `/api/public/membership-dues/{id}` | PublicMembershipDuesController | anonymous | public by design | pay page data (payments on hold) |
| 168 | `/api/public/membership-dues/{id}/search-members` | PublicMembershipDuesController | anonymous | public by design (flagged) | pay page member picker; returns full mobile and email of the club's members though the page shows them masked; sequential id (payments on hold, no rows) |
| 169 | `/api/public/membership-dues/{id}/verify-mobile-token` | PublicMembershipDuesController | anonymous | public by design | pay page data (payments on hold) |
| 170 | `/api/public/membership-dues/{id}/member/{memberProfileId}/status` | PublicMembershipDuesController | anonymous | public by design (flagged) | fee status of any member for any campaign id, without the OTP the pay page asks for (payments on hold, no rows) |
| 171 | `/api/public/membership-dues/{id}/verify-payment` | PublicMembershipDuesController | anonymous | public by design | pay page data (payments on hold) |
| 172 | `/api/public/membership-dues/{id}/report` | PublicMembershipDuesController | anonymous | public by design (flagged) | public report link: every member's dues status and the XLSX; sequential id (payments on hold, no rows) |
| 173 | `/api/public/membership-dues/{id}/report/export` | PublicMembershipDuesController | anonymous | public by design (flagged) | public report link: every member's dues status and the XLSX; sequential id (payments on hold, no rows) |
| 174 | `/api/public/ocv-live-documents` | PublicOcvLiveDocumentsController | anonymous | public by design (flagged) | governor-visit live documents; members and board tables include mobile and email; feature flag "ocv" off |
| 175 | `/api/public/ocv-live-documents/word` | PublicOcvLiveDocumentsController | anonymous | public by design (flagged) | governor-visit live documents; members and board tables include mobile and email; feature flag "ocv" off |
| 176 | `/api/public/projects/{id}` | PublicProjectController | anonymous | public by design | public project page / share card: project and club data, no member data |
| 177 | `/api/public/projects/{id:int}/share` | PublicProjectShareController | anonymous | public by design | public project page / share card: project and club data, no member data |
| 178 | `/api/public/projects/{id:int}/share-image.png` | PublicProjectShareController | anonymous | public by design | public project page / share card: project and club data, no member data |
| 179 | `/api/public/project-stats/overview` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 180 | `/api/public/project-stats/years` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 181 | `/api/public/project-stats/states` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 182 | `/api/public/project-stats/states/{state}/districts` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 183 | `/api/public/project-stats/districts` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 184 | `/api/public/project-stats/districts/{districtId:int}/clubs` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 185 | `/api/public/project-stats/clubs/{clubId:int}/areas` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 186 | `/api/public/project-stats/areas` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 187 | `/api/public/project-stats/summary` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 188 | `/api/public/project-stats/projects` | PublicProjectStatsController | anonymous | public by design | aggregated project statistics |
| 189 | `/api/public/wallet/{token}` | PublicWalletController | anonymous, signed token | public by design | signed wallet link (payments on hold) |
| 190 | `/api/public/wallet/{token}/search` | PublicWalletController | anonymous, signed token | public by design | signed wallet link (payments on hold) |
| 191 | `/api/public/wallet/{token}/entity/{entityId:int}` | PublicWalletController | anonymous, signed token | public by design | signed wallet link (payments on hold) |
| 192 | `/api/public/wallet/{token}/quote` | PublicWalletController | anonymous, signed token | public by design | signed wallet link (payments on hold) |
| 193 | `/api/public/website-directory/districts` | PublicWebsiteDirectoryController | anonymous | public by design | lists of club / district websites |
| 194 | `/api/public/website-directory/clubs` | PublicWebsiteDirectoryController | anonymous | public by design | lists of club / district websites |
| 195 | `/api/admin/push-logs/recent` | PushLogsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 196 | `/api/admin/push-logs/recipients` | PushLogsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 197 | `/api/admin/push-logs/stuck` | PushLogsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 198 | `/api/admin/razorpay-route-accounts` | RazorpayRouteAccountsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 199 | `/api/recipient-info/club/{clubId}` | RecipientInfoController | signed-in + kill switch only | fixed | managers of the club and its district's admins (they send for it) |
| 200 | `/api/recipient-info/district/{districtId}` | RecipientInfoController | signed-in + kill switch only | fixed | the district's admins |
| 201 | `/api/admin/reports/districts-list` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 202 | `/api/admin/reports/zones` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 203 | `/api/admin/reports/members-by-role` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 204 | `/api/admin/reports/districts` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 205 | `/api/admin/reports/district-governors` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 206 | `/api/admin/reports/clubs` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 207 | `/api/admin/reports/club-members` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 208 | `/api/admin/reports/club-leadership` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 209 | `/api/admin/reports/club-websites` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 210 | `/api/admin/reports/district-websites` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 211 | `/api/admin/reports/rotary-years` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 212 | `/api/admin/reports/designations` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 213 | `/api/admin/reports/themes` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 214 | `/api/admin/reports/module-master` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 215 | `/api/admin/reports/areas-of-focus` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 216 | `/api/admin/reports/funding` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 217 | `/api/admin/reports/international-president` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 218 | `/api/admin/reports/board-of-directors` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 219 | `/api/admin/reports/club-announcements` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 220 | `/api/admin/reports/club-upcoming-events` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 221 | `/api/admin/reports/club-attendance` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 222 | `/api/admin/reports/club-documents` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 223 | `/api/admin/reports/club-monthly-reports` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 224 | `/api/admin/reports/rotary-projects` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 225 | `/api/admin/reports/trf-contributions` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 226 | `/api/admin/reports/newsletters` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 227 | `/api/admin/reports/district-committee` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 228 | `/api/admin/reports/assistant-governors` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 229 | `/api/admin/reports/district-upcoming-events` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 230 | `/api/admin/reports/membership-dues` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 231 | `/api/admin/reports/event-payment-links` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 232 | `/api/admin/reports/district-citation` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 233 | `/api/admin/reports/members-full-details` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 234 | `/api/admin/reports/members-contact-summary` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 235 | `/api/admin/reports/mobile-app-users` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 236 | `/api/admin/reports/members-addresses` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 237 | `/api/admin/reports/club-weblinks` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 238 | `/api/admin/reports/potential-members` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 239 | `/api/admin/reports/club-mass-emails` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 240 | `/api/admin/reports/ocv-documents` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 241 | `/api/admin/reports/club-social-links` | ReportsController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 242 | `/api/admin/ri-admin-cleanup/preview` | RiAdminCleanupController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 243 | `/api/admin/rotary-org-manual-sync/clubs/compare` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 244 | `/api/admin/rotary-org-manual-sync/summary` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 245 | `/api/admin/rotary-org-manual-sync/clubs/sync-districts` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 246 | `/api/admin/rotary-org-manual-sync/clubs/sync-report` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 247 | `/api/admin/rotary-org-manual-sync/clubs/org-detail/{rotaryClubId:int}` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 248 | `/api/admin/rotary-org-manual-sync/clubs/india-detail/{clubId:int}` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 249 | `/api/admin/rotary-org-manual-sync/members/compare` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 250 | `/api/admin/rotary-org-manual-sync/members/org-detail/{rotaryMemberId:long}` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 251 | `/api/admin/rotary-org-manual-sync/members/india-detail/{memberId:int}` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 252 | `/api/admin/rotary-org-manual-sync/sync-exceptions` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 253 | `/api/admin/rotary-org-manual-sync/members/district-clubs` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 254 | `/api/admin/rotary-org-manual-sync/members/club-org-count` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 255 | `/api/admin/rotary-org-manual-sync/members/club-diff` | RotaryOrgManualSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 256 | `/api/rotary-org-sync/token` | RotaryOrgProjectSyncController | signed-in only (token for any club's project, sync log row in its name) | fixed | managers of the club (AllowedAsync) |
| 257 | `/api/settings/project-sync/clubs` | RotaryOrgProjectSyncLogController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 258 | `/api/settings/project-sync/clubs/{clubId:int}/projects` | RotaryOrgProjectSyncLogController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 259 | `/api/settings/project-sync/clubs/{clubId:int}/projects/{projectId:int}/history` | RotaryOrgProjectSyncLogController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 260 | `/api/admin/rotary-org-sync/ping` | RotaryOrgSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 261 | `/api/admin/rotary-org-sync/status/{logId:int}` | RotaryOrgSyncController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 262 | `/api/rotary-years` | RotaryYearsController | signed-in | ok | global lookup, no club / district / member record |
| 263 | `/api/rotary-years/current` | RotaryYearsController | signed-in | ok | global lookup, no club / district / member record |
| 264 | `/api/app/route-maintenance` | RouteMaintenanceController | signed-in | ok | global lookup, no club / district / member record |
| 265 | `/api/app/route-maintenance/all` | RouteMaintenanceController | SuperAdmin only (DB role check) | ok | admin tool |
| 266 | `/api/clubs/{clubId:int}/speakers` | SpeakersController | middleware read rule | ok | own check: club managers only (ManagesAsync) |
| 267 | `/api/clubs/{clubId:int}/meeting-duties` | SpeakersController | middleware read rule | ok | own check: club managers only (ManagesAsync) |
| 268 | `/api/mobile/meeting-duties` | SpeakersController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 269 | `/api/public/club/{clubId:int}/speakers` | SpeakersController | anonymous | public by design | upcoming speakers: name, topic, bio, photo; feature flag "volunteers" |
| 270 | `/api/clubs/{clubId}/sub-groups` | SubGroupsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 271 | `/api/clubs/{clubId}/sub-groups/{subGroupId}` | SubGroupsController | middleware read rule (members and managers of the club) | ok (flagged) | nested record id is not tied to the club in the URL; see open issues |
| 272 | `/api/clubs/{clubId}/sub-groups/club-members` | SubGroupsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 273 | `/api/clubs/{clubId}/sub-groups/available-years` | SubGroupsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 274 | `/api/admin/super-admins` | SuperAdminController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 275 | `/api/admin/super-admins/search-members` | SuperAdminController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 276 | `/api/districts/{districtId:int}/targets` | TargetDashboardController | middleware read rule | ok | service checks managers (TargetDashboardService) |
| 277 | `/api/clubs/{clubId:int}/targets` | TargetDashboardController | middleware read rule | ok | service checks managers (TargetDashboardService) |
| 278 | `/api/editions` | TenantsController | SuperAdmin only (claim check) | ok | tenant admin |
| 279 | `/api/tenants` | TenantsController | SuperAdmin only (claim check) | ok | tenant admin |
| 280 | `/api/tenants/{districtId:int}` | TenantsController | SuperAdmin only (claim check) | ok | tenant admin |
| 281 | `/api/tenants/{districtId:int}/state` | TenantsController | signed-in | ok | returns only planning / live for a district; no record data |
| 282 | `/api/themes` | ThemesController | signed-in | ok | global lookup, no club / district / member record |
| 283 | `/api/training-appointments/availability` | TrainingAppointmentController | SuperAdmin or club admin of clubId (CanActForClubAsync) | ok | already scoped |
| 284 | `/api/training-appointments/mine` | TrainingAppointmentController | SuperAdmin or club admin of clubId (CanActForClubAsync) | ok | already scoped |
| 285 | `/api/admin/training-appointments` | TrainingAppointmentController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 286 | `/api/admin/training-availability` | TrainingAppointmentController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 287 | `/api/clubs/{clubId}/trf/funds` | TrfContributionsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 288 | `/api/clubs/{clubId}/trf` | TrfContributionsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 289 | `/api/clubs/{clubId}/trf/year-total` | TrfContributionsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 290 | `/api/clubs/{clubId}/trf/month-total` | TrfContributionsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 291 | `/api/clubs/{clubId}/trf/by-month` | TrfContributionsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 292 | `/api/clubs/{clubId}/upcoming-events` | UpcomingEventsController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 293 | `/api/clubs/{clubId}/upcoming-events/{id}` | UpcomingEventsController | middleware read rule (members and managers of the club) | ok (flagged) | nested record id is not tied to the club in the URL; see open issues |
| 294 | `/api/clubs/{clubId:int}/volunteer-sheets` | VolunteersController | middleware read rule | ok | own check: club managers only (ManagesAsync) |
| 295 | `/api/clubs/{clubId:int}/volunteer-sheets/targets` | VolunteersController | middleware read rule | ok | own check: club managers only (ManagesAsync) |
| 296 | `/api/clubs/{clubId:int}/volunteer-sheets/{id:int}` | VolunteersController | middleware read rule | ok | own check: club managers only, row tied to club |
| 297 | `/api/mobile/volunteers` | VolunteersController | signed-in; caller's own data (memberId claim) | ok | reads only the caller's own rows |
| 298 | `/api/public/volunteers/{token}` | VolunteersController | anonymous, signed token | public by design | sign-up token; slots only, no names |
| 299 | `/api/wallet/quote` | WalletController | signed-in | ok | price quote, no record id (payments on hold) |
| 300 | `/api/admin/wallet/districts` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 301 | `/api/admin/wallet/club-balances` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 302 | `/api/admin/wallet/credit-entries` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 303 | `/api/admin/wallet/reports/club-website` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 304 | `/api/admin/wallet/reports/email` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 305 | `/api/admin/wallet/reports/district-email` | WalletLinksController | SuperAdmin only (claim check) | ok | SuperAdmin tool |
| 306 | `/api/clubs/{clubId}/weblinks` | WeblinksController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 307 | `/api/clubs/{clubId}/weblinks/tree` | WeblinksController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 308 | `/api/website-billing/quote` | WebsiteBillingController | SuperAdmin or club admin of the club / the order's club | ok | already scoped |
| 309 | `/api/website-billing/check-subdomain` | WebsiteBillingController | signed-in | ok | subdomain availability probe, no record data |
| 310 | `/api/website-billing/order-status/{orderId:long}` | WebsiteBillingController | SuperAdmin or club admin of the club / the order's club | ok | already scoped |
| 311 | `/api/website-billing/latest-order` | WebsiteBillingController | SuperAdmin or club admin of the club / the order's club | ok | already scoped |
| 312 | `/api/website-data-modules` | WebsiteDataModulesController | signed-in | ok | global lookup, no club / district / member record |
| 313 | `/api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-languages` | WebsiteLanguagesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 314 | `/api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/website-languages/{language}` | WebsiteLanguagesController | middleware read rule | ok | ScopeWriteGuardMiddleware: members and managers of that club / district |
| 315 | `/api/public/website-languages/{scope:regex(^(club|district)$)}/{ownerId:int}` | WebsiteLanguagesController | anonymous | public by design | site texts; feature flag "website_languages" |
| 316 | `/api/zones` | ZonesController | signed-in | ok | org structure is view-only for every signed-in user (UserPermissionHelper); counts only |
| 317 | `/api/zones/{id}` | ZonesController | signed-in | ok | org structure is view-only for every signed-in user (UserPermissionHelper); counts only |

## Open issues (seen, not fixed in this lane)

1. **Public payment pages expose personal data by sequential id** (payments on hold; `membership_dues`, `club_dues`
   and `event_payment_links` have no rows in the production copy, so nothing leaks today). Before payments go live:
   - `GET /api/public/membership-dues/{id}/search-members` returns members' full mobile and email (the pay page
     masks them client-side, then sends them back for the OTP). Mask on the server and let the OTP endpoints look the
     contact up by member id, as `EventPaymentLinkService.SendPaymentOtpAsync` already does.
   - `GET /api/public/membership-dues/{id}/member/{memberProfileId}/status` answers without the OTP.
   - `GET /api/public/membership-dues/{id}/report`, `/report/export` and `GET /api/public/event-payment/{linkId}/report`
     list every payer (the event report includes mobile and email). Give report links a signed token like the
     club-dues pay link.
   - `GET /api/public/event-payment/{linkId}/search-members` searches every member of every club when no district or
     club is passed, and does not check that the link exists.
2. **`/api/public/ocv-live-documents` (and `/word`)**: anonymous, CORS open; `moduleKey=members` and
   `board_of_directors` return names, mobiles and emails for any club id. Behind the `ocv` flag (off). Needs a signed
   link or no contact columns before the flag is turned on.
3. **`GET /api/members` (directory search)**: any signed-in user can search all members; phone and email are masked by
   the privacy flags, but the search itself matches phone and email, so a number can be looked up to a name. Used by
   SuperAdmin add-member and the club admin "add existing member" dialog. Product decision: limit to admins, or stop
   matching hidden fields.
4. **Nested ids inside the club prefix are not tied to the club** (a member of club A can read club B's record through
   `/api/clubs/A/...`): `GET /api/clubs/{clubId}/newsletters/{id}` (NewsletterService.GetByIdAsync(id)),
   `/past-presidents/{id}`, `/sub-groups/{subGroupId}` (feature flag `sub_groups`), `/upcoming-events/{id}`. Fix: pass
   clubId to the service query, as PotentialMembers and Projects already do.
5. **Middleware read rule lets every club member read prospects**: `GET /api/clubs/{id}/potential-members` and
   `/{id}` (prospects' names, phones, emails) are open to all members of the club. Consider managers only.
6. **Web twins in A to L (lane c)**: `GET /api/club-award-status` and `/api/club-myrotary`
   (`DistrictAdminDashboardController` -> `DistrictAdminDashboardService.GetClubAwardStatusAsync` /
   `GetClubMyRotaryAsync`, no club check; fixed here only for the app routes). `GET /api/districts/{id}/cmr-email-settings`
   is readable by every member of the district through the middleware rule (the CC list holds email addresses).
7. **Write IDORs seen while reading** (out of scope of a read review):
   - `POST /api/members/{id}/device-token`: any signed-in user can replace any member's push token (their pushes then
     go to the caller's phone).
   - `ModulesController` POST/PUT/DELETE `module-categories` and `modules`: no SuperAdmin check, and the path is not
     in the middleware's `RoleOnly` list.
   - `MembershipDuesController` and `MobileClubAdminMembershipDuesController` writes (create, update, allocate, fees,
     offline payments, approve / reject, receipts, reminders, sheets): role only, any campaign. The
     `ManagesDuesAsync` helper added here can guard them.
   - `PUT /api/mobile/districts/{id}/cmr-email-settings`: any Admin can change any district's CC list.
   - `MobileClubDuesController` POST `pay-link`, `pay`, `offline-payment`: the campaign is not tied to the club's
     district.
8. **Merge note**: `ScopeWriteGuardMiddleware.ReadAllowedAsync` changed from a private instance method to
   `internal static` with a `members` flag. If another lane made the same change, keep one copy; the middleware call
   passes `_connectionString`.

## Verification (lane d, database row_lane_d, API on 127.0.0.1:5104, mail and Rotary.org / payment hosts pointed at 127.0.0.1:9)

- `heavy.sh dotnet build`: 0 errors; no warnings in the touched files.
- `python -I kb/tools/read_review_m_z_e2e.py http://127.0.0.1:5104 3317 row_lane_d`: 103 PASS, ALL PASS. For every
  fixed route one cross-scope call (403/404) and one legitimate call (2xx); actors picked by query (a club admin who
  is a member of the club and a current-year officer, a plain member, a member of a club in another district,
  SuperAdmin, and a temporary district admin). Test rows (two dues campaigns with a payment each, two past
  presidents, two district dues campaigns and their synced rows, the temporary role, the sync-log rows, the `ocv`
  and `cmr_email_settings` switches) are removed in a `finally`; checked empty afterwards.
- `python -I kb/tools/scope_read_guard_e2e.py http://127.0.0.1:5104 3317 row_lane_d`: 7 PASS, ALL PASS.
- Admin app not touched (no tsc run needed).
- The current Flutter app calls only the weblinks routes among the fixed app routes (club and district dashboards,
  opened by members of that club or district), so the app keeps working.
