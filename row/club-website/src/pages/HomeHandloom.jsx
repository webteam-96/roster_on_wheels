// ─────────────────────────────────────────────────────────────────────────────
// HANDLOOM — theme 7 home.
//
// Same data layer as every other theme (useHomeData → HomePageBase), bound to
// handloom markup. No CSS import: the stylesheet arrives through the theme
// manifest, and every token lives on html[data-theme="handloom"].
//
// BAND ORDER (fixed): identity → the one thing a visitor came for (meeting,
// above the fold and before any counter) → proof at scale (counters) → proof in
// detail (projects) → the people → what is next → the supporters → the ask.
// Grounds alternate cloth → cloth-2 → INKED → cloth-3 → cloth → cloth-2 →
// cloth → cloth-2, with exactly ONE inked band and ONE warp-field band.
//
// THREE THINGS THAT LOOK LIKE STYLE AND ARE NOT:
//   1. THE ANCHOR IS THE SLIDE, for banners and for ads. opacity:0 does not stop
//      pointer events, so a wrapper anchor round a stacked slide swallows the
//      click on the visible one — a bug this platform has shipped and fixed
//      once. rotary-anim.js sets pointerEvents:'none' on every non-showing
//      [data-hero-slide], which only works when the slide IS the link.
//   2. [data-hero] sits on the .hl-x, not on the stage. initHero delegates its
//      click listener to the [data-hero] ROOT and reads [data-hero-dot] from
//      inside it — and the contract's DOM puts the pins and the arrows OUTSIDE
//      the mat (they move below it under 768px so both clear 44px). The stage
//      keeps [data-hero-banner], which is what verify-regressions.mjs measures.
//   3. The counters carry NO [data-count]. animateCount would rewrite each
//      figure to parseFloat(value)||0, which destroys the printed money string;
//      the two-layer .hl-fig fills instead, driven by CSS scroll-timeline, and
//      its un-animated state is the FINISHED state.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import { useHomeData, adAnchorProps } from '../shared/homeData.js'
import { useRotaryAnim } from '../shared/useRotaryAnim.js'
import { formatYear } from '../shared/menus.js'
import { formatMoney, groupInt } from '../shared/money.js'
import { withYear, usePageTitle, wheelFallback, initials } from '../shared/rotaryPage.js'
import AccordionGallery from '../shared/AccordionGallery.jsx'
import MorphSlider from '../shared/MorphSlider.jsx'

/** The bundled artwork homeData pushes when a club has published no ads. */
const AD_PLACEHOLDER = 'img/ClubAdvirtisment.png'

/** IS THERE A WEBGL CONTEXT? Probed once and cached.
 *  MorphSlider is a canvas with no fallback of its own — no <img>, no poster —
 *  so on a machine without WebGL (blocklisted driver, hardware acceleration
 *  off, an old handset) the banner and the advertisement would be empty boxes.
 *  That is what "showing blank" was. Anything without a context keeps the
 *  ordinary DOM slider below, which still carries the CSS warp transitions, so
 *  a club that cannot run the shader gets an approximation rather than nothing.
 *  The probe canvas is discarded at once; holding it would keep a context open. */
let WEBGL_OK = null
function hasWebGL() {
  if (WEBGL_OK !== null) return WEBGL_OK
  try {
    const c = document.createElement('canvas')
    WEBGL_OK = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch (e) {
    WEBGL_OK = false
  }
  return WEBGL_OK
}

/** CLICK-THROUGH FOR A CANVAS SLIDER.
 *  Every slide is painted into ONE canvas, so the per-slide <a> is gone. Both
 *  users of it must still open their link — a sponsor's advertisement that does
 *  not open the sponsor is a bug this project already fixed once — so the canvas
 *  is wrapped in a single anchor that follows whichever slide is showing.
 *  THE DRAG GUARD IS THE POINT: MorphSlider's stage is a drag surface, and
 *  without this every swipe would also count as a click and navigate away. */
function MorphLink({ href, children }) {
  const downAt = useRef(null)
  if (!href || href === '#') return children
  return (
    <a className="hl-morph-link" href={href} target="_blank" rel="noopener noreferrer"
       onPointerDown={(e) => { downAt.current = [e.clientX, e.clientY] }}
       onClick={(e) => {
         // A CONTROL IS NOT THE PICTURE. MorphSlider's arrows and dots sit
         // INSIDE this anchor - they have to, because every slide is painted
         // into one canvas and the anchor is the only clickable thing left - so
         // without this a click on "next" also opened the sponsor's link in a
         // new tab. Reported 2026-09-09. Only the picture opens the link now.
         // closest() and not a className test: the click usually lands on the
         // <svg> or its <line> inside the button, never on the button itself.
         if (e.target.closest && e.target.closest('.morph-slider-btn, .morph-slider-dot')) {
           e.preventDefault()
           return
         }
         const d = downAt.current
         if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) e.preventDefault()
       }}>
      {children}
    </a>
  )
}

/** THE WARP FILTER BANK — what makes melt / ripple / swirl bend the PICTURE
 *  rather than just move its box.
 *
 *  feTurbulence builds a noise field and feDisplacementMap pushes every pixel
 *  along it, which is the same idea as the GPU version's displacement shader.
 *  The flavours differ only in the noise:
 *    melt   — fractalNoise, low frequency, soft and liquid
 *    ripple — turbulence, stretched on x, so it reads as waves
 *    swirl  — very low frequency, large scale, so the whole field twists
 *
 *  WHY FOUR STEPS PER FLAVOUR INSTEAD OF ONE ANIMATED FILTER. CSS cannot
 *  interpolate between two filter() values, and SMIL inside the filter cannot
 *  be restarted from a class change. So each flavour is four fixed filters and
 *  the keyframes STEP down through them; the opacity and transform running
 *  underneath are continuous, which is what hides the stepping.
 *
 *  numOctaves is deliberately 2. feTurbulence is CPU work on every painted
 *  frame, this runs on a full-width banner, and 3+ octaves measurably drops
 *  frames on a mid-range machine for detail nobody sees at this scale. */
function WarpDefs() {
  const flavours = [
    ['melt', 'fractalNoise', '0.012', 2],
    ['ripple', 'turbulence', '0.028 0.006', 2],
    ['swirl', 'turbulence', '0.006', 2],
  ]
  const steps = [70, 44, 24, 10]
  return (
    <svg className="hl-warp-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        {flavours.map(([name, type, freq, oct]) =>
          steps.map((scale, i) => (
            <filter key={name + i} id={'hlw-' + name + '-' + i}
                    x="-15%" y="-15%" width="130%" height="130%"
                    colorInterpolationFilters="sRGB">
              <feTurbulence type={type} baseFrequency={freq} numOctaves={oct}
                            seed={7 + i} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale={scale}
                                 xChannelSelector="R" yChannelSelector="G" />
            </filter>
          ))
        )}
      </defs>
    </svg>
  )
}

