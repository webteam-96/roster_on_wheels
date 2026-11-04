'use client'
// Port of HomeVerdigrisLedger.aspx + HomeVerdigrisLedger.aspx.cs — the
// VERDIGRIS-LEDGER home body only.
//
// "The Verdigris Ledger home layout. Inherits all data from HomePageBase; only
//  the markup differs. Reached via Server.Transfer from Home.aspx when the
//  resolved theme is verdigris-ledger, so the browser URL stays Home.aspx."
// App.jsx's HomeSwitch does that transfer here, and its OnPreInit bounce (deep
// link to this page while the club is on another theme) is the route's own
// concern — this file is purely the layout.
//
// Shared data (banners, ads, stats, featured, meeting info, newsletters,
// leaders) comes from HomePageBase.cs, ported once in ../shared/homeData.js.
//
// NOT PORTED, deliberately: Page_Load also computes RailTally / YearShort /
// MissionLine / KickerLine / HeroCaption / HeroImage / MembersLine / CostTieLine
// and the LedgerRowHtml + Excerpt + FormatInr helpers. The rail and hero card
// they fed were removed from the markup; nothing in the .aspx reads them.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { media, withYear, usePageTitle } from '@/themes/shared/rotaryPage.js'
import { enc, ledgerPeriod } from '@/themes/shared/Breadcrumb.jsx'
import { useHomeData, adAnchorProps, buildProjectStatTiles, getImpactNumbersForYear, formatTime } from '@/themes/shared/homeData.js'
import { getOrAdd } from '@/site/apiCache.js'
import * as api from '@/site/clubApi.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { loadThemeScripts } from '@/site/themeAssets.js'

// Media fallback chain (uploads-path / theme-banner recovery) shared by the
// banner + advertisement plates. Walks the pipe-separated data-fallbacks list.
//
// The original declares this as an inline <script> above the plates; a <script>
// tag in JSX never executes, so it lives here and is wired through onError. The
// "no fallbacks left" branch keeps the img.style.display = 'none' but drops the
// img.onerror = null (it can't detach React's synthetic handler).
function rotaryImgFallback(img) {
  var rest = (img.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) { img.setAttribute('data-fallbacks', rest.slice(1).join('|')); img.src = rest[0] }
  else { img.style.display = 'none' }
}

// ── VlSizeClass ─────────────────────────────────────────────────────────────
// ONE size class for the whole counter band, picked from the LONGEST figure
// (usually cost), so every number renders the same size and the row stays
// aligned. Size from the figures ACTUALLY shown (the resolved counter year or
// the all-years aggregate, which can be much larger than a single year).
function vlSizeClass(stats, membership) {
  let len = 1
  const scan = (it) => {
    const l = String(Math.trunc(Number(it.value) || 0)).length
    if (l > len) len = l
  }
  for (const it of stats) scan(it)
  for (const it of membership) scan(it)
  return len >= 10 ? ' vl-stat__n--xxs' : (len >= 8 ? ' vl-stat__n--xs' : (len >= 6 ? ' vl-stat__n--sm' : ''))
}

// Bold counter-band tile: leading icon, animated count-up figure (rides the
// shared [data-count] IntersectionObserver in rotary-anim.js) and a mono label.
// Every figure — including Total Cost — is posted at its FULL amount (user call:
// no ₹ L/Cr shorthand).
function vlCounterTile(item, index, sizeCls) {
  const num = String(Math.trunc(Number(item.value) || 0))
  return '<li class="vl-stat reveal">'
    + '<span class="vl-stat__ic" aria-hidden="true">' + item.icon + '</span>'
    + '<span class="vl-stat__n' + sizeCls + '" data-count="' + num
    + '" data-count-prefix="' + enc(item.prefix) + '">0</span>'
    + '<span class="vl-stat__lb">' + enc(item.label) + '</span>'
    + '</li>'
}

