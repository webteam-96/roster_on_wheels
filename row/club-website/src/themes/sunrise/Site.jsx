'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE — the shell (Theme 8 option H). A two-tier header (client, 2026-09-29):
// a strip that scrolls away over a bar that stays pinned. When the whole menu
// fits on a row of its own (fit mode, client 2026-10-05) the strip is the big
// logo plate + the tools (Rotary year, Admin login, light/dark) and the bar is
// the menu alone, centred; else the strip is the tools and the bar is the logo
// plate + the burger. Then the mobile menu, the sky, the dawn band and the footer
// (club logo, socials, visitor count, copyright + Powered by); every page renders
// inside <main id="main">.
//
// Owns the light/dark mode exactly as the sample: html[data-sun-mode], the
// visitor's choice in localStorage "sunriseMode", the device setting until they
// choose, an aria-pressed sun/moon switch, the View Transitions circle reveal
// from the switch, and <meta name="theme-color">.
//
// One deliberate import outside _shared/data.js: getAbout (the raw v2/about
// row). The shell needs the Rotary lockup AND the club logo separately, and
// the socials - no shared hook returns that set, and
// useHomeData (12 calls) is too heavy for every page. getAbout is cached per
// request, so pages that also read about pay nothing extra.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useMenus, menuHref, menuExternal, routeKey, YearSelect, VisitorCount,
  useThemeShell, useLoader, media, LOGO_PLACEHOLDER,
} from '../_shared/data.js'
import {
  gsap, useScene, useSmoothScroll, lockScroll, getLenis, scrollToY, refreshSoon, prefersReducedMotion, skyDriver, sunrise,
} from './motion.js'
import { ADMIN_URL, Button, Chevron, Hills, NewTab, SocialLinks, ext } from './kit.jsx'
import './theme.css'

// ── light / dark ─────────────────────────────────────────────────────────────
const MODE_KEY = 'sunriseMode'
const THEME_COLOR = { dark: '#060D26', light: '#F7F9FF' }
const storedMode = () => {
  try { const m = localStorage.getItem(MODE_KEY); return m === 'light' || m === 'dark' ? m : null } catch { return null }
}
const deviceMode = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

// Layout effects run in the browser only; on the server (pages are server-rendered) they are plain effects.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

function useSunMode() {
  // The server renders dark; the visitor's stored or device mode is applied before the first paint.
  const [mode, setMode] = useState('dark')
  const original = useRef(undefined)
  useBeforePaint(() => {
    const m = storedMode() || deviceMode()
    if (m !== 'dark') setMode(m)
  }, [])

  // Before paint: the attribute every mode token keys off, and the browser chrome colour.
  useBeforePaint(() => {
    document.documentElement.setAttribute('data-sun-mode', mode)
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
    if (original.current === undefined) original.current = meta.getAttribute('content')
    meta.setAttribute('content', THEME_COLOR[mode])
  }, [mode])

  // Leaving the theme: hand the document back untouched.
  useBeforePaint(() => () => {
    document.documentElement.removeAttribute('data-sun-mode')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) { if (original.current) meta.setAttribute('content', original.current); else meta.remove() }
  }, [])

  // The device setting decides until the visitor has chosen.
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const on = (e) => { if (!storedMode()) setMode(e.matches ? 'light' : 'dark') }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // The new mode spreads from the switch as a circle (View Transitions); an instant swap elsewhere.
  const toggle = (e) => {
    const next = mode === 'light' ? 'dark' : 'light'
    try { localStorage.setItem(MODE_KEY, next) } catch { /* private mode */ }
    const apply = () => flushSync(() => setMode(next))
    if (!document.startViewTransition || prefersReducedMotion()) { apply(); return }
    const b = e.currentTarget.getBoundingClientRect()
    const x = b.left + b.width / 2, y = b.top + b.height / 2
    const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)))
    const vt = document.startViewTransition(apply)
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 800, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' })
    }).catch(() => {})
  }
  return [mode, toggle]
}

