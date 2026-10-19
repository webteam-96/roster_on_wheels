# ROW Build Specification v4.1: module layout and work plan

**Source:** `document/ROW Build Specification.docx` (v4.1, September 2026), read in full on 2026-10-19.
**Scope:** the 35 build items (Section 2 items 1-23, Appendix B items 24-35). Appendix A items are treated as already covered.
**Status of this file:** a planning layout for the team to approve, not yet an executable task plan. Each wave below gets its own detailed plan (writing-plans format) before it is built.

## 0. Conflicts with the spec, and how they were settled

**Settled by the user, 2026-10-19** (the docx is not fully up to date):
- C1: ROW is a separate project with its own backend, database and frontends (`row/`). Build once, in `row/`.
- C2: MySQL for now.
- C3: no WhatsApp and no SMS. All communication is in-app (push, feed, chat) or email. Spec items that use WhatsApp (DGE invites, wallet, templates, invite prompts) use email and in-app instead; existing WhatsApp code is removed as part of Wave 1.
- C4: hosting still undecided; keep code hosting-neutral, Wave 6 waits.
- C6: payments are Stripe (Connect). Razorpay/Cashfree are not used in ROW; subscription invoices (item 5) also go through Stripe unless told otherwise.
- C8 (Kaizen Events): open; Wave 4 event items wait for its code or API contract.

The original table is kept below for the record.

### Original conflict table

The spec disagrees with decisions recorded in this repo. Each one changes what gets built.

| # | Spec says | Repo / agreed so far | Effect if not settled |
|---|---|---|---|
| C1 | "One backend": ROW is the shared RIZones ASP.NET API, switched by brand and region flags; India clients stay on it | ROW is a separate codebase (`row/api`, stack finalised 2026-10-15) | Every item is built either once in a shared API or twice. Biggest decision. |
| C2 | SQL Server | `row/api` runs on MySQL (`database/schema.sql`, Dapper + MySqlConnector) | Migration scripts, stored procedures, data types |
| C3 | WhatsApp is a live channel (invites, wallet, templates, items 3.10, 33) | ROW has no WhatsApp (2026-10-13); user's meeting pending | Communication, invites, wallet |
| C4 | Hosting on Kaizen's managed India server, CDN, off-site backups in India | Hosting undecided (IIS or AWS), keep code neutral | Production readiness (item 13), privacy terms (DPA for India processing) |
| C5 | Members use the app only; console for admins | Matches today | none |
| C6 | Payments: Stripe Connect (Mode A / Mode B) internationally, Razorpay and Cashfree for India | Open decision 4; India gateways being removed from ROW | Settles decision 4 for ROW: Stripe Connect only, unless C1 makes ROW the shared backend |
| C7 | SMS out of scope at launch | App sign-in moved to email + password for every member (2026-10-19) | Consistent; OTP endpoints become unused |
| C8 | Kaizen Events is the single form builder and event engine ("link backends or rebuild") | Not in this repo | Items 15, 22, grants and prospect forms depend on it; needs its code or API contract |

## 1. Status of the 35 items in ROW today

Legend: **Exists** = working in `row/`; **Partial** = foundation exists; **New** = nothing yet. Layers: API, Admin (console), App, Web (club/district public sites), Worker.

