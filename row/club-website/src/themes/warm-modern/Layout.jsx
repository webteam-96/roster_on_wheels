'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Port of SiteWarmModern.Master + SiteWarmModern.Master.cs.
//
// warm-modern (theme 2) master: terracotta top strip, solid white header, coral
// accents, three-tier footer. Data comes from RotaryMasterBase (ported to
// shared/menus.js + useClub); only warm markup emission lives here. IMPORTANT:
// the header deliberately has no [data-nav]/[data-nav-pill] hooks —
// rotary-anim.js's scroll handler would force pt-2/pt-4 + h-16/h-20 toggles that
// fight the solid bar.
//
// The Render* helpers below build HTML STRINGS exactly as the C# StringBuilders
// do, and are injected with dangerouslySetInnerHTML so the markup is identical.
// Internal <a href="/"> links inside still route through the SPA:
// App.jsx installs a global anchor click-interceptor.
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

// Shell-only styles not produced by Tailwind (loader, lightbox) — the master
// carries them inline in <head>.
const SHELL_CSS = `
        #rotary-loader{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#FAF7F2;color:#7C2D12;transition:opacity .5s ease,visibility .5s ease}
        #rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
        #rotary-loader img{width:64px;height:64px}
        .rotary-lightbox{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.95);backdrop-filter:blur(4px)}
        .rotary-lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
        .rotary-lightbox__close{position:absolute;top:18px;right:24px;font-size:40px;line-height:1;color:#fff;background:none;border:0;cursor:pointer}
`

// ── Icons ────────────────────────────────────────────────────────────────────
const ICO_MAIL = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>'
const ICO_PHONE = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'

function stripIcon(path) {
  return '<svg class="h-4 w-4 shrink-0 text-gold-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
}

// currentColor icon (no fixed style color — unlike theme 1's footer icons).
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

// ── Active-page detection ────────────────────────────────────────────────────
/** Lower-case file name of the page being served ("" and default.aspx normalise
 *  to home.aspx so the Home link lights up). */
function currentPageFile(pathname) {
  return routeKey(pathname)
}

/** True when a menu href points at the page being served. */
function isActiveHref(href, currentFile) {
  if (!href || !String(href).trim() || /^http/i.test(String(href))) return false
  return routeKey(href) === currentFile
}

// ── Render* helpers (ports of the C# StringBuilders) ─────────────────────────
/** Top-strip contact links: the club's phone + email from /about, each shown
 *  only when available (the strip simply shows less when the data is missing —
 *  no placeholders up there). */
function renderStripContacts(about) {
  const contacts = (about ? about.contacts : null) || []
  const email = contacts.map((c) => c.email).find((e) => e && String(e).trim())
  const phone = contacts.map((c) => c.phone).find((p) => p && String(p).trim())

  let sb = ''
  if (phone && String(phone).trim()) {
    sb += '<a href="tel:' + enc(String(phone).trim().replace(/\s/g, '')) +
      '" class="inline-flex min-w-0 items-center gap-2 text-sm font-semibold transition-colors hover:text-gold-light">' +
      stripIcon(ICO_PHONE) + '<span class="truncate">' + enc(String(phone).trim()) + '</span></a>'
  }
  if (email && String(email).trim()) {
    sb += '<a href="mailto:' + enc(String(email).trim()) +
      '" class="hidden min-w-0 items-center gap-2 text-sm font-semibold transition-colors hover:text-gold-light md:inline-flex">' +
      stripIcon(ICO_MAIL) + '<span class="truncate">' + enc(String(email).trim()) + '</span></a>'
  }
  return sb
}

/** Desktop nav: coral slide-in underline links (.warm-nav-link); the current
 *  page's link stays lit (warm-nav-link--active). */
function renderDesktopNav(menus, current) {
  const parts = []
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    const active = isActiveHref(hrefRaw, current)
      || subs.some((s) => isActiveHref(menuHref(s.linkType, s.linkValue), current))
    const cls = active ? 'warm-nav-link warm-nav-link--active' : 'warm-nav-link'
    if (subs.length === 0) {
      parts.push('<a href="' + href + '"' + ext + ' class="' + cls + '">' + label + '</a>')
    } else {
      parts.push('<div class="group relative"><a href="' + href + '"' + ext +
        ' class="' + cls + ' flex items-center gap-1">' + label +
        '<svg class="h-3.5 w-3.5 transition-transform group-hover:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>')
      parts.push('<div class="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100"><div class="w-60 rounded-2xl border border-navy/10 bg-white p-2 shadow-xl shadow-navy/10">')
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        parts.push('<a href="' + shref + '"' + sext +
          ' class="block rounded-xl px-4 py-2.5 text-sm font-semibold uppercase text-ink/70 transition-colors hover:bg-gold/10 hover:text-navy">' +
          enc(s.subMenuName || '') + '</a>')
      }
      parts.push('</div></div></div>')
    }
  }
  return parts.join('')
}

/** Mobile drawer nav (same data hooks as theme 1; warm hover tint; the current
 *  page's row gets a gold tint). */