/** HOW A SLIDE BECOMES THE NEXT SLIDE — 'melt' | 'ripple' | 'shear' | 'swirl'.
 *  Change the word, that is the whole switch; handloom.css carries one rule set
 *  per name, keyed off the data-hl-morph attribute these write onto the stage.
 *
 *  All four are pure CSS on the slides the shared initHero already cross-fades.
 *  That is deliberate: the WebGL version of these effects was tried on
 *  2026-09-09 and taken back out because a canvas cost the banner its aspect
 *  latch, its uncropped fit and its click-through, showed nothing at all on a
 *  machine without WebGL, and pulled in a second graphics dependency. The
 *  transition is the part that was wanted; none of that was. */
const MORPHS = ['melt', 'ripple', 'shear', 'swirl']

/** WHY THIS IS A CYCLE AND NOT A CHOICE. It used to be two constants, one
 *  flavour pinned per slider, and that is what "only one transition shows"
 *  was: the banner only ever swirled, and the advertisement -- which for most
 *  clubs is a SINGLE poster, so its slider never transitions at all -- showed
 *  nothing. Between the two, exactly one of the four was ever visible. Each
 *  slide change now advances to the next flavour, so a three-banner club walks
 *  melt, ripple, shear, swirl and back round.
 *
 *  The no-WebGL fallback below keeps ONE flavour per slider. It is driven by
 *  initHero, which owns its own timer and tells React nothing, so there is no
 *  moment that is safe to swap the attribute in -- changing it mid-fade swaps
 *  the transition property under a running transition and the picture jumps.
 *  Not worth a MutationObserver for a path that only runs on a machine with no
 *  WebGL at all. */
function useMorphCycle() {
  // ONE state object, not two: announce() can fire twice for the same slide
  // (once when the tween starts, once when it commits), and separate useStates
  // would let the second one advance the flavour without the slide moving.
  // Returning the same object when the index is unchanged also lets React bail
  // out of the re-render entirely.
  const [s, set] = useState({ idx: 0, step: 0 })
  const onIndexChange = (i) => set((p) => (i === p.idx ? p : { idx: i, step: p.step + 1 }))
  return [s.idx, MORPHS[s.step % MORPHS.length], onIndexChange]
}

/** The advertisement box takes the aspect of the picture that just loaded, so a
 *  portrait poster is not letterboxed into a 4:1 strip. Clamped 0.5-6 so one
 *  freak upload cannot produce an absurd box. */
function latchAdAspect(e) {
  const img = e.currentTarget
  const stage = img.closest('.hl-ad__stage')
  if (!stage || !img.naturalWidth || !img.naturalHeight) return
  const r = Math.min(6, Math.max(0.5, img.naturalWidth / img.naturalHeight))
  stage.style.setProperty('--hl-ad-ar', String(r))
}


/**
 * Walk a banner/ad image's data-fallbacks chain. The API's
 * /Documents/…/{BANNERS,ADVERTISEMENT} shape resolves for only one of the two
 * upload generations, so mediaCandidates() hands every image an ordered list and
 * this steps through it. The last branch stops changing src rather than clearing
 * onerror — clearing it does nothing to React's delegated handler.
 */
function walkFallbacks(e) {
  const el = e.currentTarget
  const rest = (el.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) {
    el.setAttribute('data-fallbacks', rest.slice(1).join('|'))
    el.src = rest[0]
  } else {
    el.style.visibility = 'hidden'
  }
}

/** homeData hands "Not available" leaders the legacy grey headshot — that IS a
 *  missing photo, so the pennant shows its monogram state up front. */
const isPlaceholderPhoto = (src) => !src || /profile_pic\.png$/i.test(src)

/** THE OFFICER CARD - the hero's club president and secretary, stacked.
 *  NOT the pennant: a swallowtail is a portrait shape, and stacked in a 340px
 *  column two of them ran far taller than the banner beside them. This reads
 *  across instead - portrait left, office over name right - on .hl-card, so the
 *  hem, the 3px lift and the press state all come from the theme rather than
 *  from a second set of hover rules. The office sits ABOVE the name in the
 *  band-head order (label, then title), which is how every other head on this
 *  page is built. */
function Officer({ l, monogram, broken, onBroken, yearId, i = 0 }) {
  const mono = isPlaceholderPhoto(l.img) || broken
  const bio = String(l.bio || '').replace(/\s+/g, ' ').trim()
  // AN <article>, NOT AN <a>. The card now carries its own "Read more" link and
  // an anchor inside an anchor is invalid HTML — the browser closes the outer
  // one early and the card falls apart. .hl-card's hem still lifts, because it
  // keys on :focus-within as well as :hover.
  return (
    <article className="hl-off__card hl-card reveal" style={{ '--i': i + 1 }}>
      <span className="hl-off__ava">
        {mono ? (
          <span className="hl-off__mono" aria-hidden="true">{monogram}</span>
        ) : (
          <>
            {/* THE WHOLE FACE, NEVER A CROP. Same device as the banner: a
                blurred cover copy fills the plate, the real portrait sits
                contained on top of it. cover alone cut every officer, because
                the plate is a landscape box (338x160 measured) and the sources
                are portraits (159x196). */}
            <img className="hl-off__blur blur-xl scale-110" src={l.img} alt=""
                 aria-hidden="true" />
            <img className="hl-off__img" src={l.img} alt="" loading="lazy"
                 onError={onBroken} />
          </>
        )}
      </span>
      <span className="hl-off__txt">
        <span className="hl-off__role">{l.role}</span>
        <span className="hl-off__name">{l.name}</span>
        {/* memberIntroduction, clamped to three lines in handloom.css. Rendered
            as TEXT, never dangerouslySetInnerHTML: this is admin-authored free
            text straight off the API. */}
        {bio ? <span className="hl-off__bio">{bio}</span> : null}
        <a className="hl-off__more" href={withYear('/dignitary?Type=' + l.type, yearId)}>
          Read more <Arrow />
        </a>
      </span>
    </article>
  )
}

/* THE PENNANT IS GONE (2026-09-07). The swallowtail hanging card was the
 * dignitary board's own object; the board now renders the SAME <Officer> card
 * as the hero, so every person on this page is one component and one design.
 * Its rules are still in handloom.css (.hl-pennant*, .hl-cord) and now match
 * nothing — left there rather than unpicked across four media queries. */

/** "2025-2026" → 2025, for ordering the year list. */
const startOf = (label) => parseInt(String(label || '').slice(0, 4), 10) || 0

const Arrow = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
)

const IcoPin = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
  </svg>
)

const IcoClock = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
  </svg>
)

const IcoCal = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" />
  </svg>
)

/* NOTHING ON THIS PAGE IS WRITTEN HERE (2026-09-09, standing instruction).
 * A design comp will show sample copy - a poster tagline, a pull-quote, a
 * standfirst under a title, an eyebrow over it - and none of it is the club's.
 * Take the LAYOUT from a comp and leave its words behind: every string that
 * reaches a reader comes from the API, or it is a label for a control. Three
 * rounds of copy have been added from comps and removed again; this is the
 * note that is meant to stop the fourth. */

