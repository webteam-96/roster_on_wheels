'use client'
// classic-blue shell: floating glass navbar, year selector, mobile drawer and footer.
// Ported from the RIZones club site (layouts/SiteRotary.jsx). The nav and footer markup is string-built as in the
// source (menu labels and URLs go through enc()); public/Themes/classic-blue/js/rotary-anim.js wires the drawer.
import { useClub } from '@/site/ClubContext.jsx'
import { mediaUrl } from '@/site/media.js'
import { menuHref, menuExternal, socialLabel, LOGO_PLACEHOLDER, enc } from '@/site/menus.js'
import YearSelect from '@/site/YearSelect.jsx'
import VisitorCount from '@/themes/shared/visitorCount.jsx'

const SHELL_CSS = `
        [data-desktop-nav] > a,
        [data-desktop-nav] > .group > a{font-size:14.5px}
        #rotary-loader{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:#0B1F5E;color:#fff;transition:opacity .5s ease,visibility .5s ease}
        #rotary-loader.rotary-loader--hidden{opacity:0;visibility:hidden;pointer-events:none}
        #rotary-loader img{width:64px;height:64px}
        .rotary-lightbox{position:fixed;inset:0;z-index:210;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.95);backdrop-filter:blur(4px)}
        .rotary-lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
        .rotary-lightbox__close{position:absolute;top:18px;right:24px;font-size:40px;line-height:1;color:#fff;background:none;border:0;cursor:pointer}
        .rotary-hero-dots{gap:16px;padding:6px 12px;border-radius:9999px;background:rgba(15,23,42,.42);backdrop-filter:blur(2px)}
        [data-hero-dot]{position:relative}
        [data-hero-dot]::after{content:"";position:absolute;inset:-11px}
`

const CHEVRON = '<svg class="h-3.5 w-3.5 transition-transform group-hover:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'

function linkAttrs(linkType, linkValue) {
  const href = enc(menuHref(linkType, linkValue))
  const ext = menuExternal(linkType, linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
  return 'href="' + href + '"' + ext
}

function renderDesktopNav(menus) {
  let sb = ''
  for (const m of menus) {
    const subs = m.subMenus || []
    const attrs = linkAttrs(m.linkType, m.linkValue)
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      sb += '<a ' + attrs + ' class="whitespace-nowrap rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-tight text-ink/70 transition-colors hover:bg-navy/5 hover:text-navy">' + label + '</a>'
      continue
    }
    sb += '<div class="group relative"><a ' + attrs + ' class="flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-tight text-ink/70 transition-colors hover:bg-navy/5 hover:text-navy">' + label + CHEVRON + '</a>'
    sb += '<div class="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100"><div class="w-60 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl shadow-navy/10">'
    for (const s of subs) {
      sb += '<a ' + linkAttrs(s.linkType, s.linkValue) + ' class="block rounded-xl px-4 py-2.5 text-sm font-semibold text-ink/70 transition-colors hover:bg-navy/5 hover:text-navy">' + enc(s.subMenuName || '') + '</a>'
    }
    sb += '</div></div></div>'
  }
  return sb
}

function renderMobileNav(menus) {
  let sb = ''
  for (const m of menus) {
    const subs = m.subMenus || []
    const label = enc(m.menuName || '')
    if (subs.length === 0) {
      sb += '<a ' + linkAttrs(m.linkType, m.linkValue) + ' data-nav-close class="rounded-xl px-4 py-3 text-sm font-semibold uppercase text-ink/80 transition-colors hover:bg-navy/5 hover:text-navy">' + label + '</a>'
      continue
    }
    sb += '<div><button type="button" data-nav-accordion class="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold uppercase text-ink/80 transition-colors hover:bg-navy/5 hover:text-navy">' + label +
      '<svg data-nav-chevron class="h-4 w-4 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
    sb += '<div data-nav-accordion-panel class="max-h-0 overflow-hidden transition-[max-height] duration-300"><div class="flex flex-col py-1 pl-3">'
    for (const s of subs) {
      sb += '<a ' + linkAttrs(s.linkType, s.linkValue) + ' data-nav-close class="rounded-xl px-4 py-2.5 text-[13px] font-medium text-ink/70 hover:bg-navy/5 hover:text-navy">' + enc(s.subMenuName || '') + '</a>'
    }
    sb += '</div></div></div>'
  }
  return sb
}

