'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC — the theme's signature motions, as small helpers on top of
// ../_shared/motion.js. Every helper is safe to call inside a useScene setup:
// it only creates GSAP tweens/ScrollTriggers (reverted with the scene) and, when
// it adds DOM listeners or rewrites text, it RETURNS a cleanup function the
// setup must hand back (collect them with cleanups()).
//
//   useScene(ref, (c, ctx) => {
//     const off = cleanups()
//     off(afterFonts(ctx, () => titleIn(ref.current.querySelector('.cin-h2'))))
//     riseIn(ref.current.querySelectorAll('.cin-card'))
//     if (c.fine) off(magnetField(ref.current))
//     return off.run
//   }, [data])
//
// Targets may be elements, NodeLists, arrays or selector strings (strings are
// scoped to the scene's element by the surrounding gsap context).
// ─────────────────────────────────────────────────────────────────────────────
import { gsap, ScrollTrigger, SplitText, getLenis } from '../_shared/motion.js'

export {
  gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages,
  scrollToY, lockScroll, getLenis, prefersReducedMotion, useSmoothScroll,
} from '../_shared/motion.js'

export const EXPO = 'expo.out'

/** The sticky header's height right now (64 on phones, 72 wider). */
export const headerH = () => {
  const h = typeof document !== 'undefined' && document.querySelector('.cin-hdr')
  return h ? h.offsetHeight : 0
}

const all = (t) => (t ? gsap.utils.toArray(t) : [])
const one = (t) => all(t)[0] || null

/** Grid items grouped into their visual rows (by offsetTop), so each row can enter as it scrolls in. */
export function rowsOf(els) {
  const rows = new Map()
  all(els).forEach((el) => {
    const k = Math.round(el.offsetTop)
    if (!rows.has(k)) rows.set(k, [])
    rows.get(k).push(el)
  })
  return [...rows.values()]
}

/** A bag of cleanup functions: off(fn) collects, off.run() runs them all. */
export function cleanups() {
  const list = []
  const add = (f) => { if (typeof f === 'function') list.push(f); return f }
  add.run = () => { list.splice(0).reverse().forEach((f) => f()) }
  return add
}

/**
 * SplitText into words + chars, each char inside its own mask (so it can rise
 * out of its line). aria 'auto' for visible text; 'none' when an sr-only twin
 * already carries the words and the split copy is aria-hidden.
 */
export function splitChars(target, aria = 'auto') {
  const el = one(target)
  if (!el || !el.textContent.trim()) return null
  return SplitText.create(el, { type: 'words,chars', mask: 'chars', charsClass: 'cin-ch', wordsClass: 'cin-wd', aria })
}

/** Title card: the letters rise out of their own line, once, when it scrolls in. Run it inside afterFonts. */
export function titleIn(target, { scroll = true, delay = 0, start = 'top 88%' } = {}) {
  const s = splitChars(target)
  if (!s) return null
  return gsap.from(s.chars, {
    yPercent: 115, duration: 0.95, ease: EXPO, delay,
    stagger: Math.min(0.018, 0.6 / s.chars.length),
    scrollTrigger: scroll ? { trigger: s.elements[0], start, once: true } : undefined,
    onComplete: () => s.revert(),
  })
}

/** The house entrance: rise 40px and fade in, staggered, once. */
export function riseIn(targets, { trigger, start = 'top 88%', y = 40, x = 0, stagger = 0.1, delay = 0, duration = 1 } = {}) {
  const list = all(targets)
  if (!list.length) return null
  return gsap.from(list, {
    y, x, opacity: 0, duration, ease: EXPO, stagger, delay, clearProps: 'transform,opacity',
    scrollTrigger: trigger === false ? undefined : { trigger: trigger ? one(trigger) : list[0], start, once: true },
  })
}

