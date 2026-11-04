'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Port of SiteVerdigrisLedger.Master + SiteVerdigrisLedger.Master.cs.
//
// The Verdigris Ledger (theme 3) master: peacock-teal top strip, solid
// sea-paper header with mono editorial nav, and a peacock colophon footer.
// Data comes from RotaryMasterBase (ported to shared/menus.js + useClub); only
// the ledger markup emission lives here. Same [data-year-select]/[data-nav-*]
// hooks as the other themes, so the shared rotary-anim.js drives the year
// select and mobile drawer.
//
// <html>/<head>/<body>/<form runat="server"> are gone — index.html owns the
// document and ThemeProvider sets <html data-theme> and loads this theme's
// stylesheets (fonts.css / theme.css / ledger.css). The master's inline <style>
// block is still emitted here, verbatim.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { mediaUrl } from '@/site/media.js'
import {
  useMenus, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER,
} from '@/site/menus.js'
import { enc } from '@/themes/shared/Breadcrumb.jsx'
import { routeKey } from '@/site/routes.js'
import YearSelect from '@/site/YearSelect.jsx'
import VisitorCount from '@/themes/shared/visitorCount.jsx'
import { useThemeShell, useRouteEnter, useLoader } from '@/themes/shared/useRotaryAnim.js'

// ── The master's inline <style> block ───────────────────────────────────────
const SHELL_CSS = `
        #rotary-loader{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#F0ECF5;color:#3A0E3C;transition:opacity .5s ease,visibility .5s ease}
        #rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
        #rotary-loader img{width:60px;height:60px}
        .rotary-lightbox{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;background:rgba(30,10,44,.95);backdrop-filter:blur(4px)}
        .rotary-lightbox img{max-width:92vw;max-height:88vh;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
        .rotary-lightbox__close{position:absolute;top:18px;right:24px;font-size:40px;line-height:1;color:#fff;background:none;border:0;cursor:pointer}
`

// ── Icon builders (SiteVerdigrisLedger.Master.cs) ───────────────────────────
function vlStripIcon(path) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
}

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

// ── Active-link matching ────────────────────────────────────────────────────
function currentPageFile(pathname) {
  return routeKey(pathname)
}

function isActiveHref(href, currentFile) {
  if (!href || !String(href).trim() || /^http/i.test(String(href))) return false
  return routeKey(href) === currentFile
}

// CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.Trim().ToLowerInvariant()) —
// first letter of every word, apostrophes NOT treated as word breaks ("O'brien").
function titleCase(s) {
  if (!s || !String(s).trim()) return s
  return String(s).trim().toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (m, a, b) => a + b.toUpperCase())
}

// ── Top-strip contact chips (the master's INLINE <script runat="server">) ───
// The club's phone + email from /about. Supersedes the code-behind's
// RenderStripContacts(), which fell back to a "Service Above Self" motto when a
// club had no contact rows — the user wants the strip to carry the email and
// mobile, and NOTHING when the API has neither (same rule the footer now
// follows).
// NOTE: a club with no contact row in the dashboard's About/Contact tab renders an
// empty left half here — that is missing DATA, not a broken strip.
function vlStripContacts(about) {
  let email = null, phone = null
  const contacts = about ? about.contacts : null
  if (contacts) {
    for (const c of contacts) {
      if (email === null && c.email && c.email.trim()) email = c.email.trim()
      if (phone === null && c.phone && c.phone.trim()) phone = c.phone.trim()
    }
  }

  const icoPhone = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'
  const icoMail = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>'

  let sb = ''
  if (phone !== null) {
    sb += '<a class="vl-strip__c" href="tel:' + enc(phone.replace(/\s/g, '')) +
      '"><span class="vl-strip__ci">' + vlStripIcon(icoPhone) +
      '</span><span class="vl-strip__cv">' + enc(phone) + '</span></a>'
  }
  if (email !== null) {
    sb += '<a class="vl-strip__c" href="mailto:' + enc(email) +
      '"><span class="vl-strip__ci">' + vlStripIcon(icoMail) +
      '</span><span class="vl-strip__cv">' + enc(email) + '</span></a>'
  }
  return sb
}

