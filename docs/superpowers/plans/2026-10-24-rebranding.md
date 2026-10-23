# Rebranding: admin console, mobile app and API documents (2026-10-24, lane i)

Brand source: `row/website` (the product owner's site). Public club and district sites are on hold and are not
touched. Payments stay on hold: only how amounts are displayed changes, never the currency a gateway charges.

## Brand (derived from row/website)

- Colours (`app/globals.css`, `design.md` §1): cream `#F7F9FC`, cream-2 `#EDF4FB`, ink `#1B2C42`, ink-2 `#2A3F5C`,
  ink-soft `#64748B`, azure `#17458F` (Rotary Royal Blue, large fields and primary actions), mint `#0067C8`,
  mint-ink `#0B3F7A`, marigold `#F7A81B` (rules, icons, highlights only), coral `#FFC65C`, lilac `#A9C6EA`,
  sky `#CFE2F6`, stone `#D5DEE8`, line `rgba(27,44,66,.12)`. Off-white surface `#FCFDFE` (no pure white).
- Type: Bricolage Grotesque (display), Figtree (body).
- Logo: `public/brand/row-logo.png` (handshake + ROSTER ON WHEELS), the plated badge on dark fields;
  favicon `app/icon.png` / `apple-icon.png` (handshake + ROW on `#1E1C20`). Tagline "Connecting Members Globally".
- Voice: "Roster On Wheels (ROW)", "made for Rotarians by Rotarians", plain, warm, no emoji, no em dashes in UI.
  The site credits Kaizen Infotech Solutions as ROW's developer (footer, About), so a vendor credit is allowed.

## What exists (found 2026-10-24)

- Admin already carries the Fellowship tokens (`globals.css`, `tailwind.config.ts` remap), the fonts, the ROW
  logos (`public/brand/*`), `BrandLogo` on login and header, ROW logos in the sidebars. Gaps: the favicon is the
  hands-only mark (website: handshake + ROW), the `(site)` group favicon is Rotary International's wheel, unused
  Geist font files (banned typeface) sit in `src/app/fonts`, the `IndianRupee` icon draws a rupee glyph on ~45
  screens, a few "Rs." / "(INR)" labels, India copy on `/admin/about-us` and the Rotary.org sync page.
- Mobile already carries the Fellowship `AppColors`, Figtree/Bricolage, ROW logos on splash/login/home, launcher
  label "ROW". Gaps: the launcher icon is the Rotary wheel placeholder on pure white, the native launch screens are
  white (the Flutter splash is azure), the unused Kaizen logo ships in the bundle, "Rs." / "INR" labels, rupee
  icons, INR fallbacks (one breaks the project form's currency dropdown), India form hints.
- API emails and documents still use the original platform's palette (`#1a365d`, `#3182ce`, Chakra/Tailwind
  greys), emoji in the welcome email, "Rotary Club Admin Portal" wording and ₹ in dues/event emails and the
  dues receipt. PDF builders (dues receipt, club monthly report) and the project share card use the old palette.
- "RIZones" survives only in comments (3 API files + `run-local.ps1`, 3 worker files).

## Tasks

1. Admin favicon + type: copy the website `icon.png` / `apple-icon.png` into `admin/src/app` and the `(site)` group;
   delete the unused Geist font files. Verify: tsc, check-design.
2. Admin rupee glyph: `icons.ts` maps the `IndianRupee` name to Phosphor `Money` (icons.ts is designed so a glyph
   swap never touches a page). Verify: tsc, icons test.
3. Admin money and copy: "Rs." to `formatMoney` (dues and payment-link reports, OCV dues documents); drop "(INR)"
   from labels whose values already print the brand currency (AG dashboard, CSV header, foundation goal), the
   payment link amount hint shows the brand currency; settings/currency text; `/admin/about-us` India copy;
   Rotary.org sync badges "India" to "ROW". Verify: tsc, vitest, check-design.
4. API emails: one hex map from the original palette to the Fellowship tokens (status reds/greens/ambers kept,
   Excel `XLColor` lines and Excel builders left alone), font stack Figtree first, no emoji in email copy,
   "Rotary Club Admin Portal" to the brand name, ₹ to `Brand.Money`. Verify: dotnet build, e2e.
5. API documents: PDF builders and the share card take the same tokens; the share-card cache stamp moves to v2 so
   cached old-palette cards regenerate. Verify: dotnet build, one share card rendered by hand.
6. Mobile: launcher icon from the website favicon (1024 master + adaptive foreground, background `#1E1C20`)
   regenerated with the configured `flutter_launcher_icons`; native launch screens azure; Kaizen logo asset
   deleted; "Rs."/"INR" to `formatMoney`; rupee icons to `Icons.payments_rounded`; INR fallbacks to the brand
   currency; India form hints neutral; README line. Verify: flutter analyze, flutter test.
7. Comments: "RIZones" to "the original platform"; `+91` code-comment examples to the UK fictional range.
8. e2e `kb/tools/rebranding_e2e.py`: brand endpoint, the dues test reminder and receipt rendered by the API
   (logged body has the brand money format, the azure button, no ₹, no old palette), and the public share card of
   a temporary project (azure pixels, none of the old navy); rows and the cached card cleaned up.

## Out of scope (kept, with reason)

Payment gateway code and gateway-only screens (Cashfree, Razorpay, wallet and website-purchase GST pricing:
India-only providers, flags off, rebuilt on Stripe), legal texts (counsel, Q6), the off public site (`(site)`,
`PublicLanding`), stored-data defaults (`Country = "India"` DTO and column defaults change stored rows, not
display), Excel export colours, worker ops-report emails, app ids (owner decision).

## Done (2026-10-24)

### Brand applied

- Admin: favicon and Apple icon are the website's (`src/app/icon.png`, `apple-icon.png`, and the `(site)` group icon,
  which was Rotary International's wheel). Unused Geist font files deleted (banned typeface). Tokens, Tailwind remap,
  fonts, logos, login card and sidebars already matched `row/website/app/globals.css` (checked hex for hex): no change.
  `components/icons.ts` maps the `IndianRupee` name to Phosphor `Money`, so about 45 screens lose the rupee glyph
  without a page edit.
- API emails: one palette map (scratch `email_palette.py`, 463 replacements in 24 files): `#1a365d`/`#3182ce`
  header bands, headings and buttons to azure `#17458F`, Chakra/Tailwind greys to the ink-tinted scale, pure white
  to `#FCFDFE`; status reds, greens and ambers unchanged; Excel `XLColor` lines, the Excel HTML builder and the
  Cashfree/Razorpay files skipped. Font stacks start with Figtree (falls back to Arial). Emoji removed from email
  copy (welcome email, credit expiry, district performance report). "Rotary Club Admin Portal" and the
  "Rotary Club - ..." subjects use `Brand.ProductName` (the subject classifier keywords are kept). ₹ amounts in the
  dues, event and receipt emails and the dues receipt text use `Brand.Money` (display only; gateway orders untouched).
- API documents: dues receipt PDF, club monthly report PDF and the project share card take the tokens. The share
  card cache stamp moved to `v2` so cards cached in the old colours are drawn again.
- Mobile: launcher icon is the ROW favicon (handshake + ROW on `#1E1C20`): a 1024 master and an adaptive foreground
  (mark inside the safe circle) built from `row/website/public/brand/row-logo-extended.png`, regenerated with the
  configured `flutter_launcher_icons` (Android mipmaps, adaptive foregrounds, `colors.xml`; iOS AppIcon set). Native
  launch screens are azure like the Flutter splash (Android `launch_background` x2, iOS `LaunchScreen.storyboard`).
  The app's own monthly report PDF header and borders take azure and stone. `Kaizen-Logo.png` (unused, but shipped in
  the bundle) deleted. Launcher label stays "ROW".

