'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD — theme 6 shell.  "Luxury Meets Rotary" (Gold_Theme_PRD.md v1.0)
//
// Stage A: this shell + HomeGold. The shared design-system pages (Projects,
// Directory, Calendar, …) render inside it and keep their classic styling —
// gold.css loads AFTER classic-blue's rotary-design.css for exactly that reason,
// the same arrangement madras-legacy uses.
//
// No sixth copy of rotary-anim.js: this theme points at classic-blue's, so the
// mobile drawer, reveal observer, counters, sliders and split-text all come from
// one maintained file (themeAssets.js). That is also why the drawer markup below
// keeps the shared data-nav-* hooks and the Tailwind translate classes the
// script toggles — the gold skin is layered on top through gld- classes.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { media } from '@/themes/shared/rotaryPage.js'
import { enc } from '@/themes/shared/Breadcrumb.jsx'
import { useMenus, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER } from '@/site/menus.js'
import { routeKey } from '@/site/routes.js'
import YearSelect from '@/site/YearSelect.jsx'
import VisitorCount from '@/themes/shared/visitorCount.jsx'
import { useThemeShell, useRouteEnter, useLoader } from '@/themes/shared/useRotaryAnim.js'


// Boot loader — cream, not Rotary blue, so the very first paint is already Gold.
const SHELL_CSS = `
#rotary-loader{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#FCFAF5;color:#09192F;transition:opacity .5s ease,visibility .5s ease}
#rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
#rotary-loader img{width:60px;height:60px}
.rotary-lightbox{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;background:rgba(9,25,47,.94);backdrop-filter:blur(4px)}
.rotary-lightbox img{max-width:92vw;max-height:88vh;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.rotary-lightbox__close{position:absolute;top:18px;right:24px;font-size:40px;line-height:1;color:#fff;background:none;border:0;cursor:pointer}
`

const ICO_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'

function socialIcon(key, cls) {
  let path
  switch (key) {
    case 'facebook': path = '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'; break
    case 'twitter': case 'x': path = '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>'; break
    case 'instagram': path = '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>'; break
    case 'linkedin': path = '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>'; break
    case 'youtube': path = '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>'; break
    default: path = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'; break
  }
  return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
}

function isActiveHref(href, current) {
  if (!href || !String(href).trim() || /^http/i.test(String(href))) return false
  return routeKey(href) === current
}

/** Utility-strip glyphs. Filled phone, outlined envelope, outlined user — the
 *  weights the reference header uses. */
const ICO_PHONE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.15.38 2.36.58 3.6.58a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.58 3.6a1 1 0 0 1-.25 1z"/></svg>'
const ICO_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="m3 6.5 9 6 9-6"/></svg>'

/** The reference header's centred flourish: two mirrored arcs with a warm wash
 *  falling away from each toward the wordmark. Drawn rather than shipped as an
 *  image so it stays crisp and inherits nothing from the club's own artwork. */
function Swoosh() {
  return (
    <svg className="gld-hd__swoosh" viewBox="0 0 580 104" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="gldWingL" x1="58" y1="0" x2="290" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E7CB94" stopOpacity=".40" />
          <stop offset=".38" stopColor="#F4E8CE" stopOpacity=".15" />
          <stop offset=".8" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gldWingR" x1="522" y1="0" x2="290" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E7CB94" stopOpacity=".40" />
          <stop offset=".38" stopColor="#F4E8CE" stopOpacity=".15" />
          <stop offset=".8" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        {/* The arcs are strongest a third of the way down and fade out at both
            ends, exactly as they do in the reference. */}
        <linearGradient id="gldArc" x1="0" y1="0" x2="0" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E2820C" stopOpacity=".22" />
          <stop offset=".38" stopColor="#E2820C" stopOpacity="1" />
          <stop offset="1" stopColor="#E2820C" stopOpacity=".1" />
        </linearGradient>
      </defs>
      <path fill="url(#gldWingL)" d="M58 0C120 30 128 66 157 104L290 104 290 0Z" />
      <path fill="url(#gldWingR)" d="M522 0C460 30 452 66 423 104L290 104 290 0Z" />
      <g fill="none" stroke="url(#gldArc)" strokeLinecap="round">
        <path strokeWidth="1.7" d="M58 0C120 30 128 66 157 104" />
        <path strokeWidth="1" d="M71 0C133 30 141 66 170 104" />
        <path strokeWidth="1.7" d="M522 0C460 30 452 66 423 104" />
        <path strokeWidth="1" d="M509 0C447 30 439 66 410 104" />
      </g>
    </svg>
  )
}

/** Desktop bar. Sub-menus open on hover — a pointer affordance only, so the
 *  drawer below carries them inline for touch. */