function renderMobileNav(menus, current) {
  const parts = []
  for (const m of menus) {
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      const tint = isActiveHref(hrefRaw, current) ? 'bg-gold/10 text-navy' : 'text-ink/80'
      parts.push('<a href="' + href + '"' + ext +
        ' data-nav-close class="rounded-xl px-4 py-3 text-sm font-semibold uppercase transition-colors hover:bg-gold/10 hover:text-navy ' + tint + '">' +
        label + '</a>')
    } else {
      parts.push('<div><button type="button" data-nav-accordion class="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold uppercase text-ink/80 transition-colors hover:bg-gold/10 hover:text-navy">' +
        label +
        '<svg data-nav-chevron class="h-4 w-4 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>')
      parts.push('<div data-nav-accordion-panel class="max-h-0 overflow-hidden transition-[max-height] duration-300"><div class="flex flex-col py-1 pl-3">')
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        parts.push('<a href="' + shref + '"' + sext +
          ' data-nav-close class="rounded-xl px-4 py-2.5 text-[13px] font-medium uppercase text-ink/70 hover:bg-gold/10 hover:text-navy">' +
          enc(s.subMenuName || '') + '</a>')
      }
      parts.push('</div></div></div>')
    }
  }
  return parts.join('')
}

/** "UPCOMING EVENTS" / "about us" → "Upcoming Events" / "About Us". */
function titleCase(s) {
  if (!s || !String(s).trim()) return s
  return String(s).trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Footer quick links (two-column list, warm hover, arrow bullets). Labels are
 *  normalised to Title Case regardless of how the admin typed them. */
function renderFooterQuickLinks(menus) {
  const parts = []
  for (const m of menus) {
    if (!m.menuName || !String(m.menuName).trim()) continue
    const href = enc(menuHref(m.linkType, m.linkValue))
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    parts.push('<li><a href="' + href + '"' + ext +
      ' class="group inline-flex items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-gold-light">' +
      '<svg class="h-3.5 w-3.5 shrink-0 text-gold-light/70 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      enc(titleCase(m.menuName)) + '</a></li>')
  }
  return parts.join('')
}

/** Tier-2 social circles — renders nothing when the club has none (2026-07-20). */
function renderFooterSocials(about) {
  const socials = (((about ? about.socials : null) || [])
    .filter((s) => s && s.linkUrl && String(s.linkUrl).trim()))

  if (socials.length === 0) return ''

  const parts = []
  for (const s of socials) {
    let url = String(s.linkUrl).trim()
    if (!/^http/i.test(url)) url = 'https://' + url
    const key = String(s.platform || '').trim().toLowerCase()
    const label = enc(socialLabel(key))
    parts.push('<li><a href="' + enc(url) +
      '" target="_blank" rel="noopener noreferrer" class="group flex items-center gap-3 text-sm font-semibold text-white/80 transition-colors hover:text-gold-light">' +
      '<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition-colors group-hover:bg-gold group-hover:text-white">' +
      socialIcon(key, 'h-4 w-4') + '</span>' +
      '<span>' + label + '</span></a></li>')
  }
  return parts.join('')
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SiteWarmModern({ children }) {
  const adminLoginUrl = useClub().adminLoginUrl
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  // The shell's about (lib/pageShell): already for the picked year and in the visitor's language.
  const about = useClub().about

  // RotaryMasterBase.About — /about for the selected year, fetched once per view.

  const clubName = club.clubDisplayName

  // The club's uploaded Rotary/header logo; "" until /about returns it.
  const rotaryLogoUrl = media(about ? about.rotaryLogoPath : null)
  // The club's own logo (no placeholder); "" when the club has none.
  const clubLogoUrl = media(about ? about.clubLogoPath : null)
  // Header brand: uploaded Rotary logo when present, else the bundled wheel.
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  // Footer logo: club logo, else Rotary logo, else "" (block hidden).
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl

  const current = currentPageFile(location.pathname)

  // Loads warm-modern's rotary-anim.js and runs the one-time shell initialisers
  // (initNav + initLoader) once the nav markup exists — initNav binds to
  // elements that don't exist before the menus have loaded.
  const mainRef = useRef(null)
  useThemeShell('warm-modern', menus.length > 0)
  useRouteEnter(mainRef)
  // The loader covers the wait, as it did when the server rendered the whole page.
  useLoader(!club.loading)

  return (
    <>
      {/* Shell-only styles not produced by Tailwind (loader, lightbox) */}
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      {/* Page loader */}
      <div id="rotary-loader" aria-hidden="true">
        <img src="images/logo/wheel.png" alt="" className="wheel-spin" />
        <span className="px-6 text-center font-heading text-lg font-extrabold tracking-wide text-navy">{clubName}</span>
      </div>

      {/* ══ Top strip (deep terracotta, subtle horizontal gradient) ══ */}
      <div className="hidden bg-gradient-to-r from-navy-deep via-navy to-navy-deep text-white/85 sm:block">
        <div className="container-x flex h-12 items-center justify-between gap-4 text-xs">
          <div className="flex min-w-0 items-center gap-5"
            dangerouslySetInnerHTML={{ __html: renderStripContacts(about) }} />
          <div className="flex shrink-0 items-center gap-3">
            <div className="relative">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <YearSelect className="h-9 cursor-pointer appearance-none rounded-full bg-white pl-9 pr-8 text-sm font-bold text-navy shadow-sm transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gold/40" />
              <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-navy/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gold px-4 text-[13px] font-bold uppercase tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gold-cta hover:shadow-md">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Admin Login
            </a>
          </div>
        </div>
      </div>

      {/* ══ Header (solid white full-width bar; intentionally NO data-nav) ══ */}
      <header className="sticky top-0 z-50 bg-white/95 shadow-sm backdrop-blur">
        <div className="container-x flex h-20 items-center justify-between gap-3">
          <a href="/" className="group flex shrink-0 items-center" aria-label={clubName + ' — Home'}>
            <img src={headerLogoUrl} alt={clubName} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }} className="h-12 w-auto max-w-[180px] shrink-0 object-contain transition-transform duration-300 group-hover:scale-105 md:h-14" />
          </a>

          <nav className="hidden min-w-0 flex-1 flex-wrap content-center items-center justify-end gap-x-0.5 gap-y-1 xl:flex"
            dangerouslySetInnerHTML={{ __html: renderDesktopNav(menus, current) }} />

          <button type="button" data-nav-toggle className="flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-navy/5 xl:hidden" aria-label="Toggle menu">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        {/* Warm gradient hairline instead of a flat grey border */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" aria-hidden="true"></div>
      </header>

      {/* Mobile drawer + backdrop live OUTSIDE <header>: its backdrop-blur makes
          the header the containing block for fixed descendants, which pinned both
          to the 82px header box instead of the screen. */}
      <div data-nav-backdrop className="pointer-events-none fixed inset-0 z-[55] bg-navy/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 xl:hidden"></div>

      {/* The fixed overflow-hidden wrapper clips the off-canvas (translate-x-full)
          panel so it can never widen the page — putting overflow-x on <html>/<body>
          instead breaks position:fixed/sticky. */}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden xl:hidden">
        <div data-nav-drawer className="pointer-events-auto absolute right-0 top-0 flex h-full w-[86%] max-w-sm translate-x-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out">
          <div className="flex shrink-0 items-center justify-between border-b border-navy/10 px-5 py-4">
            <img src={headerLogoUrl} alt={clubName} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }} className="h-11 w-auto shrink-0" />
            <button type="button" data-nav-close className="flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-navy/5" aria-label="Close menu">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
            dangerouslySetInnerHTML={{ __html: renderMobileNav(menus, current) }} />
          <div className="shrink-0 space-y-3 border-t border-navy/10 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-navy">
                <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> Rotary Year
              </span>
              <YearSelect className="h-10 cursor-pointer appearance-none rounded-full border border-navy/20 bg-white pl-3 pr-8 text-sm font-bold text-navy shadow-sm" />
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-nav-close className="btn-navy w-full !rounded-full">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> ADMIN LOGIN
            </a>
          </div>
        </div>
      </div>

      {/* ══ Page content ══ */}
      <main ref={mainRef} className="route-enter">
        {children}
      </main>

      {/* ══ Footer (three tiers) ══ */}
      <footer>
        {/* Tier 2 (v2): deep espresso with a giant script watermark */}
        <div className="relative overflow-hidden bg-navy-deep px-4 py-12 text-white">
          <span className="pointer-events-none absolute -bottom-8 left-0 select-none whitespace-nowrap font-script text-[120px] leading-none text-white/[0.05]" aria-hidden="true">Service Above Self · Service Above Self</span>
          <div className="container-x relative grid gap-10 md:grid-cols-3">
            <div>
              {/* Club brand: club logo → Rotary logo → bundled wheel (only when the
                  club uploaded nothing). A BROKEN uploaded logo hides the card
                  entirely — never substitute the generic wheel for a club's logo. */}
              <div className="mb-5 inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2.5 shadow-lg">
                <img src={!footerLogoUrl ? headerLogoUrl : footerLogoUrl} alt={clubName + ' logo'} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.parentNode.style.display = 'none' }} className="h-12 w-auto" />
              </div>
              {/* Visitor count, under the footer logo — look comes from .rv-vc.
                  The "Service Above Self" script line that used to sit between the
                  two was removed 2026-08-18 by request; the giant watermark behind
                  this band still carries the motto. */}
              <div style={{ marginTop: '18px' }}>
                <VisitorCount />
              </div>
            </div>
            <div>
              <h4 className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-gold-light">Quick Links</h4>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2"
                dangerouslySetInnerHTML={{ __html: renderFooterQuickLinks(menus) }} />
            </div>
            <div>
              <h4 className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-gold-light">Connect</h4>
              <ul className="mt-4 flex flex-col gap-2.5"
                dangerouslySetInnerHTML={{ __html: renderFooterSocials(about) }} />
            </div>
          </div>
        </div>
        {/* Tier 3: copyright strip */}
        <div className="bg-white px-4 py-5 text-center text-sm text-ink/70">
          Powered by Roster On Wheels <span>{new Date().getFullYear()}</span> | All Rights Reserved.
        </div>
      </footer>
    </>
  )
}
