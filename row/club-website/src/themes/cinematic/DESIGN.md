# Cinematic — design guide for page agents

The club's year as a film: **night** grounds, one **gold** light source, **royal** panels. Every
page opens like a projector (the `PageHero`), titles rise out of their line like title cards,
and one moment per page is the "feature" — a reel, a dealt hand of cards, a slate, a wipe.
Everything else is calm, dark and readable.

Read `../README.md` first (wiring, data, CSS scoping, checks). Look at `Home.jsx` for every
helper below used on live data. You own only `pages/<Page>.jsx` + `pages/<Page>.css`.

---

## 1. Tokens (declared on `html[data-theme="cinematic"]`, use them — never raw hex)

| token | value | use |
|---|---|---|
| `--cin-night` | #070B1A | page ground |
| `--cin-night-2` | #0D1633 | raised surfaces, inputs, empty frames |
| `--cin-night-3` | #0A1026 | alternate band |
| `--cin-deep` | #050816 | footer |
| `--cin-royal` / `--cin-royal-2` | #17458F / #123673 | panels, pills, the meeting finale |
| `--cin-gold` / `--cin-gold-hi` | #F7A81B / #FFBE45 | the ONE accent: figures, active, primary buttons, focus |
| `--cin-ink` | #F3F5FB | text |
| `--cin-mist` | #A7B3D1 | secondary text (never on royal - 4.4:1) |
| `--cin-line` / `--cin-line-2` | mist @ .18 / .32 | hairlines, borders |
| `--cin-glow` | gold @ .45 | hover glow shadows |
| `--cin-hh` | 72px (64 < 600px) | sticky header height (pins start below it) |
| `--cin-side` | max(pad, 50% - 660px) | side gutter = 1320px max measure; use as `padding-inline` |
| `--cin-sec-y` | clamp(72px, 10vw, 150px) | section vertical padding |
| `--cin-r-sm` / `--cin-r` / `--cin-r-lg` | 12 / 18 / 24px | radii |
| `--cin-ease` | cubic-bezier(.16,1,.3,1) | CSS transitions |
| `--cin-wide` / `--cin-cond` | 125% / 62% | `font-stretch` for titles / figures |

**Type — one family, Archivo, three widths.** `font-family: var(--cin-sans)` is already on body.
- **Expanded** (`font-stretch: var(--cin-wide)`, 720–820 weight, often UPPERCASE) — titles, names, the day.
- **Normal** (100%, 400–600) — reading text, 17px/1.6 body; 15px for card text; mist for secondary.
- **Condensed** (`font-stretch: var(--cin-cond)`, 800, gold, `font-variant-numeric: tabular-nums`) —
  every figure, time, date number, count. Figures are always condensed gold.
- Big display words: `clamp()` + `overflow-wrap: anywhere` so "Wednesday", "Karkhanis",
  "Newsletters" fit at 390px. Grid tracks that meet API text: `min-width: 0`.

Contrast is pre-measured for these pairs only: ink/mist/gold on night & night-2, ink/gold(large) on
royal, night on gold. Don't invent new pairs.

## 2. Page structure

```jsx
import { usePageName, PageHero, SectionHead, Button, Arrow, EmptyState, Loading } from '../kit.jsx'
import { useScene, riseIn, cleanups } from '../motion.js'
import './Directory.css'

export default function Directory() {
  const name = usePageName('Directory')          // club's own menu label or fallback + <title>
  const members = useDirectoryData()             // null while loading
  return (
    <div className="cin-dir">
      <PageHero title={name} lede="…" meta={<ResultCount count={n} noun="member" />} />
      {members === null ? <Loading /> : members.length === 0
        ? <div className="cin-sec"><EmptyState title="No members listed yet" message="…" /></div>
        : <section className="cin-sec" aria-labelledby="cin-dir-h">…</section>}
    </div>
  )
}
```

