'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story — the theme's signature motions, as small helpers on top of
// _shared/motion.js. Everything here is meant to be called INSIDE a useScene
// setup (so it only runs when motion is allowed, and is reverted with the scene)
// unless its comment says otherwise.
//
//   useScene(ref, (c, ctx) => {
//     titleIn(ctx, ref.current.querySelector('h1'))
//     revealBatch('.spl-dir-card')
//     if (c.fine) magnet(ctx, row, pill)
//   }, [loaded])
//
// Hidden start states are only ever set here, from JS. With reduced motion no
// setup runs and every element is simply visible.
// ─────────────────────────────────────────────────────────────────────────────
import { gsap, ScrollTrigger, SplitText, afterFonts, prefersReducedMotion } from '../_shared/motion.js'

// One import surface for pages: everything the shared layer offers, plus ours.
export * from '../_shared/motion.js'

/** The split layout's breakpoint (the sticky side panel appears at this width). */
export const SPL_WIDE = '(min-width: 1000px)'
export const isWide = () => typeof window !== 'undefined' && window.matchMedia(SPL_WIDE).matches
export const motionOn = () => !prefersReducedMotion()
const EASE = 'power3.out'

/** Register `fn` to run when the scene's context reverts (listeners, classes). */
export function onRevert(ctx, fn) { ctx.add(() => fn) }

/** Run `fn` inside ctx once web fonts are in; dropped if the scene reverts first. */
export function later(ctx, fn) {
  const cancel = afterFonts(ctx, fn)
  onRevert(ctx, cancel)
}

/**
 * ScrollFloat — the element's letters rise out of per-word masks and un-stretch.
 * Needs ctx (SplitText measures real glyphs, so it waits for fonts). Pass
 * `scrollTrigger` to play it on scroll, `scrub: true` with it to tie it to the
 * scroll (the gold band's title). Non-scrubbed splits revert when done, so React
 * gets its text node back. Give the element a `key` of its text if the text can
 * change while mounted (see DESIGN.md).
 */
export function riseChars(ctx, el, { delay = 0, duration = 1, stagger = 0.03, scrollTrigger = null, scrub = false } = {}) {
  if (!el) return
  later(ctx, () => {
    const s = SplitText.create(el, { type: 'words,chars', mask: 'words', wordsClass: 'spl-sw' })
    if (scrub && scrollTrigger) {
      gsap.fromTo(s.chars,
        { yPercent: 120, scaleY: 2.3, scaleX: 0.7, opacity: 0, transformOrigin: '50% 0%' },
        { yPercent: 0, scaleY: 1, scaleX: 1, opacity: 1, ease: 'back.inOut(2)', stagger, scrollTrigger: { scrub: true, ...scrollTrigger } })
      return
    }
    gsap.from(s.chars, {
      yPercent: 120, scaleY: 2.1, opacity: 0, transformOrigin: '50% 0%', duration, ease: 'back.out(1.4)', stagger, delay,
      scrollTrigger: scrollTrigger || undefined,
      onComplete: () => s.revert(),
    })
  })
}

/** The page title entrance (PageHero runs this itself). */
export function titleIn(ctx, el, opts) { riseChars(ctx, el, { delay: 0.15, ...opts }) }

/** A section title that rises once as it scrolls into view (SectionHead runs this itself). */
export function titleOnScroll(ctx, el) {
  riseChars(ctx, el, { duration: 0.8, stagger: 0.022, scrollTrigger: { trigger: el, start: 'top 88%', once: true } })
}

/**
 * Cards/rows fade up in batches as they enter. Opacity only (never
 * visibility): an unrevealed card must stay keyboard-focusable.
 */
export function revealBatch(targets, { y = 40, stagger = 0.08, start = 'top 90%', duration = 0.8 } = {}) {
  const els = gsap.utils.toArray(targets)
  if (!els.length) return
  gsap.set(els, { opacity: 0, y })
  ScrollTrigger.batch(els, {
    start, once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration, ease: EASE, stagger, overwrite: true, clearProps: 'transform,opacity' }),
  })
}

