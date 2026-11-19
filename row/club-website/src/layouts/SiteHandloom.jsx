// ─────────────────────────────────────────────────────────────────────────────
// HANDLOOM — theme 7 shell.  "The Handloom" (Handloom_Theme_PRD.md)
//
// Modelled on SiteGold.jsx: same imports, same data flow, same drawer wiring,
// same footer data handling. Only the markup and the classes differ.
//
// No seventh copy of rotary-anim.js — the theme points at classic-blue's, so the
// mobile drawer, the reveal observer and the sliders all come from one
// maintained file (themeAssets.js). That is why the drawer markup below keeps
// the shared data-nav-* hooks and the exact Tailwind classes the script toggles
// (translate-x-full / translate-x-0, opacity-0 / opacity-100 /
// pointer-events-none, max-h-0 / max-h-96, rotate-180).
//
// Three structural rules this file exists to hold:
//   * [data-nav] is on the SHUTTLE BAR, not the masthead — initNav() does one
//     document.querySelector('[data-nav]') and the masthead must not gain the
//     scroll-shrink class swap.
//   * the drawer, its clip wrapper and the backdrop are SIBLINGS of <header>.
//     Gold documents why: a backdrop-filter on the header makes it the
//     containing block for fixed children. Handloom's header has no filter, but
//     the rule stays — <main class="route-enter"> DOES carry a filled transform,
//     so anything fixed must live outside it too.
//   * the backdrop has ZERO children, for ever. The script's close test is
//     `t === backdrop`, strict identity: one decorative span inside it and
//     tap-to-close stops working.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import * as api from '../api/clubService.js'
import { makeParticles, updateEffectPosition } from '../shared/GooeyNav.jsx'
import { media, externalUrl } from '../shared/rotaryPage.js'
import { useMenus, titleCase, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER } from '../shared/menus.js'
import { routeKey } from '../routes.js'
import YearSelect from '../shared/YearSelect.jsx'
import VisitorCount from '../shared/visitorCount.jsx'
import FooterLegal from '../shared/FooterLegal.jsx'
import HandloomThemeColor from '../shared/handloomThemeColor.jsx'
import { useThemeShell, useRouteEnter, useLoader } from '../shared/useRotaryAnim.js'
import { appSettings } from '../config.js'

const ADMIN_URL = appSettings.AdminLoginUrl

// The boot loader paints BEFORE handloom.css exists, so every value here is a
// literal hex — a var() would resolve to nothing and the first frame would be
// the browser's white. #E9E4D6 cloth, #12332A ink, #A3301C madder rule.
// z-index 150 is --hl-lyr-loader, written out for the same reason.
const SHELL_CSS = `
#rotary-loader{position:fixed;inset:0;z-index:150;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#E9E4D6;color:#12332A;transition:opacity .26s ease,visibility .26s ease}
#rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
.hl-load__mono{width:60px;height:60px;border-radius:999px;object-fit:cover}
.hl-load__rule{display:block;width:120px;height:2px;background:#A3301C;transform-origin:left center;animation:hlLoadRule 900ms linear infinite}
@keyframes hlLoadRule{from{scale:0 1}to{scale:1 1}}
@media (prefers-reduced-motion: reduce){.hl-load__rule{animation:none;background:#B8AC93}}
`

// The shuttle's running figure. data-hl-band carries the KEY; the noun is here
// so a band never has to spell its own caption twice. HomeHandloom may put the
// finished string on data-hl-fig-text and it wins — already formatted through
// shared/money.js with the club's OWN currency, so no symbol is ever written
// here. See the deviation note in the PR.
const BAND_NOUN = {
  cost: 'Cost',
  projects: 'Projects',
  hours: 'Man hours',
  beneficiaries: 'Beneficiaries',
  members: 'Members',
  events: 'Events',
}

const reduced = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

function logoFallback(e) {
  e.currentTarget.onerror = null
  e.currentTarget.src = LOGO_PLACEHOLDER
}

const ICO_CARET = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

const ICO_MAIL = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
)

const ICO_PHONE = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6.5 3Z" />
  </svg>
)

const ICO_CHEVRON = (cls) => (
  <svg className={cls} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const ICO_BURGER = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)

const ICO_CLOSE = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ICO_USER = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
)

/** Same six marks every other layout carries, drawn as JSX rather than an HTML
 *  string because nothing on this shell needs dangerouslySetInnerHTML. */
