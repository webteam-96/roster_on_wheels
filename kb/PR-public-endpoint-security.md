# Lock down public payment routes and switch off Cashfree and Razorpay

Branch: `fix/public-endpoint-security`, into `main`. Do not merge or deploy before reading "Deploy steps".

## Why

An audit found public routes that exposed member data and let anyone mark a payment paid:

- Dues, event and district dues reports were open to anyone with a link or a guessed id.
- Member search returned names and partly masked contacts, with no key and no limit.
- `send-otp` would send a code to any address the caller supplied, so a stranger could verify as a member.
- Paying took the member id from the request body.
- The status route could mark another member's row paid using someone else's paid order.
- An unsigned webhook could mark any payment paid.

ROW will take payments through Stripe only, so the Cashfree and Razorpay code inherited from RIZones must not be reachable.

## What changed

**Payment routes**
- Reports moved behind sign-in and a manager check. The old public report routes are gone.
- Member search needs the pay link's key and returns id, name and club only.
- OTPs go only to the email on the member's record. `verify-otp` issues a payer token.
- `pay`, `offline-payment` and event `create-order` need that token and take the member from it, never from the body.
- Status routes only read, and only for the row's own order. They are rate limited.
- "Email me a new link" page for holders of old pay links. It reveals nothing about who is a member, and is limited per IP and per address.

**Cashfree and Razorpay off (code kept, not reachable)**
- Their routes and webhooks answer 404. Nothing turns them back on.
- A payment with no checkout gateway is refused, with no fallback.
- Their background jobs do not start, and their settings pages are hidden.
- The vendor split step is gone from the dues and event forms, and split options from district dues and website pricing.

**Privacy**
- New members are hidden from the public directory by default. Existing members' settings are unchanged.
- The anonymous club calendar names nobody. A signed-in member of that club or SuperAdmin still sees birthdays and anniversaries.
- The governor's email and mobile follow that member's privacy settings. The name stays public.

**Test features and passwords**
- New Staging environment: simulator allowed; API docs and detailed errors off.
- Production ignores the simulator and API docs, even if switched on in settings. `Payments:AllowSimulatedInProduction` and `Swagger:Enabled` are gone.
- OTPs and temporary passwords use `RandomNumberGenerator`.
- Production refuses `Admin@123` for sign-in and as a new password.

**Admin errors**
- A validation error from the API no longer crashes pages. It is fixed once in the shared API client, which covers all 216 places using that pattern.

**Dependencies**
- `MySqlConnector` 2.6.2, `System.Security.Cryptography.Pkcs` 10.0.14, MailKit and MimeKit 4.18.1 in `RotaryOrgSyncWorker`, Next.js security upgrade.
- CORS no longer allows localhost outside Development.

**Fixes from the live test** (details in `row/ROW-CHANGES.md`, 2026-11-05)
- A session opened with a temporary password can only change that password, on web and app.
- Membership dues with a payment cannot be deleted (409).
- `/api/i18n/translate` is open to every signed-in user.
- Security headers on the API and the Next.js apps, and plain http redirects to https.
- Rupee signs on dues, event and project pages use the configured currency.
- Public site phones come from `NEXT_PUBLIC_SITE_PHONES`; empty hides them.

**No schema changes.** The branch adds no tables or columns.

## Changes people will notice

| Who | What changes |
|---|---|
| Members with an old pay link | The name search says the link is out of date. They use "Email me a new link", or the club shares the new link. |
| Admins | Copied pay links now carry a key (`?k=`). Earlier copies no longer work for search. |
| Anyone opening a report link | Must sign in as a manager of that club or district. People who are not managers lose access. |
| Everyone paying online | **Online payment is off in Production until Stripe is built.** Offline payment still works. |
| Admins creating dues or events | No vendor split step. |
| Test host | **Must run as `ASPNETCORE_ENVIRONMENT=Staging`** to use the simulator. It ignores the simulator in Production. |
| Anyone using `Admin@123` in Production | Cannot sign in. They must use forgot-password. |
| New members | Email and mobile hidden from the public directory until they choose otherwise. |
| Club website visitors | Calendar shows no birthdays or anniversaries. |
| Phone app users on an old build | The dues screen copies keyless links until the new app release. Those links reach the out-of-date message. |

