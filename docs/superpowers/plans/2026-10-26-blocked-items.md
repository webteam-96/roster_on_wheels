# Blocked items: build now, finish when the missing piece arrives (plan, 2026-10-26)

Status: draft for the owner's approval. Owner chose (2026-10-26): Stripe payments, push notifications, Zoom / Google
meetings, My Rotary imports. Each is built behind a feature switch that stays off, tested against local fakes, and
finished with a short "real account" check once the owner provides the account, keys or file.

## 1. Stripe payments (spec 3.4, 3.6) — largest, first

What exists: in-app payments go straight to Razorpay and Cashfree (India): club dues, event payment links, wallet top
ups. `Brand.PaymentProviders = stripe, paypal` and `payments.connect` are set, but no Stripe code exists.

| Step | Work | Check |
|---|---|---|
| 1a | Gateway abstraction (spec 3.4): create charge, refund, dispute lookup, settlement report, onboarding link, account status. Razorpay and Cashfree move behind it unchanged; the tenant's region picks the adapter | existing dues and payment-link e2e still pass |
| 1b | Stripe Connect adapter: each club or district connects its own Stripe account (onboarding link, account status); direct charges on the connected account; platform fee Mode A (application fee) and Mode B (recorded volume, fee added to the next invoice) behind one switch | tests against `stripe-mock` (Stripe's official local mock server) |
| 1c | Stripe webhooks: signature check, idempotency by event id, payment succeeded / failed / refunded / dispute; payments marked once | e2e with signed fake events |
| 1d | Dues (spec 3.6): fee schedule per member type with line items and account categories, billing frequency, proration, late fee; batch invoices with overrides; partial payments, credits, refunds, statement with running balance, tax line; export for QuickBooks, Xero and CSV | e2e: the spec's "done when" (50 members, four lines, tax, part payment, statement, export) on stripe-mock |
| 1e | App and web: pay screens use the gateway; Stripe's hosted checkout (no card data in ROW) | emulator run |

Owner provides at the end: a Stripe test account (platform), then live keys. Not in scope: PayPal (no spec item asks
for it; say if wanted), subscription billing 3.5 (stays on the Razorpay invoice link as the spec says).

## 2. Push notifications

What exists: `Services/Push/FirebasePushService.cs` sends through Firebase Admin when
`App_Data/firebase-admin.json` exists, and does nothing otherwise; the app registers its device token.

| Step | Work | Check |
|---|---|---|
| 2a | List every event that should push (announcements, events, chat messages, volunteer and duty reminders, highlights, grants) and make each one call the push service, honouring the member's push consent (N5) | unit test with a fake push service counting calls |
| 2b | App: open the right screen when a push is tapped (deep links already used by the feed) | widget test |

Owner provides: a Firebase project for ROW (`firebase-admin.json` for the API, `google-services.json` and the iOS
plist for the app). Note: the Android id is still the placeholder `com.SampleApp.row`, and Firebase ties its app file
to that id, so the Firebase app should be created after the id is chosen.

## 3. Zoom and Google meetings (spec 3.17)

What exists: meeting mode (in person / online / hybrid) and pasted links (N8).

| Step | Work | Check |
|---|---|---|
| 3a | Per-club connections: OAuth to the club's own Zoom and Google accounts; tokens encrypted at rest, refreshed; disconnect | e2e with a fake OAuth server |
| 3b | Create a Zoom meeting or a Google Calendar event with a Meet link from the meeting record; store the join link (shown in app, calendar feed, reminders; hidden on public pages unless the meeting is public) | e2e with fake Zoom / Google APIs |
| 3c | After a Zoom meeting: pull the participant report, mark attendance for members matched by email, list the unmatched for the secretary | e2e with a fake participant report |

Owner provides: a Zoom OAuth app and a Google OAuth client (both free to create), then each club connects its own.
QR check-in for hybrid meetings belongs to the Events decision (C8) and is not in this step.

## 4. My Rotary imports (spec 3.2)

What exists: Foundation data import (Super Admin, Excel by district).

| Step | Work | Check |
|---|---|---|
| 4a | Roster snapshot import: upload, column mapping screen (so a changed export format needs no code change), preview with matched / new / missing members, apply | e2e with a sample file built from My Rotary's documented columns |
| 4b | Foundation report import per club or district with the same mapping and preview | same |

Owner provides: one real export of each kind, to confirm the default column mapping. The mapping screen keeps the
rework small if the real file differs.

## Order and size

1 (about 4-5 days of work), then 2 (half a day), 3 (about 2 days), 4 (about 1.5 days). Each step is committed and
pushed when its checks pass, and TRACKER section 6 is updated as items move.

## Questions for the owner

1. Stripe platform fee: Mode A (Kaizen's platform entity outside India, application fee per charge) or Mode B
   (Indian entity, fee invoiced afterwards)? Both are built; this sets the default.
2. PayPal: needed, or Stripe only?