const IcoChev = ({ back }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points={back ? '12 5 5 12 12 19' : '12 5 19 12 12 19'} />
  </svg>
)

/** THE DIGNITARY CARD (2026-09-09, built to the supplied design).
 *  A SECOND card, not a reshaped <Officer>: the hero's officers carry a
 *  biography and read across a 340px column, and these carry an office, a rule
 *  and a filled READ MORE pill inside a horizontal rail. One component doing
 *  both would need a mode flag at every line that differs, which is most of
 *  them.
 *  The plate keeps the hero's contain-over-blurred-cover treatment, because the
 *  sources are the same portraits and the reason has not changed: every `cover`
 *  origin tried cut a real head-and-shoulders photo. */
function Leader({ l, monogram, broken, onBroken, yearId, i = 0 }) {
  const mono = isPlaceholderPhoto(l.img) || broken
  const bio = String(l.bio || '').trim()
  return (
    <article className="hl-lead__card reveal" style={{ '--i': i + 1 }}>
      <span className="hl-lead__ava">
        {mono ? (
          <span className="hl-lead__mono" aria-hidden="true">{monogram}</span>
        ) : (
          <>
            <img className="hl-lead__blur blur-xl scale-110" src={l.img} alt=""
                 aria-hidden="true" />
            <img className="hl-lead__img" src={l.img} alt="" loading="lazy"
                 onError={onBroken} />
          </>
        )}
      </span>
      <span className="hl-lead__txt">
        <span className="hl-lead__role">{l.role}</span>
        <i className="hl-lead__hr" aria-hidden="true" />
        <span className="hl-lead__name">{l.name}</span>
        {/* The bio is in the markup for every layout and SHOWN by the CSS only
            in the no-events one (.hl-duo__grid--solo), where the card is half
            the band; beside an Upcoming column it is a 340px card with no room
            for it (2026-09-16, asked for). */}
        {bio ? <span className="hl-lead__bio">{bio}</span> : null}
        <a className="hl-lead__more" href={withYear('/dignitary?Type=' + l.type, yearId)}>
          Read more <Arrow />
        </a>
      </span>
    </article>
  )
}

/** THE LEADERSHIP RAIL, and why it scrolls instead of wrapping.
 *  The design puts two cards side by side in HALF the band. Measured at that
 *  width the card is ~312px, of which the plate takes 132, leaving ~160px of
 *  measure for a 26px display name - which is the exact failure the old grid
 *  was widened to escape ("Olayinka Hakeem Babalola" over three lines). So the
 *  cards keep a real width and the row scrolls; the arrows in the head page it.
 *  THE ARROWS ARE HIDDEN WHEN THERE IS NOTHING TO SCROLL. With Upcoming absent
 *  the column is 960px and both cards fit, and a control that cannot do
 *  anything is worse than no control at all.
 *  A ResizeObserver, not a resize listener: this box changes width when the
 *  Upcoming column appears or the data lands, neither of which is a window
 *  resize. */
function useRailNav(count) {
  const ref = useRef(null)
  const [can, setCan] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const read = () => setCan(el.scrollWidth - el.clientWidth > 4)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    return () => ro.disconnect()
  }, [count])
  const page = (dir) => {
    const el = ref.current
    if (!el) return
    const card = el.firstElementChild
    const step = card ? card.getBoundingClientRect().width + 24 : el.clientWidth
    const smooth = !(typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches)
    el.scrollBy({ left: dir * step, behavior: smooth ? 'smooth' : 'auto' })
  }
  return [ref, can, page]
}

/** One counter cell. The caption is a SIBLING of .hl-fig, not a child: the CSS
 *  stagger keys off .hl-tb__stat:nth-child(1..5), and .hl-fig holds exactly its
 *  two layers. The base layer is the real text node (and the accessible one);
 *  the fill layer repeats it, clipped, and is aria-hidden. */
function Stat({ text, caption, money }) {
  return (
    <div className="hl-tb__stat">
      <span className={'hl-fig hl-num' + (money ? ' hl-tb__money' : '')} data-hl-fig>
        <span className="hl-fig__base">{text}</span>
        <span className="hl-fig__fill" aria-hidden="true">{text}</span>
      </span>
      <p className="hl-cap">{caption}</p>
    </div>
  )
}

/** The universal empty state. `slots` is one void slot per row the real list
 *  would have shown — the positions the content would occupy, not a blank
 *  rectangle with a sentence in it. */
/* `nested` DROPS THE REVEAL, and it exists because of one real case: the
 * newsletter empty state renders INSIDE .hl-trio__col.hl-nlc, which is itself
 * tagged now. A reveal inside a reveal starts from the outer one's mid-flight
 * state and plays a second entrance over an object that is already arriving -
 * and the club data used for testing has newsletters, so nothing would have
 * caught it here.
 * SAFE TO DROP: 6.3 in handloom.css declares .hl-unwoven__slot at its FINISHED
 * opacity and only ADDS the stagger under .is-visible, so an unobserved empty
 * state still looks designed. Verified in that rule's own comment. */
function Unwoven({ slots = 3, slot, children, nested = false }) {
  return (
    <div className={'hl-unwoven' + (nested ? '' : ' reveal')}>
      {Array.from({ length: slots }, (_, i) => (
        <div key={i} className="hl-unwoven__slot" data-hl-void
             style={{ '--i': i, ...(slot ? { '--hl-slot': slot } : null) }} />
      ))}
      {children}
    </div>
  )
}

const weft = (
  <div className="hl-weft" data-hl-weft aria-hidden="true">
    <i className="hl-weft__pick" style={{ '--i': 0 }} />
    <i className="hl-weft__thread" style={{ '--i': 1 }} />
  </div>
)

