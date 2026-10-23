# ROW work tracker

One list of all ROW work: done, to do, blocked and removed, across frontend (admin web, public sites), backend
(API, workers), database and mobile app. Update the row when work moves. Started 2026-10-22.

Sources: `document/ROW Build Specification.docx` v4.1, `document/ROW Platform Build Decisions for Engineering.docx`,
the module sheet "RotaryIndia_Modules_and_Labels" (Google Sheet), decisions in memory and `PENDING-WORK.md`.
Plans: `docs/superpowers/plans/2026-10-22-web-completion.md`, `docs/superpowers/plans/2026-10-22-row-spec-remaining-build.md`.

Status words: **Done**, **In progress**, **To do**, **Blocked** (says on what), **On hold** (payments, until
Stripe), **Removed**.

## 1. Summary

| Area | Done | In progress | To do | Blocked / on hold |
|---|---|---|---|---|
| Existing modules, web (93 in scope) | 84 pages exist (+8 app-only, 1 removed) | Error crawl | Fix crawl findings (section 4) | 7 payment modules on hold |
| Existing modules, mobile app | 59 | | 33 screens (section 3, "Build app screen"; mostly Super Admin tools) | 7 payment modules on hold |
| Skipped modules (14 sheet rows) | Removed completely (2026-10-22/23) | | Drop leftover objects on prod: `database/maintenance/2026-10-23-drop-removed-modules.sql`, user go-ahead | |
| Phase 1 web hardening | 3 of 6 | 2 | 1 | |
| New spec modules (section 5) | 10 web + API (flags off until a SuperAdmin turns them on) | | N7, N12, app screens | 12 items blocked (section 6) |
| Launch items (section 7) | 4 | | 5 | 3 |

## 2. Skipped modules: remove completely

User decision 2026-10-22: skipped modules leave **no trace and no way to reach them**: no page, menu entry,
route, API endpoint, service, DTO, app screen, role option or seed row. This replaces the 2026-10-21 approach
(code kept, hidden, API 404). Database tables: dropped from the schema in `DatabaseInitializer` / `database/*.sql`;
dropping them on the live production database needs the user's go-ahead first (it deletes data).

| # | Skipped module (sheet) | FeatureGate key | Code today (files that mention it: API / admin / app) | Status |
|---|---|---|---|---|
| S1 | Club Moderator Dashboard, Project Approval (Moderation) | `club_moderation` | 24 / 26 / 13 | Done 2026-10-23: API, admin, app, schema; approval columns and Club Moderator Assignment removed too |
| S2 | RI Director Dashboard, Zone / RI Director Reports | `ri_director` | 34 / 51 / 31 | Done 2026-10-23: incl. Settings > RI Director Management, RI scope traces, the all-zones Performance Report (user: remove) |
| S3 | Zonal Dashboard | `zonal_dashboard` | 7 / 13 / 6 | Done 2026-10-23 (with S8) |
| S4 | Zonal Awards | `zonal_awards` | 15 / 14 / 5 | Done 2026-10-23: 5 tables, zone flag, Is_healthy_club leave the schema |
| S5 | Goal Lock / Unlock | `goal_lock` | endpoints in goal setting | Done 2026-10-23: club, district, zone and bulk locks |
| S6 | Goal Setting Roles | `goal_setting_roles` | 7 / 4 / 1 | Done 2026-10-23: goal imports moved to /settings/goal-imports; every SuperAdmin gets Goal Overview |
| S7 | Directory Data Collection | `directory_data_collection` | removed: API (4 files deleted, report sections, search), admin (settings + public pages, report rows), app report tiles, schema | Done 2026-10-22; 3 empty tables left in old DBs, drop after release |
| S8 | Direct Beneficiary Approvals, Direct Beneficiaries Limit | `direct_beneficiaries` | 25 / 27 / 2 | Done 2026-10-23: also SystemSettingsController (no caller left, read any setting) |
| S9 | PPH Camps | `pph_camps` | 21 / 30 / 20 | Done 2026-10-23 |
| S10 | Categories & Sub-categories (editing the masters) | `category_masters` | edit pages + write endpoints only; project forms keep reading categories | Done 2026-10-23, widened by the user: projects have no Category / Sub-category at all, Area of Focus only |
| S11 | Market Place | `marketplace` | removed: API, admin, app, seed; existing tile soft-deleted by the initializer | Done 2026-10-22 |
| S12 | Roles left without a module: ClubModerator, RIDirector, ZonalCoordinator | | auth, role lists, write guard; prod has no member with these roles (checked 2026-10-22) | Done 2026-10-23: roles 4, 5, 7 out of code and seeds; ids stay reserved |
| S13 | WhatsApp (no WhatsApp in ROW) | | sending removed 2026-10-19; WhatsApp-named DB columns and the WhatsApp Log page remain | Done 2026-10-23: WhatsApp columns, log, procedures; SMS leftovers too |
Confirmed by the user 2026-10-22: every S row above, including Club Moderator Dashboard (red on "Modules by Role",
green on "District Admin": red wins), S12 roles and S13 WhatsApp leftovers.

