# Split Story — design notes for page agents

Theme key `split-story` · prefix `spl-` · preview http://localhost:8101/ · reference
`E:/club-website/Theme8-Samples/C-split-story/index.html` (look + motion only; its data is one club).

Read `src/themes/README.md` first. You own only `pages/<Page>.jsx` + `pages/<Page>.css`. Everything
below is already built: import from `../kit.jsx`, `../motion.js`, `../../_shared/data.js`.

## 1. Character in one paragraph

A royal-blue field and a white reading column. The page is told in **chapters**: on wide screens a
royal side panel stays put (sticky) while the reader scrolls the other column, and the panel's big
condensed title and its gold figure change — the title's letters rise and un-stretch
(ScrollFloat), the figure counts to its new value — whenever a new chapter or item crosses the
middle of the screen. Photos open through an **iris** or a **diagonal wipe**. Figures sit on
**stacked cards** that swing in and sink back. The close of a page is a **gold band** rising from
the bottom edge. Nav hover is a **gold pill** that slides to the item. Type is loud (Archivo set
condensed, 800) against calm body copy (Manrope).

## 2. Tokens (declared on `html[data-theme="split-story"]`)

| token | value | use |
|---|---|---|
| `--spl-royal` | #17458F | the field (heroes, panel), titles on white, primary buttons |
| `--spl-night` | #0B2350 | body text, footer, dark cards, row rules |
| `--spl-gold` | #F7A81B | accent: figures on royal/night, pressed chips, the closing band, pills |
| `--spl-sky` | #3CC4FF | highlight on royal only (orbits, rings) — never text on white |
| `--spl-azure` | #0067C8 | links + eyebrows + roles on white |
| `--spl-mist` | #EAF3FC | quiet grounds (tags, empty states, photo frames) |
| `--spl-muted` | #4A5B7A | secondary text on white (6.8:1) — NOT on gold (switch to night) |
| `--spl-line` | #CFDDEE | hairlines, card borders |
| `--spl-display` | Archivo … | display face; always with `font-stretch` 62–80% and weight 800 |
| `--spl-body` | Manrope … | body/UI |
| `--spl-gutter` | clamp(16px,4vw,56px) | side padding everywhere |
| `--spl-max` | 1440px | `.spl-x` container width |
| `--spl-strip` | 0 / 60px (<1000px) | height of the phone panel strip (offset sticky things by it) |
| `--spl-radius` / `--spl-radius-sm` | clamp(20–32px) / clamp(16–24px) | card + frame corners |
| `--spl-shadow` | 0 30px 60px -30px rgba(11,35,80,.45) | lifted cards |
| `--spl-ease` | cubic-bezier(.7,0,.2,1) | CSS transitions |

Allowed text pairs: white on royal, gold on royal (≥ 24px or bold ≥ 19px), white 82% on royal,
night on white/gold/mist, royal on white/mist, azure on white, muted on white, gold on night.
**Never**: gold text on white, sky text on white, muted on gold.

### Type scale (condensed display = `font-family:var(--spl-display);font-stretch:68%;font-weight:800`)

| role | size | line-height |
|---|---|---|
| page `<h1>` (PageHero) | clamp(44px, 9vw, 132px) | .9 |
| section title (SectionHead) | clamp(38px, 5.6vw, 84px) | .92 |
| band title | clamp(52px, 9vw, 150px) | .88 |
| card/person name | stretch 78%, clamp(1.35rem, 2vw, 1.7rem) | 1.05 |
| big figure | stretch 68%, clamp(40px…150px) | .85, `tabular-nums` |
| lead (`.spl-lead`) | stretch 100%, weight 700, clamp(28px, 3.3vw, 50px) | 1.08 |
| body | Manrope 1rem / 1.0625rem prose | 1.65 / 1.75 |

Every display word must fit at 390px: use `clamp()`, `overflow-wrap:anywhere` where API text meets
a grid track, and `min-width:0` on grid/flex children.

## 3. Page skeleton (every inner page)

