'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD — theme 6 home.  Redesign pass 2026-08-12 (home-page master prompt).
//
// Same data layer as every other theme (useHomeData → HomePageBase), bound to
// gold markup. Section order unchanged: hero → stats → dignitaries → utility
// strip → projects → join.
//
// The HERO SLIDER is driven here, not by rotary-anim.js: the spec's indicators
// are gold lines that FILL over the autoplay interval and pause on hover — the
// shared script's setInterval can neither pause nor expose its phase, so the
// timer, the fill and the hover-hold have to live in one place. Everything
// else (reveals, counters, the ad slider, the drawer) still comes from the
// shared script via useRotaryAnim.
//
// Once-per-session gates (sessionStorage):
//   gldHeroSeen          — the navy curtain + 1.06→1.00 settle run on first
//                          paint only, never on back-navigation.
//   gldStats|club|year   — the stat count-up plays once per club+year; after
//                          that the figures render static. A year change is new
//                          data and counts again on purpose.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import Lenis from 'lenis'
import { appSettings } from '@/site/config.js'
import { useClub } from '@/site/ClubContext.jsx'
import { withYear, usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useHomeData, adAnchorProps } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

const REDUCED = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const HERO_INT = 6000   // autoplay interval; the dot-fill duration mirrors it
// How many distinct slide entrances exist in gold.css (.gld-hero__slide.is-a0…4).
// The incoming slide picks one by its own index, so consecutive advances never
// repeat the same move and a club with 2 banners still alternates.
const HERO_ANIMS = 5

// The RI presidential theme (called the presidential MESSAGE from 2025-26 on)
// for each Rotary year, keyed by the calendar year it opens on 1 July. Stored
// pre-split into the headline's white line and its gold line rather than split
// by a rule at runtime — every one of these breaks in a different place
// ("Unite | for Good", "Create Lasting | Impact") and a table that is simply
// read is a table that can't get it wrong.
const RI_THEMES = {
  2026: ['Create Lasting', 'Impact.'],
  2025: ['Unite', 'for Good.'],
  2024: ['The Magic', 'of Rotary.'],
  2023: ['Create Hope', 'in the World.'],
  2022: ['Imagine', 'Rotary.'],
  2021: ['Serve to Change', 'Lives.'],
  2020: ['Rotary Opens', 'Opportunities.'],
  2019: ['Rotary Connects', 'the World.'],
  2018: ['Be the', 'Inspiration.'],
  2017: ['Making', 'a Difference.'],
}
// A year the table doesn't cover must never INVENT a theme — RI announces the
// next one at the January International Assembly, so a club browsing ahead (or
// far back) gets Rotary's own motto instead of a wrong official theme. Kept
// SHORT on purpose: at the hero's size the old two-clause line wrapped to three
// bands, and the clip-reveal masks per band.
const HERO_FALLBACK = ['Service Above', 'Self.']

// Replay gates — MODULE state, not sessionStorage: the choreography plays on
// every full page load (an F5 always gets the show), and only skips replays
// while navigating around inside one SPA visit. The sessionStorage version
// suppressed it for the whole browser session, which read as "no animation".
let HERO_PLAYED = false
const COUNTED_KEYS = new Set()

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
)

function imgFallback(e) {
  const el = e.currentTarget
  const rest = (el.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) {
    el.setAttribute('data-fallbacks', rest.slice(1).join('|'))
    el.src = rest[0]
  } else {
    el.style.visibility = 'hidden'
  }
}

/** Missing portrait → the wheel on a navy-tinted disc (never a broken image).
 *  The class check is the re-entry guard: clearing el.onerror does nothing to
 *  React's delegated handler, so a failing wheel.png would otherwise loop. */
function digFallback(e) {
  const el = e.currentTarget
  if (el.classList.contains('is-ph')) { el.style.visibility = 'hidden'; return }
  el.src = '/images/logo/wheel.png'
  el.classList.add('is-ph')
}

/** homeData hands "Not available" leaders the legacy grey headshot — that IS a
 *  missing photo, so it gets the designed navy placeholder up front. */
const isPlaceholderPhoto = (src) => !src || /profile_pic\.png$/i.test(src)

/** The text a stat FINISHES on — the static branch prints it and animateCount
 *  lands on it, so one function keeps the two in step. Figures are printed in
 *  FULL (user's call): no ₹ Cr / ₹ L compaction, so a lifetime total reads
 *  ₹21,567,204,235. The band's layout is what makes room for it. */
const statText = (s) => (s.placeholder ? String(s.placeholder)
  : (s.prefix || '') + Math.round(s.value || 0).toLocaleString())

/** Glyph count of that finished figure. A figure too long for a half-width
 *  phone cell takes the whole row instead of being shrunk. */
const statLen = (s) => statText(s).length
const WIDE_AT = 9

/* ── Club-life glyph — the reference's abstract geometric Lottie mark, rebuilt
   as pure SVG + CSS keyframes; it animates CONTINUOUSLY like the original's,
   and reduced-motion freezes it. Only the EVENTS tile still carries one, and
   only as its no-data fallback (with an event, the event's photo is the mark).
   Newsletters, advertisement and the weekly meeting now show no icon. */
