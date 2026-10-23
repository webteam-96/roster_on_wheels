# N3 Contacts, prospects, growth, invite prompts (2026-10-23, lane c)

Spec: build spec v4.1 section 3.13, build list #18, B.1 #33-34, B.4, launch acceptance line 333.
Plans: `2026-10-22-row-spec-remaining-build.md` section 3 row 4, `2026-10-22-web-completion.md` Phase 2 row 3.

## Goal

Non-member contacts with groups (club and district) usable as mass email recipients and event invite lists, with
CSV import and duplicate handling; the existing prospects feature gets stages, owner, notes, a public "interested
in joining" form on the club and district websites and one-click conversion to a member; members get scheduled
"bring a guest" nudges (email + in-app feed) with a personal invite link whose RSVP page creates a contact or a
prospect; each club gets a growth target with progress from joins, terminations and prospects by stage, on the
club dashboard and rolled up on the district dashboard. All of it behind one flagged feature, off by default.

## What exists (found 2026-10-23)

- Prospects = "Potential Members": table `potential_members` (club, name, email, mobile, reference, referrer),
  `PotentialMembersController` (`api/clubs/{clubId}/potential-members`), `PotentialMemberService`, admin pages
  `/clubs/[id]/rotary-network/potential-members/v2` (list, add, edit), app screen `potential_members_screen.dart`.
  No stage, owner, notes or conversion. GetById/Update/Delete do not check the record belongs to the URL's club.
- Member add path: `MemberService.CreateAsync` (duplicate check on mobile, email, Rotary ID; soft-deleted profile
  re-activation; club link; welcome email). Exposed only to SuperAdmin today.
- Mass email: `ClubMassEmailService` (club and district), recipient types 1 all, 2 subgroups/clubs, 3 manual/
  subgroups. Recipients table `club_mass_email_recipients` (fk_member_id NOT NULL).
- Events: `upcoming_events` (club or district), no invite list.
- Growth: goal setting has a club `new_members` target, but club goal setting is parked ("Coming soon",
  `lib/clubGoalSetting.ts`), so clubs cannot set it. District `district_membership_goal` is a district total.
- In-app feed: `MobileNotificationFeedService` is a live UNION over source tables (no stored feed).
- Meetings: `club_master.MeetingDay/MeetingFromTime/MeetingToTime/MeetingAddress`; no meeting records table.
- Public sites have no forms. Admin `(site)/prospective-member` form is not wired to any endpoint.

## Decisions

- One flagged feature `contacts_growth` (Settings > Features). The existing potential-members list/add/edit keep
  working when it is off; the new parts (contacts, stages UI, convert, public forms, invite prompts, growth) are
  hidden and their API answers 404.
- Contact and group reads are limited to people who manage the club/district (non-member personal data), not all
  members as the scope guard allows by default.
- District website form files the prospect under the club the visitor picks (`potential_members.fk_club_id` is
  NOT NULL; making it nullable is not an additive change).
- Growth target: own table `club_growth_targets` (net growth per club per Rotary year), set by the club's
  managers on the growth card, because club goal setting is parked. Progress = joined minus terminated.
- Invite prompts are scheduled per meeting by the club admin (meeting date + days before), not weekly
  automatic, so members are not nudged every week. A "send now" action runs the same code as the job.
- Event invites create a mass email draft (recipients = contact groups, body = the event) that the admin
  reviews and sends from Mass Email; credits and sending stay in the existing mass email code.
- RSVP page lives in the admin app as a bare public route (`/invite/[token]`), so it works for clubs without a
  club website.
- CSV/XLSX is parsed in the browser with the installed `xlsx-js-style`; the API gets rows, validates them and
  classifies duplicates (email first, then name + phone digits), inside the file and against existing contacts.

## Tables (DatabaseInitializer + database/schema.sql, additive)

- `contacts` (club or district owner, name, email, mobile, contact_type, organisation, notes, source)
- `contact_groups`, `contact_group_members`
- `potential_members` + columns `stage`, `fk_owner_member_id`, `notes`, `source`, `consent_date`,
  `fk_converted_member_id`, `converted_date`
- `club_mass_emails.ContactGroupIds`, `club_mass_email_recipients.fk_contact_id`
- `club_growth_targets` (club, year, target)
- `invite_prompts` (club, meeting date, send on, note, status), `invite_prompt_log` (prompt, member),
  `member_invite_links` (club, member, token)

## Endpoints

