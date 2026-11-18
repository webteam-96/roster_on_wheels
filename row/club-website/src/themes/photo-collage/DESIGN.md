# Photo Collage: design notes for page agents

**The idea:** the club's year as a scrapbook. Pages sit on grainy paper. White photo prints are taped down at a slight tilt, and kraft-paper tags and memos hang beside them. Headlines are big Shrikhand letters filled with the club's own photos. Captions look handwritten, and pen strokes draw themselves as you scroll. The Rotary colours appear as the tape, stickers and ink.

Before you build a page:
- Read `src/themes/README.md` (the rules).
- Open the sample `E:/club-website/Theme8-Samples/G-collage-parallax/index.html` (the look).
- Open `Home.jsx` in this folder (how the look is done in React). The home page is the reference implementation.

You own only `pages/<Page>.jsx` and `pages/<Page>.css`. Everything below comes from files owned by the theme lead: `kit.jsx`, `motion.js` and `theme.css`. **Do not edit those files.** If you need something they don't provide, put it in your own page CSS with your page prefix, or report it as a `sharedRequest`.

---

## 1. Tokens and type

All tokens are defined on `html[data-theme="photo-collage"]`. Use the variables, never the raw hex values.

| token | value | use |
|---|---|---|
| `--col-paper` | #FCF9F3 | page ground (the body adds `--col-grain`) |
| `--col-ink` | #1C2340 | text, outlines, the ink chip |
| `--col-ink-2` | #4A4F66 | muted text on paper (7.7:1). **On kraft, use `--col-ink` instead** |
| `--col-white` | #FFF | photo prints, cards |
| `--col-cran` | #D41367 | primary accent. Use it for fills and for LARGE display type only |
| `--col-cran-ink` | #B80F58 | cranberry for SMALL text: links, roles, crumb separators |
| `--col-azure` `--col-royal` `--col-violet` | #0067C8 #17458F #901F93 | photo-type tints, chips. Royal is the footer colour |
| `--col-gold` `--col-turq` | #F7A81B #00ADBB | stickers and tape. **Put ink text on these, never white** |
| `--col-kraft` `--col-kraft-edge` | #DDC6A0 #B99B6B | memos, tags, empty states, monograms |
| `--col-photo-bg` | #E9E3D8 | behind a photo before it loads, or when it fails |
| `--col-display` | Shrikhand | titles and big numbers. It has **one weight, 400**. Never bold it |
| `--col-body` | Figtree 400–800 | body text and UI. Labels are 700–800 |
| `--col-hand` | Kalam 400/700 | captions, kickers, notes, counts |
| `--col-gutter` | clamp(16px, 4vw, 56px) | side padding. Gives a 16px gutter on phones |
| `--col-sec` | clamp(72px, 12vh, 144px) | vertical padding for a section |
| `--col-max` | 1240px | content width |
| `--col-lift` / `--col-lift-hi` | shadows | a print resting on paper / lifted on hover |
| `--col-grain` | svg noise | add it to kraft and paper surfaces: `background: var(--col-kraft) var(--col-grain)` |
| `--col-vel` | −1…1 | live scroll speed, set by the shell. Prints lean into a fast scroll |
| `--col-ease` | cubic-bezier(.2,.7,.2,1) | transitions |

**Type scale** (all sizes use clamp so they fit a 390px screen)
- Page `h1`: `PageHero` sets it at `clamp(2.6rem, 10.5vw, 7rem)`.
- Section titles: `SectionHead` sets them at `clamp(2.4rem, 9vw, 6.5rem)`.
- Card titles in Shrikhand: 1.5–2rem.
- Handwritten captions: 1.05–1.3rem, weight 700.
- Body text: 1.0625rem (17px) at line-height 1.65, with paragraphs no wider than 62ch.
- Small labels: .8125rem, weight 800, uppercase, letter-spacing .12em, in ink.

---

## 2. Every page starts the same way

