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
