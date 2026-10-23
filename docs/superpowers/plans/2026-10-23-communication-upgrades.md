# N5 Communication upgrades, member language, Governor note (lane d, 2026-10-23)

Spec: row-build-spec-v4.1 section 3.10 (no WhatsApp; chat is another lane), build list #7, B.1 #24-25, B.2
(language preference, leadership block). Web layers only; the app gets API endpoints (listed below).

## Goal

- Templates per tenant (club or district) and language; one sender profile per tenant.
- Tenant sender domains checked in DNS (ownership token, SPF, DKIM, DMARC; TXT lookups with timeouts, DNS only).
- Per-campaign delivery, open and click tracking, and per-tenant bounce and complaint suppression, from Brevo's
  webhook (shared secret from config, idempotent on a derived event id); suppressed addresses are skipped on send.
- Consent per channel (email, push) with a timestamp; every bulk email carries an unsubscribe link to a public
  page (signed token, no login) and List-Unsubscribe headers.
- Monthly allowance per edition (25 emails per member for clubs, 6 for districts) enforced on bulk send, with a
  usage report. No overage purchase (payments on hold): a send over the allowance is refused.
- The member's language preference picks the template language for greetings and the meeting reminder nudge,
  falling back to the tenant language, then the platform language.
- Governor note on club greetings: district-level name, photo and message, per-district switch; the club
  president signature stays.

## What exists (verified 2026-10-23)

- Email provider: Brevo HTTP API (`EmailService.SendViaBrevoAsync` / `SendMassEmailAsync`; worker copy in
  `workers/GreetingsWorker/Services/BrevoEmailSender.cs`). `email_log.brevo_message_id` is stored for most mails,
  not for mass emails.
- Campaigns: `club_mass_emails` + `club_mass_email_recipients` (club and district), sent by
  `ClubMassEmailService.SendAsync` with a credit check (`club_credits`). Per-recipient Sent/Failed only.
  The detail, update, delete, send and recipients endpoints do not check that the campaign id belongs to the
  club or district in the URL (IDOR): fixed here because the send path changes.
