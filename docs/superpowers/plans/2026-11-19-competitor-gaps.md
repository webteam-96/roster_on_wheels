# Competitor gaps (ClubRunner, DACdb): build plan

Source: the comparison doc "ROW vs ClubRunner and DACdb" (https://claude.ai/artifact/Mvnjsob5YiotsBUjYKLrB5),
section "Detail by module". Started 2026-11-19.

**Owner decisions (2026-11-19):** build every gap, in the area order below; each feature ships on API, web admin and
the Flutter app together. Communication covers email only (ROW has no SMS or WhatsApp by decision of 2026-10-19).
The zonal dashboard stays removed (owner decision 2026-10-23).

**Area order:** 1 Membership and club administration · 2 Money (dues, invoicing, accounting, payments) ·
3 Communication (email only) · 4 Websites and mobile app · 5 District and Rotary-specific · 6 the doc's
"Gaps to close" list (what is left).

**Each item:** API + admin + app, unit tests for new logic, an e2e script in `kb/tools/`, a live check on the local
production copy (`row_prod_copy`, MySQL 3317), entry in `row/ROW-CHANGES.md`. Commit only when the owner asks.

## First: the doc's "Gaps to close" list (owner, 2026-11-19, later the same day)

The owner moved this list ahead of the area order. Events items wait until the Events work is done.

| Gap list # | Item | Status |
|---|---|---|
| 10 | Printable outputs: directory, mailing labels, name badges, table tents | Done 2026-11-19 (API, admin, app; e2e 18/18; Letter label overflow found and fixed with a test) |
| 5 | Attendance makeups, exemptions, leave of absence, monthly report to district | Building (parallel agent, API port 5101) |
| 6 | Email: resend to non-openers (open/click/bounce tracking already exists) + bulletin builder from stories | Building (agent, 5102) |
| 7 | Invoices and statements (printable), member balances, QuickBooks export | Building (agent, 5103) |
| 8 | Grants lifecycle: budgets, approval sign-off, interim and final reports, document archive | Building (agent, 5104) |
| 9 | Surveys and polls for clubs and districts (event polls wait for Events) | Building (agent, 5105) |
| 13a | Website donations with campaigns | Building (agent, 5106) |
| 13b | District speaker bureau with ratings | Building (agent, 5107) |
| 12 | Youth programs: RYLA, RLI, Youth Protection | Building (agent, 5108) |

Parallel run (owner asked, 2026-11-19): one agent per item in its own git worktree, changes left uncommitted there;
the lead merges one at a time into the main working copy, then regenerates app strings, runs every check and writes
ROW-CHANGES. Shared-file rules given to agents: own `DatabaseInitializer.<Feature>.cs`, one marked block at the end of
admin `api.ts`, no edits to ROW-CHANGES/HANDOFF/plans/ui_strings.g.dart.
| 1 | Real payments (Stripe) | Waits: Stripe account and keys |
| 2 | Rotary.org sync on the server + RI partner status | Waits: server Task Scheduler (workers package can be prepared); partner status is the owner's |
| 3 | Club website hosting (catch-all site, wildcard certificate) | Waits: owner creates the IIS site and certificate |
| 4 | Event registration forms | Waits: Events work (owner) |
| 11 | SMS | Not done: owner decision 2026-10-19 |

## MERGE DONE (2026-11-20): start here

All 32 gap worktrees (order below) plus `E:/row-lanes/rizones-1117` (9-17 Nov RIZones port, goal module, RCC pages)
are 3-way merged into the main checkout's working tree (base = each worktree's HEAD). Nothing committed or pushed.
Worktrees are untouched (still hold their copies) until the owner says to remove them.
Hand resolutions: FeatureGate.cs (speaker bureau + youth + service hours gates), MobileNotificationFeedService AllTypes
(survey, profile_update, prospect, prospect_task), ContactService delete + ContactsManager.tsx (contacts merge x tags),
admin api.ts `ProfileField` clash (profile requests type renamed `ProfileUpdateField`).
Integration added during the merge:
- Ledger: `ClubLedgerInvoiceListener` posts the items-invoice (IsDues=false) part of a receipt as other income
  (source `invoice_receipt`); dues still come through SyncDuesPaymentsAsync. invoices_e2e cleanup removes them.
