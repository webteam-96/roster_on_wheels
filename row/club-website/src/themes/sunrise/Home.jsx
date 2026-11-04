'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE — the home page. The approved sample (H-sunrise-modes) ported onto
// useHomeData, for every club:
//
//   intro     the banner in a frame of its own shape (no blurred bands); with motion
//             it pins, grows as big as the stage allows and holds there, sharp, then
//             leaves; the club's figures arrive one by one out of the depth, count up
//             at the centre and settle into one row along the foot of the stage, as
//             big as the row allows; then row and heading meet halfway (only figures
//             above zero; no figures -> the scene ends on the grown banner)
//   leaders   right after the figures: RI President, DG, club President, Secretary,
//             portraits rising in arches like suns, a Read more each (placeholders
//             dropped)
//   about     "About" + four lines of the club's own About text + Read more; beside
//             it the club's advertisements as bare pictures as tall as the text (real
//             ones only), else the crest in rising rings
//   projects  a tunnel of project photos under a heading that stays at the top
//             (wide + motion, 2+ photos); cards on a tilted plane on phones; photos
//             whole at their own ratio; a designed empty state when there are none
//   coming    upcoming events: the next event; hidden when there is none
//   finale    sunrise over the hills, one sheet: the latest two newsletters as
//             covers whose suns rise | where we meet (day / time / venue / maps)
//
// data-sun-sky on each section anchors the fixed sky (motion.js skyDriver);
// data-sun-warm marks the grounds that stay legible on the warm stops.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import {
  useClub, useHomeData, usePageTitle, withYear, formatMoney, groupInt, media, LOGO_PLACEHOLDER,
} from '../_shared/data.js'
import { useFitNumbers } from '../_shared/kit.jsx'
import {
  gsap, SplitText, useScene, afterFonts, useRefreshOnImages, headerHeight,
  flyTitle, focusPull, ringsRise, liftSheet, standUp, sunrise, flyChars, photoTunnel, tiltRise, revealBatch, countUp,
} from './motion.js'
import {
  Button, Person, People, Cover, Sheet, Hills, DateSun, EmptyState, SectionHead, WinSlide, SlideCtrl, useSlides, Emblem,
  ArrowUpRight, ClockIcon, PinIcon, ext, excerpt, emFirstDate, noEmoji, hideOnError, openHref, yearText, venueText,
} from './kit.jsx'
import './home.css'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const AD_PLACEHOLDER = /ClubAdvirtisment\.png$/i
const EVENT_PLACEHOLDER = /images\/event\/e-2\.jpg$/i
const has = (v) => !!v && v !== '—'

