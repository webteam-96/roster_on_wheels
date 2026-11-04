'use client'
// Port of HomeWarmModern.aspx + HomeWarmModern.aspx.cs — the WARM-MODERN home
// body only.
//
// "warm-modern Home layout. Inherits all data from HomePageBase; only the markup
// (HomeWarmModern.aspx) differs from the classic Home.aspx. Reached via
// Server.Transfer from Home.aspx when the resolved theme is warm-modern, so the
// browser URL stays Home.aspx." — App.jsx's HomeSwitch does that switch here.
//
// The OnPreInit guard ("direct hit under a different theme -> bounce to
// Home.aspx") is not ported: App.jsx pins /HomeWarmModern.aspx to the warm shell,
// so the route can't render inside another theme's shell.
//
// All the shared data (banners, ads, stats, featured, meeting info, events,
// newsletters, leaders) comes from HomePageBase.cs, ported once in
// ../shared/homeData.js. The four page-scoped <script> blocks of the .aspx are
// ported below as effects — a <script> tag in JSX never executes, and
// DOMContentLoaded never fires again in a SPA.
import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { withYear, usePageTitle } from '@/themes/shared/rotaryPage.js'
import {
  useHomeData, adAnchorProps, buildProjectStatTiles, getImpactNumbersForYear,
} from '@/themes/shared/homeData.js'
import { getOrAdd } from '@/site/apiCache.js'
import { enc } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

// Image fallback chain: when a banner/ad image fails to load, try each
// pipe-separated URL in its data-fallbacks in turn, then stop. (The original's
// img.onerror = null can't detach React's synthetic handler, so the "nothing
// left" branch simply stops changing src.)
function rotaryImgFallback(img) {
  var rest = (img.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) {
    img.setAttribute('data-fallbacks', rest.slice(1).join('|'))
    img.src = rest[0]
  }
}

// Curated theme art (user-supplied) — NOT a club photo: club uploads proved
// unreliable (admin-screen screenshots), so the Projects card uses this bundled
// image for every club.
const PROJECTS_TILE_BG = '/Themes/warm-modern/images/project-bg.jpg'

/**
 * &lt;option&gt;s for the band's own year picker: "All years" first (selected by
 * default), then every Rotary year the club has.
 */
function renderCounterYearOptions(years, counterIsAllYears, counterYearId) {
  var sb = ''
  sb += '<option value="all"' + (counterIsAllYears ? ' selected="selected"' : '') + '>All years</option>'
  for (const y of years) {
    const sel = (!counterIsAllYears && counterYearId != null && counterYearId === y.id)
      ? ' selected="selected"' : ''
    sb += '<option value="' + y.id + '"' + sel + '>' + enc(y.yearLabel) + '</option>'
  }
  return sb
}

// Page-scoped styles. Slider controls: the markup gives these a white glyph on a
// translucent WHITE pill (bg-white/25) and white dots (bg-white/60), which vanish
// on a light banner — and most club banners are light artwork on white. A dark
// scrim restores contrast on any image without moving or resizing anything.
//
// Hand-written because this port ships PRECOMPILED Tailwind: bg-black/40 and every
// similar utility is absent from theme.css, so swapping the class would silently
// render a fully transparent button.
//
// Specificity is 0,1,0 — deliberately BELOW Tailwind's compiled hover:bg-gold
// rule (0,2,0), so the theme's gold hover still wins on hover.
const PAGE_CSS = `
        [data-hero-prev], [data-hero-next] {
          background-color: rgba(15, 23, 42, .45);
          box-shadow: 0 1px 6px rgba(0, 0, 0, .3);
        }
        [data-hero-dot] { position: relative; box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); }
        /* The visible dot is 8x8 — far under the ~44px touch guidance. A transparent
           ::after pad raises the hit box to 30x30 while the dot itself is untouched.
           It HAS to be CSS: rotary-anim.js rewrites these buttons' class attribute
           (w-2/w-6/bg-gold) on every slide change. The row's 22px gap makes the pads
           tile edge to edge, so no dot can steal the one next to it. */
        [data-hero-dot]::after { content: ''; position: absolute; inset: -11px; }
        /* Banner and ad artwork runs right under the dot row (the ad slider paints
           them on the poster itself), so the row carries its own scrim pill. */
        .wm-dot-row { gap: 22px; padding: 6px 14px; border-radius: 9999px; background: rgba(15, 23, 42, .35); backdrop-filter: blur(2px); }
`