```jsx
import { useRef } from 'react'
import { useScene } from '../../_shared/motion.js'
import { house } from '../motion.js'
import { PageHero, SectionHead, usePageName, yearDash, EmptyState, Loading } from '../kit.jsx'
import { useClub, useDirectoryData } from '../../_shared/data.js'
import './Directory.css'

export default function Directory() {
  const club = useClub()
  const name = usePageName('Directory')          // the club's own menu label; also sets <title>
  const members = useDirectoryData()              // null while loading
  const ref = useRef(null)
  useScene(ref, (c) => house(ref.current, c), [members])   // the whole house style in one call

  return (
    <div className="col-dir" ref={ref}>
      <PageHero
        title={name}
        kicker={'Rotary year ' + yearDash(club.selectedYearLabel)}
        img={firstPhoto}                          // a photo from THIS page's data fills the letters (optional)
        tint="azure"
        lead="The members of our club."           // one plain sentence, no invented facts
        prints={threePhotos}                      // up to 3 {src, caption} (optional, decorative)
      >
        {/* tools: SearchField, FilterGroup, ResultCount */}
      </PageHero>
      <section className="col-sec col-dir-body">…</section>
    </div>
  )
}
```

About `PageHero`:
- It is the page's **only `<h1>`**.
- It draws the breadcrumb `Home / <title>`. For detail pages, pass `crumbs={[{ label: 'Projects', href: '/projects' }, { label: title }]}`.
- It runs its own entrance: the crumbs rise, the title wipes in left to right, the arrow draws, the prints are dealt, and the paper cut-outs spin in.
- The prints are dealt in a staggered row whose edges barely touch, so no caption (a name, a photo title) is ever covered by its neighbour.
- Scrubbed entrances (`titleIn`, `drawIn`, `captionIn`) that are already past their start line when the scene builds (the first section title under a short hero) play once on a timer instead of resting half-drawn; `data-col-in` marks them so a rebuilt scene never replays them.
- As the page scrolls, the cut-outs race away and the photo pans inside the letters.

**Never put a transform or `route-enter` on your page root.**

---

## 3. Kit (`../kit.jsx`)

| component / helper | what it does |
|---|---|
| `PageHero({ title, crumbs?, kicker?, lead?, img?, tint?, prints?, children? })` | The page head. See section 2. `prints` items are `{ src, caption?, ratio?, fallbacks? }` (`fallbacks` = `'url\|url'` tried when the photo fails). The words play once per title; photos that arrive later are dealt in their own scene, so the title never wipes twice. |
| `Crumbs({ items })` | The breadcrumb on its own. |
| `SectionHead({ title, id, kicker?, img?, tint?, as='h2', center?, arrow? })` | Photo-filled section title with a pen arrow and a handwritten kicker. Give the `<section>` `aria-labelledby={id}`. `decor()`/`house()` animates it. |
| `Button({ href?, external?, variant='cran'\|'ink'\|'ghost' })` | A pill. Renders `<a>` when given `href`, otherwise `<button type="button">`. With `external` it opens a new tab and adds screen-reader text. |
| `TextLink({ href, sr?, external? })` | An underlined cranberry link, 44px tall. Pass `sr={item title}` so "View project" reads "View project: <title>". |
| `Print({ src, alt, caption, captionAs, tape, r, k, ratio='4 / 3', href?, external?, fallbacks?, speed?, deal? , children })` | A taped white photo print. `r` = tilt in degrees. `k` = how much it sways with scroll speed (−1…1). `ratio='auto'` keeps the photo's natural size. `speed` (0.85–1.15) sets parallax depth. `deal` makes it drop in on scroll. If the photo is missing or broken, it shows a paper frame with a faint photo mark. `children` render under the print (for example a `Note`). |
| `Portrait({ src, name, alt?, r, k, tape, caption?, deal? })` | A 4:5 print of a person. With no photo, or the grey placeholder, it shows the person's initials in Shrikhand on kraft. Pass `alt=""` when the name is printed beside it (caption, heading): the photo/initials are then hidden from screen readers so the name is read once. |
| `Note({ as })` | A plain paper note (grain, no shadow). Use it for the text block under a print. |
| `Memo({ title, titleAs, items, tape })` | A kraft memo whose items are ticked off in pen. Good for "At a glance" facts. |
| `Tag({ children, string=true })` | A kraft luggage tag hanging on a drawn string. It swings in. |
| `Chip({ tone })` | A small uppercase pill: ink, cran, azure, royal, violet, gold, turq or kraft. |
| `FilterGroup({ label, options:[{value,label,count?}], value, onChange })` | Toggle buttons with `aria-pressed`. The pressed one turns ink and tilts. |
| `SearchField({ label, value, onChange, placeholder })` | A taped paper search strip with a clear button, wrapped in `role="search"`. |
| `ResultCount({ shown, total?, noun, plural? })` | A handwritten count, announced with `aria-live="polite"`. |
| `StatRow({ items:[{value,label,money?,tone?,shape?}], currency })` | Stickers (burst, circle, flower, scallop, and a wide pill for money). Zero values are dropped. The number always fits inside its sticker. |
| `EmptyState({ title, message, action?, as='h2' })` | A taped kraft note with an empty print outline. **Every empty list uses this one.** |
| `NotFound({ title, message, backHref, backLabel })` | A torn note with a big "?" and a way back. Keep `PageHero` above it for the `<h1>`. |
| `Loading({ label, count })` | Blank prints waiting to develop. Uses `role="status"`. |
| `Cutouts()` | The four paper shapes, as decoration. `PageHero` already includes them. |
| `useLightbox()` | State + behaviour for the shared `PhotoLightbox`: `const lb = useLightbox()`, `<PhotoLightbox index={lb.index} onIndex={lb.setIndex} …/>`, `onClick={(e) => lb.open(i, e)}`. The page behind is inert, smooth scroll is held, focus goes to Close and returns to the opener, each photo develops. theme.css restyles the viewer (white print, Kalam caption). |
| `Tape({ tone, left, tilt })`, `TAPE_CYCLE` | Washi tape: turq, cran, gold or azure. Cycle through `TAPE_CYCLE[i % 4]`. |
| `Draw`, `Underline`, `HeadArrow`, `Circled`, `P` | Hand-drawn strokes (`pathLength=1`). Pass `scroll` so `decor()` draws them as they scroll in. `<Circled>Thursday</Circled>` circles a word in pen. |
| `photoType(img, tint)` | Returns `{ className, style }` for photo-filled type on any element: `<p className={'x ' + pt.className} style={pt.style}>`. |
| `usePageName(fallback)`, `menuLabel(name)` | The page's name. Club menus come IN CAPS; this converts them to title case. |
| `htmlText`, `htmlParagraphs`, `cleanText`, `excerpt(s, max)`, `yearDash(label)` | Safe text from the API: DOMParser, no emoji, cut at a word boundary. `"2026-2027"` becomes `"2026–27"`. |
| `SocialIcon({ platform })`, `useImgChain(srcs)`, `useFitLine(ref)` | Used by the shell and the home page. You rarely need them. |