/** Tiles wipe open from their bottom edge, then their contents rise. */
export function wipeIn(targets, { trigger, start = 'top 85%', radius = 24, stagger = 0.12 } = {}) {
  const list = all(targets)
  if (!list.length) return
  const r = typeof radius === 'number' ? radius + 'px' : radius
  const st = { trigger: trigger ? one(trigger) : list[0], start, once: true }
  gsap.fromTo(list, { clipPath: 'inset(100% 0% 0% 0% round ' + r + ')' }, {
    clipPath: 'inset(0% 0% 0% 0% round ' + r + ')', duration: 1.2, ease: EXPO, stagger, clearProps: 'clipPath', scrollTrigger: st,
  })
  const kids = list.flatMap((el) => [...el.children])
  if (kids.length) {
    gsap.from(kids, { y: 40, opacity: 0, duration: 1, ease: EXPO, stagger: 0.06, delay: 0.15, clearProps: 'transform,opacity', scrollTrigger: { ...st } })
  }
}

/** Cards dealt onto the table: they swing in from below in 3D, one after another. */
export function dealIn(targets, { trigger, start = 'top 82%' } = {}) {
  const list = all(targets)
  if (!list.length) return null
  return gsap.from(list, {
    y: 90, rotationY: -26, rotationX: 10, opacity: 0, transformPerspective: 1000, transformOrigin: '50% 100%',
    duration: 1.2, ease: EXPO, stagger: 0.1, clearProps: 'transform,transformOrigin,opacity',
    scrollTrigger: { trigger: trigger ? one(trigger) : list[0], start, once: true },
  })
}

/**
 * Words light up one by one as the passage scrolls through (scrubbed). Use on
 * an aria-hidden copy with an sr-only twin (aria 'none'), keyed on its text.
 */
export function lightWords(target, { start = 'top 80%', end = 'bottom 45%', aria = 'none' } = {}) {
  const el = one(target)
  if (!el || !el.textContent.trim()) return null
  const s = SplitText.create(el, { type: 'words', wordsClass: 'cin-lw', aria })
  return gsap.fromTo(s.words, { opacity: 0.16 }, {
    opacity: 1, ease: 'none', stagger: 0.12, scrollTrigger: { trigger: el, start, end, scrub: true },
  })
}

/**
 * Count a figure up from 0 once it scrolls in. `format(n)` prints it (use
 * formatMoney / groupInt so the club's currency and digit grouping hold).
 * Rewrites textContent, so the element must be keyed on its value and hold a
 * single string child. Returns a cleanup that restores the final text.
 */
export function countUp(target, value, format = (n) => Math.round(n).toLocaleString(), { trigger, start = 'top 90%', duration = 1.8 } = {}) {
  const el = one(target)
  const end = Number(value) || 0
  if (!el || end <= 0) return null
  const o = { v: 0 }
  el.textContent = format(0)
  gsap.to(o, {
    v: end, duration, ease: 'power3.out',
    scrollTrigger: { trigger: trigger ? one(trigger) : el, start, once: true },
    onUpdate: () => { el.textContent = format(Math.round(o.v)) },
    onComplete: () => { el.textContent = format(end) },
  })
  return () => { el.textContent = format(end) }
}

/**
 * Parallax INSIDE a frame: the picture drifts against its overflow-hidden
 * parent. Vertical by default; pass containerAnimation (a reel's tween) for the
 * horizontal version. The image is scaled up just enough to never show an edge.
 */
export function parallax(targets, { amount = 8, trigger, containerAnimation } = {}) {
  all(targets).forEach((img) => {
    const horizontal = !!containerAnimation
    const key = horizontal ? 'xPercent' : 'yPercent'
    gsap.fromTo(img, { [key]: -amount, scale: 1 + amount / 50 }, {
      [key]: amount, ease: 'none',
      scrollTrigger: {
        trigger: trigger ? one(trigger) : img.parentElement,
        start: horizontal ? 'left right' : 'top bottom',
        end: horizontal ? 'right left' : 'bottom top',
        scrub: true, containerAnimation,
      },
    })
  })
}

/**
 * THE FILM REEL. Pins `section` under the header and runs `track` sideways as
 * the page scrolls, with parallax inside every frame and each card coming up to
 * full light as it enters. Wide + motion only (phones keep the native
 * scroll-snap row the CSS gives .cin-track). Keyboard focus inside the track
 * scrolls the page to where that card is in frame.
 *
 * The pinned `section` must be the only child of a plain wrapper <div> its
 * component always renders (GSAP wraps it in a pin-spacer). Returns a cleanup.
 */