function renderFooterQuickLinks(menus) {
  let sb = ''
  for (const m of menus) {
    if (!m.menuName || !String(m.menuName).trim()) continue
    sb += '<li><a ' + linkAttrs(m.linkType, m.linkValue) + ' class="uppercase text-white transition-opacity hover:opacity-75" style="font-size:16px">' + enc(m.menuName) + '</a></li>'
  }
  return sb
}

// Email + phone from the club's contacts; nothing at all when it has neither.
function renderFooterContacts(about) {
  const contacts = (about ? about.contacts : null) || []
  const email = contacts.map((c) => (c ? c.email : null)).find((e) => e && String(e).trim())
  const phone = contacts.map((c) => (c ? c.phone : null)).find((p) => p && String(p).trim())
  let sb = ''
  if (email) {
    const e = String(email).trim()
    sb += '<a href="mailto:' + enc(e) + '" class="inline-flex items-center gap-2 text-white transition-opacity hover:opacity-75">' +
      '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg> ' + enc(e) + '</a>'
  }
  if (phone) {
    const p = String(phone).trim()
    sb += '<a href="tel:' + enc(p.replace(/\s/g, '')) + '" class="inline-flex items-center gap-2 text-white transition-opacity hover:opacity-75">' +
      '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ' + enc(p) + '</a>'
  }
  return sb
}

const SOCIAL_PATHS = {
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  twitter: '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
}
const GLOBE = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'

function socialIcon(key) {
  const path = SOCIAL_PATHS[key === 'x' ? 'twitter' : key] || GLOBE
  return '<svg class="h-4 w-4" style="color:#2D3383" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
}