Done when: a search of `row/api`, `row/admin`, `row/mobile`, `row/workers` for each module's names finds nothing,
the API and admin build, and the crawl shows no request to a removed path.

## 3. Existing modules (the module sheet, 93 in scope)

Web page: the admin page exists. API + DB: endpoints and tables exist (not re-verified one by one). Mobile app:
matched by screen names in `row/mobile`. Error crawl: result of `kb/tools/admin_crawl.py` as SuperAdmin.

| # | Category | Module | Scope | Web page | API + DB | Mobile app | Error crawl | Next step |
|---|---|---|---|---|---|---|---|---|
| 1 | Communication | Announcements | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 2 | Communication | Club & District Calendar | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 3 | Communication | District Events | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 4 | Communication | Documents | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 5 | Communication | Login Announcement | In scope | Done | Exists | To do | Pending | Build app screen |
| 6 | Communication | Mass Email | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 7 | Communication | Newsletters | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 8 | Communication | Notification & Privacy Settings | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 9 | Communication | Push Notifications | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 10 | Communication | Sub Groups | Flagged off | Done | Exists | Done | Pending | Verify in crawl |
| 11 | Communication | Upcoming Events | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 12 | Communication | Web Links | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 13 | Dashboard | Assistant Governor Dashboard | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 14 | Dashboard | Club Dashboard (Overview) | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 15 | Dashboard | District Dashboard (Overview) | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 16 | Dashboard | Login & Role-based Home | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 17 | Dashboard | Member Mobile Home | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 18 | Dashboard | SuperAdmin Settings Hub | In scope | Done | Exists | To do | Pending | Build app screen |
| 19 | E-Governance | AG Reports | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 20 | E-Governance | CMR Submission Email Settings | Flagged off | App only | Exists | Done | Pending | Verify in crawl |
| 21 | E-Governance | Club Award Status & My Rotary Status | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 22 | E-Governance | Club Excellence / Youth Tracking | Flagged off | Done | Exists | Done | Pending | Verify in crawl |
| 23 | E-Governance | Club Monthly Report | Flagged off | Done | Exists | Done | Pending | Verify in crawl |
| 24 | E-Governance | Club Report / Annual Report | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 25 | E-Governance | District Awards (Citation) | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 26 | E-Governance | District Report | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 27 | E-Governance | OCV / Governor Visit | Flagged off | Done | Exists | Done | Pending | Verify in crawl |
| 28 | Foundation/TRF | Foundation Data Import | In scope | Done | Exists | To do | Pending | Build app screen |
| 29 | Foundation/TRF | Foundation Goals | Flagged off | Done | Exists | Done | Pending | Verify in crawl |
| 30 | Foundation/TRF | TRF Contributions | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 31 | Goal Setting | Club Goal Setting | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 32 | Goal Setting | District Goal Messages | In scope | Done | Exists | To do | Pending | Build app screen |
| 33 | Goal Setting | District Goal Setting | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 34 | Goal Setting | Goal Overview (Oversight) | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 35 | Goal Setting | Membership & Youth Goal Import | In scope | Done | Exists | To do | Pending | Build app screen |
| 36 | Goal Setting | Membership Goal | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 37 | Logs | Audit Log | In scope | Done | Exists | To do | Pending | Build app screen |
| 38 | Logs | Email Log | In scope | Done | Exists | To do | Pending | Build app screen |
| 39 | Logs | Login Logs | In scope | Done | Exists | To do | Pending | Build app screen |
| 40 | Logs | Push Notification Logs | In scope | Done | Exists | To do | Pending | Build app screen |
| 41 | Logs | WhatsApp Log | Removed (no WhatsApp) | Removed | Removed | Removed | Pending | Done |
| 42 | Membership | Add / Edit Member | In scope | Done | Exists | To do | Pending | Build app screen |
| 43 | Membership | Assistant Governor Assignment | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 44 | Membership | Attendance | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 45 | Membership | Board of Directors | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 46 | Membership | Club Leadership Master | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 47 | Membership | Club Moderator Assignment | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 48 | Membership | Clubs Management | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 49 | Membership | District Committee | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 50 | Membership | Duplicate Member Check | In scope | Done | Exists | To do | Pending | Build app screen |
| 51 | Membership | Global Member Search | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 52 | Membership | Global Search | In scope | Done | Exists | To do | Pending | Build app screen |
| 53 | Membership | Greetings (Birthdays & Anniversaries) | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 54 | Membership | Honorary Members | In scope | Done | Exists | To do | Pending | Build app screen |
| 55 | Membership | Members Directory | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 56 | Membership | Membership Analytics | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 57 | Membership | My Profile | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 58 | Membership | Past Presidents | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 59 | Membership | Potential Members | In scope | App only | Exists | Done | Pending | Verify in crawl |
| 60 | Membership | Rotary Network | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 61 | Membership | Zones Management | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 62 | Payments & Dues | Credit Management | In scope | Done | Exists | To do | Pending | Build app screen |
| 63 | Payments & Dues | District Dues | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 64 | Payments & Dues | Dues Approval | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 65 | Payments & Dues | Event Payment Links | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 66 | Payments & Dues | Membership Dues (Club Dues) | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 67 | Payments & Dues | My Membership Dues | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 68 | Payments & Dues | Payment Gateway Setup | On hold (payments) | Done | Exists | To do | Pending | Wait for Stripe |
| 69 | Payments & Dues | Wallet & Credits | On hold (payments) | Done | Exists | Done | Pending | Wait for Stripe |
| 70 | Reports | Daily Stats Report | In scope | Done | Exists | To do | Pending | Build app screen |
| 71 | Reports | District Performance Report | In scope | Done | Exists | To do | Pending | Build app screen |
| 72 | Reports | Platform Reports | In scope | Done | Exists | To do | Pending | Build app screen |
| 73 | Service Projects | Avenues of Service | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 74 | Service Projects | District Projects | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 75 | Service Projects | Project Categorization & Area of Focus | In scope | Done | Exists | To do | Pending | Build app screen |
| 76 | Service Projects | Public Image Initiatives | In scope | Done | Exists | To do | Pending | Build app screen |
| 77 | Service Projects | Rotary.org Project Sync | In scope | Done | Exists | To do | Pending | Build app screen |
| 78 | Service Projects | Service Projects | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 79 | Settings/Masters | Club & District Module Assignment | In scope | Done | Exists | To do | Pending | Build app screen |
| 80 | Settings/Masters | Currency & Funding | In scope | Done | Exists | To do | Pending | Build app screen |
| 81 | Settings/Masters | Designations | In scope | Done | Exists | To do | Pending | Build app screen |
| 82 | Settings/Masters | District Governor / Intl President / RI Director Masters | In scope | Done | Exists | To do | Pending | Build app screen |
| 83 | Settings/Masters | Event Masters | In scope | Done | Exists | To do | Pending | Build app screen |
| 84 | Settings/Masters | Mobile App Version & Maintenance | In scope | Done | Exists | To do | Pending | Build app screen |
| 85 | Settings/Masters | Module Master & Categories | In scope | Done | Exists | To do | Pending | Build app screen |
| 86 | Settings/Masters | Rotary Years | In scope | Done | Exists | To do | Pending | Build app screen |
| 87 | Settings/Masters | Rotary.org Sync | In scope | Done | Exists | To do | Pending | Build app screen |
| 88 | Settings/Masters | Static Pages (About, Contact, Tutorial) | In scope | Done | Exists | To do | Pending | Build app screen |
| 89 | Settings/Masters | Super Admin Role Config | In scope | Done | Exists | To do | Pending | Build app screen |
| 90 | Website | Club Website | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 91 | Website | District Website | In scope | Done | Exists | Done | Pending | Verify in crawl |
| 92 | Website | Website Management (All) | In scope | Done | Exists | To do | Pending | Build app screen |
| 93 | Website | Website Purchase & Themes | In scope | Done | Exists | Done | Pending | Verify in crawl |