/** Small things (crumbs, meta lines, buttons) rise in on load. */
export function riseIn(targets, { delay = 0.5, y = 18, stagger = 0.1 } = {}) {
  const els = gsap.utils.toArray(targets)
  if (els.length) gsap.from(els, { y, opacity: 0, duration: 0.7, stagger, delay, ease: EASE, clearProps: 'transform,opacity' })
}

/** Gentle scroll parallax on an image inside a clipping frame (amount in %). */
export function parallax(el, { amount = 12, trigger } = {}) {
  if (!el) return
  gsap.fromTo(el, { yPercent: -amount / 2, scale: 1 + amount / 100 }, {
    yPercent: amount / 2, ease: 'none',
    scrollTrigger: { trigger: trigger || el.parentElement || el, start: 'top bottom', end: 'bottom top', scrub: true },
  })
}

/** A photo frame opens through an iris (circle) as it scrolls in; its image settles from 1.25. */
export function irisIn(frame, { from = 8, to = 75, start = 'top 95%', end = 'top 40%' } = {}) {
  if (!frame) return
  gsap.fromTo(frame, { clipPath: 'circle(' + from + '% at 50% 50%)' },
    { clipPath: 'circle(' + to + '% at 50% 50%)', ease: 'none', scrollTrigger: { trigger: frame, start, end, scrub: 0.4 } })
  settleImg(frame)
}

/** A photo frame is revealed by a diagonal wipe from the left as it scrolls in. */
export function wipeIn(frame, { start = 'top 95%', end = 'top 40%' } = {}) {
  if (!frame) return
  gsap.fromTo(frame, { clipPath: 'polygon(0% 0%, 0% 0%, -30% 100%, -30% 100%)' },
    { clipPath: 'polygon(0% 0%, 130% 0%, 100% 100%, -30% 100%)', ease: 'none', scrollTrigger: { trigger: frame, start, end, scrub: 0.4 } })
  settleImg(frame)
}

/**
 * A photo frame opens through the iris ONCE, played not scrubbed, when it
 * scrolls in (a detail page's portrait/poster that is usually on screen at load);
 * its image settles from 1.2.
 */