function renderFooterSocials(about) {
  const socials = ((about ? about.socials : null) || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  let sb = ''
  for (const s of socials) {
    let url = String(s.linkUrl).trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    const key = String(s.platform || '').trim().toLowerCase()
    sb += '<li><a href="' + enc(url) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 transition-opacity hover:opacity-75" style="color:#333;font-size:16px">' +
      socialIcon(key) + ' ' + enc(socialLabel(key)) + '</a></li>'
  }
  return sb
}

const LOGIN_ICON = <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
const CALENDAR_ICON = (cls) => <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>

function fallbackToWheel(e) {
  e.currentTarget.onerror = null
  e.currentTarget.src = LOGO_PLACEHOLDER
}

export default function Layout({ children }) {
  const club = useClub()
  const { menus, about, adminLoginUrl } = club
  const clubName = club.clubDisplayName

  const clubLogoUrl = mediaUrl(about ? about.clubLogoPath : null)
  const rotaryLogoUrl = mediaUrl(about ? about.rotaryLogoPath : null)
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />

      <div id="rotary-loader" aria-hidden="true">
        <img src={LOGO_PLACEHOLDER} alt="" className="wheel-spin" />
        <span className="px-6 text-center font-heading text-lg font-extrabold tracking-wide text-white">{clubName}</span>
      </div>

      <header data-nav="" className="sticky top-0 z-50 pt-4 transition-all duration-300">
        <div className="container-x">
          <div data-nav-pill="" className="flex min-h-20 items-center justify-between gap-3 rounded-full border border-white/60 bg-white/80 pl-5 pr-3 shadow-lg shadow-navy/10 backdrop-blur-md transition-all duration-300">
            <a href="/" className="flex shrink-0 items-center" aria-label={clubName + ' home'}>
              <img src={headerLogoUrl} alt={clubName} onError={fallbackToWheel} className="h-12 w-auto max-w-[180px] shrink-0 object-contain md:h-14" />
            </a>

            {/* Fills the space between logo and actions; wraps to two lines when a club's menu is long. */}
            <nav data-desktop-nav="" aria-label="Main" className="hidden min-w-0 flex-1 flex-wrap content-center items-center justify-start gap-x-0.5 gap-y-1 xl:flex"
              dangerouslySetInnerHTML={{ __html: renderDesktopNav(menus) }} />

            <div data-desktop-actions="" className="hidden w-40 shrink-0 flex-col items-stretch gap-1.5 xl:flex">
              <div className="relative">
                {CALENDAR_ICON('pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold')}
                <YearSelect className="h-8 w-full cursor-pointer appearance-none rounded-full border border-navy/20 bg-white pl-9 pr-9 text-sm font-bold text-navy shadow-sm transition-colors hover:border-navy/40 focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20" />
                <svg className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-navy/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-magnetic="" className="btn-navy !h-8 w-full justify-center whitespace-nowrap !rounded-full">
                {LOGIN_ICON} ADMIN LOGIN
              </a>
            </div>

            <button type="button" data-nav-toggle="" className="flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-navy/5 xl:hidden" aria-label="Toggle menu">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div data-nav-backdrop="" className="pointer-events-none fixed inset-0 z-[55] bg-navy/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 xl:hidden"></div>

        <div data-nav-drawer="" className="fixed right-0 top-0 z-[60] flex h-[100dvh] w-[86%] max-w-sm translate-x-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out xl:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-navy/10 px-5 py-4">
            <span className="flex items-center gap-2.5">
              <img src={headerLogoUrl} alt={clubName} onError={fallbackToWheel} className="h-11 w-auto shrink-0" />
            </span>
            <button type="button" data-nav-close="" className="flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-navy/5" aria-label="Close menu">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <nav aria-label="Mobile" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
            dangerouslySetInnerHTML={{ __html: renderMobileNav(menus) }} />
          <div className="shrink-0 space-y-3 border-t border-navy/10 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-navy">
                {CALENDAR_ICON('h-4 w-4 text-gold')} Rotary Year
              </span>
              <div className="relative">
                <YearSelect className="h-10 cursor-pointer appearance-none rounded-full border border-navy/20 bg-white pl-3 pr-8 text-sm font-bold text-navy shadow-sm" />
              </div>
            </div>
            <a href={adminLoginUrl} target="_blank" rel="noopener noreferrer" data-nav-close="" className="btn-navy w-full !rounded-full">
              {LOGIN_ICON} ADMIN LOGIN
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="route-enter">
        {children}
      </main>

      <footer className="text-center" style={{ fontFamily: "'DM Sans',system-ui,sans-serif" }}>
        <div className="px-4 pb-7 pt-10 text-white" style={{ backgroundColor: '#2D3383' }}>
          <div className="mx-auto max-w-4xl">
            {footerLogoUrl && (
              <div className="mx-auto mb-7 inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 shadow-lg">
                <img src={footerLogoUrl} alt={clubName + ' logo'} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.parentNode.style.display = 'none' }} className="h-14 w-auto" />
              </div>
            )}
            <div style={{ margin: '0 auto 28px', maxWidth: '340px' }}>
              <VisitorCount />
            </div>
            <h3 className="font-light leading-tight" style={{ fontSize: '28px' }}>Quick Links</h3>
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#FFCC00' }}></span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#FFCC00' }}></span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#FFCC00' }}></span>
            </div>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2"
              dangerouslySetInnerHTML={{ __html: renderFooterQuickLinks(menus) }} />
            <div className="mx-auto my-6 h-px w-full max-w-[600px]" style={{ backgroundColor: '#eeeeee', opacity: '.3' }}></div>
            <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-2" style={{ fontSize: '16px' }}
              dangerouslySetInnerHTML={{ __html: renderFooterContacts(about) }} />
          </div>
        </div>
        <div className="bg-white px-4 py-6">
          <div className="mx-auto max-w-2xl">
            <ul className="flex flex-wrap items-center justify-center gap-x-9 gap-y-2"
              dangerouslySetInnerHTML={{ __html: renderFooterSocials(about) }} />
            <hr className="my-4 border-gray-200" />
            <div style={{ color: 'rgba(33,37,41,.75)', fontSize: '16px' }}>Powered by Roster On Wheels <span>{new Date().getFullYear()}</span> | All Rights Reserved.</div>
          </div>
        </div>
      </footer>
    </>
  )
}
