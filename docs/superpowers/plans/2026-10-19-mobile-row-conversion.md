# Mobile RIZones → ROW Conversion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, solo: no multi-agent). Steps use checkbox (`- [ ]`) syntax.

**Goal:** `row/mobile` behaves like the ROW web admin: same modules, ROW API only, no RIZones or India-only assumptions. Design is a later, separate plan (Fellowship port, Tasks 6-9).

**Architecture:** Keep the RIZones app's structure (Provider, go_router, `ApiConstants`, services). Change only what differs from ROW, the way the web admin was converted: client paths, formats, phone input, auth, privacy. `reference/rotary_zones_45678_flutter` is read-only source (pulled 2026-10-19, at 1c3cb0d).

**Tech Stack:** Flutter 3.47.7 / Dart 3.13.5 at `C:\src\flutter` (installed 2026-10-19), `intl`, Provider, go_router.

**Spec:** user asks (2026-10-19): "convert the app from rizones to row the same way as the web… keep the exact same things as in the web application; later decide which modules to keep". Plus memory rules: no RIZones content/branding/domains, no India-only integrations, copy design not data, no secrets in commits.

## Global Constraints

- Verify every task with `flutter analyze` (0 errors, no new warnings vs baseline 31) and `flutter test` (baseline 70/70).
- Never call an endpoint the ROW API does not serve; `kb/mobile-diff.md` "not served" list must end at 0 (payments excepted until Payments is ported).
- WhatsApp: leave as is (user decision pending, 2026-10-19).
- Payments (Cashfree/Razorpay, 18 files) and push (Firebase project): out of scope, external decisions.
- No commits until the user asks.

## Review Focus

1. A member with a non-Indian phone number (+231…, +1…) can sign in and edit their profile; stored value is E.164.
2. Currency shows the district's currency (web `Currency` setting), never a hard-coded ₹; numbers group as thousands, not lakh/crore.
3. A screen whose endpoint was removed from `ApiConstants` is not reachable from any menu.
4. First sign-in after a policy change shows the consent screen and blocks until accepted (as web).
5. Module visibility follows the same `moduleKey` gating the web sidebar uses.

---

### Task 1: Endpoint parity
**Files:** `lib/core/constants/api_constants.dart`, callers found by grep; `kb/mobile-diff.md` (regenerated).
- [ ] Classify the 23 unserved paths: unused constant → delete; used → repoint to the ROW route the web admin uses (e.g. `/api/clubs/$clubId/website-data/about`); no ROW route → hide the screen and list it.
- [ ] Delete `ApiConstants` entries with no caller (≈130, RIZones carry-over).
- [ ] `bash kb/rebuild.sh --no-graphs` → "not served" = 0 (payments excepted). analyze + test green.

### Task 2: Locale-neutral formats (WS10-04, ~30 files)
**Files:** create `lib/core/utils/formatters.dart` (`formatMoney(num, String currencyCode)`, `formatNumber(num)`, `formatDate(DateTime)`); replace ₹ / `en_IN` / lakh / crore uses.
- [ ] Failing tests first: `formatMoney(1234567, 'USD')` → `"$1,234,567"`; `formatMoney(1500, 'LRD')` → `"LRD 1,500"`; `formatNumber(1234567)` → `"1,234,567"`.
- [ ] Currency code comes from the same API field the web uses (district/club currency); fallback `USD`.
- [ ] grep `₹|en_IN|lakh|crore` in lib → 0.

### Task 3: International phone input (WS10-05, ~21 files)
**Files:** one shared phone field widget + validator; replace `+91` / 10-digit checks.
- [ ] Failing tests: `normalizePhone('+231 77 123 4567')` → `'+231771234567'`; `'0771234567'` with country `LR` → `'+231771234567'`; reject < 7 digits.
- [ ] Country list without an India default (default from brand/district country).
- [ ] grep `\+91|length.*10` in lib → only unrelated hits, each checked.

### Task 4: Sign-in parity  **(needs user decision, see below)**
- [ ] Web admin is email + password only (2026-10-19). App today: mobile number + SMS OTP (`/api/mobile/auth/request-otp`, `verify-otp`). Implement the option the user picks; keep `auth_provider.dart` session handling.

### Task 5: Privacy screens (WS10-08)
**Files:** new `lib/presentation/screens/privacy/` (consent, my data), service over `api/privacy/consent`, `consent/withdraw`, `members/{id}/export`, `language`.
- [ ] Widget test: consent required → app routes to consent screen; accept posts and continues.
- [ ] Settings entry: "Download my data", "Withdraw consent", language preference.

### Task 6: Module parity with web
- [ ] Compare app menus vs web sidebars (`row/admin/src/app/*/nav.ts`): same labels (incl. "Projects / Events" for Foundation), same `moduleKey` gating. List extra/missing modules for the user's later keep/drop decision; do not delete modules now.

### Task 7: Leftover sweep + docs
- [ ] grep RIZones names/domains/India integrations in `row/mobile` (lib, android, ios, assets) → 0 (Firebase/Play IDs listed if found).
- [ ] Update `row/STATUS.md`, `row/PENDING-WORK.md` §5, `row/ROW-CHANGES.md`; `bash kb/rebuild.sh`.
- [ ] Final: analyze 0 errors, test all green, self-review of the diff.