- Rollover: `OfficerProgressionRolloverSource` registered; year_rollover_e2e now expects `connected: true`.
- Resend to non-openers copies the campaign's attachments (files + rows: `MassEmailComposeService.CopyAttachmentsAsync`).
- Contact merge carries club tags to the survivor (tags key contacts by entity_id, the generic fk_contact_id relink missed them).
- Website extras search + sitemap include published, public website-builder pages (`/p/<slug>`, not `home`).
- Mobile: volunteer test fakes got `mySignups`; ui_strings.g.dart regenerated (5393 strings); `flutter pub get` (mobile_scanner).
Checks on the merged tree: api build 0 errors; dotnet test 610 pass / 0 fail; admin tsc 0, vitest 194/194; flutter
analyze 0 errors, flutter test 62/62; club-website vite build ok; postmerge-check only flags `ContactGroup` (intended
interface merge). API started on row_prod_copy with Database__SkipInit=false (all tables created, no errors). All 36
new e2e suites pass (6 need their own API settings: Payments__Provider=simulated, ProspectFollowUp__Job,
VolunteerFollowups__*, YouthReminders__Enabled + empty Brevo key, and goal_setting_rotary / ocv / club_monthly_report
switched on in the copy for the test only, removed after).
Not runtime-tested: resend-with-attachments copy, contact merge carrying tags, builder pages in search/sitemap
(build + unit tests only). Still to do: ROW-CHANGES entries, kb/rebuild.sh, browser/device test of new screens,
remove worktrees (owner OK), commit + push (owner OK).

## MORNING SUMMARY (2026-11-20)

All agent work is finished. Nothing is merged, committed or pushed. Each module sits uncommitted in its own worktree
under `.claude/worktrees/agent-*` on 553bfe7 or 700b070 (both ancestors of the current branch tip 700b070).
Every module: own API tests + build + admin tsc/vitest + flutter analyze + its own e2e against row_prod_copy passed,
and the lead re-ran `dotnet test` in every worktree (0 failures each). NO screen was opened by a person; browser
checks only for website builder, members-only pages, website extras, help centre.

Worktree -> module (merge in this order; security first):
1. af10f96232a6c071f attendance rules + extras + ATTENDANCE IDOR FIX (priority)
2. a2f6ac4f900029d5d GDPR erase (owner rule applied)
3. a19f55074f0c022cf club admin limit (max 3)
4. afb50a20d0d5796fd MFA + magic link (SuperAdmin optional) + exec sign-in MFA gate
5. af5d15018ad505cb0 cross-district access (touches ScopeWriteGuardMiddleware/AdminYearGuard: review + rerun scope e2e)
6. a8d0ebc2f58e678a2 invoices/statements/QuickBooks + meal charges
7. add776e8ce9778029 club accounts ledger + extras (wire IInvoicePaymentListener, post only IsDues=false)
8. af38e07747ee957a7 grants lifecycle + extras
9. a93bcf94ecddf6854 bulletins/resend + stories + subscribers   10. aa35774f789cc9269 email templates/attachments
   (9 and 10 both edit ClubMassEmailService/SendMassEmailAsync: hand-merge)
11. aaa0850bbcde3d3c6 surveys  12. a5a90714ec7ac20e6 donations  13. a96518d23be757b4a speaker bureau
14. a05c475d96f800113 youth  15. a8b4da2a0810034c0 profile requests + anniversaries  16. a5608abd75d88e9f9 prospects
17. af4003d9a527fff25 contacts merge + friends  18. a9c82cf49a8064eb2 tags/custom fields/smart lists
19. aa96ec74b1d8663ee report builder  20. ac6e9e776cd35dbe8 officer progression  21. aaa6d8f0ff07a9bdd year-end rollover
   (then register an IRolloverProgressionSource adapter over officer progression)
