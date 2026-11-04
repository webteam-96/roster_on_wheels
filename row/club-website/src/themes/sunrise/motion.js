'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE — the theme's signature motions, as small helpers on top of
// ../_shared/motion.js. Everything the shared file exports is re-exported here,
// so a page imports ALL its motion from '../motion.js'.
//
// Rules (same as useScene's):
//   - call the helpers INSIDE a useScene(ref, (c, ctx) => { … }) setup. They run
//     only when motion is allowed, and every tween/ScrollTrigger they create is
//     reverted with the scene. `c` = { motion, wide, fine }.
//   - helpers that write inline styles themselves (drum, photoTunnel, skyDriver)
//     or split text asynchronously (flyChars, pageHeroIn) RETURN a cleanup
//     function: return it (or a function calling all of them) from the setup.
//   - nothing here ever leaves content hidden without motion: with reduced
//     motion the setup never runs.
//   - filters are always tweened fromTo with explicit values (never from none).
// ─────────────────────────────────────────────────────────────────────────────
import { gsap, ScrollTrigger, SplitText, afterFonts, scrollToY } from '../_shared/motion.js'

export * from '../_shared/motion.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))
const els = (x) => (!x ? [] : typeof x === 'string' ? $$(x) : x.length !== undefined ? Array.from(x) : [x])

/** Height of the header's pinned bar (the pins start under it); the strip above the bar scrolls away. */
export const headerHeight = () => {
  const h = document.querySelector('.sun-hdr__bar') || document.querySelector('.sun-hdr')
  return h ? h.offsetHeight : 72
}

/** Run several cleanups as one (for a setup that used more than one helper). */
export const cleanups = (...fns) => () => fns.forEach((f) => { if (typeof f === 'function') f() })

// ── section titles fly out of the distance and past the viewer ──────────────
/** The sample's `.fly` h2: from z -380 (faded) to rest, hold, then past the viewer. */
export function flyTitle(targets, c) {
  els(targets).forEach((h) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: h, start: 'top bottom', end: 'bottom top', scrub: true } })
    tl.fromTo(h, { z: -380, opacity: 0, transformPerspective: 700 }, { z: 0, opacity: 1, duration: 0.4, ease: 'power2.out' })
      .to({}, { duration: 0.34 })
      .to(h, { z: c && c.wide ? 150 : 60, opacity: 0, duration: 0.26, ease: 'power1.in' })
  })
}

// ── focus pull: text sharpens as it reaches the reading line ────────────────
export function focusPull(targets, c) {
  els(targets).forEach((p) => {
    const a = c && c.wide ? { opacity: 0.15, y: 40, filter: 'blur(8px)' } : { opacity: 0.15, y: 30 }
    const b = c && c.wide ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 1, y: 0 }
    b.ease = 'none'
    // phones, tablets and short screens light the prose sooner: at 62% a 568px-tall phone kept its lower
    // third faded at rest, and one on its side had five clear lines. clamp(): a paragraph the page cannot
    // scroll that far (a short bio at the foot) is clear at the bottom
    b.scrollTrigger = { trigger: p, start: 'top 95%', end: () => (!(c && c.wide) || window.innerHeight < 560 ? 'clamp(top 82%)' : 'clamp(top 62%)'), scrub: true }
    gsap.fromTo(p, a, b)
  })
}

/** Glows and rings grow out of their centre (the about emblem, a hero ring). */
export function ringsRise(targets, trigger) {
  gsap.fromTo(els(targets), { scale: 0.5, opacity: 0 }, {
    scale: 1, opacity: 1, stagger: 0.12, ease: 'none',
    scrollTrigger: { trigger, start: 'top 92%', end: 'center 45%', scrub: true },
  })
}

/** Gentle vertical drift while an element crosses the screen. */
export function parallax(targets, amount = 12) {
  els(targets).forEach((el) => {
    gsap.fromTo(el, { yPercent: -amount }, {
      yPercent: amount, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    })
  })
}

// ── entrances for lists/grids ───────────────────────────────────────────────
/**
 * Cards lift off a tilted plane as they enter (once). ScrollTrigger.batch, so a
 * grid of 200 cards costs one trigger per card and enters row by row. Start is
 * 'top bottom' - every element in the document can reach it, so nothing can be
 * left hidden. Props are cleared after, so CSS hovers work again.
 */