## 4. Phase 1: web hardening (in progress)

| # | Task | Status | Notes |
|---|---|---|---|
| P1 | Off modules redirect to the role home, no "Not available" page | Done | `admin/src/components/FeatureGate.tsx`, 2026-10-22 |
| P2 | Read guard: club and district reads limited to members and managers | Done | `api/Services/ScopeWriteGuardMiddleware.cs`; e2e `kb/tools/scope_read_guard_e2e.py` 7/7 pass |
| P3 | Error crawl tool | Done | `kb/tools/admin_crawl.py` |
| P4 | Error crawl as SuperAdmin, fix every finding | In progress | first 66 pages: findings F1-F6 below |
| P5 | Crawl as District Admin, Club Admin, AG | Blocked | needs test logins for those roles (user said: Mukesh only for now) |
| P6 | e2e scripts use accounts from env vars | To do | `row_local` was dropped; scripts used its demo logins |
| P7 | Reads where the club / district id is in the query string, not the URL (589 GET routes) | To do | P2 covers only `/api/clubs/{id}` and `/api/districts/{id}` |

Crawl findings (SuperAdmin, 2026-10-22):

| # | Finding | Where | Status |
|---|---|---|---|
| F1 | Pages call the Foundation Goals API while that module is flagged off (404) | club admin dashboard, every tab: `api/club-foundation-goals/list` | To do |
| F2 | Pages call the Club Monthly Report API while flagged off (404) | club e-governance, `clubs/[id]/club-monthly-report` | To do |
| F3 | SuperAdmin opens the club admin dashboard with club id 1 (no club picked) | `api/clubs/1/...`; `rotary-org-credentials` answers 403 | To do |
| F4 | AG pages reachable by a non-AG (404 / 403) | `/ag-dashboard/*`, `/ag-reports` | To do |
| F5 | `rotary-org-terminated-members` answers 400 | `clubs/[id]/club-report/v2` | To do |
| F6 | Session drops to `/login` on some pages | AG dashboard, club monthly report | To do |

