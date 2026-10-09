# ROW changes to consider later

The NestJS backend is a faithful port of the RIZones API. These are places
where ROW will probably want different behaviour. They are **not** made yet
unless marked "done"; decide them when the area is worked on.

## Security and privacy

- **Members API is anonymous** (`api/members` has no `[Authorize]` in RIZones):
  anyone can list members, read and overwrite push tokens. Ported as-is.
  Strongly recommended: require sign-in.
- Blood group and family details: done behind flags `member.bloodGroup` /
  `member.familyDetails` in the members service (both on by default via
  configuration; ROW defaults them off). Revisit with counsel.
- Mobile "force re-login" never fires (tokens carry no `iat`), as in RIZones.
- **PPH camps store health data** (blood pressure, blood sugar, BMI) of
  non-members, keyed by mobile number, readable by any signed-in user of the
  club or district. Under HIPAA / GDPR / PIPEDA this needs consent records,
  access limits and retention rules, or the feature turned off for ROW.
- Blood group and spouse details are also hidden from the AG reports and the
  district committee group list when the member flags are off.

## Providers

- Email: Brevo (works for ROW; needs ROW sender domain and key).
- Mobile OTP: done - channels follow `Brand.providers.otpPolicy`
  (email + WhatsApp via Meta Cloud API, Twilio SMS fallback) instead of
  RIZones' India SMS / email-elsewhere rule.
- Push notifications (Firebase Cloud Messaging) are not wired: RIZones' Firebase
  project was excluded. Where RIZones sends a push (e.g. project approved), ROW
  skips it until a ROW Firebase project is configured.
- Payments (Cashfree, Razorpay) and WhatsApp (Interakt) still to be ported;
  ROW needs Stripe/PayPal and Meta instead (master plan WS6).

## Data and time

- Stored time is UTC with "Z" on output (RIZones: IST, no offset). Date-only
  values kept in DATETIME columns need DATE_FORMAT on read (done for member
  birthdays/anniversaries and joined date).
- Country defaults: RIZones assumed India (id 1); ROW leaves them empty.
- Zones 4-8 programmes (zonal awards, citation) ported but off by flag; seed
  content removed.

## Ported with gaps

- Schema drift: some columns the API uses exist only in the RIZones production
  database (never created in code). They are added by
  `database/schema-drift.sql` (run by `npm run db:schema`); add more there as
  they turn up. The area of focus / category / sub-category content is also
  production-only and has to be entered by ROW.
- Event T-shirt sizes / food preferences (`api/event-masters`) come with the
  event payment links port.
- Rotary.org live endpoints (club/district dashboards: award status, My Rotary
  refresh) return the RIZones failure shapes (502 / "Failed" job) until the
  Rotary.org client and sync module are ported.
- Currency conversion (`CurrencyRateService`) falls back to a rate of 1 when
  open.er-api.com is unreachable, so mixed-currency totals are summed unconverted.
- Zonal awards auto-scoring keys questions by their sort order and projects by
  RIZones taxonomy ids (area of focus 59, category 129...). ROW's own question
  set and taxonomy need that mapping redone before the zonal awards are used.
- The citation (district awards) and zonal awards modules are ported but are
  Zones 4-8 programmes; recalculation only runs with `modules.citation` on.
- PPH attendee history matches on the last 10 digits of a mobile number (an
  Indian number); international numbers need E.164 matching.

## Behaviour quirks kept from RIZones

- AG / district dashboard amounts named `...Inr` are USD totals (the RIZones
  INR rate constant is 1). Rename to `...Usd` / neutral names when the web is
  wired.
- AG dashboard joins `district_citation_category.pk_category_id`, which does not
  exist; RIZones swallows the error, so per-category citation points are 0.
- District mass emails are stored with `fk_club_id = 0`, so sending them checks
  and deducts email credits on club 0 (always "Insufficient email credits");
  editing a district "All members" email rebuilds recipients from club 0.
  Should use the district credit pool (`deductDistrictWithHistory`).
- The District Admin assignment email's role table never shows the district
  (it reads `fk_district_id` that the query does not select).
- Mass email sender is `Brevo:MassEmailSenderEmail` (RIZones hard-coded its
  own domain); it must be a Brevo-verified sender.
- The district committee sub-group "add as non-member" insert omitted its
  sort order in RIZones (the insert failed); ROW passes the next sort order.
- Password reset token lives 480 minutes; the email says 30.
- **TRF fund settings always 403**: `api/clubs/:clubId/trf/settings/funds` (create/update/delete) checks a `roleName` claim that no token carries, so no one can manage funds through the API (ported as-is from RIZones). Fix: use the `roles` claim (SuperAdmin).
- **CMR submission email suppression**: RIZones skips the submission email whenever the DB host is not localhost. ROW suppresses only when `APP_ENVIRONMENT=Development`, because an IIS production server may use a separate MySQL host.
- **CMR documents**: Word uses `docx`, PDF uses `pdfmake` (Times standard font instead of Georgia). Project cost is shown in the brand currency (RIZones printed ₹). Photos that are not JPEG/PNG (e.g. WebP) are converted with sharp for the PDF and skipped in Word, as in RIZones.
- **Club admin assignment email verification**: before sending, RIZones probes the recipient's mail server over SMTP port 25 (EmailVerifier). Outbound port 25 is commonly blocked on cloud/IIS hosts, so the probe usually ends "inconclusive" (sent anyway, warning logged). Consider dropping the probe and relying on Brevo bounce webhooks.
- **Club website hosting = Plesk (Windows/IIS)**: ported as-is (`PleskSettings:*`). If the ROW IIS servers are not managed by Plesk, provisioning needs an IIS-native provider (appcmd / Microsoft.Web.Administration) behind the same PleskService surface; until configured, activation logs "PleskSkippedNotConfigured" and just marks the site Active.
- **Club website pricing / gateway endpoints** (`pricing/*`, `default-pricing*`, `pricing/route-account`, `pricing/send-reminders`) are NOT ported yet: RIZones built them on Razorpay Route accounts and Indian GST. They come with the ROW payments work (Stripe/PayPal, tax %). Pay-link tokens are ported (`Payments:PayLinkKey`, else the JWT secret).
- **Project count rule 5** (only Zones 4–8, minus three exempt districts in RIZones) is configuration: `ProjectCount:ZoneNames` / `ProjectCount:ExemptDistrictNumbers` (empty = all active zones count).
- Club-website emails: RIZones signed them "Rotary Zones 4–8 Admin Team", listed its staff phones, named Razorpay and priced in ₹ incl. GST; ROW uses the brand name, `Brand.support` contacts, brand currency and "incl. applicable taxes". The activation email CC (a vendor mailbox in RIZones) is `Brand.support.internalCc`.
