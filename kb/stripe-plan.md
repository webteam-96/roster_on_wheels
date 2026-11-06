# Stripe plan for ROW

Status: plan only, nothing built. Based on build spec 3.4 and audit rows 16 to 20, read against the code at `0060dba`.
ROW takes payments through Stripe only. The simulator stays for testing, in Development only. Cashfree and Razorpay are
switched off (`FeatureGate` `legacy_gateways`).

## What exists today

| Piece | Where | State |
|---|---|---|
| Hosted checkout seam | `row/api/Services/Payments/PaymentCheckoutService.cs:25` `IPaymentGateway` | One method, `CreateHostedPageAsync`. All five payment flows already use it. |
| Marking a payment paid | `PaymentCheckoutService.cs:196` `SettleAsync` | Works per flow and is idempotent. A Stripe webhook can call it directly. |
| Checkout sessions | table `payment_checkout_sessions` | Token, gateway, flow, flow ref, order id, amount, currency, status, `gateway_payment_id`. |
| Gateway selection | `PaymentCheckoutService.cs` `Payments:Provider` | One gateway per install. No region selection, which Stripe-only no longer needs. |
| Tenant fee fields | `row/api/Services/DatabaseInitializer.cs:4027-4029`, `row/api/Controllers/TenantsController.cs:96`, `row/admin/src/app/settings/tenants/page.tsx:195-201` | `platform_fee_pct`, `platform_fee_fixed`, `fee_waiver_until` are stored and editable. Nothing charges them. |
| Connect a payment account | `row/api/Controllers/PaymentAccountsController.cs`, `row/admin/src/components/payments/PaymentAccountsPanel.tsx:33` | Panel asks for a club's Stripe `secretKey` and `webhookSecret`. **This is not Connect and must be replaced**: see Decisions. |
| Pay pages, app screen | `row/admin/src/lib/checkout.ts`, `row/mobile/lib/presentation/widgets/common/razorpay_checkout.dart:50` `openHostedCheckout` | Redirect to a hosted page and read the result. Reusable as is. |
| Payer identity | `PublicMembershipDuesController.cs` `TryPayer`, `EventPayerToken.cs` | Member comes from the token, never the request body. Already enforced. |
| Brand settings | `row/api/Services/Brand.cs:59`, `row/admin/src/lib/brand.ts:132` | Lists `stripe` and `paypal`. Remove `paypal` if Stripe-only is final. |
| Stripe SDK | `row/api/RotaryApi.csproj` | Not installed. |
| Refunds, disputes, payouts | none on the seam | Not started. The word "refund" appears only in unrelated services. |
| Comments promising Stripe | `row/api/Program.cs:342`, `row/api/Services/TenantRenewalService.cs:14`, `row/api/Services/CommsService.cs:452`, `row/api/Controllers/BoothSignupController.cs:13` | Each marks a stub to finish later. |
| Hard-coded currency | `order_currency = "INR"` in the off Cashfree paths; `Brand.DefaultCurrency` in the seam | The seam needs the tenant's currency, not one default. |

## The work

### 1. Gateway abstraction (spec 3.4 bullet 1, audit row 16)

Grow `IPaymentGateway` from one method to: create checkout, refund, dispute lookup, settlement report, onboarding link and
account status. The simulator implements all of them, so every flow stays testable without Stripe. No module calls Stripe
directly.

Done when: the existing `payments_simulated` suite passes through the larger interface.

### 2. Connect Express onboarding (spec bullet 4, audit row 17)

- New `stripe_accounts` table: owner type and id, Stripe account id, country, currency, `charges_enabled`, `payouts_enabled`,
  `details_submitted`. Migration ships with a way back.
- Super Admin or a district or club admin clicks Connect. The API creates an Express account and an Account Link, and the
  browser goes to Stripe's hosted form.
- `account.updated` webhook keeps status current. The return page only re-reads status, it never trusts the redirect.
- A tenant without `charges_enabled` cannot start an online payment: the same plain refusal as today.
- Replace the key-entry form in `PaymentAccountsPanel` with Connect and status. ROW stores no club keys.

Done when: a US test club onboards and shows as able to take payments.

### 3. Connect OAuth for existing Stripe accounts (spec bullet 4, audit row 17)

