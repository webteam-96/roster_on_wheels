# ROW design overhaul: every admin page and every app screen

Status: Phase 1 samples APPROVED by the user (29 Oct 2026). Phases 2 to 6 in progress.

Decisions (user, 29 Oct 2026): no mockups exist, so Phase 1 writes the spec and builds the samples; all screens
are redesigned, dates are decided later; only the page version the menus open is redesigned, unreachable
duplicates are retired after the user's OK; the user approves the samples live in the browser.

Asked (29 Oct 2026): plan the new ROW design for the whole web application (admin) and the mobile app, every
screen, then start designing once the plan is approved.

## 1. Goal and what "done" means

Every admin page and every app screen uses the ROW "Fellowship" design (`row/website/design.md`) in its layout
and parts, not only in its colours. No screen keeps a RIZones layout.

A screen is done when:
1. It is built from the shared ROW parts (page header, panels, tone cards, pill buttons, ROW table, ROW form
   fields, empty / error / skeleton states) and has no one-off buttons, tables or colours.
2. It passes the FRONTEND-RULES gate in `CLAUDE.md` (design check script stays at 0 problems).
3. It works at desktop (1440px) and phone width (390px) for every role that can open it, checked in a browser.
4. Its data, API calls, permissions and behaviour are unchanged; every existing automated test still passes.

Not in scope: data, API, features, permissions, the public club and district websites (gated until the web and
app are done), the marketing website (it is the design source).

## 2. Where we are (measured 29 Oct 2026)

| Surface | Count | Today |
|---|---|---|
| Admin pages (`row/admin/src/app/**/page.tsx`) | 473 | ROW colours, fonts, icons, logo on all. RIZones layouts on all. |
| of which RIZones "v2" duplicates | 104 | Some areas have both an old page and a `/v2` page (for example `clubs/[id]/club-service` and `.../v2`). |
| Admin shared kit (`components/ui`) | 23 parts | Restyled colours and pill buttons; layout parts missing (page header, panel, list/form/detail templates). |
| Pages drawing their own tables / buttons | 104 / 295 files | Bypass the shared kit, so a kit change does not reach them. |
| App screens (`row/mobile/lib/presentation/screens`) | about 165 | ROW theme, fonts, colours. `PillButton` and `ToneCard` exist but 0 screens use them. |

Admin pages by area: clubs 165, districts 78, settings 59, district-admin-dashboard 53, club-admin-dashboard 39,
(site) 18, ag-dashboard 11, admin 11, pay 8, other 41 (login, password, policies, members, zones, planning).

App screen files by area: clubs 67, districts 64, ag 12, settings 7, login 5, calendar 5, others 1 to 4 each.

## 3. Design rules (no new values are invented)

- Tokens, type, colour, tone system, motion, accessibility: `row/website/design.md` §1 to §6.
- Application density (design.md §7.4): same tokens, tighter spacing and smaller panel radius than the website.
- FRONTEND-RULES gate wins on any clash. In particular: no gradients, no drop shadows (1px line or tonal step),
  no pure white, no Lucide (admin uses Phosphor via `components/icons.ts`), no em dashes or emoji in copy,
  no coloured left strip on cards, skeleton loaders for every async area.
- Radius (rule 23): one deliberate scale, used everywhere: pills for buttons and chips, 20px for panels and
  cards in the admin, 12px for inputs and table wrappers. Set once as tokens.
- Gold only for lines, icons, highlights and the button arrow, never a large field.
- Status colours (success, warning, error) stay distinct and are not remapped.

## 4. The approach

Build the parts once, prove them on a few sample screens, then move every screen onto them in batches.
Converting a screen = replacing its layout markup with the shared templates and parts; its data hooks, handlers
and API calls are kept line for line.

### Phase 0: Inventory (0.5 day)
- List every admin route and app screen with: area, roles that reach it, whether a menu links to it.
- For the 104 `/v2` pairs: record which version the menus open. Unreachable duplicates are listed for a
  decision (see §7, question 3); they are not redesigned until decided.
- Take "before" screenshots of the sample screens.
- Output: `docs/plans/row-design-inventory.md` (one row per screen, a status column used to track progress).

