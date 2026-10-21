# Fellowship Design Port (admin + mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ROW admin portal (`row/admin`) and the mobile app (`row/mobile`) look like the marketing website (`row/website`), screen by screen, under the FRONTEND-RULES gate.

**Architecture:** Change the design contract first (`row/website/design.md` + website), then restyle each surface centrally (tokens, Tailwind palette remap, Flutter `AppColors`/theme, one font helper, one icon module) so every screen moves at once, then do a screen-by-screen pass in batches that removes what central changes cannot reach (gradients, shadows, hex literals, ad-hoc colours, copy rule breaks).

**Tech Stack:** Next.js + Tailwind 3 + `next/font` (admin, website); Flutter + Provider + go_router (mobile).

**Spec:** `row/website/design.md` (tokens, components, a11y) + the `FRONTEND-RULES` block in `CLAUDE.md` (wins on any clash). User decisions 2026-10-19: admin only (not club-website), full screen-by-screen, mobile pickers removed, FRONTEND-RULES wins over design.md.

## Global Constraints

- Colours (design.md §1): cream `#F7F9FC`, cream-2 `#EDF4FB`, ink `#1B2C42`, ink-2 `#2A3F5C`, ink-soft `#64748B`, azure `#17458F`, mint `#0067C8`, mint-ink `#0B3F7A`, marigold `#F7A81B`, coral `#FFC65C`, lilac `#A9C6EA`, sky `#CFE2F6`, stone `#D5DEE8`, line `rgba(27,44,66,.12)`.
- Brand balance: gold only for rules, icons, highlights, button arrow. Never a large background. Large fields are azure.
- Typeface (replaces Inter, FRONTEND-RULES #7): **Bricolage Grotesque** for display/headings (600, line-height .98, tracking -.035em), **Figtree** for body (400, line-height 1.55). This was the website's earlier concept, so it is already in the brand's history. Both are on Google Fonts under the SIL OFL.
- No pure `#FFFFFF` backgrounds (#3): page = cream, card/popover/surface = `#FCFDFE`.
- No gradients (#1), no drop shadows as default separation (#18): separate with a 1px `line` border or tonal contrast (cream vs cream-2). The `--shadow-soft`/`--shadow-lift` tokens are removed.
- No Lucide icons (#12) in admin. Mobile uses Material Icons, which is allowed.
- No em dashes (#8) or emoji (#9) in UI copy. No sparkle icons, glow orbs, dot grids, glassmorphism, coloured left strips on cards, checkmark bullet lists.
- Focus ring: `outline: 3px solid ink; outline-offset: 3px`. Marigold on azure panels.
- Semantic status colours stay distinct and are not remapped: success green, error red, warning amber.
- Admin density (design.md §7.4): same tokens, tighter section padding and panel radius (`--radius: 0.85rem`, panels `1.25rem`).
- Light theme is the brand. Existing dark modes are kept but retinted from ink. No new dark theme work.
- Do not commit per task. The user commits once on request (memory: commit-only-when-told).
- No WhatsApp, no RIZones branding/data anywhere (memory).

## Review Focus

1. **Contrast after the palette remap:** `text-white` on remapped light tones (blue-100 to 300 now sky/lilac) is unreadable. Task 2's check script flags every `text-white` paired with a 50 to 300 shade in the same className.
2. **Status and chart colours:** after remapping purple/indigo/teal to blues, 5-series charts and status badges must still be distinguishable. Task 2 keeps green/red/amber unremapped and Task 4 sets chart-1..5 to azure, marigold, mint, coral, lilac. Batch screenshots must include one chart page.
3. **Upgrading mobile users with a saved palette or font:** an app with `paletteIndex`/font prefs saved must open on Fellowship without a crash. Task 6 deletes those keys on startup, and `test/core/theme/legacy_prefs_test.dart` pins it.
4. **Icon mapping gaps:** a Lucide name with no Phosphor twin must fail the type check, never render nothing. Task 3 exports each icon explicitly (no index signature), so `tsc` fails on a missing name.
5. **Reduced motion:** new transitions respect `prefers-reduced-motion` (web) and `MediaQuery.disableAnimations` (Flutter). Checked in every batch review.

---

## Phase A: Contract and website

### Task 1: Update design.md and the website to the gate

**Files:**
- Modify: `row/website/design.md` §2 (typeface), §3 (shadows → borders/tonal), §5 (button hover, no shadow), §7 (porting checklist: Bricolage + Figtree, no shadows, no Lucide)
- Modify: `row/website/app/layout.tsx` (`next/font/google`: `Figtree` → `--font-body`, `Bricolage_Grotesque` → `--font-display`; drop `Inter`)
- Modify: `row/website/app/globals.css` (font vars; remove the 90 `shadow` uses and 12 gradients, replacing them with `1px solid var(--line)` borders or cream/cream-2 tonal steps; replace `#fff`/`#ffffff` backgrounds with `--cream`/`#FCFDFE`)
- Modify: any website copy with em dashes or emoji (`grep -rn "—" row/website/app row/website/components`)

- [ ] Step 1: Edit design.md. Every token value stays except type and shadows.
- [ ] Step 2: Swap fonts in `layout.tsx` and `globals.css`.
- [ ] Step 3: Remove shadows and gradients. Fix white backgrounds and copy.
- [ ] Step 4: Verify that `cd row/website && npm run build` passes and `npm run lint` is clean. `grep -cE "box-shadow|gradient" app/globals.css` → 0. Take browser screenshots of home and one inner page at 390px and 1440px.

## Phase B: Admin (`row/admin`)

The current uncommitted admin restyle (tokens in `globals.css`, 16 `ui/*` components, `Sidebar.tsx`) is kept and built on, not redone.

### Task 2: Remap the Tailwind palette and tokens

**Files:**
- Modify: `row/admin/tailwind.config.ts`: `theme.extend.colors` overrides the default scales so existing classes restyle with no page edits:
  - `blue`, `indigo`, `sky`, `cyan`, `teal`, `violet`, `purple`, `fuchsia`, `pink` → one Fellowship blue scale: 50 `#F3F8FD`, 100 `#EDF4FB`, 200 `#CFE2F6`, 300 `#A9C6EA`, 400 `#5E93D6`, 500 `#0067C8`, 600 `#1F56A8`, 700 `#17458F`, 800 `#0B3F7A`, 900 `#12376F`, 950 `#0A2547`.
  - `slate`, `gray`, `zinc`, `neutral`, `stone` → ink-tinted neutral scale: 50 `#F7F9FC`, 100 `#EDF4FB`, 200 `#D5DEE8`, 300 `#B7C3D2`, 400 `#8796AA`, 500 `#64748B`, 600 `#4A5A70`, 700 `#2A3F5C`, 800 `#1B2C42`, 900 `#132033`, 950 `#0B1422`.
  - `yellow`, `orange` → marigold scale (500 `#F7A81B`, 400 `#FFC65C`). `amber` stays (warning). `green`, `emerald`, `red`, `rose` stay (status).
  - Named tokens `cream`, `cream-2`, `ink`, `ink-soft`, `azure`, `mint`, `marigold`, `coral`, `lilac`, `sky-tone`, `stone-tone`, `line`.
  - `boxShadow`: `sm`, `DEFAULT`, `md`, `lg`, `xl`, `2xl` → `none`, so 633 shadow classes stop drawing. `boxShadow.ring-line: 0 0 0 1px rgba(27,44,66,.12)` for the rare deliberate case.
  - `fontFamily.sans` → `var(--font-body)`, `fontFamily.display` → `var(--font-display)`.
- Modify: `row/admin/src/app/globals.css`: `--card`/`--popover` → `#FCFDFE`. Remove `--shadow-soft`/`--shadow-lift`. Set `:focus-visible` per Global Constraints.
- Create: `row/admin/scripts/check-design.mjs`, a gate script that prints counts and exits 1 when any is non-zero: `lucide-react` imports, `bg-gradient-to-`, hex literals in `.tsx`, `—` inside JSX text, emoji, `text-white` combined with a 50 to 300 shade of a remapped scale in one className.

- [ ] Step 1: Write `check-design.mjs`. Run `node scripts/check-design.mjs` and record the starting counts. They are non-zero; this is the "failing test".
- [ ] Step 2: Edit `tailwind.config.ts` and `globals.css`.
- [ ] Step 3: Verify that `node -e` with `tailwindcss/resolveConfig` shows `colors.blue[700] === '#17458F'`, `colors.slate[800] === '#1B2C42'`, `colors.green[600]` unchanged and `boxShadow.md === 'none'`.
- [ ] Step 4: `npx tsc --noEmit` and `npm run build` pass. Take screenshots of the login, district dashboard and one chart page.

### Task 3: Replace Lucide with Phosphor through one icon module

**Files:**
- Add dependency: `@phosphor-icons/react` (reason: FRONTEND-RULES #12 bans Lucide. Phosphor covers all 189 names in use, is tree-shakeable, and has a lighter look closer to the website's 2.6-stroke line icons).
- Create: `row/admin/src/components/icons.ts`: one named export per Lucide name in use (189), each `export { Gear as Settings } from "@phosphor-icons/react"` style, plus `export type LucideIcon = Icon`. No index signature, so `tsc` fails on any missing name.
- Modify: 598 files, a codemod that rewrites `from "lucide-react"` → `from "@/components/icons"` (one `sed`).
- Modify: `row/admin/package.json`, which removes `lucide-react`.

- [ ] Step 1: List the names in use (`grep -rhoE 'import \{[^}]+\} from "lucide-react"'`) and write `icons.ts`.
- [ ] Step 2: Run the codemod and remove `lucide-react`.
- [ ] Step 3: Verify that `npx tsc --noEmit` passes, `check-design.mjs` shows lucide = 0, and `npm run build` passes. Screenshot the sidebar and one table page.

### Task 4: Admin fonts and chart tokens

**Files:**
- Modify: `row/admin/src/app/layout.tsx`, `row/admin/src/app/(site)/layout.tsx`: `Figtree` + `Bricolage_Grotesque` from `next/font/google`. Drop `Inter` and `Fraunces`.
- Modify: `row/admin/src/app/globals.css`: `--chart-1..5` = azure, marigold, mint, coral, lilac.

- [ ] Step 1: Edit and run `npm run build`. Check the headings in a screenshot.

### Task 5: Admin screen-by-screen pass (10 batches)

Each batch clears its folders to zero on `check-design.mjs`. It also brings layouts in line with design.md §5: tone panels for summary blocks, pill buttons from `ui/button`, the `ui/table` spec, `<details>` FAQ, solid fills instead of gradients, hex → tokens, and copy fixes. Batches by `src/app` folder:

1. `login`, `forgot-password`, `reset-password`, `sso`, `pay`, `(site)`, legal pages (`privacy-policy`, `terms-and-conditions`, `refunds-and-cancellations`, `cookies`), `not-found`, `error`
2. `src/components` (shared, outside `ui/`)
3. `district-admin-dashboard`, `districts`
4. `clubs` (service avenues and v2 pages)
5. `club-admin-dashboard`, `club-moderator`, `club-dues-approval`, `dues-approval`
6. `zonal-dashboard`, `zones`
7. `ri-director`, `ag-dashboard`, `ag-reports`
8. `members`, `goal-overviews`, `report`
9. `admin`, `settings`, `public`
10. Leftovers reported by `check-design.mjs`

- [ ] Per batch: edit the batch → `node scripts/check-design.mjs <folders>` = 0 → `npx tsc --noEmit` passes → screenshots of 2 to 3 pages at 390px and 1440px. Check them against Review Focus 1, 2 and 5.
- [ ] After batch 10: `node scripts/check-design.mjs` with no args = 0 for all of `src`. `npm run build` passes. Then `bash kb/rebuild.sh`.

## Phase C: Mobile (`row/mobile`)

### Task 6: Lock the theme to Fellowship and remove the pickers

**Files:**
- Modify: `lib/core/theme/app_colors.dart`. All fields become `static const` with Fellowship values: `primaryPrime` `#17458F`, `primaryLight` `#CFE2F6`, `primaryDeep` `#0B3F7A`, `goldPrime` `#F7A81B`, `goldLight` `#FFC65C`, `goldDark` `#E59A10`, `lightBg` `#F7F9FC`, `surface`/`card` `#FCFDFE`, `muted` `#EDF4FB`, `textPrimary` `#1B2C42`, `textSecondary` `#64748B`, `textMuted` `#8796AA`, `lightBorder` `#D5DEE8`, `rotaryBlue` `#17458F`, `rotaryGold` `#F7A81B`, `chart1..5` azure, marigold, mint, coral, lilac. Accent purples/blues map to the Fellowship blue scale. Status colours stay. Dark fields are retinted from ink (`darkBg` `#132033`, `darkSurface` `#1B2C42`, `darkCard` `#2A3F5C`). `applyPalette`/`applyGold` are removed.
- Create: `lib/core/theme/row_tokens.dart` with `enum RowTone { marigold, coral, azure, mint, lilac, sky, ink, cream, cream2 }` and `extension RowToneColors on RowTone { Color get fill; Color get onFill; }` (pairs from design.md §1), `RowRadii` (panel 24, tile 16, pill 999), `RowMotion` (`micro` 160ms, `ui` 320ms, `reveal` 700ms; `easeOut` `Cubic(.22,1,.36,1)`, `easeInOut` `Cubic(.65,0,.35,1)`, `spring` `Cubic(.34,1.56,.64,1)`).
- Delete: `lib/core/theme/app_palette.dart`, `app_gold_palette.dart`, `theme_controller.dart`, `lib/presentation/screens/color_theme_screen.dart`, `lib/presentation/screens/preferences/font_family_screen.dart`, `lib/core/preferences/font_family_controller.dart`, `lib/core/theme/body_font.dart`.
- Modify: `lib/core/theme/app_gradients.dart`: delete it if Task 8 removes all uses, otherwise make it const.
- Modify: `lib/main.dart`, `lib/app.dart`: drop the providers. On startup, remove the prefs keys `paletteIndex`, `goldIndex` and the font-family key.
- Modify: `lib/core/routing/app_router.dart:145-146,562-564` (remove the routes) and the settings screen entries that link to them, plus `RouteNames.colorTheme`/`fontFamily`.
- Test: `test/core/theme/app_colors_test.dart` (`expect(AppColors.primary, const Color(0xFF17458F)); expect(AppColors.secondary, const Color(0xFFF7A81B)); expect(RowTone.azure.onFill, const Color(0xFFF7F9FC));`), `test/core/theme/legacy_prefs_test.dart` (seed `SharedPreferences.setMockInitialValues({'paletteIndex': 1})`, run the startup cleanup, expect the key to be gone and the app theme primary to be azure).

- [ ] Step 1: Write both tests. `flutter test test/core/theme` fails.
- [ ] Step 2: Implement. Then `flutter test test/core/theme` passes and `flutter analyze` shows no new issues.

### Task 7: Bundle the fonts and set the theme

**Files:**
- Add: `assets/fonts/Figtree[wght].ttf`, `assets/fonts/BricolageGrotesque[opsz,wdth,wght].ttf` + `OFL.txt` (downloaded from the google/fonts GitHub repo into a fresh directory, then copied). Register them in `pubspec.yaml` `fonts:` as families `Figtree` and `BricolageGrotesque`.
- Create: `lib/core/theme/app_fonts.dart` with `class AppFonts { static TextStyle body({double? fontSize, FontWeight? fontWeight, Color? color, double? height, double? letterSpacing, TextDecoration? decoration}); static TextStyle display({...same}); }`. Body defaults to Figtree 400/1.55. Display defaults to BricolageGrotesque 600/0.98/-0.035em.
- Modify: 1,559 `GoogleFonts.plusJakartaSans(` → `AppFonts.body(` (one `sed`). Map the few `geist`/`lexend`/`atkinsonHyperlegible` calls to `AppFonts.body` and `robotoMono` to `AppFonts.body` with `FontFeature.tabularFigures()`. Remove `google_fonts` from `pubspec.yaml` once there are 0 uses.
- Modify: `lib/core/theme/app_theme.dart`. `colorScheme` gets explicit Fellowship colours (no `fromSeed`). `textTheme` gets display/headline → `AppFonts.display`, body → `AppFonts.body`. Buttons are `StadiumBorder` (pill) with `minimumSize` height 52. Cards have `elevation: 0`, a 1px `line` border and radius 16. `dividerColor` is `line`. No elevation on app bars or dialogs.
- Modify: `lib/core/theme/app_text_styles.dart`, re-pointed to `AppFonts`.

- [ ] Step 1: `flutter pub get`, then `grep -rc "GoogleFonts" lib` → 0, then `flutter analyze` and `flutter test` pass.
- [ ] Step 2: Run on an emulator. Screenshot the login, home dashboard and one list screen.

### Task 8: Shared widgets used by the screen pass

Build only what the pass needs. Text always comes in through parameters.

**Files:**
- Create: `lib/presentation/widgets/row/pill_button.dart`: `PillButton({required String label, required VoidCallback? onPressed, PillVariant variant = PillVariant.primary, bool arrow = false})`, with `enum PillVariant { primary, gold, ghost, onPanel }`. The arrow chip is a marigold circle with an ink arrow. It slides 4px with `RowMotion.spring` and stays still when animations are disabled.
- Create: `lib/presentation/widgets/row/tone_card.dart`: `ToneCard({required RowTone tone, required Widget child, EdgeInsets padding = const EdgeInsets.all(20)})`. It uses `tone.fill` and a `DefaultTextStyle` colour of `tone.onFill`, with no shadow.
- Test: `test/presentation/widgets/row/pill_button_test.dart` (renders the label, `onPressed: null` is disabled, `arrow: true` shows the arrow semantics-excluded). Also `tone_card_test.dart` (text colour = `RowTone.marigold.onFill`).

- [ ] Step 1: Write the tests and see them fail. Implement, then `flutter test test/presentation/widgets/row` passes.

### Task 9: Mobile screen-by-screen pass (8 batches)

Each batch clears its folders of `Color(0x` literals (use `AppColors`/`RowTone`), `BoxShadow(`, `LinearGradient(`, emoji and `—` in strings. It also switches cards and buttons to `ToneCard`/`PillButton` where the screen has them. Batches by `lib/presentation/screens/` subfolder, grouped in roughly equal sizes (about 24 screens each). The executor lists the folders with `ls` at the start of the task and records the grouping in this file.

- [ ] Per batch: edit → `grep -rcE "Color\(0x|BoxShadow\(|LinearGradient\(" <folders>` = 0 → `flutter analyze` with no new issues → emulator screenshots of 2 to 3 screens, checked against Review Focus 1, 2, 3 and 5.
- [ ] After the last batch: the same grep across `lib` (excluding `lib/core/theme`) = 0. `flutter test` passes. Then `bash kb/rebuild.sh`.

## Phase D: Close-out

### Task 10: Docs and final gates

- [x] Update `row/STATUS.md` and `row/ROW-CHANGES.md` (design port done; pickers removed; fonts; Lucide → Phosphor).
- [x] Final verification: website `npm run build`; admin `npx tsc --noEmit && npm run build && node scripts/check-design.mjs`; mobile `flutter analyze && flutter test`.
- [x] FRONTEND-RULES gate review across all three surfaces, listing any violation with file:line.
- [ ] Ask the user about commit and push (do not commit unasked).

## Follow-up (user request 2026-10-19, after this plan): mobile RIZones → ROW conversion

After the design port, convert the mobile app from the RIZones reference (`ref-mobile`) to ROW the same way the
web application was converted (see `kb/` diffs, `row/ROW-CHANGES.md`). For now the app keeps **exactly the same
modules as the ROW web application**; module trimming and new features come later, once finalized. Needs its own
plan (writing-plans) before work starts.