### Leftovers removed

- "RIZones": API comments (MembersController, MobileAuthService, run-local.ps1), worker comments (Program,
  CountryScope, WorldClubImportWorker), mobile README and .gitignore: "the original platform".
- "Rs.": admin dues report, payment-link report, OCV dues documents (v1 and v2) and the app's OCV screen use the
  money helpers (`formatMoney`).
- INR: "(INR)" dropped from AG dashboard labels (values already print the brand currency), the projects CSV header
  and the foundation-goal form (its info text said raised amounts are INR; the API stores TRF in USD). The payment-
  link amount hint shows the brand currency symbol. App: AG TRF chips, offline dues amounts (`formatMoney`), six
  model fallbacks (`Brand.current.defaultCurrency`), the project form's default currency (INR was not in the brand's
  currency list, so the dropdown had no matching item), the club foundation goal save (keeps the goal's currency
  as the web form does; no INR default).
- Rupee icons: admin glyph swap (above); app `Icons.currency_rupee*` x6 to `Icons.payments*`.
- `+91`: phone code-comment examples use the UK drama range `+44 7700 900xxx`.
- India copy: `/admin/about-us` (intro, who we are, INR, members, compliance) in the website's voice; Rotary.org
  sync badges "India" to "ROW"; settings currency description; app form hints (country, time zone).