export function reel({ section, stage, track, bar, cards = '.cin-card', media = '.cin-card__media img', refreshPriority = 1 }) {
  if (!section || !stage || !track) return null
  section.classList.add('is-reel')
  const dist = () => {
    const cs = getComputedStyle(stage)
    const inner = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    return Math.max(0, track.scrollWidth - inner)
  }
  const tween = gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: () => 'top ' + headerH() + 'px',
      end: () => '+=' + Math.max(1, dist()),
      pin: true, scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority,
      onUpdate: bar ? (self) => gsap.set(bar, { scaleX: self.progress }) : undefined,
    },
  })
  if (bar) gsap.set(bar, { scaleX: 0, transformOrigin: '0 50%' })
  const list = [...track.querySelectorAll(cards)]
  list.forEach((card) => {
    const img = card.querySelector(media)
    if (img) {
      gsap.fromTo(img, { xPercent: -6 }, {
        xPercent: 6, ease: 'none',
        scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
      })
    }
    gsap.fromTo(card, { opacity: 0.35, scale: 0.9 }, {
      opacity: 1, scale: 1, ease: 'none',
      scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left 98%', end: 'left 62%', scrub: true },
    })
  })
  // A focused card can sit off-screen in the translated track, where the
  // browser cannot scroll it into view. Move the page to the point in the pin
  // where that card is in frame.
  const onFocus = (e) => {
    const card = e.target.closest && e.target.closest(cards)
    const st = tween.scrollTrigger
    if (!card || !st) return
    const d = dist()
    const p = d ? Math.min(1, Math.max(0, (card.offsetLeft - track.offsetLeft) / d)) : 0
    const y = st.start + (st.end - st.start) * p
    const lenis = getLenis()
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y)
  }
  track.addEventListener('focusin', onFocus)
  return () => {
    track.removeEventListener('focusin', onFocus)
    section.classList.remove('is-reel')
  }
}

/** The projector opens: a slit of light widens to the full frame. */
export function projectorOpen(target, { duration = 1.4, delay = 0 } = {}) {
  const el = one(target)
  if (!el) return null
  return gsap.fromTo(el, { clipPath: 'inset(49.5% 0% 49.5% 0%)' }, {
    clipPath: 'inset(0% 0% 0% 0%)', duration, delay, ease: 'expo.inOut', clearProps: 'clipPath',
  })
}

/** A framed panel opens out to full bleed as it scrolls up the screen (scrubbed). */
export function panelOpen(target, { wide = true, start = 'top bottom', end = 'top 10%' } = {}) {
  const el = one(target)
  if (!el) return null
  return gsap.fromTo(el, { clipPath: wide ? 'inset(8% 6% 8% 6% round 40px)' : 'inset(3% 4% 3% 4% round 24px)' }, {
    clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', scrollTrigger: { trigger: el, start, end, scrub: true },
  })
}

/**
 * Letters float up into place one by one as the line scrolls in (scrubbed).
 * The END must be reachable: never use it on a line within half a screen of
 * the page bottom, or the last letters stay below their line.
 */
export function lettersFloat(target, { start = 'top 95%', end = 'top 55%', aria = 'none' } = {}) {
  const s = splitChars(target, aria)
  if (!s) return null
  return gsap.fromTo(s.chars, { yPercent: 110 }, {
    yPercent: 0, ease: 'none', stagger: 0.08, scrollTrigger: { trigger: s.elements[0], start, end, scrub: true },
  })
}

/**
 * The inner-page opening (used by <PageHero>): the backdrop opens like a
 * projector, the beam draws out from the centre, the title's letters rise and
 * the crumbs, eyebrow, lede and meta follow.
 */
