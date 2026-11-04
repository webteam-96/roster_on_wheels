'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY — the home page (Theme8-Samples/F-horizontal-journey).
//
// Dawn over layered ridges; scrolling climbs the cranberry front hill into ONE
// pinned horizontal track whose sky runs through the Rotary palette, one colour
// per chapter, while a low sun crosses it and sets before the last chapter's
// night. Wide + motion desktops only (>= 900 x 620); phones, short windows and
// reduced motion get the same chapters stacked vertically.
//
// Every chapter is the club's live data (useHomeData). A chapter with nothing
// to show is left out, so the sky and the numbering follow what is actually
// there (no chapter bar along the bottom - client, 2026-10-01):
//   Our story      the club's about text, first five lines + Read more (client, 2026-09-29)
//   Our impact     impact figures + active members, each with a matching icon, all in one view
//   Our projects   featured projects (designed empty state when none)
//   Our leaders    RI president, DG, president, secretary (placeholders dropped); Read more
// The hero is the banner alone, full size, shaped to each slide's photo (client, 2026-09-29).
//   Club news      next event, two newest newsletters, real advertisements
//   Where we meet  meeting day/time/venue (designed empty line when none)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useClub, useHomeData, usePageTitle, withYear, formatMoney, groupInt, adAnchorProps } from '../_shared/data.js'
import { imgFallback } from '../_shared/kit.jsx'
import {
  gsap, useScene, afterFonts, useRefreshOnImages, refreshSoon, useMedia, headerH, scrollToY,
  split, titleIn, rise, parallax, archOpen, fanIn, countUp, drawRidge, RIDGE, prefersReducedMotion, MOTION_OK,
} from './motion.js'
import { Ridge, Button, PhotoCard, Portrait, EmptyState, htmlText, cut, yearText, coverTitle, IconArrow } from './kit.jsx'
import './home.css'

const TONE = { leaders: 'turq', numbers: 'gold', events: 'violet', story: 'cran', projects: 'azure', newsletters: 'gold', meet: 'royal' }
const LEAD_ORDER = { 1: 0, 2: 1, 4: 2, 5: 3 }
const AD_PLACEHOLDER = /ClubAdvirtisment\.png$/i
const pad = (n) => String(n).padStart(2, '0')

/** Each figure IS a silhouette of what it counts (client, 2026-09-29: "icon shape instead of square"):
 *  the number sits inside the shape's body. viewBox 0 0 120 140; --ty is where the text block centres;
 *  nw / lw = how much of the shape's width (%) the number / the label may take at their height in it. */
const FIG_SHAPE = {
  // a person: head + shoulders
  member: { ty: '69%', nw: 60, lw: 80, d: 'M60 4a27 27 0 1 1 0 54a27 27 0 1 1 0-54zM4 140v-26c0-30 24-52 56-52s56 22 56 52v26z' },
  // two people, one behind the other
  people: { ty: '71%', nw: 66, lw: 84, d: 'M40 8a22 22 0 1 1 0 44a22 22 0 1 1 0-44zM86 14a18 18 0 1 1 0 36a18 18 0 1 1 0-36zM2 140v-28c0-28 20-48 48-48h22c28 0 46 20 46 48v28z' },
  // a clipboard with its clip
  projects: { ty: '58%', nw: 74, lw: 80, d: 'M44 2h32a6 6 0 0 1 6 6v8h20a12 12 0 0 1 12 12v100a12 12 0 0 1-12 12H18a12 12 0 0 1-12-12V28a12 12 0 0 1 12-12h20V8a6 6 0 0 1 6-6z' },
  // a stopwatch: the dial and its crown
  hours: { ty: '60%', nw: 72, lw: 76, d: 'M48 2h24v12h-6v6a58 58 0 1 1-12 0v-6h-6zM60 24a57 57 0 1 1 0 114a57 57 0 1 1 0-114z' },
  // a money bag tied at the neck
  money: { ty: '66%', nw: 72, lw: 84, d: 'M40 4h40l-10 22c30 12 46 42 46 72c0 26-22 40-56 40S4 124 4 98c0-30 16-60 46-72z' },
}
// A figure is sized to FIT its shape (client, 2026-10-01: the total cost ran out of the money bag on tablets and
// small laptops, and a big club's figures ran out everywhere): font-size = allowed width / text width in em
// (home.css .hj-fg__n / .hj-fg__l). Advances measured in the theme's fonts - Unbounded 700 at -.03em: digit .75,
// comma/point .27, space .22, rupee .76 (other characters counted wide); Figtree 750 caps at .04em: the labels.
const numEm = (s) => [...String(s)].reduce((w, ch) => w + (ch >= '0' && ch <= '9' ? 0.75 : ch === ',' || ch === '.' ? 0.28 : ch === ' ' ? 0.22 : 0.85), 0)
const LABEL_EM = { Beneficiaries: 7.81, Projects: 5.44, 'Man-hours': 6.62, 'Total cost': 6.5, Members: 5.04 }
const has = (v) => !!v && v !== '—' && String(v).trim() !== ''