export function revealBatch(targets, { y = 60, tilt = 16, stagger = 0.08 } = {}) {
  const nodes = els(targets)
  if (!nodes.length) return
  gsap.set(nodes, { y, rotationX: tilt, opacity: 0, transformPerspective: 900, transformOrigin: '50% 0%' })
  ScrollTrigger.batch(nodes, {
    start: 'top bottom',
    once: true,
    onEnter: (batch) => gsap.to(batch, {
      y: 0, rotationX: 0, opacity: 1, duration: 0.9, stagger, ease: 'power3.out', overwrite: true,
      clearProps: 'transform,opacity,translate,rotate,scale',
    }),
  })
}

/**
 * The sample's phone treatment for cards: scrubbed lift off a tilted plane, and
 * the photo drifts inside its frame. `imgSel` finds the photo inside each card.
 */
export function tiltRise(targets, imgSel = 'img') {
  els(targets).forEach((el) => {
    gsap.fromTo(el, { rotationX: 16, y: 60, opacity: 0.2, transformPerspective: 900, transformOrigin: '50% 0%' }, {
      rotationX: 0, y: 0, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 100%', end: 'top 62%', scrub: true },
    })
    const img = imgSel && el.querySelector(imgSel)
    if (img) gsap.fromTo(img, { scale: 1.22, yPercent: -5 }, {
      scale: 1.02, yPercent: 5, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    })
  })
}

// ── portraits rise over the horizon like suns ───────────────────────────────
/**
 * `people` = elements each holding .sun-arch__win (+ img/.sun-arch__mono inside),
 * .sun-arch__halo and .sun-person__role/__name/__bio. `cols` staggers each row
 * left to right (4 wide / 2 on phones by default).
 */
export function riseArches(people, c, cols) {
  const n = cols || (c && c.wide ? 4 : 2)
  els(people).forEach((p, i) => {
    const k = (i % n) * (c && c.wide ? 5 : 4)
    const tl = gsap.timeline({ scrollTrigger: { trigger: p, start: 'top ' + (94 - k) + '%', end: 'top ' + (48 - k) + '%', scrub: 0.6 } })
    const win = p.querySelector('.sun-arch__win')
    const pic = p.querySelector('.sun-arch__win > *')
    const halo = p.querySelector('.sun-arch__halo')
    const name = p.querySelector('.sun-person__name')
    const text = p.querySelectorAll('.sun-person__role, .sun-person__bio, .sun-person__more')
    if (win) tl.fromTo(win, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6, ease: 'power2.out' }, 0)
    if (pic) tl.fromTo(pic, { yPercent: 35, scale: 1.15 }, { yPercent: 0, scale: 1, duration: 0.6, ease: 'power2.out' }, 0)
    if (halo) tl.fromTo(halo, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7 }, 0)
    if (text.length) tl.fromTo(text, { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.4 }, 0.25)
    // the name only fades: any transform on it (even GSAP's resting translate(0,0)) makes the h3 the
    // containing block of its link's card-wide ::after, and then only the name takes the click
    if (name) tl.fromTo(name, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.31)
  })
}

// ── the sheet lifts, covers stand up, their suns rise ───────────────────────
export function liftSheet(sheet, trigger) {
  gsap.fromTo(sheet, { rotationX: 20, y: 90, transformPerspective: 1600, transformOrigin: '50% 100%' }, {
    rotationX: 0, y: 0, ease: 'none', scrollTrigger: { trigger: trigger || sheet, start: 'top bottom', end: 'top 30%', scrub: true },
  })
}
export function standUp(covers, trigger) {
  const nodes = els(covers)
  if (!nodes.length) return
  gsap.fromTo(nodes, { rotationX: -72, opacity: 0.3, transformPerspective: 1100, transformOrigin: '50% 100%' }, {
    rotationX: 0, opacity: 1, stagger: 0.18, ease: 'none', scrollTrigger: { trigger: trigger || nodes[0], start: 'top 92%', end: 'top 45%', scrub: true },
  })
  const suns = nodes.map((n) => n.querySelector('.sun-cover__sun')).filter(Boolean)
  if (suns.length) gsap.fromTo(suns, { yPercent: 55 }, {
    yPercent: 0, ease: 'none', scrollTrigger: { trigger: trigger || nodes[0], start: 'top 85%', end: 'bottom 55%', scrub: true },
  })
}

