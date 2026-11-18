# Liquid Motion — design guide for page agents

Theme key `liquid-motion`, prefix `liq-`, preview http://localhost:8102/ (hot reload; never start a server).
Design authority: `Theme8-Samples/E-liquid-webgl/index.html` (the approved home). This folder already
has the shell (`Site.jsx`), the home (`Home.jsx`), the kit (`kit.jsx`), the motion helpers
(`motion.js`, WebGL in `gl.js`) and the styles (`theme.css`, `home.css`). **You write only
`pages/<Page>.jsx` + `pages/<Page>.css`.** Read `../README.md` first (routes, data, CSS rules, checks).

The site in one line: **ink and paper bands with a liquid top edge, electric Rotary azure and gold,
huge Unbounded type that sweeps in, Instrument Serif italic accents, numbers that roll, photos that
arrive through a liquid wipe (WebGL on desktop).** Every page must feel like the home page continued.

---

## 1. Tokens (declared on `html[data-theme="liquid-motion"]` — use `var(--liq-…)`, never raw hex)

| token | value | use |
|---|---|---|
| `--liq-ink` / `--liq-ink-2` / `--liq-ink-3` | #0A0A0F / #14141C / #1D1D28 | dark bands / panels on ink / chips-in-panels |
| `--liq-ink-line` | rgba(255,255,255,.13) | hairlines on ink |
| `--liq-paper` / `--liq-paper-2` | #F6F5F1 / #ECEAE3 | light bands / image ground on paper |
| `--liq-paper-line` | rgba(10,10,15,.13) | hairlines on paper |
| `--liq-azure` | #0067C8 | **fills only** (azure band, row flood on ink) |
| `--liq-azure-ink` | #0057A8 | azure **text/links on paper** (6.6:1) |
| `--liq-azure-hi` | #4DA3FF | azure text/links/outlines **on ink** (7.5:1) |
| `--liq-gold` | #F7A81B | accents on ink, the gold band. **Never text on paper or azure.** |
| `--liq-mute` / `--liq-mute-p` | #A3A3B2 / #55555F | secondary text on ink / on paper |
| `--liq-hh` | 76px (64px < 600px) | header height — the header OVERLAYS the page top |
| `--liq-pad` | clamp(16px,4vw,48px) | side gutter |
| `--liq-max` | 1344px | content width (`.liq-wrap`) |
| `--liq-r` | clamp(16px,2vw,28px) | big radius (hero stage, posters) |
| `--liq-display` | Unbounded | display (600–800) |
| `--liq-serif` | Instrument Serif | italic accents only |
| `--liq-sans` | Geist | everything you read |
| `--liq-ease` | cubic-bezier(.2,.7,.1,1) | CSS transitions |

**Band semantics — style your page with these, not with the colours above.** Every band re-points
them, so the same component works on ink, paper, azure and gold:
`--liq-bg` (ground) · `--liq-fg` (text) · `--liq-fg-2` (secondary text) · `--liq-line` (hairline) ·
`--liq-accent` (kicker/eyebrow: gold on ink, azure-ink on paper, white on azure, ink on gold) ·
`--liq-link` · `--liq-stroke` (outlined type) · `--liq-focus` · `--liq-card` (panel ground).

Band tones (`<Band tone>`): `ink` (default), `ink2`, `paper`, `azure`, `gold`. Rhythm rule:
**alternate** — ink hero → paper → ink/azure → paper … never two paper bands in a row; gold is the
"something happens here" band (meeting, next event, newsletters). The footer is ink, so end on
paper or gold.

## 2. Type

| class | spec | where |
|---|---|---|
| `liq-ph__name` (via `<PageHero>`) | Unbounded 700, up to 140px, auto-fit | the page's one `<h1>` |
| `liq-bigtitle` (via `<SectionHead big>`) | Unbounded 800 up to 176px, 2nd line outlined | at most one per page |
| `liq-h2` | Unbounded 600 clamp(34–88px) | section titles |
| `liq-h3` / `liq-h3--sm` | Unbounded 600 22–30px / 15px | card + panel titles |
| `liq-kicker` | Geist 600 12.5px, .18em caps, leading rule, `--liq-accent` | above every h2 |
| `liq-lede` | Geist 17–20px `--liq-fg-2`, ≤ 60ch | intros |
| `liq-prose` | Geist 17.5px/1.7, ≤ 68ch, first para larger | admin HTML (about, bios, descriptions) |
| `liq-serif` / `liq-em` | Instrument Serif italic | one accent phrase, never a paragraph |
| `liq-outline` | transparent fill, 1.5px `--liq-stroke` | giant decorative words |
| `liq-link` | underlined link, 44px target | inline "All newsletters" style links |

