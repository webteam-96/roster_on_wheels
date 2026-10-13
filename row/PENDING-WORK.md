# ROW — Pending Work and Why

Written 2026-10-12 against `main` @ `eca1661`; **updated the same day after session 3** (admin, club website, privacy and the .NET edition, §3, §4, §6, §14) **and on 2026-10-13 (session 4: India-specific behaviour removed, ROW has no WhatsApp, §7, §14)**. Each item below says what is left, **why it is still
pending**, and what unblocks it. Evidence comes from the generated comparisons in `kb/` (rerun with
`bash kb/rebuild.sh`) and from `row/STATUS.md`. Task ids (WS…) refer to
`document/ROW-Master-Development-Plan.md`.

Every pending item has one of four reasons:

| Reason | Meaning |
|---|---|
| **Decision** | Cannot start until product / company decides something |
| **External** | Needs an account, credential or service ROW does not have yet |
| **Not started** | Nothing blocks it; it has simply not been reached in the build order |
| **Excluded** | India-only or a RIZones partner integration; will not be ported as it is |

## 1. Summary

| # | Area | Size | Reason | Unblocked by |
|---|---|---|---|---|
| 1 | Payments (API + all clients) | 202 routes, 19 controllers | Decision | Stripe / PayPal choice, tax handling, payouts (open decision 4) |
| 2 | Admin portal conversion | Tasks A and B done; C (pay pages) left | Decision (C) | Payments |
| 3 | Club website conversion | Done (purchase / renewal pages wait for Payments) | — | — |
| 4 | Mobile app WS10 items | 6 items | Mixed (see §5) | Firebase project, Payments, final icon |
| 5 | Privacy (WS7) | Backend done in both editions; legal texts and the mobile screens left | Decision + External | Counsel's policy texts (Q6), legal review of health data (decision 2) |
| 6 | WhatsApp removal | senders, scheduled sends, log, credits, admin / mobile screens | Decision (on hold) | ROW has no WhatsApp (2026-10-13); waits for the go-ahead (§7) |
| 7 | Deployment on IIS | web.config ×3, guide | Not started + Decision | Plesk vs IIS-native club hosting (open decision 3) |
| 8 | Testing gaps | real sends, Payments, load, reports SQL | External | ROW credentials, a test database with real-shaped data |
| 9 | Reference refresh | local copy 2 days behind | External | Access to the private RIZones repo from this machine |
| 10 | Excluded RIZones items | 8 controllers / features | Excluded | Nothing; replace with ROW equivalents where needed |
| 11 | Open product decisions | 12 | Decision | Product / company owners |
| 12 | .NET edition (`row-dotnet`) ROW behaviour | Payments only (§14) | Done except Payments | Payments (decision 4) |

## 2. Payments (largest backend gap)

**What is left.** 202 of the 224 .NET routes ROW does not serve are payments (`kb/api-routes-diff.md`):
ClubDues 39, EventPaymentLinks 32, MembershipDues 28, MobileClubAdminMembershipDues 13,
PublicMembershipDues 12, PublicEventPayment 9, EventMasters 8, WalletLinks 8, PublicClubDues 7,
PublicWallet 7, WebsiteBilling 7, MobileClubDues 5, MobileMembershipDues 4, PublicClubWebsite 4, Wallet 4,
PublicDuesApproval 2, PublicClubDuesApproval 2, ClubWebsitePublic `renew-link` 1, and the 10 ClubWebsites
pricing endpoints. Also the background jobs that depend on them: website provisioning for paid orders,
settlement sync and membership-dues reconciliation.

**Why pending.**
- RIZones takes money through **Cashfree and Razorpay**, which only work in India. ROW serves other
  countries, so this code cannot be ported as-is like the rest of the API. It has to be **rebuilt** on
  Stripe and/or PayPal (master plan WS6).
- The rebuild depends on decisions nobody has made yet (open decision 4):
  - which provider or providers;
  - how tax is handled (RIZones hard-coded Indian GST);
  - how clubs and districts get paid out (RIZones used Razorpay Route sub-accounts; Stripe Connect or
    PayPal is the likely equivalent, and the brand config already has a `payments.connect` flag).
