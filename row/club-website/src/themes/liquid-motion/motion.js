'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION — the theme's signature motions, as small helpers on top of
// _shared/motion.js. Every helper is meant to be called INSIDE a useScene()
// setup (or usePageMotion): it builds its tweens/ScrollTriggers in the active
// gsap context and registers its own cleanup there (onRevert), so a page never
// has to return anything. Nothing here sets a hidden state in CSS: with reduced
// motion the setup never runs and all content stays visible.
//
// Target arguments accept a selector (scoped to the scene's root by useScene),
// an element, or a list of elements.
// ─────────────────────────────────────────────────────────────────────────────
import {
  gsap, ScrollTrigger, useScene, useRefreshOnImages, afterFonts, refreshSoon, scrollToY, lockScroll,
  getLenis, useSmoothScroll, prefersReducedMotion,
} from '../_shared/motion.js'

export {
  gsap, ScrollTrigger, useScene, useRefreshOnImages, afterFonts, refreshSoon, scrollToY, lockScroll,
  getLenis, useSmoothScroll, prefersReducedMotion,
}

const clamp = (a, b, v) => Math.min(b, Math.max(a, v))
const all = (t) => gsap.utils.toArray(t)

/** Tweens started later (in a ScrollTrigger callback) still belong to the scene that set them up. */
function later() {
  const ctx = gsap.core.context()
  return (fn) => (ctx ? ctx.add(fn) : fn())
}

/** Run `fn` when the active scene reverts (unmount, deps change, media change). */
export function onRevert(fn) {
  const ctx = gsap.core.context()
  if (ctx) ctx.add(() => fn)
  return fn
}

// ── one scroll-velocity ticker for the whole theme ──────────────────────────
// Band-edge bulge, the header progress and the WebGL wobble all
// read the same smoothed velocity. v is -1..1 (sign = direction).
const subs = new Set()
let vel = 0, lastY = 0, dirSign = 1, ticking = false
const state = { v: 0, av: 0, dir: 1, y: 0, time: 0, f: 1 }
function tick(time, dtMs) {
  const y = window.scrollY
  const dt = Math.max(dtMs || 16.667, 1)
  const raw = clamp(-400, 400, (y - lastY) / dt * 16.667)
  lastY = y
  vel += (raw - vel) * 0.14
  if (Math.abs(vel) < 0.01) vel = 0
  if (Math.abs(vel) > 0.6) dirSign = vel > 0 ? 1 : -1
  state.v = clamp(-1, 1, vel / 40)
  state.av = Math.abs(state.v)
  state.dir = dirSign
  state.y = y
  state.time = time
  state.f = Math.min(dt / 16.667, 4)
  subs.forEach((fn) => fn(state))
}
/** Subscribe to the per-frame velocity state; returns an unsubscribe function. */
export function onScrollVelocity(fn) {
  subs.add(fn)
  if (!ticking) { ticking = true; lastY = window.scrollY; vel = 0; gsap.ticker.add(tick) }
  return () => {
    subs.delete(fn)
    if (!subs.size && ticking) { ticking = false; gsap.ticker.remove(tick) }
  }
}

// ── WebGL (desktop only; ogl is loaded on demand so phones never fetch it) ──
/**
 * `use(G)` receives the shared GL manager ({ addCard }) once ogl has
 * loaded and a WebGL context exists; it may return a cleanup. Nothing happens on
 * machines without WebGL - the DOM images simply stay in charge.
 */
export function withGL(use) {
  let dead = false, mod = null, G = null, off = null
  import('./gl.js').then((m) => {
    if (dead) return
    mod = m
    G = m.acquireGL()
    if (!G) return
    off = use(G)
  }).catch(() => {})
  onRevert(() => {
    dead = true
    if (typeof off === 'function') off()
    if (G && mod) mod.releaseGL()
  })
}

// ── text ─────────────────────────────────────────────────────────────────────
/**
 * Headline chars rise and un-fold (rotateX) - the hero-name entrance. Works on
 * any element rendered with <Chars> (it finds .liq-ch inside); plain text just
 * fades up. Pass { tl, at } to add it to a timeline.
 */