function renderNav(menus, current) {
  const parts = []
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const active = isActiveHref(hrefRaw, current) ? ' aria-current="page"' : ''
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      parts.push('<a href="' + enc(hrefRaw) + '"' + ext + active + '>' + label + '</a>')
    } else {
      parts.push('<div class="gld-nav__grp"><a href="' + enc(hrefRaw) + '"' + ext + active + '>' + label + ICO_CHEVRON + '</a><ul>')
      for (const s of subs) {
        const sExt = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        parts.push('<li><a href="' + enc(menuHref(s.linkType, s.linkValue)) + '"' + sExt + '>' + enc(s.subMenuName || '') + '</a></li>')
      }
      parts.push('</ul></div>')
    }
  }
  return parts.join('')
}

/** Drawer list. data-nav-close on every real link and data-nav-accordion on the
 *  parents — the shared script closes the drawer on a tap and on a year change. */
function renderDrawerNav(menus, current) {
  const parts = []
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      const active = isActiveHref(hrefRaw, current) ? ' style="color:#C9A227"' : ''
      parts.push('<a href="' + enc(hrefRaw) + '"' + ext + active + ' data-nav-close>' + label + '</a>')
    } else {
      parts.push('<div><button type="button" data-nav-accordion>' + label +
        '<svg data-nav-chevron viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .3s"><polyline points="6 9 12 15 18 9"/></svg></button>' +
        '<div data-nav-accordion-panel class="max-h-0 overflow-hidden transition-[max-height] duration-300"><ul style="list-style:none;margin:0;padding:0 0 0 8px">')
      for (const s of subs) {
        const sExt = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        parts.push('<li><a href="' + enc(menuHref(s.linkType, s.linkValue)) + '"' + sExt + ' data-nav-close>' + enc(s.subMenuName || '') + '</a></li>')
      }
      parts.push('</ul></div></div>')
    }
  }
  return parts.join('')
}

function renderQuickLinks(menus) {
  const parts = []
  for (const m of menus) {
    if (!m.menuName || !String(m.menuName).trim()) continue
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const t = String(m.menuName).trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    parts.push('<li><a href="' + enc(menuHref(m.linkType, m.linkValue)) + '"' + ext + '>' + enc(t) + '</a></li>')
  }
  return parts.join('')
}