**Wrappers: the rule that stops jumps.** Each print has three layers: `.col-print-move` (parallax y) > `.col-print-fl` (deal and swing) > `.col-print`.
- `.col-print` has a CSS tilt, a sway driven by scroll speed, and a hover state. **Never tween `.col-print`.**
- For your own cards, follow the same pattern: tween an outer wrapper, and put the tilt on an inner element.

---

## 4. Motion (`../motion.js`)

Everything below runs inside `useScene(ref, (c) => { … }, [data])`, so under reduced motion none of it runs. `c.wide` means ≥900px. `c.fine` means a mouse.

| helper | motion |
|---|---|
| `house(root, c)` | **Start here.** It runs `decor`, then `[data-col-deal]` deals, then `.col-print-move[data-col-speed]` parallax, `.col-print-photo img` develop, `.col-print-cap` write-in, `.col-tag` swing, `.col-memo-move` settle, and the stickers. It returns a cleanup. Use it as: `useScene(ref, (c) => house(ref.current, c), [data])` |
| `decor(root, { pinStage? })` | Section titles wipe in, pen strokes draw, `<mark class="col-hl">` fills with highlighter. |
| `titleIn(els)`, `drawIn(svgs)`, `drawNow(els, {delay})`, `highlightIn(marks)` | The parts of `decor`, on their own. |
| `revealBatch(els, { start, y, stagger })` | Grid items are dealt onto the page, one batch at a time as they enter. **Target a wrapper.** |
| `dealIn(els, { delay })` | A timed deal, for things already on screen. |
| `parallax(els, { wide })` | Each element drifts at its own `data-col-speed` (read from the element or its nearest ancestor). |
| `swayScrub(els)` | Prints swing a few degrees as they pass. Target `.col-print-fl`. |
| `develop(imgs)` | Photos develop from pale sepia to full colour as they scroll. |
| `captionIn(els)` | Handwriting writes itself in. |
| `swing(tags)`, `settleIn(wrappers)`, `slideIn(els)` | The tag swings, the memo drops and straightens, cards slide in from alternating sides. Every scrubbed entrance ends at `clamp(…)`, so it finishes even at the foot of a short page. |
| `stickersIn(els, { wide })` | Stickers pop and spin in, then count up. It writes through React's own text node and returns a cleanup. |
| `developIn(el, done)` | A one-off "develop" for things that change on an event, like a slide or a lightbox photo. It checks reduced motion itself. |
| `CLEAR`, `DEV0`/`DEV1` | Pass `CLEAR` to `clearProps` when you write your own entrance. `DEV0`/`DEV1` are the develop filter values. Always tween `filter` with `fromTo`. |
| re-exports | `gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages, scrollToY, lockScroll, prefersReducedMotion` |