22. a9823969592b75fe7 member map + business directory  23. abe011074af5c7c18 website builder + members-only pages
24. a88b67faff972ad5e website extras (add builder pages to its search/sitemap)  25. a14e6c3d78b24d690 WordPress connector
26. a7e29796ffa070c75 service hours  27. a2e3dd9a8f61eb6a9 volunteer extras  28. a5138525c38d52b9c committees
29. a40da4a9c68ffafc1 mobile leader tools  30. a8d23419469597e8d RI data tools  31. a1028b07c77e090be job board
32. a0b9e3018564ccfd6 help centre
(agent-aeba360f5ac743b8c is an empty leftover: remove.)

Every merge touches the same shared files: Program.cs, DatabaseInitializer.cs, FeatureGate.cs, admin api.ts (end
blocks), both admin nav.ts, app_router.dart, route_names.dart, custom_drawer.dart, RotaryApi.csproj (QRCoder x3).
After all merges: regenerate ui_strings.g.dart, full test suite, all e2e scripts, kb/rebuild.sh, ROW-CHANGES entries
(each agent report above has a change note), then browser/device testing of every new screen.

Open owner decisions: see "OWNER DECISIONS" below (contacts_growth switch state; profile-update email vs broadcast
consent; ledger ageing due-date assumption; keep old raw-vCard QR?; barcode check-in lane; AI drafting; training
sandbox; hosting/domain services). New-flag modules are OFF by default: job_board, service_hours, committees,
youth_programs.
Deploy needs: website ROW_API_URL; IIS write access to App_Data (committee-files, website-private, mass-email-files);
test the Super Admin RI manual sync once after merge (shared RiMemberImport refactor); WordPress plugin untested (no PHP).

## Overnight run (started 2026-11-19 ~18:15, owner away; brief: `2026-11-19-agent-brief.md`)

20 agents, one per module, each in its own worktree (ports 5101-5122), uncommitted. Owner (19:2x): DO NOT MERGE
overnight. Only get every agent's work finished in its worktree; merging starts 2026-11-20 with the owner present.
Lead overnight: start queued agent when a slot frees, re-task agents that stop short, log each report below. No commits.
Resumed (old worktrees): attendance 5101, bulletins+resend 5102, invoices+statements+QuickBooks 5103, grants 5104,
surveys 5105, donations+tax receipts 5106, speaker bureau 5107, youth 5108.
New: profile-update requests + anniversaries 5109, contacts merge + friends 5111, prospect tasks + alerts 5112,
GDPR erase 5113, tags + custom fields + smart lists 5115, report builder 5116, member map + business directory 5117,
email templates + attachments + signature 5118, website page builder 5119, website SEO/social/QR 5120,
MFA + magic link 5121, club ledger 5122.
QUEUED (start when a slot frees): year-end rollover + officer progression as ONE agent, port 5110.
Started 18:5x: year-end rollover + officer progression (one agent, port 5110).

OWNER DECISIONS (2026-11-19 ~19:45, before leaving):
- SuperAdmin two-step login: OPTIONAL for now (setting AccountSecurity:RequireMfaForSuperAdmins=false). Sent to MFA agent.
- New-prospect alert default: in-app AND email (as built).
- Ledger: club Admin role only, AND a club may have at most 3 club admins (setting, default 3; existing clubs over
  the limit are reported, not changed). New agent "club admin limit" port 5123.
- GDPR erase: ANY District Admin role needs second approval, even if also club admin. Sent to GDPR agent.
STILL OPEN for owner: contacts_growth switch state in row_prod_copy; profile-update email skips broadcast consent;
barcode meeting check-in (inside or outside the other developer's Events+QR lane?); AI email drafting (needs API key
+ cost OK); district training sandbox (infra); managed WordPress hosting / domain sales / DR service (commercial).

PHASE 2 (audit by agent, ~19:50): every doc row still short after tonight -> packages. Running:
- Resumed in own worktrees: ledger extras (vendors, bank reconciliation, voucher PDF, aged balances, app reports);
  meal charges (invoices worktree); grants extras (qualified clubs, cash-flow report, editable email templates);
  attendance extras (close/reopen meeting, rules per member type, Rule of 85 report, sign-in sheet PDF);
  story approval workflow + non-member bulletin subscribers (bulletins worktree); members-only website pages
  (builder worktree); MFA owner change; GDPR owner change.