// ── sunrise over the hills ──────────────────────────────────────────────────
/** `section` holds a sun (sunSel) and .sun-hill--back/--mid; scrubbed while it enters. */
export function sunrise(section, sunSel = '.sun-sunrise__sun, .sun-dawnband__sun', end = 'bottom bottom') {
  const st = { trigger: section, start: 'top bottom', end, scrub: true }
  const sun = section.querySelector(sunSel)
  if (sun) gsap.fromTo(sun, { yPercent: 38, scale: 0.78 }, { yPercent: 0, scale: 1, ease: 'none', scrollTrigger: st })
  const back = section.querySelector('.sun-hill--back')
  const mid = section.querySelector('.sun-hill--mid')
  if (back) gsap.fromTo(back, { yPercent: 36 }, { yPercent: 0, ease: 'none', scrollTrigger: st })
  if (mid) gsap.fromTo(mid, { yPercent: 18 }, { yPercent: 0, ease: 'none', scrollTrigger: st })
}

// ── letters fly in from the depth (the big meeting day, page titles) ────────
/**
 * Splits `el` into chars once fonts are ready and scrubs them in from z -600.
 * `aria`: 'none' when a sibling already carries the accessible text (the element
 * is aria-hidden), 'auto' to keep the text readable on the element itself.
 * Returns a cleanup (cancels the pending split, reverts it).
 */
export function flyChars(el, ctx, { trigger, start = 'top 94%', end = 'top 52%', aria = 'none' } = {}) {
  let split = null
  const cancel = afterFonts(ctx, () => {
    split = SplitText.create(el, { type: 'words,chars', charsClass: 'sun-c', wordsClass: 'sun-w', tag: 'span', aria })
    gsap.fromTo(split.chars, { z: -600, opacity: 0, rotationX: -40, transformPerspective: 600 }, {
      z: 0, opacity: 1, rotationX: 0, stagger: 0.06, ease: 'power2.out',
      scrollTrigger: { trigger: trigger || el, start, end, scrub: true },
    })
  })
  return () => { cancel(); if (split) split.revert() }
}

// ── the page hero (kit PageHero) ────────────────────────────────────────────
/**
 * The theme's page entrance: the sun rises behind the title, the crumbs settle,
 * the title's letters arrive out of the depth, then the page's tools follow (the
 * .sun-ph-after row PageHero renders right after the band: search, chips, stats).
 * Then, scrubbed on the way out, the title drifts toward the viewer and fades
 * while the sun sinks back - the same gesture as the home's section titles.
 * `root` = the .sun-ph element. Returns a cleanup.
 */
export function pageHeroIn(root, c, ctx) {
  if (!root) return () => {}
  const sun = root.querySelector('.sun-ph__sun')
  const ring = root.querySelector('.sun-ph__ring')
  const title = root.querySelector('.sun-ph__title')
  const crumbs = root.querySelector('.sun-crumbs')
  const next = root.nextElementSibling
  const after = next && next.classList.contains('sun-ph-after') ? next : null
  const clear = 'transform,opacity,translate,rotate,scale'

  if (sun) gsap.fromTo(sun, { yPercent: 36, scale: 0.8, opacity: 0.3 }, { yPercent: 0, scale: 1, opacity: 1, duration: 1.8, ease: 'power3.out', clearProps: clear })
  if (ring) gsap.fromTo(ring, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, delay: 0.1, ease: 'power3.out', clearProps: clear })
  if (crumbs) gsap.fromTo(crumbs, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power3.out', clearProps: clear })
  if (after) gsap.fromTo(after, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 1, delay: 0.45, ease: 'power3.out', clearProps: clear })

  // on the way out: sun sinks, title goes past the viewer (wrapper only, so the
  // letters' entrance and this scrub never touch the same element)
  if (sun) gsap.to(sun, { yPercent: 22, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
  if (title) gsap.fromTo(title, { z: 0, opacity: 1, transformPerspective: 700 }, {
    z: c && c.wide ? 140 : 60, opacity: 0.1, ease: 'power1.in', immediateRender: false,
    scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true },
  })

  let split = null
  const cancel = title ? afterFonts(ctx, () => {
    split = SplitText.create(title, { type: 'words,chars', charsClass: 'sun-c', wordsClass: 'sun-w', tag: 'span', aria: 'auto' })
    title.classList.add('is-split')
    gsap.fromTo(split.chars, { z: -520, opacity: 0, rotationX: -35, transformPerspective: 700 }, {
      z: 0, opacity: 1, rotationX: 0, duration: 1.1, stagger: { each: 0.028, from: 'start' }, ease: 'power3.out', clearProps: clear,
    })
  }) : () => {}
  return () => { cancel(); if (split) split.revert(); if (title) title.classList.remove('is-split') }
}