The spec asks for this and your list did not name it. Clubs keep their own dashboard, bank and history. Comes after Express.
Check with Stripe that OAuth is still offered for new platforms before building it.

Done when: an AU test club connects an existing account.

### 4. Checkout (spec bullets 1 and 2, audit rows 16 and 17)

- `StripeGateway : IPaymentGateway` creates a Checkout Session **on the connected account** (`Stripe-Account` header), which
  is the spec's direct charge, so funds settle with the club.
- Amount and currency come from the server's payment row, never the browser.
- Metadata: flow, flow ref, session token. Member identity stays in ROW's row, put there from the payer token.
- `Idempotency-Key` on creation, built from the session token. Timeout on every Stripe call.
- No card data touches ROW: Stripe hosts the page.
- Register in `Program.cs:342`, set `Payments__Provider=stripe`. The pay pages and app already follow the hosted redirect.

Done when: a member pays a test invoice in the app and the row is paid only after step 5.

### 5. Webhook (spec bullet 1, audit rows 17 and 20)

New route `POST /api/public/payments/stripe/webhook`. Never trust the payload, the same rule as the Cashfree fix:

1. **Signature:** verify `Stripe-Signature` with the SDK's `EventUtility.ConstructEvent` over the raw body. Refuse with 400.
   Enforced from day one, no log-only mode. The endpoint is a Connect endpoint, so events carry the connected account id.
2. **Confirm with the API:** on `checkout.session.completed`, retrieve the Session from Stripe on that connected account and
   require `payment_status=paid`.
3. **Match the row:** session token from metadata must find our session, with the same order id, connected account, amount
   and currency. Otherwise log and change nothing.
4. **Idempotent:** record the Stripe event id and ignore repeats. `SettleAsync` is already safe to repeat.
5. **Member from token:** the webhook names no member. The member on the row came from the verified payer token at checkout.
6. **Retries:** Stripe unreachable answers 5xx so Stripe sends it again. No relay: Stripe calls ROW directly.

Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `async_payment_failed`, `account.updated`,
`charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid`.

Done when: a forged event gets 400 and the row stays unpaid; a signed event whose Session is unpaid changes nothing; a
genuine one settles once, even when replayed.

### 6. Platform fee, modes A and B (spec bullets 3, 5 and 6, audit row 18)

One switch, `Payments:Stripe:FeeMode`, read with the tenant's `platform_fee_pct`, `platform_fee_fixed` and `fee_waiver_until`.
Defaults 1.5% plus $0.30, waived for the charter cohort until 30 June 2028.

| | Mode A (platform entity outside India) | Mode B (Indian platform entity) |
|---|---|---|
| At checkout | `application_fee_amount` on the charge | No application fee |
| Fee goes to | Kaizen's platform balance | Accrued per club from Stripe's reports |
| Collected by | Stripe, automatically | A line on the club's next ROW invoice, with a statement |
| Reports show | Stripe fee and platform fee | Stripe fee, and platform fee as accrued |
| $100 test (spec) | Club nets $95.00: $3.20 Stripe, $1.80 platform | Club nets $96.80, $1.80 accrued |

New table for per-payment fees: gross, Stripe fee, platform fee, net, from the balance transaction, so reports read stored
numbers. Fee is computed in the smallest currency unit.

Done when: both modes reproduce the spec's $100 figures in test mode.

### 7. Fee recovery (spec bullet 7, audit row 19)

Per tenant: uniform booking fee (percent plus fixed) shown in the total before checkout, default on for event tickets and off
for dues and donations; surcharge at cost on credit cards only where the country allows it (US outside restricting states,
Canada outside Quebec; disabled for EU, UK and AU); or absorb. Rules live in data, so they can change without a release.

Today's `OnlineSurchargePercent` on dues is the inherited version and must be folded into this. Get the country rules checked
by someone qualified before go-live: that is legal text and policy, not code.

### 8. Refunds and partial refunds (spec bullet 8, audit row 20)

- Admin action on a payment, by the same people who manage that campaign. Full or partial, with a reason.
- `Refund.Create` on the connected account, with an idempotency key. In Mode A, `refund_application_fee` decides whether the
  platform fee comes back: **a decision for you**, see below.