- New (each told to ff-merge to 553bfe7 first): club admin limit 5123, service hours/engagement 5124, volunteer extras
  5125, RI officer compare + transfer-in wizard 5126 (local data only, no live RI calls), enhanced committees 5127,
  cross-district time-limited access 5128, mobile leader password reset + QR contact exchange 5129, public help
  centre 5130, job postings/B2B 5131, WordPress connector 5132.
- RI data tools DONE on 700b070: officer compare (6 RI positions vs ri_club_officers) + transfer-in wizard (link/add/
  create from rotary_org_club_members_cache), audited, never calls Rotary.org. e2e 35/35. Both read data only the server
  sync fills: locally they show "not synced". REFACTOR RISK: member create/reactivate moved out of
  RotaryOrgManualSyncController into shared RiMemberImport; that live-RI path was not run. Test the Super Admin manual
  sync once on the server after merge. Local copy: a crashed early e2e left soft-deleted test rows in club 341
  (incl. one club_members row for member 1); hard deletes are blocked by triggers.
- Mobile leader tools DONE on 700b070: club leaders send a member the normal reset link (masked address, 3/member/day,
  20/leader/day, audited); QR contact exchange with a signed 5-minute token and privacy-filtered vCard. e2e 30/30.
  NEW APP DEPENDENCY mobile_scanner ^7.5.0 (camera); not run on a device; iOS pods need the Mac. Owner question: keep
  or remove the old raw-vCard QR in Share My Contact.
- Grants qualification setting DONE: per district, default OFF (warn only), ON blocks submit; e2e 134/134, Lead 133/0.
- Enhanced committees DONE on 700b070 (flag `committees`, off): nested subcommittees (loop-safe), private documents in
  App_Data/committee-files, committee email via mass email (10/day cap), archive. e2e 57/57. Full admin vitest NOT run
  (only its own file): run at merge. Older district committee documents are still on a public /Documents path.
  IIS app pool needs write access to App_Data/committee-files. Rollover does not copy the new parent links.
- Cross-district access DONE on 700b070: grants by SuperAdmin/zone roles, read or limited write, start/expiry checked on
  every request, all grant/use/revoke audited. e2e 42/42. SECURITY REVIEW AT MERGE: it changes ScopeWriteGuardMiddleware
  and AdminYearGuard (core access code); rerun scope_write_guard_e2e.py and member_scope_e2e.py after merging it.
  Every use writes an audit row (audit_log growth).
- Service hours + engagement DONE on 700b070: members log hours (+ optional photo) per project from the app, officers
  approve on web, cash/in-kind contributions, club + district reports with Excel, counts volunteer-sheet hours without
  double counting. Flag `service_hours` (off). e2e 56/56. Photos under wwwroot/Documents/ServiceHours (public path).
- Volunteer sheet extras DONE on 700b070: per-sheet confirmation email, up to 5 follow-ups sent once each by a job,
  archive + copy with date shift, coordinators emailed the list, app "My volunteer sign-ups". e2e 49/49 (fake Brevo).
  At merge also rerun volunteers_speakers_e2e.py (not rerun by agent).
- WordPress privacy fix DONE: directory returns only name, photo, classification; e2e checks none of 183 real
  contact values appear in any connector response. Admin tsc/vitest not rerun after a one-string change.