Rules:
- **No hidden start states in CSS.**
- Call `refreshSoon()` or `useRefreshOnImages(ref, [data])` after content arrives whose height isn't fixed (natural-ratio photos).
- Pinning is allowed only when `c.wide`, and only for a stage that fits the viewport. See `Home.jsx`'s leaders deck for how to scroll a pinned item into view when it receives focus.
- The shell sorts ScrollTriggers by their position on the page, so creation order doesn't matter.
- Filters on grids **re-deal**. When a filter changes, pass the filter value in the scene's deps so the batch is rebuilt.

---

## 5. Each page group

The same pieces, composed differently on each page. Each page gets one moment people will remember, and the rest stays calm.

### About (`/about`, `useAboutData`)
- **Layout:** `PageHero` (tint royal). If the club has a crest (`d.logo`), show it as one print in `prints`. The club's own text (`d.html`, already made wrappable) goes in a wide column styled as a letter on ruled notebook paper, using the newsletter-card rules from `home.css`: a margin line and blue rules. Beside it on desktop, and below it on phones, put a kraft `Memo` titled "At a glance" with the meeting day, time and venue. Then two `Portrait`s for the President and Secretary (`d.president` / `d.secretary`), linking to `/dignitary?Type=4` and `?Type=5` with `withYear`. Socials go last.
- **Memorable moment:** the meeting `Tag` hangs off the memo and swings in, with the day `<Circled>`.
- **Must-haves:**
  - Render the admin HTML with `dangerouslySetInnerHTML` inside `.col-about-prose` with `overflow-wrap:anywhere`, and style the admin's `<p>`, `<ul>`, `<strong>` and headings. Strip their inline font sizes: `.col-about-prose *{font-size:inherit!important}` is acceptable.
  - Email and phone only as AboutGold shows them (its "At a glance" rail lists both).
  - When there's no `html`, use `EmptyState`.
- **Phones:** one column, the memo under the letter, portraits side by side at 2 columns.

### Directory (`/directory`, `useDirectoryData`, which returns `null` while loading)
- **Layout:** a contact sheet. `PageHero` holds a `SearchField` (name or profession) and a `ResultCount noun="member"`. Below that, a grid of small `Portrait`s (`auto-fill, minmax(150px,1fr)`) with alternating tilts of −3/2/−1/3°. Each has the name as a Kalam caption and `work` below it in small ink-2 text.
- **Memorable moment:** members are dealt onto the sheet in batches (`deal` on each `Portrait`, then `house`). Search results re-deal.
- **Must-haves:**
  - It must handle hundreds of members: only batch reveals, no per-card scrubs, lazy images.
  - Long names wrap (`overflow-wrap:anywhere`).
  - Show initials when there's no photo.
  - `Loading` while the data is null. `EmptyState` when there are none, and a different `EmptyState` when the search matches nothing.
- **Phones:** 2 columns, tilts reduced to ±1.5°.

### Directors (`/directors`, `useDirectorsData`, board order already sorted)
- **Layout:** The first two directors (usually President and Secretary) get large prints side by side, each with a kraft role label hanging below on a short string (`Tag`). The rest of the board is a grid of mid-size `Portrait`s. Each role is in Kalam cran-ink and each name in Shrikhand at 1.5rem.
- **Memorable moment:** the role tags swing as the board scrolls in.
- **Must-haves:**
  - Show `bio` (member introduction) as an excerpt, with a `<details>` "Read more" for the full text.
  - Link the President and Secretary to `/dignitary?Type=4` and `?Type=5`.
  - `EmptyState` when there are no directors.
- **Phones:** one column, alternating left and right like the home leaders.

### Calendar (`/calendar`, `useCalendarData(year, month)`, plus `monthName`)
- **Layout:** A planner page. The `PageHero` title is the page name, and the kicker is the month and year. The month bar has previous/next `Button variant="ghost"` controls (aria-labelled "Previous month" / "Next month") and a big Shrikhand month name (photo type, tint violet) announced with `aria-live`. Below it, three paper notes (Birthdays with gold tape, Anniversaries with cran, Events with azure). Each row is a kraft date stamp (the day number in Shrikhand) plus the name.
- **Memorable moment:** changing the month flips the page. The lists wipe out and back in with a clip-path wipe, and the month name wipes in fresh.
- **Must-haves:**
  - Events link to `/event?id=`.
  - An empty list says so inside its own note (not a missing box).
  - Mark today's date when it's in the month shown.
