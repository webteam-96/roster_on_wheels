'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY — the shell (header, menus, footer) for every page.
//
// From Theme8-Samples/F-horizontal-journey: a white header closed by one stripe
// per chapter colour, a full-screen night menu on phones, and a night footer
// rising out of the page on a ridge. All content is the club's live data.
//
// <main> carries NO transform (ScrollTrigger pins are position:fixed and a
// transformed ancestor would re-anchor them) and no route-enter class.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The shell's one direct API call, exactly as every layout makes it: logos,
// socials, district and meeting come from v2/about (request-cached).
import {
  useClub, useMenus, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER, routeKey,
  YearSelect, VisitorCount, useThemeShell, useLoader, media, externalUrl, useAboutData,
} from '../_shared/data.js'
import { useSmoothScroll, lockScroll, gsap, prefersReducedMotion, scrollToEl } from './motion.js'
import { Ridge, IconOut, yearText } from './kit.jsx'
import './theme.css'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

const ADMIN_URL = ADMIN_LOGIN_URL

const SOCIAL = {
  facebook: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.6V14h2.7v8h3.2z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></svg>,
  linkedin: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="9" width="4" height="12" rx=".5" /><circle cx="5" cy="4.9" r="2.2" /><path d="M10 9h3.8v1.8c.6-1.1 2-2.1 4-2.1 3.5 0 4.2 2.2 4.2 5.2V21h-4v-6.2c0-1.5-.1-3.3-2.1-3.3s-2.3 1.5-2.3 3.2V21H10V9z" /></svg>,
  twitter: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>,
  youtube: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.8 4.8 12 4.8 12 4.8s-6.8 0-8.5.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 4.8 2.8 2.8 0 0 0 2 2c1.7.4 8.5.4 8.5.4s6.8 0 8.5-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-4.8zM9.8 15.1V8.9l5.6 3.1z" /></svg>,
  web: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z" /></svg>,
}
const socialIcon = (k) => SOCIAL[k === 'x' ? 'twitter' : k] || SOCIAL.web