```jsx
import { useRef } from 'react'
import { useClub, useDirectoryData, usePageTitle, useCurrentMenuName } from '../../_shared/data.js'
import { PageHero, SectionHead, Loading, EmptyState } from '../kit.jsx'
import { useScene, revealBatch, useRefreshOnImages } from '../motion.js'
import './Directory.css'

export default function Directory() {
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directory'
  usePageTitle(title)
  const members = useDirectoryData()            // null while loading
  const ref = useRef(null)
  useRefreshOnImages(ref, [members])
  useScene(ref, () => { revealBatch(ref.current.querySelectorAll('.spl-dir-card')) }, [members])
  return (
    <div className="spl-dir" ref={ref}>
      <PageHero title={title} stat={members ? { value: members.length, label: 'Members' } : null} />
      <section className="spl-section"><div className="spl-x">
        {members === null ? <Loading label="Loading members" />
          : members.length === 0 ? <EmptyState title="No members listed yet" message="…" />
          : <ul className="spl-grid">…</ul>}
      </div></section>
    </div>
  )
}
```

* **PageHero is mandatory** and holds the page's only `<h1>`. Crumbs default to `Home / {title}`;
  detail pages pass `crumbs={[{ label: 'Projects', href: '/projects' }, { label: p.title }]}`.
* Content sections: `<section className="spl-section">` (+ `--mist`, `--royal`, `--night`) with
  `<div className="spl-x">` inside. Grids: `<ul className="spl-grid" style={{ '--spl-min': '240px' }}>`.
* A page that tells a story uses `<Split>` (§5) right under the hero instead of sections.
* End long pages with a `<GoldBand>` only when there is real content for it (meeting, CTA to a
  related page) — never an empty gold slab.

## 4. Kit (`../kit.jsx`)

All components are styled in `theme.css`; motion is built in where noted (it runs its own
`useScene`, is reverted on unmount, and does nothing under reduced motion).

