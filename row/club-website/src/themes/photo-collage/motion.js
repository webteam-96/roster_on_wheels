'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage — the theme's signature motions, as helpers on _shared/motion.js.
//
// Ported from Theme8-Samples/G-collage-parallax (script 2). Every helper that
// takes no event is meant to run INSIDE a useScene setup: it only creates
// tweens/ScrollTriggers, so the scene's gsap.matchMedia records and reverts
// them, and under reduced motion none of it ever runs (no hidden start states in
// CSS — anything a helper hides, it hides from JS and hands back with clearProps).
//
// Scrubbed ENTRANCES end at 'clamp(...)': on a short page (or near the foot of
// one) the end is pulled back to the last scroll position, so a title, stroke,
// tag or memo always finishes instead of sitting half-drawn / mid-swing.
//
// House rule the helpers rely on (see DESIGN.md "Wrappers"):
//   .col-print-move  parallax (y)            <- parallax()
//   .col-print-fl    deal / swing (rotation) <- dealIn(), revealBatch(), swayScrub()
//   .col-print       CSS tilt + scroll sway + hover — NEVER tweened
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { gsap, ScrollTrigger, SplitText, MOTION_OK, prefersReducedMotion, afterFonts } from '../_shared/motion.js'
import { formatMoney, groupInt } from '../_shared/data.js'

export {
  gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages,
  scrollToY, lockScroll, getLenis, prefersReducedMotion,
} from '../_shared/motion.js'

/** What every timed entrance hands back (GSAP also writes translate/rotate/scale inline). */
export const CLEAR = 'transform,opacity,visibility,translate,rotate,scale'
/** A photo "develops": pale, warm and flat -> full colour. Always fromTo (a filter from none starts at brightness(0)). */
export const DEV0 = 'sepia(0.75) saturate(0.35) brightness(1.3) contrast(0.72)'
export const DEV1 = 'sepia(0) saturate(1) brightness(1) contrast(1)'

const side = (i) => (i % 2 ? 1 : -1)
/** Elements from a selector (scoped to the running scene), a node, a NodeList or an array. */
const els = (t) => gsap.utils.toArray(t).filter(Boolean)
/** Descendants of `root` (or scene-scoped when root is omitted). */
const within = (root, sel) => (root ? Array.from(root.querySelectorAll(sel)) : els(sel))
/**
 * A scrubbed entrance whose start line is already behind the element when the
 * scene builds (the first section title under a short page hero, on load) would
 * rest half-drawn until the visitor scrolls: it plays once, timed, instead
 * ('play'). The flag marks elements a scene has already built, so a scene rebuilt
 * by new data (a search, a filter) leaves the ones above the line as they are
 * (true = no tween, fully drawn) and never replays them.
 */
const playedNow = (el, startPct) => {
  if (el.getBoundingClientRect().top >= window.innerHeight * startPct) { el.setAttribute('data-col-in', ''); return false }
  return el.hasAttribute('data-col-in') ? true : 'play'
}
/** onStart of a timed play: flagged only once it really runs (StrictMode's instant revert must not count). */
const flagIn = (el) => () => el.setAttribute('data-col-in', '')

/** Parallax speed from the element or its nearest [data-col-speed] ancestor. */
const speedOf = (el, fallback = 1) => {
  const host = el.closest('[data-col-speed]')
  const v = host ? parseFloat(host.getAttribute('data-col-speed')) : NaN
  return Number.isFinite(v) ? v : fallback
}

// ── headings, strokes, highlighter ──────────────────────────────────────────
/**
 * Section titles (.col-head-title) wipe in left to right as they come up; a
 * photo-filled title (.col-pt.is-img) also pans its photo inside the letters.
 * Inside a pinned stage pass `pinStage` so the pan stops where the pin starts.
 */