- **`PageHero` is mandatory and holds the page's only `<h1>`.** Crumbs default to `Home / {title}`;
  detail pages pass `crumbs={[{ label: 'Projects', href: '/projects' }, { label: title }]}`.
  Titles over 26 chars automatically switch to the sentence-case long style. `backdrop={photoUrl}`
  projects a blurred copy of a photo behind the band (detail pages). It animates itself.
- Sections: `<section className="cin-sec">` (side gutter + vertical rhythm) with a
  `<SectionHead title="…" id="…-h" />` and `aria-labelledby`. Alternate bands with
  `background: var(--cin-night-3)` or a royal radial glow at a corner — never flat light fills.
- Headings below h1: h2 for sections, h3 for cards (kit cards default to h3; `level` prop changes it).

## 3. Kit (`../kit.jsx`) — styles live in theme.css

| component | props | notes |
|---|---|---|
| `usePageName(fallback)` | → string | menu label or fallback; sets `<title>`. Detail pages call `usePageTitle(itemTitle)` instead. |
| `PageHero` | `title, crumbs?, eyebrow?, lede?, meta?, backdrop?, children?` | the `<h1>`, crumbs, projector entrance |
| `Crumbs` | `items [{label, href?}]` | used by PageHero; last item = current |
| `SectionHead` | `title, id, action?, lede?, as='h2'` | letters rise when scrolled in (self-animating) |
| `Button` | `href?, variant 'gold'\|'line'\|'text', external?, small?, magnet=true` | `<a>` with href else `<button>`; external adds new-tab + sr text; magnetic on mouse automatically |
| `ChipGroup` | `label, options [{value,label,count?}], value, onChange` | filters/tabs as `aria-pressed` buttons |
| `SearchField` | `value, onChange, label, placeholder?, inputRef?` | labelled input + clear button; `inputRef` to return focus after "clear filters" |
| `ResultCount` | `count, total?, noun, plural?` | `aria-live="polite"`: "3 of 120 members" |
| `StatRow` | `items [{label, value, format?, text?}]` | condensed gold figures that count up; `format: (n) => formatMoney(n, currency)` |
| `DateStamp` | `day, mon, year?, weekday?` | clapperboard date: big condensed day + month/year |
| `Pill` | children | royal pill (avenue, category) |
| `FrameCard` | `href, img, fallbacks?, title, meta?, text?, layout 'grid'\|'reel', external?, as='li', level=3` | film-frame card; title link stretched over the card; gold ring on hover/focus; blank frame when no photo |
| `PanelCard` | `title, date?, kicker?, children?, foot?, as='li'` | royal radial tile (newsletters, notices, a highlighted item); `kicker` (a DateStamp) sits above the title and is read first |
| `PersonCard` | `name, role?, img, bio?, href?, as='li'` | 4:5 portrait + holo foil/glare layers; initials when no photo |
| `EmptyState` | `title, message?, action?, as='h2'` | designed "nothing yet" card (film-leader mark) |
| `NotFound` | `title, message, backHref, backLabel, crumbs?` | a whole page (includes PageHero + h1) |
| `Loading` | `label?` | flickering reel strip, `role="status"` |
| `SocialLinks` | `socials` | round icon links (About page) |
| `Logo` | `sources[], alt, className` | img that walks a fallback chain |
| `useModal(open, returnRef, focusSel?)` | — | a dialog portalled to `<body>` (PhotoLightbox, a page panel): `.cin-site` inert, scroll + Lenis stopped, focus in (`.pdm-lb__close` by default, `null` = the dialog focuses itself), back to `returnRef.current` on close; stacks |
| `.cin-prose` (class) | + `demoteH1(html)` | the look for the club's own rich HTML (about, bios, descriptions): pasted colours/fonts/backgrounds reset, gold links, tables scroll; always pass the HTML through `demoteH1` |
| helpers | `clubNames(name)`, `cutText(s, n)`, `yearText(label)` ("2025–26"), `Arrow`, `ArrowBack` (back links), `ArrowOut` (new tab), `Pin`, `Chevron`, `ADMIN_URL` | also re-exported: `PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError` |