// Rows for the footer's two-column quick-link grid. renderFooterQuickLinks skips
// blank names, so count the same way it does, then halve (rounding up) — with
// grid-auto-flow:column that yields EXACTLY two columns for any list length.
function footerQuickLinkRows(menus) {
  let n = 0
  for (const m of menus) if (m.menuName && m.menuName.trim()) n++
  return n < 2 ? 1 : Math.floor((n + 1) / 2)
}

// ── Nav / footer markup (SiteVerdigrisLedger.Master.cs) ─────────────────────
/** Desktop nav: mono ledger links with a marigold slide-in underline;
 *  the current page's link stays lit. */
function renderDesktopNav(menus, current) {
  let sb = ''
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    const active = isActiveHref(hrefRaw, current)
      || subs.some((s) => isActiveHref(menuHref(s.linkType, s.linkValue), current))
    const cls = active ? 'ledger-nav-link ledger-nav-link--active' : 'ledger-nav-link'
    if (subs.length === 0) {
      sb += '<a href="' + href + '"' + ext + ' class="' + cls + '">' + label + '</a>'
    } else {
      sb += '<div class="group relative"><a href="' + href + '"' + ext +
        ' class="' + cls + ' flex items-center gap-1">' + label +
        '<svg class="h-3 w-3 transition-transform group-hover:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>'
      sb += '<div class="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100"><div class="w-60 rounded-sm border border-navy/10 bg-white p-2 shadow-xl shadow-navy/10">'
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        sb += '<a href="' + shref + '"' + sext +
          ' class="block rounded-sm px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.04em] text-ink/70 transition-colors hover:bg-gold/10 hover:text-navy">' +
          enc(s.subMenuName || '') + '</a>'
      }
      sb += '</div></div></div>'
    }
  }
  return sb
}

/** Mobile drawer nav (same data hooks; ledger tint). */
function renderMobileNav(menus, current) {
  let sb = ''
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      const tint = isActiveHref(hrefRaw, current) ? 'bg-gold/10 text-navy' : 'text-ink/80'
      sb += '<a href="' + href + '"' + ext +
        ' data-nav-close class="rounded-sm px-4 py-3 font-mono text-[13px] uppercase tracking-[0.04em] transition-colors hover:bg-gold/10 hover:text-navy ' + tint + '">' +
        label + '</a>'
    } else {
      sb += '<div><button type="button" data-nav-accordion class="flex w-full items-center justify-between rounded-sm px-4 py-3 font-mono text-[13px] uppercase tracking-[0.04em] text-ink/80 transition-colors hover:bg-gold/10 hover:text-navy">' +
        label +
        '<svg data-nav-chevron class="h-4 w-4 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
      sb += '<div data-nav-accordion-panel class="max-h-0 overflow-hidden transition-[max-height] duration-300"><div class="flex flex-col py-1 pl-3">'
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        sb += '<a href="' + shref + '"' + sext +
          ' data-nav-close class="rounded-sm px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.04em] text-ink/70 hover:bg-gold/10 hover:text-navy">' +
          enc(s.subMenuName || '') + '</a>'
      }
      sb += '</div></div></div>'
    }
  }
  return sb
}

/** Footer quick links — mono register rows with a chevron bullet. */
function renderFooterQuickLinks(menus) {
  let sb = ''
  for (const m of menus) {
    if (!m.menuName || !m.menuName.trim()) continue
    const href = enc(menuHref(m.linkType, m.linkValue))
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    sb += '<li><a href="' + href + '"' + ext +
      ' class="group inline-flex items-center gap-2 font-mono text-[13px] text-white/75 transition-colors hover:text-gold-light">' +
      '<svg class="h-3 w-3 shrink-0 text-gold-light/70 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      enc(titleCase(m.menuName)) + '</a></li>'
  }
  return sb
}

