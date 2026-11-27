# ROW Design System — "Fellowship" (Concept 03)

The shared visual language for all three ROW surfaces: this **website**, the **mobile app** (Flutter,
`row/mobile`) and the **ROW web application / admin portal** (Next.js, `row/admin`). This file is the single
source of truth for tokens, type, colour, spacing, motion and components. The website
(`app/globals.css`, `components/kit.tsx`, `lib/row-fx.js`) is the reference implementation; port the *values
and rules* below to each platform's idiom (Flutter `ThemeData`, Tailwind/CSS variables), not the CSS verbatim.

Design character: **warm, sociable, colour-blocked.** Generous rounded panels, a friendly fluid type scale,
hand-drawn "scribble" accents, and restrained, purposeful motion. It reads as Rotary (Royal Blue + gold) but
softer and more modern.

---

## 1. Colour

### Palette (tokens → hex)

| Token | Hex | Role |
|---|---|---|
| `--cream` | `#F7F9FC` | Page background; text on dark fields |
| `--cream-2` | `#EDF4FB` | Secondary surface / soft tiles |
| `--ink` | `#1B2C42` | Primary text, dark fields, focus ring |
| `--ink-2` | `#2A3F5C` | Hover for ink surfaces |
| `--ink-soft` | `#64748B` | Muted / secondary text |
| `--azure` | `#17458F` | **Rotary Royal Blue** — primary action, large colour fields |
| `--mint` | `#0067C8` | Bright blue accent |
| `--mint-ink` | `#0B3F7A` | Deep blue text on light blue |
| `--marigold` | `#F7A81B` | **Gold** — rules, icons, highlights, scribbles, button arrow |
| `--coral` | `#FFC65C` | Warm accent / tile |
| `--lilac` | `#A9C6EA` | Soft accent tile |
| `--sky` | `#CFE2F6` | Soft accent tile |
| `--stone` | `#D5DEE8` | Neutral fill |
| `--line` | `rgba(27,44,66,.12)` | Hairline borders / insets |

**Brand balance rule (important):** gold (`--marigold`) is only for rules, icons, highlights and the button
arrow — **never** a large background. Large colour fields are Rotary Royal Blue (`--azure`). On a blue/gold
panel, primary buttons invert to white with azure text. Keep this ratio on every platform.

### Tone system (`data-c`)

Colour is applied through a single attribute, `data-c="<tone>"`, which sets two variables consumed by the
component: `--c` (the fill) and `--on-c` (the readable text/ink on that fill). Tones: `marigold`, `coral`,
`azure`, `mint`, `lilac`, `sky`, `ink`, `cream`, `cream2`. Card grids cycle tones in this order:
`sky → lilac → marigold → mint → coral → cream2`.

> **Flutter port:** model this as a `RowTone` enum → `(Color fill, Color onFill)` pair, mirroring the
> `[data-c]` table. Admin (Tailwind): expose the same names as CSS custom properties on `:root` and a
> `data-c` utility, or Tailwind theme colours `cream/ink/azure/marigold/...`.

`color-scheme: light` — the system is light-only today. There is no dark theme; if one is added, define it as
a second token set, don't hard-code hex anywhere.

---

## 2. Typography