export function titleIn(target, { delay = 0, tl, at = 0 } = {}) {
  const el = all(target)[0]
  if (!el) return null
  const chars = el.querySelectorAll('.liq-ch')
  let from, to
  if (chars.length) {
    from = { yPercent: 70, rotateX: -75, opacity: 0, transformPerspective: 700, transformOrigin: '50% 100%' }
    to = { yPercent: 0, rotateX: 0, opacity: 1, duration: 1.3, stagger: Math.min(0.035, 0.9 / chars.length), ease: 'expo.out', clearProps: 'transform,opacity,transformOrigin' }
  } else {
    from = { y: 30, opacity: 0 }
    to = { y: 0, opacity: 1, duration: 1, ease: 'power3.out', clearProps: 'transform,opacity' }
  }
  const list = chars.length ? chars : [el]
  if (tl) return tl.fromTo(list, from, to, at)
  return gsap.fromTo(list, from, { ...to, delay })
}

/** Masked chars (<Chars mask>) rise out of their line once, when scrolled to. */
export function charsRise(targets) {
  all(targets).forEach((el) => {
    const chars = el.querySelectorAll('.liq-ch')
    if (!chars.length) return
    const run = later()
    gsap.set(chars, { yPercent: 125 })
    ScrollTrigger.create({
      trigger: el, start: 'top 96%', end: 'max', once: true,
      onEnter: () => run(() => gsap.to(chars, { yPercent: 0, duration: 1.4, stagger: Math.min(0.05, 1 / chars.length), ease: 'expo.out', clearProps: 'transform' })),
    })
  })
}

/** Words (<Words>) ink in from 14% opacity as the paragraph crosses the screen (scrubbed). */
export function inkWords(targets) {
  all(targets).forEach((el) => {
    const w = el.querySelectorAll('.liq-w')
    if (!w.length) return
    gsap.fromTo(w, { opacity: 0.14 }, {
      opacity: 1, stagger: 0.06, ease: 'none',
      scrollTrigger: { trigger: el, start: 'clamp(top 82%)', end: 'clamp(bottom 42%)', scrub: true },
    })
  })
}

/** Outline -> ink fill (<OutlineFill>): the name fills left to right as it crosses the screen. Keep to <= ~30 per page. */
export function fillIn(targets) {
  all(targets).forEach((el) => {
    const ink = el.querySelector('.liq-fill__ink')
    if (!ink) return
    gsap.fromTo(ink, { clipPath: 'inset(0% 100% 0% 0%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
      scrollTrigger: { trigger: el, start: 'clamp(top 86%)', end: 'clamp(top 38%)', scrub: true },
    })
  })
}

// ── reveals ──────────────────────────────────────────────────────────────────
// Elements that already played their entrance are not hidden again when a
// scene re-runs because its data changed (that read as a flicker).
const played = new WeakSet()

/** The generic fade-up: batched, once per element. Put `liq-rv` on anything and usePageMotion does this. */
export function revealBatch(targets, { y = 36, start = 'top 90%', stagger = 0.08 } = {}) {
  const els = all(targets).filter((el) => !played.has(el))
  if (!els.length) return
  const run = later()
  gsap.set(els, { y, opacity: 0 })
  ScrollTrigger.batch(els, {
    start, end: 'max', once: true,
    onEnter: (batch) => {
      batch.forEach((el) => played.add(el))
      run(() => gsap.to(batch, { y: 0, opacity: 1, duration: 1.1, stagger, ease: 'power3.out', clearProps: 'transform,opacity', overwrite: true }))
    },
  })
}