export function titleIn(targets, { pinStage } = {}) {
  els(targets).forEach((el) => {
    const now = playedNow(el, 0.92)
    if (now === 'play') gsap.fromTo(el, { clipPath: 'inset(-20% 100% -20% -20%)' }, { clipPath: 'inset(-20% -20% -20% -20%)', duration: 1.1, delay: 0.3, ease: 'power3.inOut', clearProps: 'clipPath', onStart: flagIn(el) })
    else if (!now) gsap.fromTo(el, { clipPath: 'inset(-20% 100% -20% -20%)' }, {
      clipPath: 'inset(-20% -20% -20% -20%)', ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 92%', end: 'clamp(top 58%)', scrub: 0.5 },
    })
    if (el.classList.contains('is-img')) {
      gsap.fromTo(el, { backgroundPosition: '50% 0%' }, {
        backgroundPosition: '50% 100%', ease: 'none',
        scrollTrigger: pinStage
          ? { trigger: el, start: 'top bottom', endTrigger: pinStage, end: 'top top', scrub: true }
          : { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      })
    }
  })
}

/** Hand-drawn strokes (svg.col-scroll-draw > path.col-draw) draw themselves as they scroll in. */
export function drawIn(targets) {
  els(targets).forEach((svg) => {
    const paths = svg.querySelectorAll('.col-draw')
    if (!paths.length) return
    const now = playedNow(svg, 0.88)
    if (now === 'play') gsap.fromTo(paths, { strokeDashoffset: 1.02 }, { strokeDashoffset: 0, duration: 0.9, delay: 0.6, stagger: 0.25, ease: 'power2.inOut', clearProps: 'strokeDashoffset', onStart: flagIn(svg) })
    else if (!now) gsap.fromTo(paths, { strokeDashoffset: 1.02 }, {
      strokeDashoffset: 0, ease: 'none', stagger: 0.5,
      scrollTrigger: { trigger: svg, start: 'top 88%', end: 'clamp(top 52%)', scrub: 0.6 },
    })
  })
}

/** Timed stroke draw (for things already on screen: page hero arrow, hero underline). */
export function drawNow(targets, { delay = 0, duration = 1, stagger = 0.3 } = {}) {
  const paths = els(targets).flatMap((t) => (t.classList && t.classList.contains('col-draw') ? [t] : Array.from(t.querySelectorAll('.col-draw'))))
  if (!paths.length) return
  gsap.fromTo(paths, { strokeDashoffset: 1.02 }, { strokeDashoffset: 0, duration, delay, stagger, ease: 'power2.inOut', clearProps: 'strokeDashoffset' })
}

/** <mark class="col-hl"> fills with highlighter as it scrolls in. */
export function highlightIn(targets) {
  els(targets).forEach((m) => {
    gsap.fromTo(m, { backgroundSize: '0% 100%' }, {
      backgroundSize: '100% 100%', ease: 'none',
      scrollTrigger: { trigger: m, start: 'top 85%', end: 'clamp(top 55%)', scrub: 0.5 },
    })
  })
}

/** The sample's per-section decor: every title wipe, stroke draw and highlighter inside `root`. */
export function decor(root, { pinStage } = {}) {
  if (!root) return
  titleIn(within(root, '.col-head-title'), { pinStage })
  drawIn(within(root, 'svg.col-scroll-draw'))
  highlightIn(within(root, 'mark.col-hl'))
}

// ── prints ──────────────────────────────────────────────────────────────────
/** Timed deal (on screen now): prints drop onto the table, each at its own tilt. Target .col-print-fl. */
export function dealIn(targets, { delay = 0.35, stagger = 0.09 } = {}) {
  const list = els(targets)
  if (!list.length) return
  gsap.from(list, {
    y: -70, scale: 1.25, opacity: 0, rotation: (i) => side(i) * (14 + i * 3),
    duration: 1.05, ease: 'back.out(1.3)', stagger, delay, clearProps: CLEAR,
  })
}

/**
 * Scroll deal for grids/lists: each batch drops in once as it enters. Target the
 * card's wrapper (a .col-print-fl, a <li>), never the element that owns a CSS tilt.
 */
export function revealBatch(targets, { start = 'top 94%', y = 70, stagger = 0.08 } = {}) {
  const list = els(targets)
  if (!list.length) return
  gsap.set(list, { y, opacity: 0, rotation: (i) => side(i) * 6 })
  ScrollTrigger.batch(list, {
    start, once: true,
    onEnter: (batch) => gsap.to(batch, {
      y: 0, opacity: 1, rotation: 0, duration: 0.9, ease: 'back.out(1.4)', stagger, overwrite: true, clearProps: CLEAR,
    }),
  })
}

/** Scrubbed depth: each element drifts at its own speed (data-col-speed on it or an ancestor, ~0.85-1.15). */
export function parallax(targets, { wide = true, amount } = {}) {
  const A = amount || (wide ? 380 : 120)
  els(targets).forEach((el) => {
    const sp = speedOf(el)
    if (sp === 1) return
    gsap.fromTo(el, { y: (sp - 1) * A }, {
      y: -(sp - 1) * A, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.5 },
    })
  })
}

