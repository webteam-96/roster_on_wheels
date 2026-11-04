'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC — home. The approved sample (Theme8-Samples/A-cinematic) on live
// data: the projector-open hero that pulls back into a lit frame, the charter
// statement lighting up word by word, a pinned stage where the club's figures
// take centre in turn, the film reel of projects, leader cards dealt onto the
// table, newsletters wiping open, and the full-bleed meeting finale.
// Client order (2026-09-25): hero -> leadership -> figures -> about -> projects
// -> upcoming events -> newsletters + where we meet (one row). The club's ads
// open as a popup once per visit instead of a section. Banners are shown
// without the flat letterbox the dashboard pads photos with (bannerTrim.js).
//
// Each pinned section is its own component whose root is a plain wrapper <div>
// (GSAP re-parents the pinned <section> into a pin-spacer; React must never
// have to insert next to or remove that section directly).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useClub, useHomeData, usePageTitle, withYear, formatMoney, groupInt, plainText,
  adAnchorProps,
} from '../_shared/data.js'
import { imgFallback, hideOnError, PersonPhoto, useOneLine } from '../_shared/kit.jsx'
import {
  gsap, ScrollTrigger, useScene, afterFonts, useRefreshOnImages, prefersReducedMotion, cleanups, headerH,
  splitChars, riseIn, wipeIn, lightWords, countUp, reel, projectorOpen,
  lettersFloat, getLenis, EXPO,
} from './motion.js'
import {
  clubNames, cutText, yearText, Button, SectionHead, FrameCard, Pill, DateStamp,
  EmptyState, Arrow, ArrowOut, useModal,
} from './kit.jsx'
import { useTrimmedBanners } from './bannerTrim.js'
import './home.css'

const SLIDE_MS = 6000
let INTRO_PLAYED = false          // the projector opens once per page load, not on every return home

const has = (v) => v && String(v).trim() && v !== '—'

