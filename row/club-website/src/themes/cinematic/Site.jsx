'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC — the shell. A sticky two-row header (client, 2026-09-28): row 1 the
// club lockup, year picker, Admin login and the light/dark switch; row 2 the
// club's menus with submenus (the burger takes over on narrow screens or when
// the menu does not fit). A full-screen menu that opens from the burger like an
// iris, <main> (never transformed: pins anchor to the viewport), and the footer.
// Everything is the club's live data.
//
// Light / dark: html[data-cin-mode], the visitor's choice in localStorage
// "cinematicMode". Dark (the theme's own look) until they choose; the switch
// spreads the new mode from itself as a circle (View Transitions).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from '@/site/router.js'
// getAbout is not re-exported by _shared/data.js; the shell needs the raw row
// for the two logos and the district (per-request cached, so no extra fetch).
import {
  useClub, useMenus, titleCase, menuHref, menuExternal, routeKey, YearSelect, VisitorCount,
  useThemeShell, useLoader, media, LOGO_PLACEHOLDER, useAboutData,
} from '../_shared/data.js'
import { useSmoothScroll, useScene, lockScroll, scrollToY, gsap, prefersReducedMotion, magnetField, navIndicator } from './motion.js'
import { Logo, SocialLinks, Chevron, ArrowOut, clubNames, ADMIN_URL } from './kit.jsx'
import './theme.css'

// ── light / dark ─────────────────────────────────────────────────────────────
const MODE_KEY = 'cinematicMode'
const THEME_COLOR = { dark: '#070B1A', light: '#F3F5FA' }
const storedMode = () => {
  try { const m = localStorage.getItem(MODE_KEY); return m === 'light' || m === 'dark' ? m : null } catch { return null }
}

function useCinMode() {
  const [mode, setMode] = useState(() => storedMode() || 'dark')
  const original = useRef(undefined)

  // Before paint: the attribute every mode token keys off, and the browser chrome colour.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-cin-mode', mode)
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
    if (original.current === undefined) original.current = meta.getAttribute('content')
    meta.setAttribute('content', THEME_COLOR[mode])
  }, [mode])

  // Leaving the theme: hand the document back untouched.
  useLayoutEffect(() => () => {
    document.documentElement.removeAttribute('data-cin-mode')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) { if (original.current) meta.setAttribute('content', original.current); else meta.remove() }
  }, [])

  // The new mode spreads from the switch as a circle (View Transitions); an instant swap elsewhere.
  const toggle = (e) => {
    const next = mode === 'light' ? 'dark' : 'light'
    try { localStorage.setItem(MODE_KEY, next) } catch { /* private mode: this visit only */ }
    const apply = () => flushSync(() => setMode(next))
    if (!document.startViewTransition || prefersReducedMotion()) { apply(); return }
    const b = e.currentTarget.getBoundingClientRect()
    const x = b.left + b.width / 2, y = b.top + b.height / 2
    const r = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)))
    const vt = document.startViewTransition(apply)
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 750, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' })
    }).catch(() => {})
  }
  return [mode, toggle]
}

/** Sun in dark mode (switches to light), moon in light mode: one disc, a bite and rays that morph in CSS. */
const ModeIcon = () => (
  <svg className="cin-mode__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <mask id="cin-mode-m"><rect width="24" height="24" fill="#fff" /><circle className="cin-mode__bite" cx="30" cy="-6" r="7" fill="#000" /></mask>
    <circle className="cin-mode__disc" cx="12" cy="12" r="5" mask="url(#cin-mode-m)" />
    <g className="cin-mode__rays">
      <path d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7" />
    </g>
  </svg>
)

/** Is this menu href the page being shown? ?pr=CE (club service feed) is its own page. */
function isCurrent(href, loc) {
  if (!href || href === '#' || /^https?:/i.test(href)) return false
  if (routeKey(href) !== routeKey(loc.pathname)) return false
  const want = (href.split('?')[1] ? new URLSearchParams(href.split('?')[1]).get('pr') : '') || ''
  if (!want) return true
  const have = new URLSearchParams(loc.search).get('pr') || ''
  return want.toUpperCase() === 'CE' ? have.toUpperCase() === 'CE' : have.toUpperCase() !== 'CE'
}

const extProps = (ext) => (ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})
const FOCUSABLE = 'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])'