- **Family:** **Bricolage Grotesque** (display, with its `opsz` axis) and **Figtree** (body). Inter, Geist and Space Grotesk are banned by the project's FRONTEND-RULES gate.
  - `--font-display: var(--font-bricolage), "Bricolage Grotesque", system-ui, sans-serif`
  - `--font-body: var(--font-figtree), "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  - (Switched from Inter on 2026-10-19 to meet FRONTEND-RULES #7. Both fonts are SIL OFL, on Google Fonts.)
- **Body:** weight 400, size `--fs-body` = `clamp(1.125rem, 1.08rem + .2vw, 1.1875rem)`, line-height **1.55**.
- **Display / H2:** `--fs-h2` = `clamp(2.125rem, 1.35rem + 3.1vw, 4.25rem)`, weight **600**, line-height **.98**,
  letter-spacing **-.035em**, `text-wrap: balance`. (`.h2` class.)
- **H3:** `--fs-h3` = `clamp(1.375rem, 1.15rem + .7vw, 1.75rem)`.
- **Lead paragraph:** `max-width: 60ch`. Body paragraphs use `text-wrap: pretty`.

Headlines are tight and large; body is comfortable and a touch oversized. Keep the negative tracking on
display text and the near-1 line-height — that compact headline is a signature of the look.

> **Flutter port:** bundle Figtree and Bricolage Grotesque (variable TTFs). Map H2/H3/body to `TextTheme` entries with the weights,
> heights and letter-spacing above. Use `clamp`-equivalent responsive sizing (scale by width) for display.

---

## 3. Space, shape, elevation

| Token | Value | Use |
|---|---|---|
| `--gutter` | `clamp(16px, 4vw, 64px)` | Page side padding |
| `.container` | `min(100% - 2*gutter, 1312px)` | Max content width 1312px, centred |
| `--section-pad` | `clamp(80px, 9vw, 144px)` | Vertical rhythm between sections |
| `--panel-gap` | `clamp(8px, 1.6vw, 24px)` | Gap between colour panels |
| `--panel-r` | `clamp(32px, 4vw, 48px)` | Panel corner radius (large, friendly) |
| `--header-h` | `104px` desktop / `80px` ≤1023px | Fixed header height (shrinks on scroll) |

Radii: panels `--panel-r` (32–48px); buttons are full pills (`999px`); small tiles/icon wells ~12–20px.

Separation (FRONTEND-RULES #18: no drop shadows as default separation). The two tokens are rings, not drop shadows:
- `--shadow-soft: 0 0 0 1px var(--line)`
- `--shadow-lift: 0 0 0 2px rgba(27,44,66,.22)` (hover/raised state)

Separate surfaces with a 1px `--line` border or a tonal step (cream ↔ cream-2). No blurred drop shadows, no colour gradients.

Breakpoints (max-width unless noted): **≤479** (small phone), **≤519/≤767** (phone), **≤1023** (tablet/burger
nav), **≥1024** (desktop, inline nav), **≥1280** (wide). The primary switch is **1024px**: nav goes inline,
below it a burger + full-screen menu.

---

## 4. Motion

Restrained and meaningful. Everything is gated behind JS and `prefers-reduced-motion`, with a visible
**motion toggle** (pause/play) so users can stop it.

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | Default enter/UI easing |
| `--ease-inout` | `cubic-bezier(.65,0,.35,1)` | Symmetric moves |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Playful overshoot (arrows, hops) |
| `--t-micro` | `160ms` | Hover, press, small state |
| `--t-ui` | `320ms` | Header shrink, menu, reveals-in-UI |
| `--t-reveal` | `700ms` | Scroll reveals |

Patterns (driven by `lib/row-fx.js` via data-attributes; GSAP + Lenis smooth scroll):
- `data-reveal` — fade/rise into view on scroll (`data-reveal="fade"` for the softer variant).
- `data-split` + `.w` — headline split into words that hop in (words are `inline-block` so transforms work).
- `data-intro` — hero content revealed on load.
- `data-count` / `data-final` — numbers count up once when the stat row enters view; ROW "wheels" roll in.
- Signature motifs: the **roster wheel**, **sync** animation, **district hub**, and pictures that build in
  view. Press feedback: `scale(.98)` on buttons, `.92` on round buttons.
- **Reduced motion / no-JS:** `html:not(.js)` shows everything statically; `@media (prefers-reduced-motion:
  reduce)` disables transitions. Pre-reveal "hidden" states apply *only* under `html.js`, and a 3s failsafe
  reveals content if the script never starts. **Always ship a correct static state first, then layer motion.**

> **Flutter port:** reproduce the easings as `Cubic(...)` curves and the three durations as constants.
> Respect `MediaQuery.disableAnimations` / an in-app reduce-motion setting. Keep reveals subtle.

---

## 5. Components (from `components/kit.tsx`)

Every component takes **all visible text through props** — no copy baked into the component. Reuse these as
the shared component contract across platforms.

### Buttons (`.btn`)
- Pill shape, `min-height 52px` (`--lg` 60px, `--sm` 44px), weight 650, `gap 12px`.
- `.btn--primary` — azure fill, white text; hover `#12376F`. Optional **arrow chip** (`.btn__arrow`): a
  marigold circle with an ink arrow that slides right 4px on hover.
- `.btn--gold` — marigold fill, ink text (hover `#E59A10`).
- `.btn--ghost` — transparent, `inset 0 0 0 2px --ink` outline, ink text.
- On blue/gold panels, primary inverts to **white fill / azure text**.
- `.round-btn` (48px) and `.motion-toggle` (44px) are circular icon buttons.
- `.magnet` wrapper + `data-magnet` gives the subtle cursor-magnet effect (desktop only).