## Tested

Clean copy of this branch, on a throwaway copy of the local database. No real money, no real email.

- API and all 3 workers build with 0 errors. Admin `tsc` and `next build` pass. Vitest 145/145.
- `smoke_all`: 51 scripts, 48 pass. `bulletin_speakers`, `message_language` and `localization` fail by default and pass with their settings (background jobs on, fake translation provider). This run predates the last commits, which change only the admin's shared error handling, a seed comment, this file and test scripts.
- Environment rules proven by the same requests in Development, Staging and Production (`kb/tools/dev_only_e2e.py`).
- Old gateway routes all 404, anonymous and as SuperAdmin, and nothing reached a fake gateway (`kb/tools/legacy_gateways_e2e.py`).
- Browser click-through on a production build in Staging: create dues and an event link, a member pays through the simulator, the report shows paid (`kb/tools/browser_pay_flows.py`).

## Not tested

- **The live-test fixes together with this branch, end to end.** With them included: API build 0 errors, admin and website `tsc` pass, Vitest 145/145. `kb/tools/go_live_fixes_e2e.py`, `smoke_all` and the browser click-through were not rerun on this combined code. Run them before merging.
- **The phone app.** The `_payUrl` change and the text changes were not run on a device.
- **A real domain.** CORS, HTTPS and pay links were not checked on the test host or any live host.
- **A real payment.** Stripe is not built, and the simulator is the only gateway tested.
- **Live data.** Nothing ran against `row_production`, and the old-link dry run has only seen an empty local copy.
- **Whether any live account uses `Admin@123`.** Someone with production access needs to check.
- **Every admin page after the shared error fix.** Unit tests plus one page checked in the browser.
- **Vendor split removal on existing campaigns.** New campaigns are tested; editing older ones with splits is not.

## Known gaps, not fixed here

- The legal pages still name Cashfree, and the landing page still shows INR pricing: `privacy-policy`, `terms-and-conditions`, `refunds-and-cancellations`, `admin/contact-us`, `PublicLanding.tsx`. They need new text before go-live.
- Stripe is planned, not built: `kb/stripe-plan.md`.
- The repo is public, and business documents, a staff email and a server IP are already on `main`. Decide whether to make it private.
- `kb/rebuild.sh` was not run, so generated `kb/` files may lag behind.
- The API's HTTPS redirect in `Program.cs` covers Production only, so a Staging test host does not get it from the API.

## Deploy steps

1. **Read first.** Merging does nothing by itself, but deploying this to a live host turns online payment off until Stripe is ready.
2. **Back up** the database. No migration is needed.
3. **Do not change `JwtSettings__Secret`.** It signs logins and pay links, so changing it signs everyone out and breaks every link sent.
4. **Set the environment on each host's own `web.config`**, which deploys do not overwrite:
   - Test host: `ASPNETCORE_ENVIRONMENT=Staging`, `Payments__Provider=simulated`.
   - Live host: `ASPNETCORE_ENVIRONMENT=Production`, and leave `Payments__Provider` unset until Stripe.
   - Both: remove `Payments__AllowSimulatedInProduction` and `Swagger__Enabled` if present.
5. **Rebuild and publish** the API, workers and admin. The admin needs a new build for its API address.
6. **Old pay links:** on a restored copy of production, run `python -I kb/tools/pay_link_backfill_dry_run.py <port> <database>`, then review the list of links and reminders. It changes nothing and sends nothing.
7. **Release the phone app** so it copies keyed links.
8. **Check on the deployed host, in a browser:**
   - The real domain works with CORS, and signs in.
   - A pay link with a key finds a member. One without a key shows the out-of-date message.
   - A report link asks for sign-in and returns to the report.
   - On the test host: the simulator completes a payment and the report shows it paid.
   - `/swagger` answers 404.
   - An old gateway route, such as `/api/cashfree-kyc`, answers 404.
9. **Check `Admin@123`:** with production access, make sure no live account uses it. Anyone who did must use forgot-password.

**Rollback:** redeploy the previous build. There is no schema change to undo. Pay links with a key still open their page, but the previous build ignores the key.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
