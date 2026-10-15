# ROW Field and Module Matrix

| | |
|---|---|
| Date | 12 October 2026 |
| Status | Draft for product-owner sign-off |
| Scope | ROW only (`roster_on_wheels/row/admin`). RIZones45678 is not changed. |
| Based on | `ROW-Master-Development-Plan.md` (sections 1.6, WS1-10, Appendix A.3, Appendix C) and a read-only scan of `row/admin/src` |

**Source column:** **Plan** = already in the master plan. **New** = found in the code, missing from the plan. **Decide** = product owner must choose.

---

## Part 1. Module matrix

### 1.1 Club admin (`club-admin-dashboard/nav.ts`, tiles in `clubs/[id]/dashboard`)

| Module (key) | RIZones | ROW A1 | ROW B | Source / note |
|---|---|---|---|---|
| Dashboard | On | On | On | Plan |
| Membership, directory, board, past presidents | On | On | On | Plan |
| Service projects, 7 avenues (`community_service`, etc.) | On | On | On | Plan |
| Club monthly report, attendance | On | On | On | Plan |
| Announcements, events, newsletters, documents | On | On | On | Plan |
| Greetings | On | Off | On | Plan (on from A2) |
| Weblinks, sub-groups | On | On | On | Decide (Q12) |
| Foundation (`trf_contribution`) | On | On? | On | Decide. The Rotary Foundation is global, so probably on |
| Goal setting | On | On? | On | Decide |
| OCV / club report (`ocv_gov`, `reports`) | On | On? | On | Decide |
| Rotary network | On | On? | On | Decide |
| Mass email | On | On? | On | Decide; may depend on email credits |
| Club Dues (`membership_dues`) | Cashfree | Stripe | Stripe + PayPal | Plan. The screen needs payment rework (Part 2) |
| Event payment links | Cashfree | Stripe | Stripe + PayPal | Plan |
| District Dues (`club-dues`) | Razorpay | Off | On | Plan (WS6-05) |
| My Club Website (`website_data`) | On | Off | On | Plan |
| Wallet, Website purchase | Razorpay + GST | Off | Decide at B | Plan (X14) |
| PPH camps | On | Off | Decide at B | Plan (non-members' health data) |
| Citation | On | Off | After Q9 | Plan |

### 1.2 District admin (`district-admin-dashboard/nav.ts`)

| Module | RIZones | ROW A1 | ROW B | Source |
|---|---|---|---|---|
| Overview, Membership, Communication | On | On (pilot District Admins only) | On | Plan |
| Clubs, AG, Club moderator, District committee | On | On | On | Plan |
| District projects / events, club monthly report | On | On | On | Plan |
| Foundation, Goal setting, E-Governance, Quick links | On | On? | On | Decide |
| E-Governance, District Awards tab | On | Hide tab | After Q9 | New. The plan flags the module but not this tab |
| Zonal awards, Citation, PPH camps | On | Off | Decide at B | Plan |
| My District Website | On | Off | On | Plan |
| District Dues, Wallet | Razorpay | Off | B / decide | Plan |
| Online event link | Cashfree | Stripe | Stripe + PayPal | Plan |

### 1.3 Other roles

| Role | ROW | Note |
|---|---|---|
| AG dashboard | On | Plan |
| Club moderator (project approvals) | On | Plan |
| RI Director | Decide | Not mentioned in the plan |
| Zonal dashboard | Decide | Not mentioned in the plan |

### 1.4 SuperAdmin settings (English only, decision X3)

| Setting | ROW | Source |
|---|---|---|
| Cashfree KYC | Hide permanently | Plan ("never on ROW") |
| Razorpay Route Accounts | Hide permanently | Plan |
| Wallet, Email & WhatsApp Credits | Hide during the pilot | Plan (X14) |
| Zonal Awards | Hide | Plan |
| Club Websites, District Websites | Hide until B | Plan |
| Module Master, Designations, Rotary Years, Themes, Categories | Read-only (`masters.editable` off) | Plan (WS5-06) |
| Currency | On, with the ROW currency list | Plan |
| Payments & Dues hub | Keep Event Links and Club Dues; remove Cashfree KYC | Plan |
| New: Stripe connected accounts | Add | Plan (WS6-07) |
| New: District time zone | Add | Plan (WS4-01) |

---

## Part 2. Field matrix

### 2.1 Member form (`components/MemberForm.tsx`, `app/members/new-v2`, `app/members/edit-v2/[id]`)

| Field | RIZones today | ROW suggestion | Source |
|---|---|---|---|
| Blood group (member and family) | Shown | Hide (`member.bloodGroup`) | Plan |
| Family details section | Shown | Hide (`member.familyDetails`) | Plan |
| Mobile | Digits only, defaults to +91 | Country code picker, E.164, no default | Plan (WS6M-02) |
| Country | Defaults to India / id 1; falls back to India if the lookup fails; GMT "05:30" | No default, required; remove the India fallbacks (MemberForm.tsx:79-132, 207, 231-302, 599; same in new-v2 and edit-v2) | Plan + New |
| Residential/Business "PIN Code" | Label PIN Code (MemberForm.tsx:746, 777) | Rename to "Postal / ZIP code", optional | New |
| State | Free text | Label "State / Province / Region", optional | New |
| Primary language | List of Indian languages (`lib/constants.ts:3-14`) | ROW's 8 languages + others | New |
| COG District / Year (edit-v2) | SuperAdmin, COG club | Hide (`CogClubId = 0` on ROW) | Plan (Scope) |
| Name, email, Rotary ID, DOB, anniversary, gender, social links, visibility toggles | Shown | Keep | – |

### 2.2 Club form (`app/clubs/new`, `app/clubs/edit/[id]`)

| Field | RIZones today | ROW suggestion | Source |
|---|---|---|---|
| Club name | Letters only, `/[^a-zA-Z\s]/` | Allow Unicode. Otherwise names like "Club de São Paulo" or "東京" cannot be entered | New, a blocker |
| Country | Free text, defaults to India (new:45, edit:48, 70) | Dropdown, no default | New |
| Pincode | Required (new:98, 196; edit:125, 221) | "Postal code", optional | New |
| State | Required | Optional, generic label | New |
| Map picker | Centred on India (`MapPicker.tsx:19`), Mumbai placeholders | Centre on the district's country | New |
| Time zone | In `types/club.ts:34` but not shown | Inherit from the district (WS4-01) | Plan |
| Meeting times | Assumes IST | District time zone | Plan (WS4) |

### 2.3 District form (`app/districts/new`, `app/districts/edit/[id]`)

| Field | RIZones today | ROW suggestion | Source |
|---|---|---|---|
| Default currency | INR (edit:41, 54; new:39) | No default; ROW currency list | Plan (WS3) |
| Country | Defaults to India (`constants/countries.ts:192`), help text "Defaults to India" (new:197) | No default | New |
| Time zone | Not present | Add | Plan (WS4-01) |

### 2.4 Public directory data collection (`app/public/directory-data-collection`)

| Field | Today | ROW | Source |
|---|---|---|---|
| Masked mobile | Always "+91" (line 375) | Member's own dial code | New |
| Mobile placeholder | Indian number (line 322) | Neutral example | New |
| OTP channel | SMS for India, email for others | ROW OTP policy (email / WhatsApp / SMS) | Plan |
| Pincode | Required (lines 214, 234, 487, 510) | Optional, "Postal code" | New |

### 2.5 Club Dues setup (`app/settings/membership-dues/create`)

| Field | Today | ROW | Source |
|---|---|---|---|
| IFSC code, bank account | Required for offline payments (1025-1034, 550-552) | Hide IFSC. Use one free-text "Bank details for offline payment" field | New |
| KYC vendor split, hard-coded vendors (`kaizen_saraswatbank`, ICICI; lines 87-101) | Shown | Hide. ROW has no split (X9) | Plan + New |
| ₹ in messages (573, 1368), en-IN dates (1514) | Hard-coded | District currency via the existing `lib/currency.ts`, plus locale | Plan (WS3) |
| Fee types, online surcharge %, branding and email fields | Shown | Keep | – |

### 2.6 District Dues setup (`app/settings/club-dues/create`): off at A1, needed at B

| Field | Today | ROW at B | Source |
|---|---|---|---|
| Rate labels "(₹)" (709, 735, 751) | ₹ | District currency | Plan |
| Razorpay Route split rows (642, 790) | Shown | Hide | Plan |
| Bank / IFSC with "HDFC Bank", "HDFC0001234" placeholders (724-726) | Shown | Generic bank details, no IFSC | New |

### 2.7 Payment pages members use (`app/pay/*`)

| Page / field | Today | ROW |
|---|---|---|
| `pay/dues`: offline mode NEFT/IMPS/RTGS, UPI (792-800) | India-only options | Bank transfer, Cash, Cheque, Card, Other (New) |
| `pay/dues`: IFSC shown (629, 787) | Shown | Hide (New) |
| `pay/dues`, `pay/[linkId]`: Cashfree checkout | Cashfree | Stripe (Plan) |
| `pay/[linkId]`: ₹ amounts (556, 564) | ₹ | District currency (Plan) |
| `pay/club-dues` (Razorpay, `currency:"INR"`) | On | Off until B (Plan) |
| `pay/club-website`, `pay/w` (Razorpay + GST) | On | Off (Plan) |

### 2.8 Events

| Field | Today | ROW | Source |
|---|---|---|---|
| Event title (`upcoming-events/v2/add`) | Max 50, English characters only | Allow Unicode | New, a blocker |
| Event payment link Amount, "(INR)" hint (`event-payment-links/v2/edit:959`) | INR | District currency | Plan |
| T-shirt size, food preference | Shown | Keep; translate the masters (WS2-25) | Plan |

### 2.9 Pages hidden entirely on ROW

| Page | Reason |
|---|---|
| `settings/cashfree-kyc` (PAN, IFSC, PAN regex) | India-only; replaced by Stripe connected accounts |
| `settings/razorpay-route-accounts` (Business PAN, GST, IFSC) | India-only |

---

## Part 3. Gaps the master plan does not cover

1. **English-only checks** on club names and event titles. Non-English names cannot be entered. This blocks A2.
2. **"PIN Code" labels and required pincode** on the member, club and directory forms.
3. **India defaults hard-coded in many places**: country id 1, "+91", GMT 05:30, INR, map centred on India.
4. **India-only bank fields**: IFSC, NEFT/IMPS/RTGS, UPI, HDFC placeholders.
5. **Indian language list** in `lib/constants.ts`.

Suggested new flags, following the WS1-10 pattern: `address.postalCodeRequired`, `payments.indianBankFields`, `payments.offlineModes` (list from the brand file).

## Part 4. Decisions needed from the product owner

| # | Question |
|---|---|
| 1 | Q12: which "Decide" modules the pilot districts get (due 23 October) |
| 2 | Do RI Director, Zonal dashboard, Mass email and Rotary network appear on ROW? |
| 3 | Are offline dues payments allowed on ROW, or card only? |
| 4 | Is the postal code required for any country? |

---

## Part 5. Every module, field by field (scan of 13 October 2026)

Paths are relative to `row/admin/src/app/`. Each table lists only the fields that need a ROW change. Fields not listed (dates, images, sort order, status, URLs, etc.) work as they are.

### 5.1 Problems that appear in many modules (fix once, in a shared place)

| # | Problem | Where | ROW fix |
|---|---|---|---|
| C1 | **English-only text check.** `ENGLISH_ONLY_REGEX = /^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/` is copied into each form; keystrokes that fail are silently dropped (no é, ñ, ü, ç, 日本語, 한국어) | Club: announcements, documents, newsletters, upcoming-events. District: announcements, district-events, documents, newsletters, projects, upcoming-events (v1 and v2, add and edit, about 24 files). RI Director: announcements, upcoming-events | Move to one shared helper in `src/lib/`; on ROW allow all Unicode letters (`\p{L}\p{M}`). **Blocks A2.** |
| C2 | **English-only sanitizer** `sanitizeEnglishText` (`src/lib/englishText.ts:11`) strips characters | Club attendance: Event Name, Description | Same fix as C1 |
| C3 | **Currency defaults to INR**; options are INR, LKR, NPR, USD only (`src/lib/currency.ts:5-9`); payload keys are named `projectCostINR`, `amountSanctionedINR`, etc. | All project forms: community, international, vocational, new-generation, public-image, legacy projects, district projects | Default from the district's currency; add the ROW currency list; key names can stay (API contract) but labels must not say INR |
| C4 | **₹ / "Rs." / "(INR)" hard-coded** in labels and columns; `fmtInr`, `fmtInrShort` (Cr/L/K), `IndianRupee` icon | Project forms (CSR amounts in vocational-service :865, :871), project lists (new-generation, public-image), OCV amounts, club-report TRF, foundation-goal "Raised so far (INR)", AG dashboard (clubs, trf, projects, excellence), egovernance, district foundation "Cost (₹)", membership-dues members, public report pages ("Rs.") | Use `formatMoney` from `lib/currency.ts` (already multi-currency); drop Cr/L/K units on ROW (use K/M) |
| C5 | **en-IN date and number formatting** | About 40 list and detail pages | One shared `format.ts` (WS3-01) using the district's locale |
| C6 | **Dates sent without a time zone** (`${date}T${time}:00`); project edit has an IST +5:30 workaround (district projects edit:238) | All forms with date/time | WS4-06 / WS4-07: send the district's offset |
| C7 | **Indian placeholders** | "+91 98765 43210" (rotary-network potential-members, website-data contact_details, my-district-website contact-details); "RC Pune, RC Mumbai" (all project forms, Host Clubs); "ABC Industries Pvt Ltd" (CSR company); "Rtn Rohit Kakar" / "9238331991" (directory config) | Neutral examples, or from translation files |
| C8 | **RIZones domain and contacts hard-coded** | Mass email sender `communication@rizones45678.org` (club mass-emails compose:354, [emailId]:155); website-data menu_list URLs on `rizones45678.org` (v2/page:61); support numbers +91 8424064369 / +91 8928755144 (website-data/page.tsx:108); dues button to `membership.rotaryindia.org` (membership-dues v2/page:227) | From the ROW brand config |
| C9 | **"Export to Excel" downloads CSV** on v2 list pages | attendance, board-of-directors, club-service, all service-project lists, terminated-members, social_media_links | Not ROW-specific; note for testing. CSV must be UTF-8 with BOM so accents open correctly in Excel |
| C10 | **Phone fields have no format check** | Board non-member mobile, district committee mobile, potential-members mobile, contact_details phone, directory config mobiles | Use the E.164 phone input from WS6M-02 |

### 5.2 Club modules (`clubs/[id]/...`)

| Module | Fields needing a ROW change | ROW at A1 | Export |
|---|---|---|---|
| **Announcements** | Title (max 50), Description (max 520): C1. WhatsApp checkbox: pilot-only for one club (:375), hide on ROW until WhatsApp is live (A2) | On | – |
| **Attendance** | Event Name, Description: C2 | On | CSV (C9) |
| **Board of directors** | Non-member Mobile: C10. Designation list: comes from masters (WS2-25 translation) | On | CSV |
| **Citation** | Numeric answers, en-IN grouping | **Off** (Q9) | – |
| **Club monthly report** | Remarks (max 1000): OK. en-IN dates | On | PDF, Word: need ROW logo and fonts (WS2-22) |
| **Club report** | Read-only. TRF shown with ₹ icon though amounts are USD | On | Excel, CSV, Word |
| **Club service** | Title, Description: no English-only check (OK) | On | CSV |
| **Community service** | Currency default INR (:231), Cost and Amount labels (C3), Host Clubs placeholder (C7), **CSR Company block** (Indian CSR law; hide on ROW) | On | CSV |
| **International service** | C3, C7 (edit:711) | On | CSV |
| **Vocational service** | C3, ₹ hard-coded on CSR amounts (:865, :871), CSR block hide | On | CSV |
| **New generation service** | C3, C4 on list (₹/L/Cr, "Cost (INR)" CSV header), **bug:** Rotaractors Involved required (:459) though label says optional (:901) | On | CSV |
| **Public image initiative** | C3, C4 on list (:83-87), C7 (:1018) | On | CSV |
| **Projects (legacy)** | "(₹)" labels (add:893-963) | Hide legacy page (v2 exists) | – |
| **Documents** | Title: C1 | On | – |
| **Newsletters** | Title: C1. WhatsApp checkbox: A2 | On | – |
| **Greetings** | Greeting text (max 700), email subject/message: must be per language later | Off (A2) | – |
| **Mass emails** | Sender email hard-coded (C8) | Decide | – |
| **Membership dues** | Payment Mode NEFT/IMPS/RTGS (members:1190), ₹ (C4), rotaryindia.org button (C8) | On (Stripe) | Server report |
| **OCV / GOV** | Amount shown "Rs." (:575) | Decide | Excel, Word, CSV |
| **Past presidents** | – | On | – |
| **PPH camps** | Whole module | **Off** | Excel |
| **Rotary network: potential members** | Mobile placeholder "+91" (C7, C10) | Decide | – |
| **Rotary network: terminated members** | Termination reasons: fixed list of six (:53-59), needs translation | Decide | CSV |
| **Sub-groups** | – | On | – |
| **TRF** | Amount in USD: OK for ROW | On | – |
| **Weblinks** | – | On | – |
| **Website data** (all sub-pages) | contact_details placeholder (C7), menu URLs and support numbers (C8) | **Off** until B | CSV (social links) |

### 5.3 District modules (`districts/[id]/...` and `district-admin-dashboard/...`)

| Module | Fields needing a ROW change | ROW at A1 | Export |
|---|---|---|---|
| **Announcements** | Title (max 50), Description (max 520): C1 | On | – |
| **District events** | Title, Description (max 1000): C1 (checked on save). **Bug:** edit page has no description length check | On | – |
| **Documents, Newsletters** | Title: C1 | On | – |
| **Upcoming events** | Title, Description: C1 | On | – |
| **Projects** | Title, Description: C1. Project Cost and Amounts "(₹)" (:458, :499-521), CSR block, Host Clubs placeholder (:537), IST workaround (edit:238) | On | – |
| **Foundation goal** | Targets in USD: OK. "Raised so far (INR)" (:525, :571), `fmtInr` (:507) | On | – |
| **Membership goal** | – | On | – |
| **AG, Club moderator** (assignment) | – | On | – |
| **District committee** | Member Mobile: no check (C10). Group-name regex assumes "YYYY-YY" Rotary year (groups/page.tsx:49): OK | On | – |
| **Greetings** | As club greetings | Off (A2) | – |
| **Mass email** | Credits shown en-IN (:367) | Decide | – |
| **Website data / My district website** | contact-details "+91" placeholder (:363) | **Off** until B | – |
| **Weblinks, Sub-groups, Quick links** | – | On | – |
| **Citation** | Whole module | **Off** (Q9) | Excel |
| **Zonal awards** | Whole module | **Off** (Q9) | – |
| **PPH camps** | Whole module | **Off** | Excel |
| **Club monthly report** (view) | en-IN dates | On | PDF, Word |
| **District report** | – | On | Excel |
| **Clubs view** | Shows Pincode (:245, v2:305) | On | – |
| **E-governance** | `fmtInr` (:87), ₹ icon (:675) | On | – |
| **Rotary network** (terminated) | – | Decide | Excel |
| **Goal setting (clubs)** | – | On | Excel |
| **Wallet** | Razorpay | **Off** | – |

### 5.4 Other roles

| Module | Fields needing a ROW change | ROW at A1 | Export |
|---|---|---|---|
| **AG dashboard** | No forms. "TRF (INR)" with Cr/L/K (`fmtInrShort`), "Cost (INR)" | On | – |
| **AG reports** | "Pincode" column (:151) | On | CSV |
| **Club moderator** | Uses multi-currency `formatMoney` (good) | On | – |
| **Zonal dashboard** | Approved Beneficiaries digits only: OK | Decide | – |
| **Zones** (new/edit) | Zone Name placeholder "e.g., South Asia" | SuperAdmin | – |
| **RI Director: announcements, upcoming events** | Title, Description: C1 | Decide | Excel (reports) |
| **RI Director: credits** | Credit purchase form | **Off** (X14) | – |
| **Goal overviews** | Read-only | On | – |
| **Public report pages** (`report/[linkId]`, `report/dues/[duesId]`) | Amounts "Rs." with en-IN | On | CSV, XLSX |

### 5.5 SuperAdmin: directory data collection config (`settings/directory-data-collection/_DirectoryConfigForm.tsx`)

| Field | Today | ROW |
|---|---|---|
| First Contact Name | Placeholder "Rtn Rohit Kakar" (:222) | Neutral placeholder |
| First / Second Contact Mobile | No format check, placeholder "9238331991" (:231) | E.164 phone input |
| DC field checklist | Includes blood group, family, pincode fields | Hide blood group and family when the flags are off |

### 5.6 Bugs found that affect RIZones too (report only; fix in RIZones only if you decide to)

| Bug | Where |
|---|---|
| Rotaractors Involved is required but labelled optional | `clubs/[id]/new-generation-service/v2/add:459` vs `:901` |
| District-events edit has no description length check on save | `districts/[id]/district-events/.../edit` |
| "Export to Excel" buttons download CSV | v2 list pages (C9) |
| Terminated-member "Additional Context" is not saved | `clubs/[id]/rotary-network/terminated-members/v2/add` |
| TRF shown with a ₹ icon while the amount is USD | `clubs/[id]/club-report/v2/view.tsx:135, 825, 986` |

---

## Part 6. Status in `row-dotnet` (checked 13 October 2026 against `origin/main` @ `7593179`)

Checked with `git grep` on the committed code. ✅ done · 🟡 partly done · ❌ still pending.

### 6.1 Backend (`row-dotnet/api`, `row-dotnet/workers`)

| Item | Status | Evidence |
|---|---|---|
| RIZones name, domains, support phones, rotaryindia.org | ✅ | 0 hits for `rizones4567`, `RIZones`, `rotaryindia.org`, `8424064369` |
| Secrets removed from `appsettings*.json` | ✅ | README: scrubbed by `tools/scrub_settings.py` |
| Brand config (`Services/Brand.cs`): ROW name, USD, UTC, feature flags | ✅ | `Brand.cs:16, 49-52, 88-107` |
| Blood group and family details removed from every API response | ✅ | `api/Privacy/MemberDataGuard.cs` |
| Feature flags off: citation, zonal awards, wallet, website purchase, assistant, PPH camps | ✅ | `Brand.cs:102-107` |
| Currency from brand (no INR/NPR/LKR default) | 🟡 | Done for projects, reports, emails; 14 `"INR"` hits remain in 8 files (mostly payments) |
| Time zone from brand; timestamps with "Z" | 🟡 | Done; 7 `Asia/Kolkata` / IST hits remain in 5 files |
| OTP and SMS: Twilio, E.164 phones; DLT and Interakt removed | ✅ | `Services/RowMessaging.cs`, `RowPhone.ResolveE164Async`; 4 Interakt mentions left |
| Privacy: consent, export, erasure, retention | ✅ | `api/Privacy/`; 26/26 end-to-end checks pass (per README) |
| Database from empty: `schema.sql`, `schema-drift.sql`, `seed-master.sql` | ✅ | `row-dotnet/database/` |
| **Payments: Stripe / PayPal** | ❌ | Still Cashfree (163 hits) and Razorpay (304 hits); GST 33 hits. Waiting on "decision 4" |
| WhatsApp removal | 🟡 | On hold (`row/PENDING-WORK.md` §7); nothing is sent without Meta credentials |

### 6.2 Admin frontend (`row-dotnet/admin`)

| Matrix item | Status | Evidence / what is left |
|---|---|---|
| Blood group hidden (member + family) | ✅ | `useFeature("member.bloodGroup")` in 21 places, e.g. `MemberForm.tsx:202, 647, 879` |
| Family details hidden | ✅ | `useFeature("member.familyDetails")` in 11 places |
| Member form: country / +91 / India defaults | ✅ | `MemberForm.tsx:81-125` now blank, `fkPrimaryCountryId: 0`; no `"05:30"` fallback |
| Brand context, logo, product name | ✅ | `useBrand` / `BrandContext` in 40 files |
| RIZones domains and support numbers in pages (C8) | ✅ | 0 hits |
| Wallet hidden from menus | ✅ | `nav.ts` `feature: "modules.wallet"` (club and district) |
| PPH camps, zonal awards, citation, website purchase hidden | 🟡 | Flags exist (`lib/brand.ts:83-88`) but the pages are still there; the dashboard tiles come from the API module master. **Verify in the running app** |
| Cashfree KYC, Razorpay Route Accounts pages hidden | ❌ | `settings/cashfree-kyc`, `settings/razorpay-route-accounts` still present, no flag |
| **C1 English-only regex** | ❌ | Unchanged: `ENGLISH_ONLY_REGEX` still in **44 files**, still drops non-English keystrokes. **Blocks A2** |
| **C2 `sanitizeEnglishText`** | ❌ | Rewritten for pasted text, but still removes accented letters (é, ñ, ü) and non-Latin scripts |
| **Club name `/[^a-zA-Z\s]/`** | ❌ | Still at `clubs/new/page.tsx:166` (and edit) |
| C3 currency default "INR" in project forms | ✅ | 0 hits for `currency = "INR"` |
| C4 `fmtInr` / `IndianRupee` icon | ❌ | 128 hits in 52 files |
| C4 `₹`, `Rs.`, `(INR)` labels | ❌ | 21 / 14 / 14 hits |
| C5 `en-IN` formatting | 🟡 | Down to 6 hits in 3 files (`useFormat` / `format.ts` added) |
| C6 IST / +05:30 in the frontend | 🟡 | 6 hits in 3 files |
| C7 placeholders: "+91 98765" / "RC Pune" / "Pvt Ltd" / "Rohit Kakar" | ❌ | 9 / 23 / 23 / 1 hits |
| CSR Company block (Indian CSR) | ❌ | Still shown, 36 files |
| "PIN Code" / "Pincode" labels | ❌ | 16 hits in 9 files |
| Club and district country default "India" | ❌ | `clubs/new:45`, `clubs/edit/[id]:48`, `districts/new:198`, `constants/countries.ts:192` |
| IFSC, NEFT/IMPS/RTGS/UPI | ❌ | 47 and 39 hits (with payments) |
| Pay pages: Stripe checkout | ❌ | `pay/dues`, `pay/[linkId]` still `cashfree.checkout`; `pay/club-dues`, `pay/club-website`, `pay/w` still Razorpay. `lib/checkout.ts` and `components/payments/` exist in `row/admin` but are not wired |
| Indian language list (`lib/constants.ts`) | ❌ | Still Hindi, Marathi, Gujarati… |
| Translation framework (next-intl) | 🟡 | Started: `useTranslations` in 8 files, `messages/` folder |
| Bugs in 5.6 (Rotaractors required, etc.) | ❌ | Not checked individually; assumed unchanged |

### 6.3 Summary

- **Done (mostly backend):** rebrand, secrets, brand config, flags, member data guard, privacy, OTP/SMS, empty database scripts, member form defaults.
- **Biggest open items:**
  1. Payments: Stripe / PayPal, backend and pay pages (needed for the A1 pilot).
  2. English-only checks: 44 files plus club name, needed for A2.
  3. ₹ / INR display: `fmtInr` in 52 files.
  4. India placeholders, PIN code labels, CSR block, country default "India", Indian language list.
  5. Hide Cashfree KYC and Razorpay Route pages; verify PPH / zonal awards / citation are hidden.
- **Note:** `row-dotnet/admin` is a copy of `row/admin` (README: "change them in `../row` and copy them here"). Fix the frontend once, then copy it to both.

## Not yet scanned

- `club-website/` (public club sites; off until B)
- RI Director shared form components (`RiDocumentForm`, `RiNewsletterForm`, `RiWeblinkForm`, `RiSubGroupForm`, `RiMassEmailCompose`)
- The backend API (not yet copied into this repo)