export function pageHeroIn(root) {
  if (!root) return null
  const q = gsap.utils.selector(root)
  const tl = gsap.timeline({ delay: 0.05 })
  const back = q('.cin-phero__back')[0]
  if (back) tl.add(projectorOpen(back, { duration: 1.2 }), 0)
  const beam = q('.cin-phero__beam')
  if (beam.length) tl.fromTo(beam, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 1.1, ease: 'expo.inOut', clearProps: 'transform,opacity' }, 0)
  const s = splitChars(q('.cin-phero__title')[0])
  if (s) {
    tl.from(s.chars, {
      yPercent: 118, duration: 1.1, ease: EXPO, stagger: Math.min(0.035, 0.7 / s.chars.length), onComplete: () => s.revert(),
    }, 0.2)
  }
  const rest = q('.cin-crumbs, .cin-phero__eyebrow, .cin-phero__lede, .cin-phero__meta')
  if (rest.length) tl.from(rest, { y: 22, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, clearProps: 'transform,opacity' }, 0.4)
  return tl
}

/**
 * Magnet buttons: anything with .cin-magnet inside `root` leans toward the
 * pointer and springs back. The shell runs this once for the whole site
 * (fine pointer only), so pages just add the class. Returns a cleanup.
 */
export function magnetField(root, { selector = '.cin-magnet' } = {}) {
  if (!root) return null
  const tos = new Map()
  let cur = null
  const get = (b) => {
    let m = tos.get(b)
    if (!m) {
      m = {
        x: gsap.quickTo(b, 'x', { duration: 0.7, ease: 'elastic.out(1, 0.4)' }),
        y: gsap.quickTo(b, 'y', { duration: 0.7, ease: 'elastic.out(1, 0.4)' }),
      }
      tos.set(b, m)
    }
    return m
  }
  const release = () => { if (cur) { const m = get(cur); m.x(0); m.y(0); cur = null } }
  const move = (e) => {
    const b = e.target.closest ? e.target.closest(selector) : null
    if (cur && cur !== b) release()
    if (!b || !root.contains(b)) return
    cur = b
    const r = b.getBoundingClientRect(), m = get(b)
    m.x((e.clientX - r.left - r.width / 2) * 0.3)
    m.y((e.clientY - r.top - r.height / 2) * 0.4)
  }
  root.addEventListener('pointermove', move)
  root.addEventListener('pointerleave', release)
  return () => {
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerleave', release)
    tos.forEach((m, b) => { gsap.killTweensOf(b); gsap.set(b, { clearProps: 'transform' }) })
    tos.clear()
  }
}

/**
 * The sliding gold bar under the desktop nav: rests under the current page,
 * glides to whatever the pointer or focus is on. Returns a cleanup.
 */
export function navIndicator(nav, { bar = '.cin-nav__ind', items = '.cin-nav__top' } = {}) {
  if (!nav) return null
  const ind = nav.querySelector(bar)
  const links = [...nav.querySelectorAll(items)]
  if (!ind || !links.length) return null
  const home = () => links.find((a) => a.getAttribute('aria-current') === 'page' || a.classList.contains('is-current')) || null
  nav.classList.add('has-ind')
  const place = (a, now) => {
    if (!a || !a.offsetWidth) { gsap.to(ind, { opacity: 0, duration: 0.3, overwrite: true }); return }
    const nr = nav.getBoundingClientRect(), r = a.getBoundingClientRect(), pad = 12
    const to = { x: r.left - nr.left + pad, scaleX: Math.max(1, r.width - pad * 2), opacity: 1 }
    if (now) gsap.set(ind, to); else gsap.to(ind, { ...to, duration: 0.6, ease: EXPO, overwrite: true })
  }
  place(home(), true)
  const onEnter = (e) => place(e.currentTarget)
  const onLeave = () => place(home())
  const onRefresh = () => place(home(), true)
  links.forEach((a) => { a.addEventListener('pointerenter', onEnter); a.addEventListener('focus', onEnter); a.addEventListener('blur', onLeave) })
  nav.addEventListener('pointerleave', onLeave)
  ScrollTrigger.addEventListener('refresh', onRefresh)   // fires on resize and after web fonts land
  return () => {
    links.forEach((a) => { a.removeEventListener('pointerenter', onEnter); a.removeEventListener('focus', onEnter); a.removeEventListener('blur', onLeave) })
    nav.removeEventListener('pointerleave', onLeave)
    ScrollTrigger.removeEventListener('refresh', onRefresh)
    nav.classList.remove('has-ind')
  }
}