export default function HomeWarmModern({ data }) {
  const club = useClub()
  const location = useLocation()
  const navigate = useNavigate()

  // GetFeatured() is uncapped here (the marquee carries the whole list); the
  // newsletter rail renders a generous supply of 10 — the sync effect below
  // measures the Events card and shows only as many as fit.
  // The warm hero is a 16:5 full-bleed slider, so it serves the 16:5 warm
  // re-composition of the year's theme banner (Themes/warm-modern/images)
  // instead of the original 2:1 art — that way the fallback slide fills the
  // strip without cropping, like real banners. (ThemeBannerForYear override.)
  const d = useHomeData(data.home, { newsletterTake: 10, bannerDir: '/Themes/warm-modern/images' })
  const {
    banners, ads, membershipStats, featured, newsletters, events,
    meetingDay, meetingTime, meetingVenue,
    featuredCount, eventsCount, newslettersCount,
  } = d

  usePageTitle(club.clubName)

  // ── Impact band's OWN year control (independent of the header year select) ──
  // Opens on ALL YEARS (a lifetime sum of every Rotary year); the visitor narrows
  // it to one year from the band's own dropdown, which reloads with ?statYear.
  //
  // Resolve it from ?statYear: "all" (or absent, or an unknown id) => aggregate
  // every Rotary year; a valid year id => that single year. Deliberately separate
  // from the page/header year so the two dropdowns move on their own — changing
  // the header year does NOT retarget this band, and vice versa.
  const years = club.years || []
  const rawStatYear = new URLSearchParams(location.search).get('statYear')
  const statId = parseInt(rawStatYear, 10)
  const pickedYear = (rawStatYear && rawStatYear.toLowerCase() !== 'all' && !Number.isNaN(statId))
    ? years.find((y) => y.id === statId) : null
  const counterIsAllYears = !pickedYear
  const counterYearId = pickedYear ? pickedYear.id : null
  /** Label under the heading: "all years" or e.g. "2025-26". */
  const counterYearLabel = pickedYear ? pickedYear.yearLabel : 'all years'

  // The band's four project-stat tiles: for one chosen year, or — the default —
  // summed across every Rotary year. Each year's numbers come from the same
  // audited path the single-year band uses (GetImpactNumbers), so the total is an
  // honest sum rather than a re-estimate, and it applies the same
  // main-projects-only rule.
  const [counterStats, setCounterStats] = useState([])
  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false

    ;(async () => {
      if (!counterIsAllYears) {
        // one chosen year: always fresh (TTL 0)
        const n = await getImpactNumbersForYear(club.clubId, counterYearId)
        if (!cancelled) setCounterStats(buildProjectStatTiles(n))
        return
      }

      // "All years" costs ~2-3 API calls PER Rotary year — heavy for a long history
      // (21 years is ~6s cold). Closed past years are immutable, so cache the summed
      // aggregate with an explicit TTL even though the site is otherwise instant-mode;
      // the key carries the year COUNT so adding a Rotary year busts it. An explicit
      // single-year pick above stays live, so admin edits stay verifiable there.
      const tiles = await getOrAdd('wm:counteragg:' + club.clubId + ':' + years.length, async () => {
        const sum = { projects: 0, totalCost: 0, manHours: 0, beneficiaries: 0,
                        // the summed aggregate has no single impact row to read the
                        // currency from, so take the club's own (v2/about)
                        currency: club.currency }
        for (const y of years) {
          const n = await getImpactNumbersForYear(club.clubId, y.id)
          sum.projects += n.projects
          sum.totalCost += n.totalCost
          sum.manHours += n.manHours
          sum.beneficiaries += n.beneficiaries
        }
        return buildProjectStatTiles(sum)
      }, 10)
      if (!cancelled) setCounterStats(tiles)
    })()

    return () => { cancelled = true }
  }, [club.clubId, counterIsAllYears, counterYearId, years.length])

  // The impact band's own year picker. rotary-anim.js's initYearSelect() (which
  // owns [data-count-year-select] in the Web Forms build) is deliberately NOT
  // exposed to the SPA — it reloads the whole page — so the same behaviour runs
  // through the router here: set/remove ?statYear and re-render this band.
  const yearSelRef = useRef(null)
  useEffect(() => {
    const el = yearSelRef.current
    if (!el) return
    const onChange = () => {
      const params = new URLSearchParams(location.search)
      if (el.value && el.value !== 'all') params.set('statYear', el.value)
      else params.delete('statYear')
      const qs = params.toString()
      navigate(location.pathname + (qs ? '?' + qs : '') + location.hash)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [navigate, location.pathname, location.search, location.hash])

  // ── Adaptive banner-box reshape ─────────────────────────────────────────────
  // When the upload mismatch exceeds 25% of the 8:3 box (e.g. tall poster-style
  // banners, not the common 16:5 panorama), reshape the box to the image's own
  // ratio. This makes cover lossless for outlier shapes: box ratio equals image
  // ratio, so cover shows the whole photo. Common shapes (16:5, ~3.2) mismatch by
  // ~8.3%, so the box stays 8:3 and cover crops ~8.3% off top/bottom —
  // edge-to-edge fill, old-site behavior. boxA MUST track the strip's CSS ratio
  // (8/3) — it feeds the reshape test. KNOWN, PRE-EXISTING: `shaped` latches on
  // whichever image decodes FIRST, so a club mixing shapes (rctcv ships both 1.676
  // and 3.2) can reshape differently between loads. Acceptable trade-off.
  const heroRef = useRef(null)
  useEffect(() => {
    var hero = heroRef.current
    if (!hero) return
    var shaped = false
    function shapeHero(img) {
      if (shaped || !img.naturalWidth) return
      shaped = true
      var a = img.naturalWidth / img.naturalHeight
      var boxA = 8 / 3                            // must match the strip's CSS aspect
      var mismatch = a > boxA ? a / boxA : boxA / a
      if (mismatch <= 1.25) return                // banner-shaped: keep full-bleed 8:3, use cover
      hero.classList.remove('aspect-[8/3]', 'w-full', 'bg-navy/5')
      hero.classList.add('mx-auto', 'overflow-hidden', 'rounded-3xl')
      hero.style.aspectRatio = a + ' / 1'
      hero.style.width = 'min(1400px, 94%)'    // fixed banner width; height follows the image's own aspect so slides FILL the card
    }
    var slides = hero.querySelectorAll('[data-hero-slide]')
    var offs = []
    for (var i = 0; i < slides.length; i++) (function (slide) {
      var img = slide.querySelector('[data-hero-img]')
      if (!img) return
      function fit() {
        if (!img.naturalWidth) return
        shapeHero(img)
      }
      if (img.complete) fit()
      img.addEventListener('load', fit)    // re-runs after onerror fallbacks swap src
      window.addEventListener('resize', fit)
      offs.push(function () {
        img.removeEventListener('load', fit)
        window.removeEventListener('resize', fit)
      })
    })(slides[i])
    return () => { offs.forEach(function (off) { off() }) }
  }, [banners])

  // ── Projects marquee (ux-india style) ───────────────────────────────────────
  // The track drifts continuously and each card fans into a gentle arc — rising
  // and tilting toward the viewport edges. Pauses on hover/touch. Reduced-motion
  // users get a plain scrollable strip.
  const marqueeRef = useRef(null)
  const trackRef = useRef(null)
  useEffect(() => {
    var wrap = marqueeRef.current
    var track = trackRef.current
    if (!wrap || !track || !track.children.length) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      wrap.classList.remove('overflow-hidden')
      wrap.classList.add('overflow-x-auto', 'no-scrollbar')
      return
    }

    // Duplicate the card run until it spans 2× the viewport → seamless loop.
    // (The original does `track.innerHTML += original`, which would tear out the
    // DOM nodes React owns; appending cloneNode copies leaves React's own nodes
    // untouched and produces the same card run. The clones are removed on cleanup
    // so the DOM matches React's tree again.)
    var runCount = track.children.length
    var original = Array.prototype.slice.call(track.children)
    var guard = 0
    while (track.scrollWidth < wrap.clientWidth * 2 + 600 && guard < 6) {
      original.forEach(function (n) { track.appendChild(n.cloneNode(true)) })
      guard++
    }
    // Loop period = exact distance between a card and its clone one run later.
    var loopWidth = track.children.length > runCount
      ? track.children[runCount].offsetLeft - track.children[0].offsetLeft
      : track.scrollWidth / 2

    var offset = 0, paused = false, SPEED = 0.55
    var onEnter = function () { paused = true }
    var onLeave = function () { paused = false }
    var onTouchStart = function () { paused = true }
    var onTouchEnd = function () { setTimeout(function () { paused = false }, 3000) }
    wrap.addEventListener('mouseenter', onEnter)
    wrap.addEventListener('mouseleave', onLeave)
    wrap.addEventListener('touchstart', onTouchStart, { passive: true })
    wrap.addEventListener('touchend', onTouchEnd, { passive: true })

    var raf = 0
    function tick() {
      if (!paused && wrap.offsetParent) {
        offset += SPEED
        if (offset >= loopWidth) offset -= loopWidth
        track.style.transform = 'translate3d(' + (-offset) + 'px,0,0)'
        // Arc: tilt + raise cards by distance from the viewport centre.
        var wr = wrap.getBoundingClientRect()
        var cx = wr.left + wr.width / 2
        for (var i = 0; i < track.children.length; i++) {
          var card = track.children[i]
          var r = card.getBoundingClientRect()
          if (r.right < wr.left - 100 || r.left > wr.right + 100) continue // offscreen
          var dd = ((r.left + r.width / 2) - cx) / (wr.width / 2)   // -1 .. 1
          if (dd < -1.2) dd = -1.2; else if (dd > 1.2) dd = 1.2
          card.style.transform = 'rotate(' + (dd * 6) + 'deg) translateY(' + (-dd * dd * 40).toFixed(1) + 'px)'
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      wrap.removeEventListener('mouseenter', onEnter)
      wrap.removeEventListener('mouseleave', onLeave)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchend', onTouchEnd)
      while (track.children.length > runCount) track.removeChild(track.lastChild)
      track.style.transform = ''
      original.forEach(function (n) { n.style.transform = '' })
    }
  }, [featuredCount])

  // ── Members-band crowd ──────────────────────────────────────────────────────
  // Vanilla port of the React/GSAP "CrowdCanvas" (Skiper 39, itself adapted from
  // zadvorsky's CodePen; Open Peeps art by Pablo Stanley, CC0). Runs as TWO
  // independent side stages (left/right canvases) so the crowd never walks behind
  // the member count in the middle. Peeps stroll, bob, and get recycled when they
  // exit. Plain rAF.
  useEffect(() => {
    var canvases = document.querySelectorAll('[data-crowd]')
    if (!canvases.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    var ROWS = 15, COLS = 7                // sprite sheet layout (240×324 cells)

    function rand(min, max) { return min + Math.random() * (max - min) }

    // One walking stage per canvas — its own pools, sizing and rAF loop.
    function startStage(canvas, img) {
      var ctx = canvas.getContext('2d')
      var stage = { w: 0, h: 0 }
      var all = [], avail = [], crowd = []
      var last = 0
      var sw = img.naturalWidth / ROWS, sh = img.naturalHeight / COLS
      for (var i = 0; i < ROWS * COLS; i++) {
        all.push({ sx: (i % ROWS) * sw, sy: ((i / ROWS) | 0) * sh, sw: sw, sh: sh })
      }

      // Pull a random peep from the pool and start it walking across.
      function spawn(randomProgress) {
        if (!avail.length) return
        var p = avail.splice((Math.random() * avail.length) | 0, 1)[0]
        // Fit the band height, but on narrow (phone) stages also cap by width so a
        // peep never dwarfs its stage — smaller peeps instead of no crowd on mobile.
        var scale = Math.min((stage.h * 0.85) / p.sh, (stage.w * 0.75) / p.sw)
        p.dw = p.sw * scale; p.dh = p.sh * scale
        var r = Math.random()
        var offY = 4 - stage.h * 0.18 * r * r   // most at the front, a few deeper
        p.dir = Math.random() > 0.5 ? 1 : -1
        p.startX = p.dir === 1 ? -p.dw : stage.w + p.dw
        p.endX = p.dir === 1 ? stage.w : 0
        p.baseY = stage.h - p.dh + offY
        p.dur = 20 / rand(0.5, 1.25)            // slow stroll
        p.t = randomProgress ? Math.random() * p.dur : 0
        crowd.push(p)
        crowd.sort(function (a, b) { return a.baseY - b.baseY })   // depth order
      }

      function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.scale(devicePixelRatio, devicePixelRatio)
        for (var i = 0; i < crowd.length; i++) {
          var p = crowd[i]
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.scale(p.dir, 1)                 // flip to face walking direction
          ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh)
          ctx.restore()
        }
        ctx.restore()
      }

      var raf = 0
      function step(ts) {
        var dt = Math.min((ts - last) / 1000, 0.1); last = ts
        for (var i = crowd.length - 1; i >= 0; i--) {
          var p = crowd[i]
          p.t += dt
          var k = p.t / p.dur
          if (k >= 1) { crowd.splice(i, 1); avail.push(p); spawn(false); continue }
          p.x = p.startX + (p.endX - p.startX) * k
          var half = 0.025 * p.dur            // walking-bob half period
          var ph = (p.t / half) % 2
          p.y = p.baseY - p.dh * 0.05 * (ph < 1 ? ph : 2 - ph)
        }
        render()
        raf = requestAnimationFrame(step)
      }

      function resize() {
        stage.w = canvas.clientWidth; stage.h = canvas.clientHeight
        canvas.width = stage.w * devicePixelRatio
        canvas.height = stage.h * devicePixelRatio
        crowd.length = 0; avail.length = 0
        if (stage.w < 40 || stage.h < 40) return    // collapsed/hidden stage
        avail.push.apply(avail, all)
        // density scales with this stage's width (narrow phone stages get fewer)
        var n = Math.min(all.length, Math.max(3, Math.round(stage.w / 30)))
        for (var i = 0; i < n; i++) spawn(true)
      }

      resize()
      window.addEventListener('resize', resize)
      last = performance.now()
      raf = requestAnimationFrame(step)

      return function stop() {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
      }
    }

    var cancelled = false
    var stops = []
    var img = new Image()
    img.onload = function () {
      if (cancelled || !img.naturalWidth) return
      for (var i = 0; i < canvases.length; i++) stops.push(startStage(canvases[i], img))
    }
    img.src = '/Themes/warm-modern/images/open-peeps-sheet.png'

    return () => {
      cancelled = true
      stops.forEach(function (stop) { stop() })
    }
  }, [membershipStats.length])

  // ── Newsletter column height-match ──────────────────────────────────────────
  // The newsletter column height-matches the Events card WITHOUT CSS stretch — a
  // CSS-only attempt (h-full + flex-1 + overflow-y-auto) doesn't work here: the
  // list has no ancestor with a definite height to clip against, so the grid row
  // (and Events card via align-items:stretch) grows to fit ALL rendered newsletter
  // items instead of the intended reverse. Fix: measure the Events card's actual
  // rendered height in JS, then show only as many of the 10 rendered newsletter
  // items as fit inside that same height.
  useEffect(() => {
    var card = document.querySelector('[data-nl-sync-card]')
    var wrap = document.querySelector('[data-nl-wrap]')
    var head = document.querySelector('[data-nl-head]')
    var list = document.querySelector('[data-nl-list]')
    if (!card || !wrap || !head || !list) return
    var items = Array.prototype.slice.call(list.querySelectorAll('[data-nl-item]'))
    if (!items.length) return

    function sync() {
      if (window.matchMedia('(max-width: 1023px)').matches) {
        // columns stack on mobile/tablet — natural flow, no clipping
        items.forEach(function (el) { el.style.display = '' })
        return
      }
      // COLLAPSE FIRST, THEN MEASURE. The Events card is h-full, so it stretches
      // to the grid row — and the row is sized by whichever column is taller,
      // which is this list. Measuring the card while the list is long therefore
      // measures a height the list itself caused, and nearly every item "fits"
      // (9 of 10 before this fix). Hiding the items drops the row back to the
      // card's own intrinsic height, which is the number we actually want.
      items.forEach(function (el) { el.style.display = 'none' })
      var available = card.getBoundingClientRect().height - head.getBoundingClientRect().height
      available -= 16 // the list's mt-4 gap above it
      var gap = 12     // gap-3 between items
      var used = 0, full = false
      items.forEach(function (el, i) {
        if (full) { el.style.display = 'none'; return }
        el.style.display = ''                // measure at natural height first
        var h = el.getBoundingClientRect().height
        var next = used + (i > 0 ? gap : 0) + h
        if (next <= available) { used = next }
        else { el.style.display = 'none'; full = true }
      })
    }

    sync()
    window.addEventListener('resize', sync)
    // event card images can load after the first measure and change its height.
    // (The original listens for window 'load'; that has already fired by the time
    // a SPA route mounts, so the card's own images are watched instead.)
    var imgs = Array.prototype.slice.call(card.querySelectorAll('img'))
    imgs.forEach(function (im) { im.addEventListener('load', sync) })
    return () => {
      window.removeEventListener('resize', sync)
      imgs.forEach(function (im) { im.removeEventListener('load', sync) })
    }
  }, [d.loading, eventsCount, newslettersCount])

  useRotaryAnim([d.loading, banners.length, ads.length, counterStats.length, featuredCount, eventsCount, newslettersCount, d.leaders.length])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      {/* ══ Hero — full-bleed banner slider, photos only, edge to edge (v5: taller) ══ */}
      <section className="relative overflow-hidden bg-canvas">
        {/* 8:3 strip — the site-wide banner standard. Dashboard uploads lock to 16:5
            (3.2:1), which is an ~8.3% mismatch, so cover crops ~8.3% off top/bottom —
            edge-to-edge fill, matching the old site's behavior exactly. Tall posters
            (5:3 ratio and worse) trigger a box reshape to their own aspect (JS), so
            cover becomes lossless there (zero crop, zero gap). min-h keeps phones
            usable. This single-layer cover approach is how the old site worked. */}
        <div ref={heroRef} data-hero data-hero-banner data-hero-interval="5000" className="relative aspect-[8/3] min-h-[240px] w-full bg-navy/5">
          {banners.map((b, i) => {
            const photo = <img data-hero-img src={b.src} data-fallbacks={b.fallbacks} alt="Banner" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-cover" />
            // The anchor REPLACES the slide div — data-hero-slide must stay outermost
            // or a hidden slide (pointer-events set on it) can't stop swallowing clicks.
            return b.url ? (
              <a key={i} href={b.url} {...adAnchorProps(b.url)} aria-label={b.title || 'Open banner link'} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">
                {photo}
              </a>
            ) : (
              <div key={i} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">
                {photo}
              </div>
            )
          })}
          <button type="button" data-hero-prev aria-label="Previous slide" className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white backdrop-blur transition hover:bg-gold hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button type="button" data-hero-next aria-label="Next slide" className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white backdrop-blur transition hover:bg-gold hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div className="wm-dot-row absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2">
            {banners.map((_, i) => (
              <button key={i} type="button" data-hero-dot aria-label="Go to slide" className="h-2 w-2 rounded-full bg-white/60 transition-all"></button>
            ))}
          </div>
        </div>
      </section>

      {/* ══ Impact — warm-editorial bento grid (v4: photo on the Projects card only) ══ */}
      <section className="relative overflow-hidden bg-dotgrid bg-white pt-16">
        <div className="container-x relative">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="reveal">
              <p className="label-eyebrow mb-2">Our Projects</p>
              <h2 className="font-heading text-3xl font-extrabold text-navy md:text-4xl" data-split>Measurable Change, Together</h2>
            </div>
            <div className="reveal flex flex-wrap items-center gap-4">
              <p className="-rotate-2 font-script text-3xl leading-none text-gold">{counterYearLabel} in numbers
                <svg className="ml-1 inline h-6 w-6 -scale-y-100 rotate-[80deg]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16c6 3 12 1 15-5"/><path d="M15 8l4 3-5 2"/></svg>
              </p>
              {/* The impact band's OWN year picker: independent of the header year select.
                  Opens on "All years" (a lifetime sum); pick a year to narrow just this band.
                  Classes are copied from the header's year <select> so every utility used
                  here already exists in the compiled warm sheet (no Tailwind rebuild). */}
              <label className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-navy/60">Showing</span>
                <span className="relative">
                  <select ref={yearSelRef} data-count-year-select aria-label="Impact totals year" className="h-9 cursor-pointer appearance-none rounded-full border border-navy/20 bg-white pl-3 pr-8 text-sm font-bold text-navy shadow-sm transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gold/40"
                          dangerouslySetInnerHTML={{ __html: renderCounterYearOptions(years, counterIsAllYears, counterYearId) }} />
                  <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-navy/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </span>
              </label>
            </div>
          </div>

          {/* All tile sizing/coloring is nth-child CSS (.bento-impact in theme2.css):
               both repeaters emit the SAME .bento-tile markup. */}
          <div className="bento-impact mt-10">
            {counterStats.map((s, i) => (
              <div key={i} className="bento-tile reveal">
                {/* shared warm wash — IDENTICAL on all four cards */}
                <div className="bento-overlay"></div>
                {/* Projects card (item 0) only: crisp photo panel on the RIGHT,
                    fading into the card; painted above the overlay.
                    (ImpactTileBgHtml: two SIBLING elements, so it stays JSX here —
                    a dangerouslySetInnerHTML wrapper would add a div the CSS
                    doesn't expect.) */}
                {i === 0 && (
                  <>
                    <img src={PROJECTS_TILE_BG} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} className="absolute inset-0 h-full w-full object-cover" />
                    <div className="bento-overlay"></div>
                  </>
                )}
                <div className="bento-content relative flex flex-col items-center justify-center">
                  <div className="bento-ico" dangerouslySetInnerHTML={{ __html: s.icon }}></div>
                  <div className="bento-num" key={s.value + '|' + s.placeholder} data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                  <div className="bento-label">{s.label}</div>
                </div>
              </div>
            ))}
            {/* Members: deliberately NOT a .bento-tile — a dark horizontal band
                with real member avatars so membership reads differently from the
                project counters. */}
            {membershipStats.map((s, i) => (
              <div key={i} className="bento-member reveal">
                {/* Animated "walking crowd" in TWO side stages (vanilla port of
                    the React/GSAP CrowdCanvas; Open Peeps art, CC0) — the middle
                    stays clear so the crowd never passes behind the count. Each
                    stage fades out toward the center. JS above. */}
                {/* h-full is REQUIRED: without it a canvas derives its height
                    from its intrinsic 2:1 aspect (53px on phones) instead of
                    stretching to the band. */}
                <canvas data-crowd className="crowd-mask-l pointer-events-none absolute inset-y-0 left-0 h-full w-[31%] opacity-40" aria-hidden="true"></canvas>
                <canvas data-crowd className="crowd-mask-r pointer-events-none absolute inset-y-0 right-0 h-full w-[31%] opacity-40" aria-hidden="true"></canvas>
                <div className="relative flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="bento-num" key={s.value + '|' + s.placeholder} data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                    <div className="bento-label mt-0">{s.label}</div>
                  </div>
                  <span className="hidden font-script text-2xl leading-none text-gold-light sm:inline">…and growing every year</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Wave hand-off into the cream section below */}
        <div className="relative mt-14 text-canvas" aria-hidden="true">
          <svg viewBox="0 0 1440 56" preserveAspectRatio="none" className="block h-10 w-full"><path fill="currentColor" d="M0,32 C240,64 480,0 720,24 C960,48 1200,8 1440,32 L1440,56 L0,56 Z"/></svg>
        </div>
      </section>

      {/* ══ Dignitaries + advertisements — two-column (v3) ══ */}
      <section className="bg-canvas pb-16 pt-6">
        <div className="container-x grid gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Left: dignitaries — 2×2 horizontal cards (row 1: RI President + DG,
               row 2: Club President + Secretary). flex-1 on the grid stretches the
               two rows so the column's total height matches the ad slider column. */}
          <div className="flex flex-col lg:col-span-8">
            <div className="reveal flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-eyebrow mb-2">Our Leadership</p>
                <h2 className="font-heading text-3xl font-extrabold text-navy" data-split>Dignitaries &amp; Leaders</h2>
              </div>
              <p className="font-script text-2xl leading-none text-gold">the people behind the work</p>
            </div>
            <div className="mt-8 grid flex-1 grid-cols-1 gap-5 sm:grid-cols-2">
              {d.leaders.map((l) => (
                <div key={l.type} className="reveal h-full">
                  <div className="group relative flex h-full min-h-[190px] overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
                    {/* Warm niche: gradient panel with an arch-framed portrait */}
                    <div className="relative w-[42%] shrink-0 bg-gradient-to-br from-gold/15 via-canvas to-gold/5">
                      <div className="impact-dots pointer-events-none absolute inset-0 opacity-20"></div>
                      <div className="img-zoom absolute inset-x-4 bottom-0 top-4 overflow-hidden rounded-t-full shadow-lg ring-1 ring-navy/10">
                        <img src={l.img} alt={l.name} onError={(e) => { e.currentTarget.src = 'img/profile_pic.png' }} className="h-full w-full object-cover" />
                      </div>
                    </div>
                    {/* Copy */}
                    <div className="relative flex flex-1 flex-col justify-center p-5">
                      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gold/15 blur-2xl"></div>
                      <h3 className="line-clamp-2 font-heading text-base font-bold leading-snug text-navy transition-colors group-hover:text-gold-cta sm:text-lg">{l.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-snug text-gold-cta sm:text-sm">{l.role}</p>
                      <div className="mt-3 h-1 w-8 rounded-full bg-gold/50 transition-all duration-300 group-hover:w-12 group-hover:bg-gold"></div>
                      <a href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)} className="mt-3.5 inline-flex w-fit items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-navy transition-colors hover:text-gold-cta">View Profile
                        <svg className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: advertisement slider */}
          <div className="lg:col-span-4">
            <div>
              {/* No "Advertisements" heading (user call 2026-08-24) — the script
                  line alone labels the column, kept right-aligned (second call).
                  justify-END, not justify-between: with only one child left,
                  space-between puts it at the START of the row. */}
              <div className="reveal flex items-end justify-end gap-3">
                <p className="font-script text-2xl leading-none text-gold">from our well-wishers</p>
              </div>
              <div className="reveal mt-8">
                <div data-hero data-hero-interval="4500" className="relative aspect-[454/518] overflow-hidden rounded-3xl bg-navy-deep shadow-card ring-1 ring-navy/10">
                  {ads.map((ad, i) => (
                    <a key={i} href={ad.url} {...adAnchorProps(ad.url)} data-hero-slide className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-700">
                      {/* Ads are posters with text and the dashboard enforces NO ratio on
                          them: measured uploads run from 0.877 portrait to 1.333 landscape,
                          and 4 of 6 are landscape. object-cover alone therefore threw away
                          34% of the average poster in this portrait plate. Show the whole
                          creative with object-contain and fill the leftover with a blurred
                          cover copy - the treatment classic-blue, civic-bold and
                          verdigris-ledger already use. The sharp copy MUST be absolute
                          too: a positioned blur sibling paints over static in-flow
                          content and would bury the poster under its own blur. */}
                      <img src={ad.img} data-fallbacks={ad.fallbacks} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg" />
                      <img src={ad.img} data-fallbacks={ad.fallbacks} alt="Advertisement" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-contain" />
                    </a>
                  ))}
                  <div className="wm-dot-row absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2">
                    {ads.map((_, i) => (
                      <button key={i} type="button" data-hero-dot aria-label="Go to advertisement" className="h-2 w-2 rounded-full bg-white/60 transition-all"></button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Projects — curved continuous photo marquee (v4, ux-india style) ══ */}
      {featuredCount > 0 && (
      <section className="overflow-hidden bg-dotgrid bg-white py-14">
        <div className="container-x mb-2 flex flex-wrap items-end justify-between gap-3">
          <div className="reveal">
            <p className="label-eyebrow mb-1">What We Do</p>
            <h2 className="font-heading text-2xl font-bold text-navy sm:text-3xl" data-split>Projects</h2>
          </div>
          <a href="/projects" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition-all hover:-translate-y-0.5 hover:bg-gold">View All
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </div>
        {/* Full-bleed marquee: the track scrolls continuously (JS), cards fan into a
            gentle arc — rises + tilts toward the edges. Extra top padding gives the
            raised edge cards headroom. Pauses on hover; static scroll strip when the
            user prefers reduced motion. */}
        <div ref={marqueeRef} data-projmarquee className="relative w-full overflow-hidden">
          <div ref={trackRef} data-projtrack className="flex w-max gap-5 pb-6 pt-16">
            {featured.map((p) => (
              <a key={p.id} href={withYear('/project?pid=' + p.id, club.selectedYearId)} className="block w-[230px] shrink-0 will-change-transform sm:w-[270px]">
                <div className="img-zoom group relative aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-navy-deep to-navy shadow-card transition-shadow hover:shadow-cardHover">
                  <img src={p.img} alt={p.title} className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-navy-deep/90 via-navy-deep/20 to-transparent"></div>
                  <span className={'absolute left-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-white shadow ' + p.avenueColor}>{p.avenueLabel}</span>
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <h3 className="line-clamp-2 font-heading text-[15px] font-bold leading-snug text-white">{p.title}</h3>
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-gold-light opacity-90 transition-all group-hover:gap-2">Read More
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ══ Come sit with us — Upcoming events + Newsletters (two-column) ══ */}
      <section className="bg-canvas py-16">
        <div className="container-x">
          <div className="reveal">
            <p className="label-eyebrow mb-2">Stay In Touch</p>
            <h2 className="font-heading text-3xl font-extrabold text-navy md:text-4xl" data-split>Events &amp; Newsletters</h2>
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
            {/* Left: Upcoming Events card */}
            <div className="reveal min-w-0 lg:col-span-7">
              <div data-nl-sync-card className="card-offset h-full p-7 md:p-9">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="font-script text-3xl leading-none text-gold">what&rsquo;s coming up</p>
                    <h3 className="mt-1 font-heading text-3xl font-extrabold tracking-tight text-navy md:text-4xl">Upcoming Events</h3>
                  </div>
                  <a href="/events" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gold-cta hover:shadow-md">View All
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  </a>
                </div>
                <div className="mt-6">
                  {eventsCount === 0 ? (
                  <>
                  {/* Flat illustration empty state (per reference supplied 2026-08-03) —
                      a calendar+plant duotone illustration on a soft accent blob, a
                      heading with a short accent rule and short copy. No photo.
                      The outlined "View All Events" CTA that used to close this block
                      was removed 2026-08-18: the card header already carries a
                      "View All" pill to the same page, and two buttons a few hundred
                      pixels apart pointing at /events read as a mistake. */}
                  <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-navy/15 bg-white/60 px-8 py-10 text-center sm:flex-row sm:justify-center sm:gap-10 sm:text-left">
                    <svg className="h-auto w-44 shrink-0 sm:w-52" width="200" height="164" viewBox="0 0 200 164" fill="none" aria-hidden="true">
                      {/* soft asymmetric backdrop (two overlapping ellipses, not a single perfect oval) */}
                      <ellipse cx="104" cy="96" rx="92" ry="58" fill="#EA5A29" fillOpacity="0.08"/>
                      <ellipse cx="82" cy="80" rx="58" ry="46" fill="#F26430" fillOpacity="0.06"/>
                      {/* sparkles */}
                      <g fill="#EA5A29" fillOpacity="0.5">
                        <path d="M176 46l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
                        <path d="M20 92l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>
                        <path d="M118 16l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                      </g>
                      {/* pot + plant, pointed petal-shaped leaves instead of blobby paths */}
                      <path d="M28 130h34l-5 24a4 4 0 0 1-4 3H37a4 4 0 0 1-4-3l-5-24Z" fill="#F26430"/>
                      <rect x="24" y="124" width="42" height="9" rx="4" fill="#7C2D12"/>
                      <path d="M45 124C18 112 14 78 22 58 46 70 47 104 45 124Z" fill="#EA5A29" fillOpacity="0.88"/>
                      <path d="M45 124C64 106 70 76 56 54 46 74 44 102 45 124Z" fill="#7C2D12" fillOpacity="0.7"/>
                      <path d="M45 124C38 100 40 78 45 62 52 82 50 106 45 124Z" fill="#F26430" fillOpacity="0.95"/>
                      {/* calendar */}
                      <rect x="76" y="40" width="104" height="108" rx="14" fill="#fff" stroke="#7C2D12" strokeWidth="3.5"/>
                      <path d="M76 54a14 14 0 0 1 14-14h76a14 14 0 0 1 14 14v16H76V54Z" fill="#EA5A29"/>
                      <line x1="102" y1="24" x2="102" y2="46" stroke="#7C2D12" strokeWidth="3.5" strokeLinecap="round"/>
                      <circle cx="102" cy="22" r="6" fill="#fff" stroke="#7C2D12" strokeWidth="3.5"/>
                      <line x1="154" y1="24" x2="154" y2="46" stroke="#7C2D12" strokeWidth="3.5" strokeLinecap="round"/>
                      <circle cx="154" cy="22" r="6" fill="#fff" stroke="#7C2D12" strokeWidth="3.5"/>
                      <g fill="#F26430" fillOpacity="0.3">
                        <rect x="90" y="80" width="16" height="16" rx="5"/>
                        <rect x="112" y="80" width="16" height="16" rx="5"/>
                        <rect x="134" y="80" width="16" height="16" rx="5"/>
                        <rect x="156" y="80" width="12" height="16" rx="5"/>
                        <rect x="90" y="104" width="16" height="16" rx="5" fillOpacity="0.55"/>
                        <rect x="112" y="104" width="16" height="16" rx="5"/>
                        <rect x="134" y="104" width="16" height="16" rx="5"/>
                        <rect x="90" y="128" width="16" height="10" rx="5"/>
                        <rect x="112" y="128" width="16" height="10" rx="5" fillOpacity="0.55"/>
                      </g>
                    </svg>
                    <div className="flex flex-col items-center sm:items-start">
                      <h4 className="mt-4 font-heading text-2xl font-extrabold leading-tight text-navy sm:mt-0 md:text-3xl">No Upcoming Events</h4>
                      <div className="mt-2 h-1 w-10 rounded-full bg-gold"></div>
                      <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted">We're working on something exciting — check back soon for our next gathering.</p>
                    </div>
                  </div>
                  </>
                  ) : (
                  <>
                  {/* GetUpcomingEventCards() is already .Take(1), so this repeater can
                      only ever emit ONE card. Fragment, not a wrapper div: the original
                      emits these five elements as bare siblings. */}
                  {events.map((ev) => (
                    <Fragment key={ev.id}>
                      {/* WHOLE photo in a fixed-height box: h-56 against a 680px-wide
                          column is a 3.08 strip, and event photos are 4:3, so plain
                          object-cover was cutting 57% off the top and bottom.
                          object-contain shows all of it, on WHITE (by request — a
                          blurred fill was tried here first and rejected). The white
                          sits on the img, so the wrapper's tint still backs a missing
                          photo. */}
                      <div className="relative h-56 overflow-hidden rounded-2xl bg-navy/5 ring-1 ring-navy/10">
                        <img src={ev.img} alt={ev.title} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/event/e-2.jpg' }} className="h-full w-full bg-white object-contain" />
                      </div>
                      <h4 className="mt-5 font-heading text-2xl font-extrabold leading-tight text-navy">{ev.title}</h4>
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-navy">
                          <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                          {ev.date}
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
                          <svg className="h-4 w-4 shrink-0 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          <span className="truncate">{ev.venue}</span>
                        </span>
                      </div>
                      {ev.desc ? (
                      <p className="mt-4 line-clamp-3 text-[15px] leading-relaxed text-ink/75">{ev.desc}</p>
                      ) : null}
                      <a href={'/event?id=' + ev.id} data-magnetic className="btn-gold mt-6 !rounded-full !px-6 !py-3">Read More
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </a>
                    </Fragment>
                  ))}
                  </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Newsletters — no card border, no CSS-only stretch (CSS grid's
                row-height and this list's own content are circularly dependent: an
                unbounded list makes the ROW grow to fit it, which then also stretches
                the Events card taller via align-items:stretch — a real bug seen here
                2026-08-03, not a hypothetical). Fixed by the JS effect above: it
                measures the Events card's actual rendered pixel height and shows only
                as many newsletter items (out of the 10 rendered) as fit inside that
                same height, hiding the rest — so this column always matches Events'
                height exactly, never inflates it. */}
            <div data-nl-wrap className="reveal min-w-0 md:pr-8 lg:col-span-5 lg:pr-12 xl:pr-16">
              <div data-nl-head className="flex items-end justify-between gap-3">
                <h3 className="font-heading text-xl font-bold text-navy">Newsletters</h3>
                <a href="/newsletters" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-cta transition-colors hover:text-navy">View all
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </a>
              </div>
              <div data-nl-list className="mt-4 flex flex-col gap-3" style={{ overflow: 'hidden' }}>
                {newslettersCount === 0 ? (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-navy/20 bg-white/60 px-4 py-5">
                  <svg className="h-5 w-5 shrink-0 text-navy/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <p className="text-sm font-semibold text-navy/60">No newsletter found — <span className="font-script text-lg text-gold">check back soon</span></p>
                </div>
                ) : (
                <>
                {newsletters.map((n, i) => (
                  <a key={i} data-nl-item href={n.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-2xl border border-navy/10 bg-white p-3.5 transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-card">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-gold/10 text-gold-cta">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span className="mt-0.5 text-[8px] font-bold">PDF</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="line-clamp-1 font-heading text-[15px] font-bold text-navy group-hover:text-gold-cta">{n.title}</h4>
                      <p className="mt-1 text-xs text-muted">{n.date}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-navy/40 transition-colors group-hover:text-gold-cta">Read →</span>
                  </a>
                ))}
                </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Meeting only (separate section above footer, no map) ══ */}
      <section className="bg-white py-16">
        <div className="container-x">
          <div className="reveal mx-auto max-w-3xl text-center">
            <p className="label-eyebrow mb-2">Where We Meet</p>
            <h2 className="font-heading text-3xl font-extrabold text-navy md:text-4xl" data-split>Come Sit With Us</h2>
            <div className="card-offset mt-8 px-6 py-10 md:px-10">
              <p className="font-script text-3xl leading-none text-gold">next meeting</p>
              <h3 className="mt-3 font-heading text-4xl font-extrabold leading-tight tracking-tight text-navy md:text-5xl">
                {meetingDay}{meetingTime !== '—' && (<><span className="text-gold-cta"> · </span><span className="whitespace-nowrap">{meetingTime}</span></>)}
              </h3>
              <p className="mt-5 flex items-center justify-center gap-2 text-sm leading-relaxed text-ink/75">
                <svg className="h-4 w-4 shrink-0 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>{meetingVenue}</span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