- Stale INR / x84 comments in API, admin and app where the code already uses USD or the brand currency.

### Grep report (row/admin, api, mobile, workers, database; public sites excluded)

| Pattern | Before | After |
|---|---|---|
| RIZones | 8 lines / 8 files | 0 |
| INR | 117 / 59 | 60 / 35 |
| ₹ or "rupee" | 173 / 83 | 138 / 70 (99 lines are the `IndianRupee` identifier in 48 admin files; it draws a banknote) |
| Rs. | 14 / 5 | 0 |
| +91 | 12 / 8 | 8 / 6 |
| Kaizen | 28 / 18 | 28 / 18 |

Remaining hits and why they stay:
- Payments on hold (gateway code and gateway-only screens, rebuilt on Stripe): Razorpay/Cashfree order currency
  (ClubDuesService, EventPaymentLinkService, MembershipDuesService, WebsiteBillingService, WalletService,
  CashfreeGatewayProxy, RazorpayRouteService `+91` strip), wallet and website-order DTO/table defaults
  (WalletDtos, WebsiteBillingDtos, DatabaseInitializer + schema.sql `DEFAULT 'INR'`), Cashfree reconciliation logs,
  wallet minimum top-up message, admin Razorpay checkout (`club-admin-dashboard/club-dues`, `pay/club-dues`),
  Cashfree vendor-split labels (`settings/event-payment-links/create`), wallet GST pricing labels, app
  wallet/website-billing models and `razorpay_checkout.dart`, dues "rupee formula" comments.
- Legal texts (counsel, Q6): `refunds-and-cancellations`, `terms-and-conditions`.
- Off public site and the unreachable landing: `PublicLanding`, `PublicFooter`, the comment in `admin/page.tsx`.
- History comments ("the original platform: ..."): CurrencyHelper, CurrencyRateService, ClubWebsitePublicDataV2,
  PublicProjectStats, the "was 84 for a legacy INR display" notes, ProjectsHub, statStrip check, excellence page,
  DatabaseInitializer (`+91-9999999999` seed account), RowMessaging.
- Locale support and its tests: `lib/format.ts` en-IN examples, `format.test.ts`, `textInput`, app
  `currency_symbol.dart`, `money_format.dart` lakh/crore legend (en-IN only), `money_format_test.dart`.
- Data, legitimate India: country dial-code list (DatabaseInitializer, `seed-master.sql`), validators.dart doc
  example, Rotary.org phone-format examples (ClubMemberSweepWorker), the RI sync rule that skips India.
- Other comments: app dues and mock-data notes (`district_club_dues_screen`, `club_admin_dashboard_models` dues,
  `district_analytics_service` mock, `ag_format`), admin `addToOrg.ts` (the Rotary.org extension's input).
- Kaizen (none user-facing; `row/website` credits Kaizen Infotech as ROW's developer): iOS bundle id
  `com.kaizen.row` x6 + README (owner decision, WS10-09), Task Scheduler `<Author>` x14 (ops metadata),
  `seed-monrovia-demo.sql` x6 (the demo SuperAdmin), `run-local.ps1` SuperAdmin default (local dev script).

### Not changed (reported)

- `Country = "India"` defaults in DTOs (ClubDtos, DistrictDtos, MemberAddressDto, FamilyMemberDto, MemberDetailDto),
  `Models/Club.cs`, `DistrictService` and the `club_master.Country DEFAULT 'India'` column: stored and returned data,
  not display; changing them changes rows.
- Offline payment modes NEFT / UPI / IMPS / RTGS (payments), em dashes in API email copy, Excel colours (API and
  admin exports share `#1F4E79`), worker ops-report email colours.

### Verification

- `dotnet build` (api): 0 errors; 113 distinct warnings, the same set as a HEAD build (no new). RotaryOrgSyncWorker:
  0 errors, same warnings as HEAD.
- `kb/tools/rebranding_e2e.py`: 19 PASS. `kb/tools/scope_read_guard_e2e.py`: ALL PASS. API on 5109 stopped.
- Admin: `tsc --noEmit` 0; `vitest run` 18 files, 103 tests pass; `check-design.mjs` all 0.
- App: `flutter analyze` 0 errors, 448 issues, identical per file and rule to a HEAD copy; `flutter test` 43 pass
  (new: brand-currency fallback in `money_format_test.dart`).
