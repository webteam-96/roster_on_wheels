'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage — home. The G sample ("the club's year as a crafted
// scrapbook") on useHomeData, for any club:
//   hero (club name filled with a project photo, banner print + scattered
//   prints, pinned scatter on desktop) · leaders (a pile that deals out into
//   one row as you scroll) · our impact (stickers) · our story (5 lines + Read
//   more) beside upcoming events · the project wall · newsletters and where we
//   meet in one row. The club's ads open as a popup. (Order and sections: client, 2026-09-29.)
// Every section hides itself when the club has no data for it, except the
// project wall, which shows a designed empty note (it is the club's work).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useClub, useHomeData, usePageTitle, withYear, adAnchorProps, groupInt, media, LOGO_PLACEHOLDER } from '../_shared/data.js'
import { PersonPhoto, imgFallback, hideOnError, isPlaceholderPhoto } from '../_shared/kit.jsx'
import { useScene, useRefreshOnImages, gsap, lockScroll, prefersReducedMotion } from '../_shared/motion.js'
import {
  CLEAR, dealIn, decor, parallax, swayScrub, develop, captionIn, swing, settleIn, slideIn,
  stickersIn, revealBatch, drawNow, developIn, bounceChars,
} from './motion.js'
import {
  P, Draw, Underline, Tape, TAPE_CYCLE, photoType, SectionHead, Circled, Tag, Chip, StatRow,
  EmptyState, Print, Button, TextLink, Cutouts, htmlParagraphs, excerpt, cleanText, yearDash, useFitLine,
} from './kit.jsx'
import './home.css'

const side = (i) => (i % 2 ? 1 : -1)

// ── the club name: "Rotary Club of" + the name that gets the photo ──────────
function splitName(name) {
  const s = String(name || '').trim()
  const m = /^(rotary\s+club\s+of|rotaract\s+club\s+of|rotary\s+club)\s+(.+)$/i.exec(s)
  if (m) return [m[1], m[2]]
  // the API files most clubs by place name alone ("Thane Hills"): the sample's
  // "Rotary Club of" line is restored, as cinematic does; e-clubs/Rotaract stay as filed
  return s && !/^rota/i.test(s) ? ['Rotary Club of', s] : ['', s]
}