## 5. New spec modules (Build Specification v4.1)

Web = admin pages + public sites. All To do unless noted.

| # | Module | Spec | API | DB | Web | Mobile app | Notes |
|---|---|---|---|---|---|---|---|
| N1 | Membership fields: designations, duplicate check, sub-committees | 3.12, #9 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | designations entered by hand until RI access |
| N2 | Grants | 3.8, #17 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | |
| N3 | Contacts, prospects, growth, invite prompts | 3.13, #18, #33, #34 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | join form as a plain form until C8 |
| N4 | Volunteers and speakers | 3.13, #20 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | |
| N5 | Communication upgrades, member language, Governor note | 3.10, #7, #24, #25 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | Brevo webhook |
| N6 | Multilingual websites, Rotaract template, RI themes | 3.11, #8 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | n/a | |
| N7 | Planning mode without RI or payment | 3.1, #1, #5 | To do | To do | To do | To do | cut-over RI steps stubbed |
| N8 | Meetings: pasted links, calendar, compliance | 3.17, #23, #31 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | Zoom / Google blocked |
| N9 | Engagement: milestones, PHF, spotlight, escalation, celebration | B.2-B.4 | Done 2026-10-23 | Done 2026-10-23 | Done 2026-10-23 | To do (API ready) | feed + email; push blocked |
| N10 | Live target dashboard | B.3, #30 | Done 2026-10-23 | n/a | Done 2026-10-23 | To do (API ready) | lock flow red on the sheet |
| N11 | Chat | 3.10, #19 | Done 2026-10-23 | Done 2026-10-23 | moderation only | To do (API ready) | |
| N12 | Time zones and formats (district zone, UTC, no IST) | guide pkg 4 | To do | To do | To do | To do | |
| N13 | App language switch through the translation API | 3.3, guide pkg 13 | n/a | n/a | Done (live translation) | To do | user picks the provider |

## 6. Blocked or on hold

| Item | Spec | Waiting on |
|---|---|---|
| Payments: Stripe, fees, refunds, webhooks; dues invoices; subscriptions; donations; wallet | 3.4-3.6, #4, #5, #14, #16, #21 | On hold: Stripe test account |
| RI outbound sync, reason codes, officer titles, reconciliation | 3.2, #2, #9 | ROW's own Rotary.org access |
| Roster snapshot and Foundation report imports | 3.2 | a real My Rotary export file |
| Data migration, booth mode, ClubRunner site importer | 3.9, #6 | real ClubRunner / DACdb exports |
| Events inside ROW, form builder, QR check-in | 3.7, #15, #22 | decision C8 (Kaizen Events) |
| Zoom / Google meeting creation and attendance | 3.17 | Zoom and Google OAuth apps |
| Push notifications | many | ROW Firebase project |
| Production environment, CDN, backups, pen test, load test, support desk | 3.18, #13 | hosting decision |
| Translation provider for production | 3.3 | user choosing (DeepL or LibreTranslate) |

## 7. Launch items (build guide)

| Item | Status |
|---|---|
| Brand configuration | Done (verify "done when") |
| Master data seed files | Done (verify) |
| Privacy: export, erasure, consent, audit | Done |
| Rotary.org sync from configuration | Done (2026-10-21) |
| Phone E.164 | Done |
| Locale, time zone, currency | To do (N12) |
| App build and store listings | To do |
| Smoke suites for regression | To do |
| Prod schema catch-up (5 tables the code has, prod lacks) | To do, with the next deploy |
| Secret scan, rotate committed demo passwords (repo is public) | To do |
| Payments, club subdomains | Blocked / on hold |

Code freeze 28 October and launch 15 November 2026 (build guide): **not confirmed by the user**.
