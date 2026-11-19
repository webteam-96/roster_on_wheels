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

REBASE ROUND (~20:00): 14 worktrees made with isolation:worktree sat on OLD base 59f5edf (~750 files behind 553bfe7;
old Next.js club-website). All 14 told to follow the brief's "Rebase procedure" and rerun every check. Website builder,
website SEO and member map must also port their club-site work to the Vite app. Modules marked DONE below that were on
59f5edf (GDPR, prospects, profile, email compose, reports, officer progression, ledger, contacts, MFA, map, builder)
are DONE again only after their rebase report. The 8 resumed worktrees were already on 553bfe7.
Website builder note: contact-form section reuses /api/public/join (lands in prospects); existing sunrise theme bug
(DOMParser on server render) was in the OLD Next site.

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