export default function Site({ children }) {
  const club = useClub()
  const menus = useMenus()
  const [mode, toggleMode] = useCinMode()
  const loc = useLocation()
  const info = useAboutData()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about || {}
  const [openSub, setOpenSub] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuShown, setMenuShown] = useState(false)
  const siteRef = useRef(null)
  const hdrRef = useRef(null)
  const navRef = useRef(null)
  const burgerRef = useRef(null)
  const menuRef = useRef(null)
  const mainRef = useRef(null)
  const footRef = useRef(null)

  useSmoothScroll()
  useThemeShell('cinematic', menus.length > 0)
  useLoader(!club.loading)


  const names = clubNames(club.clubDisplayName)
  const rotaryLogo = media(about ? about.rotaryLogoPath : null)
  const clubLogo = media(about ? about.clubLogoPath : null)
  const district = about && about.districtNumber ? String(about.districtNumber).trim() : ''

  // Footer quick links: exactly the club's main menu - its top-level items, Home included, in its
  // order; no sub-menu items and no pages the menu doesn't list (client, 2026-09-28).
  // Menus often arrive in capitals ("PAST PRESIDENTS"); the list reads in title case.
  // Two-letter capitals (RI, DG, PP) stay as typed. Keyed by route + ?pr, so "Projects" and
  // "Events" (both /projects, CP vs CE) stay two links.
  const quick = useMemo(() => {
    const seen = new Set()
    const out = []
    const add = (label, href, ext) => {
      if (!label || !href || href === '#') return
      const pr = href.includes('?') ? (new URLSearchParams(href.split('?')[1]).get('pr') || '').toUpperCase() : ''
      const k = ext ? href : (routeKey(href) || '') + '|' + (pr === 'CE' ? 'CE' : '')
      if (seen.has(k)) return
      seen.add(k)
      out.push({ label, href, ext })
    }
    menus.forEach((m) => add(titleCase(String(m.menuName || '').trim()), menuHref(m.linkType, m.linkValue), menuExternal(m.linkType, m.linkValue)))
    return out
  }, [menus])

  // ── route changes close every menu ─────────────────────────────────────────
  useEffect(() => { setOpenSub(-1); setMenuOpen(false) }, [loc.pathname, loc.search])

  // ── header: fall back to the burger when the club's menu does not fit ──────
  useEffect(() => {
    const hdr = hdrRef.current, nav = navRef.current
    if (!hdr || !nav) return undefined
    const list = nav.querySelector('.cin-nav__list')
    const check = () => {
      if (getComputedStyle(nav).display === 'none') { hdr.classList.remove('is-crowded'); return }
      hdr.classList.toggle('is-crowded', list.scrollWidth > nav.clientWidth + 1)
    }
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    if (ro) { ro.observe(hdr); ro.observe(list) }
    return () => { if (ro) ro.disconnect() }
  }, [menus])

  // ── desktop submenu keyboard: Esc closes and returns to its trigger ────────
  const onGroupKey = (i) => (e) => {
    if (e.key === 'Escape' && openSub === i) {
      e.stopPropagation()
      setOpenSub(-1)
      const t = e.currentTarget.querySelector('[aria-expanded]')
      if (t) t.focus()
    } else if (e.key === 'ArrowDown' && e.target.hasAttribute('aria-expanded')) {
      e.preventDefault()
      setOpenSub(i)
      const li = e.currentTarget
      requestAnimationFrame(() => { const a = li.querySelector('.cin-nav__sub a'); if (a) a.focus() })
    }
  }
  const onGroupBlur = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpenSub(-1) }

  // ── mobile menu: iris open from the burger, Esc, focus trap, scroll lock ───
  const iris = (open, done) => {
    const menu = menuRef.current, b = burgerRef.current
    if (!menu || !b || prefersReducedMotion()) { if (done) done(); return }
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy))
    gsap.killTweensOf(menu)
    if (open) {
      gsap.fromTo(menu, { clipPath: 'circle(0px at ' + cx + 'px ' + cy + 'px)' }, { clipPath: 'circle(' + R + 'px at ' + cx + 'px ' + cy + 'px)', duration: 0.8, ease: 'expo.inOut', clearProps: 'clipPath' })
      gsap.fromTo(menu.querySelectorAll('.cin-menu__list > li, .cin-menu__end'), { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.04, delay: 0.25, clearProps: 'transform,opacity' })
    } else {
      gsap.to(menu, { clipPath: 'circle(0px at ' + cx + 'px ' + cy + 'px)', duration: 0.55, ease: 'expo.inOut', onComplete: () => { gsap.set(menu, { clearProps: 'clipPath' }); done() } })
    }
  }

  useEffect(() => {
    if (menuOpen) { setMenuShown(true); return undefined }
    if (!menuShown) return undefined
    iris(false, () => setMenuShown(false))
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen])

  // Layout effect: the iris clip must be on before the first painted frame.
  useLayoutEffect(() => {
    if (!menuOpen || !menuShown) return undefined
    const menu = menuRef.current, burger = burgerRef.current
    const outside = [mainRef.current, footRef.current].filter(Boolean)
    outside.forEach((el) => { el.inert = true })
    document.body.style.overflow = 'hidden'
    lockScroll(true)
    iris(true)
    const first = menu.querySelector('a[href], button')
    if (first) first.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { setMenuOpen(false); return }
      if (e.key !== 'Tab') return
      const list = [burger, ...menu.querySelectorAll(FOCUSABLE)].filter((el) => el && el.offsetParent !== null)
      if (!list.length) return
      const at = list.indexOf(document.activeElement)
      if (e.shiftKey && at <= 0) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && (at === list.length - 1 || at === -1)) { e.preventDefault(); list[0].focus() }
    }
    const closeOnWide = (e) => { if (e.matches) setMenuOpen(false) }
    const wide = window.matchMedia('(min-width: 900px)')
    document.addEventListener('keydown', onKey)
    wide.addEventListener('change', closeOnWide)
    return () => {
      document.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', closeOnWide)
      outside.forEach((el) => { el.inert = false })
      document.body.style.overflow = ''
      lockScroll(false)
      // next frame: a focus() in a layout-effect cleanup is undone by React's own selection restore after commit
      requestAnimationFrame(() => {
        const a = document.activeElement
        if (burger && burger.isConnected && (!a || a === document.body || menu.contains(a))) burger.focus()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, menuShown])

  // ── magnet buttons site-wide + the sliding nav indicator (mouse only) ──────
  useScene(siteRef, (c) => {
    if (!c.fine) return undefined
    const offMag = magnetField(siteRef.current)
    const offInd = navIndicator(navRef.current)
    return () => { if (offMag) offMag(); if (offInd) offInd() }
  }, [menus, loc.pathname, loc.search])

  const skip = (e) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return
    scrollToY(main.getBoundingClientRect().top + window.scrollY - (hdrRef.current ? hdrRef.current.offsetHeight : 0), true)
    main.focus({ preventScroll: true })
  }

  // Nothing until the about row is in, so a club's logo never flashes the placeholder wheel first.
  const logos = about ? [rotaryLogo, clubLogo, LOGO_PLACEHOLDER] : []
  const footLogos = about ? [clubLogo, rotaryLogo, LOGO_PLACEHOLDER] : []

  return (
    <div className="cin-site" ref={siteRef}>
      <a className="cin-skip" href="#main" onClick={skip}>Skip to content</a>

      <header className="cin-hdr" ref={hdrRef}>
        <div className="cin-hdr__bar">
          <a className="cin-brand" href="/">
            <Logo key={logos.join('|')} sources={logos} alt="" className="cin-brand__img" width="900" height="240" />
            <span className="cin-sr">{names.full}, home</span>
          </a>

          <div className="cin-hdr__end">
            <span className="cin-year"><YearSelect className="cin-select" aria-label="Rotary year" /></span>
            <a className="cin-hdr__admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">
              Admin login<span className="cin-sr"> (opens in a new tab)</span><ArrowOut />
            </a>
            <button type="button" className="cin-mode" onClick={toggleMode}
              aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              <ModeIcon />
            </button>
            <button type="button" className="cin-burger" ref={burgerRef} aria-expanded={menuOpen} aria-controls="cin-menu"
              onClick={() => setMenuOpen((v) => !v)}>
              <span className="cin-sr">{menuOpen ? 'Close menu' : 'Open menu'}</span>
              <span className="cin-burger__bars" aria-hidden="true"><i /><i /></span>
            </button>
          </div>
        </div>

        <div className="cin-hdr__rail">
          <nav className="cin-nav" aria-label="Main" ref={navRef}>
            <ul className="cin-nav__list">
              {menus.map((m, i) => {
                const subs = m.subMenus || []
                const label = m.menuName || ''
                const href = menuHref(m.linkType, m.linkValue)
                const ext = menuExternal(m.linkType, m.linkValue)
                const cur = isCurrent(href, loc)
                if (subs.length === 0) {
                  return (
                    <li key={i}>
                      <a className="cin-nav__top" href={href} {...extProps(ext)} aria-current={cur ? 'page' : undefined}>{label}</a>
                    </li>
                  )
                }
                const open = openSub === i
                const subCur = subs.some((s) => isCurrent(menuHref(s.linkType, s.linkValue), loc))
                const subId = 'cin-sub-' + i
                return (
                  <li key={i} className={'cin-nav__grp' + (open ? ' is-open' : '')}
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpenSub(i) }}
                    onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpenSub(-1) }}
                    onKeyDown={onGroupKey(i)} onBlur={onGroupBlur}>
                    {href && href !== '#' ? (
                      <>
                        <a className={'cin-nav__top' + (subCur ? ' is-current' : '')} href={href} {...extProps(ext)} aria-current={cur ? 'page' : undefined}>{label}</a>
                        <button type="button" className="cin-nav__toggle" aria-expanded={open} aria-controls={subId} onClick={() => setOpenSub(open ? -1 : i)}>
                          <span className="cin-sr">{label} menu</span><Chevron />
                        </button>
                      </>
                    ) : (
                      <button type="button" className={'cin-nav__top cin-nav__btn' + (subCur ? ' is-current' : '')} aria-expanded={open} aria-controls={subId} onClick={() => setOpenSub(open ? -1 : i)}>
                        {label}<Chevron />
                      </button>
                    )}
                    <ul className="cin-nav__sub" id={subId}>
                      {subs.map((s, j) => {
                        const sh = menuHref(s.linkType, s.linkValue)
                        return (
                          <li key={j}>
                            <a href={sh} {...extProps(menuExternal(s.linkType, s.linkValue))} aria-current={isCurrent(sh, loc) ? 'page' : undefined}>{s.subMenuName || ''}</a>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
            <span className="cin-nav__ind" aria-hidden="true" />
          </nav>
        </div>
      </header>

      <div className="cin-menu" id="cin-menu" ref={menuRef} hidden={!menuShown} data-lenis-prevent
        role="dialog" aria-modal="true" aria-label="Menu">
        <nav aria-label="Menu">
          <ul className="cin-menu__list">
            {menus.map((m, i) => {
              const subs = m.subMenus || []
              const href = menuHref(m.linkType, m.linkValue)
              const ext = menuExternal(m.linkType, m.linkValue)
              const linked = href && href !== '#'
              return (
                <li key={i}>
                  {linked ? (
                    <a className="cin-menu__top" href={href} {...extProps(ext)} aria-current={isCurrent(href, loc) ? 'page' : undefined}
                      onClick={() => setMenuOpen(false)}>{m.menuName}</a>
                  ) : <span className="cin-menu__top cin-menu__label">{m.menuName}</span>}
                  {subs.length > 0 && (
                    <ul className="cin-menu__sub">
                      {subs.map((s, j) => {
                        const sh = menuHref(s.linkType, s.linkValue)
                        return (
                          <li key={j}>
                            <a href={sh} {...extProps(menuExternal(s.linkType, s.linkValue))} aria-current={isCurrent(sh, loc) ? 'page' : undefined}
                              onClick={() => setMenuOpen(false)}>{s.subMenuName}</a>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="cin-menu__end">
          <label className="cin-menu__year">
            <span>Rotary year</span>
            <YearSelect className="cin-select" aria-label="Rotary year" />
          </label>
          <a className="cin-menu__admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">
            Admin login<span className="cin-sr"> (opens in a new tab)</span>
          </a>
        </div>
      </div>

      <main id="main" tabIndex={-1} className="cin-main" ref={mainRef}>{children}</main>

      <footer className="cin-foot" ref={footRef}>
        <div className="cin-foot__grid">
          <div className="cin-foot__club">
            <Logo key={footLogos.join('|')} sources={footLogos} alt=""
              className="cin-foot__logo" width="136" height="136" loading="lazy"
              onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth > im.naturalHeight * 1.6) im.dataset.wide = ''; else delete im.dataset.wide }} />
            <div className="cin-foot__id">
              <p className="cin-foot__name">{names.full}</p>
              {district ? <p className="cin-foot__meta">District {district}</p> : null}
              <SocialLinks socials={info.socials} />
            </div>
          </div>
          {quick.length ? (
            <nav className="cin-foot__nav" aria-labelledby="cin-foot-ql">
              <h2 className="cin-foot__h" id="cin-foot-ql">Quick links</h2>
              <ul className="cin-foot__links">
                {quick.map((q) => (
                  <li key={q.href}><a href={q.href} {...extProps(q.ext)}>{q.label}{q.ext ? <span className="cin-sr"> (opens in a new tab)</span> : null}</a></li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="cin-foot__side">
            {/* the club's contact details, above the visitor count (client, 2026-09-29); nothing when the club has none */}
            {info.email || info.phone ? (
              <div className="cin-foot__contact">
                <h2 className="cin-foot__h">Contact</h2>
                <ul className="cin-foot__cl">
                  {info.phone ? (
                    <li><a href={'tel:' + String(info.phone).replace(/[^\d+]/g, '')}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg>
                      <span className="cin-sr">Phone: </span>{info.phone}
                    </a></li>
                  ) : null}
                  {info.email ? (
                    <li><a href={'mailto:' + info.email}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4 7.3V17h16V7.3z" /></svg>
                      <span className="cin-sr">Email: </span>{info.email}
                    </a></li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            <VisitorCount className="cin-foot__vc" />
          </div>
        </div>
        <div className="cin-foot__row cin-foot__row--base">
          <p className="cin-foot__legal">© {new Date().getFullYear()} {names.full}</p>
          <p className="cin-foot__legal cin-foot__legal--by">
            Powered by{' '}
            <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer">Roster On Wheels<span className="cin-sr"> (opens in a new tab)</span></a>
          </p>
        </div>
      </footer>
    </div>
  )
}
