'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage — the shell: paper header (logo, the club's menus with
// submenus, year, burger), the cranberry full-screen menu, <main>, and the
// royal footer with its torn top edge. Every page renders inside it.
//
// Contract followed from SiteGold: menus via useMenus/menuHref/menuExternal,
// YearSelect, VisitorCount, admin login in a new tab, logos from api.getAbout
// with fallbacks. <main> carries NO transform — ScrollTrigger pins use
// position:fixed, which a transformed ancestor would re-anchor.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// sharedRequest: data.js does not re-export getAbout; the shell needs the raw
// about row (rotary + club logos, socials) exactly as SiteGold reads it.
import {
  useClub, useMenus, menuHref, menuExternal, socialLabel, routeKey, YearSelect, VisitorCount,
  useThemeShell, useLoader, media, externalUrl, LOGO_PLACEHOLDER,
} from '../_shared/data.js'
import { useSmoothScroll, lockScroll, gsap, prefersReducedMotion, scrollToY } from '../_shared/motion.js'
import { ADMIN_URL, Underline, Tape, menuLabel, yearDash, useImgChain, SocialIcon } from './kit.jsx'

const ico = (d) => function Ico() {
  return <svg className="col-hd-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
/**
 * Photo-filled titles (.col-pt.is-img) fetch their photo only once they come
 * within 600px of the screen; until then the letters are the plain tint (see
 * theme.css). An element carrying data-pt-hold waits until that is removed.
 */
function usePhotoTypeLazy() {
  useEffect(() => {
    const SEL = '.col-pt.is-img:not([data-pt-in]):not([data-pt-hold])'
    const on = (el) => el.setAttribute('data-pt-in', '')
    if (typeof IntersectionObserver === 'undefined') {
      const all = () => document.querySelectorAll(SEL).forEach(on)
      all()
      const mo = new MutationObserver(all)
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pt-hold'] })
      return () => mo.disconnect()
    }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { on(e.target); io.unobserve(e.target) } }), { rootMargin: '600px 0px' })
    const seen = new WeakSet()
    let raf = 0
    const scan = () => { raf = 0; document.querySelectorAll(SEL).forEach((el) => { if (!seen.has(el)) { seen.add(el); io.observe(el) } }) }
    const soon = () => { if (!raf) raf = requestAnimationFrame(scan) }
    scan()
    const mo = new MutationObserver(soon)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pt-hold'] })
    return () => { cancelAnimationFrame(raf); io.disconnect(); mo.disconnect() }
  }, [])
}

const PhoneIco = ico('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z')
const MailIco = ico('M4 6h16v12H4zM4 7l8 6 8-6')
import './theme.css'

/** ?pr=CE is the club-service feed; every other avenue is "Projects". */
const prKind = (pr) => (String(pr || '').toUpperCase() === 'CE' ? 'CE' : '')

/** The torn top edge of the footer (seeded, so it never changes between renders). */
const EDGE = (() => {
  let d = 'M0 18'
  for (let x = 0; x <= 1200; x += 20) d += ' L' + x + ' ' + (4 + ((((Math.sin(x * 12.9898) * 43758.5453) % 1) + 1) % 1) * 11).toFixed(1)
  return d + ' L1200 18 Z'
})()

const Chevron = () => (
  <svg className="col-chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 4.2l4 4 4-4" /></svg>
)

