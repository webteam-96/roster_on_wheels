'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story — the shell (header, full-screen menu, footer), ported from
// Theme8-Samples/C-split-story. Live data only: the club's own menus (with
// submenus), logos from v2/about with a fallback chain, the year selector,
// socials, meeting, visitor count, admin login.
//
// <main> carries NO transform: the home's sticky panel and 3D stage would be
// re-anchored by a transformed ancestor.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// ponytail: data.js has no about-fetch export yet; SiteGold reads the same call (request-cached).
import {
  useClub, useMenus, titleCase, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER, routeKey,
  YearSelect, VisitorCount, useThemeShell, useLoader, media, externalUrl,
} from '../_shared/data.js'
import { useSmoothScroll, lockScroll, scrollToY, gsap, motionOn, irisOpen, irisClose } from './motion.js'
import { yearText } from './kit.jsx'
import './theme.css'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

const ADMIN_URL = ADMIN_LOGIN_URL
const hdIco = (d) => function Ico() {
  return <svg className="spl-hd-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const PhoneIco = hdIco('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z')
const MailIco = hdIco('M4 6h16v12H4zM4 7l8 6 8-6')
const NAV_AT = '(min-width: 1024px)'   // two-row header (2026-10-05): the menu has a row of its own from here
const FINE = '(hover: hover) and (pointer: fine)'

/** The ?pr= avenue on a /projects link ('' when none) — two menu items can share a path. */
function prOf(href) {
  const m = /[?&]pr=([^&#]*)/.exec(String(href || ''))
  return m ? decodeURIComponent(m[1]) : ''
}
function isActive(href, current, pr) {
  if (!href || href === '#' || /^(https?:)?\/\//i.test(href)) return false
  return routeKey(href) === current && prOf(href) === pr
}
const extProps = (ext) => (ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})

/** First source that loads; renders nothing when every one fails. */
function Logo({ sources, alt, className }) {
  const [i, setI] = useState(0)
  if (i >= sources.length) return null
  return <img className={className} src={sources[i]} alt={alt} decoding="async" onError={() => setI(i + 1)} />
}

const SOCIAL = {
  facebook: <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21z" fill="currentColor" />,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" /></>,
  linkedin: <><rect x="4" y="9.5" width="3.2" height="10" fill="currentColor" /><circle cx="5.6" cy="5.8" r="1.9" fill="currentColor" /><path d="M10 9.5h3.1v1.4c.5-.9 1.7-1.7 3.4-1.7 3 0 3.5 2 3.5 4.5v5.8h-3.2v-5.1c0-1.2 0-2.7-1.7-2.7s-1.9 1.3-1.9 2.6v5.2H10z" fill="currentColor" /></>,
  twitter: <path d="M4 4h4.6l3.9 5.3L17 4h2.6l-5.9 6.8L20.5 20h-4.6l-4.2-5.7L6.8 20H4.2l6.3-7.2z" fill="currentColor" />,
  youtube: <><rect x="3" y="6" width="18" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor" /></>,
  web: <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.3 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.3-3.6-8.5s1-6.1 3.6-8.5z" fill="none" stroke="currentColor" strokeWidth="2" /></>,
}
SOCIAL.x = SOCIAL.twitter

const Chev = () => (
  <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" focusable="false"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
)

// ── desktop nav: the club's menus, hover + keyboard submenus, gold pill ──────
function Nav({ menus, current, pr, navRef, ulRef, pillRef }) {
  const [open, setOpen] = useState(-1)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const onKey = (e, i) => {
    const li = e.currentTarget
    const links = [...li.querySelectorAll('.spl-sub a')]
    const at = links.indexOf(document.activeElement)
    if (e.key === 'Escape' && open === i) {
      e.preventDefault(); setOpen(-1); li.querySelector('.spl-nav-more').focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (at < 0) { setOpen(i); requestAnimationFrame(() => links[0] && links[0].focus()) } else if (links[at + 1]) links[at + 1].focus()
    } else if (e.key === 'ArrowUp' && at >= 0) {
      e.preventDefault()
      if (at > 0) links[at - 1].focus(); else li.querySelector('.spl-nav-more').focus()
    }
  }

  return (
    <nav className="spl-nav" aria-label="Main" ref={navRef}>
      <span className="spl-nav-pill" aria-hidden="true" ref={pillRef} />
      <ul ref={ulRef}>
        {menus.map((m, i) => {
          const subs = m.subMenus || []
          const href = menuHref(m.linkType, m.linkValue)
          const ext = menuExternal(m.linkType, m.linkValue)
          const self = isActive(href, current, pr)
          if (!subs.length) {
            return (
              <li key={i}>
                <a className="spl-nav-link" href={href} {...extProps(ext)} aria-current={self ? 'page' : undefined}>{m.menuName}</a>
              </li>
            )
          }
          const childActive = subs.some((s) => isActive(menuHref(s.linkType, s.linkValue), current, pr))
          const isOpen = open === i
          return (
            <li key={i} className={'has-sub' + (isOpen ? ' is-open' : '')}
                onKeyDown={(e) => onKey(e, i)}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(-1) }}
                onMouseEnter={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(i), 120) }}
                onMouseLeave={(e) => {
                  clearTimeout(timer.current)
                  const li = e.currentTarget
                  timer.current = setTimeout(() => { if (!li.contains(document.activeElement)) setOpen(-1) }, 220)
                }}>
              <a className="spl-nav-link" href={href} {...extProps(ext)} aria-current={self || childActive ? 'page' : undefined}>{m.menuName}</a>
              <button type="button" className="spl-nav-more" aria-expanded={isOpen ? 'true' : 'false'} aria-controls={'spl-sub-' + i}
                      aria-label={(isOpen ? 'Hide ' : 'Show ') + m.menuName + ' submenu'}
                      onClick={() => { clearTimeout(timer.current); setOpen(isOpen ? -1 : i) }}>
                <Chev />
              </button>
              {/* mousedown must not move focus, or the blur above closes the panel before the click lands */}
              <ul className="spl-sub" id={'spl-sub-' + i} hidden={!isOpen} onMouseDown={(e) => e.preventDefault()}>
                {subs.map((s, j) => {
                  const sHref = menuHref(s.linkType, s.linkValue)
                  return (
                    <li key={j}>
                      <a href={sHref} {...extProps(menuExternal(s.linkType, s.linkValue))}
                         aria-current={isActive(sHref, current, pr) ? 'page' : undefined}
                         onClick={() => setOpen(-1)}>{s.subMenuName}</a>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default function Site({ children }) {
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about || null
  const [tight, setTight] = useState(false)        // the club's menu does not fit the desktop bar
  const [menuOpen, setMenuOpen] = useState(false)
  const hdRef = useRef(null), navRef = useRef(null), ulRef = useRef(null), pillRef = useRef(null)
  const menuRef = useRef(null), burgerRef = useRef(null), lastFocus = useRef(null), closing = useRef(false)

  useSmoothScroll()
  useThemeShell('split-story', menus.length > 0)
  useLoader(!club.loading)


  const clubName = club.clubDisplayName
  const rotaryLogo = media(about ? about.rotaryLogoPath : null)
  const clubLogo = media(about ? about.clubLogoPath : null)
  const headerLogos = about === undefined ? [] : [rotaryLogo, clubLogo, LOGO_PLACEHOLDER].filter(Boolean)
  const footerLogos = [clubLogo, rotaryLogo].filter(Boolean)
  const district = about && about.districtNumber ? String(about.districtNumber).trim() : ''
  const socials = ((about && about.socials) || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  const meetTime = !about || !about.meetingFromTime ? '' : about.meetingFromTime + (!about.meetingToTime ? ' onwards' : ' – ' + about.meetingToTime)
  const meetVenue = about ? [about.meetingAddress, about.city, about.state, about.pincode].filter((x) => x && String(x).trim()).join(', ') : ''
  const meeting = [['Day', about && about.meetingDay], ['Time', meetTime], ['Venue', meetVenue]].filter(([, v]) => v && String(v).trim())
  const yearLabel = yearText(club.selectedYearLabel)
  const contact = (k) => (((about && about.contacts) || []).map((c) => (c ? c[k] : null)).find((v) => v && String(v).trim()) || '').trim()
  const phone = contact('phone'), email = contact('email')
  const tel = phone.replace(/[^\d+]/g, '')
  const current = routeKey(location.pathname)
  const pr = new URLSearchParams(location.search).get('pr') || ''

  // ── does the club's menu fit the desktop bar? (measured, not guessed) ──────
  useLayoutEffect(() => {
    const hd = hdRef.current, ul = ulRef.current
    if (!hd || !ul) return undefined
    const mq = window.matchMedia(NAV_AT)
    const measure = () => {
      if (!mq.matches) { setTight(false); return }
      // the menu has the whole second row; it only falls back to the burger if it is wider than that
      const nav = hd.querySelector('.spl-nav'), cs = nav ? getComputedStyle(nav) : null
      const avail = (nav ? nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : hd.clientWidth) - 8
      setTight(ul.scrollWidth > avail)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) ro.observe(hd)
    mq.addEventListener('change', measure)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure)
    return () => { if (ro) ro.disconnect(); mq.removeEventListener('change', measure) }
  }, [menus])

  // ── gold pill slides to the hovered/focused item, rests on the current one ─
  useEffect(() => {
    const nav = navRef.current, ul = ulRef.current, pill = pillRef.current
    if (!nav || !ul || !pill || !menus.length || tight || !motionOn() || !window.matchMedia(FINE).matches) return undefined
    nav.classList.add('has-pill')
    const home = () => { const a = ul.querySelector(':scope > li > [aria-current="page"]'); return a ? a.parentElement : null }
    // measured against the pill's OWN box: in the two-row header the pill spans the whole menu strip, not just
    // the list, so list offsets put it hundreds of px off (2026-10-05). No current item -> it shrinks to nothing.
    const to = (li, instant) => {
      const P = pill.getBoundingClientRect()
      if (!P.width) return
      const B = li ? li.getBoundingClientRect() : null
      const T = B ? B.top - P.top : P.height / 2, Bo = B ? P.bottom - B.bottom : P.height / 2
      const L = B ? B.left - P.left : P.width / 2, R = B ? P.right - B.right : P.width / 2
      gsap.to(pill, { clipPath: 'inset(' + T + 'px ' + R + 'px ' + Bo + 'px ' + L + 'px round 999px)', duration: instant ? 0 : 0.6, ease: 'expo.out', overwrite: true })
    }
    const topLi = (t) => { const li = t && t.closest ? t.closest('li') : null; return li && li.parentElement === ul ? li : (li ? li.parentElement.closest('li') : null) }
    const over = (e) => { const li = topLi(e.target); if (li) to(li) }
    const rest = () => to(home())
    const focusIn = (e) => to(topLi(e.target))
    const focusOut = (e) => { if (!ul.contains(e.relatedTarget)) rest() }
    const snap = () => to(home(), true)
    snap()
    ul.addEventListener('pointerover', over)
    ul.addEventListener('pointerleave', rest)
    ul.addEventListener('focusin', focusIn)
    ul.addEventListener('focusout', focusOut)
    window.addEventListener('resize', snap)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(snap)
    return () => {
      ul.removeEventListener('pointerover', over)
      ul.removeEventListener('pointerleave', rest)
      ul.removeEventListener('focusin', focusIn)
      ul.removeEventListener('focusout', focusOut)
      window.removeEventListener('resize', snap)
      nav.classList.remove('has-pill')
      gsap.killTweensOf(pill)
      gsap.set(pill, { clearProps: 'clipPath' })
    }
  }, [menus, current, pr, tight])

  // ── full-screen menu: iris from the button, Esc, focus trap, focus return ──
  const burgerAt = () => {
    const b = burgerRef.current
    if (!b) return '50% 0px'
    const r = b.getBoundingClientRect()
    return (r.left + r.width / 2) + 'px ' + (r.top + r.height / 2) + 'px'
  }
  const openMenu = () => { lastFocus.current = document.activeElement; setMenuOpen(true) }
  const finishClose = () => {
    closing.current = false
    setMenuOpen(false)
    const f = lastFocus.current
    const target = f && document.contains(f) && f.offsetParent ? f : burgerRef.current
    if (target) target.focus()
  }
  const closeMenu = () => {
    if (!menuOpen || closing.current) return
    if (!motionOn() || !menuRef.current) { finishClose(); return }
    closing.current = true
    irisClose(menuRef.current, burgerAt(), finishClose)
  }

  useLayoutEffect(() => {
    if (!menuOpen) return undefined
    const m = menuRef.current
    document.documentElement.classList.add('spl-menu-open')
    lockScroll(true)
    const close = m.querySelector('.spl-menu-close')
    if (close) close.focus()
    if (motionOn()) irisOpen(m, burgerAt())
    return () => {
      document.documentElement.classList.remove('spl-menu-open')
      lockScroll(false)
      gsap.killTweensOf(m)
      gsap.set(m, { clearProps: 'clipPath' })
    }
  }, [menuOpen])

  // The bar came back (wider window, or a club with a shorter menu): the menu is not needed.
  useEffect(() => {
    const mq = window.matchMedia(NAV_AT)
    const onChange = () => { if (mq.matches && !tight) setMenuOpen(false) }
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [tight])

  // Back/forward while the menu is open.
  useEffect(() => { setMenuOpen(false); closing.current = false }, [location.pathname])

  const onMenuKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return }
    if (e.key !== 'Tab') return
    const f = [...menuRef.current.querySelectorAll('a[href], button:not([disabled]), select')]
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const skip = (e) => {
    e.preventDefault()
    const m = document.getElementById('main')
    if (!m) return
    m.focus({ preventScroll: true })
    scrollToY(m.getBoundingClientRect().top + window.scrollY, true)
  }

  return (
    <>
      <a className="spl-skip" href="#main" onClick={skip}>Skip to content</a>

      <div id="rotary-loader" className="spl-loader" aria-hidden="true">
        <span className="spl-loader-orbit"><i /></span>
        <span className="spl-loader-name">{clubName}</span>
      </div>

      {/* two rows (client, 2026-10-05): logo + contact / year / admin, then the menu on its own strip */}
      <header className={'spl-hd' + (tight ? ' is-tight' : '')} ref={hdRef}>
        <div className="spl-hd-top">
          <a className="spl-brand" href="/" aria-label={clubName + ', home'}>
            <Logo key={headerLogos.join('|')} sources={headerLogos} alt="" className="spl-brand-img" />
          </a>
          <div className="spl-hd-util">
            {phone || email ? (
              <ul className="spl-hd-contact" aria-label="Contact the club">
                {phone ? <li><a href={'tel:' + tel}><PhoneIco />{phone}</a></li> : null}
                {email ? <li><a href={'mailto:' + email}><MailIco />{email}</a></li> : null}
              </ul>
            ) : null}
            <span className="spl-year"><YearSelect aria-label="Rotary year" /></span>
            <a className="spl-hd-admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="spl-sr"> (opens in a new tab)</span></a>
            <button type="button" className="spl-burger" ref={burgerRef} aria-expanded={menuOpen ? 'true' : 'false'} aria-controls="spl-menu" aria-label="Open menu" onClick={openMenu}>
              <span className="spl-burger-bars" aria-hidden="true"><i /><i /><i /></span>
              <span className="spl-burger-text" aria-hidden="true">Menu</span>
            </button>
          </div>
        </div>
        <Nav menus={menus} current={current} pr={pr} navRef={navRef} ulRef={ulRef} pillRef={pillRef} />
      </header>

      <div className="spl-menu spl-on-dark" id="spl-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label="Menu"
           data-lenis-prevent hidden={!menuOpen} onKeyDown={onMenuKey}>
        <div className="spl-menu-top">
          <button type="button" className="spl-menu-close" onClick={closeMenu}>Close <span aria-hidden="true">&#x2715;</span></button>
        </div>
        <nav aria-label="Site">
          <ul className="spl-menu-list" onClick={(e) => { if (e.target.closest && e.target.closest('a')) closeMenu() }}>
            {menus.map((m, i) => {
              const href = menuHref(m.linkType, m.linkValue)
              const subs = m.subMenus || []
              return (
                <li key={i}>
                  <a href={href} {...extProps(menuExternal(m.linkType, m.linkValue))} aria-current={isActive(href, current, pr) ? 'page' : undefined}>{m.menuName}</a>
                  {subs.length ? (
                    <ul className="spl-menu-sub">
                      {subs.map((s, j) => {
                        const sHref = menuHref(s.linkType, s.linkValue)
                        return (
                          <li key={j}>
                            <a href={sHref} {...extProps(menuExternal(s.linkType, s.linkValue))} aria-current={isActive(sHref, current, pr) ? 'page' : undefined}>{s.subMenuName}</a>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </nav>
      </div>

      <main id="main" className="spl-main" tabIndex={-1}>{children}</main>

      {/* footer (client, 2026-10-06): row 1 = a bigger logo · visitor counter · socials; row 2 = the menu,
          centred, title case. No club name / district beside the logo, no meeting, no Admin login, no Rotary year. */}
      <footer className="spl-foot spl-on-dark">
        <div className="spl-foot-top">
          {footerLogos.length ? (
            <div className="spl-foot-logo"><Logo key={footerLogos.join('|')} sources={footerLogos} alt={clubName + ' logo'} /></div>
          ) : null}
          <div className="spl-foot-vc"><VisitorCount /></div>
          {socials.length ? (
            <ul className="spl-socials" aria-label="Social media">
              {socials.map((s, i) => {
                const key = String(s.platform || '').trim().toLowerCase()
                return (
                  <li key={i}>
                    <a href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer" aria-label={socialLabel(key) + ' (opens in a new tab)'}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{SOCIAL[key] || SOCIAL.web}</svg>
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        {menus.length ? (
          <nav className="spl-foot-nav" aria-label="Footer">
            <ul>
              {menus.map((m, i) => {
                const href = menuHref(m.linkType, m.linkValue)
                return (
                  <li key={i}>
                    <a href={href} {...extProps(menuExternal(m.linkType, m.linkValue))} aria-current={isActive(href, current, pr) ? 'page' : undefined}>{titleCase(m.menuName)}</a>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}

        <div className="spl-foot-bottom">
          <p>© {new Date().getFullYear()} {clubName}</p>
          <p className="spl-foot-powered">Powered by <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer">Roster On Wheels<span className="spl-sr"> (opens in a new tab)</span></a></p>
        </div>
      </footer>
    </>
  )
}