// ── the story, from the club's own about text (no invented facts) ──────────
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
const DATE_RE = new RegExp('(?:' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTH + ',?\\s+)?(?:18|19|20)\\d{2}\\b')
const CHARTER_RE = /\b(chartered|founded|established|formed|inaugurated|instituted|incorporated)\b/i
const splitSentences = (t) => String(t || '')
  .split(/(?<!\b(?:Mr|Mrs|Ms|Dr|PP|Rtn|Rtr|St|No|Nos|Sr|Jr|Lt|Prof|Hon|Smt|Shri|Pvt|Ltd|Co|Inc|Govt|Dist|Rs|Estd|[A-Z]))\.\s+(?=[A-Z0-9“"‘'(])/)
  .map((s) => s.trim()).filter(Boolean)
  .map((s) => (/[.!?…"”’')]$/.test(s) ? s : s + '.'))

function buildStory(html) {
  const paras = htmlParagraphs(html).map(cleanText).filter(Boolean)
  // a short first line with no full stop (or in capitals) is the page's own title ("Rotary Club of X – An overview")
  while (paras.length > 1 && paras[0].length < 90 && (!/[.!?]$/.test(paras[0]) || paras[0] === paras[0].toUpperCase())) paras.shift()
  if (!paras.length || paras.join(' ').length < 40) return null
  const all = paras.join(' ')
  const first = splitSentences(paras[0])
  let lead = first[0] || paras[0]
  if (lead.length > 260) lead = excerpt(lead, 240)
  const rest = [first.slice(1).join(' '), ...paras.slice(1)].filter(Boolean)
  const body = []
  let budget = 720
  for (const p of rest) {
    if (body.length === 2 || budget < 90) break
    let acc = ''
    for (const s of splitSentences(p)) {
      if (acc && acc.length + s.length > budget) break
      acc += (acc ? ' ' : '') + s
    }
    if (acc.length > budget) acc = excerpt(acc, budget)
    body.push(acc)
    budget -= acc.length
  }
  // the charter date, only when a sentence plainly states it about the club
  // ("chartered" is the club's own word; "founded/established…" must name the club
  // or Rotary in the same sentence, or it may be about something else)
  let year = '', circle = '', verb = ''
  for (const s of splitSentences(all)) {
    const cm = CHARTER_RE.exec(s)
    if (!cm || (!/charter/i.test(cm[0]) && !/\b(club|rotary)\b/i.test(s))) continue
    const dm = DATE_RE.exec(s)
    const y = dm && /(?:18|19|20)\d{2}/.exec(dm[0])
    if (!y || +y[0] > new Date().getFullYear()) continue
    year = y[0]
    verb = /charter/i.test(cm[0]) ? 'Chartered' : 'Founded'
    if (lead.includes(dm[0])) circle = dm[0]
    break
  }
  return { lead, body, year, verb, circle }
}

// ── layout tables (from the sample) ─────────────────────────────────────────
// the scattered prints: side, x, y, tilt, depth (flight speed in the pinned scatter), swing
const SATS = [
  { i: 0, s: 'l', x: '2%', y: '5%', r: -8, d: 0.7, k: 0.8 }, { i: 1, s: 'r', x: '3%', y: '3%', r: 7, d: 1, k: -0.9 },
  { i: 3, s: 'l', x: '1.5%', y: '73%', r: -4, d: 0.9, k: 1 }, { i: 5, s: 'l', x: '4.5%', y: '30%', r: 5, d: 1.25, k: -0.6 },
  { i: 6, s: 'r', x: '1.5%', y: '41%', r: -5, d: 0.6, k: 0.7 }, { i: 2, s: 'r', x: '5%', y: '64%', r: 4, d: 1.35, k: -1 },
]
const CUT_DEPTH = [1.6, 1.9, 2.2, 1.4]
// the wall: 12-col placement, drop, tilt, parallax speed, swing, photo shape
const WALL = [
  { c: '1 / span 7', r: -2.5, s: 1.08, k: 0.7, ar: '4 / 3' },
  { c: '9 / span 4', r: 3, s: 0.9, k: -0.8, mt: '14vh', ar: '4 / 5' },
  { c: '2 / span 4', r: 2, s: 1.12, k: 0.9, ar: '1 / 1' },
  { c: '7 / span 6', r: -1.5, s: 0.94, k: -0.6, mt: '8vh', ar: '3 / 2' },
  { c: '1 / span 4', r: -3, s: 1.15, k: 1, ar: '4 / 5' },
  { c: '5 / span 4', r: 2.5, s: 0.9, k: -0.9, mt: '12vh', ar: '1 / 1' },
  { c: '9 / span 4', r: -2, s: 1.05, k: 0.6, ar: '3 / 4' },
]
// club first, then district, then Rotary International
const LEADER_ORDER = { 1: 0, 2: 1, 4: 2, 5: 3 } // RI President, DG, club President, Secretary (client, 2026-09-29)
const AD_PLACEHOLDER = 'img/ClubAdvirtisment.png'
const EVENT_STOCK = /^\/?images\/event\//i
const HERO_INT = 6000

// ── the club's advertisements: a popup each time the home opens (a reload included) ──
// Native modal dialog (Esc, focus kept inside, starts on Close); never over the open menu.
const AD_MS = 5000
function AdPopup({ ads, clubId }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const n = ads.length

  // opens straight away (client, 2026-10-06: the 2.6s wait felt late) - as soon as the first ad's picture has
  // downloaded, so the card never appears empty (1.5s cap if it is slow); still waits while the menu is open
  useEffect(() => {
    if (!n) return undefined
    let t = 0, done = false
    const arm = (ms) => { clearTimeout(t); t = setTimeout(() => (document.documentElement.classList.contains('col-menu-open') ? arm(400) : setOpen(true)), ms) }
    const go = () => { if (!done) { done = true; arm(0) } }
    const im = new Image()
    im.onload = go; im.onerror = go
    im.src = ads[0].img
    if (im.complete) go()
    const cap = setTimeout(go, 1500)
    return () => { clearTimeout(t); clearTimeout(cap); im.onload = im.onerror = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, clubId])

  useEffect(() => {
    const dlg = ref.current
    if (!open || !dlg) return undefined
    const back = document.activeElement
    if (!dlg.open) dlg.showModal()
    lockScroll(true)
    return () => {
      lockScroll(false)
      if (back && back.isConnected && back.focus) back.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open || n < 2 || hold || prefersReducedMotion()) return undefined
    const t = setInterval(() => setI((k) => (k + 1) % n), AD_MS)
    return () => clearInterval(t)
  }, [open, n, hold])

  if (!n || !open) return null
  const k0 = i % n
  const a = ads[k0]
  const name = a.title || 'Advertisement ' + (k0 + 1)
  const linked = a.url && a.url !== '#'
  const img = <img key={a.img} className="col-adpop-img" src={a.img} data-fallbacks={a.fallbacks} alt={linked ? '' : name} decoding="async" onError={imgFallback} />
  const close = () => setOpen(false)
  return (
    <dialog ref={ref} className="col-adpop" aria-label="Advertisement" onClose={close} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <button type="button" className="col-adpop-x" onClick={close}><span aria-hidden="true">&times;</span><span className="col-sr">Close advertisement</span></button>
      <div className="col-adpop-in" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
        <div className="col-adpop-card">
          <Tape tone="gold" tilt={-5} />
          {linked ? <a className="col-adpop-link" href={a.url} {...adAnchorProps(a.url)}>{img}<span className="col-sr">{name} (opens in a new tab)</span></a> : img}
        </div>
        {n > 1 ? (
          <div className="col-adpop-ctrl" role="group" aria-label="Advertisements">
            <button type="button" className="col-adpop-step" onClick={() => setI((k) => (k - 1 + n) % n)}><span aria-hidden="true">&larr;</span><span className="col-sr">Previous advertisement</span></button>
            {ads.map((x, k) => (
              <button key={k} type="button" className="col-home-dot" aria-current={k === k0 ? 'true' : 'false'} onClick={() => setI(k)}><i /><span className="col-sr">Show advertisement {k + 1}</span></button>
            ))}
            <button type="button" className="col-adpop-step" onClick={() => setI((k) => (k + 1) % n)}><span aria-hidden="true">&rarr;</span><span className="col-sr">Next advertisement</span></button>
          </div>
        ) : null}
      </div>
    </dialog>
  )
}

export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { featuredTake: 4, newsletterTake: 2 }) // the wall shows four projects (client, 2026-09-29)
  usePageTitle(club.clubDisplayName)

  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const h1Ref = useRef(null)
  const frameRef = useRef(null)

  const clubName = club.clubDisplayName
  const [pre, main] = splitName(clubName)
  const Y = yearDash(club.selectedYearLabel)
  const yearId = club.selectedYearId
  const about = d.about || null
  const district = String((about && about.districtNumber) || '').trim()

  // photos available for the photo-filled type (project photos, cycled)
  const withImg = useMemo(() => d.featured.filter((p) => p.img), [d.featured])
  const fImg = (i) => (withImg.length ? withImg[i % withImg.length].img : '')
  const members = (d.membershipStats[0] && d.membershipStats[0].value) || 0

  useFitLine(h1Ref, [main, withImg.length])
  useRefreshOnImages(rootRef, [d.loading, d.ads.length, d.events.length])

  // ── banner slideshow: each new print "develops" in ────────────────────────
  const banners = d.banners
  const n = banners.length
  const [cur, setCur] = useState(0)
  const [prev, setPrev] = useState(-1)
  // no Pause button (client, 2026-10-05): hover / focus still hold it (bannerHold), reduced motion never autoplays
  const [paused] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [hold, setHold] = useState(false)
  const idx = Math.min(cur, Math.max(0, n - 1))
  // each banner's own width / height, once it has loaded: the print's width follows the shown one
  const [shapes, setShapes] = useState({})
  const shapeOf = (i) => (e) => {
    const im = e.currentTarget
    if (im.naturalWidth && im.naturalHeight) setShapes((m) => (m[i] ? m : { ...m, [i]: im.naturalWidth / im.naturalHeight }))
  }
  const ar = Math.min(3.6, Math.max(1.2, shapes[idx] || 3.2))
  // speed (2026-10-05): a slide fetches its photo only once it is on, leaving or next -
  // club banners are multi-MB PNGs and fetching every one at once starved the first
  const fetched = useRef(new Set())
  const wants = (i) => {
    if (i === idx || i === prev || (n > 1 && i === (idx + 1) % n)) fetched.current.add(i)
    return fetched.current.has(i)
  }
  // the hero's decorative prints wait for the first banner (or 2.5s), so they never compete with it
  const [heroReady, setHeroReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setHeroReady(true), 2500); return () => clearTimeout(t) }, [])
  useEffect(() => { setCur(0); setPrev(-1); fetched.current = new Set() }, [banners])
  const go = useCallback((k) => {
    if (k === idx || k < 0 || k >= n) return
    setPrev(idx)
    setCur(k)
  }, [idx, n])
  useEffect(() => {
    if (paused || hold || n < 2) return undefined
    const t = setTimeout(() => { if (!document.hidden) go((idx + 1) % n) }, HERO_INT)
    return () => clearTimeout(t)
  }, [paused, hold, n, idx, go])
  useEffect(() => {
    if (prev < 0) return undefined
    const next = frameRef.current && frameRef.current.children[idx]
    const tw = developIn(next, () => setPrev(-1))
    return () => { if (tw) { tw.kill(); gsap.set(next, { clearProps: 'opacity,filter' }) } }
  }, [idx, prev])

  // ── derived sections ──────────────────────────────────────────────────────
  const story = useMemo(() => buildStory(about && about.content), [about])

  const imp = d.impactNumbers
  // order (client, 2026-10-27): projects, cost, beneficiaries, man hours, members
  const stats = [
    { value: imp.projects, label: 'Projects' },
    { value: imp.totalCost, label: 'Total project cost', money: true },
    { value: imp.beneficiaries, label: 'Beneficiaries' },
    { value: imp.manHours, label: 'Man hours' },
    { value: members, label: 'Members' },
  ].filter((s) => Number(s.value) > 0)

  const sats = SATS.map((o) => ({ ...o, p: withImg[o.i] })).filter((o) => o.p)

  const leaders = d.leaders
    .filter((l) => l && l.name && l.name !== 'Not available' && LEADER_ORDER[l.type] !== undefined)
    .sort((a, b) => (LEADER_ORDER[a.type] ?? 9) - (LEADER_ORDER[b.type] ?? 9))

  const ev = d.events[0] || null
  const logo = about ? media(about.clubLogoPath) || media(about.rotaryLogoPath) || '' : ''
  const evImg = ev && ev.img && !EVENT_STOCK.test(ev.img) ? ev.img : ''
  const news = d.newsletters.filter((x) => x && x.url)
  const ads = d.ads.filter((a) => a && a.img && a.img !== AD_PLACEHOLDER)
  const day = d.meetingDay && d.meetingDay !== '—' ? d.meetingDay : ''
  const meet = [['Day', day], ['Time', d.meetingTime], ['Venue', d.meetingVenue]].filter(([, v]) => v && v !== '—')

  // ── motion 1: the hero entrance (once per visit to the page) ──────────────
  useScene(stageRef, (c, ctx) => {
    const st = stageRef.current
    const q = (s) => Array.from(st.querySelectorAll(s))
    const cuts = q('.col-cut .col-cut-in, .col-cut svg')
    if (cuts.length) gsap.from(cuts, { scale: 0, rotation: -120, opacity: 0, duration: 0.9, ease: 'back.out(1.6)', stagger: 0.1, delay: 0.9, clearProps: CLEAR })
    if (h1Ref.current) gsap.fromTo(h1Ref.current, { clipPath: 'inset(-20% 100% -20% -20%)' }, { clipPath: 'inset(-20% -20% -20% -20%)', duration: 1.2, ease: 'power3.inOut', delay: 0.15, clearProps: 'clipPath' })
    gsap.from(q('.col-home-hp-in'), { y: 60, rotation: 3, opacity: 0, duration: 1.1, ease: 'power3.out', delay: 0.3, clearProps: CLEAR })
    const subs = q('.col-home-sub > span')
    if (subs.length) gsap.from(subs, { y: 14, opacity: 0, duration: 0.7, stagger: 0.08, delay: 0.8, ease: 'power3.out', clearProps: CLEAR })
    drawNow(q('.col-home-scribble'), { delay: 1.05, duration: 1.1 })
    drawNow(q('.col-home-cue svg'), { delay: 1.6, duration: 0.8 })
    return bounceChars(st.querySelector('.col-home-h1-pre'), ctx)
  }, [])

  // ── motion 2: the scroll choreography, built once the data is in ──────────
  // created top to bottom; the shell's velocity trigger makes ScrollTrigger sort
  // by page position anyway, so each pin's spacing reaches the triggers below it
  useScene(rootRef, (c) => {
    if (d.loading) return undefined
    const root = rootRef.current
    const stage = stageRef.current
    const q = (s, r = root) => Array.from(r.querySelectorAll(s))
    const one = (s) => root.querySelector(s)
    const undo = []

    // hero: the prints are dealt onto the table, then scatter as you scroll
    dealIn(q('.col-home-sat .col-print-fl'))
    const satEls = q('.col-home-sat'), cuts = q('.col-home-stage .col-cut'), h1 = h1Ref.current
    const photoH1 = h1 && h1.classList.contains('is-img')
    if (c.wide) {
      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: stage, start: 'top top', end: '+=90%', pin: true, scrub: 0.6, invalidateOnRefresh: true } })
      satEls.forEach((s) => {
        const dd = +s.getAttribute('data-depth') || 1, dir = s.classList.contains('is-r') ? 1 : -1
        tl.to(s, { x: () => dir * dd * window.innerWidth * 0.2, y: () => -dd * window.innerHeight * 0.62, rotation: dir * dd * 18, scale: 1 + dd * 0.22, ease: 'power1.in' }, 0)
      })
      cuts.forEach((cu, i) => {
        const dd = CUT_DEPTH[i] || 1.5
        tl.to(cu, { x: () => side(i) * window.innerWidth * 0.05 * dd, y: () => -dd * window.innerHeight * 0.5, rotation: side(i) * 120 * dd, ease: 'power1.in' }, 0)
      })
      tl.to(one('.col-home-hp-card'), { rotation: 0, scale: 1.06, y: () => -window.innerHeight * 0.03 }, 0)
        .to(one('.col-home-copy'), { y: () => -window.innerHeight * 0.05 }, 0)
      const cue = one('.col-home-cue')
      if (cue) tl.to(cue, { opacity: 0, y: 24, duration: 0.2 }, 0)
      if (photoH1) tl.fromTo(h1, { backgroundPosition: '50% 12%' }, { backgroundPosition: '50% 88%' }, 0)
    } else {
      const st = () => ({ trigger: stage, start: 'top 15%', end: 'bottom top', scrub: 0.5 })
      satEls.forEach((s, i) => gsap.to(s, { y: -(40 + i * 38), rotation: side(i) * 9, ease: 'none', scrollTrigger: st() }))
      cuts.forEach((cu, i) => gsap.to(cu, { y: -110, rotation: side(i) * 160, ease: 'none', scrollTrigger: st() }))
      gsap.to(one('.col-home-hp-card'), { rotation: 0, ease: 'none', scrollTrigger: st() })
      if (photoH1) gsap.fromTo(h1, { backgroundPosition: '50% 12%' }, { backgroundPosition: '50% 88%', ease: 'none', scrollTrigger: st() })
    }

    // about us: the logo card is dealt onto the table
    const storyEl = one('.col-home-story')
    if (storyEl) { decor(storyEl); revealBatch(q('.col-home-logo-card', storyEl)) }

    // upcoming events: the print is dealt, the ticket drops in
    const evEl = one('.col-home-events')
    if (evEl) {
      decor(evEl)
      revealBatch(q('.col-home-ev-print .col-print-fl', evEl))
      develop(q('.col-print-photo img', evEl))
      settleIn(q('.col-home-ticket-move', evEl))
    }

    // numbers: stickers pop, spin, count up, drift
    const nums = one('.col-home-numbers')
    if (nums) { decor(nums); undo.push(stickersIn(q('.col-stk', nums), { wide: c.wide })) }

    // the wall: multi-speed parallax, prints swing and develop, captions write themselves
    const wall = one('.col-home-projects')
    if (wall) {
      decor(wall)
      parallax(q('.col-home-pj-move', wall), { wide: c.wide })
      swayScrub(q('.col-home-pj .col-print-fl', wall))
      develop(q('.col-home-pj .col-print-photo img', wall))
      captionIn(q('.col-home-pj .col-print-cap', wall))
      q('.col-home-wc', wall).forEach((cu, i) => gsap.fromTo(cu, { y: () => wall.offsetHeight * 0.12 }, {
        y: () => -wall.offsetHeight * 0.3, rotation: side(i) * 150, ease: 'none',
        scrollTrigger: { trigger: wall, start: 'top bottom', end: 'bottom top', scrub: 0.4, invalidateOnRefresh: true },
      }))
    }

    // leaders: on wide screens the cards start as one pile in the middle and deal out
    // into their row as the section scrolls in (client, 2026-09-29); the row is the end state
    const ld = one('.col-home-leaders')
    if (ld) {
      decor(ld)
      const list = ld.querySelector('.col-home-ld-list')
      const items = q('.col-home-ld', ld)
      if (c.wide && items.length > 1) {
        // layout offsets (not rects), so the pile is measured without the tweens' own transforms
        const dx = (li) => list.offsetWidth / 2 - (li.offsetLeft + li.offsetWidth / 2)
        items.forEach((li, i) => {
          gsap.fromTo(li, { x: () => dx(li), y: 40 + i * 6, rotation: (i - (items.length - 1) / 2) * 7, zIndex: items.length - i }, {
            x: 0, y: 0, rotation: 0, ease: 'power2.out',
            scrollTrigger: { trigger: list, start: 'top 88%', end: 'top 32%', scrub: 0.6, invalidateOnRefresh: true },
          })
        })
        undo.push(() => gsap.set(items, { clearProps: 'transform,zIndex' }))
      } else {
        revealBatch(items)
      }
      develop(q('img.col-home-ld-img', ld))
    }

    // newsletters slide in from alternating sides
    const newsEl = one('.col-home-news')
    if (newsEl) { decor(newsEl); slideIn(q('.col-home-nl-move', newsEl)) }

    // where we meet: the tag swings on its string
    const meetEl = one('.col-home-meet')
    if (meetEl) { decor(meetEl); swing(q('.col-tag', meetEl)) }

    return () => undo.forEach((f) => f())
  }, [d.loading, d.featured.length, leaders.length, d.newsletters.length, d.events.length, ads.length, stats.length, !!story, meet.length])

  // ── render ────────────────────────────────────────────────────────────────
  const h1pt = photoType(fImg(3), 'cran')

  const bannerHold = {
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') setHold(true) },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') setHold(false) },
    onFocus: () => setHold(true),
    onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHold(false) },
  }

  return (
    <div className="col-home" ref={rootRef}>
      {/* ══ hero: the table ══ */}
      <section className="col-home-hero" aria-labelledby="col-home-h1">
        <div className="col-home-stage" ref={stageRef}>
          <div className="col-home-copy">
            <h1 id="col-home-h1" className="col-home-h1">
              {pre ? <><span className="col-home-h1-pre">{pre}</span>{' '}</> : null}
              <span ref={h1Ref} className={'col-home-h1-main ' + h1pt.className} style={h1pt.style} data-pt-hold={heroReady ? undefined : ''}>{main}</span>
            </h1>
            {district || Y ? (
              <p className="col-home-sub">
                {district ? <span>District {district}</span> : null}
                {district && Y ? <span aria-hidden="true">·</span> : null}
                {Y ? <span>Rotary year {Y}</span> : null}
                <Underline className="col-home-scribble" />
              </p>
            ) : null}
          </div>

          <div className="col-home-print" role="region" aria-roledescription="carousel" aria-label="Club banners" style={{ '--col-ar': ar.toFixed(3) }} {...bannerHold}>
            <div className="col-home-hp-card">
              <div className="col-home-hp-in">
                <Tape left="9%" tilt={-9} />
                <Tape tone="cran" left="91%" tilt={7} />
                <div className="col-home-frame" ref={frameRef}>
                  {banners.map((b, i) => {
                    const cls = 'col-home-slide' + (i === idx ? ' is-on' : '') + (i === prev && i !== idx ? ' is-off' : '')
                    const alt = b.title || clubName + ' banner ' + (i + 1) + ' of ' + n
                    const src = wants(i) ? b.src : undefined
                    const first = i === 0 ? { fetchpriority: 'high' } : null
                    const art = (
                      <>
                        <img className="col-home-slide-fill" src={src} data-fallbacks={b.fallbacks} alt="" aria-hidden="true" decoding="async" onError={imgFallback} {...first} />
                        <img className="col-home-slide-img" src={src} data-fallbacks={b.fallbacks} alt={alt} width="1920" height="600"
                          decoding="async" onError={imgFallback} {...first}
                          onLoad={(e) => { shapeOf(i)(e); if (i === idx) setHeroReady(true) }} />
                      </>
                    )
                    return b.url
                      ? <a key={b.src + i} className={cls} href={b.url} {...adAnchorProps(b.url)}>{art}<span className="col-sr"> (opens in a new tab)</span></a>
                      : <figure key={b.src + i} className={cls} role="group" aria-roledescription="slide" aria-label={(i + 1) + ' of ' + n}>{art}</figure>
                  })}
                </div>
              </div>
            </div>
            {n > 1 ? (
              <div className="col-home-bctrl">
                <div className="col-home-dots">
                  {banners.map((b, i) => (
                    <button key={i} type="button" className="col-home-dot" aria-label={'Show banner ' + (i + 1)} aria-current={i === idx ? 'true' : 'false'} onClick={() => go(i)}><i /></button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <p className="col-home-cue" aria-hidden="true">Scroll<Draw d={[P.down, P.downHead]} viewBox="0 0 40 50" /></p>

          {sats.length ? (
            <ul className="col-home-sats" aria-hidden="true">
              {sats.map((o, k) => (
                <li key={o.p.id} className={'col-home-sat is-' + o.s} data-depth={o.d} style={{ '--col-x': o.x, '--col-y': o.y, '--col-r': o.r + 'deg', '--col-k': o.k }}>
                  <div className="col-print-fl">
                    <div className="col-print">
                      <Tape tone={TAPE_CYCLE[k % 4]} tilt={k % 2 ? 6 : -5} />
                      <div className="col-print-photo">
                        <img src={heroReady ? o.p.img : undefined} alt="" fetchpriority="low" decoding="async" onError={(e) => { const li = e.currentTarget.closest('li'); if (li) li.style.display = 'none' }} />
                      </div>
                      {o.p.avenueLabel ? <p className="col-print-cap">{o.p.avenueLabel}</p> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <Cutouts />
        </div>
      </section>

      {/* ══ our leaders: straight after the banner, dealt out into one row ══ */}
      {leaders.length ? (
        <section className="col-sec col-home-leaders" aria-labelledby="col-home-ld-t">
          <div className="col-home-ld-stage">
            <SectionHead id="col-home-ld-t" title="Our leaders" img={fImg(5)} tint="violet" />
            <ul className="col-home-ld-list" style={{ '--col-n': Math.min(leaders.length, 4) }}>
              {leaders.map((l, i) => {
                const role = l.type === 2 && district ? (l.role || 'District Governor') + ', ' + district : l.role
                return (
                  <li key={l.type + l.name} className="col-home-ld" style={{ '--col-r': [-3, 4, -2, 3][i % 4] + 'deg' }}>
                    <div className="col-home-ld-photo">
                      <div className="col-home-ld-card">
                        <Tape tone={TAPE_CYCLE[(i + 1) % 4]} tilt={i % 2 ? 5 : -4} />
                        <PersonPhoto src={isPlaceholderPhoto(l.img) ? '' : l.img} name={l.name} className="col-home-ld-img" monoClass="col-home-ld-mono" />
                      </div>
                    </div>
                    <div className="col-home-ld-text">
                      {role ? <p className="col-home-ld-role">{role}</p> : null}
                      <h3>{l.name}</h3>
                      <TextLink href={withYear('/dignitary?Type=' + l.type, yearId)} sr={l.name}>Read profile</TextLink>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ══ our impact ══ */}
      {stats.length ? (
        <section className="col-sec col-home-numbers" aria-labelledby="col-home-num-t">
          <SectionHead id="col-home-num-t" title="Our impact" img={fImg(5)} tint="royal" kicker={Y ? 'Rotary year ' + Y : null} />
          <StatRow items={stats} currency={d.currency} />
        </section>
      ) : null}

      {/* ══ about us: five lines + Read more, the club's logo beside it (client, 2026-09-29) ══ */}
      {story ? (
        <section className="col-sec col-home-story" aria-labelledby="col-home-story-t">
          <div className={'col-home-story-grid' + (logo ? ' has-logo' : '')}>
            <div className="col-home-story-text">
              <SectionHead id="col-home-story-t" title="About us" img={fImg(0)} tint="azure" />
              <p className="col-home-lead col-home-clamp">{[story.lead, ...story.body].join(' ')}</p>
              <p className="col-home-story-more"><Button href="/about">Read more<span className="col-sr"> about the club</span></Button></p>
            </div>
            {logo ? (
              <div className="col-home-logo" aria-hidden="true">
                <div className="col-home-logo-card">
                  <Tape tone="gold" tilt={-6} />
                  <img src={logo} alt="" decoding="async" onError={(e) => { if (e.currentTarget.src.indexOf(LOGO_PLACEHOLDER) < 0) e.currentTarget.src = LOGO_PLACEHOLDER }} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ══ upcoming events: its own section (client, 2026-09-29) ══ */}
      {ev ? (
        <section className="col-sec col-home-events" aria-labelledby="col-home-ev-t">
          <SectionHead id="col-home-ev-t" title="Upcoming events" img={fImg(2)} tint="violet" />
          <div className={'col-home-ev' + (evImg ? ' has-img' : '')}>
            {evImg ? <div className="col-home-ev-print"><Print src={evImg} r={-2} k={0.8} tape="gold" ratio="4 / 3" /></div> : null}
            <div className="col-home-ev-body">
              <div className="col-home-ticket-move">
                <p className="col-home-ticket">
                  <span className="col-home-ticket-day">{ev.day}</span>
                  <span className="col-home-ticket-mon">{ev.mon} {ev.year}</span>
                  {ev.time ? <span className="col-home-ticket-time">{ev.time}</span> : <span />}
                </p>
              </div>
              <h3 className="col-home-ev-title">{cleanText(ev.title)}</h3>
              <p className="col-home-ev-venue">{ev.venue}</p>
              {ev.desc ? <p className="col-home-ev-desc">{excerpt(ev.desc, 220)}</p> : null}
              <p className="col-home-ev-links">
                <Button href={'/event?id=' + ev.id}>Event details<span className="col-sr">: {cleanText(ev.title)}</span></Button>
                <TextLink href="/events">All upcoming events</TextLink>
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ══ our projects: the wall ══ */}
      {!d.loading ? (
        <section className="col-sec col-home-projects" aria-labelledby="col-home-pj-t">
          {d.featured.length ? (
            <>
              <span className="col-home-wc is-1" aria-hidden="true"><i className="col-cut-in" /></span>
              <span className="col-home-wc is-2" aria-hidden="true"><i className="col-cut-in" /></span>
              <span className="col-home-wc is-3" aria-hidden="true"><i className="col-cut-in" /></span>
              <span className="col-home-wc is-4" aria-hidden="true"><i className="col-cut-in" /></span>
            </>
          ) : null}
          <SectionHead id="col-home-pj-t" title="Our projects" img={fImg(1)} tint="cran" />
          {d.featured.length ? (
            <>
              <ul className="col-home-wall">
                {d.featured.map((p, i) => {
                  const w = WALL[i % WALL.length]
                  const title = cleanText(p.title) || 'Project'
                  const desc = excerpt(p.desc, 170)
                  return (
                    <li key={p.id} className="col-home-pj" data-col-speed={w.s} style={{ '--col-col': w.c, '--col-mt': w.mt || '0px', '--col-r': w.r + 'deg', '--col-k': w.k }}>
                      <div className="col-home-pj-move">
                        <div className="col-print-fl">
                          <div className="col-print">
                            <Tape tone={TAPE_CYCLE[i % 4]} tilt={i % 2 ? 4 : -5} />
                            <div className="col-print-photo" style={{ aspectRatio: w.ar }}>
                              {p.img ? <img src={p.img} alt={title} loading="lazy" decoding="async" onError={hideOnError} /> : null}
                            </div>
                            <h3 className="col-print-cap">{title}</h3>
                          </div>
                        </div>
                        <div className="col-note col-home-pj-note">
                          {p.avenueLabel ? <p className="col-home-pj-meta"><Chip>{p.avenueLabel}</Chip></p> : null}
                          {desc ? <p className="col-home-pj-desc">{desc}</p> : null}
                          <TextLink href={withYear('/project?pid=' + p.id, yearId)} sr={title}>View project</TextLink>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="col-home-more"><Button href="/projects">View all projects</Button></p>
            </>
          ) : (
            <EmptyState as="h3" title="No projects filed yet" message={'Projects the club records for ' + (Y ? 'Rotary year ' + Y : 'this Rotary year') + ' will appear on this wall.'} />
          )}
        </section>
      ) : null}

      {/* ══ newsletters and where we meet, in one row ══ */}
      {news.length || meet.length ? (
        <div className={'col-home-nm' + (news.length && meet.length ? ' is-two' : '')}>
          {news.length ? (
            <section className="col-sec col-home-news" aria-labelledby="col-home-nl-t">
              <SectionHead id="col-home-nl-t" title="Newsletters" img={fImg(2)} tint="azure" />
              <ul className="col-home-nl-list">
                {news.map((x, i) => (
                  <li key={x.url + i} className="col-home-nl">
                    <div className="col-home-nl-move">
                      <a className="col-home-nl-card" href={x.url} target="_blank" rel="noopener noreferrer" style={{ '--col-r': (i % 2 ? 2.5 : -2) + 'deg', '--col-k': i % 2 ? -0.8 : 0.8 }}>
                        <svg className="col-home-nl-clip" viewBox="0 0 26 62" aria-hidden="true" focusable="false"><path d={P.clip} /></svg>
                        <span className="col-home-nl-title">{cleanText(x.title) || 'Newsletter'}</span>
                        {x.date ? <span className="col-home-nl-date">{x.date}</span> : null}
                        <span className="col-home-nl-cta">Read newsletter <span aria-hidden="true">&#x2197;</span><span className="col-sr"> (opens in a new tab)</span></span>
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="col-home-all"><TextLink href="/newsletters">All newsletters</TextLink></p>
            </section>
          ) : null}

          {meet.length ? (
            <section className="col-sec col-home-meet" aria-labelledby="col-home-meet-t">
              <SectionHead id="col-home-meet-t" title="Where we meet" img={fImg(4)} tint="royal" center />
              <Tag className="col-home-tag">
                <dl className="col-home-tag-facts">
                  {meet.map(([k, v]) => (
                    <div key={k} className={'is-' + k.toLowerCase() + (k === 'Day' && v.length > 10 ? ' is-long' : '')}>
                      <dt>{k}</dt>
                      <dd style={k === 'Day' ? { '--n': Array.from(String(v)).length } : undefined}>{k === 'Day' ? <Circled>{v}</Circled> : v}</dd>
                    </div>
                  ))}
                </dl>
                {d.mapUrl && d.meetingVenue && d.meetingVenue !== '—' ? (
                  <TextLink href={d.mapUrl} external>Open in maps</TextLink>
                ) : null}
              </Tag>
            </section>
          ) : null}
        </div>
      ) : null}

      {d.loading ? null : <AdPopup ads={ads} clubId={club.clubId} />}
    </div>
  )
}