export function irisOnce(frame, { delay = 0.2, start = 'top 92%', duration = 1.4 } = {}) {
  if (!frame) return
  const st = { trigger: frame, start, once: true }
  gsap.fromTo(frame, { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)', duration, delay, ease: 'power3.inOut', clearProps: 'clipPath', scrollTrigger: st })
  const img = frame.querySelector('img')
  if (img) gsap.fromTo(img, { scale: 1.2 }, { scale: 1, duration: duration + 0.3, delay, ease: 'power3.out', clearProps: 'transform', scrollTrigger: st })
}

/** Alternate iris / diagonal wipe down a list of photo frames (the home timeline rhythm). */
export function photosIn(frames) {
  gsap.utils.toArray(frames).forEach((f, i) => (i % 2 === 0 ? irisIn(f) : wipeIn(f)))
}

function settleImg(frame) {
  const img = frame.querySelector('img')
  if (img) gsap.fromTo(img, { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom 40%', scrub: 0.4 } })
}

/**
 * Words of a lead paragraph sharpen from a blur as it is read (scrubbed). Keyed
 * text only — see riseChars.
 */
export function blurWords(ctx, el, { start = 'top 85%', end = 'bottom 40%' } = {}) {
  if (!el) return
  later(ctx, () => {
    const s = SplitText.create(el, { type: 'words' })
    gsap.fromTo(s.words, { opacity: 0.12, filter: 'blur(5px)' },
      { opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.12, scrollTrigger: { trigger: el, start, end, scrub: true } })
  })
}

/**
 * Count a <Num> (kit) up from 0 once it (or `trigger`) is on screen - figures already
 * in view at load count at once, never sit at 0. Lands on the
 * exact final text, and puts it back if the scene reverts mid-count.
 */
export function countUp(ctx, el, { trigger, start = 'top 95%', duration = 1.8, from = 0 } = {}) {
  if (!el || typeof el._splValue !== 'number' || !el._splFormat) return
  const to = el._splValue, f = el._splFormat, o = { v: from }
  el.textContent = f(from)
  onRevert(ctx, () => { el.textContent = f(to) })
  ScrollTrigger.create({
    trigger: trigger || el, start, once: true,
    onEnter: () => gsap.to(o, { v: to, duration, ease: 'power2.out', onUpdate: () => { el.textContent = f(Math.round(o.v)) }, onComplete: () => { el.textContent = f(to) } }),
  })
}

/**
 * The stacked cards: each card (position:sticky in CSS) swings in as it lands,
 * then sinks back and dims as the next one lands on it. `sentinels[i]` is the
 * zero-height marker placed just before card i (kit <StatStack> renders both).
 */
export function swingStack(cards, sentinels) {
  cards = gsap.utils.toArray(cards); sentinels = gsap.utils.toArray(sentinels)
  cards.forEach((card, i) => {
    if (!sentinels[i]) return
    gsap.from(card, { yPercent: 18, rotation: i % 2 ? 2.5 : -2.5, ease: 'none', scrollTrigger: { trigger: sentinels[i], start: 'top bottom', end: 'top 55%', scrub: 0.5 } })
    // fromTo: tweening filter from "none" starts at brightness(0) - the card went black mid-scroll.
    if (sentinels[i + 1]) {
      gsap.fromTo(card, { scale: 1, filter: 'brightness(1)' }, {
        scale: 0.9, filter: 'brightness(0.8)', ease: 'none', immediateRender: false,
        scrollTrigger: { trigger: sentinels[i + 1], start: 'top bottom', end: 'top 15%', scrub: 0.5 },
      })
    }
  })
}

/**
 * The timeline: the gold-to-azure line draws down, each dot pops as its item
 * crosses the middle, labels slide in, photos alternate iris / wipe.
 * `tl` is a kit <Timeline> root.
 */
export function timelineIn(ctx, tl) {
  if (!tl) return
  tl.classList.add('is-live')
  gsap.fromTo(tl.querySelector('.spl-tl-line i'), { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: tl, start: 'top 55%', end: 'bottom 55%', scrub: 0.3 } })
  const items = [...tl.querySelectorAll('.spl-tl-item')]
  items.forEach((item) => {
    ScrollTrigger.create({
      trigger: item, start: 'top 55%',
      onEnter: () => item.classList.add('is-lit'),
      onLeaveBack: () => item.classList.remove('is-lit'),
      onRefresh: (self) => item.classList.toggle('is-lit', self.progress > 0),
    })
    const label = item.querySelector('.spl-tl-label')
    if (label) gsap.from(label, { x: -40, opacity: 0, duration: 0.8, ease: EASE, clearProps: 'transform,opacity', scrollTrigger: { trigger: item, start: 'top 80%' } })
  })
  photosIn(tl.querySelectorAll('.spl-tl-photo'))
  onRevert(ctx, () => { tl.classList.remove('is-live'); items.forEach((i) => i.classList.remove('is-lit')) })
}

/**
 * The gold band rises from the bottom edge (clip circle from the bottom centre),
 * its title letters float up with the scroll, and an optional giant line slides.
 */
export function goldBand(ctx, band) {
  if (!band) return
  gsap.fromTo(band, { clipPath: 'circle(0% at 50% 100%)' }, { clipPath: 'circle(160% at 50% 100%)', ease: 'none', scrollTrigger: { trigger: band, start: 'top bottom', end: 'top 20%', scrub: 0.5 } })
  const h = band.querySelector('.spl-band-title')
  if (h) riseChars(ctx, h, { stagger: 0.03, scrub: true, scrollTrigger: { trigger: h, start: 'top 85%', end: 'top 35%' } })
  const g = band.querySelector('.spl-band-giant > span')
  if (g) {
    band.classList.add('is-motion')
    onRevert(ctx, () => band.classList.remove('is-motion'))
    gsap.fromTo(g, { x: () => window.innerWidth * 0.12 }, {
      x: () => -Math.max(0, g.offsetWidth - band.clientWidth + window.innerWidth * 0.08), ease: 'none',
      scrollTrigger: { trigger: band, start: 'top bottom', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true },
    })
  }
}

/** Magnetic pill: `pill` leans toward the pointer while it is over `area` (fine pointers only). */
export function magnet(ctx, area, pill, { x = 40, y = 18 } = {}) {
  if (!area || !pill) return
  const xTo = gsap.quickTo(pill, 'x', { duration: 0.5, ease: 'power3' })
  const yTo = gsap.quickTo(pill, 'y', { duration: 0.5, ease: 'power3' })
  const move = (e) => {
    const r = pill.getBoundingClientRect()
    const cx = r.left + r.width / 2 - (gsap.getProperty(pill, 'x') || 0)
    const cy = r.top + r.height / 2 - (gsap.getProperty(pill, 'y') || 0)
    xTo(gsap.utils.clamp(-x, x, (e.clientX - cx) * 0.35))
    yTo(gsap.utils.clamp(-y, y, (e.clientY - cy) * 0.35))
  }
  const leave = () => { xTo(0); yTo(0) }
  area.addEventListener('pointermove', move)
  area.addEventListener('pointerleave', leave)
  onRevert(ctx, () => {
    area.removeEventListener('pointermove', move)
    area.removeEventListener('pointerleave', leave)
    gsap.set(pill, { clearProps: 'transform' })
  })
}

// ── not scroll-bound (called from event handlers; safe without a scene) ──────

/** Diagonal wipe of an incoming slide over the outgoing one. Returns the tween. */
export function wipeSlide(next, onComplete) {
  gsap.killTweensOf([next, next.firstElementChild])
  const img = next.querySelector('img')
  if (img) gsap.fromTo(img, { scale: 1.18 }, { scale: 1, duration: 1.6, ease: EASE, clearProps: 'transform' })
  return gsap.fromTo(next, { clipPath: 'polygon(130% 0%, 130% 0%, 130% 100%, 100% 100%)' },
    { clipPath: 'polygon(0% 0%, 130% 0%, 130% 100%, -30% 100%)', duration: 1.15, ease: 'power3.inOut', clearProps: 'clipPath', onComplete })
}

/** A full-screen layer (the menu, a dialog) opens as a circle growing out of the button at `at` ("x y"). */
export function irisOpen(menu, at) {
  const R = Math.hypot(window.innerWidth, window.innerHeight)
  gsap.fromTo(menu, { clipPath: 'circle(0px at ' + at + ')' }, { clipPath: 'circle(' + R + 'px at ' + at + ')', duration: 0.7, ease: 'power3.inOut', clearProps: 'clipPath' })
  const links = menu.querySelectorAll('.spl-menu-list > li > a')
  if (links.length) gsap.from(links, { yPercent: 110, duration: 0.6, ease: EASE, stagger: 0.04, delay: 0.2, clearProps: 'transform' })
}

/** ...and closes back into it; `done` runs at the end. */
export function irisClose(menu, at, done) {
  // fromTo: the open tween cleared clipPath to "none", and tweening from "none" started at
  // radius 0 - the layer vanished at once instead of closing into the button.
  const R = Math.hypot(window.innerWidth, window.innerHeight)
  gsap.fromTo(menu, { clipPath: 'circle(' + R + 'px at ' + at + ')' },
    { clipPath: 'circle(0px at ' + at + ')', duration: 0.45, ease: 'power3.in', onComplete: () => { gsap.set(menu, { clearProps: 'clipPath' }); done() } })
}

/**
 * ScrollFloat for a text swap outside React (the sticky panel's title): sets the
 * text, splits it, rises the letters, reverts. Returns a kill function.
 */
export function swapChars(el, text) {
  el.textContent = text
  if (!motionOn()) return () => {}
  const s = SplitText.create(el, { type: 'words,chars', mask: 'words', wordsClass: 'spl-sw' })
  const tw = gsap.from(s.chars, {
    yPercent: 118, scaleY: 1.9, opacity: 0, transformOrigin: '50% 0%', duration: 0.75, ease: 'back.out(1.5)', stagger: 0.028,
    onComplete: () => s.revert(),
  })
  return () => { tw.kill(); s.revert() }
}