- **Phones:** the three notes stack, and the month bar stays one row.

### Projects (`/projects`, `useProjectsData(isMeetings)`, `?pr=`) and ProjectDetail (`/project?pid=`)
**Projects**
- **Layout:** The home wall, extended. In `PageHero`:
  - an avenue `FilterGroup` (`avenueTabs`; `?pr=CP|VS|NGS|IS|PII` preselects a tab);
  - the area and type filters as native `<select>`s styled like the search strip;
  - a `SearchField` and a `ResultCount noun="project"`.

  Then a `StatRow` of cost, beneficiaries, rotarians and man hours. Use `metricsOf`, and while `metricsPhase === 'loading'`, show a Kalam "counting…" note instead of zeros. Then the cards: a `Print` (photo; title as the caption with `captionAs="h3"`) over a `Note` holding the date, the avenue `Chip`, the excerpt, "8 updates" when `updates > 0`, and `TextLink sr={title}` to `withYear('/project?pid='+id, yearId)`.
- **Memorable moment:** changing a filter re-deals the prints.
- **Must-haves:**
  - `?pr=CE` is the club-service feed; its title comes from the menu (`usePageName`).
  - For hundreds of projects, show 24 at a time with a "Show more" `Button` (focus the first new card).
  - Use `formatMoney(v, currency)` and never write ₹ yourself.
- **Phones:** one column, cards at 94% width alternating left and right like the home wall.

