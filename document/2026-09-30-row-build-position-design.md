# ROW build: gates, not dates

| | |
|---|---|
| Date | 30 September 2026 |
| Status | Draft for review |
| Responds to | *ROW Build Guide* (29 September 2026) and *ROW Platform Strategy and Architecture v1.0* |
| Audience | Lead developer and product owners |
| Kind of document | A position on the build plan, with the evidence for it. It is not an implementation plan |

## 1. Purpose

The build guide sets a code freeze on 28 October and a live date of 15 November 2026 for ROW, the
international edition of RIZones45678. This document takes a position on that plan: what to accept,
what to change, and how to decide that ROW is ready. It exists so the person presenting it can show
counts from the repository rather than opinions.

## 2. Constraints

**Fixed, not argued here**

- No new hosting spend. ROW runs on the existing Windows server in India, isolated as the guide describes.
- All eight languages at launch: English, French, German, Italian, Japanese, Korean, Portuguese, Spanish.

**Open to change**

- The 15 November live date.
- The size of the team.

**Outcomes that must not happen**

1. RIZones45678 breaks or regresses. It serves about 174,000 active memberships and is the business.
2. ROW launches with poor quality: untranslated screens, broken payments, wrong times.

Where these two collide with the date, the date gives way.

## 3. The position

The guide's architecture and ground rules are right. Its calendar asks one release to carry more than
it can safely hold. Keep the build, keep 15 November as the start of a pilot, and declare launch when
quality gates pass rather than on a calendar day.

### 3.1 Accepted without change

- One codebase, two instances, configuration-only differences, India as the default.
- ROW on the existing server with its own MySQL instance, isolated application pools and Cloudflare.
- All eight languages at launch.
- District-owned Stripe and PayPal accounts, no split payments.
- The ownership split across four engineers and the week-one security work.
- All twelve ground rules, with the two clarifications in section 5 (translation scope, time storage).

### 3.2 Challenged

1. Translation is aimed at the wrong strings: too many that no ROW user sees, none of the server-side text.
2. RIZones receives a very large change with no soak and no safety net.
3. Launch is defined by a date while two checklist items are decided by other organisations.

## 4. Evidence

All figures were measured on 30 September 2026 against the `main` branch and the production database.
Counts of strings come from pattern matching and are approximate to within about ten percent.

| Measure | Value | Bearing |
|---|---|---|
| Translatable strings in the admin web app | 12,170 in 768 files | Package 13 allots one engineer 18 working days for this and the Flutter app |
| Of those, SuperAdmin screens (`settings/`, `admin/`) | 2,335 | Only Kaizen staff use them |
| Of those, in legacy v1 pages | about 3,400 | Superseded, but see section 7 item 2 |
| API message literals | 1,503 | Server-side text, not in the guide |
| Files containing email or WhatsApp templates | 29 | Not in the guide |
| PDF, Word and Excel builders | 10 | Not in the guide |
| Strings in the public club-website app | 155 in 44 files | Not in the guide |
| Labels stored in database master tables | about 700 | Modules 45, goal fields 116, areas of focus 63, categories 126, sub-categories 295, designations 40, default menus 14 |
| C# clock reads (`DateTime.Now`, `Today`) | 531 | Relevant to the UTC rule |
| SQL `NOW()` / `CURDATE()` / `CURRENT_TIMESTAMP` | 1,146 / 81 / 243 | Relevant to the UTC rule |
| Hard-coded `en-IN`, `INR` or rupee symbol in the frontend | 711 | Size of the locale package |
| Date formatting calls in the frontend | 632 | Size of the locale package |
| Role id compared as a literal | 134 places | Constrains seed files |
| Designation id compared as a literal | 14 places (ids 1, 2, 4) | Constrains seed files |
| Route files (`page.tsx`) | 494 | Constrains the translation library setup |
| Club modules with a v2 page | 21 of 30 | Limits legacy deletion |
| Reviewed v2 pages marked "major issues" | 12 of 17 | Limits legacy deletion |
| Automated tests, pipelines | none | The smoke suite does not exist yet |
| Repository churn, last 14 days | 51 commits, 427 files | Collision risk for a wide sweep |
| Clubs in ROW's regions (reference data) | about 22,000 | Against 4,187 synced for RIZones today |
| Working days to code freeze | about 18 per engineer | Dussehra 20 October; Diwali 8 November falls in the pilot window |

## 5. Changes proposed to the build guide

Everything not listed stays as the guide says.