// Upcoming-event card: image plate carrying a torn-off day/month date chip, then
// a kicker, the title, when/where rows and a calendar link. The calendar glyph
// shows through when the event has no image or it 404s.
function vlEventCard(item, index, yearId) {
  const img = item.img, title = item.title, date = item.date, time = item.time, venue = item.venue
  // Straight to THIS event; only fall back to the listing if the row has no id.
  const href = item.id ? withYear('/event?id=' + item.id, yearId) : '/events'
  // getLedgerEvents formats Date as "ddd dd MMM" upper-cased ("SAT 12 JUL"), so
  // split it into a big day/month chip and leave the weekday (+ time) on the meta
  // row. Anything that doesn't split into three parts falls back to the raw string,
  // so a changed format degrades to the old one-line rendering instead of breaking.
  const bits = (date || '').split(' ').filter(Boolean)
  const split = bits.length === 3
  const day = split ? bits[1] : ''
  const mon = split ? bits[2] : ''
  const when = split
    ? bits[0] + (!time ? '' : ' · ' + time)
    : date + (!time ? '' : ' · ' + time)
  let sb = ''
  sb += '<li class="vl-event reveal' + (index === 0 ? ' next' : '') + '">'
  sb += '<span class="vl-event__media">'
  sb += '<svg class="vl-event__glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
  if (img) sb += '<img src="' + enc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />'
  if (split) sb += '<span class="vl-event__chip"><b>' + enc(day) + '</b><i>' + enc(mon) + '</i></span>'
  sb += '</span>'
  sb += '<span class="vl-event__body">'
  if (index === 0) sb += '<span class="vl-event__kicker">Next on the register</span>'
  sb += '<b class="vl-event__title">' + enc(title) + '</b>'
  sb += '<span class="vl-event__meta vl-event__meta--date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    + enc(when) + '</span>'
  sb += '<span class="vl-event__meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
    + enc(venue) + '</span>'
  sb += '<a class="vl-event__go" href="' + enc(href) + '">Event details <span aria-hidden="true">&rarr;</span></a>'
  sb += '</span></li>'
  return sb
}

/** HttpUtility.HtmlDecode */
function htmlDecode(s) {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}

// Project blurb for a deck card. The API's Description can carry editor HTML and
// &nbsp;-joined words (the same source that once forced sideways scrolling), so
// strip tags, decode entities and collapse ALL whitespace — including U+00A0 —
// before trimming to a word boundary. Returns HTML-ENCODED text, ready to emit.
function vlBlurb(value, max) {
  let s = value === null || value === undefined ? '' : String(value)
  if (!s.trim()) return ''
  s = s.replace(/<[^>]+>/g, ' ')
  s = htmlDecode(s)
  s = s.replace(/[\s ]+/g, ' ').trim()
  if (s.length === 0) return ''
  if (s.length <= max) return enc(s)
  let cut = s.substring(0, max)
  const sp = cut.lastIndexOf(' ')
  if (sp > 40) cut = cut.substring(0, sp)
  return enc(cut.replace(/[.,;:]+$/, '')) + '&#8230;'
}

// One group of marquee items (the orange ticker). Rendered twice per track so a
// translateX(-50%) loop is seamless.
function marqueeGroup() {
  // Rotary International presidential themes / messages, most recent first — the
  // marquee scrolls the movement's yearly rallying cries (user request 2026-07-16).
  const items = [
    'Create Lasting Impact', 'Unite for Good', 'The Magic of Rotary',
    'Create Hope in the World', 'Imagine Rotary', 'Serve to Change Lives',
    'Rotary Opens Opportunities', 'Rotary Connects the World', 'Be the Inspiration',
    'Rotary: Making a Difference', 'Rotary Serving Humanity', 'Be a Gift to the World',
  ]
  let sb = ''
  for (const it of items) {
    sb += '<span class="vl-marquee__item">' + enc(it) + '</span>'
      + '<span class="vl-marquee__dot">◆</span>'
  }
  return sb
}

/** Short mono "seal" tag for a signatory card, keyed by getLeaders' type
 *  (1 = RI President, 2 = District Governor, 4 = Club President, 5 = Secretary). */
function sealFor(type) {
  switch (Number(type) || 0) {
    case 1: return 'RI'
    case 2: return 'DG'
    case 4: return 'PRES'
    case 5: return 'SEC'
    default: return '•'
  }
}

