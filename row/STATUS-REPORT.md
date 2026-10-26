# ROW status report (updated 2026-10-23, evening)

ROW (Roster On Wheels) is the international edition of RIZones: Rotary club and district management for countries
outside the India region. It is RIZones rebranded, with Stripe instead of Indian gateways (payments on hold until a
Stripe test account exists), no WhatsApp or SMS (email + in-app only), email + password sign-in, the module sheet's
red modules removed, and the build specification's new modules added.
Stack: .NET API (`row/api`, `row/workers`), Next.js admin (`row/admin`), Next.js public sites (`row/club-website`,
`row/district-website`, not in git), marketing site and brand source (`row/website`), Flutter app (`row/mobile`), MySQL.
Build guide dates: code freeze 28 Oct 2026, launch 15 Nov 2026. Priority (product owner): finish the rebranding,
the admin console and the mobile app first.

## Done (verified on a local copy of production, `row_prod_copy`)

| Area | What |
|---|---|
| Removal | Every red module of the sheet removed completely: club moderation + project approval, RI Director, zonal dashboard, zonal awards, goal lock and goal setting roles, direct beneficiaries, PPH camps, directory data collection, market place; roles ClubModerator, ZonalCoordinator, RIDirector; WhatsApp and SMS leftovers; project Category / Sub-category (Area of Focus only); the all-zones performance report |
| New modules (web + API, each behind a switch that is OFF until a SuperAdmin turns it on) | N1 Foundation designations + duplicate check + committee documents; N2 grants; N3 contacts, prospects, growth, invite prompts; N4 volunteers and speakers; N5 communication upgrades; N6 multilingual websites + Rotaract template + RI themes; N7 planning mode (elect roles, DGE invitations, next-year workspace, launchpad, cut-over with RI steps stubbed, edition auto-provisioning, trials); N8 meeting links, calendar feed, compliance; N9 milestones, PHF highlights, spotlight cards, escalation ladder, target celebration; N10 live target dashboard; N11 chat (API + web moderation); Foundation giving link per district; draft DPA page |
| Time zones (N12) | IANA zone per district; greetings, reports, reminders, milestones, iCal and dashboards use the district's own day and hour; app dates follow the device locale |
| Rebranding | Admin, emails, documents and app aligned with `row/website` (logo, colours, icons); money labels follow the brand or district currency |
| Security | Calendar endpoints and mass email limited to the right club/district; recipient lists checked; translate route signed-in tiers and visitor budget; email addresses masked in logs; 758 GET routes reviewed, 77 fixed; own-device push tokens only; module masters SuperAdmin-only; club id 0 no longer passes club writes; OTP no longer echoed outside Development; Gemini key in a header; Data Protection key untracked (must be rotated: it is in git history) |

Proof (2026-10-23): `dotnet build` API + 3 workers 0 errors; admin `tsc` 0, `vitest` 120/120, design check clean;
public sites `tsc` 0; app `flutter analyze` 0 errors, tests pass; 30 e2e scripts, 1,250 checks, 0 failures; admin crawl
of 319 pages as SuperAdmin with no real errors; the app run on the Android emulator against the local API (sign-in,
home, calendar, club calendar, notifications) with ROW branding and no exceptions. Details: `kb/testing.md`.

## Still to do (in order)

| Phase | Work |
|---|---|
| 1b (security) | Done 2026-10-26 (uncommitted): ownership checks on records by id, sub group members, payment link writes, wallets, generic errors, temporary passwords; e2e `security_guards`, `scope_read_guard`, `feature_gate` pass. Left for a product decision: club finder member lists, `/api/members` search on hidden phones, public OCV documents. |
| 3 | Done 2026-10-26 (uncommitted): app screens for N1-N5, N7-N11 (volunteers, meeting duties, guest invite, prospect stage, chat, highlights in the feed, my designations, communication + calendar feed, targets, grants, next-year workspace, group chats, club speakers, grant applications) and District Goal Messages; checked on the Android emulator; Add/Edit Member, Honorary and Public Image already existed. Left: per-tenant logo and colours (no tenant branding in the API yet, needs a decision); Club Dues tile waits for payments. |
| 3b | App language switch through the translation API |
| 4 | Final assurance: crawl as District Admin, Club Admin and AG (needs local test logins), independent reviews, non-functional checks (WCAG, timing, email throughput) |
| Later | Rotary Showcase Chrome extension under the ROW brand; exports in the tenant's language; meeting forms to send UTC times |

Super Admin tools stay web-only.

## On hold (product owner decides when)

Kaizen Events + Kaizen QR merge into ROW (events, form builder, registration, QR check-in, nomination form; copies in
`reference/kaizen-events` and `reference/kaizen-qr`, read-only). All club and district website work, including
beautiful website themes sold per subscription plan.

## Blocked outside the team

Payments (Stripe test account), RI outbound sync and imports (ROW's Rotary.org access, export files), data
migration (ClubRunner / DACdb export files), Zoom / Google meeting creation (OAuth apps), push notifications (ROW
Firebase project), production environment (hosting decision), translation provider key, app store accounts.

## Needs a decision or an action

- Rotate the ASP.NET Data Protection key ring (the old key is in the public repo's history).
- Run `row/database/maintenance/2026-10-23-drop-removed-modules.sql` on production only after deploy + backup.
- Re-import the GreetingsWorker Task Scheduler job on the server (it now runs hourly).
- The DPA page is a draft: legal review needed. Legal pages still describe India and INR.
- Defaults taken (change if wrong): no club committees; a district counts as "on ROW" with a tenant row; volunteer
  hours add to project man-hours; transactional emails are not deducted from credits.
- `reference/kaizen-events` contains a committed Google Cloud service-account key and a payment data dump;
  `reference/kaizen-qr` contains attendee data backups: rotate the key and clean those repositories.

## How to run and check locally

`row/HANDOFF.md` (MySQL on 3317 with `row_prod_copy`, API on 5000, admin on 3300, sites on 3001/3002, app on the
emulator) and `kb/testing.md` (every check and e2e script with its arguments).