**ProjectDetail**
- **Layout:** A scrapbook spread. `PageHero` (crumbs Projects → title; title photo-filled with the project's own photo) with the main photo as a big taped `Print`. Then:
  1. the facts as a `StatRow`;
  2. the description on ruled notebook paper;
  3. the photo set as a contact sheet of small `Print`s that open `PhotoLightbox`;
  4. child updates as a dated timeline of stapled notes;
  5. the share row (`useProjectShare`) as sticker buttons.
- **Memorable moment:** the contact-sheet photos develop as they scroll in, and the lightbox photo develops too (`developIn`).
- **Must-haves:**
  - `notFound` shows `PageHero` ("Project not found") plus `NotFound backHref="/projects"`.
  - `?pr=CE` means "back" goes to `/projects?pr=CE`.
  - The lightbox closes with Esc and returns focus.
- **Phones:** single column, the lightbox full screen.

### Events (`/events`, `useEventsData`, which returns `null` while loading) and EventDetail (`/event?id=`)
**Events**
- **Layout:** Tickets on a string, grouped by `monthLabel` under handwritten month headings. Each event is a kraft ticket with notched edges (see `.col-home-ticket`): the day in Shrikhand, the month and weekday, the title in Kalam, and the venue. The event's photo appears as a small print clipped to the ticket when `img` exists. The first upcoming event is a larger ticket.
- **Memorable moment:** tickets swing in on their string as each month arrives.
- **Must-haves:**
  - Registration links (`reg`) are external `Button`s.
  - Titles link to `/event?id=`.
  - `EmptyState` naming the Rotary year when there are no events.
- **Phones:** full-width tickets in one column.

**EventDetail**
- **Layout:** `PageHero` (crumbs Events → title) with the photo print, then a ticket stub (date, weekday, time from `when`, venue), a register `Button`, and the description (`descHtml`) as prose.
- **Must-haves:** `ev === false` shows `NotFound backHref="/events"`.

### PastPresidents (`/past-presidents`, `usePastPresidentsData`, newest first)
- **Layout:** A yearbook. Presidents are grouped by decade, and each decade opens with a Shrikhand label ("2010s") filled with a photo. Inside each decade is a grid of small `Portrait`s, captioned with the year (Kalam) and the name.
- **Memorable moment:** the decade label stays stuck at the top while that decade's portraits are dealt beside it (use `position:sticky`, not a pin).
- **Must-haves:**
  - Most of these rows have **no photo** (an API gap), so the initials monograms must look deliberate.
  - It can be 60+ rows, so use batch reveals only.
  - Use `EmptyState` when the list is empty.
- **Phones:** 2 columns, and the decade label is not sticky.

### Newsletters (`/newsletters`, `useNewslettersData`)
- **Layout:** A clipboard. Every issue is the home page's ruled notebook card with a paper clip (copy the `.col-home-nl-*` look into `.col-news-*`), grouped by `monthLabel` or year. The title is in Kalam, followed by the date and a "Read newsletter" pill. The link is external and needs sr text "(opens in a new tab)".
- **Memorable moment:** cards slide in from alternating sides and straighten (`slideIn`).
- **Must-haves:**
  - For large archives, a year `FilterGroup` and a `ResultCount`.
  - `EmptyState` when there are none.
- **Phones:** one column, the clip still on top.

### Gallery (`/gallery?page=n`, `useGalleryData(page)`, `GALLERY_PAGE_SIZE`)
- **Layout:** Contact sheets. A masonry of taped prints (CSS columns, `ratio="auto"`) with project titles as Kalam captions. Clicking a print opens `PhotoLightbox`. Pagination is a row of pill links (`?page=` plus `withYear`) with `aria-current` on the current page.
- **Memorable moment:** photos develop from sepia to colour as they're dealt.
- **Must-haves:**
  - Natural image heights change the layout, so call `useRefreshOnImages(ref, [page, photos.length])`.
  - Alt text comes from the title.
  - The lightbox handles Esc and returns focus.
  - `EmptyState` on an empty page.
- **Phones:** 2 columns.

### Dignitary (`/dignitary?Type=1|2|4|5`, `useDignitaryData(type)`)
- **Layout:** A feature profile. `PageHero` holds the name (photo-filled with the portrait) and the designation as a kicker. Then a large tilted `Portrait` held by a paper clip, beside the bio (`bioHtml`) set as a letter on ruled paper. A small sticker shows the Rotary year. At the end, "Also this year" links to the other dignitaries as small prints.
- **Memorable moment:** the portrait swings in on its clip, and the name wipes in.
- **Must-haves:**
  - `?Type=` is read from the URL (default 1).
  - Not found: `PageHero` plus `NotFound`.
  - The placeholder photo shows initials.
  - Some bios are long runs of unbreakable text (rcmaduraicentral), so use `overflow-wrap:anywhere`.
- **Phones:** the portrait sits above the text at 70% width.

---

## 6. Do and don't

**Do**
- Tilt things a little: −4° to +4° for cards, up to ±8° for decoration. Nothing sits at 0° except text.
- Use tape on every print and `TAPE_CYCLE[i % 4]` so the colours vary.
- Keep text on the plain paper or white surfaces, and keep it straight and readable.
- Hide a section entirely when it has no data. Use `EmptyState` only for a page's main list.
- Test your page with Thane Hills (default), `?host=rctcv.rotaryindia.org` (many banners, events) and `?host=rcmaduraicentral.rotaryindia.org` (long text).

**Don't**
- Don't use cranberry `--col-cran` for small text (use `--col-cran-ink`), and don't put white text on gold or turquoise.
- Don't bold Shrikhand, and don't set body copy in Kalam (handwriting is for captions and short lines).
- Don't tween an element that owns a CSS tilt or hover. Tween its wrapper.
- Don't set hidden start states in CSS. Don't use `.reveal`, `[data-count]`, `[data-split]` or other rotary-anim hooks.
- Don't hard-code a club, ₹, a year, or copy that states facts the data doesn't hold.
- Don't use hover-only affordances. Everything must also work by keyboard and touch (tap targets 44px).

---

## 7. Class naming

- Page classes: `col-<page>-<part>`. Use these page prefixes:

  | page | prefix |
  |---|---|
  | About | `col-about-` |
  | Directory | `col-dir-` |
  | Directors | `col-bod-` |
  | Calendar | `col-cal-` |
  | Projects | `col-pj-` |
  | ProjectDetail | `col-pjd-` |
  | Events | `col-ev-` |
  | EventDetail | `col-evd-` |
  | PastPresidents | `col-pp-` |
  | Newsletters | `col-news-` |
  | Gallery | `col-gal-` |
  | Dignitary | `col-dig-` |

  Example: `.col-dir-grid`, `.col-dir-card`, `.col-dir-work`.
- Kit classes (`col-print`, `col-btn`, `col-head`…) belong to `theme.css`. You may extend them **only inside your page scope**, for example `.col-dir .col-portrait-cap{…}`.
- Custom properties you invent are named `--col-<page>-*`. Keyframe names are prefixed too, for example `@keyframes col-cal-flip`.
- Any element selector in your CSS goes under your page root class (`.col-about-prose p{…}`), never bare.