Display words never break inside a word. The kit sizes them with a fit: set `style={{'--liq-lw': longestWord(text)}}`
(PageHero/SectionHead/Home already do). If you set big display type yourself, use the same formula:
`font-size:min(<vw>, <max>px, calc((100vw - 2*var(--liq-pad)) / (var(--liq-lw) * .8)))` — "Wednesday",
"Karkhanis", "Newsletters" must fit at 390px.

## 3. The page skeleton (copy this)

```jsx
import { useRef, useState } from 'react'
import { useClub, useCurrentMenuName, usePageTitle, useDirectoryData } from '../../_shared/data.js'
import { PageHero, Band, SectionHead, SearchField, ResultCount, EmptyState, Loading, Portrait } from '../kit.jsx'
import { usePageMotion } from '../motion.js'
import './Directory.css'

export default function Directory() {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directory'
  usePageTitle(title)
  const members = useDirectoryData()            // null while loading
  const [q, setQ] = useState('')
  const ref = useRef(null)
  usePageMotion(ref, [members, q])              // reveals, rules, numbers, photos… from class hooks

  const list = (members || []).filter(/* … */)
  return (
    <div className="liq-dir" ref={ref}>
      <PageHero title={title} pre="Our members" ghost={members ? String(members.length) : null}
                lede="Everyone in the club, A to Z.">
        <SearchField label="Search members by name or profession" value={q} onChange={setQ} />
      </PageHero>
      <Band tone="paper" aria-labelledby="liq-dir-h">
        <SectionHead kicker="A to Z" title="Members" id="liq-dir-h" />
        {members === null ? <Loading label="Loading members" /> : (
          <>
            <ResultCount count={list.length} total={members.length} one="member" many="members" />
            {list.length ? <ul className="liq-dir-grid">{/* cards */}</ul>
              : <EmptyState title="No members match" text="Try another name or profession." />}
          </>
        )}
      </Band>
    </div>
  )
}
```

Rules baked into that skeleton:
- **The page's first element is `<PageHero>`** (or `<NotFound>`). It pads for the overlaying header,
  prints the breadcrumb `Home / <page>` and the page's only `<h1>`, and plays the entrance once.
  Never add another `h1`; never put content above it.
- Title = the club's own menu label (`useCurrentMenuName()`), falling back to the page name; the same
  string goes to `usePageTitle`.
- Wrap the page in one root `<div className="liq-<page>" ref={ref}>` and call `usePageMotion(ref, deps)`
  once with everything that changes the DOM (loaded data, filter state, page number).
- Loading = `<Loading>`; nothing = `<EmptyState>`; unknown id = `<NotFound>`. Never a blank band.

## 4. Kit (`import { … } from '../kit.jsx'`)

Layout
- `<Band tone="ink|ink2|paper|azure|gold" edge={true} bleed={false} tight={false} as="section" className id aria-labelledby ref…>` —
  full-width band with the liquid top edge; children go in the 1344px `.liq-wrap` unless `bleed`.
  `tight` = half padding. Set `edge={false}` when the band above has the same colour.
- `<SectionHead kicker title id lede action as="h2">` or `<SectionHead kicker big={['Past','presidents']} id>`
  (giant two-line title, line 2 outlined; sweeps in from both sides on scroll).
- `<Kicker as="p">` · `<Card as="div">` (white panel on paper / ink-2 panel on ink) ·
  `<Facts items={[['Meets','Thursday · 7:30 PM'], ['Venue', venueNode]]} />` (dl rows, drops empty values).

Page opening
- `<PageHero title pre crumbs lede ghost image imageAlt>{controls}</PageHero>`
  - `crumbs` `[{label, href?}]` after Home (default `[{label: title}]`; last item = current page).
    Detail pages: `[{ label: 'Projects', href: backHref }, { label: shortTitle }]`.
  - `pre` serif-italic line above the title ("Our members"); `lede` 1–2 sentences.
  - No "Rotary year" label above any title (client, 2026-09-28) - PageHero has no meta slot.
  - `ghost` giant outlined word/number drifting behind (a count, a year, a month) — decorative; its drift
    rebuilds when the value changes, so a ghost that arrives with the data drifts too.
  - `image` + `imageAlt`: a 16:7 photo under the title that wipes up (detail pages).
  - children: search, chips, stat row — they fade in under the lede.
  - Long titles size themselves down (> 20 chars md, > 44 chars sm).
