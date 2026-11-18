// Port of SiteMadras.Master + SiteMadras.Master.cs.
//
// madras-legacy (theme 3) master: the RC Madras "template 4" shell from the old
// site (Site4.Master), ported markup-verbatim onto the new API data layer. Data
// comes from RotaryMasterBase (menus, years, /about — already ported to
// shared/menus.js + ClubProvider); only the legacy Bootstrap/Font-Awesome markup
// emission lives here. Scoped to RC Madras via the ClubThemeMap appSetting.
//
// The Render* helpers below build HTML STRINGS exactly as the C# StringBuilder
// versions do and are injected with dangerouslySetInnerHTML, so the markup stays
// byte-identical. Internal <a href="Foo.aspx"> links inside still route through
// the SPA: App.jsx installs a global anchor click-interceptor.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import { getAbout } from '../api/clubService.js'
import { mediaUrl } from '../lib/media.js'
import { useMenus, menuHref, menuExternal, LOGO_PLACEHOLDER } from '../shared/menus.js'
import { routeKey } from '../routes.js'
import { enc } from '../shared/Breadcrumb.jsx'
import YearSelect from '../shared/YearSelect.jsx'
import VisitorCount from '../shared/visitorCount.jsx'
import { useThemeShell } from '../shared/useRotaryAnim.js'
import { loadThemeScripts } from '../theme/themeAssets.js'
import { appSettings } from '../config.js'

// ── Head strings, exact legacy formats (old Site4.Master.cs BindClubDetails):
//    title had TWO spaces after "Home Page - "; keywords/description are the
//    verbatim templates. City comes from /about (old code used the city id). ──
function legacyTitle(clubName) {
  return 'Home Page - Rotary Club of ' + clubName
}

function legacyMetaKeywords(clubName, city) {
  return 'Rotary club near me, Rotary Club ' + clubName + ', Rotary Club of ' + clubName +
    ', Rotary Club In ' + city
}

function legacyMetaDescription(clubName) {
  return 'In our Rotary club ' + clubName + ' you will find members volunteering in communities ' +
    'to support education and provide clean water, combat hunger, improve health and sanitation, ' +
    'and eradicate polio.'
}