/** Hairline rules (`liq-line`) draw left to right, batched. */
export function drawLines(targets) {
  const els = all(targets).filter((el) => !played.has(el))
  if (!els.length) return
  const run = later()
  gsap.set(els, { scaleX: 0, transformOrigin: '0% 50%' })
  ScrollTrigger.batch(els, {
    start: 'top 94%', end: 'max', once: true,
    onEnter: (batch) => {
      batch.forEach((el) => played.add(el))
      run(() => gsap.to(batch, { scaleX: 1, duration: 1.3, stagger: 0.06, ease: 'expo.out', clearProps: 'transform' }))
    },
  })
}

/** <Odometer> digits roll up from 0, scrubbed with the scroll (skips `live` ones, which roll on change). */
export function rollNumbers(targets, { scrub = 1 } = {}) {
  all(targets).forEach((odo) => {
    if (odo.classList.contains('liq-odo--live')) return
    const strips = odo.querySelectorAll('.liq-odo__strip')
    if (!strips.length) return
    const top = (i, el) => -Number(el.getAttribute('data-to')) + 'em'
    // already on screen when the scene starts (a date plate, a hero card): a scrub would sit
    // part-way ("00 Aug") until the visitor scrolls - roll it once on a timer instead
    if (odo.getBoundingClientRect().top < window.innerHeight * 0.92) {
      if (played.has(odo)) return // a scene re-run (search typing) must not replay it
      played.add(odo)
      gsap.fromTo(strips, { top: '0em' }, { top, duration: 1.6, delay: 0.35, stagger: 0.05, ease: 'power3.out' })
      return
    }
    // further down: one timed roll as it comes into view (client, 2026-10-06) - scrubbed with the scrollbar it only
    // moved while scrolling and stopped half-turned when the visitor stopped
    gsap.fromTo(strips, { top: '0em' }, {
      top, duration: 1.6, stagger: 0.05, ease: 'power3.out',
      scrollTrigger: { trigger: odo, start: 'top 88%', once: true },
    })
  })
}

/** Scrubbed vertical drift (yPercent `from` -> `to`) while the element crosses the screen. */
export function parallax(targets, { from = 12, to = -12, trigger } = {}) {
  all(targets).forEach((el) => gsap.fromTo(el, { yPercent: from }, {
    yPercent: to, ease: 'none',
    scrollTrigger: { trigger: trigger || el, start: 'top bottom', end: 'bottom top', scrub: true },
  }))
}