function SocialIcon({ platform }) {
  let path
  switch (platform) {
    case 'facebook':
      path = <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />; break
    case 'twitter': case 'x':
      path = <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />; break
    case 'instagram':
      path = (<><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></>); break
    case 'linkedin':
      path = (<><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></>); break
    case 'youtube':
      path = (<><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></>); break
    default:
      path = (<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>); break
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
  )
}

/** The ?pr= avenue on a /projects link, '' when there is none. */
function prOf(href) {
  const q = String(href || '').split('?')[1]
  if (!q) return ''
  const m = /(?:^|&)pr=([^&]*)/.exec(q)
  return m ? decodeURIComponent(m[1]) : ''
}

/** TWO MENU ITEMS CAN SHARE A PATH, and this club has exactly that: "Club
 *  Service" is a TOP-LEVEL link to /projects?pr=CE, while "Projects" is a
 *  submenu whose five children are /projects?pr=VS|NGS|IS|CP|PII. routeKey()
 *  drops the query by design - `route.split('?')[0]` - so every one of those
 *  hrefs reduced to `projects` and matched any /projects url.
 *
 *  WHAT THAT LOOKED LIKE, measured on /projects: aria-current on BOTH the
 *  Projects item (via a submenu child, which is in the DOM even when the panel
 *  is shut, so :has() sees it) and Club Service. The pill went to Projects -
 *  the first :has match - while the white-label rule matched only Club Service,
 *  because it is the one that is an <a class="hl-nav__link">. So Club Service
 *  was painted cloth on a cloth header and vanished.
 *
 *  routeKey() is shared by seven themes and is NOT the place to fix this. The
 *  avenue is what distinguishes these items, so it joins the comparison here.
 *  A bare /projects with no ?pr= now matches nothing, which is correct: no menu
 *  item points at it - the band head's "See all projects" does. */