Shared CSS classes you can use directly: `.cin-sec`, `.cin-wrap` (gutter only), `.cin-h2`,
`.cin-sr`, `.cin-track` + `.cin-reel` / `.cin-reel__stage` / `.cin-reel__bar > span` (the reel),
`.cin-stats`, `.cin-chips`, `.cin-count`.

## 4. Motion (`../motion.js`) — GSAP only, always inside `useScene`

```jsx
const ref = useRef(null)
useScene(ref, (c, ctx) => {          // c = { motion, wide, fine }; runs only when motion is allowed
  const off = cleanups()
  riseIn(ref.current.querySelectorAll('.cin-card'))
  if (c.fine) off(holoTilt(ref.current.querySelectorAll('.cin-pcard')))
  off(afterFonts(ctx, () => lettersFloat(ref.current.querySelector('.cin-x__vis'))))
  return off.run
}, [dataSignature])                   // pass the loaded data so the scene builds on the real DOM
```

| helper | what it does |
|---|---|
| `riseIn(targets, {trigger, start, y=40, x, stagger=.1})` | house entrance: rise + fade, once |
| `titleIn(el)` | title-card letters rise out of their line (inside `afterFonts`) — SectionHead/PageHero already do it |
| `wipeIn(targets, {radius=24})` | tiles wipe open from the bottom edge, contents rise |
| `dealIn(targets)` | cards dealt in from below in 3D |
| `holoTilt(cards)` → cleanup | pointer tilt + holographic glare on `.cin-pcard` (call under `c.fine`) |
| `lightWords(el)` | words light up as the passage scrolls (aria-hidden copy + sr twin, keyed on text) |
| `lettersFloat(el)` | letters float up, scrubbed (aria-hidden copy + sr twin; not near page bottom) |
| `countUp(el, value, format)` → cleanup | figure counts up once |
| `parallax(imgs, {amount=8, containerAnimation?})` | picture drifts inside its frame |
| `reel({section, stage, track, bar, refreshPriority})` → cleanup | pinned horizontal film reel (wide only) |
| `projectorOpen(el)` | slit-of-light → full frame reveal (timeline-able) |
| `panelOpen(el, {wide})` | framed panel opens to full bleed, scrubbed |
| `splitChars(el, aria)` | SplitText words+masked chars (your own sequences) |
| `headerH()` | header height now — use for pin `start: () => 'top ' + headerH() + 'px'` |
| `rowsOf(els)` | grid items grouped into visual rows, so each row can `riseIn`/`wipeIn` on its own trigger |
| re-exported | `gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages, scrollToY, lockScroll, prefersReducedMotion, cleanups, EXPO` |

Rules that break pages if ignored:
1. **No hidden start states in CSS.** Everything is visible with motion off; helpers use `from`.
2. **Pinned sections:** own component, its `useScene` inside it, the pinned `<section>` the ONLY
   child of a plain wrapper `<div>` that component always renders; give pins `refreshPriority`
   (higher = further up the page), start below the header, and only on `c.wide`. Phones stack.
3. **Anything SplitText splits or a tween rewrites** (`lightWords`, `lettersFloat`, count-ups)
   holds a single string child and is keyed on it (`key={text}` / `key={value}`).
4. Hover styles on tweened elements go on a child (GSAP writes inline transforms).
5. `opacity:0` slides/cards also get `visibility:hidden; pointer-events:none`.
6. Magnet: nothing to do — `Button` (or any `.cin-magnet`) is magnetic site-wide on a mouse.
7. Call `useRefreshOnImages(ref, [data])` in a section whose photos change heights.

## 5. Page directions

Each page: the `PageHero`, then **one memorable moment**, then calm, scannable content.