Club and district (`{scope}` = clubs | districts), managers only:
- `GET/POST {scope}/{id}/contacts`, `PUT/DELETE {scope}/{id}/contacts/{contactId}`
- `POST {scope}/{id}/contacts/import/preview`, `POST {scope}/{id}/contacts/import`
- `GET/POST {scope}/{id}/contact-groups`, `PUT/DELETE {scope}/{id}/contact-groups/{groupId}`
- `POST {scope}/{id}/contacts/invite-event` (mass email draft from an upcoming event)
Prospects (existing controller, extended): stage/owner/notes on list/create/update, `?stage=` filter,
`POST api/clubs/{clubId}/potential-members/{id}/convert`.
Growth: `GET api/clubs/{clubId}/growth`, `PUT api/clubs/{clubId}/growth/target`, `GET api/districts/{id}/growth`.
Invite prompts: `GET/POST api/clubs/{clubId}/invite-prompts`, `POST .../{id}/send`, `DELETE .../{id}`,
`GET api/clubs/{clubId}/invite-link` (member's own link).
Mass email: recipient type 4 = contact groups (`contactGroupIds`) on club and district create/update/count.
Public (rate limited, honeypot, consent): `GET api/public/join/club/{clubId}`,
`GET api/public/join/district/{districtId}`, `POST api/public/join`, `GET api/public/invite/{token}`,
`POST api/public/invite/{token}/rsvp`.
In-app feed: `GET api/mobile/notifications` gains type `invite`.

## Pages

- Admin: `/club-admin-dashboard/contacts`, `/district-admin-dashboard/contacts` (contacts, groups, import, event
  invite; club page also schedules invite prompts); prospects list/add/edit gain stage, owner, notes, convert;
  growth card on the club dashboard overview, district growth card on the district overview; contact groups in
  the club and district mass email compose; public `/invite/[token]` RSVP page.
- Club website and district website: `/join` page (club admins link it from the website menu as URL `/join`).

## e2e

`kb/tools/contacts_prospects_growth_e2e.py`: flag off/on, contacts CRUD + scope, duplicates, import preview and
commit, groups as mass email recipients (no IDOR via foreign group ids), prospects stages/owner/IDOR/convert,
public join (consent, honeypot, rate limit), invite link + RSVP to prospect and contact, invite prompt send-now,
growth numbers. Cleans up its rows.

## Left for the app

App screens for: member's invite link share (`GET api/clubs/{clubId}/invite-link`), feed type `invite`,
contacts and groups, prospect stages and convert, growth card. All endpoints above are app-ready (JWT).

## Shortcuts

Recorded in code as `shortcut:` comments; listed in the Done section.

## Done (2026-10-23)

### Files

API added: `Controllers/ContactsController.cs`, `Controllers/GrowthController.cs`, `Controllers/PublicJoinController.cs`,
`DTOs/ContactsGrowthDtos.cs`, `Services/ContactRules.cs`, `Services/ContactService.cs`,
`Services/DatabaseInitializer.ContactsGrowth.cs`, `Services/GrowthService.cs`, `Services/InvitePromptService.cs`
(service + `InvitePromptBackgroundService`).
API changed: `PotentialMembersController`, `PotentialMemberService` (+ interface, DTOs): stage/owner/notes, club-scoped
reads and writes (fixes reading or editing another club's prospect by id), convert, public create;
`ClubMassEmailService` (+ interface, DTOs, club and district recipient-count actions): recipient type 4 = contact
groups, district drafts now keep their district on update; `FeatureGate` (`contacts_growth`, `IsOnAsync`);
`MobileNotificationFeedService` (feed type `invite`); `AuditMiddleware` (entity names, Convert/Import/Preview actions,
no contact names in the immutable log); `PersonalDataRegistry`; `PublicCorsControllerConvention` (`api/public/join`);
`Program.cs` (DI, `public-form` rate limit 8 posts / 10 min / IP, hosted job); `DatabaseInitializer.cs` (one call);
`row/database/schema.sql`.
Admin added: `app/club-admin-dashboard/contacts/{page,loading}.tsx`, `app/district-admin-dashboard/contacts/page.tsx`,
`app/invite/[token]/page.tsx`, `components/contacts/{ContactsManager,ContactImportDialog,EventInviteDialog,
InvitePromptsPanel,ContactGroupPicker,ProspectPipelineFields}.tsx`, `components/growth/{GrowthCard,DistrictGrowthCard}.tsx`,
`lib/contacts.ts`, `lib/contacts.test.ts`.
Admin changed: club and district `nav.ts` (Contacts), club dashboard overview (growth card), district overview (growth
rollup), prospects list/add/edit (stage filter, stage/owner columns, Make member, pipeline fields, skeleton loader),
club and district mass email compose (Contact groups option), `RootShell.tsx` (`/invite/` bare route),
`services/api.ts`, `types/potentialMember.ts`.
Public sites (git-ignored folders): `club-website/src/app/join/page.tsx`, `club-website/src/components/JoinForm.tsx`,
`district-website/src/app/join/page.tsx`, `district-website/src/components/JoinForm.tsx`.
e2e: `kb/tools/contacts_prospects_growth_e2e.py`.

### Tables

New: `contacts` (unique email per owner), `contact_groups`, `contact_group_members`, `club_growth_targets`,
`invite_prompts`, `invite_prompt_log`, `member_invite_links`. New columns: `potential_members.stage,
fk_owner_member_id, notes, source, consent_date, fk_converted_member_id, converted_date` (+ index),
`club_mass_emails.ContactGroupIds`, `club_mass_email_recipients.fk_contact_id`. Registered for export/erasure:
contacts and prospects by email and mobile, prospect owner, mass email contact recipients by email, invite links and
prompt log by member.

### Endpoints (all JWT unless public; app-ready)

`GET/POST api/{clubs|districts}/{id}/contacts`, `PUT/DELETE .../contacts/{contactId}`,
`POST .../contacts/import/preview`, `POST .../contacts/import`, `POST .../contacts/invite-event`,
`GET/POST .../contact-groups`, `PUT/DELETE .../contact-groups/{groupId}` (reads: managers only);
`GET api/clubs/{id}/potential-members?stage=`, `POST .../potential-members/{pid}/convert`;
`GET api/clubs/{id}/growth?yearId=`, `PUT api/clubs/{id}/growth/target`, `GET api/districts/{id}/growth?yearId=`;
`GET/POST api/clubs/{id}/invite-prompts`, `POST .../invite-prompts/{pid}/send`, `DELETE .../invite-prompts/{pid}`,
`GET api/clubs/{id}/invite-link`; mass email `recipientType=4` + `contactGroupIds` (club and district create, update,
recipient-count); public `GET api/public/join/club/{id}`, `GET api/public/join/district/{id}`, `POST api/public/join`,
`GET api/public/invite/{token}`, `POST api/public/invite/{token}/rsvp`; feed `GET api/mobile/notifications?types=invite`.

### For the app (not built)

Share the member's invite link (`GET api/clubs/{id}/invite-link`), open it from feed items of type `invite`
(deep link `invite_guest`, clubId); contacts and groups screens; prospect stage/owner/notes and Make member; growth card.

### Verification

- `dotnet build`: 0 errors, 189 warnings (same as before the module; none in the new or changed files).
- `python -I kb/tools/contacts_prospects_growth_e2e.py http://127.0.0.1:5103 3317 row_lane_c` with
  `ROW_E2E_EMAIL_SAFE=1` (API started with `Brevo__ApiUrl=http://127.0.0.1:9/`): 89 PASS, ALL PASS, run 3 times; test
  rows removed afterwards (the converted test member stays soft-deleted and is re-activated by the next run).
- `scope_read_guard_e2e.py`: ALL PASS. Existing mass email types 1 (club, district create + update) smoke-tested.
- Admin `tsc --noEmit`: 0 errors. `vitest run`: 10 files, 75 tests pass (new `lib/contacts.test.ts`: 3).
  `check-design.mjs`: all counts 0. `tsc --noEmit` in club-website and district-website: 0 errors.

### Shortcuts (in code as `shortcut:`)

- District website form files the prospect under the club the visitor picks (no district inbox).
- Invite prompt dates use the server's day, not the club's time zone (time-zone module).
- A prompt run that dies mid-send stays at `sending` (set it back to `scheduled` to resend the rest).
- Growth target in `club_growth_targets` while club goal setting is parked.
- Contacts get no unsubscribe link in bulk email yet (communication module 6).

### Open issues

- Club websites need a menu item (URL `/join`) to show the form; no theme was changed.
- The ROW marketing form `admin (site)/prospective-member` is still not wired to any endpoint.
- Pre-existing, not changed: mass email detail/update/delete/send by id do not check the email belongs to the URL's
  club or district; subgroup and member ids in mass email recipients are not checked against the club; the club
  compose "Select Members" list reads `api/clubs/{id}/sub-groups/club-members`, which answers 404 while Sub Groups is off.
- Prospect names still go to the immutable `audit_log` (existing behaviour for potential members).
- `sp_potential_member_*` stored procedures are now unused (left in place).
- Event invites are drafts: the admin sends them from Mass Email, which needs email credits.
