# Horizontal Journey — design guide for page agents

Theme key `horizontal-journey`, prefix `hj-`, preview http://localhost:8103/.
Reference: `E:/club-website/Theme8-Samples/F-horizontal-journey/index.html` (look + motion only).
Read `src/themes/README.md` first; this file adds the theme's vocabulary on top of it.

**The idea:** a day's walk across the hills. Every page is a stop on the walk: it opens on a
sky in one chapter colour over layered ridges that fall into the page's ground, the content sits
on white/cream ground, and bands of chapter colour (closing on ridges) mark the big moments. The
shell (sticky white header with the six-colour stripe, night footer rising on a ridge) is already
built. You write `pages/<Page>.jsx` + `pages/<Page>.css` only.

---

## 1. Tokens and type (declared on `html[data-theme="horizontal-journey"]`)

| token | value | use |
|---|---|---|
| `--hj-ink` | #141A33 | body text, dark UI |
| `--hj-ink-2` | #3A4260 | secondary text (9.9:1 on white, 9.2:1 on cream) |
| `--hj-cream` | #FFF6EA | warm ground, empty states |
| `--hj-paper` | #FFFFFF | default ground |
| `--hj-line` | rgba(20,26,51,.14) | hairlines |
| `--hj-cran` | #D41367 | chapter 1 · white text 5.1:1 |
| `--hj-gold` | #F7A81B | chapter 2 · **ink** text 8.6:1 (never white on gold) |
| `--hj-gold-lt` | #FFC04D | large display accents on cranberry only (3.2:1, ≥24px) |
| `--hj-azure` | #0067C8 | chapter 3 · white 5.6:1 |
| `--hj-turq` | #00ADBB | chapter 4 · **ink** text 6.3:1 |
| `--hj-violet` | #901F93 | chapter 5 · white 7.5:1 |
| `--hj-royal` | #17458F | chapter 6 · white 9.2:1; gold on royal 4.6:1 (large only) |
| `--hj-night` | #0B1D4D | night, footer · white 16.2:1, `--hj-mist` #C9D3EE 10.6:1 |
| `--hj-disp` | "Unbounded" | display: titles, figures, names (weights 600–800) |
| `--hj-sans` | "Figtree" | everything else (400–800) |
| `--hj-gut` | clamp(16px,4vw,56px) | side gutter (16px at 390) |
| `--hj-max` | 1320px | content width |
| `--hj-hh` | 72px (64 < 600px) | header height; pins start at `'top ' + headerH()` |
| `--hj-ftr` | clamp(40px,6vw,90px) | footer ridge height |
| `--hj-ground` | #fff | the page ground; `.hj-ground--cream` switches it |
| `--hj-noise`, `--hj-stars` | backgrounds | paper grain; star field |
| `--hj-shadow` | card shadow | |
| `--hj-ease` | cubic-bezier(.2,.7,.2,1) | CSS transitions |

Tone classes set `--hj-c` (sky/band colour), `--hj-fg` (text on it), `--hj-numc` (outlined numeral):
`.hj-tone--dawn | cran | gold | azure | turq | violet | royal | night`.