- `<Crumbs items>` alone, if you ever need it. `<NotFound title text crumbs backHref backLabel>` = a whole
  not-found page (hero + back pill; carries the h1).

Actions
- `<Pill href variant="ink|light|ghost|line" external back icon>` — capsule link; no `href` → `<button type="button">`
  (pass `onClick`, `aria-pressed`). `ink` on paper/gold, `light` on ink/azure, `ghost` on ink, `line` on paper.
  `external` opens a new tab and says so; `back` puts the arrow first, pointing left.
- `<RowLink href title meta action="PDF" external>` inside `<ul className="liq-rows"><li>…</li></ul>` —
  the home's newsletter row: big title, meta, action; an ink (azure on ink bands) circle floods from the
  pointer on hover/focus. Use for any list of documents, events, links.

Media & people
- `<Media src alt ratio="4 / 3" fallbacks label eager width height referrerPolicy className>{overlay}</Media>` — the liquid photo frame
  (`referrerPolicy="no-referrer"` for gallery photos: the media host 403s some requests that send a referrer).
  Missing/broken photo → the frame keeps its ground and shows `label` in outline type. On desktop with
  ≤ 12 photos on the page it is painted by WebGL (liquid reveal, hover ripple, velocity wobble); else a
  clip-wipe. `className="liq-media--still"` opts one out of motion (use for thumbnails in a lightbox strip).
- `<ProjectCard href title img avenue date desc n portrait headingLevel>` — the home project card (works on ink & paper).
- `<Portrait src name className decorative>` — photo or initials in the theme's arch (4:5, round top).
- `<PersonRow name role img bio href headingLevel>` inside `<ul className="liq-roll">` — leadership row with
  an outline name that fills with ink on scroll. **≤ ~30 per page** (each is a scrubbed trigger).
- `<OutlineFill text>` — the name effect on its own.

Numbers
- `<Odometer value="₹10,21,500" live>` — digits roll, symbols/separators stay. `value` is the finished TEXT
  (`formatMoney(n, currency)`, `groupInt(n, currency)`). Rolls on scroll; `live` = rolls again whenever the
  value changes (filter-driven totals).
- `<Figures items={[{label, value}]}>` — the home's giant numbered figure list (azure band).
- `<StatRow items={[{label, value}]} live>` — compact stat strip (dl), for heroes and filtered lists.

Controls
- `<Chips label options={[{value,label,count}]} value onChange>` — `role="group"` of `aria-pressed` buttons; the
  pressed chip floods with the band's text colour.
- `<SearchField label value onChange placeholder id>` — labelled search input + clear button.
- `<ResultCount count total one many>` — "Showing 12 of 125 members", `aria-live="polite"`.