- `charge.refunded` updates the row. Partial refunds keep a running total and cannot exceed the charge.
- Dues show a balance again after a refund. Event seats and wallet credits need a rule per flow.

### 9. Disputes and settlement reports (spec bullets 6 and 8, audit row 20)

- `charge.dispute.*` writes to a new `stripe_disputes` table. Admins see status, amount and evidence deadline, with a link to
  Stripe. Express accounts may have limited dispute tools, so confirm who answers disputes.
- Payout report per tenant, from `balance_transactions` and `payout.paid`, itemised as in step 6. Replaces
  the dues and event settlement reports, which read Cashfree-shaped rows.

### 10. Clean-up after it works

Delete the Cashfree and Razorpay code, `CashfreeWebhook.cs`, `razorpay_flutter` and the Razorpay checkout in the app, the
hidden split UI, and rewrite `row/admin/src/app/privacy-policy`, `terms-and-conditions`, `refunds-and-cancellations`,
`admin/contact-us` and `components/public/PublicLanding.tsx`, which still name Cashfree and INR pricing.

## Map to the spec and audit

| Plan step | Spec 3.4 | Audit row | Today |
|---|---|---|---|
| 1 Abstraction | Gateway abstraction | 16 PARTIAL | Hosted page only |
| 2 Express | Express onboarding | 17 MISSING | Comments only |
| 3 OAuth | OAuth connection | 17 MISSING | Comments only |
| 4 Checkout | Direct charges, in-app payments | 16, 17 | Simulator only |
| 5 Webhook | Connected account settlement | 17, 20 | None |
| 6 Fee modes | Modes A/B, fee per tenant, itemisation | 18 MISSING | Fields exist |
| 7 Fee recovery | Fee recovery settings | 19 CAN'T VERIFY: now read, not built | Only `OnlineSurchargePercent` |
| 8 Refunds | Refunds, partial refunds | 20 MISSING | None |
| 9 Disputes, reports | Dispute visibility, settlement reports | 20 MISSING | None |
| All | Test mode first | 16 to 20 | Needs the account below |

## Where this differs from the spec

- **Spec:** Razorpay and Cashfree adapters for India, selected by tenant region. **You:** Stripe only. Plan follows you, so no
  region selection. An Indian tenant cannot be served unless Stripe supports it.
- **Spec Mode B and 3.5:** the fee and the annual invoice go through a **Razorpay** invoice or payment link. With Razorpay off,
  Mode B and subscription billing need another way to invoice. Unresolved: see Decisions.
- **Spec 3.5 booth flow** waits on this too: `BoothSignupController.cs:13` has a Super Admin mark payment by hand.

## Needed from outside

1. A **Stripe platform account in test mode**, with Connect enabled: secret key, publishable key and a Connect webhook secret.
2. Later, live approval. Stripe decides which Kaizen entity it accepts, and that settles Mode A or B.
3. Test connected accounts: one US (Express) and one AU (OAuth), from the spec's done-when.
4. Someone to confirm the surcharge country rules and write the legal pages. Not code.

## Decisions needed

1. **Which entity owns the platform account?** This picks Mode A or B. Build both, as the spec says, but test mode needs one
   first. Recommendation: start with A.
2. **How does Mode B invoice, and how is the annual subscription (3.5) collected, without Razorpay?** Recommendation: Stripe
   Invoicing on the platform account, if the entity can use it.
3. **Express with direct charges:** the spec asks for direct charges, while Stripe tends to steer Express platforms toward
   destination charges. It affects who carries refunds, disputes and negative balances. Confirm with Stripe before step 4.
4. **Does a refund return the platform fee?** Recommendation: yes on a full refund, no on a partial one.
5. **PayPal:** `Brand.cs:59` still lists it. Recommendation: remove it, given Stripe-only.
6. **Vendor splits:** retired from the forms. Confirm no club needs money split between accounts. Stripe's direct charge pays
   one account.

## Order and rough size

Steps 1, 2, 4 and 5 give a working payment in test mode, and they come first. Then 6 and 8, then 9, 7 and 3, then 10. Everything
after step 1 waits for the test account. Estimate properly once decisions 1 and 3 are answered, since they change steps 4 and 6.
