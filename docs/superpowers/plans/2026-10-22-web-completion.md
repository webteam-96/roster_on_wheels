# ROW web application: completion plan (2026-10-22)

Ask (user, 2026-10-22): complete the web application, frontend, backend and APIs. Payments are on hold. Skipped
modules must be unreachable, and in-scope-but-hidden modules too, so no stray errors appear. Mobile is out of
scope for this plan. Source of scope: `2026-10-22-row-spec-remaining-build.md` (spec, module sheet, build guide).

Status: **waiting for the user's approval.**

## What exists

- `row/api/Services/FeatureGate.cs`: 11 skipped modules (API 404), 6 flagged (off until Settings > Features).
  Admin hides links and shows "Not available" (`components/FeatureGate.tsx`). E2E `kb/tools/feature_gate_e2e.py`.
- The 7 yellow payment modules are **not** in FeatureGate: their pages and India-gateway calls are reachable.
- 496 admin pages; all 93 in-scope modules have pages (2026-10-21).

## Phase 1: no stray errors (first, smallest, highest value)

1. **Payments on hold**: add the 7 payment modules (District Dues, Dues Approval, Event Payment Links,
   Membership Dues, My Membership Dues, Payment Gateway Setup, Wallet & Credits) to FeatureGate as a third kind,
   `OnHold`: hidden and API 404 like skipped, flipped on when Stripe lands. Extend `feature_gate_e2e.py`.
2. **Unreachable means unreachable**: a direct URL to an off module redirects to the role home instead of
   showing "Not available"; no other page calls an off module's API (dashboards, tabs, counters). Done when the
   crawl below logs zero requests to off-module APIs.
3. **Error crawl**: a script in `kb/tools/` signs in as SuperAdmin, District Admin, Club Admin and AG on
   `row_prod_copy`, opens every admin page reachable from that role's menu, and logs console errors, failed API
   calls (4xx/5xx) and error screens. Fix each root cause in shared code. Done when the crawl is clean for all
   four roles. Same for the club and district public websites.
4. **Read access review** (H1): every GET with a club, district or member id checks the caller may read it.
   Done when an e2e proves a club admin cannot read another club's members, dues or reports.
5. **e2e logins** (H2): `kb/tools/*_e2e.py` read their accounts from env vars; seed test accounts into
   `row_prod_copy` only.

## Phase 2: new spec modules, web layers (API + admin + public sites)

Order and content as in the spec plan, section 3; app screens are left for the mobile plan.

| # | Module | Web parts |
|---|---|---|
| 1 | Membership fields | designations with dates, duplicate check on RI ID + email, sub-committees + documents |
| 2 | Grants | district cycle, review, states, disbursement records, reports; club applicant pages |
| 3 | Contacts, prospects, growth | contacts + groups + CSV import, prospect pipeline, public join form on club and district sites, conversion, growth target on dashboards |
| 4 | Volunteers and speakers | sign-up sheets, speakers on meetings and the club site, meeting duties, reminders |
| 5 | Communication upgrades | per-language templates, sender profiles, domain check, Brevo webhook tracking + suppression, consent, unsubscribe page, allowances |
| 6 | Websites | per-language pages, machine-translate button, language dropdown, per-language SEO, Rotaract template, RI default themes |
| 7 | Planning mode (no RI, no payment) | elect roles, DGE team + invites, next-year workspace and year switcher views, launchpad, cut-over action (RI steps stubbed), edition auto-provisioning, trial |
| 8 | Meetings | pasted links for online/hybrid, calendar feed, reminders, compliance rule on the district club list |
| 9 | Engagement | milestones, PHF highlights, spotlight cards with approval, escalation ladder, celebrations (feed + email) |
| 10 | Targets | live target dashboard (lock flow stays off: red on the sheet) |
| 11 | Chat | API + moderation queue on the web (chat itself is in the app) |
| 12 | Time zones and formats | district IANA zone, UTC storage, no IST constant left (build guide package 4) |

Each module: tables in `DatabaseInitializer`, controller + service, e2e in `kb/tools/`, admin pages behind
FeatureGate, then build + `tsc` + vitest + design check + gate review before the next module.

## Not in this plan

Payments (on hold), RI outbound sync, data migration, Kaizen Events (C8), Zoom/Google OAuth creation, push,
deployment, the mobile app, translation provider key (user is choosing one).

## Size and order of work

Phase 1 is about 2 sessions. Phase 2 is about 12 modules at 1 to 2 sessions each. Work goes one module at a
time; nothing is committed until the user asks.