- Only configuration exists so far: `admin/src/lib/checkout.ts` and the brand flags. There is no payment
  code in the API.

**Knock-on effects.**
- The mobile and admin payment screens call these routes and show an error until they exist
  (`kb/mobile-diff.md`, `kb/admin-diff.md`).
- Club-website renewal emails go out without a pay link.
- The WhatsApp website reminder is not sent, because its template carries that link.

**Unblocked by.** Decision 4, then ROW Stripe / PayPal test accounts.

## 3. Admin portal (`row/admin`)

**Done (session 3).** Task A (RIZones content, media, footer, `/cookies`), task B (₹ / INR / en-IN / IST →
brand currency, locale and zone), `localCount`, the goal-split pilot, the six inherited type errors.

**What is left.**
- **C. Wire the pay pages to `checkout.ts` and hide the Cashfree / Razorpay screens.** Waits for Payments (§2).
  The ₹ / INR left in the admin is all in this code, in the wallet and website-purchase pricing (flags off
  on ROW) and on the public landing page (site off).
- **Policy texts.** The privacy policy, terms and refund pages are RIZones' Indian legal texts with the
  names changed. Why pending: legal content, not engineering; needs counsel (Q6).
- **Translation (WS2).** `next-intl` is wired, but only 6 of 773 screens use translations. Why pending:
  the extraction is large (master plan: 6 engineer-weeks) and every language needs a reviewer (Q8).

## 4. Club website (`row/club-website`)

**Done (session 3).** No RIZones literal; admin-login link, support contacts, image hosts, locale and
currency from settings; project costs in each project's own currency. Left: the website purchase and
renewal pages, which wait for Payments (§2).

## 5. Mobile app (`row/mobile`)

**Done.**
- Calls the ROW API.
- Brand loaded from `api/public/brand`.
- RIZones names, links and partner cards removed.
- ROW icons in place.
- Starts without Firebase.

35 of 400 files changed (`kb/mobile-diff.md`).

| Item | Why pending |
|---|---|
| WS10-04 currency / number / date formats (₹, lakh / crore, `en_IN`, "today") — 43 files | Not started: Flutter is not installed on this machine, so Dart changes could not even be analysed or tested here |
| WS10-05 phone input assumes India (+91, 10 digits) | Not started; needs an international phone field and E.164 storage (the API already normalises) |
| WS10-06 payment flows (18 files with Cashfree / Razorpay) | Waits for Payments (§2) |
| WS10-07 push notifications | External: needs a ROW Firebase project (open decision 6); the API side is ported |
| WS10-08 privacy screens | The backend now exists (§6); not started in the app |
| WS10-03 translation | Not started |
| WS10-09 store listings | External: needs store accounts and listing content (the ROW icon is now in place) |
| Device builds / `flutter test` | No Android SDK or Flutter on this machine; last run (2026-10-10) was 70 tests passing |

Clean-up, not urgent: 130 of the 200 `ApiConstants` entries are unused RIZones carry-over, and
`role_management_screen.dart` calls `/api/admin/roles`, which neither API has (a RIZones bug).

## 6. Privacy (WS7)

**Done (session 3), in both editions.** Consent, export, two-admin erasure, tombstone honoured by the
Rotary.org sweep, registry audit, retention, member language, consent-aware broadcasts
(`kb/tools/privacy_e2e.py`: 26 of 26 on NestJS and .NET).

**What is left.**
- Counsel's policy texts and cookie wording, and the lawful basis for synced members who never sign in
  (Q6). Why pending: legal decisions.
- The mobile app's consent screen and "download my data" / "delete my account" (WS10-08). Why pending:
  no Flutter SDK on this machine.
- Health data: PPH camps (non-members) stay behind `modules.pphCamps` (off) until decision 2.

## 7. WhatsApp: removal on hold