// ── the page hero entrance (used by kit's <PageHero>; runs once per mount) ───
export function heroIn(root) {
  const q = gsap.utils.selector(root)
  const tl = gsap.timeline({ delay: 0.1 })
  const fade = (els, at, y = 16, d = 0.9) => {
    if (els.length) tl.fromTo(els, { y, opacity: 0 }, { y: 0, opacity: 1, duration: d, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' }, at)
  }
  fade(q('.liq-ph__top > *'), 0)
  fade(q('.liq-ph__pre'), 0.05, 26, 1)
  titleIn(q('.liq-ph__name'), { tl, at: 0.1 })
  fade(q('.liq-ph__lede, .liq-ph__slot'), 0.45, 24, 1)
  const media = q('.liq-ph__media')
  if (media.length) {
    const r = parseFloat(getComputedStyle(media[0]).borderTopLeftRadius) || 0
    tl.fromTo(media, { clipPath: 'inset(100% 0% 0% 0% round ' + r + 'px)' }, { clipPath: 'inset(0% 0% 0% 0% round ' + r + 'px)', duration: 1.6, ease: 'power3.inOut', clearProps: 'clipPath' }, 0.2)
  }
  // (the ghost's drift is PageHero's own scene: it must rebuild when a data-driven ghost arrives)
  return tl
}

// ── the liquid photo ─────────────────────────────────────────────────────────
/**
 * Every <Media> photo: a clip-path wipe from the bottom with the picture
 * settling from 1.2x (scrubbed on desktop, a timed batch on phones or long
 * lists), a pointer ripple on hover, and - on wide mouse screens with <= 12
 * photos - the WebGL plane that paints the same reveal with a liquid edge,
 * chromatic wobble on scroll velocity and a hover ripple. If a photo refuses a
 * cross-origin texture read, that photo simply stays a DOM image.
 */
export function liquidMedia(targets, c, { gl = true, max = 12 } = {}) {
  const nodes = all(targets).filter((el) => el.querySelector('img'))
  if (!nodes.length) return
  const cards = nodes.map((el) => ({ el, img: el.querySelector('img'), gl: false, s: { r: 0, hover: 0, mx: 0.5, my: 0.5, tx: 0.5, ty: 0.5 } }))
  const apply = (cd) => {
    if (cd.gl) return
    const r = cd.s.r
    cd.el.style.clipPath = r >= 1 ? '' : 'inset(' + ((1 - r) * 100).toFixed(2) + '% 0% 0% 0%)'
    cd.img.style.transform = 'scale(' + (1.2 - 0.2 * r).toFixed(4) + ')'
  }
  const scrubbed = c.wide && cards.length <= 24
  cards.forEach(apply)
  if (scrubbed) {
    cards.forEach((cd) => gsap.to(cd.s, {
      r: 1, ease: 'power1.inOut', onUpdate: () => apply(cd),
      scrollTrigger: { trigger: cd.el, start: 'clamp(top 95%)', end: 'clamp(top 38%)', scrub: 0.8 },
    }))
  } else {
    const run = later()
    ScrollTrigger.batch(cards.map((cd) => cd.el), {
      start: 'top 92%', end: 'max', once: true,
      onEnter: (els) => run(() => els.forEach((el, i) => {
        const cd = cards.find((x) => x.el === el)
        gsap.to(cd.s, { r: 1, duration: 1.2, delay: i * 0.08, ease: 'power3.inOut', onUpdate: () => apply(cd) })
      })),
    })
  }
  const offs = []
  if (c.fine) {
    cards.filter((cd) => !cd.el.classList.contains('liq-media--nohover')).forEach((cd) => {
      const enter = () => gsap.to(cd.s, { hover: 1, duration: 0.7, ease: 'power2.out', overwrite: 'auto' })
      const leave = () => gsap.to(cd.s, { hover: 0, duration: 0.9, ease: 'power2.out', overwrite: 'auto' })
      const move = (e) => { const r = cd.el.getBoundingClientRect(); cd.s.tx = (e.clientX - r.left) / r.width; cd.s.ty = 1 - (e.clientY - r.top) / r.height }
      cd.el.addEventListener('pointerenter', enter)
      cd.el.addEventListener('pointerleave', leave)
      cd.el.addEventListener('pointermove', move)
      offs.push(() => { cd.el.removeEventListener('pointerenter', enter); cd.el.removeEventListener('pointerleave', leave); cd.el.removeEventListener('pointermove', move) })
    })
  }
  // GL first: cleanups run in registration order, and the planes must hand the
  // DOM images back before the style reset below wipes them clean.
  const glCards = cards.filter((cd) => !cd.el.classList.contains('liq-media--whole'))
  if (gl && c.wide && c.fine && glCards.length && cards.length <= max) {
    withGL((G) => {
      const removers = glCards.map((cd) => G.addCard({
        el: cd.el, img: cd.img, s: cd.s,
        onGL: (on) => {
          cd.gl = on
          cd.el.classList.toggle('liq-is-gl', on)
          if (on) { cd.el.style.clipPath = ''; cd.img.style.transform = '' } else apply(cd)
        },
      }))
      return () => removers.forEach((r) => r())
    })
  }
  onRevert(() => {
    offs.forEach((f) => f())
    cards.forEach((cd) => { cd.gl = false; cd.el.classList.remove('liq-is-gl'); cd.el.style.clipPath = ''; cd.img.style.transform = '' })
  })
}

// ── the standard page layer ──────────────────────────────────────────────────
/**
 * Everything a page gets for free from the kit's class hooks:
 *   .liq-rv reveal, .liq-line rules, <Odometer> roll, <OutlineFill> fill,
 *   <Words className="liq-ink"> ink-in, .liq-rise masked chars,
 *   <Media> liquid photos (not the page hero's), .liq-par drift.
 */
export function pageMotion(c) {
  revealBatch('.liq-rv')
  drawLines('.liq-line')
  rollNumbers('.liq-odo')
  fillIn('.liq-fill')
  inkWords('.liq-ink')
  charsRise('.liq-rise')
  parallax('.liq-par')
  liquidMedia('.liq-media:not(.liq-ph__media):not(.liq-media--still)', c)
}

/**
 * const ref = useRef(null); usePageMotion(ref, [data])  - on the page's root.
 * Pass whatever changes the DOM (loaded data, filters that re-render lists).
 */
export function usePageMotion(ref, deps = []) {
  useScene(ref, (c) => { pageMotion(c) }, deps)
  useRefreshOnImages(ref, deps)
}

// ── shell (Site.jsx) ─────────────────────────────────────────────────────────
/** Band edges bulge with scroll velocity, the header progress bar, the cursor bubble. */
export function shellMotion(prog, c) {
  const root = document.documentElement
  root.classList.add('liq-motion')

  // liquid band edges - one write per change, whichever page is showing
  const flat = 'M0 100 Q50 100 100 100 Z'
  let b = 0, last = -1
  // header progress
  const setProg = prog ? gsap.quickSetter(prog, 'scaleX') : null
  let max = 1
  const measure = () => { max = Math.max(1, root.scrollHeight - window.innerHeight) }
  measure()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
  if (ro) ro.observe(document.body)
  let lastP = -1
  const off = onScrollVelocity(({ av, y }) => {
    const pr = clamp(0, 1, y / max)
    if (setProg && Math.abs(pr - lastP) > 0.0005) { lastP = pr; setProg(pr) }
    b += (Math.min(46, av * 70) - b) * 0.15
    if (Math.abs(b - last) > 0.05) {
      last = b
      const d = 'M0 100 Q50 ' + (100 - 2 * b).toFixed(2) + ' 100 100 Z'
      document.querySelectorAll('.liq-edge path').forEach((p) => p.setAttribute('d', d))
    }
  })

  // difference-blend cursor bubble (mouse only)
  let cur = null
  const offs = []
  if (c.fine) {
    cur = document.createElement('div')
    cur.className = 'liq-cursor'
    cur.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cur)
    gsap.set(cur, { xPercent: -50, yPercent: -50, scale: 0 })
    const xTo = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3' })
    const yTo = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3' })
    let size = -1, seen = false
    const setSize = (s) => { if (s !== size) { size = s; gsap.to(cur, { scale: s, duration: 0.45, ease: 'power3.out', overwrite: 'auto' }) } }
    const move = (e) => {
      if (e.pointerType !== 'mouse') return
      if (!seen) { seen = true; gsap.set(cur, { x: e.clientX, y: e.clientY }) }
      xTo(e.clientX); yTo(e.clientY)
    }
    const over = (e) => {
      if (e.pointerType !== 'mouse') return
      const t = e.target
      // no bubble over the banners or project photos: they show as they are (client, 2026-09-28/29)
      setSize(!t.closest ? 0.3 : t.closest('.liq-stage, .liq-media--nohover, .liq-pd-cover, .liq-pd-hit') ? 0 : t.closest('.liq-media') ? 2.2 : t.closest('a,button,select,label,input,summary') ? 1 : 0.3)
    }
    const leave = () => setSize(0)
    window.addEventListener('pointermove', move)
    document.addEventListener('pointerover', over)
    root.addEventListener('pointerleave', leave)
    offs.push(() => { window.removeEventListener('pointermove', move); document.removeEventListener('pointerover', over); root.removeEventListener('pointerleave', leave) })
  }

  onRevert(() => {
    off()
    if (ro) ro.disconnect()
    offs.forEach((f) => f())
    if (cur) cur.remove()
    if (prog) gsap.set(prog, { clearProps: 'transform' })
    document.querySelectorAll('.liq-edge path').forEach((p) => p.setAttribute('d', flat))
    root.classList.remove('liq-motion')
  })
}