### Phase 1: Application design spec + sample screens (3 days)
- Write `row/website/design.md` §8 "Application screens": app shell (sidebar, top bar, role switcher, year
  switcher), page header, section panel, KPI tile, list page (filters, table, pagination, bulk actions),
  detail page, form page (field, label, help, error, sections, sticky actions), dialog, tabs, empty state,
  error state, skeleton, toast, charts. Same for the app: app bar, bottom navigation, list row, section header,
  card, form field, chips, sheet, empty / error / skeleton.
- Build 6 sample screens in code, with real data from the local database copy:
  - Admin: District Admin dashboard, Club members list, Add / Edit member form.
  - App: Member home, Members directory, My profile.
- Show desktop and phone screenshots of each. **Stop for approval** before Phase 2.

### Phase 2: Admin foundation (3 to 4 days)
- Restyle the 23 `components/ui` parts to the spec (table, input, select, dialog, tabs, badge, card ...).
- Add the templates: `PageHeader`, `Panel`, `KpiTile`, `ListPage`, `FormPage`, `DetailPage`, `DashboardGrid`,
  `EmptyState`, `ErrorState`, skeletons.
- Rebuild the shells: `Sidebar`, `DashboardShell`, `ClubAdminShell`, `DistrictAdminShell`, `AppHeader`.
- Effect: every page picks up the new shell and kit at once, before any page is converted.

### Phase 3: Admin pages, in batches by area (12 to 15 days)
Order (most used first): 1. sign-in and password pages; 2. the 4 dashboards (Super Admin, District, Club, AG);
3. members; 4. club pages (165); 5. district pages (78); 6. settings and Super Admin tools (70);
7. public pages (policies, invite, unsubscribe). Each batch also converts its pages from the 104 own-table and
295 own-button files to the shared kit.
Payment pages (`pay`, dues, wallet: about 20) are restyled with the Stripe rebuild, not before, so they are
built once.

### Phase 4: App foundation (2 days)
- Theme from `core/theme/row_tokens.dart`; widgets: `PillButton` and `ToneCard` (exist), plus app bar,
  bottom navigation, list row, section header, stat tile, form field, chip, bottom sheet, empty / error /
  skeleton.

### Phase 5: App screens, in batches by area (8 to 10 days)
Order: splash and sign-in; home; members and profile; calendar and notifications; clubs (67 files);
districts (64); AG (12); settings, privacy, preferences and the rest. Payment screens wait for Stripe.

### Phase 6: Final pass (1 to 2 days)
- Design check 0; no screen left on a RIZones layout (inventory all "done"); full test run; screenshots of every
  role's main path at desktop and phone width.

**Total: about 30 to 37 working days** (page 17 estimate, 1a to 1f, plus Phase 0 and 6). There are 18 working
days to 23 Nov. Everything does not fit before the internal target unless the scope or the date changes.

## 5. How each batch is checked
1. `npx tsc --noEmit`, `npx vitest run`, `node scripts/check-design.mjs` (admin); `flutter analyze`,
   `flutter test` (app). All green, design check 0.
2. Browser check of every page in the batch at 1440px and 390px for each role that reaches it; app screens on
   the emulator. Screenshots kept for the batch.
3. Diff check: only presentation files and markup changed; no API call, hook or handler removed.
4. Inventory updated; batch summary written to `docs/claude/STATUS.md`.

## 6. Risks
- Size: 473 pages and about 165 screens. The kit-first order means a half-finished state still looks
  consistent: every page has the new shell and parts even before it gets its own layout pass.
- Behaviour drift while changing markup: kept small by converting layout only, plus the test suites and the
  browser check per batch.
- Manual testing of modules is running at the same time; a redesigned page must be re-checked by the tester.
  Proposal: convert a module's pages before it is manually tested, or retest after.
- No screen designs exist for application screens (as far as the repo shows); the spec and the sample screens
  stand in for them, which is why Phase 1 stops for approval.

## 7. Questions for the owner (needed before Phase 1)
1. Are there Figma files or mockups for the admin or app screens? If yes, they replace the Phase 1 spec.
2. Scope and date: all 30 to 37 days of design now (moves other work past 23 Nov), or key screens before
   launch and the rest after?
3. The 104 `/v2` duplicate pages: redesign only the version the menus open and retire the other one?
4. Approval of the 6 sample screens: who approves, and is a screenshot review enough?
