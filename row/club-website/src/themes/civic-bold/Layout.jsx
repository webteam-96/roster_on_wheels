'use client'
// Port of SiteCivicBold.Master + SiteCivicBold.Master.cs.
//
// Civic Bold (theme 4) master: near-black ground, monospace uppercase nav with
// a hi-vis lime underline, hairline dividers, oversized grotesque footer wordmark.
// Data comes from shared/menus.js (the ported RotaryMasterBase); only civic
// markup emission lives here. Like the warm master, the header deliberately
// carries NO [data-nav]/[data-nav-pill] scroll hooks (the drawer hooks —
// data-nav-toggle/drawer/backdrop/close — are fine).
//
// The Render* helpers below build HTML STRINGS exactly as the C# StringBuilder
// versions do, and are injected with dangerouslySetInnerHTML — that keeps the
// emitted markup byte-identical instead of re-deriving it in JSX. The internal
// <a href="/about"> links inside still route through the SPA: App.jsx
// installs a global anchor click-interceptor.
import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { mediaUrl } from '@/site/media.js'
import { useMenus, menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER } from '@/site/menus.js'
import { routeKey } from '@/site/routes.js'
import { enc } from '@/themes/shared/Breadcrumb.jsx'
import YearSelect from '@/site/YearSelect.jsx'
import VisitorCount from '@/themes/shared/visitorCount.jsx'
import { useThemeShell, useRouteEnter, useLoader } from '@/themes/shared/useRotaryAnim.js'

// ── Shell-only styles not produced by Tailwind (loader, lightbox) ───────────
// The master carries these inline in <head>; index.html owns the document here,
// so they are emitted once from inside the layout instead.
const SHELL_CSS = `
        #rotary-loader{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:rgb(var(--c-canvas, 244 246 245));color:rgb(var(--c-gold, 92 138 12));transition:opacity .5s ease,visibility .5s ease}
        #rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
        #rotary-loader img{width:60px;height:60px}
        .rotary-lightbox{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.95);backdrop-filter:blur(4px)}
        .rotary-lightbox img{max-width:92vw;max-height:88vh;border-radius:2px;box-shadow:0 20px 60px rgba(0,0,0,.7)}
        .rotary-lightbox__close{position:absolute;top:18px;right:24px;font-size:40px;line-height:1;color:#fff;background:none;border:0;cursor:pointer}
`

// ── Icons ───────────────────────────────────────────────────────────────────
const ICO_MAIL = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>'
const ICO_PHONE = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'

function stripIcon(path) {
  return '<svg class="h-3.5 w-3.5 shrink-0 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
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
// CurrentPageFile(): the C# reads HttpContext.Current.Request.Url; here the
// router's pathname is the same value.
function currentPageFile(pathname) {
  return routeKey(pathname)
}

function isActiveHref(href, currentFile) {
  if (!href || !String(href).trim() || /^http/i.test(String(href))) return false
  return routeKey(href) === currentFile
}

/**
 * Top-strip contact links (phone + email), each shown only when the club's
 * /about actually provides it.
 */
function renderStripContacts(about) {
  const contacts = (about ? about.contacts : null) || []
  // (null-row guard added on top of the C#: a null element there throws an NRE
  // and 500s the request; here it would white-screen the whole shell.)
  const email = contacts.map((c) => (c ? c.email : null)).find((e) => e && String(e).trim())
  const phone = contacts.map((c) => (c ? c.phone : null)).find((p) => p && String(p).trim())

  let sb = ''
  if (phone && String(phone).trim()) {
    sb += '<a href="tel:' + enc(String(phone).trim().replace(/\s/g, '')) +
      '" class="inline-flex min-w-0 items-center gap-2 text-muted transition-colors hover:text-gold">' +
      stripIcon(ICO_PHONE) + '<span class="truncate">' + enc(String(phone).trim()) + '</span></a>'
  }
  if (email && String(email).trim()) {
    sb += '<a href="mailto:' + enc(String(email).trim()) +
      '" class="hidden min-w-0 items-center gap-2 text-muted transition-colors hover:text-gold md:inline-flex">' +
      stripIcon(ICO_MAIL) + '<span class="truncate">' + enc(String(email).trim()) + '</span></a>'
  }
  return sb
}

/**
 * Desktop nav: mono uppercase links with a lime underline draw
 * (.civic-nav-link); the current page's link stays lit.
 */
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
    const cls = active ? 'civic-nav-link civic-nav-link--active' : 'civic-nav-link'
    if (subs.length === 0) {
      sb += '<a href="' + href + '"' + ext + ' class="' + cls + '">' + label + '</a>'
    } else {
      sb += '<div class="group relative"><a href="' + href + '"' + ext +
        ' class="' + cls + ' flex items-center gap-1">' + label +
        '<svg class="h-3.5 w-3.5 transition-transform group-hover:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>'
      sb += '<div class="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100"><div class="w-60 border border-navy/10 bg-navy p-2 shadow-xl">'
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        sb += '<a href="' + shref + '"' + sext +
          ' class="block px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-muted transition-colors hover:text-gold">' +
          enc(s.subMenuName || '') + '</a>'
      }
      sb += '</div></div></div>'
    }
  }
  return sb
}