export default function Site({ children }) {
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = club.about || null
  const [open, setOpen] = useState(false)            // mobile menu
  const [sub, setSub] = useState(-1)                 // desktop submenu opened by keyboard/click
  const [compact, setCompact] = useState(false)      // menu too long for one row
  const hdRef = useRef(null)
  const navListRef = useRef(null)
  const burgerRef = useRef(null)
  const menuRef = useRef(null)
  const lastFocus = useRef(null)

  useSmoothScroll()
  usePhotoTypeLazy()
  // no scroll-velocity lean (2026-10-05): writing --col-vel on <html> every frame restyled the whole
  // page while scrolling (37s of style recalc per home scroll at 4x CPU, ~5fps) - cards keep their resting tilt
  useThemeShell('photo-collage', menus.length > 0)
  useLoader(!club.loading)


  // ── where are we ──────────────────────────────────────────────────────────
  const hereKey = routeKey(location.pathname)
  const herePr = prKind(new URLSearchParams(location.search).get('pr'))
  const isHere = (href) => {
    if (!href || href === '#' || /^(https?:)?\/\//i.test(href)) return false
    if (routeKey(href) !== hereKey) return false
    const q = href.indexOf('?')
    return prKind(q >= 0 ? new URLSearchParams(href.slice(q + 1)).get('pr') : '') === herePr
  }
  const link = (type, value) => {
    const href = menuHref(type, value)
    const external = menuExternal(type, value)
    return { href, external, here: !external && isHere(href) }
  }
  const extProps = (external) => (external ? { target: '_blank', rel: 'noopener noreferrer' } : null)

  // ── mobile menu ───────────────────────────────────────────────────────────
  const openMenu = () => { lastFocus.current = document.activeElement; setOpen(true) }
  const closeMenu = useCallback(() => {
    const menu = menuRef.current
    if (!menu || prefersReducedMotion()) { setOpen(false); return }
    gsap.to(menu, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.42, ease: 'power3.in', onComplete: () => { gsap.set(menu, { clearProps: 'clipPath' }); setOpen(false) } })
  }, [])

  // any navigation closes both menus
  useEffect(() => { setOpen(false); setSub(-1) }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return undefined
    const menu = menuRef.current
    const root = document.documentElement
    root.classList.add('col-menu-open')
    lockScroll(true)
    const close = menu && menu.querySelector('.col-menu-close')
    if (close) close.focus()
    if (menu && !prefersReducedMotion()) {
      gsap.fromTo(menu, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6, ease: 'power3.inOut', clearProps: 'clipPath' })
      gsap.from(menu.querySelectorAll('.col-menu-list > li > a, .col-menu-list > li > .col-menu-label'), { yPercent: 100, rotation: 4, duration: 0.6, ease: 'power3.out', stagger: 0.04, delay: 0.18, clearProps: 'transform,translate,rotate' })
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return }
      if (e.key !== 'Tab' || !menu) return
      const f = Array.from(menu.querySelectorAll('a[href], button, select')).filter((el) => !el.disabled && el.offsetParent !== null)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      root.classList.remove('col-menu-open')
      lockScroll(false)
      if (menu) gsap.killTweensOf(menu)
      const back = lastFocus.current
      const target = back && document.contains(back) && back.offsetParent ? back : burgerRef.current
      if (target) target.focus({ preventScroll: true })
    }
  }, [open, closeMenu])

  // ── desktop submenus: hover (CSS) + click/keyboard (data-open) ────────────
  useEffect(() => {
    if (sub < 0) return undefined
    const onDoc = (e) => { if (hdRef.current && !hdRef.current.contains(e.target)) setSub(-1) }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [sub])
  const onNavKey = (e) => {
    if (e.key !== 'Escape' || sub < 0) return
    const item = e.target.closest('.col-nav-item')
    setSub(-1)
    const tog = item && item.querySelector('.col-nav-tog, button.col-nav-link')
    if (tog) tog.focus()
  }
  const onItemBlur = (i) => (e) => { if (sub === i && !e.currentTarget.contains(e.relatedTarget)) setSub(-1) }

  // ── does the whole menu fit on one row? (else the burger takes over) ─────
  useLayoutEffect(() => {
    const hd = hdRef.current, ul = navListRef.current
    if (!hd || !ul || typeof ResizeObserver === 'undefined') return undefined
    const check = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      // two-row header (2026-10-05): the menu has the whole second row to itself
      const nav = hd.querySelector('.col-nav')
      const cs = nav ? getComputedStyle(nav) : null
      const avail = (nav ? nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : hd.clientWidth) - 8
      setCompact(ul.scrollWidth > avail)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(hd)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(check)
    return () => ro.disconnect()
  }, [menus])

  // ── skip link (through Lenis, focus without a second jump) ────────────────
  const skip = (e) => {
    const main = document.getElementById('main')
    if (!main) return
    e.preventDefault()
    scrollToY(main.getBoundingClientRect().top + window.scrollY, true)
    main.focus({ preventScroll: true })
  }

  // ── data for the chrome ───────────────────────────────────────────────────
  const clubName = club.clubDisplayName
  const a = about || {}
  const rotaryLogo = media(a.rotaryLogoPath)
  const clubLogo = media(a.clubLogoPath)
  const brandImg = useImgChain(about === undefined ? [] : [rotaryLogo, clubLogo, LOGO_PLACEHOLDER])
  // footer: the CLUB's own logo only (client, 2026-10-05) - never the Rotary lockup or the placeholder;
  // a club whose logo file is missing shows no logo here rather than the wrong one
  const footImg = useImgChain([clubLogo])
  const Y = yearDash(club.selectedYearLabel)
  const socials = (a.socials || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  const contact = (k) => ((a.contacts || []).map((c) => (c ? c[k] : null)).find((v) => v && String(v).trim()) || '').trim()
  const phone = contact('phone'), email = contact('email')
  const tel = phone.replace(/[^\d+]/g, '')

  return (
    <>
      <a className="col-skip" href="#main" onClick={skip}>Skip to content</a>

      {/* two rows (client, 2026-10-05): logo + contact / year / admin, then the menu on its own strip */}
      <header className={'col-hd' + (compact ? ' is-compact' : '')} ref={hdRef}>
        <div className="col-hd-top">
        <a className="col-brand" href="/" aria-label={clubName + ', home'}>
          {brandImg.src && !brandImg.done
            ? <img src={brandImg.src} alt="" width="900" height="240" onError={brandImg.onError} />
            : null}
          {about !== undefined && (brandImg.done || brandImg.src === LOGO_PLACEHOLDER)
            ? <span className="col-brand-name" aria-hidden="true">{clubName}</span>
            : null}
        </a>

        <div className="col-hd-util">
          {phone || email ? (
            <ul className="col-hd-contact" aria-label="Contact the club">
              {phone ? <li><a href={'tel:' + tel}><PhoneIco />{phone}</a></li> : null}
              {email ? <li><a href={'mailto:' + email}><MailIco />{email}</a></li> : null}
            </ul>
          ) : null}
          <span className="col-year"><YearSelect className="col-year-select" aria-label="Rotary year" /></span>
          <a className="col-hd-admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="col-sr"> (opens in a new tab)</span></a>
          <button type="button" className="col-burger" ref={burgerRef} aria-expanded={open} aria-controls="col-menu" onClick={openMenu}>
            <span className="col-burger-bars" aria-hidden="true"><i /><i /><i /></span><span className="col-burger-text">Menu</span>
          </button>
        </div>
        </div>

        <nav className="col-nav" aria-label="Main" onKeyDown={onNavKey}>
          <ul className="col-nav-list" ref={navListRef}>
            {menus.map((m, i) => {
              const L = link(m.linkType, m.linkValue)
              const label = menuLabel(m.menuName)
              const subs = (m.subMenus || []).filter((s) => s && String(s.subMenuName || '').trim())
              if (!label) return null
              if (!subs.length) {
                return (
                  <li key={m.id || i} className="col-nav-item">
                    <a className="col-nav-link" href={L.href} {...extProps(L.external)} aria-current={L.here ? 'page' : undefined}>
                      {label}<Underline />
                    </a>
                  </li>
                )
              }
              const subLinks = subs.map((s) => ({ s, L: link(s.linkType, s.linkValue) }))
              const childHere = subLinks.some((x) => x.L.here)
              const subId = 'col-sub-' + i
              const isOpen = sub === i
              return (
                <li key={m.id || i} className={'col-nav-item has-sub' + (childHere ? ' is-here' : '')} data-open={isOpen ? '' : undefined} onBlur={onItemBlur(i)}>
                  {L.href && L.href !== '#' ? (
                    <>
                      <a className="col-nav-link" href={L.href} {...extProps(L.external)} aria-current={L.here ? 'page' : undefined}>{label}<Underline /></a>
                      <button type="button" className="col-nav-tog" aria-expanded={isOpen} aria-controls={subId} onClick={() => setSub(isOpen ? -1 : i)}>
                        <Chevron /><span className="col-sr">{label} menu</span>
                      </button>
                    </>
                  ) : (
                    <button type="button" className="col-nav-link" aria-expanded={isOpen} aria-controls={subId} onClick={() => setSub(isOpen ? -1 : i)}>
                      {label}<Chevron /><Underline />
                    </button>
                  )}
                  <div className="col-sub" id={subId}>
                    <Tape tone={['cran', 'gold', 'azure', 'turq'][i % 4]} tilt={-3} />
                    <ul>
                      {subLinks.map(({ s, L: SL }, j) => (
                        <li key={s.id || j}>
                          <a href={SL.href} {...extProps(SL.external)} aria-current={SL.here ? 'page' : undefined}>
                            {menuLabel(s.subMenuName)}{SL.external ? <span className="col-sr"> (opens in a new tab)</span> : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              )
            })}
          </ul>
        </nav>

      </header>

      <div className="col-menu" id="col-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden={!open}>
        <div className="col-menu-top">
          <button type="button" className="col-menu-close" onClick={closeMenu}>Close <span aria-hidden="true">&#x2715;</span></button>
        </div>
        <nav aria-label="Site">
          <ul className="col-menu-list">
            {menus.map((m, i) => {
              const L = link(m.linkType, m.linkValue)
              const label = menuLabel(m.menuName)
              const subs = (m.subMenus || []).filter((s) => s && String(s.subMenuName || '').trim())
              if (!label) return null
              return (
                <li key={m.id || i}>
                  {L.href && L.href !== '#'
                    ? <a href={L.href} {...extProps(L.external)} aria-current={L.here ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>
                    : <span className="col-menu-label">{label}</span>}
                  {subs.length ? (
                    <ul className="col-menu-sub">
                      {subs.map((s, j) => {
                        const SL = link(s.linkType, s.linkValue)
                        return (
                          <li key={s.id || j}>
                            <a href={SL.href} {...extProps(SL.external)} aria-current={SL.here ? 'page' : undefined} onClick={() => setOpen(false)}>
                              {menuLabel(s.subMenuName)}{SL.external ? <span className="col-sr"> (opens in a new tab)</span> : null}
                            </a>
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
        <div className="col-menu-foot">
          {phone ? <a className="col-menu-admin" href={'tel:' + tel}><PhoneIco />{phone}</a> : null}
          {email ? <a className="col-menu-admin" href={'mailto:' + email}><MailIco />{email}</a> : null}
          <a className="col-menu-admin" href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin login<span className="col-sr"> (opens in a new tab)</span></a>
        </div>
      </div>

      <main id="main" className="col-main" tabIndex={-1}>{children}</main>

      <footer className="col-foot col-on-dark">
        <svg className="col-foot-edge" viewBox="0 0 1200 18" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={EDGE} /></svg>
        {/* one row (client, 2026-09-29): a bigger logo, the visitor counter, the social icons -
            no club name, district, meeting details or Admin login here (Admin login stays in the menu) */}
        <div className="col-foot-top">
          {!footImg.done && footImg.src ? (
            <div className="col-foot-logo"><img src={footImg.src} alt={clubName + ' logo'} width="140" height="140" loading="lazy" onError={footImg.onError} /></div>
          ) : null}
          <div className="col-foot-vc"><VisitorCount /></div>
          {socials.length ? (
            <ul className="col-socials">
              {socials.map((s, i) => (
                <li key={i}>
                  <a href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer" aria-label={socialLabel(String(s.platform || '').trim().toLowerCase()) + ' (opens in a new tab)'}>
                    <SocialIcon platform={s.platform} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="col-foot-bottom">
          <p>{Y ? 'Rotary year ' + Y + ' · ' : ''}© {new Date().getFullYear()} {clubName}</p>
          <p>Powered by <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer">Roster On Wheels<span className="col-sr"> (opens in a new tab)</span></a></p>
        </div>
      </footer>
    </>
  )
}