/** The sun / moon switch. It shows twice (the strip, which scrolls away, and the menu): each passes its own mask id. */
function ModeSwitch({ dark, onToggle, maskId }) {
  return (
    <button className="sun-mode" type="button" aria-pressed={dark} onClick={onToggle}>
      <span className="sun-sr">Dark mode</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <mask id={maskId}><rect width="24" height="24" fill="#fff" /><circle className="sun-mode__bite" cx="18" cy="7" r="7" /></mask>
        <circle className="sun-mode__disc" cx="12" cy="12" r="9" mask={'url(#' + maskId + ')'} />
        <g className="sun-mode__rays" fill="none"><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5" /></g>
      </svg>
    </button>
  )
}

// ── menus ────────────────────────────────────────────────────────────────────
/** Active when the route matches; on /projects the avenue (?pr=, CP by default) must match too. */
function isActive(href, loc) {
  if (!href || href === '#' || /^(https?:)?\/\//i.test(href)) return false
  const k = routeKey(href)
  if (!k || k !== routeKey(loc.pathname)) return false
  const qi = href.indexOf('?')
  const want = (qi >= 0 ? new URLSearchParams(href.slice(qi + 1)).get('pr') : '') || ''
  const have = new URLSearchParams(loc.search).get('pr') || ''
  const norm = (v) => (k === 'projects' ? (v || 'CP') : v).toUpperCase()
  return norm(want) === norm(have)
}

const cleanMenus = (menus) => (menus || [])
  .filter((m) => m && m.menuName && String(m.menuName).trim())
  .map((m) => ({
    label: String(m.menuName).trim(),
    href: menuHref(m.linkType, m.linkValue),
    external: menuExternal(m.linkType, m.linkValue),
    subs: (m.subMenus || [])
      .filter((s) => s && s.subMenuName && String(s.subMenuName).trim())
      .map((s) => ({ label: String(s.subMenuName).trim(), href: menuHref(s.linkType, s.linkValue), external: menuExternal(s.linkType, s.linkValue) })),
  }))

const hasHref = (h) => !!h && h !== '#'

function MenuLink({ item, loc, className, onNavigate }) {
  return (
    <a className={className} href={item.href} {...(item.external ? ext : {})}
       aria-current={isActive(item.href, loc) ? 'page' : undefined} onClick={onNavigate}>
      {item.label}{item.external ? <NewTab /> : null}
    </a>
  )
}

/** Desktop bar: sub-menus open on hover (pointer) and from a toggle button (keyboard/touch). */
function DesktopNav({ items, loc, navRef, listRef }) {
  const [open, setOpen] = useState(-1)
  useEffect(() => { setOpen(-1) }, [loc.pathname, loc.search])
  useEffect(() => {
    if (open < 0) return undefined
    const onDown = (e) => { if (navRef.current && !navRef.current.contains(e.target)) setOpen(-1) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, navRef])

  return (
    <nav className="sun-nav" aria-label="Main" ref={navRef}>
      <ul className="sun-nav__list" ref={listRef}>
        {items.map((m, i) => {
          const subId = 'sun-sub-' + i
          const isOpen = open === i
          const here = m.subs.some((s) => isActive(s.href, loc))
          const flip = () => setOpen(isOpen ? -1 : i)
          return (
            <li key={i} className={'sun-nav__item' + (isOpen ? ' is-open' : '') + (here ? ' is-here' : '')}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || !isOpen) return
                  e.preventDefault(); setOpen(-1)
                  const t = e.currentTarget.querySelector('[aria-controls="' + subId + '"]')
                  if (t) t.focus()
                }}
                onBlur={(e) => { if (isOpen && !e.currentTarget.contains(e.relatedTarget)) setOpen(-1) }}>
              {hasHref(m.href)
                ? <MenuLink item={m} loc={loc} className="sun-nav__link" />
                : m.subs.length
                  ? <button type="button" className="sun-nav__link" aria-expanded={isOpen} aria-controls={subId} onClick={flip}>{m.label}<Chevron /></button>
                  : <span className="sun-nav__link">{m.label}</span>}
              {m.subs.length > 0 && hasHref(m.href) && (
                <button type="button" className="sun-nav__toggle" aria-expanded={isOpen} aria-controls={subId} onClick={flip}>
                  <Chevron /><span className="sun-sr">{m.label}: more pages</span>
                </button>
              )}
              {m.subs.length > 0 && (
                <ul className="sun-sub" id={subId}>
                  {m.subs.map((s, j) => <li key={j}><MenuLink item={s} loc={loc} /></li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Phone / narrow menu: big display links, sub-menus as disclosures. */
function MobileMenu({ items, loc, open, menuRef, onNavigate, dark, onToggleMode }) {
  const [sub, setSub] = useState(-1)
  useEffect(() => { if (!open) setSub(-1) }, [open])
  return (
    <div className="sun-menu" id="sun-menu" ref={menuRef} hidden={!open} data-lenis-prevent="">
      <nav aria-label="Menu">
        <ul className="sun-menu__list">
          {items.map((m, i) => {
            const subId = 'sun-msub-' + i
            const isOpen = sub === i
            return (
              <li key={i}>
                <div className="sun-menu__row">
                  {hasHref(m.href)
                    ? <MenuLink item={m} loc={loc} className="sun-menu__link" onNavigate={onNavigate} />
                    : <button type="button" className="sun-menu__link" aria-expanded={isOpen} aria-controls={subId}
                              onClick={() => setSub(isOpen ? -1 : i)}>{m.label}</button>}
                  {m.subs.length > 0 && hasHref(m.href) && (
                    <button type="button" className="sun-menu__toggle" aria-expanded={isOpen} aria-controls={subId}
                            onClick={() => setSub(isOpen ? -1 : i)}>
                      <Chevron /><span className="sun-sr">{m.label}: more pages</span>
                    </button>
                  )}
                </div>
                {m.subs.length > 0 && (
                  <ul className="sun-menu__sub" id={subId} hidden={!isOpen}>
                    {m.subs.map((s, j) => <li key={j}><MenuLink item={s} loc={loc} onNavigate={onNavigate} /></li>)}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="sun-menu__foot">
        <label className="sun-year">Rotary year<YearSelect aria-label="Select Rotary year" /></label>
        {/* the strip has scrolled away mid-page: the menu carries the light/dark switch too */}
        <div className="sun-menu__acts">
          <Button href={ADMIN_URL} variant="line" external>Admin login</Button>
          <ModeSwitch dark={dark} onToggle={onToggleMode} maskId="sun-mode-mm" />
        </div>
      </div>
    </div>
  )
}

/** An <img> that walks `srcs` on error (a club's logo can 404); `fallback` once every one failed. Key it by its list. */
function Logo({ srcs, fallback = null, ...img }) {
  const [i, setI] = useState(0)
  return i < srcs.length ? <img src={srcs[i]} {...img} onError={() => setI((n) => n + 1)} /> : fallback
}
const uniq = (list) => [...new Set(list.filter(Boolean))]
/**
 * Fit mode needs a wide screen (below 900px the strip has no room for the logo plate beside the
 * tools) and :has() - its tokens key off it (theme.css); without it the burger layout is the one that works.
 */
const canFit = () => window.matchMedia('(min-width:900px)').matches && !!window.CSS && CSS.supports('selector(:has(a))')

// ─────────────────────────────────────────────────────────────────────────────
export default function Site({ children }) {
  const club = useClub()
  const menus = useMenus()
  const loc = useLocation()
  const [mode, toggleMode] = useSunMode()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about || null
  const [menuOpen, setMenuOpen] = useState(false)
  // until the menus land, guess fit mode on a wide screen (most clubs' menus fit): the header keeps its shape when they do
  // (false on the server and at hydration; the measuring effect below switches to fit mode on a wide screen)
  const [fits, setFits] = useState(false)

  const hdrRef = useRef(null), barRef = useRef(null), burgerRef = useRef(null)
  const navRef = useRef(null), listRef = useRef(null), menuRef = useRef(null)
  const mainRef = useRef(null), skyRef = useRef(null), dawnRef = useRef(null), bandRef = useRef(null)

  useSmoothScroll()
  useThemeShell('sunrise', menus.length > 0)
  useLoader(!club.loading)


  const items = useMemo(() => cleanMenus(menus), [menus])
  const clubName = club.clubDisplayName
  const rotaryLogo = media(about ? about.rotaryLogoPath : null)
  const clubLogo = media(about ? about.clubLogoPath : null)
  // the header leads with the Rotary lockup, the footer with the club's own logo; each falls back to the other, then the wheel
  const hdrLogos = uniq([rotaryLogo, clubLogo, LOGO_PLACEHOLDER])
  const footLogos = uniq([clubLogo, rotaryLogo, LOGO_PLACEHOLDER])
  const socials = (about && about.socials) || []
  const isHome = routeKey(loc.pathname) === 'home'

  // ── fit mode: does the whole menu fit on the bar by itself? else the burger ──
  useBeforePaint(() => {
    const bar = barRef.current, list = listRef.current
    if (!bar || !list) return undefined
    let retry = 0, alive = true
    const measure = () => {
      if (!alive || !items.length) return   // still loading: keep the guess
      // a scroll lock (the open burger menu, a photo viewer) hides the scrollbar and widens the bar:
      // keep the mode and look again once it has ended (an overlay scrollbar resizes nothing then)
      const lenis = getLenis()
      if (lenis && lenis.isStopped) { clearTimeout(retry); retry = setTimeout(measure, 300); return }
      const cs = getComputedStyle(bar)
      // the bar's whole inner width - fit mode puts nothing else on it - so the answer is the same in either mode
      const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const w = list.offsetWidth
      // leaving the burger takes 24px to spare, so a width right at the threshold cannot flap
      setFits((was) => canFit() && w <= room - (was ? 0 : 24))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) { ro.observe(bar); ro.observe(list) }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure)
    return () => { alive = false; clearTimeout(retry); if (ro) ro.disconnect() }
  }, [items])

  // ── mobile menu: Esc, focus trap, focus return, scroll lock ────────────────
  const closeMenu = (refocus) => {
    setMenuOpen(false)
    if (refocus && burgerRef.current) burgerRef.current.focus()
  }
  useEffect(() => { setMenuOpen(false) }, [loc.pathname, loc.search])
  // fit mode has no burger; and the two modes differ in height, so the pins re-measure under the new bar
  useEffect(() => { if (fits) setMenuOpen(false); refreshSoon() }, [fits])
  useEffect(() => {
    const html = document.documentElement
    html.classList.toggle('sun-menu-open', menuOpen)
    lockScroll(menuOpen)
    if (!menuOpen) return undefined
    const menu = menuRef.current
    if (menu) {
      menu.style.paddingTop = Math.round(hdrRef.current.getBoundingClientRect().bottom + 32) + 'px'
      const first = menu.querySelector('a[href], button, select')
      if (first) first.focus()
      if (!prefersReducedMotion()) {
        gsap.from(menu.querySelectorAll('.sun-menu__list > li, .sun-menu__foot'), {
          y: 26, opacity: 0, duration: 0.6, stagger: 0.035, ease: 'power3.out', clearProps: 'transform,opacity,translate',
        })
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return }
      if (e.key !== 'Tab' || !menu) return
      const f = [burgerRef.current, ...menu.querySelectorAll('a[href], button:not([disabled]), select')]
        .filter((el) => el && el.offsetParent !== null)
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      html.classList.remove('sun-menu-open')
      lockScroll(false)
    }
  }, [menuOpen])

  // ── the sky: one band for the whole site, scrubbed by scroll (motion only) ──
  useScene(skyRef, (c) => skyDriver(skyRef.current, dawnRef.current, c), [])
  // every inner page ends at sunrise over the hills
  useScene(bandRef, () => { sunrise(bandRef.current, '.sun-dawnband__sun', 'bottom bottom') }, [loc.pathname, isHome])
  // late content (API data, images) changes the page height: re-measure pins and the sky
  useEffect(() => {
    refreshSoon()
    const main = mainRef.current
    if (!main || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => refreshSoon(200))
    ro.observe(main)
    return () => ro.disconnect()
  }, [loc.pathname])

  const skip = (e) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return
    main.focus({ preventScroll: true })
    // under the pinned bar: the strip has scrolled away by then
    scrollToY(main.getBoundingClientRect().top + window.scrollY - (barRef.current ? barRef.current.offsetHeight : 0), true)
  }

  const dark = mode !== 'light'
  // the logo plate: leads the strip when the menu has the bar to itself (fit), else beside the burger in the bar
  const brand = (
    <a className="sun-brand" href="/" aria-label={clubName + ', home'}>
      <Logo key={hdrLogos.join('|')} srcs={hdrLogos} alt="" width="900" height="240"
            fallback={<span className="sun-brand__text">{clubName}</span>} />
    </a>
  )

  return (
    <>
      <a className="sun-skip" href="#main" onClick={skip}>Skip to content</a>

      <div className="sun-sky" ref={skyRef} aria-hidden="true">
        <div className="sun-sky__band" />
        <div className="sun-sky__stars"><i className="sun-st sun-st--a" /><i className="sun-st sun-st--b" /></div>
        <div className="sun-sky__glow sun-sky__glow--a" />
        <div className="sun-sky__glow sun-sky__glow--b" />
        <div className="sun-sky__horizon" />
        <div className="sun-sky__grain" />
      </div>

      <header className={'sun-hdr' + (fits ? ' is-fit' : '')} ref={hdrRef}>
        {/* the strip scrolls away (the header sticks at minus its height); the bar under it stays pinned */}
        <div className="sun-hdr__strip">
          {fits ? brand : null}
          <div className="sun-hdr__tools">
            {/* blur once a year is picked: the select keeps focus and matches :focus-visible, and the rule that
                brings the strip down for keyboard users then pinned the whole header open while scrolling */}
            <label className="sun-year" onChange={(e) => e.target.blur()}><span className="sun-sr">Rotary year</span><YearSelect aria-label="Select Rotary year" /></label>
            {/* one span (one flex item): "login" goes visually under 360px (theme.css), the name stays whole */}
            <Button href={ADMIN_URL} variant="line" external><span>Admin<span className="sun-hdr__login"> login</span></span></Button>
            <ModeSwitch dark={dark} onToggle={toggleMode} maskId="sun-mode-m" />
          </div>
        </div>
        <div className="sun-hdr__bar" ref={barRef}>
          {fits ? null : brand}
          <DesktopNav items={items} loc={loc} navRef={navRef} listRef={listRef} />
          <button className="sun-burger" type="button" ref={burgerRef} aria-expanded={menuOpen} aria-controls="sun-menu"
                  onClick={() => setMenuOpen((o) => !o)}>
            <span className="sun-sr">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            <span className="sun-burger__bars" aria-hidden="true"><i /><i /></span>
          </button>
        </div>
        <span className="sun-hdr__dawn" ref={dawnRef} aria-hidden="true" />
      </header>

      <MobileMenu items={items} loc={loc} open={menuOpen} menuRef={menuRef} onNavigate={() => setMenuOpen(false)}
                  dark={dark} onToggleMode={toggleMode} />

      <main id="main" tabIndex={-1} className="sun-main" ref={mainRef}>{children}</main>

      {!isHome && (
        <div className="sun-dawnband" ref={bandRef} aria-hidden="true">
          <div className="sun-dawnband__sun" />
          <Hills />
        </div>
      )}

      <footer className="sun-foot" data-sun-sky=".985">
        {/* client, 2026-09-29: the club's logo where its name and district were, the visitor
            count where the weekly meeting was, Powered by beside the copyright; no Admin login */}
        <div className="sun-wrap">
          <div className="sun-foot__row">
            <Logo key={footLogos.join('|')} srcs={footLogos} className="sun-foot__logo" alt={clubName + ' logo'} loading="lazy" decoding="async" />
            <SocialLinks socials={socials} />
          </div>
          <div className="sun-foot__row">
            <VisitorCount />
            <div className="sun-foot__legal">
              <p>© {new Date().getFullYear()} {clubName}</p>
              <p>Powered by <a href="https://rosteronwheels.com/" {...ext}>Roster On Wheels<NewTab /></a></p>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
