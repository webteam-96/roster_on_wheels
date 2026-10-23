# ROW Build Specification: remaining build (from 2026-10-22)

Source: `document/ROW Build Specification.docx` v4.1, read in full 2026-10-22 (sections 0-6, appendices A and B),
checked against `2026-10-19-row-build-spec-plan.md`. Wave 1 is done. This file sorts everything left into
**build now** and **blocked**, and sets the order. Each module gets its own short task plan before code.

Spec overrides still in force: no WhatsApp or SMS (C3, email + in-app instead), hosting undecided (C4), red
modules from the module sheet stay off (PENDING-WORK 11a).

Status: **waiting for the user's approval.**

## 1. Blocked (cannot be built or tested yet)

| Item | Spec | Waiting on |
|---|---|---|
| Payments: gateway abstraction, Stripe Connect, fee modes, refunds, webhooks | 3.4, #4, #14 | Stripe test account |
| Dues schedule, invoices, statements, accounting export | 3.6, #16 | Payments |
| Subscription invoices, Razorpay international link, dunning, DGE booth payment | 3.5, #5 | Payments |
| Donations, wallet overage | 3.13, 3.10, #21 | Payments |
| RI outbound sync, reason codes, certification, reconciliation, secondary vendor | 3.2, 3.12, #2, #9 | ROW's own Rotary.org access |
| District roster snapshot import, Foundation monthly report import | 3.2 | A real My Rotary export file |
| Data migration, booth mode, ClubRunner website importer | 3.9, #6 | Real ClubRunner / DACdb exports |
| Events inside ROW, form builder, QR check-in, nomination form | 3.7, #15, #22 | Decision C8 (Kaizen Events) |
| Zoom meeting creation and attendance pull, Google Meet links | 3.17 | Zoom and Google OAuth apps |
| Push delivery | all nudges | ROW Firebase project (in-app feed and email work without it) |
| Production readiness, CDN, backups, status page, pen test, load test, support desk | 3.18, #13, s5 | Hosting decision |
| Native-speaker review, store listings in launch languages | 3.3, 3.15 | Confirmed language list + reviewers |

## 2. Housekeeping first (not in the spec, found 2026-10-22)

| # | Task | Why |
|---|---|---|
| H1 | Review read (GET) endpoints for cross-club / cross-member access | Only writes were reviewed; prod holds 2,057 real members |
| H2 | Point `kb/tools/*_e2e.py` at accounts in `row_prod_copy` via env vars | `row_local` was dropped; every module below needs working e2e |
| H3 | Plan the prod schema catch-up (5 tables missing) with the next deploy | Translations and website orders fail on prod |

## 3. Build now, in this order

Each module: API (controller, service, tables in `DatabaseInitializer`, e2e in `kb/tools/`), then admin, then app.
Every query scoped to the caller's club or district, audit rows for admin actions, strings through the catalogue.

| # | Module | Spec | What gets built |
|---|---|---|---|
| 1 | Localisation, finish it | 3.3, #3, 3.16 | Extract hard-coded strings from API messages, admin (6 of 773 screens done), app, emails, PDFs, exports into the catalogue; machine-translate the 8 proposed languages labelled beta; tenant time zone, event time in viewer + tenant zone; name order, address and phone formats; exports in tenant language. Launch acceptance needs "no untranslated string". |
| 2 | Membership fields | 3.12, #9 part | Designations (PHF and multiples, Major Donor, Bequest Society) with dates, entered manually until RI feeds them; duplicate check on RI ID and email at entry; sub-committees and per-committee documents if missing; member self-view of Foundation recognition in the app. |
| 3 | Grants | 3.8, #17 | Cycle per year with DDF budget and rules; club application with budget lines, partners, attachments; the spec's 10 states with role-gated transitions, comments, notifications, audit; disbursement records, cash-flow view, final report, close; dashboard and export; clubs see only their own. Light mode for clubs whose district is not on ROW. |
| 4 | Contacts, prospects, growth | 3.13, #18, #33, #34 | Contacts with groups, CSV import with duplicate handling; prospect stages (inquiry to inducted) with owner and notes; public "interested in joining" form (plain form until C8); one-click conversion; invite prompts with invite link + RSVP; growth target per club with progress on club and district dashboards. |
| 5 | Volunteers and speakers | 3.13, #20 | Sign-up sheets with slots, self sign-up by members and contacts, reminders, hours rolling into project totals; speakers scheduled to meetings, shown on the website and bulletin; meeting duties with reminders. |
| 6 | Communication upgrades | 3.10, #7, #24, #25 | Templates per tenant and language, sender profiles; sender domain SPF/DKIM/DMARC check; delivery, open, click tracking and bounce/complaint suppression via signed Brevo webhook; consent per channel; unsubscribe on every bulk message; allowances per edition with usage report; member language preference for every nudge; Governor note on greetings. |
| 7 | Websites | 3.11, #8 | Per-language pages and stories, "machine translate this page", visitor language dropdown, per-language SEO, hreflang; Rotaract template; RI brand-compliant default themes. |
| 8 | Planning mode, the parts without RI or payment | 3.1, #1, #5 part, 3.15, 3.16 | Elect roles auto-provisioned at district sign-up; DGE appoints next-year team; DGE invites PE and SE by email; next-year workspace in admin and app; launchpad checklist; cut-over action (live flip, roles roll, archive, collections on; RI steps stubbed until access); edition catalogue auto-provisioning Club Basic and Rotaract; 60-day trial; per-tenant logo and colours in the app. |
| 9 | Meetings | 3.17 part, #23, #31 | Paste a Teams/other link on online and hybrid meetings; link in app, calendar feed and reminders, hidden from public pages; meeting compliance rule per club on the district club list. |
| 10 | Engagement | B.2, B.4, #26, #27, #28, #32, #35 | Milestone job (1, 3, 5, 10 years, once each); PHF highlights from designations (module 2); spotlight card generator with admin approval; escalation ladder president, AG, DG with log; target celebration once per target. Feed + email. |
| 11 | Targets | B.3, #29, #30 | Live dashboard: target vs actual per club and district, filters by AG group, drill-in, actuals from ROW data. Proposal / counter / lock flow only if the user overrides the red "Goal Lock / Unlock". |
| 12 | Chat | 3.10, #19 | Direct and group chat with SignalR, reporting and moderation queue. |
| 13 | Non-functional checks | s5 | WCAG 2.1 AA pass on public sites, app accessibility, p95 timing on the console with `row_prod_copy`, email queue throughput (50,000 in 5 minutes). |

