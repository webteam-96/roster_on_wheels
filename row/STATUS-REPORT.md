# ROW status report (2026-10-23)

ROW (Roster On Wheels) is the international edition of RIZones: Rotary club and district management for countries
outside the India region. It is RIZones rebranded, with Stripe instead of Indian gateways (payments on hold until a
Stripe test account exists), no WhatsApp or SMS (email + in-app only), email + password sign-in, the module sheet's
red modules removed, and the build specification's new modules added.
Stack: .NET API (`row/api`, `row/workers`), Next.js admin (`row/admin`), Next.js public sites (`row/club-website`,
`row/district-website`, not in git), marketing site (`row/website`), Flutter app (`row/mobile`), MySQL.
Dates from the build guide: code freeze 28 Oct 2026, launch 15 Nov 2026.

## Done (verified 2026-10-23 on a local copy of production, `row_prod_copy`)

| Area | What | Evidence |
|---|---|---|
| Removal | Every red module of the sheet removed completely (code, admin, app, schema, seeds): club moderation + project approval, RI Director, zonal dashboard, zonal awards, goal lock and goal setting roles, direct beneficiaries, PPH camps, directory data collection, market place; roles ClubModerator, ZonalCoordinator, RIDirector; WhatsApp and SMS leftovers; project Category / Sub-category (user: Area of Focus only); the all-zones performance report | 84 trace patterns: 0 hits; all builds 0 errors |
| New modules | Web + API, each behind a FeatureGate flag that is OFF until a SuperAdmin switches it on: N1 Foundation designations + duplicate check + committee documents, N2 grants, N3 contacts / prospects / growth / invite prompts, N4 volunteers and speakers, N5 communication upgrades (templates per language, sender domains, Brevo webhook, consent, unsubscribe, allowances, member language, Governor note), N6 multilingual websites + Rotaract template + RI themes, N8 meeting links / calendar feed / compliance, N9 milestones / PHF highlights / spotlight cards, N10 live target dashboard, N11 chat (API + web moderation) | e2e PASS: N1 40, N2 76, N3 89, N4 87, N5 65, N6 40, N8 43, N9 44, N10 52, N11 84 checks |
| Security | Price-change OTP no longer returned outside Development; Gemini key moved from the URL to a header; Data Protection key file untracked (must be rotated: it is in git history of a public repo) | build 0 errors |
| Checks | `dotnet build` API + 3 workers 0 errors; admin `tsc` 0 errors, `vitest` 103/103, design check clean; both public sites `tsc` 0; app `flutter analyze` + tests passed after the removal; `scope_read_guard` 7/7 and `feature_gate` 10/10 PASS | `kb/testing.md` |
| Existing databases | `row/database/maintenance/2026-10-23-drop-removed-modules.sql` drops the removed modules' tables, columns, procedures and rows | tested on a throwaway copy; NOT run on production |

Details: `row/ROW-CHANGES.md` (2026-10-23), plans `docs/superpowers/plans/2026-10-23-*.md`, tracker `row/TRACKER.md`.

## In progress and planned (in this order)

| Phase | Work | Target |
|---|---|---|
| 1 (running) | Security: calendar data leak, mass email ownership checks, open translate route, emails in logs; read-access review of all GET routes; admin crawl findings F1-F6; older e2e scripts | 24 Oct |
| 2 | N12 time zones per district; N7 planning mode (planning/live, elect roles, DGE team and invites, next-year workspace, launchpad, cut-over with RI steps stubbed, edition auto-provisioning, 60-day trial); escalation ladder; target celebration; theme seed; Rotary Showcase Chrome extension under the ROW brand; DPA page; Foundation link in greetings; exports in the tenant's language; branding aligned with `row/website` | 25 Oct |
| 3 | Mobile app for members, clubs and districts: all new modules (prospects + guest invites, volunteers + speakers, chat, highlights, designations, language + consent, meeting links, target dashboard, grant status), next-year workspace + tenant branding, Add/Edit Member, Honorary Members, Public Image, District Goal Messages; then the app language switch through the translation API | 26-27 Oct |
| 4 | Assurance: every page run in a browser, the app on the emulator, all e2e, independent reviews, non-functional checks (WCAG on public sites, timing, email throughput) | 28 Oct |

Super Admin tools stay web-only.

## On hold (product owner)

Kaizen Events + Kaizen QR merge into ROW (events, form builder, registration, QR check-in, nomination form). Source
copies are in `reference/kaizen-events` and `reference/kaizen-qr` (read-only).

## Blocked outside the team

Payments (Stripe test account), RI outbound sync and imports (ROW's Rotary.org access, export files), data
migration (ClubRunner / DACdb export files), Zoom / Google meeting creation (OAuth apps), push notifications (ROW
Firebase project), production environment (hosting decision), translation provider key, app store accounts.

## Needs a decision or an action

- Rotate the ASP.NET Data Protection key ring (old key is in the public repo's history).
- Run the production cleanup script only after the new code is deployed and a backup is taken.
- Defaults taken without a decision (change if wrong): no club committees; a district counts as "on ROW" when it
  has a tenant row; volunteer hours add to project man-hours; transactional emails are not deducted from credits.
- `reference/kaizen-events` contains a committed Google Cloud service-account key and a payment data dump;
  `reference/kaizen-qr` contains attendee data backups. Rotate the key and clean those repositories.

## How to run and check locally

See `row/HANDOFF.md` (MySQL on 3317 with `row_prod_copy`, API on 5000, admin on 3300, sites on 3001/3002, app on
the emulator) and `kb/testing.md` (every check and e2e script with its arguments).