export default function HomeHandloom() {
  const club = useClub()
  // newsletterTake: 4 (2026-09-09, asked for; was 6, then 3). The card shows
  // the latest four whole - it never scrolls - and sends the rest to
  // /newsletters through the button under the list. Handloom's own call, so the
  // other six themes still take what they always did.
  const d = useHomeData({ featuredTake: 6, newsletterTake: 4, bannerDir: 'images' })

  const stageRef = useRef(null)

  usePageTitle(club.clubDisplayName)
  // Drives the shared reveals and BOTH [data-hero] sliders. The deps are the
  // lists whose length changes the DOM — a slide set replaced by a year change
  // has to be re-synced or the fresh slides stay at the opacity-0 their JSX
  // ships with (initHero's guard calls __ra_heroSync for exactly this).
  useRotaryAnim([d.loading, d.banners.length, d.ads.length,
                 d.featured.length, d.events.length, d.newsletters.length, d.leaders.length])


  // ── The banner box LATCHES its aspect from the showing image ───────────────
  // A FIXED ratio is not an option: clubs mix shapes inside one slider, and the
  // box has to match whatever is on screen or the picture is cropped or
  // letterboxed. Clamped 0.5-4 so one freak upload cannot produce a 3000px-tall
  // hero. Restored 2026-09-09 when the WebGL slider was taken back out: a
  // canvas has no <img> for this to measure, which is why it had to go with it.
  useEffect(() => {
    const box = stageRef.current
    if (!box) return undefined
    let last = null
    const measure = () => {
      const slides = [...box.querySelectorAll('[data-hero-slide]')]
      // Before initHero's first show() nothing is marked, so fall back to slide 0.
      const active = slides.find((s) => s.classList.contains('opacity-100')) || slides[0]
      const img = active && active.querySelector('[data-hero-img]')
      if (!img || !img.naturalWidth || !img.naturalHeight) return
      const r = Math.min(4, Math.max(0.5, img.naturalWidth / img.naturalHeight))
      if (r === last) return
      last = r
      box.style.aspectRatio = String(r)
    }
    measure()
    // The shown slide changes by CLASS, so watch the class; and a picture that
    // has not decoded yet has no naturalWidth, so watch its load too.
    const mo = new MutationObserver(measure)
    box.querySelectorAll('[data-hero-slide]').forEach((s) => {
      mo.observe(s, { attributes: true, attributeFilter: ['class'] })
    })
    const imgs = [...box.querySelectorAll('[data-hero-img]')]
    imgs.forEach((img) => img.addEventListener('load', measure))
    return () => {
      mo.disconnect()
      imgs.forEach((img) => img.removeEventListener('load', measure))
    }
  }, [d.banners])

  // ── A pennant whose photograph 404s falls through to the monogram ──────────
  // State, not a DOM poke: React owns these nodes and would revert an inline
  // display flip on the next render. Cleared when the leader set changes, or a
  // stale index would blank a new club officer's portrait.
  const [brokenPortraits, setBrokenPortraits] = useState(() => new Set())
  useEffect(() => { setBrokenPortraits(new Set()) }, [d.leaders])

  const year = formatYear(club.selectedYearLabel) || 'this year'
  const monogram = initials(club.clubDisplayName)
  // THE HERO'S RIGHT COLUMN. homeData pushes type 4 (club president) and type 5
  // (club secretary) ONLY when the board actually names one, so this is 0, 1 or
  // 2 entries - never assume two. With none the hero falls back to one column
  // rather than leaving a hole where the officers would have been.
  const officers = d.leaders.filter((l) => l.type === 4 || l.type === 5)

  // ── THE TWO CANVAS SLIDERS ───────────────────────────────────────────────
  // MEMOISED, AND NOT AS AN OPTIMISATION: `items` is in MorphSlider's mount
  // effect deps, so a fresh array identity every render would destroy and
  // rebuild the WebGL context each time and leak contexts until the browser
  // caps out. Each slide passes `src` and NOT the fallback chain — the
  // component cannot walk to the next candidate (its img.onerror is empty), so
  // it gets the one homeData puts first, the /uploads/ shape that resolves.
  // ── WHY THE TEXTURE URLS CARRY ?tex=1 ────────────────────────────────────
  // This is the fix for "banner and advertisement showing blank", and it is a
  // caching bug, not a rendering one. Reproduced 2026-09-09:
  //   1. The DOM slider's plain <img> fetches the picture with NO Origin
  //      header. The media host answers 200 but sends Vary: Origin ONLY when an
  //      Origin was sent — so that response is cached with no Vary at all.
  //   2. MorphSlider then asks for the SAME url with crossOrigin="anonymous".
  //      The browser serves the cached entry, which carries no
  //      Access-Control-Allow-Origin, so the request FAILS — measured
  //      loaded:false. MorphSlider's img.onerror is an empty function, so every
  //      slide silently stays the 4x4 grey fallback and the canvas is blank.
  // A distinct query key gives the texture its own cache entry that is only
  // ever fetched as a CORS request, so it can never collide with the non-CORS
  // one. Verified the host serves ?tex=1 with the ACAO header intact.
  // THE REAL FIX IS ON THE SERVER: always send Vary: Origin. Until then this
  // stands, and it also rescues browsers whose cache is already poisoned.
  const texUrl = (u) => (!u ? u : u + (u.indexOf('?') === -1 ? '?' : '&') + 'tex=1')

  // SAFE TO CHANGE `transition` MID-LIFE: MorphSlider reads it through a ref,
  // not a mount dependency, so the WebGL context is never rebuilt; and it
  // re-reads it in syncOptions(), which is gated on `!animating`, so a flavour
  // changed while a tween is running cannot land mid-flight. goTo() syncs
  // BEFORE it announces, so the tween that triggered the advance still finishes
  // on the old flavour and the new one starts on the next slide.
  const [bannerIdx, bannerMorph, onBannerIndex] = useMorphCycle()
  const [adIdx, adMorph, onAdIndex] = useMorphCycle()
  const bannerItems = useMemo(
    () => d.banners.map((b) => ({ image: texUrl(b.src), caption: b.title || '' })),
    [d.banners]
  )
  const adItems = useMemo(
    () => d.ads.map((a) => ({ image: texUrl(a.img), caption: a.title || '' })),
    [d.ads]
  )
  const bannerHref = (d.banners[bannerIdx] || {}).url || ''
  const adHref = (d.ads[adIdx] || {}).url || ''
  // Guarded on LENGTH as well as WebGL: useHomeData starts with banners: [], and
  // mounting the engine with an empty list builds a GL program whose uniforms
  // have no value ("uCurrentSize uniform is missing a value parameter") and
  // paints nothing until the data lands.
  const morphBanner = hasWebGL() && bannerItems.length > 0
  const morphAd = hasWebGL() && adItems.length > 0

  // THE POSTER'S OWN SHAPE, MEASURED - the fix for "the advertisement photos
  // getting cut". A canvas has no <img> for latchAdAspect to read, so the morph
  // stage carried a DECLARED 3/4 while this club's poster is 402x487 (0.825):
  // the shader covers, so it was already cropping ~9% before anything else, and
  // once the stage was stretched to the card row (0.613) it was cutting 26% -
  // 13% off each side. Measured 2026-09-09.
  // FIRST POSTER ONLY, deliberately. MorphSlider cross-fades between slides and
  // re-latching mid-transition would make the box jump under the picture. The
  // plain url, not the ?tex=1 one: this is a measurement, not a texture, so it
  // wants the cached non-CORS response rather than a second fetch.
  const [adAR, setAdAR] = useState(null)
  useEffect(() => {
    if (!morphAd || !d.ads.length) return undefined
    let dead = false
    const probe = new Image()
    probe.onload = () => {
      if (dead || !probe.naturalWidth || !probe.naturalHeight) return
      setAdAR(Math.min(6, Math.max(0.5, probe.naturalWidth / probe.naturalHeight)))
    }
    probe.src = d.ads[0].img
    return () => { dead = true }
  }, [morphAd, d.ads])

  // ...and the board below shows the COMPLEMENT, so nobody appears twice on the
  // page (asked for 2026-09-07). Written as "not an officer" rather than
  // "type 1 or 2" so a leader type added to homeData later still lands here
  // instead of vanishing from the page entirely.
  const dignitaries = d.leaders.filter((l) => l.type !== 4 && l.type !== 5)
  const [leadRail, leadCan, leadPage] = useRailNav(dignitaries.length)
  const members = (d.membershipStats[0] || {}).value || 0

  // "From our supporters" is suppressed on the bundled placeholder: with zero
  // ads homeData pushes AD_PLACEHOLDER, and a placeholder is not our supporters.
  const hasRealAds = d.ads.length > 0
    && !(d.ads.length === 1 && d.ads[0].img === AD_PLACEHOLDER)

  // Newsletters empty state: offer the nearest EARLIER year, if the club has
  // one. With none, the action still exists and still goes somewhere real.
  const curStart = startOf(club.selectedYearLabel)
  const prevYear = (club.years || [])
    .filter((y) => startOf(y.yearLabel) < curStart)
    .sort((a, b) => startOf(b.yearLabel) - startOf(a.yearLabel))[0]
  const prevYearHref = prevYear ? '/newsletters?yearId=' + prevYear.id : '/newsletters'
  const prevYearLabel = prevYear ? formatYear(prevYear.yearLabel) : 'all newsletters'

  return (
    <div className="hl-home">
      <WarpDefs />

      {/* ══ BAND 2 · THE BANNER WALL — banners[] ══════════════════════════════
          Never empty: with zero banners the hook pushes the bundled year art, so
          the rail, the pins and the fringe draw identically. A new club's hero is
          a deliberate empty wall, not a broken one. */}
      <section className="hl-band hl-band--cloth hl-hero" aria-label="Club banners">
        {/* [data-hero] is on the container so the pins and arrows below the mat
            are inside the slider root — see note 2 at the top of this file. */}
        <div className="hl-x" data-hero data-hero-interval="5000">
          {/* KEPT IN THE DOCUMENT, NOT ON THE PAGE. The club name was asked off
              the banner (2026-09-07), but a route with no <h1> is a real
              regression for a screen reader and for the h1-count check, so
              handloom.css hides this one visually instead of deleting it.
              No .reveal — an observer on a 1x1 node buys nothing. */}
          <h1 className="hl-hero__h1">{club.clubDisplayName}</h1>
          {/* ONE rail across BOTH columns: the banner sits under it and the
              officers hang from it, exactly as the Leadership board reads. */}
          <div className="hl-rail" aria-hidden="true" />

          {/* TWO COLUMNS from 1024px up (2026-09-07): the banner wall on the
              left, this year's president and secretary on the right. One column
              below that, and one column at any width when the board names
              neither officer. */}
          <div className={'hl-hero__grid' + (officers.length ? '' : ' hl-hero__grid--solo')}>
          {/* THE WALL OWNS THE CONTROLS. The dots and arrows were absolutely
              positioned against .hl-hero > .hl-x; with a second column in that
              box the "next" arrow would land past the officers instead of under
              the picture. They move in here, and .hl-hero__wall takes the
              position:relative. [data-hero] stays on .hl-x - initHero only
              needs slides, dots and arrows to be DESCENDANTS of its root. */}
          {/* NO .reveal ON THE WALL, and this is a measurement, not a taste.
              Tagging it put the page's largest above-the-fold image behind the
              reveal chain - .reveal is opacity:0 until RotaryAnim.page() adds
              .is-visible, and that runs after an async loadThemeScripts() plus
              a 120ms debounce. Measured on a 1.6Mbps/150ms profile: the wall
              entered the DOM at 4008ms and did not reach opacity 1 until
              4925ms. 917ms of blank banner to buy a 520ms fade is the wrong
              trade. The officer cards beside it keep their entrance - they are
              secondary, and they already carried .reveal before any of this. */}
          <div className="hl-hero__wall">

          {morphBanner ? (
          <div className="hl-hero__stage hl-mat hl-morph hl-morph--hero" data-hero-banner>
            <MorphLink href={bannerHref}>
              <MorphSlider
                items={bannerItems}
                onIndexChange={onBannerIndex}
                fit="contain"
                transition={bannerMorph}
                intensity={0.55}
                aberration={0.35}
                drift={0.4}
                scale={2.4}
                duration={1.1}
                ease="power2.inOut"
                autoplay
                autoplayDelay={5}
                loop
                radius={0}
                overlayColor="#12332A"
                showCaptions
                showControls={bannerItems.length > 1}
                showIndicators={bannerItems.length > 1}
              />
            </MorphLink>
            <i className="hl-hero__fringe" aria-hidden="true" />
          </div>
          ) : (
          <>
          <div ref={stageRef} className="hl-hero__stage hl-mat" data-hero-banner
               data-hl-morph="swirl">
            {d.banners.map((b, i) => {
              const art = (
                <>
                  {/* blurred cover fill behind the contained picture, so a
                      mixed-ratio slider letterboxes instead of cropping */}
                  <img className="hl-hero__blur blur-xl scale-110" src={b.src} alt=""
                       aria-hidden="true" referrerPolicy="no-referrer" />
                  <img className="hl-hero__img" src={b.src} data-hero-img
                       alt={b.title || 'Club banner'} data-fallbacks={b.fallbacks}
                       referrerPolicy="no-referrer" onError={walkFallbacks} />
                  {b.title && <figcaption className="hl-hero__cap hl-scrim">{b.title}</figcaption>}
                </>
              )
              return b.url ? (
                <a key={i} className="hl-hero__slide opacity-0" data-hero-slide
                   href={b.url} {...adAnchorProps(b.url)}
                   aria-label={b.title || 'Open banner link'}>{art}</a>
              ) : (
                <div key={i} className="hl-hero__slide opacity-0" data-hero-slide>{art}</div>
              )
            })}
            <i className="hl-hero__fringe" aria-hidden="true" />
          </div>

          {d.banners.length > 1 && (
            <>
              {/* w-2 / bg-white/60 are the classes initHero toggles against
                  w-6 / bg-gold; the theme re-tints bg-gold to madder in scope. */}
              <div className="hl-rail__dots">
                {d.banners.map((_, i) => (
                  <button key={i} type="button" className="hl-rail__pin w-2 bg-white/60"
                          data-hero-dot aria-label={'Banner ' + (i + 1)} />
                ))}
              </div>
              <button type="button" className="hl-hero__nav" data-hero-prev aria-label="Previous banner">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button type="button" className="hl-hero__nav" data-hero-next aria-label="Next banner">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}
          </>
          )}

          </div>{/* .hl-hero__wall */}

          {officers.length > 0 && (
            <div className="hl-hero__office" role="group" aria-label="Club officers">
              {officers.map((l, i) => (
                <Officer key={l.type} i={i} l={l} monogram={monogram}
                         broken={brokenPortraits.has(l.type)}
                         onBroken={() => setBrokenPortraits((v) => new Set(v).add(l.type))}
                         yearId={club.selectedYearId} />
              ))}
            </div>
          )}
          </div>{/* .hl-hero__grid */}
        </div>
      </section>
      {weft}

      {/* BAND 3, the We meet / Time / Where / View on map strip, was REMOVED on
          2026-09-07. The meeting details are not lost from the page: band 9
          still carries the venue in its heading and the map itself. d.meetingDay
          and d.mapUrl now have no reader here - that is the hook's shape, not
          dead code of ours, and band 9 still reads d.meetingVenue. */}

      {/* ══ BAND 4 · THE TEMPLE BORDER — impactNumbers + membershipStats ══════
          THE ONE INKED BAND. Every figure can legitimately be 0, and 0 renders
          as a fully filled 0 — that is the fix, not a side effect. The money
          figure is a PRINTED string via formatMoney(club currency), so
          rccolombowest reads "Rs 8,160,001" and never "₹81,60,001".
          NO { compact: true } (2026-09-07): the total cost is printed IN FULL,
          never abbreviated to Cr / L / M / B. It keeps the `money` flag only for
          the nowrap in handloom.css — the figure is long and must not stack. */}
      <section className="hl-band hl-inked hl-tb" data-hl-band="cost" aria-label="Our impact">
        <i className="hl-temple hl-temple--top" aria-hidden="true" />
        <div className="hl-x hl-tb__grid">
          <Stat text={groupInt(d.impactNumbers.projects, d.currency)} caption="Projects" />
          <Stat money text={formatMoney(d.impactNumbers.totalCost, d.currency)}
                caption="Total cost" />
          <Stat text={groupInt(d.impactNumbers.beneficiaries, d.currency)} caption="Beneficiaries" />
          <Stat text={groupInt(members, d.currency)} caption="Members" />
        </div>
        <i className="hl-temple hl-temple--bottom" aria-hidden="true" />
      </section>

      {/* READING ORDER, set 2026-09-07: banner -> counters -> Leadership ->
          Upcoming -> Advertisement -> Newsletters -> Where we meet -> Projects.
          The BAND numbers below are the ORIGINAL ones and are deliberately left
          alone: they are the cross-reference into handloom.css, whose section
          headers carry the same numbers. Renumber one and you must renumber
          both, for nothing.
          GROUNDS ALTERNATE and that is load-bearing, not decoration - it is the
          only seam between two consecutive bands. Reading down: cloth, inked,
          cloth, cloth2, cloth, cloth2, cloth, cloth3. Move a band and check the
          two it now sits between. */}

      {/* ══ BAND A · THE BOARD — leaders[] + events[] ═════════════════════════
          Leadership and Upcoming share ONE band (2026-09-07), two columns at
          >=1024px and stacked below it.
          data-hl-band sits on the two COLUMNS, never on the section as well:
          rotary-anim observes every [data-hl-band] and drives the shuttle bar's
          figure from whichever crosses the middle of the viewport. Nest one
          inside another and both intersect at once, so the label flickers
          between them. Siblings, always. */}
      <section className="hl-band hl-band--cloth hl-pen hl-duo"
               aria-label="Leadership and upcoming events">
        <div className={'hl-x hl-duo__grid' + (d.events.length ? '' : ' hl-duo__grid--solo')}>

          <div className="hl-duo__col hl-lead" data-hl-band="members">
            {/* THE 6px .hl-rail IS GONE FROM BOTH COLUMNS in this band, and so
                is the standfirst line that briefly replaced it (removed
                2026-09-09). Both heads are eyebrow + title and nothing else,
                which is what lands the two columns' first cards on one line -
                give one of them an extra line and they go out of step. */}
            <div className="hl-band__head hl-band__head--tight">
              <div>
                <h2 className="hl-band__title reveal" style={{ '--i': 0 }}>Our Leadership</h2>
              </div>
              {leadCan && (
                <div className="hl-lead__nav reveal" style={{ '--i': 0 }}>
                  <button type="button" className="hl-round" aria-label="Previous leader"
                          onClick={() => leadPage(-1)}><IcoChev back /></button>
                  <button type="button" className="hl-round" aria-label="Next leader"
                          onClick={() => leadPage(1)}><IcoChev /></button>
                </div>
              )}
            </div>
            {/* The two DIGNITARIES only — the club president and secretary are
                in the hero. Both of these 204 for many clubs, and "Not
                available" carrying the office is a complete object, not a
                fallback. Same <Officer> card as the hero: one design for every
                person on the page. Their bio (the /dignitary description) is
                rendered but shown only when there is no Upcoming column and the
                pair has the band to itself - see .hl-lead__bio. */}
            {/* The label goes with the role: aria-label on a role-less <div> is
                prohibited (axe aria-prohibited-attr), and since the rail became a
                stacked grid below 1024 that is the common state, not the edge. */}
            <div className="hl-lead__rail" ref={leadRail} aria-label={leadCan ? 'Leadership' : undefined}
                 role={leadCan ? 'group' : undefined} tabIndex={leadCan ? 0 : undefined}>
              {dignitaries.map((l, i) => (
                <Leader key={l.type} i={i} l={l} monogram={monogram}
                        broken={brokenPortraits.has(l.type)}
                        onBroken={() => setBrokenPortraits((v) => new Set(v).add(l.type))}
                        yearId={club.selectedYearId} />
              ))}
            </div>
          </div>

          {/* NO EVENTS, NO COLUMN (2026-09-07). /upcoming-events returns FUTURE
              dates only, so this is empty for most clubs most of the time — and
              an empty-state card beside Leadership was more page than the
              information deserved. The whole column is dropped and the grid
              above collapses to one track, so Leadership takes the full band.
              THE EMPTY STATE IS NOT LOST: it still lives on /events, which the
              "See all events" link here goes to. */}
          {d.events.length > 0 && (
            <div className="hl-duo__col hl-up" data-hl-band="events">
              {/* "See all events" MOVED OUT OF THE HEAD (2026-09-09) and under
                  the card, which is where the newsletter card already puts its
                  own VIEW ALL. In the head it wrapped to a second line the
                  moment the column got narrower than 1440 - measured 108px of
                  head against Leadership's 48 at both 1024 and 1280 - and that
                  60px came straight off the event card, so the two cards the
                  user asked to match only matched at one width. Title-only
                  heads are the same height at EVERY width, by construction. */}
              <div className="hl-band__head hl-band__head--tight">
                <div>
                  <h2 className="hl-band__title reveal" style={{ '--i': 0 }}>Upcoming Events</h2>
                </div>
              </div>
              {/* useHomeData slices events[] to .slice(0,1) - one event, never a
                  list. No Register button: registrationLink is not on the hook.
                  Guarded above, so [0] is always there.
                  ONE ANCHOR AROUND THE WHOLE CARD, and the round mark on the
                  right is decorative. A second real control inside the same
                  link is two tab stops going to one place. */}
              <a className="hl-up__card reveal" style={{ '--i': 1 }}
                 href={'/event?id=' + d.events[0].id}>
                <span className="hl-up__date">
                  <span className="hl-up__day hl-num">{d.events[0].day}</span>
                  <span className="hl-up__mon">{d.events[0].mon}</span>
                  <span className="hl-up__yr">{d.events[0].year}</span>
                </span>
                <div className="hl-up__body">
                  <h4 className="hl-up__title">{d.events[0].title}</h4>
                  <span className="hl-up__meta"><IcoPin />{d.events[0].venue}</span>
                  {d.events[0].time
                    ? <span className="hl-up__meta"><IcoClock />{d.events[0].time}</span>
                    : null}
                </div>
                <span className="hl-up__go" aria-hidden="true"><Arrow /></span>
              </a>
              <a className="hl-up__all hl-btn hl-btn--outline reveal" style={{ '--i': 2 }}
                 href="/events">
                See all events <Arrow />
              </a>
            </div>
          )}

        </div>
      </section>
      {weft}

      {/* ══ BAND B · SUPPORTERS · NEWSLETTERS · WHERE WE MEET ═════════════════
          Three columns at >=1024px, two at >=768px, stacked below (2026-09-07).
          Every column carries the SAME two-line .hl-band__head followed by a
          rail — that shape is what lands the three rails on one baseline. Give
          one of them a different head and the other two rails go out of line.
          The advertisement keeps ITS OWN [data-hero] root and interval: the
          banner slider's root is the hero's .hl-x, a different element, and
          initHero scopes slides and dots to the root it is handed. There must
          never be a second root over d.ads or two intervals fight for it. */}
      <section className="hl-band hl-band--cloth2 hl-trio"
               aria-label="Supporters, newsletters and where we meet">
        {/* --noad IS LOAD-BEARING, not a nicety. The comment below has said
            "with no ads the band is simply two columns wide" since 2026-09-07,
            and the CSS never agreed: the >=1024px rule declares THREE explicit
            tracks (.75fr / 1.3fr / 1fr), so with two children the pair lands in
            tracks 1 and 2 and track 3 is left empty. Measured at 1440 by
            removing the ad column live: Newsletters came out 299px wide - the
            POSTER track, the narrowest of the three - "Where we meet" took 519,
            and 399px of the band was blank cloth. The list ended up in the
            column the layout exists to give it MORE measure than.
            The duo band above already carries the same idea as --solo. */}
        <div className={'hl-x hl-trio__grid' + (hasRealAds ? '' : ' hl-trio__grid--noad')}>

          {/* hasRealAds gates the WHOLE column: the bundled placeholder under a
              head reading "Our supporters" would be a claim the club has not
              made. With no ads the band is simply two columns wide.
              NO HEAD AND NO RAIL on this card: the eyebrow and title were
              removed on 2026-09-07, and the rail went with them — it is the
              line a head hangs from, and alone at the top of a card it reads as
              a stray rule. */}
          {hasRealAds && (
            <div className={'hl-trio__col hl-trio__col--ad reveal' + (morphAd ? '' : '')}
                 style={{ '--i': 0 }}
                 {...(morphAd ? {} : { 'data-hero': true, 'data-hero-interval': '6000' })}>
              {morphAd ? (
              <div className="hl-ad__stage hl-mat hl-morph hl-morph--ad"
                   style={adAR ? { aspectRatio: String(adAR) } : undefined}>
                <MorphLink href={adHref}>
                  <MorphSlider
                    items={adItems}
                    onIndexChange={onAdIndex}
                    transition={adMorph}
                    intensity={0.5}
                    aberration={0.25}
                    drift={0.3}
                    scale={2.4}
                    duration={1.2}
                    ease="power2.inOut"
                    autoplay
                    autoplayDelay={6}
                    loop
                    radius={0}
                    overlayColor="#12332A"
                    showCaptions={false}
                    showControls={false}
                    showIndicators={adItems.length > 1}
                  />
                </MorphLink>
              </div>
              ) : (
              <div className="hl-ad__stage hl-mat" data-hl-morph="melt">
                {d.ads.map((a, i) => (
                  <a key={i} className="hl-ad__slide opacity-0" data-hero-slide
                     href={a.url} {...adAnchorProps(a.url)}
                     aria-label={a.title || 'Advertisement'}>
                    <img className="hl-ad__img" src={a.img} data-fallbacks={a.fallbacks}
                         alt={a.title || 'Advertisement'} loading="lazy"
                         referrerPolicy="no-referrer" onError={walkFallbacks}
                         onLoad={latchAdAspect} />
                  </a>
                ))}
              </div>
              )}
              {!morphAd && d.ads.length > 1 && (
                <div className="hl-rail__dots">
                  {d.ads.map((_, i) => (
                    <button key={i} type="button" className="hl-rail__pin w-2 bg-white/60"
                            data-hero-dot aria-label={'Ad ' + (i + 1)} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="hl-trio__col hl-nlc reveal" style={{ '--i': hasRealAds ? 1 : 0 }}>
            {/* THE RAIL IS GONE FROM BOTH CARDS in this band (the comp has no
                rule under either head). The heads no longer have to match in
                height either: the cards are levelled by the grid, and there is
                no rail left to line up. */}
            <div className="hl-band__head hl-band__head--tight">
              <div>
                <h2 className="hl-band__title">Newsletters</h2>
              </div>
            </div>
            <div className="hl-notice__col">
              {d.newsletters.length ? (
                <ul className="hl-nl">
                  {d.newsletters.map((nl, i) => (
                    <li key={i}>
                      {/* THE DATE IS A PLATE, not a column of grey type on the
                          right. It is the same object the Upcoming card uses,
                          at list scale, which is what ties the two bands
                          together - and it buys the title the full measure
                          back, so a long one wraps instead of being squeezed.
                          The plate is aria-hidden and the sr-only line below
                          carries the whole formatted date instead: "01 SEP"
                          read out as two separate words is worse than nothing.
                          A newsletter with no publish date renders NO plate
                          rather than an empty box - the API leaves it null. */}
                      <a className="hl-nl__row" href={nl.url} target="_blank" rel="noopener noreferrer">
                        {nl.day ? (
                          <span className="hl-nl__plate" aria-hidden="true">
                            <span className="hl-nl__day hl-num">{nl.day}</span>
                            <span className="hl-nl__mon">{nl.mon} {nl.year}</span>
                          </span>
                        ) : <span className="hl-nl__plate hl-nl__plate--none" aria-hidden="true" />}
                        <span className="hl-nl__title">{nl.title}</span>
                        {/* A SPAN THAT LOOKS LIKE A BUTTON, never a <button> or
                            a second <a>: the whole row is already the link, and
                            an interactive element inside an anchor is invalid
                            and gives a keyboard user two tab stops to one
                            place. The row's :hover styles it, so it reads as
                            the control it looks like. */}
                        <span className="hl-nl__more">Read more <Arrow /></span>
                        <span className="sr-only">{nl.date ? nl.date + ', ' : ''}opens in a new tab</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <Unwoven slot="56px" nested>
                  <p>No newsletters published for {year}.</p>
                  <a className="hl-btn hl-btn--outline" href={prevYearHref}>See {prevYearLabel}</a>
                </Unwoven>
              )}
              {/* NOT A SECOND FILLED CTA. The Visit card's Go to map is the
                  band's one madder surface (law L3) and a second beside it
                  would double the page's filled madder area, so this is the
                  outline button. It sits after the list inside .hl-notice__col
                  and is pushed to the foot of the card by margin-top:auto, so
                  it lands on the same line as Go to map. */}
              {d.newsletters.length > 0 && (
                <a className="hl-nl__all hl-btn hl-btn--outline" href="/newsletters">
                  View all newsletters <Arrow />
                </a>
              )}
            </div>
          </div>

          {/* THE FACTS, NOT A MAP (2026-09-07): day, time, venue, and a button
              out to the map. The embedded iframe and the authored paragraph
              were both removed — the paragraph was the fifth --hl-reed surface,
              so four remain.
              All three values fall back to the literal "—" in the hook, so this
              column NEVER collapses: the captions and the rules hold its shape,
              which is the whole reason the rules are there. mapUrl is never
              blank either — it degrades to a club-name search — so the button
              always goes somewhere real. */}
          <div className="hl-trio__col hl-visitc reveal" style={{ '--i': hasRealAds ? 2 : 1 }}>
            {/* The wheel, faint, top right - the comp's watermark. One element,
                pointer-events:none, and it is inside the card's padding box so
                it cannot widen anything. */}
            <i className="hl-visitc__mark" aria-hidden="true" />
            <div className="hl-band__head hl-band__head--tight">
              <div>
                <h2 className="hl-band__title">Where we meet</h2>
              </div>
            </div>
            {/* Still a <dl>: these ARE term/definition pairs and the caption is
                the accessible label for the value beside it. The icon tile is a
                THIRD element inside the row, not inside the <dt> - a <dt> may
                only hold phrasing content, and it is decorative anyway. */}
            <dl className="hl-visit">
              {[['Day', d.meetingDay, IcoCal],
                ['Time', d.meetingTime, IcoClock],
                ['Where', d.meetingVenue, IcoPin]].map(([cap, val, Ico]) => (
                <div className="hl-visit__row" key={cap}>
                  <i className="hl-visit__tile" aria-hidden="true"><Ico /></i>
                  <dt className="hl-meet__cap">{cap}</dt>
                  <dd className="hl-meet__val">{val}</dd>
                </div>
              ))}
            </dl>
            {/* THE one filled madder button on the page — it was "Get in touch"
                and is now the map, so the count is still exactly one. */}
            <a className="hl-join__cta hl-btn hl-btn--solid" href={d.mapUrl}
               target="_blank" rel="noopener noreferrer">
              Go to map <Arrow />
            </a>
          </div>

        </div>
      </section>
      {weft}

      {/* ══ BAND 5 · THE WORK — featured[] ════════════════════════════════════
          The ONE warp-field band on the page. */}
      <section className="hl-band hl-band--cloth3 hl-band--roomy hl-work"
               data-hl-band="projects" aria-label="Our projects">
        <div className="hl-warp" aria-hidden="true" />
        <div className="hl-x">
          <div className="hl-band__head">
            <div>
              <h2 className="hl-band__title reveal" style={{ '--i': 0 }}>Our Projects</h2>
            </div>
            {/* NO COUNT, AND GATED. Two defects in one line:
                (a) d.featuredCount is assigned AFTER the slice in homeData.js,
                    so it is capped at featuredTake - this club has 21 projects
                    and the link read "See all 6 projects". It never was the
                    total. Every other theme uses featuredCount only as a
                    guard; handloom was the only one printing it.
                (b) with no qualifying projects the head still rendered, so a
                    club saw "See all 0 projects" directly above the empty
                    state's own "See all projects" button - two links to the
                    same page, one advertising nothing. */}
            {d.featured.length > 0 && (
              <a className="hl-band__more hl-btn hl-btn--text reveal" style={{ '--i': 1 }} href="/projects">
                See all projects <Arrow />
              </a>
            )}
          </div>

          {/* ══ THE ACCORDION (React Bits, 2026-09-09) ══════════════════════
              It replaced the six-card grid. WHAT THAT COST, stated plainly so
              nobody hunts for it later: a panel carries ONE label. The card it
              replaced carried the title, the description AND the avenue chip,
              and featured[] still supplies all three — desc and avenueLabel are
              simply not rendered here any more. /projects still shows them.

              EVERY COLOUR IS A TOKEN, passed as a var() string rather than a
              hex. The component writes these straight into --ag-accent /
              --ag-overlay / --ag-text as inline custom properties, and they
              resolve against this subtree, so the palette keeps ONE source.
              Note WHICH tokens: --hl-madder and --hl-green-deep are declared on
              html[data-theme=handloom]. --hl-turmeric is NOT — law L4 confines
              it to .hl-inked, and this band is cloth, so turmeric here would
              resolve to nothing at all.

              radius={0} is not taste, it is law: --hl-r is 0px and this theme
              has exactly two rounded things, the monogram disc and portrait
              avatars. tilt and duration are pulled well below the component's
              defaults (8deg/0.6s) to sit inside this theme's motion budget —
              its own lifts are 3px and its hover duration is 180ms.

              NO .reveal ON THE WRAPPER, deliberately. GSAP animates these nodes
              with inline styles, and handloom's reveal rule is the documented
              specificity trap in this file; letting the two systems write the
              same elements is how you get a section that is permanently
              invisible on one breakpoint. The accordion stages itself in.

              A WRAPPER AROUND IT IS A DIFFERENT MATTER, and that is what the
              div below is (2026-09-10). GSAP writes the PANELS; it never
              touches an ancestor, so the two systems still do not share a
              node. Without it this band animated its heading and its link and
              nothing else - two elements out of seventy - which is what "no
              animation on the home page" meant here.
              `filter: blur()` on this wrapper does establish a containing
              block for absolutely-positioned descendants, but .ag-panel is
              position:relative and is a closer ancestor of the only absolute
              children (.ag-panel__media), so nothing inside reparents. */}
          {d.featured.length ? (
            <div className="hl-work__gallery reveal" style={{ '--i': 2 }}>
            <AccordionGallery
              items={d.featured.map((f) => ({
                image: f.img,
                label: f.title,
                alt: f.title,
                // the avenue chip the card used to carry, restored 2026-09-09
                badge: f.avenueLabel,
                link: withYear('/project?pid=' + f.id, club.selectedYearId),
              }))}
              onImageError={wheelFallback}
              defaultIndex={0}
              accentColor="var(--hl-madder)"
              overlayColor="var(--hl-green-deep)"
              textColor="var(--hl-cloth)"
              radius={0}
              gap={12}
              height={460}
              expandRatio={0.5}
              tilt={4}
              duration={0.45}
              ease="power2.out"
              trigger="hover"
              grayscale={false}
              autoplay
              autoplayDelay={3}
            />
            </div>
          ) : (
            <Unwoven slot="240px">
              <p>Nothing woven for {year} yet.</p>
              <a className="hl-btn hl-btn--outline" href="/projects">See all projects</a>
            </Unwoven>
          )}
        </div>
      </section>

    </div>
  )
}
