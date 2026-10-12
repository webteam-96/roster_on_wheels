# ROW — Pending Work and Why

Written 2026-10-12 against `main` @ `eca1661`. Each item below says what is left, **why it is still
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
| 2 | Admin portal conversion | 818 of 882 files identical to RIZones | Not started | — |
| 3 | Club website conversion | 65 of 65 files unchanged from RIZones | Not started | — |
| 4 | Mobile app WS10 items | 6 items | Mixed (see §5) | Firebase project, Payments, final icon |
| 5 | Privacy (WS7) backend | admin UI exists, API has none | Not started + Decision | Legal review of health data (open decision 2) |
| 6 | Scheduled WhatsApp sender | 1 background service | External + Decision | Approved Meta WhatsApp templates (open decision 12) |
| 7 | Deployment on IIS | web.config ×3, guide | Not started + Decision | Plesk vs IIS-native club hosting (open decision 3) |
| 8 | Testing gaps | real sends, Payments, load, reports SQL | External | ROW credentials, a test database with real-shaped data |
| 9 | Reference refresh | local copy 2 days behind | External | Access to the private RIZones repo from this machine |
| 10 | Excluded RIZones items | 8 controllers / features | Excluded | Nothing; replace with ROW equivalents where needed |
| 11 | Open product decisions | 12 | Decision | Product / company owners |

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

**What is left.** Only 57 of 882 files differ from the RIZones `rotary-frontend` (`kb/admin-diff.md`).
STATUS §6 lists three tasks, all still open:
- **A. Strip RIZones public-site content and add a `/cookies` page.** 136 files still name RIZones or
  `rotaryindia.org` (about 495 occurrences), and `src/app/cookies` does not exist.
- **B. Replace ₹ / INR / `en-IN` / IST with the `useFormat` helper (WS3).** 69 files still contain ₹;
  `useFormat` is used in only 5. The "today" date bug is also part of this task.
- **C. Wire the pay pages to `checkout.ts` and hide the Cashfree / Razorpay screens (WS6).**
  39 files still reference Cashfree, Razorpay or Interakt.

**Other admin items found:**
- **Translation (WS2).** `next-intl` and the `en` / `en-XA` message folders are in place, but only 6 of
  773 `.tsx` files use translations. The extraction waves WS2-06 to WS2-12 have not run.
- **`rizonesCount` → `localCount`.** The API renamed this field (ROW-CHANGES, Rotary.org group); the
  admin still reads the old name, so the member-match count will come back empty against the ROW API.
- **`utils/goalSplitPilot.ts`** still has RIZones club and district ids. The API reads them from
  `GoalSetting:SplitPilot:*` instead.
- **6 type errors** in `settings/area-of-focus`, `categories` and `sub-categories`. They were inherited
  unchanged from RIZones and are hidden because `next.config` ignores build errors.

**Why pending.** The build order was API first, so the backend went from 0 to 85% of routes in the last
sessions. The admin got only its foundation (brand provider, i18n wiring, format helper). Tasks A and B
are **not blocked**. Task C waits for Payments (§2).

## 4. Club website (`row/club-website`)

**What is left.** All 65 files are identical to the RIZones club website (`kb/club-website-diff.md`).
STATUS calls it "foundation done", but no ROW change has been made yet. RIZones values still in place:
- `src/components/AdminLoginLink.tsx` links to `https://rizones45678.org/login`.
- `src/lib/support.ts` falls back to `support@rotaryindia.org`.
- `src/lib/tenant.ts` documents tenants as `<club>.rotaryindia.org`.
- 10 files have ₹ / INR / `en-IN` / IST / +91.
- `web.config` uses **iisnode**, which the deployment decision rules out (STATUS §1: HttpPlatformHandler).

**Why pending.** Everything it shows comes from the public-site API endpoints, which were only finished
in session 2 (STATUS 5.2 item 7). Work on the site was waiting for them. It is **no longer blocked**,
apart from the website purchase / renewal pages, which wait for Payments.

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
| WS10-04 currency / number / date formats (₹, lakh / crore, `en_IN`, "today") — 43 files | Not started; the same work as admin task B, best done with the same rules |
| WS10-05 phone input assumes India (+91, 10 digits) | Not started; needs an international phone field and E.164 storage (the API already normalises) |
| WS10-06 payment flows (18 files with Cashfree / Razorpay) | Waits for Payments (§2) |
| WS10-07 push notifications | External: needs a ROW Firebase project (open decision 6); the API side is ported |
| WS10-08 privacy screens | Waits for the privacy backend (§6) |
| WS10-03 translation | Not started |
| WS10-09 store listings | External: needs store accounts and listing content (the ROW icon is now in place) |
| Device builds / `flutter test` | No Android SDK or Flutter on this machine; last run (2026-10-10) was 70 tests passing |

Clean-up, not urgent: 130 of the 200 `ApiConstants` entries are unused RIZones carry-over, and
`role_management_screen.dart` calls `/api/admin/roles`, which neither API has (a RIZones bug).

## 6. Privacy (WS7)

**What is left.** The admin has privacy pages that call `/api/privacy/consent`, `/api/privacy/requests`
(list / approve / reject) and `/api/privacy/members/{id}/export` and `/erase`, plus
`/api/members/me/language`. **None of these exist in the API.** The brand config already declares
`privacy.enabled`, consent and retention settings, but nothing reads them.

**Why pending.**
- These are ROW-only features (GDPR / PIPEDA rights), so there is no RIZones code to port. They must be
  designed and written from scratch, and the API work so far has been porting.
- What has to be collected and kept depends on a legal review (open decision 2). PPH camps store health
  data of non-members, and blood group / spouse details are shown in several screens.

## 7. Scheduled WhatsApp sender

**What is left.** The background service that sends announcements, events, newsletters, projects and
reminders by WhatsApp.

**Why pending.**
- RIZones sends these through Interakt (India) with its own approved templates.
- ROW uses the Meta Cloud API, and Meta only allows **pre-approved templates**. ROW's Meta account has
  none yet.
- Someone has to decide whether to reuse RIZones' template names and parameters or design new ones
  (open decision 12), then get them approved.

Until then, items flagged "send WhatsApp" stay pending. Email and push work.

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

## 10. Reference copy is behind

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
| 12 | WhatsApp templates for ROW | Scheduled WhatsApp sender (§7) |

## 13. Suggested order

1. **Not blocked, start now:**
   - admin tasks A and B;
   - the club-website conversion;
   - mobile WS10-04 / 05 (same format and phone rules as the admin);
   - the `rizonesCount` fix;
   - the IIS `web.config` files.
2. **Get the decisions** that unlock the most work, in this order:
   - 4 Payments;
   - 3 hosting;
   - 2 privacy;
   - 12 WhatsApp;
   - 6 Firebase;
   - 7 Rotary.org.
3. **Payments rebuild** (API, then admin task C, then mobile WS10-06).
4. **Privacy backend** (WS7), then the mobile privacy screens.
5. **Real-provider tests, load tests, pilot** (WS11).