| component | props | notes |
|---|---|---|
| `PageHero` | `title, crumbs?, eyebrow?, lead?, stat?, media?, children?, className?` | royal band, crumbs, `<h1>` (ScrollFloat letters). `stat={value,label,fmt?,currency?}` = gold figure that counts up — pass it only once loaded. `media={src,alt,fallbacks?}` = wide photo that opens through the iris as the page scrolls (detail pages). `children` = filters/search on royal (use them `spl-on-dark`-aware: Chips/SearchField already restyle). |
| `Crumbs` | `items=[{label, href?}]` | used by PageHero; ONLY the last item is `aria-current="page"` (a middle item without href is plain text) |
| `SectionHead` | `title, eyebrow?, id?, as='h2', action?, tone='light'|'dark'` | condensed royal title, letters rise once on scroll. `action` = a Button/TextLink on the right |
| `Button` | `href?, variant='royal'|'gold'|'ghost'|'light', external?, srHint?, arrow=true, ...rest` | pill; `<a>` with href, `<button>` without. `external` adds new-tab + sr text (`srHint` replaces it, e.g. ' (PDF, opens in a new tab)') |
| `TextLink` | `href, external?` | underlined azure (gold on dark) link |
| `BackLink` | `href, children` | "← Back to …" |
| `Tag` | `tone='mist'|'gold'|'royal'` | small pill (avenue, category, status) |
| `Card` | `href?, img?, alt?, tag?, title, meta?, children?, external?, titleAs='h3'` | photo card 4:3 (ringed mist ground when no photo), stretched title link, lift on hover. Frame class `.spl-card-media` — run `photosIn('.spl-card-media')` for the iris/wipe entrances |
| `PersonCard` | `name, role?, img?, href?, bio?, nameAs='h3'` | 4:5 portrait, initials on royal when no photo, azure role, clamped bio |
| `Chips` | `label, items=[{value,label,count?,ariaLabel?}], value, onChange` | buttons with `aria-pressed`; pressed = gold |
| `SearchField` | `id, label, value, onChange, placeholder?` | pill input with visible label |
| `ResultCount` | `count, total?, noun=['member','members']` | `aria-live="polite"` |
| `StatRow` | `items=[{value,label,fmt?,currency?}], tone='light'|'dark'` | ruled row of figures, count up on scroll |
| `StatStack` | `items=[{value,label,fmt?,currency?,tone?}], panel?={title,sub}` | THE stacked sticky cards (tones cycle gold/azure/night/mist/royal). Inside a Split, `panel` makes each card re-title the side panel |
| `Split` | `rail=[titles], deps=[…], children` | THE sticky side panel + story column (§5); a rail of more than 6 flows into two columns, filled column by column (`--spl-rail-rows`) so months/decades read top to bottom |
| `Chapter` | `id, title, state={value,from?,fmt?,currency?,suffix?,caption?,sub?}, showTitle=false, className?` | one Split chapter; its `<h2>` is visually hidden (the panel shows it) unless `showTitle` |
| `fig(state)` | returns `{ 'data-spl-fig': … }` | spread onto any element inside a Split to make it a panel state |
| `Timeline` + `TimelineItem` | `Timeline watch?` · `TimelineItem label?, tag?, photo?, photoAlt?, title?, titleAs='h3', state?, children` | gold-to-azure line draws, dots pop, labels slide, photos alternate iris/wipe; portrait photos get a narrower frame automatically |
| `WipeList` + `WipeRow` | `WipeList watch?` · `WipeRow href?, title, meta?, cta='Open', external?, srHint?, status='Not available', state?` | rows that fill with gold from the left; the CTA pill leans to the pointer (fine pointers). No `href` = not a link: no wipe, `status` where the pill would be |
| `Slider` | `slides=[{src,fallbacks?,url?,alt}], label, itemLabel='banner', tone='dark'|'light', fit='cover'|'contain', frameClass='spl-frame--banner'|'spl-frame--ad', interval=6000` | diagonal-wipe slider; dots + pause; slide with `url` is the link |
| `GoldBand` | `id, title, giant?, children` | the closing gold band (rises from the bottom; title letters float up with scroll; `giant` slides). Facts inside: `<dl className="spl-facts">` (`.is-long` on a long value) |
| `EmptyState` | `title, message?, action?, headingAs='h2', tone='light'|'dark'` | designed "nothing yet" |
| `NotFound` | `title, message?, crumbs?, backHref, backLabel` | full-page not-found (renders PageHero → its h1) |
| `Loading` | `label` | resting state while a hook returns `null` |
| `Num` | `value, fmt='group', currency?, suffix?, as='span'` | a figure motion can count (`countUp`). Use for every animated number |
| `formatFig(fmt, v, currency, suffix)` | | `fmt`: `group` (club-locale digits), `money` (compact ₹3.90 Cr / Rs 8.16 M), `moneyFull`, `plain`, `pad` (01) |
| `excerpt(text, max=180)` | | word-safe cut with … (plain text in) |
| `yearText(label)` | | '2026-2027' → '2026–27' (every page shows the Rotary year this way) |
| `charterYear(html)` | | the charter year the club's About text states, else 0 (Home, About, Past presidents) |
| `htmlText(html)` | | admin HTML → plain text with EVERY entity decoded (the shared `plainText` leaves `&ndash;`/`&rsquo;` literal). Use it wherever admin rich text is shown as plain text (Home's story) |
| `useLightboxFocus(open, backRef)` | | hook for the shared PhotoLightbox (which moves no focus): the rest of `<body>` inert, Lenis paused, focus to its close button and back to `backRef.current` on close |
| `Arrow`, `Chevron` | `dir` | icons |
| re-exported | `PersonPhoto, SafeImg, imgFallback, paragraphs` | from `_shared/kit.jsx` |

Utility classes in theme.css: `.spl-x` (container), `.spl-section(--mist|--royal|--night)`,
`.spl-grid` (+ `--spl-min`), `.spl-wrap` (720px reading column), `.spl-lead`, `.spl-prose` (admin
HTML: headings, lists, links, images, tables that scroll), `.spl-sr` (visually hidden),
`.spl-on-dark` (put on any royal/night block so focus rings, chips, links switch to their dark
variants), `.spl-ghost` (outlined giant text).

## 5. The Split (signature layout)

```jsx
const rail = ['Our story', 'Where we meet', 'Leadership']
<Split rail={rail} deps={[loaded, clubYear]}>
  <Chapter id="spl-about-story" title="Our story" state={{ value: 1991, from: 1966, fmt: 'plain', caption: 'Chartered in 1991' }}>
    <div className="spl-wrap">…</div>
  </Chapter>
  <Chapter id="spl-about-meet" title="Where we meet" state={{ value: 'Thu', caption: '7:30 PM onwards', sub: 'Hotel …' }}>…</Chapter>
  …
</Split>
```

* Wide (≥1000px): 42/58 grid, royal panel sticky at 100svh with orbit, title, figure, caption,
  sub, the rail (current chapter lit gold) and a gold progress line. Phone: the panel is a 60px
  sticky strip (title + figure); everything else in the story column is ordinary vertical flow.
* **State** = `{ title, value, from?, fmt?, currency?, suffix?, caption?, sub? }`. Numeric
  `value` counts from `from` (default 0); a string `value` ('Thu', '2026–27') is shown as-is. The
  title letters only re-rise when the title changes; items inside a chapter can re-state the
  figure/caption with the same title (e.g. each director: `{ title: 'The board', value: i + 1,
  fmt: 'pad', caption: d.role }`).
* The active state is the **last marker whose top is above the middle of the viewport**, in DOM
  order. Put markers on elements in reading order.
* `deps` must change whenever markers change (data loaded, filter/year switched) and keep a
  constant length. `rail` titles must be unique and equal the chapter titles.
* Real headings stay in the column (Chapter's hidden `<h2>`) — the panel is `aria-hidden`.

## 6. Motion (`../motion.js`)

`motion.js` re-exports everything in `_shared/motion.js` (`useScene, useRefreshOnImages,
refreshSoon, afterFonts, scrollToY, lockScroll, getLenis, gsap, ScrollTrigger, SplitText…`) plus:

| helper | call inside `useScene(ref, (c, ctx) => …)` |
|---|---|
| `riseChars(ctx, el, {delay, duration, stagger, scrollTrigger, scrub})` | ScrollFloat letters; waits for fonts; reverts when done (non-scrub) |
| `titleIn(ctx, el)` / `titleOnScroll(ctx, el)` | page title entrance / section title on scroll (kit uses them) |
| `revealBatch(targets, {y=40, stagger=.08, start})` | batch fade-up of cards/rows (opacity only — stays focusable) |
| `riseIn(targets, {delay=.5})` | small things rise in on load |
| `irisIn(frame)` / `wipeIn(frame)` / `photosIn(frames)` | photo frame opens through a circle / diagonal wipe / alternating down a list (image inside settles from 1.25), scrubbed. The frame needs `overflow:hidden` |
| `irisOnce(frame, {delay, start, duration})` | the iris PLAYED once as the frame scrolls in (a detail page's portrait/poster, usually on screen at load) |
| `parallax(img, {amount=12})` | scrubbed drift of an image inside a clipping frame |
| `blurWords(ctx, el)` | lead paragraph words sharpen from blur as read (scrubbed) |
| `countUp(ctx, numEl, {trigger, start, duration})` | counts a `<Num>` from 0 when it scrolls in |
| `swingStack(cards, sentinels)` | the stacked-card swing/sink (StatStack uses it) |
| `timelineIn(ctx, tlRoot)` | Timeline uses it |
| `goldBand(ctx, band)` | GoldBand uses it |
| `magnet(ctx, area, pill)` | pill leans to the pointer — only when `c.fine` |
| `onRevert(ctx, fn)` / `later(ctx, fn)` | cleanup on revert / run after fonts |
| `SPL_WIDE` (`(min-width:1000px)`), `isWide()`, `motionOn()` | the split breakpoint. `c.wide` in useScene is 900px — for layout-bound motion (3D, pins) nest `gsap.matchMedia().add(SPL_WIDE, (mctx) => …)` inside the setup, as Home does |
| not in a scene: `wipeSlide`, `irisOpen/irisClose`, `swapChars` | Slider, menu/dialog iris and panel internals. `irisClose` is a `fromTo` from the full circle: the open tween clears clip-path to `none`, and tweening from `none` starts at radius 0 (the layer vanished instead of closing) |

Rules that bite (README §5 plus):
* Any element whose text SplitText touches (`riseChars`, `blurWords`) must be **keyed by its text**
  (`<h2 key={title}>`) if that text can change while mounted — React must never update a split node.
* Animated numbers: always `<Num>` + `countUp`, never tween a React text node.
* No hidden start states in CSS; `gsap.from`/`fromTo` only. `filter` tweens are `fromTo` with
  explicit values. Entrances `clearProps` what they animate (revealBatch does).
* Hover effects on elements GSAP transforms: use the individual `translate`/`scale` properties
  (the kit's card lift does).
* Pin/3D only on wide + motion and only what fits the viewport; phones get a vertical layout.
  Keyboard focus inside a pinned/3D track must scroll it into view (see `leadersRing` in Home.jsx).
* Invisible stacked things get `visibility:hidden` or `pointer-events:none` (Slider does).
* Call `useRefreshOnImages(ref, [data])` on pages with API photos.

## 7. Page directions

Titles come from `useCurrentMenuName()` with the fallback shown; `usePageTitle(title)` always.
Class names: `spl-<page>-*` — `spl-about-`, `spl-dir-`, `spl-bod-`, `spl-cal-`, `spl-proj-`,
`spl-pd-`, `spl-ev-`, `spl-evd-`, `spl-pp-`, `spl-nl-`, `spl-gal-`, `spl-dig-`.

### About (`useAboutData`)
* **Layout:** PageHero (`eyebrow` = club name, no stat) → `<Split>` with chapters *Our story* (the
  admin HTML in `.spl-prose`, first paragraph styled `.spl-lead` if you split it off safely — or
  just the prose), *Where we meet* (day/time/venue as `.spl-facts` on white, map link), *Leadership*
  (President + Secretary `PersonCard`s → `/dignitary?Type=4|5` with `withYear`), *Contact* (club
  email/phone exactly as the shared About shows them; `mailto:`/`tel:` links).
* **Memorable moment:** the panel's figure counts up to the **charter year** from 25 years earlier
  while the story is read (same rule as Home: `/\bchartered\s+(?:on|in)\b[^.]{0,40}?\b(19|20)\d\d/`
  on the plain text; fall back to the Rotary year label).
* **Must-haves:** HTML via `dangerouslySetInnerHTML={{ __html: d.html }}` (already wrappable);
  long `&nbsp;` text wraps; images/tables inside stay within the column; empty `html` → EmptyState.
* **Phone:** strip shows the chapter title + figure; chapters stack.

### Directory (`useDirectoryData` → members | null; `{ name, work, img }`)
* **Layout:** PageHero with `stat={value: members.length, label: 'Members'}` and in `children` a
  `SearchField` + A–Z `Chips` (only letters present) + `ResultCount`. Below: members grouped by
  initial letter inside a `<Split rail={letters}>`, each letter a `Chapter` (`state={{ value: 'A',
  caption: n + ' members' }}`), cards = `PersonCard` (name, role = work) in `.spl-grid`
  (`--spl-min:200px`).
* **Memorable moment:** the giant gold **letter** in the panel flips to the next initial as you scroll
  the roll (ScrollFloat on the title "A", "B"…).
* **Must-haves:** hundreds of members → `revealBatch` only (no per-card timelines), lazy photos
  with width/height, initials fallback. While searching, drop the Split and show a flat grid (keep
  `ResultCount`). No personal contact data beyond what the shared Directory shows.
* **Phone:** 2-column grid (`--spl-min:150px`), strip shows the letter; chips wrap.

### Directors (`useDirectorsData` → `{ name, role, img, bio }` sorted)
* **Layout:** PageHero (`stat` = board size). Then `<Split rail={['The board']}>`: one Chapter;
  each director is a wide row card (photo 4:5 left 34%, azure role, condensed name, bio clamped
  with a "Read more" disclosure button that expands in place) carrying `fig({ title: 'The board',
  value: i + 1, from: i, fmt: 'pad', caption: role, sub: name })`.
* **Memorable moment:** the panel number ticks **01 → 02 → …** with the role underneath as each
  director reaches the middle; portraits open through the iris (`photosIn`).
* **Must-haves:** bio HTML/plain as the shared page renders it; initials fallback; 1 or 40 directors.
* **Phone:** single column, photo on top (4:5 max 320px), strip shows the number.

### Calendar (`useCalendarData(year, month)` → `{ loading, flags, birthdays, anniversaries, events }`)
* **Layout:** PageHero with a month switcher in `children`: prev / next `Button variant="light"`
  (aria-labels "Previous month"/"Next month") around the month name (`aria-live="polite"`). Chips
  (All / Birthdays / Anniversaries / Events) with counts. Then a `<Split>` whose chapters are the
  **days that have entries** (`state={{ value: day, fmt: 'pad', caption: weekday, sub: n + ' entries' }}`),
  each day listing PersonCards (small) and event links (`/event?id=`).
* **Memorable moment:** the panel's gold **day number** counts to each day as you scroll the month,
  and the month name rises letter by letter on every month change (key the title by month).
* **Must-haves:** follow CalendarGold for the month/year state and query contract; empty month →
  EmptyState ("Nothing on the calendar in {Month}"); `flags` for dots if you draw a mini grid.
* **Phone:** chips scroll-wrap; day chapters stack; strip = day number.

### Projects (`useProjectsData(isMeetings)` with `?pr=` contract) + ProjectDetail (`useProjectData(pid)`)
* **Projects layout:** PageHero (`stat` = shown count) with `children` = avenue `Chips` (`?pr=`
  pre-selects the tab exactly as ProjectsGold reads it; picking a chip is local state), area select, `SearchField`,
  `ResultCount`. Then a `StatRow` (Cost with `fmt:'money'` + club currency, Beneficiaries,
  Rotarians, Man hours from `metricsOf` — show `Loading` while `metricsPhase==='loading'`), then a
  `.spl-grid` of `Card`s (photo, avenue `tag`, title, date meta, "N updates" `Tag tone="gold"`).
* **Memorable moment (Projects):** switching avenue re-deals the grid — new cards wipe in with
  `photosIn('.spl-card-media')` + `revealBatch`, and the StatRow re-counts.
* **ProjectDetail layout:** `PageHero` with `media={{ src: p.photos[0] }}` when there is a photo (iris opens on scroll),
  crumbs Projects → title, `BackLink` honouring `?pr=CE`. Then `<Split>` chapters: *The project*
  (description prose; panel = date day/month), *Impact* (`StatStack` with cost/beneficiaries/
  rotarians/man hours that are > 0, `panel` set), *Updates* (child projects as a `Timeline`),
  *Photos* (`p.photos` + `p.photoCaptions`, grid + `PhotoLightbox`), *Share* (`useProjectShare`, as ProjectDetailGold).
  `notFound` → `NotFound` with back to `/projects`.
* **Must-haves:** non-INR currency via `formatMoney`/`fmt:'money'` + `club.currency`; hidden
  avenues/rules untouched (use the hook's data as-is); 0 or 300 projects.
* **Phone:** chips wrap, filters stack; cards 1-col < 480px; detail chapters stack.

### Events (`useEventsData` → sorted, year-scoped) + EventDetail (`useEventData(id)` → null | false | ev)
* **Events layout:** PageHero (`stat` = count, label "Upcoming"). Then `<Split>` whose chapters are
  **months** (`monthLabel`), each a `Timeline` of events: `label` = "Sat 14", `tag` = venue,
  `photo` = img, title, excerpt, `Button` "Details" → `/event?id=`, registration `Button
  external` when `reg`. Panel state per event: `{ title: monthLabel, value: +day, from: 1,
  fmt: 'pad', caption: weekday, sub: venue }`.
* **Memorable moment:** the panel counts the **date** from 01 to each event's day as it passes.
* **EventDetail layout:** PageHero (`media` = event image, `eyebrow` = weekday + date, crumbs
  Events → title) → a two-column block: left a gold date plate (day huge, month year), time, venue,
  registration button; right `.spl-prose` with `descHtml`. `ev === false` → NotFound → `/events`.
* **Must-haves:** empty year → EmptyState "No upcoming events in {year}"; past events reachable by
  id (the hook handles it).
* **Phone:** timeline stays (it is vertical); detail columns stack, date plate first.

### PastPresidents (`usePastPresidentsData` → `{ name, year, img }` newest first)
* **Layout:** PageHero (`stat` = count, label "Past presidents"). `<Split rail={decades}>`: a
  chapter per **decade** ("2020s", "2010s"…), inside a `.spl-grid` of compact portrait tiles
  (circle photo/initials, name, year label). Each tile carries `fig({ title: decade, value:
  startYear, from: startYear + 1, fmt: 'plain', caption: name })`.
* **Memorable moment:** the panel **year rolls back** like an odometer (2025 → 2024 → …) as you
  scroll into the club's history, the president's name as the caption.
* **Must-haves:** unparseable year labels sink (the hook sorts them) — put them in an "Earlier"
  chapter; photos often missing → initials look designed, not broken.
* **Phone:** 2-column tiles, strip shows the year.

### Newsletters (`useNewslettersData` → `{ title, date, url, monthLabel, isNewMonth, … }` | null)
* **Layout:** PageHero (`stat` = issues). Optional year/month chips if > 12 issues. Then a
  `WipeList` of `WipeRow`s (`cta="Read newsletter"`, `external`, `srHint=" (PDF, opens in a new
  tab)"` when the url ends in .pdf), grouped under `monthLabel` subheads (condensed royal,
  `isNewMonth`).
* **Memorable moment:** the gold wipe filling each row on hover with the magnetic royal pill.
* **Must-haves:** rows without `url` are not links (render title only); empty → EmptyState.
* **Phone:** CTA drops under the title (built in).

### Gallery (`useGalleryData(page)`, `?page=` contract, `GALLERY_PAGE_SIZE`)
* **Layout:** PageHero (`stat` = totalCount, "Photos"). A masonry-feel grid (CSS columns or grid
  with `grid-auto-flow:dense`, spans for every 5th photo) of photo buttons opening `PhotoLightbox`;
  caption = project title linking to `/project?pid=` (withYear). Pager: Prev/Next `Button`s + "Page
  n of N" as plain links preserving `yearId` (never `disabled` links — omit them).
* **Memorable moment:** photos open through the **iris / diagonal wipe alternately** as they enter
  (`photosIn`), with a slight `parallax` on the tall ones.
* **Must-haves:** lightbox Esc (PhotoLightbox) + focus in/return (`useLightboxFocus`); broken images hide
  (`SafeImg`); 0 photos → EmptyState.
* **Phone:** 2 columns, no spans; pager buttons full width.

### Dignitary (`useDignitaryData(type)`; `?Type=1` RI President, `2` DG, `4/5` president/secretary)
* **Layout:** PageHero (`eyebrow` = role, title = name, `lead` = designation/year). Then a
  `<Split rail={['Profile']}>` variant: the story column holds the portrait (4:5, iris-open) and
  the bio (`bioHtml` in `.spl-prose`); panel state `{ title: role, value: year label, caption:
  designation }`. Links to the other dignitary (Type 1 ↔ 2) as `Button variant="ghost"`.
* **Memorable moment:** the portrait opens through the iris while the name rises letter by letter.
* **Must-haves:** `!found` → EmptyState "Profile not published yet" (keep the h1 = role); bio HTML
  with `&nbsp;` runs wraps; no personal contact data.
* **Phone:** portrait max-width 360px above the bio.

## 8. Dos and don'ts

* **Do** open with PageHero, keep one `<h1>`, use kit pieces before writing new ones, keep royal for
  fields and gold for figures/accents, and give every empty case a designed EmptyState.
* **Do** use `.spl-on-dark` on any royal/night block, 44px targets, `aria-pressed` chips,
  `aria-live` counts, `withYear()` on year-scoped links, `rel="noopener noreferrer"` on new tabs.
* **Don't** invent copy, figures or quotes; don't hard-code a club; don't restyle `spl-` kit classes
  from a page file (add `spl-<page>-*` modifiers instead); don't use `.reveal`, `[data-count]`,
  `[data-split]`, `data-tilt`… (rotary-anim.js owns them).
* **Don't** put a transform on `<main>` or a wrapper around a Split (sticky breaks); don't pin on
  phones; don't hide anything in CSS for an entrance.
* **Don't** use gold as text on white or sky as text anywhere but royal.

## 9. Checking

curl each file through http://localhost:8101/src/themes/split-story/pages/<Page>.jsx (and .css) →
200; esbuild-bundle the page (README §7). No browser — a later stage verifies in Chrome.