// ── hero banner slideshow ────────────────────────────────────────────────────
function Banner({ banners, clubName }) {
  const n = banners.length
  const [cur, setCur] = useState(0)
  const [prev, setPrev] = useState(-1)
  const [paused, setPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const motion = useMedia(MOTION_OK)
  const auto = motion && n > 1
  const boxRef = useRef(null)
  const inView = useRef(true)
  const sig = banners.map((b) => b.src).join('|')
  const [shapes, setShapes] = useState({})   // slide -> its photo's width / height
  const shapeOf = (e, i) => {
    const im = e.currentTarget
    if (im.naturalWidth && im.naturalHeight) setShapes((s) => (s[i] ? s : { ...s, [i]: im.naturalWidth / im.naturalHeight }))
  }
  const ar = Math.min(4, Math.max(1.3, shapes[cur] || 3))

  useEffect(() => { setCur(0); setPrev(-1); setShapes({}) }, [sig])
  useEffect(() => {
    const el = boxRef.current
    if (!el || !('IntersectionObserver' in window)) return undefined
    const io = new IntersectionObserver((en) => { inView.current = en[0].isIntersecting })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const go = (k) => {
    if (n < 2) return
    const next = ((k % n) + n) % n
    if (next === cur) return
    setPrev(cur)
    setCur(next)
  }
  useEffect(() => {
    if (!auto || paused || held) return undefined
    const t = setInterval(() => { if (inView.current && !document.hidden) go(cur + 1) }, 6000)
    return () => clearInterval(t)
  })

  // incoming slide wipes in from the right over the outgoing one
  useLayoutEffect(() => {
    if (prev < 0) return undefined
    const box = boxRef.current
    const inc = box && box.querySelectorAll('.hj-bn__s')[cur]
    if (!inc || prefersReducedMotion()) { setPrev(-1); return undefined }
    const img = inc.querySelector('.hj-bn__img')
    const a = gsap.fromTo(inc, { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, ease: 'expo.inOut', clearProps: 'clipPath', onComplete: () => setPrev(-1) })
    const b = img ? gsap.fromTo(img, { xPercent: 10 }, { xPercent: 0, duration: 1.5, ease: 'expo.out', clearProps: 'transform' }) : null
    return () => { a.kill(); if (b) b.kill(); gsap.set(img ? [inc, img] : [inc], { clearProps: 'clipPath,transform' }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur])

  return (
    <div className="hj-hero__banner"
         onFocusCapture={() => setHeld(true)}
         onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false) }}>
      <div className="hj-bn-card" ref={boxRef} style={{ '--hj-ar': ar.toFixed(3) }}>
        {banners.map((b, i) => {
          const cls = 'hj-bn__s' + (i === cur ? ' is-on is-top' : i === prev ? ' is-on' : '')
          const alt = b.title || clubName + ' banner ' + (i + 1) + ' of ' + n
          const art = (
            <>
              <img className="hj-bn__fill" src={b.src} data-fallbacks={b.fallbacks} alt="" aria-hidden="true" loading={i ? 'lazy' : 'eager'} onError={imgFallback} />
              <img className="hj-bn__img" src={b.src} data-fallbacks={b.fallbacks} alt={alt} width="1700" height="531"
                   loading={i ? 'lazy' : 'eager'} fetchpriority={i ? undefined : 'high'} onLoad={(e) => shapeOf(e, i)} onError={imgFallback} />
            </>
          )
          return b.url
            ? <a key={i} className={cls} href={b.url} {...adAnchorProps(b.url)}>{art}<span className="hj-sr"> (opens in a new tab)</span></a>
            : <div key={i} className={cls}>{art}</div>
        })}
      </div>
      {n > 1 && (
        <div className="hj-bn__ctrl" role="group" aria-label="Banner slideshow">
          <span className="hj-bn__dots">
            {banners.map((_, i) => (
              <button key={i} type="button" className="hj-dot" aria-current={i === cur ? 'true' : 'false'} onClick={() => go(i)}>
                <span className="hj-sr">Show banner {i + 1}</span><span aria-hidden="true" />
              </button>
            ))}
          </span>
          {/* no Pause button on the banner (client, 2026-10-06); hover / focus still hold it, reduced motion never autoplays */}
        </div>
      )}
    </div>
  )
}

// ── advertisement card (club news chapter) ───────────────────────────────────
function AdCard({ ads }) {
  const n = ads.length
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  const motion = useMedia(MOTION_OK)
  useEffect(() => { setI(0) }, [n])
  useEffect(() => {
    if (!motion || n < 2 || held) return undefined
    const t = setInterval(() => { if (!document.hidden) setI((k) => (k + 1) % n) }, 5500)
    return () => clearInterval(t)
  }, [motion, n, held])
  return (
    <div className="hj-ad" onFocusCapture={() => setHeld(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false) }}>
      <div className="hj-news__box hj-ad__frame">
        {ads.map((a, k) => {
          const cls = 'hj-ad__s' + (k === i ? ' is-on' : '')
          const img = <img src={a.img} data-fallbacks={a.fallbacks} alt={a.title || 'Advertisement ' + (k + 1)} loading="lazy" decoding="async" onError={imgFallback} />
          return a.url && a.url !== '#'
            ? <a key={k} className={cls} href={a.url} {...adAnchorProps(a.url)}>{img}<span className="hj-sr"> (opens in a new tab)</span></a>
            : <div key={k} className={cls}>{img}</div>
        })}
      </div>
      {n > 1 && (
        <div className="hj-ad__ctrl" role="group" aria-label="Advertisements">
          <button type="button" onClick={() => setI((i - 1 + n) % n)}><span className="hj-sr">Previous advertisement</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>
          <span aria-live="polite">{i + 1} / {n}</span>
          <button type="button" onClick={() => setI((i + 1) % n)}><span className="hj-sr">Next advertisement</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { featuredTake: 7, newsletterTake: 2 })
  usePageTitle(club.clubDisplayName)
  const rootRef = useRef(null)
  const tall = useMedia('(min-height: 620px)')
  const ready = !d.loading

  const clubName = club.clubDisplayName
  const yr = yearText(club.selectedYearLabel)
  const storyText = useMemo(() => htmlText(d.about && d.about.content), [d.about])

  // ── figures ────────────────────────────────────────────────────────────────
  const cur = d.currency
  const inum = d.impactNumbers
  const members = d.membershipStats[0] ? d.membershipStats[0].value : 0
  const compactCost = formatMoney(inum.totalCost, cur).length > 11
  const figs = [   // order (client, 2026-10-27): projects, cost, beneficiaries, man-hours, members
    { v: inum.projects, label: 'Projects', icon: 'projects', tone: 'cran' },
    { v: inum.totalCost, label: 'Total cost', icon: 'money', tone: 'azure', fmt: (n) => formatMoney(n, cur, compactCost ? { compact: true } : undefined) },
    { v: inum.beneficiaries, label: 'Beneficiaries', icon: 'people', tone: 'royal' },
    { v: inum.manHours, label: 'Man-hours', icon: 'hours', tone: 'ink' },
    { v: members, label: 'Members', icon: 'member', tone: 'violet' },
  ].filter((f) => f.v > 0).map((f) => ({ ...f, fmt: f.fmt || ((n) => groupInt(n, cur)) }))

  // ── people, news, meeting ──────────────────────────────────────────────────
  const leaders = d.leaders
    .filter((l) => l.name && l.name !== 'Not available')
    .sort((a, b) => (LEAD_ORDER[a.type] ?? 9) - (LEAD_ORDER[b.type] ?? 9))
  const ev = d.events[0] || null
  const news = d.newsletters.slice(0, 2)
  const ads = d.ads.filter((a) => a.img && !AD_PLACEHOLDER.test(a.img))
  // the advertisements sit beside the hero banner (client, 2026-09-29), not in a news chapter
  const meetDay = has(d.meetingDay) ? String(d.meetingDay).trim() : ''
  const meetTime = has(d.meetingTime) ? String(d.meetingTime).replace(/\s+-\s+/, ' – ') : ''
  const meetVenue = has(d.meetingVenue) ? d.meetingVenue : ''
  const hasMeet = !!(meetDay || meetTime || meetVenue)

  // the client's order (2026-09-29): leaders, impact, upcoming events, about, projects, then newsletters and
  // the meeting. Events and newsletters are separate chapters, each left out when the club has none.
  const chapters = [
    leaders.length > 0 && { key: 'leaders', title: 'Our leaders' },
    figs.length > 0 && { key: 'numbers', title: 'Our impact' },
    ev && { key: 'events', title: 'Upcoming events' },
    // no data, no chapter (client, 2026-10-05) - story, projects and the meeting too, not only events/newsletters
    storyText && { key: 'story', title: 'Our story' },
    d.featured.length > 0 && { key: 'projects', title: 'Our projects' },
    news.length > 0 && { key: 'newsletters', title: 'Newsletters' },
    hasMeet && { key: 'meet', title: 'Where we meet' },
  ].filter(Boolean)
  const first = chapters[0] ? TONE[chapters[0].key] : 'cran'

  // ── motion: the hero entrance, once per visit ──────────────────────────────
  useScene(rootRef, () => {
    gsap.timeline({ delay: 0.1 })
      .from('.hj-hero__hills', { yPercent: 30, duration: 1.8, ease: 'expo.out', clearProps: 'transform' }, 0)
      .from('.hj-hero__fw', { yPercent: 12, duration: 1.8, ease: 'expo.out', clearProps: 'transform' }, 0.05)
      .from('.hj-hero__sunwrap', { yPercent: 26, duration: 2.2, ease: 'power3.out', clearProps: 'transform' }, 0)
      .from('.hj-hero__banner', { y: 60, scale: 0.94, opacity: 0, duration: 1.4, ease: 'expo.out', clearProps: 'transform,opacity' }, 0.2)
    const ad = gsap.utils.toArray('.hj-hero__ad')
    if (ad.length) gsap.from(ad, { y: 40, opacity: 0, duration: 1.4, ease: 'expo.out', delay: 0.45, clearProps: 'transform,opacity' })
  }, [])

  // ── motion: the journey (rebuilt whenever the data or the window class changes) ─
  useScene(rootRef, (c, ctx) => {
    if (!ready) return undefined
    return afterFonts(ctx, () => journey(c))
  }, [ready, tall])
  useRefreshOnImages(rootRef, [ready])

  function journey(c) {
    const root = rootRef.current
    if (!root) return undefined
    const S = c.fine ? true : 0.8   // Lenis already smooths the wheel; touch gets a short catch-up
    const off = []
    const hero = root.querySelector('.hj-hero')
    const Hh = () => hero.offsetHeight

    if (c.wide && tall) {
      // HERO pinned: sunrise, then the cranberry front hill climbs until it becomes chapter one's ground
      const ht = gsap.timeline({
        defaults: { ease: 'none', duration: 1 },
        scrollTrigger: { trigger: hero, pin: true, scrub: S, anticipatePin: 1, invalidateOnRefresh: true, start: () => 'top ' + headerH(), end: () => '+=' + Math.round(Hh() * 0.9) },
      })
      ht.to('.hj-hero__sun', { yPercent: -170, scale: 0.74 }, 0)
        .to('.hj-hero__stars', { opacity: 0, duration: 0.45 }, 0)
        .to('.hj-hero__dawn', { opacity: 1, duration: 0.8 }, 0)
        .to('.hj-hero__hills .hj-rg--hfar', { yPercent: -12 }, 0)
        .to('.hj-hero__hills .hj-rg--hmid', { yPercent: -26 }, 0)
        .to('.hj-hero__front', { y: () => -Hh() * 0.66, duration: 0.78 }, 0.22)   // linear: the track under it (.hj-jr.is-h margin) rises 1:1 with the scroll
        .to(gsap.utils.toArray('.hj-bn-card, .hj-hero__ad'), { y: () => -Hh() * 0.06, scale: 0.94, duration: 0.6 }, 0)
      const ctrl = gsap.utils.toArray('.hj-bn__ctrl')
      // autoAlpha: faded-out dots must not stay clickable
      if (ctrl.length) ht.to(ctrl, { autoAlpha: 0, duration: 0.3 }, 0.3)
      // keyboard focus landing in the faded, pinned hero (Shift+Tab back from the journey) brings the dawn back
      const onHeroFocus = (e) => { if (e.target.matches && e.target.matches(':focus-visible') && window.scrollY > 2) scrollToY(0, true) }
      hero.addEventListener('focusin', onHeroFocus)
      off.push(() => hero.removeEventListener('focusin', onHeroFocus))
      horizontal(root, S, off)
    } else {
      // phones/tablets: the hero parts as it leaves
      const ht = gsap.timeline({
        defaults: { ease: 'none', duration: 1 },
        scrollTrigger: { trigger: hero, scrub: true, invalidateOnRefresh: true, start: () => 'top ' + headerH(), end: 'bottom top' },
      })
      ht.to('.hj-hero__sun', { yPercent: -90 }, 0)
        .to('.hj-hero__hills .hj-rg--hfar', { yPercent: -8 }, 0)
        .to('.hj-hero__hills .hj-rg--hmid', { yPercent: -18 }, 0)
        .to('.hj-hero__front', { y: () => -Hh() * 0.28 }, 0)
      vertical(root, S)
    }
    return () => off.forEach((f) => f())
  }

  // DESKTOP: one pinned horizontal track, driven by vertical scroll
  function horizontal(root, S, off) {
    const jr = root.querySelector('.hj-jr')
    const track = jr.querySelector('.hj-track')
    const panels = gsap.utils.toArray(track.querySelectorAll('.hj-pn'))
    const n = panels.length
    const sky = track.querySelector('.hj-sky'), sun = track.querySelector('.hj-sun'), sunset = sun.querySelector('b')
    const L = [
      { el: track.querySelector('.hj-hl--far'), f: 0.5, o: RIDGE.far },
      { el: track.querySelector('.hj-hl--mid'), f: 0.28, o: RIDGE.mid },
      { el: track.querySelector('.hj-hl--near'), f: -0.16, o: RIDGE.near },
    ]
    let vw = 0, H = 0, tw = 0, dist = 1, starts = [], widths = [], sunS = 0
    jr.classList.add('is-h')
    off.push(() => {
      jr.classList.remove('is-h')
      sky.style.removeProperty('--hj-sky')
      L.forEach((l) => { l.el.innerHTML = ''; l.el.style.width = '' })
    })

    // measure the track, paint the sky (one colour per chapter, blended across each border), draw the ridges
    function layout() {
      vw = jr.clientWidth; H = jr.clientHeight; tw = track.offsetWidth; dist = Math.max(1, tw - vw)
      starts = panels.map((p) => p.offsetLeft)
      widths = panels.map((p) => p.offsetWidth)
      const b = Math.round(vw * 0.1), stops = []
      panels.forEach((p, i) => {
        const col = getComputedStyle(p).getPropertyValue('--hj-c').trim()
        stops.push(col + ' ' + (i ? starts[i] + b : 0) + 'px', col + ' ' + (i < n - 1 ? starts[i] + widths[i] - b : tw) + 'px')
      })
      sky.style.setProperty('--hj-sky', 'linear-gradient(90deg,' + stops.join(',') + ')')
      L.forEach((l) => drawRidge(l.el, Math.ceil((1 - l.f) * dist + vw + 60), l.o, true))
      sunS = sun.offsetWidth
    }
    layout()

    // velocity: cards lean into the travel
    const leaners = track.querySelectorAll('.hj-pj, .hj-news__item')
    const leanTo = leaners.length ? gsap.quickTo(leaners, 'skewX', { duration: 0.6, ease: 'power3' }) : () => {}
    const settle = gsap.delayedCall(0.14, () => leanTo(0)).pause()
    const react = (self) => {
      leanTo(gsap.utils.clamp(-7, 7, self.getVelocity() / 380))
      settle.restart(true)
    }

    const tl = gsap.timeline({
      defaults: { ease: 'none', duration: 1 },
      scrollTrigger: {
        trigger: jr, pin: true, scrub: S, anticipatePin: 1, invalidateOnRefresh: true,
        start: () => 'top ' + headerH(),
        end: () => { layout(); return '+=' + dist },
        onUpdate: react,
      },
    })
    tl.to(track, { x: () => -dist }, 0)

    // ridges at three depths: far drifts slowest, the foreground ridge outruns the content
    L.forEach((l) => tl.to(l.el, { x: () => l.f * dist }, 0))
    // the sun crosses the whole journey low over the hills: rises, peaks mid-way, turns orange and sets before night
    tl.fromTo(sun, { x: () => vw * 0.1 - sunS / 2 }, { x: () => dist + vw * 0.88 - sunS / 2 }, 0)
      .fromTo(sun, { y: () => H * 0.9 - sunS / 2 }, { y: () => H * 0.66 - sunS / 2, duration: 0.42, ease: 'sine.out' }, 0)
      .fromTo(sun, { y: () => H * 0.66 - sunS / 2 }, { y: () => H * 1.02, duration: 0.46, ease: 'sine.in', immediateRender: false }, 0.42)
      .fromTo(sunset, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.56)

    const ca = (trigger, start, end) => ({ trigger, containerAnimation: tl, start, end, scrub: S, invalidateOnRefresh: true })

    // keyboard: a focused link inside an off-screen chapter brings its chapter into view
    const onFocus = (e) => {
      const t = e.target
      if (!t.matches || !t.matches(':focus-visible')) return
      const left = t.getBoundingClientRect().left - track.getBoundingClientRect().left, st = tl.scrollTrigger
      const p = gsap.utils.clamp(0, 1, (left - vw * 0.3) / dist)
      scrollToY(st.start + p * (st.end - st.start), true)
    }
    track.addEventListener('focusin', onFocus)
    off.push(() => track.removeEventListener('focusin', onFocus))

    // images inside the clipped track never reach lazy-load range until they slide in
    track.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager' })

    // chapter titles skew and scale in against the travel; giant numerals drift behind the hills
    panels.forEach((p, i) => {
      if (i === 0) return
      const h = p.querySelector('.hj-h2'), s = split(h)
      gsap.fromTo(s ? s.chars : h, { xPercent: 150, skewX: -30, scale: 1.3, opacity: 0 }, { xPercent: 0, skewX: 0, scale: 1, opacity: 1, ease: 'power3.out', stagger: 0.04, scrollTrigger: ca(h, 'left 100%', 'left 45%') })
      gsap.fromTo(p.querySelectorAll('.hj-kicker, .hj-chap__sub, .hj-chap .hj-btn'), { x: 120, opacity: 0 }, { x: 0, opacity: 1, ease: 'power2.out', stagger: 0.05, scrollTrigger: ca(h, 'left 100%', 'left 55%') })
    })

    // chapter one (whichever it is): the title arrives with the climb, before the track starts moving
    const p0 = panels[0], h0 = p0.querySelector('.hj-h2'), s0 = split(h0)
    const approach = () => ({ trigger: jr, start: 'top 88%', end: () => 'top ' + (headerH() + 30), scrub: S })
    gsap.fromTo(s0 ? s0.chars : h0, { yPercent: 110, skewY: 10, opacity: 0 }, { yPercent: 0, skewY: 0, opacity: 1, stagger: 0.05, ease: 'power3.out', scrollTrigger: approach() })
    gsap.fromTo(p0.querySelectorAll('.hj-kicker, .hj-chap__sub, .hj-story__text, .hj-chap .hj-btn'), { y: 50, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, ease: 'power2.out', scrollTrigger: approach() })

    // 02 impact: the icon cards rise in, figures count as each reaches the centre
    track.querySelectorAll('.hj-fg').forEach((f, i) => {
      gsap.fromTo(f, { yPercent: 40, scale: 0.8, opacity: 0 }, { yPercent: 0, scale: 1, opacity: 1, ease: 'back.out(1.5)', scrollTrigger: ca(f, 'left 100%', 'left 70%') })
      // counts up on its own once the shape is on screen (tied to the scroll it read 0 until it passed mid-screen)
      if (figs[i]) countUp(f.querySelector('[data-hj-n]'), figs[i].v, figs[i].fmt, { trigger: f, containerAnimation: tl, start: 'left 92%', once: true })
    })

    // 03 projects: photos wipe open, float at different speeds, and pan inside their frames
    const DRIFT = [1, -0.6, 0.8, -1, 0.5, -0.8, 0.9]
    track.querySelectorAll('.hj-pj').forEach((card, i) => {
      const dy = DRIFT[i % DRIFT.length] * 30
      gsap.fromTo(card, { y: dy }, { y: -dy, scrollTrigger: ca(card, 'left right', 'right left') })
      gsap.fromTo(card.querySelector('.hj-card__m'), { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power2.out', scrollTrigger: ca(card, 'left 105%', 'left 55%') })
      gsap.fromTo(card.querySelector('.hj-card__b'), { x: 80, opacity: 0 }, { x: 0, opacity: 1, ease: 'power2.out', scrollTrigger: ca(card, 'left 95%', 'left 50%') })
    })

    // 04 leaders: arches rise open from the ground, portraits settle, names follow
    track.querySelectorAll('.hj-ld').forEach((l, i) => {
      const a = l.querySelector('.hj-arch')
      gsap.fromTo(a, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power2.out', scrollTrigger: ca(l, 'left 100%', 'left 58%') })
      const pic = a.querySelector('.hj-arch__img')
      if (pic) gsap.fromTo(pic, { scale: 1.4 }, { scale: 1, scrollTrigger: ca(l, 'left 100%', 'left 40%') })
      gsap.fromTo(l.querySelector('.hj-ld__t'), { x: 90, opacity: 0 }, { x: 0, opacity: 1, ease: 'power2.out', scrollTrigger: ca(l, 'left 90%', 'left 50%') })
      gsap.fromTo(l, { y: i % 2 ? -20 : 20 }, { y: i % 2 ? 20 : -20, scrollTrigger: ca(l, 'left right', 'right left') })
    })

    // 05 news: the covers fan in
    track.querySelectorAll('.hj-news__item').forEach((cv, i) => {
      const r = i % 2 ? 1 : -1
      gsap.fromTo(cv, { rotation: 16 * r, xPercent: 40, yPercent: 16, opacity: 0 }, { rotation: 3 * r, xPercent: 0, yPercent: 0, opacity: 1, ease: 'power2.out', scrollTrigger: ca(cv, 'left 105%', 'left 50%') })
    })

    // 06 night: the moon rises, the stars come out, the day arrives in big type
    // the night panel is the meeting chapter - by name, since a club with no meeting details has none
    const meet = root.querySelector('.hj-pn--meet')
    if (meet) {
    gsap.fromTo(meet.querySelector('.hj-moon'), { yPercent: 160, scale: 0.7 }, { yPercent: 0, scale: 1, scrollTrigger: ca(meet, 'left 100%', 'left 15%') })
    gsap.fromTo(meet.querySelector('.hj-night .hj-stars'), { xPercent: 12 }, { xPercent: -4, scrollTrigger: ca(meet, 'left 100%', 'left 0%') })
    const dd = meet.querySelector('.hj-meet__dayt')
    if (dd) {
      const sd = split(dd, 'none')   // the visual copy is aria-hidden; the dd keeps a plain sr-only day
      gsap.fromTo(sd ? sd.chars : dd, { yPercent: 70, rotation: -12, opacity: 0 }, { yPercent: 0, rotation: 0, opacity: 1, stagger: 0.05, ease: 'back.out(1.6)', scrollTrigger: ca(meet, 'left 85%', 'left 25%') })
    }
    const rest = meet.querySelectorAll('.hj-meet__time, .hj-meet__venue, .hj-meet__go, .hj-meet__none')
    if (rest.length) gsap.fromTo(rest, { x: 100, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.08, ease: 'power2.out', scrollTrigger: ca(meet, 'left 70%', 'left 10%') })
    }
  }

  // PHONES / TABLETS / SHORT WINDOWS: vertical chapters with lighter scroll effects
  function vertical(root, S) {
    root.querySelectorAll('.hj-pn').forEach((p) => {
      titleIn(p.querySelector('.hj-h2'), { scrub: S })
      rise(p.querySelectorAll('.hj-kicker, .hj-chap__sub, .hj-story__text, .hj-chap .hj-btn'), p, { from: { y: 28 }, stagger: 0.06 })
      parallax(p.querySelector('.hj-pn__ridge .hj-rg:not(.hj-rg--front)'), { from: 35, to: -8, trigger: p, start: 'bottom bottom', end: 'bottom 30%' })
    })
    root.querySelectorAll('.hj-fg').forEach((f, i) => {
      rise(f, f, { from: { y: 30, scale: 0.85 }, ease: 'back.out(1.6)', duration: 1.1 })
      if (figs[i]) countUp(f.querySelector('[data-hj-n]'), figs[i].v, figs[i].fmt, { trigger: f, start: 'top 86%', once: true })
    })
    rise(root.querySelectorAll('.hj-pj'), root.querySelector('.hj-pj-list'), { from: { x: 70, y: 0 }, stagger: 0.08 })
    root.querySelectorAll('.hj-ld').forEach((l) => {
      archOpen(l.querySelector('.hj-arch'), { trigger: l })
      rise(l.querySelector('.hj-ld__t'), l, { from: { y: 26 } })
    })
    fanIn(root.querySelectorAll('.hj-news__item'), { trigger: root.querySelector('.hj-news') })
    const meet = root.querySelector('.hj-pn--meet')
    if (meet) {
      gsap.fromTo(meet.querySelector('.hj-moon'), { yPercent: 90, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: meet, start: 'top 85%', end: 'top 25%', scrub: true } })
      rise(meet.querySelectorAll('.hj-meet__dl > div, .hj-meet__go, .hj-meet__none'), meet.querySelector('.hj-meet'), { from: { y: 36 }, stagger: 0.08 })
    }
  }

  // a project photo's real shape sets its card width on the horizontal track
  const onPjImg = (e) => {
    const im = e.currentTarget
    const li = im.closest('.hj-pj')
    if (li && im.naturalWidth && im.naturalHeight) {
      li.style.setProperty('--hj-ar', String(Math.min(1.8, Math.max(0.75, im.naturalWidth / im.naturalHeight)).toFixed(3)))
      refreshSoon()
    }
  }

  // ── chapter bodies ─────────────────────────────────────────────────────────
  const chap = (ch, i, sub, actions) => (
    <div className="hj-chap">
      <h2 className="hj-h2" id={'hj-' + ch.key + '-h'}>{ch.title}</h2>
      {sub}
      {actions}
    </div>
  )
  const yearSub = yr ? <p className="hj-chap__sub">Rotary year {yr}</p> : null

  const body = (ch, i) => {
    switch (ch.key) {
      case 'story': return (
        // the club's own words, first five lines; the whole text is on /about (client, 2026-09-29)
        chap(ch, i,
          <p className="hj-story__text">{storyText || 'Part of Rotary International, a global network of neighbours, friends and problem-solvers who take action where they live.'}</p>,
          <p className="hj-chap__act"><Button href="/about" variant="line">Read more<span className="hj-sr"> about the club</span></Button></p>)
      )
      case 'numbers': return (
        <>
          <div className="hj-chap">
            <h2 className="hj-h2" id={'hj-' + ch.key + '-h'}>{ch.title}</h2>
            {yearSub}
          </div>
          <ul className="hj-figs" style={{ '--hj-n': figs.length }}>
            {figs.map((f) => {
              const txt = f.fmt(f.v), sh = FIG_SHAPE[f.icon]
              return (
                <li key={f.label} className={'hj-fg hj-fg--' + f.tone}
                    style={{ '--ty': sh.ty, '--hj-nw': sh.nw + 'cqi', '--hj-lw': sh.lw + 'cqi', '--hj-nem': numEm(txt).toFixed(2), '--hj-lem': LABEL_EM[f.label] || 6.6 }}>
                  <svg className="hj-fg__shape" viewBox="0 0 120 140" aria-hidden="true" focusable="false"><path d={sh.d} /></svg>
                  <span className="hj-fg__t">
                    <span className="hj-fg__n"><span aria-hidden="true" data-hj-n="">{txt}</span><span className="hj-sr">{txt}</span></span>
                    <span className="hj-fg__l">{f.label}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )
      case 'projects': return (
        <>
          {chap(ch, i, yearSub, <p className="hj-chap__act"><Button href="/projects" icon="arrow">All projects</Button></p>)}
          {d.featured.length > 0 ? (
            <ul className="hj-pj-list">
              {d.featured.map((p) => (
                <PhotoCard key={p.id} as="li" className="hj-pj" href={withYear('/project?pid=' + p.id, club.selectedYearId)}
                           img={p.img} chip={p.avenueLabel} title={p.title} desc={cut(htmlText(p.desc), 100)}
                           imgProps={{ onLoad: onPjImg, width: 400, height: 300 }} />
              ))}
            </ul>
          ) : (
            <div className="hj-pj-empty">
              <EmptyState as="h3" title="No projects published yet" message="Projects for this Rotary year will appear here as the club publishes them." />
            </div>
          )}
        </>
      )
      case 'leaders': return (
        <>
          {chap(ch, i, yearSub)}
          <ul className="hj-ld-list">
            {leaders.map((l) => (
              <li className="hj-ld" key={l.type}>
                <Portrait src={l.img} name={l.name} alt={l.name} />
                <div className="hj-ld__t">
                  <p className="hj-ld__r">{l.role}</p>
                  <h3 className="hj-ld__n">{l.name}</h3>
                  {/* no profile lines on the card - the profile page (client, 2026-09-29) */}
                  <Button className="hj-ld__more" href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)} variant="line" size="sm">
                    Read more<span className="hj-sr"> about {l.name}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )
      case 'events': return (
        <>
          {chap(ch, i, null, <p className="hj-chap__act"><Button href="/events" variant="line" size="sm">All events</Button></p>)}
          <ul className="hj-news">
            {ev && (
              <li className="hj-news__item hj-tk">
                <a className="hj-news__box hj-tk__a" href={'/event?id=' + ev.id}>
                  <span className="hj-tk__stub"><span className="hj-tk__day">{ev.day}</span><span className="hj-tk__mon">{ev.mon} {ev.year}</span></span>
                  <span className="hj-tk__body">
                    <span className="hj-tk__k">Next event</span>
                    <span className="hj-tk__t">{ev.title}</span>
                    {ev.time ? <span className="hj-tk__m">{ev.time}</span> : null}
                    <span className="hj-tk__m">{ev.venue}</span>
                    <span className="hj-tk__go">Event details <IconArrow /></span>
                  </span>
                </a>
              </li>
            )}
          </ul>
        </>
      )
      case 'newsletters': return (
        <>
          {chap(ch, i, null, <p className="hj-chap__act"><Button href="/newsletters" variant="line" size="sm">All newsletters</Button></p>)}
          <ul className="hj-news">
            {news.map((nl, k) => {
              const t = coverTitle(nl.title)
              return (
                <li key={k} className={'hj-news__item hj-cv hj-cv--' + (k % 2)}>
                  <a className="hj-news__box" href={nl.url} target="_blank" rel="noopener noreferrer">
                    <span className="hj-cv__tag" aria-hidden="true">PDF</span>
                    <span className={'hj-cv__name' + (t.name.length > 22 ? ' is-long' : '')}>{t.name}</span>
                    {t.ed ? <span className="hj-cv__ed">{t.ed}</span> : null}
                    <span className="hj-cv__art" aria-hidden="true" />
                    <span className="hj-cv__date">{nl.date ? <span>{nl.date}</span> : <span />}<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 11 11 5M6 5h5v5" /></svg></span>
                    <span className="hj-sr"> (PDF, opens in a new tab)</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      )
      default: return (
        <div className="hj-meet">
          {chap(ch, i)}
          {hasMeet ? (
            <dl className="hj-meet__dl">
              {meetDay ? (
                <div className="hj-meet__day">
                  <dt>Day</dt>
                  <dd style={{ '--hj-len': Math.max(6, meetDay.length) }}>
                    <span key={meetDay} className={'hj-meet__dayt' + (meetDay.length > 12 ? ' is-long' : '')} aria-hidden="true">{meetDay}</span>
                    <span className="hj-sr">{meetDay}</span>
                  </dd>
                </div>
              ) : null}
              {meetTime ? <div className="hj-meet__time"><dt>Time</dt><dd>{meetTime}</dd></div> : null}
              {meetVenue ? <div className="hj-meet__venue"><dt>Venue</dt><dd>{meetVenue}</dd></div> : null}
            </dl>
          ) : (
            <p className="hj-meet__none">Meeting details for this Rotary year haven’t been published yet.</p>
          )}
          {meetVenue ? <Button className="hj-meet__go" href={d.mapUrl}>Get directions</Button> : null}
        </div>
      )
    }
  }

  return (
    <div className="hj-home" ref={rootRef} style={{ '--hj-first': 'var(--hj-' + first + ')' }}>
      <section className="hj-hero" aria-labelledby="hj-hero-h">
        <div className="hj-hero__sky" aria-hidden="true"><span className="hj-hero__stars" /><span className="hj-hero__dawn" /></div>
        <div className="hj-hero__sunwrap" aria-hidden="true"><span className="hj-hero__sun" /></div>
        <div className="hj-hero__hills" aria-hidden="true">
          <Ridge preset="heroFar" className="hj-rg--hfar" />
          <Ridge preset="heroMid" className="hj-rg--hmid" />
        </div>
        <div className="hj-hero__in">
          {/* the banner alone, full size (client, 2026-09-29); the name stays for screen readers */}
          <h1 id="hj-hero-h" className="hj-sr">{clubName}</h1>
          {/* always mounted (empty until the data lands) so the entrance tween keeps its element */}
          <Banner banners={d.banners} clubName={clubName} />
          {ads.length > 0 ? <div className="hj-hero__ad"><AdCard ads={ads} /></div> : null}
        </div>
        <div className="hj-hero__fw" aria-hidden="true"><div className="hj-hero__front"><Ridge preset="heroFront" /><i /></div></div>
      </section>

      <div className="hj-jr">
        {!ready ? <div className="hj-jr__wait" aria-hidden="true" /> : (
          <>
            <div className="hj-track">
              <div className="hj-sky" aria-hidden="true" />
              <div className="hj-sun" aria-hidden="true"><b /></div>
              <div className="hj-hills" aria-hidden="true"><svg className="hj-hl hj-hl--far" /><svg className="hj-hl hj-hl--mid" /></div>
              {chapters.map((ch, i) => {
                const next = chapters[i + 1]
                const meet = ch.key === 'meet'
                return (
                  <section key={ch.key} id={'hj-' + ch.key} aria-labelledby={'hj-' + ch.key + '-h'}
                           className={'hj-pn hj-pn--' + ch.key + (ch.key === 'events' || ch.key === 'newsletters' ? ' hj-pn--news' : '') + ' hj-tone--' + TONE[ch.key]}
                           style={{ '--hj-next': next ? 'var(--hj-' + TONE[next.key] + ')' : 'var(--hj-night)' }}>
                    {/* no big chapter number behind any section (client, 2026-09-29) */}
                    {meet ? <div className="hj-night" aria-hidden="true"><span className="hj-stars" /><span className="hj-moon" /></div> : null}
                    <div className="hj-pn__ridge" aria-hidden="true">
                      <Ridge preset="pnFar" seed={i * 1.3} />
                      <Ridge preset="pnFront" seed={i * 1.7} className="hj-rg--front" />
                    </div>
                    <div className="hj-pn__in">{body(ch, i)}</div>
                  </section>
                )
              })}
              <div className="hj-hills hj-hills--front" aria-hidden="true"><svg className="hj-hl hj-hl--near" /></div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