// ── about: the club's own words, split into a statement and an excerpt ───────
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|St|No|Smt|Shri|Rtn|Rtr|PP|PDG|Prof|Hon|Ltd|Co|vs|etc)\.$/i
function aboutLines(html) {
  if (!html || !String(html).trim() || typeof DOMParser === 'undefined') return null
  // DOMParser builds an inert document: nothing in admin HTML loads or runs.
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  let blocks = [...doc.body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,div,td')]
    .filter((el) => !el.querySelector('p,li,div,h1,h2,h3,h4,h5,h6,td'))
    .map((el) => clean(el.textContent)).filter(Boolean)
  if (!blocks.length) blocks = [clean(doc.body.textContent)].filter(Boolean)
  // a leading title line ("Rotary Club of X – An overview") is not the story
  while (blocks.length > 1 && blocks[0].length < 90 && !/[.!?]["'’”)]?$/.test(blocks[0])) blocks.shift()
  const text = blocks.join(' ')
  if (!text) return null
  // No lookbehind: a lookbehind regex literal is a parse error on older Safari.
  const sentences = text.replace(/([.!?])\s+(?=[A-Z‘'"“(])/g, (m, p, i, s) => (ABBR.test(s.slice(0, i + 1)) ? m : p + '\n'))
    .split('\n').map(clean).filter(Boolean)
  let take = sentences[0] && sentences[1] && (sentences[0].length + sentences[1].length) <= 260 ? 2 : 1
  const statement = cutText(sentences.slice(0, take).join(' '), 300)
  let excerpt = ''
  for (const s of sentences.slice(take)) {
    if (excerpt && (excerpt + ' ' + s).length > 420) break
    excerpt = excerpt ? excerpt + ' ' + s : s
  }
  return { statement, excerpt: cutText(excerpt, 440) }
}

// ── 1 · hero: the screen ─────────────────────────────────────────────────────
function Hero({ banners, ready, names, district, yearLabel }) {
  const wrapRef = useRef(null)
  const [shapes, setShapes] = useState({})     // slide index -> the photo's width / height
  const bigRef = useRef(null)
  const bigTextRef = useRef(null)
  const n = banners.length
  const [cur, setCur] = useState(0)
  const [prev, setPrev] = useState(-1)
  const [paused, setPaused] = useState(false)
  const [auto] = useState(() => !prefersReducedMotion())
  const curRef = useRef(0)
  const visible = useRef(true)
  const setKey = banners.map((b) => b.src).join('|')

  useEffect(() => { curRef.current = 0; setCur(0); setPrev(-1) }, [setKey])

  const go = (k) => {
    if (n < 2) return
    const next = ((k % n) + n) % n
    if (next === curRef.current) return
    setPrev(curRef.current)
    curRef.current = next
    setCur(next)
  }

  // The incoming slide opens as an iris; the outgoing one stays under it until then.
  // Layout effect: the clip is on before the incoming slide's first frame paints.
  useLayoutEffect(() => {
    if (prev < 0) {
      const fills = wrapRef.current ? wrapRef.current.querySelectorAll('.cin-hero__fill img') : []
      if (fills.length) gsap.set(fills, { clearProps: 'opacity' })
      return undefined
    }
    const root = wrapRef.current
    const slide = root && root.querySelectorAll('.cin-slide')[cur]
    const fills = root ? root.querySelectorAll('.cin-hero__fill img') : []
    if (!slide || prefersReducedMotion()) { setPrev(-1); return undefined }
    const tl = gsap.timeline({ onComplete: () => setPrev(-1) })
    tl.fromTo(slide, { clipPath: 'circle(0% at 50% 50%)', scale: 1.1 }, { clipPath: 'circle(72% at 50% 50%)', scale: 1, duration: 1.4, ease: 'expo.inOut', clearProps: 'clipPath,transform' }, 0)
    if (fills[cur]) tl.fromTo(fills[cur], { opacity: 0 }, { opacity: 0.6, duration: 1.4, ease: 'power2.inOut' }, 0)
    if (fills[prev]) tl.to(fills[prev], { opacity: 0, duration: 1.4, ease: 'power2.inOut' }, 0)
    return () => tl.kill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, prev])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((en) => { visible.current = en[0].isIntersecting })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!auto || paused || n < 2) return undefined
    const t = setInterval(() => { if (visible.current && !document.hidden) go(curRef.current + 1) }, SLIDE_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, paused, n, cur])

  // Projector opens (once per load), the title rises; on scroll the screen
  // pulls back into a lit frame - pinned on wide screens.
  useScene(wrapRef, (c, ctx) => {
    const off = cleanups()
    const hero = wrapRef.current.querySelector('.cin-hero')
    const htl = gsap.timeline({
      scrollTrigger: {
        trigger: hero,
        start: c.wide ? () => 'top ' + headerH() + 'px' : 'top top',
        end: c.wide ? '+=90%' : 'bottom top',
        pin: c.wide, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 3,
      },
    })
    htl.to('.cin-hero__screen', { scale: c.wide ? 0.7 : 0.9, yPercent: c.wide ? -5 : 8, ease: 'none' }, 0)
      .fromTo('.cin-hero__frame', { clipPath: 'inset(0% 0% 0% 0% round 0px)' }, { clipPath: 'inset(0% 0% 0% 0% round 26px)', ease: 'none' }, 0)
      .fromTo('.cin-hero__glow', { opacity: 0.45, scale: 0.9 }, { opacity: 1, scale: 1.05, ease: 'none' }, 0)
      .to('.cin-hero__fill', { scale: 1.15, ease: 'none' }, 0)

    off(afterFonts(ctx, () => {
      const big = splitChars(wrapRef.current.querySelector('.cin-hero__bigvis'), 'none')
      if (!INTRO_PLAYED && ready) {
        INTRO_PLAYED = true
        const intro = gsap.timeline({ delay: 0.1 })
        intro.add(projectorOpen('.cin-hero__reveal'), 0)
          .fromTo('.cin-hero__fill', { opacity: 0 }, { opacity: 1, duration: 1.8, ease: 'power2.out', clearProps: 'opacity' }, 0.35)
        if (big) intro.from(big.chars, { yPercent: 118, duration: 1.2, ease: EXPO, stagger: Math.min(0.05, 0.9 / big.chars.length) }, 0.55)
        intro.from(gsap.utils.toArray('.cin-hero__pre, .cin-hero__facts, .cin-hero__meta .cin-btn, .cin-hero__ctrl'),
          { y: 22, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, clearProps: 'transform,opacity' }, 0.95)
      }
      if (big && big.masks && big.masks.length) {
        gsap.to(big.masks, {
          x: (i) => i * (c.wide ? 9 : 3), yPercent: (i) => -8 - (i % 2) * 6, ease: 'none',
          scrollTrigger: {
            trigger: hero, start: c.wide ? () => 'top ' + headerH() + 'px' : 'top top',
            end: c.wide ? '+=90%' : 'bottom top', scrub: 0.6, invalidateOnRefresh: true,
          },
        })
      }
    }))
    return off.run
  }, [ready, names.short])

  useOneLine(bigRef, bigTextRef, [names.short])
  // The screen takes the shown photo's own shape (glides between slides), so a
  // banner is never cropped; extreme shapes are clamped and shown whole (contain).
  const shapeOf = (e, i) => {
    const im = e.currentTarget
    if (im.naturalWidth && im.naturalHeight) setShapes((m) => (m[i] ? m : { ...m, [i]: im.naturalWidth / im.naturalHeight }))
  }
  const scr = Math.min(3.6, Math.max(1.3, shapes[cur] || 2.5))
  const showOn = (i) => i === cur || i === prev

  return (
    <div ref={wrapRef}>
      <section className={'cin-hero' + (n ? ' has-slides' : '')} aria-labelledby="cin-hero-h">
        <div className="cin-hero__fill" aria-hidden="true">
          {banners.map((b, i) => (
            <img key={b.src + i} src={b.src} data-fallbacks={b.fallbacks} alt="" onError={imgFallback}
              className={showOn(i) ? 'is-on' : undefined} loading={i === 0 ? 'eager' : 'lazy'} />
          ))}
        </div>
        <div className="cin-hero__stage">
          <div className="cin-hero__screen" style={{ '--cin-scr': scr.toFixed(3) }}>
            <div className="cin-hero__glow" aria-hidden="true" />
            <div className="cin-hero__frame">
              <div className="cin-hero__reveal">
                {banners.map((b, i) => {
                  const cls = 'cin-slide' + (showOn(i) ? ' is-on' : '') + (i === cur ? ' is-top' : '')
                  const alt = b.title || names.full + ' banner ' + (i + 1) + ' of ' + n
                  return b.url ? (
                    <a key={b.src + i} className={cls} href={b.url} {...adAnchorProps(b.url)} aria-label={alt + ' (opens in a new tab)'}>
                      <img src={b.src} data-fallbacks={b.fallbacks} alt="" width="1920" height="600" onError={imgFallback}
                        onLoad={(e) => shapeOf(e, i)} fetchpriority={i === 0 ? 'high' : undefined} loading={i === 0 ? 'eager' : 'lazy'} />
                    </a>
                  ) : (
                    <div key={b.src + i} className={cls}>
                      <img src={b.src} data-fallbacks={b.fallbacks} alt={alt} width="1920" height="600" onError={imgFallback}
                        onLoad={(e) => shapeOf(e, i)} fetchpriority={i === 0 ? 'high' : undefined} loading={i === 0 ? 'eager' : 'lazy'} />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="cin-hero__copy">
          <h1 id="cin-hero-h" className="cin-hero__h1">
            <span className="cin-sr">{names.full}</span>
            {names.pre ? <span className="cin-hero__pre" aria-hidden="true">{names.pre}</span> : null}
            <span className="cin-hero__big" aria-hidden="true" ref={bigRef}><span className="cin-hero__bigvis" key={names.short} ref={bigTextRef}>{names.short}</span></span>
          </h1>
          <div className="cin-hero__meta">
            <p className="cin-hero__facts">
              {district ? <span>District <b>{district}</b></span> : null}
              {yearLabel ? <span>Rotary year <b>{yearLabel}</b></span> : null}
            </p>
            <Button href="/projects">See our projects <Arrow /></Button>
            {n > 1 ? (
              <div className="cin-hero__ctrl" role="group" aria-label="Banner slideshow">
                {banners.map((b, i) => (
                  <button key={i} type="button" className="cin-dot" aria-current={i === cur ? 'true' : 'false'} onClick={() => go(i)}>
                    <span className="cin-sr">Show banner {i + 1}</span><span aria-hidden="true" />
                  </button>
                ))}
                {/* no Pause button on the banner (client, 2026-10-06); hover / focus still hold it, reduced motion never autoplays */}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── 2 · about ────────────────────────────────────────────────────────────────
// The club's own words, five lines and no more (client, 2026-09-25), lighting up
// word by word as they scroll in; the rest is one click away on /about.
function About({ lines }) {
  const ref = useRef(null)
  const text = [lines.statement, lines.excerpt].filter(Boolean).join(' ')
  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    lightWords(ref.current.querySelector('.cin-about__vis'))
    riseIn(ref.current.querySelector('.cin-about__go'), { trigger: ref.current.querySelector('.cin-statement') })
  }), [text])
  return (
    <section ref={ref} className="cin-sec cin-about" aria-labelledby="cin-about-h">
      <SectionHead id="cin-about-h" title="About the club" />
      <p className="cin-statement">
        <span className="cin-sr">{text}</span>
        <span className="cin-about__vis" aria-hidden="true" key={text}>{text}</span>
      </p>
      <div className="cin-about__go">
        <Button href="/about" variant="line">Read more<span className="cin-sr"> about the club</span> <Arrow /></Button>
      </div>
    </section>
  )
}

// ── 3 · figures: one pinned stage, each figure takes the centre in turn ──────
function Figures({ figures, yearLabel }) {
  const wrapRef = useRef(null)
  const sig = figures.map((f) => f.key + ':' + f.value).join('|')
  useScene(wrapRef, (c) => {
    const off = cleanups()
    const sec = wrapRef.current.querySelector('.cin-figures')
    const values = [...sec.querySelectorAll('.cin-fig__value')]
    // Wide screens: one number per scroll (client, 2026-09-25) - the pinned stage snaps figure by
    // figure, each step counting one number up while its line fills.
    // Phones and tablets: a compact grid, each figure counting up as it scrolls in (client, 2026-09-28:
    // the pinned stepping fought the finger there and the full-screen stage was mostly empty).
    if (c.wide && figures.length > 1) {
      sec.classList.add('is-staged')
      off(() => sec.classList.remove('is-staged'))
      off(() => values.forEach((el, i) => { el.textContent = figures[i].fmt(figures[i].value) }))
      const items = [...sec.querySelectorAll('.cin-fig')], bars = [...sec.querySelectorAll('.cin-fig__bar')]
      const dNum = sec.querySelector('.cin-dial__num'), dLab = sec.querySelector('.cin-dial__label')
      let active = -1
      gsap.set(bars, { scaleX: 0 })
      const show = (k, dir) => {
        if (k === active) return
        active = k
        items.forEach((li, j) => li.classList.toggle('is-active', j === k))
        dLab.textContent = figures[k].label
        dNum.style.setProperty('--len', String(figures[k].fmt(figures[k].value).length))
        gsap.fromTo([dNum, dLab], { yPercent: 35 * (dir || 1), opacity: 0, filter: 'blur(12px)' },
          { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out', overwrite: true, clearProps: 'transform,opacity,filter' })
      }
      const n = figures.length
      // Scroll picks the STEP; the step plays its own tween. Step s (0..n) = figures
      // 0..s-1 counted. Driving the line straight from scroll progress made it crawl
      // with every wheel tick and jump when the snap settled (client: "the line lags").
      // Now the number and its line always run together at one even speed.
      const o = { v: 0 }
      let step = -1, tw = null
      const paint = (k) => {
        dNum.textContent = figures[k].fmt(Math.round(figures[k].value * o.v))
        gsap.set(bars[k], { scaleX: o.v })
      }
      const go = (st, dir) => {
        if (st === step) return
        const back = step >= 0 && st < step
        step = st
        const k = Math.min(n - 1, Math.max(0, st - 1))
        show(k, dir)
        // earlier lines stay full, later ones empty out
        bars.forEach((bar, j) => { if (j !== k) gsap.to(bar, { scaleX: j < k ? 1 : 0, duration: 0.45, ease: 'power2.out', overwrite: true }) })
        if (tw) tw.kill()
        gsap.killTweensOf(bars[k])
        const target = st === 0 ? 0 : 1
        if (!back && target === 1) o.v = 0          // a new number starts from zero
        tw = gsap.to(o, {
          v: target, duration: target ? 1.15 : 0.45, ease: target ? 'power2.out' : 'power2.inOut',
          onUpdate: () => paint(k), onComplete: () => paint(k),
        })
        paint(k)
      }
      go(0, 1)
      // One scroll = one step. With smooth scroll (Lenis, mouse/trackpad) the step glides
      // the page itself and ignores further wheel input until it lands - ScrollTrigger's
      // own snap fought Lenis (the page crept back mid-glide and the line restarted).
      // Touch has no Lenis, so it keeps ScrollTrigger's snap.
      const lenis = getLenis()
      let moving = false, guard = null
      // a step changes only once the scroll leaves the current step's point by 5%
      const pick = (x) => (x > step + 0.05 ? Math.ceil(x - 0.05) : x < step - 0.05 ? Math.floor(x + 0.05) : step)
      ScrollTrigger.create({
        trigger: sec,
        start: () => 'top ' + headerH() + 'px',
        end: () => '+=' + Math.round(window.innerHeight * 0.7 * n),
        pin: true, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 2,
        snap: lenis ? false : { snapTo: 1 / n, directional: true, delay: 0.02, duration: { min: 0.35, max: 0.7 }, ease: 'power2.inOut' },
        onUpdate: (self) => {
          if (moving) return
          const k = Math.min(n, Math.max(0, pick(self.progress * n)))
          if (k === step) return
          const dir = k > step ? 1 : -1
          go(k, dir)
          if (lenis) {
            moving = true
            clearTimeout(guard)
            guard = setTimeout(() => { moving = false }, 1400)      // never stay locked if the glide is interrupted
            lenis.scrollTo(self.start + (k / n) * (self.end - self.start), {
              duration: 0.85, easing: (t) => 1 - Math.pow(1 - t, 3), lock: true, force: true,
              onComplete: () => { moving = false; clearTimeout(guard) },
            })
          }
        },
        onRefresh: (self) => { if (!moving) go(Math.round(self.progress * n), 1) },
      })
      off(() => { moving = false; clearTimeout(guard) })
      off(() => { if (tw) tw.kill(); gsap.killTweensOf(bars) })
      off(() => items.forEach((li) => li.classList.remove('is-active')))
    } else {
      values.forEach((el, i) => off(countUp(el, figures[i].value, figures[i].fmt)))
    }
    return off.run
  }, [sig])

  return (
    <div ref={wrapRef}>
      <section className="cin-sec cin-figures" aria-labelledby="cin-numbers-h" style={{ '--n': figures.length, '--cols': figures.length + (figures.some((f) => f.money) ? 1 : 0) }}>
        <div className="cin-figures__stage">
          <div className="cin-figures__head">
            <SectionHead id="cin-numbers-h" title="Our Projects" />
            {yearLabel ? <p className="cin-figures__note">Rotary year {yearLabel}</p> : null}
          </div>
          <div className="cin-dial" aria-hidden="true"><div className="cin-dial__num" /><div className="cin-dial__label" /></div>
          <ul className="cin-figs" key={sig}>
            {figures.map((f) => (
              <li key={f.key} className={'cin-fig' + (f.money ? ' cin-fig--money' : '')}>
                <span className="cin-fig__bar" aria-hidden="true" />
                <span className="cin-fig__value">{f.fmt(f.value)}</span>
                <span className="cin-fig__label">{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

// ── 4 · projects: the film reel ──────────────────────────────────────────────
function Projects({ featured, yearId }) {
  const wrapRef = useRef(null)
  const sig = featured.map((p) => p.id).join(',')
  useScene(wrapRef, (c) => {
    const root = wrapRef.current
    const sec = root.querySelector('.cin-reel'), track = root.querySelector('.cin-track')
    if (!track) return undefined
    if (c.wide && featured.length >= 3) {
      return reel({ section: sec, stage: root.querySelector('.cin-reel__stage'), track, bar: root.querySelector('.cin-reel__bar > span'), media: '.cin-card__fill', refreshPriority: 1 })
    }
    track.querySelectorAll('.cin-card').forEach((card) => riseIn(card, { y: 40, start: 'top 90%' }))
    return undefined
  }, [sig])
  useRefreshOnImages(wrapRef, [sig])

  return (
    <div ref={wrapRef}>
      <section className="cin-sec cin-reel cin-projects" aria-labelledby="cin-projects-h">
        <div className="cin-reel__stage">
          <SectionHead id="cin-projects-h" title="Our projects" action={<Button href="/projects" variant="line">View all projects <Arrow /></Button>} />
          {featured.length ? (
            <>
              <ul className="cin-track">
                {featured.map((p) => (
                  <FrameCard key={p.id} layout="reel" whole img={p.img} title={p.title}
                    href={withYear('/project?pid=' + p.id, yearId)}
                    meta={p.avenueLabel ? <Pill>{p.avenueLabel}</Pill> : null}
                    text={cutText(plainText(p.desc), 200)} />
                ))}
              </ul>
              <div className="cin-reel__bar" aria-hidden="true"><span /></div>
            </>
          ) : (
            <EmptyState as="h3" title="No projects published yet" message="Projects for this Rotary year will appear here once the club publishes them." />
          )}
        </div>
      </section>
    </div>
  )
}

// ── dialogs: portalled to <body>, the site behind inert (useModal), Esc closes,
//    focus lands on Close and returns to whatever opened it ───────────────────
const CloseIco = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
)
function Dialog({ open, onClose, labelledBy, label, className = '', returnRef, closeLabel = 'Close', children }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  useModal(open, returnRef, null)
  useLayoutEffect(() => {
    if (!open) return undefined
    if (closeRef.current) closeRef.current.focus({ preventScroll: true })
    // no Escape and no backdrop click: only the close button closes it (client, 2026-09-28)
    let t = null
    if (!prefersReducedMotion() && panelRef.current) {
      t = gsap.timeline()
      t.fromTo(panelRef.current, { clipPath: 'inset(49.5% 0% 49.5% 0% round 24px)' }, { clipPath: 'inset(0% 0% 0% 0% round 24px)', duration: 0.75, ease: 'expo.inOut', clearProps: 'clipPath' })
        .from(panelRef.current.querySelectorAll('[data-rise]'), { y: 26, opacity: 0, duration: 0.7, ease: EXPO, stagger: 0.06, clearProps: 'transform,opacity' }, 0.35)
    }
    return () => { if (t) t.revert() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!open) return null
  return createPortal(
    <div className={'cin-dlg ' + className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      <div className="cin-dlg__bg" aria-hidden="true" />
      <div className="cin-dlg__panel" ref={panelRef}>
        <button type="button" className="cin-dlg__x" ref={closeRef} onClick={onClose}>
          <span className="cin-sr">{closeLabel}</span><CloseIco />
        </button>
        {children}
      </div>
    </div>, document.body)
}

// ── 2 · leadership: RI President, DG, President, Secretary - dealt in ─────────
// "Read more" opens the person's own page - /dignitary?Type=1|2|4|5, the profile
// page for all four - in the selected Rotary year (client, 2026-09-28: not on
// the home page; the earlier on-page spotlight panel is gone).
const LEADER_ORDER = { 1: 0, 2: 1, 4: 2, 5: 3 }

function leaderScope(type, district) {
  if (type === 1) return 'Rotary International'
  if (type === 2) return district ? 'District ' + district : 'The district'
  return 'Our club'
}

function Leaders({ leaders, district, yearId }) {
  const ref = useRef(null)
  const sig = leaders.map((l) => l.type + ':' + l.name).join('|')
  useScene(ref, (c) => {
    const root = ref.current
    const cards = root.querySelectorAll('.cin-lead')
    const tl = gsap.timeline({ scrollTrigger: { trigger: root.querySelector('.cin-leads'), start: 'top 82%', once: true } })
    tl.from(cards, {
      y: 110, rotationY: -24, rotationX: 12, opacity: 0, transformPerspective: 1100, transformOrigin: '50% 100%',
      duration: 1.25, ease: EXPO, stagger: 0.12, clearProps: 'transform,transformOrigin,opacity',
    }, 0)
      .from(root.querySelectorAll('.cin-lead__img'), { scale: 1.35, duration: 1.8, ease: 'power3.out', stagger: 0.12, clearProps: 'transform' }, 0)
      .from(root.querySelectorAll('.cin-lead__rule'), { scaleX: 0, duration: 0.9, ease: EXPO, stagger: 0.12, clearProps: 'transform' }, 0.45)
      .from(root.querySelectorAll('.cin-lead__txt > :not(.cin-lead__rule)'), { y: 22, opacity: 0, duration: 0.8, ease: EXPO, stagger: 0.05, clearProps: 'transform,opacity' }, 0.5)
  }, [sig])
  useRefreshOnImages(ref, [sig])

  return (
    <section ref={ref} className="cin-sec cin-leaders" aria-labelledby="cin-leaders-h">
      <SectionHead id="cin-leaders-h" title="Leadership" />
      <ul className="cin-leads" style={{ '--n': Math.min(leaders.length, 4) }}>
        {leaders.map((l) => {
          return (
            <li key={l.type} className="cin-lead">
              <div className="cin-lead__in">
                <div className="cin-lead__photo">
                  <PersonPhoto key={l.img || l.name} src={l.img} name={l.name} alt={l.name} className="cin-lead__img" monoClass="cin-lead__mono" width="480" height="600" />
                  <span className="cin-lead__scope">{leaderScope(l.type, district)}</span>
                </div>
                <div className="cin-lead__txt">
                  <span className="cin-lead__rule" aria-hidden="true" />
                  <p className="cin-lead__role">{String(l.role).replace(/(\d)-(\d)/g, '$1‑$2')}</p>
                  <h3 className="cin-lead__name">{l.name}</h3>
                  <a className="cin-lead__more" href={withYear('/dignitary?Type=' + l.type, yearId)}>
                    Read more<span className="cin-sr"> about {l.name}</span> <Arrow />
                  </a>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── 6 · upcoming events: the soonest one (homeData hands the home one event) ──
function UpcomingEvents({ ev }) {
  const ref = useRef(null)
  useScene(ref, () => { wipeIn(ref.current.querySelectorAll('.cin-next__card'), { radius: 24 }) }, [ev.id])
  return (
    <section ref={ref} className="cin-sec cin-next" aria-labelledby="cin-next-h">
      <SectionHead id="cin-next-h" title="Upcoming events" action={<Button href="/events" variant="line">All events <Arrow /></Button>} />
      <article className="cin-next__card">
        <div className="cin-next__media">
          {ev.img ? <img src={ev.img} alt="" loading="lazy" decoding="async" width="800" height="600" onError={hideOnError} /> : null}
        </div>
        <div className="cin-next__body">
          <DateStamp day={ev.day} mon={ev.mon} year={ev.year} />
          <h3 className="cin-next__t"><a href={'/event?id=' + ev.id}>{ev.title}</a></h3>
          <p className="cin-next__where">{[ev.time, ev.venue].filter(Boolean).join(' · ')}</p>
          {ev.desc ? <p className="cin-next__x">{cutText(plainText(ev.desc), 220)}</p> : null}
          <span className="cin-next__go" aria-hidden="true">Event details <Arrow /></span>
        </div>
      </article>
    </section>
  )
}

// ── 7 · newsletters + where we meet, one row. Where we meet is the clapperboard
//    SLATE (the design the About page had; client, 2026-09-25): the clapper
//    snaps shut as it scrolls in and the meeting day floats up letter by letter.
const longestWord = (s) => Math.max(4, ...String(s || '').split(/\s+/).map((w) => w.length))

function NewsAndMeet({ items, day, time, venue, mapUrl }) {
  const ref = useRef(null)
  const any = has(day) || has(time) || has(venue)
  useScene(ref, (c, ctx) => {
    const root = ref.current
    const off = cleanups()
    const news = root.querySelector('.cin-nm__news')
    if (news) wipeIn(news, { trigger: root.querySelector('.cin-nm') })
    riseIn(root.querySelectorAll('.cin-issue'), { trigger: root.querySelector('.cin-nm'), stagger: 0.08, start: 'top 80%' })
    const slate = root.querySelector('.cin-slate'), clap = root.querySelector('.cin-slate__clap')
    if (slate && clap) {
      // the clapper opens by ~40px at its tip whatever the board's width (more reached into the card above on phones)
      const open = -Math.min(12, (Math.atan2(40, clap.offsetWidth || 400) * 180) / Math.PI)
      gsap.fromTo(clap, { rotation: open }, {
        rotation: 0, duration: 0.5, ease: 'power4.in', delay: 0.1, clearProps: 'transform',
        scrollTrigger: { trigger: slate, start: 'top 80%', once: true },
      })
      riseIn(root.querySelectorAll('.cin-slate__f:not(.cin-slate__f--day)'), { trigger: root.querySelector('.cin-slate__dl'), start: 'top 78%' })
    }
    off(afterFonts(ctx, () => lettersFloat(root.querySelector('.cin-slate__dayvis'), { start: 'top 92%', end: 'top 60%' })))
    return off.run
  }, [items.length, day, time, venue])
  return (
    <section ref={ref} className="cin-sec cin-nmsec" aria-label="Newsletters and where we meet">
      <div className={'cin-nm' + (items.length ? '' : ' is-solo')}>
        {items.length ? (
          <div className="cin-nm__col cin-nm__news">
            <div className="cin-nm__head">
              <p className="cin-nm__eyebrow" aria-hidden="true">Latest newsletters</p>
              <h2 className="cin-nm__h" id="cin-news-h">Newsletters</h2>
            </div>
            <ol className="cin-issues">
              {items.map((n, i) => {
                const pdf = /\.pdf($|[?#])/i.test(n.url || '')
                return (
                  <li key={i} className="cin-issue">
                    <DateStamp day={n.day} mon={n.mon} year={n.year} />
                    <div className="cin-issue__txt">
                      <h3 className="cin-issue__t">{n.url
                        ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}<span className="cin-sr"> ({pdf ? 'PDF, ' : ''}opens in a new tab)</span></a>
                        : n.title}</h3>
                    </div>
                    {n.url ? <span className="cin-issue__go" aria-hidden="true"><ArrowOut /></span> : null}
                  </li>
                )
              })}
            </ol>
            <Button href="/newsletters" variant="line">All newsletters <Arrow /></Button>
          </div>
        ) : null}
        <div className="cin-nm__col cin-nm__meet">
          <div className="cin-slate">
            <div className="cin-slate__sticks" aria-hidden="true">
              <span className="cin-slate__clap" />
              <span className="cin-slate__base" />
            </div>
            <div className="cin-slate__board">
              <h2 className="cin-slate__h" id="cin-meet-h">Where we meet</h2>
              {any ? (
                <dl className="cin-slate__dl">
                  {has(day) ? (
                    <div className="cin-slate__f cin-slate__f--day">
                      <dt>Day</dt>
                      <dd className="cin-slate__day" style={{ '--lw': longestWord(day) }}>
                        <span className="cin-sr">{day}</span>
                        <span className="cin-slate__dayvis" aria-hidden="true" key={day}>{day}</span>
                      </dd>
                    </div>
                  ) : null}
                  {has(time) ? (
                    <div className="cin-slate__f">
                      <dt>Time</dt>
                      <dd className="cin-slate__time">{time}</dd>
                    </div>
                  ) : null}
                  {has(venue) ? (
                    <div className="cin-slate__f cin-slate__f--venue">
                      <dt>Venue</dt>
                      <dd className="cin-slate__venue">
                        <address>{venue}</address>
                        {mapUrl ? <Button href={mapUrl} external className="cin-slate__go">Open in Maps <ArrowOut /></Button> : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : <p className="cin-slate__none">Meeting day, time and venue for this Rotary year haven’t been published yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── the club's advertisements: a popup once per visit, with a close button ──
const AD_MS = 5000
function AdPopup({ ads, clubId }) {
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const backRef = useRef(null)
  const n = ads.length

  // Every time the home page opens - a reload included (client, 2026-09-28; it used to show once per tab).
  useEffect(() => {
    if (!n) return undefined
    const t = setTimeout(() => {
      backRef.current = document.activeElement
      setOpen(true)
    }, 0)   // instantly once the ads are in (client, 2026-09-29; was 2.6s)
    return () => clearTimeout(t)
  }, [n, clubId])

  useEffect(() => {
    if (!open || n < 2 || hold || prefersReducedMotion()) return undefined
    const t = setInterval(() => setI((k) => (k + 1) % n), AD_MS)
    return () => clearInterval(t)
  }, [open, n, hold])

  if (!n) return null
  const k0 = i % n
  const a = ads[k0]
  const name = a.title || 'Advertisement ' + (k0 + 1)
  const img = <img key={a.img} className="cin-adpop__img" src={a.img} data-fallbacks={a.fallbacks} alt={a.url !== '#' ? '' : name} decoding="async" onError={imgFallback} />
  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Advertisement" className="cin-dlg--ad" returnRef={backRef} closeLabel="Close advertisement">
      <div className="cin-adpop" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
        <div className="cin-adpop__frame" data-rise="">
          {a.url !== '#'
            ? <a className="cin-adpop__link" href={a.url} {...adAnchorProps(a.url)}>{img}<span className="cin-sr">{name} (opens in a new tab)</span></a>
            : img}
        </div>
        {n > 1 ? (
          <div className="cin-adpop__ctrl" role="group" aria-label="Advertisements">
            <button type="button" className="cin-adpop__step is-prev" onClick={() => setI((k) => (k - 1 + n) % n)}><span className="cin-sr">Previous advertisement</span><Arrow /></button>
            {ads.map((x, k) => (
              <button key={k} type="button" className="cin-dot" aria-current={k === k0 ? 'true' : 'false'} onClick={() => setI(k)}>
                <span className="cin-sr">Show advertisement {k + 1}</span><span aria-hidden="true" />
              </button>
            ))}
            <button type="button" className="cin-adpop__step" onClick={() => setI((k) => (k + 1) % n)}><span className="cin-sr">Next advertisement</span><Arrow /></button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { featuredTake: 8, newsletterTake: 5 }) // 5 fill the column beside the meeting (client, 2026-10-06)
  usePageTitle(club.clubDisplayName)

  const names = clubNames(club.clubDisplayName)
  const yearLabel = yearText(club.selectedYearLabel)
  const district = d.about && d.about.districtNumber ? String(d.about.districtNumber).trim() : ''
  const banners = useTrimmedBanners(d.banners)
  // banners always carry at least the fallback once data is in; the intro waits for the crop
  const ready = d.banners.length > 0 && banners.done

  const lines = useMemo(() => aboutLines(d.about && d.about.content), [d.about])

  const figures = useMemo(() => {
    const n = d.impactNumbers || {}
    const cur = n.currency || d.currency
    const members = (d.membershipStats[0] && d.membershipStats[0].value) || 0
    return [
      { key: 'beneficiaries', label: 'Beneficiaries', value: n.beneficiaries },
      { key: 'projects', label: 'Projects', value: n.projects },
      { key: 'manHours', label: 'Man-hours', value: n.manHours },
      { key: 'totalCost', label: 'Total project cost', value: n.totalCost, money: true },
      { key: 'members', label: 'Members', value: members },
    ].filter((f) => Number(f.value) > 0)
      .map((f) => ({ ...f, value: Number(f.value), fmt: (v) => (f.money ? formatMoney(v, cur) : groupInt(v, cur)) }))
  }, [d.impactNumbers, d.membershipStats, d.currency])

  const leaders = useMemo(() => d.leaders
    .filter((l) => l && has(l.name) && l.name !== 'Not available')
    .sort((a, b) => (LEADER_ORDER[a.type] ?? 9) - (LEADER_ORDER[b.type] ?? 9)), [d.leaders])

  // homeData pads an empty ad list with a stock placeholder; only the club's own ads pop up.
  const ads = d.ads.filter((a) => a && a.img && !/ClubAdvirtisment\.png$/i.test(a.img))

  return (
    <div className="cin-home">
      <Hero banners={banners.list} ready={ready} names={names} district={district} yearLabel={yearLabel} />
      {ready && leaders.length ? <Leaders leaders={leaders} district={district} yearId={club.selectedYearId} /> : null}
      {ready && figures.length ? <Figures figures={figures} yearLabel={yearLabel} /> : null}
      {ready && lines && lines.statement ? <About lines={lines} /> : null}
      {ready ? <Projects featured={d.featured} yearId={club.selectedYearId} /> : null}
      {ready && d.events.length ? <UpcomingEvents ev={d.events[0]} /> : null}
      {ready ? <NewsAndMeet items={d.newsletters} day={d.meetingDay} time={d.meetingTime} venue={d.meetingVenue} mapUrl={d.mapUrl} /> : null}
      {ads.length ? <AdPopup ads={ads} clubId={club.clubId} /> : null}   {/* as soon as the ads are in - not after the banners (client, 2026-09-29) */}
    </div>
  )
}
