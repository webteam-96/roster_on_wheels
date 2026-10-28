# Build Specification v4.1: completion plan (web + app)

**Date:** 2026-10-28. **Source:** `document/ROW Build Specification.docx` sections 3.1 to 3.18 and Appendix B,
cross-checked with OMS pages 6 and 9 (27 Oct 2026).
**Goal (user, 2026-10-28):** finish every build-spec item that can be built now, on admin web, API and the mobile
app together, including the Rotary Showcase Chrome extension.
**Status:** approved 2026-10-28 with the decisions in section 3. S13 dropped (D4).

## 1. Rules for every slice

- Each slice ships API + admin web + app (+ public site where the spec says so) in one go, then its check.
- New behaviour goes behind the existing FeatureGate switch when it is a new module; bug fixes do not.
- Every schema change ships as a reversible migration script in `database/` (up + down).
- Every new endpoint checks sign-in and the club / district scope (no IDOR); reuse the scope guards.
- Checks per slice: `dotnet build` 0 errors, a new or extended `kb/tools/<name>_e2e.py` on `row_prod_copy`, admin
  `tsc` + `vitest` + `check-design`, app `flutter analyze` (0 errors) + `flutter test`.
- After each slice: `bash kb/rebuild.sh`, a short entry in `row/ROW-CHANGES.md`. No commit until the user asks.
- Solo work, no parallel agents (token budget).

## 2. Slices, in order

| # | Spec | What gets built | Web | App | Size |
|---|---|---|---|---|---|
| S1 | bugs | Meeting forms send the district time zone, not local wall-clock; AG on a club dashboard gets the credit balance (or the card is hidden for AG) | yes | check | 0.5 d |
| S2 | 3.11, 3.14 | Cookie consent banner on the district website (lost in the 21 Oct rebuild), configurable per tenant as on the club site | site | n/a | 0.5 d |
| S3 | 3.16 | Rotary year switcher on every year-scoped admin page (verify the list first: only 2 places found by search) and in the app where screens show yearly data | yes | yes | 1.5 d |
| S4 | 3.3 | Event and meeting times in the viewer's time zone with the district zone alongside (admin, app, both public sites) | yes | yes | 1 d |
| S5 | 3.3, 3.16 | DONE 2026-10-28 (plan `2026-10-28-s5-message-language.md`, ROW-CHANGES S5): emails, push text, feed titles, the CMR PDF and the citation export in the member's or tenant's language through ASP.NET Core localization; provider off by default | yes | push text | 2 d |
| S6 | 3.13 | Scheduled speakers shown in the bulletin / newsletter | yes | yes | 0.5 d |
| S7 | 3.14 | Retention rule per tenant: terminated members anonymised automatically after N months, attendance and payment totals kept (worker job + Settings field) | yes | n/a | 1 d |
| S8 | 3.12 | RI member types, join / termination reason codes (editable master list), the six RI officer titles mapped to ROW positions. Stored now; sending to RI waits for Rotary.org access | yes | yes | 1.5 d |
| S9 | 3.14 (tax) | DEFERRED to payments (2026-10-28): its only users are the on-hold payment modules | - | - | - |
| S10 | B.29 | District target setting: DG proposes per club (membership growth, meetings, dues collection, service projects, Foundation giving), president accepts or counters, both see status. No locking (D1) | yes | yes | 2 d |
| S11 | 3.5 | Trial expiry: full lock-out at day 60 until a Super Admin extends or converts, data kept (D2); auto-renew with 60-day notice and dunning reminders (email + in-app). Charging waits for Stripe | yes | yes | 1.5 d |
| S12 | 3.1, 3.2 | DGE booth sign-up: choose plan and band, tenant created in planning, Club Basic for every club, invite PE / SE by email, land on the launchpad. Payment step left as a marked stub until Stripe (decision D3). Per-club onboarding kit: PDF with the two-step RI authorisation instructions, a Showcase install page, nudge emails to president and secretary | yes | n/a | 3 d |
| S14 | 3.12 | Rotary Showcase Chrome extension (ROW brand): sign in to ROW, pick a club project, fill the Showcase form in one click. New folder `row/showcase-extension` (Manifest V3) | ext | n/a | 3 d |

Total: about 21 working days of build, plus manual testing.

## 3. Decisions (user, 2026-10-28)

- **D1 (S10):** the module sheet is final over the spec. Goal Lock is removed there, so no target locking.
- **D2 (S11):** full lock-out when a 60-day trial ends (no sign-in for that tenant's users, data kept) until a Super
  Admin extends or converts it.
- **D3 (S12):** build the booth flow now; the payment step is a stub a Super Admin marks "paid"; Stripe later.
- **D4 (S13 dropped):** the app uses ROW branding only. Per-tenant logo and design are for the club and district
  websites only.

## 4. Not in this round (blocked, recorded so nothing is lost)

- Payments: 3.4 gateway / Stripe Connect, 3.5 invoices and payment links, 3.6 dues, 3.13 donations, the 7 payment
  modules, removing Razorpay / Cashfree code. Needs the Stripe test account and the Stripe meeting.
- Rotary.org: outbound sync, RI certification, reconciliation, secondary vendor, RI view-only registration in
  cut-over, next-year officers pushed to RI. Needs ROW's Rotary.org access.
- Roster snapshot and Foundation report imports: need a real My Rotary export file.
- 3.8 data migration (ClubRunner, DACdb): needs real export files.
- 3.17 Zoom / Google Meet creation and attendance: needs OAuth apps.
- 3.7 Events and 22 QR check-in: decision C8 and the Kaizen Events / QR merge.
- Push sending: needs the ROW Firebase project.
- 3.18 production readiness: needs the hosting decision.
- Production translation provider and the 8-language screen check: needs the provider choice.

## 5. Risks

- S14: the extension fills Rotary Showcase pages. Their field names cannot be checked without an RI account, so the
  form mapping is a best guess kept in one file and will need a fix once someone with access tries it. The spec
  itself warns that RI page changes can break it.
- S5: machine translation of emails and PDFs uses the dev translation provider until the production one is chosen.
- S12: real RI club lists come from the inbound sync that already exists; districts with no synced clubs get no
  Club Basic tenants until the sync runs.
