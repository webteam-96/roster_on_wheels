'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY — the theme's signature motions, built on _shared/motion.js.
//
// Everything here is SAFE TO CALL INSIDE A useScene SETUP (or an afterFonts
// callback inside one): every tween/ScrollTrigger/SplitText joins the running
// gsap context and is reverted with it, and nothing hides content in CSS — the
// hidden start states exist only while motion is allowed.
//
// Also home of the ridge geometry (one deterministic hill line reused by every
// silhouette on the site), so kit.jsx and the home scene draw the same hills.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import {
  gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages,
  scrollToY, lockScroll, getLenis, useSmoothScroll, prefersReducedMotion, MOTION_OK, FINE_POINTER, WIDE,
} from '../_shared/motion.js'

export {
  gsap, ScrollTrigger, SplitText, useScene, afterFonts, refreshSoon, useRefreshOnImages,
  scrollToY, lockScroll, getLenis, useSmoothScroll, prefersReducedMotion, MOTION_OK, FINE_POINTER, WIDE,
}

// ── ridges ───────────────────────────────────────────────────────────────────
// fill/rim may be any CSS colour, including var(--hj-…) (applied as a style).
export const RIDGE = {
  heroFar:   { base: 40, amp: 26, seed: 1.7, fill: 'rgba(212,19,103,.42)', rim: 'rgba(255,214,160,.55)' },
  heroMid:   { base: 46, amp: 24, seed: 4.1, fill: 'rgba(212,19,103,.74)', rim: 'rgba(255,214,160,.42)' },
  heroFront: { base: 52, amp: 30, seed: 6.3, fill: 'var(--hj-first, var(--hj-cran))', rim: 'rgba(255,214,160,.5)' },
  far:       { base: 36, amp: 24, seed: 2.2, fill: 'rgba(20,26,51,.13)', rim: 'rgba(255,240,215,.32)' },
  mid:       { base: 48, amp: 24, seed: 5.3, fill: 'rgba(20,26,51,.24)', rim: 'rgba(255,240,215,.22)' },
  near:      { base: 46, amp: 30, seed: 8.1, fill: 'rgba(20,26,51,.4)', rim: 'rgba(255,240,215,.16)' },
  pnFar:     { base: 34, amp: 26, seed: 3.3, fill: 'rgba(20,26,51,.16)' },
  pnFront:   { base: 58, amp: 24, seed: 7.4, fill: 'var(--hj-next)', rim: 'rgba(255,255,255,.28)' },
  ground:    { base: 56, amp: 22, seed: 6.8, fill: 'var(--hj-ground)', rim: 'rgba(255,255,255,.3)' },
  foot:      { base: 55, amp: 30, seed: 9.2, fill: 'var(--hj-night)' },
}

/** Height of ridge `o` at x px: 0-100 from the top of its box (where a figure's foot stands). */
export const ridgeY = (x, o) =>
  o.base + o.amp * (0.55 * Math.sin(x / 380 + o.seed) + 0.3 * Math.sin(x / 157 + o.seed * 2.1) + 0.15 * Math.sin(x / 67 + o.seed * 4.7))

/** Area + rim paths of one ridge `w` px wide, in a 0-100 tall viewBox. */
export function ridgeD(w, o) {
  const step = Math.max(10, Math.round(w / 600))
  const pts = []
  let last = 0
  for (let x = 0; x <= w + step; x += step) {
    const y = ridgeY(x, o)
    pts.push(x + ' ' + y.toFixed(1))
    last = x
  }
  return { area: 'M0 100 L' + pts.join(' L') + ' L' + last + ' 100Z', line: 'M' + pts.join(' L') }
}