| # | Package | The guide says | Proposed | Reason |
|---|---|---|---|---|
| 1 | 13 Translation, scope | Extract every hard-coded string | Translate every screen a ROW user can reach, defined by a maintained list of routes. SuperAdmin screens stay in English. The lint rule applies to the listed routes | Removes up to about 5,700 strings nobody in ROW reads, without deleting any code. The exact figure depends on the route list: legacy pages still linked from a dashboard stay in scope |
| 2 | 13 Translation, coverage | Web and app | Add API messages, email and WhatsApp templates, document builders, the club-website app and the database labels | Otherwise a translated screen is followed by an English receipt |
| 3 | 13 Translation, quality | Machine translation, native review for three markets | Review for all eight languages, delivered in priority order: mobile app, club dashboard, district dashboard, payment and login flows, then the rest | Eight languages is a fixed promise |
| 4 | 13 Translation, mechanics | next-intl | Use the cookie-based locale mode with no locale segment in routes. Extract directory by directory with a short lock on each | Locale-prefixed routing would move 494 routes and break every link |
| 5 | 11 Master data | Seed files keyed by business keys, never ids | Business keys everywhere, plus explicit ids preserved for the role and designation tables. Add a translation structure for master-data labels, seeded in eight languages | Code compares role and designation ids as literals |
| 6 | 4 Time zones | UTC in the database | ROW stores server time exactly as RIZones does. Conversion to the district's zone happens at display and in scheduling. New code reads time through a clock interface | On a shared Windows server .NET returns IST for both products; a UTC database would mix two clocks in one row |
| 7 | 12 Release | Smoke suite written 29 October to 3 November; one build to ROW then RIZones | Smoke suite and an error-rate baseline for RIZones in week one. Each package ships to RIZones in the normal weekly release as it completes, behind India defaults | RIZones runs the new code for weeks before ROW depends on it |
| 8 | 10 Privacy | Erasure by anonymising | Add a suppression list the Rotary.org sync honours. Capture consent at first login, since members never sign up | The nightly sweep would recreate an erased member |
| 9 | Week one | Listed approvals | Add: US carrier registration for SMS, WhatsApp templates in each language, Stripe onboarding started by each pilot district, CJK fonts installed on the server, ROW database created as utf8mb4 | Each has a lead time measured in weeks |
| 10 | 2 Payments | Test payments in USD and EUR | Add a zero-decimal currency (JPY) to the done-when condition, and check gateway availability for each pilot district's country | Stripe is unavailable in most of Africa; yen and won have no minor unit |

## 6. Gates

### Gate A: the pilot may start (target 15 November 2026)

| Area | Passes when |
|---|---|
| Safety net | A smoke suite and an error-rate baseline exist for RIZones and were green before the first ROW package merged |
| RIZones safety | Every merged package has run in RIZones production for at least 7 days with no severity-1 defect |
| Isolation | Restarting ROW pools, workers and MySQL has no effect on RIZones; one ROW restore from backup completed |
| Secrets | All committed keys rotated; secret scan clean on the repository and its history |
| Payments | A live payment, webhook confirmation and refund completed on a pilot district's own account in its currency |
| Messaging | OTP by email and WhatsApp delivered to a real number in each pilot country |
| Languages | English plus each pilot district's language reviewed on the pilot surfaces: mobile app, club dashboard, payment and login flows |
| Rotary.org | Pilot districts' clubs and members synced into ROW; nothing written to RIZones |
| Legal | ROW privacy policy, terms and cookie notice live; wording covers EU data held in India |

### Gate B: launch declared

| Area | Passes when |
|---|---|
| Languages | All eight complete and reviewed for every listed route, every server-side text and every master-data label; an automated crawl per language finds no missing key and no clipped text; documents render in Japanese and Korean |
| Pilot | Two or three districts have completed one monthly report cycle and one dues campaign; no open severity-1 or severity-2 defect |
| RIZones safety | 30 days since the last package merged with no regression traced to ROW work |
| Capacity | Server headroom measured under the sync load of the zones in the first launch wave |
| Performance | Page-load times from each pilot region measured, published and accepted in writing by the product owners |
| Privacy | Export, erasure and the sync suppression list tested end to end |
| Stores | ROW app approved on both stores |
| Rotary International | Entitlement active for every zone in the first launch wave |
| Operations | Alerts reach the team; restore drill done for both MySQL instances |

### Governance

The lead developer publishes a one-page gate report each Friday. The product owners sign Gate A and
Gate B. If Gate B is still red four weeks after the pilot ends, scope is cut. A gate is never lowered.

## 7. Issues found while testing this position

Three were errors in the first draft of this position; they are corrected in section 5.

1. **Clock.** Running the ROW database in UTC on a shared Windows server would mix UTC and IST in the same rows. Corrected in change 6.
2. **Legacy pages.** Deleting v1 pages first is unsafe: 9 modules have no v2, 8 dashboard links still open v1 pages, 12 of 17 reviewed v2 pages have major issues. Corrected in change 1.
3. **Safety net.** Weekly shipping to RIZones and Gate A both assumed a smoke suite that does not exist. Corrected in change 7.