// ── numbers count up as they arrive ─────────────────────────────────────────
/**
 * Counts `el`'s number from 0 to `value` when it enters, writing through its
 * TEXT NODE (React keeps owning the node, so a later re-render still updates
 * it). `format(n)` prints a number (e.g. v => formatMoney(v, currency)).
 */
export function countUp(el, value, format = (n) => String(Math.round(n))) {
  const node = el && el.firstChild
  if (!node || node.nodeType !== 3 || !(value > 0)) return
  const final = format(value)
  const o = { v: 0 }
  node.nodeValue = format(0)
  gsap.to(o, {
    v: value, duration: 1.6, ease: 'power3.out',
    onUpdate: () => { node.nodeValue = format(o.v) },
    onComplete: () => { node.nodeValue = final },
    onInterrupt: () => { node.nodeValue = final },
    scrollTrigger: { trigger: el, start: 'top bottom', once: true },
  })
  return () => { node.nodeValue = final }
}

// ── the drum: a list turning under the reading line ─────────────────────────
/** `list` = an <ol class="sun-drum">; its <li>s rotate on a cylinder. Returns a cleanup. */
export function drum(list) {
  const marks = Array.from(list.children)
  if (!marks.length) return () => {}
  let centers = [], halves = []
  list.classList.add('is-live')
  const measure = () => {
    const top = list.getBoundingClientRect().top + window.scrollY
    centers = marks.map((li) => top + li.offsetTop + li.offsetHeight / 2)
    halves = marks.map((li) => li.offsetHeight / 2)
  }
  const render = () => {
    const hh = headerHeight()
    const cy = window.scrollY + (window.innerHeight + hh) / 2, R = window.innerHeight / 2
    marks.forEach((li, i) => {
      const a = clamp((centers[i] - cy) / R, -1.3, 1.3), ab = Math.abs(a)
      li.style.transform = 'perspective(900px) translateZ(' + (-ab * 160).toFixed(1) + 'px) rotateX(' + (-a * 52).toFixed(2) + 'deg)'
      li.style.opacity = Math.max(0.14, 1 - ab * 0.8).toFixed(3)
      // lit near the reading line - or anywhere on the row itself when the row is taller than that
      // band (the past presidents' photo rows): two lit rows never leave a gap between them
      li.classList.toggle('is-on', Math.abs(centers[i] - cy) < Math.max(0.14 * R, halves[i]))
    })
  }
  // measure before create(): with the list already on screen, create() calls onUpdate before onRefresh
  measure()
  ScrollTrigger.create({ trigger: list, start: 'top bottom', end: 'bottom top', onUpdate: render, onRefresh: () => { measure(); render() } })
  render()
  return () => {
    list.classList.remove('is-live')
    marks.forEach((li) => { li.style.transform = li.style.opacity = ''; li.classList.remove('is-on') })
  }
}

// ── the tunnel: travel through the photos (wide screens only) ───────────────
/**
 * `stage` = the .sun-tunnel element: .sun-tunnel__cards > .sun-tunnel__card
 * (each with a focusable link), .sun-tunnel__head, .sun-tunnel__end,
 * .sun-tunnel__sparks, .sun-tunnel__light. Pins the stage
 * and flies the camera through the cards; focusing a card with the keyboard
 * flies the camera to it. Call only when c.wide. Returns a cleanup.
 * headTop: the heading stays at the top of the stage (.is-headtop; its height in
 * --sun-th for the card sizes) and the cards fly in the band under it, instead
 * of the heading flying past first.
 */