/** Prints swing a few degrees as they pass (the wall). Target .col-print-fl. */
export function swayScrub(targets) {
  els(targets).forEach((el, i) => {
    gsap.fromTo(el, { rotation: -side(i) * 5 }, {
      rotation: side(i) * 3, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.5 },
    })
  })
}

/** Photos develop from pale sepia to full colour as they come up. Target the <img>s. */
export function develop(targets) {
  els(targets).forEach((img) => {
    gsap.fromTo(img, { filter: DEV0 }, {
      filter: DEV1, ease: 'none',
      scrollTrigger: { trigger: img, start: 'top 95%', end: 'clamp(top 45%)', scrub: 0.4 },
    })
  })
}

/** Handwritten captions write themselves in (clip wipe). */
export function captionIn(targets) {
  els(targets).forEach((cap) => {
    const now = playedNow(cap, 0.94)
    if (now === 'play') gsap.fromTo(cap, { clipPath: 'inset(-20% 100% -20% -6%)' }, { clipPath: 'inset(-20% -6% -20% -6%)', duration: 0.9, delay: 0.4, ease: 'power2.out', clearProps: 'clipPath', onStart: flagIn(cap) })
    else if (!now) gsap.fromTo(cap, { clipPath: 'inset(-20% 100% -20% -6%)' }, {
      clipPath: 'inset(-20% -6% -20% -6%)', ease: 'none',
      scrollTrigger: { trigger: cap, start: 'top 94%', end: 'clamp(top 64%)', scrub: 0.4 },
    })
  })
}

/** A hanging tag (.col-tag) swings on its string as it comes up and settles as you reach it. */
export function swing(targets) {
  els(targets).forEach((tag) => {
    const wrap = tag.closest('.col-tag-wrap') || tag
    gsap.timeline({ defaults: { ease: 'sine.inOut' }, scrollTrigger: { trigger: wrap, start: 'top bottom', end: 'clamp(center 55%)', scrub: 0.8 } })
      .fromTo(tag, { rotation: 18 }, { rotation: -10 })
      .to(tag, { rotation: 6 })
      .to(tag, { rotation: -2 })
      .to(tag, { rotation: 0 })
  })
}

/** A memo / note drops and straightens as it arrives. Target the wrapper (.col-memo-move). */
export function settleIn(targets) {
  els(targets).forEach((el, i) => {
    gsap.fromTo(el, { rotation: side(i + 1) * 11, y: 90 }, {
      rotation: 0, y: 0, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'clamp(top 45%)', scrub: 0.6 },
    })
  })
}

/** Cards slide in from alternating sides and settle (the newsletter clipboard). */
export function slideIn(targets) {
  els(targets).forEach((el, i) => {
    gsap.fromTo(el, { x: () => side(i + 1) * Math.min(window.innerWidth * 0.14, 180), y: 60, rotation: side(i + 1) * 14 }, {
      x: 0, y: 0, rotation: 0, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'clamp(top 50%)', scrub: 0.6, invalidateOnRefresh: true },
    })
  })
}

// ── stickers ────────────────────────────────────────────────────────────────
const fmtNum = (v, money, cur) => (money ? formatMoney(v, cur) : groupInt(v, cur))

/**
 * Stickers (.col-stk, from <StatRow>) pop and spin in, count up, then drift at
 * their own speed. Writes the figure through the React-owned text node (never
 * textContent) and RETURNS a cleanup — return it from the scene setup.
 */