Type scale (all already in the kit classes — reuse, don't restate):
- page title `.hj-ph__t`: Unbounded 800, clamp(30px, 9.4vw, 92px), -0.035em. "Newsletters" fits at 390.
- section title `.hj-h2`: Unbounded 800, clamp(30px, 8vw, 64px), line-height .98.
- kicker `.hj-kicker`: Figtree 750, 13px, .22em tracking, uppercase, trailing 46px rule.
- card title `.hj-card__t`: Unbounded 600, 16px. Names: Unbounded 700, 17–21px.
- body: Figtree 17px/1.6. Labels: Figtree 750 12–13px uppercase .14–.18em.
- Big display words (days, years, numbers) use `clamp()` with a vw term AND `overflow-wrap:anywhere`
  or `white-space:nowrap` only when the string is short and known.

## 2. Page skeleton

```jsx
import { PageHero, SectionHead, Button, EmptyState, Loading } from '../kit.jsx'
import { useScene, afterFonts, titleIn, revealBatch } from '../motion.js'
import './Directory.css'

export default function Directory() {
  const members = useDirectoryData()                    // from ../../_shared/data.js
  const ref = useRef(null)
  useScene(ref, (c, ctx) => afterFonts(ctx, () => {      // motion only; nothing hidden in CSS
    titleIn(ref.current.querySelector('.hj-h2'))
    revealBatch(ref.current.querySelectorAll('.hj-dir-card'))
  }), [members ? members.length : 0])
  return (
    <div className="hj-page hj-dir" ref={ref}>
      <PageHero tone="turq" title="Directory" eyebrow="Our members" sub="…" />
      <section className="hj-wrap hj-sec">…</section>
    </div>
  )
}
```

- `PageHero` renders the ONE `<h1>` and calls `usePageTitle` — don't call it again, don't add
  another h1. It uses the club's own menu label for the title when there is one.
- Wrap the page in `.hj-page` (ground colour). Use `.hj-wrap` (max width + gutters) and `.hj-sec`
  (vertical rhythm) for sections. Put `hj-ground--cream` on `.hj-page` for a cream page: the hero's
  front ridge follows automatically.
- The footer ridge needs `--hj-ftr` of space: the shell adds a white spacer after `<main>`. If your
  page ends on a coloured band, give that band class `hj-endpad` (adds the room, removes the spacer).

## 3. Kit (`../kit.jsx`)

| export | props | notes |
|---|---|---|
| `PageHero` | `title, eyebrow?, sub?, crumbs?=[{label,href}], tone?='dawn', ground?, aside?, children?, docTitle?, menuTitle?=true` | sky + sun (moon for `night`) + three ridges; crumbs "Home / …crumbs / title"; `children` go under the sub (search field, chips, StatRow); `aside` is a right column ≥900px. Animates itself. |
| `Crumbs` | `items, current` | used by PageHero; available alone. |
| `SectionHead` | `k?, title, sub?, action?, id?, as?='h2'` | chapter kicker + big title; numeric `k` is aria-hidden. |
| `Band` | `tone, next?='var(--hj-ground)', num?, id?, labelledBy?, as?` | full-bleed chapter band closing on ridges in `next` colour; `num` = giant outlined numeral. |
| `Button` | `href?, variant='gold'\|'line'\|'ink'\|'white'\|'ghost', size?='sm', icon?='arrow'\|'out'\|'back', external?` | `<a>` with href (http → new tab + sr note + ↗), else `<button>`. `line` = currentColor outline (use on colour). |
| `Chip` | `tone, children` | small label; `avenueTone(labelOrCode)` gives the tone for an avenue. |
| `ChipGroup` | `label, options=[{value,label,count?,tone?}], value, onChange` | filter buttons, `aria-pressed`, ≥44px. |
| `SearchField` | `value, onChange, label, placeholder?` | labelled `type=search`, clear button (focus returns to the field). Its ring follows the sky it sits on. |
| `ResultCount` | `count, total?, noun, plural?` | `aria-live="polite"` "Showing 12 of 120 members". |
| `PhotoCard` | `href, img, alt?, chip?, chipTone?, meta?, title, desc?, as?='article', headingAs?='h3', imgProps?, children?` | the white project card; whole card is one link; broken/missing photo shows painted hills. Use `as="li"` inside a `<ul>`. |
| `Portrait` | `src, name, alt?, ...img` | arch portrait (`.hj-arch`), initials when no photo. Size it by width. Extra props (`loading`, `width`…) go to the `<img>` (default 400×500). |
| `StatRow` | `items=[{value,label,fmt?,text?,shape?,tone?}], currency?` | the shape figures (circle/arch/square/pill/dome), count up on scroll. Drop zero items yourself; use `formatMoney` for money (`fmt:(n)=>formatMoney(n,cur,{compact:true})` if long). A figure too long for its shape moves to a circle (> 5 chars) or pill (> 7). |
| `EmptyState` | `title, message?, action?, as?='h2', night?` | cream card with a sun over hills. Every empty list uses it. |
| `Loading` | `label` | sun bobbing over the hills, `role=status`. Show while a hook returns `null`. |
| `NotFound` | `title?, message?, crumbs?, backHref?, backLabel?` | night hero (carries the h1) + way back. Use instead of PageHero for a missing record. |
| `Ridge` | `preset, seed?, fill?, rim?, className` | one hill silhouette at real pixel width; presets in motion.js `RIDGE` (`far mid near ground pnFar pnFront foot heroFar heroMid heroFront`). `.hj-rg` is absolute, bottom 0, full size; size it via its container. |
| `htmlText(html)` | | admin HTML → plain text (DOMParser, inert). Never `innerHTML` a detached div. |
| `cut(text, n)`, `yearText(label)` | | word-boundary ellipsis; "2026-2027" → "2026–27". |
| `coverTitle(title)` | | newsletter title → `{ name, ed }` ("August 2026- Hill Echoes" → name + edition) for printed covers. |
| `useLightboxModal(open, openerRef, {lock?})` | | makes the shared `PhotoLightbox` a modal: rest of `<body>` inert, Lenis paused, focus to its close button and back to the opener. |
| icons | `IconArrow IconOut IconBack` | 16px, aria-hidden. |
| re-exports | `PersonPhoto SafeImg paragraphs imgFallback hideOnError isPlaceholderPhoto` | from `_shared/kit.jsx`. |

Shared CSS classes you may use directly: `.hj-page .hj-wrap .hj-sec .hj-endpad .hj-sr .hj-h2
.hj-kicker .hj-btn(--gold|--line|--ink|--white|--ghost|--sm) .hj-chip .hj-card* .hj-arch
.hj-prose` (admin rich text: about, bios, descriptions — render with `dangerouslySetInnerHTML`
exactly as Gold does) `.hj-stars .hj-moon .hj-tone--* .hj-ground--*`.

## 4. Motion (`../motion.js`) — call inside `useScene` (after fonts when splitting text)

```js
useScene(ref, (c, ctx) => afterFonts(ctx, () => { … }), [dataLoaded])
// c.wide (>=900px), c.fine (mouse) — setup never runs with reduced motion
```

| helper | what it does |
|---|---|
| `titleIn(el, {trigger,start,end,scrub})` | THE title move: chars rise out of a 12° skew, scrubbed. For `.hj-h2`s. |
| `rise(targets, trigger, {from,stagger,start,duration,ease})` | one-shot rise (y 36 → 0, fade). `from` overrides e.g. `{x:70,y:0}`. |
| `revealBatch(nodes, {y,x,stagger,start})` | long lists/grids: each row batch rises as it enters. |
| `parallax(el, {from,to,trigger,start,end,prop})` | scrubbed drift (numerals, far ridges, moons). |
| `archOpen(arch, {trigger})` | portrait arch opens from the ground, photo settles (leaders, directors). |
| `wipeIn(el, {trigger})` | photo wipes open from the right. |
| `fanIn(nodes, {trigger})` | covers fan in with alternating tilt (newsletters). |
| `countUp(el, value, fmt, scrollTrigger, ease?)` | figure counts from 0; React renders the final text. |
| `statsIn(root)` | the shape figures tumble in (StatRow already does this). |
| `heroIn(root)` | PageHero's entrance + sunset-on-scroll (PageHero calls it). |
| `pinTrack(section, track, {scrub,onUpdate})` | **wide only**: pins `section`, scrubs `track` (sized by its own box: `width:max-content`) sideways; returns `{tl, go(x)}` (`tl` = containerAnimation). Keyboard focus scrolls the track. |
| `split(el, aria)` | SplitText words+chars. Never split text React may change without a `key`. |
| `useMedia(q)`, `headerH()`, `scrollToEl(el)`, `onRevert(fn)`, `ridgeY(x, o)` | utilities (`ridgeY`: a ridge's height at x, 0–100 from the top — where a figure's foot stands). |
| re-exported | `gsap ScrollTrigger SplitText useScene afterFonts refreshSoon useRefreshOnImages scrollToY lockScroll getLenis prefersReducedMotion` |

Rules: no hidden start states in CSS; `clearProps` what entrances animate; hovers on tweened
elements use `translate`/`scale` properties (the card image hover already uses `scale … !important`);
`useRefreshOnImages(ref, deps)` on pages with API photos; pins only when `c.wide` (and the section
fits the viewport — check `useMedia('(min-height: 620px)')` like the home).

## 5. Page directions

Colour per page (hero `tone`) — keep these so the site reads as one walk:
About **dawn** · Directory **turq** · Directors **royal** · Calendar **gold** · Projects **azure** ·
ProjectDetail **azure** · Events **violet** · EventDetail **violet** · PastPresidents **night** ·
Newsletters **violet** · Gallery **cran** · Dignitary **royal** (RI) / **azure** (DG).

**About** (`useAboutData`) — *The walk's starting point.* Dawn hero with the club crest in the
`aside` (white disc like the footer logo). Then the club's own text in `.hj-prose` on cream, set
in a readable column with a sticky "at a glance" rail on wide (meeting day/time/venue, district,
socials — only what the hook returns). Memorable moment: a `Band tone="royal"` "Where we meet"
with the moon and stars (reuse `.hj-stars` + `.hj-moon`) and the day in huge Unbounded gold,
like the home's last chapter. Must: president/secretary cards with `Portrait` linking to
`/dignitary?Type=4|5` (withYear); personal email/phone NOT shown for them. Phone: rail stacks
under the text; day word must fit at 390 (clamp + nowrap only if ≤ 10 chars).

**Directory** (`useDirectoryData` → `null` while loading) — *A people-search page: stays vertical.*
Turquoise hero with `SearchField` + `ResultCount` as `children`. Grid of member cards: small arch
`Portrait` (96–120px), name (Unbounded 700), work line. Optional A–Z `ChipGroup` only if it helps
(members > 40). Memorable moment: cards rise row by row (`revealBatch`) and the arch opens on each
portrait on hover-free scroll (`archOpen` with a small trigger). Must: search filters by name and
work, `aria-live` count, empty result → `EmptyState` "No member matches …" with a clear button,
hundreds of members perform (no per-card ScrollTrigger beyond batch). Phone: 2 columns ≥ 360px,
long names wrap (`overflow-wrap:anywhere`).

**Directors** (`useDirectorsData`) — *The board as a ridge line.* Royal hero. President and
Secretary first as large arch portraits side by side, then the rest of the board in a grid of
smaller arches with role in uppercase label and name. Memorable moment: the portraits stand on a
drawn ridge (a `Ridge` behind the row) and rise open from it (`archOpen`) as you arrive. Must:
bios via `.hj-prose` in a disclosure (`<details>` styled) — never a wall of text; role labels
wrap. Phone: one big arch per row for the first two, then 2-up.

**Calendar** (`useCalendarData(year, month)`) — *A month is a day's walk.* Gold hero (ink text),
with month navigation (prev/next buttons, month name in Unbounded, `aria-live`) as `children`.
Three lists — birthdays, anniversaries, events — as columns of "day chips" (the day number in a
gold circle like a small sun) with names. Memorable moment: the month title slides in sideways
like a chapter title on the track when the month changes (`gsap.fromTo` x 120 → 0 on the h2 with
`key={month}`). Must: follow Gold's month/flags logic exactly; each list has its own empty line;
events link to `/event?id=`. Phone: lists stack; month nav stays one row (44px buttons).

**Projects** (`useProjectsData(isMeetings)`, `?pr=`) — *Searchable, stays vertical.* Azure hero
with avenue `ChipGroup` (tones from `avenueTone`, counts), area/type selects if the hook has them,
`SearchField`, `ResultCount`; the stats (Cost/Beneficiaries/Rotarians/Man-hours from
`metricsPhase/metricsOf`) as a `StatRow` in the hero's `aside` or right below it. Grid of
`PhotoCard`s (`as="li"`, chip = avenue, meta = date). Memorable moment: cards rise in batches and
their photos `wipeIn`; the stat shapes tumble in. Must: match Gold's query contract (`?pr=CE`
feed, `?pr=CP|VS|…` preselect), metrics resting state while `loading`, money via `formatMoney`.
Phone: 1 column cards, chips wrap, search full width.