### Primitives
- **`DemoButton`** — the single recurring CTA ("Book a free demo"), a primary button with arrow linking to the
  demo form. Every "book a demo" across the site routes to `DEMO_HREF`.
- **`Scribble`** — hand-drawn pen line `under` a phrase or `circle` around it (marigold by default; recoloured
  per section). Decorative, `aria-hidden`.
- **`PageHero({title, intro, visual})`** — page opener: H1 + intro + DemoButton + optional visual.
- **`Section({id, title, c, aside, children})`** — one H2 block; pass a tone `c` for a rounded colour panel,
  omit for a plain cream section; `aside` makes it a split layout.
- **`Lead`** / **`Note`** — lead paragraph (60ch) / small note, both reveal on scroll.
- **`CardGrid({items, cols, icons})`** — `"Label: body"` lines become colour tiles (tones cycle), optional
  24-unit line icon per card, slight alternating tilt (`--tilt ±1.2deg`).
- **`ArtCards`** — picture-in-a-colour-well cards (text-free illustration + label + body).
- **`Steps({items, lead, icons})`** — ordered steps; **numbers come from CSS counters, not copy**.
- **`Table({head, rows, highlight})`** — comparison table; `highlight` marks the ROW column; horizontally
  scrollable region with an accessible label.
- **`Faq({items, idPrefix, level})`** — native `<details>` accordion sharing one `name` so only one answer is
  open at a time; plus/minus icon.
- **`Stats({items})`** — number row where each figure sits on a ROW wheel; wheels roll in and numbers count up.

### Iconography & illustration
- **Line icons:** 24×24 viewBox, `fill:none; stroke:currentColor; stroke-width:2.6; round caps/joins` (`.ico`).
  Icon tiles cycle `marigold/mint/coral/azure`.
- **Product mock-ups** use skeleton bars (`.sk`, `.sk--t`, `.sk--m`) as stand-ins for names/figures.
- **Scribbles** are the hand-drawn accent — use sparingly on key phrases.
- **Logo:** full-colour mark; on the dark (ink/azure) footer it sits on a **white plate** with clear space
  (`--footer__logo`, radius 20px). Header logo 76px, shrinks to ~50px on scroll. Keep clear space = cap height.

---

## 6. Accessibility (non-negotiable, port to every surface)

- **Skip link** to `#main`; `main` is focusable (`tabindex="-1"`).
- **Focus ring:** `:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px }` — visible on every
  interactive element. On blue panels the focus colour switches to marigold for contrast.
- `.vh` utility for visually-hidden labels; icons are `aria-hidden` with text alternatives nearby.
- Sections are `aria-labelledby` their heading; headings keep their semantic level.
- Respect reduced motion and provide the motion pause control.
- Colour pairings come pre-set via `--on-c`; don't place text on a tone without using its `--on-c`.

---

## 7. Porting checklist

**Mobile app (Flutter, `row/mobile`)**
1. Bundle Figtree + Bricolage Grotesque (variable) and build a `TextTheme` from §2.
2. Define a `RowColors` class (the §1 hexes) and a `RowTone` enum → `(fill, onFill)`.
3. Define `RowRadii`, `RowSpacing`, `RowMotion` (durations + curves) from §3–§4. No shadow tokens: cards use elevation 0 + a `--line` border.
4. Build the shared widgets from §5 (PillButton with optional arrow chip, ToneCard, Steps with counter,
   Faq accordion, Stat with wheel). Keep text as parameters.
5. Honour platform reduce-motion; ship correct static layout first.

**ROW web application / admin (`row/admin`, Tailwind + Next.js)**
1. Put the §1 tokens on `:root` as CSS custom properties and map them into the Tailwind theme (colours,
   radii, fontFamily; shadow utilities resolve to none). Reuse the exact token names.