| # | Item | ROW today | Layers |
|---|---|---|---|
| 1 | Planning mode and cut-over | New (Rotary year switcher exists) | API, Admin, App, Worker |
| 2 | My Rotary outbound sync | Partial: inbound sync and authorisation tracking exist; outbound needs ROW's own RI access (open decision 7) and RI certification | API, Worker, Admin |
| 3 | Localisation | Partial: admin next-intl + machine translation, brand locale (currency, number locale, zone), app formats done (2026-10-19); no editable string catalogue, emails/PDFs/push not localised | API, Admin, App, Web |
| 4 | Payments (international) | Partial: dues, event links and wallet APIs exist but on India gateways (`CashfreeKyc`, `RazorpayRouteAccounts`); no gateway abstraction or Stripe | API, Admin, App, Web |
| 5 | Subscription billing | Partial: editions and module switches exist; no band, term, invoices, trial, auto-provisioning | API, Admin |
| 6 | Data migration | New | API, Admin, Worker |
| 7 | Communication | Partial: mass email, push, greetings, credits, sub-groups; no per-language templates, domain verification, tracking, suppression, unsubscribe | API, Admin, Worker |
| 8 | Website | Partial: club and district site APIs and themes exist, `row/district-website` copied 2026-10-19; no multilingual content, cookie banner | Web, API, Admin |
| 9 | Membership sync fields | Partial: member types, duplicate tooling (`MemberDuplicate`) exist; RI reason codes and six officer titles not mapped | API, Admin |
| 10 | Privacy (GDPR set) | Mostly exists (WS7: consent, export, erasure, retention, registry); left: app screens, immutable audit log, cookie banner, DPA | API, Admin, App, Web |
| 11 | ROW app | Partial: conversion in progress (endpoints, formats, phone, email sign-in done 2026-10-19); left: privacy screens, languages, gateway payments, next-year workspace, stores | App |
| 12 | ROW admin console | Exists; Fellowship design done 2026-10-19; left: planning views, languages, exports in tenant language | Admin |
| 13 | Production readiness | New (blocked by C4) | Ops |
| 14 | Currency and tax | Partial: brand currency list and formatting; no tax labels per country, Stripe currency pass-through | API, Admin |
| 15 | Events inside ROW | Partial: `EventMasters`, `EventPaymentLinks`, `UpcomingEvents`; Kaizen Events not linked (C8) | API, Admin, App, Web |
| 16 | Dues | Partial: allocation, collection, reminders, receipts, KPIs; no fee schedule, frequency, proration, statements, credits, export | API, Admin, App |
| 17 | Grants | New | API, Admin, App |
| 18 | Contacts and prospects | Partial: `PotentialMembers`; no contacts, stages, public form, conversion | API, Admin, App, Web |
| 19 | Chat | New | API (real-time), App |
| 20 | Volunteers and speakers | New (project man-hours exist) | API, Admin, App, Web |
| 21 | Donations | New | API, Admin, Web, App |
| 22 | Attendance QR check-in | Partial: attendance module exists; QR in Kaizen Events (C8) | API, App |
| 23 | Online meetings | New (meeting records to verify) | API, Admin, App, Worker |
| 24 | Multilingual nudges | New, after 3 and 7 | API, Worker |
| 25 | Leadership-branded greetings | Partial: greetings exist | API, Admin |
| 26 | Service-year milestones | New | Worker, API |
| 27 | PHF highlights | New, after 9 (designations) | API, App |
| 28 | Spotlight cards | New | API, Admin |
| 29 | District target setting | Partial: district goals with lock exist | API, Admin, App |
| 30 | Live target dashboard | Partial: district dashboards exist | API, Admin |
| 31 | Meeting compliance | New, needs meeting records (23) | API, Worker, Admin |
| 32 | Escalation alerts | New | Worker, API |
| 33 | Invite prompts | New, after 18 | Worker, App, API |
| 34 | Growth progress | Partial: goals | API, Admin |
| 35 | Target celebration | New, after 28 | Worker, App |

## 2. New modules to add

Each module is one API area (controller + service + tables), one console area and, where listed, app screens. Names follow the existing `row/api` conventions (`XController`, `XService`, snake_case tables with `pk_` / `fk_` keys, soft delete `isdeleted`).

| Module | Tables (new) | API | Console (admin) | App | Public web |
|---|---|---|---|---|---|
| **TenantLifecycle** (1, 5) | `tenant_state` (planning/live, region, edition, band, term, bridge dates), `edition_catalogue`, `edition_modules`, `launchpad_checklist`, `cutover_runs` | `TenantController`, `SubscriptionController`, `CutoverService` (worker job) | Super Admin: tenants, editions, invoices; District: launchpad, cut-over | next-year workspace switch | DGE sign-up page |
| **RiOutbound** (2, 9) | `ri_outbound_queue`, `ri_reason_codes`, `ri_officer_title_map`, `roster_snapshots` | `RiOutboundController`, sync worker extension | district club list: pending/rejected per club, snapshot status, onboarding kit | none | none |
| **Localisation** (3, 24) | `i18n_strings` (key, locale, text, reviewed), `member_language` column | `I18nController` (catalogue export/import, overrides) | Super Admin string editor | language setting, ARB from catalogue | language switch |
| **Payments** (4, 14, 21 money) | `gateway_accounts`, `payments`, `refunds`, `platform_fee_ledger`, `fee_settings`, `tax_rates` | `IPaymentGateway` + `StripeConnectGateway`; `PaymentsController`, webhooks (signed, idempotent) | Express onboarding, OAuth connect, payouts, fee settings | pay via gateway | checkout pages |
| **Migration** (6) | `import_batches`, `import_mappings`, `import_rows` | `ImportController` + parser service | upload, map, preview, commit, rollback, reconciliation PDF, checklist | none | none |
| **CommsPlus** (7, 24) | `email_templates_i18n`, `sender_domains`, `email_events`, `suppressions`, `channel_consent` | provider webhooks (opens, clicks, bounces), unsubscribe endpoint | templates, domains, campaign stats | consent settings | unsubscribe page |
| **SiteI18n** (8) | `site_content_i18n`, `cookie_settings` | extend `ClubWebsitePublicDataV2`, `DistrictWebsitePublicData` | per-language editor, "machine translate this page" | none | language dropdown, cookie banner, hreflang |
| **DuesSchedule** (16) | `fee_schedules`, `fee_lines`, `invoices`, `invoice_lines`, `payments_applied`, `member_credits` | extend `MembershipDues` / `ClubDues` | schedule, batch invoice, statements, QuickBooks/Xero/CSV export | statement, part payment | public invoice pay |
| **Grants** (17) | `grant_cycles`, `grant_applications`, `grant_budget_lines`, `grant_events` (state log), `grant_disbursements` | `GrantsController` with role-gated state machine | district cycle + review; club applicant view | status + notifications | none |
| **Contacts & Prospects** (18, 33, 34) | `contacts`, `contact_groups`, `prospect_stages` (extend `PotentialMembers`) | `ContactsController`, prospect conversion | contacts, groups, pipeline board | invite link, RSVP | "interested in joining" form |
| **Chat** (19) | `chat_threads`, `chat_members`, `chat_messages`, `chat_reports` | `ChatController` + SignalR hub (or long polling if hosting forbids sockets) | moderation queue | direct + group chat | none |
| **Volunteers & Speakers** (20) | `signup_sheets`, `signup_slots`, `signup_entries`, `speakers`, `meeting_duties` | `VolunteerController`, `SpeakerController` | sheets, speakers, duties | sign up, hours | speaker list |
| **Donations** (21) | `donation_campaigns`, `donations`, `recurring_gifts` | `DonationsController` (via Payments) | campaigns, donors, receipts | give | campaign page (embeddable) |
| **Meetings** (22, 23, 31) | `meetings` (mode, link, provider ids), `oauth_connections`, `meeting_checkins` | `MeetingsController`, Zoom/Google OAuth, Zoom report pull job | meeting mode, connect Zoom/Google, compliance rule | link, QR check-in | public meeting info |
| **Engagement** (25-28, 32, 35) | `milestones_sent`, `spotlight_cards`, `escalation_rules`, `escalation_log` | worker jobs: milestones, escalations, celebrations; card renderer | approve cards, rules | feed items | none |
| **Targets** (29, 30, 34) | extend goal tables: `target_proposals` (propose/counter/accept/lock) | extend `GoalSetting` | DG proposals, live dashboard | president accept/counter | none |

