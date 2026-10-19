# Wave 1: platform foundations (ROW build spec items 1, 3, 5, 10, 23 base, C3)

> Executed inline (superpowers:executing-plans). Parent: `docs/superpowers/plans/2026-10-19-row-build-spec-plan.md`.
> Ledger: `.superpowers/sdd/2026-10-19-wave1-foundations/progress.md`.

**Goal:** the foundations every later wave needs: an immutable audit log, cookie consent on the public sites, meeting
mode on meeting records, no WhatsApp or SMS anywhere, tenant lifecycle with editions, and an editable string catalogue.

**Tech:** `row/api` (.NET 10, Dapper, MySQL; schema changes in `DatabaseInitializer` as idempotent `CREATE/ALTER IF NOT
EXISTS` plus `database/schema.sql`), `row/admin` (Next.js 14), `row/club-website` + `row/district-website`, `row/mobile`.

## Global constraints
- Decisions 2026-10-19: separate ROW backend, MySQL, Stripe, communication in-app + email only, hosting undecided.
- Every new endpoint: authentication + scope check (SuperAdmin / district / club), parameterised SQL, audit row.
- Schema changes are additive and idempotent; nothing drops data. WhatsApp tables stay (history), code goes.
- Verification per task: API → `dotnet build` + an e2e script in `kb/tools/`; admin → `tsc` + vitest; app → `flutter analyze` (0 errors) + `flutter test`.
- No commits until asked.

## Review focus
1. Erasure must still anonymise `audit_log` after it becomes immutable.
2. Removing WhatsApp must not break email or push sending paths that share services with it.
3. An edition change must not delete module data, only switch modules on or off.
4. A missing catalogue string falls back to the English source, never shows a key.
5. Cookie banner: non-essential scripts load only after consent; the choice persists.

---

### Task 1: Immutable audit log (item 10)
- DB triggers on `audit_log`: `BEFORE DELETE` signals an error; `BEFORE UPDATE` signals unless the only change is `member_name` / `ip_address` set to NULL (privacy erasure). Added in `DatabaseInitializer` (idempotent: drop-if-exists + create) and `database/schema.sql`.
- e2e `kb/tools/audit_immutable_e2e.py`: UPDATE of `action` fails, DELETE fails, anonymising UPDATE succeeds, privacy erase of a demo member still completes.

### Task 2: Meeting mode on meeting records (item 23 base)
- `club_attendance` gains `MeetingMode` (`in_person` | `online` | `hybrid`, default `in_person`) and `MeetingLink` (varchar 1000, null). Attendance API create/update/get carry both; link only kept for online/hybrid and must be `https://`.
- Admin attendance add/edit: mode select + link field; list shows a mode chip. App attendance detail shows the link (opens externally).
- e2e: create hybrid meeting with link, read back; reject `javascript:` link; in-person drops the link.

### Task 3: Cookie consent on public sites (item 10 / 8)
- `club-website` and `district-website`: a cookie banner (essential-only by default, "Accept analytics" / "Essential only"), choice in a first-party cookie for 180 days, footer link to reopen. Analytics/third-party embeds render only after consent. Text from brand; links to privacy policy.
- Verified in the browser on the local club site; vitest/unit for the consent helper.

### Task 4: Remove WhatsApp and SMS (C3)
- API: delete `WhatsAppInfoController`, `WhatsAppLogController`, WhatsApp senders/templates/scheduled sends, WhatsApp credit types in wallet/credit logic, Twilio SMS sender and OTP-by-SMS path; keep tables. Workers: same.
- Admin: remove WhatsApp log/settings pages, credit cards, preview components, menu tiles, "WhatsApp" options in send dialogs.
- App: remove WhatsApp share/send actions and credit tiles. The "whatsapp" social-link type on club/district websites is removed too (ROW has no WhatsApp).
- Gate: `grep -ri whatsapp` in code (excluding migrations/history tables and docs) = 0; build/tests green; admin and app smoke checks.

### Task 5: Tenant lifecycle and editions (items 1, 5)
- Tables: `edition_catalogue` (code district|club|club_basic|rotaract|zone, name), `edition_modules` (edition_code, module_key), `tenant_subscriptions` (district or club id, edition_code, member_band, term_start, term_end, state planning|live, region US|EU|APAC|IN, bridge_start, bridge_end, setup_fee_waived, platform_fee_pct, platform_fee_fixed, fee_waiver_until).
- API (SuperAdmin): list/edit editions and their modules; get/set a district's subscription; "apply edition" switches the district's and its clubs' module assignments using the existing module-assignment tables (on/off only); district subscription provisions `club_basic` for every club and `rotaract` for Rotaract clubs.
- Planning state: `GET api/tenants/{districtId}/state`; while `planning`, writes to current-year records are refused (next-year allowed) by one guard used by the year-scoped write endpoints.
- Admin: Super Admin › Tenants page (subscription form, apply edition), Editions page (module checklist).
- e2e: create subscription, apply edition, modules switched, planning blocks a current-year write and allows next-year.

### Task 6: String catalogue (item 3)
- Table `i18n_strings` (namespace, key, locale, text, reviewed, updated_by, updated_at). Source of truth stays the admin `messages/en` JSON; overrides per locale in the table.
- API: `GET api/i18n/{locale}` (public, cached, ETag) returns overrides; SuperAdmin `PUT api/i18n/{locale}/{namespace}/{key}`.
- Admin: messages = bundled + overrides merged at load; Super Admin › Translations editor (filter by namespace, missing/unreviewed). Machine-translated locales keep the LiveTranslate fallback.
- App: same endpoint for app strings later (Wave 1 builds the API; app ARB generation is listed for the app i18n step).
- Tests: vitest merge (override wins, missing falls back to English); e2e override round-trip.