Nine were in neither the guide nor the first draft:

4. About 700 user-visible labels live in database tables, out of reach of translation keys.
5. Seed files by business key alone would break role and designation checks that use literal ids.
6. The locale package is several times larger than planned (711 locale literals, 632 date calls).
7. The translation library's routing mode decides whether 494 routes move.
8. Japanese and Korean documents need fonts installed and embedded.
9. The public club-website app is outside every translation scope.
10. Provider lead times (SMS registration, per-language WhatsApp templates, district Stripe onboarding) are not in week one; Stripe does not cover most of Africa.
11. ROW at full scale is about five times RIZones' sync load with no quiet night, on a server whose headroom is unmeasured.
12. Consent cannot be captured "at signup" because members arrive through the Rotary.org sync.

Two minor items: Apple may expect in-app account deletion, which the guide puts out of scope; the
current database default character set is three-byte and the ROW database must be created as utf8mb4.

## 8. Calendar

| Dates | What happens |
|---|---|
| 30 Sep to 6 Oct | Week one as in the guide, plus: smoke suite and baseline, translation reviewers engaged, pilot districts named, provider registrations submitted, route list drafted |
| 7 to 28 Oct | Packages built as planned; each ships to RIZones weekly; string extraction directory by directory, pilot surfaces first |
| 28 Oct | Code freeze for pilot scope. Translation content continues |
| 29 Oct to 13 Nov | Regression, Gate A evidence, app submitted to both stores. Reduced capacity 6 to 11 November |
| 15 Nov | Gate A review. Pilot starts with two or three districts |
| 16 Nov to 18 Dec | Pilot through one report cycle and one dues campaign; remaining extraction; remaining languages reviewed |
| 21 Dec to 3 Jan | No launch activity |
| 4 to 22 Jan | Language crawls, capacity measurement, fixes, Gate B evidence |
| Late January 2027 | Gate B review. Launch declared if green. A forecast, not a commitment |

Three things set the floor, none of them engineering speed: a full monthly report cycle, 30 quiet days
on RIZones, and the December holidays in ROW's markets.

## 9. What is asked of the product owners

1. Agree that 15 November is the pilot and that launch follows the gates.
2. A budget for translation review: roughly 8,000 strings and 700 labels, about 40,000 words per language across seven languages. Estimate USD 12,000 to 20,000 one-off, to be confirmed by quote. Fallback: volunteer Rotarian reviewers per language, with a vendor only for Japanese, Korean and German. Rotary International's official terminology is the glossary.
3. Pilot districts and their languages named by 12 October, chosen with gateway availability in mind.
4. The zones in the first launch wave named, so capacity can be measured against them.
5. An escalation route to Rotary International for API entitlement, started in week one.
6. Thirty minutes each Friday for the gate report.

## 10. Objections and answers

| Objection | Answer |
|---|---|
| "You are asking for more time." | The pilot starts on the original date. The guide's own checklist already depends on Rotary International and the app stores |
| "AI-assisted coding makes old estimates obsolete." | Writing speed does not set the date. A report cycle, a quiet period, holidays and five external approvals do. Every change still needs a second engineer's review |
| "We promised 15 November." | Deliver a working pilot on 15 November: named districts, live payments, their language reviewed |
| "A vendor is new spend." | One-off, not recurring, and it buys the eight languages that were promised. A volunteer fallback exists |
| "The rule says no hard-coded strings anywhere." | The rule holds for every screen a ROW user can reach. SuperAdmin stays English |
| "UTC storage is the standard." | It is the right end state. On a shared Windows server it produces two clocks in one row. Move to UTC when ROW has its own host |
| "Weekly shipping to RIZones slows us down." | It changes the order, not the amount of work, and needs only the smoke suite earlier |
| "Gates never turn green." | They are fixed and signed now, reported weekly, and scope is cut after four red weeks |
| "Why limit the launch zones?" | About 22,000 clubs against 4,187 today. Launch in waves and measure between them |

**Deliberately not raised:** cloud hosting. It is settled. The capacity gate makes the same case later with data.

## 11. Out of scope for this document

- Any implementation. Approval of this position leads to a revised build order, not code.
- The guide's own "not in this build" list, which stands.
- The Rotary Assistant and the Rotary.org Foundation and Goals pulls, which are separate work streams in the same repository and need a decision on whether they ship in the ROW release build.

## 12. Open questions

1. Does late January collide with anything on the Rotary or Kaizen calendar?
2. Is the translation budget available, or is the volunteer fallback the working assumption?
3. Who owns the route list that defines "reachable by a ROW user"?
4. What is the lawful basis for holding EU members who are synced but never log in, and do Rotary International's API terms restrict where that data is stored?