- WordPress connector built on 700b070 (hashed scoped API keys, /api/public/connector/v1/*, PHP plugin with 6 shortcodes,
  documents opt-in column), e2e 47/47. WAS SENT BACK: remove member email/phone from the public directory output (the
  "show in all clubs" flag defaults to visible, so it would publish nearly every member's contacts). NOT VERIFIED:
  PHP not installed, plugin never linted or run on a WordPress site; test before handing to anyone.
- Job board (jobs + B2B offers) DONE on 700b070: behind flag `job_board` (off), district-scoped, members only, admin
  approval, expiry on read, 3 reports hide a post. e2e 54/54. FeatureGate.cs entry may conflict at merge.
- Stories approval + non-member bulletin subscribers + sub-group send DONE (bulletins worktree): e2e 75/75 (fake Brevo),
  vite build ok. Double opt-in (48h hashed token, GET shows a button, POST acts), HMAC one-click unsubscribe + headers,
  copies paid like mass email. Pages linked only from FooterLegal (themes without it have no link). Restart the API
  between e2e runs (sign-up rate limit).
- BRANCH MOVED: feat/rizones-pull-2026-11-06 got one commit at 19:03 (700b070a "fix: OMS ROW-56..59; member directory
  export and print", 30 files) from another session. Worktrees are on 553bfe7 (or 700b070 for those created later).
  Small delta: absorb it during tomorrow's merge, no rebase round needed.
- Club admin limit DONE (worktree on 700b070): max 3 active club admins (system_settings.ClubAdminMaxPerClub, SuperAdmin
  edits 1-50, audited). Enforced in the shared grant helper (assign-role, club leadership save/make-admin, BOD hook,
  planning cut-over), exec sign-in and the Rotary.org BOD sync worker; 409 with a clear message on web and app. Clubs
  already over the limit are untouched and listed at Settings > Club admin limit (1 club in the local copy). e2e 20/20,
  Lead 133/0. Known shortcut: no row lock, so two simultaneous grants for the last seat could both succeed.
- Ledger extras DONE: payees, bank reconciliation (CSV import, auto/manual match, undo), payment voucher PDF with cheque
  block, dues owed by age (CSV/Excel/PDF), app shows P&L + aged read-only. e2e 80/80, Lead 133/0. ASSUMPTION for owner:
  dues have no due date, so ageing dates each charge from when the club raised dues (second half +6 months).
- Grants extras DONE (qualified clubs, monthly cash flow + Excel, editable email templates), e2e 125/125, Lead 132/0.
  SENT BACK: the qualification block must be a per-district setting, default OFF (warn only), so live districts are not
  blocked at go-live.
- SECURITY FIX DONE (attendance worktree): every attendance read now checks the caller in the controller
  (ReadAllowedAsync): list, single meeting, years, members, makeups/standing/etc., and club-report attendance-matrix.
  Also closed a CONFIRMED cross-club read: GET /api/clubs/{A}/attendance/{meetingOfB} returned club B's meeting; now 404.
  e2e 89/89 incl. 13 reads x 4 callers (member/manager 200, other club/other district 403). PRIORITY MERGE.
- SECURITY (pre-existing on base, found by grants agent): GET /api/clubs/{clubId}/attendance/members has no caller-scope
  check: any logged-in user can read any club's member list (IDOR). Sent to the attendance agent to fix at the root plus
  any sibling routes, with e2e. MUST be in tomorrow's merge even if nothing else is.
- Members-only website pages + files DONE (builder worktree): e2e 76/76, vite build ok, Playwright check.
  SECURITY REVIEW AT MERGE: adds a NEW public password sign-in on club websites (POST api/public/website-session/club/
  {id}) reusing the app's password checks + `auth` rate limit; issues a site-only 8h token (key derived from
  JwtSettings:Secret), re-checked against active membership each request; sign-out is client-side only. Members-only
  files live in App_Data/website-private behind 1h signed links. Also fixed CORS on the builder's public routes.
- Attendance extras DONE: close/reopen meeting (audited, locks attendance + makeups), per-member-type rules
  (honorary excluded by default), Rule of 85 report (JSON/CSV/PDF), sign-in sheet PDF. e2e 61/61.
  Leave/exemptions not locked by a closed meeting. PDFs not visually checked.
- Meal charges DONE (invoices worktree): e2e 59/59. Meals bill only onto items invoices, never dues rows;
  InvoicePaymentApplied now has IsDues so the ledger listener can post only non-dues money (fixes the double-post trap).
  Minor: guest names entered comma-separated; Bill meals uses today + 14 days.
- MFA owner change DONE: SuperAdmin MFA optional (AccountSecurity:RequireMfaForSuperAdmins=false in appsettings.json).
  e2e passes with the setting both false and true; mobile_password_login passes.
- GDPR owner rule DONE: any District Admin role -> second approval. e2e 38/38, privacy + audit e2e pass.
  (Row 2471 the agent mentions is already gone: lead checked member 1068 has only roles 1069 and 2118.)
- Covered already per invoices report: one payment split across many invoices.
- Website extras (a88b67faff972ad5e): DONE on 553bfe7, e2e 32/32, Lead 143/0, vite build ok. No district site app;
  Instagram has no embeddable feed (link card); robots/sitemap via web.config redirect to API. MERGE NOTE: add
  builder custom pages to WebsiteExtrasService search + sitemap; QRCoder added by 3 modules (donations, MFA, extras).

GOAL WIDENED (owner, ~19:40): ROW must offer everything ROW already offers PLUS everything ClubRunner and DACdb do.
Loop: audit agent lists every doc row still short -> one agent per work package -> verify -> log. Exclusions stay:
SMS/WhatsApp, Events (other dev), live Stripe, zonal dashboard, server-side items waiting on owner.

REBASE ROUND (~20:00): 14 worktrees made with isolation:worktree sat on OLD base 59f5edf (~750 files behind 553bfe7;
old Next.js club-website). All 14 told to follow the brief's "Rebase procedure" and rerun every check. Website builder,
website SEO and member map must also port their club-site work to the Vite app. Modules marked DONE below that were on
59f5edf (GDPR, prospects, profile, email compose, reports, officer progression, ledger, contacts, MFA, map, builder)
are DONE again only after their rebase report. The 8 resumed worktrees were already on 553bfe7.
Website builder note: contact-form section reuses /api/public/join (lands in prospects); existing sunrise theme bug
(DOMParser on server render) was in the OLD Next site.

Tags + custom fields + smart lists (a9c82cf49a8064eb2): DONE on 553bfe7, e2e 67/67, Lead 130/0. Clubs only (no district
tags); members see fields read-only in app. NOTE: `contacts_growth` switch in row_prod_copy left ON (1) by its e2e;
several agents' scripts flipped it tonight, original state unclear. Owner/lead to set it as wanted.
Website builder (abe011074af5c7c18): DONE on 553bfe7, renderer ported to Vite (src/pages/CustomPage.jsx,
src/shared/PageSections.jsx, App.jsx route /p/:slug), vite build ok, e2e 44/44, Lead 131/0, Playwright render check in
classic-blue + sunrise themes. No district public site exists, so district pages are API-only. Contact form needs
contacts_growth on.
Year-end rollover: undo fix DONE, undo now refuses (409 + list) when later rows hang off the run. e2e 43/43, Lead 117/0.
Year-end rollover (aaa6d8f0ff07a9bdd): built on 553bfe7, e2e 40/40, Lead 115/0. SENT BACK (1/3): undo soft-deleted
members an admin added later to a run-created committee (data loss). Apply is manual (no auto on 1 July); app is
read-only preview. Progression plugs in via IRolloverProgressionSource adapter after merge.

Rebase results (each: base 553bfe7 confirmed by lead + lead dotnet test 0 failures; e2e per agent):
prospects 39/39 (122), custom reports 38/38 (115), officer progression 37/37 (118; e2e narrowed to its own rows),
member map + directory 29/29 (122; club page ported to Vite: src/pages/BusinessDirectory.jsx, vite build ok),
club ledger 51/51 (123), email compose 34/34 (123), GDPR erase 35/35 (126; nav.ts conflict too),
MFA + magic link 52/52 + mobile_password_login 8/8 (116). MFA port: the NEW upstream club-executive email-code sign-in
(ExecutiveSignInController, /exec-signin) skipped MFA; agent added the MFA gate there (not e2e-covered). Every one had the same api.ts end-of-file conflict with the upstream
subscriptions block, resolved the same way. Temporary district-admin role row 2471 for member 1068 (another agent's
e2e, 18:48) is gone now.
profile requests + anniversaries REBASED to 553bfe7 (lead confirmed), e2e 40/40, Lead 120/0.
contacts/friends REBASED to 553bfe7 (lead confirmed), e2e 27/27, Lead 121/0; one api.ts end-of-file
conflict with upstream subscriptions block resolved.

Agent reports (newest first). "Lead" = dotnet test re-run by the lead in that worktree.
- Club accounts / ledger (add776e8ce9778029): DONE, e2e 51/51, Lead 64/0. Posting API: ClubAccountsService.PostPaymentAsync
  (idempotent per ClubId+SourceType+SourceId). MERGE TRAP: ledger already auto-posts every paid membership_dues_payments
  row, and invoices writes such a row when a dues invoice is paid. When wiring IInvoicePaymentListener -> PostPaymentAsync,
  post ONLY non-dues invoice lines (products), or dues money is booked twice. Access = club Admin role only (a Treasurer
  board designation without Admin role cannot use it).
- Account security MFA + magic link (afb50a20d0d5796fd): DONE, e2e 52/52, mobile_password_login still passes, Lead 57/0.
  GO-LIVE RISK: MFA is REQUIRED for every SuperAdmin; after deploy each SuperAdmin must enrol at next sign-in. Older app
  builds fail to sign in for members with MFA due. Lost dp-keys = MFA reset by deleting member_mfa row (no admin screen).
  Check magic-link URL under IIS /admin. MERGE NOTE: donations and MFA both add QRCoder 1.6.0 to RotaryApi.csproj.
- Profile update requests + anniversaries (a8b4da2a0810034c0): DONE, e2e 40/40, Lead 61/0. Members update via a
  30-day no-login link (hashed token, rate-limited, login email/mobile locked). Owner question: request email skips
  the broadcast-consent filter (treated as administrative). Self-save hook in MembersController not e2e-tested.
- Surveys and polls (aaa0850bbcde3d3c6): DONE, e2e 44/44, Lead 117/0, no stray invoice files. Bell notification only
  (no push/email), no FeatureGate; district surveys need current-year officers entered.
- Youth programs (a05c475d96f800113): DONE, e2e 40/40, Lead 123/0. Behind flag `youth_programs` (off). Only appointed
  district youth chair / club youth officers see youth data; officers who are not admins work in the app only.
  Dropped on purpose: public RYLA form (minors' data), session capacity.
- Contacts export/merge + Friends (af4003d9a527fff25): DONE, e2e 27/27, Lead 62/0. Note: contact_merge_log holds
  personal data; add it to the GDPR erase registry at merge time.
- Donations (a5a90714ec7ac20e6): DONE, e2e 46/46, club-website vite build ok, Lead 124/0. Adds NuGet QRCoder 1.6.0.
- Invoices + statements + QuickBooks (a8d0ebc2f58e678a2): DONE, e2e 41/41, Lead 117/0. Exposes
  IInvoicePaymentListener for the ledger. Dues invoices paid in full only; no undo of a recorded payment.
- Speaker bureau (a96518d23be757b4a): DONE, e2e 37/37, Lead 117/0. Uses the "volunteers" switch.
- Custom report builder (aa96ec74b1d8663ee): DONE, e2e 38/38, Lead 56/0. Monthly scheduled send not run live.
- Email templates + attachments + signature (aa35774f789cc9269): DONE, e2e 34/34, Lead 64/0. MERGE NOTE: touches
  ClubMassEmailService + IEmailService.SendMassEmailAsync, overlapping bulletins; hand-merge. V1 compose pages not wired.
- Member map + business directory (a9823969592b75fe7): DONE, e2e 29/29, Lead 63/0. Club-website TS not checked; app map
  loads Leaflet from unpkg (needs internet). Public directory shows member name + business phone.
- Officer progression (ac6e9e776cd35dbe8): DONE, e2e 37/37, Lead 59/0. Hook GetPendingForYearAsync for rollover.
- Attendance rules (af10f96232a6c071f): DONE, e2e 35/35, Lead 117/0. CMR now uses recorded attendance.
- GDPR erase fix: District Admin now always needs approval. e2e 35/35, Lead 67/0. Open question for owner: a person
  who is BOTH club admin of that club and District Admin erases in one step (one-line change).
- Tags/custom fields/smart lists: the original launch failed (git error); started at ~19:15 on port 5115.
- Shared-DB side effects reported by agents: e2e scripts briefly swap password hashes of members 1068/999 and toggle
  `contacts_growth`, then restore. Copy only; check 1068/999 can still log in before tomorrow's tests.
- Prospect tasks + notifications (agent-a5608abd75d88e9f9): DONE. e2e 39/39 (fake Brevo). Lead re-check: dotnet test
  63 pass / 0 fail. Owner decision needed: default for a club that never saves settings = President + Membership
  Chair told in-app AND by email (one-line change to make it in-app only). Minor: failed notice write not logged.
- Bulletins + resend (agent-a93bcf94ecddf6854): DONE. e2e 35/35 (fake Brevo, no real mail), vitest 147, tsc ok.
  Lead re-check: dotnet test 114 pass / 0 fail. Gaps: admin sends to all members only (API takes sub-groups), no
  dashboard tile, no FeatureGate, no browser/device run. Worktree has a node_modules junction: remove with
  `cmd /c rmdir`, never Remove-Item (would delete main node_modules).
- GDPR erase (agent-a2f6ac4f900029d5d): agent says done (e2e 33/33, privacy/audit/retention e2e pass). Lead: SENT
  BACK (attempt 1/3) because a District Admin with all-clubs scope skips the second-approval rule. Note: the erase
  endpoint now requires `confirm` (callers updated). Also fixed: member_change_log kept personal data after erase.
- Grants (worktree agent-af38e07747ee957a7): agent says DONE. build 0 errors, api tests 129 pass, tsc ok, vitest 147,
  flutter analyze grants clean, grants_e2e ALL PASS. Gaps: app can't upload files / enter actuals (web only); chair =
  title contains "grant" (shortcut comment); no browser check. Lead re-check: `dotnet test` 129 pass / 0 fail (matches). PASS, ready to merge tomorrow.
- Incident 18:04: agents' concurrent `git stash` crossed (stash list is repo-wide). Lead checked all 7 resumed
  worktrees: own files present, no other module's code in Program.cs / DatabaseInitializer.cs. One "RECOVERED"
  stash entry left (invoices copy), harmless. All agents told: never stash.

Left out on purpose: training sandbox, WordPress plugin, AI drafting, Events/QR (other developer), Stripe, SMS.

## Area 1: Membership and club administration

| # | Item | Status |
|---|---|---|
| 1 | Member directory export: Excel + printable PDF | Done 2026-11-19 (API, admin, app; `member_export_e2e.py` 10/10; API tests 111 pass) |
| 2 | Mailing labels and name badges (PDF, Avery sizes) | Next |
| 3 | Ask members by email to update their profile | |
| 4 | Years-of-service and anniversaries report | |
| 5 | Carry committees over to the next year (clone) | |
| 6 | Contacts export and merge | |
| 7 | Prospect tasks assigned to members | |
| 8 | Configurable new-prospect notifications | |
| 9 | One-click GDPR erase / anonymise a person | |
| 10 | Officer progression auto-filled (PN to PE to P to IPP) | |
| 11 | Friends of the club (non-member type) | |
| 12 | Tags on members and contacts | |
| 13 | Custom profile fields | |
| 14 | Smart lists (saved filters reused in email and reports) | |
| 15 | Custom report builder | |
| 16 | Member map | |

## Area 3: Communication (email only), queued

Bulletin builder from stories, general email template library, attachments and signature, resend to non-openers,
AI drafting (assistant is switched off today).

## Local setup used (2026-11-19)

- MySQL data dir moved to `E:\websites\row\_local\rowdb\data` (git-ignored; the old temp dir was cleaned up).
  Start: `mysqld --datadir=E:\websites\row\_local\rowdb\data --port=3317 --bind-address=127.0.0.1 --mysqlx=OFF --console`.
- `row_prod_copy` re-copied from production on 2026-11-19 (read-only dump, 318 tables).
- Test logins in the copy only: club admin member 1068 (club 341, Colombo West) and ordinary member 999, password set
  locally and passed to e2e scripts through `ROW_E2E_PASSWORD`.
