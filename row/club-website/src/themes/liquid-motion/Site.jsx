'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION — the shell. Header = option C of Theme8-Samples/E-liquid-webgl/
// header-samples.html (client, 2026-09-29): a dark strip (phone + email, year,
// Admin login) that scrolls away over a solid full-width bar (big logo, the menus;
// what doesn't fit goes into "More"), a full-screen ink menu that opens as a
// circle from the burger, and the ink footer: the logo on a
// white rectangle, visitor count, socials + admin in one row, the menu under it,
// then the copyright and Powered by; a floating back-to-top button.
// Everything is the club's live data; the page renders in <main>.
//
// <main> carries NO transform (ScrollTrigger pins use position:fixed).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The shell needs the raw about row (Rotary lockup vs club crest) that no
// data.js hook exposes on its own; getAbout is per-request
// cached, so this costs no extra call (ClubProvider already made it).
import {
  useClub, useMenus, titleCase, menuHref, menuExternal, socialLabel, routeKey, YearSelect, VisitorCount,
  useThemeShell, useLoader, useAboutData, media, externalUrl, LOGO_PLACEHOLDER,
} from '../_shared/data.js'
import { useSmoothScroll, useScene, lockScroll, scrollToY, gsap, prefersReducedMotion, shellMotion, revealBatch } from './motion.js'
import { Edge, Pill, Chevron, clean } from './kit.jsx'
import './theme.css'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

const ADMIN_URL = ADMIN_LOGIN_URL

const SOCIAL_PATHS = {
  facebook: 'M13.5 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.3h2.8V22z',
  instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zM12 6.9a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2zm0 8.4a3.3 3.3 0 1 1 0-6.6 3.3 3.3 0 0 1 0 6.6zm5.3-9.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  linkedin: 'M4.5 8.8h3.2V20H4.5zM6.1 3.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM9.8 8.8h3v1.5h.1c.4-.8 1.5-1.7 3-1.7 3.2 0 3.8 2.1 3.8 4.8V20h-3.2v-5.9c0-1.4 0-3.2-2-3.2s-2.2 1.5-2.2 3.1v6H9.8z',
  twitter: 'M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z',
  youtube: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z',
}
SOCIAL_PATHS.x = SOCIAL_PATHS.twitter
const GLOBE = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h3a15.6 15.6 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.6 15.6 0 0 0 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.2 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z'