Cross-cutting, required by all of the above: tenant scoping on every query (IDOR checks), audit log rows for admin and money actions (item 10), localised strings from day one (item 3), timeouts and idempotency on every external call (Stripe, Zoom, Google, RI, email provider).

## 3. Work plan in waves

Ordered by dependency, external blockers and the launch acceptance list (spec Section 6). Every wave ends with its "Done when" checks from the spec, run end-to-end on a staging copy.

**Wave 0: decide (no code).** C1-C4 and C6 settled 2026-10-19; C8 open. Request external inputs (spec Section 4): RI test environment, Stripe test account, ClubRunner and DACdb exports, launch language list, ROW server, RI answer on Foundation feed.

**Wave 1: platform foundations** (unblocked now)
- Localisation catalogue (3): string table, overrides, export to admin (next-intl) and app (ARB); localise emails, push, PDFs.
- Tenant lifecycle and editions (1, 5): tenant state, edition catalogue, module switches from editions, year switcher in planning mode.
- Audit log + privacy remainder (10): immutable audit log, app privacy screens, cookie banner on both public sites.
- Meetings record (23 base): meeting entity with mode; verify RIZones meeting data first (spec B.3).
- Remove WhatsApp (senders, logs, credits, templates, admin and app screens) and the unused SMS/OTP paths (C3).
- Finish the app conversion (11) and the mobile design pass already in progress.

**Wave 2: money** (needs Stripe test account)
- Gateway abstraction + Stripe Connect adapter, Express + OAuth onboarding, Mode A/B fee, fee recovery, refunds, signed idempotent webhooks (4, 14).
- Move existing dues, event links and wallet off the India gateways onto the abstraction.
- Dues schedule, invoices, statements, exports (16).
- Subscription invoices with Razorpay international link (5).

**Wave 3: data in and out** (needs RI access and real export files)
- RI outbound queue, reason codes, officer title map, reconciliation, snapshot import, onboarding kit (2, 9).
- Migration framework with mappings written against real files (6).
- Cut-over action and launchpad (1).

**Wave 4: club and district features**
- Grants (17), contacts and prospects with public form (18), volunteers and speakers (20), donations (21), events inside ROW and QR check-in (15, 22) once C8 is settled, online meetings with Zoom/Google (23).
- Communication upgrades (7) and multilingual websites (8).

**Wave 5: engagement and governance** (Appendix B)
- Targets proposal/accept/lock and live dashboard (29, 30, 34), meeting compliance (31), escalations (32), milestones, PHF highlights, spotlight cards, celebrations, invite prompts (24-28, 33, 35).
- Chat (19) here or earlier, depending on hosting support for WebSockets.

**Wave 6: launch readiness** (13): environment, CDN, status page, backups with restore test, pen test, load test from outside India, support desk, store approvals.

## 4. How each wave is run

- One detailed plan per wave (writing-plans), approved before code.
- Backend first with an e2e script in `kb/tools/` per module (as `privacy_e2e.py`, `mobile_password_login_e2e.py`), then console, then app.
- Gates: BACKEND-CHECKLIST, SECURITY-CHECKLIST, FRONTEND-RULES in `CLAUDE.md`; money and auth items reviewed before merge.
- No commits until asked; no secrets in files.