/** Page.MetaKeywords / Page.MetaDescription — upsert the meta in the document head. */
function setMeta(name, content) {
  let el = document.head.querySelector('meta[name="' + name + '"]')
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

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

/**
 * The nested-UL menu tree the old asp:Menu control used to render inside #Menu1
 * (club-theme-one.css styles it purely via "#Menu1 ul ..." selectors, so plain
 * ULs restyle identically). main_menu / level_menu / selected mirror the old
 * control's LevelMenuItemStyles CssClasses.
 */
function renderLegacyMenu(menus, current) {
  const sb = []
  sb.push('<ul class="level1">')
  for (const m of menus) {
    if (!m || !m.menuName || !String(m.menuName).trim()) continue
    const subs = m.subMenus || []
    const hrefRaw = menuHref(m.linkType, m.linkValue)
    const href = enc(hrefRaw)
    const ext = menuExternal(m.linkType, m.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const active = isActiveHref(hrefRaw, current)
      || subs.some((s) => isActiveHref(menuHref(s.linkType, s.linkValue), current))
    // "popout" marks a dropdown parent — club-theme-one.css draws the legacy
    // chevron via "#Menu1 a.popout:after". The old asp:Menu added it
    // automatically; toUpperCase matches its server-side transform (the legacy
    // ALL-CAPS came from code, not CSS).
    sb.push('<li><a class="main_menu' + (subs.length > 0 ? ' popout' : '') + (active ? ' selected' : '') +
      '" href="' + href + '"' + ext + '>' + enc(String(m.menuName || '').toUpperCase()) + '</a>')
    if (subs.length > 0) {
      sb.push('<ul class="level2">')
      for (const s of subs) {
        const shref = enc(menuHref(s.linkType, s.linkValue))
        const sext = menuExternal(s.linkType, s.linkValue) ? ' target="_blank" rel="noopener noreferrer"' : ''
        sb.push('<li><a class="level_menu" href="' + shref + '"' + sext + '>' +
          enc(String(s.subMenuName || '').toUpperCase()) + '</a></li>')
      }
      sb.push('</ul>')
    }
    sb.push('</li>')
  }
  sb.push('</ul>')
  return sb.join('')
}

/** Footer contact anchors — the legacy Sendmail / Call pattern. The old shell
 *  ALWAYS rendered both anchors (icon + label text, the text simply empty when
 *  the club had no data), so this does too. */
function renderFooterContacts(about) {
  const contacts = (about ? about.contacts : null) || []
  const email = String(contacts.map((c) => c && c.email).find((e) => e && String(e).trim()) || '').trim()
  const phone = String(contacts.map((c) => c && c.phone).find((p) => p && String(p).trim()) || '').trim()

  let sb = ''
  sb += '<a id="Sendmail"'
  if (email.length > 0) sb += ' href="mailto:' + enc(email) + '"'
  sb += '><i class="fal fa-envelope"></i><span>' + enc(email) + '</span></a>'
  sb += '<a id="Call"'
  if (phone.length > 0) sb += ' href="tel:' + enc(phone.replace(/\s/g, '')) + '"'
  sb += '><i class="fal fa-phone-alt"></i><span>' + enc(phone) + '</span></a>'
  return sb
}

// legacy li order + icon class + label (verbatim from Site4.Master)
const SOCIAL_SLOTS = [
  { keys: ['facebook'], icon: 'fab fa-facebook me-3', label: 'Facebook' },
  { keys: ['twitter', 'x'], icon: 'fab fa-twitter me-3', label: 'Twitter' },
  { keys: ['google'], icon: 'fab fa-google-plus-g', label: 'Google Plus' },
  { keys: ['instagram'], icon: 'fab fa-instagram me-3', label: 'Instagram' },
  { keys: ['youtube'], icon: 'fab fa-youtube me-3', label: 'Youtube' },
  { keys: ['linkedin'], icon: 'fab fa-linkedin me-3', label: 'Linkedin' },
]

/** Footer social list items, exactly as the legacy markup: the six platforms it
 *  knew, in its fixed order (Facebook, Twitter, Google Plus, Instagram, Youtube,
 *  Linkedin), with its icon classes and labels — a platform only renders when the
 *  club has a link (old visible toggles). Unknown platforms are skipped, like the
 *  old FK_Socialmedia_ID mapping. NOTE: this master keeps its own labels; it does
 *  NOT use the shared socialLabel(). */
function renderFooterSocials(about) {
  const socials = ((about ? about.socials : null) || [])
    .filter((s) => s && s.linkUrl && String(s.linkUrl).trim())

  let sb = ''
  for (const slot of SOCIAL_SLOTS) {
    const match = socials.find((s) => slot.keys.includes(String(s.platform || '').trim().toLowerCase()))
    if (!match) continue
    let url = String(match.linkUrl).trim()
    if (!/^http/i.test(url)) url = 'https://' + url
    sb += '<li class="nav-item"><a href="' + enc(url) +
      '" target="_blank" rel="noopener noreferrer" class="nav-link"><i class="' +
      slot.icon + '"></i>' + slot.label + '</a></li>'
  }
  return sb
}

/**
 * The owl half of the master's inline $(document).ready() block. Guarded on
 * `.owl-loaded` AND a non-empty container: the shell mounts once here while the
 * content swaps under it, so #owl-demo exists long before its slides land, and
 * owl v2 only picks up the items present at init time.
 */
// Owl builds its dots as empty <button>s, so a screen reader announces nothing.
// It redraws them whenever the slide count changes (and HomeMadras destroys +
// refills the carousels), hence the 'refreshed'/'changed' relabel as well.
function labelDots($el, noun) {
  const apply = () => {
    $el.find('.owl-dots').attr({ role: 'group', 'aria-label': noun + ' slides' })
      .children('.owl-dot').each(function (i) {
        this.setAttribute('aria-label', 'Go to ' + noun + ' ' + (i + 1))
      })
  }
  $el.on('refreshed.owl.carousel changed.owl.carousel', apply)
  apply()
}

export function initOwl() {
  const $ = window.jQuery
  if (!$ || !$.fn || !$.fn.owlCarousel) return

  const demo = $('#owl-demo')
  if (demo.length && demo.children().length && !demo.hasClass('owl-loaded')) {
    demo.owlCarousel({
      items: 1,
      autoplay: true,
      loop: true,
      autoplayHoverPause: true,
      paginationSpeed: 1000,
      // autoHeight OFF: it wrote an inline height onto the owl stage for
      // whichever slide was showing, so a club mixing 16:5 and 5:3 banners
      // made this row (advertisement card included) jump between slides.
      // The banner now fills the row height via club-theme-one.css instead.
      autoHeight: false,
      transitionStyle: 'fade',
      lazyLoad: true,
      dots: true,
      // the original set animateOut twice ('slideOutDown' then 'fadeOut');
      // the second wins, so only it is kept here.
      animateOut: 'fadeOut',
      animateIn: 'slideInDown',
    })
    labelDots(demo, 'banner')
  }

  const advt = $('#owl-advt')
  if (advt.length && advt.children().length && !advt.hasClass('owl-loaded')) {
    advt.owlCarousel({
      items: 1,
      loop: true,
      autoplay: true,
      nav: false,
      dots: true,
    })
    labelDots(advt, 'advertisement')
  }
}

// The master's inline <style> block, verbatim.
const MADRAS_SHELL_CSS = `
        nav.nav_first #Menu1 ul ul{
            z-index: 9999;
        }
        /* The old asp:Menu control's JavaScript positioned and showed/hid the
           dropdowns; this port renders plain nested ULs, so pure CSS takes over. */
        nav.nav_first #Menu1 ul { list-style: none; }
        nav.nav_first #Menu1 ul li { position: relative; }
        nav.nav_first #Menu1 ul ul {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            min-width: 220px;
        }
        nav.nav_first #Menu1 ul ul li { width: 100%; }
        nav.nav_first #Menu1 ul li:hover > ul { display: block; }
        /* rotary-design.css (Tailwind, needed for content pages) defines a
           .collapse{visibility:collapse} utility that collides with Bootstrap's
           .collapse on the Club Projects navbar — undo it for this element. */
        #navbarNavDropdown { visibility: visible; }
        /* Tailwind's preflight makes img display:block, which defeats the legacy
           text-align:center on .digni-box — restore the inline behavior so the
           dignitary photos center like the original. */
        .digni-box img { display: inline-block; object-fit: cover; }
`

export default function SiteMadras({ children }) {
  const club = useClub()
  const menus = useMenus()
  const location = useLocation()
  const [about, setAbout] = useState(null)

  // RotaryMasterBase.About — /about for the selected year, the club identity
  // (logo, contacts, socials, city) the shell renders.
  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    getAbout(club.clubId, club.selectedYearId).then((a) => { if (!cancelled) setAbout(a) })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId])

  const clubName = club.clubDisplayName
  const clubLogoUrl = mediaUrl(about ? about.clubLogoPath : null)
  const rotaryLogoUrl = mediaUrl(about ? about.rotaryLogoPath : null)
  // Header brand: uploaded Rotary logo when present, else the bundled wheel.
  const headerLogoUrl = rotaryLogoUrl || LOGO_PLACEHOLDER
  // Footer logo: club logo, else Rotary logo, else "" (block hidden).
  const footerLogoUrl = clubLogoUrl || rotaryLogoUrl
  const city = String((about && about.city) || '').trim()

  // <title> + the description/keywords metas the code-behind injects via
  // Page.MetaKeywords / Page.MetaDescription (same mechanism the old Site4 used).
  // This shell ALWAYS uses LegacyTitle — a content page's SetTitle is ignored
  // here, exactly as in the Master's hardcoded <title>.
  useEffect(() => {
    document.title = legacyTitle(clubName)
    setMeta('keywords', legacyMetaKeywords(clubName, city))
    setMeta('description', legacyMetaDescription(clubName))
  }, [clubName, city, location.pathname])

  // The owl carousels the legacy Home carries. A MutationObserver re-checks
  // because the slides are rendered by the page component after its API call
  // lands, i.e. after this effect first runs. initOwl() is guarded, so every
  // extra call after both sliders are up is a no-op.
  useEffect(() => {
    let cancelled = false
    let queued = false
    const run = () => { queued = false; if (!cancelled) initOwl() }
    const obs = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(run)
    })
    loadThemeScripts('madras-legacy').then(() => {
      if (cancelled) return
      initOwl()
      obs.observe(document.body, { childList: true, subtree: true })
    })
    return () => { cancelled = true; obs.disconnect() }
  }, [])

  // Loads this theme's scripts in order (jQuery → bootstrap → uiscript →
  // magnific → owl → rotary-anim) and runs the one-time shell initialisers once
  // the nav markup exists.
  useThemeShell('madras-legacy', menus.length > 0)

  const current = currentPageFile(location.pathname)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MADRAS_SHELL_CSS }} />

      <h1 id="header_tag" style={{ display: 'none' }}>{'Rotary Club of ' + clubName}</h1>

      <header className="main-header">
        <div className="container">
          <div className="the_row">
            <div className="the_Logo">
              <div id="div_Upperlogo">
                <a className="logo" href="/">
                  <img
                    id="img_upperlogo"
                    src={headerLogoUrl}
                    alt={clubName}
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'images/logo/wheel.png' }}
                  />
                </a>

              </div>
              <a href={appSettings.AdminLoginUrl} target="_blank" rel="noopener noreferrer" className="d-md-none btn btn-primary">ADMIN LOGIN</a>
              <label htmlFor="toggleMenu" className="ms-3 menu-bar fal fa-bars fa-2x">
                <input type="checkbox" id="toggleMenu" />
              </label>

            </div>
            <div className="nav_holder">
              <div className="container-fluid">

                <nav className="nav_first">
                  <div
                    id="Menu1"
                    style={{ float: 'right' }}
                    dangerouslySetInnerHTML={{ __html: renderLegacyMenu(menus, current) }}
                  />
                  <div className="nav_btn">
                    <a href={appSettings.AdminLoginUrl} target="_blank" rel="noopener noreferrer" className="btn btn-light">ADMIN LOGIN</a>
                  </div>
                </nav>
                <nav className="navbar navbar-expand-lg nav_second">
                  <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNavDropdown" aria-controls="navbarNavDropdown" aria-expanded="false" aria-label="Toggle navigation">
                    <span className="fa fa-chevron-down"></span>
                  </button>
                  <div className="year_dropdown d-flex">
                    {/* data-year-select: the shared YearSelect re-renders the page for
                        the picked year (it replaces rotary-anim.js's initYearSelect,
                        which is not used in the SPA — it did a full reload). */}
                    <YearSelect className="form-select" />
                  </div>
                  <div className="container-fluid">

                    <div className="collapse navbar-collapse" id="navbarNavDropdown">
                      <ul className="navbar-nav">
                        <li className="nav-item bg-color dropdown">
                          <a className="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">Club Projects
                          </a>
                          <ul className="dropdown-menu">
                            <li><a className="dropdown-item" href="/projects?pr=CP">Community Service</a></li>
                            <li><a className="dropdown-item" href="/projects?pr=CS">Club Service</a></li>
                            <li><a className="dropdown-item" href="/projects?pr=VS">Vocational Service</a></li>
                            <li><a className="dropdown-item" href="/projects?pr=NGS">New Generation service</a></li>
                            <li><a className="dropdown-item" href="/projects?pr=IS">International service</a></li>
                            <li><a className="dropdown-item" href="/projects?pr=PII">Public Image Initiative</a></li>
                          </ul>
                        </li>
                      </ul>
                    </div>
                  </div>
                </nav>
              </div>
            </div>
          </div>
        </div>
      </header>

      {children}

      <footer className="text-center">
        <div className="footer_first">
          <div className="container">
            <h3 className="title_section">Quick Links
              <span></span>
            </h3>
            <ul className="list_quick_link nav justify-content-center">
              <li className="nav-item">
                <a className="nav-link active" href="/">Home</a>
              </li>
              <li className="nav-item">
                <a className="nav-link" href="/directory">Directory</a>
              </li>
              <li className="nav-item">
                <a className="nav-link" href="/directors">Directors</a>
              </li>
              <li className="nav-item">
                <a className="nav-link" href="/calendar">Calendar</a>
              </li>
              <li className="nav-item">
                <a className="nav-link" href="/newsletters">Newsletter</a>
              </li>
            </ul>
            <div className="divider w-md-50"></div>
            <div
              className="contact_details"
              dangerouslySetInnerHTML={{ __html: renderFooterContacts(about) }}
            />
          </div>
        </div>
        <div className="footer_second bg-white">
          <div className="container w-md-50">
            <ul
              className="list_quick_link nav justify-content-center"
              dangerouslySetInnerHTML={{ __html: renderFooterSocials(about) }}
            />
            {footerLogoUrl && (
              <div className="footer-logo" id="div_lowerlogo" style={{ display: 'none' }}>
                <img id="img_lowerlogo" className="w-100 valid" src={footerLogoUrl} alt="" />
              </div>
            )}
            {/* Visitor count sits under the footer logo. It is OUTSIDE
                #div_lowerlogo on purpose — that block ships display:none (legacy
                behaviour kept from the Web Forms original), so anything nested
                inside it would never be seen. */}
            <div style={{ margin: '14px auto 0', maxWidth: '340px' }}><VisitorCount /></div>
            <hr />
            <div className="text-muted">
              Powered by Roster On Wheels <span className="getYear">{new Date().getFullYear()}</span> | All Rights Reserved.
            </div>
          </div>
        </div>
      </footer>

    </>
  )
}