**Decision (2026-10-13): ROW has no WhatsApp.** Not Interakt, and not a Meta replacement either. Messaging is
email, SMS (Twilio) and push. This supersedes open decision 12 (Meta templates) and the old item "scheduled
WhatsApp sender".

**What is left.** Take WhatsApp out of both editions, the admin portal and the mobile app: the senders, the
scheduled sends (announcements, events, reminders), the WhatsApp log and credits, the "send WhatsApp" options and
screens, and "whatsapp" in the default one-time-code policy (`Brand:Providers:OtpPolicy`, NestJS default
email / WhatsApp / SMS).

**Why pending.** On hold until the go-ahead. Meanwhile the .NET edition sends WhatsApp through the Meta Cloud API
(`MetaWhatsAppService` in `Services/RowMessaging.cs`, which replaced Interakt in session 4), and only when Meta
credentials are configured; with none, nothing is sent and email / SMS are used.

## 8. Deployment on IIS

**What is left (STATUS §7).**
- `web.config` for `row/api` and `row/admin`: neither exists. The club website's is the RIZones iisnode
  one.
- An IIS deployment guide: HttpPlatformHandler, URL Rewrite, app pools, environment variables, SSL.
- Server set-up from master plan Workstream S and WS0: health endpoint, smoke suite, versioned deploy
  with rollback.

**Why pending.**
- Nothing was going to be deployed before the API was mostly ported.
- Club-website hosting depends on whether the IIS servers run Plesk (open decision 3). Provisioning is
  ported for Plesk; without Plesk an IIS-native provider has to be written.

## 9. Testing gaps

Covered (see `kb/testing.md`):
- type checks, lint and unit tests;
- a full side-by-side sweep of every GET and write route against the .NET API on synthetic data, which
  was identical apart from expected brand / time-zone / currency differences;
- background jobs.

Not covered, and why:

| Gap | Why |
|---|---|
| Real sends: Brevo email, Meta WhatsApp, Twilio SMS, FCM push, Rotary.org, Plesk | External: needs ROW credentials for each provider |
| Payments | Not built (§2) |
| Excel imports with real Rotary.org export files | No real export files available; exceljs may not open some of them (ROW-CHANGES, Goal Setting) |
| Report / goal-setting SQL on production-shaped data | Only synthetic fixture data so far |
| Load / performance | Not started (master plan WS11) |
| Mobile and club website builds | No Flutter SDK; club-website dependencies not installed on this machine |

## 10. Reference copy is behind (resolved 2026-10-12)

Resolved: the repo is reachable again and was pulled to `cb3e678c` (2026-10-09). The admin portal (both
editions) and the .NET API and sync worker were merged up to it; the NestJS API already was. No newer
RIZones commits exist. The text below is kept for the record.