/** Rotary year label "2025-26" -> [2025-07-01, 2026-07-01). */
function rotaryYearRange(label) {
  if (!label || !String(label).trim()) return null
  const m = String(label).match(/(\d{4})/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  return [new Date(start, 6, 1), new Date(start + 1, 6, 1)]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "ddd dd MMM" upper-cased, invariant — "SAT 12 JUL". */
function ledgerDate(d) {
  return (DAYS[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()]).toUpperCase()
}

/** Up to `take` upcoming events inside the selected Rotary year, soonest first,
 *  shaped for the "standing order" list. */
async function getLedgerEvents(clubId, yearLabel, take, zone) {
  const range = rotaryYearRange(yearLabel)
  const upcoming = await api.getUpcomingEvents(clubId, 40)
  return upcoming
    .filter((ev) => ev.eventDate)
    .map((ev) => ({ ev, d: new Date(ev.eventDate) }))
    .filter(({ d }) => !range || (d >= range[0] && d < range[1]))
    .sort((a, b) => a.d - b.d)
    .slice(0, take)
    .map(({ ev, d }) => ({
      // The id was dropped here, which is why the card's "Event details" link
      // pointed at the /events LISTING instead of the event itself.
      id: ev.id,
      date: ledgerDate(d),
      time: (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) ? '' : formatTime(d, zone),
      title: !ev.title || !String(ev.title).trim() ? 'Club programme' : String(ev.title).trim(),
      venue: !ev.venue || !String(ev.venue).trim() ? 'Venue to be announced' : String(ev.venue).trim(),
      img: !ev.imagePath || !String(ev.imagePath).trim() ? '' : media(ev.imagePath),
    }))
}

/** Resolve the counter band's own year from ?statYear: "all" (or absent, or an
 *  unknown id) => aggregate every Rotary year; a valid year id => that single
 *  year. Kept apart from the page/header year so the two dropdowns move on their own. */
function resolveCounterYear(years, raw) {
  if (raw && raw.toLowerCase() !== 'all') {
    const id = Number(raw)
    const y = Number.isInteger(id) ? years.find((o) => o.id === id) : null
    if (y) return { isAllYears: false, yearId: id, headingLead: ledgerPeriod(y.yearLabel) }
  }
  return { isAllYears: true, yearId: null, headingLead: 'Every year' }
}

export default function HomeVerdigrisLedger({ data }) {
  const club = useClub()
  const location = useLocation()
  const navigate = useNavigate()
  // Uncapped featured (the deck carries the club's whole project list in one
  // scroller) and the default 4 newsletters — GetFeatured() / GetNewsletterItems(4).
  const d = useHomeData(data.home)
  const {
    banners, ads, projectStats, membershipStats, featured, newsletters,
    meetingDay, meetingTime, meetingVenue, featuredCount, newslettersCount,
  } = d

  usePageTitle(club.clubName)

  // ── Counter band's OWN year control (independent of the header year) ──
  // Defaults to ALL YEARS (lifetime totals); the user narrows it via ?statYear.
  const years = club.years
  const statYear = new URLSearchParams(location.search).get('statYear')
  const counter = useMemo(() => resolveCounterYear(years, statYear), [years, statYear])
  const [counterStats, setCounterStats] = useState(null)

  // The counter's four project-stat tiles: for one chosen year, or — the default
  // — summed across every Rotary year for a lifetime "All years" view. Each
  // year's numbers come from the same audited path the single-year band uses
  // (getImpactNumbersForYear), so the aggregate is an honest sum, not a re-estimate.
  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false

    ;(async () => {
      let tiles
      if (!counter.isAllYears) {
        tiles = buildProjectStatTiles(await getImpactNumbersForYear(club.clubId, counter.yearId))
      } else {
        // "All years" sums ~2-3 API calls PER Rotary year — heavy for a long history
        // (21 years here ≈ 6s cold). Closed past years are immutable, so cache the summed
        // aggregate with an explicit TTL (ApiCache's heavy-read opt-out) even though the
        // site is otherwise instant-mode; the key carries the year COUNT so a new year
        // busts it. An explicit single-year selection above stays live, so admin edits to
        // the current year are always verifiable there.
        tiles = await getOrAdd('vl:counteragg:' + club.clubId + ':' + years.length, async () => {
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
      }
      if (!cancelled) setCounterStats(tiles)
    })()

    return () => { cancelled = true }
  }, [club.clubId, counter.isAllYears, counter.yearId, years])

  // ── Standing order: only the SINGLE next upcoming event (user call 2026-07-14)
  //    — the notice board shows one featured card; the calendar link covers the rest.
  const [events, setEvents] = useState([])
  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false
    getLedgerEvents(club.clubId, club.selectedYearLabel, 1, club.timeZone)
      .then((list) => { if (!cancelled) setEvents(list) })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearLabel])

  const eventsShown = events.length
  const bandStats = counterStats || projectStats
  const sizeCls = vlSizeClass(bandStats, membershipStats)

  // The counter band's OWN year picker: re-totals just the counter — "All years"
  // (a lifetime sum) by default, or one chosen year. Independent of the header
  // year select. rotary-anim.js's initYearSelect() does this with a full reload;
  // in the SPA it is a router navigation, like shared/YearSelect.jsx.
  function onCounterYearChange(e) {
    const params = new URLSearchParams(location.search)
    if (e.target.value && e.target.value !== 'all') params.set('statYear', e.target.value)
    else params.delete('statYear')
    const qs = params.toString()
    navigate(location.pathname + (qs ? '?' + qs : '') + location.hash)
  }

  // "Get directions" target for the meeting panel — a plain Google Maps search on the
  // venue (the embedded map was removed by request). Falls back to the club name when
  // the club has posted no address, so the link is never a search for "—".
  function vlDirectionsUrl() {
    let q = meetingVenue
    if (!q || !q.trim() || q.trim() === '—') q = club.clubName
    if (!q || !q.trim()) q = 'Rotary Club'
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q.trim())
  }

  useRotaryAnim([d.loading, banners.length, ads.length, featuredCount, eventsShown,
    newslettersCount, d.leaders.length, bandStats.length, counter.yearId])

  // ── The plate re-shapes to the banner that is showing ──────────────────────
  // ledger.css pins the plate to 8/3 (2.667), but clubs upload every shape: a
  // 996x596 poster (1.67) lost 37% of its height to object-cover — the top and
  // bottom of the artwork simply gone. Publishing the current slide's ratio as
  // --vl-plate-r lets the plate take the image's own shape, so nothing is cut.
  //
  // This plate is FULL-BLEED (100vw), so matching a 1.67 image head-on would make
  // it ~1130px tall — one and a half screens. ledger.css therefore caps the
  // height at 82vh and derives the WIDTH from the ratio, so a tall banner
  // letterboxes at the sides against the plate's own white rather than being
  // cropped or swallowing the page.
  const plateRef = useRef(null)
  useEffect(() => {
    const plate = plateRef.current
    if (!plate) return
    let current = null
    // A freak upload can't make the full-bleed plate absurdly tall or thin.
    // Outside this range the image does still crop.
    const clamp = (r) => Math.min(3.6, Math.max(1, r))

    const measure = () => {
      const slides = [...plate.querySelectorAll('[data-hero-slide]')]
      // rotary-anim's show() marks the live slide opacity-100; before it first
      // runs nothing is marked, so fall back to slide 0.
      const active = slides.find((s) => s.classList.contains('opacity-100')) || slides[0]
      const img = active && active.querySelector('img')
      if (!img || !img.naturalWidth) return
      const r = clamp(img.naturalWidth / img.naturalHeight)
      if (current === r) return
      current = r
      plate.style.setProperty('--vl-plate-r', String(r))
    }

    const cleanups = []
    measure()
    plate.querySelectorAll('[data-hero-slide]').forEach((slide) => {
      const mo = new MutationObserver(measure)
      mo.observe(slide, { attributes: true, attributeFilter: ['class'] })
      cleanups.push(() => mo.disconnect())
    })
    plate.querySelectorAll('img').forEach((img) => {
      // Also fires after an onerror fallback swaps in a different URL.
      img.addEventListener('load', measure)
      cleanups.push(() => img.removeEventListener('load', measure))
    })
    return () => cleanups.forEach((off) => off())
  }, [banners])

  // ledger.js drives the rail, the project-deck fan-out and the collapse button,
  // but it bails out when .vl-home isn't in the DOM — and it is injected while the
  // boot loader is still up. Await the script (loadThemeScripts resolves once it
  // has executed), then init; it is idempotent, so extra calls are free.
  const [deckReady, setDeckReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadThemeScripts('verdigris-ledger').then(() => {
      if (cancelled) return
      if (window.LedgerHome && window.LedgerHome.init) window.LedgerHome.init()
      setDeckReady(true)      // only now is the deck's own click handler attached
    })
    return () => { cancelled = true }
  }, [d.loading, featuredCount])

  return (
    <div className="vl-home">

      <div className="vl-wrap">

        {/* 01 · THE PLATES (banner slider, mounted as a ledger plate) */}
        <section className="vl-sec" data-vl-section="banner">
          <figure className="vl-plate-mount vl-plate-mount--full reveal" data-hero data-hero-interval="5500">
            <div className="vl-plate" ref={plateRef}>
              {banners.map((b, i) => {
                const plate = <img src={b.src} data-fallbacks={b.fallbacks} alt="Club banner" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-cover" />
                // The anchor has to BE the slide: rotary-anim toggles pointerEvents on
                // [data-hero-slide], so a nested link would stay clickable while hidden.
                return b.url ? (
                  <a key={i} href={b.url} {...adAnchorProps(b.url)} aria-label={b.title || 'Open banner link'} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">
                    {plate}
                  </a>
                ) : (
                  <div key={i} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">
                    {plate}
                  </div>
                )
              })}
              <button type="button" data-hero-prev aria-label="Previous plate" className="vl-nav vl-nav--prev">&#8249;</button>
              <button type="button" data-hero-next aria-label="Next plate" className="vl-nav vl-nav--next">&#8250;</button>
            </div>
            <figcaption className="vl-plate-cap" style={{ display: 'none' }}>
              <span className="vl-plate-cap__no">Plate 01</span>
              <span className="vl-plate-cap__tx">Entered in the field this Rotary year</span>
              <span className="vl-plate-cap__dots">
                {banners.map((_, i) => (
                  <button key={i} type="button" data-hero-dot aria-label="Go to plate" className="h-2 w-2 rounded-sm bg-white/60 transition-all"></button>
                ))}
              </span>
            </figcaption>
          </figure>
        </section>
      </div>{/* /vl-wrap */}

      {/* 02 · MARQUEE TICKER (full-bleed orange band) — directly below the banner */}
      <div className="vl-marquee reveal" aria-hidden="true">
        <div className="vl-marquee__row">
          <div className="vl-marquee__track">
            <div className="vl-marquee__group" dangerouslySetInnerHTML={{ __html: marqueeGroup() }}></div>
            <div className="vl-marquee__group" dangerouslySetInnerHTML={{ __html: marqueeGroup() }}></div>
          </div>
        </div>
      </div>

      <div className="vl-wrap">

        {/* 03 · THE SIGNATORIES (dignitaries & leaders) */}
        <section className="vl-sec" data-vl-section="leaders">
          <div className="vl-sec-head reveal">
            <h2 className="vl-h2">Dignitaries &amp; <span className="vl-strike">Leaders</span></h2>
          </div>
          <div className="vl-sign-grid">
            {d.leaders.map((l) => (
              /* Executive profile card (2026-07-23): peacock masthead band + circular
                 conic-ring avatar. spotlight-card gives the cursor-aware glow via
                 rotary-anim.js --spot-x/--spot-y; ledger.css recolors it plum. */
              <article key={l.type} className="vl-sign spotlight-card reveal">
                <div className="vl-sign__top">
                  <span className="vl-sign__seal" aria-hidden="true">{sealFor(l.type)}</span>
                  <div className="vl-sign__ring">
                    <img className="vl-sign__ava" src={l.img} alt={l.name} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} />
                  </div>
                </div>
                <div className="vl-sign__body">
                  <h3 className="vl-sign__name">{l.name}</h3>
                  <span className="vl-sign__role">{l.role}</span>
                  <span className="vl-sign__ink" aria-hidden="true"></span>
                  <a className="vl-sign__link" href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)}>View profile <em aria-hidden="true">&rarr;</em></a>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>{/* /vl-wrap */}

      {/* 04 · AUDITED TOTALS (full-bleed counter band — ux-india dark restyle) */}
      <div className="vl-band vl-band--counter vl-band--ux" data-vl-section="counter">
        <div className="vl-wrap">
          <div className="vl-sec-head vl-sec-head--counter reveal">
            <h2 className="vl-h2">{counter.headingLead}, <span className="vl-strike">Projects</span></h2>
            {/* The counter's OWN year picker: independent of the header year. Defaults to
                "All years" (a lifetime sum of every Rotary year); pick a year to narrow it. */}
            <label className="vl-count-year">
              {/* The "Showing" caption was removed by request. The <select> keeps its
                  aria-label, so the control is still named for screen readers. */}
              <span className="vl-count-year__field">
                <select data-count-year-select aria-label="Counter totals year"
                        value={counter.isAllYears ? 'all' : String(counter.yearId)}
                        onChange={onCounterYearChange}>
                  <option value="all">All years</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{ledgerPeriod(y.yearLabel)}</option>
                  ))}
                </select>
                <svg className="vl-count-year__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </label>
          </div>
          <ul className="vl-stats" dangerouslySetInnerHTML={{ __html:
            bandStats.map((s, i) => vlCounterTile(s, i, sizeCls)).join('') +
            membershipStats.map((s) => vlCounterTile(s, 0, sizeCls)).join('') }} />
        </div>
      </div>

      <div className="vl-wrap">

        {/* 05 · NOTICES & UPCOMING EVENTS (advertisement plate + events schedule) */}
        <section className="vl-sec" data-vl-section="notices">
          <div className="vl-notice">
            {/* Advertisement plate */}
            <div className="reveal">
              <div className="vl-colhead"><h2>Advertisement</h2></div>
              <div data-hero data-hero-interval="4500" className="vl-ad">
                {ads.map((ad, i) => (
                  <a key={i} href={ad.url} {...adAnchorProps(ad.url)} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">
                    {/* Blurred cover copy behind a contained poster: the club uploads
                        posters in any ratio, and plain object-cover was cropping their
                        edges. Same treatment the classic theme's banner/ad plates use.
                        Decorative, but it walks the SAME uploads-path fallback chain as
                        the real poster — otherwise a first-URL 404 (common for ad media)
                        would recover the poster and leave the fill blank. */}
                    <img src={ad.img} data-fallbacks={ad.fallbacks} alt="" aria-hidden="true" className="vl-ad__fill" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} />
                    <img src={ad.img} data-fallbacks={ad.fallbacks} alt="Advertisement" className="vl-ad__img" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} />
                  </a>
                ))}
                <div className="vl-dots absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2">
                  {ads.map((_, i) => (
                    <button key={i} type="button" data-hero-dot aria-label="Go to notice" className="h-2 w-2 rounded-sm bg-white/60 transition-all"></button>
                  ))}
                </div>
              </div>
            </div>
            {/* Upcoming events schedule */}
            <div className="reveal">
              <div className="vl-colhead"><h2>Upcoming events</h2><a className="vl-pill" href="/events">View all <span className="vl-pill__ar" aria-hidden="true">&rarr;</span></a></div>
              {eventsShown === 0 ? (
              <ul className="vl-events">
                {/* No dated events: a centred panel, NOT the two-up card — now a flat
                    duotone illustration (calendar + potted plant, peacock/marigold ink)
                    over the existing copy, a marigold rule, and a pill CTA. A CTA link
                    here was pulled once before ("View all" in the column head already
                    covers the route) but the shared empty-state pattern now ships one
                    on every theme, so it's back — as a real .vl-pill, not a repeat of
                    the removed plain-text link. */}
                <li className="vl-event vl-event--empty">
                  <svg className="vl-event__empty-art" width="200" height="164" viewBox="0 0 200 164" fill="none" aria-hidden="true">
                    <ellipse cx="104" cy="96" rx="92" ry="58" fill="#901F93" fillOpacity="0.07"/>
                    <ellipse cx="82" cy="80" rx="58" ry="46" fill="#901F93" fillOpacity="0.05"/>
                    <g fill="#901F93" fillOpacity="0.5">
                      <path d="M176 46l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
                      <path d="M20 92l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>
                      <path d="M118 16l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                    </g>
                    <path d="M28 130h34l-5 24a4 4 0 0 1-4 3H37a4 4 0 0 1-4-3l-5-24Z" fill="#6E1770"/>
                    <rect x="24" y="124" width="42" height="9" rx="4" fill="#3A0E3C"/>
                    <path d="M45 124C18 112 14 78 22 58 46 70 47 104 45 124Z" fill="#901F93" fillOpacity="0.88"/>
                    <path d="M45 124C64 106 70 76 56 54 46 74 44 102 45 124Z" fill="#3A0E3C" fillOpacity="0.7"/>
                    <path d="M45 124C38 100 40 78 45 62 52 82 50 106 45 124Z" fill="#6E1770" fillOpacity="0.95"/>
                    <rect x="76" y="40" width="104" height="108" rx="14" fill="#fff" stroke="#3A0E3C" strokeWidth="3"/>
                    <path d="M76 54a14 14 0 0 1 14-14h76a14 14 0 0 1 14 14v16H76V54Z" fill="#901F93"/>
                    <line x1="102" y1="24" x2="102" y2="46" stroke="#3A0E3C" strokeWidth="3" strokeLinecap="round"/>
                    <circle cx="102" cy="22" r="6" fill="#fff" stroke="#3A0E3C" strokeWidth="3"/>
                    <line x1="154" y1="24" x2="154" y2="46" stroke="#3A0E3C" strokeWidth="3" strokeLinecap="round"/>
                    <circle cx="154" cy="22" r="6" fill="#fff" stroke="#3A0E3C" strokeWidth="3"/>
                    <g fill="#6E1770" fillOpacity="0.3">
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
                  <b className="vl-event__title">No dated events on the register yet</b>
                  <div className="vl-card__rule" aria-hidden="true"></div>
                  <span className="vl-event__meta">Dates appear here as the club posts them.</span>
                  {/* The empty state carried its own "Open the register" pill, which
                      duplicated the "View all" pill in this column's header — two links to
                      /events on screen at once. Removed by request; the header one stays
                      because it shows whether or not there are events. */}
                </li>
              </ul>
              ) : (
              <ul className="vl-events" dangerouslySetInnerHTML={{ __html: events.map((ev, i) => vlEventCard(ev, i, club.selectedYearId)).join('') }} />
              )}
            </div>
          </div>
        </section>

        {/* Hide the ENTIRE projects band — heading and divider included — when the
            selected year has none, matching classic / warm-modern / civic. This used
            to keep the band and swap in an empty-state hint, so verdigris was the one
            theme that still showed an "Our Projects" heading with nothing under it.
            The leading vl-rule is inside the guard too, or hiding the band would
            leave two dividers stacked against the next section. */}
        {featuredCount > 0 && (
        <>
        <div className="vl-rule"></div>

        {/* 05 · THE COMMUNITY (ux-india card deck — projects fan out on click) */}
        <div className="vl-band vl-band--community" data-vl-section="community">
          {/* Structure is the .aspx's verbatim: a centred tilted stack that fans out.
              A single project has nothing to fan out, so it renders already open and
              the lone card lies flat.
              The ONLY behavioural change (by request 2026-08-04) lives in ledger.js:
              a click on a CARD now follows its link straight to the project instead
              of being swallowed to open the deck. Clicking the deck around the cards
              still fans it out. */}
          <div className={'vl-comm' + (featuredCount === 1 ? ' is-open' : '')} data-vl-comm>
            <h2 className="vl-comm__head reveal">Our <span className="ac">Projects</span></h2>
            <div className="vl-deck reveal" data-vl-deck tabIndex={0} role="button" aria-label="Project deck — activate to fan the cards out into a scrolling row"
                 onClickCapture={(e) => {
                   // Until ledger.js has attached its handler, swallow clicks on the
                   // collapsed stack. Without this the first click follows the card's
                   // href straight to the project — the deck only worked "the second
                   // time", once the script had caught up.
                   const comm = e.currentTarget.closest('[data-vl-comm]')
                   if (!deckReady && comm && !comm.classList.contains('is-open')) e.preventDefault()
                 }}>
              <div className="vl-deck__track" data-vl-track>
                {featured.map((p) => (
                  /* ProjectDetail reads Request.QueryString["pid"] — NOT "id". Emitting ?id= made
                     every home "Read more" land on "Project Not Found". Keep this in sync with
                     AllProjects.aspx / Gallery.aspx, which also link with ?pid=. */
                  <a key={p.id} className="vl-tcard" href={withYear('/project?pid=' + p.id, club.selectedYearId)}>
                    <span className="vl-tcard__media">
                      <img src={media(p.img)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none' }} />
                    </span>
                    <h3 className="vl-tcard__title">{p.title}</h3>
                    {/* The blurb fills the dead space the title used to leave above the
                        button. Already HTML-encoded by vlBlurb, so emitted raw. */}
                    <p className="vl-tcard__desc" dangerouslySetInnerHTML={{ __html: vlBlurb(p.desc, 170) }}></p>
                    <span className="vl-tcard__btn">Read more <span aria-hidden="true">&rarr;</span></span>
                  </a>
                ))}
              </div>
            </div>
            {featuredCount > 1 && (
            <button type="button" className="vl-comm__collapse" data-vl-collapse>Collapse the deck</button>
            )}
          </div>
        </div>
        </>
        )}

        <div className="vl-rule"></div>

        {/* 06 · THE STANDING ORDER & DISPATCHES (meeting info | newsletters, side by side) */}
        <section className="vl-sec" data-vl-section="meeting">
          <div className="vl-order">
            {/* Map iframe removed by request. The three facts now read as stacked rows
                that stretch to the newsletters column's height, with the directions
                link pinned to the foot so both columns end level. */}
            <div className="vl-meet reveal">
              <div className="vl-colhead"><h2>Meeting information</h2></div>
              <div className="vl-meet__panel">
                <div className="vl-meet__row">
                  <span className="vl-meet__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
                  <span className="vl-meet__tx"><span className="lb">We meet</span><b>{meetingDay}</b></span>
                </div>
                <div className="vl-meet__row">
                  <span className="vl-meet__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                  <span className="vl-meet__tx"><span className="lb">Time</span><b>{meetingTime}</b></span>
                </div>
                <div className="vl-meet__row">
                  <span className="vl-meet__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
                  <span className="vl-meet__tx"><span className="lb">Venue</span><b>{meetingVenue}</b></span>
                </div>
                <a className="vl-pill vl-meet__go" href={vlDirectionsUrl()} target="_blank" rel="noopener noreferrer">Get directions <span className="vl-pill__ar" aria-hidden="true">&rarr;</span></a>
              </div>
            </div>
            {/* Newsletters */}
            <div className="reveal">
              <div className="vl-colhead"><h2>Newsletters</h2><a className="vl-pill" href="/newsletters">View all <span className="vl-pill__ar" aria-hidden="true">&rarr;</span></a></div>
              {newslettersCount > 0 ? (
              <ul className="vl-news">
                {newsletters.map((n, i) => (
                  <li key={i}>
                    <a href={n.url} target="_blank" rel="noopener noreferrer">
                      <span className="vl-news__ic">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        PDF
                      </span>
                      <span className="vl-news__tx">
                        <span className="vl-news__ti">{n.title}</span>
                        <span className="vl-news__dt">{n.date}</span>
                      </span>
                      <span className="vl-news__go">Read →</span>
                    </a>
                  </li>
                ))}
              </ul>
              ) : (
              <div className="vl-empty">
                <h3>No newsletters filed yet</h3>
                <p>Issues appear here as the club publishes them. Browse a previous year from the selector above.</p>
              </div>
              )}
            </div>
          </div>{/* /vl-order */}
        </section>

      </div>{/* /vl-wrap */}

      {/* 07 · JOIN (full-bleed marigold band) */}
      {/* --join recolours the band marigold. The plain peacock .vl-band ran straight
          into the peacock footer below it and the two read as one dark slab. */}
      <div className="vl-band vl-band--join">
        <div className="vl-wrap">
          <section className="vl-join" data-vl-section="join">
            <div>
              <h2 className="reveal">Become a Person of <span className="vl-strike">Action</span>.</h2>
              <p className="g reveal">You do not need to be rich or retired. You need an evening a week and the willingness to show up. Members, corporate partners and one-time volunteers all have a line in this ledger.</p>
            </div>
            <div className="vl-cta reveal">
              {/* "Visit a meeting" removed by request; the survivor carries the band. */}
              <a className="vl-btn vl-btn--pri" href="/projects?pr=CP"><span>Partner a project</span></a>
            </div>
          </section>
        </div>
      </div>

    </div>
  )
}