**About** (`useAboutData`) — *The screening notes.* Hero lede = none (the club's words carry it).
First block: the club's copy (`d.html`, render like Gold with `dangerouslySetInnerHTML` in a
`.cin-about-prose` column, max 68ch, ink on night, gold links, h2/h3 in expanded). Moment: a
royal **meeting slate** beside/after the text — day in expanded gold UPPERCASE with
`lettersFloat`, time condensed, venue, `Button` "Open in Maps" (external). Then President &
Secretary as two `PersonCard`s (`dealIn` + `holoTilt`), club logo on a white rounded plate,
contact email/phone only as Gold shows them, `SocialLinks`. Phone: single column, slate full width.

**Directory** (`useDirectoryData` → null | members) — *The cast list.* Hero meta = `SearchField`
+ `ResultCount noun="member"`. Grid of compact cast cards: round 88px portrait (`PersonPhoto`,
initials fallback), name expanded 700, profession in mist; 4 cols ≥1100, 2 at 600, 1 on phone
(or 2 compact). Moment: an **A–Z strip** (`ChipGroup` of initials present, aria-pressed) and on
filter change the grid re-runs `riseIn` (key the grid on the query). Hundreds of members: no
per-card heavy motion; a single batched `riseIn` with small stagger (≤ .02). Empty search →
`EmptyState` "No members match …" with a clear button.