The RIZones source in `reference/RotaryIndia_Admin_API_Claude` on this machine is at `64a7cd86`
(2026-10-07). STATUS records a sync against the newer `cb3e678` (2026-10-09), done on a machine that could
reach the private repo. As a result, `kb/` diffs against the local copy show 10 goal-setting routes as
"ROW-only" (they are upstream's), and any upstream change after 10-07 will not show in the diffs.

**Why pending.** The private RIZones repo is not visible to the GitHub account on this machine.
**Unblocked by** access to the repo, then a re-clone and `bash kb/rebuild.sh`.

## 11. Excluded on purpose (not pending work, listed so nobody re-opens them)

| Item | Why excluded |
|---|---|
| CashfreeKyc (9), RazorpayRouteAccounts (7) | India-only payment providers; replaced by the Stripe / PayPal work (§2) |
| InteraktWebhook (1) | India WhatsApp provider; ROW uses Meta Cloud API |
| WhatsAppLog `backfill` (1) | Imported RIZones' old Interakt log files; ROW logs its own sends |
| ClubProfileReport (2) | API-key feed for a RIZones partner |
| RotaryThirdParty (1) | Anonymous feed of members' phones and emails for three RIZones districts |
| ShrigodaPartner (1) | RIZones partner integration |
| Rotary.org member-sweep worker (separate `.exe`) | A separate RIZones program, not part of the API; the launch endpoints are ported and run whatever `RotaryOrgSync:WorkerExePath` points at |

## 12. Open decisions that hold work back

Full details are in `row/STATUS.md` §8 and `row/api/ROW-CHANGES.md`.

| # | Decision | Holds back |
|---|---|---|
| 1 | Members API is open without sign-in (as in RIZones): lock it down? | Security before launch |
| 2 | Health / blood-group / spouse data under HIPAA, GDPR, PIPEDA | Privacy (§6), PPH camps |
| 3 | Plesk or IIS-native hosting for club websites | Deployment (§8) |
| 4 | Stripe and/or PayPal, tax, payouts | Payments (§2), admin task C, mobile WS10-06 |
| 5 | TRF fund settings always answer 403 (RIZones checks a claim that never exists) | TRF fund management |
| 6 | ROW Firebase project | Push notifications on mobile |
| 7 | ROW's own Rotary.org API access | Rotary.org sync, officer reports, currency fallback |
| 8 | Keep or drop the Zones 4–8 programmes (citation, zonal awards) | Those modules and their taxonomy mapping |
| 9 | Keep the SMTP port-25 email probe or rely on Brevo bounces | Club-admin assignment emails |
| 10 | Draw PDFs / Office files inline in the OCV Word report | OCV report fidelity (new dependencies) |
| 11 | RIZones quirks kept on purpose (district mass-email credits, reset-email wording, …) | Behaviour fixes |
| 12 | ~~WhatsApp templates for ROW~~ | Closed 2026-10-13: ROW has no WhatsApp (§7) |

## 13. Suggested order

1. **Not blocked, start now:**
   - the .NET edition's India-specific behaviour (§14), following the NestJS designs;
   - mobile WS10-04 / 05 / 08 (formats, phone input, privacy screens) once a machine has the Flutter SDK;
   - deployment files once hosting is decided (IIS or AWS).
2. **Get the decisions** that unlock the most work, in this order:
   - 4 Payments;
   - 3 hosting;
   - 2 privacy;
   - 12 WhatsApp;
   - 6 Firebase;
   - 7 Rotary.org.
3. **Payments rebuild** (API, then admin task C, then mobile WS10-06).
4. **Policy texts** from counsel (Q6) for the privacy, terms, refund and cookie pages.
5. **Real-provider tests, load tests, pilot** (WS11).

## 14. The .NET edition (`row-dotnet/`)

A second ROW edition on RIZones' original stack (ASP.NET Core API and workers) with the same admin and club
website as the NestJS edition. **Done:** rebrand (identity lint 0), brand endpoint and flags with the same
keys as NestJS, member-data guard, privacy module, schema gaps, workers on environment variables.

**Also done (session 3, later):** currency (brand currencies, per-currency buckets), report scope (COG, exempt
districts, zones, excluded names), one-time-code policy with Twilio / Meta senders, UTC timestamps on a UTC server,
and a security fix — the original settings returned the one-time code in the API response (`ReturnDebugOtp`).

**Done (session 4, 2026-10-13): no India-specific behaviour outside payments.** Projects without a currency use
the brand's (SQL fallbacks, year tables, district backfill); amounts in emails, approvals and the Word / PDF reports in
the brand's currency and locale (`Brand.Money`); report, training, club-cache and Zoom schedules in the brand's time
zone (`Brand.TimeZone`); clubs created by the sync and the initializer get the brand's time zone, not Asia/Kolkata;
SMS codes through Twilio (`TwilioOtpSmsService`; the India DLT gateway is removed); Interakt removed (service,
webhook, worker sender, settings); phone numbers resolved per member's country instead of +91; a member saved without
a country is stored with none (as NestJS; the original wrote India). Shared admin: login / forgot-password /
member forms start on the brand's default country, lakh / crore units and the ₹ → $ companion line are gone,
RIZones' ₹ prices removed from the landing and club-website pages.

**What is left, and why.** Payments on Cashfree / Razorpay (decision 4); WhatsApp removal (§7, on hold); the terms
page still names rupees (counsel's policy texts, Q6).