**ProjectDetail** (`useProjectData(pid)`, `?pid=`, `?pr=CE` back) — *One stop on the walk.*
Azure hero with crumbs `Projects / title` (long-title variant kicks in automatically), avenue
chip + date as eyebrow; a large photo (wipe) and the photo strip opening `PhotoLightbox`; the
project figures as `StatRow`; description in `.hj-prose`; child updates as a vertical timeline
of small `PhotoCard`s along a drawn ridge line (this is where a *horizontal* device can live on
wide screens via `pinTrack` if there are ≥ 4 updates — vertical otherwise); `useProjectShare` row.
Must: `NotFound` for pid 0/unknown; back link honours `?pr=CE`. Phone: everything vertical.

**Events** (`useEventsData`) — *The road ahead.* Violet hero. Group by `monthLabel`; each event
is a ticket like the home's (gold stub with day + month, white body with title, weekday, venue)
linking to `/event?id=`; the next one is larger. Memorable moment: tickets fan in (`fanIn`) and a
small sun marks "next" on the first ticket. Must: year-scoped by the hook; registration link
(`reg`) as `Button` new tab; `EmptyState` "No upcoming events this Rotary year". Phone: tickets
full width, stub on the left.

**EventDetail** (`useEventData(id)` → `null` loading, `false` not found) — Violet hero with the
day in big Unbounded as `aside` (like the meet chapter's day), photo, `.hj-prose` description,
venue + directions button, registration button. `NotFound` when `false`.

**PastPresidents** (`usePastPresidentsData` → newest first) — *The walk back through the years —
the one genuinely timeline-like page.* Night hero (moon, stars). On wide + motion + min-height
620: a `pinTrack` horizontal track of arch portraits standing on a long ridge, each with the
year in huge outlined Unbounded above (the home's milestone years: outline + gold fill that wipes
in via `containerAnimation`); a year list/`ChipGroup` of decades jumps the track (`go(x)`).
Everything else (phones, short, reduced motion): a vertical grid, decades as `SectionHead`s. Must:
photos often missing → `Portrait` initials; 100+ presidents must not jank (no per-card
SplitText; one ScrollTrigger per card max). Phone: 2-up grid grouped by decade.

**Newsletters** (`useNewslettersData` → items with `monthLabel`, `isNewMonth`, `dayNum`,
`monAbbr`, `url`) — *Printed covers.* Violet hero with `SearchField`. Covers exactly like the
home's (`.hj-cv` look: gold / white alternating, PDF tag, name + edition split, hills + sun art,
date) in a grid, grouped by month headings. Copy the cover markup into your page with
`hj-nl-*` classes and your own CSS (the home's `.hj-cv` styles live in home.css — never depend on
another module's CSS being loaded).
Memorable moment: `fanIn` per month group; hover lifts a cover 10px. Must: PDFs open in a new tab
with sr "(PDF, opens in a new tab)"; search by title; `EmptyState`. Phone: 2 covers per row.

**Gallery** (`useGalleryData(page)`, `?page=`) — Cranberry hero with `ResultCount` of photos.
Masonry-ish grid (CSS columns) of photos with project title captions; `PhotoLightbox` on click;
pagination as pill buttons (prev/next + numbers, `aria-current="page"`), links `?page=n`.
Memorable moment: photos `wipeIn` alternately from left/right as rows enter. Must: lazy images with
width/height, captions link to the project (withYear). Phone: 2 columns.

**Dignitary** (`useDignitaryData(type)`, `?Type=1|2|4|5`) — *A portrait at dusk.* Hero tone royal
(RI, 4, 5) or azure (DG) with the large arch `Portrait` as `aside`, designation as eyebrow, name
as title, year as sub. Bio in `.hj-prose` (`bioHtml`). Memorable moment: the arch opens from the
ground while the hero's sun sets behind it. Must: not-found → `NotFound`; personal contact only
where the shared page shows it. Phone: portrait above the title (aside stacks).

## 6. Dos and don'ts

Do
- Take every word, number and photo from the hooks; hide or `EmptyState` what a club lacks.
- Keep one `<h1>` (PageHero/NotFound). Section titles are `h2` (`SectionHead` or `.hj-h2`).
- Keep colour contrast: white text on cran/azure/violet/royal/night, ink text on gold/turq/white/cream.
- Give every interactive element ≥ 44px (min 24px) and a visible focus (`--hj-focus` sets the ring colour on coloured grounds).
- Use `withYear()` for year-scoped links (project, dignitary) exactly as Gold does.
- `min-width:0` on grid/flex children holding API text; `overflow-wrap:anywhere` on names/titles.
- Test mentally at 390px: two columns max for cards; nothing wider than the screen.

Don't
- Don't edit kit.jsx, motion.js, theme.css, Site.jsx, Home.jsx — ask the lead (report a `sharedRequest`).
- Don't use Tailwind utility classes in theme pages (only the fallback pages use them).
- Don't use `.reveal`, `[data-count]`, `[data-split]`, `data-spotlight`, `data-tilt`, `.route-enter`.
- Don't set hidden start states in CSS or animate with CSS keyframes on load (reduced motion must show everything).
- Don't pin anything on phones or anything taller than the viewport.
- Don't put a `transform` on page wrappers that contain a pin or a `position:fixed` dialog.
- Don't invent copy, numbers, quotes or dates. Sentence case, plain words.

## 7. Class naming

`hj-<page>-<part>` with BEM-ish modifiers, page CSS in `pages/<Page>.css`:
`hj-about-*`, `hj-dir-*`, `hj-bod-*` (Directors), `hj-cal-*`, `hj-proj-*`, `hj-pd-*`
(ProjectDetail), `hj-ev-*` (Events), `hj-ed-*` (EventDetail), `hj-pp-*`, `hj-nl-*`, `hj-gal-*`,
`hj-dig-*`. Any element selector in a page sheet is written under a page class
(`.hj-dir-card h3`), never bare, and never under `html`/`body` without
`html[data-theme="horizontal-journey"]`.