/** An <img> that walks a list of candidate URLs (club logos sometimes 404) and hides only when all fail. */
const stroke = (d) => function Ico() {
  return <svg className="liq-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const PhoneIco = stroke('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z')
const MailIco = stroke('M4 6h16v12H4zM4 7l8 6 8-6')

function Logo({ srcs, alt, className }) {
  const list = srcs.filter(Boolean)
  const key = list.join('|')
  const [i, setI] = useState(0)
  useEffect(() => { setI(0) }, [key])
  if (i >= list.length) return null
  return <img className={className} src={list[i]} alt={alt} decoding="async" onError={() => setI(i + 1)} />
}

/** Which menu entry is the current page: same route, best-matching query (?pr=CE vs ?pr=CP both live on /projects). */
function useActiveKey(menus) {
  const { pathname, search } = useLocation()
  return useMemo(() => {
    const cur = routeKey(pathname)
    const q = new URLSearchParams(search)
    let best = null, bestScore = -Infinity
    const test = (key, href) => {
      if (!href || href === '#' || routeKey(href) !== cur) return
      const hp = new URLSearchParams(href.split('?')[1] || '')
      let score = 0
      hp.forEach((v, k) => { if (k !== 'yearId') score += (q.get(k) || '').toLowerCase() === String(v).toLowerCase() ? 2 : -1 })
      if (score > bestScore) { bestScore = score; best = key }
    }
    menus.forEach((m, i) => {
      test(String(i), menuHref(m.linkType, m.linkValue))
      ;(m.subMenus || []).forEach((s, j) => test(i + '.' + j, menuHref(s.linkType, s.linkValue)))
    })
    return best
  }, [menus, pathname, search])
}

function MenuLink({ href, ext, label, current, className, onClick }) {
  return (
    <a className={className} href={href} aria-current={current ? 'page' : undefined} onClick={onClick}
       {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {label}{ext ? <span className="liq-sr"> (opens in new tab)</span> : null}
    </a>
  )
}

const items = (menus) => menus.map((m, i) => ({
  i,
  label: clean(m.menuName),
  href: menuHref(m.linkType, m.linkValue),
  ext: menuExternal(m.linkType, m.linkValue),
  subs: (m.subMenus || []).filter((s) => s && clean(s.subMenuName)).map((s, j) => ({
    key: i + '.' + j, label: clean(s.subMenuName), href: menuHref(s.linkType, s.linkValue), ext: menuExternal(s.linkType, s.linkValue),
  })),
})).filter((m) => m.label)

export default function Site({ children }) {
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  const ab = useAboutData()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about
  const nav = useMemo(() => items(menus), [menus])
  const active = useActiveKey(menus)

  useSmoothScroll()
  useThemeShell('liquid-motion', menus.length > 0)
  useLoader(!club.loading)


  const clubName = club.clubDisplayName
  const rotaryLogo = media(about ? about.rotaryLogoPath : null)
  const clubLogo = media(about ? about.clubLogoPath : null)
  const socials = (ab.socials || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  // footer menu row: the club's menu, a dropdown-only parent standing in for its sub pages
  const footLinks = nav.flatMap((m) => (m.subs.length && (!m.href || m.href === '#')
    ? m.subs.map((x) => ({ key: x.key, label: x.label, href: x.href, ext: x.ext }))
    : [{ key: String(m.i), label: m.label, href: m.href, ext: m.ext }])).filter((l) => l.href && l.href !== '#')

  // ── refs ──
  const hdrRef = useRef(null), barRef = useRef(null), brandRef = useRef(null), navUlRef = useRef(null), endRef = useRef(null)
  const progRef = useRef(null), burgerRef = useRef(null), menuRef = useRef(null)
  const skipRef = useRef(null), mainRef = useRef(null), footRef = useRef(null)

  // ── desktop submenus: hover opens them (CSS); click / Enter / Esc via this ──
  const [openSub, setOpenSub] = useState(-1)
  useEffect(() => { setOpenSub(-1) }, [location.pathname, location.search])

  // ── the menus that fit on the bar stay there; the rest go into "More" (up to 9 menus on a 1280 laptop) ──
  const [fit, setFit] = useState(Infinity)
  useLayoutEffect(() => {
    const ul = navUlRef.current
    if (!ul) return undefined
    const wide = window.matchMedia('(min-width: 1200px)')
    const check = () => {
      if (!wide.matches) { setFit(Infinity); return }
      const lis = [...ul.children].filter((li) => li.hasAttribute('data-i'))
      const more = ul.querySelector('.liq-nav__more')
      lis.forEach((li) => { li.style.display = 'flex' }) // measure every item, hidden or not
      if (more) more.style.display = 'flex'
      const w = lis.map((li) => li.offsetWidth)
      const moreW = more ? more.offsetWidth : 0
      lis.forEach((li) => { li.style.display = '' })
      if (more) more.style.display = ''
      const avail = ul.parentElement.clientWidth
      let k = lis.length
      if (w.reduce((a, b) => a + b, 0) > avail) {
        let used = moreW
        k = 0
        while (k < lis.length && used + w[k] <= avail) used += w[k++]
      }
      setFit(k)
    }
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    if (ro) ro.observe(ul.parentElement)
    wide.addEventListener('change', check)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(check)
    return () => { if (ro) ro.disconnect(); wide.removeEventListener('change', check) }
  }, [nav])
  const overflow = nav.filter((m, n) => n >= fit)
  const tel = String(ab.phone || '').replace(/[^\d+]/g, '')

  // ── mobile menu ──
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const [openAcc, setOpenAcc] = useState(-1)
  const close = (refocus) => { setOpen(false); if (refocus && burgerRef.current) burgerRef.current.focus() }
  useEffect(() => { setOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)')
    const on = () => { if (mq.matches) setOpen(false) }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // open: circle grows out of the burger; close: shrinks back into it
  useLayoutEffect(() => {
    const menu = menuRef.current, burger = burgerRef.current
    if (!menu || !burger) return undefined
    if (open && !shown) { setShown(true); return undefined }
    if (!open && !shown) return undefined
    const anim = !prefersReducedMotion()
    const r = burger.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const far = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy))
    gsap.killTweensOf(menu)
    if (open) {
      if (anim) {
        gsap.fromTo(menu, { clipPath: 'circle(0px at ' + cx + 'px ' + cy + 'px)' }, { clipPath: 'circle(' + far + 'px at ' + cx + 'px ' + cy + 'px)', duration: 0.75, ease: 'power3.inOut', clearProps: 'clipPath' })
        gsap.fromTo(menu.querySelectorAll('.liq-menu__list > li, .liq-menu__foot'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, delay: 0.18, stagger: 0.045, ease: 'power3.out', clearProps: 'transform,opacity' })
      }
      const first = menu.querySelector('a, button')
      if (first) first.focus({ preventScroll: true })
    } else {
      const done = () => { menu.style.clipPath = ''; setShown(false) }
      if (anim) gsap.to(menu, { clipPath: 'circle(0px at ' + cx + 'px ' + cy + 'px)', duration: 0.5, ease: 'power3.inOut', onComplete: done })
      else done()
    }
    return () => gsap.killTweensOf(menu)
  }, [open, shown])

  // while open: the page behind is inert, scroll is locked, Esc closes, Tab stays in (burger + menu)
  useEffect(() => {
    ;[mainRef.current, footRef.current, skipRef.current].forEach((el) => { if (el) el.inert = open })
    document.documentElement.classList.toggle('liq-menu-open', open)
    lockScroll(open)
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return }
      if (e.key !== 'Tab' || !menuRef.current) return
      const f = [burgerRef.current, ...menuRef.current.querySelectorAll('a[href], button, select')].filter((el) => el && el.getClientRects().length)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => () => { document.documentElement.classList.remove('liq-menu-open'); lockScroll(false) }, [])

  // ── shell motion: band edges, progress bar, cursor; the footer reveals ──
  useScene(hdrRef, (c) => { shellMotion(progRef.current, c) }, [])
  useScene(footRef, () => { revealBatch('.liq-rv') }, [!!about, socials.length, footLinks.length])

  // the floating back-to-top button shows once the first screen has scrolled away (client, 2026-09-28)
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const on = () => setShowTop(window.scrollY > window.innerHeight * 0.9)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const toTop = (e) => {
    e.preventDefault()
    scrollToY(0, prefersReducedMotion())
    if (brandRef.current) brandRef.current.focus({ preventScroll: true })
  }

  return (
    <>
      <div id="rotary-loader" aria-hidden="true">
        <img src={LOGO_PLACEHOLDER} alt="" className="wheel-spin" width="60" height="60" />
        <span>{clubName}</span>
      </div>

      <a className="liq-skip" href="#main" ref={skipRef}>Skip to content</a>

      <header className="liq-hdr" ref={hdrRef}>
        {/* the strip: how to reach the club, the year, Admin login (it scrolls away; the bar stays) */}
        <div className="liq-util">
          <div className="liq-util__in">
            <ul className="liq-util__contact" aria-label="Contact the club">
              {ab.phone ? <li><a href={'tel:' + tel}><PhoneIco />{ab.phone}</a></li> : null}
              {ab.email ? <li><a href={'mailto:' + ab.email}><MailIco />{ab.email}</a></li> : null}
            </ul>
            <div className="liq-util__end">
              <YearSelect className="liq-select liq-select--util" aria-label="Rotary year" />
              <a className="liq-util__admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="liq-sr"> (opens in new tab)</span></a>
            </div>
          </div>
        </div>
        <div className="liq-bar" ref={barRef}>
          <a className="liq-brand" href="/" ref={brandRef}>
            <Logo srcs={[rotaryLogo, clubLogo, LOGO_PLACEHOLDER]} alt={clubName + ' home'} />
          </a>

          <nav className="liq-nav" aria-label="Main">
            <ul ref={navUlRef}>
              {nav.map((m) => {
                const isOpen = openSub === m.i
                const subId = 'liq-sub-' + m.i
                const toggleOnly = m.subs.length > 0 && (!m.href || m.href === '#')
                const branchActive = active && active.split('.')[0] === String(m.i)
                return (
                  <li key={m.i} data-i={m.i}
                      className={'liq-nav__item' + (m.subs.length ? ' liq-nav__item--sub' : '') + (isOpen ? ' liq-is-open' : '') + (branchActive ? ' liq-is-active' : '') + (m.i >= fit ? ' liq-is-over' : '')}
                      onBlur={(e) => { if (isOpen && !e.currentTarget.contains(e.relatedTarget)) setOpenSub(-1) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && isOpen) {
                          setOpenSub(-1)
                          const t = e.currentTarget.querySelector('.liq-nav__btn, button.liq-nav__a')
                          if (t) t.focus()
                        }
                      }}>
                    {toggleOnly
                      ? (
                        <button type="button" className="liq-nav__a" aria-expanded={isOpen} aria-controls={subId} onClick={() => setOpenSub(isOpen ? -1 : m.i)}>
                          {m.label}<Chevron />
                        </button>
                      )
                      : <MenuLink className="liq-nav__a" href={m.href} ext={m.ext} label={m.label} current={active === String(m.i)} />}
                    {m.subs.length > 0 && !toggleOnly ? (
                      <button type="button" className="liq-nav__btn" aria-expanded={isOpen} aria-controls={subId} onClick={() => setOpenSub(isOpen ? -1 : m.i)}>
                        <Chevron /><span className="liq-sr">{m.label} submenu</span>
                      </button>
                    ) : null}
                    {m.subs.length > 0 ? (
                      <ul className="liq-nav__sub" id={subId}>
                        {m.subs.map((s) => (
                          <li key={s.key}><MenuLink href={s.href} ext={s.ext} label={s.label} current={active === s.key} onClick={() => setOpenSub(-1)} /></li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
              {overflow.length ? (
                <li className={'liq-nav__item liq-nav__item--sub liq-nav__more' + (openSub === -2 ? ' liq-is-open' : '')}
                    onBlur={(e) => { if (openSub === -2 && !e.currentTarget.contains(e.relatedTarget)) setOpenSub(-1) }}
                    onKeyDown={(e) => { if (e.key === 'Escape' && openSub === -2) { setOpenSub(-1); e.currentTarget.querySelector('button').focus() } }}>
                  <button type="button" className="liq-nav__a" aria-expanded={openSub === -2} aria-controls="liq-sub-more" onClick={() => setOpenSub(openSub === -2 ? -1 : -2)}>
                    More<Chevron />
                  </button>
                  <ul className="liq-nav__sub liq-nav__sub--more" id="liq-sub-more">
                    {overflow.flatMap((m) => [
                      m.href && m.href !== '#'
                        ? <li key={m.i}><MenuLink href={m.href} ext={m.ext} label={m.label} current={active === String(m.i)} onClick={() => setOpenSub(-1)} /></li>
                        : <li key={m.i} className="liq-nav__grp">{m.label}</li>,
                      ...m.subs.map((x) => <li key={x.key} className="liq-nav__kid"><MenuLink href={x.href} ext={x.ext} label={x.label} current={active === x.key} onClick={() => setOpenSub(-1)} /></li>),
                    ])}
                  </ul>
                </li>
              ) : null}
            </ul>
          </nav>

          <div className="liq-bar__end" ref={endRef}>
            <a className="liq-bar__admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin<span className="liq-sr"> login (opens in new tab)</span></a>
            <button type="button" className="liq-burger" ref={burgerRef} aria-expanded={open} aria-controls="liq-menu" onClick={() => (open ? close(true) : setOpen(true))}>
              <span className="liq-sr">{open ? 'Close menu' : 'Menu'}</span>
              <span className="liq-burger__bars" aria-hidden="true"><i /><i /></span>
            </button>
          </div>
          <span className="liq-bar__prog" aria-hidden="true" ref={progRef} />
        </div>
      </header>

      <div className="liq-menu" id="liq-menu" ref={menuRef} hidden={!shown} data-lenis-prevent="">
        <nav aria-label="Menu">
          <ul className="liq-menu__list">
            {nav.map((m) => {
              const accOpen = openAcc === m.i
              const toggleOnly = m.subs.length > 0 && (!m.href || m.href === '#')
              return (
                <li key={m.i}>
                  <div className="liq-menu__row">
                    {toggleOnly
                      ? <button type="button" className="liq-menu__a" aria-expanded={accOpen} aria-controls={'liq-msub-' + m.i} onClick={() => setOpenAcc(accOpen ? -1 : m.i)}>{m.label}</button>
                      : <MenuLink className="liq-menu__a" href={m.href} ext={m.ext} label={m.label} current={active === String(m.i)} onClick={() => close(true)} />}
                    {m.subs.length > 0 ? (
                      <button type="button" className="liq-menu__tog" aria-expanded={accOpen} aria-controls={'liq-msub-' + m.i} onClick={() => setOpenAcc(accOpen ? -1 : m.i)}>
                        <Chevron /><span className="liq-sr">{m.label} submenu</span>
                      </button>
                    ) : null}
                  </div>
                  {m.subs.length > 0 ? (
                    <ul className="liq-menu__sub" id={'liq-msub-' + m.i} hidden={!accOpen}>
                      {m.subs.map((s) => (
                        <li key={s.key}><MenuLink href={s.href} ext={s.ext} label={s.label} current={active === s.key} onClick={() => close(true)} /></li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="liq-menu__foot">
          <label className="liq-menu__year"><span>Rotary year</span><YearSelect className="liq-select" aria-label="Rotary year" /></label>
          <Pill href={ADMIN_URL} variant="ghost" external>Admin login</Pill>
        </div>
      </div>

      <main id="main" tabIndex={-1} ref={mainRef}>{children}</main>

      <footer className="liq-band liq-band--ink liq-foot" ref={footRef}>
        <Edge />
        <div className="liq-wrap">
          {/* client, 2026-09-28: row 1 = logo · visitor count · socials (Admin login removed 2026-10-01; it stays in the header); row 2 = the menu */}
          <div className="liq-foot__top">
            <span className="liq-foot__logo liq-rv">
              <Logo srcs={[clubLogo, rotaryLogo, LOGO_PLACEHOLDER]} alt={clubName + ' logo'} />
            </span>
            <div className="liq-foot__vc liq-rv"><VisitorCount /></div>
            <div className="liq-foot__act liq-rv">
              {socials.length > 0 ? (
                <ul className="liq-socials" aria-label="Social media">
                  {socials.map((s, i) => {
                    const k = String(s.platform || '').trim().toLowerCase()
                    return (
                      <li key={i}>
                        <a href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer" aria-label={socialLabel(k) + ' (opens in new tab)'}>
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={SOCIAL_PATHS[k] || GLOBE} /></svg>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          </div>

          {footLinks.length ? (
            <nav className="liq-foot__nav liq-rv" aria-label="Footer">
              <ul>
                {footLinks.map((l) => (
                  <li key={l.key}><MenuLink href={l.href} ext={l.ext} label={titleCase(l.label)} current={active === l.key} /></li>
                ))}
              </ul>
            </nav>
          ) : null}

          <div className="liq-foot__bottom">
            <p>{'© ' + new Date().getFullYear() + ' ' + clubName}</p>
            <p className="liq-foot__by">
              Powered by{' '}
              <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer">Roster On Wheels<span className="liq-sr"> (opens in new tab)</span></a>
            </p>
          </div>
        </div>
      </footer>

      <button type="button" className={'liq-fab' + (showTop ? ' liq-is-on' : '')} onClick={toTop} aria-label="Back to top">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </>
  )
}