/** Imperative draw into an existing <svg> (the home track's long drifting hills). `px` also sets its CSS width. */
export function drawRidge(svg, w, o, px) {
  if (!svg || !(w > 0)) return
  const d = ridgeD(w, o)
  svg.setAttribute('viewBox', '0 0 ' + w + ' 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('focusable', 'false')
  if (px) svg.style.width = w + 'px'
  svg.innerHTML = '<path d="' + d.area + '" style="fill:' + o.fill + '"/>' +
    (o.rim ? '<path d="' + d.line + '" fill="none" style="stroke:' + o.rim + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' : '')
}

// ── small utilities ──────────────────────────────────────────────────────────
/** Live boolean for a media query (e.g. the home journey's min-height gate). */
export function useMedia(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  const [m, setM] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}

/** The sticky header's real height — pin starts are "top " + headerH(). */
export const headerH = () => {
  const h = document.querySelector('.hj-hdr')
  return h ? h.offsetHeight : 0
}

/** Scroll so `el`'s top sits just under the header (Lenis-aware). */
export function scrollToEl(el, immediate = false) {
  if (!el) return
  scrollToY(Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerH()), immediate)
}

/** Register `fn` to run when the current scene reverts (call during setup only). */
export const onRevert = (fn) => gsap.context(() => fn)

/**
 * SplitText into words+chars (words keep lines breaking between words).
 * `aria`: 'auto' (label on the element) or 'none' when an sr-only copy exists.
 * NEVER split an element whose text React may change without remounting it —
 * the revert restores the OLD text. Give such elements key={text}.
 */
export function split(el, aria = 'auto') {
  if (!el || el.length === 0) return null
  return SplitText.create(el, { type: 'words,chars', charsClass: 'hj-ch', wordsClass: 'hj-wd', aria })
}

// ── entrances ────────────────────────────────────────────────────────────────
/**
 * THE theme's title move (vertical pages): characters rise out of a skew,
 * scrubbed by scroll. Call after fonts: afterFonts(ctx, () => titleIn(h2)).
 */
export function titleIn(el, { trigger, start = 'top 94%', end = 'top 64%', scrub = true } = {}) {
  if (!el) return null
  const s = split(el)
  return gsap.fromTo(s ? s.chars : el,
    { yPercent: 110, skewY: 12, opacity: 0 },
    { yPercent: 0, skewY: 0, opacity: 1, ease: 'power3.out', stagger: 0.03, scrollTrigger: { trigger: trigger || el, start, end, scrub } })
}

/**
 * One-shot rise for any targets when `trigger` enters (the sample's reveal()).
 * `from` overrides the start state, e.g. { x: 70, y: 0 } or { scale: .5, rotation: -20 }.
 */
export function rise(targets, trigger, { from = {}, stagger = 0, start = 'top 86%', duration = 0.95, ease = 'expo.out' } = {}) {
  const els = gsap.utils.toArray(targets)
  if (!els.length) return null
  return gsap.from(els, {
    y: 36, opacity: 0, ...from, duration, ease, stagger,
    clearProps: 'transform,opacity,clipPath',
    scrollTrigger: { trigger: trigger || els[0], start, once: true },
  })
}

/** Staggered rise for a long list: each batch of items rises as its row enters. */
export function revealBatch(nodes, { y = 40, x = 0, stagger = 0.07, start = 'top 90%' } = {}) {
  const els = gsap.utils.toArray(nodes)
  if (!els.length) return
  gsap.set(els, { opacity: 0, y, x })
  onRevert(() => gsap.set(els, { clearProps: 'transform,opacity' }))
  ScrollTrigger.batch(els, {
    start, once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, x: 0, duration: 0.9, ease: 'expo.out', stagger, overwrite: true, clearProps: 'transform,opacity' }),
  })
}

/** Parallax drift while `el` crosses the viewport (numerals, far ridges, moons). */
export function parallax(el, { from = 30, to = -20, trigger, start = 'top bottom', end = 'bottom top', prop = 'yPercent' } = {}) {
  if (!el) return null
  return gsap.fromTo(el, { [prop]: from }, { [prop]: to, ease: 'none', scrollTrigger: { trigger: trigger || el, start, end, scrub: true } })
}

/** Portrait arch opens from the ground up; the photo settles inside it. */
export function archOpen(arch, { trigger, start = 'top 86%' } = {}) {
  if (!arch) return
  gsap.fromTo(arch, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, ease: 'expo.out', clearProps: 'clipPath', scrollTrigger: { trigger: trigger || arch, start, once: true } })
  const img = arch.querySelector('img')
  if (img) gsap.fromTo(img, { scale: 1.35 }, { scale: 1, duration: 1.6, ease: 'expo.out', clearProps: 'transform,scale', scrollTrigger: { trigger: trigger || arch, start, once: true } })
}