/**
 * Mobile drawer nav (same data hooks as the other themes; mono rows, lime
 * active tint).
 */
function renderMobileNav(menus, current) {
  let sb = ''
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      const tint = isActiveHref(hrefRaw, current) ? 'text-gold' : 'text-muted'
      sb += '<a href="' + href + '"' + ext +
        ' data-nav-close class="border-b border-navy/10 px-1 py-3 font-mono text-[13px] uppercase tracking-[0.1em] transition-colors hover:text-gold ' + tint + '">' +
        label + '</a>'
    } else {
      sb += '<div><button type="button" data-nav-accordion class="flex w-full items-center justify-between border-b border-navy/10 px-1 py-3 font-mono text-[13px] uppercase tracking-[0.1em] text-muted transition-colors hover:text-gold">' +
        label +
        '<svg data-nav-chevron class="h-4 w-4 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
      sb += '<div data-nav-accordion-panel class="max-h-0 overflow-hidden transition-[max-height] duration-300"><div class="flex flex-col py-1 pl-3">'
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        sb += '<a href="' + shref + '"' + sext +
          ' data-nav-close class="px-2 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-muted transition-colors hover:text-gold">' +
          enc(s.subMenuName || '') + '</a>'
      }
      sb += '</div></div></div>'
    }
  }
  return sb
}

// CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.Trim().ToLowerInvariant())
function titleCase(s) {
  if (!s || !String(s).trim()) return s
  return String(s).trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** Footer quick links (two-column, mono, lime hover, arrow bullets). */
function renderFooterQuickLinks(menus) {
  let sb = ''
  for (const m of menus) {
    if (!m.menuName || !String(m.menuName).trim()) continue
    const href = enc(menuHref(m.linkType, m.linkValue))
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    sb += '<li><a href="' + href + '"' + ext +
      ' class="group inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-gold">' +
      '<svg class="h-3.5 w-3.5 shrink-0 text-gold/70 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      enc(titleCase(m.menuName)) + '</a></li>'
  }
  return sb
}

/** Footer social links (hairline square + lime hover). */
function renderFooterSocials(about) {
  const socials = (((about ? about.socials : null) || [])
    .filter((s) => s && s.linkUrl && String(s.linkUrl).trim()))

  // Nothing at all when the API has no socials — deliberately NO "No data found"
  // card in the footer (page-level EmptyState is untouched).
  if (socials.length === 0) return ''

  let sb = ''
  for (const s of socials) {
    let url = String(s.linkUrl).trim()
    if (!/^http/i.test(url)) url = 'https://' + url
    const key = String(s.platform || '').trim().toLowerCase()
    const label = enc(socialLabel(key))
    sb += '<li><a href="' + enc(url) +
      '" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-3 text-sm font-semibold text-muted transition-colors hover:text-gold">' +
      '<span class="flex h-9 w-9 shrink-0 items-center justify-center border border-navy/20 text-ink transition-colors group-hover:border-gold group-hover:text-gold">' +
      socialIcon(key, 'h-4 w-4') + '</span>' +
      '<span>' + label + '</span></a></li>'
  }
  return sb
}

export default function SiteCivicBold({ children }) {
  const adminLoginUrl = useClub().adminLoginUrl
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = useClub().about

  // RotaryMasterBase.About — /about for the selected year, fetched once per view.

  // On-load entrance: the master adds .civic-preload synchronously (before first
  // paint) so the header's start-states apply with no flash. Skipped for
  // reduced-motion, so content is always visible either way. rotary-anim.js's
  // initOnLoad (run from shell() below) then adds .civic-loaded to play the
  // sequence. NEVER removed on unmount: shell() is one-shot, so a re-added
  // .civic-preload without a matching .civic-loaded would hide the header for good.
  useLayoutEffect(() => {
    try {
      if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.documentElement.classList.add('civic-preload')
      }
    } catch (e) { /* no-op */ }
  }, [])

  // Light/dark toggle — flips data-civic-mode on <html> and remembers it.
  // (The pre-paint read of localStorage lives in ThemeProvider, which is where
  // the master's <head> script lands in this port.)
  useEffect(() => {
    const toggles = document.querySelectorAll('[data-mode-toggle]')
    const onClick = () => {
      const cur = document.documentElement.getAttribute('data-civic-mode') === 'dark' ? 'dark' : 'light'
      const next = cur === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-civic-mode', next)
      try { localStorage.setItem('civicMode', next) } catch (e) { /* private mode */ }
    }
    toggles.forEach((t) => t.addEventListener('click', onClick))
    return () => toggles.forEach((t) => t.removeEventListener('click', onClick))
  }, [])

  const clubName = club.clubDisplayName

  // Logo chain, verbatim from RotaryMasterBase:
  //   RotaryLogoUrl — the club's uploaded Rotary/header logo; "" until /about returns it
  //   ClubLogoUrl   — the club's own logo (no placeholder)
  //   HeaderLogoUrl — uploaded Rotary logo when present, else the bundled wheel
  //   FooterLogoUrl — club logo, else Rotary logo, else "" (block hidden)
  const rotaryLogoUrl = mediaUrl(about ? about.rotaryLogoPath : null)
  const clubLogoUrl = mediaUrl(about ? about.clubLogoPath : null)
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl

  const current = currentPageFile(location.pathname)

  // Loads this theme's scripts, then runs the one-time shell initialisers
  // (initNav / initLoader / initYearPicker / initScrollProgress / initClickSpark
  // / initOnLoad) once the nav markup exists.
  const mainRef = useRef(null)
  useThemeShell('civic-bold', menus.length > 0)
  useRouteEnter(mainRef)
  // The loader covers the wait, as it did when the server rendered the whole page.
  useLoader(!club.loading)

  return (
    <>
      {/* Shell-only styles not produced by Tailwind (loader, lightbox) */}
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      {/* Reading-progress hairline */}
      <div id="cv-progress" aria-hidden="true"><span></span></div>

      {/* Page loader */}
      <div id="rotary-loader" aria-hidden="true">
        <img src="images/logo/wheel.png" alt="" className="wheel-spin" />
        <span className="px-6 text-center font-heading text-lg font-extrabold uppercase tracking-wide text-ink">{clubName}</span>
      </div>

      {/* ══ Top utility strip (near-black, hairline) ══ */}
      <div className="hidden border-b border-navy/10 bg-canvas sm:block" data-onload="down" style={{ '--od': '.04s' }}>
        <div className="container-x flex h-11 items-center justify-between gap-4">
          <div
            className="flex min-w-0 items-center gap-5 font-mono text-[11px] uppercase tracking-[0.1em]"
            dangerouslySetInnerHTML={{ __html: renderStripContacts(about) }}
          />
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" data-mode-toggle aria-label="Toggle light or dark mode" title="Toggle light / dark" className="flex h-8 w-8 items-center justify-center border border-navy/20 text-ink transition-colors hover:border-gold hover:text-gold">
              <svg data-mode-moon className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>
              <svg data-mode-sun className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>
            </button>
            <div className="cv-yearsel">
              <span className="cv-yearsel__ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              </span>
              <YearSelect className="cv-yearsel__native" />
              <svg className="cv-yearsel__chev" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" className="civic-btn-accent inline-flex h-8 items-center gap-1.5 px-3 text-[11px]">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Admin Login
            </a>
          </div>
        </div>
      </div>

      {/* ══ Header (solid near-black bar; NO data-nav/pill scroll hooks) ══ */}
      <header className="sticky top-0 z-50 border-b border-navy/10 bg-canvas/90 backdrop-blur">
        <div className="container-x flex h-[68px] items-center justify-between gap-3">
          <a href="/" className="group flex shrink-0 items-center gap-3" aria-label={clubName + ' — Home'} data-onload="left" style={{ '--od': '.22s' }}>
            <img
              src={headerLogoUrl}
              alt={clubName}
              onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }}
              className="h-11 w-auto max-w-[170px] shrink-0 object-contain md:h-12"
            />
          </a>

          <nav
            className="hidden min-w-0 flex-1 flex-wrap content-center items-center justify-end gap-x-1.5 gap-y-1 xl:flex"
            dangerouslySetInnerHTML={{ __html: renderDesktopNav(menus, current) }}
          />

          <button type="button" data-nav-toggle className="flex h-10 w-10 items-center justify-center border border-navy/20 text-ink transition-colors hover:border-gold hover:text-gold xl:hidden" aria-label="Toggle menu" data-onload="down" style={{ '--od': '.28s' }}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        {/* Lime hi-vis hairline */}
        <div className="h-px bg-gradient-to-r from-transparent via-gold to-transparent" aria-hidden="true" data-onload="line" style={{ '--od': '.42s' }}></div>
      </header>

      {/* Mobile drawer + backdrop (outside <header>) */}
      <div data-nav-backdrop className="pointer-events-none fixed inset-0 z-[55] bg-black/60 opacity-0 backdrop-blur-sm transition-opacity duration-300 xl:hidden"></div>
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden xl:hidden">
        <div data-nav-drawer className="pointer-events-auto absolute right-0 top-0 flex h-full w-[86%] max-w-sm translate-x-full flex-col border-l border-navy/10 bg-navy shadow-2xl transition-transform duration-300 ease-out">
          <div className="flex shrink-0 items-center justify-between border-b border-navy/10 px-5 py-4">
            <img
              src={headerLogoUrl}
              alt={clubName}
              onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }}
              className="h-10 w-auto shrink-0"
            />
            <button type="button" data-nav-close className="flex h-10 w-10 items-center justify-center border border-navy/20 text-ink transition-colors hover:border-gold hover:text-gold" aria-label="Close menu">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <nav
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
            dangerouslySetInnerHTML={{ __html: renderMobileNav(menus, current) }}
          />
          <div className="shrink-0 space-y-3 border-t border-navy/10 p-4">
            <button type="button" data-mode-toggle aria-label="Toggle light or dark mode" className="flex h-10 w-full items-center justify-center gap-2 border border-navy/20 font-mono text-[12px] uppercase tracking-[0.12em] text-ink transition-colors hover:border-gold hover:text-gold">
              <svg data-mode-moon className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>
              <svg data-mode-sun className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>
              <span data-mode-moon>Dark mode</span><span data-mode-sun>Light mode</span>
            </button>
            <div className="cv-yearsel cv-yearsel--block">
              <span className="cv-yearsel__ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              </span>
              <YearSelect className="cv-yearsel__native" />
              <svg className="cv-yearsel__chev" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-nav-close className="civic-btn-accent w-full justify-center">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Admin Login
            </a>
          </div>
        </div>
      </div>

      {/* ══ Page content ══ */}
      <main ref={mainRef} className="route-enter">
        {children}
      </main>

      {/* ══ Footer ══ */}
      <footer className="border-t border-navy/10 bg-canvas">
        {/* Giant wordmark band */}
        <div className="container-x border-b border-navy/10 py-8 md:py-10">
          <p className="cv-wordmark font-heading text-3xl font-extrabold uppercase leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl"><span data-split data-split-stagger="0.04">{clubName}</span><span className="text-gold">.</span></p>
          <p className="civic-eyebrow mt-3">Service Above Self &middot; {clubName}</p>
        </div>
        {/* Columns */}
        <div className="container-x grid gap-8 py-10 md:grid-cols-3">
          <div>
            <div className="mb-4 inline-flex items-center border border-navy/10 bg-navy px-4 py-2.5">
              {/* Footer logo pinned to exactly 95px (2026-07-29, by request).
                  Deliberately an INLINE height, not a Tailwind class: the civic-bold CSS
                  is precompiled and contains no h-[95px] (nor any arbitrary h-[..px]),
                  so `class="h-[95px]"` would silently collapse the image to its natural
                  size. The nearest compiled class, h-24, is 96px - not the value asked
                  for. max-width keeps a wide logo from pushing out of the navy plate;
                  w-auto + object-contain preserve the aspect ratio. */}
              <img
                src={footerLogoUrl || headerLogoUrl}
                alt={clubName + ' logo'}
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.parentNode.style.display = 'none' }}
                className="w-auto max-w-full object-contain"
                style={{ height: '95px' }}
              />
            </div>
            {/* Visitor count, under the footer logo. The wrapper matters: the
                logo plate above is inline-flex, so an inline-level counter would
                flow onto the same line and sit ON the logo. */}
            <div style={{ marginTop: '18px' }}>
              <VisitorCount />
            </div>
          </div>
          <div>
            <h3 className="civic-eyebrow">Quick Links</h3>
            <ul
              className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2"
              dangerouslySetInnerHTML={{ __html: renderFooterQuickLinks(menus) }}
            />
          </div>
          <div>
            <h3 className="civic-eyebrow">Connect</h3>
            <ul
              className="mt-4 flex flex-col gap-2.5"
              dangerouslySetInnerHTML={{ __html: renderFooterSocials(about) }}
            />
          </div>
        </div>
        {/* Copyright strip */}
        <div className="border-t border-navy/10 py-5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Powered by Roster On Wheels {new Date().getFullYear()} &middot; All Rights Reserved
        </div>
      </footer>
    </>
  )
}