export function photoTunnel(stage, c, { headTop = false } = {}) {
  const q = (s) => stage.querySelector(s)
  const cards = $$('.sun-tunnel__card', stage)
  const head = q('.sun-tunnel__head'), endEl = q('.sun-tunnel__end')
  const sparkBox = q('.sun-tunnel__sparks'), glow = q('.sun-tunnel__light'), cardsBox = q('.sun-tunnel__cards')
  const n = cards.length
  if (!n || !cardsBox) return () => {}
  stage.classList.add('is-tunnel')
  if (headTop) stage.classList.add('is-headtop')
  const SP = 1250, D0 = 70, LZ = 4200, YS = [-0.06, 0.07, -0.02, 0.05]
  let SW = 1, SH = 1, TH = 0, layout = []
  const sparks = []
  cards.forEach((el, i) => { el.style.zIndex = n - i })
  if (sparkBox) for (let s = 0; s < (c.fine ? 46 : 30); s++) {
    const sp = document.createElement('i')
    sp.className = 'sun-spark'; sparkBox.appendChild(sp)
    sparks.push({ el: sp, a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.7, zb: Math.random() * LZ })
  }
  const measure = () => {
    SW = stage.clientWidth; SH = stage.clientHeight
    // headTop: the cards are centred in the band under the heading, with half the vertical drift
    TH = headTop && head ? head.offsetHeight : 0
    if (headTop) stage.style.setProperty('--sun-th', TH + 'px')
    const yk = headTop ? 0.5 : 1
    layout = cards.map((el, i) => { const side = i % 2 ? 1 : -1; return { x: side * SW * 0.22, y: TH / 2 + YS[i % 4] * (SH - TH) * yk, ry: -side * 12 } })
  }
  // the camera eases to a near-stop each time a photo reaches the reading distance
  const camAt = (t) => { const k = Math.floor(t), u = t - k; return SP * (k + u - Math.sin(u * Math.PI * 2) * 0.13) }
  const fog = (rel) => {
    if (rel > 60) return Math.max(0, 1 - (rel - 60) / 320)
    if (rel < -2600) return Math.max(0, 1 - (-2600 - rel) / 1100)
    return 1
  }
  const place = (el, x, y, rel, extra, o, card) => {
    if (!el) return
    el.style.transform = extra.replace('#', x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + rel.toFixed(1) + 'px')
    const gone = o < 0.01 || rel > 780
    el.style.opacity = gone ? '0' : o.toFixed(3)
    // passed cards stay focusable (Shift+Tab flies back) but stop taking the pointer
    if (card) el.style.pointerEvents = gone ? 'none' : ''
    else el.style.visibility = gone ? 'hidden' : ''
  }
  let tp = 0, vT = 0, vC = 0, inView = false
  const po = { x: 0, y: 0 }
  const render = () => {
    const t = -1 + tp * (n + 1), cam = camAt(t)
    vC += (vT - vC) * 0.15; vT *= 0.9
    cards.forEach((el, i) => {
      const L = layout[i] || { x: 0, y: 0, ry: 0 }, rel = cam - (SP * i + D0)
      place(el, L.x, L.y, rel, 'translate(-50%,-50%) translate3d(#) rotateY(' + L.ry + 'deg)', fog(rel), true)
    })
    const rh = cam + SP - 120, re = cam - SP * n - 110
    if (!headTop) place(head, 0, 0, rh, 'perspective(900px) translate3d(#)', fog(rh))
    place(endEl, 0, 0, re, 'perspective(900px) translate3d(#)', fog(re))
    const R = Math.max(SW, SH) * 0.5, str = (1 + vC).toFixed(2)
    sparks.forEach((p) => {
      const rel = ((p.zb + cam) % LZ + LZ) % LZ - LZ + 260
      const o = rel > 0 ? 1 - rel / 260 : rel < -3000 ? 0 : rel < -2200 ? (rel + 3000) / 800 : 1
      p.el.style.transform = 'translate3d(' + (Math.cos(p.a) * p.r * R).toFixed(1) + 'px,' + (Math.sin(p.a) * p.r * R * 0.75).toFixed(1) + 'px,' + rel.toFixed(1) + 'px) rotate(' + p.a.toFixed(3) + 'rad) scaleX(' + str + ')'
      p.el.style.opacity = (o * 0.9).toFixed(3)
    })
    if (glow) glow.style.transform = 'scale(' + (1 + vC * 0.04).toFixed(3) + ')'
    const oy = headTop ? ((TH + SH) / 2 / SH) * 100 : 50   // the vanishing point: the middle of the cards' band
    const origin = (50 + po.x * 8).toFixed(2) + '% ' + (oy + po.y * 8).toFixed(2) + '%'
    cardsBox.style.perspectiveOrigin = origin
    if (sparkBox) sparkBox.style.perspectiveOrigin = origin
  }
  const tst = ScrollTrigger.create({
    trigger: stage, pin: true, invalidateOnRefresh: true,
    start: () => 'top ' + headerHeight() + 'px',
    end: () => '+=' + Math.round(window.innerHeight * (1.6 + n * 0.4)),
    onUpdate: (self) => { tp = self.progress; vT = Math.min(12, Math.abs(self.getVelocity()) / 240) },
    onRefresh: (self) => { measure(); tp = self.progress; render() },
  })
  // on screen = the whole pinned run plus a screen either side. Not trigger:stage/'bottom top':
  // that end is measured on the unpinned stage, so it fired a few hundred px into the pin and
  // froze the tunnel on its first photo. Created after tst, so it refreshes after it.
  ScrollTrigger.create({
    start: () => tst.start - window.innerHeight, end: () => tst.end + window.innerHeight,
    onToggle: (self) => { inView = self.isActive },
  })
  const tick = () => { if (inView) render() }
  gsap.ticker.add(tick)
  let offMove = null
  if (c.fine) {
    const pox = gsap.quickTo(po, 'x', { duration: 1, ease: 'power3' }), poy = gsap.quickTo(po, 'y', { duration: 1, ease: 'power3' })
    const onMove = (e) => { pox(e.clientX / window.innerWidth - 0.5); poy(e.clientY / window.innerHeight - 0.5) }
    window.addEventListener('pointermove', onMove, { passive: true })
    offMove = () => window.removeEventListener('pointermove', onMove)
  }
  // keyboard: focusing a photo's link flies the camera to it
  const onFocus = (e) => {
    if (!e.target.matches(':focus-visible')) return   // a mouse click must not jump the scroll
    const card = e.target.closest('.sun-tunnel__card')
    const i = card ? cards.indexOf(card) : endEl && endEl.contains(e.target) ? n : -1
    if (i < 0) return
    scrollToY(tst.start + ((i + 1) / (n + 1)) * (tst.end - tst.start), true)
    ScrollTrigger.update()
  }
  stage.addEventListener('focusin', onFocus)
  measure(); render()
  return () => {
    gsap.ticker.remove(tick)
    if (offMove) offMove()
    stage.removeEventListener('focusin', onFocus)
    stage.classList.remove('is-tunnel', 'is-headtop')
    stage.style.removeProperty('--sun-th')
    sparks.forEach((p) => p.el.remove())
    cards.concat([head, endEl]).forEach((el) => {
      if (el) el.style.transform = el.style.opacity = el.style.visibility = el.style.zIndex = el.style.pointerEvents = ''
    })
    if (glow) glow.style.transform = ''
    cardsBox.style.perspectiveOrigin = ''
    if (sparkBox) sparkBox.style.perspectiveOrigin = ''
  }
}