/** A photo wipes open from the right (project cards, event photos). */
export function wipeIn(el, { trigger, start = 'top 88%' } = {}) {
  if (!el) return null
  return gsap.fromTo(el, { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath', scrollTrigger: { trigger: trigger || el, start, once: true } })
}

/** Printed covers fan in, alternately tilted (newsletters, notices). */
export function fanIn(nodes, { trigger, start = 'top 86%' } = {}) {
  const els = gsap.utils.toArray(nodes)
  els.forEach((cv, i) => gsap.from(cv, { rotation: i % 2 ? 10 : -10, y: 60, opacity: 0, duration: 1.1, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: trigger || cv, start, once: true } }))
}

/**
 * Count a figure up from 0. `fmt(n)` formats each frame (money, grouping);
 * React renders the FINAL text, so reduced motion and reverts show the real
 * number. Pass a ScrollTrigger config (scrubbed or { trigger, start, once }).
 */
export function countUp(el, value, fmt, scrollTrigger, ease = 'power2.out') {
  if (!el || !(value > 0)) return null
  const f = fmt || ((n) => String(n))
  const o = { n: 0 }
  el.textContent = f(0)
  onRevert(() => { el.textContent = f(value) })
  return gsap.to(o, { n: value, duration: 1.6, ease, scrollTrigger, onUpdate: () => { el.textContent = f(Math.round(o.n)) } })
}

/** Figures in a StatRow-like list tumble in and count (vertical flow). */
export function statsIn(root) {
  if (!root) return
  gsap.utils.toArray(root.querySelectorAll('[data-hj-stat]')).forEach((f, i) => {
    rise(f, f, { from: { scale: 0.5, rotation: i % 2 ? 20 : -20, y: 0 }, ease: 'back.out(1.6)', duration: 1.1 })
  })
}

// ── page hero ────────────────────────────────────────────────────────────────
/**
 * The inner-page hero entrance (kit <PageHero>): the hills lift, the sun
 * climbs, the crumb and eyebrow slide in, the title rises letter by letter;
 * then, on scroll away, the sun sets behind the ridges and the ridges part.
 * PageHero calls this itself — pages never need to.
 */
export function heroIn(root) {
  if (!root) return
  const q = gsap.utils.selector(root)
  const t = q('.hj-ph__t')[0]
  const s = split(t)
  const tl = gsap.timeline({ delay: 0.05 })
    .from(q('.hj-ph__hills'), { yPercent: 28, duration: 1.6, ease: 'expo.out', clearProps: 'transform' }, 0)
    .from(q('.hj-ph__orb'), { yPercent: 40, duration: 2, ease: 'power3.out', clearProps: 'transform' }, 0)
    .from(q('.hj-crumbs, .hj-ph__eyebrow'), { y: 16, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08, clearProps: 'transform,opacity' }, 0.1)
  if (t) tl.from(s ? s.chars : t, { yPercent: 80, rotation: 8, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.025, clearProps: 'transform,opacity' }, 0.2)
  const rest = q('.hj-ph__sub, .hj-ph__more, .hj-ph__aside')
  if (rest.length) tl.from(rest, { y: 24, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.1, clearProps: 'transform,opacity' }, 0.45)
  gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
    .to(q('.hj-ph__sun, .hj-ph__moon'), { yPercent: 80 }, 0)
    .to(q('.hj-ph__hills .hj-rg--far'), { yPercent: -10 }, 0)
    .to(q('.hj-ph__hills .hj-rg--mid'), { yPercent: -20 }, 0)
}

// ── a pinned horizontal track for inner pages ────────────────────────────────
/**
 * Pin `section` and scrub `track` sideways (a timeline-like page: past
 * presidents by year, a year of events). Call ONLY when c.wide (and ideally a
 * min-height check via useMedia) — phones keep the vertical layout. The track
 * must be wider than the section (by its OWN box: width:max-content) and fit
 * its height. Returns { tl, go(x) } where tl is the containerAnimation for
 * child ScrollTriggers. Keyboard focus inside the track scrolls it into view.
 */
export function pinTrack(section, track, { scrub = true, onUpdate } = {}) {
  if (!section || !track) return null
  // offsetWidth, not scrollWidth: drifting/transformed children must not lengthen the pin
  const dist = () => Math.max(1, track.offsetWidth - section.clientWidth)
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: section, pin: true, scrub, anticipatePin: 1, invalidateOnRefresh: true,
      start: () => 'top ' + headerH(), end: () => '+=' + dist(), onUpdate,
    },
  })
  tl.to(track, { x: () => -dist() }, 0)
  const toX = (x, immediate) => {
    const st = tl.scrollTrigger
    scrollToY(st.start + gsap.utils.clamp(0, 1, x / dist()) * (st.end - st.start), immediate)
  }
  const onFocus = (e) => {
    const t = e.target
    if (!t.matches || !t.matches(':focus-visible')) return
    const left = t.getBoundingClientRect().left - track.getBoundingClientRect().left
    toX(left - section.clientWidth * 0.3, true)
  }
  track.addEventListener('focusin', onFocus)
  onRevert(() => track.removeEventListener('focusin', onFocus))
  return { tl, go: toX }
}
