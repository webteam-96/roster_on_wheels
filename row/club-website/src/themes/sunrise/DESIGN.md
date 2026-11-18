# Sunrise — design guide for page agents

Theme 8 option H. Approved sample: `E:/club-website/Theme8-Samples/H-sunrise-modes/index.html`
(look + motion reference; its data handling is not a model). Read `src/themes/README.md` first —
wiring, file ownership, data and check rules there still apply. This file tells you how to make
your page read as the same site as the home.

**You own only** `src/themes/sunrise/pages/<Page>.jsx` and `pages/<Page>.css`. Import:

```js
import { useClub, useProjectsData, withYear, formatMoney /* … */ } from '../../_shared/data.js'
import { PageHero, SectionHead, Card, Button, Chips, SearchField, ResultCount, StatRow,
         EmptyState, Loading, NotFound, Person, People, Arch, Drum, Sheet, Cover, DateSun,
         WinSlide, SlideCtrl, useSlides, excerpt, ext, NewTab, Arrow } from '../kit.jsx'
import { useScene, flyTitle, revealBatch, tiltRise, focusPull, cleanups /* … */ } from '../motion.js'
import './Directory.css'
```

---

## 1. The idea

One sky for the whole site. Every page sits on a fixed sky band the shell scrubs by scroll:
**pre-dawn navy at the top of a page → Rotary royal blue → violet dusk**, and every inner page
ends at **sunrise over three hills** (the shell's dawn band) that becomes the footer. Light mode is
the same journey in daylight (morning sky → periwinkle → lilac → apricot). You never paint the
page background — the sky is behind you. You place **surfaces** on it: cards, panels, the sheet.

Characters: **Unbounded** (headings, numbers, names — wide, confident), **Instrument Serif**
(lead lines, "Rotary Club of", covers — warm, human), **Geist** (body, labels, UI).

Motion vocabulary (reuse, don't invent): things **arrive from depth** (z), **portraits rise in
arches like suns**, **lists turn like a drum under the reading line**, **text focuses** as it
reaches the reading line, **the sheet lifts and covers stand up**, **the sun rises over hills**.

## 2. Tokens (exact names — `var(--sun-…)`, declared on `html[data-theme="sunrise"]`)

Mode-dependent (light values swap in automatically under `html[data-sun-mode="light"]`):

| token | use |
|---|---|
| `--sun-ink` | primary text, names, titles |
| `--sun-mist` | secondary text, labels, captions |
| `--sun-accent` | eyebrows, meta caps, active states, focus ring, links on hover (gold at night / berry by day) |
| `--sun-line` | hairlines, field borders |
| `--sun-card-bg` `--sun-card-line` `--sun-card-shadow` `--sun-card-img` | card / panel surfaces; image ground |
| `--sun-field-bg` | inputs, chips, selects |
| `--sun-tint` | subtle hover fill on a surface |
| `--sun-hover-line` | hovered border |
| `--sun-name-grad` `--sun-num-grad` | gradient text for titles / figures (use `background-clip:text`) |
| `--sun-ring` `--sun-ring-dash` `--sun-ring-in` | concentric rings (crest, hero ring) |
| `--sun-sun-glow` | the soft sun glow behind a hero |
| `--sun-win-bg` `--sun-win-shadow` | the "window" (a framed picture) |
| `--sun-s0 … --sun-s9`, `--sun-x1 … --sun-x4` | sky stops (the shell uses them; you rarely need them) |

One palette in both modes (use for grounds that must not change): `--sun-dk` (deep plum-navy text
on light grounds), `--sun-dk2`, `--sun-berry` (accent on light grounds), `--sun-hill` (footer),
`--sun-night-ink` `--sun-night-mist` `--sun-night-accent`, `--sun-dawn` (the 5-stop dawn gradient
line), `--sun-sunbtn` (gold button gradient), `--sun-sheet` (cream at night / white by day).

Type & layout: `--sun-display` (Unbounded) `--sun-serif` (Instrument Serif) `--sun-sans` (Geist);
`--sun-h2-size` (THE section-heading size, clamp(30px, 3.4vw, 52px) — every `.sun-h2` uses it; a
section heading you style yourself takes `font-size: var(--sun-h2-size)`, never its own clamp);
`--sun-hh` (the header **bar** that stays pinned — offset sticky things by it, e.g.
`top: calc(var(--sun-hh) + 24px)`: 60px in fit mode, else 88px, 76 under 900px, 68 under 600px),
`--sun-strip` (the strip above the bar, which scrolls away: 104px in fit mode (96 at 900–1099px),
else 42px, 52px on touch screens so its controls are 44px targets) — both follow the header's mode
(§7), so read the tokens, never hard-code a header height; `--sun-pad` (page gutter, 16→48px),
`--sun-side`.

**Legibility rule (important).** At night the ink is light; it is only legible over the navy→violet
stops. Inner pages are held in that range by the shell automatically. **Do not put
`data-sun-sky` on your sections** (that switches the page into home mode). Dark text on a warm
ground only happens inside `<Sheet>` or an element with class `sun-on-light` (focus rings go dark
there). Everything else uses `--sun-ink/--sun-mist/--sun-accent`.

## 3. Type scale (classes in theme.css)

| class | what |
|---|---|
| `.sun-ph__title` (via PageHero) | the page's one h1 — Unbounded 700, clamp(36px, 6.4vw, 96px), gradient |
| `.sun-h2` | section title — Unbounded 600, `var(--sun-h2-size)` (30–52px). ONE size for every section heading, home and inner pages alike (client, 2026-10-05): no small variant, no per-page size |
| `.sun-h3` | card-level heading — Unbounded 600, 18–22px |
| `.sun-lead` | serif lead line, 22–36px; `<em>` = italic accent |
| `.sun-eyebrow` | 12.5px caps, .2em tracking, accent |
| `.sun-text` / `.sun-prose` | body copy (mist, 17px/1.65). **`.sun-prose` for admin HTML** — neutralises pasted inline font-size/colour/justify, styles lists, links, tables |
| `.sun-count` | "12 members" line |

Big display words must fit at 390px: always `clamp()` + `overflow-wrap:anywhere` where API text
meets a grid track ("Wednesday", "Karkhanis", "Newsletters" fit; long names wrap).

Layout helpers: `.sun-wrap` (max 1240px, gutters), `.sun-block` (section padding 40–88px),
`.sun-sec` (home-size 88–168px), `.sun-grid` (auto-fill cards ≥300px), `.sun-panel` (surface).

## 4. The page skeleton (every inner page)

```jsx
export default function Directory() {
  const members = useDirectoryData()            // null while loading
  const [q, setQ] = useState('')
  const list = useMemo(() => filter(members, q), [members, q])
  const ref = useRef(null)
  useScene(ref, (c) => { revealBatch(ref.current.querySelectorAll('.sun-dir-card')) }, [list.length])

  return (
    <div className="sun-page sun-dir">                 {/* root ALWAYS has sun-page */}
      <PageHero title="Directory">                     {/* crumbs + the h1; the tools render after the band */}
        <div className="sun-tools">
          <SearchField label="Search members" value={q} onChange={setQ} />
          {members && <ResultCount count={list.length} total={members.length} noun="member" />}
        </div>
      </PageHero>
      <section className="sun-wrap sun-block" ref={ref} aria-label="Members">
        {members === null ? <Loading label="Loading members" />
          : list.length === 0 ? <EmptyState title="No members match" message="Try a different name." />
          : <ul className="sun-dir-grid">…</ul>}
      </section>
    </div>
  )
}
```

- `PageHero` calls `usePageTitle` for you (with the club's own menu label, like every theme).
- Hooks before any early return. Keys on lists. Ids unique (`useId`).
- Copy: plain, sentence case, no invented facts or numbers.

## 5. Kit API (`../kit.jsx`)

**PageHero** `{ title, crumbs?, children?, size='lg'|'md', menuTitle=true, docTitle?, className? }`
A short band holding **only** the breadcrumb (Home / … / current) and the **one `<h1>`** (client,
2026-09-29: "keep only main heading & links"). Sun glow + ring behind; the entrance (sun rises,
letters arrive from depth, title drifts past on scroll) is built in. There is **no eyebrow, lead or
aside** — an intro line or a portrait the page still needs goes in the page body.
- `children` — functional controls only (search + count, filter chips, a month switch, a
  switcher, a stat row). They render right **after** the band, in
  `<div class="sun-wrap sun-ph-after">` (a modest top gap): the first row of the page body. The
  row is always rendered, and is hidden while `:empty`, so tools that arrive with the data still fade
  in. To style what follows it, use `.sun-ph-after:not(:empty)+…`.
- `menuTitle` — the club's menu label for this route replaces `title` (keep true on list pages;
  **false** on detail pages whose title is data).
- `crumbs` — items after Home: `[{ label:'Projects', href:'/projects' }, { label: p.title }]`.
- `size="md"` for long data titles (project/event names). `docTitle` overrides `<title>`.

**SectionHead** `{ eyebrow?, title, intro?, action?, id?, as='h2', center? }` — h2 has
class `sun-fly`; animate with `flyTitle(ref.current.querySelectorAll('.sun-fly'), c)`. One size
(`--sun-h2-size`); the old `small` prop is gone.

**Button** `{ href?, variant='sun'|'line'|'dark', small?, external?, icon='arrow'|'ext'|'back'|false, …rest }`
`<a>` when `href`, else `<button type="button">`. `external` → new tab + sr note + ↗ icon.
`sun` = gold gradient (the one main action per view), `line` = outlined, `dark` = on Sheet/sunrise.
Plain text link: `<a className="sun-link" href=…>All events →</a>`.

**Card** `{ href?, img?, alt='', ratio?, fit='cover'|'contain', meta?, title, desc?, more='Read more', level=3, external?, onImgError?, children? }`
The sample's project card. `img: ''` shows the sunrise-glow ground (designed "no photo"),
`img: false` drops the photo block. Whole card is the link (title's `::after`). Put in
`<ul className="sun-grid"><li>…</li></ul>`. `meta` is the accent caps line (avenue · date).
- `fit="contain"` shows the **whole** photo (never cropped) over a blurred, dimmed fill of itself
  (the window's technique), with no hover zoom. The fill (`.sun-card__fill`, decorative) comes first
  in the frame, so `tiltRise(cards, '.sun-card__img img')` drifts the fill, not the photo. Both
  images vanish if the URL fails. Default `cover` fills the frame (cropped, zooms on hover).

**Panel** `{ as='div', className, …rest }` — a plain surface (radius 24, card ground).

**Chips** `{ label, options:[{ value, label, count?, aria? }], value, onChange }` — toggle buttons with
`aria-pressed`, inside `role="group"`. Selected = gold gradient pill.
**SearchField** `{ label, placeholder?, value, onChange }` — 16px input (no phone zoom), clear button.
**ResultCount** `{ count, total?, noun='result', plural? }` — `aria-live="polite"`.
Wrap filters in `<div className="sun-tools">` (flex, wraps).

**StatRow** `{ items:[{ label, value, money? } | { label, text }], currency, center? }`
Gradient Unbounded numbers over caps labels; counts up on entry; zero values dropped; returns
null when nothing is left. Money uses `formatMoney(value, currency)` — pass the **club's**
currency (`club.currency`), never a project's.

**EmptyState** `{ title, message?, action?, as='h2' }` — a small sun on its horizon. Use for every
"nothing here" (no data, no search results). **Loading** `{ label }` — `role="status"`.
**NotFound** `{ title, message?, crumbs?, backHref, backLabel }` — a whole page (hero + empty
state + way back) for unknown ids (`?pid=0`, missing event).

**Arch** `{ src, name, small?, decorative?, eager? }` — the arch-topped portrait with halo; initials
when no photo. `decorative` when the name is printed beside it (hidden from screen readers);
`eager` for a hero portrait above the fold.
**Person** `{ src, name, role?, bio?, href?, more?, small?, as='li', level=3, children? }` — arch
(decorative) + role caps + Unbounded name (whole card links when `href`) + clamped bio, then
`children` (an action such as a Read more `Button`, on cards without `href`). The card's hover and
focus ring belong to the name's link alone, so a child action keeps its own.
**People** `{ children, cols?, animate=true, deps? }` — centred rows (4 wide / 2 phone) whose
portraits **rise like suns** (built in). Use for ≤ ~24 people; for hundreds use your own grid +
`revealBatch` (one trigger per row, cheap).

**Drum** `{ items:[{ key, label, href? }], label }` — numbered list that turns on a cylinder
under the reading line (built in); a plain numbered list without motion. Text lines only.
For richer rows (year + name + photo) build `<ol className="sun-drum">` yourself and call
`drum(listEl)` in your scene (return its cleanup).

**Sheet** `{ as, className, children }` — cream (night) / white (day) sheet with the dawn rule;
dark text; `.sun-eyebrow` turns berry inside. **Cover** `{ name, sub? }` — night-sky newsletter
cover with a sun rising from its foot, serif italic name, caps sub line.
**DateSun** `{ day, mon, small? }` — a sun-disc date badge ("24" / "SEP").
**DateRise** `{ day, mon, className }` — a DateSun rising off a horizon inside a solid + dashed
ring (decorative; size with `--d` on your class). Motion: `.sun-rise__ring`, `.sun-rise .sun-date`.
**Emblem** `{ src, alt, onError?, className }` — the club crest on a white disc in a glow + three
rings (home, About). Motion: `ringsRise(el.querySelectorAll('.sun-emblem__glow, .sun-emblem__ring'), el)`.
**SocialLinks** `{ socials, className='sun-socials', label }` — the club's socials as round icons
(new tab); null when none.
**Hills** — the three decorative hills (the shell already draws them above the footer).

**Window slideshow**: `const s = useSlides(n, 6000)` (autoplay only with motion; pausable),
`<div className="sun-win"><div className="sun-win__slides">{items.map((x,i) => <WinSlide key={i}
src={x.src} fallbacks={x.fallbacks} url={x.url} on={i===s.idx} alt={…} />)}</div></div>` +
`<SlideCtrl n={n} s={s} label="Project photos" />`. Pictures are shown whole (contain) over a
blurred fill of themselves — never cropped. Override the frame with your own class, e.g.
`.sun-pd-win{aspect-ratio:16/10}`.

Text helpers: `excerpt(textOrHtml, max=220)` (whole sentences when possible, never "Dr." cuts,
emoji stripped), `emFirstDate(text)` (first date/year in `<em>` — the serif lead accent),
`noEmoji(s)`, `yearText(label)` ("2026–27" — every page prints the Rotary year this way),
`demoteH1(html)` (admin HTML's `<h1>` -> `<h2>`, so a route keeps one h1 — use on every
`dangerouslySetInnerHTML`), `openHref(url)` (an admin-typed link for a new tab: bare host ->
https://, site paths kept). Links: `ext` (spread for new tab), `<NewTab />` (sr note). Icons: `Arrow ArrowLeft
ArrowUpRight Chevron SearchIcon CloseIcon PinIcon ClockIcon CalendarIcon` (16px, currentColor).
Re-exported from `_shared/kit`: `PersonPhoto SafeImg paragraphs imgFallback hideOnError
portraitFallback isPlaceholderPhoto`. `ADMIN_URL`.

## 6. Motion API (`../motion.js`)

Everything from `_shared/motion.js` is re-exported (`useScene, afterFonts, refreshSoon,
useRefreshOnImages, scrollToY, getLenis, lockScroll, gsap, ScrollTrigger, SplitText,
prefersReducedMotion`). Call helpers **inside** a scene:

```jsx
const ref = useRef(null)
useScene(ref, (c, ctx) => {          // runs only with motion; reverted on unmount / deps change
  const root = ref.current
  flyTitle(root.querySelectorAll('.sun-fly'), c)
  if (c.wide) revealBatch(root.querySelectorAll('.sun-card'))
  else tiltRise(root.querySelectorAll('.sun-grid > li'), '.sun-card__img img')
  return cleanups(drum(root.querySelector('.sun-drum')), flyChars(root.querySelector('.big'), ctx))
}, [data.length])                     // pass the loaded data in deps
```

| helper | what it does | returns cleanup |
|---|---|---|
| `flyTitle(targets, c)` | h2 comes out of the distance (z −380), holds, flies past the viewer | – |
| `focusPull(targets, c)` | text sharpens as it reaches the reading line (blur on wide only) | – |
| `ringsRise(targets, trigger)` | glows/rings grow from their centre | – |
| `parallax(targets, amount=12)` | gentle yPercent drift across the screen | – |
| `revealBatch(targets, {y,tilt,stagger})` | cards lift off a tilted plane, row by row, once; clears props after | – |
| `tiltRise(targets, imgSel)` | the phone treatment: scrubbed lift + photo drifts in its frame | – |
| `riseArches(people, c, cols?)` | portraits rise in arches (People does this for you) | – |
| `liftSheet(sheet, trigger?)` / `standUp(covers, trigger?)` | the sheet lifts; covers stand up, their suns rise | – |
| `sunrise(section, sunSel, end?)` | sun rises + hills parallax inside `section` | – |
| `flyChars(el, ctx, {trigger,start,end,aria})` | letters arrive from depth (SplitText after fonts). `aria:'none'` if a sibling holds the sr text | **yes** |
| `countUp(el, value, format)` | number counts up on entry (writes the text node; React-safe) | **yes** |
| `drum(olEl)` | the turning list (Drum does this for you) | **yes** |
| `photoTunnel(stageEl, c)` | pinned tunnel of photos (wide only; see §7 Gallery) | **yes** |
| `pageHeroIn(root, c, ctx)` | PageHero's entrance (built in) | **yes** |
| `headerHeight()` | the pinned header bar's height (the strip above it scrolls away) — pins start under it: `start: () => 'top ' + headerHeight() + 'px'` | – |
| `cleanups(...fns)` | combine cleanups into one return value | – |

Rules: no hidden start states in CSS (reduced motion = nothing runs, all visible); `<main>` never
gets a transform; only pin what fits the viewport and only when `c.wide`; keyboard focus inside a
pinned track must scroll it into view (photoTunnel does); tween `filter` only with `fromTo`;
GSAP writes `translate/rotate/scale: none` inline — CSS hovers on tweened elements go on a child or
use the individual properties (the kit's cards hover with `scale` on the img, not the card);
invisible stacked items get `visibility:hidden` + `pointer-events:none`. After late content
(images) call `useRefreshOnImages(ref, [deps])`. The shell sorts ScrollTriggers by position on every
refresh, so creation order does not matter.

## 7. Page directions

Each: layout concept · the one memorable moment · practical must-haves · phone.
Since the client round of 2026-09-29 every page head is crumbs + h1 only (§5 PageHero): no eyebrow,
lead or aside. Tools, figures and facts are PageHero `children`, rendered below the band.

### Home + shell (reference: `Home.jsx`, `Site.jsx` — not page-agent files)
- **Header:** two tiers: a strip (`--sun-strip`) that scrolls away over a bar (`--sun-hh`) that
  stays pinned; no district line (client, 2026-10-05). The shell measures whether the whole menu
  fits on the bar's row by itself and picks one of two layouts; the tokens follow the mode
  (`html[data-theme="sunrise"]:has(.sun-hdr.is-fit)`), and so does `headerHeight()` (it measures
  `.sun-hdr__bar`):
  - **fit mode** (`.sun-hdr.is-fit`, 900px+ only): the strip = the logo plate on the left, big
    (72px logo, 64px at 900–1099px), and the tools on the right (Rotary year, Admin login,
    light/dark as 34px pills, 44px on touch); the pinned bar = the menu alone, centred (60px).
  - **burger mode** (phones, tablets, a menu too long for the row): the strip = the tools (a 42px
    band, 44px pills in a 52px band on touch screens); the bar = the logo plate (60px logo, 48 under
    900px, 44 under 600px) + the burger. The burger menu's foot repeats the year, Admin login and
    the light/dark switch (48px), since the strip is gone mid-page.
- **Footer:** the club's logo plate + socials; the visitor counter; copyright + "Powered by Roster
  On Wheels". Inner pages end at the dawn band above it.
- **Home, top to bottom:** *intro* — the banner in a frame of its own shape (`--sun-bar`, eased
  between slides: no blurred bands, nothing cropped); with motion it pins and grows as big as the
  stage allows, sharp; then the impact figures (above zero only) arrive one by one out of the
  depth, count up at the centre and dock into ONE row as big as it allows (each slot as wide as its
  figure), then row and heading meet halfway (without motion: the window, then a plain row).
  *Leadership* (right after the figures) — RI President, DG, club President, Secretary: photo,
  designation, name and a real Read more link (a `Button` child of a `Person` without `href`; no
  bio). *About* — "About" + four clamped lines of the club's About text + Read more, the club's
  advertisements as bare pictures beside it (the crest when there are none). *Projects* — the
  tunnel under a heading that stays at the top, photos whole at their own ratio (tilted-plane cards
  on phones). *Upcoming events* — the next event. *Finale* — sunrise over the hills with ONE sheet:
  the latest newsletters | where we meet. Every section heading is `--sun-h2-size`.

### About (`sun-ab-*`) — `useAboutData()`
- **Layout:** PageHero — crumbs + the title only. Below, two columns: left (1/3) the **sticky
  crest** — the club logo on a white disc inside rising rings (like the home emblem); right (2/3)
  the story column, opened by the club's name as a serif `.sun-lead` line ("Rotary Club of *Name*, a
  member club of Rotary International."), then the full About HTML in `.sun-prose`
  (`dangerouslySetInnerHTML` of `html`, already wrappable), then contact and socials. No weekly
  meeting panel, no Leadership arches, no "Explore the club" drum (client, 2026-10-05).
- **Moment:** the prose **focus-pulls** paragraph by paragraph (`focusPull(root.querySelectorAll('.sun-prose > *'), c)`)
  while the crest's rings rise.
- **Must:** empty html → EmptyState; contact (email/phone) only as the shared About page shows it.
- **Phone:** one column; crest 60% width above the text; not sticky.

### Directory (`sun-dir-*`) — `useDirectoryData()` (null while loading)
- **Layout:** PageHero with `SearchField` + `ResultCount` as children (A–Z `Chips` of the letters
  that exist, in a sticky glass pill, for 13+ members). A grid of member cards: an `Arch` that fills
  its column + name (Unbounded 15–17px) + work (mist); 2 cols phone, 3 tablet, 4 at 900–1099px,
  5 desktop (client, 2026-09-29: bigger photos, five in a row).
- **Moment:** portraits **rise in their arches** row by row as you scroll (revealBatch on the
  cards — the list can be 300 long, so not per-card timelines); searching re-flows instantly.
- **Must:** case-insensitive search on name + work, live count, "No members match" EmptyState,
  initials for missing photos, long names wrap (`overflow-wrap:anywhere`), lazy images.
- **Phone:** 2 columns, search full width.

### Directors (`sun-bod-*`) — `useDirectorsData()`
- **Layout:** PageHero with `SearchField` + `ResultCount` as children (when the board has more than
  the two officers). ONE `People` grid of `Person`: photo, designation, name as h2 — no bio,
  buttons, links or dialog (client, 2026-09-29). The president and the secretary lead it; the rest
  follow in the club's own order.
- **Moment:** the portraits **rise like suns** over their horizon lines, row by row (not while a
  search re-flows them).
- **Must:** search on name + designation, "No match" EmptyState with Clear search; an empty board
  → EmptyState.
- **Phone:** grid 2-up.

### Calendar (`sun-cal-*`) — `useCalendarData(year, month)` (+ `monthName`, `dayLabelOf`)
- **Layout:** PageHero with a month switcher as children: prev / next buttons (aria-labels with the
  month names) around the month in Unbounded ("September 2026"). Then `Chips` — no "All"; only the
  kinds (Birthdays · Anniversaries · Events) that have entries in the scope (the month, or the picked
  day), with counts, one kind shown at a time, falling back to the first kind with entries (client,
  2026-10-05) — and a day-by-day list of that kind: each day a row with `DateSun small` and its
  entries (small arch photo + name for people; events link to `/event?id=`).
- **Moment:** changing month **turns the drum** — the month label rolls out (rotationX to −90,
  up) and the new one rolls in from below; the day rows re-enter with revealBatch.
  (Reduced motion: instant swap.)
- **Must:** month navigation exactly as the Gold page bounds it; empty month → EmptyState
  ("Nothing on the calendar for September"); loading state between months; `aria-live` count.
- **Phone:** one column; switcher full width with 48px buttons.

### Projects (`sun-prj-*`) + ProjectDetail (`sun-pd-*`)
- **Projects** — `useProjectsData(isMeetings)` (`?pr=CE` = club-service feed; `?pr=CP|VS|…` preselects
  the avenue tab). PageHero (crumbs + h1) whose only child is the figures, below the band: `StatRow`
  of Cost (money, compact) / Beneficiaries / Rotarians / Man-hours summed with `metricsOf` over the
  **filtered** list (while `metricsPhase==='loading'` show `{ label, text:'…' }` items, not zeros;
  none on the CE feed). Then a filter bar: avenue `Chips` (aria-pressed), the other filters as
  `<select className="sun-select">` with a visible `<label>`, `SearchField`, `ResultCount`. Then
  `.sun-grid` of `Card ratio="auto"` (the **whole** photo at its own ratio — no blurred fill, no
  hover zoom, very tall photos capped at 520px and contained, an empty frame shows the 4:3 ground;
  client, 2026-10-05; meta = avenue · date,
  title, `excerpt(desc, 160)`, `href=withYear('/project?pid=' + id, yearId)`, and carry `&pr=CE` on
  the CE feed exactly as Gold does), twenty at a time + "Show more".
  **Moment:** the grid **lifts off a tilted plane** (revealBatch wide / `tiltRise(cards, null)` on
  phones — no photo drift, its zoom would crop the whole photo) and the figures count up.
  **Must:** filters combine, count updates politely, "No projects match" state.
- **ProjectDetail** — `useProjectData(pid)`: `p === null && !notFound` → Loading; `notFound` →
  `NotFound` (back to `/projects` or `/projects?pr=CE`). PageHero `size="md" menuTitle={false}`,
  crumbs [Projects (back href), title]; its child is the facts row below the band (avenue in accent
  caps, date, place, Rotary year). The photos in a **window**
  (`WinSlide` + `useSlides`, captions below) opening `PhotoLightbox`; `StatRow` of the project's
  metrics (club currency); description in `.sun-prose`; child updates ("N updates") as a dated list
  (DateSun small + title); share row from `useProjectShare`. **Moment:** the window pictures shown
  whole over their own blurred light, dots + pause. **Phone:** window 4:3, stats 2×2.

### Events (`sun-evs-*`) + EventDetail (`sun-evd-*`)
- **Events** — `useEventsData()` (null while loading; already scoped to the selected year).
  PageHero; the **next event** featured large (photo if any, `DateSun`, weekday, "in N days" only
  computed from `ts`); then the agenda grouped by `monthLabel` (month in Unbounded as a divider),
  rows = `DateSun small` + title (link `/event?id=`) + weekday · venue, then a small line "View
  details" `Button` (same `/event?id=`; client, 2026-10-05) + Register (`reg`, external) when present. **Moment:** the date suns **rise along the agenda** — each disc scales
  from .6 and rises (y 40) as its row enters, staggered. **Must:** empty → EmptyState ("No
  upcoming events in Rotary year …"); venue text wraps.
- **EventDetail** — `useEventData(id)` (`null` loading, `false` not found → `NotFound`). PageHero
  `size="md" menuTitle={false}`, crumbs [Upcoming events (`/events`), title] — nothing else. The details
  Panel holds When (weekday, date), Time (when one is filed), Where + Open in Maps, and Register
  (`Button external`) if `reg`; the poster in a `.sun-win` beside it (shown whole, opens
  `PhotoLightbox`); `descHtml` in `.sun-prose`. **Phone:** stacked.

### PastPresidents (`sun-pp-*`) — `usePastPresidentsData()` (newest first)
- **Layout:** PageHero with `SearchField` (more than 4 presidents) + `ResultCount` as children.
  **Past years only**: the presidents before the selected Rotary year, no sitting-president block
  (client, 2026-09-29). The **roll**, one chapter per decade (its "2020s" heading at
  `--sun-h2-size`, like every section heading): an `<ol className="sun-drum sun-pp-roll">` whose
  rows are year (accent caps) + the arch (136px desktop, 108 tablet, 86 phone; initials when there
  is no photo) + name (Unbounded) — call `drum(ol)` per decade in your scene; drum() lights a tall
  row for as long as the reading line is on it.
- **Moment:** the roll of presidents **turns like a drum** under the reading line; the row at the
  centre lights its year and its arch.
- **Must:** missing photos → initials (the API often has none); empty → EmptyState; no match →
  EmptyState with Clear search.
- **Phone:** the drum still turns (vertical).

### Newsletters (`sun-nl-*`) — `useNewslettersData()` (null while loading)
- **Layout:** PageHero, then one `Sheet` holding a grid of issues: `Cover` (title as `name`,
  month/year as `sub`) + date + "Open PDF ↗" — each an `<a {...ext}>` with `(PDF, opens in a new
  tab)` sr text. 4 across desktop, 3 tablet, 2 phone. Optional month/search filter when > 12.
- **Moment:** the **sheet lifts** and the **covers stand up** one after another, their suns rising
  (`liftSheet`, `standUp` — for many issues call standUp per row of 4).
- **Must:** empty → EmptyState (outside the sheet), dates as text, dark focus rings inside the
  sheet (automatic via `sun-on-light`).
- **Phone:** 2 columns, sheet padding shrinks (built in).

### Gallery (`sun-gal-*`) — `useGalleryData(page)` (`?page=n`, GALLERY_PAGE_SIZE per page)
- **Layout:** PageHero with `ResultCount` (photos). On **wide + motion**, the page's first 8
  photos as a **tunnel** (same markup as home — `.sun-tunnel` > `.sun-tunnel__light`,
  `.sun-tunnel__sparks`, `.sun-tunnel__head`, `ul.sun-tunnel__cards > li.sun-tunnel__card`
  (style `--sun-tar` ratio, `--sun-w` width) > `article.sun-card` with a focusable link/button,
  `.sun-tunnel__end`, `.sun-tunnel__gauge b` — then `photoTunnel(stage, c)` when `c.wide`); below
  it the full grid of the page's photos (cover-cropped tiles, project title caption) opening
  `PhotoLightbox`. Pagination: Prev / numbered / Next links (`aria-current="page"`).
- **Moment:** travelling **through the tunnel of photos**, sparks streaming past.
- **Must:** lightbox keyboard (Esc, arrows) and focus return; alt = project title; lazy images
  with width/height; empty → EmptyState; page clamps.
- **Phone:** no tunnel — a 2-column grid with `tiltRise`.

### Dignitary (`sun-dig-*`) — `useDignitaryData(type)` (`?Type=1` RI President, `2` DG; 4/5 club officers)
- **Layout:** PageHero `menuTitle={false}`, title = the person's name (crumb = the office); its child
  is the switch between RI President and District Governor as **links** (`/dignitary?Type=1|2`,
  aria-current on the active one — it is navigation, not a filter). Below, a side plate (sticky on
  tall wide screens): the large `Arch` portrait in rings, then the office and the Rotary year;
  `bioHtml` in `.sun-prose` (max 70ch) beside it. Then "More leaders" as `Person` cards with `href`.
- **Moment:** the portrait **rises in its arch like the sun** (clip-path inset 100%→0, the halo and
  rings growing) as the plate arrives.
- **Must:** `found === false` → PageHero (title = the office) + EmptyState ("Profile not available
  for Rotary year …"); no personal contact data.
- **Phone:** the plate (arch 65% width) above the text, centred.

## 8. Dos and don'ts

**Do**
- Start every page with `PageHero`; one `<h1>` only (PageHero's).
- Put content on surfaces (`sun-card`, `sun-panel`, `Sheet`) or directly on the sky with
  ink/mist text — never invent a new background colour.
- Use the kit's `Card`, `Person`, `Chips`, `SearchField`, `ResultCount`, `EmptyState`, `Loading`
  so states look identical everywhere.
- Use one gold `Button variant="sun"` per view for the main action; `line` for the rest.
- Test your text on both modes mentally: only `--sun-*` tokens, no hex values in page CSS
  (except inside `.sun-on-light` grounds, where `--sun-dk`/`--sun-berry` apply).
- Handle: loading, empty, one item, hundreds, missing photos, long names, `&nbsp;` HTML, non-INR
  currency, year switch (`club.selectedYearId` in deps).

**Don't**
- Don't set `data-sun-sky`/`data-sun-warm` on inner-page sections (home only).
- Don't use `.reveal*`, `[data-count]`, `[data-split]`, `[data-nav*]`, `.route-enter`,
  `data-spotlight`, `data-tilt`, `data-magnetic`, `[data-slider]` (owned by rotary-anim.js).
- Don't transform `<main>`; don't pin on phones; don't pin anything taller than the viewport.
- Don't write element selectors unscoped — `html[data-theme="sunrise"] .sun-xyz img`, never `img`.
- Don't reuse the reserved component/home class names below for something else.
- No invented copy, numbers or quotes. Sentence case.

## 9. Class naming

Every class starts with `sun-`. Page classes: **`sun-<page>-<thing>`** with these page keys:

| page | key | page | key |
|---|---|---|---|
| About | `sun-ab-` | Events | `sun-evs-` |
| Directory | `sun-dir-` | EventDetail | `sun-evd-` |
| Directors | `sun-bod-` | PastPresidents | `sun-pp-` |
| Calendar | `sun-cal-` | Newsletters | `sun-nl-` |
| Projects | `sun-prj-` | Gallery | `sun-gal-` |
| ProjectDetail | `sun-pd-` | Dignitary | `sun-dig-` |

Root element: `<div className="sun-page sun-<key>">` (the `sun-page` class keeps the fallback-page
restyle off your markup). Elements inside a block: `sun-dir-card`, `sun-dir-card__name` (BEM-ish),
modifiers `is-*` for state (`is-on`, `is-open`).

Reserved (theme.css / home.css — use, don't redefine): `sun-page sun-wrap sun-sec sun-block
sun-grid sun-panel sun-eyebrow sun-h2 sun-h3 sun-lead sun-text sun-prose sun-shead* sun-btn*
sun-link sun-select sun-ph* sun-crumbs sun-card* sun-chip* sun-chips sun-tools sun-search* sun-count
sun-stat* sun-stats sun-empty* sun-loading* sun-date* sun-people sun-person* sun-arch* sun-sheet*
sun-cover* sun-drum sun-tunnel* sun-spark sun-win* sun-slidectrl sun-dot sun-pause sun-hills
sun-hill* sun-dawnband* sun-sr sun-on-light sun-c sun-w sun-fly` and the home's `sun-home
sun-intro sun-hero* sun-figs* sun-fig* sun-about sun-about__* sun-emblem* sun-projects
sun-leaders* sun-coming* sun-event* sun-news* sun-issue* sun-meet* sun-sunrise*`.
Shell: `sun-hdr* sun-nav* sun-sub sun-brand* sun-year sun-mode* sun-burger* sun-menu* sun-foot*
sun-socials sun-sky* sun-st* sun-skip sun-main`.

## 10. Checking (no browser — README §7)

`curl -s -o NUL -w "%{http_code}" http://localhost:8105/src/themes/sunrise/pages/<Page>.jsx` → 200
(and the `.css`); esbuild-bundle the page (README command) → no errors. Preview the page at
`http://localhost:8105/<route>` only if a browser stage asks you to; add
`?host=rctcv.rotaryindia.org` for a club with events and many banners.