// ── the sky (Site.jsx only) ─────────────────────────────────────────────────
/**
 * Scrubs the fixed sky band by scroll. Anchors: any `[data-sun-sky="0.3"]` inside
 * #main (the home sets one per section) plus the footer's. A page WITHOUT anchors
 * (every inner page) is mapped onto 0 -> 0.72 only - pre-dawn navy to violet
 * dusk - because dark-mode light text cannot sit on the warm stops; the dawn
 * band above the footer paints that page's sunrise itself.
 * Created with refreshPriority -100, so it measures after every pin's spacing.
 */
export function skyDriver(sky, dawn, c) {
  const html = document.documentElement
  const band = sky.querySelector('.sun-sky__band'), starsBox = sky.querySelector('.sun-sky__stars')
  const gA = sky.querySelector('.sun-sky__glow--a'), gB = sky.querySelector('.sun-sky__glow--b'), hor = sky.querySelector('.sun-sky__horizon')
  const N = 30   // band = N viewport heights; one screen shows 1/N of the dawn
  html.classList.add('sun-sky-live')
  if (starsBox && !starsBox.dataset.done) {
    const field = (count, size, alpha) => {
      const s = []
      for (let i = 0; i < count; i++) s.push((Math.random() * 100).toFixed(2) + 'vw ' + (Math.random() * 100).toFixed(2) + 'vh 0 ' + (Math.random() * size).toFixed(1) + 'px rgba(255,248,235,' + (alpha * (0.35 + Math.random() * 0.65)).toFixed(2) + ')')
      return s.join(',')
    }
    const a = starsBox.querySelector('.sun-st--a'), b = starsBox.querySelector('.sun-st--b')
    if (a) a.style.boxShadow = field(c.wide ? 150 : 80, 0.8, 0.8)
    if (b) b.style.boxShadow = field(c.wide ? 36 : 20, 1.6, 1)
    starsBox.dataset.done = '1'
  }
  let pts = [[0, 0], [1, 0.72]]
  const vIn = (list, s) => {
    for (let i = 1; i < list.length; i++) if (s <= list[i][0]) {
      const a = list[i - 1], b = list[i]
      return a[1] + (b[1] - a[1]) * clamp((s - a[0]) / (b[0] - a[0] || 1), 0, 1)
    }
    return list[list.length - 1][1]
  }
  const build = () => {
    const max = ScrollTrigger.maxScroll(window) || 1
    const anchors = $$('#main [data-sun-sky]')
    if (!anchors.length) { pts = [[0, 0], [max, 0.72]]; return }
    const top = (el) => el.getBoundingClientRect().top + window.scrollY
    // WARM GUARD: while a section with light text (no data-sun-warm) is still on
    // screen, the sky stays at or below 0.80 (violet/rose) - the peach and gold
    // stops only arrive once the warm-safe grounds (sheet, sunrise) own the view.
    let coolEnd = 0
    anchors.forEach((el) => {
      if (!el.hasAttribute('data-sun-warm')) coolEnd = Math.max(coolEnd, top(el) + el.offsetHeight - window.innerHeight * 0.1)
    })
    coolEnd = clamp(coolEnd, 0, max)
    const foot = document.querySelector('.sun-foot[data-sun-sky]')
    if (foot) anchors.push(foot)
    let raw = [[0, 0]]
    anchors.forEach((el) => {
      const v = parseFloat(el.getAttribute('data-sun-sky'))
      if (!(v >= 0)) return
      const s = clamp(top(el) - window.innerHeight * 0.55, 0, max)
      if (s > raw[raw.length - 1][0]) raw.push([s, v])
    })
    raw.push([Math.max(max, raw[raw.length - 1][0] + 1), 1])
    const CAP = 0.8
    if (coolEnd > 0) {
      const at = Math.min(CAP, vIn(raw, coolEnd))
      raw = raw.filter((p) => p[0] < coolEnd).map((p) => [p[0], Math.min(p[1], CAP)])
        .concat([[coolEnd, at]], raw.filter((p) => p[0] > coolEnd))
    }
    pts = raw
  }
  const vAt = (s) => vIn(pts, s)
  const paint = () => {
    const s = window.scrollY, max = ScrollTrigger.maxScroll(window) || 1, v = vAt(s)
    if (band) band.style.transform = 'translate3d(0,' + (-v * (N - 1) * 100).toFixed(3) + '%,0) scaleY(' + N + ')'
    if (starsBox) {
      starsBox.style.opacity = clamp(1 - v / 0.5, 0, 1).toFixed(3)
      starsBox.style.transform = 'translate3d(0,' + (-v * 140).toFixed(1) + 'px,0)'
    }
    if (gA) {
      gA.style.opacity = clamp(1 - v * 1.1, 0.15, 1).toFixed(3)
      gA.style.transform = 'translate3d(' + (v * 24).toFixed(2) + 'vw,' + (v * 30).toFixed(2) + 'vh,0)'
    }
    if (gB) {
      gB.style.opacity = clamp(v * 1.5, 0.2, 1).toFixed(3)
      gB.style.transform = 'translate3d(0,' + ((1 - v) * 24).toFixed(2) + 'vh,0)'
    }
    if (hor) {
      hor.style.opacity = Math.max(0.08, v * v * v).toFixed(3)
      hor.style.transform = 'translate3d(0,' + ((1 - v) * 26).toFixed(2) + 'vh,0)'
    }
    if (dawn) dawn.style.transform = 'scaleX(' + clamp(s / max, 0, 1).toFixed(4) + ')'
  }
  const st = ScrollTrigger.create({ start: 0, end: 'max', refreshPriority: -100, onUpdate: paint, onRefresh: () => { build(); paint() } })
  build(); paint()
  return () => {
    st.kill()
    html.classList.remove('sun-sky-live')
    ;[band, starsBox, gA, gB, hor, dawn].forEach((el) => { if (el) el.style.transform = el.style.opacity = '' })
  }
}