const GI_EVENTS = (() => {   // 4×4 dot grid, dots breathe in a diagonal wave
  let dots = ''
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      dots += '<circle cx="' + (9 + c * 15.3).toFixed(1) + '" cy="' + (9 + r * 15.3).toFixed(1)
        + '" r="6.2" style="--gd:' + ((r + c) * 0.14).toFixed(2) + 's"/>'
    }
  }
  return '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" class="gi-dots">' + dots + '</svg>'
})()
/** THE SECTION-HEADER MOTIF — identical on every section (see gold.css).
 *  Eyebrow fades, the title clip-reveals upward, the rule draws left-to-right;
 *  all keyed off the shared reveal observer's .is-visible. */
function SHead({ eyebrow, title, em, action }) {
  // SPLIT TEXT: each word gets its own overflow mask (.gld-w) so the CSS can
  // rise them out one by one. `em` is the gold tail — plain strings, because
  // splitting arbitrary JSX into words isn't worth the machinery.
  const words = [
    ...String(title || '').split(' ').filter(Boolean).map((w) => [w, false]),
    ...String(em || '').split(' ').filter(Boolean).map((w) => [w, true]),
  ]
  return (
    <div className="gld-shead reveal">
      <div className="gld-shead__main">
        <p className="gld-shead__e">{eyebrow}</p>
        <h2 className="gld-shead__t">
          {words.map(([w, isEm], i) => (
            // the trailing space is a TEXT NODE between masks, so lines still
            // wrap between words and screen readers hear normal prose
            <span key={i} className={'gld-w' + (isEm ? ' gld-w--em' : '')} style={{ '--wi': i }}><span>{w}</span></span>
          )).reduce((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
        </h2>
        <span className="gld-shead__r" aria-hidden="true" />
      </div>
      {action || null}
    </div>
  )
}

export default function HomeGold({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { featuredTake: 6, newsletterTake: 4 })
  const heroRef = useRef(null)
  const workRef = useRef(null)   // the "THE WORK" section (gets pinned)
  const rowRef = useRef(null)    // its horizontal card row
  const marqRef = useRef(null)   // the club-name marquee track
  const fanRef = useRef(null)    // the dignitary deck (parallax)

  usePageTitle(club.clubDisplayName)
  // The marquee runs the club's own name. It arrives AFTER first paint (the
  // tenant resolves asynchronously), and the scroll engine caches the loop width
  // as scrollWidth/2 — so this is in that effect's deps, or the marquee would
  // keep looping on the placeholder's width and visibly jump.
  const marqName = club.clubDisplayName

  // The headline is the Rotary year's own RI theme. The selected year lives in
  // the URL, so switching years in the header re-titles the hero with THAT
  // year's theme — which is what the picker is for.
  const heroLine = RI_THEMES[parseInt(String(club.selectedYearLabel || '').slice(0, 4), 10)]
    || HERO_FALLBACK

  // ── Hero slider state ──────────────────────────────────────────────────────
  const nBanners = d.banners.length

  // Full choreography on every page load; skipped only on SPA back-navigation
  // within this load. The initializer only READS (StrictMode double-invokes
  // initializers); the effect records the play after mount.
  const [boot] = useState(() => !REDUCED && !HERO_PLAYED)
  useEffect(() => { if (boot) HERO_PLAYED = true }, [boot])
  const [enter, setEnter] = useState(!boot)          // choreography armed
  const [curtainGone, setCurtainGone] = useState(!boot)
  const [entranceDone, setEntranceDone] = useState(!boot) // settle finished → is-enter off, stats armed
  const [heroIdx, setHeroIdx] = useState(0)
  const [leaving, setLeaving] = useState(-1)          // outgoing slide (drift)
  const [cycle, setCycle] = useState(0)               // bumps per slide change
  const [hold, setHold] = useState(false)             // hover/focus pause
  const [resumes, setResumes] = useState(0)           // re-keys the fill on resume
  const prevIdx = useRef(0)

  // entranceDone is a dep so page() re-runs when the [data-count] nodes mount
  // (armCount flips true) — the counter observer only sees nodes that exist.
  // Declared AFTER the state it reads: a dep naming a const declared below the
  // hook is a TDZ throw (this exact bug hit the old header measurement code).
  useRotaryAnim([d.loading, d.banners.length, d.ads.length, d.featured.length, d.events.length, entranceDone])

  // VIEWPORT REPLAY. The shared observer only ever ADDS .is-visible, so every
  // entrance plays once per page load. This observer REMOVES it again once an
  // element is fully out of the viewport (isIntersecting false at threshold 0
  // = zero pixels visible, so the reset is never seen) and re-adds it on the
  // way back in — re-adding a class restarts its CSS animations, so the
  // reveals, staggers, rule draws and field cascades replay on every entry.
  // Scoped to this page's wrapper: inner pages keep the shared once-only run.
  useEffect(() => {
    if (d.loading) return undefined
    const els = document.querySelectorAll('.gld-wrap .reveal')
    if (!els.length) return undefined
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // Ratio OR taller-than-viewport — a block bigger than the screen can
        // never reach 12% visibility and would never reveal at all.
        if (e.isIntersecting
            && (e.intersectionRatio >= 0.12 || e.boundingClientRect.height >= window.innerHeight))
          e.target.classList.add('is-visible')
        else if (!e.isIntersecting) e.target.classList.remove('is-visible')
      }
    }, { threshold: [0, 0.12] })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [d.loading, d.banners.length, d.featured.length, d.events.length])

  // New banner set (year change) → back to slide one.
  useEffect(() => { setHeroIdx(0); prevIdx.current = 0; setLeaving(-1) }, [nBanners])

  // Slide-change bookkeeping: mark the outgoing slide for its 1.5% drift and
  // re-key the copy column so the text re-runs its stagger at half duration.
  useEffect(() => {
    if (prevIdx.current === heroIdx) return
    setLeaving(prevIdx.current)
    setCycle((c) => c + 1)
    prevIdx.current = heroIdx
    const t = setTimeout(() => setLeaving(-1), 700)
    return () => clearTimeout(t)
  }, [heroIdx])

  // Autoplay — paused on hover/focus (hold) and while the tab is hidden.
  // heroIdx is a dep ON PURPOSE: every slide change (manual included) restarts
  // the interval, so the fill line — re-keyed per change — always mirrors the
  // real time to the next advance. Without it, a touch user's tap desynced
  // fill and timer (mouse users were masked by hover recreating the interval).
  useEffect(() => {
    if (REDUCED || hold || nBanners < 2) return
    const t = setInterval(() => {
      if (!document.hidden) setHeroIdx((c) => (c + 1) % nBanners)
    }, HERO_INT)
    return () => clearInterval(t)
  }, [hold, nBanners, heroIdx])

  // First-paint choreography starts once the first banner image is actually
  // renderable (or after a 2.2s cap, so a dead image can't hold the page).
  useEffect(() => {
    if (!boot || enter || d.loading || nBanners === 0) return
    const img = heroRef.current && heroRef.current.querySelector('.gld-hero__slide img')
    let t
    const go = () => { t = setTimeout(() => setEnter(true), 80) }
    if (img && img.complete) go()
    else {
      if (img) img.addEventListener('load', go, { once: true })
      t = setTimeout(() => setEnter(true), 2200)
    }
    return () => { clearTimeout(t); if (img) img.removeEventListener('load', go) }
  }, [boot, enter, d.loading, nBanners])

  // Absolute ceiling INDEPENDENT of the API: the gate above waits for
  // d.loading, so a slow backend would otherwise hold a featureless navy
  // curtain (and hidden copy) for as long as the fetch takes.
  useEffect(() => {
    if (!boot || enter) return
    const t = setTimeout(() => setEnter(true), 2600)
    return () => clearTimeout(t)
  }, [boot, enter])

  // Unmount the curtain after its wipe, then retire the entrance state —
  // .is-enter left on would replay the 1.06→1.00 settle on EVERY later slide.
  useEffect(() => {
    if (!enter || entranceDone) return
    const a = setTimeout(() => setCurtainGone(true), 1100)
    const b = setTimeout(() => setEntranceDone(true), 2300)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [enter, entranceDone])

  // Publish the showing banner's natural ratio as --gld-hero-r — the stage is
  // sized to the picture so an upload is never cropped (clamped against
  // mis-sized uploads). naturalWidth is 0 until the file arrives.
  useEffect(() => {
    const stage = heroRef.current
    if (!stage) return
    const img = stage.querySelectorAll('.gld-hero__slide img')[heroIdx]
    if (!img) return
    const pub = () => {
      if (!img.naturalWidth || !img.naturalHeight) return
      stage.style.setProperty('--gld-hero-r',
        String(Math.min(4.2, Math.max(1.6, img.naturalWidth / img.naturalHeight))))
    }
    if (img.complete) { pub(); return }
    img.addEventListener('load', pub, { once: true })
    return () => img.removeEventListener('load', pub)
  }, [heroIdx, d.banners])

  // Ken Burns pauses while the tab is hidden.
  useEffect(() => {
    const stage = heroRef.current
    if (!stage) return
    const on = () => stage.classList.toggle('is-hidden', document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const heroGo = (n) => {
    if (nBanners < 2) return
    setHeroIdx(((n % nBanners) + nBanners) % nBanners)
  }
  // Every unhold path must bump `resumes`: the fill <i> re-keys and restarts
  // with the fresh interval — a resumed-from-pause fill would finish early.
  const unhold = () => { if (hold) setResumes((r) => r + 1); setHold(false) }
  const heroHold = (on) => (e) => {
    if (e && e.pointerType && e.pointerType !== 'mouse') return
    if (on) setHold(true); else unhold()
  }

  // ── Scroll engine — the reference site's scroll-driven layer ───────────────
  // One rAF drives three things (measured on the reference):
  //   · the pinned project gallery: vertical scroll scrubbed into the row's
  //     horizontal translate while .gld-workpin sticks (their work-wrapper);
  //   · the giant marquee: slow constant drift PLUS the page's own scroll;
  //   · a gentle counter-parallax on the dignitary deck.
  useEffect(() => {
    if (REDUCED) return
    const sec = workRef.current, row = rowRef.current
    const marq = marqRef.current, fan = fanRef.current
    if (marq) marq.classList.add('is-js')
    let pin = false, extra = 0, raf = 0, drift = 0, fanP = -1, last = performance.now()
    // ALL geometry is cached here — the per-frame tick only reads scrollY.
    // (gBCR/scrollWidth every frame forced synchronous layout at 60fps, which
    // was the scroll jank.) offsetTop chains ignore transforms, so the fan's
    // own parallax translate can't feed back into its measurements.
    let vh = window.innerHeight, marqHalf = 0, secTop = 0, secTotal = 0, fanTop = 0, fanH = 0
    const offTop = (el) => { let t = 0; while (el) { t += el.offsetTop; el = el.offsetParent } return t }

    const measure = () => {
      vh = window.innerHeight
      if (marq) marqHalf = marq.scrollWidth / 2
      if (fan) { fanTop = offTop(fan); fanH = fan.offsetHeight }
      if (sec && row) {
        extra = Math.max(0, row.scrollWidth - window.innerWidth)
        pin = extra > 80
        sec.classList.toggle('is-pin', pin)
        // scroll length = one viewport + the horizontal distance to cover
        sec.style.height = pin ? Math.round(vh + extra) + 'px' : ''
        if (!pin) row.style.transform = ''
        secTop = offTop(sec)
        secTotal = sec.offsetHeight - vh
      }
    }

    // Write-on-change only: a style write costs a style recalc even when the
    // value is identical, so idle frames must write NOTHING.
    let wMx = null, wRx = null, wFp = null, wFy = null
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) { last = now; return }
      const dt = Math.min(50, now - last); last = now
      const y = window.scrollY
      if (marq && marqHalf > 0) {
        drift += dt * 0.028                       // ~28px/s ambient drift
        const mx = Math.round(-((drift + y * 0.45) % marqHalf))
        if (mx !== wMx) { wMx = mx; marq.style.transform = 'translateX(' + mx + 'px)' }
      }
      if (pin && row && secTotal > 0) {
        const p = Math.min(1, Math.max(0, (y - secTop) / secTotal))
        const rx = Math.round(-p * extra)
        if (rx !== wRx) { wRx = rx; row.style.transform = 'translateX(' + rx + 'px)' }
      }
      if (fan) {
        const top = fanTop - y                    // deck top in viewport coords
        const bot = top + fanH                    // …and its foot
        // TRIGGERED, not scrubbed. The spread plays whenever ANY part of the
        // deck is on screen and resets only once it is completely gone, so:
        //   · it plays on entry from EITHER direction (the original bottom-edge
        //     scrub reached 1 at mid-screen and stayed, so arriving from below
        //     found it already open);
        //   · it never collapses while you can see it (the symmetric scrub did,
        //     which is what looked wrong);
        //   · the thresholds are the deck's OWN edges — an earlier version armed
        //     at 15% of the viewport, leaving a band where the collapsed pile
        //     was visible but not yet moving.
        const anyVisible = bot > 0 && top < vh
        if (fanP < 0) fanP = 0
        if (anyVisible) fanP += (1 - fanP) * 0.055
        else fanP = 0
        if (fanP > 0.999) fanP = 1
        const fp = fanP.toFixed(3)
        if (fp !== wFp) { wFp = fp; fan.style.setProperty('--fp', fp) }
        const fy = Math.round((top + fanH / 2 - vh / 2) / vh * 20)
        if (fy !== wFy) { wFy = fy; fan.style.translate = '0 ' + fy + 'px' }
      }
    }

    measure()
    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', measure)
    // body resize covers everything that shifts section offsets (images
    // arriving, data populating) — row resize covers the gallery itself.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) { ro.observe(document.body); if (row) ro.observe(row) }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      if (ro) ro.disconnect()
      if (sec) { sec.style.height = ''; sec.classList.remove('is-pin') }
      if (row) row.style.transform = ''
    }
  }, [d.featured.length, d.leaders.length, marqName])

  // Smooth scrolling — LENIS, the exact library the reference site runs (its
  // hand-rolled predecessor here fought the shared sheet's
  // `html{scroll-behavior:smooth}`, which gold.css now switches off).
  useEffect(() => {
    if (REDUCED) return
    const lenis = new Lenis()
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t)
      raf = requestAnimationFrame(loop)
    })
    return () => { cancelAnimationFrame(raf); lenis.destroy() }
  }, [])

  // ── Stats: count up once per club+year PER PAGE LOAD, static on back-nav ───
  const statsKey = club.clubId + '|' + club.selectedYearId
  const counted = COUNTED_KEYS.has(statsKey)
  useEffect(() => {
    if (d.loading || counted) return
    const t = setTimeout(() => COUNTED_KEYS.add(statsKey), 2400)
    return () => clearTimeout(t)
  }, [d.loading, counted, statsKey])

  const stats = [...d.projectStats, ...d.membershipStats]
  // Counters arm only when: data is real (not mid-fetch), this club+year hasn't
  // counted this page load, and the hero's entrance has finished (the stats
  // enter AFTER the hero settles, not against it).
  const armCount = !d.loading && !counted && entranceDone

  // The club's OWN about copy closes the page. It arrives as admin rich HTML, so
  // take the text only — via a detached div, which parses but never runs
  // anything — and collapse the &nbsp; runs admin paste joins words with (those
  // are what make a line refuse to wrap and scroll the whole page sideways).
  const aboutText = useMemo(() => {
    const html = d.about && d.about.content
    if (!html || !String(html).trim()) return ''
    const el = document.createElement('div')
    el.innerHTML = String(html)
    return (el.textContent || '').replace(/\s+/g, ' ').trim()
  }, [d.about])

  const { meetingDay, meetingTime, meetingVenue, mapUrl } = d
  const hasMeeting = [meetingDay, meetingTime, meetingVenue].some((v) => v && v !== '—')
  // Empty panels are DROPPED, not rendered with placeholder copy — an empty
  // card in a bento reads as a hole. `rightTiles` is the surviving right-hand
  // column in display order; the meeting always stays so the section can never
  // empty out completely.
  // Presence is read from the DATA ONLY. Counting `d.loading` as "present" (to
  // pre-empt a re-flow) meant hasEvents was true while d.events was still empty
  // and d.events[0].id threw — the whole page white-screened. The grid instead
  // waits for the fetch below, so it is only ever built once, with the truth.
  const hasEvents = d.events.length > 0
  const hasNews = d.newsletters.length > 0
  // The advertisement tile ALWAYS stays. homeData pushes a placeholder onto an
  // empty list, so a club with no ads still shows the default artwork here —
  // deliberate, and the same behaviour as every other theme.
  const rightTiles = [hasNews && 'news', 'ad', 'meet'].filter(Boolean)

  // is-enter is retired once the settle finishes, or gldSettle would replay on
  // every later slide change. Render-time clamp: a shrunken banner list (year
  // switch) must never paint a frame with no active slide.
  const idx = Math.min(heroIdx, Math.max(0, nBanners - 1))
  const stageCls = 'gld-hero__stage'
    + (boot ? (enter ? (entranceDone ? '' : ' is-enter') : ' is-hold') : '')
    + (hold ? ' is-held' : '')
  // First visit: full entrance once the curtain lifts. Back-navigation and
  // every later slide change: the same sequence at half duration (is-soft).
  const copyCls = 'gld-hero__copy '
    + (cycle > 0 ? 'is-soft' : (boot ? (enter ? 'is-enter' : 'is-hold') : 'is-soft'))

  // Fan geometry: --o is the signed offset from the deck's centre, so 4
  // leaders sit at -1.5/-0.5/+0.5/+1.5 → rotations ±12°/±4°, the centre pair
  // largest and on top. Works unchanged for 2 or 3 leaders. The spread itself
  // (--fp) is driven by the scroll engine.
  const fanMid = (d.leaders.length - 1) / 2
  const fanCard = (l, i) => {
    const o = i - fanMid
    return (
      <a key={l.type} className="gld-fan__card"
         style={{ '--o': o, '--ao': Math.abs(o), '--z': 10 - Math.round(Math.abs(o) * 2) }}
         href={withYear('/dignitary?Type=' + (l.type || 1), club.selectedYearId)}>
        {isPlaceholderPhoto(l.img)
          ? <img src="/images/logo/wheel.png" className="is-ph" alt="" loading="lazy" />
          : <img src={l.img} alt="" loading="lazy" onError={digFallback} />}
        <span className="gld-fan__plate">
          <b>{l.name}</b><i>{l.role}</i>
          {/* A SPAN, not a nested <a>/<button>: the whole card is already the
              link to this dignitary, and an interactive element inside an
              anchor is invalid and breaks keyboard navigation. */}
          <span className="gld-fan__btn">Read more <Arrow /></span>
        </span>
      </a>
    )
  }

  return (
    <div className="gld-wrap">

      {/* ══ 01 · Hero ══ */}
      <section className="gld-hero">
        {/* NO pointer-enter pause. Hovering the hero used to hold the timer, and
            since the hero fills the fold the cursor rests on it constantly — the
            slider looked broken ("not sliding automatically") when it was only
            paused. Keyboard focus still pauses: a user tabbing the controls must
            not have the slide change under them. */}
        <div className={stageCls} ref={heroRef}
             onFocusCapture={() => setHold(true)}
             onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) unhold() }}>
          {d.banners.map((b, i) => {
            const cls = 'gld-hero__slide is-a' + (i % HERO_ANIMS)
                        + (i === idx ? ' is-active' : '') + (i === leaving ? ' is-leaving' : '')
            const art = <img src={b.src} data-fallbacks={b.fallbacks} alt="" onError={imgFallback} />
            // A banner carrying a typed link or an uploaded document becomes the
            // anchor ITSELF — never an anchor nested inside the slide, or the
            // hidden slides (opacity 0, but still hit-testable) would swallow the
            // click on the showing one. .is-active's z-index is what keeps the
            // showing slide on top.
            return b.url
              ? <a key={i} className={cls} href={b.url} {...adAnchorProps(b.url)}
                   aria-label={b.title || 'Open banner link'}>{art}</a>
              : <div key={i} className={cls}>{art}</div>
          })}
          <div className="gld-hero__scrim" />
          {!curtainGone && <div className={'gld-hero__curtain' + (enter ? ' is-up' : '')} aria-hidden="true" />}

          {/* The copy column sits at z-index 3, ON TOP of the banner picture, so
              it used to eat every click aimed at a linked banner. gold.css makes
              this column transparent to clicks and gives pointer events back to
              the CTA buttons and the indicators only — see the note there. */}
          <div className="gld-x gld-hero__in">
            <div className={copyCls}>
              {/* Only the TEXT re-keys per slide change (the half-duration
                  re-stagger). The CTAs and dots stay mounted — re-keying them
                  destroyed a focused button with no blur event, wedging `hold`
                  true and killing autoplay for keyboard users. */}
              <div key={cycle}>
                <p className="gld-cap">
                  {club.clubDisplayName}{club.selectedYearLabel ? ' · ' + club.selectedYearLabel : ''}
                </p>
                <h1 className="gld-h1">
                  <span className="gld-h1__a"><span>{heroLine[0]}</span></span>
                  <span className="gld-h1__b"><span>{/* innermost element clips its own
                      gradient — see the SHINY TEXT trap note in gold.css */}
                    <i className="gld-shinetxt" style={{ fontStyle: 'normal' }}>{heroLine[1]}</i></span></span>
                </h1>
                <p className="gld-hero__sub">
                  We are the people who live down your street. Every week we meet, pick
                  something our community needs, and get it done together.
                </p>
              </div>
              <div className="gld-hero__cta">
                {/* Two visitor routes, not one visitor route and one staff one:
                    admin login is in the header on every page, and it was the
                    second thing a first-time visitor was offered here. */}
                <a href="/projects" className="gld-btn gld-btn--gold">Explore projects <Arrow /></a>
                <a href="/about" className="gld-btn gld-btn--onnavy">About us <Arrow /></a>
              </div>

              {/* Indicators: gold lines that fill over the autoplay interval —
                  progress bar and indicator in one. In the copy column because
                  the lifted stats card owns the hero's bottom edge. */}
              {nBanners > 1 && (
                <div className="gld-hero__dots" aria-label="Banners">
                  {d.banners.map((_, i) => (
                    <button key={i} type="button" aria-label={'Banner ' + (i + 1)}
                            className={'gld-hero__dot' + (i === idx ? ' is-on' : '')}
                            onClick={() => heroGo(i)}>
                      {i === idx && !REDUCED && (
                        <i key={cycle + ':' + resumes} style={{ animationDuration: HERO_INT + 'ms' }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {nBanners > 1 && (
            <>
              <button type="button" aria-label="Previous banner" onClick={() => heroGo(idx - 1)}
                      className="gld-hero__nav gld-hero__nav--prev">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button type="button" aria-label="Next banner" onClick={() => heroGo(idx + 1)}
                      className="gld-hero__nav gld-hero__nav--next">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </>
          )}
        </div>
      </section>

      {/* ══ 02 · Stats — one card on the hero's edge, counts once per session ══
          Hidden entirely until the first data lands (an empty white bar floated
          over the hero otherwise); the entrance delay stretches on first paint
          so the card rises after the hero settles. */}
      {stats.length > 0 && (
        <section className="gld-stats">
          <div className="gld-x">
            {/* Every figure is the SAME fixed size in every Rotary year, and
                every figure is printed in full. What flexes is the LAYOUT: the
                desktop tracks size to their content, and a figure too long for a
                half-width phone cell takes the whole row (gld-stat--wide). */}
            <div className="gld-statgrid reveal"
                 style={boot ? { '--gld-stats-delay': '1.05s' } : undefined}>
              {stats.map((s, i) => (
                <div className={'gld-stat' + (statLen(s) > WIDE_AT ? ' gld-stat--wide' : '')} key={i}>
                  <span className="gld-stat__ico" dangerouslySetInnerHTML={{ __html: s.icon }} />
                  {armCount && !s.placeholder ? (
                    <div className="gld-stat__n"
                         key={s.value + '|' + s.placeholder}
                         data-count={s.value} data-count-dur="1400"
                         data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                  ) : (
                    /* Static. Final values when this club+year already counted
                       (or while a year-switch holds last year's data); a "0"
                       resting state while the hero entrance briefly delays the
                       count — showing finals first would make the count-up
                       read as a reset. Formatting matches animateCount. */
                    <div className="gld-stat__n">
                      {s.placeholder ? s.placeholder
                        : (counted || d.loading) ? statText(s)
                          : '0'}
                    </div>
                  )}
                  <div className="gld-stat__l">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ══ 03 · Dignitaries & Leaders — the fanned card deck ══
          The reference hero: a poster headline with a hand of rounded photo
          cards fanned over its lower half; the deck DEALS into place when the
          section scrolls in. */}
      {d.leaders.length > 0 && (
        <section className="gld-sec gld-fanwrap">
          <div className="gld-x">
            {/* The signature section motif, like every other section — the
                giant Anton poster headline was the odd one out. */}
            <SHead eyebrow="Our people" title="Dignitaries" em="& Leaders" />
          </div>
          {/* Collapsed pile until the section arrives; the scroll engine spreads
              it (--fp 0→1). Inline 0 avoids one spread frame before the engine's
              first tick — reduced-motion keeps the CSS fallback (finished fan). */}
          <div className="gld-fan" ref={fanRef} style={REDUCED ? undefined : { '--fp': 0 }}>
            {d.leaders.map(fanCard)}
          </div>
        </section>
      )}

      {/* ══ 04 · Club life — Events · Newsletters · Meeting · Advertisement ══
          The reference's "Our Expertise": a giant marquee headline sliding on
          loop, the indexed rule with a gold pill, then generous rounded cards
          with a glyph parked top-left. */}
      <section className="gld-sec gld-clublife">
        <div className="gld-marq reveal" aria-hidden="true">
          {/* The club's own name is the marquee. Both halves must be IDENTICAL —
              the scroll engine loops on scrollWidth/2, so any difference in
              length between them makes the wrap visibly jump. */}
          <div className="gld-marq__track" ref={marqRef}>
            <b>{marqName} · <em>{marqName}</em> · {marqName} · <em>{marqName}</em> · </b>
            <b>{marqName} · <em>{marqName}</em> · {marqName} · <em>{marqName}</em> · </b>
          </div>
        </div>
        <div className="gld-x">
          {/* BENTO. Tile size follows how much each panel actually has to show:
              the event is the only one with a photo AND a paragraph, so it takes
              the 2x2 hero; the advertisement is artwork with a one-word title, so
              it takes the wide short strip; newsletters and the meeting are a
              line of text each and take the two compact tiles. Laid out with
              grid-template-areas so each breakpoint re-arranges in ONE place. */}
          {/* BENTO. Tiles with NO DATA are not rendered at all, and the grid
              re-flows so nothing leaves a hole. The right-hand column is filled
              by whichever of newsletters / advertisement / meeting survive, in
              that order, tagged --r1/--r2/--r3 by POSITION -- so the CSS only
              has to know "events present?" and "how many right tiles?", not
              which specific panels are missing. */}
          {d.loading ? null : (
          <div className={'gld-bento gld-stagger' + (hasEvents ? ' is-ev' : '') + ' is-r' + rightTiles.length}>

            {/* Upcoming events -- the event's OWN image, title and description,
                stacked, with the calendar link directly beneath the card (inside
                the same grid area, so it tracks the tile at every breakpoint). */}
            {hasEvents && (
            <div className="gld-stack gld-ev">
              <a className="gld-qcard gld-qcard--ev reveal" href={'/event?id=' + d.events[0].id}>
                <span className="gld-qcard__media">
                  <img src={d.events[0].img} alt="" loading="lazy"
                       onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                </span>
                <span className="gld-qcard__body">
                  <h3 className="gld-qcard__t">{d.events[0].title}</h3>
                  <p className="gld-qcard__d">{d.events[0].desc || d.events[0].date}</p>
                  {/* SPAN, not a link: the whole tile is already the anchor and an
                      interactive element inside an anchor is invalid. */}
                  <span className="gld-qcard__cta">Read more <Arrow /></span>
                </span>
              </a>
              {/* --gold, not --ghost: these two are the section's only way out to
                  the full lists, and as outlined pills on a cream card they read
                  as part of the card's border rather than as an action. */}
              <a href="/events" className="gld-btn gld-btn--gold gld-stack__all reveal">View all upcoming events <Arrow /></a>
            </div>
            )}

            {rightTiles.map((tile, n) => {
              const slot = 'gld-qcard--r' + (n + 1)

              /* Newsletters -- the latest issue as a filed document: PDF mark,
                 caption, issue title, then its date on its own line. */
              if (tile === 'news') return (
                <div key={tile} className={'gld-stack ' + slot}>
                  <a className="gld-qcard gld-qcard--news reveal"
                     href={d.newsletters[0].url} target="_blank" rel="noopener noreferrer">
                    <span className="gld-pdf" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      <b>PDF</b>
                    </span>
                    <span className="gld-qcard__body">
                      <span className="gld-qcard__cap">Latest newsletter</span>
                      <h3 className="gld-qcard__t">{d.newsletters[0].title}</h3>
                      {d.newsletters[0].date && <span className="gld-qcard__when">{d.newsletters[0].date}</span>}
                      <span className="gld-qcard__cta">Read online <Arrow /></span>
                    </span>
                  </a>
                  <a href="/newsletters" className="gld-btn gld-btn--gold gld-stack__all reveal">View all newsletters <Arrow /></a>
                </div>
              )

              /* Advertisement -- NOT a single card-wide link like its neighbours:
                 a club can run several ads and each carries its OWN document or
                 link, so the anchor has to be PER SLIDE (as in every other
                 theme). Wrapping the rotator in one card anchor made every click
                 open ads[0] whatever was on screen -- and anchors cannot nest. */
              if (tile === 'ad') return (
                <div key={tile} className={'gld-qcard gld-qcard--ad reveal ' + slot}>
                  <span className="gld-qcard__art">
                    <span className="gld-ad__stage" data-hero data-hero-interval="5500">
                      {d.ads.map((ad, i) => (
                        <a key={i} href={ad.url} {...adAnchorProps(ad.url)} data-hero-slide className="opacity-0">
                          <img src={ad.img} data-fallbacks={ad.fallbacks} alt="Advertisement" loading="lazy" onError={imgFallback} />
                        </a>
                      ))}
                    </span>
                  </span>
                </div>
              )

              /* Weekly meeting -- day / time / venue as three captioned fields.
                 Always rendered: it is the one panel that says something useful
                 even with nothing published, and it keeps the section from
                 collapsing to nothing on a brand-new club. */
              return (
                <a key={tile} className={'gld-qcard gld-qcard--meet reveal ' + slot} href={mapUrl || '#'}
                   {...(mapUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  <span className="gld-qcard__body">
                    <span className="gld-qcard__cap">Weekly meeting</span>
                    {d.loading ? null : hasMeeting ? (
                      <span className="gld-meet">
                        {/* --day / --time / --venue: the CSS places these by NAME.
                            An unpublished field is not rendered at all, so
                            nth-child would put the survivors in the wrong
                            columns. */}
                        {[['Day', meetingDay], ['Time', meetingTime], ['Venue', meetingVenue]]
                          .filter(([, v]) => v && v !== '\u2014')
                          .map(([k, v]) => (
                            <span className={'gld-meet__f gld-meet__f--' + k.toLowerCase()} key={k}>
                              <i>{k}</i><b>{v}</b>
                            </span>
                          ))}
                      </span>
                    ) : (
                      <p className="gld-qcard__d">Meeting day, time and venue for this Rotary year haven\u2019t been published yet.</p>
                    )}
                    {mapUrl && hasMeeting && <span className="gld-qcard__cta">Open in maps <Arrow /></span>}
                  </span>
                </a>
              )
            })}

          </div>
          )}

        </div>
      </section>

      {/* ══ 05 · Our Projects — "THE WORK" band ══
          Dark band, condensed poster headline, indexed rule, then an
          edge-bleed horizontal row of big media cards. */}
      <section className="gld-sec gld-work" ref={workRef}>
        {/* Everything lives in the sticky pin; the SECTION's inline height
            (set by the scroll engine) is what provides the scrub distance. */}
        <div className="gld-workpin">
          <div className="gld-x">
            <SHead eyebrow="Our work" title="Our projects" />
          </div>
          {d.loading ? null : d.featured.length === 0 ? (
            <div className="gld-x">
              <div className="gld-empty reveal">
                <i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg></i>
                <b>No projects recorded yet</b>
                <span>Published projects for this Rotary year will appear here.</span>
              </div>
            </div>
          ) : (
            <div className="gld-workrow gld-stagger" ref={rowRef}>
              {d.featured.slice(0, 6).map((p) => (
                <a key={p.id} href={withYear('/project?pid=' + p.id, club.selectedYearId)} className="gld-workcard reveal">
                  <span className="gld-workcard__media">
                    <img src={p.img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                    {/* avenueColor = the same per-avenue bg-* class the Projects
                        page badges use, so an avenue is one color everywhere. */}
                    {p.avenueLabel && <span className={'gld-workcard__tag ' + (p.avenueColor || 'bg-navy')}>{p.avenueLabel}</span>}
                  </span>
                  <span className="gld-workcard__meta">
                    <h3 className="gld-workcard__t">{p.title}</h3>
                    {p.desc && <p className="gld-workcard__d">{p.desc}</p>}
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="gld-x gld-work__all reveal">
            {/* Same job as "View all upcoming events" / "View all newsletters",
                so the same gold variant — it was the one ghost among them. */}
            <a href="/projects" className="gld-btn gld-btn--gold">View all projects <Arrow /></a>
          </div>
        </div>
      </section>

      {/* ══ 06 · About the club + the two ways in ══
          The LIGHT band that closes the alternation — it sits between the navy
          projects band and the navy footer. Copy left, actions right, on one
          short row. The lede is the CLUB'S OWN about text (the admin's, not
          invented marketing) with a neutral line only if it has published none;
          it is clamped to three lines, so "Read more" opens the rest on
          /about — the page that holds the full text. */}
      <section className="gld-sec gld-join">
        <div className="gld-x gld-join__in">
          <div className="gld-join__copy">
            <SHead eyebrow="About the club" title="Who we are, and" em="what we do." />
            {/* BLUR TEXT: each word is a span the CSS resolves from a blur in
                sequence; the spaces stay text nodes so the clamp still wraps. */}
            <p className="gld-lede gld-join__about reveal">
              {(aboutText || 'This club is part of Rotary International — a global network of '
                + 'neighbours, friends and problem-solvers who take action where they live.')
                .split(' ').filter(Boolean)
                /* the clamp shows ~40 words at most — a real club pasted 1,800
                   here, which would mean 1,800 spans for three visible lines */
                .slice(0, 60)
                .map((w, i) => <span key={i} className="gld-w" style={{ '--wi': i }}>{w}</span>)
                .reduce((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
            </p>
          </div>
          <div className="gld-join__cta reveal">
            <a href="/about" className="gld-btn gld-btn--gold">Read more <Arrow /></a>
            <a href={appSettings.AdminLoginUrl} target="_blank" rel="noopener noreferrer"
               className="gld-btn gld-btn--ghost">Login <Arrow /></a>
          </div>
        </div>
      </section>
    </div>
  )
}