function prOf(href) {
  const m = /[?&]pr=([^&#]*)/i.exec(String(href || ''))
  return m ? decodeURIComponent(m[1]).toUpperCase() : ''
}
/** Active menu item: same route; on /projects the club-events feed (?pr=CE) is its own page. */
function isActive(href, current, pr) {
  if (!href || href === '#' || /^https?:/i.test(href)) return false
  if (routeKey(href) !== current) return false
  const hp = prOf(href)
  return hp === pr || (hp !== 'CE' && pr !== 'CE')
}

/** An image that walks a list of candidate URLs, then gives up to `fallback`. */
function LogoImg({ srcs, alt, className, fallback }) {
  const list = srcs.filter(Boolean)
  const sig = list.join('|')
  const [i, setI] = useState(0)
  useEffect(() => { setI(0) }, [sig])
  if (i >= list.length) return fallback
  return <img className={className} src={list[i]} alt={alt} onError={() => setI((n) => n + 1)} />
}

/** Desktop nav. Sub-menus open on hover (with intent delay), on the chevron button, and by keyboard. */
function DeskNav({ menus, current, pr }) {
  const [open, setOpen] = useState(-1)
  const hoverT = useRef(0)
  const loc = useLocation()
  useEffect(() => { setOpen(-1) }, [loc.pathname, loc.search])
  useEffect(() => () => clearTimeout(hoverT.current), [])

  const onKey = (e, i) => {
    const li = e.currentTarget
    const links = [...li.querySelectorAll('.hj-nav__sub a')]
    const at = links.indexOf(document.activeElement)
    if (e.key === 'Escape' && open === i) {
      e.preventDefault(); setOpen(-1)
      const b = li.querySelector('.hj-nav__more'); if (b) b.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (at < 0) { setOpen(i); requestAnimationFrame(() => { const l = li.querySelectorAll('.hj-nav__sub a')[0]; if (l) l.focus() }) }
      else if (links[at + 1]) links[at + 1].focus()
    } else if (e.key === 'ArrowUp' && at >= 0) {
      e.preventDefault()
      if (at > 0) links[at - 1].focus()
      else { setOpen(-1); const b = li.querySelector('.hj-nav__more'); if (b) b.focus() }
    }
  }

  return (
    <ul className="hj-nav__list">
      {menus.map((m, i) => {
        const subs = (m.subMenus || []).filter((s) => s && s.subMenuName)
        const href = menuHref(m.linkType, m.linkValue)
        const ext = menuExternal(m.linkType, m.linkValue)
        const extProps = ext ? { target: '_blank', rel: 'noopener noreferrer' } : null
        const subActive = subs.some((s) => isActive(menuHref(s.linkType, s.linkValue), current, pr))
        const active = isActive(href, current, pr) || subActive
        if (!subs.length) {
          return (
            <li key={i}>
              <a className="hj-nav__a" href={href} {...extProps} aria-current={active ? 'page' : undefined}>{m.menuName}</a>
            </li>
          )
        }
        const isOpen = open === i
        return (
          <li key={i} className={'hj-nav__grp' + (isOpen ? ' is-open' : '')}
              onKeyDown={(e) => onKey(e, i)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen((o) => (o === i ? -1 : o)) }}
              onMouseEnter={() => { clearTimeout(hoverT.current); hoverT.current = setTimeout(() => setOpen(i), 120) }}
              onMouseLeave={(e) => {
                clearTimeout(hoverT.current)
                const li = e.currentTarget
                hoverT.current = setTimeout(() => { if (!li.contains(document.activeElement)) setOpen((o) => (o === i ? -1 : o)) }, 220)
              }}>
            <a className="hj-nav__a" href={href} {...extProps} aria-current={active ? 'page' : undefined}>{m.menuName}</a>
            <button type="button" className="hj-nav__more" aria-expanded={isOpen ? 'true' : 'false'} aria-controls={'hj-sub-' + i}
                    aria-label={(isOpen ? 'Hide ' : 'Show ') + m.menuName + ' submenu'}
                    onClick={() => { clearTimeout(hoverT.current); setOpen(isOpen ? -1 : i) }}>
              <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            </button>
            <ul className="hj-nav__sub" id={'hj-sub-' + i} onMouseDown={(e) => e.preventDefault()}>
              {subs.map((s, j) => {
                const sh = menuHref(s.linkType, s.linkValue)
                const sx = menuExternal(s.linkType, s.linkValue)
                return (
                  <li key={j}>
                    <a href={sh} {...(sx ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
                       aria-current={isActive(sh, current, pr) ? 'page' : undefined}
                       onClick={() => setOpen(-1)}>{s.subMenuName}{sx && <span className="hj-sr"> (opens in a new tab)</span>}</a>
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

/** Phone menu list: parent link + disclosure button per group. */
function MenuList({ menus, current, pr }) {
  const [open, setOpen] = useState(-1)
  return (
    <ul className="hj-menu__list">
      {menus.map((m, i) => {
        const subs = (m.subMenus || []).filter((s) => s && s.subMenuName)
        const href = menuHref(m.linkType, m.linkValue)
        const ext = menuExternal(m.linkType, m.linkValue)
        const extProps = ext ? { target: '_blank', rel: 'noopener noreferrer' } : null
        const active = isActive(href, current, pr)
        return (
          <li key={i} className={subs.length ? 'hj-menu__grp' : undefined}>
            <a href={href} {...extProps} aria-current={active ? 'page' : undefined}>{m.menuName}</a>
            {subs.length > 0 && (
              <>
                <button type="button" className="hj-menu__more" aria-expanded={open === i ? 'true' : 'false'} aria-controls={'hj-msub-' + i}
                        aria-label={(open === i ? 'Hide ' : 'Show ') + m.menuName + ' submenu'} onClick={() => setOpen(open === i ? -1 : i)}>
                  <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                </button>
                <ul className="hj-menu__sub" id={'hj-msub-' + i} hidden={open !== i}>
                  {subs.map((s, j) => {
                    const sh = menuHref(s.linkType, s.linkValue)
                    const sx = menuExternal(s.linkType, s.linkValue)
                    return (
                      <li key={j}>
                        <a href={sh} {...(sx ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
                           aria-current={isActive(sh, current, pr) ? 'page' : undefined}>{s.subMenuName}{sx && <span className="hj-sr"> (opens in a new tab)</span>}</a>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function Site({ children }) {
  const club = useClub()
  const allMenus = useMenus()
  // no Gallery in this theme (client, 2026-09-29): a club menu item or submenu that points at it is dropped
  const menus = useMemo(() => {
    const isGallery = (t, v) => routeKey(menuHref(t, v)) === 'gallery'
    return (allMenus || []).filter((m) => !isGallery(m.linkType, m.linkValue))
      .map((m) => ({ ...m, subMenus: (m.subMenus || []).filter((s) => s && !isGallery(s.linkType, s.linkValue)) }))
  }, [allMenus])
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about || null
  const aboutDone = true
  const [menuOpen, setMenuOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  const hdrRef = useRef(null)
  const navRef = useRef(null)
  const burgerRef = useRef(null)
  const menuRef = useRef(null)
  const footRef = useRef(null)
  const wasOpen = useRef(false)

  useSmoothScroll()
  useThemeShell('horizontal-journey', menus.length > 0)
  useLoader(!club.loading)


  const clubName = club.clubDisplayName
  const current = routeKey(location.pathname)
  const pr = (new URLSearchParams(location.search).get('pr') || '').toUpperCase()
  const rotaryLogo = media(about ? about.rotaryLogoPath : null)
  const clubLogo = media(about ? about.clubLogoPath : null)
  const has = (v) => v != null && String(v).trim() !== ''
  const socials = ((about && about.socials) || []).filter((s) => s && has(s.linkUrl))
  const contact = useAboutData()   // the club's phone + email, for the footer (the year's row, with fallback)
  const yr = yearText(club.selectedYearLabel)

  // ── header fit: the club's menu decides whether it fits on one line ────────
  useLayoutEffect(() => {
    const hdr = hdrRef.current, nav = navRef.current
    if (!hdr || !nav) return undefined
    const check = () => {
      const ul = nav.firstElementChild
      if (!ul || !nav.clientWidth) return
      setCompact(ul.scrollWidth > nav.clientWidth + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(hdr)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(check)
    return () => ro.disconnect()
  }, [menus])

  // ── phone menu: Esc, focus kept inside (rest of page inert), scroll locked ──
  useEffect(() => { setMenuOpen(false) }, [location.pathname, location.search])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return undefined
    const root = document.documentElement
    const outside = [document.getElementById('main'), footRef.current, document.querySelector('.hj-skip')]
    const motion = !prefersReducedMotion()
    if (menuOpen) {
      wasOpen.current = true
      const hb = hdrRef.current ? Math.ceil(hdrRef.current.getBoundingClientRect().bottom) : 72
      menu.style.paddingTop = (hb + 32) + 'px'
      menu.hidden = false
      root.classList.add('hj-menu-open')
      lockScroll(true)
      outside.forEach((el) => { if (el) el.inert = true })
      if (motion) {
        gsap.killTweensOf(menu)
        gsap.fromTo(menu, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'expo.inOut', clearProps: 'clipPath' })
        gsap.fromTo(menu.querySelectorAll('.hj-menu__list > li, .hj-menu__foot'), { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.04, delay: 0.2, clearProps: 'transform,opacity' })
      }
      const first = menu.querySelector('a, button, select')
      if (first) first.focus()
      const onKey = (e) => { if (e.key === 'Escape') { setMenuOpen(false); if (burgerRef.current) burgerRef.current.focus() } }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
    if (!wasOpen.current) return undefined
    wasOpen.current = false
    root.classList.remove('hj-menu-open')
    lockScroll(false)
    outside.forEach((el) => { if (el) el.inert = false })
    const done = () => { menu.hidden = true; gsap.set(menu, { clearProps: 'clipPath' }) }
    if (motion) {
      gsap.killTweensOf(menu)
      gsap.to(menu, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.5, ease: 'expo.inOut', onComplete: done })
    } else done()
    return undefined
  }, [menuOpen])

  // Close when the burger goes away (window widened past the breakpoint).
  useEffect(() => {
    if (!menuOpen) return undefined
    const onResize = () => { const b = burgerRef.current; if (b && b.offsetParent === null) setMenuOpen(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [menuOpen])

  // Unmounting mid-open must not leave the page inert or scroll-locked.
  useEffect(() => () => {
    document.documentElement.classList.remove('hj-menu-open')
    lockScroll(false)
    ;[document.getElementById('main'), document.querySelector('.hj-skip')].forEach((el) => { if (el) el.inert = false })
  }, [])

  const toggleMenu = () => setMenuOpen((o) => !o)

  const skip = (e) => {
    const m = document.getElementById('main')
    if (!m) return
    e.preventDefault()
    m.focus({ preventScroll: true })
    scrollToEl(m, true)
  }

  const wheelMark = <span className="hj-brand__fb"><img src={LOGO_PLACEHOLDER} alt="" width="44" height="44" /><span>{clubName}</span></span>

  return (
    <>
      <a className="hj-skip" href="#main" onClick={skip}>Skip to content</a>

      <header ref={hdrRef} className={'hj-hdr' + (compact ? ' is-compact' : '')}>
        {/* row 1: the club's contact details, the year and Admin login (client, 2026-09-29) */}
        <div className="hj-hdr__top">
          <ul className="hj-hdr__contact" aria-label="Contact the club">
            {contact.phone ? <li><a href={'tel:' + String(contact.phone).replace(/[^\d+]/g, '')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg><span className="hj-sr">Phone: </span>{contact.phone}</a></li> : null}
            {contact.email ? <li><a href={'mailto:' + contact.email}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4 7.3V17h16V7.3z" /></svg><span className="hj-sr">Email: </span>{contact.email}</a></li> : null}
          </ul>
          <div className="hj-hdr__tools">
            <label className="hj-year">
              <span className="hj-sr">Rotary year</span>
              <YearSelect className="hj-year__sel" aria-label="Select Rotary year" />
            </label>
            <a className="hj-hdr__admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="hj-sr"> (opens in a new tab)</span><IconOut /></a>
          </div>
        </div>
        {/* row 2: the club lockup (bigger) and the menu */}
        <div className="hj-hdr__main">
        <a className="hj-brand" href="/" aria-label={clubName + ', home'}>
          {aboutDone
            ? <LogoImg srcs={[rotaryLogo, clubLogo]} alt="" className="hj-brand__img" fallback={wheelMark} />
            : <span className="hj-brand__wait" aria-hidden="true" />}
        </a>
        <nav ref={navRef} className="hj-nav" aria-label="Main" aria-hidden={compact ? 'true' : undefined}>
          <DeskNav menus={menus} current={current} pr={pr} />
        </nav>
        <div className="hj-hdr__end">
          <button ref={burgerRef} type="button" className="hj-burger" aria-expanded={menuOpen ? 'true' : 'false'} aria-controls="hj-menu" onClick={toggleMenu}>
            <span className="hj-sr">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            <span className="hj-burger__bars" aria-hidden="true"><i /><i /><i /></span>
          </button>
        </div>
        </div>
      </header>

      <div ref={menuRef} className="hj-menu" id="hj-menu" hidden data-lenis-prevent="">
        <nav aria-label="Menu"><MenuList menus={menus} current={current} pr={pr} /></nav>
        {(contact.phone || contact.email) ? (
          <ul className="hj-menu__contact" aria-label="Contact the club">
            {contact.phone ? <li><a href={'tel:' + String(contact.phone).replace(/[^\d+]/g, '')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg><span className="hj-sr">Phone: </span>{contact.phone}</a></li> : null}
            {contact.email ? <li><a href={'mailto:' + contact.email}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4 7.3V17h16V7.3z" /></svg><span className="hj-sr">Email: </span>{contact.email}</a></li> : null}
          </ul>
        ) : null}
        <div className="hj-menu__foot">
          <label className="hj-menu__year">Rotary year<YearSelect className="hj-year__sel" aria-label="Select Rotary year" /></label>
          <a className="hj-btn hj-btn--line" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="hj-sr"> (opens in a new tab)</span><IconOut /></a>
        </div>
      </div>

      <main id="main" className="hj-main" tabIndex={-1}>{children}</main>

      <footer ref={footRef} className="hj-ft">
        <Ridge preset="foot" className="hj-ft__ridge" />
        <div className="hj-ft__in">
          {/* the club's logo on a rectangular plate - no name, no district (client, 2026-09-29) */}
          <div className="hj-ft__club">
            <LogoImg srcs={[clubLogo, rotaryLogo, LOGO_PLACEHOLDER]} alt={clubName + ' logo'} className="hj-ft__logo" fallback={null} />
          </div>
          {/* the club's contact details in place of the meeting (client, 2026-09-29) */}
          {(contact.phone || contact.email) ? (
            <div className="hj-ft__meet">
              <p className="hj-ft__k">Contact</p>
              <ul className="hj-ft__cl">
                {contact.phone ? (
                  <li><a href={'tel:' + String(contact.phone).replace(/[^\d+]/g, '')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg>
                    <span className="hj-sr">Phone: </span>{contact.phone}
                  </a></li>
                ) : null}
                {contact.email ? (
                  <li><a href={'mailto:' + contact.email}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4 7.3V17h16V7.3z" /></svg>
                    <span className="hj-sr">Email: </span>{contact.email}
                  </a></li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div className="hj-ft__act">
            {socials.length > 0 && (
              <ul className="hj-soc" aria-label="Social media">
                {socials.map((s, i) => {
                  const k = String(s.platform || '').trim().toLowerCase()
                  return (
                    <li key={i}>
                      <a href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer">
                        <span className="hj-sr">{socialLabel(k)} (opens in a new tab)</span>
                        <span aria-hidden="true">{socialIcon(k)}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="hj-ft__bottom">
          <div className="hj-ft__vc"><VisitorCount /></div>
          <p>© {new Date().getFullYear()} {clubName}{yr ? <> · <span className="hj-nowrap">Rotary year {yr}</span></> : null}</p>
          <p className="hj-ft__by">Powered by{' '}
            <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer">Roster On Wheels<span className="hj-sr"> (opens in a new tab)</span></a>
          </p>
        </div>
      </footer>
    </>
  )
}