**Directors** (`useDirectorsData`) — *The billing.* President (first row) as a large feature:
portrait left, name huge expanded, role gold, intro in mist. Everyone else as `PersonCard`s in
a 4/2/1 grid, `dealIn` + `holoTilt` (the home's leader cards — same component). Bios clamp to 4
lines on cards; the feature shows the full intro. One director → feature only.

**Calendar** (`useCalendarData(year, month)`) — *The call sheet.* Hero meta = month switcher
(prev/next `Button variant="line" small`, current month in expanded; buttons have text labels).
Moment: the month as a **strip of slates** — three columns (Birthdays, Anniversaries, Events),
each row a `DateStamp` + name/photo; days with anything get a gold dot in a compact 7-col
mini-month (buttons, `aria-pressed` for the selected day filters the lists). Empty month →
`EmptyState` per column, never blank. Phone: tabs (`ChipGroup`) instead of three columns.

**Projects + ProjectDetail** (`useProjectsData(isCE)`, `useProjectData(pid)`) — *The reel and the
feature.* Projects: hero meta = `StatRow` (cost via `formatMoney(v, currency)`, beneficiaries,
man-hours, rotarians; while `metricsPhase === 'loading'` pass `text: '—'` so nothing counts from 0) + avenue
`ChipGroup` (honours `?pr=` pre-selection exactly like Gold) + `SearchField` + `ResultCount`.
Grid of `FrameCard layout="grid"` (Pill avenue + date meta, 3/2/1 cols). Moment: the first
filtered result row enters with `riseIn({x:80, y:0})` like frames sliding into a gate; optional
"Latest" reel of the top 6 using `reel()` on wide. ProjectDetail: `PageHero` with
`backdrop={p.img}`, long title style, crumbs Projects / title (`?pr=CE` → back to
`/projects?pr=CE`), then the main photo in a 16:9 lit frame (white-free, `object-fit: contain` on
night-2) with `parallax`, `StatRow` of the four metrics, the description (paragraphs), photo strip
(PhotoLightbox), child updates as a vertical timeline of `FrameCard`s, share row
(`useProjectShare`). Unknown pid → `NotFound` "Project not found", back to Projects.

**Events + EventDetail** (`useEventsData`, `useEventData(id)`) — *Coming attractions.* Events:
next event as a big royal "now showing" panel (like the home's Coming up card: photo + `DateStamp`
+ title + venue + "Event details"), then the rest grouped by `monthLabel` as rows: `DateStamp` |
title/venue | arrow — a programme listing. Moment: month captions as expanded outline titles that
`titleIn`; rows `riseIn`. No events → `EmptyState` "No upcoming events this Rotary year".
EventDetail: `PageHero` (backdrop = event image, eyebrow = weekday), `DateStamp` large, venue,
registration `Button` (external) when `reg`, description HTML, "All events" back link. `ev ===
false` → `NotFound` "Event not found".

**PastPresidents** (`usePastPresidentsData` → newest first) — *The credits roll.* Moment: a tall
**credits column** — year (condensed gold) left, name (expanded) right, centred, rows rising as
you scroll (`riseIn` per batch of ~12, or a scrubbed y drift). A `SearchField` in hero meta for
long rolls. Photos where present as small round portraits; missing photos never leave gaps
(initials). ~100 rows must stay light: no per-row pin, no per-row SplitText.

**Newsletters** (`useNewslettersData` → null | items with `monthLabel`) — *The press kit.* Latest
newsletter as a wide `PanelCard` with a big expanded title and "Read newsletter" (external, PDF noted
in sr text ONLY - no visible PDF tag); archive grouped by month as `PanelCard`s in 2/1 cols with
`wipeIn`, no per-month count. `SearchField` + `ResultCount noun="newsletter"` in hero meta, no lede;
filtering re-groups months (see Gold). Empty → EmptyState. Client rule (2026-09-25): the word is
"newsletter" everywhere, never "issue".

**Gallery** (`useGalleryData(page)`, `?page=`) — *The contact sheet.* Masonry-ish grid of photos
as film frames (rounded 18px, night-2 ground, `object-fit: cover`), each a button opening
`PhotoLightbox` (Esc, focus return). Moment: frames develop in — `fromTo` filter
`brightness(.2) saturate(0)` → `brightness(1) saturate(1)` with `riseIn`, batched per row (always
`fromTo` for filter). Caption on hover/focus = project title. Pager: Previous / page numbers /
Next as links to `/gallery?page=n` (`aria-current="page"`), 44px targets.

**Dignitary** (`useDignitaryData(type)`, `?Type=1|2`) — *The feature presentation.* `PageHero`
eyebrow = role ("RI President" / "District Governor"), title = name (long style), meta = year.
Moment: the portrait in a big lit **screen frame** (white-free, 4:5, gold glow behind, `holoTilt`
on fine pointer) beside the bio (`bioHtml`, readable column). A switcher (`ChipGroup` or two
`Button`s) between RI President and District Governor. Not found → EmptyState naming the role
"hasn't been published for this Rotary year".

## 6. Do / don't

- **Do** use only `cin-` classes; name page classes `cin-<page>-*` (`cin-dir-grid`,
  `cin-pp-row`, `cin-cal-slate`). Scope any element selector under `.cin-<page>` root.
- **Do** read every field from the hook (see goldData.js / homeData.js); handle `null` (loading),
  `[]` (empty), one item and hundreds; `formatMoney(v, currency)` for money.
- **Do** keep tap targets ≥ 44px, focus visible (gold outline is global), one `<h1>` (PageHero).
- **Don't** use Tailwind utility classes, `.reveal`, `data-count`, `data-split`, `data-tilt`,
  `data-magnetic`, `[data-slider]`, `.route-enter` — theme.css recolours Tailwind classes for
  fallback pages, and rotary-anim.js owns those hooks.
- **Don't** put light backgrounds behind text (white is only a photo/logo plate).
- **Don't** invent copy, figures or quotes; sentence case; plain words.
- **Don't** pin on phones or pin anything taller than the viewport.
- **Don't** transform the element that holds a stretched link (`a::after { inset: 0 }`) or any
  ancestor below the card: a transform makes it the `::after`'s containing block and the card's hit
  area shrinks to that box (hence `.cin-pcard.is-tilt` lifts the text only on link-less cards).
- **Do** size big display words with `--lw` (longest word) using the measured Archivo widths:
  ~0.95em per char at 125% uppercase, ~0.76em at 118% sentence case. A smaller factor lets
  "NEWSLETTERS" break mid-word.
- **Do** give focus back in a `requestAnimationFrame` from a layout-effect cleanup: React restores
  its own saved focus after the commit and undoes a synchronous `focus()` there.