## 3a. Cross-check: module sheet and build guide (2026-10-22)

**Module sheet** (Google Sheet "RotaryIndia_Modules_and_Labels", colours read from an xlsx export): it covers the
107 existing modules only, not the new spec modules. Colours match PENDING-WORK 11a exactly (14 red, 6
orange/yellow flagged, 7 yellow payments), already applied 2026-10-21. Effect on this plan:
- Red "Goal Lock / Unlock" and "Goal Setting Roles": module 11 builds the dashboard only, unless overridden.
- Red Zonal Dashboard, Zonal Awards, Zone / RI Director Reports: the spec's `zone` edition has no zone screens.
- Red PPH Camps: matches the spec's "Programmes (camps)" exclusion.
- Orange Foundation Goals ("Is this coming from RI?"): module 2's Foundation self-view stays behind that flag.
- Yellow Sub Groups (District Admin tab): contact groups in module 4 must not depend on Sub Groups being on.

**Build guide** (`document/ROW Platform Build Decisions for Engineering.docx`, 2026-09-29): a narrower launch
scope with **code freeze Wednesday 28 October 2026 and launch Sunday 15 November 2026**. Its packages and where
ROW stands (2026-10-19 overrides still win: separate backend, no WhatsApp/SMS, Stripe, hosting open):
- Brand configuration (1), master data seed files (11), privacy (10), Rotary.org sync from config (9): largely
  done per ROW-CHANGES; to verify against each "done when".
- Locale, time zone, currency (4): partial; "no IST constant remains" to verify.
- Phone and OTP (5): E.164 done; OTP by SMS/WhatsApp removed.
- Translation (13): **the biggest launch gap**: "a lint check finds no hard-coded UI strings, every screen in all
  eight languages". Admin is at 6 of 773 screens. This is module 1 above.
- Payments (2): blocked on Stripe. Club subdomains (6): blocked on hosting.
- ROW app build and store listings, regression smoke suites (12): not started.
- The guide also says "No developer machine connects to a production database". The 2026-10-22 prod copy was
  taken at the user's request; keep further prod access to dumps only.

If the 28 October freeze still holds, only module 1 and the guide's verification items fit before it; modules
2 to 13 are post-launch.

## 3b. Pending totals, web and app (2026-10-22)

Existing modules (sheet, 107): 14 red are skipped, leaving 93. Web: all 93 pages exist (built 2026-10-21); 7
yellow payment modules wait for Stripe. App: the sheet lists 32 in the app, but `row/mobile` screen names show
about 26 more of the 60 "web only" ones already in the app (mass email, sub groups, district events, CMR, OCV,
attendance, committees, prospects, district projects, club and district website editors, AG and moderator
assignment, zones, clubs list, event payment links, wallet). Missing from the app, about 34, mostly Super Admin:
login announcement, settings hub, all 11 Settings/Masters screens, 5 logs, data and goal imports, goal messages,
duplicate check, global search, honorary members, credit management, gateway setup, daily stats / district
performance / platform reports, project categorisation, public image, Rotary.org project sync, website
management, module assignment. (Name-matched, not opened screen by screen.)

Cross-cutting on existing modules: UI language. Web already switches language through live machine translation
of the page (`admin/src/i18n/LiveTranslate.tsx`, free MyMemory provider by default); only 5 of 781 files use
reviewed i18n keys. App has no language switch (no l10n / ARB). Emails, PDFs and time zones also open.
**User decision 2026-10-22: translation by API, no manual translations or native review.** App gets the same
approach as the web: a translating text widget calling the translate endpoint with a local cache, applied to its
~3,950 `Text(` widgets (386 files). Production needs a provider key (DeepL or self-hosted LibreTranslate).

New spec work: 13 buildable modules (section 3), each needing API + web + app; plus the blocked list (section 1).

## 4. Open questions for the user

0. Do the build guide dates (freeze 28 October, live 15 November 2026) still hold?

1. Order: housekeeping H1-H2 first, then modules 1 to 13?
2. Targets: the sheet marks Goal Lock / Unlock red. Dashboard only, or the proposal flow too?
3. Chat: now, or after hosting is decided?
4. Layers: API + admin + app per module, or API + admin for all first, app later?

## 5. Size

Housekeeping about 2 sessions; 13 modules about 1 to 2 sessions each, Localisation the largest. One module at a
time, each verified (build, e2e, admin type check and tests, gate review) before the next.