// ── the club's About text -> its prose as one paragraph ─────────────────────
const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,div,blockquote,td,dd,dt'
function parseAbout(html) {
  const src = String(html || '').trim()
  if (!src) return null
  // an inert document: nothing in it loads or runs (a detached <div> would still fire an <img onerror>)
  const el = new DOMParser().parseFromString(src.replace(/<br\s*\/?>/gi, '\n'), 'text/html').body
  const clean = (s) => noEmoji(String(s || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim())
  const all = clean(el.textContent)
  if (!all) return null
  let blocks = Array.from(el.querySelectorAll(BLOCKS))
    .filter((n) => !n.querySelector(BLOCKS))
    .map((n) => ({ li: !!n.closest('li'), h: /^H\d$/.test(n.tagName), text: clean(n.textContent).replace(/\n+/g, ' ') }))
    .filter((b) => b.text)
  // text that lives outside block elements (a pasted blob with <br>s): use its lines instead
  if (blocks.reduce((s, b) => s + b.text.length, 0) < all.length * 0.6) {
    blocks = all.split(/\n+/).map((t) => ({ text: t.trim() })).filter((b) => b.text)
  }

  // the prose (no headings, no list items) as one paragraph: the home shows its first four lines,
  // so a few sentences are plenty (screen readers get the same text, not the whole page)
  const prose = (bs) => bs.filter((b) => !b.li && !b.h && b.text.length >= 40).map((b) => b.text).join(' ')
  // a short first line is the text's own title ("This is Kaizen ABC"): not prose - the section is
  // simply "About" (client, 2026-10-01) - unless it is all the club wrote
  const first = blocks[0]
  const titled = first && !first.li && first.text.length <= 90 && (first.h || !/[.!?]$/.test(first.text))
  return excerpt((titled && prose(blocks.slice(1))) || prose(blocks), 480)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { newsletterTake: 2 })
  usePageTitle(club.clubDisplayName)

  const clubName = club.clubDisplayName
  const yearId = club.selectedYearId
  const year = yearText(club.selectedYearLabel)
  const about = d.about || null
  const district = about && about.districtNumber ? String(about.districtNumber).trim() : ''
  const cur = d.currency || club.currency

  // "Rotary Club of" becomes the serif pre-line; the rest is the display name
  const short = clubName.replace(/^\s*(the\s+)?rotary\s+club\s+of\s+/i, '').trim()
  const hasPre = !!short && short !== clubName.trim()
  const shownName = hasPre ? short : clubName
  const longName = shownName.length > 16

  // ── figures (only the ones above zero) ─────────────────────────────────────
  const figs = useMemo(() => {
    const n = d.impactNumbers || {}
    const members = d.membershipStats && d.membershipStats[0] ? d.membershipStats[0].value : 0
    return [   // order (client, 2026-10-27): projects, cost, beneficiaries, man-hours, members
      { k: 'projects', label: 'Projects', v: n.projects },
      { k: 'totalCost', label: 'Total cost', v: n.totalCost, money: true },
      { k: 'beneficiaries', label: 'Beneficiaries', v: n.beneficiaries },
      { k: 'manHours', label: 'Man-hours', v: n.manHours },
      { k: 'members', label: 'Members', v: members },
    ].filter((f) => Number(f.v) > 0)
  }, [d.impactNumbers, d.membershipStats])
  const fmtFig = (f, v) => (f.money ? formatMoney(v, cur) : groupInt(Math.round(v), cur))

  // ── about, advertisements, projects, leaders, events, newsletters ─────────
  const parsed = useMemo(() => parseAbout(about && about.content), [about])
  const aboutText = parsed
    ? parsed
    : district ? clubName + ' is a Rotary club in District ' + district + '.' : clubName + ' is part of Rotary International.'
  // the crest walks club logo -> Rotary logo -> placeholder instead of vanishing (a club's logo URL can 404)
  const crests = [...new Set([media(about && about.clubLogoPath), media(about && about.rotaryLogoPath), LOGO_PLACEHOLDER].filter(Boolean))]
  const nextCrest = (e) => {
    const el = e.currentTarget, i = crests.indexOf(el.getAttribute('src'))
    if (i >= 0 && i < crests.length - 1) el.src = crests[i + 1]
    else hideOnError(e)
  }

  const photoProjects = d.featured.filter((p) => p.img).slice(0, 7)
  const canTunnel = photoProjects.length >= 2
  const cards = canTunnel ? photoProjects : d.featured.slice(0, 6)
  const [ratios, setRatios] = useState({})
  const onRatio = (id) => (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w && h) setRatios((r) => (r[id] ? r : { ...r, [id]: clamp(w / h, 0.6, 2.2) }))
  }

  const ORDER = { 1: 0, 2: 1, 4: 2, 5: 3 }   // RI President, DG, club President, Secretary (client)
  const leaders = d.leaders
    .filter((l) => l && l.name && l.name !== 'Not available')
    .sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9))

  const ev = d.events[0] || null
  const evImg = ev && ev.img && !EVENT_PLACEHOLDER.test(ev.img) ? ev.img : ''
  // an advertisement whose picture fails every fallback leaves the slideshow: bare pictures leave no
  // window behind, so a dead one would be an empty link (the crest shows once none are left)
  const [deadAds, setDeadAds] = useState([])
  const ads = d.ads.filter((a) => a && a.img && !AD_PLACEHOLDER.test(a.img) && !deadAds.includes(a.img))
  // React bubbles an <img>'s error after WinSlide's own imgFallback has run: dead = it has fallen to the
  // generic ClubAdvirtisment.png placeholder (the chain's end - no advertisement) or been hidden
  const onAdError = (e) => {
    const img = e.target
    if (!img.classList || !img.classList.contains('sun-win__img')) return
    if (!AD_PLACEHOLDER.test(img.getAttribute('src') || '') && img.style.visibility !== 'hidden') return
    const slide = img.closest('.sun-win__slide'), i = slide ? Array.from(slide.parentNode.children).indexOf(slide) : -1
    if (ads[i]) setDeadAds((dd) => (dd.includes(ads[i].img) ? dd : [...dd, ads[i].img]))
  }
  const news = d.newsletters.filter((n) => n && n.url)
  const hasMeeting = has(d.meetingDay) || has(d.meetingTime) || has(d.meetingVenue)
  const dayWord = has(d.meetingDay) ? String(d.meetingDay).trim() : ''

  const hero = useSlides(d.banners.length, 6000)
  const adShow = useSlides(ads.length, 5500)
  // each banner's own shape, from its picture once loaded: the hero frame takes the showing one's
  // (React bubbles the <img> load to .sun-win__slides)
  const [bannerRatios, setBannerRatios] = useState({})
  const onBannerLoad = (e) => {
    const img = e.target
    if (!img.classList || !img.classList.contains('sun-win__img') || !img.naturalWidth) return
    const slide = img.closest('.sun-win__slide'), i = slide ? Array.from(slide.parentNode.children).indexOf(slide) : -1
    if (i < 0) return
    // the latest picture at each place wins: another Rotary year's banners (or a fallback picture)
    // reuse the same slide, and its shape must follow
    const r = clamp(img.naturalWidth / img.naturalHeight, 0.6, 4)
    setBannerRatios((o) => (o[i] === r ? o : { ...o, [i]: r }))
  }
  const heroRatio = bannerRatios[hero.idx] || bannerRatios[0] || 16 / 5

  // every scene rebuilds together when the data (or the year) changes
  const sceneKey = [
    d.loading, figs.map((f) => f.k + f.v).join(','), cards.map((p) => p.id).join(','), canTunnel,
    leaders.length, !!ev, ads.length, news.length, dayWord,
  ].join('|')

  const heroRef = useRef(null), introRef = useRef(null), aboutRef = useRef(null)
  // the plain grid (phones, tablets, reduced motion): one font size for every figure, the largest at which all
  // fit (client, 2026-10-07). Under .is-3d the scene sizes them itself, so the selector matches nothing there
  useFitNumbers(introRef, '.sun-intro:not(.is-3d) .sun-fig__num', '.sun-fig', [figs.map((f) => f.k + f.v).join(',')])
  const tunnelRef = useRef(null), leadersRef = useRef(null), comingRef = useRef(null), finaleRef = useRef(null)
  const rootRef = useRef(null)
  useRefreshOnImages(rootRef, [sceneKey])

  // ── load entrance (wrappers only, so the scrubbed children keep clean start values)
  useScene(heroRef, () => {
    const root = heroRef.current
    gsap.from(root.querySelector('.sun-hero__head'), { y: 36, opacity: 0, duration: 1.2, ease: 'power3.out', clearProps: 'transform,opacity,translate' })
    gsap.from(root.querySelector('.sun-hero__win'), { y: 50, opacity: 0, scale: 0.94, duration: 1.4, delay: 0.15, ease: 'power3.out', clearProps: 'transform,opacity,translate,scale' })
  }, [])

  // ── intro: the banner grows to its full size and holds there, sharp; then the
  //    figures arrive one by one and settle into a row along the foot of the stage
  useScene(introRef, (c, ctx) => {
    const intro = introRef.current
    const q = (s) => intro.querySelector(s)
    const winBox = q('.sun-hero__win'), win = q('.sun-win')

    // the resting window leans toward the pointer (CSS reads --sun-rx/--sun-ry); once the scroll
    // takes it (.is-grown) it squares up: flat, it is drawn sharp at every size
    let offLean = () => {}
    if (c.fine && c.wide) {
      const onMove = (e) => {
        win.style.setProperty('--sun-rx', ((e.clientY / window.innerHeight - 0.5) * -6).toFixed(2) + 'deg')
        win.style.setProperty('--sun-ry', ((e.clientX / window.innerWidth - 0.5) * 8).toFixed(2) + 'deg')
      }
      intro.classList.add('is-lean')
      window.addEventListener('pointermove', onMove, { passive: true })
      offLean = () => {
        window.removeEventListener('pointermove', onMove)
        intro.classList.remove('is-lean')
        win.style.removeProperty('--sun-rx'); win.style.removeProperty('--sun-ry')
      }
    }

    // the banners make the scene; the figures join it when they are all in the DOM
    const figEls = Array.from(intro.querySelectorAll('.sun-fig'))
    const withFigs = figEls.length > 0 && figEls.length === figs.length
    // phones and tablets (client, 2026-10-06): no pinned scene - the banner cannot grow past a phone's
    // width (it only slid down the screen), the stage left a lot of empty sky, and the bottom rows of the
    // stacked figures fell below a short screen. The banner stays under the name; the figures are a plain
    // grid that rises in and counts up
    if (!c.wide) {
      if (withFigs) {
        revealBatch(figEls)
        figEls.forEach((el, i) => countUp(el.querySelector('.sun-fig__num'), figs[i].v, (v) => fmtFig(figs[i], v)))
      }
      return offLean
    }
    if (!withFigs && !win.querySelector('.sun-win__slide')) return offLean
    const list = q('.sun-figs__list'), head = q('.sun-figs__head'), nameEl = q('.sun-hero__name')
    const numEls = figEls.map((f) => f.querySelector('.sun-fig__num'))
    const labEls = figEls.map((f) => f.querySelector('.sun-fig__label'))
    const nodes = numEls.map((p) => (p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild : null))
    const finals = figs.map((f) => fmtFig(f, f.v))
    intro.classList.add('is-3d')
    numEls.forEach((e) => { e.style.fontSize = '' })   // drop the plain grid's fitted size before the scene measures

    // the banner's big box: the stage, edge to edge on phones and tablets, a small margin on desktops.
    // The frame inside takes the showing picture's own shape (home.css), so every slide shows whole and
    // as big as it can. x/y are relative to the resting box, the window's containing block while .is-3d.
    // The dots + pause go down to the stage's foot as it grows (ctrlY), and the box ends above them:
    // left where they rested, they covered the foot of a 16:9 poster grown on a phone
    const ctrl = q('.sun-hero__ctrl')
    const my = () => clamp(intro.clientHeight * 0.04, 12, 32)
    const big = () => {
      const W = intro.clientWidth, H = intro.clientHeight
      const mx = c.wide ? clamp(W * 0.03, 16, 40) : 0, room = ctrl ? ctrl.offsetHeight + 12 : 0
      return { x: Math.round(mx - winBox.offsetLeft), y: Math.round(my() - winBox.offsetTop), w: Math.round(W - 2 * mx), h: Math.round(H - 2 * my() - room) }
    }
    const ctrlY = () => Math.round(intro.clientHeight - my() - ctrl.offsetHeight - ctrl.offsetTop)

    // the figures, in figure units of fstate.f: each arrives out of the depth counting up, has its
    // moment at the centre (D), then glides down into its slot (G) and stays. The slots: one row
    // along the foot of the stage (phones: three or two columns), every number at one size that
    // fits its slot; the moment point sits midway between the head and the row. Once the row is
    // full, the row rises and the head comes down (rstate.k) until they meet halfway: the numbers
    // right under the heading, the pair centred in the stage (client: no empty sky between them;
    // all of it moved under the row would just open the same gap before About)
    const n = figEls.length, D = 0.3, G = 0.5
    const fstate = { f: -1.2 }, rstate = { k: 0 }, shown = []
    let FW = 1, FH = 1, CX = 0, CY = 0, row = null
    const layout = () => {
      FW = intro.clientWidth; FH = intro.clientHeight
      head.style.marginTop = ''   // measured where it rests; renderFigs moves it again
      figEls.forEach((el, i) => {   // measured at the CSS sizes, with the final text
        numEls[i].style.fontSize = labEls[i].style.fontSize = ''
        if (nodes[i]) { nodes[i].nodeValue = finals[i]; shown[i] = finals[i] }
      })
      const m = figEls.map((el, i) => {   // width per px of font (layout widths: the transforms don't count)
        const nf = parseFloat(getComputedStyle(numEls[i]).fontSize), lf = parseFloat(getComputedStyle(labEls[i]).fontSize)
        return { nf, lf, nw: numEls[i].scrollWidth / nf, lw: labEls[i].scrollWidth / lf }
      })
      const rowMax = Math.min(1340, FW - 2 * clamp(FW * 0.04, 16, 48))
      // the grid (phones; a row that would leave the numbers small): equal columns, sized by the widest
      // number - and only where its rows fit under the heading (a phone on its side has a short stage)
      const fit = (k, cc) => Math.min(...m.map((x) => (rowMax / cc - 16) / x[k]))
      const gc = n !== 4 && fit('nw', 3) >= 20 && fit('lw', 3) >= 11 ? 3 : 2, gr = Math.ceil(n / gc)
      const gF = clamp(fit('nw', gc), 16, 48), gL = clamp(fit('lw', gc), 10, 13)
      const gFits = gr * (gF + gL * 2.6) + (gr - 1) * 14 <= FH - clamp(FH * 0.05, 16, 44) - (head.offsetTop + head.offsetHeight) - 12
      let cols = n, F = 0, L = 13, rowW = rowMax, xs = null
      if (FW >= 600 || n < 3) {
        // one row whose slots are each as wide as their own number (or label) with equal gaps: the
        // numbers take one size, as big as the row allows (client: bigger) - equal fifths held them
        // to the widest figure's fifth
        const sep = clamp(FW * 0.035, 24, 56)
        // labels at 13px - smaller only where they alone would overflow the row (a short, narrow stage)
        L = clamp((rowMax - sep * (n - 1)) / m.reduce((s, x) => s + x.lw, 0), 10, 13)
        const span = (f) => m.reduce((s, x) => s + Math.max(x.nw * f, x.lw * L), 0) + sep * (n - 1)
        F = 80
        while (F > 16 && span(F) > rowMax) F -= 1
        if (F >= 28 || n < 3 || !(gF > F && gFits)) {
          rowW = span(F)
          let x0 = (FW - rowW) / 2
          xs = m.map((x) => { const w = Math.max(x.nw * F, x.lw * L), cx = x0 + w / 2; x0 += w + sep; return cx })
        }
      }
      if (!xs) { cols = gc; F = gF; L = gL }
      const rows = Math.ceil(n / cols), rh = F + L * 2.6, gap = 14
      const top = FH - clamp(FH * 0.05, 16, 44) - rows * rh - (rows - 1) * gap
      const under = head.offsetTop + head.offsetHeight + clamp(FH * 0.07, 28, 72)
      row = {
        F, L, m, rise: Math.max(0, top - under), ruleY: top + rows * rh + (rows - 1) * gap + 10,
        slots: figEls.map((el, i) => {
          const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols)
          return { x: xs ? xs[i] : FW / 2 + ((i % cols) - (inRow - 1) / 2) * (rowW / cols), y: top + r * (rh + gap) + rh / 2 }
        }),
      }
      CX = FW / 2; CY = (head.offsetTop + head.offsetHeight + top) / 2
      list.style.perspectiveOrigin = CX + 'px ' + CY.toFixed(1) + 'px'   // they come out of the moment point
      list.style.setProperty('--sun-row-w', Math.round(rowW) + 'px')
    }
    const renderFigs = () => {
      if (!row) return
      const up = row.rise * rstate.k / 2   // each goes half the way
      head.style.marginTop = up ? up.toFixed(1) + 'px' : ''
      list.style.setProperty('--sun-row-y', Math.round(row.ruleY - up) + 'px')   // the horizon under the row rises with it
      figEls.forEach((el, i) => {
        const dd = i - fstate.f, s = row.slots[i], b = row.m[i]
        let x = CX, y = CY, tf = 'translate(-50%,-50%)', op = 1, k = 1, nf = '', lf = ''
        if (dd > 0) {
          // on its way out of the depth, from the right; the number materialises and counts up as it comes
          tf += ' translate3d(' + (dd * FW * (c.wide ? 0.5 : 0.6)).toFixed(1) + 'px,' + (-dd * FH * 0.05).toFixed(1) + 'px,' + (-dd * 560).toFixed(1) + 'px) rotateY(' + (-Math.min(dd, 2) * 16).toFixed(2) + 'deg)'
          op = dd < 1 ? 1 - dd * 0.45 : 0.55 * Math.pow(0.5, dd - 1)
          k = clamp((1 - dd) / 0.85, 0, 1)
        } else {
          // its moment at the centre, then down into its slot, shrinking as a real font size: it lands crisp
          const g = 1 - Math.pow(1 - clamp((-dd - D) / G, 0, 1), 3)
          if (g > 0) {
            x += (s.x - CX) * g; y += (s.y - CY - up) * g
            nf = (b.nf + (row.F - b.nf) * g).toFixed(2) + 'px'; lf = (b.lf + (row.L - b.lf) * g).toFixed(2) + 'px'
          }
        }
        el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px'; el.style.transform = tf
        el.style.opacity = op < 1 ? op.toFixed(3) : ''   // opacity only: visibility would hide the sr-only figure text
        numEls[i].style.opacity = dd > 0 ? clamp((1 - dd) / 0.7, 0, 1).toFixed(3) : ''
        numEls[i].style.fontSize = nf; labEls[i].style.fontSize = lf
        const txt = k < 1 ? fmtFig(figs[i], figs[i].v * (1 - Math.pow(1 - k, 3))) : finals[i]
        if (nodes[i] && shown[i] !== txt) { nodes[i].nodeValue = txt; shown[i] = txt }
      })
    }

    // without figures the pin ends on the hold: the grown banner scrolls away with the stage. R = when
    // the hold ends: a shorter hold under 900px, where a wide banner is near full width at rest and
    // barely grows (a phone scrolled most of a screen past a strip of picture in empty sky)
    const U = c.wide ? 0.55 : 0.42, R = c.wide ? 2.5 : 1.7, F0 = R + 0.4, TOTAL = withFigs ? F0 + n + 2.2 : R
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: intro, pin: true, scrub: c.fine ? 0.8 : 0.5, invalidateOnRefresh: true,
        start: () => 'top ' + headerHeight() + 'px',
        end: () => '+=' + Math.round(window.innerHeight * U * TOTAL),
        onRefresh: () => { if (withFigs) { layout(); renderFigs() } },
        onUpdate: (self) => { intro.classList.toggle('is-grown', self.progress > 0) },
      },
    })
    const lift = intro.querySelectorAll('.sun-hero__eyebrow, .sun-hero__pre')
    if (lift.length) tl.to(lift, { yPercent: -90, opacity: 0, duration: 0.45, stagger: 0.06 }, 0)
    // the banner grows to its big box - its real layout box, so the picture is drawn at its true size
    // every frame (a transform scale stretches a stale raster: the blur the client saw) - and holds
    // there for a real stretch of scroll
    // (--sun-fk: the picture settles to the foot of the box, over the dots - home.css .sun-win__frame)
    tl.fromTo(win, { left: 0, top: 0, width: () => winBox.offsetWidth, height: () => winBox.offsetHeight, '--sun-fk': 0 },
      { left: () => big().x, top: () => big().y, width: () => big().w, height: () => big().h, '--sun-fk': 1, duration: 1, ease: 'power2.inOut' }, 0.1)
    if (ctrl) tl.fromTo(ctrl, { y: 0 }, { y: ctrlY, duration: 1, ease: 'power2.inOut' }, 0.1)
    // the frame's corners ease down with it: flush on phones and tablets, where it meets the screen edges
    const frame = q('.sun-win__frame')
    if (frame) tl.fromTo(frame, { borderRadius: () => clamp(window.innerWidth * 0.02, 14, 28) }, { borderRadius: c.wide ? 12 : 0, duration: 1, ease: 'power2.inOut' }, 0.1)
    if (!withFigs) tl.to({}, { duration: R - 1.1 }, 1.1)
    else {
      // the figures take the stage: the banner rises away, and the dots + pause (they stay while the
      // slides play on through the grow and the hold, WCAG 2.2.2) leave with it
      tl.to(win, { top: () => big().y - Math.round(intro.clientHeight * 0.08), autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, R)
      if (ctrl) tl.to(ctrl, { y: () => ctrlY() - Math.round(intro.clientHeight * 0.08), autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, R)
      // opacity, not autoAlpha: a hidden list would hide the figures' sr-only text until scrolled
      tl.fromTo(list, { opacity: 0 }, { opacity: 1, duration: 0.4 }, R + 0.1)
        .fromTo(head, { z: -800, opacity: 0, transformPerspective: 800 }, { z: 0, opacity: 1, duration: 0.6, ease: 'power2.out' }, R + 0.2)
        .fromTo(fstate, { f: -1.2 }, { f: n - 1 + D + G, duration: n + 1, onUpdate: renderFigs }, F0)
        .fromTo(rstate, { k: 0 }, { k: 1, duration: 0.7, ease: 'power2.inOut', onUpdate: renderFigs }, F0 + n + 1)
        .to({}, { duration: 0.5 }, F0 + n + 1.7)
      layout(); renderFigs()
    }

    // the name's letters fly apart, up and toward the viewer; added to the scrubbed timeline once
    // split. They are gone by about halfway through the grow, and the growing window is stacked
    // over them (home.css), so the name never lies across the banner (client)
    let split = null
    const flyName = (chars) => {
      const mid = (chars.length - 1) / 2, now = tl.totalTime()
      gsap.set(chars, { transformPerspective: 700 })
      tl.to(chars, {
        z: (i) => Math.min(520, 220 + Math.abs(i - mid) * 30),   // under the 700px perspective: a long name never balloons
        x: (i) => (i - mid) * (c.wide ? 30 : 14),
        y: (i) => -60 - Math.abs(i - mid) * 8,
        rotationY: (i) => (i - mid) * 7,
        opacity: 0, duration: 0.45, ease: 'power2.in', stagger: { each: 0.012, from: 'center' },
      }, 0.02)
      tl.totalTime(0, true).totalTime(now, true)   // render the new tween at the current scroll position
    }
    const cancel = nameEl ? afterFonts(ctx, () => {
      split = SplitText.create(nameEl, { type: 'words,chars', charsClass: 'sun-c', wordsClass: 'sun-w', tag: 'span', aria: 'none' })
      nameEl.classList.add('is-split')
      flyName(split.chars)
    }) : () => {}

    return () => {
      cancel()
      if (split) split.revert()
      if (nameEl) nameEl.classList.remove('is-split')
      intro.classList.remove('is-3d', 'is-grown')
      if (withFigs) {
        list.style.perspectiveOrigin = ''; list.style.removeProperty('--sun-row-y'); list.style.removeProperty('--sun-row-w')
        head.style.marginTop = ''
        figEls.forEach((f, i) => {
          f.style.transform = f.style.opacity = f.style.left = f.style.top = ''
          numEls[i].style.opacity = numEls[i].style.fontSize = labEls[i].style.fontSize = ''
          if (nodes[i]) nodes[i].nodeValue = finals[i]
        })
      }
      offLean()
    }
  }, [sceneKey])

  // ── about: focus pull; the advertisements lift in, or the crest's rings rise ─
  useScene(aboutRef, (c) => {
    const s = aboutRef.current
    focusPull(s.querySelectorAll('.sun-about__lead'), c)
    flyTitle(s.querySelectorAll('.sun-fly'), c)
    revealBatch(s.querySelectorAll('.sun-about__ads'))
    const emblem = s.querySelector('.sun-emblem')
    if (emblem) ringsRise(emblem.querySelectorAll('.sun-emblem__glow, .sun-emblem__ring'), emblem)
  }, [sceneKey])

  // ── projects: the tunnel on wide screens, a tilted plane on phones (the photos
  //    stay whole: no drift inside their frames) ────────────────────────────────
  useScene(tunnelRef, (c) => {
    const stage = tunnelRef.current
    // the heading stays at the top of the pinned stage; the cards fly in under it (client). Only on a
    // stage tall enough to see a photo on its card: a phone on its side (932x430) made 150px cards,
    // their titles split mid-word. The height is a query of its own, so a turned tablet re-decides
    const mm = gsap.matchMedia(stage)
    mm.add({ tall: '(min-height: 540px)' }, (h) => {
      if (c.wide && canTunnel && h.conditions.tall) return photoTunnel(stage, c, { headTop: true })
      tiltRise(stage.querySelectorAll('.sun-tunnel__card'), null)
      flyTitle(stage.querySelectorAll('.sun-fly'), c)
      return undefined
    })
    return () => mm.revert()
  }, [sceneKey])

  useScene(leadersRef, (c) => { flyTitle(leadersRef.current.querySelectorAll('.sun-fly'), c) }, [sceneKey])

  useScene(comingRef, (c) => {
    const s = comingRef.current
    flyTitle(s.querySelectorAll('.sun-fly'), c)
    revealBatch(s.querySelectorAll('.sun-event'))
  }, [sceneKey])

  // ── the finale: the sun rises over the hills, the sheet lifts, the covers stand
  //    up (their suns rise), the meeting day's letters arrive from the depth ────
  useScene(finaleRef, (c, ctx) => {
    const s = finaleRef.current
    sunrise(s, '.sun-sunrise__sun')
    liftSheet(s.querySelector('.sun-sheet'), s)
    standUp(s.querySelectorAll('.sun-cover'), s.querySelector('.sun-issues'))
    const day = s.querySelector('.sun-meet__day-vis')
    return day ? flyChars(day, ctx, { aria: 'none' }) : undefined
  }, [sceneKey])

  const sheetRows = d.loading ? null : (
    <>
      {/* ══ leadership, right after the figures (client): portraits rising like suns, a Read more
          button each (the link) ══ */}
      {leaders.length > 0 && (
        <section className="sun-sec sun-leaders" id="leadership" ref={leadersRef} aria-labelledby="sun-lead-h" data-sun-sky=".30">
          <div className="sun-wrap">
            <h2 className="sun-h2 sun-fly sun-leaders__h" id="sun-lead-h">Leadership</h2>
            <People deps={[sceneKey]}>
              {leaders.map((l) => (
                <Person key={l.type} src={l.img} name={l.name}
                        role={l.type === 2 && district ? (l.role || 'District Governor') + ', ' + district : l.role}>
                  {/* sun-person__more: riseArches lifts it in with the text */}
                  <Button href={withYear('/dignitary?Type=' + l.type, yearId)} variant="line" small className="sun-person__more">Read more<span className="sun-sr"> about {l.name}</span></Button>
                </Person>
              ))}
            </People>
          </div>
        </section>
      )}

      {/* ══ about: four lines + Read more; the advertisements beside (else the crest) ══ */}
      <section className="sun-sec sun-about" id="about" ref={aboutRef} aria-labelledby="sun-about-h" data-sun-sky=".40">
        <div className="sun-wrap sun-about__grid">
          <div className="sun-about__text">
            <h2 className="sun-h2 sun-fly" id="sun-about-h">About</h2>
            <p className="sun-about__lead">{emFirstDate(aboutText)}</p>
            <div className="sun-about__cta"><Button href="/about" variant="line">Read more<span className="sun-sr"> about the club</span></Button></div>
          </div>
          {ads.length > 0 ? (
            <div className="sun-about__ads" onError={onAdError}>
              <div className="sun-win sun-about__win">
                <div className="sun-win__slides">
                  {ads.map((a, i) => (
                    <WinSlide key={i} src={a.img} fallbacks={a.fallbacks} url={a.url} on={i === adShow.idx}
                           alt={a.title || 'Advertisement ' + (i + 1) + ' of ' + ads.length} />
                  ))}
                </div>
              </div>
              <SlideCtrl n={ads.length} s={adShow} label="Advertisements" />
            </div>
          ) : (
            <Emblem src={crests[0]} alt={clubName + ' logo'} onError={nextCrest} />
          )}
        </div>
      </section>

      {/* ══ projects ══ */}
      <section className="sun-projects" id="projects" aria-labelledby="sun-proj-h" data-sun-sky=".54">
        <div className="sun-tunnel" ref={tunnelRef}>
          <div className="sun-tunnel__light" aria-hidden="true" />
          <div className="sun-tunnel__sparks" aria-hidden="true" />
          <div className="sun-tunnel__head">
            <div>
              {year ? <p className="sun-eyebrow">Rotary year {year}</p> : null}
              <h2 className="sun-h2 sun-fly" id="sun-proj-h">Our projects</h2>
            </div>
          </div>
          {cards.length === 0 ? (
            <EmptyState title="No projects published yet" message={'Projects the club publishes for ' + (year ? 'Rotary year ' + year : 'this Rotary year') + ' will appear here.'} as="h3" />
          ) : (
            <ul className="sun-tunnel__cards">
              {cards.map((p) => {
                // the photo's own ratio (4:3 until it loads) shapes its frame, so it shows whole;
                // in the tunnel the card's width follows it too (home.css)
                const style = { '--sun-tar': String(ratios[p.id] || 4 / 3) }
                const title = noEmoji(p.title)
                const desc = excerpt(p.desc, 200)
                return (
                  <li key={p.id} className="sun-tunnel__card" style={style}>
                    <article className="sun-card">
                      <div className="sun-card__img">
                        {p.img ? <img src={p.img} alt="" width="800" height="600" loading="lazy" decoding="async" onLoad={onRatio(p.id)} onError={hideOnError} /> : null}
                      </div>
                      <div className="sun-card__body">
                        {p.avenueLabel ? <p className="sun-card__meta"><span>{p.avenueLabel}</span></p> : null}
                        <h3 className="sun-card__title"><a className="sun-card__link" href={withYear('/project?pid=' + p.id, yearId)}>{title}</a></h3>
                        {desc ? <p className="sun-card__desc">{desc}</p> : null}
                        <span className="sun-card__more" aria-hidden="true">Read more →</span>
                      </div>
                    </article>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="sun-tunnel__end"><div><Button href="/projects">View all projects</Button></div></div>
        </div>
      </section>

      {/* ══ upcoming events: the next one ══ */}
      {ev && (
        <section className="sun-sec sun-coming" id="coming-up" ref={comingRef} aria-labelledby="sun-coming-h" data-sun-sky=".72">
          <div className="sun-wrap">
            <SectionHead id="sun-coming-h" title="Upcoming events" center />
            <article className="sun-event">
              {evImg ? <div className="sun-event__img"><img src={evImg} alt="" width="800" height="450" loading="lazy" onError={hideOnError} /></div> : null}
              <div className="sun-event__body">
                <DateSun day={ev.day} mon={ev.mon} />
                <div className="sun-event__text">
                  <p className="sun-eyebrow">Next event</p>
                  <h3 className="sun-event__title"><a className="sun-event__link" href={'/event?id=' + ev.id}>{noEmoji(ev.title)}</a></h3>
                  <ul className="sun-event__meta">
                    <li><ClockIcon />{ev.date}{ev.time ? ', ' + ev.time : ''}</li>
                    <li><PinIcon />{venueText(ev.venue)}</li>
                  </ul>
                  {ev.desc ? <p className="sun-event__desc">{excerpt(ev.desc, 180)}</p> : null}
                </div>
              </div>
              <a className="sun-link sun-event__all" href="/events">All events →</a>
            </article>
          </div>
        </section>
      )}
    </>
  )

  return (
    <div className="sun-page sun-home" ref={rootRef}>
      {/* ══ intro: hero window + figures (one scene when 3D) ══ */}
      <div className="sun-intro" ref={introRef}>
        <section className="sun-hero" ref={heroRef} aria-labelledby="sun-hero-h">
          <div className="sun-hero__head">
            {(district || year) ? (
              <p className="sun-eyebrow sun-hero__eyebrow">
                {district ? <span>District {district}</span> : null}
                {year ? <span>Rotary year {year}</span> : null}
              </p>
            ) : null}
            <h1 id="sun-hero-h" className="sun-hero__h1">
              <span className="sun-sr">{clubName}</span>
              {hasPre ? <span className="sun-hero__pre" aria-hidden="true">Rotary Club of</span> : null}
              <span key={shownName} className={'sun-hero__name' + (longName ? ' is-long' : '')} aria-hidden="true" style={{ '--sun-len': shownName.length }}>{shownName}</span>
            </h1>
          </div>
          <div className="sun-hero__win">
            {/* the frame takes the showing banner's own shape (--sun-bar, eased between slides): the
                whole picture, nothing cropped, no blurred bands (client) */}
            <div className="sun-win" style={{ '--sun-bar': heroRatio.toFixed(4) }}>
              <div className="sun-win__frame">
                <div className="sun-win__slides" onLoad={onBannerLoad}>
                  {d.banners.map((b, i) => (
                    <WinSlide key={i} src={b.src} fallbacks={b.fallbacks} url={b.url} on={i === hero.idx} eager={i === 0}
                           alt={b.title || 'Banner ' + (i + 1) + ' of ' + d.banners.length} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <SlideCtrl n={d.banners.length} s={hero} label="Banner slideshow" pause={false} className="sun-hero__ctrl" />
        </section>

        {figs.length > 0 && (
          <section className="sun-figs" id="impact" aria-labelledby="sun-figs-h">
            <div className="sun-figs__head">
              {year ? <p className="sun-eyebrow">Rotary year {year}</p> : null}
              <h2 className="sun-h2" id="sun-figs-h">Our impact</h2>
            </div>
            <ul className="sun-figs__list">
              {figs.map((f) => {
                const txt = fmtFig(f, f.v)
                return (
                  <li key={f.k} className={'sun-fig' + (txt.length > 7 ? ' sun-fig--long' : '')}>
                    <p className="sun-fig__num" aria-hidden="true" data-fit={txt}>{txt}</p>
                    <p className="sun-fig__label" aria-hidden="true">{f.label}</p>
                    <span className="sun-sr">{txt} {f.label}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>

      {sheetRows}

      {/* ══ the finale: one sheet over the sunrise (the same warm ground in both modes) -
          the newsletters | where we meet, a dawn line between them ══ */}
      <div className="sun-sunrise" ref={finaleRef} data-sun-sky=".84" data-sun-warm="">
        <div className="sun-sunrise__sun" aria-hidden="true" />
        <div className="sun-wrap sun-sunrise__wrap">
          <Sheet className={news.length > 0 ? 'is-two' : ''}>
            {news.length > 0 && (
              <section className="sun-news" id="newsletters" aria-labelledby="sun-news-h">
                <h2 className="sun-h2" id="sun-news-h">Newsletters</h2>
                <p className="sun-sheet__text">The club’s latest bulletins, as the club published them.</p>
                <ul className={'sun-issues' + (news.length === 1 ? ' is-one' : '')}>
                  {news.map((n, i) => {
                    const pdf = /\.pdf(\?|#|$)/i.test(n.url)
                    return (
                      <li className="sun-issue" key={i}>
                        <a href={openHref(n.url)} {...ext}>
                          <Cover name={noEmoji(n.title)} sub={[n.mon, n.year].filter(Boolean).join(' ')} />
                          <span className="sun-issue__foot">
                            {n.date ? <span className="sun-issue__date">{n.date}</span> : <span />}
                            <span className="sun-issue__cta">{pdf ? 'Open PDF' : 'Open'}<ArrowUpRight /></span>
                          </span>
                          <span className="sun-sr">{pdf ? ' (PDF, opens in a new tab)' : ' (opens in a new tab)'}</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
                <div className="sun-news__cta"><Button href="/newsletters" variant="dark">All newsletters</Button></div>
              </section>
            )}
            <section className="sun-meet" id="meet" aria-labelledby="sun-meet-h">
              <h2 className="sun-h2" id="sun-meet-h">Where we meet</h2>
              {d.loading ? null : hasMeeting ? (
                <>
                  {dayWord ? (
                    <p className={'sun-meet__day' + (dayWord.length > 10 ? ' is-long' : '')} style={{ '--sun-len': dayWord.length }}>
                      <span className="sun-sr">{dayWord}</span>
                      <span className="sun-meet__day-vis" aria-hidden="true" key={dayWord}>{dayWord}</span>
                    </p>
                  ) : null}
                  {has(d.meetingTime) || has(d.meetingVenue) ? (
                    <dl className="sun-meet__facts">
                      {has(d.meetingTime) ? (
                        <div className="sun-meet__fact"><span className="sun-meet__ico" aria-hidden="true"><ClockIcon /></span><dt>Time</dt><dd>{d.meetingTime}</dd></div>
                      ) : null}
                      {has(d.meetingVenue) ? (
                        <div className="sun-meet__fact"><span className="sun-meet__ico" aria-hidden="true"><PinIcon /></span><dt>Venue</dt><dd>{venueText(d.meetingVenue)}</dd></div>
                      ) : null}
                    </dl>
                  ) : null}
                  {/* the venue on a map fills the column under the details (client, 2026-10-08); the embed carries
                      Google's own "Open in Maps" link. Without a venue it would only guess from the club's name,
                      so then just the button */}
                  {has(d.meetingVenue) && d.mapEmbedUrl ? (
                    <div className="sun-meet__map">
                      <iframe src={d.mapEmbedUrl} title={'Map of the meeting venue: ' + venueText(d.meetingVenue)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                    </div>
                  ) : d.mapUrl ? <Button href={d.mapUrl} variant="dark" external>Open in Maps</Button> : null}
                </>
              ) : (
                <p className="sun-meet__none">Meeting day, time and venue for this Rotary year haven’t been published yet.</p>
              )}
            </section>
          </Sheet>
        </div>
        <Hills />
      </div>
    </div>
  )
}