Text
- `<Chars text mask>` — per-character spans (React-owned, SR reads one clean copy). Used by titles.
- `<Words text em>` — word spans; put `className="liq-ink"` on the parent `<p>` and the words ink in from 14%
  as the paragraph crosses the screen (the home's about statement). `em` = a phrase set in serif italic accent.
- helpers: `clean(s)`, `clip(s, max)` (word-boundary cut + mends the API's hard 200/260-char cuts),
  `pad2(n)`, `longestWord(s)`, `yearText(label)` ("2026–27"), `splitClubName(name)` → `{pre, short}`,
  `splitAbout(html)` → `{statement, story[], year1, em}` (the club's about HTML parsed safely).
- icons: `Arrow ArrowOut ArrowLeft Chevron CloseIco SearchIco` (1em, currentColor).
- re-exported from `_shared/kit.jsx`: `PersonPhoto SafeImg paragraphs imgFallback hideOnError isPlaceholderPhoto`.

States
- `<EmptyState title text action as="h2">` (dashed panel with a drop glyph; any band) · `<Loading label>`.
- Admin HTML goes in `<div className="liq-prose" dangerouslySetInnerHTML>` (demote its `<h1>` to `<h2>`): theme.css
  already neutralises pasted inline colours/fonts/grounds and keeps tables, iframes and images inside the column.

Overlays
- `useInertBehind(open, keep = '[data-pdm-lightbox]')` — while an overlay portalled to `<body>` is open (the shared
  `PhotoLightbox` always is), everything else in `<body>` is inert and smooth scroll pauses. Declare it before the
  effect that moves focus back on close. Native `<dialog>.showModal()` needs nothing (it inerts the page itself).

## 5. Motion (`import { … } from '../motion.js'`)

**Default: `usePageMotion(ref, deps)` and class hooks — no GSAP code needed.** It runs inside a
`useScene` (motion-allowed only, scoped to `ref`, reverted on unmount/deps change) and does:

| put this on an element | you get |
|---|---|
| `liq-rv` | fade-up reveal, batched, once per element (never re-hidden when data changes) |
| `liq-line` (a 1px rule) | draws left → right |
| `<Odometer>` | digits roll up with the scroll (not `live` ones) |
| `<OutlineFill>` / `<PersonRow>` | outline name fills with ink as it crosses |
| `<p className="liq-ink"><Words/></p>` | words ink in, scrubbed |
| `.liq-bigtitle` (`<SectionHead big>`) | line 1 sweeps from the left, outlined line 2 from the right |
| `<Media>` (not the hero's) | liquid wipe + zoom settle; WebGL ripple on desktop (≤ 12 photos) |
| `liq-rise` on a `<p>` holding `<Chars mask>` | masked chars rise once (footer wordmark move) |
| `liq-par` | gentle vertical drift |

`<PageHero>` and `<Marquee>` run their own motion. **Nothing is hidden in CSS**: with reduced motion
none of this runs and everything is simply there.

For your page's one memorable moment, add a scene of your own:

```jsx
import { useScene, gsap, ScrollTrigger, onRevert, titleIn, charsRise, parallax, liquidMedia, onScrollVelocity, scrollToY } from '../motion.js'

useScene(ref, (c) => {              // c = { motion, wide, fine } — runs only when motion is allowed
  if (!data) return
  parallax('.liq-dir-letter', { from: 20, to: -20 })          // selectors are scoped to ref
  if (c.wide) gsap.fromTo('.liq-pp-decade', { xPercent: -8 }, { xPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '.liq-pp-list', start: 'top bottom', end: 'clamp(top 30%)', scrub: true } })
  const off = onScrollVelocity(({ v }) => { /* v: -1..1 smoothed scroll velocity */ })
  onRevert(off)                      // anything you start by hand, stop here
}, [data])
```

Helper reference (all safe inside a `useScene` setup; each cleans up after itself):
`titleIn(el, {tl, at, delay})` chars rise + unfold · `charsRise(targets)` masked chars rise once ·
`inkWords(targets)` · `fillIn(targets)` · `revealBatch(targets, {y, start, stagger})` ·
`drawLines(targets)` · `rollNumbers(targets, {scrub})` · `parallax(targets, {from, to, trigger})` ·
`liquidMedia(targets, c, {gl, max})` · `heroIn(root)` (PageHero's entrance) · `velocityMarquee(root)` ·
`onScrollVelocity(fn) → unsubscribe` · `onRevert(fn)` · `withGL(G => cleanup)` · re-exports
`gsap ScrollTrigger useScene useRefreshOnImages afterFonts refreshSoon scrollToY lockScroll getLenis prefersReducedMotion`.

Motion rules (from the README, restated because they bite):
- Pins only on wide screens and only what fits the viewport; `refreshPriority: 0` on any pin you create
  (keeps triggers sorted by page position). A focusable element inside a pin/horizontal track must scroll
  itself into view on `focusin` (see Home's meeting scene).
- Tweening an element GSAP also transforms? Put CSS hovers on a child or use individual `translate`/`scale`.
  Entrance tweens `clearProps` what they animate.
- `opacity:0` still takes clicks — stacked/hidden slides also get `visibility:hidden` or `pointer-events:none`.
- No per-card scrubs for long lists on phones: use `liq-rv` (batched). 125 directory cards = `liq-rv` only.
- Dialogs/lightboxes: `lockScroll(true)` while open, Esc closes, focus returns (use `PhotoLightbox` from data.js).

## 6. Class naming

Every class starts with `liq-`; page classes add the page code: **`liq-<code>-<part>`**, BEM-ish
(`liq-dir-card`, `liq-dir-card__name`, `liq-dir-grid--compact`). Codes (fixed — the short ones avoid the
kit's names):

| page | code | page | code |
|---|---|---|---|
| About | `liq-abt-` | Events | `liq-evt-` |
| Directory | `liq-dir-` | EventDetail | `liq-ed-` |
| Directors | `liq-bod-` | PastPresidents | `liq-pp-` |
| Calendar | `liq-cal-` | Newsletters | `liq-nws-` |
| Projects | `liq-prj-` | Gallery | `liq-gal-` |
| ProjectDetail | `liq-pd-` | Dignitary | `liq-dig-` |

Taken by the shell/kit/home (don't define these): `liq-band liq-wrap liq-edge liq-ph liq-sh liq-kicker liq-h2
liq-h3 liq-pill liq-media liq-pcard liq-portrait liq-person liq-roll liq-fill liq-odo liq-fig(s) liq-stat(s)
liq-chip(s) liq-search liq-count liq-row(s) liq-card liq-facts liq-empty liq-loading liq-mq liq-hero liq-stage
liq-about liq-numbers liq-pgrid liq-notices liq-people liq-goldwrap liq-meet liq-next liq-news liq-foot liq-menu
liq-nav liq-bar liq-rv liq-line liq-ink liq-rise liq-par liq-motion`. State classes: `liq-is-*`.
Page CSS may also use the band variables and descendant selectors inside your root (`.liq-dir .liq-card{…}`).
Never style a bare element outside your root; never use Tailwind classes; never use `.reveal*`, `[data-count]`,
`[data-split]`, `data-spotlight`, `data-tilt`, `data-magnetic`, `[data-slider]`, `.route-enter`.

## 7. Page directions

Hooks and their exact shapes: `src/pages/gold/goldData.js` (and the matching `src/pages/gold/<Name>Gold.jsx`
for how each is used, the query contract and the not-found rules). Page table: `../README.md` §1.

### About — `useAboutData()` → `{loading, html, logo, email, phone, meetingDay, meetingTime, meetingVenue, mapUrl, socials, president, secretary}`
- **Layout:** PageHero (pre "About the club", title = menu label, ghost = `splitAbout(html).year1` — the first
  year the text mentions, usually the charter year; lede = none). Paper band: `splitAbout(html).statement` huge in
  Instrument Serif (`<p className="liq-abt-statement liq-ink"><Words text em/></p>`, 28–66px, max 20.5em), then a
  12-col grid — the club's full HTML in `.liq-prose` (cols 1–7, `dangerouslySetInnerHTML`, it's already wrappable)
  and a sticky `<Card>` on the right (cols 9–12, `position:sticky; top:calc(var(--liq-hh) + 24px)`): crest (the
  `logo` in a 96px white circle), `<Facts>` President · Secretary · Meets · Venue (+ Directions `liq-link`, new tab)
  · Email · Phone (plain text, exactly as Gold shows them), socials. Close with an azure band "Keep exploring":
  `<RowLink>`s to Directors, Projects, Past presidents (azure rows flood ink).
- **Memorable:** the statement's words ink in while the outlined charter year drifts behind it (home.css is
  not loaded on your page, so copy the look into `liq-abt-year`: absolute, Unbounded 800 clamp(80px,24vw,380px),
  transparent fill, 1.5px stroke rgba(0,87,168,.25), `aria-hidden`, drifted with `parallax` / the `liq-par` hook).
- **Musts:** long admin HTML (11,000px) must still read — prose ≤ 68ch; no html → `<EmptyState title="The club
  hasn't published its story yet">` but keep the facts card. **Phone:** single column, card after the prose,
  not sticky; statement ~28px.

### Directory — `useDirectoryData()` → `null | [{i, name, work, img}]`
- **Layout:** PageHero (pre "Our members", ghost = member count, children: `<SearchField>` (name or
  profession) + `<ResultCount one="member" many="members">`). Paper band: an A–Z `<Chips>` row (letters with no
  member are left out; "All" first) that stays reachable (`position:sticky` under the header on desktop), then
  members grouped by first letter: each group opens with a giant outlined letter (`liq-outline`, 120–200px) in a
  left column that sticks while its group scrolls; cards in an auto-fill grid (`minmax(200px,1fr)`):
  `<Portrait>` + name (Unbounded 600 17px, `overflow-wrap:anywhere`) + work (`--liq-fg-2`).
- **Memorable:** the sticky outlined letters sliding past as you scroll the alphabet; pressing a letter chip
  floods it and the count rolls.
- **Musts:** search + letter filter combine; live count; empty result → EmptyState with a "Clear search" Pill;
  ~50 of 125 have no photo → initials (Portrait does it); cards get `liq-rv` only (no per-card scrubs, no
  OutlineFill here). **Phone:** chips wrap to 2–3 lines — keep them above the list, not sticky; cards become rows
  (64px portrait left, text right), letters inline as small outlined headings.

### Directors — `useDirectorsData()` → `null | [{name, role, img, bio}]` (club's own order)
- **Layout:** PageHero (pre "Board of directors", title = menu label, ghost = board size). Paper band: the
  officers (roles containing president / secretary / treasurer — derive from `role` text, never invent
  titles) as `<PersonRow>`s in a `.liq-roll` with bios (`clip(bio, 320)` + a `<details>` "Read full
  introduction" for longer ones, `paragraphs(bio)`). Ink band: everyone else in a portrait grid (4 / 3 / 2
  columns): arched `<Portrait>`, gold role kicker, name in Unbounded 600 20px; group headings only if the
  role text supports them (Directors / Chairs / Other).
- **Memorable:** officer names fill from outline to ink as they cross the screen; the grid's portraits rise with
  `liq-rv` stagger.
- **Musts:** 0 directors → EmptyState; missing photos → initials; bio can be empty. **Phone:** 2-column portrait
  grid (names wrap, no truncation).

### Calendar — `useCalendarData(year, month)` → `{loading, flags, birthdays[], anniversaries[], events[]}`
- **Layout:** PageHero (pre "Special dates", title = menu label, ghost = the month name, children: a month
  switcher — ArrowLeft/Arrow buttons + the month name in Unbounded 600 32px, bounded to the selected Rotary
  year Jul → Jun, start on the current month if it's in that year). Paper band, desktop: a 7-column month grid of
  day buttons (`aria-pressed`, 72–96px square, day number in Unbounded); marked days show small labelled
  glyph counts — B (birthdays), A (anniversaries), E (events) with text, not colour alone; selecting a day
  opens a `<Card>` panel beside the grid listing its people (`<Portrait>` + name) and events (links to
  `/event?id=`). Under the grid: the month's full agenda.
- **Memorable:** changing month re-draws the grid in a liquid ripple — cells fade/scale in staggered by distance
  from the pressed arrow (`gsap … stagger: { grid: [rows, 7], from: 'start'|'end' }`), and the ghost month
  word swaps.
- **Musts:** keyboard-operable grid; month with nothing → EmptyState. **Phone (< 700px):** no 7-col grid — an
  agenda list grouped by day (`dayLabel`), with `<Chips>` All / Birthdays / Anniversaries / Events.

### Projects — `useProjectsData(isMeetings)` → `{loading, projects[], totalCount, avenueTabs, areaOptions, …, metricsPhase, metricsOf(p)}`
- Route contract: `?pr=CE` = club-service feed (`useProjectsData(true)`, no stats); `?pr=CP|VS|NGS|IS|PII`
  pre-selects that avenue chip (match ProjectsGold exactly).
- **Layout:** PageHero (pre "Our work", title = menu label, children: `<SearchField>`, avenue `<Chips>` with counts,
  `<ResultCount>`). Azure band (tight): a `live` `<StatRow>` — Total cost (`formatMoney(sum, club.currency)`),
  Beneficiaries, Rotarians, Man-hours — summed over the FILTERED projects via `metricsOf(p)`; `<Loading>`
  while `metricsPhase === 'loading'`; hidden when `'hidden'`. Ink band: `<ProjectCard>`s — ≤ 12 results use the
  home's two staggered interlocking columns (copy `.liq-pgrid` rules into `liq-prj-grid`); more results use a
  3-col grid (`minmax(300px,1fr)`), landscape cards, `liq-rv` only. Cards link `withYear('/project?pid='+id
  (+ '&pr=CE' in the CE feed), club.selectedYearId)`; show `updates` count ("8 updates") in the meta row.
- **Memorable:** pressing an avenue chip floods it, the list re-reveals, and all four stat odometers roll to
  the new totals.
- **Musts:** 122 projects stay fast (no GL > 12; `loading="lazy"` via Media); no-photo cards show the avenue in
  outline type (Media `label`); empty filter → EmptyState + "Show all" Pill. **Phone:** chips wrap; one column.

### ProjectDetail — `useProjectData(pid)` → `{p, notFound}`
- `?pid=0`/unknown → `<NotFound title="Project not found" crumbs={[{label:'Projects', href:back},{label:'Not found'}]}
  backHref={back} backLabel="All projects">`; `?pr=CE` → back = `/projects?pr=CE`.
- **Layout:** PageHero (crumbs Projects / title, pre = avenue label, title = project title — auto-sizes,
  `image` = hero photo, children: meta chips as plain text: date · location · area of focus). Paper band: 12-col
  — description `.liq-prose` (cols 1–7) and a sticky `<Card>` (cols 9–12) with `<Facts>` + the non-zero stats as
  a `<StatRow>` (`formatMoney` for cost) + the share row (`useProjectShare`, WhatsApp/copy link). Ink band:
  "Photographs" — a grid of `<Media>` thumbs (≤ 12 → WebGL ripple) opening `PhotoLightbox` with captions;
  updates (child projects) as `<RowLink>`s or a dated timeline. End with `<Pill back href={back}>All projects</Pill>`.
- **Memorable:** the hero photo wipes up through the liquid edge, then the stats roll as the card arrives.
- **Musts:** many photos, one photo, none (hide the band); description paragraphs keep breaks.

### Events — `useEventsData()` → `null | [{id, title, desc, day, mon, year, monthLabel, ts, weekday, date, venue, img, reg}]`
- **Layout:** PageHero (pre "What's on", title = menu label, ghost = count). Gold band: the next event, big —
  poster `<Media ratio="4 / 5">` left, right: date plate (day 80–112px Unbounded, `mon year` caps), title (h2),
  venue, `Details` Pill (`/event?id=`), `Register` Pill (external) if `reg`. Paper band: the rest grouped by
  `monthLabel` — month as a kicker, events as `<RowLink>` rows (title, `weekday · date · venue`, "Details").
- **Memorable:** the gold band floods in from a small circle as it scrolls up (scrubbed `clipPath: circle(8%→110%)`,
  like the home meeting; don't pin).
- **Musts:** 0 events → `<EmptyState title="No upcoming events are listed for this Rotary year">` with the weekly
  meeting (`useAboutData`) as text and a Pill to the Calendar. **Phone:** poster above text.

### EventDetail — `useEventData(id)` → `null` loading · `false` not found · `{title, venue, when, day, mon, year, weekday, img, reg, descHtml}`
- **Layout:** PageHero (crumbs Events / title, pre = `weekday`, title, `image` = poster if any, children: the
  `when` line). Paper band: `.liq-prose` `descHtml` + a sticky `<Card>`: `<Facts>` When · Venue (+ Directions
  `https://www.google.com/maps/search/?api=1&query=` + encoded venue, new tab), `Register` Pill only if `reg`.
  Back Pill to `/events`. Not found → `<NotFound title="Event not found" backHref="/events" backLabel="All events">`.
- **Memorable:** the date plate's day number rolls (Odometer) as the card enters.

### PastPresidents — `usePastPresidentsData()` → `null | [{name, year, img, y}]` newest first (years before the selected one)
- **Layout:** PageHero (pre "Our lineage", title = menu label, ghost = the earliest year). Ink band: a vertical
  timeline grouped by decade — the decade ("1990s") as giant outlined type sticking in a left column while its
  presidents scroll; each row: year (Unbounded 600, gold, tabular), small `<Portrait>` (64–88px), name
  (Unbounded 500 22–30px). Head the list with the sitting president from `useDirectorsData()` (role contains
  "president", not "past"/"vice"), marked "Current, {year}" in a gold pill; mark the last row "Earliest on
  record" (don't claim "charter" unless the data says so).
- **Memorable:** decades sweep in (`sweepIn`-style xPercent) and their outlined numerals drift as you pass.
- **Musts:** 34+ rows smooth (`liq-rv` only); no photo → initials; labels that don't parse sink to the end.
  **Phone:** one column, decade headings inline (not sticky).

### Newsletters — `useNewslettersData()` → `null | items` (shape: `buildItems` in `src/pages/Newsletter.jsx`)
- **Layout:** PageHero (pre "From the club", title = menu label, ghost = issue count). Gold band: the home's
  newsletter rows (`<ul className="liq-rows">` + `<RowLink external action="PDF">`, meta = date) — the latest
  issue first and taller (a "Latest issue" kicker above it). More than ~8 → group by year with kickers.
- **Memorable:** the ink flood that starts from where the pointer enters each row (built in).
- **Musts:** each opens its PDF in a new tab and says so (RowLink does); 1 issue or 40 both look deliberate;
  none → EmptyState on paper.

### Gallery — `useGalleryData(page)` → `{loading, totalCount, totalPages, currentPage, photos:[{img, title, projectId, module}]}`
- `?page=<n>` (24 per page) — read and write it like GalleryGold.
- **Layout:** PageHero (pre "Photographs", title = menu label, ghost = totalCount, children: `<ResultCount>` +
  `<Chips>` filtering THIS page by `module`). Ink band: a masonry grid (CSS `columns: 4 260px`, `break-inside:
  avoid`) of `<Media>` (natural ratios: set `--liq-ar` from the loaded image or use 4/3, 4/5 alternately) —
  each a button opening `PhotoLightbox` (←/→/Esc, caption = project title, link to the project with `withYear`).
  Pagination: previous/next Pills + numbered page links (`aria-current="page"`).
- **Memorable:** photos wipe up in a staggered liquid batch (24 > 12 → no GL, the clip-wipe batch — built in);
  the cursor bubble grows over photos (built in).
- **Musts:** empty year → EmptyState; broken photo → Media label; keyboard reaches every photo.

### Dignitary — `useDignitaryData(type)` → `{loading, found, year, name, role, designation, img, bio, bioHtml}`; `?Type=1` RI President, `2` District Governor (default 1; 4/5 also work)
- **Layout:** PageHero (pre = `role`, title = `name`, children: two link-chips to switch
  `/dignitary?Type=1` ↔ `?Type=2` (`withYear`, `aria-current="page"` on the active one — links, not
  buttons)). Paper band: a large arched `<Portrait>` (sticky on desktop, 360–440px wide) beside the bio
  (`.liq-prose`, `bioHtml`), `designation` as a kicker above it. Then a small ink band linking to the club's own
  leaders (`/directors`).
- **Memorable:** the portrait arch rises and its photo settles from 1.3× to 1× as it enters (parallax + scale,
  like the home leadership rows).
- **Musts:** `found === false` → EmptyState "Details for this Rotary year haven't been published yet" (keep the
  hero with the role as title). **Phone:** portrait first (max 280px), bio below.

## 8. Do / don't

Do
- Build from the kit; reach for `Band`, `PageHero`, `SectionHead`, `Card`, `Facts`, `RowLink`, `Media` first.
- Use the band variables, so your page survives being moved to a different band.
- Give every API string that meets a grid track `min-width:0` + `overflow-wrap:anywhere`.
- Keep reading text in Geist ≤ 75ch; Unbounded is for titles, numbers and names.
- Show real data only: counts, years and names from the hooks. Plain, sentence-case UI copy.
- Links: internal `<a href="/x">` (year-scoped detail links through `withYear`); external `target="_blank"
  rel="noopener noreferrer"` + "(opens in new tab)" for screen readers (Pill/RowLink do it).

Don't
- Don't add a second `h1`, a second header, or anything above `<PageHero>`.
- Don't put gold text on paper/azure, or `--liq-azure` (#0067C8) as text.
- Don't hide anything in CSS waiting for JS; don't add `transform` to `<main>` or page roots that contain pins.
- Don't animate every element; one orchestrated moment per page + the class-hook layer is the brief.
- Don't invent facts, quotes, stats or titles; don't hard-code Thane Hills (or any club) content.
- Don't import from `src/pages`, `src/shared`, `src/api` — only `../../_shared/data.js`, `../../_shared/kit.jsx`,
  `../kit.jsx`, `../motion.js`.

## 9. Before you return

`curl -s -o NUL -w "%{http_code}" http://localhost:8102/src/themes/liquid-motion/pages/<Page>.jsx` (and `.css`)
→ 200; esbuild-bundle your page (README §7); re-read for hook order, keys, unique ids. No browser.