/** Socials — nothing is rendered when the club has none (no placeholder row). */
function renderSocials(about) {
  const socials = ((about ? about.socials : null) || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  if (socials.length === 0) return ''
  return socials.map((s) => {
    let url = String(s.linkUrl).trim()
    if (!/^http/i.test(url)) url = 'https://' + url
    const key = String(s.platform || '').trim().toLowerCase()
    return '<a href="' + enc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + enc(socialLabel(key)) + '">' +
      socialIcon(key, '') + '</a>'
  }).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SiteGold({ children }) {
  const adminLoginUrl = useClub().adminLoginUrl
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = useClub().about
  const [atTop, setAtTop] = useState(true)

  // Footer viewport replay: the shared observer only ADDS .is-visible; this
  // one removes it once the footer is fully off-screen and re-adds it on
  // re-entry, so the columns' rise replays every time (all pages).
  useEffect(() => {
    const els = document.querySelectorAll('.gld-ft .reveal')
    if (!els.length) return undefined
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // Ratio OR taller-than-viewport — see the note in pages/gold/kit.jsx.
        if (e.isIntersecting
            && (e.intersectionRatio >= 0.12 || e.boundingClientRect.height >= window.innerHeight))
          e.target.classList.add('is-visible')
        else if (!e.isIntersecting) e.target.classList.remove('is-visible')
      }
    }, { threshold: [0, 0.12] })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  const mainRef = useRef(null)

  // Back-to-top visibility. One passive listener; the header's own scrolled
  // state is already handled by rotary-anim.js via [data-nav].
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 480)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const clubName = club.clubDisplayName
  const rotaryLogoUrl = media(about ? about.rotaryLogoPath : null)
  const clubLogoUrl = media(about ? about.clubLogoPath : null)
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl
  const current = routeKey(location.pathname)

  useThemeShell('gold', menus.length > 0)
  useRouteEnter(mainRef)
  useLoader(!club.loading)

  // The API carries these inside about.contacts[] — the flat emailId/contactNo
  // this used to read do not exist on the DTO, so the footer's contact block has
  // never rendered for any club. Same extraction the classic theme uses.
  const contacts = (about ? about.contacts : null) || []
  const email = (contacts.map((c) => (c ? c.email : null)).find((e) => e && String(e).trim()) || '').trim()
  const phone = (contacts.map((c) => (c ? c.phone : null)).find((p) => p && String(p).trim()) || '').trim()

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      <div id="rotary-loader" aria-hidden="true">
        <img src={LOGO_PLACEHOLDER} alt="" className="wheel-spin" />
        <span style={{ fontFamily: "'Playfair Display',serif", fontSize: '1.35rem', color: '#09192F' }}>{clubName}</span>
      </div>

      {/* ══ Header ══
          Two rows, per the reference. Row 1 is the masthead: contact left, the
          club lockup CENTRED ON THE PAGE inside its gold flourish, year + admin
          right. Row 2 is the whole menu on one centred line.
          The lockup is centred absolutely, not by flex — the blocks either side
          are different widths (and one of them empties out entirely when a club
          files no contact details), which would drag a flex-centred lockup off
          the middle. This layout also retires the old split nav: one row takes
          any number of menu items and simply wraps, so nothing has to measure
          whether the menu fits beside the wheel. */}
      <header data-nav className="gld-hd">
        <div className="gld-hd__main">
          <Swoosh />
          <div className="gld-x gld-hd__in">
            {/* The panel is only drawn when there is something on it — an empty
                one showed as a stray grey pill for clubs with no contact row. */}
            <div className="gld-hd__contact" hidden={!phone && !email}>
              {phone && (
                <a href={'tel:' + phone.replace(/\s+/g, '')}>
                  <i dangerouslySetInnerHTML={{ __html: ICO_PHONE }} /><span>{phone}</span>
                </a>
              )}
              {phone && email && <i className="gld-hd__sep" aria-hidden="true" />}
              {email && (
                <a href={'mailto:' + email}>
                  <i dangerouslySetInnerHTML={{ __html: ICO_MAIL }} /><span>{email}</span>
                </a>
              )}
            </div>

            <a href="/" className="gld-brand" aria-label={clubName + ' — Home'}>
              {/* Logo only: the club lockup already carries the name, so the
                  text beside it was saying it twice. */}
              <img src={headerLogoUrl} alt={clubName}
                   onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = LOGO_PLACEHOLDER }} />
            </a>

            <div className="gld-hd__pills">
              <span className="gld-yr"><YearSelect aria-label="Select Rotary year" /></span>
              <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" className="gld-hd__admin">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>
                Admin login
              </a>
              <button type="button" data-nav-toggle className="gld-burger" aria-label="Open menu">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div className="gld-hd__navrow">
          <div className="gld-x">
            <nav className="gld-nav" dangerouslySetInnerHTML={{ __html: renderNav(menus, current) }} />
          </div>
        </div>
      </header>

      {/* Drawer + backdrop sit outside <header>: its backdrop-filter would make
          the header the containing block for these fixed children. */}
      <div data-nav-backdrop className="pointer-events-none fixed inset-0 z-[55] bg-navy/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 xl:hidden"></div>
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden xl:hidden">
        <div data-nav-drawer className="gld-drawer pointer-events-auto absolute right-0 top-0 flex h-full w-[86%] max-w-sm translate-x-full flex-col shadow-2xl transition-transform duration-300 ease-out">
          <div className="gld-drawer__hd">
            <img src={headerLogoUrl} alt={clubName}
                 onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = LOGO_PLACEHOLDER }} />
            <button type="button" data-nav-close className="gld-burger" aria-label="Close menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto"
               dangerouslySetInnerHTML={{ __html: renderDrawerNav(menus, current) }} />
          <div className="gld-drawer__ft">
            <span className="gld-yr"><YearSelect aria-label="Select Rotary year" /></span>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-nav-close
               className="gld-btn gld-btn--gold" style={{ justifyContent: 'center' }}>Admin login</a>
          </div>
        </div>
      </div>

      <main ref={mainRef} className="route-enter">{children}</main>

      {/* ══ Footer ══ */}
      <footer className="gld-ft">
        <div className="gld-ft__top" aria-hidden="true"></div>
        <div className="gld-x">
          {/* gld-stagger + reveal: the columns rise one after another every
              time the footer enters the viewport (the observer below toggles
              is-visible both ways). */}
          <div className="gld-ft__grid gld-stagger">
            <div className="reveal">
              {footerLogoUrl
                ? <img className="gld-ft__logo" src={footerLogoUrl} alt={clubName}
                       onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : null}
              <h4>{clubName}</h4>
              {/* Logo and club name only. Phone and email are in the header's
                  contact strip, at the top of every page — repeating them under
                  the logo was the same pair twice on one screen. */}
              {/* Visitor count closes this column, under the logo — look comes
                  from .rv-vc (Anton figures on the gold hairline). */}
              <div style={{ marginTop: '18px' }}>
                <VisitorCount />
              </div>
            </div>

            {/* Spans two of the four grid tracks, and its list runs in two
                columns inside them — one heading, four columns of footer. */}
            <div className="gld-ft__quick reveal">
              <h4>Quick links</h4>
              <ul className="gld-ft__links" dangerouslySetInnerHTML={{ __html: renderQuickLinks(menus) }} />
            </div>

            {/* Socials only. Admin login lives in the header and in the hero —
                a third copy down here was the fourth on the page. */}
            <div className="reveal">
              <h4>Find us</h4>
              <div className="gld-ft__soc" dangerouslySetInnerHTML={{ __html: renderSocials(about) }} />
            </div>
          </div>

          <div className="gld-ft__bar">
            <span>© {new Date().getFullYear()} {clubName}. All rights reserved.</span>
            <span>Powered by <a href="https://rosteronwheels.com/" target="_blank" rel="noopener noreferrer"
                                className="gld-ft__row">Roster On Wheels</a></span>
          </div>
        </div>
      </footer>

      <button type="button" aria-label="Back to top"
              className={'gld-top' + (atTop ? '' : ' is-on')}
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
    </>
  )
}