- Member language: `member_master_profile.PrimaryLanguage` (profile select of English names, default "English";
  the member's own `PUT /api/members/me/language` writes a code such as "es"). Reused as the preference; names are
  mapped to codes with .NET culture data. No tenant language exists: added in `comm_settings`.
- Greetings: sent by the separate `GreetingsWorker` (birthday and anniversary, email and push, club and district),
  signed by the current Club President or DG. No templates per language, no Governor note.
- Consent: `member_consents` is the privacy-policy acceptance, not per channel. Nothing per channel exists.
- Editions: `edition_catalogue` + `tenant_subscriptions` (Wave 1). No allowance.
- DNS: `DnsClient` is already referenced (`DnsPointingChecker`). HTML cleaning: `PublicHtml.Clean`.
- Machine translation: admin route `/api/i18n/translate` (pluggable provider, 8 s timeout).

## Tables (additive: DatabaseInitializer + database/schema.sql; new columns also in schema-drift.sql)

- `comm_settings` (tenant key fk_club_id, fk_district_id): default language, Governor note (district rows),
  sender profile (from name, from email on a verified domain, reply-to).
- `comm_templates`: tenant, key, language, subject, body (cleaned HTML), reviewed (0 = beta machine translation).
- `comm_sender_domains`: tenant, domain, DKIM selector, ownership token, spf/dkim/dmarc/ownership flags, checked_at.
- `comm_suppressions`: tenant (0/0 = platform), email, reason. Personal data registry (by email).
- `member_channel_consents`: member, channel, consented, changed_at_utc, source. Registry (by member).
- `comm_webhook_events`: derived event key (idempotency), event, message id.
- `comm_usage`: tenant, month, emails used (atomic reservation).
- Columns: `club_mass_emails.TemplateKey`; `club_mass_email_recipients.MessageId, Language, DeliveryStatus,
  DeliveredAt, OpenedAt, OpenCount, ClickedAt, ClickCount` + indexes on fk_mass_email_id and MessageId;
  `edition_catalogue.email_allowance_per_member` (club editions 25, district 6).

## Endpoints

Tenant routes, `{scope}` = clubs | districts, managers of that club or district only:
- `GET|PUT /api/{scope}/{id}/comms/settings`
- `GET|PUT /api/{scope}/{id}/comms/templates`, `DELETE .../comms/templates/{templateId}`
- `GET|POST /api/{scope}/{id}/comms/domains`, `POST .../domains/{domainId}/verify`, `DELETE .../domains/{domainId}`
- `GET /api/{scope}/{id}/comms/usage?month=YYYY-MM`
- `GET /api/{scope}/{id}/comms/suppressions`, `DELETE .../suppressions/{suppressionId}`, `GET .../comms/opt-outs`
- `GET /api/{scope}/{id}/comms/campaigns/{massEmailId}` (tracking)
Member (app): `GET|PUT /api/mobile/comms/preferences` (consents; language stays on `PUT /api/members/me/language`).
Public: `GET|POST /api/public/comms/unsubscribe/{token}` (rate limited; one-click POST supported).
Webhook: `POST /api/webhooks/brevo` (bearer secret `Brevo:WebhookSecret`, idempotent).

Flag: `communication` (Kind.Flagged). The unsubscribe and webhook endpoints are not gated by the flag: links
already sent must keep working, and the webhook is gated by its secret.

## Pages

- `/club-admin-dashboard/comms-settings`, `/district-admin-dashboard/comms-settings`: templates (with machine
  translate, beta until reviewed), sender profile and domains, usage, suppressions and opt-outs, language and
  (district) Governor note. Nav entry in both dashboards.
- Campaign detail pages (4): tracking card. Compose pages (4): template picker and allowance line when on
  (the client-side credit block is skipped when on, since sends no longer use credits).
- Public `/unsubscribe/[token]` page in the admin app.

## e2e

`kb/tools/communication_upgrades_e2e.py`: a fake Brevo HTTP server and a fake DNS server inside the script (the API
is started with `Brevo__ApiUrl` and `Comms__DnsServers__0` pointing at them), so nothing leaves the machine and
recipient addresses are rewritten to `@example.invalid`. Covers flag gate, access checks, templates, settings,
domains, localised send, unsubscribe link and page API, webhook auth + idempotency + tracking + suppression,
skip on next send, allowance refusal, usage report, cleanup.

## Shortcuts

Listed in the Done section; each has a `shortcut:` comment in code.

## Done (2026-10-23)

### Files

Added:
- `row/api/Services/CommsService.cs`: settings (language, Governor note, sender profile), templates (cleaned with
  `PublicHtml.Clean`), sender domains (DnsClient TXT lookups, 4 s per query, 15 s per check, public resolvers or
  `Comms:DnsServers`), allowance and usage (atomic reservation in `comm_usage`), campaign send plan, tracking,
  suppressions, opt-outs, consent, unsubscribe token (HMAC with `JwtSettings:Secret`, no expiry), Brevo events.
- `row/api/Services/CommsTemplates.cs`: language resolution (codes, and English names through .NET culture data),
  template load and pick, placeholders, Governor note HTML, the email / push block SQL. Linked into the GreetingsWorker.
- `row/api/Controllers/CommsController.cs`, `row/api/DTOs/CommsDtos.cs`
- `row/admin/src/components/comms/` (`CommsSettings.tsx`, `TemplatesSection.tsx`, `SenderSection.tsx`,
  `CampaignTrackingCard.tsx`, `ComposeComms.tsx`, `ui.ts`), `row/admin/src/lib/comms.ts` + `comms.test.ts`
- `row/admin/src/app/club-admin-dashboard/comms-settings/page.tsx`, `.../district-admin-dashboard/comms-settings/page.tsx`,
  `row/admin/src/app/unsubscribe/[token]/page.tsx` (public)
- `kb/tools/communication_upgrades_e2e.py`

Changed:
- `row/api/Services/ClubMassEmailService.cs`: module on: skip unsubscribed / suppressed recipients (status Skipped),
  allowance instead of credits, per-member language version, unsubscribe footer + List-Unsubscribe headers, verified
  sender address, message id and language per recipient, allowance given back for failed sends, atomic
  Draft/Failed to Sending claim. Module off: unchanged (credits). `TemplateKey` on create, update and detail.
  `BelongsToAsync` (+ `IClubMassEmailService`).
- `row/api/Controllers/ClubMassEmailsController.cs`, `DistrictModulesController.cs`: detail, update, delete, send and
  recipients check that the campaign belongs to the club or district in the URL (IDOR fix; the send path changed).
- `row/api/Services/EmailService.cs` + `IEmailService.cs`: `SendMassEmailAsync` takes an optional from address and
  headers and returns Brevo's message id.
- `row/api/Services/MeetingsService.cs`: the meeting reminder (nudge) uses the club's `meeting_reminder` template in the
  member's language and leaves out unsubscribed / suppressed members while the module is on.
- `row/workers/GreetingsWorker/Services/GreetingsJob.cs` + `.csproj`: module on: birthday / anniversary template in the
  member's language, the district's Governor note under club greeting emails (president signature kept), email skipped
  for unsubscribed / suppressed members, push skipped when the member switched push off.
- `row/api/Services/FeatureGate.cs` (flagged `communication`), `row/api/Program.cs` (DI, rate limit `unsubscribe`
  30/min/IP), `row/api/Services/DatabaseInitializer.cs`, `row/database/schema.sql`, `row/database/schema-drift.sql`,
  `row/api/Privacy/PersonalDataRegistry.cs`, `row/api/DTOs/ClubMassEmailDtos.cs`
- Admin: `services/api.ts`, club and district `nav.ts` ("Email Settings"), the 4 mass email detail pages (tracking
  card) and the 4 compose pages (template picker, allowance line; the client-side credit block is skipped while on).

### Tables

New: `comm_settings`, `comm_templates`, `comm_sender_domains`, `comm_suppressions`, `member_channel_consents`,
`comm_webhook_events`, `comm_usage`. Columns: `club_mass_emails.TemplateKey`; `club_mass_email_recipients.MessageId,
Language, DeliveryStatus, DeliveredAt, OpenedAt, OpenCount, ClickedAt, ClickCount`;
`edition_catalogue.email_allowance_per_member` (club, club_basic, rotaract 25; district 6). Indexes:
`idx_cmer_mass_email`, `idx_cmer_message`, `ix_email_log_brevo_message`. Registry: `member_channel_consents` (by member,
deleted on erasure), `comm_suppressions` (by email, deleted on erasure); `comm_settings` is an audit-ignored settings table.
Down: drop the 7 tables, the 8 recipient columns, `club_mass_emails.TemplateKey`,
`edition_catalogue.email_allowance_per_member` and the 3 indexes.

### Endpoints

- `GET|PUT /api/{clubs|districts}/{id}/comms/settings`
- `GET|PUT /api/{clubs|districts}/{id}/comms/templates`, `DELETE .../comms/templates/{templateId}`
- `GET|POST /api/{clubs|districts}/{id}/comms/domains`, `POST .../domains/{domainId}/verify`, `DELETE .../domains/{domainId}`
- `GET /api/{clubs|districts}/{id}/comms/usage?month=YYYY-MM`
- `GET /api/{clubs|districts}/{id}/comms/campaigns/{massEmailId}`
- `GET /api/{clubs|districts}/{id}/comms/suppressions`, `DELETE .../suppressions/{suppressionId}`, `GET .../comms/opt-outs`
  (tenant routes: managers of that club or district only, checked on reads too; writes audited)
- `GET|PUT /api/mobile/comms/preferences` (the caller's email / push consent with timestamps, effective language)
- `GET|POST /api/public/comms/unsubscribe/{token}` (anonymous, signed token, 30/min/IP, RFC 8058 one-click POST)
- `POST /api/webhooks/brevo` (bearer `Brevo:WebhookSecret`, constant-time compare; one event or a batched array; idempotent)

The flag `communication` gates the tenant and mobile routes (404 while off); unsubscribe and webhook stay open.

### For the app (later)

- Consent per channel: `GET|PUT /api/mobile/comms/preferences` with `{ email?: bool, push?: bool }`.
- Language: the existing `PUT /api/members/me/language` (writes `PrimaryLanguage`); the effective language is in the
  preferences response.

### Verification

- `dotnet build` (api): 0 errors, 189 warnings, none in the touched files (189 before). GreetingsWorker: 0 errors, 0 warnings.
- `kb/tools/communication_upgrades_e2e.py`: 70/70 PASS, run twice on the final build against `row_lane_d` (fake Brevo
  and fake DNS inside the script, worker run included); no test rows left (checked by query). Covers the flag gate, manager-only access,
  settings and Governor-note validation, templates (script removed, beta flag), domain checks (ownership, SPF, DKIM,
  DMARC pass and fail, other tenant 404), sender profile, consent from the app, a localised campaign (English and
  Arabic versions, unsubscribed member skipped, unsubscribe link and headers, verified sender), webhook auth, batching,
  idempotency, tracking, hard bounce suppression, skip on the next send, allowance refusal, the unsubscribe page API
  (tampered and cross-member tokens refused, one-click), lifting a suppression, the IDOR fix, a greeting with the
  Arabic template, the Governor note and the president signature, and the unsubscribe link working with the module off.
- Regression: `scope_read_guard_e2e.py` ALL PASS, `meetings_links_compliance_e2e.py` ALL PASS.
- Meeting reminder in the member's language, once by hand (API with `Meetings__ReminderJob=true`, Brevo on a local
  fake server): the English member got the `en` template, the Arabic member the `ar` one, both with the join link;
  all rows removed afterwards.
- Admin: `tsc --noEmit` 0 errors; vitest `comms.test.ts`, `meetingCompliance.test.ts`, `FeatureGate.test.ts` 8/8 pass;
  `check-design.mjs` all counters 0.

### Shortcuts (each has a `shortcut:` comment)

- Over the allowance a send is refused: no overage purchase or wallet top-up while payments wait for Stripe.
- Allowance numbers are seeded per edition; no editor on Settings > Editions yet (SQL).
- The unsubscribe line, the greeting frame ("Greetings from", "Dear Rtn.", push text) and the "District Governor"
  label are English; only template subject and body are per language.
- Only greetings, the meeting reminder and mass emails use templates; other reminders keep their English text.
- The DKIM value and Brevo-side domain authentication are done by ROW support (Brevo account); ROW checks DNS only.
- `comm_webhook_events` is never pruned.

### Open issues

- Ops before go-live: create the Brevo transactional webhook (URL `/api/webhooks/brevo`, bearer auth with
  `Brevo:WebhookSecret` of 16+ characters, events delivered, opened, click, hard_bounce, soft_bounce, blocked, spam,
  invalid_email, unsubscribed); set `Api:BaseUrl` (List-Unsubscribe header) and `FrontendUrl` (unsubscribe page link).
  Check with one real send that Brevo passes the List-Unsubscribe headers (not verifiable locally).
- Rotating `JwtSettings:Secret` invalidates unsubscribe links already sent (they answer "not valid").
- Spec B.1 #25 says "per-tenant switch": built as the district's switch (all its clubs), as the task asked; there is no
  club-level opt-out. Club greetings use the club's own templates (no fallback to the district's).
- Existing, not touched: `ClubMassEmailService.UpdateAsync` re-adds recipients without the district id, so editing a
  district "All members" campaign leaves it with no recipients.
- Existing, not touched: with the module off, a district campaign checks and deducts credits for club id 0, which
  `CreditManagementService` matches against every district wallet (`fk_club_id = 0`).
- Existing: any member of a club can read its mass email list and recipients (scope guard read rule); whether that
  should be managers only belongs to the read-access review.
- Not in this module: milestone messages, the PHF feed item and spotlight cards (B.2 items 26 to 28).