export function stickersIn(targets, { wide = true } = {}) {
  const A = wide ? 420 : 160
  const undo = []
  els(targets).forEach((li, i) => {
    const move = li.querySelector('.col-stk-move'), fl = li.querySelector('.col-stk-fl'), num = li.querySelector('.col-stk-num')
    if (!move || !fl || !num) return
    const sp = speedOf(li)
    gsap.fromTo(move, { y: (sp - 1) * A, rotation: -side(i) * 10 }, {
      y: -(sp - 1) * A, rotation: side(i) * 10, ease: 'none',
      scrollTrigger: { trigger: li, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
    })
    const node = num.firstChild && num.firstChild.nodeType === 3 ? num.firstChild : null
    const to = parseFloat(num.getAttribute('data-col-to')) || 0
    const cur = num.getAttribute('data-col-cur') || null
    const money = num.hasAttribute('data-col-money')
    // the figure React holds NOW (read at restore time: when the value changed,
    // React has already written the new text before this scene's cleanup runs)
    const final = () => fmtNum(parseFloat(num.getAttribute('data-col-to')) || 0, num.hasAttribute('data-col-money'), num.getAttribute('data-col-cur') || null)
    const o = { v: 0 }
    let cnt = null
    // only a figure this scene counted is written back (a sticker with no data-col-to keeps its own text)
    undo.push(() => { if (cnt) { cnt.kill(); node.nodeValue = final() } })
    gsap.fromTo(fl, { scale: 0.15, rotation: side(i) * 200, opacity: 0 }, {
      scale: 1, rotation: 0, opacity: 1, duration: 1.1, ease: 'back.out(1.7)', delay: (i % 3) * 0.08, clearProps: CLEAR,
      scrollTrigger: { trigger: li, start: 'top 88%', once: true },
      onStart: () => {
        if (!node || !to) return
        node.nodeValue = fmtNum(0, money, cur)
        cnt = gsap.to(o, { v: to, duration: 1.6, ease: 'power2.out', onUpdate: () => { node.nodeValue = fmtNum(o.v, money, cur) }, onComplete: () => { node.nodeValue = final() } })
      },
    })
  })
  return () => undo.forEach((f) => f())
}

// ── the house style in one call ─────────────────────────────────────────────
/**
 * Everything an inner page usually wants, scoped to `root`:
 *   decor (titles, strokes, highlighter) · [data-col-deal] batches deal in ·
 *   .col-print-move[data-col-speed] parallax · .col-print-photo img develop ·
 *   .col-print-cap write-in · .col-tag swing · .col-memo-move settle · stickers.
 * Returns the cleanup: `useScene(ref, (c) => house(ref.current, c), [data])`.
 */
export function house(root, c = {}) {
  if (!root) return undefined
  // the page hero runs its own entrance — its prints must not also develop/scrub
  const body = (sel) => within(root, sel).filter((el) => !el.closest('.col-ph'))
  decor(root)
  revealBatch(body('[data-col-deal]'))
  parallax(body('.col-print-move[data-col-speed]'), { wide: c.wide })
  develop(body('.col-print-photo img'))
  captionIn(body('.col-print-cap'))
  swing(body('.col-tag'))
  settleIn(body('.col-memo-move'))
  return stickersIn(body('.col-stk'), { wide: c.wide })
}

// ── page hero entrance (PageHero runs these itself) ─────────────────────────
/** The head's words: crumbs rise, the title wipes in, the arrow draws, cut-outs spin in. Once per title. */
export function heroIn(root) {
  if (!root) return
  const q = (s) => Array.from(root.querySelectorAll(s))
  const title = root.querySelector('.col-ph-title')
  gsap.from(q('.col-crumbs li'), { y: 12, opacity: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out', clearProps: CLEAR })
  if (title) gsap.fromTo(title, { clipPath: 'inset(-20% 100% -20% -20%)' }, { clipPath: 'inset(-20% -20% -20% -20%)', duration: 1.15, delay: 0.1, ease: 'power3.inOut', clearProps: 'clipPath' })
  const rise = q('.col-ph-kick, .col-ph-lead, .col-ph-tools')
  if (rise.length) gsap.from(rise, { y: 16, opacity: 0, duration: 0.7, stagger: 0.08, delay: 0.55, ease: 'power3.out', clearProps: CLEAR })
  drawNow(q('.col-ph-arrow'), { delay: 0.9, duration: 0.9 })
  const cutIns = q('.col-cut .col-cut-in, .col-cut svg')
  if (cutIns.length) gsap.from(cutIns, { scale: 0, rotation: -120, opacity: 0, duration: 0.9, ease: 'back.out(1.6)', stagger: 0.1, delay: 0.6, clearProps: CLEAR })
  // scroll away: the cut-outs race off
  q('.col-cut').forEach((c, i) => gsap.to(c, { y: -(90 + i * 30), rotation: side(i) * 140, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.5 } }))
}

/**
 * The head's photos, which usually arrive with the page's data (after heroIn has
 * played): the prints are dealt and drift at their own depth, the photo pans
 * inside the title's letters. A scene of its own, so late data never replays the
 * title wipe.
 */
export function heroPhotosIn(root) {
  if (!root) return
  const q = (s) => Array.from(root.querySelectorAll(s))
  const title = root.querySelector('.col-ph-title.is-img')
  if (title) gsap.fromTo(title, { backgroundPosition: '50% 15%' }, { backgroundPosition: '50% 85%', ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
  dealIn(q('.col-ph-print .col-print-fl'), { delay: 0.3, stagger: 0.12 })
  q('.col-ph-print').forEach((p, i) => gsap.to(p, { y: -(40 + i * 36), ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.5 } }))
}

// ── one-off event motions (safe outside a scene; they check reduced motion) ──
/** A banner/slide "develops" in. Returns the tween (or null when motion is off). */
export function developIn(el, onComplete) {
  if (!el || prefersReducedMotion()) { if (onComplete) onComplete(); return null }
  return gsap.fromTo(el, { opacity: 0, filter: 'sepia(0.8) saturate(0.3) brightness(1.3)' }, {
    opacity: 1, filter: 'sepia(0) saturate(1) brightness(1)', duration: 1.3, ease: 'power2.out', clearProps: 'opacity,filter', onComplete,
  })
}

/** SplitText letters bounce in (the home's "Rotary Club of"). Call inside a scene; returns its cleanup. */
export function bounceChars(el, ctx) {
  if (!el) return undefined
  gsap.set(el, { autoAlpha: 0 })
  return afterFonts(ctx, () => {
    gsap.set(el, { clearProps: 'opacity,visibility' })
    const s = SplitText.create(el, { type: 'chars' })
    gsap.from(s.chars, { yPercent: -90, rotation: (i) => side(i) * 14, opacity: 0, duration: 0.7, ease: 'back.out(2)', stagger: 0.035, onComplete: () => s.revert() })
  })
}

// ── shell ───────────────────────────────────────────────────────────────────
/**
 * Scroll velocity -> --col-vel on <html> (-1..1). Prints, stickers and cards
 * lean into a fast scroll (see .col-print's transform). Call once, in Site.jsx.
 */
export function useScrollVelocity() {
  useEffect(() => {
    const mm = gsap.matchMedia()
    mm.add(MOTION_OK, () => {
      const root = document.documentElement
      const o = { v: 0 }
      const to = gsap.quickTo(o, 'v', { duration: 0.6, ease: 'power3.out', onUpdate: () => root.style.setProperty('--col-vel', o.v.toFixed(3)) })
      let t = 0
      const st = ScrollTrigger.create({
        start: 0, end: 'max',
        // Declaring ANY refreshPriority makes ScrollTrigger sort every trigger by
        // its position on the page before each refresh. Pages mount child scenes
        // before parent ones, so without this a pin created after the triggers
        // below it would leave their start/end values short by the pin's length.
        refreshPriority: 0,
        onUpdate: (self) => { to(gsap.utils.clamp(-1, 1, self.getVelocity() / 3000)); clearTimeout(t); t = setTimeout(() => to(0), 140) },
      })
      return () => { clearTimeout(t); st.kill(); root.style.removeProperty('--col-vel') }
    })
    return () => mm.revert()
  }, [])
}