/** Footer social rows — renders nothing when the club has none (2026-07-20). */
function renderFooterSocials(about) {
  const socials = ((about ? about.socials : null) || [])
    .filter((s) => s && s.linkUrl && s.linkUrl.trim())

  if (socials.length === 0) return ''

  let sb = ''
  for (const s of socials) {
    let url = s.linkUrl.trim()
    if (!/^http/i.test(url)) url = 'https://' + url
    const key = (s.platform || '').trim().toLowerCase()
    const label = enc(socialLabel(key))
    sb += '<li><a href="' + enc(url) +
      '" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-3 font-mono text-[13px] text-white/80 transition-colors hover:text-gold-light">' +
      '<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-white/10 text-white ring-1 ring-white/15 transition-colors group-hover:bg-gold group-hover:text-white">' +
      socialIcon(key, 'h-4 w-4') + '</span>' +
      '<span>' + label + '</span></a></li>'
  }
  return sb
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SiteVerdigrisLedger({ children }) {
  const adminLoginUrl = useClub().adminLoginUrl
  const { clubId, selectedYearId, clubDisplayName, loading: clubLoading } = useClub()
  const location = useLocation()
  const menus = useMenus()

  // RotaryMasterBase.About — /about for the selected year, fetched once per view.
  // Feeds the logo getters, the top-strip contacts and the footer socials.
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = useClub().about

  // RotaryMasterBase logo chain: header = uploaded Rotary logo, else the bundled
  // wheel; footer = club logo, else Rotary logo, else "" (block hidden).
  const clubLogoUrl = mediaUrl(about ? about.clubLogoPath : null)
  const rotaryLogoUrl = mediaUrl(about ? about.rotaryLogoPath : null)
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl

  // RotaryMasterBase.OnLoad — the tab title defaults to the club name. A page
  // that calls usePageTitle (every <Breadcrumb>) has already claimed it by the
  // time this parent effect runs, so only take the untouched default.
  useEffect(() => {
    if (!document.title || document.title === 'Rotary Club') document.title = clubDisplayName
  }, [clubDisplayName])

  const current = currentPageFile(location.pathname)
  const socialsHtml = renderFooterSocials(about)

  // Loads this theme's scripts (rotary-anim.js, ledger.js) and runs the one-time
  // shell initialisers once the nav markup exists.
  const mainRef = useRef(null)
  useThemeShell('verdigris-ledger', menus.length > 0)
  useRouteEnter(mainRef)
  // The loader covers the wait, as it did when the server rendered the whole page.
  useLoader(!clubLoading)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      {/* Page loader */}
      <div id="rotary-loader" aria-hidden="true">
        <img src="images/logo/wheel.png" alt="" className="wheel-spin" />
        <span className="px-6 text-center font-heading text-lg font-extrabold tracking-wide text-navy">{clubDisplayName}</span>
      </div>

      {/* ══ Top strip: peacock ledger bar (mono contacts · year · admin) ══ */}
      <div className="hidden bg-navy-deep text-white/85 sm:block">
        <div className="container-x vl-strip">
          {/* Contact chips (phone + email). Empty when the club has no contact row. */}
          <div className="vl-strip__left" dangerouslySetInnerHTML={{ __html: vlStripContacts(about) }} />
          <div className="vl-strip__right">
            <label className="vl-strip__year">
              <span className="vl-strip__year-lb">Rotary Year</span>
              <span className="vl-strip__year-field">
                <YearSelect />
                <svg className="vl-strip__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </label>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" className="vl-strip__admin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              <span>Admin Login</span>
            </a>
          </div>
        </div>
      </div>

      {/* ══ Header: solid sea-paper bar with a mono ledger eyebrow + editorial nav ══ */}
      <header className="sticky top-0 z-50 bg-canvas/95 backdrop-blur">
        <div className="container-x flex h-[72px] items-center justify-between gap-3">
          <a href="/" className="group flex shrink-0 items-center gap-3" aria-label={clubDisplayName + ' — Home'}>
            <img src={headerLogoUrl} alt={clubDisplayName} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }} className="h-11 w-auto max-w-[160px] shrink-0 object-contain md:h-12" />
          </a>

          {/* Nav switches at lg (1024) not xl (1280) so SMALL LAPTOPS and landscape
              tablets get the real nav bar instead of a hamburger. All four nav pieces
              (this nav, the toggle, the backdrop and the drawer) MUST use the same
              breakpoint — mixing them leaves either two menus or none.
              At 1024-1279 the links are tightened by a bespoke rule in ledger.css so
              the row still fits on ONE line; `flex-wrap` remains the safety net for
              clubs whose menu is longer than Gurgaon's nine items. */}
          <nav
            className="hidden min-w-0 flex-1 flex-wrap content-center items-center justify-end gap-x-1 gap-y-1 lg:flex"
            dangerouslySetInnerHTML={{ __html: renderDesktopNav(menus, current) }}
          />

          <button type="button" data-nav-toggle className="flex h-10 w-10 items-center justify-center rounded-sm text-navy transition-colors hover:bg-navy/5 lg:hidden" aria-label="Toggle menu">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gold-light/70 to-transparent" aria-hidden="true"></div>
      </header>

      {/* Mobile drawer + backdrop (outside <header> so backdrop-blur doesn't trap fixed children) */}
      <div data-nav-backdrop className="pointer-events-none fixed inset-0 z-[55] bg-navy/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 lg:hidden"></div>
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden lg:hidden">
        <div data-nav-drawer className="pointer-events-auto absolute right-0 top-0 flex h-full w-[86%] max-w-sm translate-x-full flex-col bg-canvas shadow-2xl transition-transform duration-300 ease-out">
          <div className="flex shrink-0 items-center justify-between border-b border-navy/10 px-5 py-4">
            <img src={headerLogoUrl} alt={clubDisplayName} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }} className="h-10 w-auto shrink-0" />
            <button type="button" data-nav-close className="flex h-10 w-10 items-center justify-center rounded-sm text-navy transition-colors hover:bg-navy/5" aria-label="Close menu">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <nav
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
            dangerouslySetInnerHTML={{ __html: renderMobileNav(menus, current) }}
          />
          <div className="shrink-0 space-y-3 border-t border-navy/10 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-navy">Rotary Year</span>
              <YearSelect className="h-10 cursor-pointer appearance-none rounded-sm border border-navy/20 bg-white pl-3 pr-8 font-mono text-sm font-semibold text-navy shadow-sm" />
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-nav-close className="btn-navy w-full !rounded-sm font-mono">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> ADMIN LOGIN
            </a>
          </div>
        </div>
      </div>

      {/* ══ Page content ══ */}
      <main ref={mainRef} className="route-enter">
        {children}
      </main>

      {/* ══ Footer: peacock colophon ══ */}
      <footer className="bg-navy-deep text-white">
        <div className="container-x vl-foot-grid grid gap-10 py-14 md:grid-cols-[minmax(220px,1fr)_2fr]">
          <div>
            {/* Logo only: the club name and "Service Above Self" were dropped by
                request (both already sit in the copyright line / top strip), and
                the mark runs large enough to stand on its own. */}
            <div className="inline-flex flex-col rounded-sm border border-white/15 bg-navy px-6 py-5">
              <img src={footerLogoUrl || headerLogoUrl} alt={clubDisplayName + ' logo'} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.parentNode.style.display = 'none' }} className="vl-foot-logo" />
            </div>
            {/* Visitor count, under the footer logo. It is drawn as a ledger
                FOOTING (marigold cap rule) by the .rv-vc theme block. */}
            <div style={{ marginTop: '18px' }}>
              <VisitorCount />
            </div>
          </div>
          <div className="vl-foot-cols grid gap-8 sm:grid-cols-2">
            <div>
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Quick Links</h4>
              {/* Two columns, filled top-down: the inline row count is ceil(n/2),
                  so 10 links read 5 + 5 and an odd list splits 5 + 4 rather than
                  spilling into a third column. */}
              <ul
                className="vl-foot-links mt-4"
                style={{ gridTemplateRows: 'repeat(' + footerQuickLinkRows(menus) + ',auto)' }}
                dangerouslySetInnerHTML={{ __html: renderFooterQuickLinks(menus) }}
              />
            </div>
            {/* Socials are optional per club; with none, the whole block goes —
                a bare "Connect" heading over empty space looked broken. */}
            {socialsHtml && (
              <div>
                <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Connect</h4>
                <ul className="mt-4 flex flex-col gap-2.5" dangerouslySetInnerHTML={{ __html: socialsHtml }} />
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-white/10">
          {/* vl-foot-colophon replaces the Tailwind font-mono/text-[11px]/tracking utilities:
              this line is a sentence, and IBM Plex Mono made it read as terminal output. */}
          <div className="container-x vl-foot-colophon flex flex-wrap items-center justify-between gap-2 py-5 text-white/55">
            <span>&copy; {new Date().getFullYear()} · {clubDisplayName}</span>
            <span>Powered by Roster On Wheels</span>
          </div>
        </div>
      </footer>
    </>
  )
}