2. Reuse the button, card, section, FAQ and table specs from §5 so the portal matches the marketing site.
   Icons: no Lucide (FRONTEND-RULES #12). Admin uses Phosphor through one `components/icons.ts` module.
3. Keep the brand-balance rule (gold = accents, azure = fields) and the focus-ring spec.
4. The admin is denser than the marketing site: keep the tokens and components, tighten `--section-pad`
   and panel radii for application screens rather than inventing new values.

> When any token changes, change it **here first**, then in each surface. Treat this file as the contract.

---

## 8. Application screens (admin portal and mobile app)

Added 29 Oct 2026 for the design overhaul (`docs/plans/row-design-overhaul.md`). Same tokens as §1 to §6; this
section fixes the layout and parts for working screens, which are denser than the marketing site.

### 8.1 Application tokens

| Token | Admin (web) | App (Flutter) | Use |
|---|---|---|---|
| `--app-r-panel` | 10px | 20 | Panels, cards, KPI tiles, dialogs |
| `--app-r-field` | 6px | 12 | Buttons, inputs, selects, tabs. Badges and checkboxes 4px |
| `--app-gap` | 24px desktop, 16px phone | 16 | Space between panels |
| `--app-pad` | 24px desktop, 16px phone | 16 | Inside panels |
| `--app-row-h` | 48px | 64 | Table row / list row height |
| `--app-field-h` | 40px (32px small) | 52 | Input, select, button height. 44px on touch screens |

Type in application screens: page title Bricolage 600 at 28px (phone 24px), line-height 1.1, tracking -.02em;
panel title Bricolage 600 at 18px; body Figtree 400 at 15px (phone 16px), line-height 1.5; table text 14px;
labels Figtree 600 at 13px; numbers in KPI tiles Bricolage 600 at 32px with tabular figures.

### 8.2 Shell (admin)
- **Sidebar** (≥1024px, 264px wide, cream-2 surface, 1px line on the right): logo, scope switcher (role,
  club or district), grouped navigation (group label in ink-soft caps 12px), the active item is an azure pill
  with cream text, icons Phosphor 20px. Below 1024px the sidebar becomes a full-height drawer from a menu button.
- **Top bar** (64px, cream, 1px line below): page title area on the left (breadcrumb 13px ink-soft, then the
  title), on the right the Rotary year switcher, status chips (credits), language picker, user menu. No shadow.
- **Content**: cream background, max width 1312px, `--app-pad` gutters.

### 8.3 Parts
- **PageHeader**: breadcrumb, title, one-line description (ink-soft), actions on the right (one primary pill
  with the marigold arrow chip, the rest outline or ghost). On phone the actions wrap under the title.
- **Panel**: `--app-r-panel`, card surface `#FCFDFE`, 1px line, optional title row (title, short help, actions).
  A tone panel (`data-c`) is used only for summaries and calls to action, never for forms or tables.
- **KpiTile**: card surface, 1px line, label, big number, note. The first tile of a row is the lead figure and the only
  colour field (azure); the rest stay calm. No colour per tile. Numbers count up once (700ms). 4 per row desktop, 2
  tablet, 1 phone. (Admin since 2026-11-25; the app keeps its tone tiles.)
- **ListPage**: PageHeader, filter bar (search field, up to 3 selects, "More filters" sheet), table panel,
  pagination. Table: header row cream-2, 13px caps-free labels, rows 52px, 1px line between rows, hover cream-2,
  row actions in a kebab menu, selected rows with a sky fill. Phone: each row becomes a stacked card (title,
  2 to 3 key fields, actions).
- **FormPage**: PageHeader, form in sections (Panel per section, two columns ≥1024px, one on phone), label
  above field, help under field in ink-soft, error under field in error red with an icon, required marked in
  text. Sticky action bar at the bottom of the viewport (Cancel ghost, Save primary).
- **DetailPage**: header with avatar or image, name, status badges, actions; tabs (pill tabs) for sections;
  key facts in a 2-column description list.
- **Dialog**: `--app-r-panel`, max 560px, title, body, actions right; destructive confirm uses a red primary.
- **Tabs**: pill tabs on cream-2 track; the active tab is ink text on card surface with a 1px line.
- **Badge / status**: pill, 12px, tinted fill with the matching dark text (success, warning, error, neutral,
  azure).
- **EmptyState**: line illustration or icon in a tone well, one sentence, one action.
- **ErrorState**: what failed in plain words, a Retry button, no stack traces.
- **Skeleton**: well-coloured bars with a slow light band, in the shape of the content (table rows, tiles, form fields). Every async area.
- **Toast**: bottom right (phone: bottom), card surface, 1px line, icon by status.
- **Charts**: series colours azure, marigold, mint, coral, lilac in that order; 1px line gridlines; no shadows
  or gradients; values in the tooltip and in an accessible table.

### 8.4 Mobile app
- **App bar**: cream, title Bricolage 20px, back button 44px round; no elevation, 1px line under when scrolled.
- **Bottom navigation**: 4 to 5 items, active item azure pill behind the icon with label, cream background,
  1px line above.
- **Home**: greeting and role chip, a tone hero card (next meeting or key number), a 2-column grid of module
  tiles (ToneCard, cycling tones), then lists (upcoming events, announcements).
- **List row**: 64px, avatar or icon well (12px radius), title 16px, subtitle 14px ink-soft, trailing value or
  chevron; 1px line divider inset from the text.
- **Section header**: Bricolage 18px with an optional "See all" text button.
- **Forms**: one column, 52px fields, labels above, sticky bottom action with a full-width PillButton.
- **Sheets**: bottom sheet with 20px top radius and a grab handle for filters and actions.
- Empty, error and skeleton states as in §8.3.

### 8.5 Rules that apply on every screen
- One primary action per screen region. Destructive actions are never primary on the page, only in the dialog.
- Gold appears as the arrow chip, icons, active underline or rule, never as a panel fill.
- No pure white page backgrounds, no shadows, no gradients, no em dashes or emoji in copy (FRONTEND-RULES).
- Every interactive element has the §6 focus ring; touch targets are at least 44px.

### 8.6 Mobile layout rules (added 29 Oct 2026 after the user's review)

The first app pass changed the look; these rules fix the layout. Every screen follows them.
- **App bar:** title left-aligned (Android convention), back button on the left, at most two actions on the
  right (icons or one short pill such as "Admin"). Nothing floats over content.
- **One primary action per screen.** List screens: the floating "+" (flat azure pill, bottom right). The empty
  state then explains it ("Tap + to ...") and does not repeat it as a second button. Lists leave 88px at the
  bottom so the last row scrolls clear of the "+".
- **Filters:** search field full width, then filter chips starting at the left edge (scroll sideways if they do
  not fit). Never centred.
- **List rows:** title 16/600, one secondary line (14, ink-soft), optional quiet meta line ("Male · O+"), row
  actions in a trailing "more" menu. No permanent red delete buttons on rows; destructive items live in the menu.
- **Tabs:** light: ink labels, the active tab on a sky pill, no coloured band, no divider.
- **Empty, error and loading states:** placed in the upper third of the free space, max 320px wide, 88px icon
  well in sky, title 20, text 15. Loading uses skeleton rows.
- **Colour:** module groups and icons use the brand azure only; status colours only for status.

### 8.7 Admin surfaces and motion (2026-11-25, owner: white is too much for the eyes, add smooth transitions)

Admin only; the public site, the app and paper keep the §1 whites.

| Surface | Hex | Text on it |
|---|---|---|
| Ground (page, top bar) | `#E6ECF3` | ink 11.9:1, ink-soft 5.3:1 |
| Card, dialog, menu | `#F4F7FA` | ink 13.2:1, ink-soft 5.9:1 |
| Field | `#F7F9FC` | |
| Well (sidebar, tab track, table head, skeleton) | `#DCE5EF` | ink 11.1:1, ink-soft 5.0:1 |

Ink-soft is `#526177` in the admin (`#64748B` is too light on these). Text on azure is `#F4F7FA` (8.6:1). Marigold stays an accent:
never text smaller than 24px, never a fill. Values live in `admin/src/app/globals.css` and `astryx/fellowshipTheme.tsx`.

- **Sidebar**: grouped, Phosphor icons 18px, 38px rows (44px in the drawer), 12px radius azure pill that glides to the
  new item. It opens scrolled to the current page.
- **Titles once**: a page with its own h1 keeps it; the top bar then shows the name as a quiet 14px label.
- **Navigation**: 3px marigold bar on top; the old page stays and softens to 50%. Never a full-screen loader.
- **Enter**: panels and tiles rise 10px and fade, 420ms ease-out, 45ms apart, at most 220ms late. Table rows fade, 25ms
  apart for the first ten. Bars grow from the left, 800ms. A new page fades in, 240ms.
- **Feedback**: buttons press to .98 (160ms); tab and menu pills glide 360ms; dialogs and menus land on ease-out and
  leave in 120ms.
- Transform and opacity only, except the pill's own width (out of flow). Reduced motion turns all of it off. Print and
  the PDF copy of a page (`.row-paper`) are white and still.

### 8.9 Admin: fixed parts (2026-11-25, owner: no fixed layout, different headers, too round buttons, no card design)

These win over 8.1 to 8.3 and 8.7 for the admin. A page is put together from these components and styles none of them.
`src/lib/designParts.test.ts` fails when a page builds its own.

| Part | Component | Rule |
|---|---|---|
| Frame | `dashboard/ShellFrame`, `AppFrame` for pages outside a dashboard | Sidebar 264px, top bar 56px, content up to 1400px. Super Admin and older pages too |
| Top bar | `dashboard/TopBar`, `TopBarAccount` | Left: whose data (club, district, role). Right: status, year, help, language, notices, account. Never a page title |
| Page header | `row/AppKit` `PageHeader` | One per page: back, 24px title, one 14px line; actions on the right. Tabs come under it |
| Button | `ui/button`, `ui/icon-button` | 40px or 32px, 6px corners. Primary (azure), outline, ghost, destructive. One primary per area |
| Card | `ui/card`, `Panel`, `form/SectionCard` | 10px corners, one line, 20px padding, 16px heading. Never a card inside a card |
| KPI | `KpiTile` | All tiles alike, figure in azure |
| Field | `ui/input`, `ui/native-select`, `ui/select`, `ui/textarea`, `form/FieldLabel`, `form/RadioPill` | 40px, 6px corners, 13px label; a red star marks required, no bullets |
| Table | `ui/table` or plain table inside a Card | Well head, 13px, sentence case, no navy heads |
| Badge | `ui/badge`, `PublishStatusBadge` | Tinted, 4px corners, 12px |
| Tile that opens a page | `.row-tile` | One azure icon on a well; no colour per tile |
| Small buttons (2026-11-27) | `ui/text-buttons`: `LinkButton` (tone primary / danger / muted), `ToggleButton` + `FilterChips` (pressed), `ClearButton` (x in a field), `RemoveBadgeButton` (x on an image), `MenuItemButton` (row in a list) | Text action in a sentence or cell = LinkButton; filter or view switch = ToggleButton; never a hand-written `<button>` |
| List table (2026-11-27) | `ui/data-table` `DataTable` (columns, rows, loading rows, empty row, sort, `rowClassName`); `MatrixTable` for dense goal and report grids | Irregular tables (rowSpan, inline edit rows) use the `ui/table` parts; `<Table bare>` inside its own scroll box keeps a sticky head |
| Icon-only button | `ui/icon-button` | Always an `aria-label`; defaults to `type="button"`; disabled keeps its title tooltip |

Values: `--r-*` and `.row-*` in `globals.css`. The public site keeps its own corners (`.site-shell`).

### 8.8 Mobile motion and bento (2026-11-25, owner: the app is too plain; add transitions, load animation, a bento grid)

Code: `mobile/lib/presentation/widgets/row/` (`motion`, `roster_wheel`, `bento`, `handshake_logo`, `skeleton_list`),
`mobile/lib/core/theme/row_page_transitions.dart`, values in `RowMotion` (`row_tokens.dart`). Use these, not one-off values.

- **Cold start:** the two hands of the logo reach in and meet, the name rises, the logo glides on to the next screen.
- **Pages:** a page opened from a tile or row grows out of it and shrinks back (`RowPressable(morph: true)`); sign-in
  screens fade through; other pages slide 56px and fade. 340 to 420ms, 320ms back. iOS keeps its own push (swipe back).
- **Arrival:** rows and tiles rise 18px and fade, 420ms, 45ms apart, first eight only. Never while scrolling.
- **Roster wheel** (members around a rim, one gold): busy mark and pull to refresh only, never on a tile or card (owner
  2026-11-25). Gold is an accent on the wheel, never a tile fill.
- **Loading:** skeleton rows for a page, the wheel for a small box. Buttons keep their colour and size and show the wheel.
- **Feedback:** press to .97, dialogs settle (.95 to 1), result messages pop their icon with a light haptic (errors
  medium), numbers count up and bars fill over 900ms, tabs stretch between labels. Nothing loops except busy marks.
- **Bento:** four columns (eight on tablets), 10px gaps, `RowBento.spans` keeps any group flush. Tall tiles azure then
  lilac, short ones sky and cream-2. On home: districts azure, clubs you run sky, clubs you belong to cream-2.
- **Reduced motion:** everything is in place at once; pages cross-fade. One rule, `RowMotion.still`.