function isActiveHref(href, current, currentPr) {
  if (!href || !String(href).trim() || /^http/i.test(String(href))) return false
  if (routeKey(href) !== current) return false
  return prOf(href) === (currentPr || '')
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SiteHandloom({ children }) {
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  const [about, setAbout] = useState(null)
  const [atTop, setAtTop] = useState(true)
  const [openSub, setOpenSub] = useState(-1)   // desktop dropdown, React-owned
  const mainRef = useRef(null)
  const hoverT = useRef(0)
  const lastToggle = useRef(null)

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    api.getAbout(club.clubId, club.selectedYearId).then((a) => { if (!cancelled) setAbout(a) })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId])

  // Back-to-top. THE one new passive scroll listener in the whole theme — every
  // other scroll effect is a native scroll-driven animation in handloom.css.
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 480)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── The running figure ────────────────────────────────────────────────────
  // One IntersectionObserver over [data-hl-band]; whichever band is crossing the
  // viewport's middle names itself in the shuttle bar. Written as textContent,
  // never as [data-count] (animateCount would blank it to parseFloat||0) and
  // never with aria-live (a figure that changes on scroll would flood a screen
  // reader — the span is aria-hidden instead).
  useEffect(() => {
    const fig = document.querySelector('.hl-shuttle__fig')
    if (!fig) return undefined
    const bands = document.querySelectorAll('[data-hl-band]')
    const fallback = document.title || ''
    let timer = 0

    const write = (text) => {
      if (fig.textContent === text) return
      if (reduced()) { fig.textContent = text; return }
      fig.classList.add('is-swap')
      clearTimeout(timer)
      timer = setTimeout(() => { fig.textContent = text; fig.classList.remove('is-swap') }, 120)
    }

    if (!bands.length) { write(fallback); return () => clearTimeout(timer) }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target
        write(el.dataset.hlFigText || BAND_NOUN[el.dataset.hlBand] || fallback)
      }
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 })
    bands.forEach((b) => io.observe(b))
    return () => { io.disconnect(); clearTimeout(timer) }
  }, [location.pathname, children])

  // ── The Century Rule ──────────────────────────────────────────────────────
  // A page's year list ([data-hl-year-row]) drives the SAME native <select>
  // YearSelect owns, by dispatching a real `change` on it — YearSelect listens
  // natively via a ref precisely so a programmatic dispatch is honoured, and the
  // shared script's delegated `change` handler closes the drawer for free.
  // Delegated once here so no page has to re-implement it.
  useEffect(() => {
    const onClick = (e) => {
      const row = e.target && e.target.closest && e.target.closest('[data-hl-year-row]')
      if (!row) return
      const id = row.dataset.hlYearRow || row.getAttribute('data-year-id')
      const sel = document.querySelector('[data-year-select]')
      if (!sel || !id) return
      sel.value = String(id)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // ── Drawer focus ──────────────────────────────────────────────────────────
  // The shared script owns open/close (it only swaps classes), so focus is
  // driven off the class it swaps. Focus returns to WHICHEVER burger opened the
  // drawer — there are two, and sending focus to the wrong one puts it off
  // screen when the shuttle bar has not arrived yet.
  useEffect(() => {
    const drawer = document.querySelector('[data-nav-drawer]')
    if (!drawer) return undefined
    const onToggleClick = (e) => {
      const t = e.target && e.target.closest && e.target.closest('[data-nav-toggle]')
      if (t) lastToggle.current = t
    }
    document.addEventListener('click', onToggleClick, true)

    let was = drawer.classList.contains('translate-x-0')
    const mo = new MutationObserver(() => {
      const now = drawer.classList.contains('translate-x-0')
      if (now === was) return
      was = now
      if (now) {
        const close = drawer.querySelector('[data-nav-close]')
        if (close) close.focus()
      } else if (lastToggle.current && document.contains(lastToggle.current)) {
        lastToggle.current.focus()
      }
    })
    mo.observe(drawer, { attributes: true, attributeFilter: ['class'] })
    return () => { document.removeEventListener('click', onToggleClick, true); mo.disconnect() }
  }, [])

  // Route change closes any open desktop dropdown. A child click closes it
  // itself (see the <a> below): the children are /projects?pr=X, so picking a
  // second one changes only the query and this effect never fires - measured
  // 2026-09-11, the panel stayed open on /projects?pr=NGS. An external child
  // opens in a new tab and changes nothing here at all.
  useEffect(() => { setOpenSub(-1) }, [location.pathname])

  // Outside click closes it too. (Escape and roving focus are handled on the
  // <li> itself, so they can refocus the trigger they came from.)
  useEffect(() => {
    if (openSub < 0) return undefined
    const onDoc = (e) => {
      if (!e.target || !e.target.closest || !e.target.closest('.hl-nav__item--has-sub')) setOpenSub(-1)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [openSub])

  useEffect(() => () => clearTimeout(hoverT.current), [])

  const clubName = club.clubDisplayName
  const rotaryLogoUrl = media(about ? about.rotaryLogoPath : null)
  const clubLogoUrl = media(about ? about.clubLogoPath : null)
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl
  const current = routeKey(location.pathname)
  // The avenue the page is actually showing, '' when none - see isActiveHref.
  const currentPr = new URLSearchParams(location.search).get('pr') || ''

  useThemeShell('handloom', menus.length > 0)
  useRouteEnter(mainRef)
  useLoader(!club.loading)

  // Contacts live in about.contacts[] — the flat emailId/contactNo fields are
  // not on the DTO. Same extraction every other layout uses.
  const contacts = (about ? about.contacts : null) || []
  const email = (contacts.map((c) => (c ? c.email : null)).find((e) => e && String(e).trim()) || '').trim()
  const phone = (contacts.map((c) => (c ? c.phone : null)).find((p) => p && String(p).trim()) || '').trim()
  const socials = ((about ? about.socials : null) || [])
    .filter((s) => s && s.linkUrl && String(s.linkUrl).trim())

  // UNVERIFIED at runtime, so it is omitted rather than blanked — a " · " must
  // never trail into nothing.
  const district = (about && about.districtNumber ? String(about.districtNumber).trim() : '')

  // ── Desktop dropdown keyboard ───────────────────────────────────────────────
  const onSubKey = (e, i) => {
    const li = e.currentTarget
    const links = Array.from(li.querySelectorAll('.hl-nav__sub'))
    const trigger = li.querySelector('.hl-nav__trigger')
    const at = links.indexOf(document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault(); setOpenSub(-1); if (trigger) trigger.focus(); return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (at < 0) { setOpenSub(i); requestAnimationFrame(() => { if (links[0]) links[0].focus() }) }
      else if (links[at + 1]) links[at + 1].focus()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (at > 0) links[at - 1].focus()
      else { setOpenSub(-1); if (trigger) trigger.focus() }
      return
    }
    if (e.key === 'Home' && at >= 0) { e.preventDefault(); links[0].focus(); return }
    if (e.key === 'End' && at >= 0) { e.preventDefault(); links[links.length - 1].focus() }
  }

  // ══ THE GOOEY NAV EFFECT (2026-09-10, asked for) ═════════════════════════
  // The pill and the particle burst from React Bits' GooeyNav, painted OVER the
  // nav this theme already has rather than replacing it. See the header of
  // GooeyNav.jsx for why: that component owns its own activeIndex and renders
  // one flat <a> per item, and this nav has a submenu with a button trigger,
  // aria-expanded/controls, hover intent, arrow-key handling, aria-current and
  // external-link targets. All of that survives; only the effect is borrowed.
  const navBox = useRef(null)
  const navFilter = useRef(null)
  const navText = useRef(null)
  const navLast = useRef(null)
  useEffect(() => {
    const box = navBox.current
    if (!box || !navFilter.current) return undefined
    // NO reduced() BAIL HERE (2026-09-11). It used to return before placing
    // anything, and the CSS that paints the current label --hl-cloth does not
    // know that: with Windows "Show animations" off, PROJECTS on a projects
    // page was white on the cream masthead - no pill, no label. The pill is a
    // marker of the current page, not motion; only the burst and the scale-in
    // are, and those are the two things reduced motion drops (below, and in
    // the reduced-motion block of handloom.css).

    // THE PILL IS A FUNCTION OF THE CURRENT PAGE, NOT OF CLICKS, and that is
    // the whole design after two failures that were only visible by looking:
    //   1. It used to move to whatever was clicked. Clicking the PROJECTS
    //      SUBMENU TRIGGER moves nothing - it is a <button> that opens a panel -
    //      so the pill sat on PROJECTS while aria-current stayed on HOME. The
    //      CSS paints the aria-current label --hl-cloth so it can read on the
    //      pill, so HOME became white text on a white masthead: gone.
    //   2. Same failure on any click that did not navigate.
    // Keying both off aria-current means the pill and the white label can never
    // separate. The burst now accompanies the pill ARRIVING at a new item,
    // which is also when a reader is looking at it.
    const place = (burst) => {
      const li = box.querySelector('.hl-nav__item:has([aria-current="page"])')
      if (!li) {
        navFilter.current.style.width = '0px'
        navFilter.current.classList.remove('active')
        navLast.current = null
        return
      }
      updateEffectPosition(li, box, navFilter.current, navText.current)
      navFilter.current.classList.add('active')
      // Only on a real change of page - not on every resize observation, or
      // the menu would spray particles while the window is being dragged.
      if (burst && !reduced() && navLast.current && navLast.current !== li) {
        navFilter.current.querySelectorAll('.particle').forEach((x) => x.remove())
        makeParticles(navFilter.current, {
          colors: [1, 2, 3, 4], particleDistances: [46, 8], particleR: 60,
        })
      }
      navLast.current = li
    }
    place(true)

    // A ResizeObserver, not a resize listener: this row REFLOWS without the
    // window changing - the menu wraps to a second line as labels load, and the
    // pill has to follow the item onto that second row.
    const ro = new ResizeObserver(() => place(false))
    ro.observe(box)
    return () => ro.disconnect()
    // currentPr TOO (2026-09-16). Thane Hills' PROJECTS is /projects?pr=CP and
    // its EVENTS is /projects?pr=CE - one route key, two menu items. Keyed on
    // `current` alone this never re-ran between them: aria-current and the
    // white label moved to EVENTS, the pill stayed on PROJECTS.
  }, [current, currentPr])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      {/* First focusable node in the document. Hand-written in handloom.css —
          Tailwind's focus:not-sr-only does not exist in the compiled sheet. */}
      <a className="hl-skip" href="#hl-main">Skip to content</a>

      <div id="rotary-loader" className="hl-load" aria-hidden="true">
        <img className="hl-load__mono" src={headerLogoUrl} alt="" onError={logoFallback} />
        <i className="hl-load__rule" aria-hidden="true" />
      </div>

      {/* ══ THE MASTHEAD ══
          Static, in normal flow — you scroll it away. NO data-nav (that is the
          shuttle bar's, and there is exactly one per document), no sticky, no
          backdrop-filter, no height change. .hl-inked is what makes --hl-turmeric
          resolve at all: it is declared nowhere else. */}
      <header className="hl-mast">
        <div className="hl-mast__row hl-mast__row--id">
          <div className="hl-x">
            <a className="hl-mast__id hl-frame" href="/" aria-label={clubName + ' — Home'}>
              {/* THE MARK CARRIES THE IDENTITY ALONE — no club name, no district
                  line beside it (asked for 2026-09-07). alt="" is still right:
                  the link's aria-label already names the club, so the accessible
                  name did not go anywhere. handloom.css sizes the disc up to
                  fill the room the two removed lines left. */}
              <img className="hl-mast__mono" src={headerLogoUrl} alt="" onError={logoFallback} />
            </a>

            <div className="hl-mast__tools">
              <span className="hl-yrsel"><YearSelect aria-label="Select Rotary year" /></span>
              <a className="hl-admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">
                {ICO_USER}Admin login
              </a>
              {/* THEME COLOUR trigger lands here, RIGHT of Admin login (asked for
                  2026-09-16; portal from HandloomThemeColor). Empty until the
                  component mounts = display:none, so no stray flex gap. */}
              <span className="hl-tc-slot" data-hl-tc-slot="mast" />
              {/* COPY 1 of 2. Free: initNav binds ONE delegated document click
                  listener and matches t.closest('[data-nav-toggle]'). */}
              <button type="button" className="hl-burger" data-nav-toggle
                      aria-label="Open menu" aria-expanded="false" aria-controls="hl-drawer">
                {ICO_BURGER}
              </button>
            </div>
          </div>
        </div>

        <div className="hl-mast__row hl-mast__row--nav">
          <div className="hl-x">
            {/* gooey-nav-container goes on the <nav> ITSELF, never on a
                wrapper around it: upstream styles `.gooey-nav-container nav ul`
                (white ink, 2em gaps, its own padding) and that selector needs a
                DESCENDANT nav. On the nav itself it matches nothing, so all the
                container class brings is position:relative and the .effect /
                .particle rules - which is the whole of what is wanted. */}
            <nav className="hl-nav gooey-nav-container" aria-label="Primary" ref={navBox}>
              {/* Wraps to a second row; never truncates, never scrolls, never
                  gains an overflow menu — the loom is 1152px and the labels are
                  the club's own words. */}
              <ul className="hl-nav__list">
                {menus.map((m, i) => {
                  const subs = m.subMenus || []
                  const href = menuHref(m.linkType, m.linkValue)
                  const ext = menuExternal(m.linkType, m.linkValue)
                  const active = isActiveHref(href, current, currentPr)
                  if (subs.length === 0) {
                    return (
                      <li className="hl-nav__item" key={i}>
                        <a className="hl-nav__link" href={href}
                           target={ext ? '_blank' : undefined}
                           rel={ext ? 'noopener noreferrer' : undefined}
                           aria-current={active ? 'page' : undefined}>{m.menuName}</a>
                      </li>
                    )
                  }
                  const open = openSub === i
                  return (
                    <li className={'hl-nav__item hl-nav__item--has-sub' + (open ? ' is-open' : '')} key={i}
                        onKeyDown={(e) => onSubKey(e, i)}
                        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpenSub(-1) }}
                        onMouseEnter={() => {
                          clearTimeout(hoverT.current)
                          hoverT.current = setTimeout(() => setOpenSub(i), 150)
                        }}
                        onMouseLeave={(e) => {
                          clearTimeout(hoverT.current)
                          // Not while a child link holds focus: the CSS
                          // :focus-within opener used to cover "Tab into the
                          // menu, pointer drifts off" and it is gone (2026-09-11).
                          const panel = e.currentTarget.querySelector('.hl-nav__panel')
                          hoverT.current = setTimeout(() => {
                            if (panel && panel.contains(document.activeElement)) return
                            setOpenSub(-1)
                          }, 250)
                        }}>
                      {/* A SPLIT CONTROL (2026-09-11, asked for: "if any menu
                          has a dropdown, the main menu is not working"). The
                          label is the parent's own LINK - PROJECTS goes to
                          /projects, as it does in every other theme - and the
                          chevron beside it is the disclosure button. Hover still
                          opens the panel (the <li> above); the button is for
                          touch and the keyboard, where there is no hover.
                          React state, never data-nav-accordion / data-nav-chevron:
                          those are drawer-only, and initNav's parentNode panel
                          lookup would fire on a desktop click too. */}
                      <a className="hl-nav__trigger" href={href}
                         target={ext ? '_blank' : undefined}
                         rel={ext ? 'noopener noreferrer' : undefined}
                         aria-current={active ? 'page' : undefined}
                         onClick={() => { clearTimeout(hoverT.current); setOpenSub(-1) }}>{m.menuName}</a>
                      <button type="button" className="hl-nav__more"
                              aria-expanded={open ? 'true' : 'false'} aria-controls={'hl-sub-' + i}
                              aria-label={(open ? 'Hide ' : 'Show ') + m.menuName + ' submenu'}
                              onClick={() => { clearTimeout(hoverT.current); setOpenSub(open ? -1 : i) }}>
                        {ICO_CHEVRON('hl-nav__chev')}
                      </button>
                      {/* mousedown must not move focus: Safari does not focus a
                          clicked link, so with the trigger keyboard-focused the
                          mousedown blurred the <li> (relatedTarget null), the
                          panel hid before mouseup and the click was lost. */}
                      <ul className={'hl-nav__panel' + (open ? ' is-open' : '')} id={'hl-sub-' + i}
                          onMouseDown={(e) => e.preventDefault()}>
                        {subs.map((s, j) => {
                          const sHref = menuHref(s.linkType, s.linkValue)
                          const sExt = menuExternal(s.linkType, s.linkValue)
                          return (
                            <li key={j}>
                              <a className="hl-nav__sub" href={sHref}
                                 onClick={() => { clearTimeout(hoverT.current); setOpenSub(-1) }}
                                 target={sExt ? '_blank' : undefined}
                                 rel={sExt ? 'noopener noreferrer' : undefined}
                                 aria-current={isActiveHref(sHref, current, currentPr) ? 'page' : undefined}>
                                {s.subMenuName}
                              </a>
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  )
                })}
              </ul>
              <span className="effect filter" ref={navFilter} aria-hidden="true" />
              <span className="effect text" ref={navText} aria-hidden="true" />
            </nav>
          </div>
        </div>

        <i className="hl-temple hl-temple--bottom" aria-hidden="true" />
      </header>

      {/* ══ THE SHUTTLE BAR ══  THE ONE [data-nav] IN THE DOCUMENT.
          It arrives on scroll; handloom.css forces both .pt-2 and .pt-4 (the
          classes initNav swaps onto it) to padding-top:0, and reuses .pt-2 as
          the scrolled-hairline flag. No [data-nav-pill] — without one the
          h-16/h-20 swap is inert, which is what we want. */}
      <div className="hl-shuttle hl-inked" data-nav data-hl-shuttle>
        <div className="hl-x hl-shuttle__row">
          <img className="hl-shuttle__mono" src={headerLogoUrl} alt="" onError={logoFallback} />
          <span className="hl-shuttle__fig hl-num" aria-hidden="true" />
          <span className="hl-yrsel hl-yrsel--compact"><YearSelect aria-label="Select Rotary year" /></span>
          {/* THEME COLOUR trigger, compact twin of the masthead's (portal). */}
          <span className="hl-tc-slot" data-hl-tc-slot="shuttle" />
          {/* COPY 2 of 2 — the shuttle burger opens the drawer at EVERY width,
              because a 44px bar has no room for the nav. */}
          <button type="button" className="hl-burger" data-nav-toggle
                  aria-label="Open menu" aria-expanded="false" aria-controls="hl-drawer">
            {ICO_BURGER}
          </button>
        </div>
      </div>

      {/* ZERO CHILDREN, EVER — the script's close test is `t === backdrop`. */}
      <div className="hl-backdrop pointer-events-none opacity-0 transition-opacity duration-300"
           data-nav-backdrop />

      {/* Not responsive-hidden (unlike gold's xl:hidden): the shuttle's burger
          opens this at every width. */}
      <div className="hl-drawer-clip pointer-events-none fixed inset-0 overflow-hidden">
        <aside className="hl-drawer hl-inked pointer-events-auto absolute right-0 top-0 h-full w-[86%] max-w-sm translate-x-full transition-transform duration-300 ease-out"
               data-nav-drawer>
          <div className="hl-drawer__hd">
            <img className="hl-drawer__mono" src={headerLogoUrl} alt={clubName} onError={logoFallback} />
            <button type="button" className="hl-drawer__close" data-nav-close aria-label="Close menu">
              {ICO_CLOSE}
            </button>
          </div>

          {/* Deliberately NOT role=dialog / aria-modal: the theme ships no focus
              trap, and promising inertness without one walks a screen-reader
              user out of a "modal" with no way to know. Escape still closes —
              rotary-anim.js binds it on window. */}
          <nav className="hl-drawer__nav" id="hl-drawer" aria-label="Menu">
            <ul>
              {menus.map((m, i) => {
                const subs = m.subMenus || []
                const href = menuHref(m.linkType, m.linkValue)
                const ext = menuExternal(m.linkType, m.linkValue)
                if (subs.length === 0) {
                  return (
                    <li key={i}>
                      {/* data-nav-close is MANDATORY on every real link, or the
                          drawer stays open over the page you just asked for,
                          with body{overflow:hidden} still pinned. */}
                      <a className="hl-drawer__row" href={href} data-nav-close
                         target={ext ? '_blank' : undefined}
                         rel={ext ? 'noopener noreferrer' : undefined}
                         aria-current={isActiveHref(href, current, currentPr) ? 'page' : undefined}>{m.menuName}</a>
                    </li>
                  )
                }
                return (
                  // ONE parent holds the button AND its panel — the script
                  // resolves the panel as acc.parentNode.querySelector(...), so
                  // a shared parent is what keeps a second dropdown alive.
                  <li className="hl-drawer__split" key={i}>
                    {/* The same split as the desktop row: the label is the
                        parent's link and closes the drawer, the chevron is the
                        accordion button. Both stay DIRECT children of the <li>
                        with the panel - the shared script finds the panel as
                        acc.parentNode.querySelector(...). */}
                    <a className="hl-drawer__row" href={href} data-nav-close
                       target={ext ? '_blank' : undefined}
                       rel={ext ? 'noopener noreferrer' : undefined}
                       aria-current={isActiveHref(href, current, currentPr) ? 'page' : undefined}>{m.menuName}</a>
                    <button type="button" className="hl-drawer__acc" data-nav-accordion aria-expanded="false"
                            aria-label={'Show ' + m.menuName + ' submenu'}>
                      <svg className="hl-drawer__chev" data-nav-chevron style={{ transition: 'transform .3s' }}
                           viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <div className="hl-drawer__panel max-h-0 overflow-hidden transition-[max-height] duration-300"
                         data-nav-accordion-panel>
                      <ul>
                        {subs.map((s, j) => {
                          const sExt = menuExternal(s.linkType, s.linkValue)
                          return (
                            <li key={j}>
                              <a className="hl-drawer__sub" href={menuHref(s.linkType, s.linkValue)} data-nav-close
                                 target={sExt ? '_blank' : undefined}
                                 rel={sExt ? 'noopener noreferrer' : undefined}>{s.subMenuName}</a>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="hl-drawer__ft">
            {/* The <select> closes the drawer for free — initNav delegates
                `change` on [data-year-select]. */}
            <span className="hl-yrsel"><YearSelect aria-label="Select Rotary year" /></span>
            <a className="hl-btn hl-btn--outline" href={ADMIN_URL}
               target="_blank" rel="noopener noreferrer" data-nav-close>Admin login</a>
          </div>
        </aside>
      </div>

      {/* route-enter keeps a filled identity transform, so <main> is the
          containing block for any position:fixed DESCENDANT. Page-level overlays
          must be createPortal'd to document.body. */}
      <main id="hl-main" ref={mainRef} className="route-enter">{children}</main>

      {/* ══ THE FOOTER HEM ══ .hl-inked, or every turmeric column head vanishes. */}
      <footer className="hl-ft hl-inked">
        <i className="hl-temple hl-temple--top" aria-hidden="true" />
        <div className="hl-x">
          <div className="hl-ft__grid">
            <div className="hl-ft__col reveal">
              {/* THE FOOTER MARK FALLS BACK TO THE MASTHEAD'S, IT DOES NOT
                  JUST VANISH. footerLogoUrl is the club_logo the API hands out
                  and headerLogoUrl is the club's UpperLogo; they are different
                  records and only one of them has to exist. rctcv (club 2765)
                  is the case: /uploads/club/club_logo_d0f83d4e...png is a 404
                  while its UpperLogo loads, so hiding on error left this column
                  with no mark at all. `|| headerLogoUrl` cannot catch that -
                  the url is truthy, it is the FETCH that fails - so the swap
                  has to happen in onError. onerror is cleared first: without
                  that, a headerLogoUrl that also 404s would re-enter here
                  forever. */}
              {/* A WHITE PLATE UNDER THE MARK (2026-09-09, asked for). Club
                  logos are transparent PNGs drawn in the club's own colours,
                  and this footer is near-black green - a dark-inked mark on it
                  is invisible. The plate is on the WRAPPER, never on the <img>:
                  a background on the image itself would be hidden by any logo
                  that turns out to be opaque, and would not pad it either.
                  It is display:inline-block so it hugs a narrow logo instead of
                  drawing a white band across the column. */}
              {footerLogoUrl
                ? <span className="hl-ft__plate hl-frame">
                    <img className="hl-ft__logo" src={footerLogoUrl} alt={clubName}
                         onError={(e) => {
                           const el = e.currentTarget
                           el.onerror = () => { el.parentNode.style.display = 'none' }
                           if (headerLogoUrl && el.src !== headerLogoUrl) el.src = headerLogoUrl
                           else el.parentNode.style.display = 'none'
                         }} />
                  </span>
                : null}
              {/* NO NAME AND NO DISTRICT LINE under the mark (2026-09-07) — the
                  logo carries the identity on its own, exactly as in the
                  masthead. The club is still named for a screen reader by the
                  logo's alt, and still printed in the copyright bar below.
                  THE VISITOR COUNT SITS HERE (2026-09-09, asked for; it was
                  under the social links). NEVER data-count on these figures. */}
              <div className="hl-ft__vc"><VisitorCount /><FooterLegal /></div>
            </div>

            <div className="hl-ft__col reveal">
              <h2 className="hl-ft__head">Quick links</h2>
              <ul className="hl-ft__links">
                {menus.filter((m) => m.menuName && String(m.menuName).trim()).map((m, i) => {
                  const ext = menuExternal(m.linkType, m.linkValue)
                  return (
                    <li key={i}>
                      {/* THE LABEL IS ITS OWN SPAN, and that is what carries the
                          hover rule. On the <a> the rule ran the full column
                          because the anchor is a flex BLOCK - it is as wide as
                          its track whatever the label says. */}
                      <a className="hl-ft__link" href={menuHref(m.linkType, m.linkValue)}
                         target={ext ? '_blank' : undefined}
                         rel={ext ? 'noopener noreferrer' : undefined}>
                        <i className="hl-ft__caret" aria-hidden="true">{ICO_CARET}</i>
                        <span className="hl-ft__t">{titleCase(m.menuName)}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Nothing at all when the club filed none of the three — no
                empty-state card, and no fixed column height leaving a hole.
                THE SOCIAL LINKS LIVE HERE NOW (2026-09-09, asked for). They had
                a column of their own, which made four columns in a three-track
                grid, so the fourth dropped to a second row. */}
            {(phone || email || socials.length) ? (
              <div className="hl-ft__col reveal">
                <h2 className="hl-ft__head">Contact</h2>
                {email ? (
                  <a className="hl-ft__contact" href={'mailto:' + email}>
                    <i className="hl-ft__ico" aria-hidden="true">{ICO_MAIL}</i>
                    <span className="hl-ft__t">{email}</span>
                  </a>
                ) : null}
                {phone ? (
                  <a className="hl-ft__contact" href={'tel:' + phone.replace(/\s+/g, '')}>
                    <i className="hl-ft__ico" aria-hidden="true">{ICO_PHONE}</i>
                    <span className="hl-ft__t">{phone}</span>
                  </a>
                ) : null}
                {socials.length ? (
                  <div className="hl-ft__soc">
                    {socials.map((s, i) => {
                      const key = String(s.platform || '').trim().toLowerCase()
                      return (
                        <a className="hl-ft__soc-a" key={i} href={externalUrl(s.linkUrl)}
                           target="_blank" rel="noopener noreferrer" aria-label={socialLabel(key)}>
                          <SocialIcon platform={key} />
                        </a>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>

          <div className="hl-ft__bar">
            <span>© {new Date().getFullYear()} {clubName}. All rights reserved.</span>
            <span>Powered by <a href="https://rosteronwheels.com/" target="_blank"
                                rel="noopener noreferrer">Roster On Wheels</a></span>
          </div>
        </div>
      </footer>

      <button type="button" className={'hl-top' + (atTop ? '' : ' is-on')} aria-label="Back to top"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      {/* THEME COLOUR (2026-09-11; per-browser since 2026-09-18). Applies THIS
          browser's saved pick and portals its two triggers into the
          [data-hl-tc-slot] spans above (masthead right of Admin login, shuttle
          beside the year select). Mounted once, here. Handloom only. */}
      <HandloomThemeColor />
    </>
  )
}
